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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, '{}')
  `);
  const insertMany = db.transaction((rows: PersonAttributionFact[]) => {
    for (const f of rows) {
      stmt.run(f.timestamp, f.sourceType, f.serverId, f.personId, f.rawUser, f.taskId, f.gpuIndex, f.vramMB, f.resolutionSource);
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

  // Estimate snapshot interval per server so multi-server deployments
  // don't skew results (interleaved timestamps from different cadences
  // would halve the global interval estimate).
  const serverRows = db.prepare(`
    SELECT serverId, MIN(timestamp) as minTs, MAX(timestamp) as maxTs, COUNT(DISTINCT timestamp) as cnt
    FROM person_attribution_facts
    WHERE sourceType LIKE 'gpu_%' AND timestamp >= ?
    GROUP BY serverId
  `).all(from) as Array<{ serverId: string; minTs: number; maxTs: number; cnt: number }>;

  const intervalByServer = new Map<string, number>();
  for (const sr of serverRows) {
    const interval = sr.cnt < 2 ? 60_000 : Math.max((sr.maxTs - sr.minTs) / (sr.cnt - 1), 60_000);
    intervalByServer.set(sr.serverId, interval);
  }

  // Group by (personId, serverId) so each server's rows use the correct interval.
  const rows = db.prepare(`
    SELECT personId, serverId, COUNT(DISTINCT timestamp) as snapshots, SUM(vramMB) as totalVramMB
    FROM person_attribution_facts
    WHERE personId IS NOT NULL AND sourceType LIKE 'gpu_%' AND vramMB > 0 AND timestamp >= ?
    GROUP BY personId, serverId
  `).all(from) as Array<{ personId: string; serverId: string; snapshots: number; totalVramMB: number }>;

  const result = new Map<string, { occupancyHours: number; gbHours: number }>();

  for (const row of rows) {
    const interval = intervalByServer.get(row.serverId) ?? 60_000;
    const existing = result.get(row.personId) ?? { occupancyHours: 0, gbHours: 0 };
    existing.occupancyHours += (row.snapshots * interval) / 3_600_000;
    existing.gbHours += (row.totalVramMB * interval) / (1024 * 3_600_000);
    result.set(row.personId, existing);
  }

  return result;
}

export function getPersonSummaries(hours = 168): PersonSummaryItem[] {
  const db = getDatabase();
  const now = Date.now();
  const from = now - hours * 60 * 60 * 1000;

  // currentVramMB must reflect each SERVER's latest snapshot — not the person's
  // own latest fact.  If a person stopped using VRAM 2 hours ago but the server
  // kept pushing snapshots, currentVramMB should be 0, not the stale value.
  const gpuRows = db.prepare(`
    WITH server_latest AS (
      SELECT serverId, MAX(timestamp) as latestTs
      FROM person_attribution_facts
      WHERE sourceType LIKE 'gpu_%' AND timestamp >= ?
      GROUP BY serverId
    ),
    current_vram AS (
      SELECT f.personId,
             SUM(f.vramMB) as totalVram,
             COUNT(DISTINCT f.serverId) as serverCount
      FROM person_attribution_facts f
      JOIN server_latest sl ON f.serverId = sl.serverId AND f.timestamp = sl.latestTs
      WHERE f.personId IS NOT NULL AND f.sourceType LIKE 'gpu_%'
      GROUP BY f.personId
    ),
    last_activity AS (
      SELECT personId, MAX(timestamp) as lastActivity
      FROM person_attribution_facts
      WHERE personId IS NOT NULL AND sourceType LIKE 'gpu_%' AND timestamp >= ?
      GROUP BY personId
    )
    SELECT COALESCE(cv.personId, la.personId) as personId,
           COALESCE(cv.totalVram, 0) as totalVram,
           COALESCE(cv.serverCount, 0) as serverCount,
           COALESCE(la.lastActivity, 0) as lastActivity
    FROM last_activity la
    LEFT JOIN current_vram cv ON cv.personId = la.personId
  `).all(from, from) as Array<{ personId: string; totalVram: number; serverCount: number; lastActivity: number }>;

  // Use the live status from agent_tasks (not the historical taskStatus recorded
  // in attribution facts) so that finished tasks no longer count as "running".
  const taskRows = db.prepare(`
    SELECT paf.personId, at.status as taskStatus, COUNT(DISTINCT paf.taskId) as cnt
    FROM (
      SELECT DISTINCT personId, taskId
      FROM person_attribution_facts
      WHERE personId IS NOT NULL AND sourceType = 'task_update' AND timestamp >= ?
    ) paf
    JOIN agent_tasks at ON paf.taskId = at.taskId
    GROUP BY paf.personId, at.status
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
    let entry = personMap.get(personId);
    if (!entry) {
      const person = getPersonById(personId);
      if (!person) continue;
      entry = {
        personId,
        displayName: person.displayName,
        currentVramMB: 0,
        runningTaskCount: 0,
        queuedTaskCount: 0,
        activeServerCount: 0,
        lastActivityAt: 0,
        vramOccupancyHours: 0,
        vramGigabyteHours: 0,
        taskRuntimeHours: 0,
      };
      personMap.set(personId, entry);
    }
    entry.vramOccupancyHours = stats.occupancyHours;
    entry.vramGigabyteHours = stats.gbHours;
  }

  return Array.from(personMap.values())
    .sort((a, b) => b.currentVramMB - a.currentVramMB || a.displayName.localeCompare(b.displayName));
}

