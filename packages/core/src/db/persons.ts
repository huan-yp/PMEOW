import { randomUUID } from 'crypto';
import { getDatabase } from './database.js';
import { listPersonBindingCandidates } from './person-binding-candidates.js';
import type {
  AutoAddUnassignedPersonsReport,
  AutoAddUnassignedPersonsReportBinding,
  AutoAddUnassignedPersonsReportItem,
  PersonRecord,
  PersonBindingRecord,
  TaskOwnerOverrideRecord,
} from '../types.js';

function normalizePersonName(value: string): string {
  return value.trim().toLowerCase();
}

function buildAutoAddReportItem(input: {
  username: string;
  result: AutoAddUnassignedPersonsReportItem['result'];
  personId?: string | null;
  personDisplayName?: string | null;
  bindings: AutoAddUnassignedPersonsReportBinding[];
  message: string;
}): AutoAddUnassignedPersonsReportItem {
  return {
    username: input.username,
    normalizedUsername: normalizePersonName(input.username),
    result: input.result,
    personId: input.personId ?? null,
    personDisplayName: input.personDisplayName ?? null,
    bindingCount: input.bindings.length,
    bindings: input.bindings,
    message: input.message,
  };
}

function rowToPerson(row: Record<string, unknown>): PersonRecord {
  return {
    id: row.id as string,
    displayName: row.displayName as string,
    email: row.email as string,
    qq: row.qq as string,
    note: row.note as string,
    customFields: JSON.parse((row.customFieldsJson as string) || '{}'),
    status: row.status as PersonRecord['status'],
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
  };
}

