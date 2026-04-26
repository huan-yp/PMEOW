// ========================
// Server
// ========================

export interface ServerRecord {
  id: string;
  name: string;
  agentId: string;
  createdAt: number;
  updatedAt: number;
}

export type ServerInput = {
  name: string;
  agentId: string;
};

export type ServerUpdateInput = Partial<ServerInput>;

// ========================
// Unified Report (from agent)
// ========================

export interface UnifiedReport {
  agentId: string;
  timestamp: number;
  seq: number;
  resourceSnapshot: {
    gpuCards: GpuCardReport[];
    cpu: CpuSnapshot;
    memory: MemorySnapshot;
    disks: DiskInfo[];
    diskIo: DiskIoSnapshot;
    network: NetworkSnapshot;
    processes: ProcessInfo[];
    processesByUser: UserResourceSummary[];
    localUsers: string[];
    system?: SystemSnapshot;
  };
  taskQueue: {
    queued: TaskInfo[];
    running: TaskInfo[];
    recentlyEnded: TaskInfo[];
  };
}

export interface CpuSnapshot {
  usagePercent: number;
  coreCount: number;
  modelName: string;
  frequencyMhz: number;
  perCoreUsage: number[];
}

export interface MemorySnapshot {
  totalMb: number;
  usedMb: number;
  availableMb: number;
  usagePercent: number;
  swapTotalMb: number;
  swapUsedMb: number;
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

export interface DiskIoSnapshot {
  readBytesPerSec: number;
  writeBytesPerSec: number;
}

export interface NetworkInterface {
  name: string;
  rxBytes: number;
  txBytes: number;
}

export interface NetworkSnapshot {
  rxBytesPerSec: number;
  txBytesPerSec: number;
  interfaces: NetworkInterface[];
  internetReachable?: boolean;
  internetLatencyMs?: number;
  internetProbeTarget?: string;
  internetProbeCheckedAt?: number;
}

export interface GpuCardReport {
  index: number;
  name: string;
  temperature: number;
  utilizationGpu: number;
  utilizationMemory: number;
  memoryTotalMb: number;
  memoryUsedMb: number;
  managedReservedMb: number;
  unmanagedPeakMb: number;
  effectiveFreeMb: number;
  taskAllocations: { taskId: string; declaredVramMb: number; pid?: number; user?: string; command?: string; actualVramMb?: number }[];
  userProcesses: { pid: number; user: string; vramMb: number }[];
  unknownProcesses: { pid: number; vramMb: number }[];
}

export type VramMode = 'exclusive_auto' | 'shared';

export interface TaskInfo {
  taskId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'abnormal';
  command: string;
  cwd: string;
  user: string;
  launchMode: 'background' | 'foreground';
  requireVramMb: number;
  requestedVramMb: number | null;
  vramMode: VramMode;
  requireGpuCount: number;
  gpuIds: number[] | null;
  priority: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  pid: number | null;
  exitCode: number | null;
  endReason: string | null;
  assignedGpus: number[] | null;
  declaredVramPerGpu: number | null;
  autoObserveWindowSec: number | null;
  autoPeakVramByGpuMb: Record<string, number> | null;
  autoReclaimedVramByGpuMb: Record<string, number | null> | null;
  autoReclaimDone: boolean;
  scheduleHistory: ScheduleEvaluation[];
}

export interface ScheduleEvaluation {
  timestamp: number;
  result: 'scheduled' | 'blocked_by_priority' | 'insufficient_gpu' | 'sustained_window_not_met';
  gpuSnapshot: Record<string, unknown>;
  detail: string;
}

export interface ProcessInfo {
  pid: number;
  ppid: number | null;
  user: string;
  cpuPercent: number;
  memPercent: number;
  rss: number;
  command: string;
  gpuMemoryMb: number;
}

export interface UserResourceSummary {
  user: string;
  totalCpuPercent: number;
  totalRssMb: number;
  totalVramMb: number;
  processCount: number;
}

export interface SystemSnapshot {
  hostname: string;
  uptime: string;
  loadAvg1: number;
  loadAvg5: number;
  loadAvg15: number;
  kernelVersion: string;
}

// ========================
// DB Records
// ========================

export interface SnapshotRecord {
  id: number;
  serverId: string;
  timestamp: number;
  tier: 'recent' | 'archive';
  seq: number | null;
  cpu: CpuSnapshot;
  memory: MemorySnapshot;
  disks: DiskInfo[];
  diskIo: DiskIoSnapshot;
  network: NetworkSnapshot;
  processes: ProcessInfo[];
  processesByUser: UserResourceSummary[];
  localUsers: string[];
  gpuCards: GpuCardReport[];
}

export interface GpuSnapshotRecord {
  id: number;
  snapshotId: number;
  serverId: string;
  gpuIndex: number;
  name: string;
  temperature: number;
  utilizationGpu: number;
  utilizationMemory: number;
  memoryTotalMb: number;
  memoryUsedMb: number;
  managedReservedMb: number;
  unmanagedPeakMb: number;
  effectiveFreeMb: number;
  taskAllocations: string;  // JSON
  userProcesses: string;
  unknownProcesses: string;
}

export interface TaskRecord {
  id: string;
  serverId: string;
  serverName: string;
  status: string;
  command: string;
  cwd: string;
  user: string;
  launchMode: string;
  requireVramMb: number;
  requestedVramMb: number | null;
  vramMode: VramMode;
  requireGpuCount: number;
  gpuIds: string | null;  // JSON
  priority: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  pid: number | null;
  exitCode: number | null;
  assignedGpus: string | null;  // JSON
  declaredVramPerGpu: number | null;
  autoObserveWindowSec: number | null;
  autoPeakVramByGpuMb: Record<string, number> | null;
  autoReclaimedVramByGpuMb: Record<string, number | null> | null;
  autoReclaimDone: boolean;
  scheduleHistory: string | null;  // JSON
  endReason: string | null;
}

export type AlertStatus = 'active' | 'resolved' | 'silenced';

export interface AlertRecord {
  id: number;
  serverId: string;
  serverName: string;
  alertType: string;
  value: number | null;
  threshold: number | null;
  fingerprint: string;
  details: Record<string, unknown> | null;
  status: AlertStatus;
  createdAt: number;
  updatedAt: number;
}

export interface AlertTransition {
  alertId: number;
  fromStatus: AlertStatus;
  toStatus: AlertStatus;
  source: 'detection' | 'user_action';
  createdAt: number;
}

export interface AlertStateChange {
  alert: AlertRecord;
  fromStatus: AlertStatus;
  toStatus: AlertStatus;
}

export type AlertType = 'cpu' | 'memory' | 'disk' | 'gpu_temp' | 'offline' | 'gpu_idle_memory';

export interface AlertAnomaly {
  alertType: AlertType;
  value: number;
  threshold: number;
  fingerprint: string;
  details: Record<string, unknown> | null;
}

export interface AlertEngineResult {
  allChanges: AlertStateChange[];
  broadcastable: AlertStateChange[];
}

// Security types
export type SecurityEventType = 'suspicious_process' | 'unowned_gpu' | 'high_gpu_utilization' | 'marked_safe' | 'unresolve';

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

// Person types
export type PersonStatus = 'active' | 'archived';

export interface PersonRecord {
  id: string;
  displayName: string;
  email: string | null;
  qq: string | null;
  note: string | null;
  customFields: Record<string, string>;
  status: PersonStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PersonDirectoryItem extends PersonRecord {
  currentCpuPercent: number;
  currentMemoryMb: number;
  currentVramMb: number;
  runningTaskCount: number;
  queuedTaskCount: number;
  activeServerCount: number;
}

export interface PersonBindingRecord {
  id: number;
  personId: string;
  serverId: string;
  systemUser: string;
  source: 'manual' | 'suggested' | 'synced';
  enabled: boolean;
  effectiveFrom: number | null;
  effectiveTo: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PersonTimelinePoint {
  timestamp: number;
  vramMb: number;
  serverId: string;
  gpuIndex: number;
}

// Settings
export interface AppSettings {
  alertCpuThreshold: number;
  alertMemoryThreshold: number;
  alertDiskThreshold: number;
  alertGpuTempThreshold: number;
  alertThresholdDurationSeconds: number;
  alertOfflineSeconds: number;
  alertGpuIdleMemoryPercent: number;
  alertGpuIdleUtilizationPercent: number;
  alertGpuIdleDurationSeconds: number;
  alertDiskMountPoints: string[];
  alertSuppressDefaultDays: number;
  securityMiningKeywords: string[];
  securityUnownedGpuMinutes: number;
  snapshotRecentIntervalSeconds: number;
  snapshotArchiveIntervalSeconds: number;
  snapshotRecentKeepCount: number;
  password: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  alertCpuThreshold: 90,
  alertMemoryThreshold: 90,
  alertDiskThreshold: 90,
  alertGpuTempThreshold: 85,
  alertThresholdDurationSeconds: 60,
  alertOfflineSeconds: 30,
  alertGpuIdleMemoryPercent: 20,
  alertGpuIdleUtilizationPercent: 5,
  alertGpuIdleDurationSeconds: 60,
  alertDiskMountPoints: ['/'],
  alertSuppressDefaultDays: 7,
  securityMiningKeywords: ['xmrig', 'ethminer', 'nbminer'],
  securityUnownedGpuMinutes: 30,
  snapshotRecentIntervalSeconds: 60,
  snapshotArchiveIntervalSeconds: 1800,
  snapshotRecentKeepCount: 120,
  password: '',
};

// Resolved person summary (for person resolution)
export interface ResolvedPersonSummary {
  id: string;
  displayName: string;
  email: string | null;
  qq: string | null;
}

export type PersonResolutionSource = 'binding' | 'unassigned' | 'unknown';

// Person binding candidate
export interface PersonBindingCandidate {
  serverId: string;
  serverName: string;
  systemUser: string;
  activeBinding: PersonBindingRecord | null;
  activePerson: ResolvedPersonSummary | null;
}

export type PersonWizardMode = 'seed-user' | 'manual';

// Auto-add unassigned users report
export interface AutoAddReportEntry {
  serverId: string;
  serverName: string;
  systemUser: string;
  action: 'created' | 'reused' | 'skipped_root' | 'skipped_ambiguous' | 'skipped_bound';
  personId: string | null;
  personDisplayName: string | null;
  detail: string;
}

export interface AutoAddReport {
  entries: AutoAddReportEntry[];
  createdCount: number;
  reusedCount: number;
  skippedCount: number;
}

// Person token
export type PersonTokenStatus = 'active' | 'revoked';

export interface PersonTokenRecord {
  id: number;
  personId: string;
  tokenHash: string;
  status: PersonTokenStatus;
  note: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

// Auth principal
export type PrincipalKind = 'admin' | 'person';

export interface AdminPrincipal {
  kind: 'admin';
}

export interface PersonPrincipal {
  kind: 'person';
  personId: string;
}

export type Principal = AdminPrincipal | PersonPrincipal;

export interface CreatePersonWizardBindingInput {
  serverId: string;
  systemUser: string;
  source?: 'manual' | 'suggested' | 'synced';
}

export interface CreatePersonWizardInput {
  mode: PersonWizardMode;
  person: {
    displayName: string;
    email?: string | null;
    qq?: string | null;
    note?: string | null;
  };
  bindings: CreatePersonWizardBindingInput[];
  confirmTransfer?: boolean;
}

export interface PersonBindingConflict {
  serverId: string;
  systemUser: string;
  activeBinding: PersonBindingRecord;
  activePerson: ResolvedPersonSummary | null;
}

export interface CreatePersonWizardResult {
  person: PersonRecord;
  bindings: PersonBindingRecord[];
  transferredBindings: PersonBindingConflict[];
}
