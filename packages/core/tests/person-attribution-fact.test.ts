import { describe, expect, it } from 'vitest';
import { getDatabase } from '../src/db/database.js';
import { createServer } from '../src/db/servers.js';
import { createPerson, createPersonBinding, setTaskOwnerOverride } from '../src/db/persons.js';
import { upsertAgentTask } from '../src/db/agent-tasks.js';
import { writeAttributionFacts } from '../src/person/attribution.js';
import { insertPersonAttributionFacts, getPersonTimeline } from '../src/db/person-attribution.js';
import { ingestAgentMetrics } from '../src/agent/ingest.js';
import type { MetricsSnapshot, PersonAttributionFact } from '../src/types.js';

function makeSnapshot(serverId: string, overrides?: Partial<MetricsSnapshot>): MetricsSnapshot {
  const now = Date.now();
  return {
    serverId,
    timestamp: now,
    cpu: { usagePercent: 0, coreCount: 1, modelName: 'CPU', frequencyMhz: 0, perCoreUsage: [0] },
    memory: { totalMB: 1, usedMB: 0, availableMB: 1, usagePercent: 0, swapTotalMB: 0, swapUsedMB: 0, swapPercent: 0 },
    disk: { disks: [], ioReadKBs: 0, ioWriteKBs: 0 },
    network: { rxBytesPerSec: 0, txBytesPerSec: 0, interfaces: [] },
    gpu: { available: true, totalMemoryMB: 24576, usedMemoryMB: 0, memoryUsagePercent: 0, utilizationPercent: 0, temperatureC: 0, gpuCount: 1 },
    processes: [],
    docker: [],
    system: { hostname: 'test-host', uptime: '1 day', loadAvg1: 0, loadAvg5: 0, loadAvg15: 0, kernelVersion: '6.8.0' },
    ...overrides,
  };
}

function readFacts(serverId: string): Array<Record<string, unknown>> {
  const db = getDatabase();
  return db.prepare('SELECT * FROM person_attribution_facts WHERE serverId = ? ORDER BY gpuIndex, rawUser').all(serverId) as Array<Record<string, unknown>>;
}

