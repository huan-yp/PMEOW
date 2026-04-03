import { getDatabase } from './database.js';
import type { AgentLocalUserRecord } from '../types.js';

export interface StoredServerLocalUserRecord extends AgentLocalUserRecord {
  serverId: string;
  updatedAt: number;
}

export function replaceServerLocalUsers(
  serverId: string,
  updatedAt: number,
  users: AgentLocalUserRecord[],
): void {
  const db = getDatabase();
  const deleteRows = db.prepare('DELETE FROM server_local_users WHERE serverId = ?');
  const insertRow = db.prepare(`
    INSERT INTO server_local_users (serverId, username, uid, gid, gecos, home, shell, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const replaceRows = db.transaction(() => {
    deleteRows.run(serverId);
    for (const user of users) {
      insertRow.run(
        serverId,
        user.username,
        user.uid,
        user.gid,
        user.gecos,
        user.home,
        user.shell,
        updatedAt,
      );
    }
  });

  replaceRows();
}

export function listServerLocalUsers(serverId?: string): StoredServerLocalUserRecord[] {
  const db = getDatabase();
  const rows = serverId
    ? db.prepare(`
        SELECT serverId, username, uid, gid, gecos, home, shell, updatedAt
        FROM server_local_users
        WHERE serverId = ?
        ORDER BY username ASC
      `).all(serverId)
    : db.prepare(`
        SELECT serverId, username, uid, gid, gecos, home, shell, updatedAt
        FROM server_local_users
        ORDER BY serverId ASC, username ASC
      `).all();

  return rows as StoredServerLocalUserRecord[];
}