import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { login, startTestRuntime } from './setup.js';
import { createPerson, createPersonMobileToken } from '@monitor/core';

describe('mobile person routes', () => {
  it('rejects requests without person token', async () => {
    const { baseUrl } = await startTestRuntime();

    const res = await request(baseUrl)
      .get('/api/mobile/me/bootstrap');

    expect(res.status).toBe(401);
  });

  it('rejects requests with invalid person token', async () => {
    const { baseUrl } = await startTestRuntime();

    const res = await request(baseUrl)
      .get('/api/mobile/me/bootstrap')
      .set('X-PMEOW-Person-Token', 'pmt_invalidtoken');

    expect(res.status).toBe(401);
  });

  it('returns bootstrap data for valid person token', async () => {
    const { baseUrl } = await startTestRuntime();
    // Need to set up password first so DB is initialized
    await login(baseUrl);

    const person = createPerson({ displayName: 'Alice', customFields: {} });
    const { plainToken } = createPersonMobileToken(person.id);

    const res = await request(baseUrl)
      .get('/api/mobile/me/bootstrap')
      .set('X-PMEOW-Person-Token', plainToken);

    expect(res.status).toBe(200);
    expect(res.body.person.displayName).toBe('Alice');
    expect(res.body).toHaveProperty('runningTaskCount');
    expect(res.body).toHaveProperty('queuedTaskCount');
    expect(res.body).toHaveProperty('boundNodeCount');
    expect(res.body).toHaveProperty('unreadNotificationCount');
  });

  it('returns person tasks scoped to the person', async () => {
    const { baseUrl } = await startTestRuntime();
    await login(baseUrl);

    const person = createPerson({ displayName: 'Bob', customFields: {} });
    const { plainToken } = createPersonMobileToken(person.id);

    const res = await request(baseUrl)
      .get('/api/mobile/me/tasks')
      .set('X-PMEOW-Person-Token', plainToken);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('loads and updates preferences', async () => {
    const { baseUrl } = await startTestRuntime();
    await login(baseUrl);

    const person = createPerson({ displayName: 'Carol', customFields: {} });
    const { plainToken } = createPersonMobileToken(person.id);

    const getRes = await request(baseUrl)
      .get('/api/mobile/me/preferences')
      .set('X-PMEOW-Person-Token', plainToken);

    expect(getRes.status).toBe(200);
    expect(getRes.body.notifyTaskStarted).toBe(true);
    expect(getRes.body.notifyGpuAvailable).toBe(false);

    const putRes = await request(baseUrl)
      .put('/api/mobile/me/preferences')
      .set('X-PMEOW-Person-Token', plainToken)
      .send({ notifyGpuAvailable: true, minAvailableGpuCount: 2 });

    expect(putRes.status).toBe(200);
    expect(putRes.body.notifyGpuAvailable).toBe(true);
    expect(putRes.body.minAvailableGpuCount).toBe(2);
  });

  it('admin can create and revoke person mobile tokens', async () => {
    const { baseUrl } = await startTestRuntime();
    const adminToken = await login(baseUrl);

    const person = createPerson({ displayName: 'Dave', customFields: {} });

    // Create token
    const createRes = await request(baseUrl)
      .post(`/api/persons/${person.id}/mobile-token`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'phone' });

    expect(createRes.status).toBe(200);
    expect(createRes.body.plainToken).toMatch(/^pmt_/);

    // Check status
    const statusRes = await request(baseUrl)
      .get(`/api/persons/${person.id}/mobile-token/status`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.hasToken).toBe(true);

    // Revoke
    const revokeRes = await request(baseUrl)
      .delete(`/api/persons/${person.id}/mobile-token`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(revokeRes.status).toBe(200);

    // Verify revoked
    const statusRes2 = await request(baseUrl)
      .get(`/api/persons/${person.id}/mobile-token/status`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(statusRes2.body.hasToken).toBe(false);
  });
});
