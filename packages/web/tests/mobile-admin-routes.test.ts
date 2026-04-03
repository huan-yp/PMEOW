import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { login, startTestRuntime } from './setup.js';

describe('mobile admin routes', () => {
  it('returns admin mobile summary', async () => {
    const { baseUrl } = await startTestRuntime();
    const token = await login(baseUrl);

    const res = await request(baseUrl)
      .get('/api/mobile/admin/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('serverCount');
    expect(res.body).toHaveProperty('onlineServerCount');
    expect(res.body).toHaveProperty('totalRunningTasks');
    expect(res.body).toHaveProperty('totalQueuedTasks');
  });

  it('returns admin mobile server list', async () => {
    const { baseUrl } = await startTestRuntime();
    const token = await login(baseUrl);

    const res = await request(baseUrl)
      .get('/api/mobile/admin/servers')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns admin mobile task list', async () => {
    const { baseUrl } = await startTestRuntime();
    const token = await login(baseUrl);

    const res = await request(baseUrl)
      .get('/api/mobile/admin/tasks')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('rejects unauthenticated requests', async () => {
    const { baseUrl } = await startTestRuntime();

    const res = await request(baseUrl)
      .get('/api/mobile/admin/summary');

    expect(res.status).toBe(401);
  });
});
