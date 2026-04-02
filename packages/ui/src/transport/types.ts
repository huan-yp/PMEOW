import type {
  ServerConfig, ServerInput, MetricsSnapshot, ServerStatus,
  HookRule, HookRuleInput, HookLog, AppSettings, AlertEvent, AlertRecord,
} from '@monitor/core';

export interface TransportAdapter {

  // Connection
  connect(): void;
  disconnect(): void;

  // Realtime subscriptions
  onMetricsUpdate(cb: (data: MetricsSnapshot) => void): () => void;
  onServerStatus(cb: (status: ServerStatus) => void): () => void;
  onAlert(cb: (alert: AlertEvent) => void): () => void;
  onHookTriggered(cb: (log: HookLog) => void): () => void;
  onNotify(cb: (title: string, body: string) => void): () => void;

  // Servers
  getServers(): Promise<ServerConfig[]>;
  addServer(input: ServerInput): Promise<ServerConfig>;
  updateServer(id: string, input: Partial<ServerInput>): Promise<ServerConfig>;
  deleteServer(id: string): Promise<boolean>;
  testConnection(input: ServerInput): Promise<{ success: boolean; error?: string }>;

  // Metrics
  getLatestMetrics(serverId: string): Promise<MetricsSnapshot | null>;
  getMetricsHistory(serverId: string, from: number, to: number): Promise<MetricsSnapshot[]>;
  getServerStatuses(): Promise<ServerStatus[]>;

  // Hooks
  getHooks(): Promise<HookRule[]>;
  createHook(input: HookRuleInput): Promise<HookRule>;
  updateHook(id: string, input: Partial<HookRuleInput>): Promise<HookRule>;
  deleteHook(id: string): Promise<boolean>;
  getHookLogs(hookId: string): Promise<HookLog[]>;
  testHookAction(hookId: string): Promise<{ success: boolean; result?: string; error?: string }>;

  // Settings
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: Partial<AppSettings>): Promise<void>;

  // Auth (web only)
  login(password: string): Promise<{ success: boolean; token?: string; error?: string }>;
  setPassword(password: string): Promise<{ success: boolean }>;
  checkAuth(): Promise<{ authenticated: boolean; needsSetup: boolean }>;

  // Alerts
  getAlerts(limit?: number, offset?: number): Promise<AlertRecord[]>;
  suppressAlert(id: string, days?: number): Promise<void>;

  // Key upload
  uploadKey(file: File): Promise<{ path: string }>;
}
