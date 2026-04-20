import AsyncStorage from '@react-native-async-storage/async-storage';

export interface IdleGpuNotificationRule {
  minIdleGpuCount: number;
  idleWindowSeconds: number;
  maxGpuUtilizationPercent: number;
  minSchedulableFreePercent: number;
}

export type MobileHomeView = 'summary' | 'gpuIdle';

export const DEFAULT_IDLE_GPU_NOTIFICATION_RULE: IdleGpuNotificationRule = {
  minIdleGpuCount: 1,
  idleWindowSeconds: 60,
  maxGpuUtilizationPercent: 5,
  minSchedulableFreePercent: 80,
};

function sanitizeWholeNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function sanitizePercent(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

function sanitizeIdleGpuRule(value: unknown): IdleGpuNotificationRule {
  const parsed = (value ?? {}) as Partial<IdleGpuNotificationRule>;

  return {
    minIdleGpuCount: sanitizeWholeNumber(parsed.minIdleGpuCount, DEFAULT_IDLE_GPU_NOTIFICATION_RULE.minIdleGpuCount, 1, 16),
    idleWindowSeconds: sanitizeWholeNumber(parsed.idleWindowSeconds, DEFAULT_IDLE_GPU_NOTIFICATION_RULE.idleWindowSeconds, 10, 3600),
    maxGpuUtilizationPercent: sanitizePercent(parsed.maxGpuUtilizationPercent, DEFAULT_IDLE_GPU_NOTIFICATION_RULE.maxGpuUtilizationPercent),
    minSchedulableFreePercent: sanitizePercent(parsed.minSchedulableFreePercent, DEFAULT_IDLE_GPU_NOTIFICATION_RULE.minSchedulableFreePercent),
  };
}

function sanitizeIdleGpuRuleMap(value: unknown): Record<string, IdleGpuNotificationRule> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([serverId]) => typeof serverId === 'string' && serverId.length > 0)
      .map(([serverId, rule]) => [serverId, sanitizeIdleGpuRule(rule)]),
  );
}

function migrateIdleServerIds(value: unknown): Record<string, IdleGpuNotificationRule> {
  if (!Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    value
      .filter((serverId): serverId is string => typeof serverId === 'string' && serverId.length > 0)
      .map((serverId) => [serverId, { ...DEFAULT_IDLE_GPU_NOTIFICATION_RULE }]),
  );
}

function sanitizeHomeView(value: unknown, fallback: MobileHomeView): MobileHomeView {
  return value === 'summary' || value === 'gpuIdle' ? value : fallback;
}

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0)));
}

export interface MobileNotificationSettings {
  notificationsEnabled: boolean;
  adminCategories: {
    alerts: boolean;
    security: boolean;
    taskEvents: boolean;
  };
  home: {
    adminView: MobileHomeView;
    personView: MobileHomeView;
    adminHiddenServerIds: string[];
  };
  person: {
    taskEvents: boolean;
    idleServerRules: Record<string, IdleGpuNotificationRule>;
  };
}

interface LegacyMobileNotificationSettings extends Omit<MobileNotificationSettings, 'person' | 'home'> {
  home?: {
    adminView?: MobileHomeView;
    personView?: MobileHomeView;
    adminHiddenServerIds?: string[];
  };
  person?: {
    taskEvents?: boolean;
    idleServerRules?: Record<string, IdleGpuNotificationRule>;
    idleServerIds?: string[];
  };
}

const STORAGE_KEY = 'pmeow.mobile.notification-settings';
const BATTERY_OPTIMIZATION_PROMPT_KEY = 'pmeow.mobile.android-battery-prompted';

export const DEFAULT_NOTIFICATION_SETTINGS: MobileNotificationSettings = {
  notificationsEnabled: true,
  adminCategories: {
    alerts: true,
    security: true,
    taskEvents: true,
  },
  home: {
    adminView: 'summary',
    personView: 'gpuIdle',
    adminHiddenServerIds: [],
  },
  person: {
    taskEvents: true,
    idleServerRules: {},
  },
};

export async function loadNotificationSettings(): Promise<MobileNotificationSettings> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LegacyMobileNotificationSettings>;
    return {
      notificationsEnabled: parsed.notificationsEnabled ?? DEFAULT_NOTIFICATION_SETTINGS.notificationsEnabled,
      adminCategories: {
        alerts: parsed.adminCategories?.alerts ?? DEFAULT_NOTIFICATION_SETTINGS.adminCategories.alerts,
        security: parsed.adminCategories?.security ?? DEFAULT_NOTIFICATION_SETTINGS.adminCategories.security,
        taskEvents: parsed.adminCategories?.taskEvents ?? DEFAULT_NOTIFICATION_SETTINGS.adminCategories.taskEvents,
      },
      home: {
        adminView: sanitizeHomeView(parsed.home?.adminView, DEFAULT_NOTIFICATION_SETTINGS.home.adminView),
        personView: sanitizeHomeView(parsed.home?.personView, DEFAULT_NOTIFICATION_SETTINGS.home.personView),
        adminHiddenServerIds: sanitizeStringList(parsed.home?.adminHiddenServerIds),
      },
      person: {
        taskEvents: parsed.person?.taskEvents ?? DEFAULT_NOTIFICATION_SETTINGS.person.taskEvents,
        idleServerRules: parsed.person?.idleServerRules
          ? sanitizeIdleGpuRuleMap(parsed.person.idleServerRules)
          : migrateIdleServerIds(parsed.person?.idleServerIds),
      },
    };
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

export async function saveNotificationSettings(settings: MobileNotificationSettings): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export async function loadBatteryOptimizationPromptShown(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(BATTERY_OPTIMIZATION_PROMPT_KEY);
  return raw === '1';
}

export async function saveBatteryOptimizationPromptShown(shown: boolean): Promise<void> {
  await AsyncStorage.setItem(BATTERY_OPTIMIZATION_PROMPT_KEY, shown ? '1' : '0');
}