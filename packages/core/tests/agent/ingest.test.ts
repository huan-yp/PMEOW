import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  flattenGpuAllocation,
  ingestAgentMetrics,
  ingestAgentTaskUpdate,
} from '../../src/agent/ingest.js';
import { getAgentTask, getAgentTasksByServerId } from '../../src/db/agent-tasks.js';
import { getDatabase } from '../../src/db/database.js';
import { getLatestGpuUsageByServerId } from '../../src/db/gpu-usage.js';
import { getLatestMetrics } from '../../src/db/metrics.js';
import { createServer } from '../../src/db/servers.js';
import type { GpuAllocationSummary, MetricsSnapshot } from '../../src/types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function createAgentServer() {
  return createServer({
    name: 'Agent Server',
    host: '127.0.0.1',
    port: 22,
    username: 'agent',
    privateKeyPath: '/tmp/agent-key',
    sourceType: 'agent',
    agentId: 'agent-1',
  });
}

function createGpuAllocation(): GpuAllocationSummary {
  return {
    perGpu: [
      {
        gpuIndex: 0,
        totalMemoryMB: 24576,
        pmeowTasks: [
          {
            taskId: 'task-1',
            gpuIndex: 0,
            declaredVramMB: 8192,
            actualVramMB: 6144,
          },
          {
            taskId: 'task-2',
            gpuIndex: 0,
            declaredVramMB: 4096,
            actualVramMB: 2048,
          },
        ],
        userProcesses: [
          {
            pid: 2201,
            user: 'alice',
            gpuIndex: 0,
            usedMemoryMB: 1024,
            command: 'python monitor.py',
          },
        ],
        unknownProcesses: [
          {
            pid: 991,
            gpuIndex: 0,
            usedMemoryMB: 512,
          },
        ],
        effectiveFreeMB: 14848,
      },
      {
        gpuIndex: 1,
        totalMemoryMB: 24576,
        pmeowTasks: [],
        userProcesses: [
          {
            pid: 3302,
            user: 'bob',
            gpuIndex: 1,
            usedMemoryMB: 1536,
            command: 'python eval.py',
          },
        ],
        unknownProcesses: [
          {
            pid: 992,
            gpuIndex: 1,
            usedMemoryMB: 256,
          },
        ],
        effectiveFreeMB: 22784,
      },
    ],
    byUser: [
      {
        user: 'alice',
        totalVramMB: 7168,
        gpuIndices: [0],
      },
      {
        user: 'bob',
        totalVramMB: 1536,
        gpuIndices: [1],
      },
    ],
  };
}

function createSnapshot(serverId: string, overrides: Partial<MetricsSnapshot> = {}): MetricsSnapshot {
  return {
    serverId,
    timestamp: 1712010000,
    cpu: {
      usagePercent: 42,
      coreCount: 16,
      modelName: 'Threadripper',
      frequencyMhz: 3600,
      perCoreUsage: [41, 43],
    },
    memory: {
      totalMB: 65536,
      usedMB: 32768,
      availableMB: 32768,
      usagePercent: 50,
      swapTotalMB: 8192,
      swapUsedMB: 0,
      swapPercent: 0,
    },
    disk: {
      disks: [],
      ioReadKBs: 0,
      ioWriteKBs: 0,
    },
    network: {
      rxBytesPerSec: 0,
      txBytesPerSec: 0,
      interfaces: [],
    },
    gpu: {
      available: true,
      totalMemoryMB: 49152,
      usedMemoryMB: 11520,
      memoryUsagePercent: 23.44,
      utilizationPercent: 64,
      temperatureC: 52,
      gpuCount: 2,
    },
    processes: [],
    docker: [],
    system: {
      hostname: 'gpu-01',
      uptime: '1 day',
      loadAvg1: 0.1,
      loadAvg5: 0.2,
      loadAvg15: 0.3,
      kernelVersion: '6.8.0',
    },
    ...overrides,
  };
}

