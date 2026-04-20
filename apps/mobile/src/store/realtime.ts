import type { GpuCardReport, ServerStatus, UnifiedReport } from '@pmeow/app-common';
import { normalizeTimestamp } from '../app/formatters';
import type { IdleGpuNotificationRule } from '../lib/preferences';
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
const MAX_IDLE_SAMPLE_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_IDLE_NOTIFICATION_COOLDOWN_MS = 15 * 60 * 1000;

type GpuIdleSample = {
  time: number;
  utilizationGpu: number;
  schedulableFreePercent: number;
};

type ServerIdleNotificationState = {
  armed: boolean;
  conditionActive: boolean;
  recoveryStartedAt: number | null;
  gpuSamples: Map<number, GpuIdleSample[]>;
};

const idleNotificationStateByServer = new Map<string, ServerIdleNotificationState>();
let lastIdleNotificationAt = 0;
let idleNotificationDispatchInFlight = false;

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

function getIdleNotificationState(serverId: string): ServerIdleNotificationState {
  const existing = idleNotificationStateByServer.get(serverId);
  if (existing) {
    return existing;
  }

  const created: ServerIdleNotificationState = {
    armed: true,
    conditionActive: false,
    recoveryStartedAt: null,
    gpuSamples: new Map<number, GpuIdleSample[]>(),
  };
  idleNotificationStateByServer.set(serverId, created);
  return created;
}

function getSchedulableFreePercent(gpu: GpuCardReport): number {
  if (gpu.memoryTotalMb <= 0) {
    return 0;
  }

  return (gpu.effectiveFreeMb / gpu.memoryTotalMb) * 100;
}

function normalizeReportTime(timestamp: number): number {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function recordGpuSamples(serverId: string, report: UnifiedReport): void {
  const state = getIdleNotificationState(serverId);
  const time = normalizeReportTime(report.timestamp);
  const cutoff = time - MAX_IDLE_SAMPLE_WINDOW_MS;

  for (const gpu of report.resourceSnapshot.gpuCards) {
    const current = state.gpuSamples.get(gpu.index) ?? [];
    const next = current.filter((sample) => sample.time > cutoff && sample.time !== time);
    next.push({
      time,
      utilizationGpu: gpu.utilizationGpu,
      schedulableFreePercent: getSchedulableFreePercent(gpu),
    });
    state.gpuSamples.set(gpu.index, next);
  }

  for (const [gpuIndex, samples] of state.gpuSamples.entries()) {
    const next = samples.filter((sample) => sample.time > cutoff);
    if (next.length === 0) {
      state.gpuSamples.delete(gpuIndex);
      continue;
    }
    state.gpuSamples.set(gpuIndex, next);
  }
}

function isGpuIdleForRule(samples: GpuIdleSample[] | undefined, rule: IdleGpuNotificationRule, now: number): boolean {
  if (!samples || samples.length === 0) {
    return false;
  }

  const windowStart = now - rule.idleWindowSeconds * 1000;
  const relevant = samples.filter((sample) => sample.time >= windowStart);
  if (relevant.length === 0) {
    return false;
  }
  if (now - relevant[0].time < rule.idleWindowSeconds * 1000) {
    return false;
  }

  return relevant.every((sample) => {
    return sample.utilizationGpu <= rule.maxGpuUtilizationPercent
      && sample.schedulableFreePercent >= rule.minSchedulableFreePercent;
  });
}

function countIdleGpusForRule(serverId: string, rule: IdleGpuNotificationRule, now: number): number {
  const state = getIdleNotificationState(serverId);
  let count = 0;

  for (const samples of state.gpuSamples.values()) {
    if (isGpuIdleForRule(samples, rule, now)) {
      count += 1;
    }
  }

  return count;
}

export function primeRealtimeState(
  statuses: Record<string, ServerStatus>,
  latestMetrics: Record<string, UnifiedReport>,
): void {
  idleNotificationStateByServer.clear();
  lastIdleNotificationAt = 0;
  idleNotificationDispatchInFlight = false;

  Object.keys(statuses).forEach((serverId) => {
    const report = latestMetrics[serverId];
    if (report) {
      recordGpuSamples(serverId, report);
    }
  });
}

export function connectRealtime(baseUrl: string, token: string, set: StateSetter, get: StateGetter): void {
  set({ realtimeConnected: false });
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
        const sampleTime = normalizeReportTime(report.timestamp);

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

        recordGpuSamples(serverId, report);

        const currentState = get();
        const status = currentState.statuses[serverId];
        const rule = currentState.notificationSettings.person.idleServerRules[serverId];

        if (!rule || status?.status !== 'online') {
          const idleState = getIdleNotificationState(serverId);
          if (!idleState.armed && idleState.recoveryStartedAt == null) {
            idleState.recoveryStartedAt = sampleTime;
          }
          idleState.conditionActive = false;
          return;
        }

        const idleState = getIdleNotificationState(serverId);
        const idleGpuCount = countIdleGpusForRule(serverId, rule, sampleTime);
        const nextConditionActive = idleGpuCount >= rule.minIdleGpuCount;

        if (nextConditionActive) {
          idleState.conditionActive = true;
          idleState.recoveryStartedAt = null;

          if (
            idleState.armed
            && !idleNotificationDispatchInFlight
            && sampleTime - lastIdleNotificationAt >= GLOBAL_IDLE_NOTIFICATION_COOLDOWN_MS
          ) {
            idleNotificationDispatchInFlight = true;
            void maybeNotifyServerIdle(serverId, idleGpuCount, rule, set, get)
              .then((shown) => {
                if (shown) {
                  idleState.armed = false;
                  lastIdleNotificationAt = sampleTime;
                }
              })
              .finally(() => {
                idleNotificationDispatchInFlight = false;
              });
          }

          return;
        }

        idleState.conditionActive = false;
        if (idleState.recoveryStartedAt == null) {
          idleState.recoveryStartedAt = sampleTime;
        }
        if (
          !idleState.armed
          && sampleTime - idleState.recoveryStartedAt >= rule.idleWindowSeconds * 1000
        ) {
          idleState.armed = true;
        }
      },
      onServerStatus: (status) => {
        set((state) => ({
          statuses: {
            ...state.statuses,
            [status.serverId]: status,
          },
        }));

        if (status.status !== 'online') {
          const idleState = getIdleNotificationState(status.serverId);
          idleState.conditionActive = false;
          if (idleState.recoveryStartedAt == null) {
            idleState.recoveryStartedAt = Date.now();
          }
        }
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

export function reconnectRealtime(baseUrl: string, token: string, set: StateSetter, get: StateGetter): void {
  disconnectRealtime();
  connectRealtime(baseUrl, token, set, get);
}

export function disconnectRealtime(): void {
  realtimeClient.disconnect();
  idleNotificationStateByServer.clear();
  idleNotificationDispatchInFlight = false;
}