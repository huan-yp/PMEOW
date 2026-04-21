/**
 * 任务摄入的唯一业务入口。
 *
 * 从一份 Agent 汇报中提取 active / recentlyEnded 视图，
 * 每轮先全量更新任务持久化，再调用 diffTasks 生成状态变化用于事件广播，
 * 并返回 TaskEvent[] 供上层广播。
 *
 * @module
 */
import type { UnifiedReport } from '../types.js';
import type { TaskEvent } from './events.js';
import { diffTasks } from './differ.js';
import * as taskDb from '../db/tasks.js';

export class TaskEngine {
  /**
   * Process task queue from a report: diff against previous state,
   * persist changes, and return generated events.
   */
  processReport(serverId: string, prevReport: UnifiedReport | undefined, currentReport: UnifiedReport): TaskEvent[] {
    const prevTasks = prevReport
      ? [...prevReport.taskQueue.queued, ...prevReport.taskQueue.running]
      : [];
    const currTasks = [...currentReport.taskQueue.queued, ...currentReport.taskQueue.running];
    const recentlyEnded = currentReport.taskQueue.recentlyEnded ?? [];
    const reportTimestamp = Math.floor(currentReport.timestamp);

    const persistedTaskIds = new Set<string>();
    for (const task of currTasks) {
      taskDb.upsertTask(serverId, task);
      taskDb.upsertTaskScheduleSnapshot(serverId, task, reportTimestamp);
      persistedTaskIds.add(task.taskId);
    }

    for (const task of recentlyEnded) {
      taskDb.upsertTask(serverId, task);
      taskDb.upsertTaskScheduleSnapshot(serverId, task, reportTimestamp);
      persistedTaskIds.add(task.taskId);
    }

    const diffs = diffTasks(serverId, prevTasks, currTasks, recentlyEnded);
    const events: TaskEvent[] = [];

    for (const diff of diffs) {
      if (diff.eventType === 'ended' && !persistedTaskIds.has(diff.task.taskId)) {
        taskDb.upsertTask(serverId, diff.task);
        persistedTaskIds.add(diff.task.taskId);
      }

      events.push({
        serverId,
        eventType: diff.eventType,
        task: diff.task,
      });
    }

    return events;
  }
}
