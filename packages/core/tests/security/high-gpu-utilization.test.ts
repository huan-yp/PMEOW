import { afterEach, describe, expect, it } from 'vitest';
import { buildProcessAuditRows } from '../../src/security/audit.js';
import {
  buildSecurityFingerprint,
  checkHighGpuUtilization,
  resetHighGpuUtilizationCounters,
  type CheckHighGpuUtilizationInput,
} from '../../src/security/analyzer.js';
import type { StoredGpuUsageRow } from '../../src/db/gpu-usage.js';
import type { MetricsSnapshot, GpuAllocationSummary } from '../../src/types.js';

afterEach(() => {
  resetHighGpuUtilizationCounters();
});

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
      usedMemoryMB: 20_000,
      memoryUsagePercent: 81.4,
      utilizationPercent: 95,
      temperatureC: 82,
      gpuCount: 2,
    },
    processes: [
      {
        pid: 500,
        user: 'mallory',
        command: 'python suspicious_train.py',
        cpuPercent: 50,
        memPercent: 5,
        rss: 4_096,
      },
    ],
    docker: [],
    system: {
      hostname: 'gpu-01',
      uptime: '5 days',
      loadAvg1: 4,
      loadAvg5: 3.5,
      loadAvg15: 3,
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
    ownerType: 'unknown',
    ownerId: undefined,
    userName: 'mallory',
    taskId: undefined,
    pid: 500,
    command: 'python suspicious_train.py',
    usedMemoryMB: 8_000,
    declaredVramMB: undefined,
    ...overrides,
  };
}