describe('agent ingest', () => {
  it('stores metrics with gpuAllocation and writes flattened gpu usage rows', () => {
    const server = createAgentServer();
    const gpuAllocation = createGpuAllocation();
    const snapshot = createSnapshot(server.id, { gpuAllocation });

    ingestAgentMetrics(snapshot);

    expect(getLatestMetrics(server.id)).toEqual(snapshot);
    expect(flattenGpuAllocation(server.id, snapshot.timestamp, gpuAllocation)).toEqual([
      {
        gpuIndex: 0,
        ownerType: 'task',
        ownerId: 'task-1',
        taskId: 'task-1',
        usedMemoryMB: 6144,
        declaredVramMB: 8192,
      },
      {
        gpuIndex: 0,
        ownerType: 'task',
        ownerId: 'task-2',
        taskId: 'task-2',
        usedMemoryMB: 2048,
        declaredVramMB: 4096,
      },
      {
        gpuIndex: 0,
        ownerType: 'user',
        ownerId: 'alice',
        userName: 'alice',
        pid: 2201,
        usedMemoryMB: 1024,
      },
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        pid: 991,
        usedMemoryMB: 512,
      },
      {
        gpuIndex: 1,
        ownerType: 'user',
        ownerId: 'bob',
        userName: 'bob',
        pid: 3302,
        usedMemoryMB: 1536,
      },
      {
        gpuIndex: 1,
        ownerType: 'unknown',
        pid: 992,
        usedMemoryMB: 256,
      },
    ]);
    expect(getLatestGpuUsageByServerId(server.id)).toEqual([
      {
        id: expect.any(Number),
        serverId: server.id,
        timestamp: snapshot.timestamp,
        gpuIndex: 0,
        ownerType: 'task',
        ownerId: 'task-1',
        userName: undefined,
        taskId: 'task-1',
        pid: undefined,
        usedMemoryMB: 6144,
        declaredVramMB: 8192,
      },
      {
        id: expect.any(Number),
        serverId: server.id,
        timestamp: snapshot.timestamp,
        gpuIndex: 0,
        ownerType: 'task',
        ownerId: 'task-2',
        userName: undefined,
        taskId: 'task-2',
        pid: undefined,
        usedMemoryMB: 2048,
        declaredVramMB: 4096,
      },
      {
        id: expect.any(Number),
        serverId: server.id,
        timestamp: snapshot.timestamp,
        gpuIndex: 0,
        ownerType: 'user',
        ownerId: 'alice',
        userName: 'alice',
        taskId: undefined,
        pid: 2201,
        usedMemoryMB: 1024,
        declaredVramMB: undefined,
      },
      {
        id: expect.any(Number),
        serverId: server.id,
        timestamp: snapshot.timestamp,
        gpuIndex: 0,
        ownerType: 'unknown',
        ownerId: undefined,
        userName: undefined,
        taskId: undefined,
        pid: 991,
        usedMemoryMB: 512,
        declaredVramMB: undefined,
      },
      {
        id: expect.any(Number),
        serverId: server.id,
        timestamp: snapshot.timestamp,
        gpuIndex: 1,
        ownerType: 'user',
        ownerId: 'bob',
        userName: 'bob',
        taskId: undefined,
        pid: 3302,
        usedMemoryMB: 1536,
        declaredVramMB: undefined,
      },
      {
        id: expect.any(Number),
        serverId: server.id,
        timestamp: snapshot.timestamp,
        gpuIndex: 1,
        ownerType: 'unknown',
        ownerId: undefined,
        userName: undefined,
        taskId: undefined,
        pid: 992,
        usedMemoryMB: 256,
        declaredVramMB: undefined,
      },
    ]);
  });

  it('stores metrics without gpuAllocation and writes zero gpu usage rows', () => {
    const server = createAgentServer();
    const snapshot = createSnapshot(server.id);

    ingestAgentMetrics(snapshot);

    const db = getDatabase();
    const gpuUsageCount = db.prepare(
      'SELECT COUNT(*) AS count FROM gpu_usage_stats WHERE serverId = ?'
    ).get(server.id) as { count: number };

    expect(getLatestMetrics(server.id)).toEqual(snapshot);
    expect(gpuUsageCount.count).toBe(0);
    expect(getLatestGpuUsageByServerId(server.id)).toEqual([]);
  });

  it('does not create duplicate mirrored tasks for repeated task updates', () => {
    const server = createAgentServer();
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);

    const update = {
      serverId: server.id,
      taskId: 'task-1',
      status: 'queued' as const,
      command: 'python train.py',
      cwd: '/srv/jobs/train',
      user: 'alice',
      requireVramMB: 8192,
      requireGpuCount: 1,
      gpuIds: [0],
      priority: 7,
      createdAt: 900,
    };

    ingestAgentTaskUpdate(update);

    const db = getDatabase();
    const firstWrite = db.prepare(
      'SELECT updatedAt FROM agent_tasks WHERE taskId = ?'
    ).get(update.taskId) as { updatedAt: number };

    ingestAgentTaskUpdate({ ...update });

    const row = db.prepare(
      'SELECT COUNT(*) AS count, updatedAt FROM agent_tasks WHERE taskId = ?'
    ).get(update.taskId) as { count: number; updatedAt: number };

    expect(row.count).toBe(1);
    expect(row.updatedAt).toBe(firstWrite.updatedAt);
    expect(getAgentTasksByServerId(server.id)).toHaveLength(1);
  });

  it('preserves prior fields across task status progression updates', () => {
    const server = createAgentServer();
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(3_000);

    ingestAgentTaskUpdate({
      serverId: server.id,
      taskId: 'task-1',
      status: 'queued',
      command: 'python train.py',
      cwd: '/srv/jobs/train',
      user: 'alice',
      requireVramMB: 8192,
      requireGpuCount: 1,
      gpuIds: [0],
      priority: 7,
      createdAt: 900,
    });

    ingestAgentTaskUpdate({
      serverId: server.id,
      taskId: 'task-1',
      status: 'running',
      startedAt: 1_500,
      pid: 4321,
    });

    ingestAgentTaskUpdate({
      serverId: server.id,
      taskId: 'task-1',
      status: 'completed',
      finishedAt: 2_500,
      exitCode: 0,
    });

    expect(getAgentTask('task-1')).toEqual({
      serverId: server.id,
      taskId: 'task-1',
      status: 'completed',
      command: 'python train.py',
      cwd: '/srv/jobs/train',
      user: 'alice',
      requireVramMB: 8192,
      requireGpuCount: 1,
      gpuIds: [0],
      priority: 7,
      createdAt: 900,
      startedAt: 1_500,
      finishedAt: 2_500,
      exitCode: 0,
      pid: 4321,
    });
    expect(getAgentTasksByServerId(server.id)).toHaveLength(1);
  });
});