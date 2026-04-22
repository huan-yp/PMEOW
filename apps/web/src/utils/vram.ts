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

export function formatTaskRequestedVram(requireVramMb: number, requireVramOmitted: boolean): string {
  if (requireVramOmitted) {
    return '未声明（独占）';
  }
  return `${requireVramMb} MB`;
}

export function formatTaskRequestedResources(
  requireVramMb: number,
  requireVramOmitted: boolean,
  requireGpuCount: number,
): string {
  return `${formatTaskRequestedVram(requireVramMb, requireVramOmitted)} × ${requireGpuCount} GPU`;
}
