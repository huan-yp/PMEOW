import { getDatabase } from './database.js';

export type GpuUsageOwnerType = 'task' | 'user' | 'unknown';

export interface GpuUsageRowInput {
  gpuIndex: number;
  ownerType: GpuUsageOwnerType;
  ownerId?: string;
  userName?: string;
  taskId?: string;
  pid?: number;
  usedMemoryMB: number;
  declaredVramMB?: number;
}

export interface StoredGpuUsageRow extends GpuUsageRowInput {
  id: number;
  serverId: string;
  timestamp: number;
}

interface RawGpuUsageRow {
  id: number;
  serverId: string;
  timestamp: number;
  gpuIndex: number;
  ownerType: GpuUsageOwnerType;
  ownerId: string | null;
  userName: string | null;
  taskId: string | null;
  pid: number | null;
  usedMemoryMB: number;
  declaredVramMB: number | null;
}

export function saveGpuUsageRows(serverId: string, timestamp: number, rows: GpuUsageRowInput[]): number {
  const db = getDatabase();
  const deleteExisting = db.prepare('DELETE FROM gpu_usage_stats WHERE serverId = ? AND timestamp = ?');
  const insertRow = db.prepare(`
    INSERT INTO gpu_usage_stats (
      serverId,
      timestamp,
      gpuIndex,
      ownerType,
      ownerId,
      userName,
      taskId,
      pid,
      usedMemoryMB,
      declaredVramMB
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const saveBatch = db.transaction((currentServerId: string, currentTimestamp: number, currentRows: GpuUsageRowInput[]) => {
    deleteExisting.run(currentServerId, currentTimestamp);

    for (const row of currentRows) {
      insertRow.run(
        currentServerId,
        currentTimestamp,
        row.gpuIndex,
        row.ownerType,
        row.ownerId ?? null,
        row.userName ?? null,
        row.taskId ?? null,
        row.pid ?? null,
        row.usedMemoryMB,
        row.declaredVramMB ?? null,
      );
    }

    return currentRows.length;
  });

  return saveBatch(serverId, timestamp, rows);
}

export function getLatestGpuUsageByServerId(serverId: string): StoredGpuUsageRow[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT id, serverId, timestamp, gpuIndex, ownerType, ownerId, userName, taskId, pid, usedMemoryMB, declaredVramMB
    FROM gpu_usage_stats
    WHERE serverId = ?
      AND timestamp = (
        SELECT timestamp
        FROM gpu_usage_stats
        WHERE serverId = ?
        ORDER BY timestamp DESC
        LIMIT 1
      )
    ORDER BY gpuIndex ASC, id ASC
  `).all(serverId, serverId) as RawGpuUsageRow[];

  return rows.map(rowToStoredGpuUsageRow);
}

export function cleanOldGpuUsage(retentionDays: number): number {
  const db = getDatabase();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = db.prepare('DELETE FROM gpu_usage_stats WHERE timestamp < ?').run(cutoff);
  return result.changes;
}

function rowToStoredGpuUsageRow(row: RawGpuUsageRow): StoredGpuUsageRow {
  return {
    id: row.id,
    serverId: row.serverId,
    timestamp: row.timestamp,
    gpuIndex: row.gpuIndex,
    ownerType: row.ownerType,
    ownerId: row.ownerId ?? undefined,
    userName: row.userName ?? undefined,
    taskId: row.taskId ?? undefined,
    pid: row.pid ?? undefined,
    usedMemoryMB: row.usedMemoryMB,
    declaredVramMB: row.declaredVramMB ?? undefined,
  };
}