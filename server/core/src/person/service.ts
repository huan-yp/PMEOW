import { getDatabase } from '../db/database.js';
import * as personDb from '../db/persons.js';
import * as personBindingDb from '../db/person-bindings.js';
import * as snapshotDb from '../db/snapshots.js';
import * as taskDb from '../db/tasks.js';
import {
  AutoAddReport,
  AutoAddReportEntry,
  CreatePersonWizardInput,
  CreatePersonWizardResult,
  GpuSnapshotRecord,
  PersonBindingRecord,
  PersonBindingConflict,
  PersonDirectoryItem,
  PersonTimelinePoint,
  TaskRecord,
  UserResourceSummary,
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
  const offset = (page - 1) * limit;
  const tasks = taskDb.getTasks({ personId, limit, offset });

  return {
    tasks,
    total: taskDb.countTasks({ personId }),
  };
}

export function getPersonDirectory(): PersonDirectoryItem[] {
  const persons = personDb.listPersons({ includeArchived: true });
  const now = Date.now();
  const snapshotCache = new Map<string, ReturnType<typeof snapshotDb.getLatestSnapshot> | null>();
  const taskCache = new Map<string, TaskRecord[]>();

  const rows = persons.map((person) => {
    const activeBindings = dedupeActiveBindings(personBindingDb.getBindingsByPersonId(person.id), now);
    let currentCpuPercent = 0;
    let currentMemoryMb = 0;
    let currentVramMb = 0;
    let runningTaskCount = 0;
    let queuedTaskCount = 0;
    const activeServerIds = new Set<string>();

    for (const binding of activeBindings) {
      const snapshot = getCachedLatestSnapshot(snapshotCache, binding.serverId);
      const resourceSummary = snapshot ? getUserResourceSummary(snapshot.processesByUser, binding.systemUser) : null;
      const bindingCpuPercent = resourceSummary?.totalCpuPercent ?? 0;
      const bindingMemoryMb = resourceSummary?.totalRssMb ?? 0;
      const bindingVramMb = resourceSummary?.totalVramMb ?? 0;
      const tasks = getCachedTasks(taskCache, binding.serverId, binding.systemUser);
      const bindingRunningTaskCount = tasks.filter((task) => task.status === 'running').length;
      const bindingQueuedTaskCount = tasks.filter((task) => task.status === 'queued').length;

      currentCpuPercent += bindingCpuPercent;
      currentMemoryMb += bindingMemoryMb;
      currentVramMb += bindingVramMb;
      runningTaskCount += bindingRunningTaskCount;
      queuedTaskCount += bindingQueuedTaskCount;

      if (bindingCpuPercent > 0 || bindingMemoryMb > 0 || bindingVramMb > 0 || bindingRunningTaskCount > 0 || bindingQueuedTaskCount > 0) {
        activeServerIds.add(binding.serverId);
      }
    }

    return {
      ...person,
      currentCpuPercent: roundMetric(currentCpuPercent),
      currentMemoryMb: roundMetric(currentMemoryMb),
      currentVramMb,
      runningTaskCount,
      queuedTaskCount,
      activeServerCount: activeServerIds.size,
    } satisfies PersonDirectoryItem;
  });

  return rows.sort(comparePersonDirectoryItems);
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

function dedupeActiveBindings(bindings: PersonBindingRecord[], now: number): PersonBindingRecord[] {
  const seen = new Set<string>();
  const activeBindings: PersonBindingRecord[] = [];

  for (const binding of bindings) {
    if (!isBindingActiveNow(binding, now)) {
      continue;
    }

    const key = `${binding.serverId}::${binding.systemUser}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    activeBindings.push(binding);
  }

  return activeBindings;
}

function isBindingActiveNow(binding: PersonBindingRecord, now: number): boolean {
  if (!binding.enabled) {
    return false;
  }

  if (binding.effectiveFrom !== null && binding.effectiveFrom > now) {
    return false;
  }

  if (binding.effectiveTo !== null && binding.effectiveTo <= now) {
    return false;
  }

  return true;
}

function getCachedLatestSnapshot(
  snapshotCache: Map<string, ReturnType<typeof snapshotDb.getLatestSnapshot> | null>,
  serverId: string,
) {
  if (!snapshotCache.has(serverId)) {
    snapshotCache.set(serverId, snapshotDb.getLatestSnapshot(serverId) ?? null);
  }

  return snapshotCache.get(serverId) ?? null;
}

function getCachedTasks(taskCache: Map<string, TaskRecord[]>, serverId: string, systemUser: string): TaskRecord[] {
  const key = `${serverId}::${systemUser}`;
  if (!taskCache.has(key)) {
    taskCache.set(key, taskDb.getTasks({ serverId, user: systemUser }));
  }

  return taskCache.get(key) ?? [];
}

function getUserResourceSummary(summaries: UserResourceSummary[], systemUser: string): UserResourceSummary | null {
  return summaries.find((summary) => summary.user === systemUser) ?? null;
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10;
}

function comparePersonDirectoryItems(left: PersonDirectoryItem, right: PersonDirectoryItem): number {
  if (left.status !== right.status) {
    return left.status === 'active' ? -1 : 1;
  }

  if (left.currentCpuPercent !== right.currentCpuPercent) {
    return right.currentCpuPercent - left.currentCpuPercent;
  }

  if (left.currentMemoryMb !== right.currentMemoryMb) {
    return right.currentMemoryMb - left.currentMemoryMb;
  }

  if (left.currentVramMb !== right.currentVramMb) {
    return right.currentVramMb - left.currentVramMb;
  }

  return left.displayName.localeCompare(right.displayName, 'zh-CN');
}

export function autoAddUnassignedUsers(): AutoAddReport {
  const db = getDatabase();
  const candidates = personBindingDb.listBindingCandidates();
  const entries: AutoAddReportEntry[] = [];
  let createdCount = 0;
  let reusedCount = 0;
  let skippedCount = 0;

  return db.transaction(() => {
    for (const candidate of candidates) {
      if (candidate.activeBinding) {
        entries.push({
          serverId: candidate.serverId,
          serverName: candidate.serverName,
          systemUser: candidate.systemUser,
          action: 'skipped_bound',
          personId: null,
          personDisplayName: null,
          detail: `已绑定给 ${candidate.activePerson?.displayName ?? candidate.activeBinding.personId}`,
        });
        skippedCount++;
        continue;
      }

      if (candidate.systemUser === 'root') {
        entries.push({
          serverId: candidate.serverId,
          serverName: candidate.serverName,
          systemUser: candidate.systemUser,
          action: 'skipped_root',
          personId: null,
          personDisplayName: null,
          detail: '跳过 root 账号',
        });
        skippedCount++;
        continue;
      }

      const allPersons = personDb.listPersons();
      const sameNamePersons = allPersons.filter(p => p.displayName === candidate.systemUser);

      if (sameNamePersons.length === 1) {
        const person = sameNamePersons[0];
        personBindingDb.createBinding({
          personId: person.id,
          serverId: candidate.serverId,
          systemUser: candidate.systemUser,
          source: 'synced',
        });
        entries.push({
          serverId: candidate.serverId,
          serverName: candidate.serverName,
          systemUser: candidate.systemUser,
          action: 'reused',
          personId: person.id,
          personDisplayName: person.displayName,
          detail: `复用已有人员 ${person.displayName}`,
        });
        reusedCount++;
      } else if (sameNamePersons.length > 1) {
        entries.push({
          serverId: candidate.serverId,
          serverName: candidate.serverName,
          systemUser: candidate.systemUser,
          action: 'skipped_ambiguous',
          personId: null,
          personDisplayName: null,
          detail: `找到 ${sameNamePersons.length} 个同名人员，无法自动判断`,
        });
        skippedCount++;
      } else {
        const person = personDb.createPerson({ displayName: candidate.systemUser });
        personBindingDb.createBinding({
          personId: person.id,
          serverId: candidate.serverId,
          systemUser: candidate.systemUser,
          source: 'synced',
        });
        entries.push({
          serverId: candidate.serverId,
          serverName: candidate.serverName,
          systemUser: candidate.systemUser,
          action: 'created',
          personId: person.id,
          personDisplayName: person.displayName,
          detail: `创建人员 ${person.displayName}`,
        });
        createdCount++;
      }
    }

    return { entries, createdCount, reusedCount, skippedCount };
  })();
}
