/**
 * 任务事件类型定义：submitted / started / ended。
 *
 * @module
 */
import { TaskInfo, TaskRecord } from '../types.js';

export type TaskEventType = 'submitted' | 'started' | 'ended';

export interface TaskEvent {
  serverId: string;
  eventType: TaskEventType;
  task: TaskInfo | TaskRecord;
}
