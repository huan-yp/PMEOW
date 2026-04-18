import type { Socket } from 'socket.io';
import { AgentSession } from './registry.js';

export function createAgentSession(agentId: string, serverId: string, socket: Socket): AgentSession {
  return {
    agentId,
    serverId,
    emit(event: string, data: unknown) {
      socket.emit(event, data);
    }
  };
}
