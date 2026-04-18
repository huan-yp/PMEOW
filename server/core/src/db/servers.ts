import { getDatabase } from './database.js';
import { ServerRecord, ServerInput } from '../types.js';
import { randomUUID } from 'crypto';

export function getAllServers(): ServerRecord[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM servers ORDER BY name ASC').all();
  return (rows as any[]).map(r => ({
    id: r.id,
    name: r.name,
    agentId: r.agent_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}

export function getServerById(id: string): ServerRecord | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  if (!row) return undefined;
  const r = row as any;
  return {
    id: r.id,
    name: r.name,
    agentId: r.agent_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export function getServerByAgentId(agentId: string): ServerRecord | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM servers WHERE agent_id = ?').get(agentId);
  if (!row) return undefined;
  const r = row as any;
  return {
    id: r.id,
    name: r.name,
    agentId: r.agent_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export function createServer(input: ServerInput): ServerRecord {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();
  db.prepare('INSERT INTO servers (id, name, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    id, input.name, input.agentId, now, now
  );
  return { id, ...input, createdAt: now, updatedAt: now };
}

export function updateServer(id: string, input: Partial<ServerInput>): ServerRecord | undefined {
  const db = getDatabase();
  const existing = getServerById(id);
  if (!existing) return undefined;

  const name = input.name ?? existing.name;
  const agentId = input.agentId ?? existing.agentId;
  const now = Date.now();

  db.prepare('UPDATE servers SET name = ?, agent_id = ?, updated_at = ? WHERE id = ?').run(
    name, agentId, now, id
  );

  return { ...existing, name, agentId, updatedAt: now };
}

export function deleteServer(id: string): boolean {
  const db = getDatabase();
  const info = db.prepare('DELETE FROM servers WHERE id = ?').run(id);
  return info.changes > 0;
}
