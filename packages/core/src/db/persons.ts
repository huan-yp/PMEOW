import { randomUUID } from 'crypto';
import { getDatabase } from './database.js';
import type { PersonRecord, PersonStatus } from '../types.js';

export function createPerson(input: {
  displayName: string;
  email?: string | null;
  qq?: string | null;
  note?: string | null;
  customFields?: Record<string, string>;
}): PersonRecord {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();

  db.prepare(
    `INSERT INTO persons (id, display_name, email, qq, note, custom_fields, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(
    id,
    input.displayName,
    input.email ?? null,
    input.qq ?? null,
    input.note ?? null,
    JSON.stringify(input.customFields ?? {}),
    now,
    now,
  );

  return getPersonById(id)!;
}

export function getPersonById(id: string): PersonRecord | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM persons WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : undefined;
}

export function listPersons(opts: { includeArchived: boolean } = { includeArchived: false }): PersonRecord[] {
  const db = getDatabase();
  const sql = opts.includeArchived
    ? 'SELECT * FROM persons ORDER BY display_name ASC'
    : "SELECT * FROM persons WHERE status = 'active' ORDER BY display_name ASC";
  const rows = db.prepare(sql).all() as Record<string, unknown>[];
  return rows.map(mapRow);
}

export function updatePerson(
  id: string,
  input: Partial<Omit<PersonRecord, 'id' | 'createdAt' | 'updatedAt'>>,
): PersonRecord | undefined {
  const db = getDatabase();
  const existing = getPersonById(id);
  if (!existing) return undefined;

  const now = Date.now();
  const displayName = input.displayName ?? existing.displayName;
  const email = input.email !== undefined ? input.email : existing.email;
  const qq = input.qq !== undefined ? input.qq : existing.qq;
  const note = input.note !== undefined ? input.note : existing.note;
  const customFields = input.customFields ? JSON.stringify(input.customFields) : JSON.stringify(existing.customFields);
  const status = input.status ?? existing.status;

  db.prepare(
    `UPDATE persons SET display_name = ?, email = ?, qq = ?, note = ?, custom_fields = ?, status = ?, updated_at = ?
     WHERE id = ?`
  ).run(displayName, email, qq, note, customFields, status, now, id);

  return getPersonById(id);
}

function mapRow(r: Record<string, unknown>): PersonRecord {
  return {
    id: r.id as string,
    displayName: r.display_name as string,
    email: r.email as string | null,
    qq: r.qq as string | null,
    note: r.note as string | null,
    customFields: JSON.parse((r.custom_fields as string) || '{}'),
    status: r.status as PersonStatus,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}