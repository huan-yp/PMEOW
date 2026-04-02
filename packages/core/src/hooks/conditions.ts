import type { MetricsSnapshot, HookCondition, GpuMetrics } from '../types.js';

// GPU idle state tracking for gpu_idle_duration condition
const gpuBusySince = new Map<string, number>(); // serverId -> last time GPU was busy

export function evaluateCondition(
  condition: HookCondition,
  metrics: MetricsSnapshot
): boolean {
  if (condition.serverId !== metrics.serverId) return false;

  const gpu = metrics.gpu;
  if (!gpu.available) return false;

  switch (condition.type) {
    case 'gpu_mem_below':
      return gpu.memoryUsagePercent < condition.threshold;

    case 'gpu_util_below':
      return gpu.utilizationPercent < condition.threshold;

    case 'gpu_idle_duration':
      return checkIdleDuration(metrics.serverId, gpu, condition.threshold);

    default:
      return false;
  }
}

function checkIdleDuration(serverId: string, gpu: GpuMetrics, thresholdMinutes: number): boolean {
  const isIdle = gpu.utilizationPercent < 5 && gpu.memoryUsagePercent < 10;

  if (!isIdle) {
    gpuBusySince.set(serverId, Date.now());
    return false;
  }

  const lastBusy = gpuBusySince.get(serverId);
  if (!lastBusy) {
    // Never been busy since tracking started, assume idle from now
    gpuBusySince.set(serverId, Date.now() - thresholdMinutes * 60 * 1000 - 1);
    return true;
  }

  const idleMs = Date.now() - lastBusy;
  return idleMs >= thresholdMinutes * 60 * 1000;
}

export function getGpuIdleMinutes(serverId: string): number {
  const lastBusy = gpuBusySince.get(serverId);
  if (!lastBusy) return 0;
  return Math.floor((Date.now() - lastBusy) / 60000);
}

export function resetIdleTracking(serverId: string): void {
  gpuBusySince.delete(serverId);
}
