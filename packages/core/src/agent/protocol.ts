import type {
  AgentHeartbeatPayload,
  AgentRegisterPayload,
  AgentTaskStatus,
  AgentTaskUpdatePayload,
  GpuAllocationSummary,
  GpuTaskAllocation,
  GpuUnknownProcess,
  GpuUserProcess,
  MetricsSnapshot,
  MirroredAgentTaskRecord,
  PerGpuAllocationSummary,
  UserGpuUsageSummary,
} from '../types.js';

export type {
  AgentHeartbeatPayload,
  AgentRegisterPayload,
  AgentTaskUpdatePayload,
  MirroredAgentTaskRecord,
} from '../types.js';

export const AGENT_EVENT = {
  register: 'agent:register',
  metrics: 'agent:metrics',
  taskUpdate: 'agent:taskUpdate',
  heartbeat: 'agent:heartbeat',
} as const;

export const SERVER_COMMAND = {
  cancelTask: 'server:cancelTask',
  pauseQueue: 'server:pauseQueue',
  resumeQueue: 'server:resumeQueue',
  setPriority: 'server:setPriority',
} as const;

export const AGENT_TASK_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export type AgentEventName = typeof AGENT_EVENT[keyof typeof AGENT_EVENT];
export type ServerCommandName = typeof SERVER_COMMAND[keyof typeof SERVER_COMMAND];
export type AgentMetricsPayload = MetricsSnapshot;
export type ServerPauseQueuePayload = Record<string, never>;
export type ServerResumeQueuePayload = Record<string, never>;

export interface ServerCancelTaskPayload {
  taskId: string;
}

export interface ServerSetPriorityPayload {
  taskId: string;
  priority: number;
}

export interface AgentRegisterEnvelope {
  event: typeof AGENT_EVENT.register;
  data: AgentRegisterPayload;
}

export interface AgentMetricsEnvelope {
  event: typeof AGENT_EVENT.metrics;
  data: AgentMetricsPayload;
}

export interface AgentTaskUpdateEnvelope {
  event: typeof AGENT_EVENT.taskUpdate;
  data: AgentTaskUpdatePayload;
}

export interface AgentHeartbeatEnvelope {
  event: typeof AGENT_EVENT.heartbeat;
  data: AgentHeartbeatPayload;
}

export type AgentEventEnvelope =
  | AgentRegisterEnvelope
  | AgentMetricsEnvelope
  | AgentTaskUpdateEnvelope
  | AgentHeartbeatEnvelope;

export interface ServerCancelTaskEnvelope {
  event: typeof SERVER_COMMAND.cancelTask;
  data: ServerCancelTaskPayload;
}

export interface ServerPauseQueueEnvelope {
  event: typeof SERVER_COMMAND.pauseQueue;
  data: ServerPauseQueuePayload;
}

export interface ServerResumeQueueEnvelope {
  event: typeof SERVER_COMMAND.resumeQueue;
  data: ServerResumeQueuePayload;
}

export interface ServerSetPriorityEnvelope {
  event: typeof SERVER_COMMAND.setPriority;
  data: ServerSetPriorityPayload;
}

export type ServerCommandEnvelope =
  | ServerCancelTaskEnvelope
  | ServerPauseQueueEnvelope
  | ServerResumeQueueEnvelope
  | ServerSetPriorityEnvelope;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

function isArrayOf<T>(
  value: unknown,
  itemGuard: (item: unknown) => item is T,
): value is T[] {
  return Array.isArray(value) && value.every((item) => itemGuard(item));
}

function isIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => isInteger(item));
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isOptionalFiniteNumber(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || isFiniteNumber(value);
}

function isOptionalInteger(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || isInteger(value);
}

function isOptionalIntegerArray(value: unknown): value is number[] | null | undefined {
  return value === undefined || value === null || isIntegerArray(value);
}

function isEmptyObject(value: unknown): value is Record<string, never> {
  return isRecord(value) && Object.keys(value).length === 0;
}

function hasEnvelopeShape(value: unknown): value is { event: string; data: unknown } {
  return isRecord(value)
    && isString(value.event)
    && Object.prototype.hasOwnProperty.call(value, 'data');
}

