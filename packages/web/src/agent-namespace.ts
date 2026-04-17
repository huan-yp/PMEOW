import {
  AGENT_EVENT,
  AgentDataSource,
  type AgentHeartbeatPayload,
  type AgentTaskAuditDetailResponse,
  type AgentTaskEventsResponse,
  type AgentTaskQueueResponse,
  type AgentLocalUsersPayload,
  type AgentRegisterPayload,
  AgentSessionRegistry,
  type AgentLiveSession,
  type MirroredAgentTaskRecord,
  ingestAgentLocalUsers,
  isAgentLocalUsersPayload,
  isAgentMetricsPayload,
  type Scheduler,
  SERVER_COMMAND,
  type ServerCancelTaskPayload,
  type ServerCommandEnvelope,
  type ServerGetTaskAuditDetailPayload,
  type ServerGetTaskEventsPayload,
  type ServerGetTaskQueuePayload,
  type ServerPauseQueuePayload,
  type ServerResumeQueuePayload,
  type ServerSetPriorityPayload,
  isAgentHeartbeatPayload,
  isAgentRegisterPayload,
  type MetricsSnapshot,
  resolveAgentBinding,
  autoCreateAgentServer,
  AgentCommandError,
  diffTaskQueue,
  setTaskQueueCache,
  clearTaskQueueCache,
  recordTaskAttributionFact,
} from '@monitor/core';
import type { Namespace, Server as SocketServer, Socket } from 'socket.io';

const AGENT_NAMESPACE = '/agent';
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 90_000;
const DEFAULT_SWEEP_INTERVAL_MS = 5_000;
const MILLIS_TIMESTAMP_THRESHOLD = 1_000_000_000_000;

interface AgentConnectionState {
  agentId: string;
  session: AgentLiveSession;
  socket: AgentSocket;
  serverId?: string;
  lastHeartbeatAt: number;
  lastMetricsAt?: number;
  timedOut: boolean;
  version?: string;
}

interface AgentSocketData {
  agentState?: AgentConnectionState;
}

interface AgentNamespaceClientEvents {
  [AGENT_EVENT.register]: (payload: AgentRegisterPayload) => void;
  [AGENT_EVENT.metrics]: (payload: unknown) => void;
  [AGENT_EVENT.taskChanged]: () => void;
  [AGENT_EVENT.localUsers]: (payload: unknown) => void;
  [AGENT_EVENT.heartbeat]: (payload: AgentHeartbeatPayload) => void;
}

interface AgentNamespaceServerEvents {
  [SERVER_COMMAND.cancelTask]: (payload: ServerCancelTaskPayload) => void;
  [SERVER_COMMAND.getTaskEvents]: (
    payload: ServerGetTaskEventsPayload,
    callback: (response: AgentTaskEventsResponse) => void,
  ) => void;
  [SERVER_COMMAND.getTaskAuditDetail]: (
    payload: ServerGetTaskAuditDetailPayload,
    callback: (response: AgentTaskAuditDetailResponse) => void,
  ) => void;
  [SERVER_COMMAND.getTaskQueue]: (
    payload: ServerGetTaskQueuePayload,
    callback: (response: AgentTaskQueueResponse) => void,
  ) => void;
  [SERVER_COMMAND.pauseQueue]: (payload: ServerPauseQueuePayload) => void;
  [SERVER_COMMAND.resumeQueue]: (payload: ServerResumeQueuePayload) => void;
  [SERVER_COMMAND.setPriority]: (payload: ServerSetPriorityPayload) => void;
}

type AgentSocket = Socket<
  AgentNamespaceClientEvents,
  AgentNamespaceServerEvents,
  Record<string, never>,
  AgentSocketData
>;
type AgentNamespace = Namespace<
  AgentNamespaceClientEvents,
  AgentNamespaceServerEvents,
  Record<string, never>,
  AgentSocketData
>;

export interface CreateAgentNamespaceOptions {
  heartbeatTimeoutMs?: number;
  sweepIntervalMs?: number;
  now?: () => number;
  onTaskChanged?: (serverId: string, changedTasks: MirroredAgentTaskRecord[]) => void;
  onServerChanged?: () => void;
  getMetricsTimeoutMs?: () => number;
}

