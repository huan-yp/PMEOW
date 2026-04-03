import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  AgentTaskQueueGroup,
  AlertEvent,
  AlertRecord,
  AppSettings,
  GpuOverviewResponse,
  GpuUsageSummaryItem,
  HookLog,
  HookRule,
  HookRuleInput,
  MetricsSnapshot,
  ProcessAuditRow,
  SecurityEventRecord,
  ServerConfig,
  ServerInput,
  ServerStatus,
  PersonRecord,
  PersonBindingRecord,
  PersonBindingSuggestion,
  PersonSummaryItem,
  PersonTimelinePoint,
  ServerPersonActivity,
  MirroredAgentTaskRecord,
} from '@monitor/core';
import { DEFAULT_SETTINGS } from '@monitor/core';
import { TransportProvider } from '../src/transport/TransportProvider.js';
import type { SecurityEventQuery, TransportAdapter } from '../src/transport/types.js';
import { PeopleOverview } from '../src/pages/PeopleOverview.js';
import { PeopleManage } from '../src/pages/PeopleManage.js';
import { PersonDetail } from '../src/pages/PersonDetail.js';

function createMockTransport(): TransportAdapter {
  return {
    isElectron: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMetricsUpdate: vi.fn(() => () => undefined),
    onServerStatus: vi.fn(() => () => undefined),
    onAlert: vi.fn((_cb: (alert: AlertEvent) => void) => () => undefined),
    onHookTriggered: vi.fn((_cb: (log: HookLog) => void) => () => undefined),
    onNotify: vi.fn((_cb: (title: string, body: string) => void) => () => undefined),
    onTaskUpdate: vi.fn(() => () => undefined),
    onSecurityEvent: vi.fn(() => () => undefined),
    getServers: vi.fn<() => Promise<ServerConfig[]>>(async () => []),
    addServer: vi.fn<(input: ServerInput) => Promise<ServerConfig>>(async (_input) => ({ id: 's1', name: 's', host: 'h', port: 22, username: 'u', privateKeyPath: '', sourceType: 'ssh', createdAt: 1, updatedAt: 1 }) as ServerConfig),
    updateServer: vi.fn<(id: string, input: Partial<ServerInput>) => Promise<ServerConfig>>(async (_id, _input) => ({ id: 's1', name: 's', host: 'h', port: 22, username: 'u', privateKeyPath: '', sourceType: 'ssh', createdAt: 1, updatedAt: 1 }) as ServerConfig),
    deleteServer: vi.fn<(id: string) => Promise<boolean>>(async (_id) => true),
    testConnection: vi.fn<(input: ServerInput) => Promise<{ success: boolean; error?: string }>>(async (_input) => ({ success: true })),
    getLatestMetrics: vi.fn<(serverId: string) => Promise<MetricsSnapshot | null>>(async (_serverId) => null),
    getMetricsHistory: vi.fn<(serverId: string, from: number, to: number) => Promise<MetricsSnapshot[]>>(async () => []),
    getServerStatuses: vi.fn<() => Promise<ServerStatus[]>>(async () => []),
    getHooks: vi.fn<() => Promise<HookRule[]>>(async () => []),
    createHook: vi.fn<(input: HookRuleInput) => Promise<HookRule>>(async (_input) => { throw new Error('not implemented'); }),
    updateHook: vi.fn<(id: string, input: Partial<HookRuleInput>) => Promise<HookRule>>(async () => { throw new Error('not implemented'); }),
    deleteHook: vi.fn<(id: string) => Promise<boolean>>(async (_id) => true),
    getHookLogs: vi.fn<(hookId: string) => Promise<HookLog[]>>(async (_hookId) => []),
    testHookAction: vi.fn<(hookId: string) => Promise<{ success: boolean; result?: string; error?: string }>>(async (_hookId) => ({ success: true })),
    getSettings: vi.fn<() => Promise<AppSettings>>(async () => DEFAULT_SETTINGS),
    saveSettings: vi.fn<(settings: Partial<AppSettings>) => Promise<void>>(async () => undefined),
    login: vi.fn<(password: string) => Promise<{ success: boolean; token?: string; error?: string }>>(async () => ({ success: true, token: 'token' })),
    setPassword: vi.fn<(password: string) => Promise<{ success: boolean }>>(async () => ({ success: true })),
    checkAuth: vi.fn<() => Promise<{ authenticated: boolean; needsSetup: boolean }>>(async () => ({ authenticated: true, needsSetup: false })),
    getAlerts: vi.fn<(limit?: number, offset?: number) => Promise<AlertRecord[]>>(async () => []),
    suppressAlert: vi.fn<(id: string, days?: number) => Promise<void>>(async () => undefined),
    getTaskQueue: vi.fn<() => Promise<AgentTaskQueueGroup[]>>(async () => []),
    getProcessAudit: vi.fn<(serverId: string) => Promise<ProcessAuditRow[]>>(async () => []),
    getSecurityEvents: vi.fn<(query?: SecurityEventQuery) => Promise<SecurityEventRecord[]>>(async () => []),
    markSecurityEventSafe: vi.fn<(id: number, reason?: string) => Promise<{ resolvedEvent: SecurityEventRecord; auditEvent?: SecurityEventRecord }>>(async () => { throw new Error('not implemented'); }),
    getGpuOverview: vi.fn<() => Promise<GpuOverviewResponse>>(async () => ({ generatedAt: 1, users: [], servers: [] })),
    getGpuUsageSummary: vi.fn<(hours?: number) => Promise<GpuUsageSummaryItem[]>>(async () => []),
    getGpuUsageByUser: vi.fn(async () => []),
    cancelTask: vi.fn<(serverId: string, taskId: string) => Promise<void>>(async () => undefined),
    setTaskPriority: vi.fn<(serverId: string, taskId: string, priority: number) => Promise<void>>(async () => undefined),
    pauseQueue: vi.fn<(serverId: string) => Promise<void>>(async () => undefined),
    resumeQueue: vi.fn<(serverId: string) => Promise<void>>(async () => undefined),
    uploadKey: vi.fn<(file: File) => Promise<{ path: string }>>(async () => ({ path: '/tmp/key' })),
    getPersons: vi.fn(async () => [{ id: 'person-1', displayName: 'Alice', email: 'alice@example.com', qq: '', note: '', customFields: {}, status: 'active' as const, createdAt: 1, updatedAt: 1 }]),
    createPerson: vi.fn(async (input: { displayName: string; email?: string; qq?: string; note?: string; customFields: Record<string, string> }) => ({ id: 'person-2', status: 'active' as const, createdAt: 2, updatedAt: 2, displayName: input.displayName, email: input.email ?? '', qq: input.qq ?? '', note: input.note ?? '', customFields: input.customFields })),
    updatePerson: vi.fn(async (id: string, input: Partial<{ displayName: string; email: string; qq: string; note: string; customFields: Record<string, string> }>) => ({ id, displayName: 'Alice', email: '', qq: '', note: '', customFields: {}, status: 'active' as const, createdAt: 1, updatedAt: 2, ...input })),
    getPersonBindings: vi.fn(async () => []),
    createPersonBinding: vi.fn(async (input: { personId: string; serverId: string; systemUser: string; source: string; effectiveFrom: number }) => ({ id: 'binding-1', enabled: true, effectiveTo: null, createdAt: 1, updatedAt: 1, ...input })),
    updatePersonBinding: vi.fn(async (id: string, input: Partial<{ enabled: boolean; effectiveTo: number | null }>) => ({ id, personId: 'person-1', serverId: 'server-1', systemUser: 'alice', source: 'manual', enabled: true, effectiveFrom: 1, effectiveTo: null, createdAt: 1, updatedAt: 2, ...input })),
    getPersonBindingSuggestions: vi.fn(async () => []),
    getPersonSummary: vi.fn(async () => [{ personId: 'person-1', displayName: 'Alice', currentVramMB: 4096, runningTaskCount: 1, queuedTaskCount: 0, activeServerCount: 1, lastActivityAt: Date.now(), vramOccupancyHours: 2, vramGigabyteHours: 8, taskRuntimeHours: 1.5 }]),
    getPersonTimeline: vi.fn(async () => []),
    getPersonTasks: vi.fn(async () => []),
    getServerPersonActivity: vi.fn(async () => ({ serverId: 'server-1', people: [], unassignedVramMB: 0, unassignedUsers: [] })),
    getResolvedGpuAllocation: vi.fn(async () => null),
  };
}

