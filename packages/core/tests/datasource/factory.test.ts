import { describe, it, expect } from 'vitest';
import { createDataSource } from '../../src/datasource/factory.js';
import { SSHDataSource } from '../../src/datasource/ssh-datasource.js';
import { AgentDataSource } from '../../src/datasource/agent-datasource.js';
import type { ServerConfig } from '../../src/types.js';

const baseServer: ServerConfig = {
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

describe('createDataSource', () => {
  it('should create SSHDataSource for ssh sourceType', () => {
    const ds = createDataSource(baseServer);
    expect(ds).toBeInstanceOf(SSHDataSource);
    expect(ds.type).toBe('ssh');
  });

  it('should create AgentDataSource for agent sourceType', () => {
    const ds = createDataSource({ ...baseServer, sourceType: 'agent', agentId: 'a-1' });
    expect(ds).toBeInstanceOf(AgentDataSource);
    expect(ds.type).toBe('agent');
  });
});
