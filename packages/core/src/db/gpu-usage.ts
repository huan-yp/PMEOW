import { getDatabase } from './database.js';
import type {
  GpuOverviewResponse,
  GpuOverviewServerSummary,
  GpuOverviewUserSummary,
  GpuUsageSummaryItem,
  GpuUsageTimelinePoint,
} from '../types.js';

export type GpuUsageOwnerType = 'task' | 'user' | 'unknown';

export interface GpuUsageRowInput {
  gpuIndex: number;
  ownerType: GpuUsageOwnerType;
  ownerId?: string;
  userName?: string;
  taskId?: string;
  pid?: number;
  command?: string;
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
  command: string | null;
  usedMemoryMB: number;
  declaredVramMB: number | null;
}

interface RawServerRow {
  id: string;
  name: string;
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
      command,
      usedMemoryMB,
      declaredVramMB
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        row.command ?? null,
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
    SELECT id, serverId, timestamp, gpuIndex, ownerType, ownerId, userName, taskId, pid, command, usedMemoryMB, declaredVramMB
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

export function getGpuUsageByServerIdAndTimestamp(serverId: string, timestamp: number): StoredGpuUsageRow[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT id, serverId, timestamp, gpuIndex, ownerType, ownerId, userName, taskId, pid, command, usedMemoryMB, declaredVramMB
    FROM gpu_usage_stats
    WHERE serverId = ? AND timestamp = ?
    ORDER BY gpuIndex ASC, id ASC
  `).all(serverId, timestamp) as RawGpuUsageRow[];

  return rows.map(rowToStoredGpuUsageRow);
}

export function getGpuOverview(): GpuOverviewResponse {
  const db = getDatabase();
  const latestRows = db.prepare(`
    SELECT usage.id, usage.serverId, usage.timestamp, usage.gpuIndex, usage.ownerType, usage.ownerId, usage.userName, usage.taskId, usage.pid, usage.command, usage.usedMemoryMB, usage.declaredVramMB
    FROM gpu_usage_stats AS usage
    INNER JOIN (
      SELECT serverId, MAX(timestamp) AS latestTimestamp
      FROM gpu_usage_stats
      GROUP BY serverId
    ) AS latest
      ON latest.serverId = usage.serverId
     AND latest.latestTimestamp = usage.timestamp
    ORDER BY usage.serverId ASC, usage.gpuIndex ASC, usage.id ASC
  `).all() as RawGpuUsageRow[];

  if (latestRows.length === 0) {
    return {
      generatedAt: 0,
      users: [],
      servers: [],
    };
  }

  const serverNames = new Map(
    (db.prepare('SELECT id, name FROM servers').all() as RawServerRow[]).map(row => [row.id, row.name])
  );
  const userMap = new Map<string, { totalVramMB: number; taskIds: Set<string>; processIds: Set<string>; serverIds: Set<string> }>();
  const serverMap = new Map<string, GpuOverviewServerSummary>();
  let generatedAt = 0;

  for (const row of latestRows) {
    generatedAt = Math.max(generatedAt, row.timestamp);

    const existingServer = serverMap.get(row.serverId) ?? {
      serverId: row.serverId,
      serverName: serverNames.get(row.serverId) ?? row.serverId,
      totalUsedMB: 0,
      totalTaskMB: 0,
      totalNonTaskMB: 0,
    };
    existingServer.totalUsedMB += row.usedMemoryMB;
    if (row.ownerType === 'task') {
      existingServer.totalTaskMB += row.usedMemoryMB;
    } else {
      existingServer.totalNonTaskMB += row.usedMemoryMB;
    }
    serverMap.set(row.serverId, existingServer);

    if (!row.userName) {
      continue;
    }

    const existingUser = userMap.get(row.userName) ?? {
      totalVramMB: 0,
      taskIds: new Set<string>(),
      processIds: new Set<string>(),
      serverIds: new Set<string>(),
    };
    existingUser.totalVramMB += row.usedMemoryMB;
    existingUser.serverIds.add(row.serverId);
    if (row.taskId) {
      existingUser.taskIds.add(row.taskId);
    }
    if (row.ownerType !== 'task' && row.pid !== null) {
      existingUser.processIds.add(`${row.serverId}:${row.pid}`);
    }
    userMap.set(row.userName, existingUser);
  }

  const users: GpuOverviewUserSummary[] = Array.from(userMap.entries())
    .map(([user, value]) => ({
      user,
      totalVramMB: value.totalVramMB,
      taskCount: value.taskIds.size,
      processCount: value.processIds.size,
      serverIds: Array.from(value.serverIds).sort(),
    }))
    .sort((left, right) => right.totalVramMB - left.totalVramMB || left.user.localeCompare(right.user));

  const servers = Array.from(serverMap.values())
    .sort((left, right) => right.totalUsedMB - left.totalUsedMB || left.serverName.localeCompare(right.serverName));

  return {
    generatedAt,
    users,
    servers,
  };
}

export function getGpuUsageSummary(hours = 168): GpuUsageSummaryItem[] {
  const db = getDatabase();
  const now = Date.now();
  const from = now - hours * 60 * 60 * 1000;
  const rows = db.prepare(`
    SELECT userName, ownerType, usedMemoryMB
    FROM gpu_usage_stats
    WHERE timestamp >= ? AND timestamp <= ? AND userName IS NOT NULL
    ORDER BY timestamp ASC, id ASC
  `).all(from, now) as Array<Pick<RawGpuUsageRow, 'userName' | 'ownerType' | 'usedMemoryMB'>>;

  const summaries = new Map<string, GpuUsageSummaryItem>();

  for (const row of rows) {
    const user = row.userName!;
    const existing = summaries.get(user) ?? {
      user,
      totalVramMB: 0,
      taskVramMB: 0,
      nonTaskVramMB: 0,
    };

    existing.totalVramMB += row.usedMemoryMB;
    if (row.ownerType === 'task') {
      existing.taskVramMB += row.usedMemoryMB;
    } else {
      existing.nonTaskVramMB += row.usedMemoryMB;
    }
    summaries.set(user, existing);
  }

  return Array.from(summaries.values())
    .sort((left, right) => right.totalVramMB - left.totalVramMB || left.user.localeCompare(right.user));
}

export function getGpuUsageTimelineByUser(
  user: string,
  hours = 168,
  bucketMinutes = 60,
): GpuUsageTimelinePoint[] {
  const db = getDatabase();
  const now = Date.now();
  const from = now - hours * 60 * 60 * 1000;
  const bucketSizeMs = bucketMinutes * 60 * 1000;
  const rows = db.prepare(`
    SELECT timestamp, userName, ownerType, usedMemoryMB
    FROM gpu_usage_stats
    WHERE userName = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC, id ASC
  `).all(user, from, now) as Array<Pick<RawGpuUsageRow, 'timestamp' | 'userName' | 'ownerType' | 'usedMemoryMB'>>;

  const points = new Map<string, GpuUsageTimelinePoint>();

  for (const row of rows) {
    const bucketStart = Math.floor(row.timestamp / bucketSizeMs) * bucketSizeMs;
    const user = row.userName!;
    const key = `${bucketStart}:${user}`;
    const existing = points.get(key) ?? {
      bucketStart,
      user,
      totalVramMB: 0,
      taskVramMB: 0,
      nonTaskVramMB: 0,
    };

    existing.totalVramMB += row.usedMemoryMB;
    if (row.ownerType === 'task') {
      existing.taskVramMB += row.usedMemoryMB;
    } else {
      existing.nonTaskVramMB += row.usedMemoryMB;
    }
    points.set(key, existing);
  }

  return Array.from(points.values())
    .sort((left, right) => left.bucketStart - right.bucketStart || left.user.localeCompare(right.user));
}

export function getLatestUnownedGpuDurationMinutes(
  serverId: string,
  now = Date.now(),
  maxGapMs = 90_000,
): number {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT timeline.timestamp,
      EXISTS (
        SELECT 1
        FROM gpu_usage_stats AS usage
        WHERE usage.serverId = ?
          AND usage.timestamp = timeline.timestamp
          AND usage.ownerType = 'unknown'
          AND usage.usedMemoryMB > 0
      ) AS isUnownedActive
    FROM (
      SELECT DISTINCT timestamp
      FROM gpu_usage_stats
      WHERE serverId = ?
        AND timestamp <= ?
    ) AS timeline
    ORDER BY timestamp DESC
  `).all(serverId, serverId, now) as Array<{ timestamp: number; isUnownedActive: number }>;

  if (rows.length === 0) {
    return 0;
  }

  if (rows[0].isUnownedActive !== 1) {
    return 0;
  }

  if (now - rows[0].timestamp > maxGapMs) {
    return 0;
  }

  let latestTimestamp = rows[0].timestamp;
  let earliestTimestamp = latestTimestamp;

  for (let index = 1; index < rows.length; index += 1) {
    const currentRow = rows[index];
    const currentTimestamp = currentRow.timestamp;
    if (earliestTimestamp - currentTimestamp > maxGapMs) {
      break;
    }
    if (currentRow.isUnownedActive !== 1) {
      break;
    }
    earliestTimestamp = currentTimestamp;
  }

  return Math.floor((latestTimestamp - earliestTimestamp) / 60_000);
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
    command: row.command ?? undefined,
    usedMemoryMB: row.usedMemoryMB,
    declaredVramMB: row.declaredVramMB ?? undefined,
  };
}