import { EventEmitter } from 'events';
import type { AgentTaskAuditDetail, AgentTaskEventRecord, AgentTaskQueueResponse, AgentTaskStatus, MetricsSnapshot, ConnectionStatus } from '../types.js';
import { SERVER_COMMAND, type ServerCommandEnvelope } from '../agent/protocol.js';
import { AgentCommandError } from '../agent/errors.js';
import type { AgentLiveSession } from '../agent/registry.js';
import type { AgentCommandDataSource, NodeDataSource } from './types.js';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function readField<T>(record: UnknownRecord, camelKey: string, snakeKey: string): T | undefined {
  const camelValue = record[camelKey];
  if (camelValue !== undefined) {
    return camelValue as T;
  }
  const snakeValue = record[snakeKey];
  return snakeValue !== undefined ? snakeValue as T : undefined;
}

function normalizeTaskEvent(event: unknown): AgentTaskEventRecord {
  const record = asRecord(event) ?? {};
  return {
    id: Number(record.id ?? 0),
    taskId: String(readField(record, 'taskId', 'task_id') ?? ''),
    eventType: String(readField(record, 'eventType', 'event_type') ?? ''),
    timestamp: Number(record.timestamp ?? 0),
    details: asRecord(record.details) ?? null,
  };
}

function normalizeTaskAuditDetail(
  serverId: string,
  detail: unknown,
): AgentTaskAuditDetail | null {
  if (detail === null) {
    return null;
  }

  const record = asRecord(detail);
  if (!record) {
    return null;
  }

  const taskRecord = asRecord(record.task) ?? {};
  const runtimeRecord = asRecord(record.runtime);

  return {
    task: {
      serverId: String(taskRecord.serverId ?? serverId),
      taskId: String(readField(taskRecord, 'taskId', 'id') ?? ''),
      status: String(taskRecord.status ?? '') as AgentTaskStatus,
      command: readField<string>(taskRecord, 'command', 'command'),
      cwd: readField<string>(taskRecord, 'cwd', 'cwd'),
      user: readField<string>(taskRecord, 'user', 'user'),
      requireVramMB: readField<number>(taskRecord, 'requireVramMB', 'require_vram_mb'),
      requireGpuCount: readField<number>(taskRecord, 'requireGpuCount', 'require_gpu_count'),
      gpuIds: readField<number[] | null>(taskRecord, 'gpuIds', 'gpu_ids'),
      priority: readField<number>(taskRecord, 'priority', 'priority'),
      createdAt: readField<number>(taskRecord, 'createdAt', 'created_at'),
      startedAt: readField<number | null>(taskRecord, 'startedAt', 'started_at'),
      finishedAt: readField<number | null>(taskRecord, 'finishedAt', 'finished_at'),
      exitCode: readField<number | null>(taskRecord, 'exitCode', 'exit_code'),
      pid: readField<number | null>(taskRecord, 'pid', 'pid'),
    },
    events: Array.isArray(record.events) ? record.events.map(normalizeTaskEvent) : [],
    runtime: runtimeRecord
      ? {
          launchMode: String(readField(runtimeRecord, 'launchMode', 'launch_mode') ?? ''),
          rootPid: readField<number | null>(runtimeRecord, 'rootPid', 'root_pid') ?? null,
          rootCreatedAt: readField<number | null>(runtimeRecord, 'rootCreatedAt', 'root_created_at') ?? null,
          runtimePhase: String(readField(runtimeRecord, 'runtimePhase', 'runtime_phase') ?? ''),
          firstStartedAt: readField<number | null>(runtimeRecord, 'firstStartedAt', 'first_started_at') ?? null,
          lastSeenAt: readField<number | null>(runtimeRecord, 'lastSeenAt', 'last_seen_at') ?? null,
          finalizeSource: readField<string | null>(runtimeRecord, 'finalizeSource', 'finalize_source') ?? null,
          finalizeReasonCode: readField<string | null>(runtimeRecord, 'finalizeReasonCode', 'finalize_reason_code') ?? null,
          lastObservedExitCode: readField<number | null>(runtimeRecord, 'lastObservedExitCode', 'last_observed_exit_code') ?? null,
        }
      : undefined,
  };
}

