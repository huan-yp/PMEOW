import {
  AgentDataSource,
  Scheduler,
  createServer,
  getServerById,
} from '@monitor/core';
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
  assertion: () => void,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 1_000;
  const intervalMs = options.intervalMs ?? 10;
  const startedAt = Date.now();

  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

async function startRuntime(options: {
  heartbeatTimeoutMs?: number;
  sweepIntervalMs?: number;
} = {}): Promise<{ runtime: WebRuntime; baseUrl: string }> {
  const runtime = trackRuntime(createWebRuntime({
    port: 0,
    scheduler: new Scheduler(),
    agentNamespace: options,
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

function getAgentDataSource(runtime: WebRuntime, serverId: string): AgentDataSource {
  const dataSource = runtime.scheduler.getDataSource(serverId);

  expect(dataSource).toBeInstanceOf(AgentDataSource);
  return dataSource as AgentDataSource;
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

describe('createAgentNamespace', () => {
  it('register binds a live session and flips the scheduler datasource to agent', async () => {
    const { runtime, baseUrl } = await startRuntime();
    const server = createServer({
      name: 'gpu-register',
      host: 'gpu-register',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
    });
    const client = await connectAgent(baseUrl);

    client.emit('agent:register', {
      agentId: 'agent-register',
      hostname: 'gpu-register',
      version: '1.0.0',
    });

    await waitForCondition(() => {
      expect(getServerById(server.id)?.sourceType).toBe('agent');
      expect(getServerById(server.id)?.agentId).toBe('agent-register');
      expect(runtime.agentRegistry.getSession('agent-register')).toBeDefined();
      expect(runtime.agentRegistry.getSessionByServerId(server.id)).toBe(runtime.agentRegistry.getSession('agent-register'));

      const dataSource = getAgentDataSource(runtime, server.id);
      expect(dataSource.agentId).toBe('agent-register');
      expect(dataSource.isConnected()).toBe(true);
    });
  });

  it('heartbeats refresh last-seen state', async () => {
    const { runtime, baseUrl } = await startRuntime({
      heartbeatTimeoutMs: 200,
      sweepIntervalMs: 20,
    });
    const server = createServer({
      name: 'gpu-heartbeat',
      host: 'gpu-heartbeat',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
    });
    const client = await connectAgent(baseUrl);

    client.emit('agent:register', {
      agentId: 'agent-heartbeat',
      hostname: 'gpu-heartbeat',
      version: '1.0.0',
    });

    await waitForCondition(() => {
      expect(runtime.agentRegistry.getSession('agent-heartbeat')).toBeDefined();
      expect(getAgentDataSource(runtime, server.id).isConnected()).toBe(true);
    });

    const initialHeartbeatAt = runtime.agentRegistry.getLastHeartbeat('agent-heartbeat') ?? 0;
    const heartbeatAt = Date.now();

    client.emit('agent:heartbeat', {
      agentId: 'agent-heartbeat',
      timestamp: heartbeatAt,
    });

    await waitForCondition(() => {
      expect(runtime.agentRegistry.getLastHeartbeat('agent-heartbeat')).toBe(heartbeatAt);
      expect(runtime.agentRegistry.getLastHeartbeat('agent-heartbeat')).toBeGreaterThan(initialHeartbeatAt);
      expect(getAgentDataSource(runtime, server.id).isConnected()).toBe(true);
    });
  });

  it('heartbeat timeout detaches the live session without deleting the binding', async () => {
    const { runtime, baseUrl } = await startRuntime({
      heartbeatTimeoutMs: 40,
      sweepIntervalMs: 10,
    });
    const server = createServer({
      name: 'gpu-timeout',
      host: 'gpu-timeout',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
    });
    const client = await connectAgent(baseUrl);

    client.emit('agent:register', {
      agentId: 'agent-timeout',
      hostname: 'gpu-timeout',
      version: '1.0.0',
    });

    await waitForCondition(() => {
      expect(getAgentDataSource(runtime, server.id).isConnected()).toBe(true);
    });

    await waitForCondition(() => {
      expect(getAgentDataSource(runtime, server.id).isConnected()).toBe(false);
    }, { timeoutMs: 500 });

    expect(getServerById(server.id)?.sourceType).toBe('agent');
    expect(getServerById(server.id)?.agentId).toBe('agent-timeout');
    expect(runtime.agentRegistry.getSession('agent-timeout')).toBeDefined();
  });

  it('disconnect marks the agent offline', async () => {
    const { runtime, baseUrl } = await startRuntime();
    const server = createServer({
      name: 'gpu-disconnect',
      host: 'gpu-disconnect',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
    });
    const client = await connectAgent(baseUrl);

    client.emit('agent:register', {
      agentId: 'agent-disconnect',
      hostname: 'gpu-disconnect',
      version: '1.0.0',
    });

    await waitForCondition(() => {
      expect(getAgentDataSource(runtime, server.id).isConnected()).toBe(true);
      expect(runtime.agentRegistry.getSession('agent-disconnect')).toBeDefined();
    });

    client.disconnect();

    await waitForCondition(() => {
      expect(getAgentDataSource(runtime, server.id).isConnected()).toBe(false);
      expect(runtime.agentRegistry.getSession('agent-disconnect')).toBeUndefined();
    });
  });

  it('reconnect with the same agentId replaces the old live session cleanly', async () => {
    const { runtime, baseUrl } = await startRuntime({
      heartbeatTimeoutMs: 200,
      sweepIntervalMs: 20,
    });
    const server = createServer({
      name: 'gpu-reconnect',
      host: 'gpu-reconnect',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
    });
    const first = await connectAgent(baseUrl);
    let firstReceivedPause = false;

    first.on('server:pauseQueue', () => {
      firstReceivedPause = true;
    });
    first.emit('agent:register', {
      agentId: 'agent-reconnect',
      hostname: 'gpu-reconnect',
      version: '1.0.0',
    });

    await waitForCondition(() => {
      expect(runtime.agentRegistry.getSession('agent-reconnect')).toBeDefined();
      expect(getAgentDataSource(runtime, server.id).isConnected()).toBe(true);
    });

    const initialSession = runtime.agentRegistry.getSession('agent-reconnect');
    const second = await connectAgent(baseUrl);
    const pauseQueue = new Promise<Record<string, never>>((resolve) => {
      second.once('server:pauseQueue', (payload) => resolve(payload));
    });

    second.emit('agent:register', {
      agentId: 'agent-reconnect',
      hostname: 'gpu-reconnect',
      version: '1.0.1',
    });

    await waitForCondition(() => {
      const currentSession = runtime.agentRegistry.getSession('agent-reconnect');

      expect(currentSession).toBeDefined();
      expect(currentSession).not.toBe(initialSession);
      expect(getAgentDataSource(runtime, server.id).isConnected()).toBe(true);
      expect(first.connected).toBe(false);
    });

    getAgentDataSource(runtime, server.id).pauseQueue();

    await expect(pauseQueue).resolves.toEqual({});
    await waitForCondition(() => {
      expect(firstReceivedPause).toBe(false);
    });
  });
});