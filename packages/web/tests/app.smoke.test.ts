import { Scheduler } from '@monitor/core';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createWebRuntime, type WebRuntime } from '../src/app.js';

const runtimes: WebRuntime[] = [];

function trackRuntime(runtime: WebRuntime): WebRuntime {
  runtimes.push(runtime);
  return runtime;
}

afterEach(async () => {
  while (runtimes.length > 0) {
    const runtime = runtimes.pop();
    if (runtime) {
      await runtime.stop();
    }
  }
});

describe('createWebRuntime', () => {
  it('creates a runtime surface without binding a port', () => {
    const scheduler = new Scheduler();
    const runtime = trackRuntime(createWebRuntime({ scheduler }));

    expect(runtime.app).toBeDefined();
    expect(runtime.httpServer).toBeDefined();
    expect(runtime.io).toBeDefined();
    expect(runtime.scheduler).toBe(scheduler);
    expect(typeof runtime.start).toBe('function');
    expect(typeof runtime.stop).toBe('function');
  });

  it('returns 401 for protected routes with an injected scheduler', async () => {
    const scheduler = new Scheduler();
    const runtime = trackRuntime(createWebRuntime({ scheduler }));

    const response = await request(runtime.app).get('/api/servers');

    expect(runtime.scheduler).toBe(scheduler);
    expect(response.status).toBe(401);
  });
});