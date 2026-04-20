import type {
  Alert,
  AuthSession,
  SecurityEvent,
  Server,
  ServerStatus,
  Task,
  TaskEvent,
  UnifiedReport,
} from '@pmeow/app-common';
import type { NotificationInboxItem } from '../lib/notification-inbox';
import type { IdleGpuNotificationRule, MobileNotificationSettings } from '../lib/preferences';
import type { ConnectionMode } from '../lib/storage';

export const UNAUTHENTICATED_SESSION: AuthSession = {
  authenticated: false,
  principal: null,
  person: null,
  accessibleServerIds: null,
};

export interface OverviewData {
  servers: Server[];
  statuses: Record<string, ServerStatus>;
  latestMetrics: Record<string, UnifiedReport>;
  alerts: Alert[];
  securityEvents: SecurityEvent[];
  personTasks: Task[];
}

export interface SignInInput {
  secret: string;
}

export interface MobileAppState {
  hydrated: boolean;
  busy: boolean;
  refreshing: boolean;
  realtimeConnected: boolean;
  error: string | null;
  pendingTaskId: string | null;
  notificationPermissionGranted: boolean | null;
  notificationSettings: MobileNotificationSettings;
  notificationInbox: NotificationInboxItem[];
  baseUrl: string;
  mode: ConnectionMode;
  authToken: string | null;
  session: AuthSession;
  servers: Server[];
  statuses: Record<string, ServerStatus>;
  latestMetrics: Record<string, UnifiedReport>;
  alerts: Alert[];
  securityEvents: SecurityEvent[];
  personTasks: Task[];
  recentTaskEvents: TaskEvent[];
  hydrate: () => Promise<void>;
  setBaseUrl: (baseUrl: string) => void;
  setMode: (mode: ConnectionMode) => void;
  signIn: (input: SignInInput) => Promise<void>;
  refreshOverview: () => Promise<void>;
  signOut: () => Promise<void>;
  cancelTask: (task: Task) => Promise<void>;
  toggleNotificationsEnabled: () => void;
  toggleAdminCategory: (category: keyof MobileNotificationSettings['adminCategories']) => void;
  togglePersonTaskNotifications: () => void;
  toggleIdleServerSubscription: (serverId: string) => void;
  updateIdleServerRule: (serverId: string, rule: IdleGpuNotificationRule) => void;
  clearError: () => void;
}

export type StateSetter = (
  partial:
    | Partial<MobileAppState>
    | ((state: MobileAppState) => Partial<MobileAppState>)
) => void;

export type StateGetter = () => MobileAppState;

export function createEmptyOverviewSlice(): Pick<
  MobileAppState,
  'servers' | 'statuses' | 'latestMetrics' | 'alerts' | 'securityEvents' | 'personTasks' | 'recentTaskEvents'
> {
  return {
    servers: [],
    statuses: {},
    latestMetrics: {},
    alerts: [],
    securityEvents: [],
    personTasks: [],
    recentTaskEvents: [],
  };
}