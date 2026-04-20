import {
  API_PATHS,
  type Alert,
  type AlertQuery,
  type AuthSession,
  type LoginCredentials,
  type LoginResult,
  type SecurityEvent,
  type Server,
  type ServerStatus,
  type SnapshotWithGpu,
  type Task,
  type UnifiedReport,
} from '@pmeow/app-common';

export interface TaskQuery {
  page?: number;
  limit?: number;
  serverId?: string;
  status?: Task['status'];
  user?: string;
}

export class MobileApiError extends Error {
  status?: number;
  details?: unknown;
  requestUrl?: string;
  requestMethod?: string;
}

const DEFAULT_WEB_PORT = '17200';
const BASE_URL_PATTERN = /^([a-z][a-z0-9+.-]*:\/\/)(\[[^\]]+\]|[^/?#:]+)(:\d+)?([/?#].*)?$/iu;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//iu;

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return '';
  }

  const normalized = URL_SCHEME_PATTERN.test(trimmed) ? trimmed : `http://${trimmed}`;

  if (!URL_SCHEME_PATTERN.test(trimmed)) {
    console.info(`[mobile][api] No URL scheme provided, assuming ${normalized}`);
  }

  const matched = normalized.match(BASE_URL_PATTERN);
  if (!matched) {
    return normalized;
  }

  const [, protocol, host, port, suffix = ''] = matched;
  return `${protocol}${host}${port ?? `:${DEFAULT_WEB_PORT}`}${suffix}`;
}

function joinBaseUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}${path}`;
}

function buildQueryString(params: Array<[string, string | number | boolean | undefined]>): string {
  const entries = params
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);

  return entries.length > 0 ? `?${entries.join('&')}` : '';
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = new MobileApiError(`HTTP ${response.status}`);
    error.status = response.status;

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const data = await response.json().catch(() => undefined);
      error.details = data;
      if (data && typeof data === 'object') {
        const record = data as Record<string, unknown>;
        if (typeof record.message === 'string') {
          error.message = record.message;
        } else if (typeof record.error === 'string') {
          error.message = record.error;
        }
      }
    } else {
      const text = await response.text().catch(() => '');
      if (text) {
        error.message = text;
      }
    }

    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function formatMobileApiError(error: unknown): string {
  if (error instanceof MobileApiError || error instanceof Error) {
    return error.message;
  }
  return '请求失败';
}

function describeUnknownError(error: unknown): string {
  if (error instanceof MobileApiError) {
    const requestLabel = error.requestMethod && error.requestUrl
      ? ` ${error.requestMethod} ${error.requestUrl}`
      : '';
    return `${error.message}${requestLabel}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export class MobileApiClient {
  private readonly baseUrl: string;
  private token: string | null;

  constructor(baseUrl: string, token: string | null = null) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = token;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers = new Headers(options?.headers ?? {});
    if (!headers.has('Content-Type') && options?.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }
    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const requestUrl = joinBaseUrl(this.baseUrl, path);
    const requestMethod = options?.method ?? 'GET';
    console.info(
      `[mobile][api] ${requestMethod} ${requestUrl} auth=${this.token ? 'bearer' : 'none'} body=${options?.body !== undefined ? 'yes' : 'no'}`
    );

    let response: Response;

    try {
      response = await fetch(requestUrl, {
        ...options,
        headers,
      });
    } catch (error) {
      const wrappedError = new MobileApiError(error instanceof Error ? error.message : '请求失败');
      wrappedError.requestUrl = requestUrl;
      wrappedError.requestMethod = requestMethod;
      console.warn(`[mobile][api] request failed: ${describeUnknownError(wrappedError)}`);
      throw wrappedError;
    }

    console.info(`[mobile][api] response ${requestMethod} ${requestUrl} -> ${response.status}`);

    try {
      return await parseResponse<T>(response);
    } catch (error) {
      if (error instanceof MobileApiError) {
        error.requestUrl = requestUrl;
        error.requestMethod = requestMethod;
      }
      console.warn(`[mobile][api] response parse failed: ${describeUnknownError(error)}`);
      throw error;
    }
  }

  async login(credentials: LoginCredentials): Promise<LoginResult> {
    const result = await this.request<LoginResult>(API_PATHS.login, {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    this.token = result.token;
    return result;
  }

  async checkAuth(): Promise<AuthSession> {
    if (!this.token) {
      return {
        authenticated: false,
        principal: null,
        person: null,
        accessibleServerIds: null,
      };
    }

    try {
      return await this.request<AuthSession>(API_PATHS.sessionMe);
    } catch (error) {
      if (error instanceof MobileApiError && error.status === 401) {
        this.token = null;
        return {
          authenticated: false,
          principal: null,
          person: null,
          accessibleServerIds: null,
        };
      }
      throw error;
    }
  }

  async getServers(): Promise<Server[]> {
    return this.request<Server[]>(API_PATHS.servers);
  }

  async getStatuses(): Promise<Record<string, ServerStatus>> {
    return this.request<Record<string, ServerStatus>>(API_PATHS.statuses);
  }

  async getLatestMetrics(): Promise<Record<string, UnifiedReport>> {
    return this.request<Record<string, UnifiedReport>>(API_PATHS.latestMetrics);
  }

  async getMetricsHistory(
    serverId: string,
    query: { from?: number; to?: number; tier?: 'recent' | 'archive' } = {},
  ): Promise<{ snapshots: SnapshotWithGpu[] }> {
    const suffix = buildQueryString([
      ['from', query.from],
      ['to', query.to],
      ['tier', query.tier],
    ]);
    const snapshots = await this.request<SnapshotWithGpu[]>(`${API_PATHS.metricsHistory(serverId)}${suffix}`);
    return { snapshots };
  }

  async getPersonTasks(personId: string, query: { page?: number; limit?: number } = {}): Promise<{ tasks: Task[]; total: number }> {
    const suffix = buildQueryString([
      ['page', query.page],
      ['limit', query.limit],
    ]);
    return this.request<{ tasks: Task[]; total: number }>(`${API_PATHS.personTasks(personId)}${suffix}`);
  }

  async getTasks(query: TaskQuery = {}): Promise<{ tasks: Task[]; total: number }> {
    const suffix = buildQueryString([
      ['page', query.page],
      ['limit', query.limit],
      ['serverId', query.serverId],
      ['status', query.status],
      ['user', query.user],
    ]);
    return this.request<{ tasks: Task[]; total: number }>(`${API_PATHS.tasks}${suffix}`);
  }

  async getTask(taskId: string): Promise<Task> {
    return this.request<Task>(API_PATHS.task(taskId));
  }

  async getAlerts(query: AlertQuery = {}): Promise<Alert[]> {
    const suffix = buildQueryString([
      ['serverId', query.serverId],
      ['status', query.status],
      ['limit', query.limit],
      ['offset', query.offset],
    ]);
    return this.request<Alert[]>(`${API_PATHS.alerts}${suffix}`);
  }

  async getSecurityEvents(query: { serverId?: string; resolved?: boolean; limit?: number } = {}): Promise<SecurityEvent[]> {
    const suffix = buildQueryString([
      ['serverId', query.serverId],
      ['resolved', query.resolved],
      ['limit', query.limit],
    ]);
    return this.request<SecurityEvent[]>(`${API_PATHS.securityEvents}${suffix}`);
  }

  async cancelTask(serverId: string, taskId: string): Promise<void> {
    await this.request<void>(API_PATHS.cancelTask(serverId, taskId), {
      method: 'POST',
    });
  }
}
