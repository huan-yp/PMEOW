import { describe, expect, it, vi } from 'vitest';
import {
  createServer,
  getGpuOverview,
  getGpuUsageSummary,
  getGpuUsageTimelineByUser,
  getLatestUnownedGpuDurationMinutes,
  saveGpuUsageRows,
} from '../../src/index.js';

describe('gpu usage query helpers', () => {
  it('aggregates the latest gpu overview per server', () => {
    const agentServer = createServer({
      name: 'gpu-a',
      host: 'gpu-a.local',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key-a',
      sourceType: 'agent',
      agentId: 'agent-a',
    });
    const secondServer = createServer({
      name: 'gpu-b',
      host: 'gpu-b.local',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key-b',
      sourceType: 'agent',
      agentId: 'agent-b',
    });

    saveGpuUsageRows(agentServer.id, 1_000, [
      {
        gpuIndex: 0,
        ownerType: 'task',
        ownerId: 'task-older',
        userName: 'alice',
        taskId: 'task-older',
        pid: 100,
        usedMemoryMB: 999,
      },
    ]);

    saveGpuUsageRows(agentServer.id, 2_000, [
      {
        gpuIndex: 0,
        ownerType: 'task',
        ownerId: 'task-1',
        userName: 'alice',
        taskId: 'task-1',
        pid: 101,
        usedMemoryMB: 4_096,
      },
      {
        gpuIndex: 0,
        ownerType: 'user',
        ownerId: 'alice-shell',
        userName: 'alice',
        pid: 102,
        usedMemoryMB: 1_024,
      },
      {
        gpuIndex: 1,
        ownerType: 'unknown',
        ownerId: 'mystery',
        pid: 103,
        usedMemoryMB: 512,
      },
    ]);

    saveGpuUsageRows(secondServer.id, 1_500, [
      {
        gpuIndex: 0,
        ownerType: 'task',
        ownerId: 'task-2',
        userName: 'bob',
        taskId: 'task-2',
        pid: 201,
        usedMemoryMB: 2_048,
      },
      {
        gpuIndex: 0,
        ownerType: 'user',
        ownerId: 'bob-shell',
        userName: 'bob',
        pid: 202,
        usedMemoryMB: 256,
      },
    ]);

    const overview = getGpuOverview();

    expect(overview).toEqual({
      generatedAt: 2_000,
      users: [
        {
          user: 'alice',
          totalVramMB: 5_120,
          taskCount: 1,
          processCount: 1,
          serverIds: [agentServer.id],
        },
        {
          user: 'bob',
          totalVramMB: 2_304,
          taskCount: 1,
          processCount: 1,
          serverIds: [secondServer.id],
        },
      ],
      servers: [
        {
          serverId: agentServer.id,
          serverName: 'gpu-a',
          totalUsedMB: 5_632,
          totalTaskMB: 4_096,
          totalNonTaskMB: 1_536,
        },
        {
          serverId: secondServer.id,
          serverName: 'gpu-b',
          totalUsedMB: 2_304,
          totalTaskMB: 2_048,
          totalNonTaskMB: 256,
        },
      ],
    });
  });

  it('counts unique non-task processes per user and ignores task rows in gpu overview processCount', () => {
    const server = createServer({
      name: 'gpu-process-count',
      host: 'gpu-process-count.local',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key-process-count',
      sourceType: 'agent',
      agentId: 'agent-process-count',
    });

    saveGpuUsageRows(server.id, 10_000, [
      {
        gpuIndex: 0,
        ownerType: 'user',
        ownerId: 'alice-shell',
        userName: 'alice',
        pid: 901,
        usedMemoryMB: 700,
      },
      {
        gpuIndex: 1,
        ownerType: 'user',
        ownerId: 'alice-shell',
        userName: 'alice',
        pid: 901,
        usedMemoryMB: 600,
      },
      {
        gpuIndex: 2,
        ownerType: 'user',
        ownerId: 'alice-trainer',
        userName: 'alice',
        pid: 902,
        usedMemoryMB: 500,
      },
      {
        gpuIndex: 3,
        ownerType: 'task',
        ownerId: 'task-alice',
        userName: 'alice',
        taskId: 'task-alice',
        pid: 903,
        usedMemoryMB: 400,
      },
    ]);

    const overview = getGpuOverview();

    expect(overview.users).toEqual([
      {
        user: 'alice',
        totalVramMB: 2_200,
        taskCount: 1,
        processCount: 2,
        serverIds: [server.id],
      },
    ]);
  });

  it('uses hours-based summary windows, filters timeline to one user, and measures unknown unowned usage with now override', () => {
    vi.useFakeTimers();
    vi.setSystemTime(720_000);

    const server = createServer({
      name: 'gpu-c',
      host: 'gpu-c.local',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key-c',
      sourceType: 'agent',
      agentId: 'agent-c',
    });

    saveGpuUsageRows(server.id, 0, [
      {
        gpuIndex: 0,
        ownerType: 'task',
        ownerId: 'task-old',
        userName: 'alice',
        taskId: 'task-old',
        pid: 300,
        usedMemoryMB: 900,
      },
    ]);

    saveGpuUsageRows(server.id, 180_000, [
      {
        gpuIndex: 0,
        ownerType: 'task',
        ownerId: 'task-1',
        userName: 'alice',
        taskId: 'task-1',
        pid: 301,
        usedMemoryMB: 1_000,
      },
      {
        gpuIndex: 0,
        ownerType: 'user',
        ownerId: 'alice-shell',
        userName: 'alice',
        pid: 302,
        usedMemoryMB: 200,
      },
      {
        gpuIndex: 1,
        ownerType: 'unknown',
        ownerId: 'stray-1',
        pid: 303,
        usedMemoryMB: 300,
      },
    ]);

    saveGpuUsageRows(server.id, 240_000, [
      {
        gpuIndex: 0,
        ownerType: 'task',
        ownerId: 'task-2',
        userName: 'alice',
        taskId: 'task-2',
        pid: 304,
        usedMemoryMB: 1_500,
      },
      {
        gpuIndex: 1,
        ownerType: 'user',
        ownerId: 'alice-notebook',
        userName: 'alice',
        pid: 305,
        usedMemoryMB: 500,
      },
      {
        gpuIndex: 1,
        ownerType: 'unknown',
        ownerId: 'stray-2',
        pid: 306,
        usedMemoryMB: 400,
      },
      {
        gpuIndex: 1,
        ownerType: 'unknown',
        ownerId: 'stray-zero',
        pid: 310,
        usedMemoryMB: 0,
      },
    ]);

    saveGpuUsageRows(server.id, 300_000, [
      {
        gpuIndex: 0,
        ownerType: 'task',
        ownerId: 'task-3',
        userName: 'bob',
        taskId: 'task-3',
        pid: 307,
        usedMemoryMB: 2_000,
      },
      {
        gpuIndex: 1,
        ownerType: 'unknown',
        ownerId: 'stray-3',
        pid: 308,
        usedMemoryMB: 500,
      },
      {
        gpuIndex: 1,
        ownerType: 'user',
        ownerId: 'bob-shell',
        userName: 'bob',
        pid: 311,
        usedMemoryMB: 800,
      },
    ]);

    saveGpuUsageRows(server.id, 360_000, [
      {
        gpuIndex: 1,
        ownerType: 'unknown',
        ownerId: 'stray-4',
        pid: 309,
        usedMemoryMB: 600,
      },
      {
        gpuIndex: 1,
        ownerType: 'user',
        ownerId: 'alice-shell-late',
        userName: 'alice',
        pid: 312,
        usedMemoryMB: 700,
      },
    ]);

    saveGpuUsageRows(server.id, 420_000, [
      {
        gpuIndex: 0,
        ownerType: 'user',
        ownerId: 'alice-shell-only',
        userName: 'alice',
        pid: 313,
        usedMemoryMB: 900,
      },
    ]);

    saveGpuUsageRows(server.id, 480_000, [
      {
        gpuIndex: 1,
        ownerType: 'unknown',
        ownerId: 'stray-zero-only',
        pid: 314,
        usedMemoryMB: 0,
      },
    ]);

    vi.setSystemTime(720_000);

    expect(getGpuUsageSummary(0.1)).toEqual([
      {
        user: 'alice',
        totalVramMB: 1_600,
        taskVramMB: 0,
        nonTaskVramMB: 1_600,
      },
    ]);

    vi.setSystemTime(400_000);

    expect(getGpuUsageTimelineByUser('alice', 0.1, 1)).toEqual([
      {
        bucketStart: 180_000,
        user: 'alice',
        totalVramMB: 1_200,
        taskVramMB: 1_000,
        nonTaskVramMB: 200,
      },
      {
        bucketStart: 240_000,
        user: 'alice',
        totalVramMB: 2_000,
        taskVramMB: 1_500,
        nonTaskVramMB: 500,
      },
      {
        bucketStart: 360_000,
        user: 'alice',
        totalVramMB: 700,
        taskVramMB: 0,
        nonTaskVramMB: 700,
      },
    ]);

    vi.setSystemTime(720_000);

    expect(getLatestUnownedGpuDurationMinutes(server.id)).toBe(0);
    expect(getLatestUnownedGpuDurationMinutes(server.id, 450_000)).toBe(0);
    expect(getLatestUnownedGpuDurationMinutes(server.id, 500_000)).toBe(0);
    expect(getLatestUnownedGpuDurationMinutes(server.id, 330_000)).toBe(2);
    expect(getLatestUnownedGpuDurationMinutes(server.id, 360_000, 50_000)).toBe(0);

    vi.useRealTimers();
  });

  it('returns 0 when the latest timestamp is not unowned unknown usage', () => {
    const server = createServer({
      name: 'gpu-d',
      host: 'gpu-d.local',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key-d',
      sourceType: 'agent',
      agentId: 'agent-d',
    });

    saveGpuUsageRows(server.id, 120_000, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        ownerId: 'stray-1',
        pid: 401,
        usedMemoryMB: 700,
      },
    ]);

    saveGpuUsageRows(server.id, 180_000, [
      {
        gpuIndex: 0,
        ownerType: 'user',
        ownerId: 'alice-shell',
        userName: 'alice',
        pid: 402,
        usedMemoryMB: 500,
      },
    ]);

    expect(getLatestUnownedGpuDurationMinutes(server.id, 200_000)).toBe(0);
  });

  it('breaks continuity when an intermediate timestamp has only zero-memory unknown rows or non-unknown rows', () => {
    const server = createServer({
      name: 'gpu-e',
      host: 'gpu-e.local',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key-e',
      sourceType: 'agent',
      agentId: 'agent-e',
    });

    saveGpuUsageRows(server.id, 120_000, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        ownerId: 'stray-early',
        pid: 501,
        usedMemoryMB: 800,
      },
    ]);

    saveGpuUsageRows(server.id, 180_000, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        ownerId: 'stray-zero',
        pid: 502,
        usedMemoryMB: 0,
      },
    ]);

    saveGpuUsageRows(server.id, 240_000, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        ownerId: 'stray-late',
        pid: 503,
        usedMemoryMB: 900,
      },
    ]);

    saveGpuUsageRows(server.id, 300_000, [
      {
        gpuIndex: 0,
        ownerType: 'user',
        ownerId: 'bob-shell',
        userName: 'bob',
        pid: 504,
        usedMemoryMB: 600,
      },
    ]);

    saveGpuUsageRows(server.id, 360_000, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        ownerId: 'stray-latest',
        pid: 505,
        usedMemoryMB: 1_000,
      },
    ]);

    expect(getLatestUnownedGpuDurationMinutes(server.id, 260_000)).toBe(0);
    expect(getLatestUnownedGpuDurationMinutes(server.id, 370_000)).toBe(0);
  });

  it('still accumulates minutes across truly continuous unknown usage timestamps', () => {
    const server = createServer({
      name: 'gpu-f',
      host: 'gpu-f.local',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key-f',
      sourceType: 'agent',
      agentId: 'agent-f',
    });

    saveGpuUsageRows(server.id, 120_000, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        ownerId: 'stray-1',
        pid: 601,
        usedMemoryMB: 500,
      },
    ]);

    saveGpuUsageRows(server.id, 180_000, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        ownerId: 'stray-2',
        pid: 602,
        usedMemoryMB: 600,
      },
    ]);

    saveGpuUsageRows(server.id, 240_000, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        ownerId: 'stray-3',
        pid: 603,
        usedMemoryMB: 700,
      },
    ]);

    saveGpuUsageRows(server.id, 300_000, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        ownerId: 'stray-4',
        pid: 604,
        usedMemoryMB: 800,
      },
    ]);

    expect(getLatestUnownedGpuDurationMinutes(server.id, 310_000)).toBe(3);
  });

  it('returns 0 when the latest active unknown sample is stale relative to now', () => {
    const server = createServer({
      name: 'gpu-stale-unknown',
      host: 'gpu-stale-unknown.local',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key-stale-unknown',
      sourceType: 'agent',
      agentId: 'agent-stale-unknown',
    });

    saveGpuUsageRows(server.id, 120_000, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        ownerId: 'stray-1',
        pid: 701,
        usedMemoryMB: 800,
      },
    ]);

    saveGpuUsageRows(server.id, 180_000, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        ownerId: 'stray-2',
        pid: 702,
        usedMemoryMB: 900,
      },
    ]);

    saveGpuUsageRows(server.id, 240_000, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        ownerId: 'stray-3',
        pid: 703,
        usedMemoryMB: 1_000,
      },
    ]);

    expect(getLatestUnownedGpuDurationMinutes(server.id, 300_000)).toBe(2);
    expect(getLatestUnownedGpuDurationMinutes(server.id, 340_001)).toBe(0);
  });
});