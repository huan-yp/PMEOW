import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TransportProvider } from '../src/transport/TransportProvider.js';
import { useStore } from '../src/store/useStore.js';
import NodeDetail from '../src/pages/NodeDetail.js';
import type { Server, ServerStatus, SnapshotWithGpu, TaskInfo, TransportAdapter, UnifiedReport } from '../src/transport/types.js';

const timeSeriesChartSpy = vi.fn();

vi.mock('../src/components/TimeSeriesChart.js', () => ({
  TimeSeriesChart: (props: { series: Array<{ name: string }>; yAxes?: unknown[] }) => {
    timeSeriesChartSpy(props);
    return <div data-testid="time-series-chart">{props.series.map((item) => item.name).join(',')}</div>;
  },
}));

function createServer(id: string, name: string): Server {
  return { id, name, agentId: `${id}-agent`, createdAt: 0, updatedAt: 0 };
}

function createStatus(serverId: string): ServerStatus {
  return {
    serverId,
    status: 'online',
    version: '1.0.0',
    lastSeenAt: Date.now(),
  };
}

function createReport(timestamp = 1_713_312_000): UnifiedReport {
  const runningTask: TaskInfo = {
    taskId: 'task-1',
    status: 'running',
    command: 'python train.py',
    cwd: '/workspace',
    user: 'alice',
    launchMode: 'attached_python',
    requireVramMb: 4096,
    requireGpuCount: 1,
    gpuIds: [0],
    priority: 1,
    createdAt: timestamp - 120,
    startedAt: timestamp - 60,
    pid: 4321,
    assignedGpus: [0],
    declaredVramPerGpu: 4096,
    scheduleHistory: [],
  };

  return {
    agentId: 'agent-a',
    timestamp,
    seq: 10,
    resourceSnapshot: {
      gpuCards: [
        {
          index: 0,
          name: 'RTX 4090',
          temperature: 62,
          utilizationGpu: 55,
          utilizationMemory: 41,
          memoryTotalMb: 24576,
          memoryUsedMb: 8192,
          managedReservedMb: 4096,
          unmanagedPeakMb: 512,
          effectiveFreeMb: 16384,
          taskAllocations: [{ taskId: 'task-1', declaredVramMb: 4096 }],
          userProcesses: [{ pid: 2345, user: 'alice', vramMb: 2048 }],
          unknownProcesses: [],
        },
      ],
      cpu: { usagePercent: 33, coreCount: 16, modelName: 'AMD EPYC', frequencyMhz: 3500, perCoreUsage: [] },
      memory: { totalMb: 65536, usedMb: 32768, availableMb: 32768, usagePercent: 50, swapTotalMb: 0, swapUsedMb: 0, swapPercent: 0 },
      disks: [
        { filesystem: 'ext4', mountPoint: '/', totalGB: 500, usedGB: 200, availableGB: 300, usagePercent: 40 },
        { filesystem: 'xfs', mountPoint: '/data', totalGB: 2000, usedGB: 1000, availableGB: 1000, usagePercent: 50 },
      ],
      diskIo: { readBytesPerSec: 2048, writeBytesPerSec: 1024 },
      network: { rxBytesPerSec: 4096, txBytesPerSec: 2048, interfaces: [{ name: 'eth0', rxBytes: 100000, txBytes: 50000 }], internetReachable: true, internetLatencyMs: 10, internetProbeTarget: '8.8.8.8:53', internetProbeCheckedAt: timestamp },
      processes: [
        { pid: 1, ppid: null, user: 'root', cpuPercent: 1, memPercent: 0.1, rss: 1024 * 1024 * 128, command: 'init', gpuMemoryMb: 0 },
      ],
      localUsers: ['alice'],
      system: { hostname: 'node-a', uptime: '1d', loadAvg1: 0.1, loadAvg5: 0.2, loadAvg15: 0.3, kernelVersion: '6.8' },
    },
    taskQueue: { queued: [], running: [runningTask] },
  };
}

function createSnapshot(timestamp: number): SnapshotWithGpu {
  const report = createReport(timestamp);
  return {
    id: timestamp,
    serverId: 'server-a',
    timestamp,
    tier: 'recent',
    cpu: report.resourceSnapshot.cpu,
    memory: report.resourceSnapshot.memory,
    disks: report.resourceSnapshot.disks,
    diskIo: report.resourceSnapshot.diskIo,
    network: report.resourceSnapshot.network,
    processes: report.resourceSnapshot.processes,
    localUsers: report.resourceSnapshot.localUsers,
    gpuCards: report.resourceSnapshot.gpuCards,
  };
}

