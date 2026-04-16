import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
  MetricsHistoryResponse,
  MetricsSnapshot,
  ProcessAuditRow,
  ProcessHistoryFrame,
  ProcessReplayIndexPoint,
  SecurityEventRecord,
  ServerConfig,
  ServerInput,
  ServerStatus,
  PersonRecord,
  PersonBindingRecord,
  PersonBindingSuggestion,
  PersonSummaryItem,
  PersonTimelinePoint,
  ServerPersonActivity,
  MirroredAgentTaskRecord,
} from '@monitor/core';
import { DEFAULT_SETTINGS } from '@monitor/core';
import App from '../src/App.js';
import { useStore } from '../src/store/useStore.js';
import { TransportProvider } from '../src/transport/TransportProvider.js';
import type { SecurityEventQuery, TransportAdapter } from '../src/transport/types.js';
import { PeopleOverview } from '../src/pages/PeopleOverview.js';
import { PeopleManage } from '../src/pages/PeopleManage.js';
import { PersonDetail } from '../src/pages/PersonDetail.js';

const originalFetch = globalThis.fetch;

const basePerson: PersonRecord = {
  id: 'person-1',
  displayName: 'Alice',
  email: 'alice@example.com',
  qq: '',
  note: '',
  customFields: {},
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
};

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
    onTaskChanged: vi.fn(() => () => undefined),
    onSecurityEvent: vi.fn(() => () => undefined),
    getServers: vi.fn<() => Promise<ServerConfig[]>>(async () => []),
    addServer: vi.fn<(input: ServerInput) => Promise<ServerConfig>>(async (_input) => ({ id: 's1', name: 's', host: 'h', port: 22, username: 'u', privateKeyPath: '', sourceType: 'ssh', createdAt: 1, updatedAt: 1 }) as ServerConfig),
    updateServer: vi.fn<(id: string, input: Partial<ServerInput>) => Promise<ServerConfig>>(async (_id, _input) => ({ id: 's1', name: 's', host: 'h', port: 22, username: 'u', privateKeyPath: '', sourceType: 'ssh', createdAt: 1, updatedAt: 1 }) as ServerConfig),
    deleteServer: vi.fn<(id: string) => Promise<boolean>>(async (_id) => true),
    testConnection: vi.fn<(input: ServerInput) => Promise<{ success: boolean; error?: string }>>(async (_input) => ({ success: true })),
    getLatestMetrics: vi.fn<(serverId: string) => Promise<MetricsSnapshot | null>>(async (_serverId) => null),
    getMetricsHistory: vi.fn<(serverId: string, from: number, to: number) => Promise<MetricsSnapshot[]>>(async () => []),
    getMetricsHistoryBucketed: vi.fn<(serverId: string, from: number, to: number, bucketMs?: number) => Promise<MetricsHistoryResponse>>(async (serverId, from, to) => ({ serverId, from, to, source: 'raw', bucketMs: 60_000, buckets: [] })),
    getServerStatuses: vi.fn<() => Promise<ServerStatus[]>>(async () => []),
    getHooks: vi.fn<() => Promise<HookRule[]>>(async () => []),
    createHook: vi.fn<(input: HookRuleInput) => Promise<HookRule>>(async (_input) => { throw new Error('not implemented'); }),
    updateHook: vi.fn<(id: string, input: Partial<HookRuleInput>) => Promise<HookRule>>(async () => { throw new Error('not implemented'); }),
    deleteHook: vi.fn<(id: string) => Promise<boolean>>(async (_id) => true),
    getHookLogs: vi.fn<(hookId: string) => Promise<HookLog[]>>(async (_hookId) => []),
    testHookAction: vi.fn<(hookId: string) => Promise<{ success: boolean; result?: string; error?: string }>>(async (_hookId) => ({ success: true })),
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
    getProcessHistoryIndex: vi.fn<(serverId: string, from: number, to: number) => Promise<ProcessReplayIndexPoint[]>>(async () => []),
    getProcessHistoryFrame: vi.fn<(serverId: string, timestamp: number) => Promise<ProcessHistoryFrame>>(async (serverId, timestamp) => ({ serverId, timestamp, processes: [] })),
    getSecurityEvents: vi.fn<(query?: SecurityEventQuery) => Promise<SecurityEventRecord[]>>(async () => []),
    markSecurityEventSafe: vi.fn<(id: number, reason?: string) => Promise<{ resolvedEvent: SecurityEventRecord; auditEvent?: SecurityEventRecord }>>(async () => { throw new Error('not implemented'); }),
    unresolveSecurityEvent: vi.fn<(id: number, reason?: string) => Promise<{ reopenedEvent: SecurityEventRecord; auditEvent: SecurityEventRecord }>>(async () => { throw new Error('not implemented'); }),
    getGpuOverview: vi.fn<() => Promise<GpuOverviewResponse>>(async () => ({ generatedAt: 1, users: [], servers: [] })),
    getGpuUsageSummary: vi.fn<(hours?: number) => Promise<GpuUsageSummaryItem[]>>(async () => []),
    getGpuUsageByUser: vi.fn(async () => []),
    getGpuUsageByUserBucketed: vi.fn(async (_userName?: string, from = 0, to = 0) => ({ from, to, source: 'raw', bucketMs: 60_000, buckets: [] })),
    cancelTask: vi.fn<(serverId: string, taskId: string) => Promise<void>>(async () => undefined),
    setTaskPriority: vi.fn<(serverId: string, taskId: string, priority: number) => Promise<void>>(async () => undefined),
    pauseQueue: vi.fn<(serverId: string) => Promise<void>>(async () => undefined),
    resumeQueue: vi.fn<(serverId: string) => Promise<void>>(async () => undefined),
    uploadKey: vi.fn<(file: File) => Promise<{ path: string }>>(async () => ({ path: '/tmp/key' })),
    getPersons: vi.fn(async () => [basePerson]),
    createPerson: vi.fn(async (input: { displayName: string; email?: string; qq?: string; note?: string; customFields: Record<string, string> }) => ({ id: 'person-2', status: 'active' as const, createdAt: 2, updatedAt: 2, displayName: input.displayName, email: input.email ?? '', qq: input.qq ?? '', note: input.note ?? '', customFields: input.customFields })),
    updatePerson: vi.fn(async (id: string, input: Partial<{ displayName: string; email: string; qq: string; note: string; customFields: Record<string, string> }>) => ({ id, displayName: 'Alice', email: '', qq: '', note: '', customFields: {}, status: 'active' as const, createdAt: 1, updatedAt: 2, ...input })),
    getPersonBindings: vi.fn(async () => []),
    createPersonBinding: vi.fn(async (input: { personId: string; serverId: string; systemUser: string; source: 'manual' | 'suggested' | 'synced'; effectiveFrom: number }) => ({ id: 'binding-1', enabled: true, effectiveTo: null, createdAt: 1, updatedAt: 1, ...input })),
    updatePersonBinding: vi.fn(async (id: string, input: Partial<{ enabled: boolean; effectiveTo: number | null }>) => ({ id, personId: 'person-1', serverId: 'server-1', systemUser: 'alice', source: 'manual' as const, enabled: true, effectiveFrom: 1, effectiveTo: null, createdAt: 1, updatedAt: 2, ...input })),
    getPersonBindingCandidates: vi.fn(async () => []),
    getPersonBindingSuggestions: vi.fn(async () => []),
    getPersonSummary: vi.fn(async () => [{ personId: 'person-1', displayName: 'Alice', currentVramMB: 4096, runningTaskCount: 1, queuedTaskCount: 0, activeServerCount: 1, lastActivityAt: Date.now(), vramOccupancyHours: 2, vramGigabyteHours: 8, taskRuntimeHours: 1.5 }]),
    getPersonTimeline: vi.fn(async () => []),
    getPersonTasks: vi.fn(async () => []),
    getServerPersonActivity: vi.fn(async () => ({ serverId: 'server-1', people: [], unassignedVramMB: 0, unassignedUsers: [] })),
    getResolvedGpuAllocation: vi.fn(async () => null),
    ...overrides,
  ...overrides,
  };
}

