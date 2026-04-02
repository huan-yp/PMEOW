import { getDatabase } from './database.js';
import type { AgentTaskStatus, MirroredAgentTaskRecord } from '../types.js';

interface RawAgentTaskRow {
  taskId: string;
  serverId: string;
  status: string;
  command: string | null;
  cwd: string | null;
  user: string | null;
  requireVramMB: number | null;
  requireGpuCount: number | null;
  gpuIdsJson: string | null;
  priority: number | null;
  createdAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
  pid: number | null;
  updatedAt: number;
}

export function upsertAgentTask(task: MirroredAgentTaskRecord): void {
  const db = getDatabase();
  const existing = getAgentTask(task.taskId);
  const mergedTask = mergeAgentTask(existing, task);
  const updatedAt = Date.now();

  db.prepare(`
    INSERT INTO agent_tasks (
      taskId,
      serverId,
      status,
      command,
      cwd,
      user,
      requireVramMB,
      requireGpuCount,
      gpuIdsJson,
      priority,
      createdAt,
      startedAt,
      finishedAt,
      exitCode,
      pid,
      updatedAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(taskId) DO UPDATE SET
      serverId = excluded.serverId,
      status = excluded.status,
      command = excluded.command,
      cwd = excluded.cwd,
      user = excluded.user,
      requireVramMB = excluded.requireVramMB,
      requireGpuCount = excluded.requireGpuCount,
      gpuIdsJson = excluded.gpuIdsJson,
      priority = excluded.priority,
      createdAt = excluded.createdAt,
      startedAt = excluded.startedAt,
      finishedAt = excluded.finishedAt,
      exitCode = excluded.exitCode,
      pid = excluded.pid,
      updatedAt = excluded.updatedAt
  `).run(
    mergedTask.taskId,
    mergedTask.serverId,
    mergedTask.status,
    mergedTask.command ?? null,
    mergedTask.cwd ?? null,
    mergedTask.user ?? null,
    mergedTask.requireVramMB ?? null,
    mergedTask.requireGpuCount ?? null,
    serializeGpuIds(mergedTask),
    mergedTask.priority ?? null,
    mergedTask.createdAt ?? null,
    mergedTask.startedAt ?? null,
    mergedTask.finishedAt ?? null,
    mergedTask.exitCode ?? null,
    mergedTask.pid ?? null,
    updatedAt
  );
}

export function getAgentTask(taskId: string): MirroredAgentTaskRecord | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM agent_tasks WHERE taskId = ?').get(taskId) as RawAgentTaskRow | undefined;
  return row ? rowToAgentTask(row) : undefined;
}

export function getAgentTasksByServerId(serverId: string): MirroredAgentTaskRecord[] {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT * FROM agent_tasks WHERE serverId = ? ORDER BY updatedAt DESC'
  ).all(serverId) as RawAgentTaskRow[];
  return rows.map(rowToAgentTask);
}

export function deleteAgentTasksByServerId(serverId: string): number {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM agent_tasks WHERE serverId = ?').run(serverId);
  return result.changes;
}

function mergeAgentTask(
  existing: MirroredAgentTaskRecord | undefined,
  incoming: MirroredAgentTaskRecord,
): MirroredAgentTaskRecord {
  return {
    taskId: incoming.taskId,
    serverId: incoming.serverId,
    status: incoming.status,
    command: pickField(incoming, existing, 'command'),
    cwd: pickField(incoming, existing, 'cwd'),
    user: pickField(incoming, existing, 'user'),
    requireVramMB: pickField(incoming, existing, 'requireVramMB'),
    requireGpuCount: pickField(incoming, existing, 'requireGpuCount'),
    gpuIds: pickField(incoming, existing, 'gpuIds'),
    priority: pickField(incoming, existing, 'priority'),
    createdAt: pickField(incoming, existing, 'createdAt'),
    startedAt: pickField(incoming, existing, 'startedAt'),
    finishedAt: pickField(incoming, existing, 'finishedAt'),
    exitCode: pickField(incoming, existing, 'exitCode'),
    pid: pickField(incoming, existing, 'pid'),
  };
}

function pickField<K extends keyof MirroredAgentTaskRecord>(
  incoming: MirroredAgentTaskRecord,
  existing: MirroredAgentTaskRecord | undefined,
  key: K,
): MirroredAgentTaskRecord[K] {
  if (Object.prototype.hasOwnProperty.call(incoming, key)) {
    return incoming[key];
  }
  return existing?.[key] as MirroredAgentTaskRecord[K];
}

function serializeGpuIds(task: MirroredAgentTaskRecord): string | null {
  if (!Object.prototype.hasOwnProperty.call(task, 'gpuIds')) {
    return null;
  }

  return JSON.stringify(task.gpuIds ?? null);
}

function rowToAgentTask(row: RawAgentTaskRow): MirroredAgentTaskRecord {
  const task: MirroredAgentTaskRecord = {
    taskId: row.taskId,
    serverId: row.serverId,
    status: row.status as AgentTaskStatus,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    exitCode: row.exitCode,
    pid: row.pid,
  };

  if (row.command !== null) {
    task.command = row.command;
  }
  if (row.cwd !== null) {
    task.cwd = row.cwd;
  }
  if (row.user !== null) {
    task.user = row.user;
  }
  if (row.requireVramMB !== null) {
    task.requireVramMB = row.requireVramMB;
  }
  if (row.requireGpuCount !== null) {
    task.requireGpuCount = row.requireGpuCount;
  }
  if (row.priority !== null) {
    task.priority = row.priority;
  }
  if (row.createdAt !== null) {
    task.createdAt = row.createdAt;
  }
  if (row.gpuIdsJson !== null) {
    task.gpuIds = JSON.parse(row.gpuIdsJson) as number[] | null;
  }

  return task;
}