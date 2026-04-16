import type {
  ServerConfig, ServerInput, MetricsSnapshot, ServerStatus,
  HookRule, HookRuleInput, HookLog, AppSettings, AlertEvent, AlertRecord,
  AgentTaskQueueGroup, AgentTaskUpdatePayload, GpuOverviewResponse,
  GpuUsageSummaryItem, GpuUsageTimelinePoint, ProcessAuditRow, SecurityEventRecord,
  PersonRecord, PersonBindingCandidate, PersonBindingRecord, PersonBindingSuggestion,
  PersonSummaryItem, PersonTimelinePoint, ServerPersonActivity,
  AutoAddUnassignedPersonsReport,
  MirroredAgentTaskRecord, ResolvedGpuAllocationResponse, AgentTaskEventRecord,
  MetricsHistoryResponse, GpuUsageHistoryResponse, ProcessHistoryFrame, ProcessReplayIndexPoint,
} from '@monitor/core';

export interface SecurityEventQuery {
  serverId?: string;
  resolved?: boolean;
  hours?: number;
}

export interface AlertQuery {
  limit?: number;
  offset?: number;
  /** true = only suppressed; false = only active; undefined = all */
  suppressed?: boolean;
}

export interface TransportAdapter {
  readonly isElectron?: boolean;

  // Connection
  connect(): void;
  disconnect(): void;

  // Realtime subscriptions
  onMetricsUpdate(cb: (data: MetricsSnapshot) => void): () => void;
  onServerStatus(cb: (status: ServerStatus) => void): () => void;
  onAlert(cb: (alert: AlertEvent) => void): () => void;
  onHookTriggered(cb: (log: HookLog) => void): () => void;
  onNotify(cb: (title: string, body: string) => void): () => void;
  onTaskUpdate(cb: (update: AgentTaskUpdatePayload) => void): () => void;
  onSecurityEvent(cb: (event: SecurityEventRecord) => void): () => void;
  onServersChanged?(cb: () => void): () => void;

  // Servers
  getServers(): Promise<ServerConfig[]>;
  addServer(input: ServerInput): Promise<ServerConfig>;
  updateServer(id: string, input: Partial<ServerInput>): Promise<ServerConfig>;
  deleteServer(id: string): Promise<boolean>;
  testConnection(input: ServerInput): Promise<{ success: boolean; error?: string }>;

  // Metrics
  getLatestMetrics(serverId: string): Promise<MetricsSnapshot | null>;
  getMetricsHistory(serverId: string, from: number, to: number): Promise<MetricsSnapshot[]>;
  getMetricsHistoryBucketed(serverId: string, from: number, to: number, bucketMs?: number): Promise<MetricsHistoryResponse>;
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
  getAlerts(query?: AlertQuery): Promise<AlertRecord[]>;
  suppressAlert(id: string, days?: number): Promise<void>;
  unsuppressAlert(id: string): Promise<void>;
  batchSuppressAlerts(ids: string[], days?: number): Promise<void>;
  batchUnsuppressAlerts(ids: string[]): Promise<void>;

  // Operator data
  getTaskQueue(): Promise<AgentTaskQueueGroup[]>;
  getTaskEvents?(serverId: string, taskId: string, afterId?: number): Promise<AgentTaskEventRecord[]>;
  getProcessAudit(serverId: string): Promise<ProcessAuditRow[]>;
  getProcessHistoryIndex?(serverId: string, from: number, to: number): Promise<ProcessReplayIndexPoint[]>;
  getProcessHistoryFrame?(serverId: string, timestamp: number): Promise<ProcessHistoryFrame>;
  getSecurityEvents(query?: SecurityEventQuery): Promise<SecurityEventRecord[]>;
  markSecurityEventSafe(id: number, reason?: string): Promise<{ resolvedEvent: SecurityEventRecord; auditEvent?: SecurityEventRecord }>;
  unresolveSecurityEvent(id: number, reason?: string): Promise<{ reopenedEvent: SecurityEventRecord; auditEvent: SecurityEventRecord }>;
  getGpuOverview(): Promise<GpuOverviewResponse>;
  getGpuUsageSummary(hours?: number): Promise<GpuUsageSummaryItem[]>;
  getGpuUsageByUser(user: string, hours?: number): Promise<GpuUsageTimelinePoint[]>;
  getGpuUsageByUserBucketed(user: string, from: number, to: number, bucketMs?: number): Promise<GpuUsageHistoryResponse>;
  cancelTask(serverId: string, taskId: string): Promise<void>;
  setTaskPriority(serverId: string, taskId: string, priority: number): Promise<void>;
  pauseQueue(serverId: string): Promise<void>;
  resumeQueue(serverId: string): Promise<void>;

  // Key upload
  uploadKey(file: File): Promise<{ path: string }>;

  // Person attribution
  getPersons(): Promise<PersonRecord[]>;
  createPerson(input: { displayName: string; email?: string; qq?: string; note?: string; customFields: Record<string, string> }): Promise<PersonRecord>;
  updatePerson(id: string, input: Partial<{ displayName: string; email: string; qq: string; note: string; customFields: Record<string, string> }>): Promise<PersonRecord>;
  getPersonBindings(personId: string): Promise<PersonBindingRecord[]>;
  createPersonBinding(input: { personId: string; serverId: string; systemUser: string; source: string; effectiveFrom: number }): Promise<PersonBindingRecord>;
  updatePersonBinding(id: string, input: Partial<{ enabled: boolean; effectiveTo: number | null }>): Promise<PersonBindingRecord>;
  getPersonBindingCandidates(): Promise<PersonBindingCandidate[]>;
  getPersonBindingSuggestions(): Promise<PersonBindingSuggestion[]>;
  autoAddUnassignedPersons?(): Promise<AutoAddUnassignedPersonsReport>;
  getPersonSummary(hours?: number): Promise<PersonSummaryItem[]>;
  getPersonTimeline(personId: string, hours?: number): Promise<PersonTimelinePoint[]>;
  getPersonTasks(personId: string, hours?: number): Promise<MirroredAgentTaskRecord[]>;
  getServerPersonActivity(serverId: string): Promise<ServerPersonActivity>;
  getResolvedGpuAllocation(serverId: string): Promise<ResolvedGpuAllocationResponse | null>;
}