describe('person attribution fact persistence', () => {
  it('writes facts with correct personId for a bound user process', () => {
    const server = createServer({ name: 'fact-1', host: 'fact-1', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-fact-1' });
    const alice = createPerson({ displayName: 'Alice', customFields: {} });
    createPersonBinding({ personId: alice.id, serverId: server.id, systemUser: 'alice', source: 'manual', effectiveFrom: Date.now() - 100_000 });

    upsertAgentTask({ serverId: server.id, taskId: 'task-f1', status: 'running', user: 'alice', startedAt: Date.now() - 50_000 });

    const snapshot = makeSnapshot(server.id, {
      gpuAllocation: {
        perGpu: [{
          gpuIndex: 0,
          totalMemoryMB: 24576,
          usedMemoryMB: 8192,
          pmeowTasks: [{ taskId: 'task-f1', gpuIndex: 0, declaredVramMB: 8192, actualVramMB: 6144 }],
          userProcesses: [{ pid: 3001, user: 'alice', gpuIndex: 0, usedMemoryMB: 2048, command: 'python train.py' }],
          unknownProcesses: [],
          effectiveFreeMB: 16384,
        }],
        byUser: [{ user: 'alice', totalVramMB: 8192, gpuIndices: [0] }],
      },
    });

    writeAttributionFacts(snapshot, []);

    const facts = readFacts(server.id);
    expect(facts).toHaveLength(2);

    // Task fact
    const taskFact = facts.find(f => f.taskId === 'task-f1');
    expect(taskFact).toBeDefined();
    expect(taskFact!.personId).toBe(alice.id);
    expect(taskFact!.rawUser).toBe('alice');
    expect(taskFact!.gpuIndex).toBe(0);
    expect(taskFact!.vramMB).toBe(6144);
    expect(taskFact!.resolutionSource).toBe('binding');

    // User process fact
    const userFact = facts.find(f => f.taskId === null && f.rawUser === 'alice');
    expect(userFact).toBeDefined();
    expect(userFact!.personId).toBe(alice.id);
    expect(userFact!.vramMB).toBe(2048);
    expect(userFact!.resolutionSource).toBe('binding');
  });

  it('writes facts with personId null for unbound user processes', () => {
    const server = createServer({ name: 'fact-2', host: 'fact-2', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-fact-2' });

    const snapshot = makeSnapshot(server.id, {
      gpuAllocation: {
        perGpu: [{
          gpuIndex: 0,
          totalMemoryMB: 24576,
          usedMemoryMB: 4096,
          pmeowTasks: [],
          userProcesses: [{ pid: 4001, user: 'nobody', gpuIndex: 0, usedMemoryMB: 4096, command: 'python idle.py' }],
          unknownProcesses: [{ pid: 4002, gpuIndex: 0, usedMemoryMB: 512, command: 'mystery' }],
          effectiveFreeMB: 20480,
        }],
        byUser: [{ user: 'nobody', totalVramMB: 4096, gpuIndices: [0] }],
      },
    });

    writeAttributionFacts(snapshot, []);

    const facts = readFacts(server.id);
    expect(facts).toHaveLength(2);

    // Unbound user process
    const userFact = facts.find(f => f.rawUser === 'nobody');
    expect(userFact).toBeDefined();
    expect(userFact!.personId).toBeNull();
    expect(userFact!.vramMB).toBe(4096);
    expect(userFact!.resolutionSource).toBe('unassigned');

    // Unknown process
    const unknownFact = facts.find(f => f.rawUser === null);
    expect(unknownFact).toBeDefined();
    expect(unknownFact!.personId).toBeNull();
    expect(unknownFact!.vramMB).toBe(512);
    expect(unknownFact!.resolutionSource).toBe('unassigned');
  });

  it('handles zero-person mode gracefully without crashing', () => {
    const server = createServer({ name: 'fact-3', host: 'fact-3', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-fact-3' });

    const snapshot = makeSnapshot(server.id, {
      gpuAllocation: {
        perGpu: [{
          gpuIndex: 0,
          totalMemoryMB: 24576,
          usedMemoryMB: 2048,
          pmeowTasks: [],
          userProcesses: [{ pid: 5001, user: 'some-user', gpuIndex: 0, usedMemoryMB: 2048, command: 'python run.py' }],
          unknownProcesses: [],
          effectiveFreeMB: 22528,
        }],
        byUser: [{ user: 'some-user', totalVramMB: 2048, gpuIndices: [0] }],
      },
    });

    // Should not throw even with no persons configured at all
    expect(() => writeAttributionFacts(snapshot, [])).not.toThrow();

    const facts = readFacts(server.id);
    expect(facts).toHaveLength(1);
    expect(facts[0].personId).toBeNull();
    expect(facts[0].rawUser).toBe('some-user');
    expect(facts[0].resolutionSource).toBe('unassigned');
  });

  it('skips writing when snapshot has no gpuAllocation', () => {
    const server = createServer({ name: 'fact-4', host: 'fact-4', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'ssh' });

    const snapshot = makeSnapshot(server.id);

    writeAttributionFacts(snapshot, []);

    const facts = readFacts(server.id);
    expect(facts).toHaveLength(0);
  });

  it('uses override resolution source for tasks with an explicit owner override', () => {
    const server = createServer({ name: 'fact-5', host: 'fact-5', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-fact-5' });
    const bob = createPerson({ displayName: 'Bob', customFields: {} });

    setTaskOwnerOverride({ taskId: 'task-override-1', serverId: server.id, personId: bob.id, source: 'manual', effectiveFrom: Date.now() - 100_000 });
    upsertAgentTask({ serverId: server.id, taskId: 'task-override-1', status: 'running', user: 'train', startedAt: Date.now() - 50_000 });

    const snapshot = makeSnapshot(server.id, {
      gpuAllocation: {
        perGpu: [{
          gpuIndex: 0,
          totalMemoryMB: 24576,
          usedMemoryMB: 8192,
          pmeowTasks: [{ taskId: 'task-override-1', gpuIndex: 0, declaredVramMB: 8192, actualVramMB: 8192 }],
          userProcesses: [],
          unknownProcesses: [],
          effectiveFreeMB: 16384,
        }],
        byUser: [],
      },
    });

    writeAttributionFacts(snapshot, []);

    const facts = readFacts(server.id);
    expect(facts).toHaveLength(1);
    expect(facts[0].personId).toBe(bob.id);
    expect(facts[0].resolutionSource).toBe('override');
  });

  it('produces a non-empty person timeline when the only GPU usage is a pmeow task (agent pipeline)', () => {
    const server = createServer({ name: 'task-only', host: 'task-only', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-task-only' });
    const alice = createPerson({ displayName: 'Alice', customFields: {} });
    const now = Date.now();
    createPersonBinding({ personId: alice.id, serverId: server.id, systemUser: 'alice', source: 'manual', effectiveFrom: now - 10 * 60 * 1000 });
    upsertAgentTask({ serverId: server.id, taskId: 'task-only-1', status: 'running', user: 'alice', startedAt: now - 60_000 });

    const snapshot: MetricsSnapshot = {
      serverId: server.id,
      timestamp: now,
      cpu: { usagePercent: 0, coreCount: 1, modelName: 'CPU', frequencyMhz: 0, perCoreUsage: [0] },
      memory: { totalMB: 1, usedMB: 0, availableMB: 1, usagePercent: 0, swapTotalMB: 0, swapUsedMB: 0, swapPercent: 0 },
      disk: { disks: [], ioReadKBs: 0, ioWriteKBs: 0 },
      network: { rxBytesPerSec: 0, txBytesPerSec: 0, interfaces: [] },
      gpu: { available: true, totalMemoryMB: 24576, usedMemoryMB: 6144, memoryUsagePercent: 25, utilizationPercent: 0, temperatureC: 0, gpuCount: 1 },
      processes: [],
      docker: [],
      system: { hostname: 'task-only', uptime: '1 day', loadAvg1: 0, loadAvg5: 0, loadAvg15: 0, kernelVersion: '6.8.0' },
      gpuAllocation: {
        perGpu: [{
          gpuIndex: 0,
          totalMemoryMB: 24576,
          usedMemoryMB: 6144,
          pmeowTasks: [{ taskId: 'task-only-1', gpuIndex: 0, declaredVramMB: 8192, actualVramMB: 6144 }],
          userProcesses: [],
          unknownProcesses: [],
          effectiveFreeMB: 18432,
        }],
        byUser: [],
      },
    };

    // Replicate scheduler.handleMetrics for agent data: both attribution paths run.
    ingestAgentMetrics(snapshot);
    writeAttributionFacts(snapshot, []);

    // getPersonTimeline should surface rows for Alice and include task VRAM in taskVramMB.
    const timeline = getPersonTimeline(alice.id, 24);
    expect(timeline.length, 'timeline must not be empty for a person whose only GPU usage is a pmeow task').toBeGreaterThan(0);
    const total = timeline.reduce((sum, p) => sum + p.totalVramMB, 0);
    const taskOnly = timeline.reduce((sum, p) => sum + p.taskVramMB, 0);
    expect(total, 'total VRAM should count the task allocation').toBeGreaterThan(0);
    expect(taskOnly, 'task VRAM should be attributed to taskVramMB (not nonTaskVramMB)').toBeGreaterThan(0);
  });

  it('batch inserts via insertPersonAttributionFacts correctly', () => {
    const server = createServer({ name: 'fact-batch', host: 'fact-batch', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-batch' });
    const now = Date.now();

    const batch: PersonAttributionFact[] = [
      { personId: null, rawUser: 'user-a', taskId: null, serverId: server.id, gpuIndex: 0, vramMB: 1024, timestamp: now, sourceType: 'gpu_user', resolutionSource: 'unassigned' },
      { personId: null, rawUser: 'user-b', taskId: null, serverId: server.id, gpuIndex: 1, vramMB: 2048, timestamp: now, sourceType: 'gpu_user', resolutionSource: 'unassigned' },
    ];

    insertPersonAttributionFacts(batch);

    const facts = readFacts(server.id);
    expect(facts).toHaveLength(2);
    expect(facts.map(f => f.rawUser)).toEqual(expect.arrayContaining(['user-a', 'user-b']));
  });
});
