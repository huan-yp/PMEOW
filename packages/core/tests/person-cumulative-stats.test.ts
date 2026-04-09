import { describe, expect, it } from 'vitest';
import { getDatabase } from '../src/db/database.js';
import { createServer } from '../src/db/servers.js';
import { createPerson, createPersonBinding } from '../src/db/persons.js';
import {
  estimateSnapshotIntervalMs,
  queryPersonCumulativeStats,
  getPersonSummaries,
  insertPersonAttributionFact,
} from '../src/db/person-attribution.js';

function insertGpuFact(serverId: string, personId: string | null, rawUser: string | null, gpuIndex: number, vramMB: number, timestamp: number): void {
  insertPersonAttributionFact({
    timestamp,
    sourceType: 'gpu_snapshot',
    serverId,
    personId,
    rawUser,
    taskId: null,
    gpuIndex,
    vramMB,
    taskStatus: null,
    resolutionSource: personId ? 'binding' : 'unassigned',
    metadataJson: '{}',
  });
}

describe('person cumulative stats', () => {
  it('computes occupancyHours and gbHours for known-interval facts', () => {
    const server = createServer({ name: 'cum-1', host: 'cum-1', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-cum-1' });
    const alice = createPerson({ displayName: 'Alice', customFields: {} });
    createPersonBinding({ personId: alice.id, serverId: server.id, systemUser: 'alice', source: 'manual', effectiveFrom: 0 });

    const now = Date.now();
    // 3 snapshots at 60s intervals, each with 1024 MB
    insertGpuFact(server.id, alice.id, 'alice', 0, 1024, now - 120_000);
    insertGpuFact(server.id, alice.id, 'alice', 0, 1024, now - 60_000);
    insertGpuFact(server.id, alice.id, 'alice', 0, 1024, now);

    const from = now - 300_000;
    const interval = estimateSnapshotIntervalMs(from);
    expect(interval).toBe(60_000);

    const stats = queryPersonCumulativeStats(from);
    expect(stats.has(alice.id)).toBe(true);

    const aliceStats = stats.get(alice.id)!;
    // 3 snapshots × 60000ms / 3600000 = 0.05 hours
    expect(aliceStats.occupancyHours).toBeCloseTo(3 * 60_000 / 3_600_000, 4);
    // (1024+1024+1024) × 60000 / (1024 × 3600000) = 3 × 60000 / 3600000 = 0.05
    expect(aliceStats.gbHours).toBeCloseTo(3 * 1024 * 60_000 / (1024 * 3_600_000), 4);
  });

  it('returns empty map when no facts exist', () => {
    const from = Date.now() - 86_400_000;
    const stats = queryPersonCumulativeStats(from);
    expect(stats.size).toBe(0);
  });

  it('excludes unassigned (personId=null) facts from cumulative stats', () => {
    const server = createServer({ name: 'cum-3', host: 'cum-3', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-cum-3' });

    const now = Date.now();
    insertGpuFact(server.id, null, 'nobody', 0, 2048, now - 60_000);
    insertGpuFact(server.id, null, 'nobody', 0, 2048, now);

    const stats = queryPersonCumulativeStats(now - 300_000);
    expect(stats.size).toBe(0);
  });

  it('filters by time window correctly', () => {
    const server = createServer({ name: 'cum-4', host: 'cum-4', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-cum-4' });
    const bob = createPerson({ displayName: 'Bob', customFields: {} });

    const now = Date.now();
    const oneHourAgo = now - 3_600_000;
    const twoHoursAgo = now - 7_200_000;

    // One fact outside 1h window, two inside
    insertGpuFact(server.id, bob.id, 'bob', 0, 512, twoHoursAgo);
    insertGpuFact(server.id, bob.id, 'bob', 0, 512, oneHourAgo);
    insertGpuFact(server.id, bob.id, 'bob', 0, 512, now);

    // Query with 1h window — should only include 2 of the 3 facts
    const statsNarrow = queryPersonCumulativeStats(oneHourAgo);
    expect(statsNarrow.has(bob.id)).toBe(true);
    const narrow = statsNarrow.get(bob.id)!;

    // Query with 3h window — should include all 3 facts
    const statsWide = queryPersonCumulativeStats(twoHoursAgo - 1);
    const wide = statsWide.get(bob.id)!;

    expect(wide.occupancyHours).toBeGreaterThan(narrow.occupancyHours);
    expect(wide.gbHours).toBeGreaterThan(narrow.gbHours);
  });

  it('populates vramOccupancyHours and vramGigabyteHours in getPersonSummaries', () => {
    const server = createServer({ name: 'cum-5', host: 'cum-5', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-cum-5' });
    const carol = createPerson({ displayName: 'Carol', customFields: {} });
    createPersonBinding({ personId: carol.id, serverId: server.id, systemUser: 'carol', source: 'manual', effectiveFrom: 0 });

    const now = Date.now();
    insertGpuFact(server.id, carol.id, 'carol', 0, 2048, now - 120_000);
    insertGpuFact(server.id, carol.id, 'carol', 0, 2048, now - 60_000);
    insertGpuFact(server.id, carol.id, 'carol', 0, 2048, now);

    const summaries = getPersonSummaries(1);
    const carolSummary = summaries.find(s => s.personId === carol.id);
    expect(carolSummary).toBeDefined();
    expect(carolSummary!.vramOccupancyHours).toBeGreaterThan(0);
    expect(carolSummary!.vramGigabyteHours).toBeGreaterThan(0);
  });

  it('computes per-server intervals correctly in multi-server deployments', () => {
    // Server A pushes every 60s, Server B pushes every 60s but offset by 5s.
    // With a single global interval the interleaving halves the estimate (~30s).
    const serverA = createServer({ name: 'cum-multi-a', host: 'cum-multi-a', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-multi-a' });
    const serverB = createServer({ name: 'cum-multi-b', host: 'cum-multi-b', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-multi-b' });
    const alice = createPerson({ displayName: 'Alice', customFields: {} });
    createPersonBinding({ personId: alice.id, serverId: serverA.id, systemUser: 'alice', source: 'manual', effectiveFrom: 0 });
    createPersonBinding({ personId: alice.id, serverId: serverB.id, systemUser: 'alice', source: 'manual', effectiveFrom: 0 });

    const now = Date.now();
    // Server A: 3 snapshots at 60s intervals
    for (let i = 0; i < 3; i++) {
      insertGpuFact(serverA.id, alice.id, 'alice', 0, 1024, now - (2 - i) * 60_000);
    }
    // Server B: 3 snapshots at 60s intervals, offset by 5s
    for (let i = 0; i < 3; i++) {
      insertGpuFact(serverB.id, alice.id, 'alice', 0, 2048, now - (2 - i) * 60_000 + 5_000);
    }

    const from = now - 300_000;
    const stats = queryPersonCumulativeStats(from);
    const aliceStats = stats.get(alice.id)!;

    // occupancyHours: 3 snapshots × 60s on each server = 2 × 0.05h = 0.1h
    expect(aliceStats.occupancyHours).toBeCloseTo(6 * 60_000 / 3_600_000, 4);

    // gbHours: Server A contributes 3 × 1024 MB × 60s, Server B contributes 3 × 2048 MB × 60s
    // = (3072 × 60000 + 6144 × 60000) / (1024 × 3600000)
    const expectedGbH = (3 * 1024 * 60_000 + 3 * 2048 * 60_000) / (1024 * 3_600_000);
    expect(aliceStats.gbHours).toBeCloseTo(expectedGbH, 4);
  });

  it('returns fallback interval of 60s when fewer than 2 distinct timestamps exist', () => {
    const server = createServer({ name: 'cum-6', host: 'cum-6', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-cum-6' });
    const dan = createPerson({ displayName: 'Dan', customFields: {} });

    const now = Date.now();
    insertGpuFact(server.id, dan.id, 'dan', 0, 4096, now);

    const interval = estimateSnapshotIntervalMs(now - 300_000);
    expect(interval).toBe(60_000);
  });
});
