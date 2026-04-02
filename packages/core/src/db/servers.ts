import { randomUUID } from 'crypto';
import { getDatabase } from './database.js';
import type { ServerConfig, ServerInput } from '../types.js';

export function getAllServers(): ServerConfig[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM servers ORDER BY createdAt ASC').all() as ServerConfig[];
}

export function getServerById(id: string): ServerConfig | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as ServerConfig | undefined;
}

export function getServerByAgentId(agentId: string): ServerConfig | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM servers WHERE agentId = ? ORDER BY updatedAt DESC LIMIT 1').get(agentId) as ServerConfig | undefined;
}

export function getServersByHost(hostname: string): ServerConfig[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM servers WHERE host = ? ORDER BY createdAt ASC, id ASC').all(hostname) as ServerConfig[];
}

export function createServer(input: ServerInput): ServerConfig {
  const db = getDatabase();
  const now = Date.now();
  const server: ServerConfig = {
    id: randomUUID(),
    ...input,
    sourceType: input.sourceType ?? 'ssh',
    agentId: input.agentId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    'INSERT INTO servers (id, name, host, port, username, privateKeyPath, sourceType, agentId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(server.id, server.name, server.host, server.port, server.username, server.privateKeyPath, server.sourceType, server.agentId, server.createdAt, server.updatedAt);
  return server;
}

export function updateServer(id: string, input: Partial<ServerInput>): ServerConfig | undefined {
  const db = getDatabase();
  const existing = getServerById(id);
  if (!existing) return undefined;

  const updated: ServerConfig = {
    ...existing,
    ...input,
    sourceType: input.sourceType ?? existing.sourceType,
    agentId: input.agentId !== undefined ? input.agentId : existing.agentId,
    updatedAt: Date.now(),
  };
  db.prepare(
    'UPDATE servers SET name = ?, host = ?, port = ?, username = ?, privateKeyPath = ?, sourceType = ?, agentId = ?, updatedAt = ? WHERE id = ?'
  ).run(updated.name, updated.host, updated.port, updated.username, updated.privateKeyPath, updated.sourceType, updated.agentId, updated.updatedAt, id);
  return updated;
}

export function bindAgentToServer(serverId: string, agentId: string): ServerConfig | undefined {
  return updateServer(serverId, {
    sourceType: 'agent',
    agentId,
  });
}

export function deleteServer(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM servers WHERE id = ?').run(id);
  return result.changes > 0;
}
