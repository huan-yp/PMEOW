import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Security from '../src/pages/Security.js';
import { useStore } from '../src/store/useStore.js';
import { TransportProvider } from '../src/transport/TransportProvider.js';
import type { SecurityEvent, TransportAdapter } from '../src/transport/types.js';

function createMockTransport(events: SecurityEvent[]): TransportAdapter {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMetricsUpdate: vi.fn(() => () => undefined),
    onServerStatus: vi.fn(() => () => undefined),
    onTaskEvent: vi.fn(() => () => undefined),
    onAlertStateChange: vi.fn(() => () => undefined),
    onSecurityEvent: vi.fn(() => () => undefined),
    onServersChanged: vi.fn(() => () => undefined),
    getServers: vi.fn(async () => []),
    addServer: vi.fn(async () => { throw new Error('not implemented'); }),
    updateServer: vi.fn(async () => { throw new Error('not implemented'); }),
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
    getPersonDirectory: vi.fn(async () => []),
    createPerson: vi.fn(async () => { throw new Error('not implemented'); }),
    getPerson: vi.fn(async () => { throw new Error('not found'); }),
    updatePerson: vi.fn(async () => { throw new Error('not implemented'); }),
    getPersonBindings: vi.fn(async () => []),
    createPersonBinding: vi.fn(async () => { throw new Error('not implemented'); }),
    updatePersonBinding: vi.fn(async () => { throw new Error('not implemented'); }),
    createPersonWizard: vi.fn(async () => { throw new Error('not implemented'); }),
    autoAddUnassigned: vi.fn(async () => ({ entries: [], createdCount: 0, reusedCount: 0, skippedCount: 0 })),
    getPersonTimeline: vi.fn(async () => ({ points: [] })),
    getPersonTasks: vi.fn(async () => ({ tasks: [], total: 0 })),
    getPersonBindingCandidates: vi.fn(async () => ({ candidates: [] })),
    getPersonTokens: vi.fn(async () => []),
    createPersonToken: vi.fn(async () => { throw new Error('not implemented'); }),
    revokePersonToken: vi.fn(async () => { throw new Error('not implemented'); }),
    rotatePersonToken: vi.fn(async () => { throw new Error('not implemented'); }),
    getAlerts: vi.fn(async () => []),
    silenceAlert: vi.fn(async () => undefined),
    unsilenceAlert: vi.fn(async () => undefined),
    batchSilenceAlerts: vi.fn(async () => undefined),
    batchUnsilenceAlerts: vi.fn(async () => undefined),
    getSecurityEvents: vi.fn(async () => events),
    markSecurityEventSafe: vi.fn(async () => undefined),
    unresolveSecurityEvent: vi.fn(async () => undefined),
    getSettings: vi.fn(async () => ({
      alertCpuThreshold: 90,
      alertMemoryThreshold: 90,
      alertDiskThreshold: 90,
      alertGpuTempThreshold: 85,
      alertOfflineSeconds: 30,
      alertGpuIdleMemoryPercent: 20,
      alertGpuIdleUtilizationPercent: 5,
      alertGpuIdleDurationSeconds: 60,
      alertDiskMountPoints: ['/'],
      alertSuppressDefaultDays: 7,
      securityMiningKeywords: ['xmrig'],
      securityUnownedGpuMinutes: 30,
      snapshotRecentIntervalSeconds: 60,
      snapshotArchiveIntervalSeconds: 1800,
      snapshotRecentKeepCount: 120,
    })),
    saveSettings: vi.fn(async () => undefined),
    login: vi.fn(async () => ({ authenticated: true, token: 'token', principal: { kind: 'admin' }, person: null, accessibleServerIds: null })),
    checkAuth: vi.fn(async () => ({ authenticated: true, principal: { kind: 'admin' }, person: null, accessibleServerIds: null })),
  };
}

describe('Security page', () => {
  beforeEach(() => {
    useStore.setState({
      servers: [],
      statuses: new Map(),
      latestSnapshots: new Map(),
      tasks: [],
      taskTotal: 0,
      alerts: [],
      securityEvents: [],
      toasts: [],
      authenticated: false,
    });
  });

  it('renders readable node name, event meaning, and millisecond timestamp', async () => {
    const createdAt = Date.UTC(2026, 3, 24, 14, 30, 0);
    const events: SecurityEvent[] = [{
      id: 1,
      serverId: 'server-training-a',
      eventType: 'unowned_gpu',
      fingerprint: 'abc123',
      details: {
        reason: 'Unknown process using GPU 2',
        pid: 4242,
        gpuIndex: 2,
        usedMemoryMB: 512,
      },
      resolved: false,
      resolvedBy: null,
      createdAt,
      resolvedAt: null,
    }];

    useStore.getState().setServers([
      { id: 'server-training-a', name: '训练节点 A', agentId: 'agent-a', createdAt: 0, updatedAt: 0 },
    ]);

    render(
      <TransportProvider adapter={createMockTransport(events)}>
        <Security />
      </TransportProvider>,
    );

    await waitFor(() => expect(screen.queryByText('加载中...')).toBeNull());

    expect(screen.getByText('未知进程占用 GPU')).toBeTruthy();
    expect(screen.getByText(/节点: 训练节点 A/)).toBeTruthy();
    expect(screen.getByText(/GPU 2/)).toBeTruthy();
    expect(screen.getByText(/PID 4242/)).toBeTruthy();
    expect(screen.getByText(/512 MB/)).toBeTruthy();
    expect(screen.getByText(/2026/)).toBeTruthy();
    expect(screen.queryByText(/5827/)).toBeNull();
  });
});
