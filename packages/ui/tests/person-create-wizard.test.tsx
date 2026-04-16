import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type {
  AgentTaskQueueGroup,
  AlertEvent,
  AlertRecord,
  AppSettings,
  GpuOverviewResponse,
  GpuUsageSummaryItem,
  HookLog,
  HookRule,
  HookRuleInput,
  MetricsSnapshot,
  MirroredAgentTaskRecord,
  PersonBindingCandidate,
  PersonBindingRecord,
  PersonBindingSuggestion,
  PersonRecord,
  PersonSummaryItem,
  PersonTimelinePoint,
  ProcessAuditRow,
  SecurityEventRecord,
  ServerConfig,
  ServerInput,
  ServerPersonActivity,
  ServerStatus,
} from '@monitor/core';
import { DEFAULT_SETTINGS } from '@monitor/core';
import { PeopleManage } from '../src/pages/PeopleManage.js';
import { TransportProvider } from '../src/transport/TransportProvider.js';
import type { SecurityEventQuery, TransportAdapter } from '../src/transport/types.js';

function createWizardTransport(overrides: Partial<TransportAdapter> = {}): TransportAdapter {
  return {
    isElectron: false,
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
    addServer: vi.fn<(input: ServerInput) => Promise<ServerConfig>>(async () => ({ id: 'server-0', name: 'seed', host: 'host', port: 22, username: 'root', privateKeyPath: '', sourceType: 'ssh', createdAt: 1, updatedAt: 1 } as ServerConfig)),
    updateServer: vi.fn<(id: string, input: Partial<ServerInput>) => Promise<ServerConfig>>(async (id) => ({ id, name: 'seed', host: 'host', port: 22, username: 'root', privateKeyPath: '', sourceType: 'ssh', createdAt: 1, updatedAt: 1 } as ServerConfig)),
    deleteServer: vi.fn<(id: string) => Promise<boolean>>(async () => true),
    testConnection: vi.fn<(input: ServerInput) => Promise<{ success: boolean; error?: string }>>(async () => ({ success: true })),
    getLatestMetrics: vi.fn<(serverId: string) => Promise<MetricsSnapshot | null>>(async () => null),
    getMetricsHistory: vi.fn<(serverId: string, from: number, to: number) => Promise<MetricsSnapshot[]>>(async () => []),
    getServerStatuses: vi.fn<() => Promise<ServerStatus[]>>(async () => []),
    getHooks: vi.fn<() => Promise<HookRule[]>>(async () => []),
    createHook: vi.fn<(input: HookRuleInput) => Promise<HookRule>>(async () => { throw new Error('not implemented'); }),
    updateHook: vi.fn<(id: string, input: Partial<HookRuleInput>) => Promise<HookRule>>(async () => { throw new Error('not implemented'); }),
    deleteHook: vi.fn<(id: string) => Promise<boolean>>(async () => true),
    getHookLogs: vi.fn<(hookId: string) => Promise<HookLog[]>>(async () => []),
    testHookAction: vi.fn<(hookId: string) => Promise<{ success: boolean; result?: string; error?: string }>>(async () => ({ success: true })),
    getSettings: vi.fn<() => Promise<AppSettings>>(async () => DEFAULT_SETTINGS),
    saveSettings: vi.fn<(settings: Partial<AppSettings>) => Promise<void>>(async () => undefined),
    login: vi.fn<(password: string) => Promise<{ success: boolean; token?: string; error?: string }>>(async () => ({ success: true, token: 'token' })),
    setPassword: vi.fn<(password: string) => Promise<{ success: boolean }>>(async () => ({ success: true })),
    checkAuth: vi.fn<() => Promise<{ authenticated: boolean; needsSetup: boolean }>>(async () => ({ authenticated: true, needsSetup: false })),
    getAlerts: vi.fn<(query?: unknown) => Promise<AlertRecord[]>>(async () => []),
    suppressAlert: vi.fn<(id: string, days?: number) => Promise<void>>(async () => undefined),
    unsuppressAlert: vi.fn<(id: string) => Promise<void>>(async () => undefined),
    batchSuppressAlerts: vi.fn<(ids: string[], days?: number) => Promise<void>>(async () => undefined),
    batchUnsuppressAlerts: vi.fn<(ids: string[]) => Promise<void>>(async () => undefined),
    getTaskQueue: vi.fn<() => Promise<AgentTaskQueueGroup[]>>(async () => []),
    getProcessAudit: vi.fn<(serverId: string) => Promise<ProcessAuditRow[]>>(async () => []),
    getSecurityEvents: vi.fn<(query?: SecurityEventQuery) => Promise<SecurityEventRecord[]>>(async () => []),
    markSecurityEventSafe: vi.fn<(id: number, reason?: string) => Promise<{ resolvedEvent: SecurityEventRecord; auditEvent?: SecurityEventRecord }>>(async () => { throw new Error('not implemented'); }),
    getGpuOverview: vi.fn<() => Promise<GpuOverviewResponse>>(async () => ({ generatedAt: 1, users: [], servers: [] })),
    getGpuUsageSummary: vi.fn<(hours?: number) => Promise<GpuUsageSummaryItem[]>>(async () => []),
    getGpuUsageByUser: vi.fn(async () => []),
    cancelTask: vi.fn<(serverId: string, taskId: string) => Promise<void>>(async () => undefined),
    setTaskPriority: vi.fn<(serverId: string, taskId: string, priority: number) => Promise<void>>(async () => undefined),
    pauseQueue: vi.fn<(serverId: string) => Promise<void>>(async () => undefined),
    resumeQueue: vi.fn<(serverId: string) => Promise<void>>(async () => undefined),
    uploadKey: vi.fn<(file: File) => Promise<{ path: string }>>(async () => ({ path: '/tmp/key' })),
    getPersons: vi.fn(async () => []),
    createPerson: vi.fn(async (input: { displayName: string; email?: string; qq?: string; note?: string; customFields: Record<string, string> }) => ({
      id: 'person-new',
      displayName: input.displayName,
      email: input.email ?? '',
      qq: input.qq ?? '',
      note: input.note ?? '',
      customFields: input.customFields,
      status: 'active' as const,
      createdAt: 1,
      updatedAt: 1,
    })),
    updatePerson: vi.fn(async (id: string, input: Partial<{ displayName: string; email: string; qq: string; note: string; customFields: Record<string, string> }>) => ({
      id,
      displayName: input.displayName ?? 'Alice',
      email: input.email ?? '',
      qq: input.qq ?? '',
      note: input.note ?? '',
      customFields: input.customFields ?? {},
      status: 'active' as const,
      createdAt: 1,
      updatedAt: 2,
    })),
    getPersonBindings: vi.fn(async () => []),
    createPersonBinding: vi.fn(async (input: { personId: string; serverId: string; systemUser: string; source: string; effectiveFrom: number }) => ({
      id: `${input.serverId}-${input.systemUser}`,
      enabled: true,
      effectiveTo: null,
      createdAt: 1,
      updatedAt: 1,
      ...input,
    } as PersonBindingRecord)),
    updatePersonBinding: vi.fn(async (id: string, input: Partial<{ enabled: boolean; effectiveTo: number | null }>) => ({
      id,
      personId: 'person-old',
      serverId: 'server-3',
      systemUser: 'alice-old',
      source: 'manual',
      enabled: input.enabled ?? false,
      effectiveFrom: 1,
      effectiveTo: input.effectiveTo ?? 2,
      createdAt: 1,
      updatedAt: 2,
    } as PersonBindingRecord)),
    getPersonBindingCandidates: vi.fn<() => Promise<PersonBindingCandidate[]>>(async () => [
      { serverId: 'server-1', serverName: 'gpu-1', systemUser: 'alice', lastSeenAt: 10, activeBinding: null },
      { serverId: 'server-2', serverName: 'gpu-2', systemUser: 'alice-lab', lastSeenAt: 9, activeBinding: null },
      {
        serverId: 'server-3',
        serverName: 'gpu-3',
        systemUser: 'alice-old',
        lastSeenAt: 8,
        activeBinding: {
          bindingId: 'binding-9',
          personId: 'person-9',
          personDisplayName: 'Legacy Alice',
        },
      },
    ]),
    getPersonBindingSuggestions: vi.fn<() => Promise<PersonBindingSuggestion[]>>(async () => []),
    autoAddUnassignedPersons: vi.fn(async () => ({
      generatedAt: 1,
      summary: {
        candidateUserCount: 2,
        createdPersonCount: 1,
        reusedPersonCount: 1,
        createdBindingCount: 3,
        skippedRootCount: 0,
        skippedAmbiguousCount: 0,
        skippedAlreadyBoundCount: 0,
        failedCount: 0,
      },
      items: [
        {
          username: 'alice',
          normalizedUsername: 'alice',
          result: 'reused-person' as const,
          personId: 'person-1',
          personDisplayName: 'Alice',
          bindingCount: 2,
          bindings: [
            { serverId: 'server-1', serverName: 'gpu-1', systemUser: 'alice' },
            { serverId: 'server-2', serverName: 'gpu-2', systemUser: 'alice-lab' },
          ],
          message: '已复用同名人员并补充绑定。',
        },
        {
          username: 'carol',
          normalizedUsername: 'carol',
          result: 'created-person' as const,
          personId: 'person-2',
          personDisplayName: 'carol',
          bindingCount: 1,
          bindings: [{ serverId: 'server-3', serverName: 'gpu-3', systemUser: 'carol' }],
          message: '已创建人员并完成账号归属。',
        },
      ],
    })),
    getPersonSummary: vi.fn<() => Promise<PersonSummaryItem[]>>(async () => []),
    getPersonTimeline: vi.fn<() => Promise<PersonTimelinePoint[]>>(async () => []),
    getPersonTasks: vi.fn<() => Promise<MirroredAgentTaskRecord[]>>(async () => []),
    getServerPersonActivity: vi.fn<() => Promise<ServerPersonActivity>>(async () => ({ serverId: 'server-1', people: [], unassignedVramMB: 0, unassignedUsers: [] })),
    ...overrides,
  };
}

