import type {
  AlertRecord,
  AlertStateChange,
  AlertStatus,
  AlertType,
  AppSettings,
  AutoAddReportEntry,
  AutoAddReport,
  CpuSnapshot,
  CreatePersonWizardInput,
  CreatePersonWizardResult,
  DiskInfo,
  DiskIoSnapshot,
  GpuCardReport,
  NetworkInterface,
  NetworkSnapshot,
  PersonBindingCandidate,
  PersonBindingConflict,
  PersonBindingRecord,
  PersonDirectoryItem,
  PersonRecord,
  PersonTimelinePoint,
  PersonTokenRecord,
  PersonTokenStatus,
  PersonWizardMode,
  Principal,
  ProcessInfo,
  ScheduleEvaluation,
  SecurityEventRecord,
  SecurityEventType,
  ServerRecord,
  SnapshotRecord,
  SystemSnapshot,
  TaskInfo,
  TaskRecord,
  UnifiedReport,
  UserResourceSummary,
} from '@monitor/server-contracts';

// Re-export types that frontends consume
export type {
  AlertStatus,
  AlertType,
  AutoAddReportEntry,
  AutoAddReport,
  CpuSnapshot,
  CreatePersonWizardInput,
  CreatePersonWizardResult,
  DiskInfo,
  DiskIoSnapshot,
  GpuCardReport,
  NetworkInterface,
  NetworkSnapshot,
  PersonBindingCandidate,
  PersonBindingConflict,
  PersonDirectoryItem,
  PersonTimelinePoint,
  PersonTokenStatus,
  PersonWizardMode,
  Principal,
  ProcessInfo,
  ScheduleEvaluation,
  SecurityEventType,
  SystemSnapshot,
  TaskInfo,
  UnifiedReport,
  UserResourceSummary,
} from '@monitor/server-contracts';

// Re-export boundary constants
export { API_PATHS, UI_SOCKET_EVENTS } from '@monitor/server-contracts';

// ========================
// Frontend view models
// ========================

export type Server = ServerRecord;

export interface ServerStatus {
  serverId: string;
  status: 'online' | 'offline';
  lastSeenAt: number | null;
  version: string;
}

export interface Task extends Omit<TaskRecord, 'status' | 'launchMode' | 'gpuIds' | 'assignedGpus' | 'scheduleHistory'> {
  status: TaskInfo['status'];
  launchMode: TaskInfo['launchMode'];
  gpuIds: number[] | null;
  assignedGpus: number[] | null;
  scheduleHistory: ScheduleEvaluation[] | null;
}

export interface Alert extends Omit<AlertRecord, 'alertType'> {
  alertType: AlertType;
}

export interface AlertQuery {
  serverId?: string;
  status?: AlertStatus;
  limit?: number;
  offset?: number;
}

export type SecurityEvent = SecurityEventRecord;
export type Person = PersonRecord;
export type PersonBinding = PersonBindingRecord;
export type PersonToken = Omit<PersonTokenRecord, 'tokenHash'>;
export type SessionPrincipal = Principal;
export type SnapshotWithGpu = SnapshotRecord;
export type Settings = Omit<AppSettings, 'password'>;

export interface PersonTokenCreateResult extends PersonToken {
  plainToken: string;
}

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

export interface TaskEvent {
  serverId: string;
  eventType: 'submitted' | 'started' | 'ended';
  task: TaskInfo;
}

export interface AlertStateChangeEvent {
  alert: Alert;
  fromStatus: AlertStateChange['fromStatus'] | null;
  toStatus: AlertStateChange['toStatus'];
}

export interface GpuOverviewResponse {
  servers: { serverId: string; serverName: string; gpus: GpuCardReport[] }[];
  users?: unknown[];
}
