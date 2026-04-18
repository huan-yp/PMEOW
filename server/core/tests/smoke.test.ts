import { describe, it, expect } from 'vitest';
import {
  getDatabase,
  createServer,
  getAllServers,
  getServerById,
  deleteServer,
  saveSnapshot,
  getSnapshotHistory,
  getLatestSnapshot,
  deleteOldRecentSnapshots,
  upsertTask,
  listTasks,
  getTask,
  endTask,
  getAlerts,
  reconcileAlerts,
  silenceAlert,
  unsilenceAlert,
  createPerson,
  getPersonById,
  listPersons,
  createBinding,
  getBindingsByPersonId,
  getSettings,
  saveSetting,
  type UnifiedReport,
  type TaskInfo,
} from '../src/index.js';

function makeReport(overrides: Partial<UnifiedReport> = {}): UnifiedReport {
  return {
    agentId: 'agent-1',
    timestamp: Math.floor(Date.now() / 1000),
    seq: 1,
    resourceSnapshot: {
      gpuCards: [{
        index: 0,
        name: 'RTX 4090',
        temperature: 65,
        utilizationGpu: 50,
        utilizationMemory: 40,
        memoryTotalMb: 24576,
        memoryUsedMb: 8000,
        managedReservedMb: 4000,
        unmanagedPeakMb: 1000,
        effectiveFreeMb: 15576,
        taskAllocations: [{ taskId: 'task-1', declaredVramMb: 4000 }],
        userProcesses: [{ pid: 1234, user: 'alice', vramMb: 3000 }],
        unknownProcesses: [],
      }],
      cpu: { usagePercent: 45, coreCount: 16, modelName: 'AMD EPYC', frequencyMhz: 3500, perCoreUsage: [] },
      memory: { totalMb: 65536, usedMb: 32000, availableMb: 33536, usagePercent: 49, swapTotalMb: 0, swapUsedMb: 0, swapPercent: 0 },
      disks: [{ filesystem: 'ext4', mountPoint: '/', totalGB: 500, usedGB: 200, availableGB: 300, usagePercent: 40 }],
      diskIo: { readBytesPerSec: 2048, writeBytesPerSec: 1024 },
      network: { rxBytesPerSec: 1000, txBytesPerSec: 500, interfaces: [{ name: 'eth0', rxBytes: 100000, txBytes: 50000 }], internetReachable: true, internetLatencyMs: 12, internetProbeTarget: '8.8.8.8:53', internetProbeCheckedAt: Math.floor(Date.now() / 1000) },
      processes: [{ pid: 1, ppid: null, user: 'root', cpuPercent: 1, memPercent: 0.5, rss: 1024, command: 'init', gpuMemoryMb: 0 }],
      processesByUser: [{ user: 'root', totalCpuPercent: 1, totalRssMb: 1024, totalVramMb: 0, processCount: 1 }],
      localUsers: ['alice', 'bob'],
    },
    taskQueue: {
      queued: [],
      running: [],
      recentlyEnded: [],
    },
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    taskId: 'task-1',
    status: 'queued',
    command: 'python train.py',
    cwd: '/home/alice',
    user: 'alice',
    launchMode: 'daemon_shell',
    requireVramMb: 8000,
    requireGpuCount: 1,
    gpuIds: null,
    priority: 10,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    pid: null,
    exitCode: null,
    endReason: null,
    assignedGpus: null,
    declaredVramPerGpu: null,
    scheduleHistory: [],
    ...overrides,
  };
}

describe('DB schema initialization', () => {
  it('creates database without error', () => {
    const db = getDatabase();
    expect(db).toBeDefined();
  });

  it('all tables exist', () => {
    const db = getDatabase();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('servers');
    expect(names).toContain('snapshots');
    expect(names).toContain('gpu_snapshots');
    expect(names).toContain('tasks');
    expect(names).toContain('alerts');
    expect(names).toContain('security_events');
    expect(names).toContain('persons');
    expect(names).toContain('person_bindings');
    expect(names).toContain('settings');
  });
});

describe('servers CRUD', () => {
  it('creates and retrieves a server', () => {
    const server = createServer({ name: 'gpu-node-1', agentId: 'agent-abc' });
    expect(server.id).toBeTruthy();
    expect(server.name).toBe('gpu-node-1');
    expect(server.agentId).toBe('agent-abc');

    const found = getServerById(server.id);
    expect(found).toEqual(server);

    const all = getAllServers();
    expect(all).toHaveLength(1);
  });

  it('deletes a server', () => {
    const server = createServer({ name: 'node', agentId: 'a1' });
    expect(deleteServer(server.id)).toBe(true);
    expect(getServerById(server.id)).toBeUndefined();
  });
});

