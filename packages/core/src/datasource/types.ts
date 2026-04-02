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

export interface AgentCommandDataSource extends NodeDataSource {
  readonly type: 'agent';
  readonly agentId: string | null;

  cancelTask(taskId: string): void;
  pauseQueue(): void;
  resumeQueue(): void;
  setPriority(taskId: string, priority: number): void;
}

export function isAgentCommandDataSource(
  dataSource: NodeDataSource,
): dataSource is AgentCommandDataSource {
  const candidate = dataSource as Partial<AgentCommandDataSource>;

  return dataSource.type === 'agent'
    && typeof candidate.cancelTask === 'function'
    && typeof candidate.pauseQueue === 'function'
    && typeof candidate.resumeQueue === 'function'
    && typeof candidate.setPriority === 'function';
}
