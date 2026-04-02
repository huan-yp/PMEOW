import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDatabase } from '../src/db/database.js';
import { getMetricsHistory } from '../src/db/metrics.js';
import { createServer } from '../src/db/servers.js';
import { Scheduler } from '../src/scheduler.js';
import type { MetricsSnapshot } from '../src/types.js';
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
});
