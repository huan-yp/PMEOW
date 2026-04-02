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
