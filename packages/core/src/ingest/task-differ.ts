import type { TaskInfo } from '../types.js';
import type { TaskEventType } from '../task/events.js';

export interface TaskDiffResult {
  eventType: TaskEventType;
  task: TaskInfo;
  serverId: string;
}

export function diffTasks(
  serverId: string,
  previousTasks: TaskInfo[],
  currentTasks: TaskInfo[],
): TaskDiffResult[] {
  const results: TaskDiffResult[] = [];
  const prevMap = new Map(previousTasks.map(t => [t.taskId, t]));
  const currMap = new Map(currentTasks.map(t => [t.taskId, t]));

  // New and updated tasks
  for (const curr of currentTasks) {
    const prev = prevMap.get(curr.taskId);
    if (!prev) {
      // New task
      results.push({ eventType: 'task_submitted', task: curr, serverId });
      if (curr.status === 'running') {
        results.push({ eventType: 'task_started', task: curr, serverId });
      }
    } else {
      // Status changed: queued → running
      if (prev.status === 'queued' && curr.status === 'running') {
        results.push({ eventType: 'task_started', task: curr, serverId });
      }
      // Priority changed
      if (prev.priority !== curr.priority) {
        results.push({ eventType: 'task_priority_changed', task: curr, serverId });
      }
    }
  }

  // Ended tasks (disappeared from report)
  for (const prev of previousTasks) {
    if (!currMap.has(prev.taskId)) {
      results.push({ eventType: 'task_ended', task: prev, serverId });
    }
  }

  return results;
}