describe('person create wizard', () => {
  it('creates from a seed user and requires transfer confirmation before moving an existing binding', async () => {
    const user = userEvent.setup();
    const transport = createWizardTransport();

    render(
      <TransportProvider adapter={transport}>
        <MemoryRouter initialEntries={['/people/new']}>
          <Routes>
            <Route path="/people/new" element={<PeopleManage />} />
            <Route path="/people/:id" element={<div>detail page</div>} />
          </Routes>
        </MemoryRouter>
      </TransportProvider>
    );

    await user.click(await screen.findByRole('button', { name: '从服务器用户开始' }));
    await user.click(await screen.findByRole('button', { name: '选择 gpu-1 · alice' }));
    await user.click(screen.getByRole('button', { name: '下一步' }));

    await user.type(screen.getByLabelText('显示名称'), 'Alice Zhang');
    await user.click(screen.getByRole('button', { name: '下一步' }));

    await user.click(await screen.findByRole('checkbox', { name: /gpu-2 · alice-lab/i }));
    await user.click(screen.getByRole('checkbox', { name: /gpu-3 · alice-old/i }));
    await user.click(screen.getByRole('button', { name: '下一步' }));

    expect(screen.getByText(/Legacy Alice/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '创建人员' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('checkbox', { name: '我确认转移已绑定账号' }));
    await user.click(screen.getByRole('button', { name: '创建人员' }));

    await waitFor(() => {
      expect(transport.createPerson).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Alice Zhang' }));
      expect(transport.updatePersonBinding).toHaveBeenCalledWith('binding-9', expect.objectContaining({ enabled: false, effectiveTo: expect.any(Number) }));
      expect(transport.createPersonBinding).toHaveBeenCalledTimes(3);
    });

    const updateOrder = vi.mocked(transport.updatePersonBinding).mock.invocationCallOrder[0];
    const firstCreateOrder = vi.mocked(transport.createPersonBinding).mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(firstCreateOrder);

    expect(await screen.findByText('detail page')).toBeTruthy();
  });

  it('supports manual creation without bindings', async () => {
    const user = userEvent.setup();
    const transport = createWizardTransport();

    render(
      <TransportProvider adapter={transport}>
        <MemoryRouter initialEntries={['/people/new']}>
          <Routes>
            <Route path="/people/new" element={<PeopleManage />} />
            <Route path="/people/:id" element={<div>detail page</div>} />
          </Routes>
        </MemoryRouter>
      </TransportProvider>
    );

    await user.click(await screen.findByRole('button', { name: '手动创建空白人员' }));
    await user.type(screen.getByLabelText('显示名称'), 'Manual Person');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByRole('button', { name: '创建人员' }));

    await waitFor(() => {
      expect(transport.createPerson).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Manual Person' }));
      expect(transport.createPersonBinding).not.toHaveBeenCalled();
      expect(transport.updatePersonBinding).not.toHaveBeenCalled();
    });

    expect(await screen.findByText('detail page')).toBeTruthy();
  });

  it('paginates seed candidates so long lists stay manageable', async () => {
    const user = userEvent.setup();
    const transport = createWizardTransport({
      getPersonBindingCandidates: vi.fn(async () => Array.from({ length: 9 }, (_value, index) => ({
        serverId: `server-${index + 1}`,
        serverName: `gpu-${index + 1}`,
        systemUser: `user-${index + 1}`,
        lastSeenAt: 100 - index,
        activeBinding: null,
      }))),
    });

    render(
      <TransportProvider adapter={transport}>
        <MemoryRouter initialEntries={['/people/new']}>
          <Routes>
            <Route path="/people/new" element={<PeopleManage />} />
          </Routes>
        </MemoryRouter>
      </TransportProvider>
    );

    await user.click(await screen.findByRole('button', { name: '从服务器用户开始' }));

    expect(await screen.findByRole('button', { name: '选择 gpu-1 · user-1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '选择 gpu-9 · user-9' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Seed 列表下一页' }));

    expect(await screen.findByRole('button', { name: '选择 gpu-9 · user-9' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '选择 gpu-1 · user-1' })).toBeNull();
  });

  it('shows a paginated auto-add report after one-click setup', async () => {
    const user = userEvent.setup();
    const transport = createWizardTransport({
      autoAddUnassignedPersons: vi.fn(async () => ({
        generatedAt: 1,
        summary: {
          candidateUserCount: 9,
          createdPersonCount: 5,
          reusedPersonCount: 2,
          createdBindingCount: 9,
          skippedRootCount: 1,
          skippedAmbiguousCount: 1,
          skippedAlreadyBoundCount: 0,
          failedCount: 0,
        },
        items: Array.from({ length: 9 }, (_value, index) => ({
          username: `user-${index + 1}`,
          normalizedUsername: `user-${index + 1}`,
          result: index === 0 ? 'reused-person' as const : 'created-person' as const,
          personId: `person-${index + 1}`,
          personDisplayName: `user-${index + 1}`,
          bindingCount: 1,
          bindings: [{ serverId: `server-${index + 1}`, serverName: `gpu-${index + 1}`, systemUser: `user-${index + 1}` }],
          message: '已创建人员并完成账号归属。',
        })),
      })),
    });

    render(
      <TransportProvider adapter={transport}>
        <MemoryRouter initialEntries={['/people/new']}>
          <Routes>
            <Route path="/people/new" element={<PeopleManage />} />
            <Route path="/people" element={<div>people overview</div>} />
          </Routes>
        </MemoryRouter>
      </TransportProvider>
    );

    await user.click(await screen.findByRole('button', { name: '一键添加未归属用户' }));

    expect(await screen.findByRole('heading', { name: '一键添加结果' })).toBeTruthy();
    expect(screen.getByText('处理用户名数')).toBeTruthy();
    expect(screen.getAllByText('user-1').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('user-9')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: '结果报告下一页' }));

    expect((await screen.findAllByText('user-9')).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('user-1')).toHaveLength(0);
    expect(transport.autoAddUnassignedPersons).toHaveBeenCalledTimes(1);
  });
});