import type { GpuCardReport, TaskInfo } from '@pmeow/app-common';
import { FREE_COLOR, UNKNOWN_COLOR, UNATTRIBUTED_COLOR, getOwnerColor } from '@pmeow/app-common';

export { FREE_COLOR, UNKNOWN_COLOR };

export interface OwnerGroup {
  key: string;
  label: string;
  baseColor: string;
  managedReservedMb: number;
  managedActualMb: number;
  unmanagedMb: number;
  taskCount: number;
  processCount: number;
}

export interface GpuAllocationLegendModel {
  owners: OwnerGroup[];
  unknownTotalMb: number;
  note: string | null;
}

interface ManagedEstimate {
  key: string;
  reservedMb: number;
  exactShare: number;
  floorShare: number;
  remainder: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function ensureOwnerGroup(groups: Map<string, OwnerGroup>, key: string, label: string): OwnerGroup {
  const existing = groups.get(key);
  if (existing) {
    return existing;
  }

  const next: OwnerGroup = {
    key,
    label,
    baseColor: '', // assigned in post-processing
    managedReservedMb: 0,
    managedActualMb: 0,
    unmanagedMb: 0,
    taskCount: 0,
    processCount: 0,
  };
  groups.set(key, next);
  return next;
}

function distributeManagedActual(groups: OwnerGroup[], totalActualManagedMb: number): void {
  const managed = groups.filter((group) => group.managedReservedMb > 0);
  const totalReserved = managed.reduce((sum, group) => sum + group.managedReservedMb, 0);

  if (managed.length === 0 || totalReserved <= 0 || totalActualManagedMb <= 0) {
    return;
  }

  const estimates: ManagedEstimate[] = managed.map((group) => {
    const exactShare = totalActualManagedMb * (group.managedReservedMb / totalReserved);
    const floorShare = Math.floor(exactShare);
    return {
      key: group.key,
      reservedMb: group.managedReservedMb,
      exactShare,
      floorShare,
      remainder: exactShare - floorShare,
    };
  });

  let remainder = totalActualManagedMb - estimates.reduce((sum, estimate) => sum + estimate.floorShare, 0);
  estimates.sort((left, right) => {
    if (right.remainder !== left.remainder) {
      return right.remainder - left.remainder;
    }
    return right.reservedMb - left.reservedMb;
  });

  for (const estimate of estimates) {
    const group = managed.find((item) => item.key === estimate.key);
    if (!group) {
      continue;
    }
    const nextActual = estimate.floorShare + (remainder > 0 ? 1 : 0);
    group.managedActualMb = clamp(nextActual, 0, group.managedReservedMb);
    if (remainder > 0) {
      remainder -= 1;
    }
  }
}

/**
 * Assign baseColor to every group using the collision-aware algorithm.
 *
 * Owners are sorted alphabetically by key before assignment so that each
 * owner deterministically "claims" its preferred hash color ahead of any
 * other owner that might hash to the same slot.
 */
function assignGroupColors(groups: Map<string, OwnerGroup>): void {
  const usedColors = new Set<string>();
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key)!;
    const ownerKind = key.startsWith('managed:') ? 'managed' : 'user';
    const color = getOwnerColor(key, ownerKind, usedColors);
    group.baseColor = color;
    if (color !== FREE_COLOR && color !== UNKNOWN_COLOR && color !== UNATTRIBUTED_COLOR) {
      usedColors.add(color);
    }
  }
}

export function buildGpuOwnerGroups(
  gpu: GpuCardReport,
  tasks: TaskInfo[] | undefined,
  historical: boolean,
): { groups: OwnerGroup[]; unknownMb: number; totalDisplayedMb: number; freeMb: number; note: string | null } {
  const groups = new Map<string, OwnerGroup>();
  const taskMap = new Map((tasks ?? []).map((task) => [task.taskId, task]));

  for (const allocation of gpu.taskAllocations) {
    const task = taskMap.get(allocation.taskId);
    const rawUser = task?.user?.trim();
    const fallbackKey = historical ? 'managed:historical' : 'managed:unresolved';
    const fallbackLabel = historical ? '托管任务（历史未归因）' : '托管任务（未归因）';
    const ownerKey = rawUser ? `user:${rawUser}` : fallbackKey;
    const ownerLabel = rawUser || fallbackLabel;
    const group = ensureOwnerGroup(groups, ownerKey, ownerLabel);
    group.managedReservedMb += allocation.declaredVramMb;
    group.taskCount += 1;
  }

  for (const process of gpu.userProcesses) {
    const ownerKey = `user:${process.user}`;
    const group = ensureOwnerGroup(groups, ownerKey, process.user);
    group.unmanagedMb += process.vramMb;
    group.processCount += 1;
  }

  assignGroupColors(groups);

  const unknownMb = gpu.unknownProcesses.reduce((sum, process) => sum + process.vramMb, 0);
  const totalManagedReserved = [...groups.values()].reduce((sum, group) => sum + group.managedReservedMb, 0);
  const totalUnmanaged = [...groups.values()].reduce((sum, group) => sum + group.unmanagedMb, 0);
  const totalActualManaged = clamp(gpu.memoryUsedMb - totalUnmanaged - unknownMb, 0, totalManagedReserved);

  distributeManagedActual([...groups.values()], totalActualManaged);

  const orderedGroups = [...groups.values()].sort((left, right) => {
    const leftTotal = left.managedReservedMb + left.unmanagedMb;
    const rightTotal = right.managedReservedMb + right.unmanagedMb;
    if (rightTotal !== leftTotal) {
      return rightTotal - leftTotal;
    }
    return left.label.localeCompare(right.label, 'zh-CN');
  });

  const totalDisplayedMb = totalManagedReserved + totalUnmanaged + unknownMb;
  const freeMb = Math.max(0, gpu.memoryTotalMb - totalDisplayedMb);
  const note = historical && gpu.taskAllocations.length > 0
    ? '历史快照缺少任务归属，托管任务按未归因分组展示。'
    : null;

  return { groups: orderedGroups, unknownMb, totalDisplayedMb, freeMb, note };
}

export function aggregateOwnerGroups(items: OwnerGroup[][]): OwnerGroup[] {
  const aggregate = new Map<string, OwnerGroup>();

  for (const groups of items) {
    for (const group of groups) {
      const existing = aggregate.get(group.key);
      if (existing) {
        existing.managedReservedMb += group.managedReservedMb;
        existing.managedActualMb += group.managedActualMb;
        existing.unmanagedMb += group.unmanagedMb;
        existing.taskCount += group.taskCount;
        existing.processCount += group.processCount;
      } else {
        aggregate.set(group.key, { ...group });
      }
    }
  }

  return [...aggregate.values()].sort((left, right) => {
    const leftTotal = left.managedReservedMb + left.unmanagedMb;
    const rightTotal = right.managedReservedMb + right.unmanagedMb;
    if (rightTotal !== leftTotal) {
      return rightTotal - leftTotal;
    }
    return left.label.localeCompare(right.label, 'zh-CN');
  });
}

export function buildGpuAllocationLegendModel(gpuCards: GpuCardReport[], tasks: TaskInfo[] | undefined, historical: boolean): GpuAllocationLegendModel {
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
