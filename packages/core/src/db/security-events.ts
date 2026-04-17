import { getDatabase } from './database.js';
import type { SecurityEventRecord, SecurityEventDetails, SecurityEventType } from '../types.js';

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
  limit?: number;
}

export function createSecurityEvent(input: SecurityEventInput): SecurityEventRecord {
  const db = getDatabase();
  const now = Date.now();
  const res = db.prepare(
    `INSERT INTO security_events (server_id, event_type, fingerprint, details, resolved, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run(input.serverId, input.eventType, input.fingerprint, JSON.stringify(input.details), now);

  return getSecurityEventById(Number(res.lastInsertRowid))!;
}

export function findOpenSecurityEvent(serverId: string, eventType: string, fingerprint: string): SecurityEventRecord | undefined {
  const db = getDatabase();
  const row = db.prepare(
    `SELECT * FROM security_events
     WHERE server_id = ? AND event_type = ? AND fingerprint = ? AND resolved = 0`
  ).get(serverId, eventType, fingerprint) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : undefined;
}

export function listSecurityEvents(query: SecurityEventQuery = {}): SecurityEventRecord[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.serverId) {
    conditions.push('server_id = ?');
    params.push(query.serverId);
  }
  if (query.resolved !== undefined) {
    conditions.push('resolved = ?');
    params.push(query.resolved ? 1 : 0);
  }
  if (query.eventType) {
    conditions.push('event_type = ?');
    params.push(query.eventType);
  }

  let sql = 'SELECT * FROM security_events';
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY created_at DESC';

  if (query.limit) {
    sql += ' LIMIT ?';
    params.push(query.limit);
  }

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(mapRow);
}

export function markSecurityEventSafe(
  id: number,
  resolvedBy: string,
  reason: string,
): { resolvedEvent: SecurityEventRecord; auditEvent?: SecurityEventRecord } | undefined {
  const db = getDatabase();
  const existing = getSecurityEventById(id);
  if (!existing) return undefined;
  if (existing.resolved) return { resolvedEvent: existing };

  const resolvedAt = Date.now();

  const transact = db.transaction(() => {
    db.prepare(
      'UPDATE security_events SET resolved = 1, resolved_by = ?, resolved_at = ? WHERE id = ?'
    ).run(resolvedBy, resolvedAt, id);

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

    // Mark audit event as resolved so it doesn't show up as unresolved
    db.prepare(
      'UPDATE security_events SET resolved = 1, resolved_by = ?, resolved_at = ? WHERE id = ?'
    ).run(resolvedBy, resolvedAt, auditEvent.id);
    const finalAuditEvent = getSecurityEventById(auditEvent.id)!;

    return { resolvedEvent, auditEvent: finalAuditEvent };
  });

  return transact();
}

export function unresolveSecurityEvent(
  id: number,
  actor: string,
  reason: string,
): { reopenedEvent: SecurityEventRecord; auditEvent: SecurityEventRecord } | { error: 'not_found' | 'not_resolved' | 'duplicate_open' } {
  const db = getDatabase();
  const existing = getSecurityEventById(id);
  if (!existing || existing.eventType === 'marked_safe' || existing.eventType === 'unresolve') {
    return { error: 'not_found' };
  }
  if (!existing.resolved) {
    return { error: 'not_resolved' };
  }

  const open = findOpenSecurityEvent(existing.serverId, existing.eventType, existing.fingerprint);
  if (open) {
    return { error: 'duplicate_open' };
  }

  const now = Date.now();

  const transact = db.transaction(() => {
    db.prepare(
      'UPDATE security_events SET resolved = 0, resolved_by = NULL, resolved_at = NULL WHERE id = ?'
    ).run(id);

    const reopenedEvent = getSecurityEventById(id)!;

    const auditEvent = createSecurityEvent({
      serverId: existing.serverId,
      eventType: 'unresolve',
      fingerprint: `unresolve:${id}:${now}`,
      details: {
        reason,
        targetEventId: id,
        pid: existing.details.pid,
        user: existing.details.user,
        command: existing.details.command,
        taskId: existing.details.taskId,
      },
    });

    db.prepare(
      'UPDATE security_events SET resolved = 1, resolved_by = ?, resolved_at = ? WHERE id = ?'
    ).run(actor, now, auditEvent.id);
    const finalAuditEvent = getSecurityEventById(auditEvent.id)!;

    return { reopenedEvent, auditEvent: finalAuditEvent };
  });

  return transact();
}

function getSecurityEventById(id: number): SecurityEventRecord | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM security_events WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : undefined;
}

function mapRow(r: Record<string, unknown>): SecurityEventRecord {
  return {
    id: r.id as number,
    serverId: r.server_id as string,
    eventType: r.event_type as SecurityEventType,
    fingerprint: r.fingerprint as string,
    details: JSON.parse(r.details as string) as SecurityEventDetails,
    resolved: (r.resolved as number) === 1,
    resolvedBy: r.resolved_by as string | null,
    createdAt: r.created_at as number,
    resolvedAt: r.resolved_at as number | null,
  };
}