export function isAgentTaskStatus(value: unknown): value is AgentTaskStatus {
  return isString(value)
    && AGENT_TASK_STATUSES.some((status) => status === value);
}

export function isGpuTaskAllocation(value: unknown): value is GpuTaskAllocation {
  if (!isRecord(value)) {
    return false;
  }

  return isString(value.taskId)
    && isInteger(value.gpuIndex)
    && isFiniteNumber(value.declaredVramMB)
    && isFiniteNumber(value.actualVramMB);
}

export function isGpuUserProcess(value: unknown): value is GpuUserProcess {
  if (!isRecord(value)) {
    return false;
  }

  return isInteger(value.pid)
    && isString(value.user)
    && isInteger(value.gpuIndex)
    && isFiniteNumber(value.usedMemoryMB)
    && isString(value.command);
}

export function isGpuUnknownProcess(value: unknown): value is GpuUnknownProcess {
  if (!isRecord(value)) {
    return false;
  }

  return isInteger(value.pid)
    && isInteger(value.gpuIndex)
    && isFiniteNumber(value.usedMemoryMB);
}

export function isPerGpuAllocationSummary(value: unknown): value is PerGpuAllocationSummary {
  if (!isRecord(value)) {
    return false;
  }

  return isInteger(value.gpuIndex)
    && isFiniteNumber(value.totalMemoryMB)
    && isArrayOf(value.pmeowTasks, isGpuTaskAllocation)
    && isArrayOf(value.userProcesses, isGpuUserProcess)
    && isArrayOf(value.unknownProcesses, isGpuUnknownProcess)
    && isFiniteNumber(value.effectiveFreeMB);
}

export function isUserGpuUsageSummary(value: unknown): value is UserGpuUsageSummary {
  if (!isRecord(value)) {
    return false;
  }

  return isString(value.user)
    && isFiniteNumber(value.totalVramMB)
    && isIntegerArray(value.gpuIndices);
}

export function isGpuAllocationSummary(value: unknown): value is GpuAllocationSummary {
  if (!isRecord(value)) {
    return false;
  }

  return isArrayOf(value.perGpu, isPerGpuAllocationSummary)
    && isArrayOf(value.byUser, isUserGpuUsageSummary);
}

export function isMirroredAgentTaskRecord(value: unknown): value is MirroredAgentTaskRecord {
  if (!isRecord(value)) {
    return false;
  }

  return isString(value.serverId)
    && isString(value.taskId)
    && isAgentTaskStatus(value.status)
    && isOptionalString(value.command)
    && isOptionalString(value.cwd)
    && isOptionalString(value.user)
    && isOptionalInteger(value.requireVramMB)
    && isOptionalInteger(value.requireGpuCount)
    && isOptionalIntegerArray(value.gpuIds)
    && isOptionalInteger(value.priority)
    && isOptionalFiniteNumber(value.createdAt)
    && isOptionalFiniteNumber(value.startedAt)
    && isOptionalFiniteNumber(value.finishedAt)
    && isOptionalInteger(value.exitCode)
    && isOptionalInteger(value.pid);
}

export function isAgentRegisterPayload(value: unknown): value is AgentRegisterPayload {
  if (!isRecord(value)) {
    return false;
  }

  return isString(value.agentId)
    && isString(value.hostname)
    && isString(value.version);
}

export function isAgentHeartbeatPayload(value: unknown): value is AgentHeartbeatPayload {
  if (!isRecord(value)) {
    return false;
  }

  return isString(value.agentId)
    && isFiniteNumber(value.timestamp);
}

export function isAgentTaskUpdatePayload(value: unknown): value is AgentTaskUpdatePayload {
  if (!isRecord(value)) {
    return false;
  }

  return isString(value.taskId)
    && isAgentTaskStatus(value.status)
    && isOptionalString(value.command)
    && isOptionalString(value.cwd)
    && isOptionalString(value.user)
    && isOptionalInteger(value.requireVramMB)
    && isOptionalInteger(value.requireGpuCount)
    && isOptionalIntegerArray(value.gpuIds)
    && isOptionalInteger(value.priority)
    && isOptionalFiniteNumber(value.createdAt)
    && isOptionalFiniteNumber(value.startedAt)
    && isOptionalFiniteNumber(value.finishedAt)
    && isOptionalInteger(value.exitCode)
    && isOptionalInteger(value.pid);
}

