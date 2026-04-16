import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  AgentTaskQueueGroup,
  AlertEvent,
  AlertRecord,
  AppSettings,
  GpuOverviewResponse,
  GpuUsageSummaryItem,
  GpuUsageTimelinePoint,
  HookLog,
  HookRule,
  HookRuleInput,
  MetricsSnapshot,
  ProcessAuditRow,
  SecurityEventQuery,
  SecurityEventRecord,
  ServerConfig,
  ServerInput,
  ServerStatus,
} from '@monitor/core';
import { TransportProvider } from '../src/transport/TransportProvider.js';
import type { TransportAdapter } from '../src/transport/types.js';
import { useStore } from '../src/store/useStore.js';
import { useOperatorBootstrap } from '../src/hooks/useOperatorData.js';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createMockTransport(): TransportAdapter & {
  emitTaskChanged: () => void;
  emitSecurityEvent: () => void;
} {
  let onTaskChangedCb: (() => void) | undefined;
  let onSecurityEventCb: (() => void) | undefined;

  return {
    isElectron: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMetricsUpdate: vi.fn(() => () => undefined),
    onServerStatus: vi.fn(() => () => undefined),
    onAlert: vi.fn((_cb: (alert: AlertEvent) => void) => () => undefined),
    onHookTriggered: vi.fn((_cb: (log: HookLog) => void) => () => undefined),
    onNotify: vi.fn((_cb: (title: string, body: string) => void) => () => undefined),
    onTaskChanged: vi.fn((cb) => {
      onTaskChangedCb = () => cb();
      return () => {
        onTaskChangedCb = undefined;
      };
    }),
    onSecurityEvent: vi.fn((cb) => {
      onSecurityEventCb = () => cb({
        id: 99,
        serverId: 'server-1',
        eventType: 'unowned_gpu',
        fingerprint: 'fp-refresh',
        details: { reason: 'refresh' },
        resolved: false,
        resolvedBy: null,
        createdAt: 1_700_000_000_999,
        resolvedAt: null,
      });
      return () => {
        onSecurityEventCb = undefined;
      };
    }),
    getServers: vi.fn<() => Promise<ServerConfig[]>>(async () => []),
    addServer: vi.fn<(input: ServerInput) => Promise<ServerConfig>>(async (_input) => {
      throw new Error('not implemented');
    }),
    updateServer: vi.fn<(id: string, input: Partial<ServerInput>) => Promise<ServerConfig>>(async (_id, _input) => {
      throw new Error('not implemented');
    }),
    deleteServer: vi.fn<(id: string) => Promise<boolean>>(async (_id) => true),
    testConnection: vi.fn<(input: ServerInput) => Promise<{ success: boolean; error?: string }>>(async (_input) => ({ success: true })),
    getLatestMetrics: vi.fn<(serverId: string) => Promise<MetricsSnapshot | null>>(async (_serverId) => null),
    getMetricsHistory: vi.fn<(serverId: string, from: number, to: number) => Promise<MetricsSnapshot[]>>(async (_serverId, _from, _to) => []),
    getServerStatuses: vi.fn<() => Promise<ServerStatus[]>>(async () => []),
    getHooks: vi.fn<() => Promise<HookRule[]>>(async () => []),
    createHook: vi.fn<(input: HookRuleInput) => Promise<HookRule>>(async (_input) => {
      throw new Error('not implemented');
    }),
    updateHook: vi.fn<(id: string, input: Partial<HookRuleInput>) => Promise<HookRule>>(async (_id, _input) => {
      throw new Error('not implemented');
    }),
    deleteHook: vi.fn<(id: string) => Promise<boolean>>(async (_id) => true),
    getHookLogs: vi.fn<(hookId: string) => Promise<HookLog[]>>(async (_hookId) => []),
    testHookAction: vi.fn<(hookId: string) => Promise<{ success: boolean; result?: string; error?: string }>>(async (_hookId) => ({ success: true })),
    getSettings: vi.fn<() => Promise<AppSettings>>(async () => {
      throw new Error('not implemented');
    }),
    saveSettings: vi.fn<(settings: Partial<AppSettings>) => Promise<void>>(async (_settings) => undefined),
    login: vi.fn<(password: string) => Promise<{ success: boolean; token?: string; error?: string }>>(async (_password) => ({ success: true, token: 'token' })),
    setPassword: vi.fn<(password: string) => Promise<{ success: boolean }>>(async (_password) => ({ success: true })),
    checkAuth: vi.fn<() => Promise<{ authenticated: boolean; needsSetup: boolean }>>(async () => ({ authenticated: true, needsSetup: false })),
    getAlerts: vi.fn<(query?: unknown) => Promise<AlertRecord[]>>(async (_query) => []),
    suppressAlert: vi.fn<(id: string, days?: number) => Promise<void>>(async (_id, _days) => undefined),
    unsuppressAlert: vi.fn<(id: string) => Promise<void>>(async (_id) => undefined),
    batchSuppressAlerts: vi.fn<(ids: string[], days?: number) => Promise<void>>(async (_ids, _days) => undefined),
    batchUnsuppressAlerts: vi.fn<(ids: string[]) => Promise<void>>(async (_ids) => undefined),
    uploadKey: vi.fn<(file: File) => Promise<{ path: string }>>(async (_file) => ({ path: '/tmp/key' })),
    getTaskQueue: vi.fn<() => Promise<AgentTaskQueueGroup[]>>(async () => [
      {
        serverId: 'server-1',
        serverName: 'gpu-01',
        queued: [{ serverId: 'server-1', taskId: 'queued-1', status: 'queued', command: 'python train.py' }],
        running: [],
        recent: [],
      },
    ]),
    getProcessAudit: vi.fn<(serverId: string) => Promise<ProcessAuditRow[]>>(async (_serverId) => []),
    getSecurityEvents: vi.fn<(query?: SecurityEventQuery) => Promise<SecurityEventRecord[]>>(async (_query) => [
      {
        id: 11,
        serverId: 'server-1',
        eventType: 'suspicious_process',
        fingerprint: 'fp-1',
        details: {
          reason: '命中关键词 xmrig',
          command: 'xmrig --donate-level=1',
          user: 'alice',
        },
        resolved: false,
        resolvedBy: null,
        createdAt: 1_700_000_000_000,
        resolvedAt: null,
      },
    ]),
    markSecurityEventSafe: vi.fn<(id: number, reason?: string) => Promise<{ resolvedEvent: SecurityEventRecord; auditEvent?: SecurityEventRecord }>>(async (_id, _reason) => {
      throw new Error('not implemented');
    }),
    getGpuOverview: vi.fn<() => Promise<GpuOverviewResponse>>(async () => ({ generatedAt: 0, users: [], servers: [] })),
    getGpuUsageSummary: vi.fn<(hours?: number) => Promise<GpuUsageSummaryItem[]>>(async (_hours) => []),
    getGpuUsageByUser: vi.fn<(user: string, hours?: number) => Promise<GpuUsageTimelinePoint[]>>(async (_user, _hours) => []),
    cancelTask: vi.fn<(serverId: string, taskId: string) => Promise<void>>(async (_serverId, _taskId) => undefined),
    setTaskPriority: vi.fn<(serverId: string, taskId: string, priority: number) => Promise<void>>(async (_serverId, _taskId, _priority) => undefined),
    pauseQueue: vi.fn<(serverId: string) => Promise<void>>(async (_serverId) => undefined),
    resumeQueue: vi.fn<(serverId: string) => Promise<void>>(async (_serverId) => undefined),
    getGpuAllocation: vi.fn<(serverId: string) => Promise<GpuAllocationSummary | null>>(async (_serverId) => null),
    getTask: vi.fn<(serverId: string, taskId: string) => Promise<unknown>>(async (_serverId, _taskId) => null),
    getResolvedGpuAllocation: vi.fn(async () => null),
    getPersonBindingCandidates: vi.fn(async () => []),
    emitTaskChanged: () => {
      onTaskChangedCb?.();
    },
    emitSecurityEvent: () => {
      onSecurityEventCb?.();
    },
  };
}

