/**
 * 任务查询和控制的唯一对外入口（TaskService）。
 *
 * 提供 listTasks / getTask / countTasks 查询接口，
 * 以及 cancelTask / setPriority 控制接口（通过 AgentSession 下发指令）。
 *
 * @module
 */
import * as taskDb from '../db/tasks.js';
import { AgentSessionRegistry } from '../node/registry.js';
import { SERVER_COMMAND } from '../agent/protocol.js';
import { Principal, ScheduleEvaluation, TaskRecord } from '../types.js';

export interface TaskFilter {
  serverId?: string;
  status?: string;
  user?: string;
  personId?: string;
  limit?: number;
  offset?: number;
}

export function listTasks(filter?: TaskFilter): TaskRecord[] {
  return taskDb.getTasks(filter);
}

export function getTask(taskId: string): TaskRecord | undefined {
  return taskDb.getTaskById(taskId);
}

export function getTaskScheduleHistory(task: Pick<TaskRecord, 'id' | 'scheduleHistory'>, nowSeconds?: number): ScheduleEvaluation[] {
  return taskDb.getTaskScheduleHistory(task.id, task.scheduleHistory, nowSeconds);
}

export function countTasks(filter?: TaskFilter): number {
  return taskDb.countTasks(filter);
}

export function listTasksForPrincipal(principal: Principal, filter?: Omit<TaskFilter, 'personId'>): TaskRecord[] {
  if (principal.kind === 'admin') {
    return listTasks(filter);
  }

  return listTasks({ ...filter, personId: principal.personId });
}

export function countTasksForPrincipal(principal: Principal, filter?: Omit<TaskFilter, 'personId'>): number {
  if (principal.kind === 'admin') {
    return countTasks(filter);
  }

  return countTasks({ ...filter, personId: principal.personId });
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
