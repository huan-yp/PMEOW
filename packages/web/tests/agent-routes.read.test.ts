import {
  Scheduler,
  closeDatabase,
  createServer,
  getLatestGpuUsageByServerId,
  getLatestMetrics,
  type GpuAllocationSummary,
  type MetricsSnapshot,
} from '@monitor/core';
import request from 'supertest';
import { io as createClient, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { createWebRuntime, type WebRuntime } from '../src/app.js';

process.env.MONITOR_DB_PATH = ':memory:';

const runtimes: WebRuntime[] = [];
const clients: Socket[] = [];

function trackRuntime(runtime: WebRuntime): WebRuntime {
  runtimes.push(runtime);
  return runtime;
}

function trackClient(client: Socket): Socket {
  clients.push(client);
  return client;
}

async function waitForCondition(
  assertion: () => void | Promise<void>,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 1_000;
  const intervalMs = options.intervalMs ?? 10;
  const startedAt = Date.now();

  while (true) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

async function startRuntime(): Promise<{ runtime: WebRuntime; baseUrl: string }> {
  const runtime = trackRuntime(createWebRuntime({
    port: 0,
    scheduler: new Scheduler(),
  }));
  const port = await runtime.start(0);

  return {
    runtime,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

async function connectAgent(baseUrl: string): Promise<Socket> {
  const client = trackClient(createClient(`${baseUrl}/agent`, {
    autoConnect: false,
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  }));

  const connected = new Promise<void>((resolve, reject) => {
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      client.off('connect', onConnect);
      client.off('connect_error', onError);
    };

    client.on('connect', onConnect);
    client.on('connect_error', onError);
  });

  client.connect();
  await connected;

  return client;
}

async function login(baseUrl: string): Promise<string> {
  const response = await request(baseUrl)
    .post('/api/login')
    .send({ password: 'test-password' });

  expect(response.status).toBe(200);
  expect(response.body.token).toEqual(expect.any(String));
  return response.body.token as string;
}

function createGpuAllocation(taskId = 'task-1', user = 'alice'): GpuAllocationSummary {
  return {
    perGpu: [
      {
        gpuIndex: 0,
        totalMemoryMB: 24_576,
        pmeowTasks: [
          {
            taskId,
            gpuIndex: 0,
            declaredVramMB: 8_192,
            actualVramMB: 6_144,
          },
        ],
        userProcesses: [
          {
            pid: 2_201,
            user,
            gpuIndex: 0,
            usedMemoryMB: 1_024,
            command: 'python job.py',
          },
        ],
        unknownProcesses: [
          {
            pid: 991,
            gpuIndex: 0,
            usedMemoryMB: 512,
          },
        ],
        effectiveFreeMB: 16_896,
      },
    ],
    byUser: [
      {
        user,
        totalVramMB: 7_168,
        gpuIndices: [0],
      },
    ],
  };
}

function createSnapshot(serverId: string, overrides: Partial<MetricsSnapshot> = {}): MetricsSnapshot {
  return {
    serverId,
    timestamp: 1_000,
    cpu: {
      usagePercent: 42,
      coreCount: 16,
      modelName: 'Threadripper',
      frequencyMhz: 3_600,
      perCoreUsage: [41, 43],
    },
    memory: {
      totalMB: 65_536,
      usedMB: 32_768,
      availableMB: 32_768,
      usagePercent: 50,
      swapTotalMB: 8_192,
      swapUsedMB: 0,
      swapPercent: 0,
    },
    disk: {
      disks: [],
      ioReadKBs: 0,
      ioWriteKBs: 0,
    },
    network: {
      rxBytesPerSec: 0,
      txBytesPerSec: 0,
      interfaces: [],
    },
    gpu: {
      available: true,
      totalMemoryMB: 24_576,
      usedMemoryMB: 6_144,
      memoryUsagePercent: 25,
      utilizationPercent: 60,
      temperatureC: 55,
      gpuCount: 1,
    },
    processes: [],
    docker: [],
    system: {
      hostname: 'gpu-node',
      uptime: '1 day',
      loadAvg1: 0.1,
      loadAvg5: 0.2,
      loadAvg15: 0.3,
      kernelVersion: '6.8.0',
    },
    ...overrides,
  };
}

function expectedGpuUsageRows(serverId: string, timestamp: number, taskId = 'task-1', user = 'alice') {
  return [
    {
      id: expect.any(Number),
      serverId,
      timestamp,
      gpuIndex: 0,
      ownerType: 'task',
      ownerId: taskId,
      userName: undefined,
      taskId,
      pid: undefined,
      command: undefined,
      usedMemoryMB: 6_144,
      declaredVramMB: 8_192,
    },
    {
      id: expect.any(Number),
      serverId,
      timestamp,
      gpuIndex: 0,
      ownerType: 'user',
      ownerId: user,
      userName: user,
      taskId: undefined,
      pid: 2_201,
      command: 'python job.py',
      usedMemoryMB: 1_024,
      declaredVramMB: undefined,
    },
    {
      id: expect.any(Number),
      serverId,
      timestamp,
      gpuIndex: 0,
      ownerType: 'unknown',
      ownerId: undefined,
      userName: undefined,
      taskId: undefined,
      pid: 991,
      command: undefined,
      usedMemoryMB: 512,
      declaredVramMB: undefined,
    },
  ];
}

afterEach(async () => {
  while (clients.length > 0) {
    const client = clients.pop();
    if (client) {
      client.disconnect();
    }
  }

  while (runtimes.length > 0) {
    const runtime = runtimes.pop();
    if (runtime) {
      await runtime.stop();
    }
  }

  closeDatabase();
});

describe('agent read routes', () => {
  it('metrics ingress preserves gpuAllocation and normalizes the bound serverId', async () => {
    const { baseUrl } = await startRuntime();
    const server = createServer({
      name: 'gpu-metrics',
      host: 'gpu-metrics',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-metrics',
    });
    const client = await connectAgent(baseUrl);
    const gpuAllocation = createGpuAllocation();
    const incomingSnapshot = createSnapshot('wrong-server-id', {
      timestamp: 1_111,
      gpuAllocation,
    });

    client.emit('agent:register', {
      agentId: 'agent-metrics',
      hostname: 'gpu-metrics',
      version: '1.0.0',
    });
    client.emit('agent:metrics', incomingSnapshot);

    await waitForCondition(() => {
      expect(getLatestMetrics(server.id)).toEqual({
        ...incomingSnapshot,
        serverId: server.id,
      });
      expect(getLatestGpuUsageByServerId(server.id)).toEqual(
        expectedGpuUsageRows(server.id, incomingSnapshot.timestamp),
      );
    });
  });

  it('task update ingress feeds the mirrored task read APIs', async () => {
    const { baseUrl } = await startRuntime();
    const token = await login(baseUrl);
    const api = request(baseUrl);
    const server = createServer({
      name: 'gpu-tasks',
      host: 'gpu-tasks',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-tasks',
    });
    const otherServer = createServer({
      name: 'gpu-other',
      host: 'gpu-other',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
    });
    const client = await connectAgent(baseUrl);

    client.emit('agent:register', {
      agentId: 'agent-tasks',
      hostname: 'gpu-tasks',
      version: '1.0.0',
    });

    const emptyListResponse = await api
      .get(`/api/servers/${server.id}/tasks`)
      .set('Authorization', `Bearer ${token}`);

    expect(emptyListResponse.status).toBe(200);
    expect(emptyListResponse.body).toEqual([]);

    client.emit('agent:taskUpdate', {
      taskId: 'task-1',
      status: 'queued',
      command: 'python train.py',
      cwd: '/srv/jobs/train',
      user: 'alice',
      requireVramMB: 8_192,
      requireGpuCount: 1,
      gpuIds: [0],
      priority: 7,
      createdAt: 900,
    });

    await waitForCondition(async () => {
      const listResponse = await api
        .get(`/api/servers/${server.id}/tasks`)
        .set('Authorization', `Bearer ${token}`);

      expect(listResponse.status).toBe(200);
      expect(listResponse.body).toEqual([
        {
          serverId: server.id,
          taskId: 'task-1',
          status: 'queued',
          command: 'python train.py',
          cwd: '/srv/jobs/train',
          user: 'alice',
          requireVramMB: 8_192,
          requireGpuCount: 1,
          gpuIds: [0],
          priority: 7,
          createdAt: 900,
          startedAt: null,
          finishedAt: null,
          exitCode: null,
          pid: null,
        },
      ]);

      const taskResponse = await api
        .get(`/api/servers/${server.id}/tasks/task-1`)
        .set('Authorization', `Bearer ${token}`);

      expect(taskResponse.status).toBe(200);
      expect(taskResponse.body).toEqual(listResponse.body[0]);
    });

    const wrongServerResponse = await api
      .get(`/api/servers/${otherServer.id}/tasks/task-1`)
      .set('Authorization', `Bearer ${token}`);
    const missingServerResponse = await api
      .get('/api/servers/missing-server/tasks')
      .set('Authorization', `Bearer ${token}`);

    expect(wrongServerResponse.status).toBe(404);
    expect(missingServerResponse.status).toBe(404);
  });

  it('gpu allocation endpoint returns the latest mirrored allocation', async () => {
    const { baseUrl } = await startRuntime();
    const token = await login(baseUrl);
    const api = request(baseUrl);
    const server = createServer({
      name: 'gpu-allocation',
      host: 'gpu-allocation',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-allocation',
    });
    const client = await connectAgent(baseUrl);
    const olderAllocation = createGpuAllocation('task-old', 'alice');
    const latestAllocation = createGpuAllocation('task-new', 'bob');

    client.emit('agent:register', {
      agentId: 'agent-allocation',
      hostname: 'gpu-allocation',
      version: '1.0.0',
    });
    client.emit('agent:metrics', createSnapshot(server.id, {
      timestamp: 1_000,
      gpuAllocation: olderAllocation,
    }));
    client.emit('agent:metrics', createSnapshot(server.id, {
      timestamp: 2_000,
      gpuAllocation: latestAllocation,
    }));

    await waitForCondition(async () => {
      const response = await api
        .get(`/api/servers/${server.id}/gpu-allocation`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(latestAllocation);
    });

    const missingServerResponse = await api
      .get('/api/servers/missing-server/gpu-allocation')
      .set('Authorization', `Bearer ${token}`);

    expect(missingServerResponse.status).toBe(404);
  });

  it('disconnect does not erase persisted read state', async () => {
    const { runtime, baseUrl } = await startRuntime();
    const token = await login(baseUrl);
    const api = request(baseUrl);
    const server = createServer({
      name: 'gpu-disconnect-read',
      host: 'gpu-disconnect-read',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-disconnect-read',
    });
    const client = await connectAgent(baseUrl);
    const gpuAllocation = createGpuAllocation();

    client.emit('agent:register', {
      agentId: 'agent-disconnect-read',
      hostname: 'gpu-disconnect-read',
      version: '1.0.0',
    });
    client.emit('agent:metrics', createSnapshot(server.id, {
      timestamp: 3_000,
      gpuAllocation,
    }));
    client.emit('agent:taskUpdate', {
      taskId: 'task-disconnect',
      status: 'running',
      startedAt: 3_100,
      pid: 4_321,
    });

    await waitForCondition(async () => {
      const tasksResponse = await api
        .get(`/api/servers/${server.id}/tasks`)
        .set('Authorization', `Bearer ${token}`);
      const gpuResponse = await api
        .get(`/api/servers/${server.id}/gpu-allocation`)
        .set('Authorization', `Bearer ${token}`);

      expect(tasksResponse.status).toBe(200);
      expect(tasksResponse.body).toEqual([
        {
          serverId: server.id,
          taskId: 'task-disconnect',
          status: 'running',
          gpuIds: null,
          startedAt: 3_100,
          finishedAt: null,
          exitCode: null,
          pid: 4_321,
        },
      ]);
      expect(gpuResponse.status).toBe(200);
      expect(gpuResponse.body).toEqual(gpuAllocation);
    });

    client.disconnect();

    await waitForCondition(() => {
      expect(runtime.agentRegistry.getSession('agent-disconnect-read')).toBeUndefined();
    });

    const tasksAfterDisconnect = await api
      .get(`/api/servers/${server.id}/tasks`)
      .set('Authorization', `Bearer ${token}`);
    const gpuAfterDisconnect = await api
      .get(`/api/servers/${server.id}/gpu-allocation`)
      .set('Authorization', `Bearer ${token}`);

    expect(tasksAfterDisconnect.status).toBe(200);
    expect(tasksAfterDisconnect.body).toEqual([
      {
        serverId: server.id,
        taskId: 'task-disconnect',
        status: 'running',
        gpuIds: null,
        startedAt: 3_100,
        finishedAt: null,
        exitCode: null,
        pid: 4_321,
      },
    ]);
    expect(gpuAfterDisconnect.status).toBe(200);
    expect(gpuAfterDisconnect.body).toEqual(gpuAllocation);
  });

  it('metrics without gpuAllocation still persist successfully', async () => {
    const { baseUrl } = await startRuntime();
    const token = await login(baseUrl);
    const api = request(baseUrl);
    const server = createServer({
      name: 'gpu-no-allocation',
      host: 'gpu-no-allocation',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-no-allocation',
    });
    const client = await connectAgent(baseUrl);
    const snapshot = createSnapshot(server.id, {
      timestamp: 4_000,
    });

    client.emit('agent:register', {
      agentId: 'agent-no-allocation',
      hostname: 'gpu-no-allocation',
      version: '1.0.0',
    });
    client.emit('agent:metrics', snapshot);

    await waitForCondition(() => {
      expect(getLatestMetrics(server.id)).toEqual(snapshot);
      expect(getLatestGpuUsageByServerId(server.id)).toEqual([]);
    });

    const response = await api
      .get(`/api/servers/${server.id}/gpu-allocation`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
  });
});