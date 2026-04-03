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

export type SecurityEventType = 'suspicious_process' | 'unowned_gpu' | 'marked_safe';

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
