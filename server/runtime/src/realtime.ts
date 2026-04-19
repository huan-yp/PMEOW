import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Server as SocketServer, Namespace } from "socket.io";
import type { AlertStateChange, SecurityEventRecord, TaskEvent, UnifiedReport, Principal } from "@pmeow/core";
import {
  AGENT_EVENT,
  isAgentRegisterPayload,
  parseUnifiedReport,
  AgentSessionRegistry,
  IngestPipeline,
  getServerByAgentId,
  createServer,
  createAgentSession,
  canAccessServer,
  canAccessTask,
} from "@pmeow/core";

const AGENT_NAMESPACE = "/agent";
const REPORT_DEBUG_ENV = "PMEOW_WEB_DEBUG_REPORTS";
const REPORT_DEBUG_PATH_ENV = "PMEOW_WEB_DEBUG_REPORT_PATH";
const REPORT_DEBUG_INTERVAL = 5;
const DEFAULT_LOG_FILE_NAME = "web-agent-report-debug.ndjson";
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export interface UIBroadcast {
  metricsUpdate(serverId: string, report: UnifiedReport): void;
  taskEvent(event: TaskEvent): void;
  alertStateChange(change: AlertStateChange): void;
  securityEvent(event: SecurityEventRecord): void;
  serverStatus(data: { serverId: string; status: string; lastSeenAt: number; version?: string }): void;
  serversChanged(): void;
}

export interface AgentReportDebugLogger {
  logReceivedReport(agentId: string, serverId: string, payload: unknown): void;
}

interface AgentReportDebugEntry {
  loggedAt: string;
  receivedCount: number;
  agentId: string;
  serverId: string;
  payload: unknown;
}

interface AgentReportDebugLoggerOptions {
  enabled?: boolean;
  logPath?: string;
  interval?: number;
  now?: () => string;
  logger?: Pick<typeof console, "warn">;
}

export function createUIBroadcast(namespace: Namespace): UIBroadcast {
  function forEachSocket(fn: (socket: any, principal: Principal) => void): void {
    for (const [, socket] of namespace.sockets) {
      const principal = socket.data.principal as Principal | undefined;
      if (principal) {
        fn(socket, principal);
      }
    }
  }

  return {
    metricsUpdate(serverId, report) {
      forEachSocket((socket, principal) => {
        if (canAccessServer(principal, serverId)) {
          socket.emit("metricsUpdate", { serverId, report });
        }
      });
    },
    taskEvent(event) {
      forEachSocket((socket, principal) => {
        if (canAccessTask(principal, event.serverId, event.task.user)) {
          socket.emit("taskEvent", { serverId: event.serverId, eventType: event.eventType, task: event.task });
        }
      });
    },
    alertStateChange(change) {
      forEachSocket((socket, principal) => {
        if (principal.kind === "admin") {
          socket.emit("alertStateChange", {
            alert: change.alert,
            fromStatus: change.fromStatus,
            toStatus: change.toStatus,
          });
        }
      });
    },
    securityEvent(event) {
      forEachSocket((socket, principal) => {
        if (principal.kind === "admin") {
          socket.emit("securityEvent", event);
        }
      });
    },
    serverStatus(data) {
      forEachSocket((socket, principal) => {
        if (canAccessServer(principal, data.serverId)) {
          socket.emit("serverStatus", data);
        }
      });
    },
    serversChanged() {
      namespace.emit("serversChanged", {});
    },
  };
}

export function isAgentReportDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[REPORT_DEBUG_ENV] === "1";
}

export function resolveAgentReportDebugLogPath(env: NodeJS.ProcessEnv = process.env): string {
  const configuredPath = env[REPORT_DEBUG_PATH_ENV]?.trim();
  if (configuredPath) {
    return path.resolve(configuredPath);
  }

  return path.resolve(moduleDir, "../../..", "data", "logs", DEFAULT_LOG_FILE_NAME);
}

export function createAgentReportDebugLogger(
  options: AgentReportDebugLoggerOptions = {},
): AgentReportDebugLogger {
  const enabled = options.enabled ?? isAgentReportDebugEnabled();
  if (!enabled) {
    return { logReceivedReport() {} };
  }

  const logPath = options.logPath ?? resolveAgentReportDebugLogPath();
  const interval = options.interval ?? REPORT_DEBUG_INTERVAL;
  const now = options.now ?? (() => new Date().toISOString());
  const logger = options.logger ?? console;
  let receivedCount = 0;

  return {
    logReceivedReport(agentId: string, serverId: string, payload: unknown): void {
      receivedCount += 1;
      if (receivedCount % interval !== 0) {
        return;
      }

      const entry: AgentReportDebugEntry = {
        loggedAt: now(),
        receivedCount,
        agentId,
        serverId,
        payload,
      };

      try {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
      } catch (error) {
        logger.warn(
          `[agent-report-debug] failed to append ${logPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}

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
      broadcast?.serverStatus({ serverId: server.id, status: "online", lastSeenAt: Date.now(), version: payload.version ?? "" });
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
        console.warn(`[agent] invalid report from ${agentId}:`, typeof payload, payload && typeof payload === "object" ? Object.keys(payload) : payload);
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
          broadcast?.serverStatus({ serverId, status: "offline", lastSeenAt: Date.now() });
        }
      }
    });
  });

  return ns;
}