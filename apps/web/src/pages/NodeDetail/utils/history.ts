import type { HistoryPreset, HistoryRangeQuery } from './types.js';
import { PRESET_LABELS } from './types.js';

export function buildPresetRange(preset: Exclude<HistoryPreset, 'custom'>): HistoryRangeQuery {
  const now = Math.floor(Date.now() / 1000);
  const durations: Record<Exclude<HistoryPreset, 'custom'>, number> = {
    '24h': 24 * 60 * 60,
    '3d': 3 * 24 * 60 * 60,
    '7d': 7 * 24 * 60 * 60,
    '30d': 30 * 24 * 60 * 60,
  };

  return {
    preset,
    from: now - durations[preset],
    to: now,
  };
}

export function formatDateTimeLocal(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function parseDateTimeLocal(value: string): number | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor(parsed.getTime() / 1000);
}

export function describeHistoryRange(range: HistoryRangeQuery): string {
  if (range.preset !== 'custom') {
    return PRESET_LABELS[range.preset];
  }
  return `${formatSnapshotTime(range.from)} - ${formatSnapshotTime(range.to)}`;
}

export function formatSnapshotTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
