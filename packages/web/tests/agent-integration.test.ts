import { randomUUID } from 'node:crypto';
import {
  AgentDataSource,
  SERVER_COMMAND,
  createServer,
  getLatestGpuUsageByServerId,
  getLatestMetrics,
  getServerById,
  type GpuAllocationSummary,
  type MetricsSnapshot,
} from '@monitor/core';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { WebRuntime } from '../src/app.js';
import { AgentTestStub, login, startTestRuntime, waitForCondition } from './setup.js';

const DEFAULT_TIMESTAMP_MS = 1_700_000_000_000;

function createUniqueHost(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function getAgentDataSource(runtime: WebRuntime, serverId: string): AgentDataSource {
  runtime.scheduler.refreshServerDataSource(serverId);

  const dataSource = runtime.scheduler.getDataSource(serverId);
  expect(dataSource).toBeInstanceOf(AgentDataSource);
  return dataSource as AgentDataSource;
}

function createGpuAllocation(options: {
  taskId: string;
  user: string;
  actualVramMB: number;
  userProcessMemoryMB: number;
  userPid: number;
  unknownPid: number;
  declaredVramMB?: number;
}): GpuAllocationSummary {
  const declaredVramMB = options.declaredVramMB ?? 8_192;
  const unknownProcessMemoryMB = 512;

  return {
    perGpu: [
      {
        gpuIndex: 0,
        totalMemoryMB: 24_576,
        pmeowTasks: [
          {
            taskId: options.taskId,
            gpuIndex: 0,
            declaredVramMB,
            actualVramMB: options.actualVramMB,
          },
        ],
        userProcesses: [
          {
            pid: options.userPid,
            user: options.user,
            gpuIndex: 0,
            usedMemoryMB: options.userProcessMemoryMB,
            command: `python ${options.taskId}.py`,
          },
        ],
        unknownProcesses: [
          {
            pid: options.unknownPid,
            gpuIndex: 0,
            usedMemoryMB: unknownProcessMemoryMB,
          },
        ],
        effectiveFreeMB: 24_576 - options.actualVramMB - options.userProcessMemoryMB - unknownProcessMemoryMB,
      },
    ],
    byUser: [
      {
        user: options.user,
        totalVramMB: options.actualVramMB + options.userProcessMemoryMB,
        gpuIndices: [0],
      },
    ],
  };
}

function createSnapshot(
  serverId: string,
  hostname: string,
  timestamp: number,
  gpuAllocation: GpuAllocationSummary,
): MetricsSnapshot {
  const totalMemoryMB = gpuAllocation.perGpu.reduce(
    (sum, allocation) => sum + allocation.totalMemoryMB,
    0,
  );
  const usedMemoryMB = gpuAllocation.perGpu.reduce((sum, allocation) => {
    const taskVram = allocation.pmeowTasks.reduce(
      (taskSum, task) => taskSum + task.actualVramMB,
      0,
    );
    const userVram = allocation.userProcesses.reduce(
      (processSum, process) => processSum + process.usedMemoryMB,
      0,
    );
    const unknownVram = allocation.unknownProcesses.reduce(
      (processSum, process) => processSum + process.usedMemoryMB,
      0,
    );

    return sum + taskVram + userVram + unknownVram;
  }, 0);

  return {
    serverId,
    timestamp,
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
      totalMemoryMB,
      usedMemoryMB,
      memoryUsagePercent: Math.round((usedMemoryMB / totalMemoryMB) * 100),
      utilizationPercent: 63,
      temperatureC: 58,
      gpuCount: gpuAllocation.perGpu.length,
    },
    processes: [],
    docker: [],
    system: {
      hostname,
      uptime: '1 day',
      loadAvg1: 0.1,
      loadAvg5: 0.2,
      loadAvg15: 0.3,
      kernelVersion: '6.8.0',
    },
    gpuAllocation,
  };
}

