import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabase } from '../../src/db/database.js';
import { getAllServers, createServer, getServerById, updateServer, deleteServer } from '../../src/db/servers.js';
import type { ServerInput } from '../../src/types.js';

beforeEach(() => {
  getDatabase();
});

const testInput: ServerInput = {
  name: 'test-server',
  host: '192.168.1.1',
  port: 22,
  username: 'root',
  privateKeyPath: '/tmp/test_key',
};

describe('servers CRUD', () => {
  it('should start empty', () => {
    expect(getAllServers()).toEqual([]);
  });

  it('should create and retrieve a server', () => {
    const server = createServer(testInput);
    expect(server.id).toBeDefined();
    expect(server.name).toBe('test-server');
    expect(server.host).toBe('192.168.1.1');

    const found = getServerById(server.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('test-server');
  });

  it('should update a server', () => {
    const server = createServer(testInput);
    const updated = updateServer(server.id, { name: 'renamed' });
    expect(updated!.name).toBe('renamed');
    expect(updated!.host).toBe('192.168.1.1');
  });

  it('should delete a server', () => {
    const server = createServer(testInput);
    expect(deleteServer(server.id)).toBe(true);
    expect(getServerById(server.id)).toBeUndefined();
  });
});

describe('server sourceType and agentId fields', () => {
  it('should default sourceType to ssh and agentId to null', () => {
    const server = createServer(testInput);
    expect(server.sourceType).toBe('ssh');
    expect(server.agentId).toBeNull();
  });

  it('should allow creating a server with agent sourceType', () => {
    const server = createServer({ ...testInput, sourceType: 'agent', agentId: 'agent-001' });
    expect(server.sourceType).toBe('agent');
    expect(server.agentId).toBe('agent-001');
  });

  it('should update sourceType', () => {
    const server = createServer(testInput);
    const updated = updateServer(server.id, { sourceType: 'agent', agentId: 'agent-002' });
    expect(updated!.sourceType).toBe('agent');
    expect(updated!.agentId).toBe('agent-002');
  });
});
