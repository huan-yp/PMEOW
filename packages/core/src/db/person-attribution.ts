import { getDatabase } from './database.js';
import { getGpuUsageByServerIdAndTimestamp } from './gpu-usage.js';
import { getPersonById } from './persons.js';
import { resolveTaskPerson, resolveRawUserPerson } from '../person/resolve.js';
import { getAgentTask } from './agent-tasks.js';
import { getLatestMetrics } from './metrics.js';
import type {
  PersonBindingCandidate,
  PersonSummaryItem,
  PersonTimelinePoint,
  PersonBindingSuggestion,
  ServerPersonActivity,
  AgentTaskUpdatePayload,
  MirroredAgentTaskRecord,
  ResolvedGpuAllocationResponse,
  ResolvedGpuAllocationSegment,
} from '../types.js';

export function insertPersonAttributionFact(fact: {
  timestamp: number;
  sourceType: string;
  serverId: string;
  personId: string | null;
  rawUser: string | null;
  taskId: string | null;
  gpuIndex: number | null;
  vramMB: number | null;
  taskStatus: string | null;
  resolutionSource: string;
  metadataJson: string;
}): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO person_attribution_facts (timestamp, sourceType, serverId, personId, rawUser, taskId, gpuIndex, vramMB, taskStatus, resolutionSource, metadataJson)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fact.timestamp, fact.sourceType, fact.serverId, fact.personId,
    fact.rawUser, fact.taskId, fact.gpuIndex, fact.vramMB,
    fact.taskStatus, fact.resolutionSource, fact.metadataJson,
  );
}

export function recordGpuAttributionFacts(serverId: string, timestamp: number): void {
  const rows = getGpuUsageByServerIdAndTimestamp(serverId, timestamp);
  for (const row of rows) {
    const resolution = row.taskId
      ? resolveTaskPerson(serverId, row.taskId, row.userName ?? undefined, timestamp)
      : resolveRawUserPerson(serverId, row.userName ?? undefined, timestamp);

    insertPersonAttributionFact({
      timestamp,
      sourceType: row.ownerType === 'task' ? 'gpu_task' : row.ownerType === 'user' ? 'gpu_user' : 'gpu_unknown',
      serverId,
      personId: resolution.person?.id ?? null,
      rawUser: row.userName ?? null,
      taskId: row.taskId ?? null,
      gpuIndex: row.gpuIndex,
      vramMB: row.usedMemoryMB,
      taskStatus: null,
      resolutionSource: resolution.resolutionSource,
      metadataJson: JSON.stringify({ pid: row.pid ?? null, command: row.command ?? '' }),
    });
  }
}

export function recordTaskAttributionFact(update: AgentTaskUpdatePayload): void {
  const resolution = resolveTaskPerson(
    update.serverId, update.taskId, update.user,
    update.finishedAt ?? update.startedAt ?? update.createdAt ?? Date.now(),
  );
  insertPersonAttributionFact({
    timestamp: update.finishedAt ?? update.startedAt ?? update.createdAt ?? Date.now(),
    sourceType: 'task_update',
    serverId: update.serverId,
    personId: resolution.person?.id ?? null,
    rawUser: update.user ?? null,
    taskId: update.taskId,
    gpuIndex: null,
    vramMB: null,
    taskStatus: update.status,
    resolutionSource: resolution.resolutionSource,
    metadataJson: JSON.stringify({ priority: update.priority ?? null }),
  });
}