function Probe() {
  useOperatorBootstrap();
  const taskQueueGroups = useStore((state) => state.taskQueueGroups);
  const openSecurityEvents = useStore((state) => state.openSecurityEvents);

  return (
    <>
      <div data-testid="task-groups">{taskQueueGroups.length}</div>
      <div data-testid="security-events">{openSecurityEvents.length}</div>
    </>
  );
}

describe('useOperatorBootstrap', () => {
  beforeEach(() => {
    useStore.setState({
      taskQueueGroups: [],
      openSecurityEvents: [],
    });
  });

  it('loads task queue and unresolved security events on mount', async () => {
    const transport = createMockTransport();

    render(
      <TransportProvider adapter={transport}>
        <Probe />
      </TransportProvider>
    );

    await waitFor(() => {
      expect(useStore.getState().taskQueueGroups).toHaveLength(1);
      expect(useStore.getState().openSecurityEvents).toHaveLength(1);
    });

    expect(transport.getTaskQueue).toHaveBeenCalledTimes(1);
    expect(transport.getSecurityEvents).toHaveBeenCalledWith({ resolved: false, hours: 168 });
  });

  it('refreshes only task queue after task updates and only security events after security updates', async () => {
    const transport = createMockTransport();

    render(
      <TransportProvider adapter={transport}>
        <Probe />
      </TransportProvider>
    );

    expect(transport.getTaskQueue).toHaveBeenCalledTimes(1);
    expect(transport.getSecurityEvents).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();

    await act(async () => {
      transport.emitTaskChanged();

      expect(transport.getTaskQueue).toHaveBeenCalledTimes(1);
      expect(transport.getSecurityEvents).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(200);
    });

    expect(transport.getTaskQueue).toHaveBeenCalledTimes(2);
    expect(transport.getSecurityEvents).toHaveBeenCalledTimes(1);

    await act(async () => {
      transport.emitSecurityEvent();

      expect(transport.getTaskQueue).toHaveBeenCalledTimes(2);
      expect(transport.getSecurityEvents).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(200);
    });

    expect(transport.getTaskQueue).toHaveBeenCalledTimes(2);
    expect(transport.getSecurityEvents).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('keeps newer task queue and security event results when older requests resolve later', async () => {
    vi.useFakeTimers();

    const transport = createMockTransport();
    const initialTaskQueue = createDeferred<AgentTaskQueueGroup[]>();
    const refreshedTaskQueue = createDeferred<AgentTaskQueueGroup[]>();
    const initialSecurityEvents = createDeferred<SecurityEventRecord[]>();
    const refreshedSecurityEvents = createDeferred<SecurityEventRecord[]>();

    transport.getTaskQueue = vi
      .fn<() => Promise<AgentTaskQueueGroup[]>>()
      .mockImplementationOnce(() => initialTaskQueue.promise)
      .mockImplementationOnce(() => refreshedTaskQueue.promise);
    transport.getSecurityEvents = vi
      .fn<(query?: SecurityEventQuery) => Promise<SecurityEventRecord[]>>()
      .mockImplementationOnce((_query) => initialSecurityEvents.promise)
      .mockImplementationOnce((_query) => refreshedSecurityEvents.promise);

    render(
      <TransportProvider adapter={transport}>
        <Probe />
      </TransportProvider>
    );

    expect(transport.getTaskQueue).toHaveBeenCalledTimes(1);
    expect(transport.getSecurityEvents).toHaveBeenCalledTimes(1);

    await act(async () => {
      transport.emitTaskChanged();
      transport.emitSecurityEvent();
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(transport.getTaskQueue).toHaveBeenCalledTimes(2);
    expect(transport.getSecurityEvents).toHaveBeenCalledTimes(2);

    refreshedTaskQueue.resolve([
      {
        serverId: 'server-new',
        serverName: 'gpu-new',
        queued: [{ serverId: 'server-new', taskId: 'task-new', status: 'queued', command: 'python new.py' }],
        running: [],
        recent: [],
      },
    ]);
    refreshedSecurityEvents.resolve([
      {
        id: 22,
        serverId: 'server-new',
        eventType: 'suspicious_process',
        fingerprint: 'fp-new',
        details: { reason: 'new' },
        resolved: false,
        resolvedBy: null,
        createdAt: 1_700_000_000_222,
        resolvedAt: null,
      },
    ]);

    await flushMicrotasks();

    expect(useStore.getState().taskQueueGroups[0]?.serverId).toBe('server-new');
    expect(useStore.getState().openSecurityEvents[0]?.id).toBe(22);

    initialTaskQueue.resolve([
      {
        serverId: 'server-old',
        serverName: 'gpu-old',
        queued: [{ serverId: 'server-old', taskId: 'task-old', status: 'queued', command: 'python old.py' }],
        running: [],
        recent: [],
      },
    ]);
    initialSecurityEvents.resolve([
      {
        id: 11,
        serverId: 'server-old',
        eventType: 'unowned_gpu',
        fingerprint: 'fp-old',
        details: { reason: 'old' },
        resolved: false,
        resolvedBy: null,
        createdAt: 1_700_000_000_111,
        resolvedAt: null,
      },
    ]);

    await flushMicrotasks();

    expect(useStore.getState().taskQueueGroups[0]?.serverId).toBe('server-new');
    expect(useStore.getState().openSecurityEvents[0]?.id).toBe(22);

    vi.useRealTimers();
  });

  it('keeps successful chain updates and continues refreshing after single-side failures', async () => {
    vi.useFakeTimers();

    const transport = createMockTransport();
    const firstTaskQueue = createDeferred<AgentTaskQueueGroup[]>();
    const secondTaskQueue = createDeferred<AgentTaskQueueGroup[]>();

    transport.getTaskQueue = vi
      .fn<() => Promise<AgentTaskQueueGroup[]>>()
      .mockImplementationOnce(() => firstTaskQueue.promise)
      .mockImplementationOnce(() => secondTaskQueue.promise);
    transport.getSecurityEvents = vi
      .fn<(query?: SecurityEventQuery) => Promise<SecurityEventRecord[]>>()
      .mockRejectedValueOnce(new Error('security unavailable'))
      .mockResolvedValueOnce([
        {
          id: 33,
          serverId: 'server-1',
          eventType: 'suspicious_process',
          fingerprint: 'fp-recovered',
          details: { reason: 'recovered' },
          resolved: false,
          resolvedBy: null,
          createdAt: 1_700_000_000_333,
          resolvedAt: null,
        },
      ]);

    render(
      <TransportProvider adapter={transport}>
        <Probe />
      </TransportProvider>
    );

    firstTaskQueue.resolve([
      {
        serverId: 'server-1',
        serverName: 'gpu-01',
        queued: [{ serverId: 'server-1', taskId: 'task-1', status: 'queued', command: 'python a.py' }],
        running: [],
        recent: [],
      },
    ]);

    await flushMicrotasks();

    expect(useStore.getState().taskQueueGroups[0]?.serverId).toBe('server-1');
    expect(useStore.getState().openSecurityEvents).toHaveLength(0);

    await act(async () => {
      transport.emitSecurityEvent();
      await vi.advanceTimersByTimeAsync(200);
    });

    await act(async () => {
      transport.emitTaskChanged();
      await vi.advanceTimersByTimeAsync(200);
    });

    secondTaskQueue.resolve([
      {
        serverId: 'server-3',
        serverName: 'gpu-03',
        queued: [{ serverId: 'server-3', taskId: 'task-3', status: 'queued', command: 'python c.py' }],
        running: [],
        recent: [],
      },
    ]);

    await flushMicrotasks();

    expect(useStore.getState().taskQueueGroups[0]?.serverId).toBe('server-3');
    expect(useStore.getState().openSecurityEvents[0]?.id).toBe(33);

    expect(transport.getTaskQueue).toHaveBeenCalledTimes(2);
    expect(transport.getSecurityEvents).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});