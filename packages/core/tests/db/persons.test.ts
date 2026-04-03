import { describe, expect, it } from 'vitest';
import { getDatabase } from '../../src/db/database.js';
import {
  archivePerson,
  createPerson,
  createPersonBinding,
  getTaskOwnerOverride,
  getPersonById,
  listPersons,
  setTaskOwnerOverride,
} from '../../src/db/persons.js';

describe('person schema', () => {
  it('creates person-related tables and indexes', () => {
    const db = getDatabase();
    const tables = ['persons', 'person_bindings', 'task_owner_overrides', 'person_attribution_facts']
      .map((name) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
      .map((row) => (row as { name: string } | undefined)?.name);

    expect(tables).toEqual(['persons', 'person_bindings', 'task_owner_overrides', 'person_attribution_facts']);
  });

  it('creates, lists, and archives a person profile', () => {
    const created = createPerson({
      displayName: 'Alice Zhang',
      email: 'alice@example.com',
      qq: '123456',
      note: 'vision lab',
      customFields: { team: 'cv' },
    });

    expect(getPersonById(created.id)?.displayName).toBe('Alice Zhang');
    expect(listPersons({ includeArchived: false })).toHaveLength(1);

    archivePerson(created.id);

    expect(listPersons({ includeArchived: false })).toHaveLength(0);
    expect(listPersons({ includeArchived: true })[0].status).toBe('archived');
  });

  it('rejects overlapping active bindings for the same server user', () => {
    const alice = createPerson({ displayName: 'Alice Zhang', customFields: {} });
    const bob = createPerson({ displayName: 'Bob Li', customFields: {} });

    createPersonBinding({
      personId: alice.id,
      serverId: 'server-1',
      systemUser: 'alice',
      source: 'manual',
      effectiveFrom: 1_700_000_000_000,
    });

    expect(() => createPersonBinding({
      personId: bob.id,
      serverId: 'server-1',
      systemUser: 'alice',
      source: 'manual',
      effectiveFrom: 1_700_000_100_000,
    })).toThrow(/active binding/i);
  });

  it('stores explicit task owner overrides', () => {
    const alice = createPerson({ displayName: 'Alice Zhang', customFields: {} });

    setTaskOwnerOverride({
      taskId: 'task-1',
      serverId: 'server-1',
      personId: alice.id,
      source: 'manual',
      effectiveFrom: 1_700_000_000_000,
    });

    expect(getTaskOwnerOverride('task-1')?.personId).toBe(alice.id);
  });
});
