import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPORT_DEBUG_ENV = "PMEOW_WEB_DEBUG_REPORTS";
const REPORT_DEBUG_PATH_ENV = "PMEOW_WEB_DEBUG_REPORT_PATH";
const REPORT_DEBUG_INTERVAL = 5;
const DEFAULT_LOG_FILE_NAME = "web-agent-report-debug.ndjson";
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

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