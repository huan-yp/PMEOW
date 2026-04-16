import { describe, expect, it, vi } from 'vitest';
import { AgentCommandService } from '../../src/agent/command-service.js';
import { AgentCommandError } from '../../src/agent/errors.js';
import { AgentDataSource } from '../../src/datasource/agent-datasource.js';
import { AgentSessionRegistry } from '../../src/agent/registry.js';
import type { AgentLiveSession } from '../../src/agent/registry.js';
import type { NodeDataSource } from '../../src/datasource/types.js';

function createMockSession(agentId = 'agent-1'): AgentLiveSession {
  return {
    agentId,
    emitCommand: vi.fn(),
    requestTaskEvents: vi.fn().mockResolvedValue([]),
    requestTaskAuditDetail: vi.fn().mockResolvedValue(null),
  };
}

function createTestSetup(options?: { sourceType?: 'agent' | 'ssh'; withSession?: boolean }) {
  const registry = new AgentSessionRegistry();
  const serverId = 'server-1';
  const agentId = 'agent-1';
  const session = createMockSession(agentId);
  const ds = new AgentDataSource(serverId, agentId);
  const dataSources = new Map<string, NodeDataSource>();

  if (options?.sourceType !== 'ssh') {
    dataSources.set(serverId, ds);
  }

  if (options?.withSession !== false) {
    registry.attachSession(session, { serverId });
    ds.attachSession(session);
  }

  const service = new AgentCommandService({
    agentRegistry: registry,
    getDataSource: (id) => dataSources.get(id),
  });

  return { service, registry, session, ds, serverId };
}

describe('AgentCommandService', () => {
  describe('resolveAgentDataSource', () => {
    it('should throw offline when no dataSource exists', () => {
      const { service } = createTestSetup();
      expect(() => service.cancelTask('unknown-server', 'task-1')).toThrow(AgentCommandError);
      try {
        service.cancelTask('unknown-server', 'task-1');
      } catch (e) {
        expect((e as AgentCommandError).code).toBe('offline');
      }
    });

    it('should throw offline when session not attached', () => {
      const { service, serverId } = createTestSetup({ withSession: false });
      expect(() => service.cancelTask(serverId, 'task-1')).toThrow(AgentCommandError);
      try {
        service.cancelTask(serverId, 'task-1');
      } catch (e) {
        expect((e as AgentCommandError).code).toBe('offline');
      }
    });
  });

  describe('cancelTask', () => {
    it('should emit cancel command via dataSource', () => {
      const { service, serverId, session } = createTestSetup();
      service.cancelTask(serverId, 'task-1');
      expect(session.emitCommand).toHaveBeenCalledWith(
        expect.objectContaining({ data: { taskId: 'task-1' } }),
      );
    });
  });

  describe('pauseQueue', () => {
    it('should emit pause command', () => {
      const { service, serverId, session } = createTestSetup();
      service.pauseQueue(serverId);
      expect(session.emitCommand).toHaveBeenCalled();
    });
  });

  describe('resumeQueue', () => {
    it('should emit resume command', () => {
      const { service, serverId, session } = createTestSetup();
      service.resumeQueue(serverId);
      expect(session.emitCommand).toHaveBeenCalled();
    });
  });

  describe('setPriority', () => {
    it('should emit setPriority command', () => {
      const { service, serverId, session } = createTestSetup();
      service.setPriority(serverId, 'task-1', 5);
      expect(session.emitCommand).toHaveBeenCalledWith(
        expect.objectContaining({ data: { taskId: 'task-1', priority: 5 } }),
      );
    });
  });

  describe('getTaskEvents', () => {
    it('should return events on success', async () => {
      const { service, serverId, session } = createTestSetup();
      const mockEvents = [{ id: 1, taskId: 'task-1', type: 'started', payload: '{}', createdAt: '2026-01-01' }];
      (session.requestTaskEvents as ReturnType<typeof vi.fn>).mockResolvedValue(mockEvents);
      const result = await service.getTaskEvents(serverId, 'task-1');
      expect(result).toEqual(mockEvents);
    });

    it('should wrap timeout errors', async () => {
      const { service, serverId, session } = createTestSetup();
      (session.requestTaskEvents as ReturnType<typeof vi.fn>).mockRejectedValue(
        new AgentCommandError('timeout'),
      );
      await expect(service.getTaskEvents(serverId, 'task-1')).rejects.toThrow(AgentCommandError);
      try {
        await service.getTaskEvents(serverId, 'task-1');
      } catch (e) {
        expect((e as AgentCommandError).code).toBe('timeout');
      }
    });
  });

  describe('getTaskAuditDetail', () => {
    it('should return audit detail on success', async () => {
      const { service, serverId, session } = createTestSetup();
      const mockDetail = { task: {}, events: [], runtime: null };
      (session.requestTaskAuditDetail as ReturnType<typeof vi.fn>).mockResolvedValue(mockDetail);
      const result = await service.getTaskAuditDetail(serverId, 'task-1');
      expect(result).toEqual(mockDetail);
    });

    it('should wrap transport errors', async () => {
      const { service, serverId, session } = createTestSetup();
      (session.requestTaskAuditDetail as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('connection lost'),
      );
      await expect(service.getTaskAuditDetail(serverId, 'task-1')).rejects.toThrow(AgentCommandError);
      try {
        await service.getTaskAuditDetail(serverId, 'task-1');
      } catch (e) {
        expect((e as AgentCommandError).code).toBe('internal');
      }
    });
  });
});
