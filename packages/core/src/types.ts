// ========================
// Server Configuration
// ========================

export type SourceType = 'ssh' | 'agent';

export interface ServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  sourceType: SourceType;
  agentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type ServerInput = Omit<ServerConfig, 'id' | 'createdAt' | 'updatedAt' | 'sourceType' | 'agentId'> & {
  sourceType?: SourceType;
  agentId?: string | null;
};

// ========================
// Metrics Data
// ========================

export interface CpuMetrics {
  usagePercent: number;      // Overall CPU usage %
  coreCount: number;
  modelName: string;
  frequencyMhz: number;
  perCoreUsage: number[];    // Per-core usage %
}

export interface MemoryMetrics {
  totalMB: number;
  usedMB: number;
  availableMB: number;
  usagePercent: number;
  swapTotalMB: number;
  swapUsedMB: number;
  swapPercent: number;
}

export interface DiskInfo {
  filesystem: string;
  mountPoint: string;
  totalGB: number;
  usedGB: number;
  availableGB: number;
  usagePercent: number;
}

export interface DiskMetrics {
  disks: DiskInfo[];
  ioReadKBs: number;       // Read KB/s
  ioWriteKBs: number;      // Write KB/s
}

export interface NetworkMetrics {
  rxBytesPerSec: number;    // Download bytes/s
  txBytesPerSec: number;    // Upload bytes/s
  interfaces: {
    name: string;
    rxBytes: number;
    txBytes: number;
  }[];
  // Internet reachability probe result (optional; populated by sources that support it).
  // Unset on snapshots where the probe is unavailable or has not yet produced a sample.
  internetReachable?: boolean;            // overall reachability decision
  internetLatencyMs?: number | null;      // latency in ms to the first successful target; null when unreachable
  internetProbeTarget?: string;           // target that was probed, e.g. "1.1.1.1:443"
  internetProbeCheckedAt?: number;        // ms epoch when the probe result was produced
}

export interface GpuMetrics {
  available: boolean;
  totalMemoryMB: number;
  usedMemoryMB: number;
  memoryUsagePercent: number;
  utilizationPercent: number;
  temperatureC: number;
  gpuCount: number;
}

// ========================
// Agent Runtime Data
// ========================

export type AgentTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface GpuTaskAllocation {
  taskId: string;
  gpuIndex: number;
  declaredVramMB: number;
  actualVramMB: number;
}

export interface GpuUserProcess {
  pid: number;
  user: string;
  gpuIndex: number;
  usedMemoryMB: number;
  command: string;
}

export interface GpuUnknownProcess {
  pid: number;
  gpuIndex: number;
  usedMemoryMB: number;
  command?: string;
}

export interface PerGpuAllocationSummary {
  gpuIndex: number;
  totalMemoryMB: number;
  usedMemoryMB?: number;
  pmeowTasks: GpuTaskAllocation[];
  userProcesses: GpuUserProcess[];
  unknownProcesses: GpuUnknownProcess[];
  effectiveFreeMB: number;
}

export interface UserGpuUsageSummary {
  user: string;
  totalVramMB: number;
  gpuIndices: number[];
}

export interface GpuAllocationSummary {
  perGpu: PerGpuAllocationSummary[];
  byUser: UserGpuUsageSummary[];
}

export type SecurityEventType = 'suspicious_process' | 'unowned_gpu' | 'high_gpu_utilization' | 'marked_safe';

export interface SecurityEventDetails {
  reason: string;
  pid?: number;
  user?: string;
  command?: string;
  gpuIndex?: number;
  taskId?: string | null;
  keyword?: string;
  targetEventId?: number;
  durationMinutes?: number;
  usedMemoryMB?: number;
  gpuUtilizationPercent?: number;
}

