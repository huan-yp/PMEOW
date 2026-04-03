import crypto from 'crypto';
import { getDatabase } from './database.js';
import type { PersonMobileNotificationRecord, PersonMobileNotificationCategory } from '../types.js';

function rowToRecord(row: any): PersonMobileNotificationRecord {
  return {
    id: row.id,
    personId: row.personId,
    category: row.category as PersonMobileNotificationCategory,
    eventType: row.eventType,
    title: row.title,
    body: row.body,
    payloadJson: row.payloadJson,
    dedupeKey: row.dedupeKey,
    createdAt: row.createdAt,
    readAt: row.readAt ?? null,
  };
}

export interface CreateNotificationInput {
  personId: string;
  category: PersonMobileNotificationCategory;
  eventType: string;
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
  dedupeKey?: string;
}

export function createPersonMobileNotification(input: CreateNotificationInput): PersonMobileNotificationRecord | null {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = Date.now();
  const dedupeKey = input.dedupeKey ?? '';

  // If a dedupeKey is provided, skip on duplicate
  if (dedupeKey) {
    const existing = db.prepare(
      `SELECT id FROM person_mobile_notifications WHERE personId = ? AND dedupeKey = ?`
    ).get(input.personId, dedupeKey);
    if (existing) return null;
  }

  db.prepare(`
    INSERT INTO person_mobile_notifications
    (id, personId, category, eventType, title, body, payloadJson, dedupeKey, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.personId,
    input.category,
    input.eventType,
    input.title,
    input.body ?? '',
    JSON.stringify(input.payload ?? {}),
    dedupeKey,
    now,
  );

  return rowToRecord(db.prepare('SELECT * FROM person_mobile_notifications WHERE id = ?').get(id)!);
}

export function getPersonMobileNotifications(
  personId: string,
  limit = 50,
  offset = 0,
): PersonMobileNotificationRecord[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM person_mobile_notifications
    WHERE personId = ?
    ORDER BY createdAt DESC
    LIMIT ? OFFSET ?
  `).all(personId, limit, offset) as any[];

  return rows.map(rowToRecord);
}

export function getPersonUnreadNotificationCount(personId: string): number {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM person_mobile_notifications WHERE personId = ? AND readAt IS NULL'
  ).get(personId) as any;
  return row.cnt;
}

export function markPersonNotificationRead(notificationId: string): void {
  const db = getDatabase();
  db.prepare('UPDATE person_mobile_notifications SET readAt = ? WHERE id = ? AND readAt IS NULL')
    .run(Date.now(), notificationId);
}
