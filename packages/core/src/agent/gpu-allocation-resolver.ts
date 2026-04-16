import { getLatestMetrics } from '../db/metrics.js';
import { getTaskQueueCache } from './task-queue-cache.js';
import { resolveTaskPerson, resolveRawUserPerson } from '../person/resolve.js';
import type {
  ResolvedGpuAllocationResponse,
  ResolvedGpuAllocationSegment,
} from '../types.js';

/**
 * Merge a new segment into the per-GPU segment map.
 * If a segment with the same ownerKey already exists, accumulate usedMemoryMB
 * and merge sourceKinds.
 */
function upsertResolvedSegment(
  segmentMap: Map<string, ResolvedGpuAllocationSegment>,
  nextSegment: ResolvedGpuAllocationSegment,
): void {
  const existing = segmentMap.get(nextSegment.ownerKey);
  if (!existing) {
    segmentMap.set(nextSegment.ownerKey, nextSegment);
    return;
  }

  existing.usedMemoryMB += nextSegment.usedMemoryMB;
  for (const sourceKind of nextSegment.sourceKinds) {
    if (!existing.sourceKinds.includes(sourceKind)) {
      existing.sourceKinds.push(sourceKind);
    }
  }
  if (!existing.rawUser && nextSegment.rawUser) {
    existing.rawUser = nextSegment.rawUser;
  }
}

/**
 * Derive a person-resolved GPU allocation view from the latest metrics snapshot.
 *
 * Resolution order per segment:
 * - PMEOW tasks: find mirrored task → read task.user → resolve person (override > binding)
 * - User processes: resolve person by server + username
 * - Unknown processes: group into Unknown bucket
 *
 * Within the same GPU, segments with the same ownerKey are merged.
 */
export function getResolvedGpuAllocation(serverId: string): ResolvedGpuAllocationResponse | null {
  const metrics = getLatestMetrics(serverId);
  if (!metrics || !metrics.gpuAllocation) return null;

  const allocation = metrics.gpuAllocation;
  const timestamp = metrics.timestamp;

  const perGpu = allocation.perGpu.map(gpu => {
    const segmentMap = new Map<string, ResolvedGpuAllocationSegment>();

    // Resolve PMEOW task allocations
    for (const taskAllocation of gpu.pmeowTasks) {
      const cached = getTaskQueueCache(serverId);
      const allTasks = cached ? [...cached.queued, ...cached.running, ...cached.recent] : [];
      const task = allTasks.find(t => t.taskId === taskAllocation.taskId);
      const rawUser = task?.user;
      const resolved = resolveTaskPerson(serverId, taskAllocation.taskId, rawUser, timestamp);

      let segment: ResolvedGpuAllocationSegment;
      if (resolved.person) {
        segment = {
          ownerKey: `person:${resolved.person.id}`,
          ownerKind: 'person',
          displayName: resolved.person.displayName,
          usedMemoryMB: taskAllocation.actualVramMB,
          personId: resolved.person.id,
          rawUser,
          sourceKinds: ['task'],
        };
      } else if (rawUser) {
        segment = {
          ownerKey: `user:${rawUser}`,
          ownerKind: 'user',
          displayName: rawUser,
          usedMemoryMB: taskAllocation.actualVramMB,
          rawUser,
          sourceKinds: ['task'],
        };
      } else {
        segment = {
          ownerKey: 'unknown',
          ownerKind: 'unknown',
          displayName: 'Unknown',
          usedMemoryMB: taskAllocation.actualVramMB,
          sourceKinds: ['task'],
        };
      }
      upsertResolvedSegment(segmentMap, segment);
    }

    // Resolve ordinary user processes
    for (const process of gpu.userProcesses) {
      const resolved = resolveRawUserPerson(serverId, process.user, timestamp);

      let segment: ResolvedGpuAllocationSegment;
      if (resolved.person) {
        segment = {
          ownerKey: `person:${resolved.person.id}`,
          ownerKind: 'person',
          displayName: resolved.person.displayName,
          usedMemoryMB: process.usedMemoryMB,
          personId: resolved.person.id,
          rawUser: process.user,
          sourceKinds: ['user_process'],
        };
      } else {
        segment = {
          ownerKey: `user:${process.user}`,
          ownerKind: 'user',
          displayName: process.user,
          usedMemoryMB: process.usedMemoryMB,
          rawUser: process.user,
          sourceKinds: ['user_process'],
        };
      }
      upsertResolvedSegment(segmentMap, segment);
    }

    // Group unknown processes
    for (const process of gpu.unknownProcesses) {
      upsertResolvedSegment(segmentMap, {
        ownerKey: 'unknown',
        ownerKind: 'unknown',
        displayName: 'Unknown',
        usedMemoryMB: process.usedMemoryMB,
        sourceKinds: ['unknown_process'],
      });
    }

    const segments = [...segmentMap.values()];

    // Compute unattributed usage (reported used > sum of attributed segments)
    const attributedUsedMB = segments.reduce((sum, segment) => sum + segment.usedMemoryMB, 0);
    const actualUsedMB = Math.max(gpu.usedMemoryMB ?? 0, attributedUsedMB);
    const unattributedUsedMB = Math.max(actualUsedMB - attributedUsedMB, 0);

    if (unattributedUsedMB > 0) {
      segments.push({
        ownerKey: 'unattributed',
        ownerKind: 'unknown',
        displayName: 'Unattributed',
        usedMemoryMB: unattributedUsedMB,
        sourceKinds: ['unknown_process'],
      });
    }

    // Sort by usedMemoryMB descending, then displayName ascending
    segments.sort((a, b) => {
      if (b.usedMemoryMB !== a.usedMemoryMB) return b.usedMemoryMB - a.usedMemoryMB;
      return a.displayName.localeCompare(b.displayName);
    });

    return {
      gpuIndex: gpu.gpuIndex,
      totalMemoryMB: gpu.totalMemoryMB,
      freeMB: Math.max(gpu.totalMemoryMB - actualUsedMB, 0),
      segments,
    };
  });

  return {
    serverId,
    snapshotTimestamp: timestamp,
    perGpu,
  };
}
