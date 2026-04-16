import {
  SERVER_COMMAND,
  Scheduler,
  createServer,
  getAgentTask,
  upsertAgentTask,
  type MirroredAgentTaskRecord,
} from '@monitor/core';
import request from 'supertest';
import { io as createClient, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { createWebRuntime, type WebRuntime } from '../src/app.js';

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

async function registerAgent(
  client: Socket,
  runtime: WebRuntime,
  serverId: string,
  agentId: string,
  hostname: string,
): Promise<void> {
  client.emit('agent:register', {
    agentId,
    hostname,
    version: '1.0.0',
  });

  await waitForCondition(() => {
    expect(runtime.agentRegistry.hasSessionByServerId(serverId)).toBe(true);
  });
}

function mirrorTask(task: MirroredAgentTaskRecord): MirroredAgentTaskRecord {
  upsertAgentTask(task);

  const mirroredTask = getAgentTask(task.taskId);
  expect(mirroredTask).toBeDefined();
  return mirroredTask as MirroredAgentTaskRecord;
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
});

describe('agent control routes', () => {
  it('cancel command reaches the Agent session', async () => {
    const { runtime, baseUrl } = await startRuntime();
    const token = await login(baseUrl);
    const api = request(baseUrl);
    const server = createServer({
      name: 'gpu-cancel',
      host: 'gpu-cancel',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-cancel',
    });
    const mirroredTask = mirrorTask({
      serverId: server.id,
      taskId: 'task-cancel',
      status: 'running',
      command: 'python train.py',
      priority: 7,
      startedAt: 1_000,
      pid: 4_321,
    });
    const client = await connectAgent(baseUrl);

    await registerAgent(client, runtime, server.id, 'agent-cancel', 'gpu-cancel');

    const cancelCommand = new Promise<{ taskId: string }>((resolve) => {
      client.once(SERVER_COMMAND.cancelTask, (payload) => resolve(payload));
    });

    const response = await api
      .post(`/api/servers/${server.id}/tasks/${mirroredTask.taskId}/cancel`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    await expect(cancelCommand).resolves.toEqual({ taskId: mirroredTask.taskId });
    expect(getAgentTask(mirroredTask.taskId)).toEqual(mirroredTask);
  });

  it('pause and resume commands reach the Agent session', async () => {
    const { runtime, baseUrl } = await startRuntime();
    const token = await login(baseUrl);
    const api = request(baseUrl);
    const server = createServer({
      name: 'gpu-queue-control',
      host: 'gpu-queue-control',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-queue-control',
    });
    const client = await connectAgent(baseUrl);

    await registerAgent(client, runtime, server.id, 'agent-queue-control', 'gpu-queue-control');

    const pauseCommand = new Promise<Record<string, never>>((resolve) => {
      client.once(SERVER_COMMAND.pauseQueue, (payload) => resolve(payload));
    });

    const pauseResponse = await api
      .post(`/api/servers/${server.id}/queue/pause`)
      .set('Authorization', `Bearer ${token}`);

    expect(pauseResponse.status).toBe(200);
    expect(pauseResponse.body).toEqual({ ok: true });
    await expect(pauseCommand).resolves.toEqual({});

    const resumeCommand = new Promise<Record<string, never>>((resolve) => {
      client.once(SERVER_COMMAND.resumeQueue, (payload) => resolve(payload));
    });

    const resumeResponse = await api
      .post(`/api/servers/${server.id}/queue/resume`)
      .set('Authorization', `Bearer ${token}`);

    expect(resumeResponse.status).toBe(200);
    expect(resumeResponse.body).toEqual({ ok: true });
    await expect(resumeCommand).resolves.toEqual({});
  });

  it('set-priority validates request body and dispatches the correct payload', async () => {
    const { runtime, baseUrl } = await startRuntime();
    const token = await login(baseUrl);
    const api = request(baseUrl);
    const server = createServer({
      name: 'gpu-priority',
      host: 'gpu-priority',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-priority',
    });
    const mirroredTask = mirrorTask({
      serverId: server.id,
      taskId: 'task-priority',
      status: 'queued',
      command: 'python queue.py',
      priority: 3,
      createdAt: 500,
    });
    const client = await connectAgent(baseUrl);

    await registerAgent(client, runtime, server.id, 'agent-priority', 'gpu-priority');

    const invalidResponse = await api
      .post(`/api/servers/${server.id}/tasks/${mirroredTask.taskId}/priority`)
      .set('Authorization', `Bearer ${token}`)
      .send({ priority: 2.5 });

    expect(invalidResponse.status).toBe(400);

    const setPriorityCommand = new Promise<{ taskId: string; priority: number }>((resolve) => {
      client.once(SERVER_COMMAND.setPriority, (payload) => resolve(payload));
    });
    const taskBeforeDispatch = getAgentTask(mirroredTask.taskId);

    const response = await api
      .post(`/api/servers/${server.id}/tasks/${mirroredTask.taskId}/priority`)
      .set('Authorization', `Bearer ${token}`)
      .send({ priority: 11 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    await expect(setPriorityCommand).resolves.toEqual({
      taskId: mirroredTask.taskId,
      priority: 11,
    });
    expect(getAgentTask(mirroredTask.taskId)).toEqual(taskBeforeDispatch);
  });

  it('task-events route returns acknowledged structured events from the Agent session', async () => {
    const { runtime, baseUrl } = await startRuntime();
    const token = await login(baseUrl);
    const api = request(baseUrl);
    const server = createServer({
      name: 'gpu-events',
      host: 'gpu-events',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-events',
    });
    const mirroredTask = mirrorTask({
      serverId: server.id,
      taskId: 'task-events',
      status: 'queued',
      command: 'python queue.py',
      priority: 3,
      createdAt: 500,
    });
    const client = await connectAgent(baseUrl);

    await registerAgent(client, runtime, server.id, 'agent-events', 'gpu-events');

    client.on(SERVER_COMMAND.getTaskEvents, (payload, callback) => {
      callback([
        {
          id: 7,
          taskId: payload.taskId,
          eventType: 'schedule_blocked',
          timestamp: 1_710_000_000,
          details: {
            message: 'schedule blocked',
            reason_code: 'blocked_by_higher_priority',
            blocker_task_ids: ['task-a'],
          },
        },
      ]);
    });

    const response = await api
      .get(`/api/servers/${server.id}/tasks/${mirroredTask.taskId}/events?afterId=0`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        id: 7,
        taskId: mirroredTask.taskId,
        eventType: 'schedule_blocked',
        timestamp: 1_710_000_000,
        details: {
          message: 'schedule blocked',
          reason_code: 'blocked_by_higher_priority',
          blocker_task_ids: ['task-a'],
        },
      },
    ]);
  });

  it('offline Agent returns 409', async () => {
    const { baseUrl } = await startRuntime();
    const token = await login(baseUrl);
    const api = request(baseUrl);
    const server = createServer({
      name: 'gpu-offline-control',
      host: 'gpu-offline-control',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-offline-control',
    });

    const response = await api
      .post(`/api/servers/${server.id}/queue/pause`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(409);
  });

  it('missing task returns 404 for cancel and priority routes', async () => {
    const { runtime, baseUrl } = await startRuntime();
    const token = await login(baseUrl);
    const api = request(baseUrl);
    const server = createServer({
      name: 'gpu-control',
      host: 'gpu-control',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-control',
    });
    const otherServer = createServer({
      name: 'gpu-other-task',
      host: 'gpu-other-task',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-other-task',
    });
    const client = await connectAgent(baseUrl);

    mirrorTask({
      serverId: otherServer.id,
      taskId: 'task-elsewhere',
      status: 'queued',
      priority: 5,
      createdAt: 800,
    });

    await registerAgent(client, runtime, server.id, 'agent-control', 'gpu-control');

    const cancelResponse = await api
      .post(`/api/servers/${server.id}/tasks/task-elsewhere/cancel`)
      .set('Authorization', `Bearer ${token}`);
    const priorityResponse = await api
      .post(`/api/servers/${server.id}/tasks/task-elsewhere/priority`)
      .set('Authorization', `Bearer ${token}`)
      .send({ priority: 9 });

    expect(cancelResponse.status).toBe(404);
    expect(priorityResponse.status).toBe(404);
  });

  it('audit detail returns data from Agent session', async () => {
    const { runtime, baseUrl } = await startRuntime();
    const token = await login(baseUrl);
    const api = request(baseUrl);
    const server = createServer({
      name: 'gpu-audit',
      host: 'gpu-audit',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-audit',
    });
    const mirroredTask = mirrorTask({
      serverId: server.id,
      taskId: 'task-audit',
      status: 'completed',
      command: 'python train.py',
      priority: 5,
      createdAt: 100,
      startedAt: 200,
      finishedAt: 300,
      exitCode: 0,
    });
    const client = await connectAgent(baseUrl);

    await registerAgent(client, runtime, server.id, 'agent-audit', 'gpu-audit');

    const auditResponse = {
      task: { id: mirroredTask.taskId, command: 'python train.py', status: 'completed' },
      events: [],
      runtime: null,
    };

    client.on(SERVER_COMMAND.getTaskAuditDetail, (_payload, callback) => {
      callback(auditResponse);
    });

    const response = await api
      .get(`/api/servers/${server.id}/tasks/${mirroredTask.taskId}/audit`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(auditResponse);
  });

  it('audit detail returns 409 when Agent is offline', async () => {
    const { baseUrl } = await startRuntime();
    const token = await login(baseUrl);
    const api = request(baseUrl);
    const server = createServer({
      name: 'gpu-audit-offline',
      host: 'gpu-audit-offline',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-audit-offline',
    });
    mirrorTask({
      serverId: server.id,
      taskId: 'task-audit-offline',
      status: 'completed',
      command: 'python train.py',
      priority: 5,
      createdAt: 100,
    });

    const response = await api
      .get(`/api/servers/${server.id}/tasks/task-audit-offline/audit`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('Agent');
  });

  it('audit detail returns 504 when Agent times out', async () => {
    const { runtime, baseUrl } = await startRuntime();
    const token = await login(baseUrl);
    const api = request(baseUrl);
    const server = createServer({
      name: 'gpu-audit-timeout',
      host: 'gpu-audit-timeout',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-audit-timeout',
    });
    mirrorTask({
      serverId: server.id,
      taskId: 'task-audit-timeout',
      status: 'running',
      command: 'python train.py',
      priority: 5,
      createdAt: 100,
    });
    const client = await connectAgent(baseUrl);

    await registerAgent(client, runtime, server.id, 'agent-audit-timeout', 'gpu-audit-timeout');

    // Do not respond to the audit request, causing Socket.IO timeout
    client.on(SERVER_COMMAND.getTaskAuditDetail, () => {
      // intentionally no callback — will trigger timeout
    });

    const response = await api
      .get(`/api/servers/${server.id}/tasks/task-audit-timeout/audit`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(504);
    expect(response.body.error).toContain('超时');
  }, 10_000);

  it('task-events returns 504 when Agent times out', async () => {
    const { runtime, baseUrl } = await startRuntime();
    const token = await login(baseUrl);
    const api = request(baseUrl);
    const server = createServer({
      name: 'gpu-events-timeout',
      host: 'gpu-events-timeout',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-events-timeout',
    });
    mirrorTask({
      serverId: server.id,
      taskId: 'task-events-timeout',
      status: 'running',
      command: 'python train.py',
      priority: 5,
      createdAt: 100,
    });
    const client = await connectAgent(baseUrl);

    await registerAgent(client, runtime, server.id, 'agent-events-timeout', 'gpu-events-timeout');

    client.on(SERVER_COMMAND.getTaskEvents, () => {
      // intentionally no callback — will trigger timeout
    });

    const response = await api
      .get(`/api/servers/${server.id}/tasks/task-events-timeout/events`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(504);
    expect(response.body.error).toContain('超时');
  }, 10_000);

  it('SSH node returns 409 for agent command routes', async () => {
    const { baseUrl } = await startRuntime();
    const token = await login(baseUrl);
    const api = request(baseUrl);
    const server = createServer({
      name: 'ssh-node',
      host: 'ssh-node',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'ssh',
    });

    const pauseResponse = await api
      .post(`/api/servers/${server.id}/queue/pause`)
      .set('Authorization', `Bearer ${token}`);

    expect(pauseResponse.status).toBe(409);
    expect(pauseResponse.body.error).toContain('不支持');
  });
});