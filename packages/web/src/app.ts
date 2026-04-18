import fs from "fs";
import { createServer, type Server as HttpServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import express, { type Express } from "express";
import { Server as SocketServer } from "socket.io";
import {
  getDatabase,
  AgentSessionRegistry,
  IngestPipeline,
  SnapshotScheduler,
  getSettings,
  collectOfflineCandidates,
  reconcileAlerts,
  type AlertStateChange,
  type SecurityEventRecord,
  type TaskEvent,
  type UnifiedReport,
} from "@monitor/core";
import { loginHandler, authMiddleware, socketAuthMiddleware } from "./auth.js";
import { createAgentNamespace } from "./agent-namespace.js";
import {
  createAgentReportDebugLogger,
  isAgentReportDebugEnabled,
  resolveAgentReportDebugLogPath,
} from "./agent-report-debug-log.js";
import { createUIBroadcast } from "./ui-broadcast.js";
import { serverRoutes } from "./routes/server-routes.js";
import { metricsRoutes } from "./routes/metrics-routes.js";
import { taskRoutes } from "./routes/task-routes.js";
import { personRoutes } from "./routes/person-routes.js";
import { alertRoutes } from "./routes/alert-routes.js";
import { securityRoutes } from "./routes/security-routes.js";
import { settingsRoutes } from "./routes/settings-routes.js";

const DEFAULT_PORT = Number(process.env.PORT) || 17200;
const DEFAULT_HOST = "0.0.0.0";
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function resolvePublicDir(): string | null {
  const configuredDir = process.env.PMEOW_WEB_PUBLIC_DIR?.trim();
  const candidateDirs = [
    configuredDir,
    path.join(moduleDir, "public"),
    path.resolve(moduleDir, "..", "dist", "public"),
    path.resolve(moduleDir, "..", "..", "ui", "dist"),
  ].filter((value): value is string => Boolean(value));

  for (const candidateDir of candidateDirs) {
    const indexFile = path.join(candidateDir, "index.html");
    if (fs.existsSync(indexFile)) {
      return candidateDir;
    }
  }

  return null;
}

export interface WebRuntime {
  app: Express;
  httpServer: HttpServer;
  io: SocketServer;
  registry: AgentSessionRegistry;
  pipeline: IngestPipeline;
  start: (port?: number) => Promise<number>;
  stop: () => Promise<void>;
}

export function createWebRuntime(): WebRuntime {
  getDatabase();
  
  const registry = new AgentSessionRegistry();
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, { cors: { origin: "*" } });
  
  const uiNamespace = io.of("/");
  const broadcast = createUIBroadcast(uiNamespace);
  const reportDebugLogger = createAgentReportDebugLogger();

  if (isAgentReportDebugEnabled()) {
    console.info(`[agent-report-debug] enabled: every 5 reports -> ${resolveAgentReportDebugLogPath()}`);
  }
  
  const snapshotScheduler = new SnapshotScheduler();
  
  const pipeline = new IngestPipeline({
    onMetricsUpdate: (serverId, report) => broadcast.metricsUpdate(serverId, report),
    onTaskEvent: (event) => broadcast.taskEvent(event),
    onAlertStateChange: (change) => broadcast.alertStateChange(change),
    onSecurityEvent: (event) => broadcast.securityEvent(event),
  });
  
  let offlineTimer: ReturnType<typeof setInterval> | null = null;
  let started = false;
  let stoppingPromise: Promise<void> | null = null;
  
  app.use(cors());
  app.use(express.json());
  app.post("/api/login", loginHandler);
  app.use("/api", authMiddleware);
  
  app.use("/api", serverRoutes(registry));
  app.use("/api", metricsRoutes(pipeline));
  app.use("/api", taskRoutes(registry));
  app.use("/api", personRoutes());
  app.use("/api", alertRoutes());
  app.use("/api", securityRoutes());
  app.use("/api", settingsRoutes());
  
  createAgentNamespace(io, registry, pipeline, broadcast, reportDebugLogger);
  
  uiNamespace.use(socketAuthMiddleware);
  uiNamespace.on("connect_error", (error) => {
    console.warn(`[ws] namespace connect_error: ${error.message}`);
  });
  uiNamespace.on("connection", (socket) => {
    const authUser = socket.data.user as Record<string, unknown> | undefined;
    console.info(
      `[ws] client connected: ${socket.id} address=${socket.handshake.address} transport=${socket.conn.transport.name} role=${String(authUser?.role ?? 'unknown')}`,
    );
    socket.conn.on("upgrade", () => {
      console.info(`[ws] transport upgraded: ${socket.id} -> ${socket.conn.transport.name}`);
    });
    socket.on("disconnecting", (reason) => {
      console.info(`[ws] client disconnecting: ${socket.id} reason=${reason}`);
    });
    socket.on("disconnect", (reason) => {
      console.info(`[ws] client disconnected: ${socket.id} reason=${reason}`);
    });
    socket.on("error", (error) => {
      console.warn(`[ws] socket error: ${socket.id} message=${error instanceof Error ? error.message : String(error)}`);
    });
  });
  
  const publicDir = resolvePublicDir();
  if (publicDir) {
    app.use(express.static(publicDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(publicDir, "index.html"));
    });
  }
  
  const start = async (port = DEFAULT_PORT): Promise<number> => {
    if (started) return port;
    
    const host = process.env.HOST?.trim() || DEFAULT_HOST;
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.once("listening", () => {
        httpServer.off("error", reject);
        started = true;
        resolve();
      });
      httpServer.listen(port, host);
    });
    
    offlineTimer = setInterval(() => {
      const settings = getSettings();
      const offlineResults = collectOfflineCandidates(registry, settings);
      for (const { serverId, candidates } of offlineResults) {
        const changes = reconcileAlerts(serverId, candidates);
        for (const change of changes) {
          broadcast.alertStateChange(change);
        }
      }
    }, 10_000);
    
    const addr = httpServer.address();
    return addr && typeof addr === "object" ? addr.port : port;
  };
  
  const stop = async (): Promise<void> => {
    if (stoppingPromise) return stoppingPromise;
    stoppingPromise = (async () => {
      if (offlineTimer) { clearInterval(offlineTimer); offlineTimer = null; }
      if (!httpServer.listening) { io.close(); started = false; return; }
      await new Promise<void>(r => io.close(() => r()));
      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) => httpServer.close(e => e ? reject(e) : resolve()));
      }
      started = false;
    })();
    return stoppingPromise;
  };
  
  return { app, httpServer, io, registry, pipeline, start, stop };
}
