import { getAgentTasksByServerId } from '../db/agent-tasks.js';
import {
  getGpuUsageByServerIdAndTimestamp,
  getLatestUnownedGpuDurationMinutes,
} from '../db/gpu-usage.js';
import { getLatestMetrics } from '../db/metrics.js';
import { createSecurityEvent, findOpenSecurityEvent } from '../db/security-events.js';
import { buildProcessAuditRows } from './audit.js';
import { analyzeSecuritySnapshot } from './analyzer.js';
import type { AppSettings, MetricsSnapshot, SecurityEventRecord } from '../types.js';

export function processSecuritySnapshot(
  serverId: string,
  settings: AppSettings,
  now = Date.now(),
  snapshot?: MetricsSnapshot,
): SecurityEventRecord[] {
  const snapshotToAnalyze = snapshot ?? getLatestMetrics(serverId);
  if (!snapshotToAnalyze || !snapshotToAnalyze.gpu.available) {
    return [];
  }

  const gpuRows = getGpuUsageByServerIdAndTimestamp(serverId, snapshotToAnalyze.timestamp);
  const tasks = getAgentTasksByServerId(serverId);
  const hasRunningPmeowTasks = tasks.some((task) => task.status === 'running');
  const maxGapMs = Math.max(settings.refreshIntervalMs * 2, 90_000);
  const unownedGpuMinutes = getLatestUnownedGpuDurationMinutes(serverId, now, maxGapMs);

  const auditRows = buildProcessAuditRows(snapshotToAnalyze, gpuRows, {
    securityMiningKeywords: settings.securityMiningKeywords,
    unownedGpuMinutes,
    hasRunningPmeowTasks,
  });
  const findings = analyzeSecuritySnapshot({ snapshot: snapshotToAnalyze, auditRows });
  const created: SecurityEventRecord[] = [];

  for (const finding of findings) {
    const existing = findOpenSecurityEvent(serverId, finding.eventType, finding.fingerprint);
    if (existing) {
      continue;
    }

    created.push(createSecurityEvent(finding));
  }

  return created;
}