function createMockTransport(overrides: Partial<TransportAdapter> = {}): TransportAdapter {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMetricsUpdate: vi.fn(() => () => undefined),
    onServerStatus: vi.fn(() => () => undefined),
    onTaskEvent: vi.fn(() => () => undefined),
    onAlert: vi.fn(() => () => undefined),
    onSecurityEvent: vi.fn(() => () => undefined),
    onServersChanged: vi.fn(() => () => undefined),
    getServers: vi.fn(async () => []),
    addServer: vi.fn(async () => { throw new Error('not implemented'); }),
    deleteServer: vi.fn(async () => undefined),
    getStatuses: vi.fn(async () => ({})),
    getLatestMetrics: vi.fn(async () => ({})),
    getMetricsHistory: vi.fn(async () => ({ snapshots: [] })),
    getTasks: vi.fn(async () => ({ tasks: [], total: 0 })),
    getTask: vi.fn(async () => { throw new Error('not found'); }),
    cancelTask: vi.fn(async () => undefined),
    setTaskPriority: vi.fn(async () => undefined),
    getGpuOverview: vi.fn(async () => ({ servers: [] })),
    getPersons: vi.fn(async () => []),
    createPerson: vi.fn(async () => { throw new Error('not implemented'); }),
    getPerson: vi.fn(async () => { throw new Error('not found'); }),
    updatePerson: vi.fn(async () => { throw new Error('not implemented'); }),
    getPersonBindings: vi.fn(async () => []),
    createPersonBinding: vi.fn(async () => { throw new Error('not implemented'); }),
    updatePersonBinding: vi.fn(async () => { throw new Error('not implemented'); }),
    getPersonTimeline: vi.fn(async () => ({ points: [] })),
    getPersonTasks: vi.fn(async () => ({ tasks: [], total: 0 })),
    getPersonBindingCandidates: vi.fn(async () => ({ candidates: [] })),
    getAlerts: vi.fn(async () => []),
    suppressAlert: vi.fn(async () => undefined),
    unsuppressAlert: vi.fn(async () => undefined),
    batchSuppressAlerts: vi.fn(async () => undefined),
    batchUnsuppressAlerts: vi.fn(async () => undefined),
    getSecurityEvents: vi.fn(async () => []),
    markSecurityEventSafe: vi.fn(async () => undefined),
    unresolveSecurityEvent: vi.fn(async () => undefined),
    getSettings: vi.fn(async () => ({ alertCpuThreshold: 90, alertMemoryThreshold: 90, alertDiskThreshold: 90, alertGpuTempThreshold: 85 })),
    saveSettings: vi.fn(async () => undefined),
    login: vi.fn(async () => ({ token: 'token' })),
    checkAuth: vi.fn(async () => ({ authenticated: true })),
    ...overrides,
  } as TransportAdapter;
}

function renderNodeDetail(transport: TransportAdapter, routeState?: unknown) {
  return render(
    <TransportProvider adapter={transport}>
      <MemoryRouter initialEntries={[{ pathname: '/nodes/server-a', state: routeState }]}> 
        <Routes>
          <Route path="/" element={<div>控制台首页</div>} />
          <Route path="/nodes" element={<div>节点列表页</div>} />
          <Route path="/nodes/:id" element={<NodeDetail />} />
        </Routes>
      </MemoryRouter>
    </TransportProvider>,
  );
}

function findChartProps(seriesNames: string[]) {
  return timeSeriesChartSpy.mock.calls
    .map(([props]) => props as { series: Array<{ name: string }>; yAxes?: unknown[] })
    .reverse()
    .find((props) => props.series.map((item) => item.name).join(',') === seriesNames.join(','));
}

