import type { Principal } from '../types.js';
import * as personBindingDb from '../db/person-bindings.js';

export function canAccessServer(principal: Principal, serverId: string): boolean {
  if (principal.kind === 'admin') return true;
  const bindings = personBindingDb.getBindingsByPersonId(principal.personId);
  return bindings.some(b => b.serverId === serverId && b.enabled);
}

export function canAccessTask(principal: Principal, serverId: string, taskUser: string): boolean {
  if (principal.kind === 'admin') return true;
  const bindings = personBindingDb.getBindingsByPersonId(principal.personId);
  return bindings.some(b => b.serverId === serverId && b.systemUser === taskUser && b.enabled);
}

export function getAccessibleServerIds(principal: Principal): string[] | null {
  if (principal.kind === 'admin') return null;
  const bindings = personBindingDb.getBindingsByPersonId(principal.personId);
  return [...new Set(bindings.filter(b => b.enabled).map(b => b.serverId))];
}
