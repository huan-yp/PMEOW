import { describe, it, expect } from 'vitest';
import {
  getDatabase,
  createServer,
  IngestPipeline,
  diffTasks,
  type UnifiedReport,
  type TaskInfo,
  type TaskEvent,
  type AlertRecord,
} from '../src/index.js';

function makeReport(overrides: Partial<UnifiedReport> = {}): UnifiedReport {
  return {
    agentId: 'agent-1',
    timestamp: Date.now(),
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
      cpu: { usage: 45, cores: 16, frequency: 3500 },
      memory: { totalMb: 65536, usedMb: 32000, percent: 49 },
      disks: [{ mountpoint: '/', totalMb: 500000, usedMb: 200000 }],
      network: [{ interface: 'eth0', rxBytesPerSec: 1000, txBytesPerSec: 500 }],
      processes: [],
      internet: { reachable: true, targets: ['8.8.8.8'] },
      localUsers: ['alice'],
    },
    taskQueue: { queued: [], running: [] },
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id: 'task-1',
    status: 'queued',
    command: 'python train.py',
    cwd: '/home/alice',
    user: 'alice',
    launchMode: 'daemon_shell',
    requireVramMb: 8000,
    requireGpuCount: 1,
    gpuIds: null,
    priority: 10,
    createdAt: Date.now(),
    startedAt: null,
    pid: null,
    assignedGpus: null,
    declaredVramPerGpu: null,
    scheduleHistory: [],
    ...overrides,
  };
}

describe('task diff', () => {
  it('detects new queued task', () => {
    const diffs = diffTasks('server-1', [], [makeTask()]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].eventType).toBe('task_submitted');
  });

  it('detects new running task', () => {
    const diffs = diffTasks('server-1', [], [makeTask({ status: 'running' })]);
    expect(diffs).toHaveLength(2);
    expect(diffs[0].eventType).toBe('task_submitted');
    expect(diffs[1].eventType).toBe('task_started');
  });

  it('detects status upgrade queued → running', () => {
    const prev = [makeTask({ status: 'queued' })];
    const curr = [makeTask({ status: 'running', pid: 1234, startedAt: Date.now() })];
    const diffs = diffTasks('server-1', prev, curr);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].eventType).toBe('task_started');
  });

  it('detects priority change', () => {
    const prev = [makeTask({ priority: 10 })];
    const curr = [makeTask({ priority: 5 })];
    const diffs = diffTasks('server-1', prev, curr);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].eventType).toBe('task_priority_changed');
  });

  it('detects task ended (disappeared)', () => {
    const diffs = diffTasks('server-1', [makeTask()], []);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].eventType).toBe('task_ended');
  });
});

describe('IngestPipeline', () => {
  it('processes a report and fires callbacks', () => {
    const server = createServer({ name: 'node-1', agentId: 'agent-1' });
    const events: TaskEvent[] = [];
    const alerts: AlertRecord[] = [];

    const pipeline = new IngestPipeline({
      onMetricsUpdate: () => {},
      onTaskEvent: (e) => events.push(e),
      onAlert: (a) => alerts.push(a),
    });

    // First report with a queued task
    const report1 = makeReport({
      taskQueue: {
        queued: [makeTask({ id: 'task-a' })],
        running: [],
      },
    });
    pipeline.processReport(server.id, report1);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('task_submitted');

    // Second report: task starts running
    const report2 = makeReport({
      seq: 2,
      timestamp: Date.now() + 1000,
      taskQueue: {
        queued: [],
        running: [makeTask({ id: 'task-a', status: 'running', pid: 1234, startedAt: Date.now() })],
      },
    });
    pipeline.processReport(server.id, report2);
    expect(events).toHaveLength(2);
    expect(events[1].eventType).toBe('task_started');

    // Third report: task disappears (ended)
    const report3 = makeReport({
      seq: 3,
      timestamp: Date.now() + 2000,
      taskQueue: { queued: [], running: [] },
    });
    pipeline.processReport(server.id, report3);
    expect(events).toHaveLength(3);
    expect(events[2].eventType).toBe('task_ended');
  });

  it('stores latest report in memory', () => {
    const server = createServer({ name: 'node-1', agentId: 'agent-1' });
    const pipeline = new IngestPipeline();
    const report = makeReport();
    pipeline.processReport(server.id, report);

    expect(pipeline.getLatestReport(server.id)).toBe(report);
  });

  it('triggers alerts on high CPU', () => {
    const server = createServer({ name: 'node-1', agentId: 'agent-1' });
    const alerts: AlertRecord[] = [];
    const pipeline = new IngestPipeline({
      onAlert: (a) => alerts.push(a),
    });

    const report = makeReport({
      resourceSnapshot: {
        ...makeReport().resourceSnapshot,
        cpu: { usage: 95, cores: 16, frequency: 3500 },
      },
    });
    pipeline.processReport(server.id, report);
    
    const cpuAlerts = alerts.filter(a => a.alertType === 'cpu');
    expect(cpuAlerts.length).toBeGreaterThanOrEqual(1);
    expect(cpuAlerts[0].value).toBe(95);
  });
});
