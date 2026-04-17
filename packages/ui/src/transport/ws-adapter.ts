import { io, Socket } from 'socket.io-client';
import type {
  TransportAdapter, Server, ServerStatus, UnifiedReport, Task, Alert,
  SecurityEvent, Person, PersonBinding, PersonTimelinePoint, SnapshotWithGpu,
  GpuOverviewResponse, Settings, TaskEvent, AlertEvent,
} from './types.js';

export class WebSocketAdapter implements TransportAdapter {
  private socket: Socket | null = null;
  private token: string | null = null;

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
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  // Subscriptions
  onMetricsUpdate(cb: (data: { serverId: string; snapshot: UnifiedReport }) => void): () => void {
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

  onAlert(cb: (alert: AlertEvent) => void): () => void {
    this.socket?.on('alert', cb);
    return () => { this.socket?.off('alert', cb); };
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
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
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
  async getLatestMetrics(): Promise<Record<string, { snapshot: SnapshotWithGpu }>> { return this.fetch('/api/metrics/latest'); }
  async getMetricsHistory(serverId: string, query: { from?: number; to?: number; tier?: 'recent' | 'archive' } = {}): Promise<{ snapshots: SnapshotWithGpu[] }> {
    const params = new URLSearchParams();
    if (query.from !== undefined) params.set('from', String(query.from));
    if (query.to !== undefined) params.set('to', String(query.to));
    if (query.tier) params.set('tier', query.tier);
    return this.fetch(`/api/metrics/${encodeURIComponent(serverId)}/history?${params}`);
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
  async getPersonBindingCandidates(): Promise<{ candidates: { serverId: string; systemUser: string }[] }> { return this.fetch('/api/person-binding-candidates'); }

  // Alerts
  async getAlerts(query: { serverId?: string } = {}): Promise<Alert[]> {
    const params = new URLSearchParams();
    if (query.serverId) params.set('serverId', query.serverId);
    return this.fetch(`/api/alerts?${params}`);
  }
  async suppressAlert(id: number, until: number): Promise<void> {
    await this.fetch(`/api/alerts/${id}/suppress`, { method: 'POST', body: JSON.stringify({ until }) });
  }
  async unsuppressAlert(id: number): Promise<void> {
    await this.fetch(`/api/alerts/${id}/unsuppress`, { method: 'POST' });
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
  async login(password: string): Promise<{ token: string }> {
    const res = await window.fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
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

  async checkAuth(): Promise<{ authenticated: boolean }> {
    if (!this.token) return { authenticated: false };
    try {
      await this.fetch('/api/settings');
      return { authenticated: true };
    } catch {
      return { authenticated: false };
    }
  }
}