import type {
  Alert,
  AlertStateChangeEvent,
  AuthSession,
  SecurityEvent,
  Server,
  TaskEvent,
} from '@pmeow/app-common';
import {
  pushNotificationInboxItem,
  saveNotificationInbox,
  type NotificationInboxItem,
} from '../lib/notification-inbox';
import {
  nativeNotificationsSupported,
  prepareNativeNotifications,
  showNativeNotification,
} from '../lib/native-notifications';
import { saveNotificationSettings, type IdleGpuNotificationRule, type MobileNotificationSettings } from '../lib/preferences';
import type { StateGetter, StateSetter } from './types';

function formatPercentValue(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function persistNotificationInboxAsync(items: NotificationInboxItem[]): void {
  void saveNotificationInbox(items);
}

function buildNotificationId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function findServerName(servers: Server[], serverId: string): string {
  return servers.find((server) => server.id === serverId)?.name ?? serverId;
}

function formatTaskEventTitle(event: TaskEvent, session: AuthSession): string {
  if (session.principal?.kind === 'admin') {
    return `任务${event.eventType === 'submitted' ? '提交' : event.eventType === 'started' ? '启动' : '结束'} · ${event.serverId}`;
  }
  return `我的任务${event.eventType === 'submitted' ? '已提交' : event.eventType === 'started' ? '已启动' : '已结束'}`;
}

function formatTaskEventBody(event: TaskEvent): string {
  return `${event.task.command} · ${event.task.user}`;
}

function formatAlertValue(alert: Alert): string {
  if (alert.alertType === 'offline') {
    const seconds = typeof alert.value === 'number' ? Math.round(alert.value) : null;
    return seconds == null ? '节点离线中' : `节点已离线 ${seconds} 秒`;
  }
  if (alert.alertType === 'gpu_temp') {
    return typeof alert.value === 'number' ? `${alert.value.toFixed(1)}°C` : 'GPU 温度异常';
  }
  return typeof alert.value === 'number' ? `${alert.value.toFixed(1)}%` : '阈值异常';
}

function formatAlertTypeLabel(alertType: Alert['alertType']): string {
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

function formatSecurityEventTypeLabel(eventType: SecurityEvent['eventType']): string {
  const labels: Record<SecurityEvent['eventType'], string> = {
    suspicious_process: '可疑进程',
    unowned_gpu: '未归属 GPU',
    high_gpu_utilization: '高 GPU 利用率',
    marked_safe: '已标记安全',
    unresolve: '重新打开',
  };
  return labels[eventType];
}

export async function enableNotificationsIfPossible(): Promise<boolean | null> {
  if (!nativeNotificationsSupported()) {
    return null;
  }
  return prepareNativeNotifications();
}

export async function persistNotificationSettings(settings: MobileNotificationSettings): Promise<void> {
  await saveNotificationSettings(settings);
}

async function dispatchNotification(
  item: NotificationInboxItem,
  set: StateSetter,
): Promise<boolean> {
  const shown = await showNativeNotification({
    title: item.title,
    body: item.body,
    data: {
      kind: item.kind,
      serverId: item.serverId ?? '',
      taskId: item.taskId ?? '',
    },
  });

  set((state) => {
    const nextInbox = shown
      ? pushNotificationInboxItem(state.notificationInbox, item)
      : state.notificationInbox;

    if (shown) {
      persistNotificationInboxAsync(nextInbox);
    }

    return {
      notificationPermissionGranted: shown ? true : state.notificationPermissionGranted,
      notificationInbox: nextInbox,
    };
  });

  return shown;
}

export async function maybeNotifyTaskEvent(event: TaskEvent, set: StateSetter, get: StateGetter): Promise<void> {
  const state = get();
  if (!state.notificationSettings.notificationsEnabled || !state.session.authenticated) {
    return;
  }
  if (state.session.principal.kind === 'admin' && !state.notificationSettings.adminCategories.taskEvents) {
    return;
  }
  if (state.session.principal.kind === 'person' && !state.notificationSettings.person.taskEvents) {
    return;
  }

  await dispatchNotification({
    id: buildNotificationId('task'),
    kind: 'task',
    title: formatTaskEventTitle(event, state.session),
    body: formatTaskEventBody(event),
    timestamp: Date.now(),
    serverId: event.serverId,
    taskId: event.task.taskId,
  }, set);
}

export async function maybeNotifyAlert(event: AlertStateChangeEvent, set: StateSetter, get: StateGetter): Promise<void> {
  const state = get();
  if (!state.session.authenticated || state.session.principal.kind !== 'admin') {
    return;
  }
  if (!state.notificationSettings.notificationsEnabled || !state.notificationSettings.adminCategories.alerts) {
    return;
  }
  if (event.toStatus !== 'active') {
    return;
  }

  await dispatchNotification({
    id: buildNotificationId('alert'),
    kind: 'alert',
    title: `${formatAlertTypeLabel(event.alert.alertType)} 告警 · ${findServerName(state.servers, event.alert.serverId)}`,
    body: formatAlertValue(event.alert),
    timestamp: Date.now(),
    serverId: event.alert.serverId,
  }, set);
}

export async function maybeNotifySecurityEvent(event: SecurityEvent, set: StateSetter, get: StateGetter): Promise<void> {
  const state = get();
  if (!state.session.authenticated || state.session.principal.kind !== 'admin') {
    return;
  }
  if (!state.notificationSettings.notificationsEnabled || !state.notificationSettings.adminCategories.security) {
    return;
  }
  if (event.resolved) {
    return;
  }

  await dispatchNotification({
    id: buildNotificationId('security'),
    kind: 'security',
    title: `安全事件 · ${findServerName(state.servers, event.serverId)}`,
    body: formatSecurityEventTypeLabel(event.eventType),
    timestamp: Date.now(),
    serverId: event.serverId,
  }, set);
}

export async function maybeNotifyServerIdle(
  serverId: string,
  idleGpuCount: number,
  rule: IdleGpuNotificationRule,
  set: StateSetter,
  get: StateGetter,
): Promise<boolean> {
  const state = get();
  if (!state.session.authenticated || state.session.principal.kind !== 'person') {
    return false;
  }
  if (!state.notificationSettings.notificationsEnabled) {
    return false;
  }
  if (!state.notificationSettings.person.idleServerRules[serverId]) {
    return false;
  }

  const serverName = findServerName(state.servers, serverId);
  return dispatchNotification({
    id: buildNotificationId('idle'),
    kind: 'idle',
    title: `GPU 空闲 · ${serverName}`,
    body: `${idleGpuCount} 张 GPU 在最近 ${rule.idleWindowSeconds} 秒内利用率低于 ${formatPercentValue(rule.maxGpuUtilizationPercent)}%，调度可用显存高于 ${formatPercentValue(rule.minSchedulableFreePercent)}%。`,
    timestamp: Date.now(),
    serverId,
  }, set);
}