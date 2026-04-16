import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import type { AlertQuery, SecurityEventQuery, TransportAdapter } from '../src/transport/types.js';
import { useStore } from '../src/store/useStore.js';

function createAlertRecord(overrides: Partial<AlertRecord> = {}): AlertRecord {
  return {
    id: 'alert-1',
    serverId: 'server-1',
    serverName: 'gpu-agent-01',
    metric: 'cpu_usage',
    value: 95.5,
    threshold: 90,
    timestamp: 1_710_000_000_000,
    suppressedUntil: null,
    ...overrides,
  };
}

function createMockTransport() {
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
    getServers: vi.fn<() => Promise<ServerConfig[]>>(async () => []),
    addServer: vi.fn<(input: ServerInput) => Promise<ServerConfig>>(async (_input) => { throw new Error('not implemented'); }),
    updateServer: vi.fn<(id: string, input: Partial<ServerInput>) => Promise<ServerConfig>>(async (_id, _input) => { throw new Error('not implemented'); }),
    deleteServer: vi.fn<(id: string) => Promise<boolean>>(async (_id) => true),
    testConnection: vi.fn<(input: ServerInput) => Promise<{ success: boolean; error?: string }>>(async (_input) => ({ success: true })),
    getLatestMetrics: vi.fn<(serverId: string) => Promise<MetricsSnapshot | null>>(async (_serverId) => null),
    getMetricsHistory: vi.fn<(serverId: string, from: number, to: number) => Promise<MetricsSnapshot[]>>(async (_serverId, _from, _to) => []),
    getServerStatuses: vi.fn<() => Promise<ServerStatus[]>>(async () => []),
    getHooks: vi.fn<() => Promise<HookRule[]>>(async () => []),
    createHook: vi.fn<(input: HookRuleInput) => Promise<HookRule>>(async (_input) => { throw new Error('not implemented'); }),
    updateHook: vi.fn<(id: string, input: Partial<HookRuleInput>) => Promise<HookRule>>(async (_id, _input) => { throw new Error('not implemented'); }),
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
    getTaskQueue: vi.fn<() => Promise<AgentTaskQueueGroup[]>>(async () => []),
    getProcessAudit: vi.fn<(serverId: string) => Promise<ProcessAuditRow[]>>(async (_serverId) => []),
    getSecurityEvents: vi.fn<(query?: SecurityEventQuery) => Promise<SecurityEventRecord[]>>(async (_query) => []),
    markSecurityEventSafe: vi.fn<(id: number, reason?: string) => Promise<{ resolvedEvent: SecurityEventRecord; auditEvent?: SecurityEventRecord }>>(async (id, _reason) => ({ resolvedEvent: { id, serverId: 's', eventType: 'suspicious_process', fingerprint: 'fp', details: { reason: '' }, resolved: true, resolvedBy: 'op', createdAt: 1, resolvedAt: 1 } })),
    unresolveSecurityEvent: vi.fn<(id: number, reason?: string) => Promise<{ reopenedEvent: SecurityEventRecord; auditEvent: SecurityEventRecord }>>(async (_id, _reason) => { throw new Error('not implemented'); }),
    getGpuOverview: vi.fn<() => Promise<GpuOverviewResponse>>(async () => ({ generatedAt: 1, users: [], servers: [] })),
    getGpuUsageSummary: vi.fn<(hours?: number) => Promise<GpuUsageSummaryItem[]>>(async (_hours) => []),
    getGpuUsageByUser: vi.fn<(user: string, hours?: number) => Promise<GpuUsageTimelinePoint[]>>(async (_user, _hours) => []),
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

describe('alerts page', () => {
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

  it('switching to "已忽略" tab calls getAlerts with suppressed=true', async () => {
    const transport = createMockTransport();
    const user = userEvent.setup();

    renderApp(transport, '/alerts');

    expect(await screen.findByRole('button', { name: '已忽略' })).toBeTruthy();

    transport.getAlerts.mockClear();

    await user.click(screen.getByRole('button', { name: '已忽略' }));

    await waitFor(() => {
      expect(transport.getAlerts).toHaveBeenCalledWith(
        expect.objectContaining({ suppressed: true }),
      );
    });
  });

  it('switching to "活跃" tab calls getAlerts with suppressed=false', async () => {
    const transport = createMockTransport();
    const user = userEvent.setup();

    renderApp(transport, '/alerts');
    await screen.findByRole('button', { name: '全部' });

    transport.getAlerts.mockClear();

    await user.click(screen.getByRole('button', { name: '活跃' }));

    await waitFor(() => {
      expect(transport.getAlerts).toHaveBeenCalledWith(
        expect.objectContaining({ suppressed: false }),
      );
    });
  });

  it('search filters rows by serverName or metric', async () => {
    const transport = createMockTransport();
    const user = userEvent.setup();

    transport.getAlerts = vi.fn(async () => [
      createAlertRecord({ id: 'a-1', serverName: 'node-gpu-01', metric: 'cpu_usage' }),
      createAlertRecord({ id: 'a-2', serverName: 'node-gpu-02', metric: 'memory_usage' }),
    ]);

    renderApp(transport, '/alerts');

    expect(await screen.findByText('node-gpu-01')).toBeTruthy();
    expect(screen.getByText('node-gpu-02')).toBeTruthy();

    await user.type(screen.getByLabelText('search'), 'memory');

    await waitFor(() => {
      expect(screen.queryByText('node-gpu-01')).toBeNull();
      expect(screen.getByText('node-gpu-02')).toBeTruthy();
    });
  });

  it('checkbox selects a row and header checkbox selects all', async () => {
    const transport = createMockTransport();
    const user = userEvent.setup();

    transport.getAlerts = vi.fn(async () => [
      createAlertRecord({ id: 'chk-1', serverName: 'n1', metric: 'cpu_usage' }),
      createAlertRecord({ id: 'chk-2', serverName: 'n2', metric: 'mem_usage' }),
    ]);

    renderApp(transport, '/alerts');

    await screen.findByText('n1');

    const rowCheckbox = screen.getByLabelText('选择 chk-1');
    await user.click(rowCheckbox);
    expect((rowCheckbox as HTMLInputElement).checked).toBe(true);

    // Batch bar appears
    expect(await screen.findByText(/已选 1 条/)).toBeTruthy();

    // Header select-all
    const allCheckbox = screen.getByLabelText('全选');
    await user.click(allCheckbox);
    expect((screen.getByLabelText('选择 chk-2') as HTMLInputElement).checked).toBe(true);
    expect(await screen.findByText(/已选 2 条/)).toBeTruthy();
  });

  it('batch suppress calls batchSuppressAlerts with selected ids', async () => {
    const transport = createMockTransport();
    const user = userEvent.setup();

    transport.getAlerts = vi.fn(async () => [
      createAlertRecord({ id: 'bs-1', serverName: 'node-bs-1', metric: 'cpu_usage' }),
      createAlertRecord({ id: 'bs-2', serverName: 'node-bs-2', metric: 'mem_usage' }),
    ]);

    renderApp(transport, '/alerts');

    await screen.findByText('node-bs-1');

    // Select both rows via header checkbox
    await user.click(screen.getByLabelText('全选'));

    expect(await screen.findByText(/已选 2 条/)).toBeTruthy();

    transport.batchSuppressAlerts.mockClear();
    // Click the "7天" button in the batch action bar (first one in DOM)
    const dayButtons = screen.getAllByRole('button', { name: '7天' });
    await user.click(dayButtons[0]);

    await waitFor(() => {
      expect(transport.batchSuppressAlerts).toHaveBeenCalledWith(
        expect.arrayContaining(['bs-1', 'bs-2']),
        7,
      );
    });
  });

  it('batch unsuppress calls batchUnsuppressAlerts with selected ids', async () => {
    const transport = createMockTransport();
    const user = userEvent.setup();

    const futureTime = Date.now() + 7 * 24 * 60 * 60 * 1000;
    transport.getAlerts = vi.fn(async () => [
      createAlertRecord({ id: 'bu-1', serverName: 'n', metric: 'cpu_usage', suppressedUntil: futureTime }),
    ]);

    renderApp(transport, '/alerts');

    await screen.findByText('n');

    await user.click(screen.getByLabelText('选择 bu-1'));
    expect(await screen.findByText(/已选 1 条/)).toBeTruthy();

    transport.batchUnsuppressAlerts.mockClear();
    await user.click(screen.getByRole('button', { name: '批量取消忽略' }));

    await waitFor(() => {
      expect(transport.batchUnsuppressAlerts).toHaveBeenCalledWith(['bu-1']);
    });
  });

  it('registers onAlert subscription on mount', async () => {
    const transport = createMockTransport();

    renderApp(transport, '/alerts');

    await screen.findByText('暂无告警记录');

    // onAlert subscription was registered during mount
    expect(transport.onAlert).toHaveBeenCalled();
  });
});
