import { EventEmitter } from 'events';
import type { MetricsSnapshot, ConnectionStatus } from '../types.js';
import { SERVER_COMMAND, type ServerCommandEnvelope } from '../agent/protocol.js';
import type { AgentLiveSession } from '../agent/registry.js';
import type { AgentCommandDataSource, NodeDataSource } from './types.js';

/**
 * AgentDataSource receives metrics pushed by a remote Python Agent via WebSocket.
 * This is a stub — full Agent WebSocket handling is in Plan 3.
 */
export class AgentDataSource extends EventEmitter implements NodeDataSource, AgentCommandDataSource {
  readonly type = 'agent' as const;
  readonly serverId: string;
  readonly agentId: string | null;

  private connected = false;
  private latestSnapshot: MetricsSnapshot | null = null;
  private liveSession: AgentLiveSession | null = null;

  constructor(serverId: string, agentId: string | null = null) {
    super();
    this.serverId = serverId;
    this.agentId = agentId;
  }

  async connect(): Promise<void> {
    // Agent connects to us; this is a no-op.
    // Connection state is updated when Agent registers.
  }

  disconnect(): void {
    this.detachSession();
  }

  isConnected(): boolean {
    return this.connected;
  }

  getConnectionStatus(): ConnectionStatus {
    return this.connected ? 'connected' : 'disconnected';
  }

  async collectMetrics(): Promise<MetricsSnapshot | null> {
    // Agent mode: return the latest pushed snapshot (passive, no pull).
    return this.latestSnapshot;
  }

  /** Called when Agent pushes a metrics snapshot via WebSocket. */
  pushMetrics(snapshot: MetricsSnapshot): void {
    this.latestSnapshot = snapshot;
    this.connected = true;
    this.emit('metricsReceived', snapshot);
  }

  attachSession(session: AgentLiveSession): void {
    this.liveSession = session;
    this.connected = true;
  }

  detachSession(session?: AgentLiveSession): void {
    if (session !== undefined && this.liveSession !== session) {
      return;
    }

    this.liveSession = null;
    this.connected = false;
    this.latestSnapshot = null;
  }

  /** Called when Agent registers or reconnects. */
  setConnected(connected: boolean): void {
    this.connected = connected;
    if (!connected) {
      this.liveSession = null;
      this.latestSnapshot = null;
    }
  }

  cancelTask(taskId: string): void {
    this.emitCommand({
      event: SERVER_COMMAND.cancelTask,
      data: { taskId },
    });
  }

  pauseQueue(): void {
    this.emitCommand({
      event: SERVER_COMMAND.pauseQueue,
      data: {},
    });
  }

  resumeQueue(): void {
    this.emitCommand({
      event: SERVER_COMMAND.resumeQueue,
      data: {},
    });
  }

  setPriority(taskId: string, priority: number): void {
    this.emitCommand({
      event: SERVER_COMMAND.setPriority,
      data: { taskId, priority },
    });
  }

  private emitCommand(command: ServerCommandEnvelope): void {
    this.requireLiveSession().emitCommand(command);
  }

  private requireLiveSession(): AgentLiveSession {
    if (this.liveSession === null) {
      throw new Error(`Agent server ${this.serverId} is offline`);
    }

    return this.liveSession;
  }
}
