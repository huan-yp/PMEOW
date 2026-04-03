import { describe, expect, it } from 'vitest';
import { getDatabase } from '../../src/db/database.js';
import {
  archivePerson,
  createPerson,
  createPersonBinding,
  getActivePersonBinding,
  getActiveTaskOwnerOverride,
  getTaskOwnerOverride,
  getPersonById,
  listPersonBindings,
  listPersons,
  setTaskOwnerOverride,
  updatePerson,
  updatePersonBinding,
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

  it('updatePerson updates fields and preserves unchanged ones', () => {
    const person = createPerson({
      displayName: 'Carol Wu',
      email: 'carol@example.com',
      qq: '999',
      customFields: { dept: 'nlp' },
    });

    const updated = updatePerson(person.id, { displayName: 'Carol W.' });
    expect(updated.displayName).toBe('Carol W.');
    expect(updated.email).toBe('carol@example.com');
    expect(updated.customFields).toEqual({ dept: 'nlp' });
  });

  it('updatePerson throws for non-existent id', () => {
    expect(() => updatePerson('no-such-id', { displayName: 'x' })).toThrow(/not found/i);
  });

  it('updatePersonBinding updates enabled and effectiveTo atomically', () => {
    const person = createPerson({ displayName: 'Dan', customFields: {} });
    const binding = createPersonBinding({
      personId: person.id,
      serverId: 'srv-upd',
      systemUser: 'dan',
      source: 'manual',
      effectiveFrom: 1_700_000_000_000,
    });

    const updated = updatePersonBinding(binding.id, { enabled: false, effectiveTo: 1_700_001_000_000 });
    expect(updated.enabled).toBe(false);
    expect(updated.effectiveTo).toBe(1_700_001_000_000);
  });

  it('updatePersonBinding throws for non-existent id', () => {
    expect(() => updatePersonBinding('no-such-id', { enabled: false })).toThrow(/not found/i);
  });

  it('listPersonBindings returns bindings for a person', () => {
    const person = createPerson({ displayName: 'Eve', customFields: {} });
    createPersonBinding({
      personId: person.id,
      serverId: 'srv-a',
      systemUser: 'eve',
      source: 'manual',
      effectiveFrom: 1_700_000_000_000,
    });
    createPersonBinding({
      personId: person.id,
      serverId: 'srv-b',
      systemUser: 'eve',
      source: 'manual',
      effectiveFrom: 1_700_000_000_000,
    });

    const bindings = listPersonBindings(person.id);
    expect(bindings).toHaveLength(2);
    expect(bindings.every((b) => b.personId === person.id)).toBe(true);
  });

  it('getActivePersonBinding returns active binding for server user', () => {
    const person = createPerson({ displayName: 'Fay', customFields: {} });
    createPersonBinding({
      personId: person.id,
      serverId: 'srv-act',
      systemUser: 'fay',
      source: 'manual',
      effectiveFrom: 1_700_000_000_000,
    });

    const active = getActivePersonBinding('srv-act', 'fay', Date.now());
    expect(active).toBeDefined();
    expect(active!.personId).toBe(person.id);

    expect(getActivePersonBinding('srv-act', 'nobody', Date.now())).toBeUndefined();
  });

  it('getActiveTaskOwnerOverride returns override for task', () => {
    const person = createPerson({ displayName: 'Grace', customFields: {} });
    setTaskOwnerOverride({
      taskId: 'task-ato',
      serverId: 'srv-ato',
      personId: person.id,
      source: 'manual',
      effectiveFrom: 1_700_000_000_000,
    });

    const override = getActiveTaskOwnerOverride('task-ato', Date.now());
    expect(override).toBeDefined();
    expect(override!.personId).toBe(person.id);

    expect(getActiveTaskOwnerOverride('task-nope', Date.now())).toBeUndefined();
  });
});