function expectedGpuUsageRows(
  serverId: string,
  timestamp: number,
  gpuAllocation: GpuAllocationSummary,
) {
  return gpuAllocation.perGpu.flatMap((allocation) => [
    ...allocation.pmeowTasks.map((task) => ({
      id: expect.any(Number),
      serverId,
      timestamp,
      gpuIndex: allocation.gpuIndex,
      ownerType: 'task',
      ownerId: task.taskId,
      userName: undefined,
      taskId: task.taskId,
      pid: undefined,
      command: undefined,
      usedMemoryMB: task.actualVramMB,
      declaredVramMB: task.declaredVramMB,
    })),
    ...allocation.userProcesses.map((process) => ({
      id: expect.any(Number),
      serverId,
      timestamp,
      gpuIndex: allocation.gpuIndex,
      ownerType: 'user',
      ownerId: process.user,
      userName: process.user,
      taskId: undefined,
      pid: process.pid,
      command: process.command,
      usedMemoryMB: process.usedMemoryMB,
      declaredVramMB: undefined,
    })),
    ...allocation.unknownProcesses.map((process) => ({
      id: expect.any(Number),
      serverId,
      timestamp,
      gpuIndex: allocation.gpuIndex,
      ownerType: 'unknown',
      ownerId: undefined,
      userName: undefined,
      taskId: undefined,
      pid: process.pid,
      command: process.command,
      usedMemoryMB: process.usedMemoryMB,
      declaredVramMB: undefined,
    })),
  ]);
}

