import { getDatabase } from './database.js';
import type { MetricsSnapshot, MetricsBucketRow, BucketSize } from '../types.js';

interface StoredMetricsRow {
  data: string;
}

export function saveMetrics(snapshot: MetricsSnapshot): void {
  const db = getDatabase();
  db.prepare(
    'INSERT INTO metrics (serverId, timestamp, data) VALUES (?, ?, ?)'
  ).run(snapshot.serverId, snapshot.timestamp, serializeMetricsSnapshot(snapshot));
}

export function getLatestMetrics(serverId: string): MetricsSnapshot | undefined {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT data FROM metrics WHERE serverId = ? ORDER BY timestamp DESC LIMIT 1'
  ).get(serverId) as StoredMetricsRow | undefined;
  return row ? deserializeMetricsSnapshot(row.data) : undefined;
}

export function getMetricsHistory(serverId: string, from: number, to: number): MetricsSnapshot[] {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT data FROM metrics WHERE serverId = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC'
  ).all(serverId, from, to) as StoredMetricsRow[];
  return rows.map(row => deserializeMetricsSnapshot(row.data));
}

/**
 * Query metrics history with automatic source selection.
 * - If the requested range falls within raw retention, aggregate raw snapshots on-the-fly.
 * - Otherwise, read from pre-computed metrics_agg table.
 * - bucketMs is auto-selected from the time range if not provided.
 */
