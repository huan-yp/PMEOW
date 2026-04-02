import { io, Socket } from 'socket.io-client';
import type { TransportAdapter } from './types.js';
import type {
  ServerConfig, ServerInput, MetricsSnapshot, ServerStatus,
  HookRule, HookRuleInput, HookLog, AppSettings, AlertEvent, AlertRecord,
} from '@monitor/core';

export class WebSocketAdapter implements TransportAdapter {
  private socket: Socket | null = null;
  private token: string | null = null;

  constructor() {
    this.token = localStorage.getItem('auth_token');
  }

  connect(): void {
    if (this.socket?.connected) return;
    this.socket = io({
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
  onMetricsUpdate(cb: (data: MetricsSnapshot) => void): () => void {
    this.socket?.on('metricsUpdate', cb);
    return () => { this.socket?.off('metricsUpdate', cb); };
  }

  onServerStatus(cb: (status: ServerStatus) => void): () => void {
    this.socket?.on('serverStatus', cb);
    return () => { this.socket?.off('serverStatus', cb); };
  }

  onAlert(cb: (alert: AlertEvent) => void): () => void {
    this.socket?.on('alert', cb);
    return () => { this.socket?.off('alert', cb); };
  }

  onHookTriggered(cb: (log: HookLog) => void): () => void {
    this.socket?.on('hookTriggered', cb);
    return () => { this.socket?.off('hookTriggered', cb); };
  }

  onNotify(cb: (title: string, body: string) => void): () => void {
    this.socket?.on('notify', (data: { title: string; body: string }) => cb(data.title, data.body));
    return () => { this.socket?.off('notify'); };
  }

  // REST helpers
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
    return res.json();
  }

  // Servers
  async getServers(): Promise<ServerConfig[]> {
    return this.fetch('/api/servers');
  }

  async addServer(input: ServerInput): Promise<ServerConfig> {
    return this.fetch('/api/servers', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updateServer(id: string, input: Partial<ServerInput>): Promise<ServerConfig> {
    return this.fetch(`/api/servers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  async deleteServer(id: string): Promise<boolean> {
    const res = await this.fetch<{ success: boolean }>(`/api/servers/${id}`, { method: 'DELETE' });
    return res.success;
  }

  async testConnection(input: ServerInput): Promise<{ success: boolean; error?: string }> {
    // testConnection on WebSocket uses existing server ID via POST to /api/servers/:id/test
    // But we may also get called with raw input for not-yet-saved servers
    return this.fetch('/api/servers/test', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  // Metrics
  async getLatestMetrics(serverId: string): Promise<MetricsSnapshot | null> {
    const all = await this.fetch<Record<string, MetricsSnapshot>>('/api/metrics/latest');
    return all[serverId] ?? null;
  }

  async getMetricsHistory(serverId: string, from: number, to: number): Promise<MetricsSnapshot[]> {
    const hours = Math.max(1, Math.ceil((to - from) / (3600 * 1000)));
    return this.fetch(`/api/metrics/${serverId}/history?hours=${hours}`);
  }

  async getServerStatuses(): Promise<ServerStatus[]> {
    return this.fetch('/api/statuses');
  }

  // Hooks
  async getHooks(): Promise<HookRule[]> {
    return this.fetch('/api/hooks');
  }

  async createHook(input: HookRuleInput): Promise<HookRule> {
    return this.fetch('/api/hooks', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updateHook(id: string, input: Partial<HookRuleInput>): Promise<HookRule> {
    return this.fetch(`/api/hooks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  async deleteHook(id: string): Promise<boolean> {
    const res = await this.fetch<{ success: boolean }>(`/api/hooks/${id}`, { method: 'DELETE' });
    return res.success;
  }

  async getHookLogs(hookId: string): Promise<HookLog[]> {
    return this.fetch(`/api/hooks/${hookId}/logs`);
  }

  async testHookAction(hookId: string): Promise<{ success: boolean; result?: string; error?: string }> {
    return this.fetch(`/api/hooks/${hookId}/test`, { method: 'POST' });
  }

  // Settings
  async getSettings(): Promise<AppSettings> {
    return this.fetch('/api/settings');
  }

  async saveSettings(settings: Partial<AppSettings>): Promise<void> {
    await this.fetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // Auth
  async login(password: string): Promise<{ success: boolean; token?: string; error?: string }> {
    try {
      const res = await window.fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        this.token = data.token;
        localStorage.setItem('auth_token', data.token);
        this.disconnect();
        this.connect();
        return { success: true, token: data.token };
      }
      return { success: false, error: data.error || '登录失败' };
    } catch {
      return { success: false, error: '网络错误' };
    }
  }

  async setPassword(password: string): Promise<{ success: boolean }> {
    return this.login(password);
  }

  async checkAuth(): Promise<{ authenticated: boolean; needsSetup: boolean }> {
    if (!this.token) return { authenticated: false, needsSetup: false };
    try {
      await this.fetch('/api/settings');
      return { authenticated: true, needsSetup: false };
    } catch {
      return { authenticated: false, needsSetup: false };
    }
  }

  // Alerts
  async getAlerts(limit = 50, offset = 0): Promise<AlertRecord[]> {
    return this.fetch(`/api/alerts?limit=${limit}&offset=${offset}`);
  }

  async suppressAlert(id: string, days?: number): Promise<void> {
    await this.fetch(`/api/alerts/${id}/suppress`, {
      method: 'POST',
      body: JSON.stringify({ days }),
    });
  }

  // Key upload
  async uploadKey(file: File): Promise<{ path: string }> {
    const formData = new FormData();
    formData.append('key', file);
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await window.fetch('/api/keys/upload', {
      method: 'POST',
      headers,
      body: formData,
    });
    if (res.status === 401) {
      localStorage.removeItem('auth_token');
      this.token = null;
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}
