import type { Server as SocketServer, Socket, Namespace } from "socket.io";
import {
  AGENT_EVENT,
  isAgentRegisterPayload,
  parseUnifiedReport,
  AgentSessionRegistry,
  IngestPipeline,
  getServerByAgentId,
  createServer,
  createAgentSession,
} from "@monitor/core";
import type { AgentReportDebugLogger } from "./agent-report-debug-log.js";
import type { UIBroadcast } from "./ui-broadcast.js";

const AGENT_NAMESPACE = "/agent";

export function createAgentNamespace(
  io: SocketServer,
  registry: AgentSessionRegistry,
  pipeline: IngestPipeline,
  broadcast?: UIBroadcast,
  reportDebugLogger?: AgentReportDebugLogger,
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
      broadcast?.serverStatus({ serverId: server.id, status: 'online', lastSeenAt: Date.now(), version: payload.version ?? '' });
      broadcast?.serversChanged();
    });
    
    socket.on(AGENT_EVENT.report, (payload: unknown) => {
      if (!agentId) return;

      const session = registry.getSession(agentId);
      if (!session) {
        console.warn(`[agent] report from unregistered agent ${agentId}, ignoring`);
        return;
      }

      reportDebugLogger?.logReceivedReport(agentId, session.serverId, payload);

      const report = parseUnifiedReport(payload);
      if (!report) {
        console.warn(`[agent] invalid report from ${agentId}:`, typeof payload, payload && typeof payload === 'object' ? Object.keys(payload) : payload);
        return;
      }
      
      registry.updateLastReport(agentId, Date.now());
      pipeline.processReport(session.serverId, report);
    });
    
    socket.on("disconnect", () => {
      if (agentId) {
        const session = registry.getSession(agentId);
        const serverId = session?.serverId;
        registry.detachSession(agentId);
        console.log(`[agent] disconnected: ${agentId}`);
        if (serverId) {
          broadcast?.serverStatus({ serverId, status: 'offline', lastSeenAt: Date.now() });
        }
      }
    });
  });
  
  return ns;
}
