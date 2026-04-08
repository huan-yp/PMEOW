import { resolveTaskPerson, resolveRawUserPerson } from './resolve.js';
import { getAgentTask } from '../db/agent-tasks.js';
import { insertPersonAttributionFacts } from '../db/person-attribution.js';
import type { MetricsSnapshot, MirroredAgentTaskRecord, PersonAttributionFact } from '../types.js';

export function writeAttributionFacts(snapshot: MetricsSnapshot, _mirroredTasks: MirroredAgentTaskRecord[]): void {
  const allocation = snapshot.gpuAllocation;
  if (!allocation) return;

  const facts: PersonAttributionFact[] = [];
  const ts = snapshot.timestamp;
  const serverId = snapshot.serverId;

  for (const gpu of allocation.perGpu) {
    for (const taskAlloc of gpu.pmeowTasks) {
      const task = getAgentTask(taskAlloc.taskId);
      const rawUser = task?.user ?? undefined;
      const resolution = resolveTaskPerson(serverId, taskAlloc.taskId, rawUser, ts);

      facts.push({
        personId: resolution.person?.id ?? null,
        rawUser: rawUser ?? null,
        taskId: taskAlloc.taskId,
        serverId,
        gpuIndex: gpu.gpuIndex,
        vramMB: taskAlloc.actualVramMB,
        timestamp: ts,
        resolutionSource: resolution.resolutionSource === 'unknown' ? 'unassigned' : resolution.resolutionSource,
      });
    }

    for (const proc of gpu.userProcesses) {
      const resolution = resolveRawUserPerson(serverId, proc.user, ts);

      facts.push({
        personId: resolution.person?.id ?? null,
        rawUser: proc.user,
        taskId: null,
        serverId,
        gpuIndex: gpu.gpuIndex,
        vramMB: proc.usedMemoryMB,
        timestamp: ts,
        resolutionSource: resolution.resolutionSource === 'unknown' ? 'unassigned' : resolution.resolutionSource,
      });
    }

    for (const proc of gpu.unknownProcesses) {
      facts.push({
        personId: null,
        rawUser: null,
        taskId: null,
        serverId,
        gpuIndex: gpu.gpuIndex,
        vramMB: proc.usedMemoryMB,
        timestamp: ts,
        resolutionSource: 'unassigned',
      });
    }
  }

  insertPersonAttributionFacts(facts);
}
