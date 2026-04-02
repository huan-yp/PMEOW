import { describe, it, expect } from 'vitest';
import { SSHDataSource } from '../../src/datasource/ssh-datasource.js';
import type { ServerConfig } from '../../src/types.js';

const mockServer: ServerConfig = {
  id: 'srv-1',
  name: 'test',
  host: '192.168.1.1',
  port: 22,
  username: 'root',
  privateKeyPath: '/tmp/key',
  sourceType: 'ssh',
  agentId: null,
  createdAt: 0,
  updatedAt: 0,
};

describe('SSHDataSource', () => {
  it('should have type ssh', () => {
    const ds = new SSHDataSource(mockServer);
    expect(ds.type).toBe('ssh');
    expect(ds.serverId).toBe('srv-1');
  });

  it('should start disconnected', () => {
    const ds = new SSHDataSource(mockServer);
    expect(ds.isConnected()).toBe(false);
    expect(ds.getConnectionStatus()).toBe('disconnected');
  });
});
