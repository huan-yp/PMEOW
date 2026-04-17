import { getDatabase } from './database.js';
import type { PersonBindingRecord, PersonBindingCandidate } from '../types.js';
import { getPersonById } from './persons.js';

export function createBinding(input: {
  personId: string;
  serverId: string;
  systemUser: string;
  source: 'manual' | 'suggested' | 'synced';
  enabled?: boolean;
  effectiveFrom?: number | null;
  effectiveTo?: number | null;
}): PersonBindingRecord {
  const db = getDatabase();
  const existingActive = getActiveBinding(input.serverId, input.systemUser);
  if (existingActive) {
    if (existingActive.personId !== input.personId) {
      throw new Error(`Active binding already exists for ${input.serverId}:${input.systemUser}`);
    }

    return updateBinding(existingActive.id, {
      source: input.source,
      enabled: input.enabled,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
    })!;
  }

  const now = Date.now();
  const res = db.prepare(
    `INSERT INTO person_bindings (person_id, server_id, system_user, source, enabled, effective_from, effective_to, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.personId,
    input.serverId,
    input.systemUser,
    input.source,
    input.enabled !== false ? 1 : 0,
    input.effectiveFrom ?? null,
    input.effectiveTo ?? null,
    now,
    now,
  );

  return getBindingById(Number(res.lastInsertRowid))!;
}

export function updateBinding(
  id: number,
  input: Partial<Omit<PersonBindingRecord, 'id' | 'createdAt' | 'updatedAt'>>,
): PersonBindingRecord | undefined {
  const db = getDatabase();
  const existing = getBindingById(id);
  if (!existing) return undefined;

  const now = Date.now();
  db.prepare(
    `UPDATE person_bindings SET
       person_id = ?, source = ?, enabled = ?, effective_from = ?, effective_to = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    input.personId ?? existing.personId,
    input.source ?? existing.source,
    input.enabled !== undefined ? (input.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
    input.effectiveFrom !== undefined ? input.effectiveFrom : existing.effectiveFrom,
    input.effectiveTo !== undefined ? input.effectiveTo : existing.effectiveTo,
    now,
    id,
  );

  return getBindingById(id);
}

export function getBindingsByPersonId(personId: string): PersonBindingRecord[] {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT * FROM person_bindings WHERE person_id = ? ORDER BY enabled DESC, updated_at DESC, created_at DESC'
  ).all(personId) as Record<string, unknown>[];
  return rows.map(mapRow);
}

export function getActiveBinding(serverId: string, systemUser: string): PersonBindingRecord | undefined {
  const db = getDatabase();
  const row = db.prepare(
    `SELECT * FROM person_bindings
     WHERE server_id = ?
       AND system_user = ?
       AND enabled = 1
       AND (effective_from IS NULL OR effective_from <= ?)
       AND (effective_to IS NULL OR effective_to > ?)
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`
  ).get(serverId, systemUser, Date.now(), Date.now()) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : undefined;
}

export function deactivateBinding(id: number, effectiveTo = Date.now()): PersonBindingRecord | undefined {
  return updateBinding(id, { enabled: false, effectiveTo });
}

export function listBindingCandidates(): PersonBindingCandidate[] {
  const db = getDatabase();
  // Get distinct (serverId, systemUser) from latest snapshots' local_users
  const rows = db.prepare(
    `SELECT DISTINCT s.id AS server_id, s.name AS server_name, j.value AS system_user
     FROM snapshots sn
     JOIN servers s ON sn.server_id = s.id
     CROSS JOIN json_each(sn.local_users) j
     WHERE sn.id IN (
       SELECT MAX(id) FROM snapshots GROUP BY server_id
     )`
  ).all() as Record<string, unknown>[];

  return rows.map(r => {
    const serverId = r.server_id as string;
    const systemUser = r.system_user as string;
    const binding = getActiveBinding(serverId, systemUser);
    const activePerson = binding ? getPersonById(binding.personId) ?? null : null;
    return {
      serverId,
      serverName: r.server_name as string,
      systemUser,
      activeBinding: binding ?? null,
      activePerson: activePerson ? {
        id: activePerson.id,
        displayName: activePerson.displayName,
        email: activePerson.email,
        qq: activePerson.qq,
      } : null,
    };
  });
}

function getBindingById(id: number): PersonBindingRecord | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM person_bindings WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : undefined;
}

function mapRow(r: Record<string, unknown>): PersonBindingRecord {
  return {
    id: r.id as number,
    personId: r.person_id as string,
    serverId: r.server_id as string,
    systemUser: r.system_user as string,
    source: r.source as 'manual' | 'suggested' | 'synced',
    enabled: (r.enabled as number) === 1,
    effectiveFrom: r.effective_from as number | null,
    effectiveTo: r.effective_to as number | null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}