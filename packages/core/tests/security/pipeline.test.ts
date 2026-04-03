import { describe, expect, it } from 'vitest';
import { createServer } from '../../src/db/servers.js';
import { saveMetrics } from '../../src/db/metrics.js';
import { saveGpuUsageRows } from '../../src/db/gpu-usage.js';
import { listSecurityEvents } from '../../src/db/security-events.js';
import { processSecuritySnapshot } from '../../src/security/pipeline.js';
import type { AppSettings, MetricsSnapshot } from '../../src/types.js';

function createSnapshot(serverId: string, overrides: Partial<MetricsSnapshot> = {}): MetricsSnapshot {
  return {
    serverId,
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

function createSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    refreshIntervalMs: 5_000,
    alertCpuThreshold: 90,
    alertMemoryThreshold: 90,
    alertDiskThreshold: 90,
    alertDiskMountPoints: ['/'],
    alertSuppressDefaultDays: 7,
    apiEnabled: true,
    apiPort: 17_210,
    apiToken: '',
    historyRetentionDays: 7,
    securityMiningKeywords: ['xmrig'],
    securityUnownedGpuMinutes: 30,
    securityHighGpuUtilizationPercent: 90,
    securityHighGpuDurationMinutes: 120,
    password: '',
    ...overrides,
  };
}

describe('processSecuritySnapshot', () => {
  it('creates two events for the first suspicious snapshot', () => {
    const server = createServer({
      name: 'gpu-01',
      host: 'gpu-01',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
    });
    const snapshot = createSnapshot(server.id);
    saveMetrics(snapshot);
    saveGpuUsageRows(server.id, snapshot.timestamp - 60_000, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        pid: 202,
        command: 'xmrig --donate-level=1',
        userName: 'bob',
        usedMemoryMB: 1_024,
      },
    ]);
    saveGpuUsageRows(server.id, snapshot.timestamp, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        pid: 202,
        command: 'xmrig --donate-level=1',
        userName: 'bob',
        usedMemoryMB: 1_024,
      },
    ]);

    const created = processSecuritySnapshot(server.id, createSettings(), snapshot.timestamp);

    expect(created).toHaveLength(2);
    expect(created.map((event) => event.eventType)).toEqual(['suspicious_process', 'unowned_gpu']);
    expect(listSecurityEvents({ serverId: server.id, resolved: false })).toHaveLength(2);
  });

  it('does not create duplicate events when the same fingerprint is still open', () => {
    const server = createServer({
      name: 'gpu-02',
      host: 'gpu-02',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
    });
    const snapshot = createSnapshot(server.id);
    saveMetrics(snapshot);
    saveGpuUsageRows(server.id, snapshot.timestamp - 60_000, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        pid: 202,
        command: 'xmrig --donate-level=1',
        userName: 'bob',
        usedMemoryMB: 1_024,
      },
    ]);
    saveGpuUsageRows(server.id, snapshot.timestamp, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        pid: 202,
        command: 'xmrig --donate-level=1',
        userName: 'bob',
        usedMemoryMB: 1_024,
      },
    ]);

    const firstPass = processSecuritySnapshot(server.id, createSettings(), snapshot.timestamp);

    expect(firstPass).toHaveLength(2);

    const secondPass = processSecuritySnapshot(server.id, createSettings(), snapshot.timestamp);

    expect(secondPass).toEqual([]);
    expect(listSecurityEvents({ serverId: server.id, resolved: false })).toHaveLength(2);
  });

  it('uses the explicitly provided snapshot and matching gpu rows instead of newer stored samples', () => {
    const server = createServer({
      name: 'gpu-03',
      host: 'gpu-03',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
    });
    const currentSnapshot = createSnapshot(server.id, {
      timestamp: 1_712_010_000,
      gpu: {
        available: true,
        totalMemoryMB: 24_576,
        usedMemoryMB: 1_024,
        memoryUsagePercent: 4.17,
        utilizationPercent: 30,
        temperatureC: 65,
        gpuCount: 1,
      },
      processes: [
        {
          pid: 202,
          user: 'bob',
          command: 'xmrig --donate-level=1',
          cpuPercent: 88,
          memPercent: 2.4,
          rss: 2_048,
        },
      ],
    });
    const newerSnapshot = createSnapshot(server.id, {
      timestamp: currentSnapshot.timestamp + 60_000,
      gpu: {
        available: true,
        totalMemoryMB: 24_576,
        usedMemoryMB: 2_048,
        memoryUsagePercent: 8.33,
        utilizationPercent: 55,
        temperatureC: 55,
        gpuCount: 1,
      },
      processes: [
        {
          pid: 303,
          user: 'carol',
          command: 'xmrig-newer --config prod',
          cpuPercent: 91,
          memPercent: 3.1,
          rss: 4_096,
        },
      ],
    });

    saveMetrics(currentSnapshot);
    saveGpuUsageRows(server.id, currentSnapshot.timestamp - 60_000, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        pid: 202,
        command: 'xmrig --donate-level=1',
        userName: 'bob',
        usedMemoryMB: 1_024,
      },
    ]);
    saveGpuUsageRows(server.id, currentSnapshot.timestamp, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        pid: 202,
        command: 'xmrig --donate-level=1',
        userName: 'bob',
        usedMemoryMB: 1_024,
      },
    ]);

    saveMetrics(newerSnapshot);
    saveGpuUsageRows(server.id, newerSnapshot.timestamp, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        pid: 303,
        command: 'xmrig-newer --config prod',
        userName: 'carol',
        usedMemoryMB: 2_048,
      },
    ]);

    const created = processSecuritySnapshot(
      server.id,
      createSettings(),
      newerSnapshot.timestamp,
      currentSnapshot,
    );

    expect(created).toHaveLength(2);
    expect(created.map((event) => event.eventType)).toEqual(['suspicious_process', 'unowned_gpu']);
    expect(created.every((event) => event.details.command === 'xmrig --donate-level=1')).toBe(true);
    expect(created.every((event) => event.details.pid === 202)).toBe(true);
  });

  it('returns an empty array when gpu is unavailable', () => {
    const server = createServer({
      name: 'cpu-only',
      host: 'cpu-only',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
    });
    const snapshot = createSnapshot(server.id, {
      gpu: {
        available: false,
        totalMemoryMB: 0,
        usedMemoryMB: 0,
        memoryUsagePercent: 0,
        utilizationPercent: 0,
        temperatureC: 0,
        gpuCount: 0,
      },
    });
    saveMetrics(snapshot);

    const created = processSecuritySnapshot(server.id, createSettings(), snapshot.timestamp);

    expect(created).toEqual([]);
    expect(listSecurityEvents({ serverId: server.id })).toEqual([]);
  });
});