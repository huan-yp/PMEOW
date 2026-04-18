import type { TaskInfo } from '../types.js';
import type { TaskEventType } from './events.js';

export interface TaskDiffResult {
  eventType: TaskEventType;
  task: TaskInfo;
  serverId: string;
}

/**
 * Diff active tasks (queued/running) and process explicitly-ended tasks.
 *
 * Inputs:
 *   previousTasks  – active tasks from the previous report
 *   currentTasks   – active tasks from the current report
 *   recentlyEnded  – tasks the agent explicitly reports as terminated
 *
 * Rules:
 *   1. New active task (not in prev)          → submitted (+ started if running)
 *   2. Status queued→running                  → started
 *   3. Present in recentlyEnded               → ended (with full terminal info)
 *   4. In prev but missing from both curr     → ended (disappeared / abnormal)
 *      AND recentlyEnded
 */

export function diffTasks(
  serverId: string,
  previousTasks: TaskInfo[],
  currentTasks: TaskInfo[],
  recentlyEnded: TaskInfo[] = [],
): TaskDiffResult[] {
  const results: TaskDiffResult[] = [];
  const prevMap = new Map(previousTasks.map(t => [t.taskId, t]));
  const currMap = new Map(currentTasks.map(t => [t.taskId, t]));
  const endedMap = new Map(recentlyEnded.map(t => [t.taskId, t]));

  // New and updated active tasks
  for (const curr of currentTasks) {
    const prev = prevMap.get(curr.taskId);
    if (!prev) {
      results.push({ eventType: 'submitted', task: curr, serverId });
      if (curr.status === 'running') {
        results.push({ eventType: 'started', task: curr, serverId });
      }
    } else {
      if (prev.status === 'queued' && curr.status === 'running') {
        results.push({ eventType: 'started', task: curr, serverId });
      }
    }
  }

  // Explicitly ended tasks from the agent
  for (const ended of recentlyEnded) {
    results.push({ eventType: 'ended', task: ended, serverId });
  }

  // Disappeared tasks — in prev but not in curr and not in recentlyEnded
  for (const prev of previousTasks) {
    if (!currMap.has(prev.taskId) && !endedMap.has(prev.taskId)) {
      // Synthesize an abnormal-ended entry
      const disappeared: TaskInfo = {
        ...prev,
        status: 'abnormal',
        finishedAt: Math.floor(Date.now() / 1000),
        exitCode: null,
        endReason: 'disappeared',
      };
      results.push({ eventType: 'ended', task: disappeared, serverId });
    }
  }

  return results;
}
