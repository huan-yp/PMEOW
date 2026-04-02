import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
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

  it('adds the task mirror table when opening a pre-migration database', () => {
    const dbPath = path.join(process.cwd(), 'tmp-agent-tasks-legacy.db');
    fs.rmSync(dbPath, { force: true });

    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 22,
        username TEXT NOT NULL,
        privateKeyPath TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `);
    legacyDb.close();

    const previousDbPath = process.env.MONITOR_DB_PATH;
    process.env.MONITOR_DB_PATH = dbPath;

    try {
      const db = getDatabase();
      const table = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_tasks'"
      ).get() as { name: string } | undefined;
      const columns = new Set(
        (db.prepare('PRAGMA table_info(agent_tasks)').all() as { name: string }[]).map(column => column.name)
      );

      expect(table?.name).toBe('agent_tasks');
      expect(columns.has('taskId')).toBe(true);
      expect(columns.has('updatedAt')).toBe(true);
    } finally {
      process.env.MONITOR_DB_PATH = previousDbPath;
      fs.rmSync(dbPath, { force: true });
    }
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

  it('treats identical replay payloads as idempotent', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);

    const task: MirroredAgentTaskRecord = {
      serverId: 'server-a',
      taskId: 'task-1',
      status: 'queued',
      command: 'python train.py',
      gpuIds: [0],
      priority: 5,
      createdAt: 900,
    };

    upsertAgentTask(task);

    const db = getDatabase();
    const firstWrite = db.prepare(
      'SELECT updatedAt FROM agent_tasks WHERE taskId = ?'
    ).get('task-1') as { updatedAt: number };

    upsertAgentTask({ ...task });

    const secondWrite = db.prepare(
      'SELECT COUNT(*) AS count, updatedAt FROM agent_tasks WHERE taskId = ?'
    ).get('task-1') as { count: number; updatedAt: number };

    expect(secondWrite.count).toBe(1);
    expect(secondWrite.updatedAt).toBe(firstWrite.updatedAt);
  });

  it('returns tasks ordered by updatedAt descending', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(3_000)
      .mockReturnValueOnce(4_000)
      .mockReturnValueOnce(5_000);

    upsertAgentTask({ serverId: 'server-a', taskId: 'task-1', status: 'queued' });
    upsertAgentTask({ serverId: 'server-a', taskId: 'task-2', status: 'queued' });
    upsertAgentTask({ serverId: 'server-a', taskId: 'task-3', status: 'queued' });
    upsertAgentTask({ serverId: 'server-a', taskId: 'task-1', status: 'running', startedAt: 3_500 });

    expect(getAgentTasksByServerId('server-a').map(task => task.taskId)).toEqual([
      'task-1',
      'task-3',
      'task-2',
    ]);
  });

  it('clears stale runtime fields when a task returns to queued state', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(3_000);

    upsertAgentTask({
      serverId: 'server-a',
      taskId: 'task-1',
      status: 'running',
      startedAt: 1_500,
      pid: 4321,
    });

    upsertAgentTask({
      serverId: 'server-a',
      taskId: 'task-1',
      status: 'completed',
      finishedAt: 2_500,
      exitCode: 0,
      pid: 4321,
    });

    upsertAgentTask({
      serverId: 'server-a',
      taskId: 'task-1',
      status: 'queued',
      command: 'python retry.py',
    });

    expect(getAgentTask('task-1')).toEqual({
      serverId: 'server-a',
      taskId: 'task-1',
      status: 'queued',
      command: 'python retry.py',
      gpuIds: null,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      pid: null,
    });
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