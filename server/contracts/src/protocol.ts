import type { UnifiedReport } from './types.js';
import type { VramMode } from './types.js';

export const AGENT_EVENT = {
  register: 'agent:register',
  report: 'agent:report',
} as const;

export const SERVER_COMMAND = {
  cancelTask: 'server:cancelTask',
  setPriority: 'server:setPriority',
  requestCollection: 'server:requestCollection',
} as const;

export interface AgentRegisterPayload {
  agentId: string;
  hostname: string;
  version: string;
}

export interface ServerCancelTaskPayload { taskId: string; }
export interface ServerSetPriorityPayload { taskId: string; priority: number; }

interface WireMemorySnapshot {
  totalMB: number;
  usedMB: number;
  availableMB: number;
  usagePercent: number;
  swapTotalMB: number;
  swapUsedMB: number;
  swapPercent: number;
}

interface WireProcessInfo {
  pid: number;
  ppid: number | null;
  user: string;
  cpuPercent: number;
  memPercent: number;
  rss: number;
  command: string;
  gpuMemoryMB: number;
}

interface WireUserResourceSummary {
  user: string;
  totalCpuPercent: number;
  totalRssMb: number;
  totalVramMb: number;
  processCount: number;
}

interface WireTaskInfo {
  taskId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'abnormal';
  command: string;
  cwd: string;
  user: string;
  launchMode: 'background' | 'foreground';
  requireVramMB: number;
  requestedVramMb?: number | null;
  requestedVramMB?: number | null;
  vramMode: VramMode;
  requireGpuCount: number;
  gpuIds: number[] | null;
  priority: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  pid: number | null;
  exitCode: number | null;
  endReason: string | null;
  assignedGpus: number[] | null;
  declaredVramPerGpu: number | null;
  autoObserveWindowSec?: number | null;
  autoPeakVramByGpuMb?: Record<string, number> | null;
  autoReclaimedVramByGpuMb?: Record<string, number | null> | null;
  autoReclaimDone?: boolean;
  scheduleHistory: UnifiedReport['taskQueue']['queued'][number]['scheduleHistory'];
}

interface WireDiskIoSnapshot {
  readBytesPerSec: number;
  writeBytesPerSec: number;
}

interface WireUnifiedReport {
  agentId: string;
  timestamp: number;
  seq: number;
  resourceSnapshot: Omit<UnifiedReport['resourceSnapshot'], 'memory' | 'processes' | 'processesByUser'> & {
    memory: WireMemorySnapshot;
    processes: WireProcessInfo[];
    processesByUser: WireUserResourceSummary[];
  };
  taskQueue: {
    queued: WireTaskInfo[];
    running: WireTaskInfo[];
    recentlyEnded: WireTaskInfo[];
  };
}

export function isAgentRegisterPayload(data: unknown): data is AgentRegisterPayload {
  if (typeof data !== 'object' || data === null) return false;
  const p = data as AgentRegisterPayload;
  return typeof p.agentId === 'string' && typeof p.hostname === 'string';
}

export function isUnifiedReport(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const p = data as WireUnifiedReport;
  if (typeof p.agentId !== 'string' || typeof p.timestamp !== 'number' || typeof p.seq !== 'number') return false;
  if (typeof p.resourceSnapshot !== 'object' || p.resourceSnapshot === null) return false;
  if (typeof p.taskQueue !== 'object' || p.taskQueue === null) return false;

  const snapshot = p.resourceSnapshot as Record<string, unknown>;
  const cpu = snapshot.cpu as Record<string, unknown> | undefined;
  const memory = snapshot.memory as Record<string, unknown> | undefined;
  const diskIo = snapshot.diskIo as Record<string, unknown> | undefined;
  const network = snapshot.network as Record<string, unknown> | undefined;

  if ('internet' in snapshot) return false;
  if (!Array.isArray(snapshot.gpuCards) || !Array.isArray(snapshot.disks) || !Array.isArray(snapshot.processes) || !Array.isArray(snapshot.processesByUser) || !Array.isArray(snapshot.localUsers)) return false;
  if (!cpu || typeof cpu.usagePercent !== 'number' || typeof cpu.coreCount !== 'number' || typeof cpu.frequencyMhz !== 'number') return false;
  if (!memory || typeof memory.totalMB !== 'number' || typeof memory.usedMB !== 'number' || typeof memory.usagePercent !== 'number') return false;
  if (!diskIo || typeof diskIo.readBytesPerSec !== 'number' || typeof diskIo.writeBytesPerSec !== 'number') return false;
  if (!network || typeof network.rxBytesPerSec !== 'number' || typeof network.txBytesPerSec !== 'number' || !Array.isArray(network.interfaces)) return false;
  if (!Array.isArray(p.taskQueue.queued) || !Array.isArray(p.taskQueue.running) || !Array.isArray(p.taskQueue.recentlyEnded)) return false;

  return snapshot.processesByUser.every(isUserResourceSummary)
    && p.taskQueue.queued.every(isTaskInfo)
    && p.taskQueue.running.every(isTaskInfo)
    && p.taskQueue.recentlyEnded.every(isTaskInfo);
}

