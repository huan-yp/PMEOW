import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '../../src/db/database.js';
import {
  cleanOldGpuUsage,
  getLatestGpuUsageByServerId,
  saveGpuUsageRows,
  type GpuUsageRowInput,
} from '../../src/db/gpu-usage.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('gpu_usage_stats schema', () => {
  it('creates the gpu usage table and indexes on a fresh database', () => {
    const db = getDatabase();
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'gpu_usage_stats'"
    ).get() as { name: string } | undefined;
    const indexByTime = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_gpu_usage_stats_server_time'"
    ).get() as { name: string } | undefined;
    const indexByGpu = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_gpu_usage_stats_server_gpu_time'"
    ).get() as { name: string } | undefined;
    const columns = new Set(
      (db.prepare('PRAGMA table_info(gpu_usage_stats)').all() as { name: string }[]).map(column => column.name)
    );

    expect(table?.name).toBe('gpu_usage_stats');
    expect(indexByTime?.name).toBe('idx_gpu_usage_stats_server_time');
    expect(indexByGpu?.name).toBe('idx_gpu_usage_stats_server_gpu_time');
    expect(columns).toEqual(new Set([
      'id',
      'serverId',
      'timestamp',
      'gpuIndex',
      'ownerType',
      'ownerId',
      'userName',
      'taskId',
      'pid',
      'usedMemoryMB',
      'declaredVramMB',
    ]));
  });
});

describe('gpu usage repository', () => {
  it('writes a sample batch and reads back only the latest sample for the server', () => {
    const olderRows: GpuUsageRowInput[] = [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        pid: 999,
        usedMemoryMB: 128,
      },
    ];
    const latestRows: GpuUsageRowInput[] = [
      {
        gpuIndex: 0,
        ownerType: 'task',
        ownerId: 'task-1',
        userName: 'alice',
        taskId: 'task-1',
        pid: 1234,
        usedMemoryMB: 2048,
        declaredVramMB: 4096,
      },
      {
        gpuIndex: 1,
        ownerType: 'user',
        ownerId: 'bob',
        userName: 'bob',
        pid: 2222,
        usedMemoryMB: 1024,
      },
    ];

    expect(saveGpuUsageRows('server-a', 1_000, olderRows)).toBe(1);
    expect(saveGpuUsageRows('server-a', 2_000, latestRows)).toBe(2);
    expect(saveGpuUsageRows('server-b', 3_000, [
      {
        gpuIndex: 0,
        ownerType: 'user',
        ownerId: 'carol',
        userName: 'carol',
        pid: 3333,
        usedMemoryMB: 512,
      },
    ])).toBe(1);

    expect(getLatestGpuUsageByServerId('server-a')).toEqual([
      {
        id: expect.any(Number),
        serverId: 'server-a',
        timestamp: 2_000,
        gpuIndex: 0,
        ownerType: 'task',
        ownerId: 'task-1',
        userName: 'alice',
        taskId: 'task-1',
        pid: 1234,
        usedMemoryMB: 2048,
        declaredVramMB: 4096,
      },
      {
        id: expect.any(Number),
        serverId: 'server-a',
        timestamp: 2_000,
        gpuIndex: 1,
        ownerType: 'user',
        ownerId: 'bob',
        userName: 'bob',
        taskId: undefined,
        pid: 2222,
        usedMemoryMB: 1024,
        declaredVramMB: undefined,
      },
    ]);
  });

  it('cleans up rows older than the retention window and keeps recent rows', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10 * 24 * 60 * 60 * 1000);

    saveGpuUsageRows('server-a', 1_000, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        usedMemoryMB: 64,
      },
    ]);
    saveGpuUsageRows('server-a', 9 * 24 * 60 * 60 * 1000, [
      {
        gpuIndex: 0,
        ownerType: 'task',
        ownerId: 'task-2',
        taskId: 'task-2',
        usedMemoryMB: 512,
      },
    ]);

    const deleted = cleanOldGpuUsage(2);
    const db = getDatabase();
    const count = db.prepare('SELECT COUNT(*) AS count FROM gpu_usage_stats').get() as { count: number };

    expect(deleted).toBe(1);
    expect(count.count).toBe(1);
    expect(getLatestGpuUsageByServerId('server-a')).toEqual([
      {
        id: expect.any(Number),
        serverId: 'server-a',
        timestamp: 9 * 24 * 60 * 60 * 1000,
        gpuIndex: 0,
        ownerType: 'task',
        ownerId: 'task-2',
        userName: undefined,
        taskId: 'task-2',
        pid: undefined,
        usedMemoryMB: 512,
        declaredVramMB: undefined,
      },
    ]);
  });
});