export function createPerson(input: {
  displayName: string;
  email?: string;
  qq?: string;
  note?: string;
  customFields: Record<string, string>;
}): PersonRecord {
  const db = getDatabase();
  const now = Date.now();
  const person: PersonRecord = {
    id: randomUUID(),
    displayName: input.displayName.trim(),
    email: input.email?.trim() ?? '',
    qq: input.qq?.trim() ?? '',
    note: input.note?.trim() ?? '',
    customFields: input.customFields,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(`
    INSERT INTO persons (id, displayName, email, qq, note, customFieldsJson, status, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    person.id,
    person.displayName,
    person.email,
    person.qq,
    person.note,
    JSON.stringify(person.customFields),
    person.status,
    person.createdAt,
    person.updatedAt,
  );

  return person;
}

export function getPersonById(id: string): PersonRecord | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM persons WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToPerson(row) : undefined;
}

export function listPersons(opts: { includeArchived: boolean }): PersonRecord[] {
  const db = getDatabase();
  const query = opts.includeArchived
    ? 'SELECT * FROM persons ORDER BY createdAt DESC'
    : "SELECT * FROM persons WHERE status = 'active' ORDER BY createdAt DESC";
  return (db.prepare(query).all() as Record<string, unknown>[]).map(rowToPerson);
}

export function autoAddUnassignedPersons(): AutoAddUnassignedPersonsReport {
  const db = getDatabase();
  const now = Date.now();
  const activePeopleByName = new Map<string, PersonRecord[]>();

  for (const person of listPersons({ includeArchived: false })) {
    const key = normalizePersonName(person.displayName);
    const existing = activePeopleByName.get(key);
    if (existing) {
      existing.push(person);
    } else {
      activePeopleByName.set(key, [person]);
    }
  }

  const groupedCandidates = new Map<string, {
    username: string;
    bindings: AutoAddUnassignedPersonsReportBinding[];
  }>();

  for (const candidate of listPersonBindingCandidates()) {
    if (candidate.activeBinding) {
      continue;
    }

    const normalizedUsername = normalizePersonName(candidate.systemUser);
    const existing = groupedCandidates.get(normalizedUsername);
    const binding = {
      serverId: candidate.serverId,
      serverName: candidate.serverName,
      systemUser: candidate.systemUser,
    };

    if (existing) {
      existing.bindings.push(binding);
      continue;
    }

    groupedCandidates.set(normalizedUsername, {
      username: candidate.systemUser,
      bindings: [binding],
    });
  }

  const items: AutoAddUnassignedPersonsReportItem[] = [];

  for (const [normalizedUsername, group] of groupedCandidates) {
    if (!normalizedUsername) {
      continue;
    }

    const bindings = [...group.bindings].sort(
      (left, right) => left.serverName.localeCompare(right.serverName)
        || left.serverId.localeCompare(right.serverId)
        || left.systemUser.localeCompare(right.systemUser),
    );

    if (normalizedUsername === 'root') {
      items.push(buildAutoAddReportItem({
        username: group.username,
        result: 'skipped-root',
        bindings,
        message: '已跳过 root 账号。',
      }));
      continue;
    }

    const matchedPeople = activePeopleByName.get(normalizedUsername) ?? [];
    if (matchedPeople.length > 1) {
      items.push(buildAutoAddReportItem({
        username: group.username,
        result: 'skipped-ambiguous',
        bindings,
        message: '存在多条同名人员档案，已跳过等待人工处理。',
      }));
      continue;
    }

    const reusedPerson = matchedPeople[0] ?? null;
    const runGroup = db.transaction(() => {
      for (const binding of bindings) {
        const overlap = getActivePersonBinding(binding.serverId, binding.systemUser, now);
        if (overlap) {
          return buildAutoAddReportItem({
            username: group.username,
            result: 'skipped-already-bound',
            personId: reusedPerson?.id ?? null,
            personDisplayName: reusedPerson?.displayName ?? null,
            bindings,
            message: '检测到账号已被绑定，已跳过本次自动归属。',
          });
        }
      }

      const person = reusedPerson ?? createPerson({
        displayName: group.username,
        email: '',
        qq: '',
        note: '',
        customFields: {},
      });

      if (!reusedPerson) {
        activePeopleByName.set(normalizedUsername, [person]);
      }

      for (const binding of bindings) {
        createPersonBinding({
          personId: person.id,
          serverId: binding.serverId,
          systemUser: binding.systemUser,
          source: 'suggested',
          effectiveFrom: now,
        });
      }

      return buildAutoAddReportItem({
        username: group.username,
        result: reusedPerson ? 'reused-person' : 'created-person',
        personId: person.id,
        personDisplayName: person.displayName,
        bindings,
        message: reusedPerson
          ? '已复用同名人员并补充绑定。'
          : '已创建人员并完成账号归属。',
      });
    });

    try {
      items.push(runGroup());
    } catch (error) {
      items.push(buildAutoAddReportItem({
        username: group.username,
        result: 'failed',
        bindings,
        message: error instanceof Error ? error.message : '自动添加失败。',
      }));
    }
  }

  items.sort((left, right) => left.normalizedUsername.localeCompare(right.normalizedUsername) || left.username.localeCompare(right.username));

  return {
    generatedAt: now,
    summary: {
      candidateUserCount: items.length,
      createdPersonCount: items.filter((item) => item.result === 'created-person').length,
      reusedPersonCount: items.filter((item) => item.result === 'reused-person').length,
      createdBindingCount: items
        .filter((item) => item.result === 'created-person' || item.result === 'reused-person')
        .reduce((total, item) => total + item.bindingCount, 0),
      skippedRootCount: items.filter((item) => item.result === 'skipped-root').length,
      skippedAmbiguousCount: items.filter((item) => item.result === 'skipped-ambiguous').length,
      skippedAlreadyBoundCount: items.filter((item) => item.result === 'skipped-already-bound').length,
      failedCount: items.filter((item) => item.result === 'failed').length,
    },
    items,
  };
}

export function updatePerson(id: string, input: Partial<{
  displayName: string;
  email: string;
  qq: string;
  note: string;
  customFields: Record<string, string>;
}>): PersonRecord {
  const db = getDatabase();
  const existing = getPersonById(id);
  if (!existing) throw new Error('Person not found');

  const updated = {
    displayName: input.displayName?.trim() ?? existing.displayName,
    email: input.email?.trim() ?? existing.email,
    qq: input.qq?.trim() ?? existing.qq,
    note: input.note?.trim() ?? existing.note,
    customFields: input.customFields ?? existing.customFields,
    updatedAt: Date.now(),
  };

  db.prepare(`
    UPDATE persons SET displayName = ?, email = ?, qq = ?, note = ?, customFieldsJson = ?, updatedAt = ?
    WHERE id = ?
  `).run(
    updated.displayName,
    updated.email,
    updated.qq,
    updated.note,
    JSON.stringify(updated.customFields),
    updated.updatedAt,
    id,
  );

  return getPersonById(id)!;
}

export function archivePerson(id: string): void {
  const db = getDatabase();
  db.prepare("UPDATE persons SET status = 'archived', updatedAt = ? WHERE id = ?")
    .run(Date.now(), id);
}

export function createPersonBinding(input: {
  personId: string;
  serverId: string;
  systemUser: string;
  source: PersonBindingRecord['source'];
  effectiveFrom: number;
}): PersonBindingRecord {
  const db = getDatabase();

  const overlap = db.prepare(`
    SELECT id FROM person_bindings
    WHERE serverId = ? AND systemUser = ? AND enabled = 1 AND effectiveTo IS NULL
  `).get(input.serverId, input.systemUser) as { id: string } | undefined;

  if (overlap) {
    throw new Error('Active binding already exists for this server user');
  }

  const now = Date.now();
  const record: PersonBindingRecord = {
    id: randomUUID(),
    personId: input.personId,
    serverId: input.serverId,
    systemUser: input.systemUser,
    source: input.source,
    enabled: true,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: null,
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(`
    INSERT INTO person_bindings (id, personId, serverId, systemUser, source, enabled, effectiveFrom, effectiveTo, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.personId,
    record.serverId,
    record.systemUser,
    record.source,
    1,
    record.effectiveFrom,
    null,
    record.createdAt,
    record.updatedAt,
  );

  return record;
}

export function listPersonBindings(personId: string): PersonBindingRecord[] {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM person_bindings WHERE personId = ? ORDER BY createdAt DESC').all(personId) as Record<string, unknown>[])
    .map(rowToBinding);
}

export function updatePersonBinding(id: string, input: Partial<{
  enabled: boolean;
  effectiveTo: number | null;
}>): PersonBindingRecord {
  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM person_bindings WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) throw new Error('Binding not found');

  const sets: string[] = [];
  const params: unknown[] = [];
  const now = Date.now();

  if (input.enabled !== undefined) {
    sets.push('enabled = ?');
    params.push(input.enabled ? 1 : 0);
  }
  if (input.effectiveTo !== undefined) {
    sets.push('effectiveTo = ?');
    params.push(input.effectiveTo);
  }

  if (sets.length > 0) {
    sets.push('updatedAt = ?');
    params.push(now);
    params.push(id);
    db.prepare(`UPDATE person_bindings SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  return rowToBinding(db.prepare('SELECT * FROM person_bindings WHERE id = ?').get(id) as Record<string, unknown>);
}

export function getActivePersonBinding(serverId: string, systemUser: string, _timestamp: number): PersonBindingRecord | undefined {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM person_bindings
    WHERE serverId = ? AND systemUser = ? AND enabled = 1 AND effectiveTo IS NULL
  `).get(serverId, systemUser) as Record<string, unknown> | undefined;
  return row ? rowToBinding(row) : undefined;
}

export function setTaskOwnerOverride(input: {
  taskId: string;
  serverId: string;
  personId: string;
  source: TaskOwnerOverrideRecord['source'];
  effectiveFrom: number;
}): TaskOwnerOverrideRecord {
  const db = getDatabase();
  const now = Date.now();
  const record: TaskOwnerOverrideRecord = {
    id: randomUUID(),
    taskId: input.taskId,
    serverId: input.serverId,
    personId: input.personId,
    source: input.source,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: null,
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(`
    INSERT INTO task_owner_overrides (id, taskId, serverId, personId, source, effectiveFrom, effectiveTo, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.taskId,
    record.serverId,
    record.personId,
    record.source,
    record.effectiveFrom,
    null,
    record.createdAt,
    record.updatedAt,
  );

  return record;
}

export function getTaskOwnerOverride(taskId: string): TaskOwnerOverrideRecord | undefined {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM task_owner_overrides
    WHERE taskId = ? AND effectiveTo IS NULL
    ORDER BY effectiveFrom DESC
    LIMIT 1
  `).get(taskId) as Record<string, unknown> | undefined;
  return row ? rowToOverride(row) : undefined;
}

export function getActiveTaskOwnerOverride(taskId: string, _timestamp: number): TaskOwnerOverrideRecord | undefined {
  return getTaskOwnerOverride(taskId);
}

function rowToBinding(row: Record<string, unknown>): PersonBindingRecord {
  return {
    id: row.id as string,
    personId: row.personId as string,
    serverId: row.serverId as string,
    systemUser: row.systemUser as string,
    source: row.source as PersonBindingRecord['source'],
    enabled: row.enabled === 1,
    effectiveFrom: row.effectiveFrom as number,
    effectiveTo: (row.effectiveTo as number) ?? null,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
  };
}

function rowToOverride(row: Record<string, unknown>): TaskOwnerOverrideRecord {
  return {
    id: row.id as string,
    taskId: row.taskId as string,
    serverId: row.serverId as string,
    personId: row.personId as string,
    source: row.source as TaskOwnerOverrideRecord['source'],
    effectiveFrom: row.effectiveFrom as number,
    effectiveTo: (row.effectiveTo as number) ?? null,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
  };
}
