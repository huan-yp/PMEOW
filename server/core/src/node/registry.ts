export interface AgentSession {
  readonly agentId: string;
  readonly serverId: string;
  emit(event: string, data: unknown): void;
}

export class AgentSessionRegistry {
  private sessions = new Map<string, AgentSession>();
  private lastReportAt = new Map<string, number>();
  
  attachSession(session: AgentSession): void {
    this.sessions.set(session.agentId, session);
    if (!this.lastReportAt.has(session.agentId)) {
      this.lastReportAt.set(session.agentId, Date.now());
    }
  }

  detachSession(agentId: string): void {
    this.sessions.delete(agentId);
  }

  getSession(agentId: string): AgentSession | undefined {
    return this.sessions.get(agentId);
  }

  getSessionByServerId(serverId: string): AgentSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.serverId === serverId) return session;
    }
    return undefined;
  }

  updateLastReport(agentId: string, timestamp: number): void {
    this.lastReportAt.set(agentId, timestamp);
  }

  getLastReportAt(agentId: string): number | undefined {
    return this.lastReportAt.get(agentId);
  }

  getAllSessions(): AgentSession[] {
    return Array.from(this.sessions.values());
  }

  getOnlineServerIds(): string[] {
    return this.getAllSessions().map(s => s.serverId);
  }
}
