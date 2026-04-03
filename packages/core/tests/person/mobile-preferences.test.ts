import { describe, expect, it } from 'vitest';
import { createPerson } from '../../src/db/persons.js';
import {
  getPersonMobilePreferences,
  updatePersonMobilePreferences,
} from '../../src/db/person-mobile-preferences.js';

describe('person mobile preferences', () => {
  it('returns design-approved defaults on first access', () => {
    const person = createPerson({ displayName: 'Alice', customFields: {} });
    const prefs = getPersonMobilePreferences(person.id);

    expect(prefs.personId).toBe(person.id);
    expect(prefs.notifyTaskStarted).toBe(true);
    expect(prefs.notifyTaskCompleted).toBe(true);
    expect(prefs.notifyTaskFailed).toBe(true);
    expect(prefs.notifyTaskCancelled).toBe(true);
    expect(prefs.notifyNodeStatus).toBe(true);
    expect(prefs.notifyGpuAvailable).toBe(false);
    expect(prefs.minAvailableGpuCount).toBe(1);
    expect(prefs.minAvailableVramGB).toBeNull();
  });

  it('persists updated preference values', () => {
    const person = createPerson({ displayName: 'Bob', customFields: {} });

    const updated = updatePersonMobilePreferences(person.id, {
      notifyTaskStarted: false,
      notifyGpuAvailable: true,
      minAvailableGpuCount: 2,
      minAvailableVramGB: 20,
    });

    expect(updated.notifyTaskStarted).toBe(false);
    expect(updated.notifyGpuAvailable).toBe(true);
    expect(updated.minAvailableGpuCount).toBe(2);
    expect(updated.minAvailableVramGB).toBe(20);
    // Unchanged defaults remain
    expect(updated.notifyTaskCompleted).toBe(true);
    expect(updated.notifyNodeStatus).toBe(true);

    // Re-read to confirm persistence
    const reread = getPersonMobilePreferences(person.id);
    expect(reread.notifyTaskStarted).toBe(false);
    expect(reread.notifyGpuAvailable).toBe(true);
  });

  it('idempotent default creation on repeated reads', () => {
    const person = createPerson({ displayName: 'Carol', customFields: {} });
    const first = getPersonMobilePreferences(person.id);
    const second = getPersonMobilePreferences(person.id);
    expect(first.updatedAt).toBe(second.updatedAt);
  });
});
