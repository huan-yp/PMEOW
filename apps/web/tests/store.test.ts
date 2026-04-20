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

  it('upserts tasks', () => {
    const task = {
      id: 't1', serverId: 's1', command: 'python train.py', cwd: '/home',
      user: 'alice', status: 'queued' as const, priority: 100,
      requireVramMb: 4096, requireGpuCount: 1, launchMode: 'background' as const,
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
