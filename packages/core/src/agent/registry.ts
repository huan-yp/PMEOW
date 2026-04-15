import type { AgentTaskEventsResponse, ServerCommandEnvelope, ServerGetTaskEventsPayload } from './protocol.js';

export interface AgentLiveSession {
  readonly agentId: string;
  emitCommand(command: ServerCommandEnvelope): void;
  requestTaskEvents(payload: ServerGetTaskEventsPayload): Promise<AgentTaskEventsResponse>;
}

export interface AttachAgentSessionOptions {
  serverId?: string;
  heartbeatAt?: number;
}

export class AgentSessionRegistry {
  private readonly sessionsByAgentId = new Map<string, AgentLiveSession>();
  private readonly serverIdByAgentId = new Map<string, string>();
  private readonly agentIdByServerId = new Map<string, string>();
  private readonly lastHeartbeatByAgentId = new Map<string, number>();

  attachSession(
    session: AgentLiveSession,
    options: AttachAgentSessionOptions = {},
  ): AgentLiveSession {
    this.sessionsByAgentId.set(session.agentId, session);

    if (options.serverId !== undefined) {
      this.bindServer(session.agentId, options.serverId);
    }

    if (options.heartbeatAt !== undefined) {
      this.updateHeartbeat(session.agentId, options.heartbeatAt);
    }

    return session;
  }

  getSession(agentId: string): AgentLiveSession | undefined {
    return this.sessionsByAgentId.get(agentId);
  }

  getAgentIdByServerId(serverId: string): string | undefined {
    return this.agentIdByServerId.get(serverId);
  }

  hasSessionByServerId(serverId: string): boolean {
    return this.getSessionByServerId(serverId) !== undefined;
  }

  detachSession(agentId: string, session?: AgentLiveSession): void {
    if (session !== undefined && this.sessionsByAgentId.get(agentId) !== session) {
      return;
    }

    this.sessionsByAgentId.delete(agentId);
  }

  bindServer(agentId: string, serverId: string): void {
    const previousServerId = this.serverIdByAgentId.get(agentId);
    if (previousServerId !== undefined && previousServerId !== serverId) {
      this.agentIdByServerId.delete(previousServerId);
    }

    const previousAgentId = this.agentIdByServerId.get(serverId);
    if (previousAgentId !== undefined && previousAgentId !== agentId) {
      this.serverIdByAgentId.delete(previousAgentId);
    }

    this.serverIdByAgentId.set(agentId, serverId);
    this.agentIdByServerId.set(serverId, agentId);
  }

  getSessionByServerId(serverId: string): AgentLiveSession | undefined {
    const agentId = this.agentIdByServerId.get(serverId);
    if (agentId === undefined) {
      return undefined;
    }

    return this.sessionsByAgentId.get(agentId);
  }

  updateHeartbeat(agentId: string, timestamp: number): number {
    this.lastHeartbeatByAgentId.set(agentId, timestamp);
    return timestamp;
  }

  getLastHeartbeat(agentId: string): number | undefined {
    return this.lastHeartbeatByAgentId.get(agentId);
  }
}