describe('person pages', () => {
  it('renders person overview with summary data', async () => {
    render(
      <TransportProvider adapter={createMockTransport()}>
        <MemoryRouter initialEntries={['/people']}>
          <Routes>
            <Route path="/people" element={<PeopleOverview />} />
          </Routes>
        </MemoryRouter>
      </TransportProvider>
    );
    expect(await screen.findByText('Alice')).toBeTruthy();
    expect(await screen.findByText(/4096 MB/)).toBeTruthy();
  });

  it('renders person management list', async () => {
    render(
      <TransportProvider adapter={createMockTransport()}>
        <MemoryRouter initialEntries={['/people/manage']}>
          <Routes>
            <Route path="/people/manage" element={<PeopleManage />} />
          </Routes>
        </MemoryRouter>
      </TransportProvider>
    );
    expect(await screen.findByText('人员管理')).toBeTruthy();
    expect(await screen.findByText('Alice')).toBeTruthy();
  });

  it('renders person detail page', async () => {
    render(
      <TransportProvider adapter={createMockTransport()}>
        <MemoryRouter initialEntries={['/people/person-1']}>
          <Routes>
            <Route path="/people/:id" element={<PersonDetail />} />
          </Routes>
        </MemoryRouter>
      </TransportProvider>
    );
    expect(await screen.findByText('Alice')).toBeTruthy();
  });
});
