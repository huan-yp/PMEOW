import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDatabase } from '../src/db/database.js';
import { getMetricsHistory } from '../src/db/metrics.js';
import { saveGpuUsageRows } from '../src/db/gpu-usage.js';
import { createServer } from '../src/db/servers.js';
import { Scheduler } from '../src/scheduler.js';
import type { MetricsSnapshot, SecurityEventRecord } from '../src/types.js';
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
});
