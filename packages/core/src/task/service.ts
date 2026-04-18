import * as taskDb from '../db/tasks.js';
import { AgentSessionRegistry } from '../node/registry.js';
import { SERVER_COMMAND } from '../agent/protocol.js';
import { TaskRecord } from '../types.js';

export interface TaskFilter {
  serverId?: string;
  status?: string;
  user?: string;
  limit?: number;
  offset?: number;
}

export function listTasks(filter?: TaskFilter): TaskRecord[] {
  return taskDb.getTasks(filter);
}

export function getTask(taskId: string): TaskRecord | undefined {
  return taskDb.getTaskById(taskId);
}

export function countTasks(filter?: TaskFilter): number {
  return taskDb.countTasks(filter);
}

export function cancelTask(registry: AgentSessionRegistry, serverId: string, taskId: string): void {
  const session = registry.getSessionByServerId(serverId);
  if (session) {
    session.emit(SERVER_COMMAND.cancelTask, { taskId });
  }
}

export function setPriority(registry: AgentSessionRegistry, serverId: string, taskId: string, priority: number): void {
  const session = registry.getSessionByServerId(serverId);
  if (session) {
    session.emit(SERVER_COMMAND.setPriority, { taskId, priority });
  }
}
