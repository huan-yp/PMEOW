import { create } from 'zustand';
import type { Server, ServerStatus, UnifiedReport, Task, Alert, SecurityEvent, Toast } from '../transport/types.js';

interface AppState {
  // Auth
  authenticated: boolean;
  setAuthenticated: (v: boolean) => void;

  // Servers
  servers: Server[];
  setServers: (servers: Server[]) => void;
  addServer: (server: Server) => void;
  removeServer: (id: string) => void;

  // Statuses
  statuses: Map<string, ServerStatus>;
  setStatus: (status: ServerStatus) => void;
  setStatuses: (statuses: Record<string, ServerStatus>) => void;

  // Realtime snapshots (in-memory, from WebSocket)
  latestSnapshots: Map<string, UnifiedReport>;
  setLatestSnapshot: (serverId: string, report: UnifiedReport) => void;

  // Tasks
  tasks: Task[];
  taskTotal: number;
  setTasks: (tasks: Task[], total: number) => void;
  upsertTask: (task: Task) => void;

  // Alerts
  alerts: Alert[];
  setAlerts: (alerts: Alert[]) => void;

  // Security Events
  securityEvents: SecurityEvent[];
  setSecurityEvents: (events: SecurityEvent[]) => void;

  // Toasts
  toasts: Toast[];
  addToast: (title: string, body: string, type?: Toast['type']) => void;
  dismissToast: (id: string) => void;
}

let toastCounter = 0;

export const useStore = create<AppState>((set) => ({
  // Auth
  authenticated: false,
  setAuthenticated: (v) => set({ authenticated: v }),

  // Servers
  servers: [],
  setServers: (servers) => set({ servers }),
  addServer: (server) => set((s) => ({ servers: [...s.servers, server] })),
  removeServer: (id) => set((s) => ({ servers: s.servers.filter(srv => srv.id !== id) })),

  // Statuses
  statuses: new Map(),
  setStatus: (status) => set((s) => {
    const next = new Map(s.statuses);
    next.set(status.serverId, status);
    return { statuses: next };
  }),
  setStatuses: (statuses) => set(() => {
    const map = new Map<string, ServerStatus>();
    for (const [k, v] of Object.entries(statuses)) map.set(k, v);
    return { statuses: map };
  }),

  // Realtime snapshots
  latestSnapshots: new Map(),
  setLatestSnapshot: (serverId, report) => set((s) => {
    const next = new Map(s.latestSnapshots);
    next.set(serverId, report);
    return { latestSnapshots: next };
  }),

  // Tasks
  tasks: [],
  taskTotal: 0,
  setTasks: (tasks, total) => set({ tasks, taskTotal: total }),
  upsertTask: (task) => set((s) => {
    const idx = s.tasks.findIndex(t => t.id === task.id);
    if (idx >= 0) {
      const next = [...s.tasks];
      next[idx] = task;
      return { tasks: next };
    }
    return { tasks: [task, ...s.tasks], taskTotal: s.taskTotal + 1 };
  }),

  // Alerts
  alerts: [],
  setAlerts: (alerts) => set({ alerts }),

  // Security Events
  securityEvents: [],
  setSecurityEvents: (securityEvents) => set({ securityEvents }),

  // Toasts
  toasts: [],
  addToast: (title, body, type = 'info') => set((s) => {
    const id = `toast-${++toastCounter}`;
    const toast: Toast = { id, title, body, type, timestamp: Date.now() };
    setTimeout(() => {
      useStore.setState((s2) => ({ toasts: s2.toasts.filter(t => t.id !== id) }));
    }, 8000);
    return { toasts: [...s.toasts, toast] };
  }),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));
