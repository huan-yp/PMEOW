import { randomUUID } from 'crypto';
import { getDatabase } from './database.js';
import type { HookRule, HookRuleInput, HookLog, HookCondition, HookAction } from '../types.js';

export function getAllHooks(): HookRule[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM hooks ORDER BY createdAt ASC').all() as RawHookRow[];
  return rows.map(rowToHook);
}

export function getHookById(id: string): HookRule | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM hooks WHERE id = ?').get(id) as RawHookRow | undefined;
  return row ? rowToHook(row) : undefined;
}

export function getHooksByServerId(serverId: string): HookRule[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM hooks ORDER BY createdAt ASC').all() as RawHookRow[];
  return rows.map(rowToHook).filter(h => h.condition.serverId === serverId);
}

export function createHook(input: HookRuleInput): HookRule {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    'INSERT INTO hooks (id, name, enabled, conditionJson, actionJson, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, input.name, input.enabled ? 1 : 0, JSON.stringify(input.condition), JSON.stringify(input.action), now, now);
  return { id, ...input, lastTriggeredAt: null, createdAt: now, updatedAt: now };
}

export function updateHook(id: string, input: Partial<HookRuleInput>): HookRule | undefined {
  const existing = getHookById(id);
  if (!existing) return undefined;

  const updated = {
    ...existing,
    ...input,
    updatedAt: Date.now(),
  };

  const db = getDatabase();
  db.prepare(
    'UPDATE hooks SET name = ?, enabled = ?, conditionJson = ?, actionJson = ?, updatedAt = ? WHERE id = ?'
  ).run(updated.name, updated.enabled ? 1 : 0, JSON.stringify(updated.condition), JSON.stringify(updated.action), updated.updatedAt, id);
  return updated;
}

export function deleteHook(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM hooks WHERE id = ?').run(id);
  return result.changes > 0;
}

export function setHookLastTriggered(id: string, timestamp: number): void {
  const db = getDatabase();
  db.prepare('UPDATE hooks SET lastTriggeredAt = ? WHERE id = ?').run(timestamp, id);
}

// Hook logs
export function addHookLog(hookId: string, success: boolean, result: string, error: string | null): HookLog {
  const db = getDatabase();
  const log: HookLog = {
    id: randomUUID(),
    hookId,
    triggeredAt: Date.now(),
    success,
    result,
    error,
  };
  db.prepare(
    'INSERT INTO hook_logs (id, hookId, triggeredAt, success, result, error) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(log.id, log.hookId, log.triggeredAt, log.success ? 1 : 0, log.result, log.error);
  return log;
}

export function getHookLogs(hookId: string, limit = 50): HookLog[] {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT * FROM hook_logs WHERE hookId = ? ORDER BY triggeredAt DESC LIMIT ?'
  ).all(hookId, limit) as RawHookLogRow[];
  return rows.map(r => ({
    id: r.id,
    hookId: r.hookId,
    triggeredAt: r.triggeredAt,
    success: r.success === 1,
    result: r.result,
    error: r.error,
  }));
}

// Internal types
interface RawHookRow {
  id: string;
  name: string;
  enabled: number;
  conditionJson: string;
  actionJson: string;
  lastTriggeredAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface RawHookLogRow {
  id: string;
  hookId: string;
  triggeredAt: number;
  success: number;
  result: string;
  error: string | null;
}

function rowToHook(row: RawHookRow): HookRule {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    condition: JSON.parse(row.conditionJson) as HookCondition,
    action: JSON.parse(row.actionJson) as HookAction,
    lastTriggeredAt: row.lastTriggeredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
