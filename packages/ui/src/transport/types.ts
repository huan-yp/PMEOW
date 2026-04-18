// Server
export interface Server {
  id: string;
  name: string;
  agentId: string;
  createdAt: number;
  updatedAt: number;
}

export interface ServerStatus {
  serverId: string;
  status: 'online' | 'offline';
  lastSeenAt: number;
  version: string;
}

// UnifiedReport (from spec §4.3)
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
  taskId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'abnormal';
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
  finishedAt: number | null;
  pid: number | null;
  exitCode: number | null;
  endReason: string | null;
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

// Task (persisted, from spec §3.1 tasks table)
export interface Task {
  id: string;
  serverId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'abnormal';
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
  finishedAt: number | null;
  pid: number | null;
  exitCode: number | null;
  assignedGpus: number[] | null;
  declaredVramPerGpu: number | null;
  scheduleHistory: ScheduleEvaluation[] | null;
  endReason: string | null;
}

// Alert (three-state model)
export type AlertStatus = 'active' | 'resolved' | 'silenced';

export interface Alert {
  id: number;
  serverId: string;
  alertType: 'cpu' | 'memory' | 'disk' | 'gpu_temp' | 'offline' | 'gpu_idle_memory';
  value: number | null;
  threshold: number | null;
  fingerprint: string;
  details: Record<string, unknown> | null;
  status: AlertStatus;
  createdAt: number;
  updatedAt: number;
}

export interface AlertQuery {
  serverId?: string;
  status?: AlertStatus;
  limit?: number;
  offset?: number;
}

// Security Event
export interface SecurityEvent {
  id: number;
  serverId: string;
  eventType: 'suspicious_process' | 'unowned_gpu' | 'high_gpu_utilization' | 'marked_safe' | 'unresolve';
  fingerprint: string;
  details: Record<string, unknown>;
  resolved: boolean;
  resolvedBy: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

// Person
export interface Person {
  id: string;
  displayName: string;
  email: string | null;
  qq: string | null;
  note: string | null;
  customFields: Record<string, string> | null;
  status: 'active' | 'archived';
  createdAt: number;
  updatedAt: number;
}

export interface PersonDirectoryItem extends Person {
  currentCpuPercent: number;
  currentMemoryMb: number;
  currentVramMb: number;
  runningTaskCount: number;
  queuedTaskCount: number;
  activeServerCount: number;
}

export interface PersonBinding {
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

export interface PersonBindingCandidate {
  serverId: string;
  serverName: string;
  systemUser: string;
  activeBinding: PersonBinding | null;
  activePerson: Pick<Person, 'id' | 'displayName' | 'email' | 'qq'> | null;
}

export type PersonWizardMode = 'seed-user' | 'manual';

export interface CreatePersonWizardInput {
  mode: PersonWizardMode;
  person: {
    displayName: string;
    email?: string | null;
    qq?: string | null;
    note?: string | null;
  };
  bindings: Array<{
    serverId: string;
    systemUser: string;
    source?: 'manual' | 'suggested' | 'synced';
  }>;
  confirmTransfer?: boolean;
}

export interface PersonBindingConflict {
  serverId: string;
  systemUser: string;
  activeBinding: PersonBinding;
  activePerson: Pick<Person, 'id' | 'displayName' | 'email' | 'qq'> | null;
}

export interface CreatePersonWizardResult {
  person: Person;
  bindings: PersonBinding[];
  transferredBindings: PersonBindingConflict[];
}

// Auto-add unassigned users
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

export interface PersonTimelinePoint {
  timestamp: number;
  vramMb: number;
  serverId: string;
  gpuIndex: number;
}

// Person token
export type PersonTokenStatus = 'active' | 'revoked';

export interface PersonToken {
  id: number;
  personId: string;
  status: PersonTokenStatus;
  note: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface PersonTokenCreateResult extends PersonToken {
  plainToken: string;
}

export type SessionPrincipal =
  | { kind: 'admin' }
  | { kind: 'person'; personId: string };

export type AuthSession =
  | {
      authenticated: true;
      principal: SessionPrincipal;
      person: Person | null;
      accessibleServerIds: string[] | null;
    }
  | {
      authenticated: false;
      principal: null;
      person: null;
      accessibleServerIds: null;
    };

export interface LoginResult {
  token: string;
  authenticated: true;
  principal: SessionPrincipal;
  person: Person | null;
  accessibleServerIds: string[] | null;
}

export interface LoginCredentials {
  password?: string;
  token?: string;
}

// Task Event (pushed via WebSocket)
export interface TaskEvent {
  serverId: string;
  eventType: 'submitted' | 'started' | 'ended';
  task: TaskInfo;
}

// Alert State Change Event (pushed via WebSocket)
export interface AlertStateChangeEvent {
  alert: Alert;
  fromStatus: AlertStatus | null;
  toStatus: AlertStatus;
}

// Snapshot with GPU (for history queries)
export interface SnapshotWithGpu {
  id: number;
  serverId: string;
  timestamp: number;
  tier: 'recent' | 'archive';
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

// GPU Overview response
export interface GpuOverviewResponse {
  servers: { serverId: string; serverName: string; gpus: GpuCardReport[] }[];
}

// Settings
export interface Settings {
  alertCpuThreshold: number;
  alertMemoryThreshold: number;
  alertDiskThreshold: number;
  alertGpuTempThreshold: number;
  alertGpuIdleMemoryPercent: number;
  alertGpuIdleUtilizationPercent: number;
  alertGpuIdleDurationSeconds: number;
  [key: string]: unknown;
}

// Toast (UI-only)
export interface Toast {
  id: string;
  title: string;
  body: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: number;
}

// Transport adapter interface
export interface TransportAdapter {
  // Connection
  connect(): void;
  disconnect(): void;