export function getPersonSummaries(hours = 168): PersonSummaryItem[] {
  const db = getDatabase();
  const now = Date.now();
  const from = now - hours * 60 * 60 * 1000;

  const gpuRows = db.prepare(`
    SELECT personId, SUM(vramMB) as totalVram, COUNT(DISTINCT serverId) as serverCount, MAX(timestamp) as lastActivity
    FROM person_attribution_facts
    WHERE personId IS NOT NULL AND sourceType LIKE 'gpu_%' AND timestamp >= ?
    GROUP BY personId
  `).all(from) as Array<{ personId: string; totalVram: number; serverCount: number; lastActivity: number }>;

  const taskRows = db.prepare(`
    SELECT personId, taskStatus, COUNT(*) as cnt
    FROM person_attribution_facts
    WHERE personId IS NOT NULL AND sourceType = 'task_update' AND timestamp >= ?
    GROUP BY personId, taskStatus
  `).all(from) as Array<{ personId: string; taskStatus: string; cnt: number }>;

  const personMap = new Map<string, PersonSummaryItem>();

  for (const row of gpuRows) {
    const person = getPersonById(row.personId);
    if (!person) continue;
    personMap.set(row.personId, {
      personId: row.personId,
      displayName: person.displayName,
      currentVramMB: row.totalVram,
      runningTaskCount: 0,
      queuedTaskCount: 0,
      activeServerCount: row.serverCount,
      lastActivityAt: row.lastActivity,
      vramOccupancyHours: 0,
      vramGigabyteHours: 0,
      taskRuntimeHours: 0,
    });
  }

  for (const row of taskRows) {
    const existing = personMap.get(row.personId);
    if (!existing) {
      const person = getPersonById(row.personId);
      if (!person) continue;
      personMap.set(row.personId, {
        personId: row.personId,
        displayName: person.displayName,
        currentVramMB: 0,
        runningTaskCount: 0,
        queuedTaskCount: 0,
        activeServerCount: 0,
        lastActivityAt: 0,
        vramOccupancyHours: 0,
        vramGigabyteHours: 0,
        taskRuntimeHours: 0,
      });
    }
    const entry = personMap.get(row.personId)!;
    if (row.taskStatus === 'running') entry.runningTaskCount = row.cnt;
    if (row.taskStatus === 'queued') entry.queuedTaskCount = row.cnt;
  }

  return Array.from(personMap.values())
    .sort((a, b) => b.currentVramMB - a.currentVramMB || a.displayName.localeCompare(b.displayName));
}

export function getPersonTimeline(personId: string, hours = 168, bucketMinutes = 60): PersonTimelinePoint[] {
  const db = getDatabase();
  const now = Date.now();
  const from = now - hours * 60 * 60 * 1000;
  const bucketSizeMs = bucketMinutes * 60 * 1000;

  const rows = db.prepare(`
    SELECT timestamp, vramMB, sourceType
    FROM person_attribution_facts
    WHERE personId = ? AND sourceType LIKE 'gpu_%' AND timestamp >= ?
    ORDER BY timestamp ASC
  `).all(personId, from) as Array<{ timestamp: number; vramMB: number; sourceType: string }>;

  const points = new Map<number, PersonTimelinePoint>();

  for (const row of rows) {
    const bucketStart = Math.floor(row.timestamp / bucketSizeMs) * bucketSizeMs;
    const existing = points.get(bucketStart) ?? {
      bucketStart,
      personId,
      totalVramMB: 0,
      taskVramMB: 0,
      nonTaskVramMB: 0,
    };
    existing.totalVramMB += row.vramMB ?? 0;
    if (row.sourceType === 'gpu_task') {
      existing.taskVramMB += row.vramMB ?? 0;
    } else {
      existing.nonTaskVramMB += row.vramMB ?? 0;
    }
    points.set(bucketStart, existing);
  }

  return Array.from(points.values()).sort((a, b) => a.bucketStart - b.bucketStart);
}