export function isAgentMetricsPayload(value: unknown): value is AgentMetricsPayload {
  if (!isRecord(value)) {
    return false;
  }

  return isString(value.serverId)
    && isFiniteNumber(value.timestamp)
    && isRecord(value.cpu)
    && isRecord(value.memory)
    && isRecord(value.disk)
    && isRecord(value.network)
    && isRecord(value.gpu)
    && Array.isArray(value.processes)
    && Array.isArray(value.docker)
    && isRecord(value.system)
    && (value.gpuAllocation === undefined || isGpuAllocationSummary(value.gpuAllocation));
}

export function isServerCancelTaskPayload(value: unknown): value is ServerCancelTaskPayload {
  return isRecord(value) && isString(value.taskId);
}

export function isServerPauseQueuePayload(value: unknown): value is ServerPauseQueuePayload {
  return isEmptyObject(value);
}

export function isServerResumeQueuePayload(value: unknown): value is ServerResumeQueuePayload {
  return isEmptyObject(value);
}

export function isServerSetPriorityPayload(value: unknown): value is ServerSetPriorityPayload {
  return isRecord(value)
    && isString(value.taskId)
    && isInteger(value.priority);
}

export function isAgentRegisterEnvelope(value: unknown): value is AgentRegisterEnvelope {
  return hasEnvelopeShape(value)
    && value.event === AGENT_EVENT.register
    && isAgentRegisterPayload(value.data);
}

export function isAgentMetricsEnvelope(value: unknown): value is AgentMetricsEnvelope {
  return hasEnvelopeShape(value)
    && value.event === AGENT_EVENT.metrics
    && isAgentMetricsPayload(value.data);
}

export function isAgentTaskUpdateEnvelope(value: unknown): value is AgentTaskUpdateEnvelope {
  return hasEnvelopeShape(value)
    && value.event === AGENT_EVENT.taskUpdate
    && isAgentTaskUpdatePayload(value.data);
}

export function isAgentHeartbeatEnvelope(value: unknown): value is AgentHeartbeatEnvelope {
  return hasEnvelopeShape(value)
    && value.event === AGENT_EVENT.heartbeat
    && isAgentHeartbeatPayload(value.data);
}

export function isAgentEventEnvelope(value: unknown): value is AgentEventEnvelope {
  return isAgentRegisterEnvelope(value)
    || isAgentMetricsEnvelope(value)
    || isAgentTaskUpdateEnvelope(value)
    || isAgentHeartbeatEnvelope(value);
}

export function isServerCancelTaskEnvelope(value: unknown): value is ServerCancelTaskEnvelope {
  return hasEnvelopeShape(value)
    && value.event === SERVER_COMMAND.cancelTask
    && isServerCancelTaskPayload(value.data);
}

export function isServerPauseQueueEnvelope(value: unknown): value is ServerPauseQueueEnvelope {
  return hasEnvelopeShape(value)
    && value.event === SERVER_COMMAND.pauseQueue
    && isServerPauseQueuePayload(value.data);
}

export function isServerResumeQueueEnvelope(value: unknown): value is ServerResumeQueueEnvelope {
  return hasEnvelopeShape(value)
    && value.event === SERVER_COMMAND.resumeQueue
    && isServerResumeQueuePayload(value.data);
}

export function isServerSetPriorityEnvelope(value: unknown): value is ServerSetPriorityEnvelope {
  return hasEnvelopeShape(value)
    && value.event === SERVER_COMMAND.setPriority
    && isServerSetPriorityPayload(value.data);
}

export function isServerCommandEnvelope(value: unknown): value is ServerCommandEnvelope {
  return isServerCancelTaskEnvelope(value)
    || isServerPauseQueueEnvelope(value)
    || isServerResumeQueueEnvelope(value)
    || isServerSetPriorityEnvelope(value);
}