describe('agent integration', () => {
  it('handles register, mirrored reads, metrics persistence, and command dispatch end to end', async () => {
    const host = createUniqueHost('agent-happy');
    const agentId = `${host}-id`;
    const taskId = `${host}-task`;
    const server = createServer({
      name: host,
      host,
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
    });
    const { runtime, baseUrl } = await startTestRuntime();
    const token = await login(baseUrl);
    const api = request(baseUrl);
    const agent = new AgentTestStub(baseUrl);
    const gpuAllocation = createGpuAllocation({
      taskId,
      user: 'alice',
      actualVramMB: 6_144,
      userProcessMemoryMB: 1_024,
      userPid: 2_201,
      unknownPid: 991,
    });
    const incomingSnapshot = createSnapshot('wrong-server-id', host, DEFAULT_TIMESTAMP_MS + 1_111, gpuAllocation);

    await agent.connect();
    agent.register({ agentId, hostname: host });

    await waitForCondition(() => {
      expect(getServerById(server.id)?.sourceType).toBe('agent');
      expect(getServerById(server.id)?.agentId).toBe(agentId);
      expect(getAgentDataSource(runtime, server.id).isConnected()).toBe(true);
      expect(runtime.agentRegistry.getSessionByServerId(server.id)).toBe(runtime.agentRegistry.getSession(agentId));
    });

    agent.sendMetrics(incomingSnapshot);

    await waitForCondition(() => {
      expect(getLatestMetrics(server.id)).toEqual({
        ...incomingSnapshot,
        serverId: server.id,
      });
      expect(getLatestGpuUsageByServerId(server.id)).toEqual(
        expectedGpuUsageRows(server.id, incomingSnapshot.timestamp, gpuAllocation),
      );
    });

    agent.sendTaskUpdate({
      taskId,
      status: 'running',
      command: 'python train.py',
      cwd: '/srv/jobs/train',
      user: 'alice',
      requireVramMB: 8_192,
      requireGpuCount: 1,
      gpuIds: [0],
      priority: 9,
      createdAt: DEFAULT_TIMESTAMP_MS + 900,
      startedAt: DEFAULT_TIMESTAMP_MS + 1_000,
      pid: 4_321,
    });

    await waitForCondition(async () => {
      const taskListResponse = await api
        .get(`/api/servers/${server.id}/tasks`)
        .set('Authorization', `Bearer ${token}`);
      const taskDetailResponse = await api
        .get(`/api/servers/${server.id}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(taskListResponse.status).toBe(200);
      expect(taskListResponse.body).toEqual([
        {
          serverId: server.id,
          taskId,
          status: 'running',
          command: 'python train.py',
          cwd: '/srv/jobs/train',
          user: 'alice',
          requireVramMB: 8_192,
          requireGpuCount: 1,
          gpuIds: [0],
          priority: 9,
          createdAt: DEFAULT_TIMESTAMP_MS + 900,
          startedAt: DEFAULT_TIMESTAMP_MS + 1_000,
          finishedAt: null,
          exitCode: null,
          pid: 4_321,
        },
      ]);
      expect(taskDetailResponse.status).toBe(200);
      expect(taskDetailResponse.body).toEqual(taskListResponse.body[0]);
    });

    const pauseCommand = agent.waitForCommand(SERVER_COMMAND.pauseQueue);
    const pauseResponse = await api
      .post(`/api/servers/${server.id}/queue/pause`)
      .set('Authorization', `Bearer ${token}`);

    expect(pauseResponse.status).toBe(200);
    expect(pauseResponse.body).toEqual({ ok: true });
    await expect(pauseCommand).resolves.toEqual({});

    const priorityCommand = agent.waitForCommand(SERVER_COMMAND.setPriority);
    const priorityResponse = await api
      .post(`/api/servers/${server.id}/tasks/${taskId}/priority`)
      .set('Authorization', `Bearer ${token}`)
      .send({ priority: 11 });

    expect(priorityResponse.status).toBe(200);
    expect(priorityResponse.body).toEqual({ ok: true });
    await expect(priorityCommand).resolves.toEqual({
      taskId,
      priority: 11,
    });
  });

  it('keeps mirrored read state during heartbeat timeout and restores command delivery after reconnect', async () => {
    const host = createUniqueHost('agent-recovery');
    const agentId = `${host}-id`;
    const taskId = `${host}-task`;
    const server = createServer({
      name: host,
      host,
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
    });
    const { runtime, baseUrl } = await startTestRuntime({
      agentNamespace: {
        heartbeatTimeoutMs: 80,
        sweepIntervalMs: 10,
      },
    });
    const token = await login(baseUrl);
    const api = request(baseUrl);
    const initialAgent = new AgentTestStub(baseUrl);
    const initialAllocation = createGpuAllocation({
      taskId,
      user: 'alice',
      actualVramMB: 5_120,
      userProcessMemoryMB: 1_024,
      userPid: 3_101,
      unknownPid: 1_001,
    });
    const refreshedAllocation = createGpuAllocation({
      taskId,
      user: 'alice',
      actualVramMB: 7_168,
      userProcessMemoryMB: 768,
      userPid: 3_202,
      unknownPid: 1_002,
    });
    const initialSnapshot = createSnapshot('stale-server-id', host, DEFAULT_TIMESTAMP_MS + 2_000, initialAllocation);
    const refreshedSnapshot = createSnapshot('stale-server-id-2', host, DEFAULT_TIMESTAMP_MS + 3_000, refreshedAllocation);

    await initialAgent.connect();
    initialAgent.register({ agentId, hostname: host });

    await waitForCondition(() => {
      expect(getAgentDataSource(runtime, server.id).isConnected()).toBe(true);
    });

    initialAgent.heartbeat();
    initialAgent.sendMetrics(initialSnapshot);
    initialAgent.sendTaskUpdate({
      taskId,
      status: 'running',
      command: 'python recover.py',
      cwd: '/srv/jobs/recover',
      user: 'alice',
      requireVramMB: 8_192,
      requireGpuCount: 1,
      gpuIds: [0],
      priority: 5,
      createdAt: DEFAULT_TIMESTAMP_MS + 1_500,
      startedAt: DEFAULT_TIMESTAMP_MS + 2_100,
      pid: 6_001,
    });

    await waitForCondition(async () => {
      const taskListResponse = await api
        .get(`/api/servers/${server.id}/tasks`)
        .set('Authorization', `Bearer ${token}`);
      const gpuResponse = await api
        .get(`/api/servers/${server.id}/gpu-allocation`)
        .set('Authorization', `Bearer ${token}`);

      expect(taskListResponse.status).toBe(200);
      expect(taskListResponse.body).toEqual([
        {
          serverId: server.id,
          taskId,
          status: 'running',
          command: 'python recover.py',
          cwd: '/srv/jobs/recover',
          user: 'alice',
          requireVramMB: 8_192,
          requireGpuCount: 1,
          gpuIds: [0],
          priority: 5,
          createdAt: DEFAULT_TIMESTAMP_MS + 1_500,
          startedAt: DEFAULT_TIMESTAMP_MS + 2_100,
          finishedAt: null,
          exitCode: null,
          pid: 6_001,
        },
      ]);
      expect(gpuResponse.status).toBe(200);
      expect(gpuResponse.body).toEqual(initialAllocation);
    });

    const initialSession = runtime.agentRegistry.getSession(agentId);
    expect(initialSession).toBeDefined();

    await waitForCondition(() => {
      expect(getAgentDataSource(runtime, server.id).isConnected()).toBe(false);
      expect(getAgentDataSource(runtime, server.id).hasLiveSession()).toBe(false);
    }, { timeoutMs: 1_000 });

    const offlineResponse = await api
      .post(`/api/servers/${server.id}/queue/pause`)
      .set('Authorization', `Bearer ${token}`);

    expect(offlineResponse.status).toBe(409);
    expect(offlineResponse.body).toEqual({ error: 'Agent 未在线' });

    const tasksWhileOffline = await api
      .get(`/api/servers/${server.id}/tasks`)
      .set('Authorization', `Bearer ${token}`);
    const gpuWhileOffline = await api
      .get(`/api/servers/${server.id}/gpu-allocation`)
      .set('Authorization', `Bearer ${token}`);

    expect(tasksWhileOffline.status).toBe(200);
    expect(tasksWhileOffline.body).toEqual([
      {
        serverId: server.id,
        taskId,
        status: 'running',
        command: 'python recover.py',
        cwd: '/srv/jobs/recover',
        user: 'alice',
        requireVramMB: 8_192,
        requireGpuCount: 1,
        gpuIds: [0],
        priority: 5,
        createdAt: DEFAULT_TIMESTAMP_MS + 1_500,
        startedAt: DEFAULT_TIMESTAMP_MS + 2_100,
        finishedAt: null,
        exitCode: null,
        pid: 6_001,
      },
    ]);
    expect(gpuWhileOffline.status).toBe(200);
    expect(gpuWhileOffline.body).toEqual(initialAllocation);

    const reconnectedAgent = new AgentTestStub(baseUrl);
    await reconnectedAgent.connect();
    reconnectedAgent.register({ agentId, hostname: host });

    await waitForCondition(() => {
      const restoredSession = runtime.agentRegistry.getSession(agentId);

      expect(restoredSession).toBeDefined();
      expect(restoredSession).not.toBe(initialSession);
      expect(runtime.agentRegistry.getSessionByServerId(server.id)).toBe(restoredSession);
      expect(getAgentDataSource(runtime, server.id).isConnected()).toBe(true);
      expect(getAgentDataSource(runtime, server.id).hasLiveSession()).toBe(true);
    });

    reconnectedAgent.sendMetrics(refreshedSnapshot);

    await waitForCondition(async () => {
      expect(getLatestMetrics(server.id)).toEqual({
        ...refreshedSnapshot,
        serverId: server.id,
      });
      expect(getLatestGpuUsageByServerId(server.id)).toEqual(
        expectedGpuUsageRows(server.id, refreshedSnapshot.timestamp, refreshedAllocation),
      );

      const gpuResponse = await api
        .get(`/api/servers/${server.id}/gpu-allocation`)
        .set('Authorization', `Bearer ${token}`);

      expect(gpuResponse.status).toBe(200);
      expect(gpuResponse.body).toEqual(refreshedAllocation);
    });

    const cancelCommand = reconnectedAgent.waitForCommand(SERVER_COMMAND.cancelTask);
    const cancelResponse = await api
      .post(`/api/servers/${server.id}/tasks/${taskId}/cancel`)
      .set('Authorization', `Bearer ${token}`);

    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body).toEqual({ ok: true });
    await expect(cancelCommand).resolves.toEqual({ taskId });
  });
});