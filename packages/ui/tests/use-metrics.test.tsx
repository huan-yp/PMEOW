import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransportProvider } from '../src/transport/TransportProvider.js';
import { useLoadInitialData, useMetricsSubscription } from '../src/hooks/useMetrics.js';
import { useStore } from '../src/store/useStore.js';
import type { TransportAdapter, Server, ServerStatus } from '../src/transport/types.js';

function createServer(id: string, name: string): Server {
  return { id, name, agentId: `${id}-agent`, createdAt: 0, updatedAt: 0 };
}

function createMockTransport(): TransportAdapter {
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
    getMetricsHistory: vi.fn(async () => ({ snapshots: [], total: 0 })),
    getSettings: vi.fn(async () => ({ alertCpuThreshold: 90, alertMemoryThreshold: 90, alertDiskThreshold: 90, alertGpuTempThreshold: 85 })),
    saveSettings: vi.fn(async () => undefined),
    login: vi.fn(async () => ({ success: true, token: 'token' })),
    checkAuth: vi.fn(async () => ({ authenticated: true })),
    getTasks: vi.fn(async () => ({ tasks: [], total: 0 })),
    getTask: vi.fn(async () => { throw new Error('not found'); }),
    cancelTask: vi.fn(async () => undefined),
    getAlerts: vi.fn(async () => []),
    suppressAlert: vi.fn(async () => undefined),
    unsuppressAlert: vi.fn(async () => undefined),
    getSecurityEvents: vi.fn(async () => []),
    markSecurityEventSafe: vi.fn(async () => undefined),
    unresolveSecurityEvent: vi.fn(async () => undefined),
    getPersons: vi.fn(async () => []),
    getPerson: vi.fn(async () => { throw new Error('not found'); }),
    createPerson: vi.fn(async () => { throw new Error('not implemented'); }),
    updatePerson: vi.fn(async () => { throw new Error('not implemented'); }),
    getPersonBindings: vi.fn(async () => []),
    getPersonTasks: vi.fn(async () => ({ tasks: [], total: 0 })),
    getPersonTimeline: vi.fn(async () => ({ points: [] })),
  } as TransportAdapter;
}

function Probe() {
  useLoadInitialData();
  return null;
}

function SubscriptionProbe() {
  useMetricsSubscription();
  return null;
}

describe('useLoadInitialData', () => {
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

  it('hydrates servers and statuses on first mount', async () => {
    const transport = createMockTransport();
    const serverA = createServer('server-a', 'GPU Node A');
    const serverB = createServer('server-b', 'GPU Node B');
    const statuses: Record<string, ServerStatus> = {
      'server-a': { serverId: 'server-a', status: 'online', version: '1.0', lastSeenAt: Date.now() },
      'server-b': { serverId: 'server-b', status: 'offline', version: '1.0', lastSeenAt: Date.now() - 60000 },
    };

    transport.getServers = vi.fn(async () => [serverA, serverB]);
    transport.getStatuses = vi.fn(async () => statuses);

    render(
      <TransportProvider adapter={transport}>
        <Probe />
      </TransportProvider>,
    );

    await waitFor(() => {
      expect(transport.getServers).toHaveBeenCalledTimes(1);
      expect(transport.getStatuses).toHaveBeenCalledTimes(1);
      expect(useStore.getState().servers).toHaveLength(2);
    });

    const state = useStore.getState();
    expect(state.statuses.get('server-a')?.status).toBe('online');
    expect(state.statuses.get('server-b')?.status).toBe('offline');
  });

  it('refreshes the server list when the server catalog changes in realtime', async () => {
    const transport = createMockTransport();
    const serverA = createServer('server-a', 'Node A');
    const serverB = createServer('server-b', 'Node B');
    let handleServersChanged: (() => void) | undefined;

    transport.getServers = vi.fn()
      .mockResolvedValueOnce([serverA])
      .mockResolvedValueOnce([serverA, serverB]);
    transport.getStatuses = vi.fn(async () => ({}));
    transport.onServersChanged = vi.fn((cb: () => void) => {
      handleServersChanged = cb;
      return () => undefined;
    });

    render(
      <TransportProvider adapter={transport}>
        <>
          <Probe />
          <SubscriptionProbe />
        </>
      </TransportProvider>,
    );

    await waitFor(() => {
      expect(transport.getServers).toHaveBeenCalledTimes(1);
      expect(useStore.getState().servers).toEqual([serverA]);
      expect(handleServersChanged).toBeTypeOf('function');
    });

    handleServersChanged?.();

    await waitFor(() => {
      expect(transport.getServers).toHaveBeenCalledTimes(2);
      expect(useStore.getState().servers).toEqual([serverA, serverB]);
    });
  });
});