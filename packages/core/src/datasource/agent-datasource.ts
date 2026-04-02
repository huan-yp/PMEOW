import { EventEmitter } from 'events';
import type { MetricsSnapshot, ConnectionStatus } from '../types.js';
import type { NodeDataSource } from './types.js';

/**
 * AgentDataSource receives metrics pushed by a remote Python Agent via WebSocket.
 * This is a stub — full Agent WebSocket handling is in Plan 3.
 */
export class AgentDataSource extends EventEmitter implements NodeDataSource {
  readonly type = 'agent' as const;
  readonly serverId: string;

  private connected = false;
  private latestSnapshot: MetricsSnapshot | null = null;

  constructor(serverId: string) {
    super();
    this.serverId = serverId;
  }

  async connect(): Promise<void> {
    // Agent connects to us; this is a no-op.
    // Connection state is updated when Agent registers.
  }

  disconnect(): void {
    this.connected = false;
    this.latestSnapshot = null;
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

  /** Called when Agent registers or reconnects. */
  setConnected(connected: boolean): void {
    this.connected = connected;
    if (!connected) {
      this.latestSnapshot = null;
    }
  }
}
