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

  it('fans out taskChanged events from the agent namespace to authenticated ui clients', async () => {
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

    // Track call count so we return different data on the pull triggered by taskChanged
    let pullCount = 0;
    agentClient.on('server:getTaskQueue' as any, (_payload: any, callback: any) => {
      pullCount++;
      if (pullCount <= 1) {
        // Initial pull on register: empty queue
        callback({ queued: [], running: [], recent: [] });
      } else {
        // Pull triggered by taskChanged: new running task
        callback({
          queued: [],
          running: [{ taskId: 'task-1', serverId: server.id, status: 'running' }],
          recent: [],
        });
      }
    });

    const received = new Promise<any>((resolve) => {
      uiClient.once('taskChanged', resolve);
    });

    agentClient.emit(AGENT_EVENT.register, {
      agentId: 'agent-realtime-id',
      hostname: 'agent-realtime',
      version: '1.0.0',
    });

    // Wait for the initial pull to complete before emitting taskChanged
    await new Promise(r => setTimeout(r, 200));
    agentClient.emit(AGENT_EVENT.taskChanged);

    await waitForCondition(async () => {
      await expect(received).resolves.toBeDefined();
    });
  });
});