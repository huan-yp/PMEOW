import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgentReportDebugLogger,
  isAgentReportDebugEnabled,
  resolveAgentReportDebugLogPath,
} from "../src/agent-report-debug-log.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("agent report debug logger", () => {
  it("appends the raw payload every fifth report when enabled", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pmeow-web-debug-"));
    const logPath = path.join(tempDir, "agent-report.ndjson");
    tempDirs.push(tempDir);

    const logger = createAgentReportDebugLogger({
      enabled: true,
      logPath,
      now: () => "2026-04-17T22:50:00.000Z",
    });

    for (let seq = 1; seq <= 5; seq += 1) {
      logger.logReceivedReport("agent-gpu", "server-gpu", { seq, gpuCards: [{ index: 0, managedReservedMb: 24_576 }] });
    }

    const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      loggedAt: "2026-04-17T22:50:00.000Z",
      receivedCount: 5,
      agentId: "agent-gpu",
      serverId: "server-gpu",
      payload: {
        seq: 5,
        gpuCards: [{ index: 0, managedReservedMb: 24_576 }],
      },
    });
  });

  it("does not create a log file when disabled", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pmeow-web-debug-"));
    const logPath = path.join(tempDir, "agent-report.ndjson");
    tempDirs.push(tempDir);

    const logger = createAgentReportDebugLogger({ enabled: false, logPath });

    for (let seq = 1; seq <= 10; seq += 1) {
      logger.logReceivedReport("agent-gpu", "server-gpu", { seq });
    }

    expect(fs.existsSync(logPath)).toBe(false);
  });

  it("reads the enable flag and log path from environment", () => {
    const warn = vi.fn();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pmeow-web-debug-"));
    const logPath = path.join(tempDir, "custom", "report.ndjson");
    tempDirs.push(tempDir);

    expect(isAgentReportDebugEnabled({ PMEOW_WEB_DEBUG_REPORTS: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(resolveAgentReportDebugLogPath({ PMEOW_WEB_DEBUG_REPORT_PATH: logPath } as NodeJS.ProcessEnv)).toBe(logPath);

    const logger = createAgentReportDebugLogger({
      enabled: true,
      logPath,
      interval: 1,
      logger: { warn },
    });

    logger.logReceivedReport("agent-gpu", "server-gpu", { seq: 1 });

    expect(fs.existsSync(logPath)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});