describe('checkHighGpuUtilization', () => {
  it('triggers alert after sustained high utilization without PMEOW tasks', () => {
    const collectionIntervalMs = 5_000;
    const durationMinutes = 1;
    const requiredCount = Math.ceil(durationMinutes * 60_000 / collectionIntervalMs);
    const baseTimestamp = 1_712_010_000;

    let events: ReturnType<typeof checkHighGpuUtilization> = [];

    for (let i = 0; i < requiredCount; i += 1) {
      const snapshot = createSnapshot({
        timestamp: baseTimestamp + i * collectionIntervalMs,
      });
      events = checkHighGpuUtilization({
        serverId: 'server-1',
        snapshot,
        hasRunningPmeowTasks: false,
        thresholdPercent: 90,
        durationMinutes,
        collectionIntervalMs,
      });
    }

    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('high_gpu_utilization');
    expect(events[0]!.details.durationMinutes).toBe(durationMinutes);
    expect(events[0]!.details.gpuUtilizationPercent).toBe(95);
  });

  it('does not trigger when PMEOW tasks are running', () => {
    const collectionIntervalMs = 5_000;
    const durationMinutes = 1;
    const requiredCount = Math.ceil(durationMinutes * 60_000 / collectionIntervalMs);
    const baseTimestamp = 1_712_010_000;

    let events: ReturnType<typeof checkHighGpuUtilization> = [];

    for (let i = 0; i < requiredCount + 5; i += 1) {
      const snapshot = createSnapshot({
        timestamp: baseTimestamp + i * collectionIntervalMs,
      });
      events = checkHighGpuUtilization({
        serverId: 'server-1',
        snapshot,
        hasRunningPmeowTasks: true,
        thresholdPercent: 90,
        durationMinutes,
        collectionIntervalMs,
      });
    }

    expect(events).toEqual([]);
  });

  it('resets counter when utilization drops below threshold mid-streak', () => {
    const collectionIntervalMs = 5_000;
    const durationMinutes = 1;
    const requiredCount = Math.ceil(durationMinutes * 60_000 / collectionIntervalMs);
    const baseTimestamp = 1_712_010_000;

    for (let i = 0; i < requiredCount - 2; i += 1) {
      checkHighGpuUtilization({
        serverId: 'server-1',
        snapshot: createSnapshot({ timestamp: baseTimestamp + i * collectionIntervalMs }),
        hasRunningPmeowTasks: false,
        thresholdPercent: 90,
        durationMinutes,
        collectionIntervalMs,
      });
    }

    const dropIndex = requiredCount - 2;
    checkHighGpuUtilization({
      serverId: 'server-1',
      snapshot: createSnapshot({
        timestamp: baseTimestamp + dropIndex * collectionIntervalMs,
        gpu: {
          available: true,
          totalMemoryMB: 24_576,
          usedMemoryMB: 4_000,
          memoryUsagePercent: 16.3,
          utilizationPercent: 50,
          temperatureC: 60,
          gpuCount: 2,
        },
      }),
      hasRunningPmeowTasks: false,
      thresholdPercent: 90,
      durationMinutes,
      collectionIntervalMs,
    });

    let events: ReturnType<typeof checkHighGpuUtilization> = [];
    for (let i = dropIndex + 1; i < dropIndex + 1 + requiredCount; i += 1) {
      events = checkHighGpuUtilization({
        serverId: 'server-1',
        snapshot: createSnapshot({ timestamp: baseTimestamp + i * collectionIntervalMs }),
        hasRunningPmeowTasks: false,
        thresholdPercent: 90,
        durationMinutes,
        collectionIntervalMs,
      });
    }

    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('high_gpu_utilization');
  });

  it('uses per-GPU allocation when available', () => {
    const collectionIntervalMs = 5_000;
    const durationMinutes = 1;
    const requiredCount = Math.ceil(durationMinutes * 60_000 / collectionIntervalMs);
    const baseTimestamp = 1_712_010_000;

    const allocation: GpuAllocationSummary = {
      perGpu: [
        {
          gpuIndex: 0,
          totalMemoryMB: 12_288,
          usedMemoryMB: 10_000,
          pmeowTasks: [
            { taskId: 'task-1', gpuIndex: 0, declaredVramMB: 8_000, actualVramMB: 10_000 },
          ],
          userProcesses: [],
          unknownProcesses: [],
          effectiveFreeMB: 2_288,
        },
        {
          gpuIndex: 1,
          totalMemoryMB: 12_288,
          usedMemoryMB: 10_000,
          pmeowTasks: [],
          userProcesses: [
            { pid: 500, user: 'mallory', gpuIndex: 1, usedMemoryMB: 10_000, command: 'python suspicious_train.py' },
          ],
          unknownProcesses: [],
          effectiveFreeMB: 2_288,
        },
      ],
      byUser: [],
    };

    let events: ReturnType<typeof checkHighGpuUtilization> = [];

    for (let i = 0; i < requiredCount; i += 1) {
      const snapshot = createSnapshot({
        timestamp: baseTimestamp + i * collectionIntervalMs,
        gpuAllocation: allocation,
      });
      events = checkHighGpuUtilization({
        serverId: 'server-1',
        snapshot,
        hasRunningPmeowTasks: true,
        thresholdPercent: 90,
        durationMinutes,
        collectionIntervalMs,
      });
    }

    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('high_gpu_utilization');
    expect(events[0]!.details.gpuIndex).toBe(1);
  });

  it('does not trigger for GPUs with PMEOW tasks in allocation mode', () => {
    const collectionIntervalMs = 5_000;
    const durationMinutes = 1;
    const requiredCount = Math.ceil(durationMinutes * 60_000 / collectionIntervalMs);
    const baseTimestamp = 1_712_010_000;

    const allocation: GpuAllocationSummary = {
      perGpu: [
        {
          gpuIndex: 0,
          totalMemoryMB: 12_288,
          usedMemoryMB: 10_000,
          pmeowTasks: [
            { taskId: 'task-1', gpuIndex: 0, declaredVramMB: 8_000, actualVramMB: 10_000 },
          ],
          userProcesses: [],
          unknownProcesses: [],
          effectiveFreeMB: 2_288,
        },
      ],
      byUser: [],
    };

    let events: ReturnType<typeof checkHighGpuUtilization> = [];

    for (let i = 0; i < requiredCount + 5; i += 1) {
      const snapshot = createSnapshot({
        timestamp: baseTimestamp + i * collectionIntervalMs,
        gpuAllocation: allocation,
      });
      events = checkHighGpuUtilization({
        serverId: 'server-1',
        snapshot,
        hasRunningPmeowTasks: true,
        thresholdPercent: 90,
        durationMinutes,
        collectionIntervalMs,
      });
    }

    expect(events).toEqual([]);
  });

  it('returns empty when GPU is unavailable', () => {
    const events = checkHighGpuUtilization({
      serverId: 'server-1',
      snapshot: createSnapshot({
        gpu: {
          available: false,
          totalMemoryMB: 0,
          usedMemoryMB: 0,
          memoryUsagePercent: 0,
          utilizationPercent: 0,
          temperatureC: 0,
          gpuCount: 0,
        },
      }),
      hasRunningPmeowTasks: false,
      thresholdPercent: 90,
      durationMinutes: 120,
      collectionIntervalMs: 5_000,
    });

    expect(events).toEqual([]);
  });

  it('skips check when durationMinutes is zero', () => {
    const events = checkHighGpuUtilization({
      serverId: 'server-1',
      snapshot: createSnapshot(),
      hasRunningPmeowTasks: false,
      thresholdPercent: 90,
      durationMinutes: 0,
      collectionIntervalMs: 5_000,
    });

    expect(events).toEqual([]);
  });
});

