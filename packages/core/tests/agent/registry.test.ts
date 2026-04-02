import { describe, expect, it, vi } from 'vitest';
import type { AgentLiveSession } from '../../src/agent/registry.js';
import { AgentSessionRegistry } from '../../src/agent/registry.js';

function createSession(agentId = 'agent-1') {
  const emitCommand = vi.fn();
  const session: AgentLiveSession = {
    agentId,
    emitCommand,
  };

  return { session, emitCommand };
}

describe('AgentSessionRegistry', () => {
  it('attaches and gets sessions by agentId', () => {
    const registry = new AgentSessionRegistry();
    const { session } = createSession();

    registry.attachSession(session);

    expect(registry.getSession('agent-1')).toBe(session);
  });

  it('replaces the session for the same agentId', () => {
    const registry = new AgentSessionRegistry();
    const first = createSession();
    const replacement = createSession();

    registry.attachSession(first.session, { serverId: 'srv-1' });
    registry.attachSession(replacement.session);
    registry.detachSession('agent-1', first.session);

    expect(registry.getSession('agent-1')).toBe(replacement.session);
    expect(registry.getSessionByServerId('srv-1')).toBe(replacement.session);
  });

  it('binds serverId and reads back by serverId', () => {
    const registry = new AgentSessionRegistry();
    const { session } = createSession();

    registry.attachSession(session);
    registry.bindServer('agent-1', 'srv-1');

    expect(registry.getSessionByServerId('srv-1')).toBe(session);
  });

  it('updates heartbeat timestamps', () => {
    const registry = new AgentSessionRegistry();

    registry.updateHeartbeat('agent-1', 1712010000);

    expect(registry.getLastHeartbeat('agent-1')).toBe(1712010000);
  });

  it('detach removes lookups', () => {
    const registry = new AgentSessionRegistry();
    const { session } = createSession();

    registry.attachSession(session, { serverId: 'srv-1' });
    registry.detachSession('agent-1');

    expect(registry.getSession('agent-1')).toBeUndefined();
    expect(registry.getSessionByServerId('srv-1')).toBeUndefined();
  });
});