/**
 * AgentDataSource receives metrics pushed by a remote Python Agent via WebSocket.
 * This is a stub — full Agent WebSocket handling is in Plan 3.
 */
export class AgentDataSource extends EventEmitter implements NodeDataSource, AgentCommandDataSource {
  readonly type = 'agent' as const;
  readonly serverId: string;
  readonly agentId: string | null;

  private connected = false;
  private latestSnapshot: MetricsSnapshot | null = null;
  private liveSession: AgentLiveSession | null = null;
  private _agentVersion: string | undefined;

  constructor(serverId: string, agentId: string | null = null) {
    super();
    this.serverId = serverId;
    this.agentId = agentId;
  }

  async connect(): Promise<void> {
    // Agent connects to us; this is a no-op.
    // Connection state is updated when Agent registers.
  }

  disconnect(): void {
    this.detachSession();
  }

  isConnected(): boolean {
    return this.connected;
  }

  hasLiveSession(): boolean {
    return this.liveSession !== null;
  }

  getConnectionStatus(): ConnectionStatus {
    return this.connected ? 'connected' : 'disconnected';
  }

  async collectMetrics(): Promise<MetricsSnapshot | null> {
    // Agent mode: return the latest pushed snapshot (passive, no pull).
    return this.latestSnapshot;
  }

  /** Called when Agent pushes a metrics snapshot via WebSocket. */
  pushMetrics(snapshot: MetricsSnapshot): void {
    this.latestSnapshot = snapshot;
    this.connected = true;
    this.emit('metricsReceived', snapshot);
  }

  get agentVersion(): string | undefined {
    return this._agentVersion;
  }

  attachSession(session: AgentLiveSession, version?: string): void {
    this.liveSession = session;
    this.connected = true;
    if (version !== undefined) {
      this._agentVersion = version;
    }
    this.emit('sessionAttached');
  }

  detachSession(session?: AgentLiveSession, reason?: string): void {
    if (session !== undefined && this.liveSession !== session) {
      return;
    }

    this.liveSession = null;
    this.connected = false;
    this.emit('sessionDetached', { reason });
  }

  /** Called when Agent registers or reconnects. */
  setConnected(connected: boolean, reason?: string): void {
    this.connected = connected;
    if (!connected) {
      this.liveSession = null;
      this.emit('sessionDetached', { reason });
    } else {
      this.emit('sessionAttached');
    }
  }

  cancelTask(taskId: string): void {
    this.emitCommand({
      event: SERVER_COMMAND.cancelTask,
      data: { taskId },
    });
  }

  pauseQueue(): void {
    this.emitCommand({
      event: SERVER_COMMAND.pauseQueue,
      data: {},
    });
  }

  resumeQueue(): void {
    this.emitCommand({
      event: SERVER_COMMAND.resumeQueue,
      data: {},
    });
  }

  setPriority(taskId: string, priority: number): void {
    this.emitCommand({
      event: SERVER_COMMAND.setPriority,
      data: { taskId, priority },
    });
  }

  async getTaskEvents(taskId: string, afterId = 0): Promise<AgentTaskEventRecord[]> {
    const events = await this.requireLiveSession().requestTaskEvents({ taskId, afterId });
    return events.map(normalizeTaskEvent);
  }

  async getTaskAuditDetail(taskId: string): Promise<AgentTaskAuditDetail | null> {
    const detail = await this.requireLiveSession().requestTaskAuditDetail({ taskId });
    return normalizeTaskAuditDetail(this.serverId, detail);
  }

  async getTaskQueue(): Promise<AgentTaskQueueResponse> {
    return this.requireLiveSession().requestTaskQueue();
  }

  private emitCommand(command: ServerCommandEnvelope): void {
    this.requireLiveSession().emitCommand(command);
  }

  private requireLiveSession(): AgentLiveSession {
    if (this.liveSession === null) {
      throw new AgentCommandError('offline');
    }

    return this.liveSession;
  }
}
