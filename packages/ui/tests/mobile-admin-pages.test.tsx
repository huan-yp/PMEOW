import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MobileAdminLayout } from '../src/mobile/layouts/MobileAdminLayout.js';
import { AdminHome } from '../src/mobile/screens/admin/Home.js';
import { AdminTasks } from '../src/mobile/screens/admin/Tasks.js';
import { AdminNodes } from '../src/mobile/screens/admin/Nodes.js';
import { AdminNotifications } from '../src/mobile/screens/admin/Notifications.js';

// Mock the admin API module
vi.mock('../src/mobile/api/admin.js', () => ({
  getAdminMobileSummary: vi.fn(async () => ({
    serverCount: 3,
    onlineServerCount: 2,
    totalRunningTasks: 5,
    totalQueuedTasks: 2,
  })),
  getAdminMobileTasks: vi.fn(async () => [
    { taskId: 'task-1', command: 'python train.py', status: 'running', serverId: 's1', serverName: 'GPU-1', updatedAt: Date.now() },
  ]),
  getAdminMobileServers: vi.fn(async () => [
    { id: 's1', name: 'GPU-1', host: '10.0.0.1', status: 'connected', lastSeen: Date.now() },
  ]),
  getAdminMobileNotifications: vi.fn(async () => []),
}));

describe('admin mobile pages', () => {
  it('renders admin mobile home with summary cards', async () => {
    render(
      <MemoryRouter initialEntries={['/m/admin']}>
        <Routes>
          <Route path="/m/admin" element={<MobileAdminLayout />}>
            <Route index element={<AdminHome />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('集群概览')).toBeTruthy();
    expect(await screen.findByText('3')).toBeTruthy(); // serverCount
    expect(await screen.findByText('5')).toBeTruthy(); // runningTasks
  });

  it('renders admin mobile bottom navigation', async () => {
    render(
      <MemoryRouter initialEntries={['/m/admin']}>
        <Routes>
          <Route path="/m/admin" element={<MobileAdminLayout />}>
            <Route index element={<AdminHome />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const homeLink = await screen.findByRole('link', { name: '首页' });

    expect(homeLink.getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('任务')).toBeTruthy();
    // "节点" appears in both summary card and nav bar
    expect(screen.getAllByText('节点').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('通知')).toBeTruthy();
  });

  it('renders admin mobile tasks list', async () => {
    render(
      <MemoryRouter initialEntries={['/m/admin/tasks']}>
        <Routes>
          <Route path="/m/admin" element={<MobileAdminLayout />}>
            <Route path="tasks" element={<AdminTasks />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('python train.py')).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
  });

  it('renders admin nodes page', async () => {
    render(
      <MemoryRouter initialEntries={['/m/admin/nodes']}>
        <Routes>
          <Route path="/m/admin" element={<MobileAdminLayout />}>
            <Route path="nodes" element={<AdminNodes />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('GPU-1')).toBeTruthy();
    expect(screen.getByText('在线')).toBeTruthy();
  });

  it('renders empty notification state', async () => {
    render(
      <MemoryRouter initialEntries={['/m/admin/notifications']}>
        <Routes>
          <Route path="/m/admin" element={<MobileAdminLayout />}>
            <Route path="notifications" element={<AdminNotifications />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('暂无通知')).toBeTruthy();
  });
});
