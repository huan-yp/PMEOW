import { createHash } from 'node:crypto';
import { getProcessAuditFindings, hasProcessAuditFindings, type ProcessAuditFinding } from './audit.js';
import type { SecurityEventInput } from '../db/security-events.js';
import type { MetricsSnapshot, ProcessAuditRow, SecurityEventDetails, SecurityEventType } from '../types.js';

export interface AnalyzeSecuritySnapshotInput {
  snapshot: MetricsSnapshot;
  auditRows: ProcessAuditRow[];
}

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