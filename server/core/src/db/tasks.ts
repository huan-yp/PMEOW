import { getDatabase } from './database.js';
import type { TaskInfo, TaskRecord, ScheduleEvaluation } from '../types.js';

export function upsertTask(serverId: string, task: TaskInfo): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO tasks (
      id, server_id, status, command, cwd, user, launch_mode, require_vram_mb, require_gpu_count,
      gpu_ids, priority, created_at, started_at, pid, assigned_gpus, declared_vram_per_gpu, schedule_history
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      started_at = excluded.started_at,
      pid = excluded.pid,
      assigned_gpus = excluded.assigned_gpus,
      declared_vram_per_gpu = excluded.declared_vram_per_gpu,
      schedule_history = excluded.schedule_history,
      priority = excluded.priority`
  ).run(
    task.taskId,
    serverId,
    task.status,
    task.command,
    task.cwd,
    task.user,
    task.launchMode,
    task.requireVramMb,
    task.requireGpuCount,
    task.gpuIds ? JSON.stringify(task.gpuIds) : null,
    task.priority,
    task.createdAt,
    task.startedAt,
    task.pid,
    task.assignedGpus ? JSON.stringify(task.assignedGpus) : null,
    task.declaredVramPerGpu,
    task.scheduleHistory.length > 0 ? JSON.stringify(task.scheduleHistory) : null,
  );
}

export function endTask(taskId: string, finishedAt: number, exitCode: number | null = null, status: string = 'ended', endReason: string | null = null): void {
  const db = getDatabase();
  db.prepare(
    'UPDATE tasks SET status = ?, finished_at = ?, exit_code = ?, end_reason = ? WHERE id = ?'
  ).run(status, finishedAt, exitCode, endReason, taskId);
}

export function getTasks(filter: { serverId?: string; status?: string; user?: string; limit?: number; offset?: number } = {}): TaskRecord[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.serverId) {
    conditions.push('t.server_id = ?');
    params.push(filter.serverId);
  }
  if (filter.status) {
    conditions.push('t.status = ?');
    params.push(filter.status);
  }
  if (filter.user) {
    conditions.push('t.user = ?');
    params.push(filter.user);
  }

  let sql = 'SELECT t.*, s.name AS server_name FROM tasks t LEFT JOIN servers s ON s.id = t.server_id';
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY t.created_at DESC';

  if (filter.limit) {
    sql += ' LIMIT ?';
    params.push(filter.limit);
    if (filter.offset) {
      sql += ' OFFSET ?';
      params.push(filter.offset);
    }
  }

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(mapTaskRow);
}

export function getTaskById(taskId: string): TaskRecord | undefined {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT t.*, s.name AS server_name FROM tasks t LEFT JOIN servers s ON s.id = t.server_id WHERE t.id = ?',
  ).get(taskId) as Record<string, unknown> | undefined;
  return row ? mapTaskRow(row) : undefined;
}

export function updateTaskPriority(taskId: string, priority: number): void {
  const db = getDatabase();
  db.prepare('UPDATE tasks SET priority = ? WHERE id = ?').run(priority, taskId);
}

export function updateTaskScheduleHistory(taskId: string, history: ScheduleEvaluation[]): void {
  const db = getDatabase();
  db.prepare('UPDATE tasks SET schedule_history = ? WHERE id = ?').run(JSON.stringify(history), taskId);
}

export function countTasks(filter: { serverId?: string; status?: string; user?: string } = {}): number {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.serverId) { conditions.push('server_id = ?'); params.push(filter.serverId); }
  if (filter.status) { conditions.push('status = ?'); params.push(filter.status); }
  if (filter.user) { conditions.push('user = ?'); params.push(filter.user); }
  let sql = 'SELECT COUNT(*) as cnt FROM tasks';
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  const row = db.prepare(sql).get(...params) as { cnt: number };
  return row.cnt;
}

function mapTaskRow(r: Record<string, unknown>): TaskRecord {
  return {
    id: r.id as string,
    serverId: r.server_id as string,
    serverName: typeof r.server_name === 'string' ? r.server_name : (r.server_id as string),
    status: r.status as string,
    command: r.command as string,
    cwd: r.cwd as string,
    user: r.user as string,
    launchMode: r.launch_mode as string,
    requireVramMb: r.require_vram_mb as number,
    requireGpuCount: r.require_gpu_count as number,
    gpuIds: r.gpu_ids as string | null,
    priority: r.priority as number,
    createdAt: r.created_at as number,
    startedAt: r.started_at as number | null,
    finishedAt: r.finished_at as number | null,
    pid: r.pid as number | null,
    exitCode: r.exit_code as number | null,
    assignedGpus: r.assigned_gpus as string | null,
    declaredVramPerGpu: r.declared_vram_per_gpu as number | null,
    scheduleHistory: r.schedule_history as string | null,
    endReason: r.end_reason as string | null,
  };
}