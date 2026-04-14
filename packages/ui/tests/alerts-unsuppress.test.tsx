import { render, screen, waitFor } from '@testing-library/react';
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
    onTaskUpdate: vi.fn(() => () => undefined),
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
    unresolveSecurityEvent: vi.fn<(id: number, reason?: string) => Promise<{ reopenedEvent: SecurityEventRecord; auditEvent: SecurityEventRecord }>>(async (id, _reason) => { throw new Error('not implemented'); }),
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

describe('alerts unsuppress', () => {
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

  it('suppressed alerts show a "取消忽略" button and call unsuppressAlert when clicked', async () => {
    const transport = createMockTransport();
    const user = userEvent.setup();

    const futureTime = Date.now() + 7 * 24 * 60 * 60 * 1000;
    transport.getAlerts = vi.fn(async () => [
      createAlertRecord({
        id: 'alert-sup-1',
        suppressedUntil: futureTime,
      }),
    ]);

    renderApp(transport, '/alerts');

    expect(await screen.findByRole('button', { name: '取消忽略 alert-sup-1' })).toBeTruthy();
    expect(screen.queryByText('1天')).toBeNull();

    transport.unsuppressAlert.mockClear();

    await user.click(screen.getByRole('button', { name: '取消忽略 alert-sup-1' }));

    await waitFor(() => {
      expect(transport.unsuppressAlert).toHaveBeenCalledWith('alert-sup-1');
    });
  });

  it('active alerts do not show "取消忽略" button but show suppress day buttons', async () => {
    const transport = createMockTransport();

    transport.getAlerts = vi.fn(async () => [
      createAlertRecord({
        id: 'alert-active-1',
        suppressedUntil: null,
      }),
    ]);

    renderApp(transport, '/alerts');

    await screen.findByText('活跃');
    expect(screen.queryByRole('button', { name: '取消忽略 alert-active-1' })).toBeNull();
    expect(screen.getByRole('button', { name: '1天' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '7天' })).toBeTruthy();
  });

  it('expired suppressedUntil alerts show suppress buttons, not "取消忽略"', async () => {
    const transport = createMockTransport();

    transport.getAlerts = vi.fn(async () => [
      createAlertRecord({
        id: 'alert-expired-1',
        suppressedUntil: 1_000, // far in the past
      }),
    ]);

    renderApp(transport, '/alerts');

    await screen.findByText('活跃');
    expect(screen.queryByRole('button', { name: '取消忽略 alert-expired-1' })).toBeNull();
  });
});
