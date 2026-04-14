import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MobilePersonLayout } from '../src/mobile/layouts/MobilePersonLayout.js';
import { PersonHome } from '../src/mobile/screens/person/Home.js';
import { PersonTasks } from '../src/mobile/screens/person/Tasks.js';
import { PersonSettings } from '../src/mobile/screens/person/Settings.js';
import { PersonDetail } from '../src/pages/PersonDetail.js';
import { TransportProvider } from '../src/transport/TransportProvider.js';
import type { TransportAdapter } from '../src/transport/types.js';
import { DEFAULT_SETTINGS } from '@monitor/core';

const mockGetPersonBootstrap = vi.fn();
const mockGetPersonMobileTasks = vi.fn();
const mockCancelPersonTask = vi.fn();
const mockGetPersonMobilePreferences = vi.fn();
const mockUpdatePersonMobilePreferences = vi.fn();

vi.mock('../src/mobile/api/person.js', () => ({
  getPersonBootstrap: (...args: unknown[]) => mockGetPersonBootstrap(...args),
  getPersonMobileTasks: (...args: unknown[]) => mockGetPersonMobileTasks(...args),
  cancelPersonTask: (...args: unknown[]) => mockCancelPersonTask(...args),
  getPersonMobileServers: vi.fn(async () => []),
  getPersonMobileNotifications: vi.fn(async () => []),
  markNotificationRead: vi.fn(),
  getPersonMobilePreferences: (...args: unknown[]) => mockGetPersonMobilePreferences(...args),
  updatePersonMobilePreferences: (...args: unknown[]) => mockUpdatePersonMobilePreferences(...args),
}));

vi.mock('../src/mobile/session/person-session.js', () => ({
  getPersonToken: vi.fn(() => 'pmt_test_token'),
  setPersonToken: vi.fn(),
  clearPersonToken: vi.fn(),
}));

