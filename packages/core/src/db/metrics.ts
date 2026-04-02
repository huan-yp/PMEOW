import { getDatabase } from './database.js';
import type { MetricsSnapshot } from '../types.js';

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

export function cleanOldMetrics(retentionDays: number): number {
  const db = getDatabase();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = db.prepare('DELETE FROM metrics WHERE timestamp < ?').run(cutoff);
  return result.changes;
}

function serializeMetricsSnapshot(snapshot: MetricsSnapshot): string {
  return JSON.stringify(snapshot);
}

function deserializeMetricsSnapshot(data: string): MetricsSnapshot {
  return JSON.parse(data) as MetricsSnapshot;
}
