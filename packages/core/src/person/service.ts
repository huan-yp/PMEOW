import { getDatabase } from '../db/database.js';
import * as personDb from '../db/persons.js';
import * as personBindingDb from '../db/person-bindings.js';
import * as snapshotDb from '../db/snapshots.js';
import * as taskDb from '../db/tasks.js';
import {
  CreatePersonWizardInput,
  CreatePersonWizardResult,
  GpuSnapshotRecord,
  PersonBindingConflict,
  PersonTimelinePoint,
  TaskRecord,
} from '../types.js';

export class PersonWizardConflictError extends Error {
  readonly conflicts: PersonBindingConflict[];

  constructor(conflicts: PersonBindingConflict[]) {
    super('Selected system users are already bound to another person');
    this.name = 'PersonWizardConflictError';
    this.conflicts = conflicts;
  }
}

export function createPersonFromWizard(input: CreatePersonWizardInput): CreatePersonWizardResult {
  const displayName = input.person.displayName.trim();
  if (!displayName) {
    throw new Error('displayName is required');
  }

  const bindings = dedupeBindings(input.bindings);
  const conflicts = bindings
    .map<PersonBindingConflict | null>((binding) => {
      const activeBinding = personBindingDb.getActiveBinding(binding.serverId, binding.systemUser);
      if (!activeBinding) {
        return null;
      }

      const activePerson = personDb.getPersonById(activeBinding.personId) ?? null;
      return {
        serverId: binding.serverId,
        systemUser: binding.systemUser,
        activeBinding,
        activePerson: activePerson ? {
          id: activePerson.id,
          displayName: activePerson.displayName,
          email: activePerson.email,
          qq: activePerson.qq,
        } : null,
      };
    })
    .filter((conflict): conflict is PersonBindingConflict => conflict !== null);

  if (conflicts.length > 0 && !input.confirmTransfer) {
    throw new PersonWizardConflictError(conflicts);
  }

  const db = getDatabase();
  return db.transaction(() => {
    const person = personDb.createPerson({
      displayName,
      email: normalizeNullable(input.person.email),
      qq: normalizeNullable(input.person.qq),
      note: normalizeNullable(input.person.note),
    });

    const createdBindings = [];
    for (const conflict of conflicts) {
      personBindingDb.deactivateBinding(conflict.activeBinding.id);
    }

    for (const binding of bindings) {
      createdBindings.push(personBindingDb.createBinding({
        personId: person.id,
        serverId: binding.serverId,
        systemUser: binding.systemUser,
        source: binding.source ?? (input.mode === 'seed-user' ? 'suggested' : 'manual'),
      }));
    }

    return {
      person,
      bindings: createdBindings,
      transferredBindings: conflicts,
    };
  })();
}

export function getPersonTimeline(personId: string, from: number, to: number): { points: PersonTimelinePoint[] } {
  const bindings = personBindingDb.getBindingsByPersonId(personId);
  const result: PersonTimelinePoint[] = [];

  for (const binding of bindings) {
    const snapshots = snapshotDb.getSnapshotHistory(binding.serverId, from, to);
    for (const snap of snapshots) {
      for (const gpu of snap.gpuSnapshots) {
        const userProcs = JSON.parse(gpu.userProcesses as string) as any[];
        const vramMb = userProcs
          .filter((proc) => proc.user === binding.systemUser)
          .reduce((sum, proc) => sum + Number(proc.vramMb ?? 0), 0);
        if (vramMb > 0) {
          result.push({
            timestamp: snap.timestamp,
            vramMb,
            serverId: binding.serverId,
            gpuIndex: gpu.gpuIndex,
          });
        }
      }
    }
  }

  return { points: result.sort((a, b) => a.timestamp - b.timestamp) };
}

export function getPersonTasks(personId: string, page: number, limit: number): { tasks: TaskRecord[]; total: number } {
  const bindings = personBindingDb.getBindingsByPersonId(personId);
  let allTasks: TaskRecord[] = [];

  for (const binding of bindings) {
    const tasks = taskDb.getTasks({ serverId: binding.serverId, user: binding.systemUser });
    allTasks = allTasks.concat(tasks);
  }

  const tasks = allTasks
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice((page - 1) * limit, page * limit);

  return {
    tasks,
    total: allTasks.length,
  };
}

function dedupeBindings(bindings: CreatePersonWizardInput['bindings']): CreatePersonWizardInput['bindings'] {
  const seen = new Set<string>();
  return bindings.filter((binding) => {
    const key = `${binding.serverId}::${binding.systemUser}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
