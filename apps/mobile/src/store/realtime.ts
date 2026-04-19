import type { ServerStatus, UnifiedReport } from '@pmeow/app-common';
import { normalizeTimestamp } from '../app/formatters';
import { MobileRealtimeClient } from '../lib/realtime';
import {
  maybeNotifyAlert,
  maybeNotifySecurityEvent,
  maybeNotifyServerIdle,
  maybeNotifyTaskEvent,
} from './notifications';
import type { StateGetter, StateSetter } from './types';

const MAX_RECENT_TASK_EVENTS = 8;
const realtimeClient = new MobileRealtimeClient();
const idleStateByServer = new Map<string, boolean>();

let queuedRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function queueOverviewRefresh(get: StateGetter): void {
  if (queuedRefreshTimer) {
    return;
  }

  queuedRefreshTimer = setTimeout(() => {
    queuedRefreshTimer = null;
    void get().refreshOverview();
  }, 500);
}

function isServerIdle(status: ServerStatus | undefined, report: UnifiedReport | undefined): boolean {
  return status?.status === 'online' && (report?.taskQueue.running.length ?? 0) === 0;
}

export function primeRealtimeState(
  statuses: Record<string, ServerStatus>,
  latestMetrics: Record<string, UnifiedReport>,
): void {
  idleStateByServer.clear();
  Object.keys(statuses).forEach((serverId) => {
    idleStateByServer.set(serverId, isServerIdle(statuses[serverId], latestMetrics[serverId]));
  });
}

export function connectRealtime(baseUrl: string, token: string, set: StateSetter, get: StateGetter): void {
  realtimeClient.connect({
    baseUrl,
    token,
    callbacks: {
      onConnect: () => set({ realtimeConnected: true }),
      onDisconnect: () => set({ realtimeConnected: false }),
      onConnectError: (message) => {
        if (get().session.authenticated) {
          set({ realtimeConnected: false, error: message });
        }
      },
      onMetricsUpdate: (serverId, report) => {
        const normalizedLastSeenAt = normalizeTimestamp(report.timestamp);

        set((state) => ({
          latestMetrics: {
            ...state.latestMetrics,
            [serverId]: report,
          },
          statuses: {
            ...state.statuses,
            [serverId]: {
              serverId,
              status: 'online',
              lastSeenAt: normalizedLastSeenAt,
              version: state.statuses[serverId]?.version ?? '',
            },
          },
        }));

        const currentState = get();
        const nextIdle = isServerIdle(currentState.statuses[serverId], report);
        const previousIdle = idleStateByServer.get(serverId) ?? false;
        idleStateByServer.set(serverId, nextIdle);
        if (nextIdle && !previousIdle) {
          void maybeNotifyServerIdle(serverId, set, get);
        }
      },
      onServerStatus: (status) => {
        set((state) => ({
          statuses: {
            ...state.statuses,
            [status.serverId]: status,
          },
        }));

        const report = get().latestMetrics[status.serverId];
        idleStateByServer.set(status.serverId, isServerIdle(status, report));
      },
      onTaskEvent: (event) => {
        set((state) => ({
          recentTaskEvents: [event, ...state.recentTaskEvents].slice(0, MAX_RECENT_TASK_EVENTS),
        }));
        queueOverviewRefresh(get);
        void maybeNotifyTaskEvent(event, set, get);
      },
      onAlertStateChange: (event) => {
        set((state) => {
          const remainingAlerts = state.alerts.filter((alert) => alert.id !== event.alert.id);
          return {
            alerts: event.toStatus === 'active'
              ? [event.alert, ...remainingAlerts].slice(0, 12)
              : remainingAlerts,
          };
        });
        void maybeNotifyAlert(event, set, get);
      },
      onSecurityEvent: (event) => {
        set((state) => {
          const remainingEvents = state.securityEvents.filter((item) => item.id !== event.id);
          return {
            securityEvents: event.resolved
              ? remainingEvents
              : [event, ...remainingEvents].slice(0, 12),
          };
        });
        void maybeNotifySecurityEvent(event, set, get);
      },
      onServersChanged: () => {
        queueOverviewRefresh(get);
      },
    },
  });
}

export function disconnectRealtime(): void {
  realtimeClient.disconnect();
}