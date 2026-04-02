import { getDatabase } from './database.js';
import type { AppSettings } from '../types.js';
import { DEFAULT_SETTINGS } from '../types.js';

export function getSettings(): AppSettings {
  const db = getDatabase();
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const map = new Map(rows.map(r => [r.key, r.value]));

  return {
    refreshIntervalMs: parseInt(map.get('refreshIntervalMs') || '') || DEFAULT_SETTINGS.refreshIntervalMs,
    alertCpuThreshold: parseInt(map.get('alertCpuThreshold') || '') || DEFAULT_SETTINGS.alertCpuThreshold,
    alertMemoryThreshold: parseInt(map.get('alertMemoryThreshold') || '') || DEFAULT_SETTINGS.alertMemoryThreshold,
    alertDiskThreshold: parseInt(map.get('alertDiskThreshold') || '') || DEFAULT_SETTINGS.alertDiskThreshold,
    alertDiskMountPoints: map.has('alertDiskMountPoints')
      ? JSON.parse(map.get('alertDiskMountPoints')!)
      : DEFAULT_SETTINGS.alertDiskMountPoints,
    alertSuppressDefaultDays: parseInt(map.get('alertSuppressDefaultDays') || '') || DEFAULT_SETTINGS.alertSuppressDefaultDays,
    apiEnabled: map.get('apiEnabled') === 'false' ? false : DEFAULT_SETTINGS.apiEnabled,
    apiPort: parseInt(map.get('apiPort') || '') || DEFAULT_SETTINGS.apiPort,
    apiToken: map.get('apiToken') ?? DEFAULT_SETTINGS.apiToken,
    historyRetentionDays: parseInt(map.get('historyRetentionDays') || '') || DEFAULT_SETTINGS.historyRetentionDays,
    password: map.get('password') ?? DEFAULT_SETTINGS.password,
  };
}

export function saveSetting(key: keyof AppSettings, value: string): void {
  const db = getDatabase();
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
  ).run(key, value, value);
}

export function saveSettings(settings: Partial<AppSettings>): void {
  for (const [key, value] of Object.entries(settings)) {
    const strValue = Array.isArray(value) ? JSON.stringify(value) : String(value);
    saveSetting(key as keyof AppSettings, strValue);
  }
}
