import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/store/useStore.js';

describe('useStore', () => {
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

  it('adds and removes servers', () => {
    const server = { id: 's1', name: 'Node 1', agentId: 'a1', createdAt: 0, updatedAt: 0 };
    useStore.getState().addServer(server);
    expect(useStore.getState().servers).toHaveLength(1);
    expect(useStore.getState().servers[0].name).toBe('Node 1');

    useStore.getState().removeServer('s1');
    expect(useStore.getState().servers).toHaveLength(0);
  });

  it('manages statuses', () => {
    useStore.getState().setStatus({ serverId: 's1', status: 'online', version: '1.0', lastSeenAt: Date.now() });
    expect(useStore.getState().statuses.get('s1')?.status).toBe('online');

    useStore.getState().setStatuses({ s2: { status: 'offline', version: '1.0', lastSeenAt: 0 } });
    expect(useStore.getState().statuses.get('s2')?.status).toBe('offline');
  });

  it('manages toasts with auto-dismiss', async () => {
    useStore.getState().addToast('Test', 'Body', 'info');
    expect(useStore.getState().toasts).toHaveLength(1);

    const toastId = useStore.getState().toasts[0].id;
    useStore.getState().dismissToast(toastId);
    expect(useStore.getState().toasts).toHaveLength(0);
  });

  it('upserts tasks', () => {
    const task = {
      id: 't1', serverId: 's1', command: 'python train.py', cwd: '/home',
      user: 'alice', status: 'queued' as const, priority: 100,
      requireVramMb: 4096, requireGpuCount: 1, launchMode: 'hold' as const,
      pid: null, exitCode: null, assignedGpus: null, declaredVramPerGpu: null,
      scheduleHistory: [], createdAt: 0, startedAt: null, finishedAt: null,
    };
    useStore.getState().upsertTask(task);
    expect(useStore.getState().tasks).toHaveLength(1);

    useStore.getState().upsertTask({ ...task, status: 'running' as const });
    expect(useStore.getState().tasks).toHaveLength(1);
    expect(useStore.getState().tasks[0].status).toBe('running');
  });
});
