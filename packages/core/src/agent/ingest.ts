import { upsertAgentTask } from '../db/agent-tasks.js';
import { saveGpuUsageRows, type GpuUsageRowInput } from '../db/gpu-usage.js';
import { saveMetrics } from '../db/metrics.js';
import { recordGpuAttributionFacts, recordTaskAttributionFact } from '../db/person-attribution.js';
import { replaceServerLocalUsers } from '../db/server-local-users.js';
import type { AgentLocalUsersPayload, AgentTaskUpdatePayload, GpuAllocationSummary, MetricsSnapshot } from '../types.js';

export function ingestAgentMetrics(snapshot: MetricsSnapshot): void {
  saveMetrics(snapshot);

  if (snapshot.gpuAllocation === undefined) {
    return;
  }

  const rows = flattenGpuAllocation(snapshot.serverId, snapshot.timestamp, snapshot.gpuAllocation);
  saveGpuUsageRows(snapshot.serverId, snapshot.timestamp, rows);
  recordGpuAttributionFacts(snapshot.serverId, snapshot.timestamp);
}

export function ingestAgentTaskUpdate(update: AgentTaskUpdatePayload): void {
  upsertAgentTask(update);
  recordTaskAttributionFact(update);
}

export function ingestAgentLocalUsers(payload: AgentLocalUsersPayload): void {
  replaceServerLocalUsers(payload.serverId, payload.timestamp, payload.users);
}

export function flattenGpuAllocation(
  serverId: string,
  timestamp: number,
  gpuAllocation: GpuAllocationSummary,
): GpuUsageRowInput[] {
  const rows: GpuUsageRowInput[] = [];

  for (const allocation of gpuAllocation.perGpu) {
    for (const task of allocation.pmeowTasks) {
      rows.push({
        gpuIndex: allocation.gpuIndex,
        ownerType: 'task',
        ownerId: task.taskId,
        taskId: task.taskId,
        usedMemoryMB: task.actualVramMB,
        declaredVramMB: task.declaredVramMB,
      });
    }

    for (const process of allocation.userProcesses) {
      rows.push({
        gpuIndex: allocation.gpuIndex,
        ownerType: 'user',
        ownerId: process.user,
        userName: process.user,
        pid: process.pid,
        command: process.command,
        usedMemoryMB: process.usedMemoryMB,
      });
    }

    for (const process of allocation.unknownProcesses) {
      rows.push({
        gpuIndex: allocation.gpuIndex,
        ownerType: 'unknown',
        pid: process.pid,
        command: process.command,
        usedMemoryMB: process.usedMemoryMB,
      });
    }
  }

  return rows;
}