import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TaskDetail from '../src/pages/TaskDetail.js';
import { TransportProvider } from '../src/transport/TransportProvider.js';
import type { Task, TransportAdapter } from '../src/transport/types.js';

function createTask(): Task {
  return {
    id: 'task-1',
    serverId: 'server-a',
    status: 'queued',
    command: 'python train.py',
    cwd: '/workspace',
    user: 'alice',
    launchMode: 'attached_python',
    requireVramMb: 5120,
    requireGpuCount: 2,
    gpuIds: null,
    priority: 3,
    createdAt: 1_713_312_000,
    startedAt: null,
    finishedAt: null,
    pid: null,
    exitCode: null,
    assignedGpus: null,
    declaredVramPerGpu: null,
    scheduleHistory: [
      {
        timestamp: 1_713_312_009,
        result: 'scheduled',
        gpuSnapshot: {
          requestedGpuCount: 2,
          requestedVramMb: 5120,
          eligibleNowCount: 3,
          eligibleSustainedCount: 3,
          selectedGpuCount: 2,
          blockerCount: 0,
          'effectiveFreeMb.gpu0': 3821.58,
          'effectiveFreeMb.gpu1': 5171.88,
          'effectiveFreeMb.gpu2': 6301.68,
          'effectiveFreeMb.gpu3': 6438.18,
        },
        detail: 'need 2 GPU(s) with >= 5120 MB; selected=3,2; eligible_now=1,2,3; effective_free=gpu0=3821.58MB, gpu1=5171.88MB, gpu2=6301.68MB, gpu3=6438.18MB',
      },
    ],
  };
}

function createMockTransport(task: Task): TransportAdapter {
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
    getTask: vi.fn(async () => task),
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
  } as TransportAdapter;
}

function renderTaskDetail(task: Task) {
  const transport = createMockTransport(task);
  return render(
    <TransportProvider adapter={transport}>
      <MemoryRouter initialEntries={['/tasks/task-1']}>
        <Routes>
          <Route path="/tasks" element={<div>任务列表</div>} />
          <Route path="/tasks/:taskId" element={<TaskDetail />} />
        </Routes>
      </MemoryRouter>
    </TransportProvider>,
  );
}

describe('TaskDetail', () => {
  it('renders schedule history as threshold bars instead of raw detail text', async () => {
    renderTaskDetail(createTask());

    await waitFor(() => expect(screen.getByText('调度历史')).toBeTruthy());

    expect(screen.getByText('已调度')).toBeTruthy();
    expect(screen.getByText('需要 2 张 GPU，每张至少 5.0 GB')).toBeTruthy();
    expect(screen.getAllByText('当前满足').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3 张').length).toBeGreaterThan(0);
    expect(screen.getByText('实际选中')).toBeTruthy();
    expect(screen.getByText('GPU 2')).toBeTruthy();
    expect(screen.getByText('GPU 3')).toBeTruthy();
    expect(screen.getAllByText('已选中').length).toBeGreaterThan(0);
    expect(screen.getByText('低于阈值')).toBeTruthy();
    expect(screen.queryByText(/selected=3,2/)).toBeNull();
  });
});