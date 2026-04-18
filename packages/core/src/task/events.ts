import { TaskInfo, TaskRecord } from '../types.js';

export type TaskEventType = 'submitted' | 'started' | 'ended' | 'priority_changed' | 'schedule_updated';

export interface TaskEvent {
  serverId: string;
  eventType: TaskEventType;
  task: TaskInfo | TaskRecord;
}
