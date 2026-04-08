import { describe, expect, it } from 'vitest';
import { createServer } from '../../src/db/servers.js';
import { upsertAgentTask } from '../../src/db/agent-tasks.js';
import { createPerson, createPersonBinding } from '../../src/db/persons.js';
import { saveMetrics } from '../../src/db/metrics.js';
import { getResolvedGpuAllocation } from '../../src/agent/gpu-allocation-resolver.js';
import type { MetricsSnapshot } from '../../src/types.js';

function stubMetrics(serverId: string, timestamp: number, overrides: Partial<MetricsSnapshot> = {}): MetricsSnapshot {
  return {
    serverId,
    timestamp,
    cpu: { usagePercent: 0, coreCount: 1, modelName: 'CPU', frequencyMhz: 0, perCoreUsage: [0] },
    memory: { totalMB: 1, usedMB: 0, availableMB: 1, usagePercent: 0, swapTotalMB: 0, swapUsedMB: 0, swapPercent: 0 },
    disk: { disks: [], ioReadKBs: 0, ioWriteKBs: 0 },
    network: { rxBytesPerSec: 0, txBytesPerSec: 0, interfaces: [] },
    gpu: { available: true, totalMemoryMB: 24576, usedMemoryMB: 0, memoryUsagePercent: 0, utilizationPercent: 0, temperatureC: 0, gpuCount: 1 },
    processes: [],
    docker: [],
    system: { hostname: 'test', uptime: '1 day', loadAvg1: 0, loadAvg5: 0, loadAvg15: 0, kernelVersion: '6.8.0' },
    ...overrides,
  };
}

