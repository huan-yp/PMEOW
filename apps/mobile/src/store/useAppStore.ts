import { create } from 'zustand';
import type {
  AuthSession,
  Task,
} from '@monitor/app-common';
import { formatMobileApiError, MobileApiClient, normalizeBaseUrl } from '../lib/api';
import {
  loadNotificationInbox,
} from '../lib/notification-inbox';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  loadNotificationSettings,
} from '../lib/preferences';
import {
  loadPersistedSession,
} from '../lib/storage';
import { persistState, loadOverview } from './overview';
import { enableNotificationsIfPossible, persistNotificationSettings } from './notifications';
import { connectRealtime, disconnectRealtime, primeRealtimeState } from './realtime';
import {
  createEmptyOverviewSlice,
  UNAUTHENTICATED_SESSION,
} from './types';
import type { MobileAppState, SignInInput } from './types';

export const useAppStore = create<MobileAppState>((set, get) => ({
  hydrated: false,
  busy: false,
  refreshing: false,
  realtimeConnected: false,
  error: null,
  pendingTaskId: null,
  notificationPermissionGranted: null,
  notificationSettings: DEFAULT_NOTIFICATION_SETTINGS,
  notificationInbox: [],
  baseUrl: '',
  mode: 'admin',
  authToken: null,
  session: UNAUTHENTICATED_SESSION,
  ...createEmptyOverviewSlice(),

  hydrate: async () => {
    if (get().hydrated || get().busy) {
      return;
    }

    set({ busy: true, error: null });

    try {
      const [persisted, notificationSettings, notificationInbox] = await Promise.all([
        loadPersistedSession(),
        loadNotificationSettings(),
        loadNotificationInbox(),
      ]);

      const notificationPermissionGranted = notificationSettings.notificationsEnabled
        ? await enableNotificationsIfPossible()
        : null;

      set({ notificationSettings, notificationInbox, notificationPermissionGranted });

      if (!persisted) {
        set({ hydrated: true, busy: false });
        return;
      }

      const normalizedBaseUrl = normalizeBaseUrl(persisted.baseUrl);
      if (normalizedBaseUrl && normalizedBaseUrl !== persisted.baseUrl) {
        console.info(
          `[mobile][auth] hydrate normalized persisted baseUrl from "${persisted.baseUrl}" to "${normalizedBaseUrl}"`
        );
      }

      set({
        baseUrl: normalizedBaseUrl || persisted.baseUrl,
        mode: persisted.mode,
        authToken: persisted.authToken,
      });

      if (!persisted.authToken) {
        set({ hydrated: true, busy: false });
        return;
      }

      const resolvedBaseUrl = normalizedBaseUrl || persisted.baseUrl;
      const client = new MobileApiClient(resolvedBaseUrl, persisted.authToken);
      const session = await client.checkAuth();
      if (!session.authenticated) {
        disconnectRealtime();
        await persistState({ ...persisted, baseUrl: resolvedBaseUrl, authToken: null });
        set({
          baseUrl: resolvedBaseUrl,
          authToken: null,
          session,
          ...createEmptyOverviewSlice(),
          realtimeConnected: false,
          hydrated: true,
          busy: false,
        });
        return;
      }

      const overview = await loadOverview(client, session);
      primeRealtimeState(overview.statuses, overview.latestMetrics);
      connectRealtime(resolvedBaseUrl, persisted.authToken, set, get);
      if (resolvedBaseUrl !== persisted.baseUrl) {
        await persistState({ ...persisted, baseUrl: resolvedBaseUrl, authToken: persisted.authToken });
      }
      set({
        baseUrl: resolvedBaseUrl,
        session,
        servers: overview.servers,
        statuses: overview.statuses,
        latestMetrics: overview.latestMetrics,
        alerts: overview.alerts,
        securityEvents: overview.securityEvents,
        personTasks: overview.personTasks,
        recentTaskEvents: [],
        hydrated: true,
        busy: false,
      });
    } catch (error) {
      disconnectRealtime();
      set({
        hydrated: true,
        busy: false,
        realtimeConnected: false,
        error: formatMobileApiError(error),
      });
    }
  },

  setBaseUrl: (baseUrl) => {
    const next = {
      baseUrl,
      mode: get().mode,
      authToken: get().authToken,
    };
    set({ baseUrl });
    void persistState(next);
  },

  setMode: (mode) => {
    const next = {
      baseUrl: get().baseUrl,
      mode,
      authToken: get().authToken,
    };
    set({ mode });
    void persistState(next);
  },

  signIn: async ({ secret }) => {
    const state = get();
    const baseUrl = normalizeBaseUrl(state.baseUrl);
    if (!baseUrl) {
      set({ error: '请填写后端 URL。' });
      return;
    }
    if (!secret.trim()) {
      set({ error: state.mode === 'admin' ? '请填写管理员密码。' : '请填写访问令牌。' });
      return;
    }

    set({ busy: true, error: null });
    console.info(
      `[mobile][auth] sign-in start mode=${state.mode} rawBaseUrl="${state.baseUrl}" normalizedBaseUrl="${baseUrl}" secretProvided=${secret.trim() ? 'yes' : 'no'}`
    );

    try {
      const client = new MobileApiClient(baseUrl);
      const result = await client.login(
        state.mode === 'admin'
          ? { password: secret.trim() }
          : { token: secret.trim() },
      );

      const session: AuthSession = {
        authenticated: true,
        principal: result.principal,
        person: result.person,
        accessibleServerIds: result.accessibleServerIds,
      };

      const overview = await loadOverview(client, session);
      const notificationPermissionGranted = state.notificationSettings.notificationsEnabled
        ? await enableNotificationsIfPossible()
        : get().notificationPermissionGranted;
      await persistState({
        baseUrl,
        mode: state.mode,
        authToken: result.token,
      });

      primeRealtimeState(overview.statuses, overview.latestMetrics);

      set({
        baseUrl,
        authToken: result.token,
        session,
        servers: overview.servers,
        statuses: overview.statuses,
        latestMetrics: overview.latestMetrics,
        alerts: overview.alerts,
        securityEvents: overview.securityEvents,
        personTasks: overview.personTasks,
        recentTaskEvents: [],
        notificationPermissionGranted,
        busy: false,
      });
      connectRealtime(baseUrl, result.token, set, get);
      console.info(`[mobile][auth] sign-in success mode=${state.mode} baseUrl="${baseUrl}"`);
    } catch (error) {
      disconnectRealtime();
      console.warn(`[mobile][auth] sign-in failed: ${formatMobileApiError(error)}`);
      set({ busy: false, error: formatMobileApiError(error) });
    }
  },

  refreshOverview: async () => {
    const state = get();
    if (!state.authToken || !state.session.authenticated || !state.baseUrl) {
      return;
    }

    set({ refreshing: true, error: null });

    try {
      const client = new MobileApiClient(state.baseUrl, state.authToken);
      const overview = await loadOverview(client, state.session);
      primeRealtimeState(overview.statuses, overview.latestMetrics);
      set({
        servers: overview.servers,
        statuses: overview.statuses,
        latestMetrics: overview.latestMetrics,
        alerts: overview.alerts,
        securityEvents: overview.securityEvents,
        personTasks: overview.personTasks,
        refreshing: false,
      });
    } catch (error) {
      set({ refreshing: false, error: formatMobileApiError(error) });
    }
  },

  cancelTask: async (task) => {
    const state = get();
    if (!state.authToken || !state.baseUrl || !state.session.authenticated) {
      return;
    }

    set({ pendingTaskId: task.id, error: null });
    try {
      const client = new MobileApiClient(state.baseUrl, state.authToken);
      await client.cancelTask(task.serverId, task.id);
      await get().refreshOverview();
      set({ pendingTaskId: null });
    } catch (error) {
      set({ pendingTaskId: null, error: formatMobileApiError(error) });
    }
  },

  signOut: async () => {
    const state = get();
    await persistState({
      baseUrl: state.baseUrl,
      mode: state.mode,
      authToken: null,
    });

    disconnectRealtime();

    set({
      authToken: null,
      session: UNAUTHENTICATED_SESSION,
      ...createEmptyOverviewSlice(),
      pendingTaskId: null,
      realtimeConnected: false,
      error: null,
    });
  },

  toggleNotificationsEnabled: () => {
    const current = get().notificationSettings;
    const next = {
      ...current,
      notificationsEnabled: !current.notificationsEnabled,
    };
    set({ notificationSettings: next });
    void persistNotificationSettings(next);
    if (next.notificationsEnabled) {
      void enableNotificationsIfPossible().then((granted) => {
        set({ notificationPermissionGranted: granted });
      });
    }
  },

  toggleAdminCategory: (category) => {
    const current = get().notificationSettings;
    const next = {
      ...current,
      adminCategories: {
        ...current.adminCategories,
        [category]: !current.adminCategories[category],
      },
    };
    set({ notificationSettings: next });
    void persistNotificationSettings(next);
  },

  togglePersonTaskNotifications: () => {
    const current = get().notificationSettings;
    const next = {
      ...current,
      person: {
        ...current.person,
        taskEvents: !current.person.taskEvents,
      },
    };
    set({ notificationSettings: next });
    void persistNotificationSettings(next);
  },

  toggleIdleServerSubscription: (serverId) => {
    const current = get().notificationSettings;
    const exists = current.person.idleServerIds.includes(serverId);
    const next = {
      ...current,
      person: {
        ...current.person,
        idleServerIds: exists
          ? current.person.idleServerIds.filter((value) => value !== serverId)
          : [...current.person.idleServerIds, serverId],
      },
    };
    set({ notificationSettings: next });
    void persistNotificationSettings(next);
  },

  clearError: () => set({ error: null }),
}));
