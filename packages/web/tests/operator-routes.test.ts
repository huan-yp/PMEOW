import {
  createSecurityEvent,
  createServer,
  createPerson,
  createPersonBinding,
  getSettings,
  getGpuOverview,
  getAgentTaskQueueGroups,
  saveMetrics,
  saveGpuUsageRows,
  type MetricsSnapshot,
} from '@monitor/core';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { login, startTestRuntime } from './setup.js';

function createSnapshot(serverId: string, hostname: string, timestamp: number): MetricsSnapshot {
  return {
    serverId,
    timestamp,
    cpu: {
      usagePercent: 18,
      coreCount: 16,
      modelName: 'EPYC',
      frequencyMhz: 3200,
      perCoreUsage: [18, 17],
    },
    memory: {
      totalMB: 65536,
      usedMB: 16384,
      availableMB: 49152,
      usagePercent: 25,
      swapTotalMB: 8192,
      swapUsedMB: 0,
      swapPercent: 0,
    },
    disk: {
      disks: [],
      ioReadKBs: 0,
      ioWriteKBs: 0,
    },
    network: {
      rxBytesPerSec: 0,
      txBytesPerSec: 0,
      interfaces: [],
    },
    gpu: {
      available: true,
      totalMemoryMB: 24576,
      usedMemoryMB: 7168,
      memoryUsagePercent: 29,
      utilizationPercent: 51,
      temperatureC: 57,
      gpuCount: 1,
    },
    processes: [
      {
        pid: 2201,
        user: 'alice',
        command: 'python train.py',
        cpuPercent: 12,
        memPercent: 4,
        rss: 1024,
      },
    ],
    docker: [],
    system: {
      hostname,
      uptime: '2 days',
      loadAvg1: 0.2,
      loadAvg5: 0.3,
      loadAvg15: 0.4,
      kernelVersion: '6.8.0',
    },
  };
}

describe('operator routes', () => {
  it('hashes password updates before saving settings', async () => {
    const { baseUrl } = await startTestRuntime();
    const token = await login(baseUrl);

    const updateResponse = await request(baseUrl)
      .put('/api/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'Yk8?mR4+uN1.' });

    expect(updateResponse.status).toBe(200);

    const settings = getSettings();
    expect(settings.password).toEqual(expect.any(String));
    expect(settings.password).not.toBe('Yk8?mR4+uN1.');
    expect(settings.password.startsWith('$2')).toBe(true);

    const reloginResponse = await request(baseUrl)
      .post('/api/login')
      .send({ password: 'Yk8?mR4+uN1.' });

    expect(reloginResponse.status).toBe(200);
    expect(reloginResponse.body.token).toEqual(expect.any(String));
  });

  it('serves authenticated task queue, gpu overview, and security events', async () => {
    const server = createServer({
      name: 'gpu-operator',
      host: 'gpu-operator',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-operator',
    });
    const snapshot = createSnapshot(server.id, server.host, 1_000);
    saveMetrics(snapshot);
    saveGpuUsageRows(server.id, snapshot.timestamp, [
      {
        gpuIndex: 0,
        ownerType: 'task',
        ownerId: 'task-1',
        userName: 'alice',
        taskId: 'task-1',
        usedMemoryMB: 6144,
        declaredVramMB: 8192,
      },
      {
        gpuIndex: 0,
        ownerType: 'user',
        ownerId: 'alice',
        userName: 'alice',
        pid: 2201,
        command: 'python train.py',
        usedMemoryMB: 1024,
      },
    ]);
    createSecurityEvent({
      serverId: server.id,
      eventType: 'suspicious_process',
      fingerprint: 'fingerprint-1',
      details: {
        reason: '命中关键词 xmrig',
        pid: 2201,
        user: 'alice',
        command: 'python train.py',
        taskId: 'task-1',
      },
    });

    const { baseUrl } = await startTestRuntime();
    const token = await login(baseUrl);
    const api = request(baseUrl);

    const queueResponse = await api
      .get('/api/task-queue')
      .set('Authorization', `Bearer ${token}`);
    const overviewResponse = await api
      .get('/api/gpu-overview')
      .set('Authorization', `Bearer ${token}`);
    const securityResponse = await api
      .get('/api/security/events')
      .set('Authorization', `Bearer ${token}`);

    expect(queueResponse.status).toBe(200);
    expect(queueResponse.body).toEqual(getAgentTaskQueueGroups());

    expect(overviewResponse.status).toBe(200);
    expect(overviewResponse.body).toEqual(getGpuOverview());

    expect(securityResponse.status).toBe(200);
    expect(securityResponse.body).toEqual([
      expect.objectContaining({
        serverId: server.id,
        eventType: 'suspicious_process',
        resolved: false,
      }),
    ]);

    const processAuditResponse = await api
      .get(`/api/servers/${server.id}/process-audit`)
      .set('Authorization', `Bearer ${token}`);

    expect(processAuditResponse.status).toBe(200);
    expect(processAuditResponse.body).toEqual([
      expect.objectContaining({
        pid: 2201,
        user: 'alice',
        command: 'python train.py',
      }),
    ]);

    const settings = getSettings();
    expect(settings.securityMiningKeywords).toEqual(expect.any(Array));
  });

  it('rejects gpu usage by-user requests without a user query', async () => {
    const { baseUrl } = await startTestRuntime();
    const token = await login(baseUrl);

    const response = await request(baseUrl)
      .get('/api/gpu-usage/by-user?hours=24')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '缺少 user 参数' });
  });

  it('enriches process-audit rows with resolved person name', async () => {
    const server = createServer({
      name: 'gpu-person',
      host: 'gpu-person',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-person',
    });
    const person = createPerson({ displayName: '张三', customFields: {} });
    createPersonBinding({
      personId: person.id,
      serverId: server.id,
      systemUser: 'alice',
      source: 'manual',
      effectiveFrom: 0,
    });

    const snapshot = createSnapshot(server.id, server.host, 1_000);
    saveMetrics(snapshot);
    saveGpuUsageRows(server.id, snapshot.timestamp, [
      {
        gpuIndex: 0,
        ownerType: 'user',
        ownerId: 'alice',
        userName: 'alice',
        pid: 2201,
        command: 'python train.py',
        usedMemoryMB: 1024,
      },
    ]);

    const { baseUrl } = await startTestRuntime();
    const token = await login(baseUrl);

    const response = await request(baseUrl)
      .get(`/api/servers/${server.id}/process-audit`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        pid: 2201,
        user: 'alice',
        resolvedPersonId: person.id,
        resolvedPersonName: '张三',
      }),
    ]);
  });

  it('returns process-audit rows without person fields for unbound users', async () => {
    const server = createServer({
      name: 'gpu-unbound',
      host: 'gpu-unbound',
      port: 22,
      username: 'root',
      privateKeyPath: '/tmp/key',
      sourceType: 'agent',
      agentId: 'agent-unbound',
    });

    const snapshot = createSnapshot(server.id, server.host, 2_000);
    saveMetrics(snapshot);

    const { baseUrl } = await startTestRuntime();
    const token = await login(baseUrl);

    const response = await request(baseUrl)
      .get(`/api/servers/${server.id}/process-audit`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        pid: 2201,
        user: 'alice',
      }),
    ]);
    expect(response.body[0].resolvedPersonId).toBeUndefined();
    expect(response.body[0].resolvedPersonName).toBeUndefined();
  });
});