import type { StoredGpuUsageRow } from '../db/gpu-usage.js';
import type { MetricsSnapshot, ProcessAuditRow, ProcessInfo } from '../types.js';

export interface BuildProcessAuditRowsOptions {
  securityMiningKeywords: string[];
  unownedGpuMinutes: number;
  hasRunningPmeowTasks: boolean;
}

export interface ProcessAuditFinding {
  kind: 'keyword' | 'unowned_gpu';
  reason: string;
  keyword?: string;
}

interface MutableAuditRow extends ProcessAuditRow {
  suspiciousReasons: string[];
}

const processAuditFindings = new WeakMap<ProcessAuditRow, ProcessAuditFinding[]>();

const OWNER_PRIORITY: Record<ProcessAuditRow['ownerType'], number> = {
  none: 0,
  unknown: 1,
  user: 2,
  task: 3,
};

export function buildProcessAuditRows(
  snapshot: MetricsSnapshot,
  gpuRows: StoredGpuUsageRow[],
  options: BuildProcessAuditRowsOptions,
): ProcessAuditRow[] {
  const auditRows = new Map<number, MutableAuditRow>();

  for (const process of snapshot.processes) {
    auditRows.set(process.pid, createBaseRow(process));
  }

  for (const gpuRow of gpuRows) {
    if (gpuRow.pid === undefined) {
      continue;
    }

    const existing = auditRows.get(gpuRow.pid);
    if (existing) {
      mergeGpuRow(existing, gpuRow);
      continue;
    }

    const syntheticRow = createSyntheticRow(gpuRow);
    auditRows.set(gpuRow.pid, syntheticRow);
    mergeGpuRow(syntheticRow, gpuRow);
  }

  for (const row of auditRows.values()) {
    const findings = buildProcessAuditFindings(row, options);
    setProcessAuditFindings(row, findings);
    row.suspiciousReasons = findings.map((finding) => finding.reason);
  }

  return Array.from(auditRows.values());
}

export function getProcessAuditFindings(row: ProcessAuditRow): ProcessAuditFinding[] {
  return processAuditFindings.get(row) ?? [];
}

export function hasProcessAuditFindings(row: ProcessAuditRow): boolean {
  return processAuditFindings.has(row);
}

function setProcessAuditFindings(row: ProcessAuditRow, findings: ProcessAuditFinding[]): void {
  processAuditFindings.set(row, findings);
}

function createBaseRow(process: ProcessInfo): MutableAuditRow {
  return {
    pid: process.pid,
    user: process.user,
    command: process.command,
    cpuPercent: process.cpuPercent,
    memPercent: process.memPercent,
    rss: process.rss,
    gpuMemoryMB: 0,
    ownerType: 'none',
    taskId: undefined,
    suspiciousReasons: [],
  };
}

function createSyntheticRow(gpuRow: StoredGpuUsageRow): MutableAuditRow {
  return {
    pid: gpuRow.pid!,
    user: gpuRow.userName ?? 'unknown',
    command: gpuRow.command ?? '',
    cpuPercent: 0,
    memPercent: 0,
    rss: 0,
    gpuMemoryMB: 0,
    ownerType: 'none',
    taskId: undefined,
    suspiciousReasons: [],
  };
}

function mergeGpuRow(row: MutableAuditRow, gpuRow: StoredGpuUsageRow): void {
  row.gpuMemoryMB += gpuRow.usedMemoryMB;

  if (!row.command && gpuRow.command) {
    row.command = gpuRow.command;
  }

  if ((row.user === 'unknown' || !row.user) && gpuRow.userName) {
    row.user = gpuRow.userName;
  }

  if (OWNER_PRIORITY[gpuRow.ownerType] > OWNER_PRIORITY[row.ownerType]) {
    row.ownerType = gpuRow.ownerType;
  }

  if (gpuRow.taskId) {
    row.taskId = gpuRow.taskId;
    row.ownerType = 'task';
  }
}

function buildProcessAuditFindings(
  row: ProcessAuditRow,
  options: BuildProcessAuditRowsOptions,
): ProcessAuditFinding[] {
  const findings: ProcessAuditFinding[] = [];
  const command = row.command.toLowerCase();

  for (const keyword of options.securityMiningKeywords) {
    if (!keyword) {
      continue;
    }

    if (command.includes(keyword.toLowerCase())) {
      findings.push({
        kind: 'keyword',
        keyword,
        reason: `命中关键词 ${keyword}`,
      });
      break;
    }
  }

  if (
    !options.hasRunningPmeowTasks
    && row.ownerType !== 'task'
    && row.gpuMemoryMB > 0
    && options.unownedGpuMinutes > 0
  ) {
    findings.push({
      kind: 'unowned_gpu',
      reason: `无主 GPU 占用 ${options.unownedGpuMinutes} 分钟`,
    });
  }

  return findings;
}