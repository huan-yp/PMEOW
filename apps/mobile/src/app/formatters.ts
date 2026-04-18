import type { Alert, SecurityEvent, Task, TaskEvent, TaskInfo } from '@monitor/app-common';
import type { NotificationInboxItem } from '../lib/notification-inbox';

export function normalizeTimestamp(timestamp: number | null): number | null {
  if (!timestamp) {
    return null;
  }

  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

export function formatTimestamp(timestamp: number | null): string {
  const normalized = normalizeTimestamp(timestamp);
  if (!normalized) {
    return '尚未上报';
  }
  return new Date(normalized).toLocaleString('zh-CN');
}

export function formatPercent(value: number | undefined): string {
  if (value == null) {
    return '--';
  }
  return `${value.toFixed(1)}%`;
}

export function formatTaskEventLabel(event: TaskEvent): string {
  if (event.eventType === 'submitted') {
    return '已提交';
  }
  if (event.eventType === 'started') {
    return '已启动';
  }
  return '已结束';
}

export function formatAlertType(alertType: Alert['alertType']): string {
  const labels: Record<Alert['alertType'], string> = {
    cpu: 'CPU',
    memory: '内存',
    disk: '磁盘',
    gpu_temp: 'GPU 温度',
    offline: '离线',
    gpu_idle_memory: 'GPU 空闲',
  };
  return labels[alertType];
}

export function formatAlertValue(alert: Alert): string {
  if (alert.alertType === 'offline') {
    return typeof alert.value === 'number' ? `已离线 ${Math.round(alert.value)} 秒` : '节点离线中';
  }
  if (alert.alertType === 'gpu_temp') {
    return typeof alert.value === 'number' ? `${alert.value.toFixed(1)}°C` : '--';
  }
  return typeof alert.value === 'number' ? `${alert.value.toFixed(1)}%` : '--';
}

export function formatSecurityEventType(eventType: SecurityEvent['eventType']): string {
  const labels: Record<SecurityEvent['eventType'], string> = {
    suspicious_process: '可疑进程',
    unowned_gpu: '未归属 GPU',
    high_gpu_utilization: '高 GPU 利用率',
    marked_safe: '已标记安全',
    unresolve: '重新打开',
  };
  return labels[eventType];
}

export function formatTaskStatus(status: Task['status']): string {
  const labels: Record<Task['status'], string> = {
    queued: '排队中',
    running: '运行中',
    succeeded: '已成功',
    failed: '失败',
    cancelled: '已取消',
    abnormal: '异常',
  };
  return labels[status];
}

export function formatQueueTaskStatus(status: TaskInfo['status']): string {
  return formatTaskStatus(status);
}

export function formatNotificationKind(kind: NotificationInboxItem['kind']): string {
  const labels: Record<NotificationInboxItem['kind'], string> = {
    task: '任务通知',
    alert: '告警通知',
    security: '安全通知',
    idle: '空闲提醒',
  };
  return labels[kind];
}