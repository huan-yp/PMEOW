import { getDatabase } from './database.js';
import { getGpuUsageByServerIdAndTimestamp } from './gpu-usage.js';
import { getPersonById } from './persons.js';
import { listServerLocalUsers } from './server-local-users.js';
import { resolveTaskPerson, resolveRawUserPerson } from '../person/resolve.js';
import type {
  PersonAttributionFact,
  PersonBindingCandidate,
  PersonSummaryItem,
  PersonTimelinePoint,
  PersonBindingSuggestion,
  ServerPersonActivity,
  AgentTaskUpdatePayload,
  MirroredAgentTaskRecord,
} from '../types.js';

interface BindingUserObservation {
  serverId: string;
  systemUser: string;
  lastSeenAt: number;
}

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

export function insertPersonAttributionFacts(facts: PersonAttributionFact[]): void {
  if (facts.length === 0) return;
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO person_attribution_facts (timestamp, sourceType, serverId, personId, rawUser, taskId, gpuIndex, vramMB, taskStatus, resolutionSource, metadataJson)
    VALUES (?, 'gpu_snapshot', ?, ?, ?, ?, ?, ?, NULL, ?, '{}')
  `);
  const insertMany = db.transaction((rows: PersonAttributionFact[]) => {
    for (const f of rows) {
      stmt.run(f.timestamp, f.serverId, f.personId, f.rawUser, f.taskId, f.gpuIndex, f.vramMB, f.resolutionSource);
    }
  });
  insertMany(facts);
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

export function estimateSnapshotIntervalMs(from: number): number {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT MIN(timestamp) as minTs, MAX(timestamp) as maxTs, COUNT(DISTINCT timestamp) as cnt
    FROM person_attribution_facts
    WHERE sourceType LIKE 'gpu_%' AND timestamp >= ?
  `).get(from) as { minTs: number | null; maxTs: number | null; cnt: number } | undefined;

  if (!row || !row.minTs || !row.maxTs || row.cnt < 2) return 60_000;
  const estimated = (row.maxTs - row.minTs) / (row.cnt - 1);
  return Math.max(estimated, 60_000);
}

export function queryPersonCumulativeStats(from: number): Map<string, { occupancyHours: number; gbHours: number }> {
  const db = getDatabase();
  const intervalMs = estimateSnapshotIntervalMs(from);

  const rows = db.prepare(`
    SELECT personId, COUNT(DISTINCT timestamp) as snapshots, SUM(vramMB) as totalVramMB
    FROM person_attribution_facts
    WHERE personId IS NOT NULL AND sourceType LIKE 'gpu_%' AND vramMB > 0 AND timestamp >= ?
    GROUP BY personId
  `).all(from) as Array<{ personId: string; snapshots: number; totalVramMB: number }>;

  const result = new Map<string, { occupancyHours: number; gbHours: number }>();

  for (const row of rows) {
    result.set(row.personId, {
      occupancyHours: (row.snapshots * intervalMs) / 3_600_000,
      gbHours: (row.totalVramMB * intervalMs) / (1024 * 3_600_000),
    });
  }

  return result;
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

  const cumulative = queryPersonCumulativeStats(from);
  for (const [personId, stats] of cumulative) {
    const entry = personMap.get(personId);
    if (entry) {
      entry.vramOccupancyHours = stats.occupancyHours;
      entry.vramGigabyteHours = stats.gbHours;
    }
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

function listBindingUserObservations(): BindingUserObservation[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT f.serverId, f.rawUser, MAX(f.timestamp) as lastSeenAt
    FROM person_attribution_facts f
    WHERE f.rawUser IS NOT NULL
    GROUP BY f.serverId, f.rawUser
  `).all() as Array<{ serverId: string; rawUser: string; lastSeenAt: number }>;

  const merged = new Map<string, BindingUserObservation>();

  for (const row of rows) {
    merged.set(`${row.serverId}:${row.rawUser}`, {
      serverId: row.serverId,
      systemUser: row.rawUser,
      lastSeenAt: row.lastSeenAt,
    });
  }

  for (const row of listServerLocalUsers()) {
    const key = `${row.serverId}:${row.username}`;
    const existing = merged.get(key);
    if (!existing || row.updatedAt > existing.lastSeenAt) {
      merged.set(key, {
        serverId: row.serverId,
        systemUser: row.username,
        lastSeenAt: row.updatedAt,
      });
    }
  }

  return Array.from(merged.values()).sort(
    (a, b) => b.lastSeenAt - a.lastSeenAt
      || a.serverId.localeCompare(b.serverId)
      || a.systemUser.localeCompare(b.systemUser),
  );
}

function getActiveBindingsByServerUser(): Map<string, {
  bindingId: string;
  personId: string;
  personDisplayName: string;
}> {
  const db = getDatabase();
  return new Map(
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
}

export function listPersonBindingSuggestions(): PersonBindingSuggestion[] {
  const db = getDatabase();
  const rows = listBindingUserObservations();
  const activeBindings = getActiveBindingsByServerUser();

  const serverNames = new Map(
    (db.prepare('SELECT id, name FROM servers').all() as Array<{ id: string; name: string }>).map(r => [r.id, r.name])
  );

  return rows
    .filter(row => !activeBindings.has(`${row.serverId}:${row.systemUser}`))
    .map(row => ({
      serverId: row.serverId,
      serverName: serverNames.get(row.serverId) ?? row.serverId,
      systemUser: row.systemUser,
      lastSeenAt: row.lastSeenAt,
    }));
}

export function listPersonBindingCandidates(): PersonBindingCandidate[] {
  const db = getDatabase();
  const rows = listBindingUserObservations();

  const serverNames = new Map(
    (db.prepare('SELECT id, name FROM servers').all() as Array<{ id: string; name: string }>).map(r => [r.id, r.name])
  );

  const activeBindings = getActiveBindingsByServerUser();

  return rows.map(row => ({
    serverId: row.serverId,
    serverName: serverNames.get(row.serverId) ?? row.serverId,
    systemUser: row.systemUser,
    lastSeenAt: row.lastSeenAt,
    activeBinding: activeBindings.get(`${row.serverId}:${row.systemUser}`) ?? null,
  }));
}
