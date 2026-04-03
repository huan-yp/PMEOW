import { getDatabase } from './database.js';
import type { ServerStatusEvent } from '../types.js';

export function insertServerStatusEvent(event: Omit<ServerStatusEvent, 'id'>): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO server_status_events (serverId, fromStatus, toStatus, reason, lastSeen, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(event.serverId, event.fromStatus, event.toStatus, event.reason ?? null, event.lastSeen, event.createdAt);
}

export function listServerStatusEvents(query?: {
  serverId?: string;
  limit?: number;
  since?: number;
}): ServerStatusEvent[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query?.serverId) {
    conditions.push('serverId = ?');
    params.push(query.serverId);
  }
  if (query?.since) {
    conditions.push('createdAt >= ?');
    params.push(query.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = query?.limit ?? 100;

  return db.prepare(
    `SELECT id, serverId, fromStatus, toStatus, reason, lastSeen, createdAt
     FROM server_status_events ${where}
     ORDER BY createdAt DESC
     LIMIT ?`
  ).all(...params, limit) as ServerStatusEvent[];
}
