/**
 * 任务摄入的唯一业务入口。
 *
 * 从一份 Agent 汇报中提取 active / recentlyEnded 视图，
 * 调用 diffTasks 生成状态变化，逐条执行 upsertTask / endTask 落库，
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

    const diffs = diffTasks(serverId, prevTasks, currTasks, recentlyEnded);
    const events: TaskEvent[] = [];
    const nowSeconds = Math.floor(Date.now() / 1000);

    for (const diff of diffs) {
      if (diff.eventType === 'ended') {
        const finishedAt = diff.task.finishedAt ?? nowSeconds;
        taskDb.endTask(diff.task.taskId, finishedAt, diff.task.exitCode ?? null, diff.task.status, diff.task.endReason ?? null);
      } else {
        taskDb.upsertTask(serverId, diff.task);
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
