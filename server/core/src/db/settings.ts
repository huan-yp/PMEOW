import { getDatabase } from './database.js';
import { AppSettings, DEFAULT_SETTINGS } from '../types.js';

export function getSettings(): AppSettings {
  const db = getDatabase();
  const rows = db.prepare('SELECT key, value FROM settings').all() as any[];
  const settings: any = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch (e) {
      settings[row.key] = row.value;
    }
  }
  return settings as AppSettings;
}

export function saveSetting(key: string, value: any): void {
  const db = getDatabase();
  const valStr = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value);
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, valStr);
}

export function saveSettings(settings: Partial<AppSettings>): void {
  const db = getDatabase();
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const tx = db.transaction((data: any) => {
    for (const [key, value] of Object.entries(data)) {
      stmt.run(key, JSON.stringify(value));
    }
  });
  tx(settings);
}