  // Realtime subscriptions (return unsubscribe fn)
  onMetricsUpdate(cb: (data: { serverId: string; snapshot: UnifiedReport }) => void): () => void;
  onServerStatus(cb: (status: ServerStatus) => void): () => void;
  onTaskEvent(cb: (event: TaskEvent) => void): () => void;
  onAlertStateChange(cb: (event: AlertStateChangeEvent) => void): () => void;
  onSecurityEvent(cb: (event: SecurityEvent) => void): () => void;
  onServersChanged(cb: () => void): () => void;

  // Servers (spec §8.2)
  getServers(): Promise<Server[]>;
  addServer(input: { name: string; agentId: string }): Promise<Server>;
  deleteServer(id: string): Promise<void>;
  getStatuses(): Promise<Record<string, ServerStatus>>;

  // Snapshots (spec §8.3)
  getLatestMetrics(): Promise<Record<string, UnifiedReport>>;
  getMetricsHistory(serverId: string, query: { from?: number; to?: number; tier?: 'recent' | 'archive' }): Promise<{ snapshots: SnapshotWithGpu[] }>;

  // Tasks (spec §8.4)
  getTasks(query?: { serverId?: string; status?: string; user?: string; page?: number; limit?: number }): Promise<{ tasks: Task[]; total: number }>;
  getTask(taskId: string): Promise<Task>;
  cancelTask(serverId: string, taskId: string): Promise<void>;
  setTaskPriority(serverId: string, taskId: string, priority: number): Promise<void>;

  // GPU Overview (spec §8.5)
  getGpuOverview(): Promise<GpuOverviewResponse>;

  // Persons (spec §8.6)
  getPersons(): Promise<Person[]>;
  getPersonDirectory(): Promise<PersonDirectoryItem[]>;
  createPerson(input: { displayName: string; email?: string; qq?: string; note?: string }): Promise<Person>;
  getPerson(id: string): Promise<Person>;
  updatePerson(id: string, input: Partial<{ displayName: string; email: string; qq: string; note: string; status: string }>): Promise<Person>;
  getPersonBindings(personId: string): Promise<PersonBinding[]>;
  createPersonBinding(input: { personId: string; serverId: string; systemUser: string; source?: string }): Promise<PersonBinding>;
  updatePersonBinding(id: number, input: Partial<{ enabled: boolean; effectiveFrom: number; effectiveTo: number }>): Promise<PersonBinding>;
  createPersonWizard(input: CreatePersonWizardInput): Promise<CreatePersonWizardResult>;
  autoAddUnassigned(): Promise<AutoAddReport>;
  getPersonTimeline(personId: string, query?: { from?: number; to?: number }): Promise<{ points: PersonTimelinePoint[] }>;
  getPersonTasks(personId: string, query?: { page?: number; limit?: number }): Promise<{ tasks: Task[]; total: number }>;
  getPersonBindingCandidates(): Promise<{ candidates: PersonBindingCandidate[] }>;

  // Person tokens (admin only)
  getPersonTokens(personId: string): Promise<PersonToken[]>;
  createPersonToken(personId: string, note?: string | null): Promise<PersonTokenCreateResult>;
  revokePersonToken(tokenId: number): Promise<PersonToken>;
  rotatePersonToken(tokenId: number, note?: string | null): Promise<PersonTokenCreateResult>;

  // Alerts (spec §8.7)
  getAlerts(query?: AlertQuery): Promise<Alert[]>;
  silenceAlert(id: number): Promise<void>;
  unsilenceAlert(id: number): Promise<void>;
  batchSilenceAlerts(ids: number[]): Promise<void>;
  batchUnsilenceAlerts(ids: number[]): Promise<void>;

  // Security (spec §8.8)
  getSecurityEvents(query?: { serverId?: string; resolved?: boolean }): Promise<SecurityEvent[]>;
  markSecurityEventSafe(id: number): Promise<void>;
  unresolveSecurityEvent(id: number): Promise<void>;

  // Settings (spec §8.9)
  getSettings(): Promise<Settings>;
  saveSettings(settings: Partial<Settings>): Promise<void>;

  // Auth (spec §8.1)
  login(credentials: LoginCredentials): Promise<LoginResult>;
  checkAuth(): Promise<AuthSession>;
}