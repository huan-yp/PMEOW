import { getDatabase } from './database.js';
import type { PersonMobilePreferenceRecord } from '../types.js';

const DEFAULTS: Omit<PersonMobilePreferenceRecord, 'personId' | 'updatedAt'> = {
  notifyTaskStarted: true,
  notifyTaskCompleted: true,
  notifyTaskFailed: true,
  notifyTaskCancelled: true,
  notifyNodeStatus: true,
  notifyGpuAvailable: false,
  minAvailableGpuCount: 1,
  minAvailableVramGB: null,
};

function rowToRecord(row: any): PersonMobilePreferenceRecord {
  return {
    personId: row.personId,
    notifyTaskStarted: Boolean(row.notifyTaskStarted),
    notifyTaskCompleted: Boolean(row.notifyTaskCompleted),
    notifyTaskFailed: Boolean(row.notifyTaskFailed),
    notifyTaskCancelled: Boolean(row.notifyTaskCancelled),
    notifyNodeStatus: Boolean(row.notifyNodeStatus),
    notifyGpuAvailable: Boolean(row.notifyGpuAvailable),
    minAvailableGpuCount: row.minAvailableGpuCount,
    minAvailableVramGB: row.minAvailableVramGB ?? null,
    updatedAt: row.updatedAt,
  };
}

export function getPersonMobilePreferences(personId: string): PersonMobilePreferenceRecord {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM person_mobile_preferences WHERE personId = ?').get(personId) as any;

  if (row) return rowToRecord(row);

  // Create with defaults
  const now = Date.now();
  db.prepare(`
    INSERT INTO person_mobile_preferences
    (personId, notifyTaskStarted, notifyTaskCompleted, notifyTaskFailed, notifyTaskCancelled,
     notifyNodeStatus, notifyGpuAvailable, minAvailableGpuCount, minAvailableVramGB, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    personId,
    DEFAULTS.notifyTaskStarted ? 1 : 0,
    DEFAULTS.notifyTaskCompleted ? 1 : 0,
    DEFAULTS.notifyTaskFailed ? 1 : 0,
    DEFAULTS.notifyTaskCancelled ? 1 : 0,
    DEFAULTS.notifyNodeStatus ? 1 : 0,
    DEFAULTS.notifyGpuAvailable ? 1 : 0,
    DEFAULTS.minAvailableGpuCount,
    DEFAULTS.minAvailableVramGB,
    now,
  );

  return { personId, ...DEFAULTS, updatedAt: now };
}

export function updatePersonMobilePreferences(
  personId: string,
  updates: Partial<Omit<PersonMobilePreferenceRecord, 'personId' | 'updatedAt'>>,
): PersonMobilePreferenceRecord {
  // Ensure row exists
  getPersonMobilePreferences(personId);

  const db = getDatabase();
  const now = Date.now();
  const fields: string[] = ['updatedAt = ?'];
  const values: unknown[] = [now];

  const boolKeys = [
    'notifyTaskStarted', 'notifyTaskCompleted', 'notifyTaskFailed', 'notifyTaskCancelled',
    'notifyNodeStatus', 'notifyGpuAvailable',
  ] as const;

  for (const key of boolKeys) {
    if (key in updates) {
      fields.push(`${key} = ?`);
      values.push(updates[key] ? 1 : 0);
    }
  }

  if ('minAvailableGpuCount' in updates) {
    fields.push('minAvailableGpuCount = ?');
    values.push(updates.minAvailableGpuCount);
  }
  if ('minAvailableVramGB' in updates) {
    fields.push('minAvailableVramGB = ?');
    values.push(updates.minAvailableVramGB);
  }

  values.push(personId);
  db.prepare(`UPDATE person_mobile_preferences SET ${fields.join(', ')} WHERE personId = ?`).run(...values);

  return getPersonMobilePreferences(personId);
}