describe('snapshots CRUD', () => {
  it('saves and queries snapshots', () => {
    const server = createServer({ name: 'node', agentId: 'a1' });
    const report = makeReport();
    const id = saveSnapshot(server.id, report, 'recent', 1);
    expect(id).toBeGreaterThan(0);

    const latest = getLatestSnapshot(server.id);
    expect(latest).toBeDefined();
    expect(latest!.serverId).toBe(server.id);
    expect(latest!.tier).toBe('recent');
    expect(latest!.gpuSnapshots).toHaveLength(1);
    expect(latest!.gpuSnapshots[0].name).toBe('RTX 4090');
    expect(latest!.diskIo.readBytesPerSec).toBe(2048);

    const history = getSnapshotHistory(server.id, 0, Math.floor(Date.now() / 1000) + 1000);
    expect(history).toHaveLength(1);
  });

  it('prunes old recent snapshots', () => {
    const server = createServer({ name: 'node', agentId: 'a1' });
    for (let i = 0; i < 5; i++) {
      const report = makeReport({ timestamp: Math.floor(Date.now() / 1000) + i, seq: i });
      saveSnapshot(server.id, report, 'recent', i);
    }
    deleteOldRecentSnapshots(server.id, 2);
    const remaining = getSnapshotHistory(server.id, 0, Math.floor(Date.now() / 1000) + 100000, 'recent');
    expect(remaining).toHaveLength(2);
  });
});

describe('tasks CRUD', () => {
  it('upserts and queries tasks', () => {
    const server = createServer({ name: 'node', agentId: 'a1' });
    const task = makeTask();
    upsertTask(server.id, task);

    const found = getTask('task-1');
    expect(found).toBeDefined();
    expect(found!.id).toBe('task-1');
    expect(found!.status).toBe('queued');
    expect(found!.command).toBe('python train.py');
  });

  it('ends a task', () => {
    const server = createServer({ name: 'node', agentId: 'a1' });
    upsertTask(server.id, makeTask());
    endTask('task-1', Date.now());

    const found = getTask('task-1');
    expect(found!.status).toBe('ended');
    expect(found!.finishedAt).toBeTruthy();
  });

  it('paginates tasks', () => {
    const server = createServer({ name: 'node', agentId: 'a1' });
    for (let i = 0; i < 5; i++) {
      upsertTask(server.id, makeTask({ taskId: `task-${i}`, createdAt: Date.now() + i }));
    }
    const page = listTasks({ limit: 2, offset: 0 });
    expect(page).toHaveLength(2);
  });
});

describe('alerts CRUD', () => {
  it('upserts alerts with dedup', () => {
    const server = createServer({ name: 'node', agentId: 'a1' });
    reconcileAlerts(server.id, [{
      alertType: 'cpu',
      value: 95,
      threshold: 90,
      fingerprint: '',
      details: null,
    }]);
    reconcileAlerts(server.id, [{
      alertType: 'cpu',
      value: 97,
      threshold: 90,
      fingerprint: '',
      details: null,
    }]); // should update, not insert

    const alerts = getAlerts({ serverId: server.id });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].value).toBe(97);
    expect(alerts[0].status).toBe('active');
  });

  it('suppresses and unsuppresses', () => {
    const server = createServer({ name: 'node', agentId: 'a1' });
    reconcileAlerts(server.id, [{
      alertType: 'memory',
      value: 92,
      threshold: 90,
      fingerprint: '',
      details: null,
    }]);
    const alerts = getAlerts({ serverId: server.id });
    expect(alerts).toHaveLength(1);

    const silenced = silenceAlert(alerts[0].id);
    expect(silenced?.toStatus).toBe('silenced');
    const suppressed = getAlerts({ serverId: server.id });
    expect(suppressed[0].status).toBe('silenced');

    const unsilenced = unsilenceAlert(alerts[0].id);
    expect(unsilenced?.toStatus).toBe('resolved');
    const unsup = getAlerts({ serverId: server.id });
    expect(unsup[0].status).toBe('resolved');
  });
});

describe('persons and bindings', () => {
  it('creates person and binding', () => {
    const person = createPerson({ displayName: 'Alice', email: 'alice@example.com' });
    expect(person.id).toBeTruthy();
    expect(person.displayName).toBe('Alice');

    const found = getPersonById(person.id);
    expect(found).toBeDefined();
    expect(found!.email).toBe('alice@example.com');

    const all = listPersons();
    expect(all).toHaveLength(1);

    const server = createServer({ name: 'node', agentId: 'a1' });
    const binding = createBinding({
      personId: person.id,
      serverId: server.id,
      systemUser: 'alice',
      source: 'manual',
    });
    expect(binding.id).toBeTruthy();

    const bindings = getBindingsByPersonId(person.id);
    expect(bindings).toHaveLength(1);
  });
});

describe('settings', () => {
  it('reads default settings', () => {
    const settings = getSettings();
    expect(settings.alertCpuThreshold).toBe(90);
    expect(settings.alertMemoryThreshold).toBe(90);
    expect(settings.password).toBe('');
  });

  it('saves and reads settings', () => {
    saveSetting('alertCpuThreshold', 95);
    const settings = getSettings();
    expect(settings.alertCpuThreshold).toBe(95);
  });
});
