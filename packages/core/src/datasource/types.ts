import type { MetricsSnapshot, ConnectionStatus } from '../types.js';

export interface NodeDataSource {
  readonly type: 'ssh' | 'agent';
  readonly serverId: string;

  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  getConnectionStatus(): ConnectionStatus;

  /**
   * Collect metrics from this node.
   * For SSH: executes remote commands.
   * For Agent: returns the latest pushed snapshot (or null if none).
   */
  collectMetrics(): Promise<MetricsSnapshot | null>;
}
