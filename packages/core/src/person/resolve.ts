import { getPersonById, getActivePersonBinding, getActiveTaskOwnerOverride } from '../db/persons.js';
import type { ResolvedPersonSummary, PersonResolutionSource } from '../types.js';

function toResolvedPersonSummary(person: ReturnType<typeof getPersonById>): ResolvedPersonSummary | null {
  if (!person) return null;
  return { id: person.id, displayName: person.displayName, email: person.email, qq: person.qq };
}

export function resolveTaskPerson(
  serverId: string,
  taskId: string,
  rawUser: string | undefined,
  timestamp: number,
): { person: ResolvedPersonSummary; resolutionSource: PersonResolutionSource } | { person: null; resolutionSource: PersonResolutionSource } {
  const override = getActiveTaskOwnerOverride(taskId, timestamp);
  if (override) {
    return { person: toResolvedPersonSummary(getPersonById(override.personId))!, resolutionSource: 'override' };
  }

  if (rawUser) {
    const binding = getActivePersonBinding(serverId, rawUser, timestamp);
    if (binding) {
      return { person: toResolvedPersonSummary(getPersonById(binding.personId))!, resolutionSource: 'binding' };
    }
    return { person: null, resolutionSource: 'unassigned' };
  }

  return { person: null, resolutionSource: 'unknown' };
}

export function resolveRawUserPerson(
  serverId: string,
  rawUser: string | undefined,
  timestamp: number,
): { person: ResolvedPersonSummary | null; resolutionSource: PersonResolutionSource } {
  if (rawUser) {
    const binding = getActivePersonBinding(serverId, rawUser, timestamp);
    if (binding) {
      return { person: toResolvedPersonSummary(getPersonById(binding.personId)), resolutionSource: 'binding' };
    }
    return { person: null, resolutionSource: 'unassigned' };
  }
  return { person: null, resolutionSource: 'unknown' };
}
