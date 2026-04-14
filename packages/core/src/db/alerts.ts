import { getDatabase } from './database.js';
import type { AlertRecord } from '../types.js';

export function saveAlert(alert: AlertRecord): void {
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO alert_history (id, serverId, serverName, metric, value, threshold, timestamp, suppressedUntil)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(alert.id, alert.serverId, alert.serverName, alert.metric, alert.value, alert.threshold, alert.timestamp, alert.suppressedUntil);
}

export function getAlerts(limit = 50, offset = 0): AlertRecord[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT id, serverId, serverName, metric, value, threshold, timestamp, suppressedUntil
    FROM alert_history
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as AlertRecord[];
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
