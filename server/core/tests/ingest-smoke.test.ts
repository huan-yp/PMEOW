import { describe, it, expect, vi } from 'vitest';
import {
  getDatabase,
  createServer,
  IngestPipeline,
  AlertEngine,
  diffTasks,
  type UnifiedReport,
  type TaskInfo,
  type TaskEvent,
  type AlertStateChange,
} from '../src/index.js';

function makeReport(overrides: Partial<UnifiedReport> = {}): UnifiedReport {
  return {
    agentId: 'agent-1',
    timestamp: Math.floor(Date.now() / 1000),
    seq: 1,
    resourceSnapshot: {
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
    },
    taskQueue: { queued: [], running: [], recentlyEnded: [] },
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    taskId: 'task-1',
    status: 'queued',
    command: 'python train.py',
    cwd: '/home/alice',
    user: 'alice',
    launchMode: 'background',
    requireVramMb: 8000,
    requestedVramMb: null,
    vramMode: 'shared',
    requireGpuCount: 1,
    gpuIds: null,
    priority: 10,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    pid: null,
    exitCode: null,
    endReason: null,
    assignedGpus: null,
    declaredVramPerGpu: null,
    autoObserveWindowSec: null,
    autoPeakVramByGpuMb: null,
    autoReclaimedVramByGpuMb: null,
    autoReclaimDone: false,
    scheduleHistory: [],
    ...overrides,
  };
}

describe('task diff', () => {
  it('detects new queued task', () => {
    const diffs = diffTasks('server-1', [], [makeTask()]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].eventType).toBe('submitted');
  });

  it('detects new running task', () => {
    const diffs = diffTasks('server-1', [], [makeTask({ status: 'running' })]);
    expect(diffs).toHaveLength(2);
    expect(diffs[0].eventType).toBe('submitted');
    expect(diffs[1].eventType).toBe('started');
  });

  it('detects status upgrade queued → running', () => {
    const prev = [makeTask({ status: 'queued' })];
    const curr = [makeTask({ status: 'running', pid: 1234, startedAt: Date.now() })];
    const diffs = diffTasks('server-1', prev, curr);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].eventType).toBe('started');
  });

  it('detects task ended (disappeared)', () => {
    const diffs = diffTasks('server-1', [makeTask()], []);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].eventType).toBe('ended');
  });
});

describe('IngestPipeline', () => {
  it('processes a report and fires callbacks', () => {
    const server = createServer({ name: 'node-1', agentId: 'agent-1' });
    const events: TaskEvent[] = [];

    const pipeline = new IngestPipeline({
      onMetricsUpdate: () => {},
      onTaskEvent: (e) => events.push(e),
    });

    // First report with a queued task
    const report1 = makeReport({
      taskQueue: {
        queued: [makeTask({ taskId: 'task-a' })],
        running: [],
        recentlyEnded: [],
      },
    });
    pipeline.processReport(server.id, report1);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('submitted');

    // Second report: task starts running
    const report2 = makeReport({
      seq: 2,
      timestamp: Math.floor(Date.now() / 1000) + 1,
      taskQueue: {
        queued: [],
        running: [makeTask({ taskId: 'task-a', status: 'running', pid: 1234, startedAt: Date.now() })],
        recentlyEnded: [],
      },
    });
    pipeline.processReport(server.id, report2);
    expect(events).toHaveLength(2);
    expect(events[1].eventType).toBe('started');

    // Third report: task disappears (ended)
    const report3 = makeReport({
      seq: 3,
      timestamp: Math.floor(Date.now() / 1000) + 2,
      taskQueue: { queued: [], running: [], recentlyEnded: [] },
    });
    pipeline.processReport(server.id, report3);
    expect(events).toHaveLength(3);
    expect(events[2].eventType).toBe('ended');
  });

  it('stores latest report in memory', () => {
    const server = createServer({ name: 'node-1', agentId: 'agent-1' });
    const pipeline = new IngestPipeline();
    const report = makeReport();
    pipeline.processReport(server.id, report);

    expect(pipeline.getLatestReport(server.id)).toBe(report);
  });

  it('triggers alerts after high CPU is sustained', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T00:00:00Z'));

    try {
      const server = createServer({ name: 'node-1', agentId: 'agent-1' });
      const changes: AlertStateChange[] = [];
      const pipeline = new IngestPipeline({
        onAlertStateChange: (change) => changes.push(change),
      }, new AlertEngine());

      const report = makeReport({
        resourceSnapshot: {
          ...makeReport().resourceSnapshot,
          cpu: { usagePercent: 95, coreCount: 16, modelName: 'AMD EPYC', frequencyMhz: 3500, perCoreUsage: [] },
        },
      });

      pipeline.processReport(server.id, report);
      expect(changes.filter((change) => change.alert.alertType === 'cpu')).toHaveLength(0);

      vi.advanceTimersByTime(60_000);
      pipeline.processReport(server.id, report);

      const cpuChanges = changes.filter((change) => change.alert.alertType === 'cpu');
      expect(cpuChanges.length).toBeGreaterThanOrEqual(1);
      expect(cpuChanges[0].toStatus).toBe('active');
      expect(cpuChanges[0].alert.value).toBe(95);
    } finally {
      vi.useRealTimers();
    }
  });
});