export function getPersonTasks(personId: string, hours = 168): MirroredAgentTaskRecord[] {
  const db = getDatabase();
  const now = Date.now();
  const from = now - hours * 60 * 60 * 1000;

  const taskIds = db.prepare(`
    SELECT DISTINCT taskId FROM person_attribution_facts
    WHERE personId = ? AND sourceType = 'task_update' AND timestamp >= ? AND taskId IS NOT NULL
  `).all(personId, from) as Array<{ taskId: string }>;

  if (taskIds.length === 0) return [];

  const placeholders = taskIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT * FROM agent_tasks WHERE taskId IN (${placeholders})
  `).all(...taskIds.map(r => r.taskId)) as MirroredAgentTaskRecord[];
}

export function getServerPersonActivity(serverId: string): ServerPersonActivity {
  const db = getDatabase();

  const latestRow = db.prepare(`
    SELECT MAX(timestamp) as ts FROM person_attribution_facts WHERE serverId = ? AND sourceType LIKE 'gpu_%'
  `).get(serverId) as { ts: number | null } | undefined;

  const latestTs = latestRow?.ts;
  if (!latestTs) {
    return { serverId, people: [], unassignedVramMB: 0, unassignedUsers: [] };
  }

  const rows = db.prepare(`
    SELECT personId, rawUser, vramMB, sourceType, resolutionSource
    FROM person_attribution_facts
    WHERE serverId = ? AND timestamp = ? AND sourceType LIKE 'gpu_%'
  `).all(serverId, latestTs) as Array<{
    personId: string | null; rawUser: string | null; vramMB: number;
    sourceType: string; resolutionSource: string;
  }>;

  const personMap = new Map<string, { personId: string; displayName: string; currentVramMB: number; runningTaskCount: number }>();
  let unassignedVramMB = 0;
  const unassignedUsers = new Set<string>();

  for (const row of rows) {
    if (row.personId) {
      const existing = personMap.get(row.personId);
      if (existing) {
        existing.currentVramMB += row.vramMB ?? 0;
      } else {
        const person = getPersonById(row.personId);
        personMap.set(row.personId, {
          personId: row.personId,
          displayName: person?.displayName ?? 'Unknown',
          currentVramMB: row.vramMB ?? 0,
          runningTaskCount: 0,
        });
      }
    } else {
      unassignedVramMB += row.vramMB ?? 0;
      if (row.rawUser) unassignedUsers.add(row.rawUser);
    }
  }

  return {
    serverId,
    people: Array.from(personMap.values()),
    unassignedVramMB,
    unassignedUsers: Array.from(unassignedUsers),
  };
}

export function listPersonBindingSuggestions(): PersonBindingSuggestion[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT DISTINCT f.serverId, f.rawUser, MAX(f.timestamp) as lastSeenAt
    FROM person_attribution_facts f
    WHERE f.rawUser IS NOT NULL
      AND f.personId IS NULL
      AND f.resolutionSource = 'unassigned'
      AND f.sourceType LIKE 'gpu_%'
    GROUP BY f.serverId, f.rawUser
    ORDER BY lastSeenAt DESC
  `).all() as Array<{ serverId: string; rawUser: string; lastSeenAt: number }>;

  const serverNames = new Map(
    (db.prepare('SELECT id, name FROM servers').all() as Array<{ id: string; name: string }>).map(r => [r.id, r.name])
  );

  return rows.map(row => ({
    serverId: row.serverId,
    serverName: serverNames.get(row.serverId) ?? row.serverId,
    systemUser: row.rawUser,
    lastSeenAt: row.lastSeenAt,
  }));
}