export function getMetricsBucketed(
  serverId: string,
  from: number,
  to: number,
  bucketMs?: number,
  rawRetentionDays = 7,
): { source: 'raw' | 'agg'; bucketMs: number; buckets: MetricsBucketRow[] } {
  const resolvedBucketMs = bucketMs ?? autoSelectBucket(to - from);
  const rawCutoff = Date.now() - rawRetentionDays * 86_400_000;

  if (from >= rawCutoff) {
    // Entirely within raw window — aggregate from raw snapshots
    return {
      source: 'raw',
      bucketMs: resolvedBucketMs,
      buckets: aggregateRawSnapshots(serverId, from, to, resolvedBucketMs),
    };
  }

  // Read from pre-computed aggregation table
  // Pick the finest available bucket size that is <= requestedBucketMs
  const aggBucketSize: BucketSize = resolvedBucketMs >= 900_000 ? 900_000 : 60_000;
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM metrics_agg
    WHERE serverId = ? AND bucketSize = ? AND bucketStart >= ? AND bucketStart < ?
    ORDER BY bucketStart ASC
  `).all(serverId, aggBucketSize, from, to) as MetricsBucketRow[];

  // If requested bucket is larger than the stored bucket, re-aggregate
  if (resolvedBucketMs > aggBucketSize) {
    return {
      source: 'agg',
      bucketMs: resolvedBucketMs,
      buckets: reaggregateBuckets(rows, resolvedBucketMs, serverId),
    };
  }

  return { source: 'agg', bucketMs: aggBucketSize, buckets: rows };
}

/**
 * Run aggregation for raw metrics data within a time range, writing results to metrics_agg.
 * Called by the scheduler pipeline.
 */
export function aggregateMetrics(bucketSizeMs: BucketSize, fromMs: number, toMs: number): number {
  const db = getDatabase();

  // Get distinct serverIds that have data in this range
  const serverIds = db.prepare(
    'SELECT DISTINCT serverId FROM metrics WHERE timestamp >= ? AND timestamp < ?'
  ).all(fromMs, toMs) as Array<{ serverId: string }>;

  let totalWritten = 0;

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO metrics_agg (
      serverId, bucketStart, bucketSize,
      cpuAvg, cpuMax, memUsedAvgMB, memUsedMaxMB, memTotalMB, memPercAvg,
      swapUsedAvgMB, swapPercAvg,
      gpuUtilAvg, gpuUtilMax, gpuMemUsedAvgMB, gpuMemUsedMaxMB, gpuMemTotalMB, gpuMemPercAvg,
      gpuTempAvg, gpuTempMax,
      netRxAvgBps, netTxAvgBps, diskReadAvgKBs, diskWriteAvgKBs, diskUsageJson,
      internetReachableRatio, internetLatencyAvgMs, sampleCount
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((sid: string, buckets: MetricsBucketRow[]) => {
    for (const b of buckets) {
      upsert.run(
        sid, b.bucketStart, b.bucketSize,
        b.cpuAvg, b.cpuMax, b.memUsedAvgMB, b.memUsedMaxMB, b.memTotalMB, b.memPercAvg,
        b.swapUsedAvgMB, b.swapPercAvg,
        b.gpuUtilAvg, b.gpuUtilMax, b.gpuMemUsedAvgMB, b.gpuMemUsedMaxMB, b.gpuMemTotalMB, b.gpuMemPercAvg,
        b.gpuTempAvg, b.gpuTempMax,
        b.netRxAvgBps, b.netTxAvgBps, b.diskReadAvgKBs, b.diskWriteAvgKBs, b.diskUsageJson,
        b.internetReachableRatio, b.internetLatencyAvgMs, b.sampleCount,
      );
    }
    return buckets.length;
  });

  for (const { serverId } of serverIds) {
    const buckets = aggregateRawSnapshots(serverId, fromMs, toMs, bucketSizeMs);
    if (buckets.length > 0) {
      totalWritten += insertMany(serverId, buckets);
    }
  }

  return totalWritten;
}

/**
 * Build 15-minute aggregation from existing 1-minute buckets.
 */
export function aggregateMetrics15mFrom1m(fromMs: number, toMs: number): number {
  const db = getDatabase();
  const BUCKET_1M = 60_000;
  const BUCKET_15M = 900_000;

  const serverIds = db.prepare(
    'SELECT DISTINCT serverId FROM metrics_agg WHERE bucketSize = ? AND bucketStart >= ? AND bucketStart < ?'
  ).all(BUCKET_1M, fromMs, toMs) as Array<{ serverId: string }>;

  let totalWritten = 0;

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO metrics_agg (
      serverId, bucketStart, bucketSize,
      cpuAvg, cpuMax, memUsedAvgMB, memUsedMaxMB, memTotalMB, memPercAvg,
      swapUsedAvgMB, swapPercAvg,
      gpuUtilAvg, gpuUtilMax, gpuMemUsedAvgMB, gpuMemUsedMaxMB, gpuMemTotalMB, gpuMemPercAvg,
      gpuTempAvg, gpuTempMax,
      netRxAvgBps, netTxAvgBps, diskReadAvgKBs, diskWriteAvgKBs, diskUsageJson,
      internetReachableRatio, internetLatencyAvgMs, sampleCount
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const { serverId } of serverIds) {
    const rows = db.prepare(`
      SELECT * FROM metrics_agg
      WHERE serverId = ? AND bucketSize = ? AND bucketStart >= ? AND bucketStart < ?
      ORDER BY bucketStart ASC
    `).all(serverId, BUCKET_1M, fromMs, toMs) as MetricsBucketRow[];

    const merged = reaggregateBuckets(rows, BUCKET_15M, serverId);
    const insertBatch = db.transaction((buckets: MetricsBucketRow[]) => {
      for (const b of buckets) {
        upsert.run(
          serverId, b.bucketStart, BUCKET_15M,
          b.cpuAvg, b.cpuMax, b.memUsedAvgMB, b.memUsedMaxMB, b.memTotalMB, b.memPercAvg,
          b.swapUsedAvgMB, b.swapPercAvg,
          b.gpuUtilAvg, b.gpuUtilMax, b.gpuMemUsedAvgMB, b.gpuMemUsedMaxMB, b.gpuMemTotalMB, b.gpuMemPercAvg,
          b.gpuTempAvg, b.gpuTempMax,
          b.netRxAvgBps, b.netTxAvgBps, b.diskReadAvgKBs, b.diskWriteAvgKBs, b.diskUsageJson,
          b.internetReachableRatio, b.internetLatencyAvgMs, b.sampleCount,
        );
      }
      return buckets.length;
    });
    totalWritten += insertBatch(merged);
  }

  return totalWritten;
}

export function cleanOldMetrics(retentionDays: number): number {
  const db = getDatabase();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = db.prepare('DELETE FROM metrics WHERE timestamp < ?').run(cutoff);
  return result.changes;
}

export function cleanOldMetricsAgg(retentionDays: number): number {
  const db = getDatabase();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = db.prepare('DELETE FROM metrics_agg WHERE bucketStart < ?').run(cutoff);
  return result.changes;
}

export function getAggregationCursor(id: string): number {
  const db = getDatabase();
  const row = db.prepare('SELECT lastAggregatedAt FROM aggregation_cursor WHERE id = ?').get(id) as { lastAggregatedAt: number } | undefined;
  return row?.lastAggregatedAt ?? 0;
}

export function setAggregationCursor(id: string, timestamp: number): void {
  const db = getDatabase();
  db.prepare('INSERT OR REPLACE INTO aggregation_cursor (id, lastAggregatedAt) VALUES (?, ?)').run(id, timestamp);
}

// ── Internal helpers ──

function autoSelectBucket(rangeMs: number): number {
  if (rangeMs <= 3_600_000) return 60_000;         // ≤1h → 1min buckets
  if (rangeMs <= 6 * 3_600_000) return 60_000;     // ≤6h → 1min buckets
  if (rangeMs <= 24 * 3_600_000) return 60_000;    // ≤24h → 1min buckets
  if (rangeMs <= 7 * 86_400_000) return 900_000;   // ≤7d → 15min buckets
  return 900_000;                                   // >7d → 15min buckets
}

function aggregateRawSnapshots(
  serverId: string,
  from: number,
  to: number,
  bucketSizeMs: number,
): MetricsBucketRow[] {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT data FROM metrics WHERE serverId = ? AND timestamp >= ? AND timestamp < ? ORDER BY timestamp ASC'
  ).all(serverId, from, to) as StoredMetricsRow[];

  const bucketMap = new Map<number, {
    cpuSum: number; cpuMax: number;
    memUsedSum: number; memUsedMax: number; memTotal: number; memPercSum: number;
    swapUsedSum: number; swapPercSum: number;
    gpuUtilSum: number; gpuUtilMax: number;
    gpuMemUsedSum: number; gpuMemUsedMax: number; gpuMemTotal: number; gpuMemPercSum: number;
    gpuTempSum: number; gpuTempMax: number;
    netRxSum: number; netTxSum: number;
    diskReadSum: number; diskWriteSum: number;
    diskUsageMap: Map<string, { percSum: number; percMax: number; count: number }>;
    internetReachableCount: number; internetProbeCount: number;
    internetLatencySum: number; internetLatencyCount: number;
    count: number;
  }>();

  for (const row of rows) {
    const snap = deserializeMetricsSnapshot(row.data);
    const bucketStart = Math.floor(snap.timestamp / bucketSizeMs) * bucketSizeMs;

    let agg = bucketMap.get(bucketStart);
    if (!agg) {
      agg = {
        cpuSum: 0, cpuMax: 0,
        memUsedSum: 0, memUsedMax: 0, memTotal: 0, memPercSum: 0,
        swapUsedSum: 0, swapPercSum: 0,
        gpuUtilSum: 0, gpuUtilMax: 0,
        gpuMemUsedSum: 0, gpuMemUsedMax: 0, gpuMemTotal: 0, gpuMemPercSum: 0,
        gpuTempSum: 0, gpuTempMax: 0,
        netRxSum: 0, netTxSum: 0,
        diskReadSum: 0, diskWriteSum: 0,
        diskUsageMap: new Map(),
        internetReachableCount: 0, internetProbeCount: 0,
        internetLatencySum: 0, internetLatencyCount: 0,
        count: 0,
      };
      bucketMap.set(bucketStart, agg);
    }

    agg.count++;
    agg.cpuSum += snap.cpu.usagePercent;
    agg.cpuMax = Math.max(agg.cpuMax, snap.cpu.usagePercent);
    agg.memUsedSum += snap.memory.usedMB;
    agg.memUsedMax = Math.max(agg.memUsedMax, snap.memory.usedMB);
    agg.memTotal = snap.memory.totalMB;
    agg.memPercSum += snap.memory.usagePercent;
    agg.swapUsedSum += snap.memory.swapUsedMB;
    agg.swapPercSum += snap.memory.swapPercent;

    if (snap.gpu.available) {
      agg.gpuUtilSum += snap.gpu.utilizationPercent;
      agg.gpuUtilMax = Math.max(agg.gpuUtilMax, snap.gpu.utilizationPercent);
      agg.gpuMemUsedSum += snap.gpu.usedMemoryMB;
      agg.gpuMemUsedMax = Math.max(agg.gpuMemUsedMax, snap.gpu.usedMemoryMB);
      agg.gpuMemTotal = snap.gpu.totalMemoryMB;
      agg.gpuMemPercSum += snap.gpu.memoryUsagePercent;
      agg.gpuTempSum += snap.gpu.temperatureC;
      agg.gpuTempMax = Math.max(agg.gpuTempMax, snap.gpu.temperatureC);
    }

    agg.netRxSum += snap.network.rxBytesPerSec;
    agg.netTxSum += snap.network.txBytesPerSec;
    agg.diskReadSum += snap.disk.ioReadKBs;
    agg.diskWriteSum += snap.disk.ioWriteKBs;

    for (const d of snap.disk.disks) {
      let du = agg.diskUsageMap.get(d.mountPoint);
      if (!du) {
        du = { percSum: 0, percMax: 0, count: 0 };
        agg.diskUsageMap.set(d.mountPoint, du);
      }
      du.percSum += d.usagePercent;
      du.percMax = Math.max(du.percMax, d.usagePercent);
      du.count++;
    }

    if (snap.network.internetReachable !== undefined) {
      agg.internetProbeCount++;
      if (snap.network.internetReachable) agg.internetReachableCount++;
      if (snap.network.internetLatencyMs != null) {
        agg.internetLatencySum += snap.network.internetLatencyMs;
        agg.internetLatencyCount++;
      }
    }
  }

  const result: MetricsBucketRow[] = [];
  for (const [bucketStart, a] of bucketMap) {
    const n = a.count;
    const diskUsage = Array.from(a.diskUsageMap.entries()).map(([mountPoint, du]) => ({
      mountPoint,
      avgPercent: Math.round((du.percSum / du.count) * 100) / 100,
      maxPercent: du.percMax,
    }));

    result.push({
      serverId,
      bucketStart,
      bucketSize: bucketSizeMs,
      cpuAvg: Math.round((a.cpuSum / n) * 100) / 100,
      cpuMax: a.cpuMax,
      memUsedAvgMB: Math.round((a.memUsedSum / n) * 100) / 100,
      memUsedMaxMB: a.memUsedMax,
      memTotalMB: a.memTotal,
      memPercAvg: Math.round((a.memPercSum / n) * 100) / 100,
      swapUsedAvgMB: Math.round((a.swapUsedSum / n) * 100) / 100,
      swapPercAvg: Math.round((a.swapPercSum / n) * 100) / 100,
      gpuUtilAvg: Math.round((a.gpuUtilSum / n) * 100) / 100,
      gpuUtilMax: a.gpuUtilMax,
      gpuMemUsedAvgMB: Math.round((a.gpuMemUsedSum / n) * 100) / 100,
      gpuMemUsedMaxMB: a.gpuMemUsedMax,
      gpuMemTotalMB: a.gpuMemTotal,
      gpuMemPercAvg: Math.round((a.gpuMemPercSum / n) * 100) / 100,
      gpuTempAvg: Math.round((a.gpuTempSum / n) * 100) / 100,
      gpuTempMax: a.gpuTempMax,
      netRxAvgBps: Math.round((a.netRxSum / n) * 100) / 100,
      netTxAvgBps: Math.round((a.netTxSum / n) * 100) / 100,
      diskReadAvgKBs: Math.round((a.diskReadSum / n) * 100) / 100,
      diskWriteAvgKBs: Math.round((a.diskWriteSum / n) * 100) / 100,
      diskUsageJson: JSON.stringify(diskUsage),
      internetReachableRatio: a.internetProbeCount > 0
        ? Math.round((a.internetReachableCount / a.internetProbeCount) * 1000) / 1000
        : 0,
      internetLatencyAvgMs: a.internetLatencyCount > 0
        ? Math.round((a.internetLatencySum / a.internetLatencyCount) * 100) / 100
        : null,
      sampleCount: n,
    });
  }

  return result.sort((a, b) => a.bucketStart - b.bucketStart);
}

function reaggregateBuckets(
  fineBuckets: MetricsBucketRow[],
  targetBucketMs: number,
  serverId: string,
): MetricsBucketRow[] {
  const grouped = new Map<number, MetricsBucketRow[]>();
  for (const b of fineBuckets) {
    const coarseBucket = Math.floor(b.bucketStart / targetBucketMs) * targetBucketMs;
    let arr = grouped.get(coarseBucket);
    if (!arr) {
      arr = [];
      grouped.set(coarseBucket, arr);
    }
    arr.push(b);
  }

  const result: MetricsBucketRow[] = [];
  for (const [bucketStart, group] of grouped) {
    let totalSamples = 0;
    let cpuWSum = 0, cpuMax = 0;
    let memUsedWSum = 0, memUsedMax = 0, memTotal = 0, memPercWSum = 0;
    let swapUsedWSum = 0, swapPercWSum = 0;
    let gpuUtilWSum = 0, gpuUtilMax = 0;
    let gpuMemUsedWSum = 0, gpuMemUsedMax = 0, gpuMemTotal = 0, gpuMemPercWSum = 0;
    let gpuTempWSum = 0, gpuTempMax = 0;
    let netRxWSum = 0, netTxWSum = 0;
    let diskReadWSum = 0, diskWriteWSum = 0;
    let reachableWSum = 0, latencyWSum = 0, latencyCount = 0;
    const diskMap = new Map<string, { percWSum: number; percMax: number; totalSamples: number }>();

    for (const b of group) {
      const w = b.sampleCount;
      totalSamples += w;
      cpuWSum += b.cpuAvg * w; cpuMax = Math.max(cpuMax, b.cpuMax);
      memUsedWSum += b.memUsedAvgMB * w; memUsedMax = Math.max(memUsedMax, b.memUsedMaxMB);
      memTotal = b.memTotalMB; memPercWSum += b.memPercAvg * w;
      swapUsedWSum += b.swapUsedAvgMB * w; swapPercWSum += b.swapPercAvg * w;
      gpuUtilWSum += b.gpuUtilAvg * w; gpuUtilMax = Math.max(gpuUtilMax, b.gpuUtilMax);
      gpuMemUsedWSum += b.gpuMemUsedAvgMB * w; gpuMemUsedMax = Math.max(gpuMemUsedMax, b.gpuMemUsedMaxMB);
      gpuMemTotal = b.gpuMemTotalMB; gpuMemPercWSum += b.gpuMemPercAvg * w;
      gpuTempWSum += b.gpuTempAvg * w; gpuTempMax = Math.max(gpuTempMax, b.gpuTempMax);
      netRxWSum += b.netRxAvgBps * w; netTxWSum += b.netTxAvgBps * w;
      diskReadWSum += b.diskReadAvgKBs * w; diskWriteWSum += b.diskWriteAvgKBs * w;
      reachableWSum += b.internetReachableRatio * w;
      if (b.internetLatencyAvgMs != null) {
        latencyWSum += b.internetLatencyAvgMs * w;
        latencyCount += w;
      }

      const diskArr = JSON.parse(b.diskUsageJson) as Array<{ mountPoint: string; avgPercent: number; maxPercent: number }>;
      for (const d of diskArr) {
        let dm = diskMap.get(d.mountPoint);
        if (!dm) {
          dm = { percWSum: 0, percMax: 0, totalSamples: 0 };
          diskMap.set(d.mountPoint, dm);
        }
        dm.percWSum += d.avgPercent * w;
        dm.percMax = Math.max(dm.percMax, d.maxPercent);
        dm.totalSamples += w;
      }
    }

    const n = totalSamples || 1;
    const diskUsage = Array.from(diskMap.entries()).map(([mountPoint, dm]) => ({
      mountPoint,
      avgPercent: Math.round((dm.percWSum / (dm.totalSamples || 1)) * 100) / 100,
      maxPercent: dm.percMax,
    }));

    result.push({
      serverId,
      bucketStart,
      bucketSize: targetBucketMs,
      cpuAvg: Math.round((cpuWSum / n) * 100) / 100,
      cpuMax,
      memUsedAvgMB: Math.round((memUsedWSum / n) * 100) / 100,
      memUsedMaxMB: memUsedMax,
      memTotalMB: memTotal,
      memPercAvg: Math.round((memPercWSum / n) * 100) / 100,
      swapUsedAvgMB: Math.round((swapUsedWSum / n) * 100) / 100,
      swapPercAvg: Math.round((swapPercWSum / n) * 100) / 100,
      gpuUtilAvg: Math.round((gpuUtilWSum / n) * 100) / 100,
      gpuUtilMax,
      gpuMemUsedAvgMB: Math.round((gpuMemUsedWSum / n) * 100) / 100,
      gpuMemUsedMaxMB: gpuMemUsedMax,
      gpuMemTotalMB: gpuMemTotal,
      gpuMemPercAvg: Math.round((gpuMemPercWSum / n) * 100) / 100,
      gpuTempAvg: Math.round((gpuTempWSum / n) * 100) / 100,
      gpuTempMax,
      netRxAvgBps: Math.round((netRxWSum / n) * 100) / 100,
      netTxAvgBps: Math.round((netTxWSum / n) * 100) / 100,
      diskReadAvgKBs: Math.round((diskReadWSum / n) * 100) / 100,
      diskWriteAvgKBs: Math.round((diskWriteWSum / n) * 100) / 100,
      diskUsageJson: JSON.stringify(diskUsage),
      internetReachableRatio: Math.round((reachableWSum / n) * 1000) / 1000,
      internetLatencyAvgMs: latencyCount > 0
        ? Math.round((latencyWSum / latencyCount) * 100) / 100
        : null,
      sampleCount: totalSamples,
    });
  }

  return result.sort((a, b) => a.bucketStart - b.bucketStart);
}

function serializeMetricsSnapshot(snapshot: MetricsSnapshot): string {
  return JSON.stringify(snapshot);
}

function deserializeMetricsSnapshot(data: string): MetricsSnapshot {
  return JSON.parse(data) as MetricsSnapshot;
}
