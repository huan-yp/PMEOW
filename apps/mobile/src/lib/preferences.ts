import AsyncStorage from '@react-native-async-storage/async-storage';

export interface MobileNotificationSettings {
  notificationsEnabled: boolean;
  adminCategories: {
    alerts: boolean;
    security: boolean;
    taskEvents: boolean;
  };
  person: {
    taskEvents: boolean;
    idleServerIds: string[];
  };
}

const STORAGE_KEY = 'pmeow.mobile.notification-settings';

export const DEFAULT_NOTIFICATION_SETTINGS: MobileNotificationSettings = {
  notificationsEnabled: true,
  adminCategories: {
    alerts: true,
    security: true,
    taskEvents: true,
  },
  person: {
    taskEvents: true,
    idleServerIds: [],
  },
};

export async function loadNotificationSettings(): Promise<MobileNotificationSettings> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<MobileNotificationSettings>;
    return {
      notificationsEnabled: parsed.notificationsEnabled ?? DEFAULT_NOTIFICATION_SETTINGS.notificationsEnabled,
      adminCategories: {
        alerts: parsed.adminCategories?.alerts ?? DEFAULT_NOTIFICATION_SETTINGS.adminCategories.alerts,
        security: parsed.adminCategories?.security ?? DEFAULT_NOTIFICATION_SETTINGS.adminCategories.security,
        taskEvents: parsed.adminCategories?.taskEvents ?? DEFAULT_NOTIFICATION_SETTINGS.adminCategories.taskEvents,
      },
      person: {
        taskEvents: parsed.person?.taskEvents ?? DEFAULT_NOTIFICATION_SETTINGS.person.taskEvents,
        idleServerIds: Array.isArray(parsed.person?.idleServerIds)
          ? parsed.person.idleServerIds.filter((value): value is string => typeof value === 'string')
          : DEFAULT_NOTIFICATION_SETTINGS.person.idleServerIds,
      },
    };
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

export async function saveNotificationSettings(settings: MobileNotificationSettings): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}