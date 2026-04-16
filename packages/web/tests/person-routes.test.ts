import { createPerson, createServer, replaceServerLocalUsers } from '@monitor/core';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { login, startTestRuntime } from './setup.js';

describe('person routes', () => {
  it('creates a person and retrieves summary', async () => {
    const { baseUrl } = await startTestRuntime();
    const token = await login(baseUrl);

    const created = await request(baseUrl)
      .post('/api/persons')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'Alice', email: 'alice@example.com', qq: '', note: '', customFields: { team: 'cv' } });

    expect(created.status).toBe(200);
    expect(created.body.displayName).toBe('Alice');

    const list = await request(baseUrl)
      .get('/api/persons')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const summary = await request(baseUrl)
      .get('/api/persons/summary')
      .set('Authorization', `Bearer ${token}`);
    expect(summary.status).toBe(200);
    expect(Array.isArray(summary.body)).toBe(true);
  });

  it('returns empty results for zero-person deployment', async () => {
    const { baseUrl } = await startTestRuntime();
    const token = await login(baseUrl);

    const summary = await request(baseUrl)
      .get('/api/persons/summary')
      .set('Authorization', `Bearer ${token}`);
    expect(summary.status).toBe(200);
    expect(summary.body).toEqual([]);

    const activity = await request(baseUrl)
      .get('/api/servers/nonexistent/person-activity')
      .set('Authorization', `Bearer ${token}`);
    expect(activity.status).toBe(200);
    expect(activity.body.people).toEqual([]);
  });

  it('auto adds unassigned users and returns a detailed report', async () => {
    const now = Date.now();
    const { baseUrl } = await startTestRuntime();
    const token = await login(baseUrl);
    const server = createServer({ name: 'gpu-auto', host: 'gpu-auto', port: 22, username: 'root', privateKeyPath: '/tmp/key', sourceType: 'agent', agentId: 'agent-auto' });

    createPerson({ displayName: 'alice', customFields: {} });

    replaceServerLocalUsers(server.id, now, [
      { username: 'alice', uid: 1000, gid: 1000, gecos: 'Alice', home: '/home/alice', shell: '/bin/bash' },
      { username: 'root', uid: 0, gid: 0, gecos: 'root', home: '/root', shell: '/bin/bash' },
      { username: 'carol', uid: 1001, gid: 1001, gecos: 'Carol', home: '/home/carol', shell: '/bin/bash' },
    ]);

    const response = await request(baseUrl)
      .post('/api/persons/auto-add-unassigned')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.summary).toEqual(expect.objectContaining({
      candidateUserCount: 3,
      reusedPersonCount: 1,
      createdPersonCount: 1,
      skippedRootCount: 1,
      createdBindingCount: 2,
    }));
    expect(response.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ normalizedUsername: 'alice', result: 'reused-person' }),
      expect.objectContaining({ normalizedUsername: 'carol', result: 'created-person' }),
      expect.objectContaining({ normalizedUsername: 'root', result: 'skipped-root' }),
    ]));
  });
});
