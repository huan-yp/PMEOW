import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.js';
import type { TransportAdapter } from '../src/transport/types.js';
import { useStore } from '../src/store/useStore.js';

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
    getMetricsHistory: vi.fn(async () => ({ snapshots: [], total: 0 })),
    getSettings: vi.fn(async () => ({ alertCpuThreshold: 90, alertMemoryThreshold: 90, alertDiskThreshold: 90, alertGpuTempThreshold: 85 })),
    saveSettings: vi.fn(async () => undefined),
    login: vi.fn(async () => ({ success: true, token: 'token' })),
    checkAuth: vi.fn(async () => ({ authenticated: false })),
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
    ...overrides,
  } as TransportAdapter;
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
      latestSnapshots: new Map(),
      tasks: [],
      taskTotal: 0,
      alerts: [],
      securityEvents: [],
      toasts: [],
      authenticated: false,
    });
  });

  it('restores an existing authenticated session before rendering the app shell', async () => {
    const transport = createMockTransport({
      checkAuth: vi.fn(async () => ({ authenticated: true })),
    });

    renderApp(transport);

    expect(await screen.findByRole('heading', { name: '节点运行视图' })).toBeTruthy();
    expect(screen.queryByPlaceholderText('请输入访问口令')).toBeNull();
    await waitFor(() => {
      expect(transport.checkAuth).toHaveBeenCalledTimes(1);
    });
  });


});