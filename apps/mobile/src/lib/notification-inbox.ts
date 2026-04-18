import AsyncStorage from '@react-native-async-storage/async-storage';

export type NotificationInboxKind = 'task' | 'alert' | 'security' | 'idle';

export interface NotificationInboxItem {
  id: string;
  kind: NotificationInboxKind;
  title: string;
  body: string;
  timestamp: number;
  serverId?: string;
  taskId?: string;
}

const STORAGE_KEY = 'pmeow.mobile.notification-inbox';
export const MAX_NOTIFICATION_INBOX_ITEMS = 50;

export async function loadNotificationInbox(): Promise<NotificationInboxItem[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as NotificationInboxItem[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is NotificationInboxItem => {
      return typeof item?.id === 'string'
        && typeof item?.kind === 'string'
        && typeof item?.title === 'string'
        && typeof item?.body === 'string'
        && typeof item?.timestamp === 'number';
    }).slice(0, MAX_NOTIFICATION_INBOX_ITEMS);
  } catch {
    return [];
  }
}

export async function saveNotificationInbox(items: NotificationInboxItem[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_NOTIFICATION_INBOX_ITEMS)));
}

export function pushNotificationInboxItem(
  currentItems: NotificationInboxItem[],
  nextItem: NotificationInboxItem,
): NotificationInboxItem[] {
  return [nextItem, ...currentItems].slice(0, MAX_NOTIFICATION_INBOX_ITEMS);
}