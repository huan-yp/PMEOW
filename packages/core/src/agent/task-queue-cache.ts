import type { AgentTaskQueueGroup, AgentTaskQueueResponse, MirroredAgentTaskRecord } from '../types.js';

const cache = new Map<string, AgentTaskQueueResponse>();

export function getTaskQueueCache(serverId: string): AgentTaskQueueResponse | undefined {
  return cache.get(serverId);
}

export function setTaskQueueCache(serverId: string, data: AgentTaskQueueResponse): void {
  cache.set(serverId, data);
}

export function clearTaskQueueCache(serverId: string): void {
  cache.delete(serverId);
}

export function getAllCachedTaskQueueGroups(
  getServerName: (serverId: string) => string,
): AgentTaskQueueGroup[] {
  const groups: AgentTaskQueueGroup[] = [];

  for (const [serverId, data] of cache) {
    groups.push({
      serverId,
      serverName: getServerName(serverId),
      queued: data.queued,
      running: data.running,
      recent: data.recent,
    });
  }

  return groups;
}

/**
 * Compare new queue data with the cached version and return tasks
 * whose status has changed (for attribution recording and notifications).
 */
export function diffTaskQueue(
  serverId: string,
  newData: AgentTaskQueueResponse,
): MirroredAgentTaskRecord[] {
  const oldData = cache.get(serverId);
  if (!oldData) {
    // First fetch — treat all non-queued tasks as "changed" for attribution
    const allNew = [...newData.queued, ...newData.running, ...newData.recent];
    return allNew.map((t) => ({ ...t, serverId }));
  }

  const oldMap = new Map<string, string>();
  for (const t of [...oldData.queued, ...oldData.running, ...oldData.recent]) {
    oldMap.set(t.taskId, t.status);
  }

  const changed: MirroredAgentTaskRecord[] = [];
  for (const t of [...newData.queued, ...newData.running, ...newData.recent]) {
    const oldStatus = oldMap.get(t.taskId);
    if (oldStatus !== t.status) {
      changed.push({ ...t, serverId });
    }
  }

  return changed;
}