function renderApp(transport: TransportAdapter, route: string) {
  window.history.pushState({}, '', route);
  const AppWithAdapter = App as unknown as (props: { adapter?: TransportAdapter }) => JSX.Element;
  return render(<AppWithAdapter adapter={transport} />);
}

describe('person pages', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
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

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders a browse-first people landing page from the person directory and merged summary data', async () => {
    const transport = createMockTransport({
      getPersons: vi.fn(async () => [
        basePerson,
        {
          ...basePerson,
          id: 'person-2',
          displayName: 'Bob',
          email: 'bob@example.com',
          createdAt: 2,
          updatedAt: 2,
        },
      ]),
      getPersonSummary: vi.fn(async () => [
        { personId: 'person-1', displayName: 'Alice', currentVramMB: 4096, runningTaskCount: 1, queuedTaskCount: 0, activeServerCount: 1, lastActivityAt: Date.now(), vramOccupancyHours: 2, vramGigabyteHours: 8, taskRuntimeHours: 1.5 },
        { personId: 'person-2', displayName: 'Bob', currentVramMB: 0, runningTaskCount: 0, queuedTaskCount: 1, activeServerCount: 1, lastActivityAt: Date.now(), vramOccupancyHours: 0, vramGigabyteHours: 0, taskRuntimeHours: 0 },
      ]),
    });

    render(
      <TransportProvider adapter={transport}>
        <MemoryRouter initialEntries={['/people']}>
          <Routes>
            <Route path="/people" element={<PeopleOverview />} />
          </Routes>
        </MemoryRouter>
      </TransportProvider>
    );

    expect(await screen.findByRole('heading', { name: '人员' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '添加人员' }).getAttribute('href')).toBe('/people/new');
    expect(await screen.findByText('Alice')).toBeTruthy();
    expect(await screen.findByText('Bob')).toBeTruthy();
    expect(await screen.findByText(/4.0 GB/)).toBeTruthy();
    expect(screen.queryByPlaceholderText('显示名称')).toBeNull();
    expect(screen.queryByText('绑定建议')).toBeNull();
    await waitFor(() => {
      expect(transport.getPersons).toHaveBeenCalledTimes(1);
      expect(transport.getPersonSummary).toHaveBeenCalledTimes(1);
    });
  });

  it('renders the people list before summary stats finish loading', async () => {
    const personsDeferred = createDeferred<PersonRecord[]>();
    const summaryDeferred = createDeferred<PersonSummaryItem[]>();
    const transport = createMockTransport({
      getPersons: vi.fn(() => personsDeferred.promise),
      getPersonSummary: vi.fn(() => summaryDeferred.promise),
    });

    render(
      <TransportProvider adapter={transport}>
        <MemoryRouter initialEntries={['/people']}>
          <Routes>
            <Route path="/people" element={<PeopleOverview />} />
          </Routes>
        </MemoryRouter>
      </TransportProvider>
    );

    expect(await screen.findByRole('heading', { name: '人员' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '人员加载中' })).toBeTruthy();
    expect(screen.queryByText('还没有人员')).toBeNull();
    expect(transport.getPersonSummary).not.toHaveBeenCalled();

    await act(async () => {
      personsDeferred.resolve([basePerson]);
      await personsDeferred.promise;
    });

    expect(await screen.findByText('Alice')).toBeTruthy();
    expect(screen.queryByRole('status', { name: '人员加载中' })).toBeNull();
    expect(screen.getByText('统计加载中...')).toBeTruthy();
    expect(screen.queryByText(/4.0 GB/)).toBeNull();
    expect(transport.getPersonSummary).toHaveBeenCalledTimes(1);

    await act(async () => {
      summaryDeferred.resolve([
        {
          personId: 'person-1',
          displayName: 'Alice',
          currentVramMB: 4096,
          runningTaskCount: 1,
          queuedTaskCount: 0,
          activeServerCount: 1,
          lastActivityAt: Date.now(),
          vramOccupancyHours: 2,
          vramGigabyteHours: 8,
          taskRuntimeHours: 1.5,
        },
      ]);
      await summaryDeferred.promise;
    });

    expect(await screen.findByText(/4.0 GB/)).toBeTruthy();
    expect(screen.queryByText('统计加载中...')).toBeNull();
  });

  it('renders an empty-state CTA that enters the creation flow', async () => {
    const transport = createMockTransport({ getPersons: vi.fn(async () => []), getPersonSummary: vi.fn(async () => []) });

    render(
      <TransportProvider adapter={transport}>
        <MemoryRouter initialEntries={['/people']}>
          <Routes>
            <Route path="/people" element={<PeopleOverview />} />
          </Routes>
        </MemoryRouter>
      </TransportProvider>
    );

    expect(await screen.findByText('还没有人员')).toBeTruthy();
    expect(screen.getByRole('link', { name: '开始添加' }).getAttribute('href')).toBe('/people/new');
    expect(transport.getPersonSummary).not.toHaveBeenCalled();
  });

  it('redirects the legacy manage route to /people/new', async () => {
    renderApp(
      createMockTransport({
        checkAuth: vi.fn(async () => ({ authenticated: true, needsSetup: false })),
      }),
      '/people/manage'
    );

    expect(await screen.findByRole('heading', { name: '添加人员' })).toBeTruthy();
    await waitFor(() => {
      expect(window.location.pathname).toBe('/people/new');
    });
  });

  it('renders the guided people creation page at /people/new with a single people nav entry', async () => {
    renderApp(
      createMockTransport({
        checkAuth: vi.fn(async () => ({ authenticated: true, needsSetup: false })),
      }),
      '/people/new'
    );

    expect(await screen.findByRole('heading', { name: '添加人员' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: '从服务器用户开始' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '手动创建空白人员' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '一键添加未归属用户' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '人员' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('link', { name: '人员管理' })).toBeNull();
  });

  it('renders person creation wizard directly', async () => {
    render(
      <TransportProvider adapter={createMockTransport()}>
        <MemoryRouter initialEntries={['/people/manage']}>
          <Routes>
            <Route path="/people/manage" element={<PeopleManage />} />
          </Routes>
        </MemoryRouter>
      </TransportProvider>
    );
    expect(await screen.findByText('添加人员')).toBeTruthy();
    expect(await screen.findByRole('button', { name: '从服务器用户开始' })).toBeTruthy();
  });

  it('renders person detail page', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);

      if (requestUrl.includes('/node-distribution')) {
        return new Response(JSON.stringify([
          {
            serverId: 'server-2',
            serverName: 'Beta Node',
            avgVramMB: 3072,
            maxVramMB: 4096,
            sampleCount: 1,
            gpus: [
              { gpuIndex: 0, avgVramMB: 3072, maxVramMB: 4096, sampleCount: 1 },
            ],
          },
          {
            serverId: 'server-1',
            serverName: 'Alpha Node',
            avgVramMB: 6144,
            maxVramMB: 10240,
            sampleCount: 2,
            gpus: [
              { gpuIndex: 0, avgVramMB: 2048, maxVramMB: 4096, sampleCount: 1 },
              { gpuIndex: 1, avgVramMB: 4096, maxVramMB: 6144, sampleCount: 1 },
            ],
          },
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (requestUrl.includes('/peak-periods')) {
        return new Response(JSON.stringify([
          { bucketStart: 1_710_000_000_000, totalVramMB: 8192 },
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (requestUrl.includes('/mobile-token/status')) {
        return new Response(JSON.stringify({ hasToken: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const transport = createMockTransport({
      getPersonTimeline: vi.fn(async () => [{
        bucketStart: 1_710_000_000_000,
        personId: 'person-1',
        totalVramMB: 3584,
        taskVramMB: 2048,
        nonTaskVramMB: 1536,
      }]),
    });

    render(
      <TransportProvider adapter={transport}>
        <MemoryRouter initialEntries={['/people/person-1']}>
          <Routes>
            <Route path="/people/:id" element={<PersonDetail />} />
          </Routes>
        </MemoryRouter>
      </TransportProvider>
    );
    expect(await screen.findByText('Alice')).toBeTruthy();
    expect(await screen.findByText('3.5 GB')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Alpha Node/ })).toBeTruthy();
    expect(screen.queryByText('GPU 0')).toBeNull();

    await act(async () => {
      screen.getByRole('button', { name: /Alpha Node/ }).click();
    });

    expect(await screen.findByText('GPU 0')).toBeTruthy();
    expect(screen.getByText('GPU 1')).toBeTruthy();
  });

  describe('active filter', () => {
    const activePerson: PersonRecord = { ...basePerson, id: 'active-1', displayName: 'Active Alice' };
    const inactivePerson: PersonRecord = { ...basePerson, id: 'inactive-1', displayName: 'Inactive Bob', email: 'bob@example.com' };

    const activeSummary: PersonSummaryItem = {
      personId: 'active-1', displayName: 'Active Alice',
      currentVramMB: 4096, runningTaskCount: 1, queuedTaskCount: 0,
      activeServerCount: 1, lastActivityAt: Date.now(),
      vramOccupancyHours: 2, vramGigabyteHours: 8, taskRuntimeHours: 1.5,
    };

    const inactiveSummary: PersonSummaryItem = {
      personId: 'inactive-1', displayName: 'Inactive Bob',
      currentVramMB: 0, runningTaskCount: 0, queuedTaskCount: 0,
      activeServerCount: 0, lastActivityAt: 0,
      vramOccupancyHours: 0, vramGigabyteHours: 0, taskRuntimeHours: 0,
    };

    function renderPeopleOverview(transport: TransportAdapter) {
      return render(
        <TransportProvider adapter={transport}>
          <MemoryRouter initialEntries={['/people']}>
            <Routes>
              <Route path="/people" element={<PeopleOverview />} />
            </Routes>
          </MemoryRouter>
        </TransportProvider>
      );
    }

    it('defaults to showing only active people once summary data is available', async () => {
      const transport = createMockTransport({
        getPersons: vi.fn(async () => [activePerson, inactivePerson]),
        getPersonSummary: vi.fn(async () => [activeSummary, inactiveSummary]),
      });

      renderPeopleOverview(transport);

      expect(await screen.findByText('Active Alice')).toBeTruthy();
      await waitFor(() => {
        expect(screen.queryByText('Inactive Bob')).toBeNull();
      });
      expect(screen.getByRole('button', { name: '当前活跃' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '全部' })).toBeTruthy();
    });

    it('switches to all to restore the complete directory list', async () => {
      const transport = createMockTransport({
        getPersons: vi.fn(async () => [activePerson, inactivePerson]),
        getPersonSummary: vi.fn(async () => [activeSummary, inactiveSummary]),
      });

      renderPeopleOverview(transport);

      expect(await screen.findByText('Active Alice')).toBeTruthy();
      await waitFor(() => {
        expect(screen.queryByText('Inactive Bob')).toBeNull();
      });

      await act(async () => {
        screen.getByRole('button', { name: '全部' }).click();
      });

      expect(screen.getByText('Active Alice')).toBeTruthy();
      expect(screen.getByText('Inactive Bob')).toBeTruthy();
    });

    it('includes a person with any single activity signal in currently active', async () => {
      const vramOnlyPerson: PersonRecord = { ...basePerson, id: 'vram-only', displayName: 'VRAM Only' };
      const queuedOnlyPerson: PersonRecord = { ...basePerson, id: 'queued-only', displayName: 'Queued Only' };
      const serverOnlyPerson: PersonRecord = { ...basePerson, id: 'server-only', displayName: 'Server Only' };

      const transport = createMockTransport({
        getPersons: vi.fn(async () => [vramOnlyPerson, queuedOnlyPerson, serverOnlyPerson]),
        getPersonSummary: vi.fn(async () => [
          { ...inactiveSummary, personId: 'vram-only', displayName: 'VRAM Only', currentVramMB: 1024 },
          { ...inactiveSummary, personId: 'queued-only', displayName: 'Queued Only', queuedTaskCount: 2 },
          { ...inactiveSummary, personId: 'server-only', displayName: 'Server Only', activeServerCount: 1 },
        ]),
      });

      renderPeopleOverview(transport);

      expect(await screen.findByText('VRAM Only')).toBeTruthy();
      expect(screen.getByText('Queued Only')).toBeTruthy();
      expect(screen.getByText('Server Only')).toBeTruthy();
    });

    it('excludes a person with all four signals at zero from currently active', async () => {
      const transport = createMockTransport({
        getPersons: vi.fn(async () => [inactivePerson]),
        getPersonSummary: vi.fn(async () => [inactiveSummary]),
      });

      renderPeopleOverview(transport);

      await waitFor(() => {
        expect(screen.queryByText('Inactive Bob')).toBeNull();
      });
      expect(screen.getByText('当前没有活跃人员')).toBeTruthy();
    });

    it('shows filter-specific empty state when summary loading fails', async () => {
      const transport = createMockTransport({
        getPersons: vi.fn(async () => [inactivePerson]),
        getPersonSummary: vi.fn(async () => { throw new Error('network error'); }),
      });

      renderPeopleOverview(transport);

      // Summary fails → falls back to empty summary → all metrics are zero → no active people
      await waitFor(() => {
        expect(screen.getByText('当前没有活跃人员')).toBeTruthy();
      });
      expect(screen.getByRole('button', { name: '查看全部人员' })).toBeTruthy();
    });

    it('shows the no-people empty state when there are no person records at all', async () => {
      const transport = createMockTransport({
        getPersons: vi.fn(async () => []),
        getPersonSummary: vi.fn(async () => []),
      });

      renderPeopleOverview(transport);

      expect(await screen.findByText('还没有人员')).toBeTruthy();
      expect(screen.queryByText('当前没有活跃人员')).toBeNull();
    });
  });
});
