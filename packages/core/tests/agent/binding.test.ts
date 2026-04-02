import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAgentBinding } from '../../src/agent/binding.js';
import { getDatabase } from '../../src/db/database.js';
import { createServer, getServerById } from '../../src/db/servers.js';
import { AgentDataSource } from '../../src/datasource/agent-datasource.js';
import { SSHDataSource } from '../../src/datasource/ssh-datasource.js';
import { Scheduler } from '../../src/scheduler.js';

beforeEach(() => {
  getDatabase();
});

describe('resolveAgentBinding', () => {
  it('unique hostname auto-binds and flips sourceType to agent', () => {
    const server = createServer({
      name: 'gpu-01',
      host: 'gpu-01',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
    });

    const resolution = resolveAgentBinding('agent-01', 'gpu-01');

    expect(resolution.status).toBe('bound');
    if (resolution.status !== 'bound') {
      return;
    }

    expect(resolution.restored).toBe(false);
    expect(resolution.server.id).toBe(server.id);
    expect(resolution.server.sourceType).toBe('agent');
    expect(resolution.server.agentId).toBe('agent-01');
    expect(getServerById(server.id)?.sourceType).toBe('agent');
    expect(getServerById(server.id)?.agentId).toBe('agent-01');
  });

  it('duplicate hostname returns conflict and does not bind automatically', () => {
    const first = createServer({
      name: 'gpu-dup-a',
      host: 'gpu-dup',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
    });
    const second = createServer({
      name: 'gpu-dup-b',
      host: 'gpu-dup',
      port: 2202,
      username: 'root',
      privateKeyPath: '/tmp/key',
    });

    const resolution = resolveAgentBinding('agent-dup', 'gpu-dup');

    expect(resolution.status).toBe('conflict');
    if (resolution.status !== 'conflict') {
      return;
    }

    expect(resolution.matches).toHaveLength(2);
    expect(resolution.matches.map(server => server.id).sort()).toEqual([first.id, second.id].sort());
    expect(getServerById(first.id)?.sourceType).toBe('ssh');
    expect(getServerById(first.id)?.agentId).toBeNull();
    expect(getServerById(second.id)?.sourceType).toBe('ssh');
    expect(getServerById(second.id)?.agentId).toBeNull();
  });

  it('reconnect with same agentId restores previous binding', () => {
    const server = createServer({
      name: 'gpu-restore',
      host: 'gpu-restore',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
    });

    const initial = resolveAgentBinding('agent-restore', 'gpu-restore');
    expect(initial.status).toBe('bound');

    const restored = resolveAgentBinding('agent-restore', 'different-hostname');

    expect(restored.status).toBe('bound');
    if (restored.status !== 'bound') {
      return;
    }

    expect(restored.restored).toBe(true);
    expect(restored.server.id).toBe(server.id);
    expect(restored.server.sourceType).toBe('agent');
    expect(restored.server.agentId).toBe('agent-restore');
  });
});

describe('Scheduler.refreshServerDataSource', () => {
  it('disconnects old ssh datasource and replaces it with an agent datasource', () => {
    const server = createServer({
      name: 'gpu-refresh',
      host: 'gpu-refresh',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
    });

    const scheduler = new Scheduler();
    scheduler.initDataSources();

    const initial = scheduler.getDataSource(server.id);
    expect(initial).toBeInstanceOf(SSHDataSource);

    const disconnectSpy = vi.spyOn(initial as SSHDataSource, 'disconnect');
    const resolution = resolveAgentBinding('agent-refresh', 'gpu-refresh');
    expect(resolution.status).toBe('bound');

    scheduler.refreshServerDataSource(server.id);

    expect(disconnectSpy).toHaveBeenCalledOnce();

    const refreshed = scheduler.getDataSource(server.id);
    expect(refreshed).toBeInstanceOf(AgentDataSource);
    expect(refreshed).not.toBe(initial);
    expect((refreshed as AgentDataSource).agentId).toBe('agent-refresh');

    scheduler.stop();
  });
});