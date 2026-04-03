import { AGENT_EVENT, Scheduler, createSecurityEvent, createServer } from '@monitor/core';
import { io as createClient, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { login, startTestRuntime, waitForCondition } from './setup.js';

const sockets: Socket[] = [];

function trackSocket(socket: Socket): Socket {
  sockets.push(socket);
  return socket;
}

async function connectUi(baseUrl: string, token: string): Promise<Socket> {
  const socket = trackSocket(createClient(baseUrl, {
    autoConnect: false,
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  }));

  await new Promise<void>((resolve, reject) => {
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    };

    socket.on('connect', onConnect);
    socket.on('connect_error', onError);
    socket.connect();
  });

  return socket;
}

async function connectAgent(baseUrl: string): Promise<Socket> {
  const socket = trackSocket(createClient(`${baseUrl}/agent`, {
    autoConnect: false,
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  }));

  await new Promise<void>((resolve, reject) => {
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    };

    socket.on('connect', onConnect);
    socket.on('connect_error', onError);
    socket.connect();
  });

  return socket;
}

afterEach(() => {
  while (sockets.length > 0) {
    sockets.pop()?.disconnect();
  }
});

describe('operator realtime fanout', () => {
  it('notifies authenticated ui clients when agent registration changes the server catalog', async () => {
    const { baseUrl } = await startTestRuntime();
    const token = await login(baseUrl);
    const uiClient = await connectUi(baseUrl, token);
    const agentClient = await connectAgent(baseUrl);

    const changed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for serversChanged'));
      }, 1_000);

      uiClient.once('serversChanged', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    agentClient.emit(AGENT_EVENT.register, {
      agentId: 'agent-servers-changed',
      hostname: 'agent-servers-changed',
      version: '1.0.0',
    });

    await expect(changed).resolves.toBeUndefined();
  });

  it('forwards scheduler securityEvent emissions to authenticated ui clients', async () => {
    const { baseUrl, runtime } = await startTestRuntime({
      scheduler: new Scheduler(),
    });
    const token = await login(baseUrl);
    const uiClient = await connectUi(baseUrl, token);

    const received = new Promise<any>((resolve) => {
      uiClient.once('securityEvent', resolve);
    });
    const event = createSecurityEvent({
      serverId: 'server-1',
      eventType: 'suspicious_process',
      fingerprint: 'realtime-1',
      details: { reason: '命中关键词 miner', pid: 99 },
    });

    runtime.scheduler.emit('securityEvent', event);

    await expect(received).resolves.toEqual(event);
  });

  it('fans out normalized taskUpdate events from the agent namespace to authenticated ui clients', async () => {
    const server = createServer({
      name: 'agent-realtime',
      host: 'agent-realtime',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-realtime-id',
    });
    const { baseUrl } = await startTestRuntime();
    const token = await login(baseUrl);
    const uiClient = await connectUi(baseUrl, token);
    const agentClient = await connectAgent(baseUrl);

    const received = new Promise<any>((resolve) => {
      uiClient.once('taskUpdate', resolve);
    });

    agentClient.emit(AGENT_EVENT.register, {
      agentId: 'agent-realtime-id',
      hostname: 'agent-realtime',
      version: '1.0.0',
    });
    agentClient.emit(AGENT_EVENT.taskUpdate, {
      taskId: 'task-rt-1',
      status: 'running',
      command: 'python run.py',
      user: 'alice',
      startedAt: 1234,
      pid: 4567,
    });

    await waitForCondition(async () => {
      await expect(received).resolves.toEqual(expect.objectContaining({
        serverId: server.id,
        taskId: 'task-rt-1',
        status: 'running',
      }));
    });
  });
});