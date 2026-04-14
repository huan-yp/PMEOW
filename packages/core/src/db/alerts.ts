import { getDatabase } from './database.js';
import type { AlertRecord } from '../types.js';

export interface AlertQuery {
  limit?: number;
  offset?: number;
  /** true = only currently suppressed; false = only active (not suppressed); undefined = all */
  suppressed?: boolean;
}

export function saveAlert(alert: AlertRecord): void {
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO alert_history (id, serverId, serverName, metric, value, threshold, timestamp, suppressedUntil)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(alert.id, alert.serverId, alert.serverName, alert.metric, alert.value, alert.threshold, alert.timestamp, alert.suppressedUntil);
}

export function getAlerts(query: AlertQuery = {}): AlertRecord[] {
  const db = getDatabase();
  const { limit = 50, offset = 0, suppressed } = query;
  const now = Date.now();

  let where = '';
  const params: unknown[] = [];
  if (suppressed === true) {
    where = 'WHERE suppressedUntil > ?';
    params.push(now);
  } else if (suppressed === false) {
    where = 'WHERE (suppressedUntil IS NULL OR suppressedUntil <= ?)';
    params.push(now);
  }

  return db.prepare(`
    SELECT id, serverId, serverName, metric, value, threshold, timestamp, suppressedUntil
    FROM alert_history
    ${where}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as AlertRecord[];
}

export function batchSuppressAlerts(ids: string[], untilMs: number): void {
  if (ids.length === 0) return;
  const db = getDatabase();
  const placeholders = ids.map(() => '?').join(', ');
  db.transaction(() => {
    db.prepare(`UPDATE alert_history SET suppressedUntil = ? WHERE id IN (${placeholders})`).run(untilMs, ...ids);
  })();
}

export function batchUnsuppressAlerts(ids: string[]): void {
  if (ids.length === 0) return;
  const db = getDatabase();
  const placeholders = ids.map(() => '?').join(', ');
  db.transaction(() => {
    db.prepare(`UPDATE alert_history SET suppressedUntil = NULL WHERE id IN (${placeholders})`).run(...ids);
  })();
}

export function suppressAlert(id: string, untilMs: number): void {
  const db = getDatabase();
  db.prepare(`UPDATE alert_history SET suppressedUntil = ? WHERE id = ?`).run(untilMs, id);
}

export function unsuppressAlert(id: string): void {
  const db = getDatabase();
  db.prepare('UPDATE alert_history SET suppressedUntil = NULL WHERE id = ?').run(id);
}

export function getActiveSuppressions(): Map<string, number> {
  const db = getDatabase();
  const now = Date.now();
  const rows = db.prepare(`
    SELECT serverId, metric, suppressedUntil
    FROM alert_history
    WHERE suppressedUntil > ?
  `).all(now) as { serverId: string; metric: string; suppressedUntil: number }[];

  const map = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.serverId}:${row.metric}`;
    const existing = map.get(key);
    if (!existing || row.suppressedUntil > existing) {
      map.set(key, row.suppressedUntil);
    }
  }
  return map;
}

export function cleanExpiredAlerts(retentionDays: number): void {
  const db = getDatabase();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  db.prepare(`DELETE FROM alert_history WHERE timestamp < ?`).run(cutoff);
}
