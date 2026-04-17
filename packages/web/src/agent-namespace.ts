import type { Server as SocketServer, Socket, Namespace } from "socket.io";
import {
  AGENT_EVENT,
  SERVER_COMMAND,
  isAgentRegisterPayload,
  isUnifiedReport,
  AgentSessionRegistry,
  IngestPipeline,
  getServerByAgentId,
  createServer,
  createAgentSession,
  type AgentRegisterPayload,
  type UnifiedReport,
} from "@monitor/core";

const AGENT_NAMESPACE = "/agent";

export function createAgentNamespace(
  io: SocketServer,
  registry: AgentSessionRegistry,
  pipeline: IngestPipeline,
): Namespace {
  const ns = io.of(AGENT_NAMESPACE);
  
  ns.on("connection", (socket) => {
    let agentId: string | null = null;
    
    socket.on(AGENT_EVENT.register, (payload: unknown) => {
      if (!isAgentRegisterPayload(payload)) return;
      
      agentId = payload.agentId;
      let server = getServerByAgentId(agentId);
      if (!server) {
        server = createServer({ name: payload.hostname, agentId });
      }
      
      const session = createAgentSession(agentId, server.id, socket);
      registry.attachSession(session);
      
      console.log(`[agent] registered: ${agentId} → server ${server.id}`);
    });
    
    socket.on(AGENT_EVENT.report, (payload: unknown) => {
      if (!agentId) return;
      if (!isUnifiedReport(payload)) return;
      
      const session = registry.getSession(agentId);
      if (!session) return;
      
      registry.updateLastReport(agentId, Date.now());
      pipeline.processReport(session.serverId, payload as UnifiedReport);
    });
    
    socket.on("disconnect", () => {
      if (agentId) {
        registry.detachSession(agentId);
        console.log(`[agent] disconnected: ${agentId}`);
      }
    });
  });
  
  return ns;
}
