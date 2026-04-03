import { describe, expect, it } from 'vitest';
import { createServer } from '../../src/db/servers.js';
import { saveGpuUsageRows } from '../../src/db/gpu-usage.js';
import { upsertAgentTask } from '../../src/db/agent-tasks.js';
import { createPerson, createPersonBinding, setTaskOwnerOverride } from '../../src/db/persons.js';
import { resolveTaskPerson } from '../../src/person/resolve.js';
import { saveMetrics } from '../../src/db/metrics.js';
import {
  getPersonSummaries,
  getPersonTimeline,
  getServerPersonActivity,
  listPersonBindingCandidates,
  listPersonBindingSuggestions,
  recordGpuAttributionFacts,
  recordTaskAttributionFact,
  getResolvedGpuAllocation,
} from '../../src/db/person-attribution.js';

describe('person attribution', () => {
  it('prefers explicit task overrides over binding fallback', () => {
    const server = createServer({ name: 'gpu-1', host: 'gpu-1', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-1' });
    const alice = createPerson({ displayName: 'Alice', customFields: {} });
    const bob = createPerson({ displayName: 'Bob', customFields: {} });

    createPersonBinding({ personId: alice.id, serverId: server.id, systemUser: 'train', source: 'manual', effectiveFrom: 1_700_000_000_000 });
    setTaskOwnerOverride({ taskId: 'task-1', serverId: server.id, personId: bob.id, source: 'manual', effectiveFrom: 1_700_000_000_100 });

    upsertAgentTask({ serverId: server.id, taskId: 'task-1', status: 'running', user: 'train', startedAt: 1_700_000_000_200 });

    expect(resolveTaskPerson(server.id, 'task-1', 'train', 1_700_000_000_200)?.person.id).toBe(bob.id);
  });

  it('builds person summaries, timeline, and suggestions without backfilling old data', () => {
    const now = Date.now();
    const server = createServer({ name: 'gpu-2', host: 'gpu-2', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-2' });
    const alice = createPerson({ displayName: 'Alice', customFields: { team: 'cv' } });

    createPersonBinding({ personId: alice.id, serverId: server.id, systemUser: 'alice', source: 'manual', effectiveFrom: now - 200_000 });

    saveGpuUsageRows(server.id, now - 100_000, [
      { gpuIndex: 0, ownerType: 'user', ownerId: 'alice', userName: 'alice', pid: 2001, command: 'python train.py', usedMemoryMB: 4096 },
      { gpuIndex: 0, ownerType: 'user', ownerId: 'nobody', userName: 'nobody', pid: 2002, command: 'python idle.py', usedMemoryMB: 1024 },
    ]);

    recordGpuAttributionFacts(server.id, now - 100_000);

    expect(getPersonSummaries(24)[0]).toEqual(expect.objectContaining({
      personId: alice.id,
      displayName: 'Alice',
      currentVramMB: 4096,
      activeServerCount: 1,
    }));
    expect(getPersonTimeline(alice.id, 24)).toEqual([
      expect.objectContaining({ totalVramMB: 4096 }),
    ]);
    expect(getServerPersonActivity(server.id).unassignedUsers).toContain('nobody');
    expect(listPersonBindingSuggestions()).toEqual([
      expect.objectContaining({ serverId: server.id, systemUser: 'nobody' }),
    ]);
  });

  it('lists observed binding candidates with active binding metadata for bound and unbound users', () => {
    const now = Date.now();
    const server = createServer({ name: 'gpu-3', host: 'gpu-3', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-3' });
    const alice = createPerson({ displayName: 'Alice', customFields: {} });
    const binding = createPersonBinding({
      personId: alice.id,
      serverId: server.id,
      systemUser: 'alice',
      source: 'manual',
      effectiveFrom: now - 300_000,
    });

    saveGpuUsageRows(server.id, now - 120_000, [
      { gpuIndex: 0, ownerType: 'user', ownerId: 'alice', userName: 'alice', pid: 3001, command: 'python bound.py', usedMemoryMB: 2048 },
    ]);
    saveGpuUsageRows(server.id, now - 60_000, [
      { gpuIndex: 0, ownerType: 'user', ownerId: 'carol', userName: 'carol', pid: 3002, command: 'python unbound.py', usedMemoryMB: 1024 },
    ]);

    recordGpuAttributionFacts(server.id, now - 120_000);
    recordGpuAttributionFacts(server.id, now - 60_000);

    const candidates = listPersonBindingCandidates();

    expect(candidates).toEqual([
      {
        serverId: server.id,
        serverName: 'gpu-3',
        systemUser: 'carol',
        lastSeenAt: now - 60_000,
        activeBinding: null,
      },
      {
        serverId: server.id,
        serverName: 'gpu-3',
        systemUser: 'alice',
        lastSeenAt: now - 120_000,
        activeBinding: {
          bindingId: binding.id,
          personId: alice.id,
          personDisplayName: 'Alice',
        },
      },
    ]);
  });

  it('builds resolved gpu allocation from the latest snapshot using person name first and username fallback', () => {
    const now = Date.now();
    const server = createServer({
      name: 'gpu-resolved',
      host: 'gpu-resolved',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-resolved',
    });
    const alice = createPerson({ displayName: 'Alice', customFields: {} });

    createPersonBinding({
      personId: alice.id,
      serverId: server.id,
      systemUser: 'alice',
      source: 'manual',
      effectiveFrom: now - 10_000,
    });

    upsertAgentTask({
      serverId: server.id,
      taskId: 'task-run-1',
      status: 'running',
      user: 'alice',
      startedAt: now - 5_000,
    });

    saveMetrics({
      serverId: server.id,
      timestamp: now,
      cpu: { usagePercent: 0, coreCount: 1, modelName: 'CPU', frequencyMhz: 0, perCoreUsage: [0] },
      memory: { totalMB: 1, usedMB: 0, availableMB: 1, usagePercent: 0, swapTotalMB: 0, swapUsedMB: 0, swapPercent: 0 },
      disk: { disks: [], ioReadKBs: 0, ioWriteKBs: 0 },
      network: { rxBytesPerSec: 0, txBytesPerSec: 0, interfaces: [] },
      gpu: { available: true, totalMemoryMB: 24576, usedMemoryMB: 8704, memoryUsagePercent: 35, utilizationPercent: 0, temperatureC: 0, gpuCount: 1 },
      processes: [],
      docker: [],
      system: { hostname: 'gpu-resolved', uptime: '1 day', loadAvg1: 0, loadAvg5: 0, loadAvg15: 0, kernelVersion: '6.8.0' },
      gpuAllocation: {
        perGpu: [
          {
            gpuIndex: 0,
            totalMemoryMB: 24576,
            pmeowTasks: [{ taskId: 'task-run-1', gpuIndex: 0, declaredVramMB: 8192, actualVramMB: 6144 }],
            userProcesses: [
              { pid: 2001, user: 'alice', gpuIndex: 0, usedMemoryMB: 1024, command: 'python train.py' },
              { pid: 2002, user: 'bob', gpuIndex: 0, usedMemoryMB: 1024, command: 'python eval.py' },
            ],
            unknownProcesses: [{ pid: 2003, gpuIndex: 0, usedMemoryMB: 512, command: 'mystery' }],
            effectiveFreeMB: 16896,
          },
        ],
        byUser: [
          { user: 'alice', totalVramMB: 1024, gpuIndices: [0] },
          { user: 'bob', totalVramMB: 1024, gpuIndices: [0] },
        ],
      },
    });

    expect(getResolvedGpuAllocation(server.id)).toEqual({
      serverId: server.id,
      snapshotTimestamp: now,
      perGpu: [
        {
          gpuIndex: 0,
          totalMemoryMB: 24576,
          freeMB: 16896,
          segments: [
            {
              ownerKey: `person:${alice.id}`,
              ownerKind: 'person',
              displayName: 'Alice',
              usedMemoryMB: 7168,
              personId: alice.id,
              rawUser: 'alice',
              sourceKinds: ['task', 'user_process'],
            },
            {
              ownerKey: 'user:bob',
              ownerKind: 'user',
              displayName: 'bob',
              usedMemoryMB: 1024,
              rawUser: 'bob',
              sourceKinds: ['user_process'],
            },
            {
              ownerKey: 'unknown',
              ownerKind: 'unknown',
              displayName: 'Unknown',
              usedMemoryMB: 512,
              sourceKinds: ['unknown_process'],
            },
          ],
        },
      ],
    });
  });
});
