import { describe, expect, it } from 'vitest';
import { createServer } from '../../src/db/servers.js';
import { saveGpuUsageRows } from '../../src/db/gpu-usage.js';
import { upsertAgentTask } from '../../src/db/agent-tasks.js';
import { createPerson, createPersonBinding, setTaskOwnerOverride } from '../../src/db/persons.js';
import { resolveTaskPerson } from '../../src/person/resolve.js';
import {
  getPersonSummaries,
  getPersonTimeline,
  getServerPersonActivity,
  listPersonBindingSuggestions,
  recordGpuAttributionFacts,
  recordTaskAttributionFact,
} from '../../src/db/person-attribution.js';

describe('person attribution', () => {
  it('prefers explicit task overrides over binding fallback', () => {
    const server = createServer({ name: 'gpu-1', host: 'gpu-1', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-1' });
    const alice = createPerson({ displayName: 'Alice', customFields: {} });
    const bob = createPerson({ displayName: 'Bob', customFields: {} });

    createPersonBinding({ personId: alice.id, serverId: server.id, systemUser: 'train', source: 'manual', effectiveFrom: 1_700_000_000_000 });
    setTaskOwnerOverride({ taskId: 'task-1', serverId: server.id, personId: bob.id, source: 'manual', effectiveFrom: 1_700_000_000_100 });

    upsertAgentTask({ serverId: server.id, taskId: 'task-1', status: 'running', user: 'train', startedAt: 1_700_000_000_200 });

    expect(resolveTaskPerson(server.id, 'task-1', 'train', 1_700_000_000_200)?.person.id).toBe(bob.id);
  });

  it('builds person summaries, timeline, and suggestions without backfilling old data', () => {
    const now = Date.now();
    const server = createServer({ name: 'gpu-2', host: 'gpu-2', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-2' });
    const alice = createPerson({ displayName: 'Alice', customFields: { team: 'cv' } });

    createPersonBinding({ personId: alice.id, serverId: server.id, systemUser: 'alice', source: 'manual', effectiveFrom: now - 200_000 });

    saveGpuUsageRows(server.id, now - 100_000, [
      { gpuIndex: 0, ownerType: 'user', ownerId: 'alice', userName: 'alice', pid: 2001, command: 'python train.py', usedMemoryMB: 4096 },
      { gpuIndex: 0, ownerType: 'user', ownerId: 'nobody', userName: 'nobody', pid: 2002, command: 'python idle.py', usedMemoryMB: 1024 },
    ]);

    recordGpuAttributionFacts(server.id, now - 100_000);

    expect(getPersonSummaries(24)[0]).toEqual(expect.objectContaining({
      personId: alice.id,
      displayName: 'Alice',
      currentVramMB: 4096,
      activeServerCount: 1,
    }));
    expect(getPersonTimeline(alice.id, 24)).toEqual([
      expect.objectContaining({ totalVramMB: 4096 }),
    ]);
    expect(getServerPersonActivity(server.id).unassignedUsers).toContain('nobody');
    expect(listPersonBindingSuggestions()).toEqual([
      expect.objectContaining({ serverId: server.id, systemUser: 'nobody' }),
    ]);
  });
});
