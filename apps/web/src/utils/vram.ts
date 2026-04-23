export const VRAM_MB_PER_GB = 1024;

function toGigabytesFromMegabytes(megabytes: number): number {
  return (Number.isFinite(megabytes) ? megabytes : 0) / VRAM_MB_PER_GB;
}

function toGigabytesFromKilobytes(kilobytes: number): number {
  return (Number.isFinite(kilobytes) ? kilobytes : 0) / VRAM_MB_PER_GB / VRAM_MB_PER_GB;
}

export function formatMemoryGB(megabytes: number): string {
  return `${toGigabytesFromMegabytes(megabytes).toFixed(1)} GB`;
}

export function formatMemoryPairGB(usedMB: number, totalMB: number): string {
  return `${toGigabytesFromMegabytes(usedMB).toFixed(1)}/${toGigabytesFromMegabytes(totalMB).toFixed(1)} GB`;
}

export function formatMemoryKilobytesGB(kilobytes: number): string {
  return `${toGigabytesFromKilobytes(kilobytes).toFixed(1)} GB`;
}

export function formatVramGB(megabytes: number): string {
  return formatMemoryGB(megabytes);
}

export function formatVramPairGB(usedMB: number, totalMB: number): string {
  return formatMemoryPairGB(usedMB, totalMB);
}

export type TaskVramFields = {
  requireVramMb: number;
  requestedVramMb?: number | null;
  vramMode?: 'exclusive_auto' | 'shared';
  requireGpuCount?: number;
  autoObserveWindowSec?: number | null;
  autoPeakVramByGpuMb?: Record<string, number> | null;
  autoReclaimedVramByGpuMb?: Record<string, number | null> | null;
  autoReclaimDone?: boolean;
};

function resolveRequestedVram(task: TaskVramFields): number | null {
  if (task.requestedVramMb !== undefined) {
    return task.requestedVramMb;
  }
  return task.vramMode === 'exclusive_auto' ? null : task.requireVramMb;
}

function resolveVramMode(task: TaskVramFields): 'exclusive_auto' | 'shared' {
  if (task.vramMode === 'exclusive_auto' || task.vramMode === 'shared') {
    return task.vramMode;
  }
  return 'shared';
}

export function formatTaskRequestedVram(task: TaskVramFields): string {
  const mode = resolveVramMode(task);
  const requested = resolveRequestedVram(task);

  if (mode === 'exclusive_auto') {
    return '独占（自动观察）';
  }
  if (requested === 0) {
    return '0 MB（共享 / 不预留）';
  }
  return `${requested ?? 0} MB（共享）`;
}

export function formatTaskRequestedResources(
  task: TaskVramFields,
): string {
  return `${formatTaskRequestedVram(task)} × ${task.requireGpuCount ?? 1} GPU`;
}

export function formatPerGpuVramMap(values: Record<string, number> | null | undefined): string {
  if (!values || Object.keys(values).length === 0) {
    return '—';
  }
  return Object.entries(values)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([gpuId, value]) => `GPU ${gpuId}: ${value} MB`)
    .join('；');
}

export function formatPerGpuReclaimMap(values: Record<string, number | null> | null | undefined): string {
  if (!values || Object.keys(values).length === 0) {
    return '未生成回收结果，保持独占';
  }
  return Object.entries(values)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([gpuId, value]) => (value == null ? `GPU ${gpuId}: 未回收，保持独占` : `GPU ${gpuId}: 已回收至 ${value} MB`))
    .join('；');
}

export function formatAutoReclaimStatus(task: TaskVramFields): string {
  if (resolveVramMode(task) !== 'exclusive_auto') {
    return '不适用';
  }
  if (!task.autoReclaimDone) {
    return '观察中';
  }
  return formatPerGpuReclaimMap(task.autoReclaimedVramByGpuMb);
}
