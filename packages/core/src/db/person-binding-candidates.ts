import { getDatabase } from './database.js';
import { listServerLocalUsers } from './server-local-users.js';
import type {
  PersonBindingCandidate,
  PersonBindingSuggestion,
} from '../types.js';

interface BindingUserObservation {
  serverId: string;
  systemUser: string;
  lastSeenAt: number;
}

function listBindingUserObservations(): BindingUserObservation[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT f.serverId, f.rawUser, MAX(f.timestamp) as lastSeenAt
    FROM person_attribution_facts f
    WHERE f.rawUser IS NOT NULL
    GROUP BY f.serverId, f.rawUser
  `).all() as Array<{ serverId: string; rawUser: string; lastSeenAt: number }>;

  const merged = new Map<string, BindingUserObservation>();

  for (const row of rows) {
    merged.set(`${row.serverId}:${row.rawUser}`, {
      serverId: row.serverId,
      systemUser: row.rawUser,
      lastSeenAt: row.lastSeenAt,
    });
  }

  for (const row of listServerLocalUsers()) {
    const key = `${row.serverId}:${row.username}`;
    const existing = merged.get(key);
    if (!existing || row.updatedAt > existing.lastSeenAt) {
      merged.set(key, {
        serverId: row.serverId,
        systemUser: row.username,
        lastSeenAt: row.updatedAt,
      });
    }
  }

  return Array.from(merged.values()).sort(
    (left, right) => right.lastSeenAt - left.lastSeenAt
      || left.serverId.localeCompare(right.serverId)
      || left.systemUser.localeCompare(right.systemUser),
  );
}

function getActiveBindingsByServerUser(): Map<string, {
  bindingId: string;
  personId: string;
  personDisplayName: string;
}> {
  const db = getDatabase();
  return new Map(
    (db.prepare(`
      SELECT b.id, b.serverId, b.systemUser, b.personId, p.displayName as personDisplayName
      FROM person_bindings b
      JOIN persons p ON p.id = b.personId
      WHERE b.enabled = 1 AND b.effectiveTo IS NULL
    `).all() as Array<{
      id: string;
      serverId: string;
      systemUser: string;
      personId: string;
      personDisplayName: string;
    }>).map((row) => [
      `${row.serverId}:${row.systemUser}`,
      {
        bindingId: row.id,
        personId: row.personId,
        personDisplayName: row.personDisplayName,
      },
    ]),
  );
}

export function listPersonBindingSuggestions(): PersonBindingSuggestion[] {
  const db = getDatabase();
  const rows = listBindingUserObservations();
  const activeBindings = getActiveBindingsByServerUser();

  const serverNames = new Map(
    (db.prepare('SELECT id, name FROM servers').all() as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]),
  );

  return rows
    .filter((row) => !activeBindings.has(`${row.serverId}:${row.systemUser}`))
    .map((row) => ({
      serverId: row.serverId,
      serverName: serverNames.get(row.serverId) ?? row.serverId,
      systemUser: row.systemUser,
      lastSeenAt: row.lastSeenAt,
    }));
}

export function listPersonBindingCandidates(): PersonBindingCandidate[] {
  const db = getDatabase();
  const rows = listBindingUserObservations();
  const activeBindings = getActiveBindingsByServerUser();

  const serverNames = new Map(
    (db.prepare('SELECT id, name FROM servers').all() as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]),
  );

  return rows.map((row) => ({
    serverId: row.serverId,
    serverName: serverNames.get(row.serverId) ?? row.serverId,
    systemUser: row.systemUser,
    lastSeenAt: row.lastSeenAt,
    activeBinding: activeBindings.get(`${row.serverId}:${row.systemUser}`) ?? null,
  }));
}