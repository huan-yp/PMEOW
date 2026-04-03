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
});