describe('gpu-allocation-resolver', () => {
  it('resolves a task segment to person displayName through task user and binding', () => {
    const now = Date.now();
    const server = createServer({
      name: 'resolver-task-person',
      host: 'resolver-task-person',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-resolver-1',
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
      taskId: 'task-resolve-1',
      status: 'running',
      user: 'alice',
      startedAt: now - 5_000,
    });

    saveMetrics(stubMetrics(server.id, now, {
      gpuAllocation: {
        perGpu: [{
          gpuIndex: 0,
          totalMemoryMB: 24576,
          usedMemoryMB: 8192,
          pmeowTasks: [{ taskId: 'task-resolve-1', gpuIndex: 0, declaredVramMB: 8192, actualVramMB: 8192 }],
          userProcesses: [],
          unknownProcesses: [],
          effectiveFreeMB: 16384,
        }],
        byUser: [],
      },
    }));

    const result = getResolvedGpuAllocation(server.id);
    expect(result).not.toBeNull();
    expect(result!.perGpu[0].segments[0]).toEqual(expect.objectContaining({
      ownerKey: `person:${alice.id}`,
      ownerKind: 'person',
      displayName: 'Alice',
      usedMemoryMB: 8192,
    }));
  });

  it('falls back from task segment to username when no person binding exists', () => {
    const now = Date.now();
    const server = createServer({
      name: 'resolver-task-user',
      host: 'resolver-task-user',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-resolver-2',
    });

    upsertAgentTask({
      serverId: server.id,
      taskId: 'task-unbound-1',
      status: 'running',
      user: 'bob',
      startedAt: now - 5_000,
    });

    saveMetrics(stubMetrics(server.id, now, {
      gpuAllocation: {
        perGpu: [{
          gpuIndex: 0,
          totalMemoryMB: 16384,
          usedMemoryMB: 4096,
          pmeowTasks: [{ taskId: 'task-unbound-1', gpuIndex: 0, declaredVramMB: 4096, actualVramMB: 4096 }],
          userProcesses: [],
          unknownProcesses: [],
          effectiveFreeMB: 12288,
        }],
        byUser: [],
      },
    }));

    const result = getResolvedGpuAllocation(server.id);
    expect(result!.perGpu[0].segments[0]).toEqual(expect.objectContaining({
      ownerKey: 'user:bob',
      ownerKind: 'user',
      displayName: 'bob',
      usedMemoryMB: 4096,
    }));
  });

  it('merges task and user-process usage for the same resolved person on one GPU', () => {
    const now = Date.now();
    const server = createServer({
      name: 'resolver-merge-person',
      host: 'resolver-merge-person',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-resolver-3',
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
      taskId: 'task-merge-1',
      status: 'running',
      user: 'alice',
      startedAt: now - 5_000,
    });

    saveMetrics(stubMetrics(server.id, now, {
      gpuAllocation: {
        perGpu: [{
          gpuIndex: 0,
          totalMemoryMB: 24576,
          usedMemoryMB: 7168,
          pmeowTasks: [{ taskId: 'task-merge-1', gpuIndex: 0, declaredVramMB: 6144, actualVramMB: 6144 }],
          userProcesses: [{ pid: 2001, user: 'alice', gpuIndex: 0, usedMemoryMB: 1024, command: 'python train.py' }],
          unknownProcesses: [],
          effectiveFreeMB: 17408,
        }],
        byUser: [],
      },
    }));

    const result = getResolvedGpuAllocation(server.id);
    const aliceSegment = result!.perGpu[0].segments.find(s => s.ownerKey === `person:${alice.id}`);
    expect(aliceSegment).toBeDefined();
    expect(aliceSegment!.usedMemoryMB).toBe(7168);
    expect(aliceSegment!.sourceKinds).toEqual(expect.arrayContaining(['task', 'user_process']));
  });

  it('merges multiple raw rows for the same unresolved username on one GPU', () => {
    const now = Date.now();
    const server = createServer({
      name: 'resolver-merge-user',
      host: 'resolver-merge-user',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-resolver-4',
    });

    saveMetrics(stubMetrics(server.id, now, {
      gpuAllocation: {
        perGpu: [{
          gpuIndex: 0,
          totalMemoryMB: 16384,
          usedMemoryMB: 3072,
          pmeowTasks: [],
          userProcesses: [
            { pid: 3001, user: 'carol', gpuIndex: 0, usedMemoryMB: 1024, command: 'python a.py' },
            { pid: 3002, user: 'carol', gpuIndex: 0, usedMemoryMB: 2048, command: 'python b.py' },
          ],
          unknownProcesses: [],
          effectiveFreeMB: 13312,
        }],
        byUser: [],
      },
    }));

    const result = getResolvedGpuAllocation(server.id);
    const carolSegment = result!.perGpu[0].segments.find(s => s.ownerKey === 'user:carol');
    expect(carolSegment).toBeDefined();
    expect(carolSegment!.usedMemoryMB).toBe(3072);
  });

  it('groups rows with no resolvable username into Unknown', () => {
    const now = Date.now();
    const server = createServer({
      name: 'resolver-unknown',
      host: 'resolver-unknown',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-resolver-5',
    });

    upsertAgentTask({
      serverId: server.id,
      taskId: 'task-no-user',
      status: 'running',
      startedAt: now - 5_000,
    });

    saveMetrics(stubMetrics(server.id, now, {
      gpuAllocation: {
        perGpu: [{
          gpuIndex: 0,
          totalMemoryMB: 16384,
          usedMemoryMB: 2560,
          pmeowTasks: [{ taskId: 'task-no-user', gpuIndex: 0, declaredVramMB: 2048, actualVramMB: 2048 }],
          userProcesses: [],
          unknownProcesses: [{ pid: 4001, gpuIndex: 0, usedMemoryMB: 512, command: 'mystery' }],
          effectiveFreeMB: 13824,
        }],
        byUser: [],
      },
    }));

    const result = getResolvedGpuAllocation(server.id);
    const segments = result!.perGpu[0].segments;
    const unknownSegment = segments.find(s => s.ownerKey === 'unknown');
    expect(unknownSegment).toBeDefined();
    // task with no user + unknown process should both go to unknown
    expect(unknownSegment!.usedMemoryMB).toBe(2560);
    expect(unknownSegment!.sourceKinds).toEqual(expect.arrayContaining(['task', 'unknown_process']));
  });

  it('returns null when no gpu allocation exists', () => {
    const now = Date.now();
    const server = createServer({
      name: 'resolver-null',
      host: 'resolver-null',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-resolver-6',
    });

    saveMetrics(stubMetrics(server.id, now));

    expect(getResolvedGpuAllocation(server.id)).toBeNull();
  });

  it('adds unattributed segment when reported used exceeds attributed total', () => {
    const now = Date.now();
    const server = createServer({
      name: 'resolver-unattributed',
      host: 'resolver-unattributed',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-resolver-7',
    });

    saveMetrics(stubMetrics(server.id, now, {
      gpuAllocation: {
        perGpu: [{
          gpuIndex: 0,
          totalMemoryMB: 16384,
          usedMemoryMB: 4096,
          pmeowTasks: [],
          userProcesses: [],
          unknownProcesses: [],
          effectiveFreeMB: 12288,
        }],
        byUser: [],
      },
    }));

    const result = getResolvedGpuAllocation(server.id);
    const segments = result!.perGpu[0].segments;
    expect(segments).toEqual([
      expect.objectContaining({
        ownerKey: 'unattributed',
        ownerKind: 'unknown',
        usedMemoryMB: 4096,
      }),
    ]);
    expect(result!.perGpu[0].freeMB).toBe(12288);
  });

  it('sorts segments by usedMemoryMB descending', () => {
    const now = Date.now();
    const server = createServer({
      name: 'resolver-sort',
      host: 'resolver-sort',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-resolver-8',
    });

    saveMetrics(stubMetrics(server.id, now, {
      gpuAllocation: {
        perGpu: [{
          gpuIndex: 0,
          totalMemoryMB: 24576,
          usedMemoryMB: 6144,
          pmeowTasks: [],
          userProcesses: [
            { pid: 5001, user: 'small', gpuIndex: 0, usedMemoryMB: 1024, command: 'python s.py' },
            { pid: 5002, user: 'big', gpuIndex: 0, usedMemoryMB: 4096, command: 'python b.py' },
          ],
          unknownProcesses: [{ pid: 5003, gpuIndex: 0, usedMemoryMB: 1024, command: 'mystery' }],
          effectiveFreeMB: 18432,
        }],
        byUser: [],
      },
    }));

    const result = getResolvedGpuAllocation(server.id);
    const names = result!.perGpu[0].segments.map(s => s.displayName);
    expect(names[0]).toBe('big');
  });
});
