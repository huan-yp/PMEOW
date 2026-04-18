import type {
  Alert,
  AlertQuery,
  AlertStateChangeEvent,
  AuthSession,
  AutoAddReport,
  CreatePersonWizardInput,
  CreatePersonWizardResult,
  GpuOverviewResponse,
  LoginCredentials,
  LoginResult,
  Person,
  PersonBinding,
  PersonBindingCandidate,
  PersonDirectoryItem,
  PersonTimelinePoint,
  PersonToken,
  PersonTokenCreateResult,
  SecurityEvent,
  Server,
  ServerStatus,
  SessionPrincipal,
  Settings,
  SnapshotWithGpu,
  Task,
  TaskEvent,
  UnifiedReport,
} from './types.js';

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

  // Servers
  getServers(): Promise<Server[]>;
  addServer(input: { name: string; agentId: string }): Promise<Server>;
  deleteServer(id: string): Promise<void>;
  getStatuses(): Promise<Record<string, ServerStatus>>;

  // Snapshots
  getLatestMetrics(): Promise<Record<string, UnifiedReport>>;
  getMetricsHistory(serverId: string, query: { from?: number; to?: number; tier?: 'recent' | 'archive' }): Promise<{ snapshots: SnapshotWithGpu[] }>;

  // Tasks
  getTasks(query?: { serverId?: string; status?: string; user?: string; page?: number; limit?: number }): Promise<{ tasks: Task[]; total: number }>;
  getTask(taskId: string): Promise<Task>;
  cancelTask(serverId: string, taskId: string): Promise<void>;
  setTaskPriority(serverId: string, taskId: string, priority: number): Promise<void>;

  // GPU Overview
  getGpuOverview(): Promise<GpuOverviewResponse>;

  // Persons
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

  // Alerts
  getAlerts(query?: AlertQuery): Promise<Alert[]>;
  silenceAlert(id: number): Promise<void>;
  unsilenceAlert(id: number): Promise<void>;
  batchSilenceAlerts(ids: number[]): Promise<void>;
  batchUnsilenceAlerts(ids: number[]): Promise<void>;

  // Security
  getSecurityEvents(query?: { serverId?: string; resolved?: boolean }): Promise<SecurityEvent[]>;
  markSecurityEventSafe(id: number): Promise<void>;
  unresolveSecurityEvent(id: number): Promise<void>;

  // Settings
  getSettings(): Promise<Settings>;
  saveSettings(settings: Partial<Settings>): Promise<void>;

  // Auth
  login(credentials: LoginCredentials): Promise<LoginResult>;
  checkAuth(): Promise<AuthSession>;
}
