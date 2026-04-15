import fs from 'fs';
import path from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { getDatabase } from './database.js';
import type { AppSettings, MetricsBucketRow, GpuUsageBucketRow } from '../types.js';

/**
 * Export aggregation data older than aggregationRetentionDays to JSONL.gz archive files.
 * Directory structure: {archivePath}/{serverId}/{YYYY-MM}/metrics_agg.jsonl.gz
 *                      {archivePath}/gpu/{YYYY-MM}/gpu_usage_agg.jsonl.gz
 *
 * After successful export, the archived rows are deleted from the online tables.
 */
export function exportArchive(settings: AppSettings): void {
  const db = getDatabase();
  const cutoff = Date.now() - settings.aggregationRetentionDays * 86_400_000;
  const archiveDir = settings.archivePath || path.join(process.cwd(), 'data', 'archive');

  // Export metrics aggregation
  const metricsRows = db.prepare(
    'SELECT * FROM metrics_agg WHERE bucketStart < ? ORDER BY serverId, bucketStart ASC'
  ).all(cutoff) as MetricsBucketRow[];

  if (metricsRows.length > 0) {
    const grouped = groupByServerAndMonth(metricsRows, r => r.serverId, r => r.bucketStart);
    for (const [key, rows] of grouped) {
      const [serverId, yearMonth] = key.split('|');
      const dir = path.join(archiveDir, serverId, yearMonth);
      writeJsonlGz(dir, 'metrics_agg.jsonl.gz', rows);
    }

    db.prepare('DELETE FROM metrics_agg WHERE bucketStart < ?').run(cutoff);
  }

  // Export GPU usage aggregation
  const gpuRows = db.prepare(
    'SELECT * FROM gpu_usage_agg WHERE bucketStart < ? ORDER BY userName, bucketStart ASC'
  ).all(cutoff) as GpuUsageBucketRow[];

  if (gpuRows.length > 0) {
    const grouped = groupByServerAndMonth(gpuRows, r => r.serverId, r => r.bucketStart);
    for (const [key, rows] of grouped) {
      const [serverId, yearMonth] = key.split('|');
      const dir = path.join(archiveDir, 'gpu', serverId, yearMonth);
      writeJsonlGz(dir, 'gpu_usage_agg.jsonl.gz', rows);
    }

    db.prepare('DELETE FROM gpu_usage_agg WHERE bucketStart < ?').run(cutoff);
  }

  // Write manifest
  if (metricsRows.length > 0 || gpuRows.length > 0) {
    const manifestPath = path.join(archiveDir, 'manifest.jsonl');
    const entry = JSON.stringify({
      exportedAt: Date.now(),
      cutoff,
      metricsRowCount: metricsRows.length,
      gpuRowCount: gpuRows.length,
    });
    fs.appendFileSync(manifestPath, entry + '\n', 'utf-8');
  }
}

function groupByServerAndMonth<T>(
  rows: T[],
  getServerId: (r: T) => string,
  getTimestamp: (r: T) => number,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const d = new Date(getTimestamp(row));
    const yearMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const key = `${getServerId(row)}|${yearMonth}`;
    let arr = map.get(key);
    if (!arr) {
      arr = [];
      map.set(key, arr);
    }
    arr.push(row);
  }
  return map;
}

function writeJsonlGz(dir: string, filename: string, rows: unknown[]): void {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);

  // For append-friendly archiving, we write synchronously with gzip
  const lines = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  const gzip = require('zlib').gzipSync(Buffer.from(lines, 'utf-8'));

  // Append mode: if file exists, we append (though gzip files aren't truly appendable,
  // each export creates a new file with timestamp suffix for safety)
  const timestampSuffix = Date.now();
  const safePath = filePath.replace('.jsonl.gz', `_${timestampSuffix}.jsonl.gz`);
  fs.writeFileSync(safePath, gzip);
}
