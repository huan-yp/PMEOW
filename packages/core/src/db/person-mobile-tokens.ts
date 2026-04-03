import crypto from 'crypto';
import { getDatabase } from './database.js';
import type { PersonMobileTokenRecord } from '../types.js';

function hashToken(plain: string): string {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

function rowToRecord(row: any): PersonMobileTokenRecord {
  return {
    id: row.id,
    personId: row.personId,
    label: row.label,
    tokenHash: row.tokenHash,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt ?? null,
    revokedAt: row.revokedAt ?? null,
    lastUsedAt: row.lastUsedAt ?? null,
  };
}

export interface CreatePersonMobileTokenResult {
  record: PersonMobileTokenRecord;
  plainToken: string;
}

export function createPersonMobileToken(personId: string, label = ''): CreatePersonMobileTokenResult {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const plainToken = `pmt_${crypto.randomBytes(32).toString('hex')}`;
  const now = Date.now();

  db.prepare(`
    INSERT INTO person_mobile_tokens (id, personId, label, tokenHash, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, personId, label, hashToken(plainToken), now);

  const record = rowToRecord(db.prepare('SELECT * FROM person_mobile_tokens WHERE id = ?').get(id));
  return { record, plainToken };
}

export function rotatePersonMobileToken(personId: string): CreatePersonMobileTokenResult | null {
  const db = getDatabase();
  const now = Date.now();

  // Revoke all active tokens for this person
  db.prepare(`
    UPDATE person_mobile_tokens
    SET revokedAt = ?, rotatedAt = ?
    WHERE personId = ? AND revokedAt IS NULL
  `).run(now, now, personId);

  return createPersonMobileToken(personId);
}

export function revokePersonMobileToken(personId: string): void {
  const db = getDatabase();
  const now = Date.now();

  db.prepare(`
    UPDATE person_mobile_tokens
    SET revokedAt = ?
    WHERE personId = ? AND revokedAt IS NULL
  `).run(now, personId);
}

export function resolvePersonMobileToken(plainToken: string): PersonMobileTokenRecord | null {
  const db = getDatabase();
  const hash = hashToken(plainToken);

  const row = db.prepare(`
    SELECT * FROM person_mobile_tokens
    WHERE tokenHash = ? AND revokedAt IS NULL
  `).get(hash) as any;

  if (!row) return null;

  // Touch last used
  const now = Date.now();
  db.prepare('UPDATE person_mobile_tokens SET lastUsedAt = ? WHERE id = ?').run(now, row.id);

  const record = rowToRecord(row);
  record.lastUsedAt = now;

  return record;
}

export function getPersonMobileTokenStatus(personId: string): PersonMobileTokenRecord | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM person_mobile_tokens
    WHERE personId = ? AND revokedAt IS NULL
    ORDER BY createdAt DESC LIMIT 1
  `).get(personId) as any;

  return row ? rowToRecord(row) : null;
}
