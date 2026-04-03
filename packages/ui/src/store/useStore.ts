import { create } from 'zustand';
import type {
  MetricsSnapshot, ServerConfig, ServerStatus, HookRule, AppSettings, AlertEvent,
  AgentTaskQueueGroup, SecurityEventRecord,
} from '@monitor/core';

interface Toast {
  id: string;
  title: string;
  body: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: number;
  alertId?: string;
  onAction?: () => void;
}

interface AppState {
  // Servers
  servers: ServerConfig[];
  setServers: (servers: ServerConfig[]) => void;
  addServer: (server: ServerConfig) => void;
  removeServer: (id: string) => void;
  updateServerInList: (server: ServerConfig) => void;

  // Server statuses
  statuses: Map<string, ServerStatus>;
  setStatus: (status: ServerStatus) => void;
  setStatuses: (statuses: ServerStatus[]) => void;

  // Realtime metrics
  latestMetrics: Map<string, MetricsSnapshot>;
  setLatestMetrics: (snapshot: MetricsSnapshot) => void;

  // Hooks
  hooks: HookRule[];
  setHooks: (hooks: HookRule[]) => void;

  // Settings
  settings: AppSettings | null;
  setSettings: (settings: AppSettings) => void;

  // Operator data
  taskQueueGroups: AgentTaskQueueGroup[];
  setTaskQueueGroups: (groups: AgentTaskQueueGroup[]) => void;
  openSecurityEvents: SecurityEventRecord[];
  setOpenSecurityEvents: (events: SecurityEventRecord[]) => void;

  // Toasts
  toasts: Toast[];
  addToast: (title: string, body: string, type?: Toast['type'], extra?: { alertId?: string; onAction?: () => void }) => void;
  dismissToast: (id: string) => void;

  // Auth (web mode)
  authenticated: boolean;
  setAuthenticated: (v: boolean) => void;
}

let toastCounter = 0;

export const useStore = create<AppState>((set) => ({
  // Servers
  servers: [],
  setServers: (servers) => set({ servers }),
  addServer: (server) => set((s) => ({ servers: [...s.servers, server] })),
  removeServer: (id) => set((s) => ({ servers: s.servers.filter(srv => srv.id !== id) })),
  updateServerInList: (server) => set((s) => ({
    servers: s.servers.map(srv => srv.id === server.id ? server : srv),
  })),

  // Statuses
  statuses: new Map(),
  setStatus: (status) => set((s) => {
    const next = new Map(s.statuses);
    next.set(status.serverId, status);
    return { statuses: next };
  }),
  setStatuses: (statuses) => set(() => {
    const map = new Map<string, ServerStatus>();
    statuses.forEach(s => map.set(s.serverId, s));
    return { statuses: map };
  }),

  // Metrics
  latestMetrics: new Map(),
  setLatestMetrics: (snapshot) => set((s) => {
    const next = new Map(s.latestMetrics);
    next.set(snapshot.serverId, snapshot);
    return { latestMetrics: next };
  }),

  // Hooks
  hooks: [],
  setHooks: (hooks) => set({ hooks }),

  // Settings
  settings: null,
  setSettings: (settings) => set({ settings }),

  // Operator data
  taskQueueGroups: [],
  setTaskQueueGroups: (taskQueueGroups) => set({ taskQueueGroups }),
  openSecurityEvents: [],
  setOpenSecurityEvents: (openSecurityEvents) => set({ openSecurityEvents }),

  // Toasts
  toasts: [],
  addToast: (title, body, type = 'info', extra) => set((s) => {
    const id = `toast-${++toastCounter}`;
    const toast: Toast = { id, title, body, type, timestamp: Date.now(), alertId: extra?.alertId, onAction: extra?.onAction };
    // Auto-dismiss after 8 seconds via a timeout (side effect OK in zustand)
    setTimeout(() => {
      set((s2) => ({ toasts: s2.toasts.filter(t => t.id !== id) }));
    }, 8000);
    return { toasts: [...s.toasts, toast] };
  }),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter(t => t.id !== id) })),

  // Auth
  authenticated: false,
  setAuthenticated: (v) => set({ authenticated: v }),
}));
