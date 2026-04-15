import { getDatabase } from './database.js';
import type {
  GpuOverviewResponse,
  GpuOverviewServerSummary,
  GpuOverviewUserSummary,
  GpuUsageSummaryItem,
  GpuUsageTimelinePoint,
  GpuUsageBucketRow,
  BucketSize,
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

export function cleanOldGpuUsageAgg(retentionDays: number): number {
  const db = getDatabase();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = db.prepare('DELETE FROM gpu_usage_agg WHERE bucketStart < ?').run(cutoff);
  return result.changes;
}

/**
 * Aggregate raw gpu_usage_stats rows into gpu_usage_agg buckets.
 * Groups by (serverId, userName) per bucket and computes avg/max VRAM, task/non-task split.
 */
export function aggregateGpuUsage(bucketSizeMs: BucketSize, fromMs: number, toMs: number): number {
  const db = getDatabase();

  // Each raw row is a per-GPU-process snapshot. We need to aggregate by (serverId, userName, timestamp)
  // first to get per-snapshot totals, then bucket those.
  const rows = db.prepare(`
    SELECT serverId, userName, timestamp, ownerType, usedMemoryMB
    FROM gpu_usage_stats
    WHERE timestamp >= ? AND timestamp < ? AND userName IS NOT NULL
    ORDER BY timestamp ASC
  `).all(fromMs, toMs) as Array<{
    serverId: string;
    userName: string;
    timestamp: number;
    ownerType: string;
    usedMemoryMB: number;
  }>;

  // Step 1: aggregate per (serverId, userName, timestamp) → snapshot-level totals
  const snapMap = new Map<string, { total: number; task: number; nonTask: number }>();
  for (const row of rows) {
    const key = `${row.serverId}|${row.userName}|${row.timestamp}`;
    let entry = snapMap.get(key);
    if (!entry) {
      entry = { total: 0, task: 0, nonTask: 0 };
      snapMap.set(key, entry);
    }
    entry.total += row.usedMemoryMB;
    if (row.ownerType === 'task') {
      entry.task += row.usedMemoryMB;
    } else {
      entry.nonTask += row.usedMemoryMB;
    }
  }

  // Step 2: bucket the snapshot-level totals
  const bucketMap = new Map<string, {
    serverId: string;
    userName: string;
    bucketStart: number;
    totalSum: number;
    totalMax: number;
    taskSum: number;
    nonTaskSum: number;
    count: number;
  }>();

  for (const [compositeKey, totals] of snapMap) {
    const [serverId, userName, tsStr] = compositeKey.split('|');
    const ts = Number(tsStr);
    const bucketStart = Math.floor(ts / bucketSizeMs) * bucketSizeMs;
    const bKey = `${serverId}|${userName}|${bucketStart}`;

    let bucket = bucketMap.get(bKey);
    if (!bucket) {
      bucket = {
        serverId,
        userName,
        bucketStart,
        totalSum: 0,
        totalMax: 0,
        taskSum: 0,
        nonTaskSum: 0,
        count: 0,
      };
      bucketMap.set(bKey, bucket);
    }
    bucket.totalSum += totals.total;
    bucket.totalMax = Math.max(bucket.totalMax, totals.total);
    bucket.taskSum += totals.task;
    bucket.nonTaskSum += totals.nonTask;
    bucket.count++;
  }

  // Step 3: write to gpu_usage_agg
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO gpu_usage_agg (
      serverId, userName, personId, bucketStart, bucketSize,
      totalVramAvgMB, totalVramMaxMB, taskVramAvgMB, nonTaskVramAvgMB, sampleCount
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let totalWritten = 0;
  const insertBatch = db.transaction((entries: typeof bucketMap) => {
    for (const b of entries.values()) {
      const n = b.count || 1;
      upsert.run(
        b.serverId, b.userName, null, b.bucketStart, bucketSizeMs,
        Math.round((b.totalSum / n) * 100) / 100,
        b.totalMax,
        Math.round((b.taskSum / n) * 100) / 100,
        Math.round((b.nonTaskSum / n) * 100) / 100,
        b.count,
      );
      totalWritten++;
    }
  });

  insertBatch(bucketMap);
  return totalWritten;
}

/**
 * Build 15-minute GPU usage aggregation from existing 1-minute buckets.
 */
export function aggregateGpuUsage15mFrom1m(fromMs: number, toMs: number): number {
  const db = getDatabase();
  const BUCKET_1M = 60_000;
  const BUCKET_15M = 900_000;

  const rows = db.prepare(`
    SELECT * FROM gpu_usage_agg
    WHERE bucketSize = ? AND bucketStart >= ? AND bucketStart < ?
    ORDER BY bucketStart ASC
  `).all(BUCKET_1M, fromMs, toMs) as GpuUsageBucketRow[];

  // Group by (serverId, userName) then re-bucket
  const grouped = new Map<string, Map<number, GpuUsageBucketRow[]>>();
  for (const r of rows) {
    const key = `${r.serverId}|${r.userName}`;
    let bMap = grouped.get(key);
    if (!bMap) {
      bMap = new Map();
      grouped.set(key, bMap);
    }
    const coarseBucket = Math.floor(r.bucketStart / BUCKET_15M) * BUCKET_15M;
    let arr = bMap.get(coarseBucket);
    if (!arr) {
      arr = [];
      bMap.set(coarseBucket, arr);
    }
    arr.push(r);
  }

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO gpu_usage_agg (
      serverId, userName, personId, bucketStart, bucketSize,
      totalVramAvgMB, totalVramMaxMB, taskVramAvgMB, nonTaskVramAvgMB, sampleCount
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let totalWritten = 0;
  const insertBatch = db.transaction(() => {
    for (const [compositeKey, bMap] of grouped) {
      const [serverId, userName] = compositeKey.split('|');
      for (const [bucketStart, group] of bMap) {
        let totalSamples = 0;
        let totalWSum = 0, totalMax = 0;
        let taskWSum = 0, nonTaskWSum = 0;

        for (const b of group) {
          const w = b.sampleCount;
          totalSamples += w;
          totalWSum += b.totalVramAvgMB * w;
          totalMax = Math.max(totalMax, b.totalVramMaxMB);
          taskWSum += b.taskVramAvgMB * w;
          nonTaskWSum += b.nonTaskVramAvgMB * w;
        }

        const n = totalSamples || 1;
        upsert.run(
          serverId, userName, group[0]?.personId ?? null, bucketStart, BUCKET_15M,
          Math.round((totalWSum / n) * 100) / 100,
          totalMax,
          Math.round((taskWSum / n) * 100) / 100,
          Math.round((nonTaskWSum / n) * 100) / 100,
          totalSamples,
        );
        totalWritten++;
      }
    }
  });

  insertBatch();
  return totalWritten;
}

/**
 * Query GPU usage history with automatic source selection.
 */
export function getGpuUsageBucketed(
  userName: string,
  from: number,
  to: number,
  bucketMs?: number,
  rawRetentionDays = 7,
): { source: 'raw' | 'agg'; bucketMs: number; buckets: GpuUsageBucketRow[] } {
  const resolvedBucketMs = bucketMs ?? autoSelectGpuBucket(to - from);
  const rawCutoff = Date.now() - rawRetentionDays * 86_400_000;

  if (from >= rawCutoff) {
    // Within raw window: compute from raw data
    return {
      source: 'raw',
      bucketMs: resolvedBucketMs,
      buckets: aggregateRawGpuUsage(userName, from, to, resolvedBucketMs),
    };
  }

  // Read from pre-computed aggregation
  const aggBucketSize: BucketSize = resolvedBucketMs >= 900_000 ? 900_000 : 60_000;
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM gpu_usage_agg
    WHERE userName = ? AND bucketSize = ? AND bucketStart >= ? AND bucketStart < ?
    ORDER BY bucketStart ASC
  `).all(userName, aggBucketSize, from, to) as GpuUsageBucketRow[];

  return { source: 'agg', bucketMs: aggBucketSize, buckets: rows };
}

function autoSelectGpuBucket(rangeMs: number): number {
  if (rangeMs <= 24 * 3_600_000) return 60_000;
  return 900_000;
}

function aggregateRawGpuUsage(
  userName: string,
  from: number,
  to: number,
  bucketSizeMs: number,
): GpuUsageBucketRow[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT serverId, timestamp, ownerType, usedMemoryMB
    FROM gpu_usage_stats
    WHERE userName = ? AND timestamp >= ? AND timestamp < ?
    ORDER BY timestamp ASC
  `).all(userName, from, to) as Array<{
    serverId: string;
    timestamp: number;
    ownerType: string;
    usedMemoryMB: number;
  }>;

  // Per-snapshot totals by (serverId, timestamp)
  const snapMap = new Map<string, { serverId: string; total: number; task: number; nonTask: number }>();
  for (const r of rows) {
    const key = `${r.serverId}|${r.timestamp}`;
    let e = snapMap.get(key);
    if (!e) {
      e = { serverId: r.serverId, total: 0, task: 0, nonTask: 0 };
      snapMap.set(key, e);
    }
    e.total += r.usedMemoryMB;
    if (r.ownerType === 'task') e.task += r.usedMemoryMB;
    else e.nonTask += r.usedMemoryMB;
  }

  // Bucket
  const bucketMap = new Map<string, {
    serverId: string;
    bucketStart: number;
    totalSum: number; totalMax: number;
    taskSum: number; nonTaskSum: number;
    count: number;
  }>();

  for (const [compositeKey, totals] of snapMap) {
    const [serverId, tsStr] = compositeKey.split('|');
    const ts = Number(tsStr);
    const bucketStart = Math.floor(ts / bucketSizeMs) * bucketSizeMs;
    const bKey = `${serverId}|${bucketStart}`;

    let b = bucketMap.get(bKey);
    if (!b) {
      b = { serverId, bucketStart, totalSum: 0, totalMax: 0, taskSum: 0, nonTaskSum: 0, count: 0 };
      bucketMap.set(bKey, b);
    }
    b.totalSum += totals.total;
    b.totalMax = Math.max(b.totalMax, totals.total);
    b.taskSum += totals.task;
    b.nonTaskSum += totals.nonTask;
    b.count++;
  }

  const result: GpuUsageBucketRow[] = [];
  for (const b of bucketMap.values()) {
    const n = b.count || 1;
    result.push({
      serverId: b.serverId,
      userName,
      personId: null,
      bucketStart: b.bucketStart,
      bucketSize: bucketSizeMs,
      totalVramAvgMB: Math.round((b.totalSum / n) * 100) / 100,
      totalVramMaxMB: b.totalMax,
      taskVramAvgMB: Math.round((b.taskSum / n) * 100) / 100,
      nonTaskVramAvgMB: Math.round((b.nonTaskSum / n) * 100) / 100,
      sampleCount: b.count,
    });
  }

  return result.sort((a, b) => a.bucketStart - b.bucketStart);
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