import { TaskInfo, TaskRecord } from '../types.js';

export type TaskEventType = 'task_submitted' | 'task_started' | 'task_ended' | 'task_priority_changed';

export interface TaskEvent {
  serverId: string;
  eventType: TaskEventType;
  task: TaskInfo | TaskRecord;
}