export interface AgentNamespaceRuntime {
  registry: AgentSessionRegistry;
  namespace: AgentNamespace;
  stop: () => void;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeHeartbeatTimestamp(timestamp: number): number {
  if (timestamp < MILLIS_TIMESTAMP_THRESHOLD) {
    return Math.round(timestamp * 1000);
  }

  return Math.round(timestamp);
}

function normalizeTimestamp(timestamp: number): number {
  if (timestamp < MILLIS_TIMESTAMP_THRESHOLD) {
    return Math.round(timestamp * 1000);
  }

  return Math.round(timestamp);
}

function normalizeOptionalTimestamp(timestamp: number | null | undefined): number | undefined {
  if (timestamp == null) {
    return undefined;
  }

  return normalizeTimestamp(timestamp);
}

function normalizePeerAddress(value: string | string[] | undefined): string | undefined {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const firstValue = rawValue?.split(',')[0]?.trim();

  if (!firstValue) {
    return undefined;
  }

  const withoutBrackets = firstValue.startsWith('[') && firstValue.includes(']')
    ? firstValue.slice(1, firstValue.indexOf(']'))
    : firstValue;

  return withoutBrackets.startsWith('::ffff:')
    ? withoutBrackets.slice('::ffff:'.length)
    : withoutBrackets;
}

function getSocketAddress(socket: AgentSocket): string | undefined {
  const forwardedAddress = normalizePeerAddress(socket.handshake.headers['x-forwarded-for']);
  if (forwardedAddress) {
    return forwardedAddress;
  }

  return normalizePeerAddress(socket.handshake.address);
}

function stampServerId(
  serverId: string,
  data: AgentTaskQueueResponse,
): AgentTaskQueueResponse {
  const stamp = (tasks: MirroredAgentTaskRecord[]) =>
    tasks.map((t) => (t.serverId === serverId ? t : { ...t, serverId }));
  return {
    queued: stamp(data.queued),
    running: stamp(data.running),
    recent: stamp(data.recent),
  };
}

function createLiveSession(socket: AgentSocket, agentId: string): AgentLiveSession {
  return {
    agentId,
    emitCommand(command: ServerCommandEnvelope): void {
      switch (command.event) {
        case SERVER_COMMAND.cancelTask:
          socket.emit(SERVER_COMMAND.cancelTask, command.data);
          break;
        case SERVER_COMMAND.getTaskEvents:
          socket.emit(SERVER_COMMAND.getTaskEvents, command.data, () => undefined);
          break;
        case SERVER_COMMAND.getTaskAuditDetail:
          socket.emit(SERVER_COMMAND.getTaskAuditDetail, command.data, () => undefined);
          break;
        case SERVER_COMMAND.pauseQueue:
          socket.emit(SERVER_COMMAND.pauseQueue, command.data);
          break;
        case SERVER_COMMAND.resumeQueue:
          socket.emit(SERVER_COMMAND.resumeQueue, command.data);
          break;
        case SERVER_COMMAND.setPriority:
          socket.emit(SERVER_COMMAND.setPriority, command.data);
          break;
        case SERVER_COMMAND.getTaskQueue:
          socket.emit(SERVER_COMMAND.getTaskQueue, command.data, () => undefined);
          break;
      }
    },
    requestTaskEvents(payload: ServerGetTaskEventsPayload): Promise<AgentTaskEventsResponse> {
      return new Promise((resolve, reject) => {
        socket.timeout(5_000).emit(
          SERVER_COMMAND.getTaskEvents,
          payload,
          (error: Error | null, response: AgentTaskEventsResponse) => {
            if (error) {
              reject(new AgentCommandError('timeout'));
              return;
            }
            resolve(response);
          },
        );
      });
    },
    requestTaskAuditDetail(payload: ServerGetTaskAuditDetailPayload): Promise<AgentTaskAuditDetailResponse> {
      return new Promise((resolve, reject) => {
        socket.timeout(5_000).emit(
          SERVER_COMMAND.getTaskAuditDetail,
          payload,
          (error: Error | null, response: AgentTaskAuditDetailResponse) => {
            if (error) {
              reject(new AgentCommandError('timeout'));
              return;
            }
            resolve(response);
          },
        );
      });
    },
    requestTaskQueue(): Promise<AgentTaskQueueResponse> {
      return new Promise((resolve, reject) => {
        socket.timeout(5_000).emit(
          SERVER_COMMAND.getTaskQueue,
          {},
          (error: Error | null, response: AgentTaskQueueResponse) => {
            if (error) {
              reject(new AgentCommandError('timeout'));
              return;
            }
            resolve(response);
          },
        );
      });
    },
  };
}

function isCurrentState(
  states: Map<string, AgentConnectionState>,
  state: AgentConnectionState,
): boolean {
  return states.get(state.agentId)?.session === state.session;
}

function getAgentDataSource(scheduler: Scheduler, serverId: string): AgentDataSource | undefined {
  const dataSource = scheduler.getDataSource(serverId);
  return dataSource instanceof AgentDataSource ? dataSource : undefined;
}

function normalizeMetricsPayload(
  payload: unknown,
  serverId: string | undefined,
): MetricsSnapshot | undefined {
  if (!serverId || !isAgentMetricsPayload(payload)) {
    return undefined;
  }

  const normalizedPayload = payload.serverId === serverId
    ? payload
    : {
      ...payload,
      serverId,
    };

  const normalizedTimestamp = normalizeTimestamp(normalizedPayload.timestamp);
  if (normalizedTimestamp === normalizedPayload.timestamp) {
    return normalizedPayload;
  }

  return {
    ...normalizedPayload,
    timestamp: normalizedTimestamp,
  };
}


function normalizeLocalUsersPayload(
  payload: unknown,
  serverId: string | undefined,
  agentId: string,
): AgentLocalUsersPayload | undefined {
  if (!serverId) {
    return undefined;
  }

  if (isAgentLocalUsersPayload(payload)) {
    const normalizedPayload = {
      ...payload,
      serverId,
      agentId,
    };

    return {
      ...normalizedPayload,
      timestamp: normalizeTimestamp(normalizedPayload.timestamp),
    };
  }

  if (!isRecord(payload)) {
    return undefined;
  }

  const normalizedPayload = {
    ...payload,
    serverId,
    agentId,
  };

  if (!isAgentLocalUsersPayload(normalizedPayload)) {
    return undefined;
  }

  return {
    ...normalizedPayload,
    timestamp: normalizeTimestamp(normalizedPayload.timestamp),
  };
}

export function createAgentNamespace(
  io: SocketServer,
  scheduler: Scheduler,
  options: CreateAgentNamespaceOptions = {},
): AgentNamespaceRuntime {
  const registry = new AgentSessionRegistry();
  const namespace = io.of(AGENT_NAMESPACE) as AgentNamespace;
  const states = new Map<string, AgentConnectionState>();
  const now = options.now ?? (() => Date.now());
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
  const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const onTaskChanged = options.onTaskChanged;
  const onServerChanged = options.onServerChanged;

  const detachServerSession = (serverId: string | undefined, session?: AgentLiveSession, reason?: string): void => {
    if (!serverId) {
      return;
    }

    getAgentDataSource(scheduler, serverId)?.detachSession(session, reason);
  };

  const attachServerSession = (serverId: string, session: AgentLiveSession, version?: string): void => {
    scheduler.refreshServerDataSource(serverId);
    getAgentDataSource(scheduler, serverId)?.attachSession(session, version);
  };

  const clearSocketState = (socket: AgentSocket, state: AgentConnectionState): void => {
    if (socket.data.agentState?.session === state.session) {
      socket.data.agentState = undefined;
    }
  };

  const cleanupState = (state: AgentConnectionState): void => {
    if (!isCurrentState(states, state)) {
      clearSocketState(state.socket, state);
      return;
    }

    states.delete(state.agentId);
    registry.detachSession(state.agentId, state.session);
    detachServerSession(state.serverId, state.session, 'socket_disconnect');
    if (state.serverId) {
      clearTaskQueueCache(state.serverId);
    }
    clearSocketState(state.socket, state);
  };

  const refreshHeartbeat = (state: AgentConnectionState, timestamp: number): void => {
    const heartbeatAt = normalizeHeartbeatTimestamp(timestamp);
    state.lastHeartbeatAt = heartbeatAt;
    state.timedOut = false;
    registry.updateHeartbeat(state.agentId, heartbeatAt);

    if (!state.serverId) {
      return;
    }

    const dataSource = getAgentDataSource(scheduler, state.serverId);
    if (dataSource && !dataSource.isConnected()) {
      dataSource.attachSession(state.session);
    }
  };

  namespace.on('connection', (socket) => {
    socket.on(AGENT_EVENT.register, (payload: unknown) => {
      if (!isAgentRegisterPayload(payload)) {
        return;
      }

      const socketState = socket.data.agentState;
      if (socketState && socketState.agentId !== payload.agentId) {
        cleanupState(socketState);
      }

      const previous = states.get(payload.agentId);
      const session = createLiveSession(socket, payload.agentId);
      const socketAddress = getSocketAddress(socket);
      let resolution = resolveAgentBinding(payload.agentId, payload.hostname);
      if (resolution.status === 'unmatched') {
        resolution = autoCreateAgentServer(payload.agentId, payload.hostname, socketAddress);
      }
      const nextState: AgentConnectionState = {
        agentId: payload.agentId,
        session,
        socket,
        serverId: resolution.status === 'bound' ? resolution.server.id : undefined,
        lastHeartbeatAt: now(),
        timedOut: false,
        version: payload.version,
      };

      if (previous && previous.serverId && previous.serverId !== nextState.serverId) {
        detachServerSession(previous.serverId, previous.session);
      }

      states.set(payload.agentId, nextState);
      socket.data.agentState = nextState;
      registry.attachSession(session, {
        heartbeatAt: nextState.lastHeartbeatAt,
        serverId: nextState.serverId,
      });

      if (nextState.serverId) {
        attachServerSession(nextState.serverId, session, payload.version);
        onServerChanged?.();

        // Initial pull of task queue on registration
        session.requestTaskQueue().then((data) => {
          if (!isCurrentState(states, nextState) || !nextState.serverId) return;
          const normalized = stampServerId(nextState.serverId, data);
          const changed = diffTaskQueue(nextState.serverId, normalized);
          setTaskQueueCache(nextState.serverId, normalized);
          for (const task of changed) {
            recordTaskAttributionFact(task);
          }
        }).catch(() => { /* agent may not support getTaskQueue yet */ });
      }

      if (previous && previous.socket.id !== socket.id) {
        previous.socket.disconnect(true);
      }
    });

    socket.on(AGENT_EVENT.heartbeat, (payload: unknown) => {
      if (!isAgentHeartbeatPayload(payload)) {
        return;
      }

      const state = socket.data.agentState;
      if (!state || state.agentId !== payload.agentId || !isCurrentState(states, state)) {
        return;
      }

      refreshHeartbeat(state, payload.timestamp);
    });

    socket.on(AGENT_EVENT.metrics, (payload: unknown) => {
      const state = socket.data.agentState;
      const serverId = state?.serverId;
      if (!state || !serverId || !isCurrentState(states, state)) {
        return;
      }

      const snapshot = normalizeMetricsPayload(payload, serverId);
      if (!snapshot) {
        return;
      }

      scheduler.refreshServerDataSource(serverId);
      getAgentDataSource(scheduler, serverId)?.pushMetrics(snapshot);
      state.lastMetricsAt = now();
    });

    socket.on(AGENT_EVENT.taskChanged, () => {
      const state = socket.data.agentState;
      if (!state || !state.serverId || !isCurrentState(states, state)) {
        return;
      }

      const serverId = state.serverId;
      state.session.requestTaskQueue().then((data) => {
        if (!isCurrentState(states, state)) return;
        const normalized = stampServerId(serverId, data);
        const changed = diffTaskQueue(serverId, normalized);
        setTaskQueueCache(serverId, normalized);
        for (const task of changed) {
          recordTaskAttributionFact(task);
        }
        if (changed.length > 0) {
          onTaskChanged?.(serverId, changed);
        }
      }).catch(() => { /* pull failed, stale cache remains */ });
    });

    socket.on(AGENT_EVENT.localUsers, (payload: unknown) => {
      const state = socket.data.agentState;
      if (!state || !isCurrentState(states, state)) {
        return;
      }

      const inventory = normalizeLocalUsersPayload(payload, state.serverId, state.agentId);
      if (!inventory) {
        return;
      }

      ingestAgentLocalUsers(inventory);
    });

    socket.on('disconnect', () => {
      const state = socket.data.agentState;
      if (!state) {
        return;
      }

      cleanupState(state);
    });
  });

  const getMetricsTimeoutMs = options.getMetricsTimeoutMs;
  const DEFAULT_METRICS_TIMEOUT_MS = 15_000;

  const sweepTimer = setInterval(() => {
    const currentTime = now();
    const metricsTimeout = getMetricsTimeoutMs ? getMetricsTimeoutMs() : DEFAULT_METRICS_TIMEOUT_MS;

    for (const state of states.values()) {
      if (state.timedOut) {
        continue;
      }

      // Metrics-based timeout for nodes that have reported at least once
      if (state.lastMetricsAt !== undefined) {
        if (currentTime - state.lastMetricsAt > metricsTimeout) {
          state.timedOut = true;
          detachServerSession(state.serverId, state.session, 'metrics_timeout');
          continue;
        }
      }

      // Heartbeat-based timeout as fallback (session health)
      if (currentTime - state.lastHeartbeatAt > heartbeatTimeoutMs) {
        state.timedOut = true;
        detachServerSession(state.serverId, state.session, 'heartbeat_timeout');
      }
    }
  }, sweepIntervalMs);

  const stop = (): void => {
    clearInterval(sweepTimer);
  };

  return {
    registry,
    namespace,
    stop,
  };
}