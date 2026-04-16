import { getDatabase } from './database.js';
import { getGpuUsageByServerIdAndTimestamp } from './gpu-usage.js';
import { getPersonById } from './persons.js';
export { listPersonBindingCandidates, listPersonBindingSuggestions } from './person-binding-candidates.js';
import { resolveTaskPerson, resolveRawUserPerson } from '../person/resolve.js';
import type {
  PersonAttributionFact,
  PersonNodeDistribution,
  PersonNodeDistributionGpu,
  PersonPeakPeriod,
  PersonSummaryItem,
  PersonTimelinePoint,
  ServerPersonActivity,
  MirroredAgentTaskRecord,
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

export function recordTaskAttributionFact(update: MirroredAgentTaskRecord): void {
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

  // Step 1: For every (serverId, timestamp) pair, compute the actual interval
  // to the next snapshot using LEAD().  This avoids the inaccuracy of a single
  // estimated average interval when collection cadences vary or there are gaps.
  const snapshotRows = db.prepare(`
    SELECT serverId, timestamp,
           LEAD(timestamp) OVER (PARTITION BY serverId ORDER BY timestamp) as nextTs
    FROM (
      SELECT DISTINCT serverId, timestamp
      FROM person_attribution_facts
      WHERE sourceType LIKE 'gpu_%' AND timestamp >= ?
    )
  `).all(from) as Array<{ serverId: string; timestamp: number; nextTs: number | null }>;

  // Compute a fallback interval per server (average gap) for the last snapshot
  // of each server where LEAD() returns NULL.
  const serverTimestamps = new Map<string, number[]>();
  for (const row of snapshotRows) {
    let arr = serverTimestamps.get(row.serverId);
    if (!arr) { arr = []; serverTimestamps.set(row.serverId, arr); }
    arr.push(row.timestamp);
  }
  const fallbackByServer = new Map<string, number>();
  for (const [serverId, timestamps] of serverTimestamps) {
    if (timestamps.length < 2) {
      fallbackByServer.set(serverId, 60_000);
    } else {
      const span = timestamps[timestamps.length - 1] - timestamps[0];
      fallbackByServer.set(serverId, Math.max(span / (timestamps.length - 1), 60_000));
    }
  }

  // Build a lookup: "serverId|timestamp" → actual interval in ms.
  const intervalAt = new Map<string, number>();
  for (const row of snapshotRows) {
    const interval = row.nextTs !== null
      ? (row.nextTs - row.timestamp)
      : (fallbackByServer.get(row.serverId) ?? 60_000);
    intervalAt.set(`${row.serverId}|${row.timestamp}`, interval);
  }

  // Step 2: Get person-level per-snapshot VRAM totals.
  // Grouping by timestamp ensures each snapshot contributes its own actual
  // interval to the accumulation, instead of an averaged estimate.
  const personFacts = db.prepare(`
    SELECT personId, serverId, timestamp, SUM(vramMB) as vramMB
    FROM person_attribution_facts
    WHERE personId IS NOT NULL AND sourceType LIKE 'gpu_%' AND vramMB > 0 AND timestamp >= ?
    GROUP BY personId, serverId, timestamp
  `).all(from) as Array<{ personId: string; serverId: string; timestamp: number; vramMB: number }>;

  // Step 3: Accumulate per-person stats using actual per-snapshot intervals.
  // occupancyHours = Σ actualInterval_i  (for each snapshot where person used VRAM)
  // gbHours        = Σ (vramMB_i × actualInterval_i)
  const result = new Map<string, { occupancyHours: number; gbHours: number }>();

  for (const fact of personFacts) {
    const interval = intervalAt.get(`${fact.serverId}|${fact.timestamp}`)
                     ?? (fallbackByServer.get(fact.serverId) ?? 60_000);
    const existing = result.get(fact.personId) ?? { occupancyHours: 0, gbHours: 0 };
    existing.occupancyHours += interval / 3_600_000;
    existing.gbHours += (fact.vramMB * interval) / (1024 * 3_600_000);
    result.set(fact.personId, existing);
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

export function getPersonNodeDistribution(personId: string, hours = 168): PersonNodeDistribution[] {
  const db = getDatabase();
  const from = Date.now() - hours * 60 * 60 * 1000;

  const rows = db.prepare(`
    WITH per_gpu_snapshot AS (
      SELECT serverId, gpuIndex, timestamp, SUM(vramMB) as totalVramMB
      FROM person_attribution_facts
      WHERE personId = ?
        AND sourceType LIKE 'gpu_%'
        AND timestamp >= ?
        AND gpuIndex IS NOT NULL
      GROUP BY serverId, gpuIndex, timestamp
    )
    SELECT serverId, gpuIndex, AVG(totalVramMB) as avgVram, MAX(totalVramMB) as maxVram, COUNT(*) as cnt
    FROM per_gpu_snapshot
    GROUP BY serverId, gpuIndex
  `).all(personId, from) as Array<{
    serverId: string;
    gpuIndex: number;
    avgVram: number;
    maxVram: number;
    cnt: number;
  }>;

  const serverNames = new Map(
    (db.prepare('SELECT id, name FROM servers').all() as Array<{ id: string; name: string }>).map(r => [r.id, r.name]),
  );

  const nodeMap = new Map<string, PersonNodeDistribution>();

  for (const row of rows) {
    const node = nodeMap.get(row.serverId) ?? {
      serverId: row.serverId,
      serverName: serverNames.get(row.serverId) ?? row.serverId,
      avgVramMB: 0,
      maxVramMB: 0,
      sampleCount: 0,
      gpus: [],
    };

    const gpu: PersonNodeDistributionGpu = {
      gpuIndex: row.gpuIndex,
      avgVramMB: Math.round(row.avgVram),
      maxVramMB: Math.round(row.maxVram),
      sampleCount: row.cnt,
    };

    node.gpus.push(gpu);
    node.avgVramMB += gpu.avgVramMB;
    node.maxVramMB += gpu.maxVramMB;
    node.sampleCount += gpu.sampleCount;
    nodeMap.set(row.serverId, node);
  }

  return Array.from(nodeMap.values())
    .map((node) => ({
      ...node,
      gpus: [...node.gpus].sort((left, right) => left.gpuIndex - right.gpuIndex),
    }))
    .sort((left, right) => left.serverName.localeCompare(right.serverName));
}

export function getPersonPeakPeriods(personId: string, hours = 168, topN = 3): PersonPeakPeriod[] {
  const db = getDatabase();
  const from = Date.now() - hours * 60 * 60 * 1000;
  const bucketMinutes = hours <= 24 ? 5 : hours <= 168 ? 30 : 120;
  const bucketSizeMs = bucketMinutes * 60 * 1000;

  const rows = db.prepare(`
    SELECT timestamp, vramMB FROM person_attribution_facts
    WHERE personId = ? AND sourceType LIKE 'gpu_%' AND timestamp >= ?
    ORDER BY timestamp ASC
  `).all(personId, from) as Array<{ timestamp: number; vramMB: number }>;

  // Group by bucket → sum vram per snapshot → max within bucket
  const snapshots = new Map<number, number>();
  for (const row of rows) {
    snapshots.set(row.timestamp, (snapshots.get(row.timestamp) ?? 0) + (row.vramMB ?? 0));
  }

  const buckets = new Map<number, number>();
  for (const [ts, vram] of snapshots) {
    const bucketStart = Math.floor(ts / bucketSizeMs) * bucketSizeMs;
    buckets.set(bucketStart, Math.max(buckets.get(bucketStart) ?? 0, vram));
  }

  return Array.from(buckets.entries())
    .map(([bucketStart, totalVramMB]) => ({ bucketStart, totalVramMB }))
    .sort((a, b) => b.totalVramMB - a.totalVramMB)
    .slice(0, topN);
}