export function listPersonBindingCandidates(): PersonBindingCandidate[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT f.serverId, f.rawUser, MAX(f.timestamp) as lastSeenAt
    FROM person_attribution_facts f
    WHERE f.rawUser IS NOT NULL
    GROUP BY f.serverId, f.rawUser
    ORDER BY lastSeenAt DESC, f.serverId ASC, f.rawUser ASC
  `).all() as Array<{ serverId: string; rawUser: string; lastSeenAt: number }>;

  const serverNames = new Map(
    (db.prepare('SELECT id, name FROM servers').all() as Array<{ id: string; name: string }>).map(r => [r.id, r.name])
  );

  const activeBindings = new Map(
    (db.prepare(`
      SELECT b.id, b.serverId, b.systemUser, b.personId, p.displayName as personDisplayName
      FROM person_bindings b
      JOIN persons p ON p.id = b.personId
      WHERE b.enabled = 1 AND b.effectiveTo IS NULL
    `).all() as Array<{
      id: string;
      serverId: string;
      systemUser: string;
      personId: string;
      personDisplayName: string;
    }>).map(row => [
      `${row.serverId}:${row.systemUser}`,
      {
        bindingId: row.id,
        personId: row.personId,
        personDisplayName: row.personDisplayName,
      },
    ])
  );

  return rows.map(row => ({
    serverId: row.serverId,
    serverName: serverNames.get(row.serverId) ?? row.serverId,
    systemUser: row.rawUser,
    lastSeenAt: row.lastSeenAt,
    activeBinding: activeBindings.get(`${row.serverId}:${row.rawUser}`) ?? null,
  }));
}

function upsertResolvedSegment(
  segmentMap: Map<string, ResolvedGpuAllocationSegment>,
  nextSegment: ResolvedGpuAllocationSegment,
): void {
  const existing = segmentMap.get(nextSegment.ownerKey);
  if (!existing) {
    segmentMap.set(nextSegment.ownerKey, nextSegment);
    return;
  }

  existing.usedMemoryMB += nextSegment.usedMemoryMB;
  for (const sourceKind of nextSegment.sourceKinds) {
    if (!existing.sourceKinds.includes(sourceKind)) {
      existing.sourceKinds.push(sourceKind);
    }
  }
  if (!existing.rawUser && nextSegment.rawUser) {
    existing.rawUser = nextSegment.rawUser;
  }
}

export function getResolvedGpuAllocation(serverId: string): ResolvedGpuAllocationResponse | null {
  const metrics = getLatestMetrics(serverId);
  if (!metrics || !metrics.gpuAllocation) return null;

  const allocation = metrics.gpuAllocation;
  const timestamp = metrics.timestamp;

  const perGpu = allocation.perGpu.map(gpu => {
    const segmentMap = new Map<string, ResolvedGpuAllocationSegment>();

    for (const taskAllocation of gpu.pmeowTasks) {
      const task = getAgentTask(taskAllocation.taskId);
      const rawUser = task?.user;
      const resolved = resolveTaskPerson(serverId, taskAllocation.taskId, rawUser, timestamp);

      let segment: ResolvedGpuAllocationSegment;
      if (resolved.person) {
        segment = {
          ownerKey: `person:${resolved.person.id}`,
          ownerKind: 'person',
          displayName: resolved.person.displayName,
          usedMemoryMB: taskAllocation.actualVramMB,
          personId: resolved.person.id,
          rawUser,
          sourceKinds: ['task'],
        };
      } else if (rawUser) {
        segment = {
          ownerKey: `user:${rawUser}`,
          ownerKind: 'user',
          displayName: rawUser,
          usedMemoryMB: taskAllocation.actualVramMB,
          rawUser,
          sourceKinds: ['task'],
        };
      } else {
        segment = {
          ownerKey: 'unknown',
          ownerKind: 'unknown',
          displayName: 'Unknown',
          usedMemoryMB: taskAllocation.actualVramMB,
          sourceKinds: ['task'],
        };
      }
      upsertResolvedSegment(segmentMap, segment);
    }

    for (const process of gpu.userProcesses) {
      const resolved = resolveRawUserPerson(serverId, process.user, timestamp);

      let segment: ResolvedGpuAllocationSegment;
      if (resolved.person) {
        segment = {
          ownerKey: `person:${resolved.person.id}`,
          ownerKind: 'person',
          displayName: resolved.person.displayName,
          usedMemoryMB: process.usedMemoryMB,
          personId: resolved.person.id,
          rawUser: process.user,
          sourceKinds: ['user_process'],
        };
      } else {
        segment = {
          ownerKey: `user:${process.user}`,
          ownerKind: 'user',
          displayName: process.user,
          usedMemoryMB: process.usedMemoryMB,
          rawUser: process.user,
          sourceKinds: ['user_process'],
        };
      }
      upsertResolvedSegment(segmentMap, segment);
    }

    for (const process of gpu.unknownProcesses) {
      upsertResolvedSegment(segmentMap, {
        ownerKey: 'unknown',
        ownerKind: 'unknown',
        displayName: 'Unknown',
        usedMemoryMB: process.usedMemoryMB,
        sourceKinds: ['unknown_process'],
      });
    }

    const segments = [...segmentMap.values()].sort((a, b) => {
      if (b.usedMemoryMB !== a.usedMemoryMB) return b.usedMemoryMB - a.usedMemoryMB;
      return a.displayName.localeCompare(b.displayName);
    });

    return {
      gpuIndex: gpu.gpuIndex,
      totalMemoryMB: gpu.totalMemoryMB,
      freeMB: Math.max(gpu.effectiveFreeMB, 0),
      segments,
    };
  });

  return {
    serverId,
    snapshotTimestamp: timestamp,
    perGpu,
  };
}
