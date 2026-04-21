export type AdminTab = 'dashboard' | 'alerts' | 'settings';
export type PersonTab = 'home' | 'tasks' | 'settings';

export const ADMIN_TABS: Array<{ id: AdminTab; label: string }> = [
  { id: 'dashboard', label: '看板' },
  { id: 'alerts', label: '告警' },
  { id: 'settings', label: '设置' },
];

export const PERSON_TABS: Array<{ id: PersonTab; label: string }> = [
  { id: 'home', label: '首页' },
  { id: 'tasks', label: '我的任务' },
  { id: 'settings', label: '设置' },
];

export function tabToIndex<T extends string>(tabs: Array<{ id: T }>, tabId: T): number {
  const idx = tabs.findIndex((t) => t.id === tabId);
  return idx === -1 ? 0 : idx;
}

export function indexToTab<T extends string>(tabs: Array<{ id: T }>, index: number): T {
  return tabs[index]?.id ?? tabs[0].id;
}

export function isPersonTaskDetailVisible(tab: PersonTab, selectedTaskId: string | null): boolean {
  return tab === 'tasks' && selectedTaskId != null;
}

export function normalizeSelectedTaskIdForTab(tab: PersonTab, selectedTaskId: string | null): string | null {
  return tab === 'tasks' ? selectedTaskId : null;
}
