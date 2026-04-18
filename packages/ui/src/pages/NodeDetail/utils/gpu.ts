import type { SnapshotWithGpu, TaskInfo } from '../../../transport/types.js';
import { buildGpuOwnerGroups, aggregateOwnerGroups, type OwnerGroup } from '../../../utils/gpuAllocation.js';

export interface GpuTotals {
  averageUtilization: number;
  totalVramPercent: number;
}

export function computeGpuTotals(gpuCards: SnapshotWithGpu['gpuCards']): GpuTotals {
  if (gpuCards.length === 0) {
    return { averageUtilization: 0, totalVramPercent: 0 };
  }

  const totalUtilization = gpuCards.reduce((sum, gpu) => sum + gpu.utilizationGpu, 0);
  const totalMemory = gpuCards.reduce((sum, gpu) => sum + gpu.memoryTotalMb, 0);
  const usedMemory = gpuCards.reduce((sum, gpu) => sum + gpu.memoryUsedMb, 0);

  return {
    averageUtilization: totalUtilization / gpuCards.length,
    totalVramPercent: totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0,
  };
}

export function computeGpuMemoryUsagePercent(gpu: SnapshotWithGpu['gpuCards'][number]): number {
  return gpu.memoryTotalMb > 0 ? (gpu.memoryUsedMb / gpu.memoryTotalMb) * 100 : 0;
}

export interface GpuAllocationLegendModel {
  owners: OwnerGroup[];
  unknownTotalMb: number;
  note: string | null;
}

export function buildGpuAllocationLegendModel(gpuCards: SnapshotWithGpu['gpuCards'], tasks: TaskInfo[] | undefined, historical: boolean): GpuAllocationLegendModel {
  const perGpu = gpuCards.map((gpu) => buildGpuOwnerGroups(gpu, tasks, historical));
  const mergedOwners = aggregateOwnerGroups(perGpu.map((item) => item.groups));
  const owners = mergedOwners.filter((group) => group.key !== 'managed:historical' && group.key !== 'managed:unresolved');
  const fallbackOwners = mergedOwners.filter((group) => group.key === 'managed:historical' || group.key === 'managed:unresolved');

  return {
    owners: owners.length > 0 ? owners : fallbackOwners,
    unknownTotalMb: perGpu.reduce((sum, item) => sum + item.unknownMb, 0),
    note: perGpu.find((item) => item.note)?.note ?? null,
  };
}
