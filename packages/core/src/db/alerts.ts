import { getDatabase } from './database.js';
import type { AlertRecord, AlertStatus, AlertType, AlertCandidate, AlertStateChange } from '../types.js';

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export function getAlerts(options: { serverId?: string; status?: AlertStatus } = {}): AlertRecord[] {
  const db = getDatabase();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.serverId) { clauses.push('server_id = ?'); params.push(options.serverId); }
  if (options.status) { clauses.push('status = ?'); params.push(options.status); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM alerts${where} ORDER BY updated_at DESC`).all(...params) as Record<string, unknown>[];
  return rows.map(mapAlertRow);
}

export function getActiveAlerts(serverId: string): AlertRecord[] {
  return getAlerts({ serverId, status: 'active' });
}

export function getAlertByKey(serverId: string, alertType: AlertType, fingerprint: string): AlertRecord | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM alerts WHERE server_id = ? AND alert_type = ? AND fingerprint = ?')
    .get(serverId, alertType, fingerprint) as Record<string, unknown> | undefined;
  return row ? mapAlertRow(row) : null;
}

// ---------------------------------------------------------------------------
// Closed-loop state machine — called by the ingest pipeline
// ---------------------------------------------------------------------------

/**
 * Given the current set of anomaly candidates for a server, compute all
 * state transitions against existing alerts in the DB, persist them, and
 * return the list of changes that should be broadcast to frontends.
 *
 * Rules (from docs/developer/告警事件处理.md):
 *  - Candidate present + no alert / alert RESOLVED → create or update to ACTIVE
 *  - Candidate present + alert SILENCED → keep SILENCED (update value only)
 *  - Candidate present + alert ACTIVE → update value, no state change
 *  - Candidate absent + alert ACTIVE → transition to RESOLVED
 *  - Candidate absent + alert SILENCED → keep SILENCED
 *  - Candidate absent + alert RESOLVED → no-op
 */
export function reconcileAlerts(
  serverId: string,
  candidates: AlertCandidate[],
  source: 'detection' | 'user_action' = 'detection',
): AlertStateChange[] {
  const db = getDatabase();
  const now = Date.now();
  const changes: AlertStateChange[] = [];

  const candidateMap = new Map<string, AlertCandidate>();
  for (const c of candidates) {
    candidateMap.set(alertKey(c.alertType, c.fingerprint), c);
  }

  const transact = db.transaction(() => {
    // 1. Scan existing ACTIVE alerts for this server — resolve any that lost their candidate
    const activeAlerts = getActiveAlerts(serverId);
    for (const alert of activeAlerts) {
      const key = alertKey(alert.alertType as AlertType, alert.fingerprint);
      if (!candidateMap.has(key)) {
        // Anomaly disappeared → ACTIVE → RESOLVED
        setStatus(db, alert.id, 'active', 'resolved', source, now);
        changes.push({ alert: { ...alert, status: 'resolved', updatedAt: now }, fromStatus: 'active', toStatus: 'resolved' });
      }
    }

    // 2. Process each candidate
    for (const [, candidate] of candidateMap) {
      const existing = getAlertByKey(serverId, candidate.alertType, candidate.fingerprint);

      if (!existing) {
        // Brand-new alert → ACTIVE
        const alert = insertAlert(db, serverId, candidate, now);
        writeTransition(db, alert.id, 'resolved', 'active', source, now);
        changes.push({ alert, fromStatus: 'resolved', toStatus: 'active' });
      } else if (existing.status === 'resolved') {
        // Re-activation → RESOLVED → ACTIVE
        updateAlertValue(db, existing.id, candidate, now);
        setStatus(db, existing.id, 'resolved', 'active', source, now);
        const updated = { ...existing, ...candidateValues(candidate), status: 'active' as AlertStatus, updatedAt: now };
        changes.push({ alert: updated, fromStatus: 'resolved', toStatus: 'active' });
      } else if (existing.status === 'active') {
        // Still active — just refresh value
        updateAlertValue(db, existing.id, candidate, now);
      } else {
        // SILENCED — refresh value but keep status
        updateAlertValue(db, existing.id, candidate, now);
      }
    }
  });

  transact();
  return changes;
}

// ---------------------------------------------------------------------------
// User-facing state transitions (silence / unsilence)
// ---------------------------------------------------------------------------

export function silenceAlert(id: number): AlertStateChange | null {
  const db = getDatabase();
  const now = Date.now();
  const row = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const alert = mapAlertRow(row);
  if (alert.status === 'silenced') return null;
  const from = alert.status;
  setStatus(db, id, from, 'silenced', 'user_action', now);
  return { alert: { ...alert, status: 'silenced', updatedAt: now }, fromStatus: from, toStatus: 'silenced' };
}

export function unsilenceAlert(id: number): AlertStateChange | null {
  const db = getDatabase();
  const now = Date.now();
  const row = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const alert = mapAlertRow(row);
  if (alert.status !== 'silenced') return null;
  setStatus(db, id, 'silenced', 'resolved', 'user_action', now);
  return { alert: { ...alert, status: 'resolved', updatedAt: now }, fromStatus: 'silenced', toStatus: 'resolved' };
}

export function batchSilenceAlerts(ids: number[]): AlertStateChange[] {
  const changes: AlertStateChange[] = [];
  for (const id of ids) {
    const c = silenceAlert(id);
    if (c) changes.push(c);
  }
  return changes;
}

export function batchUnsilenceAlerts(ids: number[]): AlertStateChange[] {
  const changes: AlertStateChange[] = [];
  for (const id of ids) {
    const c = unsilenceAlert(id);
    if (c) changes.push(c);
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function deleteAlertsByServerId(serverId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM alerts WHERE server_id = ?').run(serverId);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function alertKey(alertType: string, fingerprint: string): string {
  return `${alertType}:${fingerprint}`;
}

function candidateValues(c: AlertCandidate) {
  return { value: c.value, threshold: c.threshold, details: c.details };
}

import type Database from 'better-sqlite3';

function insertAlert(db: Database.Database, serverId: string, c: AlertCandidate, now: number): AlertRecord {
  const detailsJson = c.details ? JSON.stringify(c.details) : null;
  db.prepare(
    `INSERT INTO alerts (server_id, alert_type, value, threshold, fingerprint, details, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(serverId, c.alertType, c.value, c.threshold, c.fingerprint, detailsJson, now, now);
  const row = db.prepare('SELECT * FROM alerts WHERE server_id = ? AND alert_type = ? AND fingerprint = ?')
    .get(serverId, c.alertType, c.fingerprint) as Record<string, unknown>;
  return mapAlertRow(row);
}

function updateAlertValue(db: Database.Database, id: number, c: AlertCandidate, now: number): void {
  const detailsJson = c.details ? JSON.stringify(c.details) : null;
  db.prepare('UPDATE alerts SET value = ?, threshold = ?, details = ?, updated_at = ? WHERE id = ?')
    .run(c.value, c.threshold, detailsJson, now, id);
}

function setStatus(db: Database.Database, id: number, from: AlertStatus, to: AlertStatus, source: string, now: number): void {
  db.prepare('UPDATE alerts SET status = ?, updated_at = ? WHERE id = ?').run(to, now, id);
  writeTransition(db, id, from, to, source, now);
}

function writeTransition(db: Database.Database, alertId: number, from: string, to: string, source: string, now: number): void {
  db.prepare('INSERT INTO alert_transitions (alert_id, from_status, to_status, source, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(alertId, from, to, source, now);
}

function mapAlertRow(r: Record<string, unknown>): AlertRecord {
  let details: Record<string, unknown> | null = null;
  if (typeof r.details === 'string') {
    try { details = JSON.parse(r.details); } catch { /* ignore */ }
  }
  return {
    id: r.id as number,
    serverId: r.server_id as string,
    alertType: r.alert_type as string,
    value: r.value as number | null,
    threshold: r.threshold as number | null,
    fingerprint: (r.fingerprint as string) ?? '',
    details,
    status: r.status as AlertStatus,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}
