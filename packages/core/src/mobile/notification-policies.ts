import type { CreateNotificationInput } from '../db/person-mobile-notifications.js';
import type { AgentTaskStatus, PersonMobilePreferenceRecord } from '../types.js';

export function buildTaskNotificationEvent(
  personId: string,
  taskId: string,
  serverId: string,
  status: AgentTaskStatus,
  command?: string,
): CreateNotificationInput | null {
  const statusLabels: Record<string, { eventType: string; title: string; prefKey: keyof PersonMobilePreferenceRecord }> = {
    running: { eventType: 'task_started', title: '任务开始运行', prefKey: 'notifyTaskStarted' },
    completed: { eventType: 'task_completed', title: '任务运行完成', prefKey: 'notifyTaskCompleted' },
    failed: { eventType: 'task_failed', title: '任务运行失败', prefKey: 'notifyTaskFailed' },
    cancelled: { eventType: 'task_cancelled', title: '任务已取消', prefKey: 'notifyTaskCancelled' },
  };

  const entry = statusLabels[status];
  if (!entry) return null;

  const shortCmd = command ? (command.length > 60 ? command.slice(0, 57) + '...' : command) : taskId;

  return {
    personId,
    category: 'task',
    eventType: entry.eventType,
    title: entry.title,
    body: `${shortCmd} @ ${serverId}`,
    payload: { taskId, serverId, status },
    dedupeKey: `task:${taskId}:${status}`,
  };
}

export function buildNodeStatusNotificationEvent(
  personId: string,
  serverId: string,
  serverName: string,
  online: boolean,
): CreateNotificationInput {
  return {
    personId,
    category: 'node',
    eventType: online ? 'node_online' : 'node_offline',
    title: online ? '节点恢复在线' : '节点离线',
    body: serverName || serverId,
    payload: { serverId, serverName, online },
    dedupeKey: `node:${serverId}:${online ? 'online' : 'offline'}`,
  };
}

export function buildGpuAvailabilityNotificationEvent(
  personId: string,
  serverId: string,
  serverName: string,
  availableGpuCount: number,
  minVramGB: number,
): CreateNotificationInput {
  return {
    personId,
    category: 'gpu',
    eventType: 'gpu_available',
    title: 'GPU 可用',
    body: `${serverName}: ${availableGpuCount} GPU(s) ≥ ${minVramGB} GB 空闲显存`,
    payload: { serverId, serverName, availableGpuCount, minVramGB },
    dedupeKey: `gpu:${serverId}:available:${availableGpuCount}`,
  };
}

export function shouldNotifyForTask(
  prefs: PersonMobilePreferenceRecord,
  status: AgentTaskStatus,
): boolean {
  const map: Partial<Record<AgentTaskStatus, keyof PersonMobilePreferenceRecord>> = {
    running: 'notifyTaskStarted',
    completed: 'notifyTaskCompleted',
    failed: 'notifyTaskFailed',
    cancelled: 'notifyTaskCancelled',
  };
  const key = map[status];
  return key ? Boolean(prefs[key]) : false;
}
