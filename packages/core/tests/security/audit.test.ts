import { describe, expect, it } from 'vitest';
import { buildProcessAuditRows } from '../../src/security/audit.js';
import { analyzeSecuritySnapshot, buildSecurityFingerprint } from '../../src/security/analyzer.js';
import type { StoredGpuUsageRow } from '../../src/db/gpu-usage.js';
import type { MetricsSnapshot } from '../../src/types.js';

function createSnapshot(overrides: Partial<MetricsSnapshot> = {}): MetricsSnapshot {
  return {
    serverId: 'server-1',
    timestamp: 1_712_010_000,
    cpu: {
      usagePercent: 40,
      coreCount: 16,
      modelName: 'Threadripper',
      frequencyMhz: 3600,
      perCoreUsage: [35, 45],
    },
    memory: {
      totalMB: 65_536,
      usedMB: 20_480,
      availableMB: 45_056,
      usagePercent: 31.25,
      swapTotalMB: 8_192,
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
      totalMemoryMB: 24_576,
      usedMemoryMB: 4_096,
      memoryUsagePercent: 16.67,
      utilizationPercent: 30,
      temperatureC: 65,
      gpuCount: 1,
    },
    processes: [
      {
        pid: 101,
        user: 'alice',
        command: 'python trainer.py',
        cpuPercent: 12.5,
        memPercent: 3.1,
        rss: 1_024,
      },
      {
        pid: 202,
        user: 'bob',
        command: 'xmrig --donate-level=1',
        cpuPercent: 88,
        memPercent: 2.4,
        rss: 2_048,
      },
    ],
    docker: [],
    system: {
      hostname: 'gpu-01',
      uptime: '1 day',
      loadAvg1: 1,
      loadAvg5: 1.5,
      loadAvg15: 2,
      kernelVersion: '6.8.0',
    },
    ...overrides,
  };
}

function createGpuRow(overrides: Partial<StoredGpuUsageRow>): StoredGpuUsageRow {
  return {
    id: 1,
    serverId: 'server-1',
    timestamp: 1_712_010_000,
    gpuIndex: 0,
    ownerType: 'user',
    ownerId: 'alice',
    userName: 'alice',
    taskId: undefined,
    pid: 101,
    command: 'python trainer.py',
    usedMemoryMB: 2_048,
    declaredVramMB: undefined,
    ...overrides,
  };
}

describe('buildProcessAuditRows', () => {
  it('generates synthetic rows for gpu-only processes and accumulates gpu memory', () => {
    const snapshot = createSnapshot({ processes: [] });
    const rows = buildProcessAuditRows(
      snapshot,
      [
        createGpuRow({
          id: 9,
          pid: 999,
          userName: 'ghost',
          ownerType: 'unknown',
          ownerId: undefined,
          command: 'python mystery.py',
          usedMemoryMB: 512,
        }),
        createGpuRow({
          id: 10,
          pid: 999,
          userName: 'ghost',
          ownerType: 'unknown',
          ownerId: undefined,
          command: 'python mystery.py',
          usedMemoryMB: 256,
        }),
      ],
      {
        securityMiningKeywords: [],
        unownedGpuMinutes: 0,
        hasRunningPmeowTasks: false,
      },
    );

    expect(rows).toEqual([
      {
        pid: 999,
        user: 'ghost',
        command: 'python mystery.py',
        cpuPercent: 0,
        memPercent: 0,
        rss: 0,
        gpuMemoryMB: 768,
        ownerType: 'unknown',
        taskId: undefined,
        suspiciousReasons: [],
      },
    ]);
  });

  it('adds keyword and unowned gpu reasons with merged ownerType and taskId priority', () => {
    const snapshot = createSnapshot();
    const rows = buildProcessAuditRows(
      snapshot,
      [
        createGpuRow({
          id: 2,
          pid: 101,
          ownerType: 'task',
          taskId: 'task-1',
          ownerId: 'task-1',
          userName: 'alice',
          usedMemoryMB: 3_072,
        }),
        createGpuRow({
          id: 3,
          pid: 202,
          ownerType: 'unknown',
          ownerId: undefined,
          userName: 'bob',
          command: 'xmrig --donate-level=1',
          usedMemoryMB: 1_024,
        }),
      ],
      {
        securityMiningKeywords: ['xmrig', 'nbminer'],
        unownedGpuMinutes: 45,
        hasRunningPmeowTasks: false,
      },
    );

    expect(rows).toEqual([
      {
        pid: 101,
        user: 'alice',
        command: 'python trainer.py',
        cpuPercent: 12.5,
        memPercent: 3.1,
        rss: 1_024,
        gpuMemoryMB: 3_072,
        ownerType: 'task',
        taskId: 'task-1',
        suspiciousReasons: [],
      },
      {
        pid: 202,
        user: 'bob',
        command: 'xmrig --donate-level=1',
        cpuPercent: 88,
        memPercent: 2.4,
        rss: 2_048,
        gpuMemoryMB: 1_024,
        ownerType: 'unknown',
        taskId: undefined,
        suspiciousReasons: ['命中关键词 xmrig', '无主 GPU 占用 45 分钟'],
      },
    ]);
  });

  it('keeps analyzer semantics stable when suspicious reason labels change', () => {
    const snapshot = createSnapshot();
    const rows = buildProcessAuditRows(
      snapshot,
      [
        createGpuRow({
          id: 3,
          pid: 202,
          ownerType: 'unknown',
          ownerId: undefined,
          userName: 'bob',
          command: 'xmrig --donate-level=1',
          usedMemoryMB: 1_024,
        }),
      ],
      {
        securityMiningKeywords: ['xmrig'],
        unownedGpuMinutes: 45,
        hasRunningPmeowTasks: false,
      },
    );

    expect(rows).toHaveLength(2);
    expect(rows[1]?.suspiciousReasons).toEqual(['命中关键词 xmrig', '无主 GPU 占用 45 分钟']);

    rows[1]!.suspiciousReasons = ['关键词告警: xmrig', 'GPU 无归属占用 45 分钟'];

    expect(analyzeSecuritySnapshot({ snapshot, auditRows: rows })).toEqual([
      {
        serverId: 'server-1',
        eventType: 'suspicious_process',
        fingerprint: buildSecurityFingerprint('server-1', 'suspicious_process', {
          reason: '命中关键词 xmrig',
          pid: 202,
          user: 'bob',
          command: 'xmrig --donate-level=1',
          taskId: undefined,
          keyword: 'xmrig',
          usedMemoryMB: 1_024,
        }),
        details: {
          reason: '命中关键词 xmrig',
          pid: 202,
          user: 'bob',
          command: 'xmrig --donate-level=1',
          taskId: undefined,
          keyword: 'xmrig',
          usedMemoryMB: 1_024,
        },
      },
      {
        serverId: 'server-1',
        eventType: 'unowned_gpu',
        fingerprint: buildSecurityFingerprint('server-1', 'unowned_gpu', {
          reason: '无主 GPU 占用 45 分钟',
          pid: 202,
          user: 'bob',
          command: 'xmrig --donate-level=1',
          taskId: undefined,
          usedMemoryMB: 1_024,
        }),
        details: {
          reason: '无主 GPU 占用 45 分钟',
          pid: 202,
          user: 'bob',
          command: 'xmrig --donate-level=1',
          taskId: undefined,
          usedMemoryMB: 1_024,
        },
      },
    ]);
  });
});