describe('buildProcessAuditRows with highGpuUtilizationActive', () => {
  it('adds high_utilization finding when active and process uses GPU without being a task', () => {
    const snapshot = createSnapshot();
    const rows = buildProcessAuditRows(
      snapshot,
      [
        createGpuRow({
          id: 1,
          pid: 500,
          ownerType: 'unknown',
          userName: 'mallory',
          usedMemoryMB: 8_000,
        }),
      ],
      {
        securityMiningKeywords: [],
        unownedGpuMinutes: 0,
        hasRunningPmeowTasks: false,
        highGpuUtilizationActive: true,
      },
    );

    const targetRow = rows.find((r) => r.pid === 500);
    expect(targetRow).toBeDefined();
    expect(targetRow!.suspiciousReasons).toContain('高 GPU 利用率期间存在非任务 GPU 进程');
  });

  it('does not add high_utilization finding for PMEOW task processes', () => {
    const snapshot = createSnapshot();
    const rows = buildProcessAuditRows(
      snapshot,
      [
        createGpuRow({
          id: 1,
          pid: 500,
          ownerType: 'task',
          taskId: 'task-1',
          userName: 'alice',
          usedMemoryMB: 8_000,
        }),
      ],
      {
        securityMiningKeywords: [],
        unownedGpuMinutes: 0,
        hasRunningPmeowTasks: true,
        highGpuUtilizationActive: true,
      },
    );

    const targetRow = rows.find((r) => r.pid === 500);
    expect(targetRow).toBeDefined();
    expect(targetRow!.suspiciousReasons).not.toContain('高 GPU 利用率期间存在非任务 GPU 进程');
  });

  it('does not add high_utilization finding when flag is false', () => {
    const snapshot = createSnapshot();
    const rows = buildProcessAuditRows(
      snapshot,
      [
        createGpuRow({
          id: 1,
          pid: 500,
          ownerType: 'unknown',
          userName: 'mallory',
          usedMemoryMB: 8_000,
        }),
      ],
      {
        securityMiningKeywords: [],
        unownedGpuMinutes: 0,
        hasRunningPmeowTasks: false,
        highGpuUtilizationActive: false,
      },
    );

    const targetRow = rows.find((r) => r.pid === 500);
    expect(targetRow).toBeDefined();
    expect(targetRow!.suspiciousReasons).not.toContain('高 GPU 利用率期间存在非任务 GPU 进程');
  });
});
