import { describe, expect, it, vi } from 'vitest';
import {
  AlertEngine,
  createServer,
  getAlerts,
  type AppSettings,
  type UnifiedReport,
} from '../src/index.js';
import { DEFAULT_SETTINGS } from '@pmeow/server-contracts';

function makeReport(overrides: Partial<UnifiedReport['resourceSnapshot']> = {}): UnifiedReport {
  const baseSnapshot: UnifiedReport['resourceSnapshot'] = {
    gpuCards: [{
      index: 0,
      name: 'RTX 4090',
      temperature: 65,
      utilizationGpu: 50,
      utilizationMemory: 40,
      memoryTotalMb: 24576,
      memoryUsedMb: 8000,
      managedReservedMb: 4000,
      unmanagedPeakMb: 1000,
      effectiveFreeMb: 15576,
      taskAllocations: [],
      userProcesses: [],
      unknownProcesses: [],
    }],
    cpu: { usagePercent: 45, coreCount: 16, modelName: 'AMD EPYC', frequencyMhz: 3500, perCoreUsage: [] },
    memory: { totalMb: 65536, usedMb: 32000, availableMb: 33536, usagePercent: 49, swapTotalMb: 0, swapUsedMb: 0, swapPercent: 0 },
    disks: [{ filesystem: 'ext4', mountPoint: '/', totalGB: 500, usedGB: 200, availableGB: 300, usagePercent: 40 }],
    diskIo: { readBytesPerSec: 2048, writeBytesPerSec: 1024 },
    network: { rxBytesPerSec: 1000, txBytesPerSec: 500, interfaces: [{ name: 'eth0', rxBytes: 100000, txBytes: 50000 }], internetReachable: true, internetLatencyMs: 12, internetProbeTarget: '8.8.8.8:53', internetProbeCheckedAt: Math.floor(Date.now() / 1000) },
    processes: [],
    processesByUser: [],
    localUsers: ['alice'],
  };

  return {
    agentId: 'agent-1',
    timestamp: Math.floor(Date.now() / 1000),
    seq: 1,
    resourceSnapshot: {
      ...baseSnapshot,
      ...overrides,
    },
    taskQueue: { queued: [], running: [], recentlyEnded: [] },
  };
}

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    alertThresholdDurationSeconds: 60,
    ...overrides,
  };
}

describe('threshold alert duration', () => {
  it('waits until a CPU threshold breach is sustained before creating an alert', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T00:00:00Z'));

    try {
      const server = createServer({ name: 'node-1', agentId: 'agent-1' });
      const engine = new AlertEngine();
      const highCpu = makeReport({
        cpu: { usagePercent: 95, coreCount: 16, modelName: 'AMD EPYC', frequencyMhz: 3500, perCoreUsage: [] },
      });

      const first = engine.processReport(server.id, highCpu, settings());
      expect(first.allChanges).toHaveLength(0);
      expect(getAlerts({ serverId: server.id })).toHaveLength(0);

      vi.advanceTimersByTime(59_000);
      const beforeDuration = engine.processReport(server.id, highCpu, settings());
      expect(beforeDuration.allChanges).toHaveLength(0);
      expect(getAlerts({ serverId: server.id })).toHaveLength(0);

      vi.advanceTimersByTime(1_000);
      const afterDuration = engine.processReport(server.id, highCpu, settings());
      expect(afterDuration.allChanges).toHaveLength(1);
      expect(afterDuration.allChanges[0].toStatus).toBe('active');
      expect(getAlerts({ serverId: server.id })).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the duration window when the threshold breach clears before firing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T00:00:00Z'));

    try {
      const server = createServer({ name: 'node-1', agentId: 'agent-1' });
      const engine = new AlertEngine();
      const highMemory = makeReport({
        memory: { totalMb: 65536, usedMb: 62000, availableMb: 3536, usagePercent: 95, swapTotalMb: 0, swapUsedMb: 0, swapPercent: 0 },
      });
      const recoveredMemory = makeReport();

      engine.processReport(server.id, highMemory, settings());
      vi.advanceTimersByTime(30_000);
      engine.processReport(server.id, recoveredMemory, settings());
      vi.advanceTimersByTime(59_000);

      const secondHigh = engine.processReport(server.id, highMemory, settings());
      expect(secondHigh.allChanges).toHaveLength(0);
      expect(getAlerts({ serverId: server.id })).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves an active CPU alert when current usage falls below the configured threshold', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T00:00:00Z'));

    try {
      const server = createServer({ name: 'node-1', agentId: 'agent-1' });
      const engine = new AlertEngine();
      const highCpu = makeReport({
        cpu: { usagePercent: 95, coreCount: 16, modelName: 'AMD EPYC', frequencyMhz: 3500, perCoreUsage: [] },
      });
      const lowerCpu = makeReport({
        cpu: { usagePercent: 5.9, coreCount: 16, modelName: 'AMD EPYC', frequencyMhz: 3500, perCoreUsage: [] },
      });

      engine.processReport(server.id, highCpu, settings({ alertCpuThreshold: 90, alertThresholdDurationSeconds: 5 }));
      vi.advanceTimersByTime(5_000);
      const activated = engine.processReport(server.id, highCpu, settings({ alertCpuThreshold: 90, alertThresholdDurationSeconds: 5 }));
      expect(activated.allChanges[0].toStatus).toBe('active');

      vi.advanceTimersByTime(5_000);
      const recovered = engine.processReport(server.id, lowerCpu, settings({ alertCpuThreshold: 7.1, alertThresholdDurationSeconds: 5 }));

      expect(recovered.allChanges).toHaveLength(1);
      expect(recovered.allChanges[0].fromStatus).toBe('active');
      expect(recovered.allChanges[0].toStatus).toBe('resolved');
      expect(getAlerts({ serverId: server.id })[0].status).toBe('resolved');
    } finally {
      vi.useRealTimers();
    }
  });
});
