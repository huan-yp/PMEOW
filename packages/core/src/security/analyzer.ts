import { createHash } from 'node:crypto';
import { getProcessAuditFindings, hasProcessAuditFindings, type ProcessAuditFinding } from './audit.js';
import type { SecurityEventInput } from '../db/security-events.js';
import type { MetricsSnapshot, ProcessAuditRow, SecurityEventDetails, SecurityEventType } from '../types.js';

export interface AnalyzeSecuritySnapshotInput {
  snapshot: MetricsSnapshot;
  auditRows: ProcessAuditRow[];
}

export interface CheckHighGpuUtilizationInput {
  serverId: string;
  snapshot: MetricsSnapshot;
  hasRunningPmeowTasks: boolean;
  thresholdPercent: number;
  durationMinutes: number;
  collectionIntervalMs: number;
}

interface HighGpuCounter {
  count: number;
  lastSeen: number;
}

const highGpuUtilizationCounts = new Map<string, HighGpuCounter>();
const STALE_THRESHOLD_MS = 30 * 60_000;

export function buildSecurityFingerprint(
  serverId: string,
  eventType: SecurityEventType,
  details: SecurityEventDetails,
): string {
  const normalized = JSON.stringify(sortValue({ serverId, eventType, details }));
  return createHash('sha256').update(normalized).digest('hex');
}

export function analyzeSecuritySnapshot({ snapshot, auditRows }: AnalyzeSecuritySnapshotInput): SecurityEventInput[] {
  const events: SecurityEventInput[] = [];

  for (const row of auditRows) {
    const findings = getStructuredOrLegacyFindings(row);

    for (const finding of findings) {
      if (finding.kind === 'high_utilization') {
        continue;
      }

      const details = buildEventDetails(row, finding);
      const eventType = finding.kind === 'keyword'
        ? 'suspicious_process'
        : 'unowned_gpu';

      events.push({
        serverId: snapshot.serverId,
        eventType,
        fingerprint: buildSecurityFingerprint(snapshot.serverId, eventType, details),
        details,
      });
    }
  }

  return events;
}

function buildEventDetails(row: ProcessAuditRow, finding: ProcessAuditFinding): SecurityEventDetails {
  const details: SecurityEventDetails = {
    reason: finding.reason,
    pid: row.pid,
    user: row.user,
    command: row.command,
    taskId: row.taskId,
    usedMemoryMB: row.gpuMemoryMB,
  };

  if (finding.keyword) {
    details.keyword = finding.keyword;
  }

  return details;
}

function getStructuredOrLegacyFindings(row: ProcessAuditRow): ProcessAuditFinding[] {
  const findings = getProcessAuditFindings(row);
  if (hasProcessAuditFindings(row)) {
    return findings;
  }

  return row.suspiciousReasons.map((reason) => {
    const keywordPrefix = '命中关键词 ';
    if (reason.startsWith(keywordPrefix)) {
      return {
        kind: 'keyword',
        reason,
        keyword: reason.slice(keywordPrefix.length),
      } satisfies ProcessAuditFinding;
    }

    return {
      kind: 'unowned_gpu',
      reason,
    } satisfies ProcessAuditFinding;
  });
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortValue(nestedValue)]),
    );
  }

  return value;
}

function cleanStaleHighGpuCounters(now: number): void {
  for (const [key, entry] of highGpuUtilizationCounts) {
    if (now - entry.lastSeen > STALE_THRESHOLD_MS) {
      highGpuUtilizationCounts.delete(key);
    }
  }
}

export function checkHighGpuUtilization(input: CheckHighGpuUtilizationInput): SecurityEventInput[] {
  const {
    serverId,
    snapshot,
    hasRunningPmeowTasks,
    thresholdPercent,
    durationMinutes,
    collectionIntervalMs,
  } = input;

  const now = snapshot.timestamp;

  cleanStaleHighGpuCounters(now);

  if (durationMinutes <= 0 || !snapshot.gpu.available) {
    return [];
  }

  const requiredCount = Math.ceil(durationMinutes * 60_000 / collectionIntervalMs);
  const events: SecurityEventInput[] = [];
  const allocation = snapshot.gpuAllocation;

  if (allocation) {
    for (const perGpu of allocation.perGpu) {
      const key = `${serverId}:${perGpu.gpuIndex}`;
      const hasTasksOnGpu = perGpu.pmeowTasks.length > 0;

      if (snapshot.gpu.utilizationPercent > thresholdPercent && !hasTasksOnGpu) {
        const existing = highGpuUtilizationCounts.get(key);
        const count = (existing?.count ?? 0) + 1;
        highGpuUtilizationCounts.set(key, { count, lastSeen: now });

        if (count >= requiredCount) {
          const details: SecurityEventDetails = {
            reason: `GPU ${perGpu.gpuIndex} 利用率超过 ${thresholdPercent}% 持续 ${durationMinutes} 分钟`,
            gpuIndex: perGpu.gpuIndex,
            durationMinutes,
            gpuUtilizationPercent: snapshot.gpu.utilizationPercent,
          };
          events.push({
            serverId,
            eventType: 'high_gpu_utilization',
            fingerprint: buildSecurityFingerprint(serverId, 'high_gpu_utilization', details),
            details,
          });
          highGpuUtilizationCounts.set(key, { count: 0, lastSeen: now });
        }
      } else {
        highGpuUtilizationCounts.delete(key);
      }
    }
  } else {
    const key = `${serverId}:all`;

    if (snapshot.gpu.utilizationPercent > thresholdPercent && !hasRunningPmeowTasks) {
      const existing = highGpuUtilizationCounts.get(key);
      const count = (existing?.count ?? 0) + 1;
      highGpuUtilizationCounts.set(key, { count, lastSeen: now });

      if (count >= requiredCount) {
        const details: SecurityEventDetails = {
          reason: `GPU 利用率超过 ${thresholdPercent}% 持续 ${durationMinutes} 分钟`,
          durationMinutes,
          gpuUtilizationPercent: snapshot.gpu.utilizationPercent,
        };
        events.push({
          serverId,
          eventType: 'high_gpu_utilization',
          fingerprint: buildSecurityFingerprint(serverId, 'high_gpu_utilization', details),
          details,
        });
        highGpuUtilizationCounts.set(key, { count: 0, lastSeen: now });
      }
    } else {
      highGpuUtilizationCounts.delete(key);
    }
  }

  return events;
}

export function resetHighGpuUtilizationCounters(): void {
  highGpuUtilizationCounts.clear();
}