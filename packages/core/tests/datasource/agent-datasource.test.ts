import { describe, expect, it, vi } from 'vitest';
import type { AgentLiveSession } from '../../src/agent/registry.js';
import { SERVER_COMMAND, isServerCommandEnvelope } from '../../src/agent/protocol.js';
import { AgentCommandError } from '../../src/agent/errors.js';
import { AgentDataSource } from '../../src/datasource/agent-datasource.js';
import type { MetricsSnapshot } from '../../src/types.js';

function createSession(agentId = 'agent-1') {
  const emitCommand = vi.fn();
  const requestTaskEvents = vi.fn().mockResolvedValue([]);
  const requestTaskAuditDetail = vi.fn().mockResolvedValue(null);
  const requestTaskQueue = vi.fn().mockResolvedValue({ queued: [], running: [], recent: [] });
  const session: AgentLiveSession = {
    agentId,
    emitCommand,
    requestTaskEvents,
    requestTaskAuditDetail,
    requestTaskQueue,
  };

  return { session, emitCommand, requestTaskEvents, requestTaskAuditDetail, requestTaskQueue };
}

function createSnapshot(): MetricsSnapshot {
  return {
    serverId: 'srv-1',
    timestamp: 123,
  } as MetricsSnapshot;
}

describe('AgentDataSource', () => {
  it('should have type agent', () => {
    const ds = new AgentDataSource('srv-1', 'agent-1');
    expect(ds.type).toBe('agent');
    expect(ds.serverId).toBe('srv-1');
    expect(ds.agentId).toBe('agent-1');
  });

  it('should start disconnected', () => {
    const ds = new AgentDataSource('srv-1');
    expect(ds.isConnected()).toBe(false);
    expect(ds.getConnectionStatus()).toBe('disconnected');
  });

  it('should return null from collectMetrics when no data pushed', async () => {
    const ds = new AgentDataSource('srv-1');
    const result = await ds.collectMetrics();
    expect(result).toBeNull();
  });

  it('should return pushed snapshot from collectMetrics', async () => {
    const ds = new AgentDataSource('srv-1');
    const fakeSnapshot = createSnapshot();
    ds.pushMetrics(fakeSnapshot);
    const result = await ds.collectMetrics();
    expect(result).toEqual(fakeSnapshot);
  });

  it('attaching a session marks the datasource connected', () => {
    const ds = new AgentDataSource('srv-1', 'agent-1');
    const { session } = createSession();

    ds.attachSession(session);

    expect(ds.isConnected()).toBe(true);
    expect(ds.getConnectionStatus()).toBe('connected');
  });

  it('replacing a session invalidates the old one', () => {
    const ds = new AgentDataSource('srv-1', 'agent-1');
    const first = createSession();
    const replacement = createSession();

    ds.attachSession(first.session);
    ds.attachSession(replacement.session);
    ds.detachSession(first.session);
    ds.pauseQueue();

    expect(ds.isConnected()).toBe(true);
    expect(first.emitCommand).not.toHaveBeenCalled();
    expect(replacement.emitCommand).toHaveBeenCalledOnce();
    expect(replacement.emitCommand).toHaveBeenCalledWith({
      event: SERVER_COMMAND.pauseQueue,
      data: {},
    });
  });

  it('offline datasource rejects command dispatch cleanly', () => {
    const ds = new AgentDataSource('srv-1', 'agent-1');

    expect(() => ds.cancelTask('task-1')).toThrow(AgentCommandError);
    expect(() => ds.pauseQueue()).toThrow(AgentCommandError);
    expect(() => ds.resumeQueue()).toThrow(AgentCommandError);
    expect(() => ds.setPriority('task-1', 10)).toThrow(AgentCommandError);
  });

  it('emits command payloads with correct event names and shapes', () => {
    const ds = new AgentDataSource('srv-1', 'agent-1');
    const { session, emitCommand } = createSession();

    ds.attachSession(session);
    ds.cancelTask('task-1');
    ds.pauseQueue();
    ds.resumeQueue();
    ds.setPriority('task-2', 7);

    const commands = emitCommand.mock.calls.map(([command]) => command);

    expect(commands).toEqual([
      {
        event: SERVER_COMMAND.cancelTask,
        data: { taskId: 'task-1' },
      },
      {
        event: SERVER_COMMAND.pauseQueue,
        data: {},
      },
      {
        event: SERVER_COMMAND.resumeQueue,
        data: {},
      },
      {
        event: SERVER_COMMAND.setPriority,
        data: { taskId: 'task-2', priority: 7 },
      },
    ]);

    for (const command of commands) {
      expect(isServerCommandEnvelope(command)).toBe(true);
    }
  });

  it('emits sessionAttached when session is attached', () => {
    const ds = new AgentDataSource('srv-1', 'agent-1');
    const { session } = createSession();
    const events: string[] = [];

    ds.on('sessionAttached', () => events.push('attached'));
    ds.attachSession(session);

    expect(events).toEqual(['attached']);
  });

  it('emits sessionDetached with reason when session is detached', () => {
    const ds = new AgentDataSource('srv-1', 'agent-1');
    const { session } = createSession();
    const events: Array<{ reason?: string }> = [];

    ds.on('sessionDetached', (info: { reason?: string }) => events.push(info));
    ds.attachSession(session);
    ds.detachSession(session, 'metrics_timeout');

    expect(events).toEqual([{ reason: 'metrics_timeout' }]);
  });

  it('preserves latestSnapshot after detach', async () => {
    const ds = new AgentDataSource('srv-1', 'agent-1');
    const { session } = createSession();
    const snapshot = createSnapshot();

    ds.attachSession(session);
    ds.pushMetrics(snapshot);
    ds.detachSession(session, 'metrics_timeout');

    expect(ds.isConnected()).toBe(false);
    // latestSnapshot should be preserved for stale display
    await expect(ds.collectMetrics()).resolves.toEqual(snapshot);
  });

  it('does not emit sessionDetached when detaching a non-current session', () => {
    const ds = new AgentDataSource('srv-1', 'agent-1');
    const first = createSession();
    const second = createSession();
    const events: string[] = [];

    ds.on('sessionDetached', () => events.push('detached'));
    ds.attachSession(first.session);
    ds.attachSession(second.session);
    ds.detachSession(first.session, 'old');

    expect(events).toEqual([]);
    expect(ds.isConnected()).toBe(true);
  });

  it('normalizes snake_case task events from the agent session', async () => {
    const ds = new AgentDataSource('srv-1', 'agent-1');
    const { session, requestTaskEvents } = createSession();
    ds.attachSession(session);

    requestTaskEvents.mockResolvedValue([
      {
        id: 7,
        task_id: 'task-7',
        event_type: 'schedule_blocked',
        timestamp: 1_710_000_000,
        details: {
          reason_code: 'blocked_by_higher_priority',
        },
      },
    ]);

    await expect(ds.getTaskEvents('task-7')).resolves.toEqual([
      {
        id: 7,
        taskId: 'task-7',
        eventType: 'schedule_blocked',
        timestamp: 1_710_000_000,
        details: {
          reason_code: 'blocked_by_higher_priority',
        },
      },
    ]);
  });

  it('normalizes snake_case audit detail from the agent session', async () => {
    const ds = new AgentDataSource('srv-1', 'agent-1');
    const { session, requestTaskAuditDetail } = createSession();
    ds.attachSession(session);

    requestTaskAuditDetail.mockResolvedValue({
      task: {
        id: 'task-9',
        command: 'python train.py',
        cwd: '/srv/jobs',
        user: 'alice',
        require_vram_mb: 4096,
        require_gpu_count: 2,
        gpu_ids: [0, 1],
        priority: 3,
        status: 'queued',
        created_at: 100,
        started_at: null,
        finished_at: null,
        exit_code: null,
        pid: null,
      },
      events: [
        {
          id: 1,
          task_id: 'task-9',
          event_type: 'submitted',
          timestamp: 100,
          details: {
            require_gpu_count: 2,
          },
        },
      ],
      runtime: {
        launch_mode: 'daemon_shell',
        root_pid: 1234,
        root_created_at: 101,
        runtime_phase: 'running',
        first_started_at: 101,
        last_seen_at: 110,
        finalize_source: null,
        finalize_reason_code: null,
        last_observed_exit_code: null,
      },
    });

    await expect(ds.getTaskAuditDetail('task-9')).resolves.toEqual({
      task: {
        serverId: 'srv-1',
        taskId: 'task-9',
        command: 'python train.py',
        cwd: '/srv/jobs',
        user: 'alice',
        requireVramMB: 4096,
        requireGpuCount: 2,
        gpuIds: [0, 1],
        priority: 3,
        status: 'queued',
        createdAt: 100,
        startedAt: null,
        finishedAt: null,
        exitCode: null,
        pid: null,
      },
      events: [
        {
          id: 1,
          taskId: 'task-9',
          eventType: 'submitted',
          timestamp: 100,
          details: {
            require_gpu_count: 2,
          },
        },
      ],
      runtime: {
        launchMode: 'daemon_shell',
        rootPid: 1234,
        rootCreatedAt: 101,
        runtimePhase: 'running',
        firstStartedAt: 101,
        lastSeenAt: 110,
        finalizeSource: null,
        finalizeReasonCode: null,
        lastObservedExitCode: null,
      },
    });
  });
});
