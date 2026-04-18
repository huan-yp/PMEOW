import { io, Socket } from 'socket.io-client';
import type {
  TransportAdapter, Server, ServerStatus, UnifiedReport, Task, Alert, AlertQuery,
  SecurityEvent, Person, PersonBinding, PersonBindingCandidate, PersonDirectoryItem, PersonTimelinePoint, SnapshotWithGpu,
  GpuOverviewResponse, Settings, TaskEvent, AlertStateChangeEvent, CreatePersonWizardInput, CreatePersonWizardResult,
  AutoAddReport, PersonToken, PersonTokenCreateResult, AuthSession, LoginCredentials, LoginResult,
} from './types.js';

export class WebSocketAdapter implements TransportAdapter {
  private socket: Socket | null = null;
  private token: string | null = null;
  private socketLogBound = false;

  constructor() {
    this.token = localStorage.getItem('auth_token');
  }

  connect(): void {
    if (this.socket?.connected) return;
    this.socket = io(undefined as unknown as string, {
      auth: { token: this.token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    this.bindSocketLogs();
    console.info(`[ui-ws] connect requested: tokenPresent=${this.token ? 'yes' : 'no'}`);
  }

  disconnect(): void {
    console.info(`[ui-ws] disconnect requested: socketPresent=${this.socket ? 'yes' : 'no'} connected=${this.socket?.connected ? 'yes' : 'no'}`);
    this.socket?.disconnect();
    this.socket = null;
    this.socketLogBound = false;
  }

  private bindSocketLogs(): void {
    if (!this.socket || this.socketLogBound) return;
    this.socketLogBound = true;

    this.socket.on('connect', () => {
      console.info(`[ui-ws] connected: id=${this.socket?.id ?? 'unknown'} transport=${this.socket?.io.engine.transport.name ?? 'unknown'}`);
    });
    this.socket.on('disconnect', (reason, details) => {
      const detailText = details ? JSON.stringify(details) : 'none';
      console.info(`[ui-ws] disconnected: reason=${reason} details=${detailText}`);
    });
    this.socket.on('connect_error', (error) => {
      console.warn(`[ui-ws] connect_error: ${error.message}`);
    });
    this.socket.io.on('reconnect_attempt', (attempt) => {
      console.info(`[ui-ws] reconnect_attempt: count=${attempt}`);
    });
    this.socket.io.on('reconnect_error', (error) => {
      console.warn(`[ui-ws] reconnect_error: ${error instanceof Error ? error.message : String(error)}`);
    });
    this.socket.io.on('reconnect_failed', () => {
      console.warn('[ui-ws] reconnect_failed');
    });
  }

  // Subscriptions
  onMetricsUpdate(cb: (data: { serverId: string; report: UnifiedReport }) => void): () => void {
    this.socket?.on('metricsUpdate', cb);
    return () => { this.socket?.off('metricsUpdate', cb); };
  }

  onServerStatus(cb: (status: ServerStatus) => void): () => void {
    this.socket?.on('serverStatus', cb);
    return () => { this.socket?.off('serverStatus', cb); };
  }

  onTaskEvent(cb: (event: TaskEvent) => void): () => void {
    this.socket?.on('taskEvent', cb);
    return () => { this.socket?.off('taskEvent', cb); };
  }

  onAlertStateChange(cb: (event: AlertStateChangeEvent) => void): () => void {
    this.socket?.on('alertStateChange', cb);
    return () => { this.socket?.off('alertStateChange', cb); };
  }

  onSecurityEvent(cb: (event: SecurityEvent) => void): () => void {
    this.socket?.on('securityEvent', cb);
    return () => { this.socket?.off('securityEvent', cb); };
  }

  onServersChanged(cb: () => void): () => void {
    this.socket?.on('serversChanged', cb);
    return () => { this.socket?.off('serversChanged', cb); };
  }

  // REST helper
  private async fetch<T>(url: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string> || {}),
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    const res = await window.fetch(url, { ...options, headers });
    if (res.status === 401) {
      localStorage.removeItem('auth_token');
      this.token = null;
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const contentType = res.headers.get('content-type') ?? '';
      let details: unknown = undefined;
      let message = `HTTP ${res.status}`;

      if (contentType.includes('application/json')) {
        details = await res.json();
        if (details && typeof details === 'object') {
          const record = details as Record<string, unknown>;
          if (typeof record.message === 'string') {
            message = record.message;
          } else if (typeof record.error === 'string') {
            message = record.error;
          }
        }
      } else {
        const text = await res.text();
        if (text) {
          message = text;
        }
      }

      const error = new Error(message) as Error & { status?: number; details?: unknown };
      error.status = res.status;
      error.details = details;
      throw error;
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  }

  // Servers
  async getServers(): Promise<Server[]> { return this.fetch('/api/servers'); }
  async addServer(input: { name: string; agentId: string }): Promise<Server> {
    return this.fetch('/api/servers', { method: 'POST', body: JSON.stringify(input) });
  }
  async deleteServer(id: string): Promise<void> {
    await this.fetch(`/api/servers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  async getStatuses(): Promise<Record<string, ServerStatus>> { return this.fetch('/api/statuses'); }

  // Snapshots
  async getLatestMetrics(): Promise<Record<string, UnifiedReport>> { return this.fetch('/api/metrics/latest'); }
  async getMetricsHistory(serverId: string, query: { from?: number; to?: number; tier?: 'recent' | 'archive' } = {}): Promise<{ snapshots: SnapshotWithGpu[] }> {
    const params = new URLSearchParams();
    if (query.from !== undefined) params.set('from', String(query.from));
    if (query.to !== undefined) params.set('to', String(query.to));
    if (query.tier) params.set('tier', query.tier);
    return this.fetch<SnapshotWithGpu[]>(`/api/metrics/${encodeURIComponent(serverId)}/history?${params}`).then((snapshots) => ({ snapshots }));
  }

  // Tasks
  async getTasks(query: { serverId?: string; status?: string; user?: string; page?: number; limit?: number } = {}): Promise<{ tasks: Task[]; total: number }> {
    const params = new URLSearchParams();
    if (query.serverId) params.set('serverId', query.serverId);
    if (query.status) params.set('status', query.status);
    if (query.user) params.set('user', query.user);
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    return this.fetch(`/api/tasks?${params}`);
  }
  async getTask(taskId: string): Promise<Task> { return this.fetch(`/api/tasks/${encodeURIComponent(taskId)}`); }
  async cancelTask(serverId: string, taskId: string): Promise<void> {
    await this.fetch(`/api/servers/${encodeURIComponent(serverId)}/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
  }
  async setTaskPriority(serverId: string, taskId: string, priority: number): Promise<void> {
    await this.fetch(`/api/servers/${encodeURIComponent(serverId)}/tasks/${encodeURIComponent(taskId)}/priority`, { method: 'POST', body: JSON.stringify({ priority }) });
  }

  // GPU Overview
  async getGpuOverview(): Promise<GpuOverviewResponse> { return this.fetch('/api/gpu-overview'); }

  // Persons
  async getPersons(): Promise<Person[]> { return this.fetch('/api/persons'); }
  async getPersonDirectory(): Promise<PersonDirectoryItem[]> { return this.fetch('/api/persons/directory'); }
  async createPerson(input: { displayName: string; email?: string; qq?: string; note?: string }): Promise<Person> {
    return this.fetch('/api/persons', { method: 'POST', body: JSON.stringify(input) });
  }
  async getPerson(id: string): Promise<Person> { return this.fetch(`/api/persons/${encodeURIComponent(id)}`); }
  async updatePerson(id: string, input: Partial<{ displayName: string; email: string; qq: string; note: string; status: string }>): Promise<Person> {
    return this.fetch(`/api/persons/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
  }
  async getPersonBindings(personId: string): Promise<PersonBinding[]> { return this.fetch(`/api/persons/${encodeURIComponent(personId)}/bindings`); }
  async createPersonBinding(input: { personId: string; serverId: string; systemUser: string; source?: string }): Promise<PersonBinding> {
    return this.fetch('/api/person-bindings', { method: 'POST', body: JSON.stringify(input) });
  }
  async updatePersonBinding(id: number, input: Partial<{ enabled: boolean; effectiveFrom: number; effectiveTo: number }>): Promise<PersonBinding> {
    return this.fetch(`/api/person-bindings/${id}`, { method: 'PUT', body: JSON.stringify(input) });
  }
  async createPersonWizard(input: CreatePersonWizardInput): Promise<CreatePersonWizardResult> {
    return this.fetch('/api/persons/wizard', { method: 'POST', body: JSON.stringify(input) });
  }
  async autoAddUnassigned(): Promise<AutoAddReport> {
    return this.fetch('/api/persons/auto-add', { method: 'POST' });
  }
  async getPersonTimeline(personId: string, query: { from?: number; to?: number } = {}): Promise<{ points: PersonTimelinePoint[] }> {
    const params = new URLSearchParams();
    if (query.from !== undefined) params.set('from', String(query.from));
    if (query.to !== undefined) params.set('to', String(query.to));
    return this.fetch(`/api/persons/${encodeURIComponent(personId)}/timeline?${params}`);
  }
  async getPersonTasks(personId: string, query: { page?: number; limit?: number } = {}): Promise<{ tasks: Task[]; total: number }> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    return this.fetch(`/api/persons/${encodeURIComponent(personId)}/tasks?${params}`);
  }
  async getPersonBindingCandidates(): Promise<{ candidates: PersonBindingCandidate[] }> { return this.fetch('/api/person-binding-candidates'); }

  // Person tokens
  async getPersonTokens(personId: string): Promise<PersonToken[]> {
    return this.fetch(`/api/persons/${encodeURIComponent(personId)}/tokens`);
  }
  async createPersonToken(personId: string, note?: string | null): Promise<PersonTokenCreateResult> {
    return this.fetch(`/api/persons/${encodeURIComponent(personId)}/tokens`, { method: 'POST', body: JSON.stringify({ note: note ?? null }) });
  }
  async revokePersonToken(tokenId: number): Promise<PersonToken> {
    return this.fetch(`/api/person-tokens/${tokenId}/revoke`, { method: 'POST' });
  }
  async rotatePersonToken(tokenId: number, note?: string | null): Promise<PersonTokenCreateResult> {
    return this.fetch(`/api/person-tokens/${tokenId}/rotate`, { method: 'POST', body: JSON.stringify({ note: note ?? null }) });
  }

  // Alerts
  async getAlerts(query: AlertQuery = {}): Promise<Alert[]> {
    const params = new URLSearchParams();
    if (query.serverId) params.set('serverId', query.serverId);
    if (query.status) params.set('status', query.status);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
    return this.fetch(`/api/alerts?${params}`);
  }
  async silenceAlert(id: number): Promise<void> {
    await this.fetch(`/api/alerts/${id}/silence`, { method: 'POST' });
  }
  async unsilenceAlert(id: number): Promise<void> {
    await this.fetch(`/api/alerts/${id}/unsilence`, { method: 'POST' });
  }
  async batchSilenceAlerts(ids: number[]): Promise<void> {
    await this.fetch('/api/alerts/batch/silence', { method: 'POST', body: JSON.stringify({ ids }) });
  }
  async batchUnsilenceAlerts(ids: number[]): Promise<void> {
    await this.fetch('/api/alerts/batch/unsilence', { method: 'POST', body: JSON.stringify({ ids }) });
  }

  // Security
  async getSecurityEvents(query: { serverId?: string; resolved?: boolean } = {}): Promise<SecurityEvent[]> {
    const params = new URLSearchParams();
    if (query.serverId) params.set('serverId', query.serverId);
    if (query.resolved !== undefined) params.set('resolved', String(query.resolved));
    return this.fetch(`/api/security/events?${params}`);
  }
  async markSecurityEventSafe(id: number): Promise<void> {
    await this.fetch(`/api/security/events/${id}/mark-safe`, { method: 'POST' });
  }
  async unresolveSecurityEvent(id: number): Promise<void> {
    await this.fetch(`/api/security/events/${id}/unresolve`, { method: 'POST' });
  }

  // Settings
  async getSettings(): Promise<Settings> { return this.fetch('/api/settings'); }
  async saveSettings(settings: Partial<Settings>): Promise<void> {
    await this.fetch('/api/settings', { method: 'PUT', body: JSON.stringify(settings) });
  }

  // Auth
  async login(credentials: LoginCredentials): Promise<LoginResult> {
    const res = await window.fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '登录失败');
    }
    const data = await res.json();
    this.token = data.token;
    localStorage.setItem('auth_token', data.token);
    this.disconnect();
    this.connect();
    return data;
  }

  async checkAuth(): Promise<AuthSession> {
    if (!this.token) {
      return { authenticated: false, principal: null, person: null, accessibleServerIds: null };
    }

    try {
      return await this.fetch('/api/session/me');
    } catch {
      return { authenticated: false, principal: null, person: null, accessibleServerIds: null };
    }
  }
}