import type { DiskInfo, GpuCardReport, SnapshotWithGpu } from '@pmeow/app-common';

export type ChartPoint = { time: number; value: number };

export interface PerGpuRealtimeHistory {
  utilization: ChartPoint[];
  memoryUsage: ChartPoint[];
  memoryBandwidth: ChartPoint[];
}

export interface HostRealtimeHistory {
  cpuUsage: ChartPoint[];
  memoryUsage: ChartPoint[];
}

export interface GpuTotals {
  averageUtilization: number;
  totalVramPercent: number;
  totalVramUsedMb: number;
  totalVramMb: number;
}

export type UsageTone = 'normal' | 'warning' | 'critical';

export interface UsagePalette {
  tone: UsageTone;
  textColor: string;
  accentColor: string;
  borderColor: string;
  backgroundColor: string;
}

export const REALTIME_WINDOW_SECONDS = 10 * 60;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function computeGpuMemoryUsagePercent(gpu: GpuCardReport): number {
  return gpu.memoryTotalMb > 0 ? (gpu.memoryUsedMb / gpu.memoryTotalMb) * 100 : 0;
}

export function computeGpuTotals(gpuCards: GpuCardReport[]): GpuTotals {
  if (gpuCards.length === 0) {
    return {
      averageUtilization: 0,
      totalVramPercent: 0,
      totalVramUsedMb: 0,
      totalVramMb: 0,
    };
  }

  const totalUtilization = gpuCards.reduce((sum, gpu) => sum + gpu.utilizationGpu, 0);
  const totalVramMb = gpuCards.reduce((sum, gpu) => sum + gpu.memoryTotalMb, 0);
  const totalVramUsedMb = gpuCards.reduce((sum, gpu) => sum + gpu.memoryUsedMb, 0);

  return {
    averageUtilization: totalUtilization / gpuCards.length,
    totalVramPercent: totalVramMb > 0 ? (totalVramUsedMb / totalVramMb) * 100 : 0,
    totalVramUsedMb,
    totalVramMb,
  };
}

export function appendChartPoint(history: ChartPoint[], time: number, value: number, cutoff: number): ChartPoint[] {
  const filtered = history.filter((point) => point.time > cutoff && point.time !== time);
  filtered.push({ time, value });
  return filtered;
}

export function mergeChartPoints(prev: ChartPoint[], seed: ChartPoint[], liveCutoff: number): ChartPoint[] {
  if (seed.length === 0) {
    return prev;
  }

  const merged = new Map<number, number>();
  for (const point of seed) {
    merged.set(point.time, point.value);
  }
  for (const point of prev) {
    merged.set(point.time, point.value);
  }

  return Array.from(merged.entries())
    .filter(([time]) => time > liveCutoff)
    .sort(([left], [right]) => left - right)
    .map(([time, value]) => ({ time, value }));
}

export function buildGpuHistoryFromSnapshots(snapshots: SnapshotWithGpu[], cutoff: number): Record<number, PerGpuRealtimeHistory> {
  const perGpu: Record<number, PerGpuRealtimeHistory> = {};

  for (const snapshot of snapshots) {
    const time = snapshot.timestamp * 1000;
    if (time <= cutoff) {
      continue;
    }

    for (const gpu of snapshot.gpuCards) {
      const current = perGpu[gpu.index] ?? { utilization: [], memoryUsage: [], memoryBandwidth: [] };
      current.utilization.push({ time, value: gpu.utilizationGpu });
      current.memoryUsage.push({ time, value: computeGpuMemoryUsagePercent(gpu) });
      current.memoryBandwidth.push({ time, value: gpu.utilizationMemory });
      perGpu[gpu.index] = current;
    }
  }

  return perGpu;
}

export function buildHostHistoryFromSnapshots(snapshots: SnapshotWithGpu[], cutoff: number): HostRealtimeHistory {
  const history: HostRealtimeHistory = {
    cpuUsage: [],
    memoryUsage: [],
  };

  for (const snapshot of snapshots) {
    const time = snapshot.timestamp * 1000;
    if (time <= cutoff) {
      continue;
    }

    history.cpuUsage.push({ time, value: snapshot.cpu.usagePercent });
    history.memoryUsage.push({ time, value: snapshot.memory.usagePercent });
  }

  return history;
}

export function formatMemoryGb(megabytes: number): string {
  return `${(megabytes / 1024).toFixed(1)} GB`;
}

export function formatMemoryPairGb(usedMb: number, totalMb: number): string {
  return `${(usedMb / 1024).toFixed(1)}/${(totalMb / 1024).toFixed(1)} GB`;
}

export function formatDiskPairGb(usedGb: number, totalGb: number): string {
  return `${usedGb.toFixed(1)}/${totalGb.toFixed(1)} GB`;
}

export function selectPrimaryDisk(disks: DiskInfo[]): DiskInfo | undefined {
  const rankDisk = (disk: DiskInfo): number => {
    const mountPoint = disk.mountPoint.toLowerCase();
    if (mountPoint === '/' || mountPoint === '\\') return 0;
    if (mountPoint === 'c:' || mountPoint === 'c:\\') return 1;
    if (/^[a-z]:\\?$/iu.test(disk.mountPoint)) return 2;
    return 10;
  };

  return [...disks].sort((left, right) => {
    const rankDelta = rankDisk(left) - rankDisk(right);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return left.mountPoint.localeCompare(right.mountPoint, 'zh-CN');
  })[0];
}

export function getThresholdFillPercent(usagePercent: number): number {
  return clamp(usagePercent, 0, 100);
}

export function getUsageTone(usagePercent: number | undefined): UsageTone {
  const value = usagePercent ?? 0;
  if (value > 90) {
    return 'critical';
  }
  if (value > 60) {
    return 'warning';
  }
  return 'normal';
}

export function getUsagePalette(usagePercent: number | undefined): UsagePalette {
  const tone = getUsageTone(usagePercent);
  if (tone === 'critical') {
    return {
      tone,
      textColor: '#ff878d',
      accentColor: '#ff6c71',
      borderColor: '#5a2630',
      backgroundColor: '#221119',
    };
  }
  if (tone === 'warning') {
    return {
      tone,
      textColor: '#ffd57f',
      accentColor: '#f3b24c',
      borderColor: '#5b4520',
      backgroundColor: '#241b10',
    };
  }
  return {
    tone,
    textColor: '#70e0a6',
    accentColor: '#2bc38a',
    borderColor: '#1e4a35',
    backgroundColor: '#101f18',
  };
}