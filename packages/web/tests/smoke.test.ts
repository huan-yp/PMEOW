import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { createWebRuntime, type WebRuntime } from '../src/app.js';
import { signToken } from '../src/auth.js';

let runtime: WebRuntime;
let token: string;

beforeAll(async () => {
  runtime = createWebRuntime();
  await runtime.start(0); // random port
  token = signToken({ role: 'admin' });
});

afterAll(async () => {
  await runtime.stop();
});

describe('web runtime lifecycle', () => {
  it('starts and exposes express app', () => {
    expect(runtime.app).toBeDefined();
    expect(runtime.httpServer.listening).toBe(true);
  });
});

describe('auth', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(runtime.app).get('/api/servers');
    expect(res.status).toBe(401);
  });

  it('allows first-time password setup via login', async () => {
    const res = await request(runtime.app)
      .post('/api/login')
      .send({ password: 'test-password' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
  });
});

describe('server routes', () => {
  it('GET /api/servers returns empty list', async () => {
    const res = await request(runtime.app)
      .get('/api/servers')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('settings routes', () => {
  it('GET /api/settings returns defaults', async () => {
    const res = await request(runtime.app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('alertCpuThreshold');
  });
});

describe('alerts routes', () => {
  it('GET /api/alerts returns empty list', async () => {
    const res = await request(runtime.app)
      .get('/api/alerts')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
