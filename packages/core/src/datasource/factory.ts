import type { ServerConfig } from '../types.js';
import type { NodeDataSource } from './types.js';
import { SSHDataSource } from './ssh-datasource.js';
import { AgentDataSource } from './agent-datasource.js';
import { SSHManager } from '../ssh/manager.js';

export function createDataSource(server: ServerConfig, sharedSSH?: SSHManager): NodeDataSource {
  switch (server.sourceType) {
    case 'agent':
      return new AgentDataSource(server.id, server.agentId);
    case 'ssh':
    default:
      return new SSHDataSource(server, sharedSSH);
  }
}
