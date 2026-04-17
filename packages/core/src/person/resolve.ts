import { ResolvedPersonSummary, PersonResolutionSource } from '../types.js';
import * as personBindingDb from '../db/person-bindings.js';
import * as personDb from '../db/persons.js';

export function resolveRawUserPerson(
  serverId: string, 
  rawUser: string | undefined, 
  timestamp: number
): { person: ResolvedPersonSummary | null; resolutionSource: PersonResolutionSource } {
  if (!rawUser) {
    return { person: null, resolutionSource: 'unknown' };
  }

  const binding = personBindingDb.getActiveBinding(serverId, rawUser);
  if (binding) {
    const person = personDb.getPersonById(binding.personId);
    if (person) {
      return {
        person: {
          id: person.id,
          displayName: person.displayName,
          email: person.email,
          qq: person.qq
        },
        resolutionSource: 'binding'
      };
    }
  }

  return { person: null, resolutionSource: 'unassigned' };
}
