import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '../../src/db/database.js';
import {
  deleteAgentTasksByServerId,
  getAgentTask,
  getAgentTasksByServerId,
  upsertAgentTask,
} from '../../src/db/agent-tasks.js';
import type { MirroredAgentTaskRecord } from '../../src/types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('agent_tasks schema', () => {
  it('creates the task mirror table and index on a fresh database', () => {
    const db = getDatabase();
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_tasks'"
    ).get() as { name: string } | undefined;
    const index = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_agent_tasks_server_updated_at'"
    ).get() as { name: string } | undefined;
    const columns = new Set(
      (db.prepare('PRAGMA table_info(agent_tasks)').all() as { name: string }[]).map(column => column.name)
    );

    expect(table?.name).toBe('agent_tasks');
    expect(index?.name).toBe('idx_agent_tasks_server_updated_at');
    expect(columns).toEqual(new Set([
      'taskId',
      'serverId',
      'status',
      'command',
      'cwd',
      'user',
      'requireVramMB',
      'requireGpuCount',
      'gpuIdsJson',
      'priority',
      'createdAt',
      'startedAt',
      'finishedAt',
      'exitCode',
      'pid',
      'updatedAt',
    ]));
  });
});

describe('agent task repository', () => {
  it('upserts by taskId and preserves previous fields when updates are partial', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);

    const initialTask: MirroredAgentTaskRecord = {
      serverId: 'server-a',
      taskId: 'task-1',
      status: 'queued',
      command: 'python train.py',
      cwd: '/tmp/job',
      user: 'alice',
      requireVramMB: 4096,
      requireGpuCount: 1,
      gpuIds: [0],
      priority: 10,
      createdAt: 900,
    };

    upsertAgentTask(initialTask);
    upsertAgentTask({
      serverId: 'server-a',
      taskId: 'task-1',
      status: 'running',
      startedAt: 1_500,
      pid: 4321,
    });

    const task = getAgentTask('task-1');
    const db = getDatabase();
    const row = db.prepare(
      'SELECT COUNT(*) AS count, MAX(updatedAt) AS updatedAt FROM agent_tasks WHERE taskId = ?'
    ).get('task-1') as { count: number; updatedAt: number };

    expect(row.count).toBe(1);
    expect(row.updatedAt).toBe(2_000);
    expect(task).toEqual({
      serverId: 'server-a',
      taskId: 'task-1',
      status: 'running',
      command: 'python train.py',
      cwd: '/tmp/job',
      user: 'alice',
      requireVramMB: 4096,
      requireGpuCount: 1,
      gpuIds: [0],
      priority: 10,
      createdAt: 900,
      startedAt: 1_500,
      finishedAt: null,
      exitCode: null,
      pid: 4321,
    });
  });

  it('returns tasks ordered by updatedAt descending', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(3_000)
      .mockReturnValueOnce(4_000);

    upsertAgentTask({ serverId: 'server-a', taskId: 'task-1', status: 'queued' });
    upsertAgentTask({ serverId: 'server-a', taskId: 'task-2', status: 'queued' });
    upsertAgentTask({ serverId: 'server-a', taskId: 'task-3', status: 'queued' });
    upsertAgentTask({ serverId: 'server-a', taskId: 'task-1', status: 'running' });

    expect(getAgentTasksByServerId('server-a').map(task => task.taskId)).toEqual([
      'task-1',
      'task-3',
      'task-2',
    ]);
  });

  it('deletes only rows for the requested server', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(3_000);

    upsertAgentTask({ serverId: 'server-a', taskId: 'task-1', status: 'queued' });
    upsertAgentTask({ serverId: 'server-a', taskId: 'task-2', status: 'running' });
    upsertAgentTask({ serverId: 'server-b', taskId: 'task-3', status: 'queued' });

    expect(deleteAgentTasksByServerId('server-a')).toBe(2);
    expect(getAgentTasksByServerId('server-a')).toEqual([]);
    expect(getAgentTasksByServerId('server-b').map(task => task.taskId)).toEqual(['task-3']);
  });
});