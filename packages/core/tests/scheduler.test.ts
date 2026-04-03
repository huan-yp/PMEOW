import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDatabase } from '../src/db/database.js';
import { getMetricsHistory } from '../src/db/metrics.js';
import { saveGpuUsageRows } from '../src/db/gpu-usage.js';
import { createServer } from '../src/db/servers.js';
import { listServerStatusEvents } from '../src/db/server-status-events.js';
import { Scheduler } from '../src/scheduler.js';
import type { MetricsSnapshot, SecurityEventRecord, ServerStatus } from '../src/types.js';
import { AgentDataSource } from '../src/datasource/agent-datasource.js';

beforeEach(() => {
  getDatabase();
});

describe('Scheduler', () => {
  it('should expose getDataSource for a created server', () => {
    const server = createServer({
      name: 'test', host: '1.2.3.4', port: 22,
      username: 'root', privateKeyPath: '/tmp/key',
    });
    const scheduler = new Scheduler();
    scheduler.initDataSources();
    const ds = scheduler.getDataSource(server.id);
    expect(ds).toBeDefined();
    expect(ds!.type).toBe('ssh');
  });

  it('should handle Agent node metricsReceived event', async () => {
    const server = createServer({
      name: 'agent-node', host: 'gpu-01', port: 22,
      username: 'root', privateKeyPath: '/tmp/key',
      sourceType: 'agent', agentId: 'a1',
    });

    const scheduler = new Scheduler();
    scheduler.initDataSources();

    const ds = scheduler.getDataSource(server.id);
    expect(ds).toBeDefined();
    expect(ds!.type).toBe('agent');

    // Simulate Agent pushing metrics
    const received: MetricsSnapshot[] = [];
    scheduler.on('metricsUpdate', (snap: MetricsSnapshot) => {
      received.push(snap);
    });

    const fakeSnapshot = {
      serverId: server.id,
      timestamp: Date.now(),
      cpu: { usagePercent: 0, coreCount: 1, modelName: '', frequencyMhz: 0, perCoreUsage: [] } as any,
      memory: { totalMB: 0, usedMB: 0, availableMB: 0, usagePercent: 0, swapTotalMB: 0, swapUsedMB: 0, swapPercent: 0 } as any,
      disk: { disks: [], ioReadKBs: 0, ioWriteKBs: 0 } as any,
      network: {} as any,
      gpu: { available: false, totalMemoryMB: 0, usedMemoryMB: 0, memoryUsagePercent: 0, utilizationPercent: 0, temperatureC: 0, gpuCount: 0 } as any,
      processes: [],
      docker: [],
      system: {} as any,
    } satisfies MetricsSnapshot;

    (ds as AgentDataSource).pushMetrics(fakeSnapshot);

    // Give event loop a tick
    await new Promise(r => setTimeout(r, 10));

    expect(received.length).toBe(1);
    expect(received[0].serverId).toBe(server.id);
  });

  it('should not persist pushed agent metrics twice when collectServer is called', async () => {
    const server = createServer({
      name: 'agent-node', host: 'gpu-02', port: 22,
      username: 'root', privateKeyPath: '/tmp/key',
      sourceType: 'agent', agentId: 'a2',
    });

    const scheduler = new Scheduler();
    scheduler.initDataSources();

    const ds = scheduler.getDataSource(server.id);
    expect(ds).toBeInstanceOf(AgentDataSource);

    const snapshot = {
      serverId: server.id,
      timestamp: Date.now(),
      cpu: { usagePercent: 0, coreCount: 1, modelName: '', frequencyMhz: 0, perCoreUsage: [] } as any,
      memory: { totalMB: 0, usedMB: 0, availableMB: 0, usagePercent: 0, swapTotalMB: 0, swapUsedMB: 0, swapPercent: 0 } as any,
      disk: { disks: [], ioReadKBs: 0, ioWriteKBs: 0 } as any,
      network: {} as any,
      gpu: { available: false, totalMemoryMB: 0, usedMemoryMB: 0, memoryUsagePercent: 0, utilizationPercent: 0, temperatureC: 0, gpuCount: 0 } as any,
      processes: [],
      docker: [],
      system: {} as any,
    } satisfies MetricsSnapshot;

    (ds as AgentDataSource).pushMetrics(snapshot);
    await new Promise(r => setTimeout(r, 10));

    const firstHistory = getMetricsHistory(server.id, 0, Date.now());
    expect(firstHistory).toHaveLength(1);

    const collected = await scheduler.collectServer(server.id);
    const secondHistory = getMetricsHistory(server.id, 0, Date.now());

    expect(collected).toEqual(snapshot);
    expect(secondHistory).toHaveLength(1);
  });

  it('emits securityEvent for newly created security findings in the shared metrics pipeline', async () => {
    const server = createServer({
      name: 'agent-node', host: 'gpu-03', port: 22,
      username: 'root', privateKeyPath: '/tmp/key',
      sourceType: 'agent', agentId: 'a3',
    });

    const scheduler = new Scheduler();
    scheduler.initDataSources();

    const ds = scheduler.getDataSource(server.id);
    expect(ds).toBeInstanceOf(AgentDataSource);

    const events: SecurityEventRecord[] = [];
    scheduler.on('securityEvent', (event: SecurityEventRecord) => {
      events.push(event);
    });

    const snapshotTimestamp = Date.now();
    saveGpuUsageRows(server.id, snapshotTimestamp - 60_000, [
      {
        gpuIndex: 0,
        ownerType: 'unknown',
        pid: 202,
        command: 'xmrig --donate-level=1',
        userName: 'bob',
        usedMemoryMB: 1_024,
      },
    ]);

    const snapshot = {
      serverId: server.id,
      timestamp: snapshotTimestamp,
      cpu: { usagePercent: 12, coreCount: 1, modelName: '', frequencyMhz: 0, perCoreUsage: [] } as any,
      memory: { totalMB: 0, usedMB: 0, availableMB: 0, usagePercent: 0, swapTotalMB: 0, swapUsedMB: 0, swapPercent: 0 } as any,
      disk: { disks: [], ioReadKBs: 0, ioWriteKBs: 0 } as any,
      network: {} as any,
      gpu: { available: true, totalMemoryMB: 24_576, usedMemoryMB: 1_024, memoryUsagePercent: 4, utilizationPercent: 30, temperatureC: 60, gpuCount: 1 } as any,
      processes: [
        {
          pid: 202,
          user: 'bob',
          command: 'xmrig --donate-level=1',
          cpuPercent: 88,
          memPercent: 2.4,
          rss: 2_048,
        },
      ],
      docker: [],
      system: {} as any,
      gpuAllocation: {
        perGpu: [
          {
            gpuIndex: 0,
            totalMemoryMB: 24_576,
            pmeowTasks: [],
            userProcesses: [],
            unknownProcesses: [
              {
                pid: 202,
                gpuIndex: 0,
                usedMemoryMB: 1_024,
                command: 'xmrig --donate-level=1',
              },
            ],
            effectiveFreeMB: 23_552,
          },
        ],
        byUser: [],
      },
    } satisfies MetricsSnapshot;

    (ds as AgentDataSource).pushMetrics(snapshot);
    await new Promise(r => setTimeout(r, 10));

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.eventType)).toEqual(['suspicious_process', 'unowned_gpu']);
  });

  it('transitions agent status to connecting on session attach, then connected on metrics', async () => {
    const server = createServer({
      name: 'agent-status', host: 'gpu-status', port: 22,
      username: 'root', privateKeyPath: '/tmp/key',
      sourceType: 'agent', agentId: 'a-status',
    });

    const scheduler = new Scheduler();
    scheduler.initDataSources();
    const ds = scheduler.getDataSource(server.id) as AgentDataSource;

    const statuses: ServerStatus[] = [];
    scheduler.on('serverStatus', (s: ServerStatus) => statuses.push({ ...s }));

    // Attach session → should transition to connecting
    const session = { agentId: 'a-status', emitCommand: vi.fn() };
    ds.attachSession(session);
    await new Promise(r => setTimeout(r, 10));

    expect(statuses.length).toBeGreaterThanOrEqual(1);
    expect(statuses[0].status).toBe('connecting');

    // Push metrics → should transition to connected
    const snapshot = {
      serverId: server.id,
      timestamp: Date.now(),
      cpu: { usagePercent: 10, coreCount: 1, modelName: '', frequencyMhz: 0, perCoreUsage: [] } as any,
      memory: { totalMB: 0, usedMB: 0, availableMB: 0, usagePercent: 0, swapTotalMB: 0, swapUsedMB: 0, swapPercent: 0 } as any,
      disk: { disks: [], ioReadKBs: 0, ioWriteKBs: 0 } as any,
      network: {} as any,
      gpu: { available: false, totalMemoryMB: 0, usedMemoryMB: 0, memoryUsagePercent: 0, utilizationPercent: 0, temperatureC: 0, gpuCount: 0 } as any,
      processes: [],
      docker: [],
      system: {} as any,
    } satisfies MetricsSnapshot;

    ds.pushMetrics(snapshot);
    await new Promise(r => setTimeout(r, 10));

    // handleMetrics emits serverStatus after setting latestMetrics — check the last emission
    const connectedStatuses = statuses.filter(s => s.status === 'connected');
    expect(connectedStatuses.length).toBeGreaterThanOrEqual(1);
    const lastConnected = connectedStatuses[connectedStatuses.length - 1];
    expect(lastConnected.latestMetrics).toBeDefined();
  });

  it('persists status transitions to server_status_events table', async () => {
    const server = createServer({
      name: 'agent-events', host: 'gpu-events', port: 22,
      username: 'root', privateKeyPath: '/tmp/key',
      sourceType: 'agent', agentId: 'a-events',
    });

    const scheduler = new Scheduler();
    scheduler.initDataSources();
    const ds = scheduler.getDataSource(server.id) as AgentDataSource;

    const session = { agentId: 'a-events', emitCommand: vi.fn() };
    ds.attachSession(session);
    await new Promise(r => setTimeout(r, 10));

    const snapshot = {
      serverId: server.id,
      timestamp: Date.now(),
      cpu: { usagePercent: 0, coreCount: 1, modelName: '', frequencyMhz: 0, perCoreUsage: [] } as any,
      memory: { totalMB: 0, usedMB: 0, availableMB: 0, usagePercent: 0, swapTotalMB: 0, swapUsedMB: 0, swapPercent: 0 } as any,
      disk: { disks: [], ioReadKBs: 0, ioWriteKBs: 0 } as any,
      network: {} as any,
      gpu: { available: false, totalMemoryMB: 0, usedMemoryMB: 0, memoryUsagePercent: 0, utilizationPercent: 0, temperatureC: 0, gpuCount: 0 } as any,
      processes: [],
      docker: [],
      system: {} as any,
    } satisfies MetricsSnapshot;

    ds.pushMetrics(snapshot);
    await new Promise(r => setTimeout(r, 10));

    ds.detachSession(session, 'metrics_timeout');
    await new Promise(r => setTimeout(r, 10));

    const events = listServerStatusEvents({ serverId: server.id });
    expect(events.length).toBeGreaterThanOrEqual(2);

    const toStatuses = events.map(e => e.toStatus);
    expect(toStatuses).toContain('connecting');
    expect(toStatuses).toContain('disconnected');
  });

  it('preserves latestMetrics in status after agent disconnect', async () => {
    const server = createServer({
      name: 'agent-stale', host: 'gpu-stale', port: 22,
      username: 'root', privateKeyPath: '/tmp/key',
      sourceType: 'agent', agentId: 'a-stale',
    });

    const scheduler = new Scheduler();
    scheduler.initDataSources();
    const ds = scheduler.getDataSource(server.id) as AgentDataSource;

    const session = { agentId: 'a-stale', emitCommand: vi.fn() };
    ds.attachSession(session);
    await new Promise(r => setTimeout(r, 10));

    const snapshot = {
      serverId: server.id,
      timestamp: Date.now(),
      cpu: { usagePercent: 42, coreCount: 1, modelName: '', frequencyMhz: 0, perCoreUsage: [] } as any,
      memory: { totalMB: 0, usedMB: 0, availableMB: 0, usagePercent: 0, swapTotalMB: 0, swapUsedMB: 0, swapPercent: 0 } as any,
      disk: { disks: [], ioReadKBs: 0, ioWriteKBs: 0 } as any,
      network: {} as any,
      gpu: { available: false, totalMemoryMB: 0, usedMemoryMB: 0, memoryUsagePercent: 0, utilizationPercent: 0, temperatureC: 0, gpuCount: 0 } as any,
      processes: [],
      docker: [],
      system: {} as any,
    } satisfies MetricsSnapshot;

    ds.pushMetrics(snapshot);
    await new Promise(r => setTimeout(r, 10));

    const preDisconnect = scheduler.getServerStatus(server.id);
    expect(preDisconnect?.latestMetrics?.cpu.usagePercent).toBe(42);
    const lastSeenBefore = preDisconnect?.lastSeen;

    ds.detachSession(session, 'metrics_timeout');
    await new Promise(r => setTimeout(r, 10));

    const postDisconnect = scheduler.getServerStatus(server.id);
    expect(postDisconnect?.status).toBe('disconnected');
    // latestMetrics and lastSeen should be preserved, not cleared
    expect(postDisconnect?.latestMetrics?.cpu.usagePercent).toBe(42);
    expect(postDisconnect?.lastSeen).toBe(lastSeenBefore);
  });

  it('does not persist duplicate status transitions', async () => {
    const server = createServer({
      name: 'agent-dedup', host: 'gpu-dedup', port: 22,
      username: 'root', privateKeyPath: '/tmp/key',
      sourceType: 'agent', agentId: 'a-dedup',
    });

    const scheduler = new Scheduler();
    scheduler.initDataSources();
    const ds = scheduler.getDataSource(server.id) as AgentDataSource;

    const statuses: ServerStatus[] = [];
    scheduler.on('serverStatus', (s: ServerStatus) => statuses.push({ ...s }));

    // Push two metrics — should only emit connected once
    const makeSnapshot = (): MetricsSnapshot => ({
      serverId: server.id,
      timestamp: Date.now(),
      cpu: { usagePercent: 0, coreCount: 1, modelName: '', frequencyMhz: 0, perCoreUsage: [] } as any,
      memory: { totalMB: 0, usedMB: 0, availableMB: 0, usagePercent: 0, swapTotalMB: 0, swapUsedMB: 0, swapPercent: 0 } as any,
      disk: { disks: [], ioReadKBs: 0, ioWriteKBs: 0 } as any,
      network: {} as any,
      gpu: { available: false, totalMemoryMB: 0, usedMemoryMB: 0, memoryUsagePercent: 0, utilizationPercent: 0, temperatureC: 0, gpuCount: 0 } as any,
      processes: [],
      docker: [],
      system: {} as any,
    });

    ds.pushMetrics(makeSnapshot());
    ds.pushMetrics(makeSnapshot());
    await new Promise(r => setTimeout(r, 10));

    // updateAgentStatus de-dups: connected→connected is no-op transition
    const connectedEmits = statuses.filter(s => s.status === 'connected');
    // First pushMetrics transitions disconnected→connected, emits twice (once for transition + once for metrics update)
    // Second pushMetrics only emits for metrics update (already connected, no transition)
    const events = listServerStatusEvents({ serverId: server.id });
    const connectedTransitions = events.filter(e => e.toStatus === 'connected');
    expect(connectedTransitions).toHaveLength(1);
  });
});