describe('NodeDetail', () => {
  beforeEach(() => {
    timeSeriesChartSpy.mockClear();
    const server = createServer('server-a', 'GPU Node A');
    const report = createReport();
    useStore.setState({
      authenticated: true,
      servers: [server],
      statuses: new Map([[server.id, createStatus(server.id)]]),
      latestSnapshots: new Map([[server.id, report]]),
      tasks: [],
      taskTotal: 0,
      alerts: [],
      securityEvents: [],
      toasts: [],
    });
  });

  it('shows four tabs and returns to console when entered from overview', async () => {
    const transport = createMockTransport();
    const user = userEvent.setup();

    renderNodeDetail(transport, { returnTo: '/', returnLabel: '返回控制台' });

    expect(screen.getByRole('button', { name: '实时概览' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '进程' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '历史' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '快照' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /返回控制台/ }));

    expect(await screen.findByText('控制台首页')).toBeTruthy();
  });

  it('loads history with a default 24h range when the history tab opens', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const historySpy = vi.fn(async () => ({ snapshots: [createSnapshot(nowSeconds - 3600), createSnapshot(nowSeconds)] }));
    const transport = createMockTransport({ getMetricsHistory: historySpy });
    const user = userEvent.setup();

    renderNodeDetail(transport);
    await user.click(screen.getByRole('button', { name: '历史' }));

    await waitFor(() => expect(historySpy).toHaveBeenCalled());

    const [serverId, query] = historySpy.mock.calls[0] as unknown as [string, { from: number; to: number }];
    expect(serverId).toBe('server-a');
    expect(query.to).toBeGreaterThanOrEqual(nowSeconds - 2);
    expect(query.from).toBeGreaterThanOrEqual(nowSeconds - 24 * 60 * 60 - 2);
    expect(query.from).toBeLessThanOrEqual(nowSeconds - 24 * 60 * 60 + 2);
    expect(screen.getByText(/当前范围：24 小时/)).toBeTruthy();
  });

  it('renders snapshot state without trend charts', async () => {
    const snapshotSpy = vi.fn(async () => ({ snapshots: [createSnapshot(1_713_311_400), createSnapshot(1_713_312_000)] }));
    const transport = createMockTransport({ getMetricsHistory: snapshotSpy });
    const user = userEvent.setup();

    renderNodeDetail(transport);
    await user.click(screen.getByRole('button', { name: '快照' }));

    await waitFor(() => expect(snapshotSpy).toHaveBeenCalled());

    expect(screen.getByText('快照进程列表')).toBeTruthy();
    expect(screen.getAllByText('磁盘使用情况')).toHaveLength(1);
    expect(screen.queryByTestId('time-series-chart')).toBeNull();
  });

  it('shows per-GPU occupancy and memory bandwidth as separate metrics', async () => {
    const transport = createMockTransport();
    const user = userEvent.setup();

    renderNodeDetail(transport);

    expect(screen.getByText('默认折叠，展开后查看每张 GPU 的利用率、显存占用与显存带宽利用率')).toBeTruthy();
    expect(screen.getByText('当前 GPU 55% · 显存占用 33% · 显存带宽利用率 41%')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /GPU 0: RTX 4090/ }));

    expect(screen.getByText('GPU 利用率,显存占用,显存带宽利用率')).toBeTruthy();
  });

  it('switches realtime network and disk charts to dual axes when ranges diverge', () => {
    const report = createReport();
    report.resourceSnapshot.network.rxBytesPerSec = 5 * 1024 * 1024;
    report.resourceSnapshot.network.txBytesPerSec = 256 * 1024;
    report.resourceSnapshot.diskIo.readBytesPerSec = 8 * 1024 * 1024;
    report.resourceSnapshot.diskIo.writeBytesPerSec = 128 * 1024;

    useStore.setState({
      latestSnapshots: new Map([['server-a', report]]),
    });

    renderNodeDetail(createMockTransport());

    expect(screen.getAllByText('左 MB/s / 右 KB/s')).toHaveLength(2);

    const networkChart = findChartProps(['接收', '发送']);
    const diskChart = findChartProps(['读取', '写入']);

    expect(networkChart?.yAxes).toHaveLength(2);
    expect(diskChart?.yAxes).toHaveLength(2);
  });

  it('keeps a shared axis for history charts when ranges are similar', async () => {
    const historySpy = vi.fn(async () => ({
      snapshots: [
        (() => {
          const snapshot = createSnapshot(1_713_311_400);
          snapshot.network.rxBytesPerSec = 8 * 1024;
          snapshot.network.txBytesPerSec = 6 * 1024;
          snapshot.diskIo.readBytesPerSec = 4 * 1024;
          snapshot.diskIo.writeBytesPerSec = 2 * 1024;
          return snapshot;
        })(),
        (() => {
          const snapshot = createSnapshot(1_713_312_000);
          snapshot.network.rxBytesPerSec = 12 * 1024;
          snapshot.network.txBytesPerSec = 9 * 1024;
          snapshot.diskIo.readBytesPerSec = 6 * 1024;
          snapshot.diskIo.writeBytesPerSec = 3 * 1024;
          return snapshot;
        })(),
      ],
    }));
    const transport = createMockTransport({ getMetricsHistory: historySpy });
    const user = userEvent.setup();

    renderNodeDetail(transport);
    timeSeriesChartSpy.mockClear();
    await user.click(screen.getByRole('button', { name: '历史' }));

    await waitFor(() => expect(historySpy).toHaveBeenCalled());

    expect(screen.queryByText('左 KB/s / 右 KB/s')).toBeNull();

    const networkChart = findChartProps(['接收', '发送']);
    const diskChart = findChartProps(['读取', '写入']);

    expect(networkChart?.yAxes).toHaveLength(1);
    expect(diskChart?.yAxes).toHaveLength(1);
  });

  it('renders user-grouped gpu allocation for realtime and historical fallback note for snapshots', async () => {
    const snapshotSpy = vi.fn(async () => ({ snapshots: [createSnapshot(1_713_312_000)] }));
    const transport = createMockTransport({ getMetricsHistory: snapshotSpy });
    const user = userEvent.setup();

    renderNodeDetail(transport);

    expect(screen.getAllByText('alice')).toHaveLength(1);
    expect(screen.getByText('用户颜色说明')).toBeTruthy();
    expect(screen.getByText('同一用户跨 GPU 只显示一次')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '快照' }));
    await waitFor(() => expect(snapshotSpy).toHaveBeenCalled());

    expect(screen.getByText('历史快照缺少任务归属，托管任务以未归因分组展示。')).toBeTruthy();
  });
});