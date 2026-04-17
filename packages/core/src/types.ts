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

// ========================
// Unified Report (from agent)
// ========================

export interface UnifiedReport {
  agentId: string;
  timestamp: number;
  seq: number;
  resourceSnapshot: {
    gpuCards: GpuCardReport[];
    cpu: { usage: number; cores: number; frequency: number };
    memory: { totalMb: number; usedMb: number; percent: number };
    disks: { mountpoint: string; totalMb: number; usedMb: number }[];
    network: { interface: string; rxBytesPerSec: number; txBytesPerSec: number }[];
    processes: ProcessInfo[];
    internet: { reachable: boolean; targets: string[] };
    localUsers: string[];
  };
  taskQueue: {
    queued: TaskInfo[];
    running: TaskInfo[];
  };
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
  taskAllocations: { taskId: string; declaredVramMb: number }[];
  userProcesses: { pid: number; user: string; vramMb: number }[];
  unknownProcesses: { pid: number; vramMb: number }[];
}

export interface TaskInfo {
  id: string;
  status: 'queued' | 'running';
  command: string;
  cwd: string;
  user: string;
  launchMode: 'daemon_shell' | 'attached_python';
  requireVramMb: number;
  requireGpuCount: number;
  gpuIds: number[] | null;
  priority: number;
  createdAt: number;
  startedAt: number | null;
  pid: number | null;
  assignedGpus: number[] | null;
  declaredVramPerGpu: number | null;
  scheduleHistory: ScheduleEvaluation[];
}

export interface ScheduleEvaluation {
  timestamp: number;
  result: 'scheduled' | 'blocked_by_priority' | 'insufficient_gpu' | 'sustained_window_not_met';
  gpuSnapshot: Record<string, number>;
  detail: string;
}

export interface ProcessInfo {
  pid: number;
  user: string;
  cpuPercent: number;
  memPercent: number;
  rss: number;
  command: string;
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
  cpu: string;  // JSON
  memory: string;
  disks: string;
  network: string;
  processes: string;
  internet: string;
  localUsers: string;
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
  status: string;
  command: string;
  cwd: string;
  user: string;
  launchMode: string;
  requireVramMb: number;
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
  scheduleHistory: string | null;  // JSON
}

export interface AlertRecord {
  id: number;
  serverId: string;
  alertType: string;
  value: number | null;
  threshold: number | null;
  createdAt: number;
  updatedAt: number;
  suppressedUntil: number | null;
}

export type AlertType = 'cpu' | 'memory' | 'disk' | 'gpu_temp' | 'offline';

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

// Settings
export interface AppSettings {
  alertCpuThreshold: number;
  alertMemoryThreshold: number;
  alertDiskThreshold: number;
  alertGpuTempThreshold: number;
  alertOfflineSeconds: number;
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
  alertOfflineSeconds: 30,
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
}
