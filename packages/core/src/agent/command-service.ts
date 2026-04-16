import type { AgentTaskAuditDetail, AgentTaskEventRecord } from '../types.js';
import { AgentCommandError } from './errors.js';
import type { AgentSessionRegistry } from './registry.js';
import { AgentDataSource } from '../datasource/agent-datasource.js';
import type { NodeDataSource } from '../datasource/types.js';

export interface AgentCommandServiceOptions {
  agentRegistry: AgentSessionRegistry;
  getDataSource: (serverId: string) => NodeDataSource | undefined;
  refreshDataSource?: (serverId: string) => void;
}

export class AgentCommandService {
  private readonly registry: AgentSessionRegistry;
  private readonly getDataSource: (serverId: string) => NodeDataSource | undefined;
  private readonly refreshDataSource: ((serverId: string) => void) | undefined;

  constructor(options: AgentCommandServiceOptions) {
    this.registry = options.agentRegistry;
    this.getDataSource = options.getDataSource;
    this.refreshDataSource = options.refreshDataSource;
  }

  cancelTask(serverId: string, taskId: string): void {
    const ds = this.resolveAgentDataSource(serverId);
    ds.cancelTask(taskId);
  }

  pauseQueue(serverId: string): void {
    const ds = this.resolveAgentDataSource(serverId);
    ds.pauseQueue();
  }

  resumeQueue(serverId: string): void {
    const ds = this.resolveAgentDataSource(serverId);
    ds.resumeQueue();
  }

  setPriority(serverId: string, taskId: string, priority: number): void {
    const ds = this.resolveAgentDataSource(serverId);
    ds.setPriority(taskId, priority);
  }

  async getTaskEvents(serverId: string, taskId: string, afterId = 0): Promise<AgentTaskEventRecord[]> {
    const ds = this.resolveAgentDataSource(serverId);
    try {
      return await ds.getTaskEvents(taskId, afterId);
    } catch (error) {
      throw this.wrapTransportError(error);
    }
  }

  async getTaskAuditDetail(serverId: string, taskId: string): Promise<AgentTaskAuditDetail | null> {
    const ds = this.resolveAgentDataSource(serverId);
    try {
      return await ds.getTaskAuditDetail(taskId);
    } catch (error) {
      throw this.wrapTransportError(error);
    }
  }

  private resolveAgentDataSource(serverId: string): AgentDataSource {
    this.refreshDataSource?.(serverId);

    const dataSource = this.getDataSource(serverId);
    if (!dataSource) {
      throw new AgentCommandError('offline');
    }

    if (!(dataSource instanceof AgentDataSource)) {
      throw new AgentCommandError('invalid_target');
    }

    if (!this.registry.hasSessionByServerId(serverId) || !dataSource.hasLiveSession()) {
      throw new AgentCommandError('offline');
    }

    return dataSource;
  }

  private wrapTransportError(error: unknown): AgentCommandError {
    if (error instanceof AgentCommandError) {
      return error;
    }

    if (error instanceof Error) {
      if (error.message.includes('timeout') || error.message.includes('Timeout')) {
        return new AgentCommandError('timeout');
      }
    }

    return new AgentCommandError('internal', error instanceof Error ? error.message : '命令执行失败');
  }
}
