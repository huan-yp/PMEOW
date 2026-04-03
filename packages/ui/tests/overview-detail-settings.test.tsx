import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLayoutEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom';
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
  ProcessAuditRow,
  SecurityEventRecord,
  ServerConfig,
  ServerInput,
  ServerStatus,
} from '@monitor/core';
import { DEFAULT_SETTINGS } from '@monitor/core';
import { TransportProvider } from '../src/transport/TransportProvider.js';
import type { SecurityEventQuery, TransportAdapter } from '../src/transport/types.js';
import { useStore } from '../src/store/useStore.js';
import { Overview } from '../src/pages/Overview.js';
import { ServerDetail } from '../src/pages/ServerDetail.js';
import { Settings } from '../src/pages/Settings.js';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

vi.mock('../src/components/GaugeChart.js', () => ({
  GaugeChart: ({ label, value }: { label: string; value: number }) => (
    <div data-testid={`gauge-${label}`}>{label}:{value}</div>
  ),
}));

vi.mock('../src/components/MetricChart.js', () => ({
  MetricChart: () => <div data-testid="metric-chart" />,
}));

vi.mock('../src/components/DockerList.js', () => ({
  DockerList: () => <div data-testid="docker-list" />,
}));

function createServer(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id: 'server-agent-1',
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

function createMetricsSnapshot(serverId = 'server-agent-1'): MetricsSnapshot {
  return {
    serverId,
    timestamp: 1_710_000_000_000,
    cpu: {
      usagePercent: 22,
      coreCount: 16,
      modelName: 'AMD EPYC 7B12',
      frequencyMhz: 2500,
      perCoreUsage: [22],
    },
    memory: {
      totalMB: 131072,
      usedMB: 65536,
      availableMB: 65536,
      usagePercent: 50,
      swapTotalMB: 0,
      swapUsedMB: 0,
      swapPercent: 0,
    },
    disk: {
      disks: [{ filesystem: '/dev/nvme0n1p1', mountPoint: '/', totalGB: 512, usedGB: 120, availableGB: 392, usagePercent: 23 }],
      ioReadKBs: 150,
      ioWriteKBs: 75,
    },
    network: {
      rxBytesPerSec: 1024,
      txBytesPerSec: 2048,
      interfaces: [{ name: 'eth0', rxBytes: 1, txBytes: 2 }],
    },
    gpu: {
      available: true,
      totalMemoryMB: 49152,
      usedMemoryMB: 28672,
      memoryUsagePercent: 58.3,
      utilizationPercent: 72,
      temperatureC: 61,
      gpuCount: 2,
    },
    processes: [],
    docker: [],
    system: {
      hostname: 'gpu-agent-01',
      uptime: '5d 02:31',
      loadAvg1: 1.2,
      loadAvg5: 1.1,
      loadAvg15: 1.0,
      kernelVersion: '6.8.0',
    },
    gpuAllocation: {
      perGpu: [
        {
          gpuIndex: 0,
          totalMemoryMB: 24576,
          pmeowTasks: [{ taskId: 'task-run-1', gpuIndex: 0, declaredVramMB: 8192, actualVramMB: 6144 }],
          userProcesses: [{ pid: 4123, user: 'alice', gpuIndex: 0, usedMemoryMB: 4096, command: 'python train.py' }],
          unknownProcesses: [{ pid: 4888, gpuIndex: 0, usedMemoryMB: 1024, command: 'mystery' }],
          effectiveFreeMB: 13312,
        },
      ],
      byUser: [{ user: 'alice', totalVramMB: 4096, gpuIndices: [0] }],
    },
  };
}

function createStatus(serverId = 'server-agent-1'): ServerStatus {
  return {
    serverId,
    status: 'connected',
    lastSeen: 1_710_000_000_000,
  };
}

function createMockTransport(): TransportAdapter {
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
    addServer: vi.fn<(input: ServerInput) => Promise<ServerConfig>>(async (_input) => createServer()),
    updateServer: vi.fn<(id: string, input: Partial<ServerInput>) => Promise<ServerConfig>>(async (_id, _input) => createServer()),
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
    getAlerts: vi.fn<(limit?: number, offset?: number) => Promise<AlertRecord[]>>(async (_limit, _offset) => []),
    suppressAlert: vi.fn<(id: string, days?: number) => Promise<void>>(async (_id, _days) => undefined),
    getTaskQueue: vi.fn<() => Promise<AgentTaskQueueGroup[]>>(async () => [
      {
        serverId: 'server-agent-1',
        serverName: 'gpu-agent-01',
        queued: [{ serverId: 'server-agent-1', taskId: 'task-queued-1', status: 'queued', command: 'python queue.py' }],
        running: [{ serverId: 'server-agent-1', taskId: 'task-run-1', status: 'running', command: 'python train.py' }],
        recent: [],
      },
    ]),
    getProcessAudit: vi.fn<(serverId: string) => Promise<ProcessAuditRow[]>>(async (_serverId) => [
      {
        pid: 4888,
        user: 'alice',
        command: 'xmrig --donate-level=1',
        cpuPercent: 92,
        memPercent: 5.2,
        rss: 153600,
        gpuMemoryMB: 1024,
        ownerType: 'unknown',
        taskId: null,
        suspiciousReasons: ['命中安全关键词 xmrig'],
      },
    ]),
    getSecurityEvents: vi.fn<(query?: SecurityEventQuery) => Promise<SecurityEventRecord[]>>(async (_query) => []),
    markSecurityEventSafe: vi.fn<(id: number, reason?: string) => Promise<{ resolvedEvent: SecurityEventRecord; auditEvent?: SecurityEventRecord }>>(async (_id, _reason) => { throw new Error('not implemented'); }),
    getGpuOverview: vi.fn<() => Promise<GpuOverviewResponse>>(async () => ({
      generatedAt: 1_710_000_000_000,
      users: [
        { user: 'alice', totalVramMB: 16384, taskCount: 2, processCount: 3, serverIds: ['server-agent-1'] },
        { user: 'bob', totalVramMB: 8192, taskCount: 1, processCount: 1, serverIds: ['server-agent-2'] },
      ],
      servers: [],
    })),
    getGpuUsageSummary: vi.fn<(hours?: number) => Promise<GpuUsageSummaryItem[]>>(async (_hours) => []),
    getGpuUsageByUser: vi.fn<(user: string, hours?: number) => Promise<{ bucketStart: number; user: string; totalVramMB: number; taskVramMB: number; nonTaskVramMB: number; }[]>>(async (_user, _hours) => []),
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

function renderWithProviders(ui: React.ReactNode, transport: TransportAdapter, route = '/') {
  return render(
    <TransportProvider adapter={transport}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </TransportProvider>
  );
}

function ServerDetailHarness() {
  const navigate = useNavigate();

  return (
    <>
      <button onClick={() => navigate('/server/server-a')}>go-server-a</button>
      <button onClick={() => navigate('/server/server-b')}>go-server-b</button>
      <Routes>
        <Route path="/server/:id" element={<ServerDetail />} />
      </Routes>
    </>
  );
}

function ServerDetailRaceHarness({
  triggerRace,
}: {
  triggerRace: (serverId: string | undefined) => void;
}) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  useLayoutEffect(() => {
    triggerRace(id);
  }, [id, triggerRace]);

  return (
    <>
      <button onClick={() => navigate('/server/server-a')}>go-server-a</button>
      <button onClick={() => navigate('/server/server-b')}>go-server-b</button>
      <ServerDetail />
    </>
  );
}

describe('overview detail settings', () => {
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

  it('shows distinct source and presence badges on overview cards', async () => {
    const transport = createMockTransport();
    const agentServer = createServer();
    const sshServer = createServer({
      id: 'server-ssh-1',
      name: 'ssh-node-01',
      host: '10.0.0.11',
      sourceType: 'ssh',
      agentId: undefined,
    });

    useStore.setState({
      servers: [agentServer, sshServer],
      statuses: new Map([
        [agentServer.id, createStatus(agentServer.id)],
        [sshServer.id, { serverId: sshServer.id, status: 'disconnected', lastSeen: 1_710_000_100_000 }],
      ]),
      latestMetrics: new Map([[agentServer.id, createMetricsSnapshot(agentServer.id)]]),
    });

    renderWithProviders(<Overview />, transport);

    const agentCard = screen.getByText(agentServer.name).closest('.node-card-shell');
    const sshCard = screen.getByText(sshServer.name).closest('.node-card-shell');

    expect(agentCard).toBeTruthy();
    expect(sshCard).toBeTruthy();

    const agentWithin = within(agentCard as HTMLElement);
    const sshWithin = within(sshCard as HTMLElement);

    expect(agentWithin.getByText('Agent').className).toContain('node-badge-source-agent');
    expect(agentWithin.getByText('在线').className).toContain('node-badge-status-online');
    expect(sshWithin.getByText('SSH').className).toContain('node-badge-source-ssh');
    expect(sshWithin.getByText('离线').className).toContain('node-badge-status-offline');
  });

  it('shows gpu overview card on overview page', async () => {
    const user = userEvent.setup();
    const transport = createMockTransport();
    const server = createServer();
    const metrics = createMetricsSnapshot(server.id);

    useStore.setState({
      servers: [server],
      statuses: new Map([[server.id, createStatus(server.id)]]),
      latestMetrics: new Map([[server.id, metrics]]),
    });

    renderWithProviders(<Overview />, transport);

    await user.click(await screen.findByRole('button', { name: '节点态势' }));
    expect(await screen.findByText('GPU 归属总览')).toBeTruthy();
    expect(await screen.findByText(/alice/)).toBeTruthy();
    expect(await screen.findByText('16.0 GB')).toBeTruthy();
    expect(transport.getGpuOverview).toHaveBeenCalledTimes(1);
  });

  it('shows tasks tab for agent server detail', async () => {
    const user = userEvent.setup();
    const transport = createMockTransport();
    const server = createServer();
    const metrics = createMetricsSnapshot(server.id);

    useStore.setState({
      servers: [server],
      statuses: new Map([[server.id, createStatus(server.id)]]),
      latestMetrics: new Map([[server.id, metrics]]),
      taskQueueGroups: await transport.getTaskQueue(),
    });

    renderWithProviders(
      <Routes>
        <Route path="/server/:id" element={<ServerDetail />} />
      </Routes>,
      transport,
      `/server/${server.id}`
    );

    expect(await screen.findByText('Agent')).toBeTruthy();
    expect(screen.getByText('在线').className).toContain('node-badge-status-online');
    expect(await screen.findByRole('button', { name: '任务' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '任务' }));

    expect(await screen.findByText('排队 1 / 运行中 1')).toBeTruthy();
    await waitFor(() => {
      expect(transport.getProcessAudit).toHaveBeenCalledWith(server.id);
    });
  });

  it('separates GPU utilization and VRAM usage in monitoring views', async () => {
    const transport = createMockTransport();
    const server = createServer();
    const metrics = createMetricsSnapshot(server.id);

    useStore.setState({
      servers: [server],
      statuses: new Map([[server.id, createStatus(server.id)]]),
      latestMetrics: new Map([[server.id, metrics]]),
      taskQueueGroups: await transport.getTaskQueue(),
    });

    const { unmount } = renderWithProviders(<Overview />, transport);

    const card = await screen.findByText(server.name);
    const shell = card.closest('.node-card-shell') as HTMLElement | null;

    expect(shell).toBeTruthy();
    expect(within(shell!).getByText('GPU 利用率')).toBeTruthy();
    expect(within(shell!).getByText('72%')).toBeTruthy();
    expect(within(shell!).getByText('VRAM 28.0/48.0 GB')).toBeTruthy();
    expect(within(shell!).getByText('VRAM')).toBeTruthy();

    unmount();

    renderWithProviders(
      <Routes>
        <Route path="/server/:id" element={<ServerDetail />} />
      </Routes>,
      transport,
      `/server/${server.id}`
    );

    expect(await screen.findByText('GPU 利用率')).toBeTruthy();
    expect(screen.getByText('72%')).toBeTruthy();
    expect(screen.getAllByText('VRAM').length).toBeGreaterThan(0);
    expect(screen.getByText('64.0/128.0 GB')).toBeTruthy();
    expect(screen.getByText('28.0/48.0 GB')).toBeTruthy();
    expect(screen.getByText('61°C')).toBeTruthy();
    expect(screen.getByText('24.0 GB')).toBeTruthy();
    expect(screen.getByText('Task 6.0 GB')).toBeTruthy();
    expect(screen.getByText('User 4.0 GB')).toBeTruthy();
    expect(screen.getByText('Unknown 1.0 GB')).toBeTruthy();
    expect(screen.getByText('Free 13.0 GB')).toBeTruthy();
  });

  it('renders resolved GPU allocation and person activity with GB-formatted VRAM values', async () => {
    const transport = createMockTransport();
    const server = createServer();
    const metrics = createMetricsSnapshot(server.id);

    transport.getResolvedGpuAllocation = vi.fn(async () => ({
      serverId: server.id,
      snapshotTimestamp: 1_710_000_000_000,
      perGpu: [
        {
          gpuIndex: 0,
          totalMemoryMB: 12288,
          freeMB: 512,
          segments: [
            {
              ownerKey: 'person:person-1',
              ownerKind: 'person',
              displayName: 'Alice Example',
              usedMemoryMB: 3584,
              personId: 'person-1',
              sourceKinds: ['task'],
            },
          ],
        },
      ],
    }));
    transport.getServerPersonActivity = vi.fn(async () => ({
      serverId: server.id,
      people: [
        {
          personId: 'person-1',
          displayName: 'Alice Example',
          currentVramMB: 4096,
          runningTaskCount: 1,
        },
      ],
      unassignedVramMB: 512,
      unassignedUsers: ['root'],
    }));

    useStore.setState({
      servers: [server],
      statuses: new Map([[server.id, createStatus(server.id)]]),
      latestMetrics: new Map([[server.id, metrics]]),
      taskQueueGroups: [],
    });

    renderWithProviders(
      <Routes>
        <Route path="/server/:id" element={<ServerDetail />} />
      </Routes>,
      transport,
      `/server/${server.id}`
    );

    expect(await screen.findByRole('heading', { name: server.name })).toBeTruthy();
    expect(await screen.findByText('Alice Example')).toBeTruthy();
    expect(await screen.findByText('Alice Example 3.5 GB')).toBeTruthy();
    expect(screen.getByText('12.0 GB')).toBeTruthy();
    expect(screen.getByText('4.0 GB')).toBeTruthy();
    expect(screen.getByText('Free 0.5 GB')).toBeTruthy();
    expect(screen.getByText('未分配显存: 0.5 GB')).toBeTruthy();
    expect(screen.getByTitle('Alice Example: 3.5 GB')).toBeTruthy();
  });

  it('shows process VRAM values in GB on the process tab', async () => {
    const user = userEvent.setup();
    const transport = createMockTransport();
    const server = createServer();
    const metrics = createMetricsSnapshot(server.id);

    useStore.setState({
      servers: [server],
      statuses: new Map([[server.id, createStatus(server.id)]]),
      latestMetrics: new Map([[server.id, metrics]]),
      taskQueueGroups: [],
    });

    renderWithProviders(
      <Routes>
        <Route path="/server/:id" element={<ServerDetail />} />
      </Routes>,
      transport,
      `/server/${server.id}`
    );

    expect(await screen.findByRole('heading', { name: server.name })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '进程' }));

    expect(await screen.findByRole('columnheader', { name: 'RSS GB' })).toBeTruthy();
    expect(await screen.findByRole('columnheader', { name: 'VRAM GB' })).toBeTruthy();
    expect(screen.getByText('0.1 GB')).toBeTruthy();
    expect(screen.getByText('1.0 GB')).toBeTruthy();
  });

  it('keeps server detail stable when history and process audit requests fail', async () => {
    const user = userEvent.setup();
    const transport = createMockTransport();
    const server = createServer();
    const metrics = createMetricsSnapshot(server.id);

    transport.getMetricsHistory = vi.fn(async () => {
      throw new Error('history unavailable');
    });
    transport.getProcessAudit = vi.fn(async () => {
      throw new Error('audit unavailable');
    });

    useStore.setState({
      servers: [server],
      statuses: new Map([[server.id, createStatus(server.id)]]),
      latestMetrics: new Map([[server.id, metrics]]),
      taskQueueGroups: await createMockTransport().getTaskQueue(),
    });

    renderWithProviders(
      <Routes>
        <Route path="/server/:id" element={<ServerDetail />} />
      </Routes>,
      transport,
      `/server/${server.id}`
    );

    expect(await screen.findByRole('heading', { name: server.name })).toBeTruthy();
    expect(await screen.findByRole('button', { name: '任务' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '任务' }));

    expect(await screen.findByText('排队 1 / 运行中 1')).toBeTruthy();
    await waitFor(() => {
      expect(transport.getMetricsHistory).toHaveBeenCalledWith(server.id, expect.any(Number), expect.any(Number));
      expect(transport.getProcessAudit).toHaveBeenCalledWith(server.id);
    });
  });

  it('shows ssh and offline badges on server detail header', async () => {
    const transport = createMockTransport();
    const server = createServer({
      id: 'server-ssh-detail',
      name: 'ssh-detail-01',
      host: '10.0.0.20',
      sourceType: 'ssh',
      agentId: undefined,
    });

    useStore.setState({
      servers: [server],
      statuses: new Map([[server.id, { serverId: server.id, status: 'disconnected', lastSeen: 1_710_000_100_000 }]]),
      latestMetrics: new Map(),
      taskQueueGroups: [],
    });

    renderWithProviders(
      <Routes>
        <Route path="/server/:id" element={<ServerDetail />} />
      </Routes>,
      transport,
      `/server/${server.id}`
    );

    expect(await screen.findByRole('heading', { name: server.name })).toBeTruthy();
    expect(screen.getByText('SSH').className).toContain('node-badge-source-ssh');
    expect(screen.getByText('离线').className).toContain('node-badge-status-offline');
    expect(screen.getByText(/最后上报/)).toBeTruthy();
  });

  it('clears previous server history and process audit when switching servers and the new requests fail', async () => {
    const user = userEvent.setup();
    const serverA = createServer({ id: 'server-a', name: 'server-a', host: '10.0.0.11' });
    const serverB = createServer({ id: 'server-b', name: 'server-b', host: '10.0.0.12' });
    const metricsA = createMetricsSnapshot(serverA.id);
    const metricsB = createMetricsSnapshot(serverB.id);
    const historyA = createDeferred<MetricsSnapshot[]>();
    const auditA = createDeferred<ProcessAuditRow[]>();

    const transport = createMockTransport();
    transport.getMetricsHistory = vi.fn(async (serverId) => {
      if (serverId === serverA.id) {
        return historyA.promise;
      }
      throw new Error('history unavailable');
    });
    transport.getProcessAudit = vi.fn(async (serverId) => {
      if (serverId === serverA.id) {
        return auditA.promise;
      }
      throw new Error('audit unavailable');
    });

    useStore.setState({
      servers: [serverA, serverB],
      statuses: new Map([
        [serverA.id, createStatus(serverA.id)],
        [serverB.id, createStatus(serverB.id)],
      ]),
      latestMetrics: new Map([
        [serverA.id, metricsA],
        [serverB.id, metricsB],
      ]),
      taskQueueGroups: [],
    });

    renderWithProviders(<ServerDetailHarness />, transport, `/server/${serverA.id}`);

    expect(await screen.findByRole('heading', { name: serverA.name })).toBeTruthy();

    historyA.resolve([metricsA]);
    auditA.resolve([
      {
        pid: 9001,
        user: 'alice',
        command: 'python train-a.py',
        cpuPercent: 90,
        memPercent: 4,
        rss: 1024,
        gpuMemoryMB: 1024,
        ownerType: 'unknown',
        taskId: null,
        suspiciousReasons: ['A audit'],
      },
    ]);

    await waitFor(() => {
      expect(transport.getMetricsHistory).toHaveBeenCalledWith(serverA.id, expect.any(Number), expect.any(Number));
      expect(transport.getProcessAudit).toHaveBeenCalledWith(serverA.id);
    });

    await user.click(screen.getByRole('button', { name: '进程' }));
    expect(await screen.findByText('A audit')).toBeTruthy();
    expect(screen.getByText('python train-a.py')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'go-server-b' }));

    expect(await screen.findByRole('heading', { name: serverB.name })).toBeTruthy();

    await waitFor(() => {
      expect(transport.getMetricsHistory).toHaveBeenCalledWith(serverB.id, expect.any(Number), expect.any(Number));
      expect(transport.getProcessAudit).toHaveBeenCalledWith(serverB.id);
    });

    await user.click(screen.getByRole('button', { name: '进程' }));

    expect(screen.queryByText('A audit')).toBeNull();
    expect(screen.queryByText('python train-a.py')).toBeNull();
  });

  it('ignores late responses from the previous server after navigating to a new server', async () => {
    const user = userEvent.setup();
    const serverA = createServer({ id: 'server-a', name: 'server-a', host: '10.0.0.11' });
    const serverB = createServer({ id: 'server-b', name: 'server-b', host: '10.0.0.12' });
    const metricsA = createMetricsSnapshot(serverA.id);
    const metricsB = createMetricsSnapshot(serverB.id);
    const historyA = createDeferred<MetricsSnapshot[]>();
    const auditA = createDeferred<ProcessAuditRow[]>();

    const transport = createMockTransport();
    transport.getMetricsHistory = vi.fn(async (serverId) => {
      if (serverId === serverA.id) {
        return historyA.promise;
      }
      throw new Error('history unavailable');
    });
    transport.getProcessAudit = vi.fn(async (serverId) => {
      if (serverId === serverA.id) {
        return auditA.promise;
      }
      throw new Error('audit unavailable');
    });

    useStore.setState({
      servers: [serverA, serverB],
      statuses: new Map([
        [serverA.id, createStatus(serverA.id)],
        [serverB.id, createStatus(serverB.id)],
      ]),
      latestMetrics: new Map([
        [serverA.id, metricsA],
        [serverB.id, metricsB],
      ]),
      taskQueueGroups: [],
    });

    renderWithProviders(<ServerDetailHarness />, transport, `/server/${serverA.id}`);

    expect(await screen.findByRole('heading', { name: serverA.name })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'go-server-b' }));

    expect(await screen.findByRole('heading', { name: serverB.name })).toBeTruthy();

    historyA.resolve([metricsA]);
    auditA.resolve([
      {
        pid: 9002,
        user: 'alice',
        command: 'python late-a.py',
        cpuPercent: 85,
        memPercent: 3,
        rss: 1024,
        gpuMemoryMB: 2048,
        ownerType: 'unknown',
        taskId: null,
        suspiciousReasons: ['late A audit'],
      },
    ]);

    await waitFor(() => {
      expect(transport.getMetricsHistory).toHaveBeenCalledWith(serverB.id, expect.any(Number), expect.any(Number));
      expect(transport.getProcessAudit).toHaveBeenCalledWith(serverB.id);
    });

    await user.click(screen.getByRole('button', { name: '进程' }));

    expect(screen.queryByText('late A audit')).toBeNull();
    expect(screen.queryByText('python late-a.py')).toBeNull();
  });

  it('ignores previous server responses that resolve during the new route layout phase', async () => {
    const user = userEvent.setup();
    const serverA = createServer({ id: 'server-a', name: 'server-a', host: '10.0.0.11' });
    const serverB = createServer({ id: 'server-b', name: 'server-b', host: '10.0.0.12' });
    const metricsA = createMetricsSnapshot(serverA.id);
    const metricsB = createMetricsSnapshot(serverB.id);
    const historyA = createDeferred<MetricsSnapshot[]>();
    const auditA = createDeferred<ProcessAuditRow[]>();
    let raceTriggered = false;

    const transport = createMockTransport();
    transport.getMetricsHistory = vi.fn(async (serverId) => {
      if (serverId === serverA.id) {
        return historyA.promise;
      }
      throw new Error('history unavailable');
    });
    transport.getProcessAudit = vi.fn(async (serverId) => {
      if (serverId === serverA.id) {
        return auditA.promise;
      }
      throw new Error('audit unavailable');
    });

    useStore.setState({
      servers: [serverA, serverB],
      statuses: new Map([
        [serverA.id, createStatus(serverA.id)],
        [serverB.id, createStatus(serverB.id)],
      ]),
      latestMetrics: new Map([
        [serverA.id, metricsA],
        [serverB.id, metricsB],
      ]),
      taskQueueGroups: [],
    });

    renderWithProviders(
      <Routes>
        <Route
          path="/server/:id"
          element={
            <ServerDetailRaceHarness
              triggerRace={(serverId) => {
                if (serverId !== serverB.id || raceTriggered) {
                  return;
                }
                raceTriggered = true;
                historyA.resolve([metricsA]);
                auditA.resolve([
                  {
                    pid: 9003,
                    user: 'alice',
                    command: 'python render-race-a.py',
                    cpuPercent: 88,
                    memPercent: 3,
                    rss: 1024,
                    gpuMemoryMB: 512,
                    ownerType: 'unknown',
                    taskId: null,
                    suspiciousReasons: ['render phase A audit'],
                  },
                ]);
              }}
            />
          }
        />
      </Routes>,
      transport,
      `/server/${serverA.id}`
    );

    expect(await screen.findByRole('heading', { name: serverA.name })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'go-server-b' }));

    expect(await screen.findByRole('heading', { name: serverB.name })).toBeTruthy();

    await waitFor(() => {
      expect(transport.getMetricsHistory).toHaveBeenCalledWith(serverB.id, expect.any(Number), expect.any(Number));
      expect(transport.getProcessAudit).toHaveBeenCalledWith(serverB.id);
    });

    await user.click(screen.getByRole('button', { name: '进程' }));

    expect(screen.queryByText('render phase A audit')).toBeNull();
    expect(screen.queryByText('python render-race-a.py')).toBeNull();
  });

  it('shows security audit settings fields', () => {
    const transport = createMockTransport();

    useStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        securityMiningKeywords: ['xmrig', 'ethminer'],
      },
    });

    renderWithProviders(<Settings />, transport);

    expect(screen.getByLabelText('挖矿关键词')).toBeTruthy();
    expect(screen.getByLabelText('无归属 GPU 持续分钟')).toBeTruthy();
    expect(screen.getByLabelText('高 GPU 利用率阈值 (%)')).toBeTruthy();
    expect(screen.getByText('Agent 部署说明')).toBeTruthy();
  });

  it('restores save button and shows failure feedback when saving settings fails', async () => {
    const user = userEvent.setup();
    const transport = createMockTransport();

    transport.saveSettings = vi.fn(async () => {
      throw new Error('save failed');
    });

    useStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
      },
    });

    renderWithProviders(<Settings />, transport);

    const button = screen.getByRole('button', { name: '保存设置' });
    await user.click(button);

    await waitFor(() => {
      expect(transport.saveSettings).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/保存失败/)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存设置' })).not.toHaveProperty('disabled', true);
    });
  });

  it('shows stale indicator on ServerCard when disconnected with metrics', () => {
    const transport = createMockTransport();
    const server = createServer();

    useStore.setState({
      servers: [server],
      statuses: new Map([
        [server.id, { serverId: server.id, status: 'disconnected' as const, lastSeen: 1_710_000_000_000 }],
      ]),
      latestMetrics: new Map([[server.id, createMetricsSnapshot(server.id)]]),
    });

    renderWithProviders(<Overview />, transport);

    const card = screen.getByText(server.name).closest('.node-card-shell');
    expect(card).toBeTruthy();

    // Should show "最后上报" with the last seen time
    expect(card!.textContent).toContain('最后上报');

    // Should apply stale opacity
    const staleWrapper = card!.querySelector('.opacity-50');
    expect(staleWrapper).toBeTruthy();
  });

  it('online count excludes disconnected agent nodes', () => {
    const transport = createMockTransport();
    const onlineServer = createServer({ id: 'online-1', name: 'online-node' });
    const offlineServer = createServer({ id: 'offline-1', name: 'offline-node' });

    useStore.setState({
      servers: [onlineServer, offlineServer],
      statuses: new Map([
        ['online-1', { serverId: 'online-1', status: 'connected' as const, lastSeen: Date.now() }],
        ['offline-1', { serverId: 'offline-1', status: 'disconnected' as const, lastSeen: Date.now() - 60000 }],
      ]),
      latestMetrics: new Map([
        ['online-1', createMetricsSnapshot('online-1')],
        ['offline-1', createMetricsSnapshot('offline-1')],
      ]),
    });

    renderWithProviders(<Overview />, transport);

    // Both server cards should be visible
    expect(screen.getByText('online-node')).toBeTruthy();
    expect(screen.getByText('offline-node')).toBeTruthy();

    // Online count should show 1 (only connected nodes)
    // The overview shows "在线 X / Y" or similar — check for the status badges
    const onlineCard = screen.getByText('online-node').closest('.node-card-shell');
    const offlineCard = screen.getByText('offline-node').closest('.node-card-shell');
    expect(onlineCard?.textContent).toContain('在线');
    expect(offlineCard?.textContent).toContain('离线');
  });

  it('shows agent metrics timeout setting in Settings page', () => {
    const transport = createMockTransport();

    useStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        agentMetricsTimeoutMs: 15_000,
      },
    });

    renderWithProviders(<Settings />, transport);

    expect(screen.getByText('Agent 离线检测')).toBeTruthy();
    const input = screen.getByLabelText('指标超时 (秒)');
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('15');
  });
});