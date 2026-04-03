import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@monitor/core';
import type {
  AgentTaskQueueGroup,
  AlertEvent,
  AlertRecord,
  AppSettings,
  GpuAllocationSummary,
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
  SecurityEventQuery,
} from '@monitor/core';
import { TransportProvider } from '../src/transport/TransportProvider.js';
import { useLoadInitialData } from '../src/hooks/useMetrics.js';
import { useStore } from '../src/store/useStore.js';
import type { TransportAdapter } from '../src/transport/types.js';

function createServer(id: string, host: string): ServerConfig {
  return {
    id,
    name: id,
    host,
    port: 22,
    username: 'root',
    privateKeyPath: '/tmp/key',
    sourceType: 'agent',
    agentId: `${id}-agent`,
    createdAt: 0,
    updatedAt: 0,
  };
}

function createMetricsSnapshot(serverId: string, timestamp: number): MetricsSnapshot {
  return {
    serverId,
    timestamp,
    cpu: { usagePercent: 10, coreCount: 8, modelName: 'CPU', frequencyMhz: 3200, perCoreUsage: [10, 10] },
    memory: { totalMB: 1024, usedMB: 512, availableMB: 512, usagePercent: 50, swapTotalMB: 0, swapUsedMB: 0, swapPercent: 0 },
    disk: { disks: [], ioReadKBs: 0, ioWriteKBs: 0 },
    network: { rxBytesPerSec: 128, txBytesPerSec: 64, interfaces: [] },
    gpu: { available: false, totalMemoryMB: 0, usedMemoryMB: 0, memoryUsagePercent: 0, utilizationPercent: 0, temperatureC: 0, gpuCount: 0 },
    processes: [],
    docker: [],
    system: { hostname: serverId, uptime: '1 day', loadAvg1: 0.1, loadAvg5: 0.2, loadAvg15: 0.3, kernelVersion: '6.8.0' },
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
    getServers: vi.fn(async () => []),
    addServer: vi.fn(async (_input: ServerInput) => { throw new Error('not implemented'); }),
    updateServer: vi.fn(async (_id: string, _input: Partial<ServerInput>) => { throw new Error('not implemented'); }),
    deleteServer: vi.fn(async (_id: string) => true),
    testConnection: vi.fn(async (_input: ServerInput) => ({ success: true })),
    getLatestMetrics: vi.fn(async (_serverId: string) => null),
    getMetricsHistory: vi.fn(async (_serverId: string, _from: number, _to: number) => []),
    getServerStatuses: vi.fn(async () => []),
    getHooks: vi.fn(async () => []),
    createHook: vi.fn(async (_input: HookRuleInput) => { throw new Error('not implemented'); }),
    updateHook: vi.fn(async (_id: string, _input: Partial<HookRuleInput>) => { throw new Error('not implemented'); }),
    deleteHook: vi.fn(async (_id: string) => true),
    getHookLogs: vi.fn(async (_hookId: string) => []),
    testHookAction: vi.fn(async (_hookId: string) => ({ success: true })),
    getSettings: vi.fn(async () => DEFAULT_SETTINGS),
    saveSettings: vi.fn(async (_settings: Partial<AppSettings>) => undefined),
    login: vi.fn(async (_password: string) => ({ success: true, token: 'token' })),
    setPassword: vi.fn(async (_password: string) => ({ success: true })),
    checkAuth: vi.fn(async () => ({ authenticated: true, needsSetup: false })),
    getAlerts: vi.fn(async (_limit?: number, _offset?: number) => [] as AlertRecord[]),
    suppressAlert: vi.fn(async (_id: string, _days?: number) => undefined),
    getTaskQueue: vi.fn(async () => [] as AgentTaskQueueGroup[]),
    getProcessAudit: vi.fn(async (_serverId: string) => [] as ProcessAuditRow[]),
    getSecurityEvents: vi.fn(async (_query?: SecurityEventQuery) => [] as SecurityEventRecord[]),
    markSecurityEventSafe: vi.fn(async (_id: number, _reason?: string) => { throw new Error('not implemented'); }),
    getGpuOverview: vi.fn(async () => ({ generatedAt: 0, users: [], servers: [] } as GpuOverviewResponse)),
    getGpuUsageSummary: vi.fn(async (_hours?: number) => [] as GpuUsageSummaryItem[]),
    getGpuUsageByUser: vi.fn(async (_user: string, _hours?: number) => [] as GpuUsageTimelinePoint[]),
    cancelTask: vi.fn(async (_serverId: string, _taskId: string) => undefined),
    setTaskPriority: vi.fn(async (_serverId: string, _taskId: string, _priority: number) => undefined),
    pauseQueue: vi.fn(async (_serverId: string) => undefined),
    resumeQueue: vi.fn(async (_serverId: string) => undefined),
    uploadKey: vi.fn(async (_file: File) => ({ path: '/tmp/key' })),
    getGpuAllocation: vi.fn(async (_serverId: string) => null as GpuAllocationSummary | null),
    getTask: vi.fn(async (_serverId: string, _taskId: string) => null),
    getResolvedGpuAllocation: vi.fn(async () => null),
  };
}

function Probe() {
  useLoadInitialData();
  return null;
}

describe('useLoadInitialData', () => {
  beforeEach(() => {
    useStore.setState({
      servers: [],
      statuses: new Map(),
      latestMetrics: new Map(),
      hooks: [],
      settings: null,
    });
  });

  it('hydrates latest metrics from statuses and latest-metrics fallback on first mount', async () => {
    const transport = createMockTransport();
    const serverA = createServer('server-a', 'gpu-a');
    const serverB = createServer('server-b', 'gpu-b');
    const statusSnapshot = createMetricsSnapshot(serverA.id, 1_700_000_000_100);
    const fallbackSnapshot = createMetricsSnapshot(serverB.id, 1_700_000_000_200);
    const statuses: ServerStatus[] = [
      {
        serverId: serverA.id,
        status: 'connected',
        lastSeen: Date.now(),
        latestMetrics: statusSnapshot,
      },
      {
        serverId: serverB.id,
        status: 'connected',
        lastSeen: Date.now(),
      },
    ];

    transport.getServers = vi.fn(async () => [serverA, serverB]);
    transport.getServerStatuses = vi.fn(async () => statuses);
    transport.getLatestMetrics = vi.fn(async (serverId: string) => (
      serverId === serverB.id ? fallbackSnapshot : null
    ));

    render(
      <TransportProvider adapter={transport}>
        <Probe />
      </TransportProvider>,
    );

    await waitFor(() => {
      expect(transport.getServers).toHaveBeenCalledTimes(1);
      expect(transport.getServerStatuses).toHaveBeenCalledTimes(1);
      expect(transport.getLatestMetrics).toHaveBeenCalledTimes(2);
      expect(useStore.getState().servers).toHaveLength(2);
      expect(useStore.getState().statuses.get(serverA.id)?.latestMetrics).toEqual(statusSnapshot);
    });

    await waitFor(() => {
      const state = useStore.getState();
      expect(state.latestMetrics.get(serverA.id)).toEqual(statusSnapshot);
      expect(state.latestMetrics.get(serverB.id)).toEqual(fallbackSnapshot);
    });

    expect(transport.getLatestMetrics).toHaveBeenCalledTimes(2);
    expect(transport.getLatestMetrics).toHaveBeenCalledWith(serverA.id);
    expect(transport.getLatestMetrics).toHaveBeenCalledWith(serverB.id);
  });
});