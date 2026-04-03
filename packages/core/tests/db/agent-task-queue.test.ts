import { describe, expect, it } from 'vitest';
import { createServer, getAgentTaskQueueGroups, upsertAgentTask } from '../../src/index.js';

describe('agent task queue helpers', () => {
  it('groups only agent servers and sorts queued, running, and recent tasks', () => {
    const agentA = createServer({
      name: 'agent-a',
      host: 'agent-a.local',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key-a',
      sourceType: 'agent',
      agentId: 'agent-a',
    });
    const agentB = createServer({
      name: 'agent-b',
      host: 'agent-b.local',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key-b',
      sourceType: 'agent',
      agentId: 'agent-b',
    });
    const sshOnly = createServer({
      name: 'ssh-only',
      host: 'ssh-only.local',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key-c',
    });

    upsertAgentTask({
      taskId: 'queued-low',
      serverId: agentA.id,
      status: 'queued',
      command: 'python low.py',
      priority: 1,
      createdAt: 1_000,
    });
    upsertAgentTask({
      taskId: 'queued-high-old',
      serverId: agentA.id,
      status: 'queued',
      command: 'python high-old.py',
      priority: 5,
      createdAt: 2_000,
    });
    upsertAgentTask({
      taskId: 'queued-high-new',
      serverId: agentA.id,
      status: 'queued',
      command: 'python high-new.py',
      priority: 5,
      createdAt: 3_000,
    });
    upsertAgentTask({
      taskId: 'running-old',
      serverId: agentA.id,
      status: 'running',
      command: 'python run-old.py',
      startedAt: 4_000,
      pid: 401,
    });
    upsertAgentTask({
      taskId: 'running-new',
      serverId: agentA.id,
      status: 'running',
      command: 'python run-new.py',
      startedAt: 5_000,
      pid: 402,
    });
    upsertAgentTask({
      taskId: 'completed-new',
      serverId: agentA.id,
      status: 'completed',
      command: 'python done-new.py',
      finishedAt: 8_000,
      exitCode: 0,
    });
    upsertAgentTask({
      taskId: 'failed-mid',
      serverId: agentA.id,
      status: 'failed',
      command: 'python failed.py',
      finishedAt: 7_000,
      exitCode: 1,
    });
    upsertAgentTask({
      taskId: 'cancelled-old',
      serverId: agentA.id,
      status: 'cancelled',
      command: 'python cancelled.py',
      finishedAt: 6_000,
      exitCode: 130,
    });

    for (let index = 0; index < 22; index += 1) {
      upsertAgentTask({
        taskId: `recent-${index}`,
        serverId: agentB.id,
        status: index % 2 === 0 ? 'completed' : 'failed',
        command: `python recent-${index}.py`,
        finishedAt: 10_000 + index,
        exitCode: index % 2,
      });
    }

    upsertAgentTask({
      taskId: 'ignored-ssh-task',
      serverId: sshOnly.id,
      status: 'queued',
      command: 'python ignore.py',
      priority: 99,
      createdAt: 9_000,
    });

    expect(getAgentTaskQueueGroups()).toEqual([
      {
        serverId: agentA.id,
        serverName: 'agent-a',
        queued: [
          expect.objectContaining({ taskId: 'queued-high-new' }),
          expect.objectContaining({ taskId: 'queued-high-old' }),
          expect.objectContaining({ taskId: 'queued-low' }),
        ],
        running: [
          expect.objectContaining({ taskId: 'running-new' }),
          expect.objectContaining({ taskId: 'running-old' }),
        ],
        recent: [
          expect.objectContaining({ taskId: 'completed-new' }),
          expect.objectContaining({ taskId: 'failed-mid' }),
          expect.objectContaining({ taskId: 'cancelled-old' }),
        ],
      },
      {
        serverId: agentB.id,
        serverName: 'agent-b',
        queued: [],
        running: [],
        recent: Array.from({ length: 20 }, (_, offset) =>
          expect.objectContaining({ taskId: `recent-${21 - offset}` })
        ),
      },
    ]);
  });
});