export interface SecurityEventRecord {
  id: number;
  serverId: string;
  eventType: SecurityEventType;
  fingerprint: string;
  details: SecurityEventDetails;
  resolved: boolean;
  resolvedBy: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface ProcessAuditRow {
  pid: number;
  user: string;
  command: string;
  cpuPercent: number;
  memPercent: number;
  rss: number;
  gpuMemoryMB: number;
  ownerType: 'task' | 'user' | 'unknown' | 'none';
  taskId?: string | null;
  suspiciousReasons: string[];
  resolvedPersonId?: string;
  resolvedPersonName?: string;
}

export interface AgentTaskQueueGroup {
  serverId: string;
  serverName: string;
  queued: MirroredAgentTaskRecord[];
  running: MirroredAgentTaskRecord[];
  recent: MirroredAgentTaskRecord[];
}

export interface GpuOverviewUserSummary {
  user: string;
  totalVramMB: number;
  taskCount: number;
  processCount: number;
  serverIds: string[];
}

export interface GpuOverviewServerSummary {
  serverId: string;
  serverName: string;
  totalUsedMB: number;
  totalTaskMB: number;
  totalNonTaskMB: number;
}

export interface GpuOverviewResponse {
  generatedAt: number;
  users: GpuOverviewUserSummary[];
  servers: GpuOverviewServerSummary[];
}

export interface GpuUsageSummaryItem {
  user: string;
  totalVramMB: number;
  taskVramMB: number;
  nonTaskVramMB: number;
}

export interface GpuUsageTimelinePoint {
  bucketStart: number;
  user: string;
  totalVramMB: number;
  taskVramMB: number;
  nonTaskVramMB: number;
}

export interface AgentRegisterPayload {
  agentId: string;
  hostname: string;
  version: string;
}

export interface AgentHeartbeatPayload {
  agentId: string;
  timestamp: number;
}

export interface AgentTaskUpdatePayload {
  serverId: string;
  taskId: string;
  status: AgentTaskStatus;
  command?: string;
  cwd?: string;
  user?: string;
  requireVramMB?: number;
  requireGpuCount?: number;
  gpuIds?: number[] | null;
  priority?: number;
  createdAt?: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  exitCode?: number | null;
  pid?: number | null;
}

export interface AgentLocalUserRecord {
  username: string;
  uid: number;
  gid: number;
  gecos: string;
  home: string;
  shell: string;
}

export interface AgentLocalUsersPayload {
  serverId: string;
  agentId: string;
  timestamp: number;
  users: AgentLocalUserRecord[];
}

export interface MirroredAgentTaskRecord extends AgentTaskUpdatePayload {
  serverId: string;
}

export interface ProcessInfo {
  pid: number;
  user: string;
  cpuPercent: number;
  memPercent: number;
  rss: number;              // Resident memory KB
  command: string;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  createdAt: string;
}

export interface SystemMetrics {
  hostname: string;
  uptime: string;
  loadAvg1: number;
  loadAvg5: number;
  loadAvg15: number;
  kernelVersion: string;
}

export interface MetricsSnapshot {
  serverId: string;
  timestamp: number;
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  disk: DiskMetrics;
  network: NetworkMetrics;
  gpu: GpuMetrics;
  processes: ProcessInfo[];
  docker: DockerContainer[];
  system: SystemMetrics;
  gpuAllocation?: GpuAllocationSummary;
}

// ========================
// Server Status
// ========================

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

export interface ServerStatus {
  serverId: string;
  status: ConnectionStatus;
  lastSeen: number;
  error?: string;
  latestMetrics?: MetricsSnapshot;
}

export interface ServerStatusEvent {
  id?: number;
  serverId: string;
  fromStatus: ConnectionStatus;
  toStatus: ConnectionStatus;
  reason?: string;
  lastSeen: number;
  createdAt: number;
}

// ========================
// Hook System
// ========================

export type HookConditionType = 'gpu_mem_below' | 'gpu_util_below' | 'gpu_idle_duration';

export interface HookCondition {
  type: HookConditionType;
  threshold: number;         // percent (0-100) or minutes
  serverId: string;
}

export type HookActionType = 'exec_local' | 'http_request' | 'desktop_notify';

export interface ExecLocalAction {
  type: 'exec_local';
  command: string;
}

export interface HttpRequestAction {
  type: 'http_request';
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers: Record<string, string>;
  body: string;
}

export interface DesktopNotifyAction {
  type: 'desktop_notify';
  title: string;
  body: string;
}

export type HookAction = ExecLocalAction | HttpRequestAction | DesktopNotifyAction;

export interface HookRule {
  id: string;
  name: string;
  enabled: boolean;
  condition: HookCondition;
  action: HookAction;
  lastTriggeredAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type HookRuleInput = Omit<HookRule, 'id' | 'lastTriggeredAt' | 'createdAt' | 'updatedAt'>;

export interface HookLog {
  id: string;
  hookId: string;
  triggeredAt: number;
  success: boolean;
  result: string;
  error: string | null;
}

// ========================
// Settings
// ========================

export interface AppSettings {
  refreshIntervalMs: number;
  alertCpuThreshold: number;
  alertMemoryThreshold: number;
  alertDiskThreshold: number;
  alertDiskMountPoints: string[];   // which mount points to check, default ["/"]
  alertSuppressDefaultDays: number; // default suppress duration in days
  apiEnabled: boolean;
  apiPort: number;
  apiToken: string;
  historyRetentionDays: number;
  securityMiningKeywords: string[];
  securityUnownedGpuMinutes: number;
  securityHighGpuUtilizationPercent: number;
  securityHighGpuDurationMinutes: number;
  password: string;           // bcrypt hash, for web mode
  agentMetricsTimeoutMs: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  refreshIntervalMs: 5000,
  alertCpuThreshold: 90,
  alertMemoryThreshold: 90,
  alertDiskThreshold: 90,
  alertDiskMountPoints: ['/'],
  alertSuppressDefaultDays: 7,
  apiEnabled: true,
  apiPort: 17210,
  apiToken: '',
  historyRetentionDays: 7,
  securityMiningKeywords: ['xmrig', 'ethminer', 'nbminer'],
  securityUnownedGpuMinutes: 30,
  securityHighGpuUtilizationPercent: 90,
  securityHighGpuDurationMinutes: 120,
  password: '',
  agentMetricsTimeoutMs: 15_000,
};

// ========================
// Events
// ========================

export interface CoreEvents {
  metricsUpdate: (data: MetricsSnapshot) => void;
  serverStatus: (status: ServerStatus) => void;
  alert: (alert: AlertEvent) => void;
  securityEvent: (event: SecurityEventRecord) => void;
  hookTriggered: (log: HookLog) => void;
  notify: (title: string, body: string) => void;
}

export interface AlertEvent {
  id?: string;                // alert record ID (if persisted)
  serverId: string;
  serverName: string;
  metric: string;
  value: number;
  threshold: number;
  timestamp: number;
}

export interface AlertRecord {
  id: string;
  serverId: string;
  serverName: string;
  metric: string;
  value: number;
  threshold: number;
  timestamp: number;
  suppressedUntil: number | null;
}

// ========================
// Template Variables (for hooks)
// ========================

export interface TemplateContext {
  serverName: string;
  serverHost: string;
  gpuMemUsage: number;
  gpuUtil: number;
  gpuIdleMinutes: number;
  timestamp: string;
  cpuUsage: number;
  memUsage: number;
  personId: string;
  personName: string;
  personEmail: string;
  personQQ: string;
  personNote: string;
  personCustomFieldsJson: string;
  rawUser: string;
  taskId: string;
  resolutionSource: string;
}

// ========================
// Person Attribution
// ========================

export type PersonStatus = 'active' | 'archived';
export type PersonResolutionSource = 'override' | 'binding' | 'unassigned' | 'unknown';

export interface PersonRecord {
  id: string;
  displayName: string;
  email: string;
  qq: string;
  note: string;
  customFields: Record<string, string>;
  status: PersonStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PersonBindingRecord {
  id: string;
  personId: string;
  serverId: string;
  systemUser: string;
  source: 'manual' | 'suggested' | 'synced';
  enabled: boolean;
  effectiveFrom: number;
  effectiveTo: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TaskOwnerOverrideRecord {
  id: string;
  taskId: string;
  serverId: string;
  personId: string;
  source: 'manual' | 'synced';
  effectiveFrom: number;
  effectiveTo: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ResolvedPersonSummary {
  id: string;
  displayName: string;
  email: string;
  qq: string;
}

export interface PersonSummaryItem {
  personId: string;
  displayName: string;
  currentVramMB: number;
  runningTaskCount: number;
  queuedTaskCount: number;
  activeServerCount: number;
  lastActivityAt: number;
  vramOccupancyHours: number;
  vramGigabyteHours: number;
  taskRuntimeHours: number;
}

export interface PersonTimelinePoint {
  bucketStart: number;
  personId: string;
  totalVramMB: number;
  taskVramMB: number;
  nonTaskVramMB: number;
}

export interface PersonBindingSuggestion {
  serverId: string;
  serverName: string;
  systemUser: string;
  lastSeenAt: number;
}

export interface PersonBindingCandidateActiveBinding {
  bindingId: string;
  personId: string;
  personDisplayName: string;
}

export interface PersonBindingCandidate {
  serverId: string;
  serverName: string;
  systemUser: string;
  lastSeenAt: number;
  activeBinding: PersonBindingCandidateActiveBinding | null;
}

export interface ServerPersonActivity {
  serverId: string;
  people: Array<{ personId: string; displayName: string; currentVramMB: number; runningTaskCount: number }>;
  unassignedVramMB: number;
  unassignedUsers: string[];
}

// ========================
// Person Mobile
// ========================

export interface PersonMobileTokenRecord {
  id: string;
  personId: string;
  label: string;
  tokenHash: string;
  createdAt: number;
  rotatedAt: number | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
}

export interface PersonMobilePreferenceRecord {
  personId: string;
  notifyTaskStarted: boolean;
  notifyTaskCompleted: boolean;
  notifyTaskFailed: boolean;
  notifyTaskCancelled: boolean;
  notifyNodeStatus: boolean;
  notifyGpuAvailable: boolean;
  minAvailableGpuCount: number;
  minAvailableVramGB: number | null;
  updatedAt: number;
}

export type PersonMobileNotificationCategory = 'task' | 'node' | 'gpu';

export interface PersonMobileNotificationRecord {
  id: string;
  personId: string;
  category: PersonMobileNotificationCategory;
  eventType: string;
  title: string;
  body: string;
  payloadJson: string;
  dedupeKey: string;
  createdAt: number;
  readAt: number | null;
}

export interface MobileAdminSummary {
  serverCount: number;
  onlineServerCount: number;
  totalRunningTasks: number;
  totalQueuedTasks: number;
  unreadNotificationCount: number;
}

export interface MobilePersonBootstrap {
  person: PersonRecord;
  runningTaskCount: number;
  queuedTaskCount: number;
  boundNodeCount: number;
  unreadNotificationCount: number;
}

// ========================
// Resolved GPU Allocation
// ========================

export interface ResolvedGpuAllocationSegment {
  ownerKey: string;
  ownerKind: 'person' | 'user' | 'unknown';
  displayName: string;
  usedMemoryMB: number;
  personId?: string;
  rawUser?: string;
  sourceKinds: Array<'task' | 'user_process' | 'unknown_process'>;
}

export interface ResolvedPerGpuAllocation {
  gpuIndex: number;
  totalMemoryMB: number;
  freeMB: number;
  segments: ResolvedGpuAllocationSegment[];
}

export interface ResolvedGpuAllocationResponse {
  serverId: string;
  snapshotTimestamp: number;
  perGpu: ResolvedPerGpuAllocation[];
}

// ========================
// Person Attribution Fact
// ========================

export interface PersonAttributionFact {
  personId: string | null;
  rawUser: string | null;
  taskId: string | null;
  serverId: string;
  gpuIndex: number;
  vramMB: number;
  timestamp: number;
  resolutionSource: 'binding' | 'override' | 'unassigned';
}
