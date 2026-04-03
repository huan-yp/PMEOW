import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  SecurityEventRecord,
  ServerConfig,
  ServerInput,
  ServerStatus,
} from '@monitor/core';
import { DEFAULT_SETTINGS } from '@monitor/core';
import App from '../src/App.js';
import type { SecurityEventQuery, TransportAdapter } from '../src/transport/types.js';
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

function createMockTransport(overrides: Partial<TransportAdapter> = {}): TransportAdapter {
  return {
    isElectron: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMetricsUpdate: vi.fn(() => () => undefined),
    onServerStatus: vi.fn(() => () => undefined),
    onAlert: vi.fn((_cb: (alert: AlertEvent) => void) => () => undefined),
    onHookTriggered: vi.fn((_cb: (log: HookLog) => void) => () => undefined),
    onNotify: vi.fn((_cb: (title: string, body: string) => void) => () => undefined),
    onTaskUpdate: vi.fn(() => () => undefined),
    onSecurityEvent: vi.fn(() => () => undefined),
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
    getSettings: vi.fn<() => Promise<AppSettings>>(async () => DEFAULT_SETTINGS),
    saveSettings: vi.fn<(settings: Partial<AppSettings>) => Promise<void>>(async (_settings) => undefined),
    login: vi.fn<(password: string) => Promise<{ success: boolean; token?: string; error?: string }>>(async (_password) => ({ success: true, token: 'token' })),
    setPassword: vi.fn<(password: string) => Promise<{ success: boolean }>>(async (_password) => ({ success: true })),
    checkAuth: vi.fn<() => Promise<{ authenticated: boolean; needsSetup: boolean }>>(async () => ({ authenticated: false, needsSetup: false })),
    getAlerts: vi.fn<(limit?: number, offset?: number) => Promise<AlertRecord[]>>(async (_limit, _offset) => []),
    suppressAlert: vi.fn<(id: string, days?: number) => Promise<void>>(async (_id, _days) => undefined),
    getTaskQueue: vi.fn<() => Promise<AgentTaskQueueGroup[]>>(async () => []),
    getProcessAudit: vi.fn<(serverId: string) => Promise<ProcessAuditRow[]>>(async (_serverId) => []),
    getSecurityEvents: vi.fn<(query?: SecurityEventQuery) => Promise<SecurityEventRecord[]>>(async (_query) => []),
    markSecurityEventSafe: vi.fn<(id: number, reason?: string) => Promise<{ resolvedEvent: SecurityEventRecord; auditEvent?: SecurityEventRecord }>>(async (_id, _reason) => {
      throw new Error('not implemented');
    }),
    getGpuOverview: vi.fn<() => Promise<GpuOverviewResponse>>(async () => ({ generatedAt: 1_710_000_000_000, users: [], servers: [] })),
    getGpuUsageSummary: vi.fn<(hours?: number) => Promise<GpuUsageSummaryItem[]>>(async (_hours) => []),
    getGpuUsageByUser: vi.fn<(user: string, hours?: number) => Promise<GpuUsageTimelinePoint[]>>(async (_user, _hours) => []),
    cancelTask: vi.fn<(serverId: string, taskId: string) => Promise<void>>(async (_serverId, _taskId) => undefined),
    setTaskPriority: vi.fn<(serverId: string, taskId: string, priority: number) => Promise<void>>(async (_serverId, _taskId, _priority) => undefined),
    pauseQueue: vi.fn<(serverId: string) => Promise<void>>(async (_serverId) => undefined),
    resumeQueue: vi.fn<(serverId: string) => Promise<void>>(async (_serverId) => undefined),
    uploadKey: vi.fn<(file: File) => Promise<{ path: string }>>(async (_file) => ({ path: '/tmp/key' })),
    getPersonBindingCandidates: vi.fn(async () => []),
    ...overrides,
  };
}

function renderApp(transport: TransportAdapter, route = '/') {
  window.history.pushState({}, '', route);
  const AppWithAdapter = App as unknown as (props: { adapter?: TransportAdapter }) => JSX.Element;
  return render(<AppWithAdapter adapter={transport} />);
}

describe('AuthGate', () => {
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

  it('restores an existing authenticated session before rendering the app shell', async () => {
    const transport = createMockTransport({
      checkAuth: vi.fn(async () => ({ authenticated: true, needsSetup: false })),
    });

    renderApp(transport);

    expect(await screen.findByRole('heading', { name: '节点运行视图' })).toBeTruthy();
    expect(screen.queryByPlaceholderText('请输入访问口令')).toBeNull();
    await waitFor(() => {
      expect(transport.checkAuth).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps the login form hidden until the startup auth check completes', async () => {
    const deferred = createDeferred<{ authenticated: boolean; needsSetup: boolean }>();
    const transport = createMockTransport({
      checkAuth: vi.fn(async () => deferred.promise),
    });

    renderApp(transport, '/settings');

    expect((await screen.findByRole('status')).textContent).toContain('正在恢复登录状态...');
    expect(screen.queryByPlaceholderText('请输入访问口令')).toBeNull();

    deferred.resolve({ authenticated: false, needsSetup: false });

    expect(await screen.findByPlaceholderText('请输入访问口令')).toBeTruthy();
    await waitFor(() => {
      expect(transport.checkAuth).toHaveBeenCalledTimes(1);
    });
  });
});