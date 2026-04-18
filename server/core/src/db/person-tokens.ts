import { randomBytes, createHash } from 'crypto';
import { getDatabase } from './database.js';
import type { PersonTokenRecord } from '../types.js';

export function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

export function generateToken(): { plain: string; hash: string } {
  const plain = 'pt_' + randomBytes(32).toString('base64url');
  return { plain, hash: hashToken(plain) };
}

export function createPersonToken(personId: string, note: string | null): { record: PersonTokenRecord; plainToken: string } {
  const db = getDatabase();
  const { plain, hash } = generateToken();
  const now = Date.now();
  const res = db.prepare(
    `INSERT INTO person_tokens (person_id, token_hash, status, note, created_at, last_used_at)
     VALUES (?, ?, 'active', ?, ?, NULL)`
  ).run(personId, hash, note, now);
  return { record: getPersonTokenById(Number(res.lastInsertRowid))!, plainToken: plain };
}

export function getPersonTokenById(id: number): PersonTokenRecord | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM person_tokens WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : undefined;
}

export function getPersonTokensByPersonId(personId: string): PersonTokenRecord[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM person_tokens WHERE person_id = ? ORDER BY created_at DESC').all(personId) as Record<string, unknown>[];
  return rows.map(mapRow);
}

export function verifyPersonToken(plain: string): PersonTokenRecord | undefined {
  const db = getDatabase();
  const hash = hashToken(plain);
  const row = db.prepare("SELECT * FROM person_tokens WHERE token_hash = ? AND status = 'active'").get(hash) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  db.prepare('UPDATE person_tokens SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id);
  return mapRow(row);
}

export function revokePersonToken(id: number): PersonTokenRecord | undefined {
  const db = getDatabase();
  const existing = getPersonTokenById(id);
  if (!existing) return undefined;
  db.prepare("UPDATE person_tokens SET status = 'revoked' WHERE id = ?").run(id);
  return getPersonTokenById(id);
}

export function rotatePersonToken(id: number, note: string | null): { record: PersonTokenRecord; plainToken: string } | undefined {
  const db = getDatabase();
  const existing = getPersonTokenById(id);
  if (!existing) return undefined;

  return db.transaction(() => {
    db.prepare("UPDATE person_tokens SET status = 'revoked' WHERE id = ?").run(id);
    return createPersonToken(existing.personId, note ?? existing.note);
  })();
}

function mapRow(r: Record<string, unknown>): PersonTokenRecord {
  return {
    id: r.id as number,
    personId: r.person_id as string,
    tokenHash: r.token_hash as string,
    status: r.status as 'active' | 'revoked',
    note: r.note as string | null,
    createdAt: r.created_at as number,
    lastUsedAt: r.last_used_at as number | null,
  };
}
