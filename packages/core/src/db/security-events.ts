import { getDatabase } from './database.js';
import type { SecurityEventDetails, SecurityEventRecord, SecurityEventType } from '../types.js';

export interface SecurityEventInput {
  serverId: string;
  eventType: SecurityEventType;
  fingerprint: string;
  details: SecurityEventDetails;
}

export interface SecurityEventQuery {
  serverId?: string;
  resolved?: boolean;
  eventType?: SecurityEventType;
  fingerprint?: string;
  limit?: number;
}

interface RawSecurityEventRow {
  id: number;
  serverId: string;
  eventType: SecurityEventType;
  fingerprint: string;
  detailsJson: string;
  resolved: number;
  resolvedBy: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export function createSecurityEvent(input: SecurityEventInput): SecurityEventRecord {
  const db = getDatabase();
  const createdAt = Date.now();
  const result = db.prepare(`
    INSERT INTO security_events (
      serverId,
      eventType,
      fingerprint,
      detailsJson,
      resolved,
      resolvedBy,
      createdAt,
      resolvedAt
    )
    VALUES (?, ?, ?, ?, 0, NULL, ?, NULL)
  `).run(
    input.serverId,
    input.eventType,
    input.fingerprint,
    JSON.stringify(input.details),
    createdAt,
  );

  return getSecurityEventById(Number(result.lastInsertRowid))!;
}

export function findOpenSecurityEvent(
  serverId: string,
  eventType: SecurityEventType,
  fingerprint: string,
): SecurityEventRecord | undefined {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT *
    FROM security_events
    WHERE serverId = ? AND eventType = ? AND fingerprint = ? AND resolved = 0
    LIMIT 1
  `).get(serverId, eventType, fingerprint) as RawSecurityEventRow | undefined;

  return row ? rowToSecurityEvent(row) : undefined;
}

export function listSecurityEvents(query: SecurityEventQuery = {}): SecurityEventRecord[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const values: Array<string | number> = [];

  if (query.serverId !== undefined) {
    conditions.push('serverId = ?');
    values.push(query.serverId);
  }

  if (query.resolved !== undefined) {
    conditions.push('resolved = ?');
    values.push(query.resolved ? 1 : 0);
  }

  if (query.eventType !== undefined) {
    conditions.push('eventType = ?');
    values.push(query.eventType);
  }

  if (query.fingerprint !== undefined) {
    conditions.push('fingerprint = ?');
    values.push(query.fingerprint);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = query.limit !== undefined ? 'LIMIT ?' : '';
  if (query.limit !== undefined) {
    values.push(query.limit);
  }

  const rows = db.prepare(`
    SELECT *
    FROM security_events
    ${whereClause}
    ORDER BY createdAt DESC, id DESC
    ${limitClause}
  `).all(...values) as RawSecurityEventRow[];

  return rows.map(rowToSecurityEvent);
}

export function markSecurityEventSafe(
  id: number,
  resolvedBy: string,
  reason: string,
): { resolvedEvent: SecurityEventRecord; auditEvent?: SecurityEventRecord } | undefined {
  const db = getDatabase();
  const existing = getSecurityEventById(id);
  if (!existing) {
    return undefined;
  }

  if (existing.resolved) {
    return { resolvedEvent: existing };
  }

  const resolvedAt = Date.now();

  const runUpdate = db.prepare(`
    UPDATE security_events
    SET resolved = 1, resolvedBy = ?, resolvedAt = ?
    WHERE id = ?
  `);

  const transact = db.transaction(() => {
    runUpdate.run(resolvedBy, resolvedAt, id);

    const resolvedEvent = getSecurityEventById(id)!;
    const auditEvent = createSecurityEvent({
      serverId: existing.serverId,
      eventType: 'marked_safe',
      fingerprint: `marked_safe:${id}:${resolvedAt}`,
      details: {
        reason,
        targetEventId: id,
        pid: existing.details.pid,
        user: existing.details.user,
        command: existing.details.command,
        taskId: existing.details.taskId,
      },
    });

    return { resolvedEvent, auditEvent };
  });

  return transact();
}

function getSecurityEventById(id: number): SecurityEventRecord | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM security_events WHERE id = ?').get(id) as RawSecurityEventRow | undefined;
  return row ? rowToSecurityEvent(row) : undefined;
}

function rowToSecurityEvent(row: RawSecurityEventRow): SecurityEventRecord {
  return {
    id: row.id,
    serverId: row.serverId,
    eventType: row.eventType,
    fingerprint: row.fingerprint,
    details: JSON.parse(row.detailsJson) as SecurityEventDetails,
    resolved: row.resolved === 1,
    resolvedBy: row.resolvedBy,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}