export function parseUnifiedReport(data: unknown): UnifiedReport | null {
  if (!isUnifiedReport(data)) {
    return null;
  }

  const report = data as WireUnifiedReport;
  return {
    agentId: report.agentId,
    timestamp: report.timestamp,
    seq: report.seq,
    resourceSnapshot: {
      ...report.resourceSnapshot,
      memory: {
        totalMb: report.resourceSnapshot.memory.totalMB,
        usedMb: report.resourceSnapshot.memory.usedMB,
        availableMb: report.resourceSnapshot.memory.availableMB,
        usagePercent: report.resourceSnapshot.memory.usagePercent,
        swapTotalMb: report.resourceSnapshot.memory.swapTotalMB,
        swapUsedMb: report.resourceSnapshot.memory.swapUsedMB,
        swapPercent: report.resourceSnapshot.memory.swapPercent,
      },
      processes: report.resourceSnapshot.processes.map((process) => ({
        pid: process.pid,
        ppid: process.ppid,
        user: process.user,
        cpuPercent: process.cpuPercent,
        memPercent: process.memPercent,
        rss: process.rss,
        command: process.command,
        gpuMemoryMb: process.gpuMemoryMB,
      })),
      processesByUser: report.resourceSnapshot.processesByUser.map((summary) => ({
        user: summary.user,
        totalCpuPercent: summary.totalCpuPercent,
        totalRssMb: summary.totalRssMb,
        totalVramMb: summary.totalVramMb,
        processCount: summary.processCount,
      })),
    },
    taskQueue: {
      queued: report.taskQueue.queued.map(normalizeTaskInfo),
      running: report.taskQueue.running.map(normalizeTaskInfo),
      recentlyEnded: report.taskQueue.recentlyEnded.map(normalizeTaskInfo),
    },
  };
}

function isUserResourceSummary(summary: unknown): summary is WireUserResourceSummary {
  if (typeof summary !== 'object' || summary === null) return false;
  const record = summary as Record<string, unknown>;
  return typeof record.user === 'string'
    && typeof record.totalCpuPercent === 'number'
    && typeof record.totalRssMb === 'number'
    && typeof record.totalVramMb === 'number'
    && typeof record.processCount === 'number';
}

function isTaskInfo(task: unknown): task is WireTaskInfo {
  if (typeof task !== 'object' || task === null) return false;
  const record = task as Record<string, unknown>;
  return typeof record.taskId === 'string'
    && typeof record.status === 'string'
    && typeof record.command === 'string'
    && typeof record.cwd === 'string'
    && typeof record.user === 'string'
    && typeof record.launchMode === 'string'
    && typeof record.requireVramMB === 'number'
    && (record.requestedVramMb === undefined || record.requestedVramMb === null || typeof record.requestedVramMb === 'number')
    && (record.requestedVramMB === undefined || record.requestedVramMB === null || typeof record.requestedVramMB === 'number')
    && (record.vramMode === 'exclusive_auto' || record.vramMode === 'shared')
    && typeof record.requireGpuCount === 'number'
    && typeof record.priority === 'number'
    && typeof record.createdAt === 'number';
}


function normalizeTaskInfo(task: WireTaskInfo): UnifiedReport['taskQueue']['queued'][number] {
  const requestedVramMb = normalizeRequestedVramMb(task);
  const vramMode = normalizeVramMode(task);

  return {
    taskId: task.taskId,
    status: task.status,
    command: task.command,
    cwd: task.cwd,
    user: task.user,
    launchMode: task.launchMode,
    requireVramMb: task.requireVramMB,
    requestedVramMb,
    vramMode,
    requireGpuCount: task.requireGpuCount,
    gpuIds: task.gpuIds,
    priority: task.priority,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    pid: task.pid,
    assignedGpus: task.assignedGpus,
    declaredVramPerGpu: task.declaredVramPerGpu,
    autoObserveWindowSec: task.autoObserveWindowSec ?? null,
    autoPeakVramByGpuMb: normalizeNumberMap(task.autoPeakVramByGpuMb),
    autoReclaimedVramByGpuMb: normalizeNullableNumberMap(task.autoReclaimedVramByGpuMb),
    autoReclaimDone: task.autoReclaimDone === true,
    scheduleHistory: task.scheduleHistory,
    finishedAt: task.finishedAt ?? null,
    exitCode: task.exitCode ?? null,
    endReason: task.endReason ?? null,
  };
}

function normalizeRequestedVramMb(task: WireTaskInfo): number | null {
  if (typeof task.requestedVramMb === 'number' || task.requestedVramMb === null) {
    return task.requestedVramMb;
  }
  if (typeof task.requestedVramMB === 'number' || task.requestedVramMB === null) {
    return task.requestedVramMB;
  }
  return task.vramMode === 'exclusive_auto' ? null : task.requireVramMB;
}

function normalizeVramMode(task: WireTaskInfo): VramMode {
  return task.vramMode;
}

function normalizeNumberMap(value: unknown): Record<string, number> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      result[key] = entry;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function normalizeNullableNumberMap(value: unknown): Record<string, number | null> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const result: Record<string, number | null> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || (typeof entry === 'number' && Number.isFinite(entry))) {
      result[key] = entry;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}
