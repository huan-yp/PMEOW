import { getDatabase } from './database.js';
import type { AlertRecord, AlertType } from '../types.js';

export function upsertAlert(serverId: string, alertType: AlertType, value: number | null, threshold: number | null): AlertRecord {
  const db = getDatabase();
  const now = Date.now();

  db.prepare(
    `INSERT INTO alerts (server_id, alert_type, value, threshold, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(server_id, alert_type) DO UPDATE SET
       value = excluded.value,
       threshold = excluded.threshold,
       updated_at = excluded.updated_at`
  ).run(serverId, alertType, value, threshold, now, now);

  const row = db.prepare('SELECT * FROM alerts WHERE server_id = ? AND alert_type = ?').get(serverId, alertType) as Record<string, unknown>;
  return mapAlertRow(row);
}

export function getAlerts(serverId?: string): AlertRecord[] {
  const db = getDatabase();
  if (serverId) {
    const rows = db.prepare('SELECT * FROM alerts WHERE server_id = ? ORDER BY updated_at DESC').all(serverId) as Record<string, unknown>[];
    return rows.map(mapAlertRow);
  }
  const rows = db.prepare('SELECT * FROM alerts ORDER BY updated_at DESC').all() as Record<string, unknown>[];
  return rows.map(mapAlertRow);
}

export function suppressAlert(id: number, until: number): void {
  const db = getDatabase();
  db.prepare('UPDATE alerts SET suppressed_until = ? WHERE id = ?').run(until, id);
}

export function unsuppressAlert(id: number): void {
  const db = getDatabase();
  db.prepare('UPDATE alerts SET suppressed_until = NULL WHERE id = ?').run(id);
}

export function deleteAlertsByServerId(serverId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM alerts WHERE server_id = ?').run(serverId);
}

function mapAlertRow(r: Record<string, unknown>): AlertRecord {
  return {
    id: r.id as number,
    serverId: r.server_id as string,
    alertType: r.alert_type as string,
    value: r.value as number | null,
    threshold: r.threshold as number | null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    suppressedUntil: r.suppressed_until as number | null,
  };
}
