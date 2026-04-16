import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentTaskEventRecord,
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
  MirroredAgentTaskRecord,
  ProcessAuditRow,
  SecurityEventRecord,
  ServerConfig,
  ServerInput,
  ServerStatus,
} from '@monitor/core';
import { DEFAULT_SETTINGS } from '@monitor/core';
import App from '../src/App.js';
import type { AlertQuery, SecurityEventQuery, TransportAdapter } from '../src/transport/types.js';
import { useStore } from '../src/store/useStore.js';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function createServer(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id: 'server-1',
    name: 'gpu-agent-01',
    host: '10.0.0.10',
    port: 22,
    username: 'ubuntu',
    privateKeyPath: '/keys/id_ed25519',
    sourceType: 'agent',
    agentId: 'agent-1',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createSecurityEvent(overrides: Partial<SecurityEventRecord> = {}): SecurityEventRecord {
  return {
    id: 101,
    serverId: 'server-1',
    eventType: 'suspicious_process',
    fingerprint: 'fp-101',
    details: {
      reason: '命中关键词 xmrig',
      command: 'xmrig --donate-level=1',
      user: 'alice',
      pid: 4123,
    },
    resolved: false,
    resolvedBy: null,
    createdAt: 1_710_000_000_000,
    resolvedAt: null,
    ...overrides,
  };
}

function createTask(overrides: Partial<MirroredAgentTaskRecord> = {}): MirroredAgentTaskRecord {
  return {
    serverId: 'server-1',
    taskId: 'task-1',
    status: 'completed',
    command: 'python done.py',
    priority: 0,
    user: 'alice',
    createdAt: 1_710_000_000_000,
    finishedAt: 1_710_000_100_000,
    ...overrides,
  };
}

function createMockTransport() {
  const taskQueueGroups: AgentTaskQueueGroup[] = [
    {
      serverId: 'server-1',
      serverName: 'gpu-agent-01',
      queued: [
        {
          serverId: 'server-1',
          taskId: 'task-queued-1',
          status: 'queued',
          command: 'python queued.py',
          priority: 2,
          user: 'alice',
          createdAt: 1_710_000_000_000,
        },
      ],
      running: [
        {
          serverId: 'server-1',
          taskId: 'task-running-1',
          status: 'running',
          command: 'python train.py',
          priority: 4,
          user: 'bob',
          startedAt: 1_710_000_100_000,
        },
      ],
      recent: [],
    },
  ];

  const securityEvents = [createSecurityEvent()];
  const taskEvents: AgentTaskEventRecord[] = [
    {
      id: 1,
      taskId: 'task-queued-1',
      eventType: 'schedule_blocked',
      timestamp: 1_710_000_000,
      details: {
        message: 'schedule blocked (blocked by higher-priority reservations in this scheduling round)',
        reason_code: 'blocked_by_higher_priority',
        current_eligible_gpu_ids: [0, 1],
        sustained_eligible_gpu_ids: [0],
        blocker_task_ids: ['task-a'],
      },
    },
  ];

  return {
    isElectron: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMetricsUpdate: vi.fn(() => () => undefined),
    onServerStatus: vi.fn(() => () => undefined),
    onAlert: vi.fn((_cb: (alert: AlertEvent) => void) => () => undefined),
    onHookTriggered: vi.fn((_cb: (log: HookLog) => void) => () => undefined),
    onNotify: vi.fn((_cb: (title: string, body: string) => void) => () => undefined),
    onTaskChanged: vi.fn(() => () => undefined),
    onSecurityEvent: vi.fn(() => () => undefined),
    getServers: vi.fn<() => Promise<ServerConfig[]>>(async () => [createServer()]),
    addServer: vi.fn<(input: ServerInput) => Promise<ServerConfig>>(async (_input) => createServer()),
    updateServer: vi.fn<(id: string, input: Partial<ServerInput>) => Promise<ServerConfig>>(async (_id, _input) => createServer()),
    deleteServer: vi.fn<(id: string) => Promise<boolean>>(async (_id) => true),
    testConnection: vi.fn<(input: ServerInput) => Promise<{ success: boolean; error?: string }>>(async (_input) => ({ success: true })),
    getLatestMetrics: vi.fn<(serverId: string) => Promise<MetricsSnapshot | null>>(async (_serverId) => null),
    getMetricsHistory: vi.fn<(serverId: string, from: number, to: number) => Promise<MetricsSnapshot[]>>(async (_serverId, _from, _to) => []),
    getMetricsHistoryBucketed: vi.fn(async (_serverId, _from, _to, _bucketMs) => ({ serverId: 'server-1', buckets: [], bucketMs: 60_000, from: 0, to: 0, source: 'raw' as const })),
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
    getSettings: vi.fn<() => Promise<AppSettings>>(async () => DEFAULT_SETTINGS),
    saveSettings: vi.fn<(settings: Partial<AppSettings>) => Promise<void>>(async (_settings) => undefined),
    login: vi.fn<(password: string) => Promise<{ success: boolean; token?: string; error?: string }>>(async (_password) => ({ success: true, token: 'token' })),
    setPassword: vi.fn<(password: string) => Promise<{ success: boolean }>>(async (_password) => ({ success: true })),
    checkAuth: vi.fn<() => Promise<{ authenticated: boolean; needsSetup: boolean }>>(async () => ({ authenticated: true, needsSetup: false })),
    getAlerts: vi.fn<(query?: AlertQuery) => Promise<AlertRecord[]>>(async (_query) => []),
    suppressAlert: vi.fn<(id: string, days?: number) => Promise<void>>(async (_id, _days) => undefined),
    unsuppressAlert: vi.fn<(id: string) => Promise<void>>(async (_id) => undefined),
    batchSuppressAlerts: vi.fn<(ids: string[], days?: number) => Promise<void>>(async (_ids, _days) => undefined),
    batchUnsuppressAlerts: vi.fn<(ids: string[]) => Promise<void>>(async (_ids) => undefined),
    getTaskQueue: vi.fn<() => Promise<AgentTaskQueueGroup[]>>(async () => taskQueueGroups),
    getTaskEvents: vi.fn<(serverId: string, taskId: string, afterId?: number) => Promise<AgentTaskEventRecord[]>>(async (_serverId, _taskId, _afterId) => taskEvents),
    getProcessAudit: vi.fn<(serverId: string) => Promise<ProcessAuditRow[]>>(async (_serverId) => []),
    getSecurityEvents: vi.fn<(query?: SecurityEventQuery) => Promise<SecurityEventRecord[]>>(async (_query) => securityEvents),
    markSecurityEventSafe: vi.fn<(id: number, reason?: string) => Promise<{ resolvedEvent: SecurityEventRecord; auditEvent?: SecurityEventRecord }>>(async (id, _reason) => ({
      resolvedEvent: createSecurityEvent({ id, resolved: true, resolvedBy: 'operator', resolvedAt: 1_710_000_100_000 }),
    })),
    unresolveSecurityEvent: vi.fn<(id: number, reason?: string) => Promise<{ reopenedEvent: SecurityEventRecord; auditEvent: SecurityEventRecord }>>(async (id, _reason) => ({
      reopenedEvent: createSecurityEvent({ id, resolved: false, resolvedBy: null, resolvedAt: null }),
      auditEvent: createSecurityEvent({ id: id + 1000, eventType: 'unresolve', resolved: true, resolvedBy: 'operator', resolvedAt: 1_710_000_200_000, details: { reason: 'unresolve', targetEventId: id } }),
    })),
    getGpuOverview: vi.fn<() => Promise<GpuOverviewResponse>>(async () => ({ generatedAt: 1_710_000_000_000, users: [], servers: [] })),
    getGpuUsageSummary: vi.fn<(hours?: number) => Promise<GpuUsageSummaryItem[]>>(async (_hours) => []),
    getGpuUsageByUser: vi.fn<(user: string, hours?: number) => Promise<GpuUsageTimelinePoint[]>>(async (_user, _hours) => []),
    getGpuUsageByUserBucketed: vi.fn(async (_user, _from, _to, _bucketMs) => ({ buckets: [], bucketMs: 60_000, from: 0, to: 0, source: 'raw' as const })),
    cancelTask: vi.fn<(serverId: string, taskId: string) => Promise<void>>(async (_serverId, _taskId) => undefined),
    setTaskPriority: vi.fn<(serverId: string, taskId: string, priority: number) => Promise<void>>(async (_serverId, _taskId, _priority) => undefined),
    pauseQueue: vi.fn<(serverId: string) => Promise<void>>(async (_serverId) => undefined),
    resumeQueue: vi.fn<(serverId: string) => Promise<void>>(async (_serverId) => undefined),
    uploadKey: vi.fn<(file: File) => Promise<{ path: string }>>(async (_file) => ({ path: '/tmp/key' })),
    getPersons: vi.fn(async () => []),
    createPerson: vi.fn(async () => ({ id: 'p1', displayName: '', email: '', qq: '', note: '', customFields: {}, status: 'active' as const, createdAt: 1, updatedAt: 1 })),
    updatePerson: vi.fn(async () => ({ id: 'p1', displayName: '', email: '', qq: '', note: '', customFields: {}, status: 'active' as const, createdAt: 1, updatedAt: 1 })),
    getPersonBindings: vi.fn(async () => []),
    createPersonBinding: vi.fn(async () => ({ id: 'b1', personId: 'p1', serverId: 's1', systemUser: 'u', source: 'manual' as const, enabled: true, effectiveFrom: 1, effectiveTo: null, createdAt: 1, updatedAt: 1 })),
    updatePersonBinding: vi.fn(async () => ({ id: 'b1', personId: 'p1', serverId: 's1', systemUser: 'u', source: 'manual' as const, enabled: true, effectiveFrom: 1, effectiveTo: null, createdAt: 1, updatedAt: 1 })),
    getPersonBindingCandidates: vi.fn(async () => []),
    getPersonBindingSuggestions: vi.fn(async () => []),
    getPersonSummary: vi.fn(async () => []),
    getPersonTimeline: vi.fn(async () => []),
    getPersonTasks: vi.fn(async () => []),
    getServerPersonActivity: vi.fn(async () => ({ serverId: 's1', people: [], unassignedVramMB: 0, unassignedUsers: [] })),
    getResolvedGpuAllocation: vi.fn(async () => null),
  };
}

function renderApp(transport: TransportAdapter, route = '/') {
  window.history.pushState({}, '', route);
  const AppWithAdapter = App as unknown as (props: { adapter?: TransportAdapter }) => JSX.Element;
  return render(<AppWithAdapter adapter={transport} />);
}

describe('task queue and security pages', () => {
  beforeEach(() => {
    useStore.setState({
      servers: [],
      statuses: new Map(),
      latestMetrics: new Map(),
      hooks: [],
      settings: null,
      taskQueueGroups: [],
      openSecurityEvents: [],
      toasts: [],
      authenticated: false,
    });
  });

  it('renders Tasks and Security navigation and routes to both pages', async () => {
    const transport = createMockTransport();
    const user = userEvent.setup();

    renderApp(transport);

    expect(await screen.findByRole('link', { name: '任务调度' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '安全审计' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '查看日志' })).toBeNull();

    await user.click(screen.getByRole('link', { name: '任务调度' }));
    expect(await screen.findByRole('heading', { name: '任务调度' })).toBeTruthy();

    await user.click(screen.getByRole('link', { name: '安全审计' }));
    expect(await screen.findByRole('heading', { name: '安全审计' })).toBeTruthy();

    await waitFor(() => {
      expect(transport.getTaskQueue).toHaveBeenCalled();
      expect(transport.getSecurityEvents).toHaveBeenCalled();
    });
  });

  it('calls task queue transport actions from the Tasks page', async () => {
    const transport = createMockTransport();
    const user = userEvent.setup();
    const pauseQueueRequest = createDeferred<void>();
    const cancelTaskRequest = createDeferred<void>();

    transport.pauseQueue = vi.fn(async () => pauseQueueRequest.promise);
    transport.cancelTask = vi.fn(async () => cancelTaskRequest.promise);

    renderApp(transport, '/tasks');

    expect(await screen.findByText('task-queued-1')).toBeTruthy();

    const pauseButton = screen.getByRole('button', { name: '暂停队列' });
    const resumeButton = screen.getByRole('button', { name: '恢复队列' });
    const cancelButton = screen.getByRole('button', { name: '取消任务 task-queued-1' });
    const priorityButton = screen.getByRole('button', { name: '提高优先级 task-queued-1' });

    await user.click(pauseButton);
    await waitFor(() => {
      expect(transport.pauseQueue).toHaveBeenCalledWith('server-1');
      expect((pauseButton as HTMLButtonElement).disabled).toBe(true);
      expect((resumeButton as HTMLButtonElement).disabled).toBe(true);
    });

    await user.click(resumeButton);
    expect(transport.resumeQueue).not.toHaveBeenCalled();

    pauseQueueRequest.resolve(undefined);
    await waitFor(() => {
      expect((pauseButton as HTMLButtonElement).disabled).toBe(false);
      expect((resumeButton as HTMLButtonElement).disabled).toBe(false);
    });

    await user.click(resumeButton);
    await waitFor(() => {
      expect(transport.resumeQueue).toHaveBeenCalledWith('server-1');
    });

    await user.click(cancelButton);
    await waitFor(() => {
      expect(transport.cancelTask).toHaveBeenCalledWith('server-1', 'task-queued-1');
      expect((cancelButton as HTMLButtonElement).disabled).toBe(true);
      expect((priorityButton as HTMLButtonElement).disabled).toBe(true);
    });

    await user.click(priorityButton);
    expect(transport.setTaskPriority).not.toHaveBeenCalled();

    cancelTaskRequest.resolve(undefined);
    await waitFor(() => {
      expect((cancelButton as HTMLButtonElement).disabled).toBe(false);
      expect((priorityButton as HTMLButtonElement).disabled).toBe(false);
    });

    await user.click(priorityButton);
    await waitFor(() => {
      expect(transport.setTaskPriority).toHaveBeenCalledWith('server-1', 'task-queued-1', 3);
    });

    expect(screen.queryByRole('button', { name: '查看日志' })).toBeNull();
  });

  it('paginates recent tasks per server without affecting other servers', async () => {
    const transport = createMockTransport();
    const user = userEvent.setup();

    transport.getTaskQueue = vi.fn(async () => [
      {
        serverId: 'server-1',
        serverName: 'gpu-agent-01',
        queued: [],
        running: [],
        recent: Array.from({ length: 7 }, (_, index) => createTask({
          serverId: 'server-1',
          taskId: `task-recent-${index + 1}`,
          command: `python recent-${index + 1}.py`,
          user: 'alice',
          finishedAt: 1_710_000_100_000 - index,
        })),
      },
      {
        serverId: 'server-2',
        serverName: 'gpu-agent-02',
        queued: [],
        running: [],
        recent: Array.from({ length: 6 }, (_, index) => createTask({
          serverId: 'server-2',
          taskId: `task-other-${index + 1}`,
          command: `python other-${index + 1}.py`,
          user: 'bob',
          finishedAt: 1_710_000_200_000 - index,
        })),
      },
    ]);

    renderApp(transport, '/tasks');

    const firstServerHeading = await screen.findByText('gpu-agent-01');
    const secondServerHeading = await screen.findByText('gpu-agent-02');
    const firstServerSection = firstServerHeading.closest('section');
    const secondServerSection = secondServerHeading.closest('section');

    expect(firstServerSection).toBeTruthy();
    expect(secondServerSection).toBeTruthy();

    const firstServer = within(firstServerSection as HTMLElement);
    const secondServer = within(secondServerSection as HTMLElement);

    expect(firstServer.getByText('第 1 页 / 共 2 页')).toBeTruthy();
    expect(secondServer.getByText('第 1 页 / 共 2 页')).toBeTruthy();
    expect(firstServer.getByText('task-recent-1')).toBeTruthy();
    expect(firstServer.queryByText('task-recent-6')).toBeNull();
    expect(secondServer.getByText('task-other-1')).toBeTruthy();
    expect(secondServer.queryByText('task-other-6')).toBeNull();
    expect((firstServer.getByRole('button', { name: '上一页' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(firstServer.getByRole('button', { name: '下一页' }));

    await waitFor(() => {
      expect(firstServer.getByText('第 2 页 / 共 2 页')).toBeTruthy();
      expect(firstServer.getByText('task-recent-6')).toBeTruthy();
      expect(firstServer.getByText('task-recent-7')).toBeTruthy();
      expect(firstServer.queryByText('task-recent-1')).toBeNull();
      expect((firstServer.getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled).toBe(true);
    });

    expect(secondServer.getByText('第 1 页 / 共 2 页')).toBeTruthy();
    expect(secondServer.getByText('task-other-1')).toBeTruthy();
    expect(secondServer.queryByText('task-other-6')).toBeNull();
  });

  it('queries security events with filters and marks events safe', async () => {
    const transport = createMockTransport();
    const user = userEvent.setup();

    renderApp(transport, '/security');

    expect(await screen.findByText('xmrig --donate-level=1')).toBeTruthy();

    transport.markSecurityEventSafe.mockClear();
    transport.getSecurityEvents.mockClear();

    await user.click(screen.getByRole('button', { name: '标记安全 101' }));

    await waitFor(() => {
      expect(transport.markSecurityEventSafe).toHaveBeenCalledWith(101);
      expect(transport.getSecurityEvents).toHaveBeenCalledWith({ resolved: false, hours: 168 });
    });

    transport.getSecurityEvents.mockClear();

    await user.clear(screen.getByLabelText('serverId'));
    await user.type(screen.getByLabelText('serverId'), 'server-1');
    await user.selectOptions(screen.getByLabelText('resolved'), 'true');
    await user.clear(screen.getByLabelText('hours'));
    await user.type(screen.getByLabelText('hours'), '24');
    await user.click(screen.getByRole('button', { name: '更新视图' }));

    await waitFor(() => {
      expect(transport.getSecurityEvents).toHaveBeenCalledWith({
        serverId: 'server-1',
        resolved: true,
        hours: 24,
      });
    });

    expect(screen.queryByRole('button', { name: '查看日志' })).toBeNull();
  });

  it('does not allow marked_safe audit events to be marked safe again', async () => {
    const transport = createMockTransport();

    transport.getSecurityEvents = vi.fn(async () => [
      createSecurityEvent({
        id: 102,
        eventType: 'marked_safe',
        resolved: false,
        details: {
          reason: '操作员已标记安全',
          targetEventId: 101,
        },
      }),
    ]);

    renderApp(transport, '/security');

    expect(await screen.findByText('已标记安全')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '标记安全 102' })).toBeNull();
    expect(transport.markSecurityEventSafe).not.toHaveBeenCalled();
  });

  it('shows "取消忽略" button for resolved events and calls unresolveSecurityEvent', async () => {
    const transport = createMockTransport();
    const user = userEvent.setup();

    transport.getSecurityEvents = vi.fn(async () => [
      createSecurityEvent({
        id: 201,
        resolved: true,
        resolvedBy: 'operator',
        resolvedAt: 1_710_000_100_000,
      }),
    ]);

    renderApp(transport, '/security');

    expect(await screen.findByRole('button', { name: '取消忽略 201' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '标记安全 201' })).toBeNull();

    transport.unresolveSecurityEvent.mockClear();
    transport.getSecurityEvents.mockClear();

    await user.click(screen.getByRole('button', { name: '取消忽略 201' }));

    await waitFor(() => {
      expect(transport.unresolveSecurityEvent).toHaveBeenCalledWith(201);
    });
  });

  it('shows resolved-by details for resolved events', async () => {
    const transport = createMockTransport();

    transport.getSecurityEvents = vi.fn(async () => [
      createSecurityEvent({
        id: 202,
        resolved: true,
        resolvedBy: 'admin-user',
        resolvedAt: 1_710_000_150_000,
      }),
    ]);

    renderApp(transport, '/security');

    expect(await screen.findByText(/admin-user/)).toBeTruthy();
  });

  it('does not show "取消忽略" button for unresolve audit events', async () => {
    const transport = createMockTransport();

    transport.getSecurityEvents = vi.fn(async () => [
      createSecurityEvent({
        id: 203,
        eventType: 'unresolve',
        resolved: true,
        resolvedBy: 'operator',
        resolvedAt: 1_710_000_200_000,
        details: { reason: 'unresolve', targetEventId: 101 },
      }),
    ]);

    renderApp(transport, '/security');

    // The unresolve audit event is visible in the history but has no action button
    expect(await screen.findByText('取消忽略')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '取消忽略 203' })).toBeNull();
  });
});