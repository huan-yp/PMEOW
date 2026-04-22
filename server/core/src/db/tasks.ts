import { getDatabase } from './database.js';
import type { TaskInfo, TaskRecord, ScheduleEvaluation } from '../types.js';

const WINDOW_TIER = 'window_5s';
const ARCHIVE_TIER = 'archive_15m';
const WINDOW_SECONDS = 5;
const WINDOW_RETENTION_SECONDS = 5 * 60;
const ARCHIVE_SECONDS = 15 * 60;

export interface TaskQueryFilter {
  serverId?: string;
  status?: string;
  user?: string;
  personId?: string;
  limit?: number;
  offset?: number;
}

export function upsertTask(serverId: string, task: TaskInfo): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO tasks (
      id, server_id, status, command, cwd, user, launch_mode, require_vram_mb, require_vram_omitted, require_gpu_count,
      gpu_ids, priority, created_at, started_at, finished_at, pid, exit_code, assigned_gpus,
      declared_vram_per_gpu, schedule_history, end_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      server_id = excluded.server_id,
      status = excluded.status,
      started_at = excluded.started_at,
      finished_at = excluded.finished_at,
      pid = excluded.pid,
      exit_code = excluded.exit_code,
      assigned_gpus = excluded.assigned_gpus,
      declared_vram_per_gpu = excluded.declared_vram_per_gpu,
      schedule_history = excluded.schedule_history,
      priority = excluded.priority,
      end_reason = excluded.end_reason,
      require_vram_omitted = excluded.require_vram_omitted`
  ).run(
    task.taskId,
    serverId,
    task.status,
    task.command,
    task.cwd,
    task.user,
    task.launchMode,
    task.requireVramMb,
    task.requireVramOmitted ? 1 : 0,
    task.requireGpuCount,
    task.gpuIds ? JSON.stringify(task.gpuIds) : null,
    task.priority,
    task.createdAt,
    task.startedAt,
    task.finishedAt,
    task.pid,
    task.exitCode,
    task.assignedGpus ? JSON.stringify(task.assignedGpus) : null,
    task.declaredVramPerGpu,
    task.scheduleHistory.length > 0 ? JSON.stringify(task.scheduleHistory) : null,
    task.endReason,
  );
}

export function upsertTaskScheduleSnapshot(
  serverId: string,
  task: TaskInfo,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): void {
  const latest = getLatestScheduleEvaluation(task.scheduleHistory);
  if (!latest) {
    return;
  }

  const db = getDatabase();
  const snapshotJson = JSON.stringify(latest);

  upsertScheduleSnapshot(
    db,
    task.taskId,
    serverId,
    ARCHIVE_TIER,
    floorToBucket(latest.timestamp, ARCHIVE_SECONDS),
    latest,
    snapshotJson,
    nowSeconds,
  );

  if (latest.timestamp >= nowSeconds - WINDOW_RETENTION_SECONDS) {
    upsertScheduleSnapshot(
      db,
      task.taskId,
      serverId,
      WINDOW_TIER,
      floorToBucket(latest.timestamp, WINDOW_SECONDS),
      latest,
      snapshotJson,
      nowSeconds,
    );
  }

  db.prepare(
    `DELETE FROM task_schedule_snapshots
     WHERE task_id = ?
       AND tier = ?
       AND bucket_start < ?`
  ).run(task.taskId, WINDOW_TIER, nowSeconds - WINDOW_RETENTION_SECONDS);
}

export function getTaskScheduleHistory(
  taskId: string,
  rawHistory: string | null = null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): ScheduleEvaluation[] {
  const db = getDatabase();
  const cutoff = nowSeconds - WINDOW_RETENTION_SECONDS;
  const rows = db.prepare(
    `SELECT snapshot_json
     FROM task_schedule_snapshots
     WHERE task_id = ?
       AND ((tier = ? AND bucket_start >= ?) OR (tier = ? AND bucket_start < ?))
     ORDER BY source_timestamp DESC`
  ).all(taskId, WINDOW_TIER, cutoff, ARCHIVE_TIER, cutoff) as Array<{ snapshot_json: string }>;

  if (rows.length === 0) {
    return parseScheduleHistory(rawHistory);
  }

  const history = rows.flatMap((row) => {
    const entry = parseScheduleEvaluation(row.snapshot_json);
    return entry ? [entry] : [];
  });

  return history.sort((left, right) => right.timestamp - left.timestamp);
}

export function endTask(taskId: string, finishedAt: number, exitCode: number | null = null, status: string = 'ended', endReason: string | null = null): void {
  const db = getDatabase();
  db.prepare(
    'UPDATE tasks SET status = ?, finished_at = ?, exit_code = ?, end_reason = ? WHERE id = ?'
  ).run(status, finishedAt, exitCode, endReason, taskId);
}

export function getTasks(filter: TaskQueryFilter = {}): TaskRecord[] {
  const db = getDatabase();
  let sql = 'SELECT t.*, s.name AS server_name FROM tasks t LEFT JOIN servers s ON s.id = t.server_id';
  const { conditions, params } = buildTaskQuery(filter, 't');
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY t.created_at DESC';

  if (filter.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(filter.limit);
    if (filter.offset !== undefined) {
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

export function countTasks(filter: TaskQueryFilter = {}): number {
  const db = getDatabase();
  let sql = 'SELECT COUNT(*) as cnt FROM tasks t';
  const { conditions, params } = buildTaskQuery(filter, 't');
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  const row = db.prepare(sql).get(...params) as { cnt: number };
  return row.cnt;
}

function buildTaskQuery(filter: TaskQueryFilter, taskAlias: string): { conditions: string[]; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.serverId) {
    conditions.push(`${taskAlias}.server_id = ?`);
    params.push(filter.serverId);
  }
  if (filter.status) {
    conditions.push(`${taskAlias}.status = ?`);
    params.push(filter.status);
  }
  if (filter.user) {
    conditions.push(`${taskAlias}.user = ?`);
    params.push(filter.user);
  }
  if (filter.personId) {
    const now = Date.now();
    conditions.push(`EXISTS (
      SELECT 1
      FROM person_bindings pb
      WHERE pb.person_id = ?
        AND pb.server_id = ${taskAlias}.server_id
        AND pb.system_user = ${taskAlias}.user
        AND pb.enabled = 1
        AND (pb.effective_from IS NULL OR pb.effective_from <= ?)
        AND (pb.effective_to IS NULL OR pb.effective_to > ?)
    )`);
    params.push(filter.personId, now, now);
  }

  return { conditions, params };
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
    requireVramOmitted: Boolean(r.require_vram_omitted),
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

function upsertScheduleSnapshot(
  db: ReturnType<typeof getDatabase>,
  taskId: string,
  serverId: string,
  tier: string,
  bucketStart: number,
  snapshot: ScheduleEvaluation,
  snapshotJson: string,
  nowSeconds: number,
): void {
  db.prepare(
    `INSERT INTO task_schedule_snapshots (
      task_id, server_id, tier, bucket_start, source_timestamp, snapshot_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id, tier, bucket_start) DO UPDATE SET
      server_id = excluded.server_id,
      source_timestamp = excluded.source_timestamp,
      snapshot_json = excluded.snapshot_json,
      updated_at = excluded.updated_at`
  ).run(taskId, serverId, tier, bucketStart, snapshot.timestamp, snapshotJson, nowSeconds);
}

function getLatestScheduleEvaluation(history: ScheduleEvaluation[]): ScheduleEvaluation | null {
  if (history.length === 0) {
    return null;
  }

  return [...history].sort((left, right) => right.timestamp - left.timestamp)[0] ?? null;
}

function floorToBucket(timestamp: number, bucketSeconds: number): number {
  return Math.floor(timestamp / bucketSeconds) * bucketSeconds;
}

function parseScheduleHistory(rawHistory: string | null): ScheduleEvaluation[] {
  if (!rawHistory) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawHistory) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((entry) => {
      const evaluation = normalizeScheduleEvaluation(entry);
      return evaluation ? [evaluation] : [];
    });
  } catch {
    return [];
  }
}

function parseScheduleEvaluation(raw: string): ScheduleEvaluation | null {
  try {
    return normalizeScheduleEvaluation(JSON.parse(raw));
  } catch {
    return null;
  }
}

function normalizeScheduleEvaluation(value: unknown): ScheduleEvaluation | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const candidate = value as Partial<ScheduleEvaluation> & { gpuSnapshot?: Record<string, number> };
  if (typeof candidate.timestamp !== 'number' || typeof candidate.result !== 'string' || typeof candidate.detail !== 'string') {
    return null;
  }

  return {
    timestamp: candidate.timestamp,
    result: candidate.result as ScheduleEvaluation['result'],
    gpuSnapshot: candidate.gpuSnapshot ?? {},
    detail: candidate.detail,
  };
}