export function getPersonTimeline(personId: string, hours = 168, bucketMinutes?: number): PersonTimelinePoint[] {
  const db = getDatabase();
  const now = Date.now();
  const from = now - hours * 60 * 60 * 1000;

  // Auto-pick bucket size so the chart has ~300 data points.
  const effectiveBucketMinutes = bucketMinutes ?? (
    hours <= 24 ? 5 :
    hours <= 168 ? 30 :
    hours <= 720 ? 120 :
    240
  );
  const bucketSizeMs = effectiveBucketMinutes * 60 * 1000;

  const rows = db.prepare(`
    SELECT timestamp, vramMB, sourceType
    FROM person_attribution_facts
    WHERE personId = ? AND sourceType LIKE 'gpu_%' AND timestamp >= ?
    ORDER BY timestamp ASC
  `).all(personId, from) as Array<{ timestamp: number; vramMB: number; sourceType: string }>;

  // No data at all → return empty so UI can show a placeholder.
  if (rows.length === 0) return [];

  // Step 1: aggregate per timestamp (one snapshot may produce multiple fact rows,
  // e.g. one per GPU or one per process).
  const perSnapshot = new Map<number, { total: number; task: number; nonTask: number }>();
  for (const row of rows) {
    const entry = perSnapshot.get(row.timestamp) ?? { total: 0, task: 0, nonTask: 0 };
    const vram = row.vramMB ?? 0;
    entry.total += vram;
    if (row.sourceType === 'gpu_task') {
      entry.task += vram;
    } else {
      entry.nonTask += vram;
    }
    perSnapshot.set(row.timestamp, entry);
  }

  // Step 2: bucket by time and average across snapshots within each bucket.
  const buckets = new Map<number, { total: number; task: number; nonTask: number; count: number }>();
  for (const [ts, snap] of perSnapshot) {
    const bucketStart = Math.floor(ts / bucketSizeMs) * bucketSizeMs;
    const acc = buckets.get(bucketStart) ?? { total: 0, task: 0, nonTask: 0, count: 0 };
    acc.total += snap.total;
    acc.task += snap.task;
    acc.nonTask += snap.nonTask;
    acc.count += 1;
    buckets.set(bucketStart, acc);
  }

  // Fill zero-value buckets across the full [from, now] range so the chart
  // x-axis always extends to the current time and time gaps show as zero.
  const fromBucket = Math.floor(from / bucketSizeMs) * bucketSizeMs;
  const nowBucket = Math.floor(now / bucketSizeMs) * bucketSizeMs;
  const result: PersonTimelinePoint[] = [];

  for (let t = fromBucket; t <= nowBucket; t += bucketSizeMs) {
    const acc = buckets.get(t);
    result.push({
      bucketStart: t,
      personId,
      totalVramMB: acc ? Math.round(acc.total / acc.count) : 0,
      taskVramMB: acc ? Math.round(acc.task / acc.count) : 0,
      nonTaskVramMB: acc ? Math.round(acc.nonTask / acc.count) : 0,
    });
  }

  return result;
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
