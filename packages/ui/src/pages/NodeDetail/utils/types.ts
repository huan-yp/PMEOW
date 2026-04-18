export type Tab = 'realtime' | 'processes' | 'history' | 'snapshot';
export type ChartPoint = { time: number; value: number };
export type HistoryPreset = '24h' | '3d' | '7d' | '30d' | 'custom';

export interface NodeDetailLocationState {
  returnTo?: string;
  returnLabel?: string;
}

export interface HistoryRangeQuery {
  preset: HistoryPreset;
  from: number;
  to: number;
}

export interface PerGpuRealtimeHistory {
  utilization: ChartPoint[];
  memoryUsage: ChartPoint[];
  memoryBandwidth: ChartPoint[];
}

export const REALTIME_WINDOW_SECONDS = 10 * 60;
export const SNAPSHOT_TIMELINE_FROM = 0;

export const PRESET_LABELS: Record<Exclude<HistoryPreset, 'custom'>, string> = {
  '24h': '24 小时',
  '3d': '3 天',
  '7d': '7 天',
  '30d': '30 天',
};
