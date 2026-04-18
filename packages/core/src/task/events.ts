import { TaskInfo, TaskRecord } from '../types.js';

export type TaskEventType = 'submitted' | 'started' | 'ended' | 'priority_changed';

export interface TaskEvent {
  serverId: string;
  eventType: TaskEventType;
  task: TaskInfo | TaskRecord;
}
