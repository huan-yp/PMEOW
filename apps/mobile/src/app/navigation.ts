export type AdminTabRouteName = 'OpsOverview' | 'Nodes' | 'Alerts' | 'AdminSettings';
export type PersonTabRouteName = 'Resources' | 'MyTasks' | 'Notifications' | 'PersonSettings';
export type AdminDetailRouteName = 'AdminServerDetail' | 'AdminAlertDetail' | 'AdminSecurityEventDetail';
export type PersonDetailRouteName = 'PersonServerDetail' | 'PersonTaskDetail';
export type MainTabIconId = 'overview' | 'nodes' | 'alerts' | 'settings' | 'resources' | 'tasks' | 'notifications';
export type AdminAlertSecondaryPageId = 'activeAlerts' | 'securityEvents';
export type AdminSettingsSecondaryPageId = 'localNotifications' | 'notificationInbox' | 'connection';
export type PersonTaskSecondaryPageId = 'inProgress' | 'completed' | 'all';
export type PersonNotificationSecondaryPageId = 'taskEvents' | 'notificationInbox';
export type PersonSettingsSecondaryPageId = 'localNotifications' | 'notificationInbox' | 'connection';
export type ServerDetailSecondaryPageId = 'overview' | 'realtime' | 'disk' | 'vram' | 'tasks';
export const SERVER_DETAIL_TAB_BLOCK_SIZE = 3;

export const ADMIN_TAB_ROUTES: Array<{ name: AdminTabRouteName; label: string; icon: MainTabIconId }> = [
  { name: 'OpsOverview', label: '总览', icon: 'overview' },
  { name: 'Nodes', label: '节点', icon: 'nodes' },
  { name: 'Alerts', label: '告警', icon: 'alerts' },
  { name: 'AdminSettings', label: '设置', icon: 'settings' },
];

export const PERSON_TAB_ROUTES: Array<{ name: PersonTabRouteName; label: string; icon: MainTabIconId }> = [
  { name: 'Resources', label: '资源', icon: 'resources' },
  { name: 'MyTasks', label: '我的任务', icon: 'tasks' },
  { name: 'Notifications', label: '通知', icon: 'notifications' },
  { name: 'PersonSettings', label: '设置', icon: 'settings' },
];

export const ADMIN_DETAIL_ROUTES: Array<{ name: AdminDetailRouteName }> = [
  { name: 'AdminServerDetail' },
  { name: 'AdminAlertDetail' },
  { name: 'AdminSecurityEventDetail' },
];

export const PERSON_DETAIL_ROUTES: Array<{ name: PersonDetailRouteName }> = [
  { name: 'PersonServerDetail' },
  { name: 'PersonTaskDetail' },
];

export const ADMIN_ALERT_SECONDARY_PAGES: Array<{ id: AdminAlertSecondaryPageId; label: string }> = [
  { id: 'activeAlerts', label: '活动告警' },
  { id: 'securityEvents', label: '安全事件' },
];

export const ADMIN_SETTINGS_SECONDARY_PAGES: Array<{ id: AdminSettingsSecondaryPageId; label: string }> = [
  { id: 'localNotifications', label: '本地通知' },
  { id: 'notificationInbox', label: '通知记录' },
  { id: 'connection', label: '当前连接' },
];

export const PERSON_TASK_SECONDARY_PAGES: Array<{ id: PersonTaskSecondaryPageId; label: string }> = [
  { id: 'inProgress', label: '进行中' },
  { id: 'completed', label: '已结束' },
  { id: 'all', label: '全部' },
];

export const PERSON_NOTIFICATION_SECONDARY_PAGES: Array<{ id: PersonNotificationSecondaryPageId; label: string }> = [
  { id: 'taskEvents', label: '任务事件' },
  { id: 'notificationInbox', label: '通知记录' },
];

export const PERSON_SETTINGS_SECONDARY_PAGES: Array<{ id: PersonSettingsSecondaryPageId; label: string }> = [
  { id: 'localNotifications', label: '本地通知' },
  { id: 'notificationInbox', label: '通知记录' },
  { id: 'connection', label: '当前连接' },
];

export const SERVER_DETAIL_SECONDARY_PAGES: Array<{ id: ServerDetailSecondaryPageId; label: string }> = [
  { id: 'overview', label: '总览' },
  { id: 'realtime', label: '资源实时走势' },
  { id: 'disk', label: '磁盘占用' },
  { id: 'vram', label: 'VRAM 分布' },
  { id: 'tasks', label: '任务' },
];

export function groupSecondaryPages<T>(pages: Array<{ id: T; label: string }>, blockSize: number): Array<Array<{ id: T; label: string }>> {
  if (blockSize <= 0 || pages.length <= blockSize) {
    return [pages];
  }

  const blocks: Array<Array<{ id: T; label: string }>> = [];
  let start = 0;
  while (start < pages.length) {
    blocks.push(pages.slice(start, start + blockSize));
    start += blockSize;
  }

  return blocks;
}

export function getServerDetailSecondaryPageBlocks(): Array<Array<{ id: ServerDetailSecondaryPageId; label: string }>> {
  return groupSecondaryPages(SERVER_DETAIL_SECONDARY_PAGES, SERVER_DETAIL_TAB_BLOCK_SIZE);
}

export const MOBILE_INFORMATION_MAP = {
  admin: {
    overviewCounts: 'OpsOverview',
    realtimeConnectionState: 'OpsOverview',
    machineSummary: 'Nodes',
    gpuIdleMachineView: 'Nodes',
    recentTaskEvents: 'OpsOverview',
    activeAlerts: 'Alerts',
    unresolvedSecurityEvents: 'Alerts',
    activeAlertDetail: 'AdminAlertDetail',
    securityEventDetail: 'AdminSecurityEventDetail',
    notificationSettings: 'AdminSettings',
    adminNotificationCategories: 'AdminSettings',
    hiddenHomeServers: 'AdminSettings',
    notificationInbox: 'AdminSettings',
    currentBackendAndSignOut: 'AdminSettings',
    serverDetailAllPanels: 'AdminServerDetail',
  },
  person: {
    machineSummary: 'Resources',
    gpuIdleMachineView: 'Resources',
    recentTaskEvents: 'Notifications',
    notificationInbox: 'Notifications',
    personTasks: 'MyTasks',
    cancelTask: 'MyTasks',
    notificationSettings: 'PersonSettings',
    personTaskNotifications: 'PersonSettings',
    idleServerSubscriptions: 'PersonSettings',
    currentBackendAndSignOut: 'PersonSettings',
    serverDetailAllPanels: 'PersonServerDetail',
    taskDetailAllFields: 'PersonTaskDetail',
  },
} as const;
