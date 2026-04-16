import {
  AGENT_EVENT,
  type AgentTaskEventRecord,
  SERVER_COMMAND,
  Scheduler,
  closeDatabase,
  type AgentHeartbeatPayload,
  type AgentMetricsPayload,
  type AgentRegisterPayload,
  type ServerCancelTaskPayload,
  type ServerGetTaskEventsPayload,
  type ServerPauseQueuePayload,
  type ServerResumeQueuePayload,
  type ServerSetPriorityPayload,
} from '@monitor/core';
import request from 'supertest';
import { io as createClient, type Socket } from 'socket.io-client';
import { afterEach, expect } from 'vitest';
import { createWebRuntime, type CreateWebRuntimeOptions, type WebRuntime } from '../src/app.js';
import type { CreateAgentNamespaceOptions } from '../src/agent-namespace.js';

process.env.MONITOR_DB_PATH = ':memory:';

const runtimes: WebRuntime[] = [];
const clients: Socket[] = [];

interface WaitForConditionOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

interface WaitForCommandOptions {
  timeoutMs?: number;
}

interface AgentCommandPayloadMap {
  [SERVER_COMMAND.cancelTask]: ServerCancelTaskPayload;
  [SERVER_COMMAND.getTaskEvents]: ServerGetTaskEventsPayload;
  [SERVER_COMMAND.pauseQueue]: ServerPauseQueuePayload;
  [SERVER_COMMAND.resumeQueue]: ServerResumeQueuePayload;
  [SERVER_COMMAND.setPriority]: ServerSetPriorityPayload;
}

export interface StartTestRuntimeOptions {
  scheduler?: Scheduler;
  agentNamespace?: CreateAgentNamespaceOptions;
}

export interface TestRuntimeHandle {
  runtime: WebRuntime;
  baseUrl: string;
}

function trackRuntime(runtime: WebRuntime): WebRuntime {
  runtimes.push(runtime);
  return runtime;
}

function trackClient(client: Socket): Socket {
  clients.push(client);
  return client;
}

async function waitForSocketConnection(client: Socket): Promise<void> {
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
}

export async function waitForCondition(
  assertion: () => void | Promise<void>,
  options: WaitForConditionOptions = {},
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

export async function startTestRuntime(
  options: StartTestRuntimeOptions = {},
): Promise<TestRuntimeHandle> {
  const runtimeOptions: CreateWebRuntimeOptions = {
    port: 0,
    scheduler: options.scheduler ?? new Scheduler(),
  };

  if (options.agentNamespace) {
    runtimeOptions.agentNamespace = options.agentNamespace;
  }

  const runtime = trackRuntime(createWebRuntime(runtimeOptions));
  const port = await runtime.start(0);

  return {
    runtime,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

export async function login(baseUrl: string, password = 'test-password'): Promise<string> {
  const response = await request(baseUrl)
    .post('/api/login')
    .send({ password });

  expect(response.status).toBe(200);
  expect(response.body.token).toEqual(expect.any(String));
  return response.body.token as string;
}

export class AgentTestStub {
  private client: Socket | null = null;
  private agentId: string | null = null;

  constructor(private readonly baseUrl: string) {}

  async connect(): Promise<Socket> {
    if (this.client?.connected) {
      return this.client;
    }

    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }

    const client = trackClient(createClient(`${this.baseUrl}/agent`, {
      autoConnect: false,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    }));

    this.client = client;
    await waitForSocketConnection(client);
    return client;
  }

  disconnect(): void {
    this.client?.disconnect();
    this.client = null;
  }

  register(payload: Omit<AgentRegisterPayload, 'version'> & { version?: string }): void {
    const client = this.requireClient();

    this.agentId = payload.agentId;
    client.emit(AGENT_EVENT.register, {
      ...payload,
      version: payload.version ?? '1.0.0',
    });
  }

  heartbeat(payload: Partial<AgentHeartbeatPayload> = {}): void {
    const client = this.requireClient();
    const agentId = payload.agentId ?? this.agentId;

    if (!agentId) {
      throw new Error('AgentTestStub is missing an agentId; call register() first or provide agentId.');
    }

    client.emit(AGENT_EVENT.heartbeat, {
      agentId,
      timestamp: payload.timestamp ?? Date.now(),
    });
  }

  sendMetrics(snapshot: AgentMetricsPayload): void {
    this.requireClient().emit(AGENT_EVENT.metrics, snapshot);
  }

  sendTaskChanged(): void {
    this.requireClient().emit(AGENT_EVENT.taskChanged);
  }

  waitForCommand<EventName extends keyof AgentCommandPayloadMap>(
    eventName: EventName,
    options: WaitForCommandOptions = {},
  ): Promise<AgentCommandPayloadMap[EventName]> {
    const client = this.requireClient();
    const timeoutMs = options.timeoutMs ?? 1_000;

    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const untypedClient = client as unknown as {
        off(eventName: string, listener: (...args: any[]) => void): void;
        once(eventName: string, listener: (...args: any[]) => void): void;
      };
      const onCommand = (payload: AgentCommandPayloadMap[EventName]) => {
        cleanup();
        resolve(payload);
      };
      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
        }

        untypedClient.off(eventName, onCommand as (...args: any[]) => void);
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for ${eventName}`));
      }, timeoutMs);

      untypedClient.once(eventName, onCommand as (...args: any[]) => void);
    });
  }

  private requireClient(): Socket {
    if (!this.client) {
      throw new Error('AgentTestStub is not connected. Call connect() first.');
    }

    return this.client;
  }

  respondToTaskEvents(response: AgentTaskEventRecord[]): void {
    const client = this.requireClient();
    client.on(SERVER_COMMAND.getTaskEvents, (_payload, callback) => {
      callback(response);
    });
  }
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