describe('person mobile pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPersonBootstrap.mockResolvedValue({
      person: { id: 'p1', displayName: 'Alice' },
      runningTaskCount: 2,
      queuedTaskCount: 1,
      boundNodeCount: 3,
      unreadNotificationCount: 4,
    });
    mockGetPersonMobileTasks.mockResolvedValue([
      { taskId: 't1', command: 'python train.py', status: 'running', serverId: 's1', serverName: 'GPU-1', updatedAt: Date.now() },
      { taskId: 't2', command: 'python eval.py', status: 'queued', serverId: 's1', serverName: 'GPU-1', updatedAt: Date.now() },
    ]);
    mockCancelPersonTask.mockResolvedValue({ success: true });
    mockGetPersonMobilePreferences.mockResolvedValue({
      personId: 'p1',
      notifyTaskStarted: true,
      notifyTaskCompleted: true,
      notifyTaskFailed: true,
      notifyTaskCancelled: false,
      notifyNodeStatus: true,
      notifyGpuAvailable: false,
      minAvailableGpuCount: 1,
      minAvailableVramGB: null,
      updatedAt: Date.now(),
    });
    mockUpdatePersonMobilePreferences.mockImplementation(async (updates: Record<string, unknown>) => ({
      personId: 'p1',
      notifyTaskStarted: true,
      notifyTaskCompleted: true,
      notifyTaskFailed: true,
      notifyTaskCancelled: false,
      notifyNodeStatus: true,
      notifyGpuAvailable: false,
      minAvailableGpuCount: 1,
      minAvailableVramGB: null,
      updatedAt: Date.now(),
      ...updates,
    }));
  });

  it('bootstraps person mobile from stored token', async () => {
    render(
      <MemoryRouter initialEntries={['/m/me']}>
        <Routes>
          <Route path="/m/me" element={<MobilePersonLayout />}>
            <Route index element={<PersonHome />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    // Should validate token and display the person home
    expect(await screen.findByText('你好, Alice')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy(); // runningTaskCount
    expect(screen.getByText('3')).toBeTruthy(); // boundNodeCount
  });

  it('shows blocked state when token is invalid', async () => {
    mockGetPersonBootstrap.mockRejectedValue(new Error('HTTP 401'));

    render(
      <MemoryRouter initialEntries={['/m/me']}>
        <Routes>
          <Route path="/m/me" element={<MobilePersonLayout />}>
            <Route index element={<PersonHome />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    // Should show token input form
    expect(await screen.findByPlaceholderText('pmt_...')).toBeTruthy();
    expect(screen.getByText('验证令牌')).toBeTruthy();
  });

  it('renders person tasks and can cancel an owned task', async () => {
    render(
      <MemoryRouter initialEntries={['/m/me/tasks']}>
        <Routes>
          <Route path="/m/me" element={<MobilePersonLayout />}>
            <Route path="tasks" element={<PersonTasks />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('python train.py')).toBeTruthy();
    expect(screen.getByText('python eval.py')).toBeTruthy();

    // Click cancel on the queued task
    const cancelButtons = screen.getAllByText('取消任务');
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);

    await waitFor(() => {
      expect(mockCancelPersonTask).toHaveBeenCalledWith('t2');
    });
  });

  it('renders notification settings and saves preference changes', async () => {
    render(
      <MemoryRouter initialEntries={['/m/me/settings']}>
        <Routes>
          <Route path="/m/me" element={<MobilePersonLayout />}>
            <Route path="settings" element={<PersonSettings />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('通知设置')).toBeTruthy();
    expect(screen.getByText('任务开始通知')).toBeTruthy();
    expect(screen.getByText('任务取消通知')).toBeTruthy();

    // Toggle '任务取消通知' (currently off)
    const toggleButtons = screen.getAllByRole('button');
    // The Settings screen renders 6 toggle buttons (one per preference)
    // '任务取消通知' is the 4th toggle
    fireEvent.click(toggleButtons[3]);

    await waitFor(() => {
      expect(mockUpdatePersonMobilePreferences).toHaveBeenCalledWith({ notifyTaskCancelled: true });
    });
  });
});

describe('desktop person detail token controls', () => {
  const originalFetch = globalThis.fetch;

  function createMinimalTransport(): TransportAdapter {
    return {
      isElectron: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      onMetricsUpdate: vi.fn(() => () => undefined),
      onServerStatus: vi.fn(() => () => undefined),
      onAlert: vi.fn(() => () => undefined),
      onHookTriggered: vi.fn(() => () => undefined),
      onNotify: vi.fn(() => () => undefined),
      onTaskUpdate: vi.fn(() => () => undefined),
      onSecurityEvent: vi.fn(() => () => undefined),
      getServers: vi.fn(async () => []),
      addServer: vi.fn(async () => ({} as any)),
      updateServer: vi.fn(async () => ({} as any)),
      deleteServer: vi.fn(async () => true),
      testConnection: vi.fn(async () => ({ success: true })),
      getLatestMetrics: vi.fn(async () => null),
      getMetricsHistory: vi.fn(async () => []),
      getServerStatuses: vi.fn(async () => []),
      getHooks: vi.fn(async () => []),
      createHook: vi.fn(async () => ({} as any)),
      updateHook: vi.fn(async () => ({} as any)),
      deleteHook: vi.fn(async () => true),
      getHookLogs: vi.fn(async () => []),
      testHookAction: vi.fn(async () => ({ success: true })),
      getSettings: vi.fn(async () => DEFAULT_SETTINGS),
      saveSettings: vi.fn(async () => undefined),
      login: vi.fn(async () => ({ success: true, token: 'token' })),
      setPassword: vi.fn(async () => ({ success: true })),
      checkAuth: vi.fn(async () => ({ authenticated: true, needsSetup: false })),
      getAlerts: vi.fn(async () => []),
      suppressAlert: vi.fn(async () => undefined),
      unsuppressAlert: vi.fn(async () => undefined),
      batchSuppressAlerts: vi.fn(async () => undefined),
      batchUnsuppressAlerts: vi.fn(async () => undefined),
      getTaskQueue: vi.fn(async () => []),
      getProcessAudit: vi.fn(async () => []),
      getSecurityEvents: vi.fn(async () => []),
      markSecurityEventSafe: vi.fn(async () => ({} as any)),
      getGpuOverview: vi.fn(async () => ({ generatedAt: 1, users: [], servers: [] })),
      getGpuUsageSummary: vi.fn(async () => []),
      getGpuUsageByUser: vi.fn(async () => []),
      cancelTask: vi.fn(async () => undefined),
      setTaskPriority: vi.fn(async () => undefined),
      pauseQueue: vi.fn(async () => undefined),
      resumeQueue: vi.fn(async () => undefined),
      uploadKey: vi.fn(async () => ({ path: '/tmp/key' })),
      getPersons: vi.fn(async () => [
        { id: 'p1', displayName: 'Alice', email: '', qq: '', note: '', customFields: {}, status: 'active' as const, createdAt: 1, updatedAt: 1 },
      ]),
      createPerson: vi.fn(async () => ({} as any)),
      updatePerson: vi.fn(async () => ({} as any)),
      getPersonBindings: vi.fn(async () => []),
      createPersonBinding: vi.fn(async () => ({} as any)),
      updatePersonBinding: vi.fn(async () => ({} as any)),
      getPersonBindingCandidates: vi.fn(async () => []),
      getPersonBindingSuggestions: vi.fn(async () => []),
      getPersonSummary: vi.fn(async () => []),
      getPersonTimeline: vi.fn(async () => []),
      getPersonTasks: vi.fn(async () => []),
      getServerPersonActivity: vi.fn(async () => ({ serverId: 's1', people: [], unassignedVramMB: 0, unassignedUsers: [] })),
      getResolvedGpuAllocation: vi.fn(async () => null),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('shows create button when no token exists', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/mobile-token/status')) {
        return new Response(JSON.stringify({ hasToken: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    render(
      <TransportProvider adapter={createMinimalTransport()}>
        <MemoryRouter initialEntries={['/people/p1']}>
          <Routes>
            <Route path="/people/:id" element={<PersonDetail />} />
          </Routes>
        </MemoryRouter>
      </TransportProvider>,
    );

    expect(await screen.findByText('创建令牌')).toBeTruthy();
  });

  it('shows rotate and revoke buttons when token exists', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/mobile-token/status')) {
        return new Response(JSON.stringify({ hasToken: true, createdAt: Date.now(), lastUsedAt: Date.now() }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    render(
      <TransportProvider adapter={createMinimalTransport()}>
        <MemoryRouter initialEntries={['/people/p1']}>
          <Routes>
            <Route path="/people/:id" element={<PersonDetail />} />
          </Routes>
        </MemoryRouter>
      </TransportProvider>,
    );

    expect(await screen.findByText('轮换令牌')).toBeTruthy();
    expect(screen.getByText('吊销令牌')).toBeTruthy();
    expect(screen.getByText('令牌已创建')).toBeTruthy();
  });
});
