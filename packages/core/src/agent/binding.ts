import type { ServerConfig } from '../types.js';
import {
  bindAgentToServer,
  createServer,
  getServerByAgentId,
  getServersByHost,
} from '../db/servers.js';

export interface BoundAgentBindingResolution {
  status: 'bound';
  server: ServerConfig;
  restored: boolean;
}

export interface ConflictAgentBindingResolution {
  status: 'conflict';
  hostname: string;
  matches: ServerConfig[];
}

export interface UnmatchedAgentBindingResolution {
  status: 'unmatched';
  hostname: string;
}

export type AgentBindingResolution =
  | BoundAgentBindingResolution
  | ConflictAgentBindingResolution
  | UnmatchedAgentBindingResolution;

export function resolveAgentBinding(agentId: string, hostname: string): AgentBindingResolution {
  const existing = getServerByAgentId(agentId);
  if (existing) {
    const restored = existing.sourceType === 'agent'
      ? existing
      : bindAgentToServer(existing.id, agentId);

    if (restored) {
      return {
        status: 'bound',
        server: restored,
        restored: true,
      };
    }
  }

  const matches = getServersByHost(hostname);

  if (matches.length === 1) {
    const server = bindAgentToServer(matches[0].id, agentId);
    if (server) {
      return {
        status: 'bound',
        server,
        restored: false,
      };
    }
  }

  if (matches.length > 1) {
    return {
      status: 'conflict',
      hostname,
      matches,
    };
  }

  return {
    status: 'unmatched',
    hostname,
  };
}

/**
 * Auto-create a server entry for a first-time agent and bind it.
 * Call this when resolveAgentBinding returns 'unmatched'.
 */
export function autoCreateAgentServer(agentId: string, hostname: string): BoundAgentBindingResolution {
  const server = createServer({
    name: hostname,
    host: hostname,
    port: 0,
    username: '',
    privateKeyPath: '',
    sourceType: 'agent',
    agentId,
  });
  return {
    status: 'bound',
    server,
    restored: false,
  };
}