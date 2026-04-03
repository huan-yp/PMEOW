import { describe, expect, it } from 'vitest';
import { createPerson } from '../../src/db/persons.js';
import {
  createPersonMobileToken,
  rotatePersonMobileToken,
  revokePersonMobileToken,
  resolvePersonMobileToken,
  getPersonMobileTokenStatus,
} from '../../src/db/person-mobile-tokens.js';

describe('person mobile tokens', () => {
  it('creates a token and resolves it back to the person', () => {
    const person = createPerson({ displayName: 'Alice', customFields: {} });
    const { record, plainToken } = createPersonMobileToken(person.id, 'phone');

    expect(record.personId).toBe(person.id);
    expect(record.label).toBe('phone');
    expect(record.revokedAt).toBeNull();
    expect(plainToken).toMatch(/^pmt_/);

    const resolved = resolvePersonMobileToken(plainToken);
    expect(resolved).not.toBeNull();
    expect(resolved!.personId).toBe(person.id);
    expect(resolved!.lastUsedAt).toBeGreaterThan(0);
  });

  it('only returns the plain token once at creation', () => {
    const person = createPerson({ displayName: 'Bob', customFields: {} });
    const { plainToken } = createPersonMobileToken(person.id);

    // The status endpoint should not expose the plain token
    const status = getPersonMobileTokenStatus(person.id);
    expect(status).not.toBeNull();
    expect((status as any).plainToken).toBeUndefined();
    // But the hash should exist
    expect(status!.tokenHash).toBeDefined();

    // The plain token should still resolve
    expect(resolvePersonMobileToken(plainToken)).not.toBeNull();
  });

  it('rotating a token invalidates the old token', () => {
    const person = createPerson({ displayName: 'Carol', customFields: {} });
    const { plainToken: oldToken } = createPersonMobileToken(person.id);

    const result = rotatePersonMobileToken(person.id);
    expect(result).not.toBeNull();
    const { plainToken: newToken } = result!;

    // Old token is revoked
    expect(resolvePersonMobileToken(oldToken)).toBeNull();
    // New token works
    expect(resolvePersonMobileToken(newToken)!.personId).toBe(person.id);
  });

  it('revoking tokens stops resolution', () => {
    const person = createPerson({ displayName: 'Dave', customFields: {} });
    const { plainToken } = createPersonMobileToken(person.id);

    revokePersonMobileToken(person.id);

    expect(resolvePersonMobileToken(plainToken)).toBeNull();
    expect(getPersonMobileTokenStatus(person.id)).toBeNull();
  });
});
