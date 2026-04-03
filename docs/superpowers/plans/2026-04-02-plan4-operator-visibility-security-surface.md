# Plan 4: Operator Visibility and Security Surface Implementation Plan

> **For agentic workers:** REQUIRED: Use the `subagent-driven-development` agent (recommended) or `executing-plans` agent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the operator-facing task queue, security audit surface, and GPU reporting layer on top of the existing server-agent integration without moving scheduling ownership out of the Python Agent.

**Architecture:** `packages/core/` owns the new shared DTOs, security settings, audit persistence, GPU/task aggregate queries, and the default V2 security analyzer. `packages/web/` owns the authenticated REST APIs plus the minimal realtime fanout needed for task/security freshness. `packages/ui/` stays a React web client that consumes those APIs, adds the new Tasks/Security pages, and enhances the existing Overview/Server Detail/Settings surfaces without reworking the app shell.

**Tech Stack:** TypeScript, React 18, Zustand, Express, Socket.IO, better-sqlite3, vitest, supertest, React Testing Library, Tailwind CSS

**Out of Scope:** Server-side task submission, server-side admission or queue scheduling, task log streaming/viewing, offline command replay, and V3 behavior-analysis heuristics. The V2 spec also mentions Electron package cleanup; treat that as a separate packaging/runtime follow-up so this plan stays focused on the operator visibility/security slice.

---

## File Structure

- Modify: `packages/core/src/types.ts`
  Responsibility: add shared DTOs for security events, process audit rows, GPU overview responses, task-queue groups, and the new flat security settings keys.

- Modify: `packages/core/src/db/settings.ts`
  Responsibility: parse and persist the new security settings without introducing nested config objects.

- Modify: `packages/core/src/db/database.ts`
  Responsibility: add the `security_events` table, add `gpu_usage_stats.command`, and add the indexes needed for overview/timeline/security-window queries.

- Modify: `packages/core/src/db/gpu-usage.ts`
  Responsibility: persist GPU process commands and expose aggregate read helpers for overview, summary, by-user timelines, and recent unowned-GPU windows.

- Modify: `packages/core/src/agent/ingest.ts`
  Responsibility: keep `gpu_usage_stats` audit-ready by flattening command strings from Agent GPU allocations into database rows.

- Create: `packages/core/src/db/security-events.ts`
  Responsibility: create/list/find/resolve security events and append a `marked_safe` audit entry when an operator resolves a finding.

- Modify: `packages/core/src/db/agent-tasks.ts`
  Responsibility: expose grouped task-queue reads for all Agent-backed servers.

- Create: `packages/core/src/security/audit.ts`
  Responsibility: join latest metrics + latest GPU rows into process audit rows, including synthetic rows for GPU PIDs missing from the top-process snapshot.

- Create: `packages/core/src/security/analyzer.ts`
  Responsibility: implement the default V2 security rules (keyword match and sustained unowned GPU use) and compute stable event fingerprints.

- Create: `packages/core/src/security/pipeline.ts`
  Responsibility: orchestrate audit reads, duration-window checks, dedupe, persistence, and emitted security events so `Scheduler` stays thin.

- Modify: `packages/core/src/scheduler.ts`
  Responsibility: invoke the security pipeline after persistence, emit the new `securityEvent`, and clean old GPU rows alongside metrics.

- Modify: `packages/core/src/index.ts`
  Responsibility: export all new core helpers and DTOs used by web/ui/tests.

- Create: `packages/core/tests/db/settings.test.ts`
  Responsibility: lock the new flat settings contract.

- Create: `packages/core/tests/db/security-events.test.ts`
  Responsibility: verify migration safety, dedupe lookup, resolution, and `marked_safe` audit logging.

- Modify: `packages/core/tests/db/gpu-usage.test.ts`
  Responsibility: verify command persistence round-trips.

- Create: `packages/core/tests/db/gpu-usage-queries.test.ts`
  Responsibility: verify overview/summary/timeline/unowned-window queries.

- Create: `packages/core/tests/db/agent-task-queue.test.ts`
  Responsibility: verify queue/running/recent grouping and sort order.

- Create: `packages/core/tests/security/audit.test.ts`
  Responsibility: verify synthetic process rows, GPU memory joins, and suspicious-reason annotation.

- Create: `packages/core/tests/security/analyzer.test.ts`
  Responsibility: verify emitted findings and stable fingerprints.

- Create: `packages/core/tests/security/pipeline.test.ts`
  Responsibility: verify deduped persistence and emitted events.

- Create: `packages/web/src/operator-routes.ts`
  Responsibility: add task-queue snapshot, process-audit, security-event, and GPU reporting APIs.

- Modify: `packages/web/src/handlers.ts`
  Responsibility: forward the new `securityEvent` realtime event to authenticated UI clients.

- Modify: `packages/web/src/agent-namespace.ts`
  Responsibility: rebroadcast normalized task updates to authenticated UI clients after ingest.

- Modify: `packages/web/src/app.ts`
  Responsibility: mount the new operator routes and connect the UI namespace fanout.

- Create: `packages/web/tests/operator-routes.test.ts`
  Responsibility: verify authenticated operator APIs.

- Create: `packages/web/tests/operator-realtime.test.ts`
  Responsibility: verify task/security realtime delivery to the UI namespace.

- Modify: `packages/ui/package.json`
  Responsibility: add UI test scripts and dependencies.

- Create: `packages/ui/vitest.config.ts`
  Responsibility: configure jsdom-based UI tests.

- Create: `packages/ui/tests/setup.ts`
  Responsibility: register jest-dom matchers and any global cleanup.

- Modify: `packages/ui/src/transport/types.ts`
  Responsibility: add task/security/GPU/process-audit API methods and subscriptions.

- Modify: `packages/ui/src/transport/ws-adapter.ts`
  Responsibility: implement the new REST endpoints and Socket.IO subscriptions.

- Modify: `packages/ui/src/transport/TransportProvider.tsx`
  Responsibility: allow adapter injection in tests.

- Modify: `packages/ui/src/store/useStore.ts`
  Responsibility: store task-queue groups and unresolved security events used across the shell.

- Create: `packages/ui/src/hooks/useOperatorData.ts`
  Responsibility: bootstrap/refetch task-queue and unresolved security data with snapshot + incremental refresh.

- Create: `packages/ui/tests/operator-bootstrap.test.tsx`
  Responsibility: verify the new bootstrap hook loads and refreshes operator data.

- Create: `packages/ui/src/components/GpuOverviewCard.tsx`
  Responsibility: render cluster-wide GPU ownership summary on the Overview page.

- Create: `packages/ui/src/components/GpuAllocationBars.tsx`
  Responsibility: render the per-GPU allocation bars used in Server Detail.

- Modify: `packages/ui/src/components/ServerCard.tsx`
  Responsibility: show source-type badge, task counts, and a security warning indicator.

- Modify: `packages/ui/src/components/ProcessTable.tsx`
  Responsibility: render process audit rows, GPU memory, and suspicious highlighting.

- Modify: `packages/ui/src/pages/Overview.tsx`
  Responsibility: add the GPU ownership summary card.

- Modify: `packages/ui/src/pages/ServerDetail.tsx`
  Responsibility: add the Agent-only Tasks tab, GPU allocation bars, and audit-backed process table.

- Modify: `packages/ui/src/pages/Settings.tsx`
  Responsibility: expose security settings and an Agent deployment/help panel.

- Create: `packages/ui/src/pages/TaskQueue.tsx`
  Responsibility: render grouped queued/running/recent Agent tasks with cancel/priority/pause/resume actions.

- Create: `packages/ui/src/pages/Security.tsx`
  Responsibility: render filterable security events with mark-safe actions.

- Modify: `packages/ui/src/App.tsx`
  Responsibility: wire the new bootstrap hook, routes, and sidebar entries.

- Create: `packages/ui/tests/overview-detail-settings.test.tsx`
  Responsibility: verify the existing surfaces render the new operator/security data correctly.

- Create: `packages/ui/tests/taskqueue-security-pages.test.tsx`
  Responsibility: verify the new pages, actions, and route wiring.

- Modify: `README.md`
  Responsibility: document the new UI pages, security settings, and operator APIs.

---

### Task 1: Extend shared visibility/security types and flat settings

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/db/settings.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/db/settings.test.ts`

- [ ] **Step 1: Write the failing settings-contract test**

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, getSettings, saveSettings } from '../../src/index.js';

describe('security settings contract', () => {
  let dataDir: string | undefined;

  afterEach(() => {
    closeDatabase();
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
  });

  it('loads flat security defaults and persists keyword arrays', () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmeow-settings-'));
    getDatabase(dataDir);

    expect(getSettings()).toMatchObject({
      securityMiningKeywords: ['xmrig', 'ethminer', 'nbminer'],
      securityUnownedGpuMinutes: 30,
      securityHighGpuUtilizationPercent: 90,
      securityHighGpuDurationMinutes: 120,
    });

    saveSettings({
      securityMiningKeywords: ['miner', 'evil'],
      securityUnownedGpuMinutes: 45,
      securityHighGpuUtilizationPercent: 95,
      securityHighGpuDurationMinutes: 180,
    });

    expect(getSettings()).toMatchObject({
      securityMiningKeywords: ['miner', 'evil'],
      securityUnownedGpuMinutes: 45,
      securityHighGpuUtilizationPercent: 95,
      securityHighGpuDurationMinutes: 180,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd packages/core && pnpm test -- tests/db/settings.test.ts
```

Expected: FAIL because `AppSettings` and `getSettings()` do not expose the new security fields yet.

- [ ] **Step 3: Add the shared DTOs and flat settings fields**

In `packages/core/src/types.ts`, add the new shared models and defaults:

```ts
export type SecurityEventType = 'suspicious_process' | 'unowned_gpu' | 'marked_safe';

export interface SecurityEventDetails {
  reason: string;
  pid?: number;
  user?: string;
  command?: string;
  gpuIndex?: number;
  taskId?: string | null;
  keyword?: string;
  targetEventId?: number;
  durationMinutes?: number;
  usedMemoryMB?: number;
}

export interface SecurityEventRecord {
  id: number;
  serverId: string;
  eventType: SecurityEventType;
  fingerprint: string;
  details: SecurityEventDetails;
  resolved: boolean;
  resolvedBy: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface ProcessAuditRow {
  pid: number;
  user: string;
  command: string;
  cpuPercent: number;
  memPercent: number;
  rss: number;
  gpuMemoryMB: number;
  ownerType: 'task' | 'user' | 'unknown' | 'none';
  taskId?: string | null;
  suspiciousReasons: string[];
}

export interface AgentTaskQueueGroup {
  serverId: string;
  serverName: string;
  queued: MirroredAgentTaskRecord[];
  running: MirroredAgentTaskRecord[];
  recent: MirroredAgentTaskRecord[];
}

export interface GpuOverviewUserSummary {
  user: string;
  totalVramMB: number;
  taskCount: number;
  processCount: number;
  serverIds: string[];
}

export interface GpuOverviewServerSummary {
  serverId: string;
  serverName: string;
  totalUsedMB: number;
  totalTaskMB: number;
  totalNonTaskMB: number;
}

export interface GpuOverviewResponse {
  generatedAt: number;
  users: GpuOverviewUserSummary[];
  servers: GpuOverviewServerSummary[];
}

export interface GpuUsageSummaryItem {
  user: string;
  totalVramMB: number;
  taskVramMB: number;
  nonTaskVramMB: number;
}

export interface GpuUsageTimelinePoint {
  bucketStart: number;
  user: string;
  totalVramMB: number;
  taskVramMB: number;
  nonTaskVramMB: number;
}
```

Also extend the existing settings contract and GPU process types:

```ts
export interface GpuUnknownProcess {
  pid: number;
  gpuIndex: number;
  usedMemoryMB: number;
  command?: string;
}

export interface AppSettings {
  refreshIntervalMs: number;
  alertCpuThreshold: number;
  alertMemoryThreshold: number;
  alertDiskThreshold: number;
  alertDiskMountPoints: string[];
  alertSuppressDefaultDays: number;
  apiEnabled: boolean;
  apiPort: number;
  apiToken: string;
  historyRetentionDays: number;
  securityMiningKeywords: string[];
  securityUnownedGpuMinutes: number;
  securityHighGpuUtilizationPercent: number;
  securityHighGpuDurationMinutes: number;
  password: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  refreshIntervalMs: 5000,
  alertCpuThreshold: 90,
  alertMemoryThreshold: 90,
  alertDiskThreshold: 90,
  alertDiskMountPoints: ['/'],
  alertSuppressDefaultDays: 7,
  apiEnabled: true,
  apiPort: 17210,
  apiToken: '',
  historyRetentionDays: 7,
  securityMiningKeywords: ['xmrig', 'ethminer', 'nbminer'],
  securityUnownedGpuMinutes: 30,
  securityHighGpuUtilizationPercent: 90,
  securityHighGpuDurationMinutes: 120,
  password: '',
};
```

In `packages/core/src/db/settings.ts`, parse the new keys exactly like the existing flat keys:

```ts
return {
  refreshIntervalMs: parseInt(map.get('refreshIntervalMs') || '') || DEFAULT_SETTINGS.refreshIntervalMs,
  alertCpuThreshold: parseInt(map.get('alertCpuThreshold') || '') || DEFAULT_SETTINGS.alertCpuThreshold,
  alertMemoryThreshold: parseInt(map.get('alertMemoryThreshold') || '') || DEFAULT_SETTINGS.alertMemoryThreshold,
  alertDiskThreshold: parseInt(map.get('alertDiskThreshold') || '') || DEFAULT_SETTINGS.alertDiskThreshold,
  alertDiskMountPoints: map.has('alertDiskMountPoints')
    ? JSON.parse(map.get('alertDiskMountPoints')!)
    : DEFAULT_SETTINGS.alertDiskMountPoints,
  alertSuppressDefaultDays: parseInt(map.get('alertSuppressDefaultDays') || '') || DEFAULT_SETTINGS.alertSuppressDefaultDays,
  apiEnabled: map.get('apiEnabled') === 'false' ? false : DEFAULT_SETTINGS.apiEnabled,
  apiPort: parseInt(map.get('apiPort') || '') || DEFAULT_SETTINGS.apiPort,
  apiToken: map.get('apiToken') ?? DEFAULT_SETTINGS.apiToken,
  historyRetentionDays: parseInt(map.get('historyRetentionDays') || '') || DEFAULT_SETTINGS.historyRetentionDays,
  securityMiningKeywords: map.has('securityMiningKeywords')
    ? JSON.parse(map.get('securityMiningKeywords')!)
    : DEFAULT_SETTINGS.securityMiningKeywords,
  securityUnownedGpuMinutes: parseInt(map.get('securityUnownedGpuMinutes') || '') || DEFAULT_SETTINGS.securityUnownedGpuMinutes,
  securityHighGpuUtilizationPercent: parseInt(map.get('securityHighGpuUtilizationPercent') || '') || DEFAULT_SETTINGS.securityHighGpuUtilizationPercent,
  securityHighGpuDurationMinutes: parseInt(map.get('securityHighGpuDurationMinutes') || '') || DEFAULT_SETTINGS.securityHighGpuDurationMinutes,
  password: map.get('password') ?? DEFAULT_SETTINGS.password,
};
```

Update `packages/core/src/index.ts` to export the new DTOs through the existing barrel.

- [ ] **Step 4: Run the focused core tests again**

Run:
```bash
cd packages/core && pnpm test -- tests/db/settings.test.ts
```

Expected: PASS with the new defaults and array persistence verified.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/db/settings.ts packages/core/src/index.ts packages/core/tests/db/settings.test.ts
git commit -m "feat(core): add security and visibility shared types"
```

---

### Task 2: Persist audit-ready GPU rows and security events

**Files:**
- Modify: `packages/core/src/db/database.ts`
- Modify: `packages/core/src/db/gpu-usage.ts`
- Modify: `packages/core/src/agent/ingest.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/src/db/security-events.ts`
- Modify: `packages/core/tests/db/gpu-usage.test.ts`
- Test: `packages/core/tests/db/security-events.test.ts`

- [ ] **Step 1: Write the failing persistence tests**

Create `packages/core/tests/db/security-events.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  createSecurityEvent,
  findOpenSecurityEvent,
  getDatabase,
  listSecurityEvents,
  markSecurityEventSafe,
} from '../../src/index.js';

describe('security event persistence', () => {
  let dataDir: string | undefined;

  afterEach(() => {
    closeDatabase();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates, finds, resolves, and audits marked-safe events', () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmeow-security-events-'));
    getDatabase(dataDir);

    const created = createSecurityEvent({
      serverId: 'srv-1',
      eventType: 'suspicious_process',
      fingerprint: 'srv-1:suspicious_process:4321:xmrig',
      details: {
        reason: '命中关键词 xmrig',
        pid: 4321,
        user: 'root',
        command: 'xmrig --donate-level 0',
        keyword: 'xmrig',
        usedMemoryMB: 4096,
      },
      createdAt: 1_710_000_000_000,
    });

    expect(findOpenSecurityEvent('srv-1', 'suspicious_process', created.fingerprint)?.id).toBe(created.id);

    const result = markSecurityEventSafe(created.id, 'admin');

    expect(result?.resolvedEvent.resolved).toBe(true);
    expect(result?.auditEvent.eventType).toBe('marked_safe');
    expect(listSecurityEvents({ serverId: 'srv-1' })).toHaveLength(2);
    expect(listSecurityEvents({ resolved: false })).toHaveLength(0);
  });
});
```

Extend `packages/core/tests/db/gpu-usage.test.ts` with a command round-trip assertion:

```ts
it('round-trips GPU process commands', () => {
  saveGpuUsageRows('srv-1', 1_710_000_000_000, [
    {
      gpuIndex: 0,
      ownerType: 'user',
      ownerId: 'alice',
      userName: 'alice',
      pid: 222,
      command: 'python train.py',
      usedMemoryMB: 6144,
    },
  ]);

  expect(getLatestGpuUsageByServerId('srv-1')).toEqual([
    expect.objectContaining({
      pid: 222,
      command: 'python train.py',
      userName: 'alice',
      usedMemoryMB: 6144,
    }),
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd packages/core && pnpm test -- tests/db/gpu-usage.test.ts tests/db/security-events.test.ts
```

Expected: FAIL because `gpu_usage_stats` does not persist `command` and there is no `security_events` repository yet.

- [ ] **Step 3: Add the schema and persistence code**

In `packages/core/src/db/database.ts`, add the new table and indexes and backfill missing columns:

```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serverId TEXT NOT NULL,
    eventType TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    detailsJson TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    resolvedBy TEXT,
    createdAt INTEGER NOT NULL,
    resolvedAt INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_security_events_server_created_at
    ON security_events(serverId, createdAt DESC);

  CREATE INDEX IF NOT EXISTS idx_security_events_resolved_created_at
    ON security_events(resolved, createdAt DESC);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_security_events_open_fingerprint
    ON security_events(serverId, eventType, fingerprint)
    WHERE resolved = 0;

  CREATE INDEX IF NOT EXISTS idx_gpu_usage_stats_user_time
    ON gpu_usage_stats(userName, timestamp DESC);

  CREATE INDEX IF NOT EXISTS idx_gpu_usage_stats_task_time
    ON gpu_usage_stats(taskId, timestamp DESC);
`);

ensureColumns(db, 'gpu_usage_stats', [
  { name: 'command', definition: 'TEXT' },
]);
```

Create `packages/core/src/db/security-events.ts`:

```ts
import { getDatabase } from './database.js';
import type { SecurityEventDetails, SecurityEventRecord, SecurityEventType } from '../types.js';

export interface SecurityEventInput {
  serverId: string;
  eventType: SecurityEventType;
  fingerprint: string;
  details: SecurityEventDetails;
  createdAt: number;
}

export interface SecurityEventQuery {
  serverId?: string;
  resolved?: boolean;
  since?: number;
  limit?: number;
}

export function createSecurityEvent(input: SecurityEventInput): SecurityEventRecord {
  const db = getDatabase();
  const result = db.prepare(`
    INSERT INTO security_events (serverId, eventType, fingerprint, detailsJson, resolved, resolvedBy, createdAt, resolvedAt)
    VALUES (?, ?, ?, ?, 0, NULL, ?, NULL)
  `).run(
    input.serverId,
    input.eventType,
    input.fingerprint,
    JSON.stringify(input.details),
    input.createdAt,
  );

  return getSecurityEventById(Number(result.lastInsertRowid))!;
}

export function findOpenSecurityEvent(
  serverId: string,
  eventType: SecurityEventType,
  fingerprint: string,
): SecurityEventRecord | undefined {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM security_events
    WHERE serverId = ? AND eventType = ? AND fingerprint = ? AND resolved = 0
    LIMIT 1
  `).get(serverId, eventType, fingerprint);
  return row ? rowToSecurityEvent(row as Record<string, unknown>) : undefined;
}

export function listSecurityEvents(query: SecurityEventQuery = {}): SecurityEventRecord[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM security_events
    WHERE (? IS NULL OR serverId = ?)
      AND (? IS NULL OR resolved = ?)
      AND (? IS NULL OR createdAt >= ?)
    ORDER BY createdAt DESC, id DESC
    LIMIT ?
  `).all(
    query.serverId ?? null,
    query.serverId ?? null,
    query.resolved === undefined ? null : Number(query.resolved),
    query.resolved === undefined ? null : Number(query.resolved),
    query.since ?? null,
    query.since ?? null,
    query.limit ?? 200,
  ) as Record<string, unknown>[];

  return rows.map(rowToSecurityEvent);
}

export function markSecurityEventSafe(id: number, resolvedBy: string) {
  const db = getDatabase();
  const existing = getSecurityEventById(id);
  if (!existing) return undefined;

  const resolvedAt = Date.now();

  db.prepare(`
    UPDATE security_events
    SET resolved = 1, resolvedBy = ?, resolvedAt = ?
    WHERE id = ?
  `).run(resolvedBy, resolvedAt, id);

  const resolvedEvent = getSecurityEventById(id)!;
  const auditEvent = createSecurityEvent({
    serverId: existing.serverId,
    eventType: 'marked_safe',
    fingerprint: `marked_safe:${id}:${resolvedAt}`,
    details: {
      reason: '管理员标记为安全',
      targetEventId: id,
      pid: existing.details.pid,
      user: existing.details.user,
      command: existing.details.command,
      taskId: existing.details.taskId,
    },
    createdAt: resolvedAt,
  });

  db.prepare(`
    UPDATE security_events
    SET resolved = 1, resolvedBy = ?, resolvedAt = ?
    WHERE id = ?
  `).run(resolvedBy, resolvedAt, auditEvent.id);

  return { resolvedEvent, auditEvent: getSecurityEventById(auditEvent.id)! };
}
```

Update `packages/core/src/db/gpu-usage.ts` and `packages/core/src/agent/ingest.ts` so commands persist end-to-end:

```ts
export interface GpuUsageRowInput {
  gpuIndex: number;
  ownerType: GpuUsageOwnerType;
  ownerId?: string;
  userName?: string;
  taskId?: string;
  pid?: number;
  command?: string;
  usedMemoryMB: number;
  declaredVramMB?: number;
}

insertRow.run(
  currentServerId,
  currentTimestamp,
  row.gpuIndex,
  row.ownerType,
  row.ownerId ?? null,
  row.userName ?? null,
  row.taskId ?? null,
  row.pid ?? null,
  row.command ?? null,
  row.usedMemoryMB,
  row.declaredVramMB ?? null,
);
```

```ts
for (const process of allocation.userProcesses) {
  rows.push({
    gpuIndex: allocation.gpuIndex,
    ownerType: 'user',
    ownerId: process.user,
    userName: process.user,
    pid: process.pid,
    command: process.command,
    usedMemoryMB: process.usedMemoryMB,
  });
}

for (const process of allocation.unknownProcesses) {
  rows.push({
    gpuIndex: allocation.gpuIndex,
    ownerType: 'unknown',
    pid: process.pid,
    command: process.command,
    usedMemoryMB: process.usedMemoryMB,
  });
}
```

Export `createSecurityEvent`, `findOpenSecurityEvent`, `listSecurityEvents`, and `markSecurityEventSafe` from `packages/core/src/index.ts`.

- [ ] **Step 4: Run the persistence tests again**

Run:
```bash
cd packages/core && pnpm test -- tests/db/gpu-usage.test.ts tests/db/security-events.test.ts
```

Expected: PASS with command round-trips and the security-event audit flow working.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/database.ts packages/core/src/db/gpu-usage.ts packages/core/src/agent/ingest.ts packages/core/src/db/security-events.ts packages/core/src/index.ts packages/core/tests/db/gpu-usage.test.ts packages/core/tests/db/security-events.test.ts
git commit -m "feat(core): persist audit-ready gpu rows and security events"
```

---

### Task 3: Add queue and GPU aggregate read helpers

**Files:**
- Modify: `packages/core/src/db/gpu-usage.ts`
- Modify: `packages/core/src/db/agent-tasks.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/db/gpu-usage-queries.test.ts`
- Test: `packages/core/tests/db/agent-task-queue.test.ts`

- [ ] **Step 1: Write the failing aggregate-query tests**

Create `packages/core/tests/db/gpu-usage-queries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  createServer,
  getGpuOverview,
  getGpuUsageSummary,
  getGpuUsageTimelineByUser,
  getLatestUnownedGpuDurationMinutes,
  saveGpuUsageRows,
} from '../../src/index.js';

describe('gpu usage aggregate queries', () => {
  it('builds latest-overview, summary, timeline, and unowned-duration results', () => {
    const alpha = createServer({ name: 'alpha', host: 'alpha.lab', port: 22, username: 'root', privateKeyPath: '/tmp/a', sourceType: 'agent', agentId: 'agent-alpha' });
    const beta = createServer({ name: 'beta', host: 'beta.lab', port: 22, username: 'root', privateKeyPath: '/tmp/b', sourceType: 'agent', agentId: 'agent-beta' });

    saveGpuUsageRows(alpha.id, 1_710_000_000_000, [
      { gpuIndex: 0, ownerType: 'task', ownerId: 'task-1', taskId: 'task-1', usedMemoryMB: 4096, declaredVramMB: 4096 },
      { gpuIndex: 0, ownerType: 'user', ownerId: 'alice', userName: 'alice', pid: 101, command: 'python train.py', usedMemoryMB: 2048 },
    ]);
    saveGpuUsageRows(alpha.id, 1_710_000_060_000, [
      { gpuIndex: 0, ownerType: 'user', ownerId: 'alice', userName: 'alice', pid: 101, command: 'python train.py', usedMemoryMB: 3072 },
      { gpuIndex: 0, ownerType: 'unknown', pid: 404, command: 'mystery', usedMemoryMB: 1024 },
    ]);
    saveGpuUsageRows(beta.id, 1_710_000_060_000, [
      { gpuIndex: 0, ownerType: 'user', ownerId: 'bob', userName: 'bob', pid: 202, command: 'python serve.py', usedMemoryMB: 1024 },
    ]);

    const overview = getGpuOverview();
    expect(overview.users).toContainEqual(expect.objectContaining({ user: 'alice', totalVramMB: 3072 }));

    const summary = getGpuUsageSummary(24);
    expect(summary).toContainEqual(expect.objectContaining({ user: 'alice', totalVramMB: 5120 }));

    const timeline = getGpuUsageTimelineByUser('alice', 24, 60);
    expect(timeline.at(-1)).toMatchObject({ user: 'alice', totalVramMB: 5120 });

    const unownedMinutes = getLatestUnownedGpuDurationMinutes(alpha.id, 1_710_000_120_000, 90_000);
    expect(unownedMinutes).toBe(1);
  });
});
```

Create `packages/core/tests/db/agent-task-queue.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createServer, getAgentTaskQueueGroups, upsertAgentTask } from '../../src/index.js';

describe('agent task queue groups', () => {
  it('groups queued, running, and recent tasks by agent server', () => {
    const server = createServer({ name: 'alpha', host: 'alpha.lab', port: 22, username: 'root', privateKeyPath: '/tmp/a', sourceType: 'agent', agentId: 'agent-alpha' });

    upsertAgentTask({ serverId: server.id, taskId: 'q-1', status: 'queued', command: 'python a.py', createdAt: 100, priority: 1 });
    upsertAgentTask({ serverId: server.id, taskId: 'q-2', status: 'queued', command: 'python b.py', createdAt: 200, priority: 5 });
    upsertAgentTask({ serverId: server.id, taskId: 'r-1', status: 'running', command: 'python c.py', createdAt: 150, startedAt: 250, pid: 999 });
    upsertAgentTask({ serverId: server.id, taskId: 'f-1', status: 'failed', command: 'python d.py', createdAt: 50, finishedAt: 300, exitCode: 1 });

    const [group] = getAgentTaskQueueGroups();

    expect(group.serverId).toBe(server.id);
    expect(group.queued.map((task) => task.taskId)).toEqual(['q-2', 'q-1']);
    expect(group.running.map((task) => task.taskId)).toEqual(['r-1']);
    expect(group.recent.map((task) => task.taskId)).toEqual(['f-1']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd packages/core && pnpm test -- tests/db/gpu-usage-queries.test.ts tests/db/agent-task-queue.test.ts
```

Expected: FAIL because the aggregate read helpers do not exist yet.

- [ ] **Step 3: Implement the overview, timeline, window, and queue helpers**

In `packages/core/src/db/gpu-usage.ts`, add the read helpers:

```ts
export function getGpuOverview(now = Date.now()): GpuOverviewResponse {
  const db = getDatabase();
  const rows = db.prepare(`
    WITH latest_per_server AS (
      SELECT serverId, MAX(timestamp) AS timestamp
      FROM gpu_usage_stats
      GROUP BY serverId
    )
    SELECT gus.serverId, gus.userName, gus.ownerType, gus.taskId, gus.usedMemoryMB, srv.name AS serverName
    FROM gpu_usage_stats gus
    JOIN latest_per_server latest
      ON latest.serverId = gus.serverId AND latest.timestamp = gus.timestamp
    LEFT JOIN servers srv ON srv.id = gus.serverId
  `).all() as Array<{
    serverId: string;
    userName: string | null;
    ownerType: 'task' | 'user' | 'unknown';
    taskId: string | null;
    usedMemoryMB: number;
    serverName: string | null;
  }>;

  return {
    generatedAt: now,
    users: buildGpuOverviewUsers(rows),
    servers: buildGpuOverviewServers(rows),
  };
}

export function getGpuUsageSummary(hours = 168): GpuUsageSummaryItem[] {
  const db = getDatabase();
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const rows = db.prepare(`
    SELECT
      COALESCE(userName, ownerId, 'unknown') AS user,
      SUM(usedMemoryMB) AS totalVramMB,
      SUM(CASE WHEN ownerType = 'task' THEN usedMemoryMB ELSE 0 END) AS taskVramMB,
      SUM(CASE WHEN ownerType != 'task' THEN usedMemoryMB ELSE 0 END) AS nonTaskVramMB
    FROM gpu_usage_stats
    WHERE timestamp >= ?
    GROUP BY COALESCE(userName, ownerId, 'unknown')
    ORDER BY totalVramMB DESC
  `).all(cutoff) as GpuUsageSummaryItem[];

  return rows;
}

export function getGpuUsageTimelineByUser(user: string, hours = 168, bucketMinutes = 60): GpuUsageTimelinePoint[] {
  const db = getDatabase();
  const bucketMs = bucketMinutes * 60 * 1000;
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return db.prepare(`
    SELECT
      CAST(timestamp / ? AS INTEGER) * ? AS bucketStart,
      COALESCE(userName, ownerId, 'unknown') AS user,
      SUM(usedMemoryMB) AS totalVramMB,
      SUM(CASE WHEN ownerType = 'task' THEN usedMemoryMB ELSE 0 END) AS taskVramMB,
      SUM(CASE WHEN ownerType != 'task' THEN usedMemoryMB ELSE 0 END) AS nonTaskVramMB
    FROM gpu_usage_stats
    WHERE timestamp >= ?
      AND COALESCE(userName, ownerId, 'unknown') = ?
    GROUP BY bucketStart, user
    ORDER BY bucketStart ASC
  `).all(bucketMs, bucketMs, cutoff, user) as GpuUsageTimelinePoint[];
}

export function getLatestUnownedGpuDurationMinutes(
  serverId: string,
  now = Date.now(),
  maxGapMs = 90_000,
): number {
  const db = getDatabase();
  const timestamps = db.prepare(`
    SELECT DISTINCT timestamp
    FROM gpu_usage_stats
    WHERE serverId = ? AND ownerType != 'task' AND usedMemoryMB > 0 AND timestamp <= ?
    ORDER BY timestamp DESC
    LIMIT 512
  `).all(serverId, now) as Array<{ timestamp: number }>;

  if (timestamps.length === 0) return 0;

  let newest = timestamps[0].timestamp;
  let oldest = newest;

  for (const row of timestamps.slice(1)) {
    if (oldest - row.timestamp > maxGapMs) break;
    oldest = row.timestamp;
  }

  return Math.max(0, Math.round((newest - oldest) / 60_000));
}
```

In `packages/core/src/db/agent-tasks.ts`, add the grouped queue view:

```ts
const TERMINAL_STATUSES = new Set<AgentTaskStatus>(['completed', 'failed', 'cancelled']);

export function getAgentTaskQueueGroups(): AgentTaskQueueGroup[] {
  const agentServers = getAllServers().filter((server) => server.sourceType === 'agent');

  return agentServers.map((server) => {
    const tasks = getAgentTasksByServerId(server.id);
    return {
      serverId: server.id,
      serverName: server.name,
      queued: tasks
        .filter((task) => task.status === 'queued')
        .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || (right.createdAt ?? 0) - (left.createdAt ?? 0)),
      running: tasks
        .filter((task) => task.status === 'running')
        .sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0)),
      recent: tasks
        .filter((task) => TERMINAL_STATUSES.has(task.status))
        .sort((left, right) => (right.finishedAt ?? 0) - (left.finishedAt ?? 0))
        .slice(0, 20),
    };
  });
}
```

Export the new helpers from `packages/core/src/index.ts`.

- [ ] **Step 4: Run the aggregate-query tests again**

Run:
```bash
cd packages/core && pnpm test -- tests/db/gpu-usage-queries.test.ts tests/db/agent-task-queue.test.ts
```

Expected: PASS with stable queue grouping and GPU aggregate data.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/gpu-usage.ts packages/core/src/db/agent-tasks.ts packages/core/src/index.ts packages/core/tests/db/gpu-usage-queries.test.ts packages/core/tests/db/agent-task-queue.test.ts
git commit -m "feat(core): add task queue and gpu aggregate queries"
```

---

### Task 4: Build process audit rows and the default V2 security analyzer

**Files:**
- Create: `packages/core/src/security/audit.ts`
- Create: `packages/core/src/security/analyzer.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/security/audit.test.ts`
- Test: `packages/core/tests/security/analyzer.test.ts`

- [ ] **Step 1: Write the failing audit/analyzer tests**

Create `packages/core/tests/security/audit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildProcessAuditRows } from '../../src/security/audit.js';
import type { MetricsSnapshot, StoredGpuUsageRow } from '../../src/index.js';

describe('buildProcessAuditRows', () => {
  it('creates synthetic GPU rows and annotates suspicious reasons', () => {
    const snapshot = {
      serverId: 'srv-1',
      timestamp: 1_710_000_000_000,
      cpu: { usagePercent: 0, coreCount: 1, modelName: 'cpu', frequencyMhz: 0, perCoreUsage: [0] },
      memory: { totalMB: 1, usedMB: 1, availableMB: 0, usagePercent: 0, swapTotalMB: 0, swapUsedMB: 0, swapPercent: 0 },
      disk: { disks: [], ioReadKBs: 0, ioWriteKBs: 0 },
      network: { rxBytesPerSec: 0, txBytesPerSec: 0, interfaces: [] },
      gpu: { available: true, totalMemoryMB: 8192, usedMemoryMB: 4096, memoryUsagePercent: 50, utilizationPercent: 95, temperatureC: 60, gpuCount: 1 },
      processes: [],
      docker: [],
      system: { hostname: 'alpha', uptime: '1h', loadAvg1: 0, loadAvg5: 0, loadAvg15: 0, kernelVersion: '6.1' },
    } satisfies MetricsSnapshot;

    const gpuRows = [
      {
        id: 1,
        serverId: 'srv-1',
        timestamp: 1_710_000_000_000,
        gpuIndex: 0,
        ownerType: 'user',
        ownerId: 'root',
        userName: 'root',
        pid: 4321,
        command: 'xmrig --donate-level 0',
        usedMemoryMB: 4096,
      },
    ] satisfies StoredGpuUsageRow[];

    const rows = buildProcessAuditRows(snapshot, gpuRows, {
      securityMiningKeywords: ['xmrig'],
      unownedGpuMinutes: 45,
      hasRunningPmeowTasks: false,
    });

    expect(rows).toContainEqual(expect.objectContaining({
      pid: 4321,
      gpuMemoryMB: 4096,
      ownerType: 'user',
      suspiciousReasons: ['命中关键词 xmrig', '无主 GPU 占用 45 分钟'],
    }));
  });
});
```

Create `packages/core/tests/security/analyzer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { analyzeSecuritySnapshot, buildSecurityFingerprint } from '../../src/security/analyzer.js';

describe('analyzeSecuritySnapshot', () => {
  it('emits stable suspicious-process and unowned-gpu findings', () => {
    const findings = analyzeSecuritySnapshot({
      snapshot: { serverId: 'srv-1', timestamp: 1_710_000_000_000 } as any,
      auditRows: [
        {
          pid: 4321,
          user: 'root',
          command: 'xmrig --donate-level 0',
          cpuPercent: 0,
          memPercent: 0,
          rss: 0,
          gpuMemoryMB: 4096,
          ownerType: 'user',
          suspiciousReasons: ['命中关键词 xmrig', '无主 GPU 占用 45 分钟'],
        },
      ],
    });

    expect(findings.map((finding) => finding.eventType)).toEqual(['suspicious_process', 'unowned_gpu']);
    expect(findings[0].fingerprint).toBe(buildSecurityFingerprint('srv-1', 'suspicious_process', findings[0].details));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd packages/core && pnpm test -- tests/security/audit.test.ts tests/security/analyzer.test.ts
```

Expected: FAIL because the audit/analyzer modules do not exist yet.

- [ ] **Step 3: Implement the audit join and analyzer**

Create `packages/core/src/security/audit.ts`:

```ts
import type { AppSettings, MetricsSnapshot, ProcessAuditRow, StoredGpuUsageRow } from '../types.js';

interface BuildProcessAuditOptions {
  securityMiningKeywords: AppSettings['securityMiningKeywords'];
  unownedGpuMinutes: number;
  hasRunningPmeowTasks: boolean;
}

export function buildProcessAuditRows(
  snapshot: MetricsSnapshot,
  gpuRows: StoredGpuUsageRow[],
  options: BuildProcessAuditOptions,
): ProcessAuditRow[] {
  const rows = new Map<number, ProcessAuditRow>();

  for (const process of snapshot.processes) {
    rows.set(process.pid, {
      ...process,
      gpuMemoryMB: 0,
      ownerType: 'none',
      taskId: null,
      suspiciousReasons: [],
    });
  }

  for (const gpuRow of gpuRows) {
    if (!gpuRow.pid) continue;

    const current = rows.get(gpuRow.pid) ?? {
      pid: gpuRow.pid,
      user: gpuRow.userName ?? 'unknown',
      command: gpuRow.command ?? '',
      cpuPercent: 0,
      memPercent: 0,
      rss: 0,
      gpuMemoryMB: 0,
      ownerType: 'none',
      taskId: null,
      suspiciousReasons: [],
    };

    current.gpuMemoryMB += gpuRow.usedMemoryMB;
    current.command = current.command || gpuRow.command || '';
    current.user = current.user || gpuRow.userName || 'unknown';

    if (gpuRow.ownerType === 'task') {
      current.ownerType = 'task';
      current.taskId = gpuRow.taskId ?? null;
    } else if (current.ownerType !== 'task') {
      current.ownerType = gpuRow.ownerType;
    }

    rows.set(gpuRow.pid, current);
  }

  const keywords = options.securityMiningKeywords.map((keyword) => keyword.toLowerCase());

  return Array.from(rows.values())
    .map((row) => {
      const reasons: string[] = [];
      const commandLower = row.command.toLowerCase();
      const matchedKeyword = keywords.find((keyword) => commandLower.includes(keyword));

      if (matchedKeyword) reasons.push(`命中关键词 ${matchedKeyword}`);
      if (!options.hasRunningPmeowTasks && row.ownerType !== 'task' && row.gpuMemoryMB > 0 && options.unownedGpuMinutes > 0) {
        reasons.push(`无主 GPU 占用 ${options.unownedGpuMinutes} 分钟`);
      }

      return { ...row, suspiciousReasons: reasons };
    })
    .sort((left, right) => right.gpuMemoryMB - left.gpuMemoryMB || right.cpuPercent - left.cpuPercent);
}
```

Create `packages/core/src/security/analyzer.ts`:

```ts
import type { ProcessAuditRow, SecurityEventDetails, SecurityEventType } from '../types.js';
import type { SecurityEventInput } from '../db/security-events.js';

export function buildSecurityFingerprint(
  serverId: string,
  eventType: SecurityEventType,
  details: SecurityEventDetails,
): string {
  return [
    serverId,
    eventType,
    details.pid ?? 'no-pid',
    details.keyword ?? 'no-keyword',
    details.taskId ?? 'no-task',
    details.reason,
  ].join(':');
}

export function analyzeSecuritySnapshot(input: {
  snapshot: { serverId: string; timestamp: number };
  auditRows: ProcessAuditRow[];
}): SecurityEventInput[] {
  return input.auditRows.flatMap((row) => {
    return row.suspiciousReasons.map((reason) => {
      const eventType: SecurityEventType = reason.startsWith('命中关键词') ? 'suspicious_process' : 'unowned_gpu';
      const keyword = eventType === 'suspicious_process' ? reason.replace('命中关键词 ', '') : undefined;
      const details = {
        reason,
        pid: row.pid,
        user: row.user,
        command: row.command,
        taskId: row.taskId,
        keyword,
        usedMemoryMB: row.gpuMemoryMB,
      };

      return {
        serverId: input.snapshot.serverId,
        eventType,
        fingerprint: buildSecurityFingerprint(input.snapshot.serverId, eventType, details),
        details,
        createdAt: input.snapshot.timestamp,
      };
    });
  });
}
```

Export both helpers from `packages/core/src/index.ts`.

- [ ] **Step 4: Run the audit/analyzer tests again**

Run:
```bash
cd packages/core && pnpm test -- tests/security/audit.test.ts tests/security/analyzer.test.ts
```

Expected: PASS with synthetic GPU rows and stable security fingerprints.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/security/audit.ts packages/core/src/security/analyzer.ts packages/core/src/index.ts packages/core/tests/security/audit.test.ts packages/core/tests/security/analyzer.test.ts
git commit -m "feat(core): add process audit and security analyzer"
```

---

### Task 5: Wire the security pipeline into core runtime flow

**Files:**
- Create: `packages/core/src/security/pipeline.ts`
- Modify: `packages/core/src/scheduler.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/security/pipeline.test.ts`

- [ ] **Step 1: Write the failing pipeline test**

Create `packages/core/tests/security/pipeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  createServer,
  getSettings,
  listSecurityEvents,
  processSecuritySnapshot,
  saveGpuUsageRows,
  saveMetrics,
  upsertAgentTask,
} from '../../src/index.js';

describe('processSecuritySnapshot', () => {
  it('persists deduped security events and ignores repeated snapshots', () => {
    const server = createServer({ name: 'alpha', host: 'alpha.lab', port: 22, username: 'root', privateKeyPath: '/tmp/a', sourceType: 'agent', agentId: 'agent-alpha' });

    saveMetrics({
      serverId: server.id,
      timestamp: 1_710_000_000_000,
      cpu: { usagePercent: 0, coreCount: 1, modelName: 'cpu', frequencyMhz: 0, perCoreUsage: [0] },
      memory: { totalMB: 1, usedMB: 1, availableMB: 0, usagePercent: 0, swapTotalMB: 0, swapUsedMB: 0, swapPercent: 0 },
      disk: { disks: [], ioReadKBs: 0, ioWriteKBs: 0 },
      network: { rxBytesPerSec: 0, txBytesPerSec: 0, interfaces: [] },
      gpu: { available: true, totalMemoryMB: 8192, usedMemoryMB: 4096, memoryUsagePercent: 50, utilizationPercent: 95, temperatureC: 60, gpuCount: 1 },
      processes: [],
      docker: [],
      system: { hostname: 'alpha', uptime: '1h', loadAvg1: 0, loadAvg5: 0, loadAvg15: 0, kernelVersion: '6.1' },
    });

    saveGpuUsageRows(server.id, 1_710_000_000_000, [
      { gpuIndex: 0, ownerType: 'unknown', pid: 1234, command: 'xmrig', usedMemoryMB: 4096 },
    ]);
    saveGpuUsageRows(server.id, 1_710_000_060_000, [
      { gpuIndex: 0, ownerType: 'unknown', pid: 1234, command: 'xmrig', usedMemoryMB: 4096 },
    ]);

    upsertAgentTask({ serverId: server.id, taskId: 'task-1', status: 'completed', finishedAt: 1_709_999_999_000 });

    const settings = getSettings();
    const created = processSecuritySnapshot(server.id, settings, 1_710_000_120_000);
    const repeated = processSecuritySnapshot(server.id, settings, 1_710_000_180_000);

    expect(created).toHaveLength(2);
    expect(repeated).toHaveLength(0);
    expect(listSecurityEvents({ resolved: false })).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd packages/core && pnpm test -- tests/security/pipeline.test.ts
```

Expected: FAIL because the security pipeline does not exist and `Scheduler` does not emit security events yet.

- [ ] **Step 3: Implement the pipeline and scheduler hook-up**

Create `packages/core/src/security/pipeline.ts`:

```ts
import { getAgentTasksByServerId } from '../db/agent-tasks.js';
import { findOpenSecurityEvent, createSecurityEvent } from '../db/security-events.js';
import { getLatestGpuUsageByServerId, getLatestUnownedGpuDurationMinutes } from '../db/gpu-usage.js';
import { getLatestMetrics } from '../db/metrics.js';
import { buildProcessAuditRows } from './audit.js';
import { analyzeSecuritySnapshot } from './analyzer.js';
import type { AppSettings, SecurityEventRecord } from '../types.js';

export function processSecuritySnapshot(
  serverId: string,
  settings: AppSettings,
  now = Date.now(),
): SecurityEventRecord[] {
  const snapshot = getLatestMetrics(serverId);
  if (!snapshot?.gpu.available) return [];

  const gpuRows = getLatestGpuUsageByServerId(serverId);
  const runningTasks = getAgentTasksByServerId(serverId).filter((task) => task.status === 'running');
  const unownedGpuMinutes = getLatestUnownedGpuDurationMinutes(
    serverId,
    now,
    Math.max(settings.refreshIntervalMs * 2, 90_000),
  );

  const auditRows = buildProcessAuditRows(snapshot, gpuRows, {
    securityMiningKeywords: settings.securityMiningKeywords,
    unownedGpuMinutes,
    hasRunningPmeowTasks: runningTasks.length > 0,
  });

  return analyzeSecuritySnapshot({ snapshot, auditRows }).flatMap((finding) => {
    if (findOpenSecurityEvent(serverId, finding.eventType, finding.fingerprint)) {
      return [];
    }
    return [createSecurityEvent(finding)];
  });
}
```

Update `packages/core/src/types.ts` so `CoreEvents` includes the new event:

```ts
export interface CoreEvents {
  metricsUpdate: (data: MetricsSnapshot) => void;
  serverStatus: (status: ServerStatus) => void;
  alert: (alert: AlertEvent) => void;
  hookTriggered: (log: HookLog) => void;
  notify: (title: string, body: string) => void;
  securityEvent: (event: SecurityEventRecord) => void;
}
```

Then update `packages/core/src/scheduler.ts`:

```ts
import { cleanOldGpuUsage } from './db/gpu-usage.js';
import { processSecuritySnapshot } from './security/pipeline.js';

this.cleanupTimerId = setInterval(() => {
  const s = getSettings();
  cleanOldMetrics(s.historyRetentionDays);
  cleanOldGpuUsage(s.historyRetentionDays);
}, 60 * 60 * 1000);
```

```ts
const settings = getSettings();
const server = getServerById(serverId);
if (server) {
  checkAlerts(snapshot, settings, server);

  for (const securityEvent of processSecuritySnapshot(serverId, settings)) {
    this.emit('securityEvent', securityEvent);
  }
}
```

Export `processSecuritySnapshot` from `packages/core/src/index.ts`.

- [ ] **Step 4: Run the focused core pipeline test again**

Run:
```bash
cd packages/core && pnpm test -- tests/security/pipeline.test.ts
```

Expected: PASS and repeated samples do not create duplicate unresolved events.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/security/pipeline.ts packages/core/src/scheduler.ts packages/core/src/types.ts packages/core/src/index.ts packages/core/tests/security/pipeline.test.ts
git commit -m "feat(core): emit security events from scheduler pipeline"
```

---

### Task 6: Expose operator APIs and realtime fanout in web runtime

**Files:**
- Create: `packages/web/src/operator-routes.ts`
- Modify: `packages/web/src/handlers.ts`
- Modify: `packages/web/src/agent-namespace.ts`
- Modify: `packages/web/src/app.ts`
- Test: `packages/web/tests/operator-routes.test.ts`
- Test: `packages/web/tests/operator-realtime.test.ts`

- [ ] **Step 1: Write the failing web route and realtime tests**

Create `packages/web/tests/operator-routes.test.ts`:

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { signToken } from '../src/auth.js';
import { createWebRuntime } from '../src/app.js';

describe('operator routes', () => {
  it('serves task queue, gpu overview, process audit, and security events', async () => {
    const runtime = createWebRuntime();
    const token = signToken({ role: 'admin' });

    const taskQueue = await request(runtime.app)
      .get('/api/task-queue')
      .set('Authorization', `Bearer ${token}`);

    const gpuOverview = await request(runtime.app)
      .get('/api/gpu-overview')
      .set('Authorization', `Bearer ${token}`);

    const securityEvents = await request(runtime.app)
      .get('/api/security/events?resolved=false&hours=168')
      .set('Authorization', `Bearer ${token}`);

    expect(taskQueue.status).toBe(200);
    expect(Array.isArray(taskQueue.body)).toBe(true);
    expect(gpuOverview.status).toBe(200);
    expect(gpuOverview.body).toHaveProperty('users');
    expect(securityEvents.status).toBe(200);
    expect(Array.isArray(securityEvents.body)).toBe(true);

    await runtime.stop();
  });
});
```

Create `packages/web/tests/operator-realtime.test.ts`:

```ts
import { io as createClient } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer as createCoreServer } from '@monitor/core';
import { signToken } from '../src/auth.js';
import { createWebRuntime } from '../src/app.js';

describe('operator realtime fanout', () => {
  const clients: Array<ReturnType<typeof createClient>> = [];
  let runtime: ReturnType<typeof createWebRuntime> | undefined;

  afterEach(async () => {
    clients.forEach((client) => client.close());
    await runtime?.stop();
  });

  it('broadcasts task updates and security events to authenticated ui clients', async () => {
    createCoreServer({ name: 'alpha', host: 'alpha.lab', port: 22, username: 'root', privateKeyPath: '/tmp/a', sourceType: 'agent', agentId: 'agent-alpha' });
    runtime = createWebRuntime({ port: 0 });
    const port = await runtime.start(0);
    const token = signToken({ role: 'admin' });

    const uiClient = createClient(`http://127.0.0.1:${port}`, { auth: { token } });
    const agentClient = createClient(`http://127.0.0.1:${port}/agent`);
    clients.push(uiClient, agentClient);

    const taskPromise = new Promise((resolve) => uiClient.on('taskUpdate', resolve));
    const securityPromise = new Promise((resolve) => uiClient.on('securityEvent', resolve));

    runtime.scheduler.emit('securityEvent', { id: 1, serverId: 'srv-1', eventType: 'suspicious_process', fingerprint: 'fp', details: { reason: '命中关键词 xmrig' }, resolved: false, resolvedBy: null, createdAt: Date.now(), resolvedAt: null });
    agentClient.emit('agent:register', { agentId: 'agent-alpha', hostname: 'alpha.lab', version: '1.0.0' });
    agentClient.emit('agent:taskUpdate', { taskId: 'task-1', status: 'running', command: 'python train.py' });

    expect(await securityPromise).toMatchObject({ eventType: 'suspicious_process' });
    expect(await taskPromise).toMatchObject({ taskId: 'task-1' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd packages/web && pnpm test -- tests/operator-routes.test.ts tests/operator-realtime.test.ts
```

Expected: FAIL because the new routes and fanout hooks do not exist yet.

- [ ] **Step 3: Add the operator routes and wire the realtime events**

Create `packages/web/src/operator-routes.ts`:

```ts
import {
  getAgentTaskQueueGroups,
  getGpuOverview,
  getGpuUsageSummary,
  getGpuUsageTimelineByUser,
  getLatestMetrics,
  listSecurityEvents,
  markSecurityEventSafe,
  buildProcessAuditRows,
  getLatestGpuUsageByServerId,
  getSettings,
  getAgentTasksByServerId,
} from '@monitor/core';
import type { Express, Request, Response } from 'express';
import type { Namespace } from 'socket.io';

export function setupOperatorRoutes(app: Express, uiNamespace: Namespace): void {
  app.get('/api/task-queue', (_req, res) => {
    res.json(getAgentTaskQueueGroups());
  });

  app.get('/api/gpu-overview', (_req, res) => {
    res.json(getGpuOverview());
  });

  app.get('/api/gpu-usage/summary', (req, res) => {
    const hours = Number(req.query.hours) || 168;
    res.json(getGpuUsageSummary(hours));
  });

  app.get('/api/gpu-usage/by-user', (req, res) => {
    const user = String(req.query.user || '');
    if (!user) return res.status(400).json({ error: '缺少 user 参数' });
    const hours = Number(req.query.hours) || 168;
    res.json(getGpuUsageTimelineByUser(user, hours));
  });

  app.get('/api/servers/:id/process-audit', (req: Request, res: Response) => {
    const snapshot = getLatestMetrics(req.params.id);
    if (!snapshot) return res.json([]);

    const settings = getSettings();
    const auditRows = buildProcessAuditRows(snapshot, getLatestGpuUsageByServerId(req.params.id), {
      securityMiningKeywords: settings.securityMiningKeywords,
      unownedGpuMinutes: 0,
      hasRunningPmeowTasks: getAgentTasksByServerId(req.params.id).some((task) => task.status === 'running'),
    });

    res.json(auditRows);
  });

  app.get('/api/security/events', (req, res) => {
    const hours = Number(req.query.hours) || 168;
    const since = Date.now() - hours * 60 * 60 * 1000;
    const resolved = req.query.resolved === undefined ? undefined : req.query.resolved === 'true';
    const serverId = typeof req.query.serverId === 'string' ? req.query.serverId : undefined;
    res.json(listSecurityEvents({ serverId, resolved, since, limit: 500 }));
  });

  app.post('/api/security/events/:id/mark-safe', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效事件 ID' });

    const actor = String((req as any).user?.role ?? 'admin');
    const result = markSecurityEventSafe(id, actor);
    if (!result) return res.status(404).json({ error: '事件不存在' });

    uiNamespace.emit('securityEvent', result.resolvedEvent);
    uiNamespace.emit('securityEvent', result.auditEvent);
    res.json(result);
  });
}
```

Update `packages/web/src/handlers.ts` to forward the new scheduler event:

```ts
scheduler.on('securityEvent', (event) => {
  io.emit('securityEvent', event);
});
```

Update `packages/web/src/agent-namespace.ts` so normalized task updates reach the UI namespace:

```ts
export interface CreateAgentNamespaceOptions {
  heartbeatTimeoutMs?: number;
  sweepIntervalMs?: number;
  now?: () => number;
  onTaskUpdate?: (task: AgentTaskUpdatePayload) => void;
}
```

```ts
ingestAgentTaskUpdate(update);
options.onTaskUpdate?.(update);
```

Update `packages/web/src/app.ts` to mount the routes and connect the callback:

```ts
import { setupOperatorRoutes } from './operator-routes.js';

const uiNamespace = io.of('/');
const agentNamespace = createAgentNamespace(io, scheduler, {
  ...options.agentNamespace,
  onTaskUpdate: (update) => {
    uiNamespace.emit('taskUpdate', update);
  },
});

setupRestRoutes(app, scheduler);
setupAgentReadRoutes(app, {
  scheduler,
  agentRegistry: agentNamespace.registry,
});
setupOperatorRoutes(app, uiNamespace);
```

- [ ] **Step 4: Run the focused web tests again**

Run:
```bash
cd packages/web && pnpm test -- tests/operator-routes.test.ts tests/operator-realtime.test.ts
```

Expected: PASS with authenticated operator routes and UI fanout working.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/operator-routes.ts packages/web/src/handlers.ts packages/web/src/agent-namespace.ts packages/web/src/app.ts packages/web/tests/operator-routes.test.ts packages/web/tests/operator-realtime.test.ts
git commit -m "feat(web): add operator apis and realtime fanout"
```

---

### Task 7: Add UI test harness and operator-data transport/bootstrap

**Files:**
- Modify: `packages/ui/package.json`
- Create: `packages/ui/vitest.config.ts`
- Create: `packages/ui/tests/setup.ts`
- Modify: `packages/ui/src/transport/types.ts`
- Modify: `packages/ui/src/transport/ws-adapter.ts`
- Modify: `packages/ui/src/transport/TransportProvider.tsx`
- Modify: `packages/ui/src/store/useStore.ts`
- Create: `packages/ui/src/hooks/useOperatorData.ts`
- Test: `packages/ui/tests/operator-bootstrap.test.tsx`

- [ ] **Step 1: Write the failing UI bootstrap test**

Create `packages/ui/tests/operator-bootstrap.test.tsx`:

```tsx
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TransportProvider } from '../src/transport/TransportProvider.js';
import { useOperatorBootstrap } from '../src/hooks/useOperatorData.js';
import { useStore } from '../src/store/useStore.js';

function Probe() {
  useOperatorBootstrap();
  const { taskQueueGroups, openSecurityEvents } = useStore();
  return <div>{taskQueueGroups.length}:{openSecurityEvents.length}</div>;
}

describe('useOperatorBootstrap', () => {
  it('loads queue groups and unresolved security events', async () => {
    const adapter = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      onMetricsUpdate: vi.fn(() => () => {}),
      onServerStatus: vi.fn(() => () => {}),
      onAlert: vi.fn(() => () => {}),
      onHookTriggered: vi.fn(() => () => {}),
      onNotify: vi.fn(() => () => {}),
      onTaskUpdate: vi.fn(() => () => {}),
      onSecurityEvent: vi.fn(() => () => {}),
      getServers: vi.fn(async () => []),
      getServerStatuses: vi.fn(async () => []),
      getHooks: vi.fn(async () => []),
      getSettings: vi.fn(async () => ({ refreshIntervalMs: 5000 })),
      getTaskQueue: vi.fn(async () => [{ serverId: 'srv-1', serverName: 'alpha', queued: [], running: [], recent: [] }]),
      getSecurityEvents: vi.fn(async () => [{ id: 1, serverId: 'srv-1', eventType: 'suspicious_process', fingerprint: 'fp', details: { reason: '命中关键词 xmrig' }, resolved: false, resolvedBy: null, createdAt: 1, resolvedAt: null }]),
    } as any;

    render(
      <TransportProvider adapter={adapter}>
        <MemoryRouter>
          <Probe />
        </MemoryRouter>
      </TransportProvider>,
    );

    await waitFor(() => expect(screen.getByText('1:1')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Add the UI test dependencies and verify the test fails**

Update `packages/ui/package.json`:

```json
{
  "scripts": {
    "build": "vite build",
    "dev": "vite",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.2.0",
    "@testing-library/user-event": "^14.6.1",
    "jsdom": "^26.0.0",
    "vitest": "^4.1.2"
  }
}
```

Then run:
```bash
pnpm install
cd packages/ui && pnpm test -- tests/operator-bootstrap.test.tsx
```

Expected: FAIL because `TransportProvider` cannot inject a mock adapter yet and the operator hook/store do not exist.

- [ ] **Step 3: Implement the transport/store/bootstrap surface**

Create `packages/ui/vitest.config.ts` and `packages/ui/tests/setup.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
});
```

```ts
import '@testing-library/jest-dom/vitest';
```

Extend `packages/ui/src/transport/types.ts`:

```ts
import type {
  AgentTaskQueueGroup,
  GpuOverviewResponse,
  GpuUsageSummaryItem,
  GpuUsageTimelinePoint,
  MirroredAgentTaskRecord,
  ProcessAuditRow,
  SecurityEventRecord,
} from '@monitor/core';

export interface SecurityEventQuery {
  serverId?: string;
  resolved?: boolean;
  hours?: number;
}

export interface TransportAdapter {
  connect(): void;
  disconnect(): void;
  onMetricsUpdate(cb: (data: MetricsSnapshot) => void): () => void;
  onServerStatus(cb: (status: ServerStatus) => void): () => void;
  onAlert(cb: (alert: AlertEvent) => void): () => void;
  onHookTriggered(cb: (log: HookLog) => void): () => void;
  onNotify(cb: (title: string, body: string) => void): () => void;
  onTaskUpdate(cb: (task: MirroredAgentTaskRecord) => void): () => void;
  onSecurityEvent(cb: (event: SecurityEventRecord) => void): () => void;
  getTaskQueue(): Promise<AgentTaskQueueGroup[]>;
  getProcessAudit(serverId: string): Promise<ProcessAuditRow[]>;
  getSecurityEvents(query?: SecurityEventQuery): Promise<SecurityEventRecord[]>;
  markSecurityEventSafe(id: number): Promise<void>;
  getGpuOverview(): Promise<GpuOverviewResponse>;
  getGpuUsageSummary(hours?: number): Promise<GpuUsageSummaryItem[]>;
  getGpuUsageByUser(user: string, hours?: number): Promise<GpuUsageTimelinePoint[]>;
  cancelTask(serverId: string, taskId: string): Promise<void>;
  setTaskPriority(serverId: string, taskId: string, priority: number): Promise<void>;
  pauseQueue(serverId: string): Promise<void>;
  resumeQueue(serverId: string): Promise<void>;
}
```

Update `packages/ui/src/transport/TransportProvider.tsx` so tests can inject an adapter:

```tsx
export function TransportProvider({
  children,
  adapter,
}: {
  children: React.ReactNode;
  adapter?: TransportAdapter;
}) {
  const [transport] = useState<TransportAdapter>(() => adapter ?? new WebSocketAdapter());
  useEffect(() => {
    transport.connect();
    return () => transport.disconnect();
  }, [transport]);

  return <TransportContext.Provider value={transport}>{children}</TransportContext.Provider>;
}
```

Implement the new REST calls and subscriptions in `packages/ui/src/transport/ws-adapter.ts` with concrete methods:

```ts
onTaskUpdate(cb: (task: MirroredAgentTaskRecord) => void): () => void {
  this.socket?.on('taskUpdate', cb);
  return () => {
    this.socket?.off('taskUpdate', cb);
  };
}

onSecurityEvent(cb: (event: SecurityEventRecord) => void): () => void {
  this.socket?.on('securityEvent', cb);
  return () => {
    this.socket?.off('securityEvent', cb);
  };
}

async getTaskQueue(): Promise<AgentTaskQueueGroup[]> {
  return this.fetch('/api/task-queue');
}

async getProcessAudit(serverId: string): Promise<ProcessAuditRow[]> {
  return this.fetch(`/api/servers/${serverId}/process-audit`);
}

async getSecurityEvents(query: SecurityEventQuery = {}): Promise<SecurityEventRecord[]> {
  const params = new URLSearchParams();
  if (query.serverId) params.set('serverId', query.serverId);
  if (query.resolved !== undefined) params.set('resolved', String(query.resolved));
  if (query.hours !== undefined) params.set('hours', String(query.hours));
  return this.fetch(`/api/security/events?${params.toString()}`);
}

async markSecurityEventSafe(id: number): Promise<void> {
  await this.fetch(`/api/security/events/${id}/mark-safe`, { method: 'POST' });
}

async getGpuOverview(): Promise<GpuOverviewResponse> {
  return this.fetch('/api/gpu-overview');
}

async getGpuUsageSummary(hours = 168): Promise<GpuUsageSummaryItem[]> {
  return this.fetch(`/api/gpu-usage/summary?hours=${hours}`);
}

async getGpuUsageByUser(user: string, hours = 168): Promise<GpuUsageTimelinePoint[]> {
  return this.fetch(`/api/gpu-usage/by-user?user=${encodeURIComponent(user)}&hours=${hours}`);
}

async cancelTask(serverId: string, taskId: string): Promise<void> {
  await this.fetch(`/api/servers/${serverId}/tasks/${taskId}/cancel`, { method: 'POST' });
}

async setTaskPriority(serverId: string, taskId: string, priority: number): Promise<void> {
  await this.fetch(`/api/servers/${serverId}/tasks/${taskId}/priority`, {
    method: 'POST',
    body: JSON.stringify({ priority }),
  });
}

async pauseQueue(serverId: string): Promise<void> {
  await this.fetch(`/api/servers/${serverId}/queue/pause`, { method: 'POST' });
}

async resumeQueue(serverId: string): Promise<void> {
  await this.fetch(`/api/servers/${serverId}/queue/resume`, { method: 'POST' });
}
```

Update `packages/ui/src/store/useStore.ts` with shell-wide operator state:

```ts
interface AppState {
  taskQueueGroups: AgentTaskQueueGroup[];
  setTaskQueueGroups: (groups: AgentTaskQueueGroup[]) => void;
  openSecurityEvents: SecurityEventRecord[];
  setOpenSecurityEvents: (events: SecurityEventRecord[]) => void;
}

taskQueueGroups: [],
setTaskQueueGroups: (taskQueueGroups) => set({ taskQueueGroups }),
openSecurityEvents: [],
setOpenSecurityEvents: (openSecurityEvents) => set({ openSecurityEvents }),
```

Create `packages/ui/src/hooks/useOperatorData.ts`:

```tsx
import { useEffect } from 'react';
import { useTransport } from '../transport/TransportProvider.js';
import { useStore } from '../store/useStore.js';

function createDebouncedAsync(fn: () => Promise<void>, delayMs: number) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = null;
      void fn();
    }, delayMs);
  };
}

export function useOperatorBootstrap() {
  const transport = useTransport();
  const { setTaskQueueGroups, setOpenSecurityEvents } = useStore();

  useEffect(() => {
    const loadTaskQueue = async () => setTaskQueueGroups(await transport.getTaskQueue());
    const loadOpenSecurity = async () => setOpenSecurityEvents(await transport.getSecurityEvents({ resolved: false, hours: 168 }));

    void Promise.all([loadTaskQueue(), loadOpenSecurity()]);

    const refreshTaskQueue = createDebouncedAsync(loadTaskQueue, 250);
    const refreshOpenSecurity = createDebouncedAsync(loadOpenSecurity, 250);

    const unsubs = [
      transport.onTaskUpdate(() => refreshTaskQueue()),
      transport.onSecurityEvent(() => refreshOpenSecurity()),
    ];

    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [transport, setTaskQueueGroups, setOpenSecurityEvents]);
}
```

Implement the new REST calls and subscriptions in `packages/ui/src/transport/ws-adapter.ts` using the web routes from Task 6.

- [ ] **Step 4: Run the focused UI bootstrap test again**

Run:
```bash
cd packages/ui && pnpm test -- tests/operator-bootstrap.test.tsx
```

Expected: PASS and the hook loads task/security data via the injected adapter.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/package.json packages/ui/vitest.config.ts packages/ui/tests/setup.ts packages/ui/src/transport/types.ts packages/ui/src/transport/ws-adapter.ts packages/ui/src/transport/TransportProvider.tsx packages/ui/src/store/useStore.ts packages/ui/src/hooks/useOperatorData.ts packages/ui/tests/operator-bootstrap.test.tsx pnpm-lock.yaml
git commit -m "feat(ui): add operator data bootstrap and ui test harness"
```

---

### Task 8: Enhance Overview, Server Detail, Server Card, Process Table, and Settings

**Files:**
- Create: `packages/ui/src/components/GpuOverviewCard.tsx`
- Create: `packages/ui/src/components/GpuAllocationBars.tsx`
- Modify: `packages/ui/src/components/ServerCard.tsx`
- Modify: `packages/ui/src/components/ProcessTable.tsx`
- Modify: `packages/ui/src/pages/Overview.tsx`
- Modify: `packages/ui/src/pages/ServerDetail.tsx`
- Modify: `packages/ui/src/pages/Settings.tsx`
- Test: `packages/ui/tests/overview-detail-settings.test.tsx`

- [ ] **Step 1: Write the failing component/page test**

Create `packages/ui/tests/overview-detail-settings.test.tsx`:

```tsx
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Overview } from '../src/pages/Overview.js';
import { ServerDetail } from '../src/pages/ServerDetail.js';
import { Settings } from '../src/pages/Settings.js';
import { TransportProvider } from '../src/transport/TransportProvider.js';
import { useStore } from '../src/store/useStore.js';

describe('operator surface enhancements', () => {
  it('renders gpu overview, security badge, and audit-backed detail tabs', () => {
    useStore.setState({
      servers: [{ id: 'srv-1', name: 'alpha', host: 'alpha.lab', port: 22, username: 'root', privateKeyPath: '/tmp/a', sourceType: 'agent', agentId: 'agent-alpha', createdAt: 1, updatedAt: 1 }],
      taskQueueGroups: [{ serverId: 'srv-1', serverName: 'alpha', queued: [{ serverId: 'srv-1', taskId: 'q-1', status: 'queued', command: 'python train.py' }], running: [], recent: [] }],
      openSecurityEvents: [{ id: 1, serverId: 'srv-1', eventType: 'suspicious_process', fingerprint: 'fp', details: { reason: '命中关键词 xmrig' }, resolved: false, resolvedBy: null, createdAt: 1, resolvedAt: null }],
    } as any);

    const adapter = {
      connect() {},
      disconnect() {},
      onMetricsUpdate: () => () => {},
      onServerStatus: () => () => {},
      onAlert: () => () => {},
      onHookTriggered: () => () => {},
      onNotify: () => () => {},
      onTaskUpdate: () => () => {},
      onSecurityEvent: () => () => {},
      getServers: async () => [],
      getServerStatuses: async () => [],
      getHooks: async () => [],
      getSettings: async () => ({ refreshIntervalMs: 5000, historyRetentionDays: 7, alertCpuThreshold: 90, alertMemoryThreshold: 90, alertDiskThreshold: 90, alertDiskMountPoints: ['/'], alertSuppressDefaultDays: 7, apiEnabled: true, apiPort: 17210, apiToken: '', securityMiningKeywords: ['xmrig'], securityUnownedGpuMinutes: 30, securityHighGpuUtilizationPercent: 90, securityHighGpuDurationMinutes: 120, password: '' }),
      getMetricsHistory: async () => [],
      getProcessAudit: async () => [],
      getGpuOverview: async () => ({ generatedAt: Date.now(), users: [], servers: [] }),
    } as any;

    render(
      <TransportProvider adapter={adapter}>
        <MemoryRouter initialEntries={['/server/srv-1']}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/server/:id" element={<ServerDetail />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </MemoryRouter>
      </TransportProvider>,
    );

    expect(screen.getByText('Tasks')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd packages/ui && pnpm test -- tests/overview-detail-settings.test.tsx
```

Expected: FAIL because the new components, props, and tabs are not implemented yet.

- [ ] **Step 3: Implement the existing-surface enhancements**

Create `packages/ui/src/components/GpuOverviewCard.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { GpuOverviewResponse } from '@monitor/core';
import { useTransport } from '../transport/TransportProvider.js';

export function GpuOverviewCard() {
  const transport = useTransport();
  const [overview, setOverview] = useState<GpuOverviewResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next = await transport.getGpuOverview();
      if (!cancelled) setOverview(next);
    };
    void load();
    const interval = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [transport]);

  if (!overview) return <div className="bg-dark-card border border-dark-border rounded-xl p-4 text-sm text-slate-500">加载 GPU 使用分布...</div>;

  return (
    <div className="bg-dark-card border border-dark-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-slate-200">GPU 使用分布</h3>
        <span className="text-xs text-slate-500">按用户汇总</span>
      </div>
      <div className="space-y-2">
        {overview.users.slice(0, 5).map((row) => (
          <div key={row.user} className="flex items-center justify-between text-xs">
            <span className="text-slate-300">{row.user}</span>
            <span className="font-mono text-slate-400">{row.totalVramMB.toFixed(0)} MB</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

Create `packages/ui/src/components/GpuAllocationBars.tsx`:

```tsx
import type { GpuAllocationSummary } from '@monitor/core';

export function GpuAllocationBars({ allocation }: { allocation: GpuAllocationSummary | undefined }) {
  if (!allocation?.perGpu.length) {
    return <div className="text-sm text-slate-500">暂无 GPU 分配数据</div>;
  }

  return (
    <div className="space-y-3">
      {allocation.perGpu.map((gpu) => {
        const taskMB = gpu.pmeowTasks.reduce((sum, task) => sum + task.actualVramMB, 0);
        const userMB = gpu.userProcesses.reduce((sum, process) => sum + process.usedMemoryMB, 0);
        const unknownMB = gpu.unknownProcesses.reduce((sum, process) => sum + process.usedMemoryMB, 0);
        const freeMB = Math.max(0, gpu.totalMemoryMB - taskMB - userMB - unknownMB);
        return (
          <div key={gpu.gpuIndex}>
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>GPU {gpu.gpuIndex}</span>
              <span>{gpu.totalMemoryMB} MB</span>
            </div>
            <div className="h-3 rounded-full overflow-hidden bg-dark-border flex">
              <div className="bg-accent-blue" style={{ width: `${(taskMB / gpu.totalMemoryMB) * 100}%` }} />
              <div className="bg-accent-green" style={{ width: `${(userMB / gpu.totalMemoryMB) * 100}%` }} />
              <div className="bg-accent-red" style={{ width: `${(unknownMB / gpu.totalMemoryMB) * 100}%` }} />
              <div className="bg-slate-700" style={{ width: `${(freeMB / gpu.totalMemoryMB) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

Update `packages/ui/src/components/ServerCard.tsx` to show source/task/security summary:

```tsx
const { taskQueueGroups, openSecurityEvents } = useStore();
const taskGroup = taskQueueGroups.find((group) => group.serverId === server.id);
const hasSecurityWarning = openSecurityEvents.some((event) => event.serverId === server.id);

<div className="flex items-center gap-2">
  <div className={`w-2.5 h-2.5 rounded-full ${statusColor[connStatus]}`} />
  <h3 className="text-base font-semibold text-slate-200 truncate">{server.name}</h3>
  <span className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-slate-400 uppercase">{server.sourceType}</span>
  {hasSecurityWarning && <span className="text-[10px] text-accent-red">SEC</span>}
</div>

{server.sourceType === 'agent' && taskGroup && (
  <p className="text-xs text-slate-500 mt-2">排队 {taskGroup.queued.length} · 运行中 {taskGroup.running.length}</p>
)}
```

Update `packages/ui/src/components/ProcessTable.tsx` to consume `ProcessAuditRow[]` instead of `ProcessInfo[]`:

```tsx
import type { ProcessAuditRow } from '@monitor/core';

export function ProcessTable({ processes }: { processes: ProcessAuditRow[] }) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 border-b border-dark-border">
            <th className="text-left py-2 px-3">PID</th>
            <th className="text-left py-2 px-3">用户</th>
            <th className="text-right py-2 px-3">GPU MB</th>
            <th className="text-right py-2 px-3">CPU%</th>
            <th className="text-right py-2 px-3">MEM%</th>
            <th className="text-left py-2 px-3">命令</th>
            <th className="text-left py-2 px-3">风险</th>
          </tr>
        </thead>
        <tbody>
          {processes.map((process) => (
            <tr key={process.pid} className={process.suspiciousReasons.length ? 'bg-accent-red/5 border-b border-accent-red/20' : 'border-b border-dark-border/50 hover:bg-dark-hover'}>
              <td className="py-1.5 px-3 font-mono text-slate-400">{process.pid}</td>
              <td className="py-1.5 px-3 text-slate-300">{process.user}</td>
              <td className="py-1.5 px-3 text-right font-mono text-slate-300">{process.gpuMemoryMB ? `${process.gpuMemoryMB.toFixed(0)}M` : '-'}</td>
              <td className="py-1.5 px-3 text-right font-mono text-slate-300">{process.cpuPercent.toFixed(1)}</td>
              <td className="py-1.5 px-3 text-right font-mono text-slate-300">{process.memPercent.toFixed(1)}</td>
              <td className="py-1.5 px-3 text-slate-400 truncate max-w-[300px]">{process.command}</td>
              <td className="py-1.5 px-3 text-accent-red">{process.suspiciousReasons.join(' · ') || '正常'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Update `packages/ui/src/pages/Overview.tsx` to render the new GPU card above the server grid.

```tsx
import { GpuOverviewCard } from '../components/GpuOverviewCard.js';

return (
  <div className="p-6">
    <div className="flex items-center justify-between mb-6">
      ...
    </div>

    <div className="mb-6">
      <GpuOverviewCard />
    </div>

    {servers.length === 0 ? ... : ...}
  </div>
);
```

Update `packages/ui/src/pages/ServerDetail.tsx` to:

```tsx
type Tab = 'overview' | 'tasks' | 'processes' | 'docker';

const [processAudit, setProcessAudit] = useState<ProcessAuditRow[]>([]);

useEffect(() => {
  if (!id) return;
  void transport.getProcessAudit(id).then(setProcessAudit);
}, [id, transport, metrics?.timestamp]);

const taskGroup = useStore((state) => state.taskQueueGroups.find((group) => group.serverId === id));

const tabs: { key: Tab; label: string; visible?: boolean }[] = [
  { key: 'overview', label: '概览' },
  { key: 'tasks', label: 'Tasks', visible: server.sourceType === 'agent' },
  { key: 'processes', label: '进程' },
  { key: 'docker', label: 'Docker' },
].filter((tab) => tab.visible !== false);
```

Render `GpuAllocationBars` in the overview tab and render `taskGroup` in the Tasks tab.

```tsx
{tab === 'overview' && (
  <div className="space-y-6">
    ...
    <div className="bg-dark-card border border-dark-border rounded-lg p-4">
      <h3 className="text-sm text-slate-400 mb-3">GPU 分配</h3>
      <GpuAllocationBars allocation={metrics?.gpuAllocation} />
    </div>
  </div>
)}

{tab === 'tasks' && server.sourceType === 'agent' && (
  <div className="bg-dark-card border border-dark-border rounded-lg p-4 space-y-3">
    <h3 className="text-sm text-slate-400">当前任务</h3>
    {taskGroup?.running.concat(taskGroup.queued).map((task) => (
      <div key={task.taskId} className="rounded border border-dark-border bg-dark-bg p-3">
        <p className="text-sm text-slate-200 font-mono">{task.command ?? task.taskId}</p>
        <p className="text-xs text-slate-500 mt-1">{task.status} · VRAM {task.requireVramMB ?? 0} MB · GPU {task.gpuIds?.join(',') ?? '-'}</p>
      </div>
    ))}
  </div>
)}
```

Update `packages/ui/src/pages/Settings.tsx` to expose the new security settings and an Agent help card:

```tsx
<div className="bg-dark-card border border-dark-border rounded-lg p-4">
  <h3 className="text-sm font-medium text-slate-300 mb-3">安全审计</h3>
  <div className="space-y-3">
    <div>
      <label className="text-xs text-slate-500 block mb-1">挖矿关键词</label>
      <input
        value={local.securityMiningKeywords.join(', ')}
        onChange={(event) => update('securityMiningKeywords', event.target.value.split(',').map((item) => item.trim()).filter(Boolean))}
        className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 font-mono"
      />
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <input type="number" value={local.securityUnownedGpuMinutes} onChange={(event) => update('securityUnownedGpuMinutes', Number(event.target.value))} />
      <input type="number" value={local.securityHighGpuUtilizationPercent} onChange={(event) => update('securityHighGpuUtilizationPercent', Number(event.target.value))} />
      <input type="number" value={local.securityHighGpuDurationMinutes} onChange={(event) => update('securityHighGpuDurationMinutes', Number(event.target.value))} />
    </div>
  </div>
</div>

<div className="bg-dark-card border border-dark-border rounded-lg p-4">
  <h3 className="text-sm font-medium text-slate-300 mb-2">Agent 部署说明</h3>
  <p className="text-xs text-slate-500">Agent 节点会本地调度任务；Web 端仅做观测、审计和干预。</p>
</div>
```

- [ ] **Step 4: Run the UI surface test again**

Run:
```bash
cd packages/ui && pnpm test -- tests/overview-detail-settings.test.tsx
```

Expected: PASS with the new summary card, Agent Tasks tab, and security settings rendered.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/GpuOverviewCard.tsx packages/ui/src/components/GpuAllocationBars.tsx packages/ui/src/components/ServerCard.tsx packages/ui/src/components/ProcessTable.tsx packages/ui/src/pages/Overview.tsx packages/ui/src/pages/ServerDetail.tsx packages/ui/src/pages/Settings.tsx packages/ui/tests/overview-detail-settings.test.tsx
git commit -m "feat(ui): enhance existing operator and security surfaces"
```

---

### Task 9: Add Tasks and Security pages and wire them into the app shell

**Files:**
- Create: `packages/ui/src/pages/TaskQueue.tsx`
- Create: `packages/ui/src/pages/Security.tsx`
- Modify: `packages/ui/src/App.tsx`
- Test: `packages/ui/tests/taskqueue-security-pages.test.tsx`

- [ ] **Step 1: Write the failing route/page test**

Create `packages/ui/tests/taskqueue-security-pages.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../src/App.js';

describe('tasks and security routes', () => {
  it('shows the Tasks and Security navigation entries', () => {
    const adapter = {
      connect() {},
      disconnect() {},
      onMetricsUpdate: () => () => {},
      onServerStatus: () => () => {},
      onAlert: () => () => {},
      onHookTriggered: () => () => {},
      onNotify: () => () => {},
      onTaskUpdate: () => () => {},
      onSecurityEvent: () => () => {},
      getServers: async () => [],
      getServerStatuses: async () => [],
      getHooks: async () => [],
      getSettings: async () => ({ refreshIntervalMs: 5000, historyRetentionDays: 7, alertCpuThreshold: 90, alertMemoryThreshold: 90, alertDiskThreshold: 90, alertDiskMountPoints: ['/'], alertSuppressDefaultDays: 7, apiEnabled: true, apiPort: 17210, apiToken: '', securityMiningKeywords: ['xmrig'], securityUnownedGpuMinutes: 30, securityHighGpuUtilizationPercent: 90, securityHighGpuDurationMinutes: 120 }),
      getTaskQueue: async () => [],
      getSecurityEvents: async () => [],
    } as any;

    render(<App adapter={adapter} />);

    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Security')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd packages/ui && pnpm test -- tests/taskqueue-security-pages.test.tsx
```

Expected: FAIL because the new routes/pages are not mounted yet.

- [ ] **Step 3: Implement the Tasks/Security pages and route wiring**

Create `packages/ui/src/pages/TaskQueue.tsx`:

```tsx
import { useState } from 'react';
import { useStore } from '../store/useStore.js';
import { useTransport } from '../transport/TransportProvider.js';

export function TaskQueue() {
  const transport = useTransport();
  const { taskQueueGroups } = useStore();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    try {
      await action();
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Tasks</h1>
        <p className="text-sm text-slate-500 mt-1">仅展示 Agent 节点镜像到服务端的任务状态。</p>
      </div>

      {taskQueueGroups.map((group) => (
        <section key={group.serverId} className="bg-dark-card border border-dark-border rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-slate-200">{group.serverName}</h2>
              <p className="text-xs text-slate-500">排队 {group.queued.length} · 运行中 {group.running.length}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => void runAction(`${group.serverId}:pause`, () => transport.pauseQueue(group.serverId))} disabled={busyKey === `${group.serverId}:pause`} className="px-3 py-1.5 text-xs rounded bg-dark-bg border border-dark-border">暂停队列</button>
              <button onClick={() => void runAction(`${group.serverId}:resume`, () => transport.resumeQueue(group.serverId))} disabled={busyKey === `${group.serverId}:resume`} className="px-3 py-1.5 text-xs rounded bg-accent-blue/20 text-accent-blue">恢复队列</button>
            </div>
          </div>

          {[['排队中', group.queued], ['运行中', group.running], ['最近完成', group.recent]] as const}.map(([title, tasks]) => (
            <div key={title}>
              <h3 className="text-sm text-slate-400 mb-2">{title}</h3>
              <div className="space-y-2">
                {tasks.map((task) => (
                  <div key={task.taskId} className="rounded-lg border border-dark-border bg-dark-bg p-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-slate-200 font-mono">{task.command ?? task.taskId}</p>
                      <p className="text-xs text-slate-500">{task.user ?? 'unknown'} · VRAM {task.requireVramMB ?? 0} MB · GPU {task.gpuIds?.join(',') ?? '-'}</p>
                    </div>
                    <div className="flex gap-2">
                      {task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled' && (
                        <button onClick={() => void runAction(`${group.serverId}:${task.taskId}:cancel`, () => transport.cancelTask(group.serverId, task.taskId))} className="px-3 py-1.5 text-xs rounded bg-accent-red/15 text-accent-red">取消</button>
                      )}
                      <button onClick={() => void runAction(`${group.serverId}:${task.taskId}:priority`, () => transport.setTaskPriority(group.serverId, task.taskId, (task.priority ?? 0) + 1))} className="px-3 py-1.5 text-xs rounded bg-accent-yellow/15 text-accent-yellow">提高优先级</button>
                    </div>
                  </div>
                ))}
                {tasks.length === 0 && <div className="text-xs text-slate-600">暂无任务</div>}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
```

Create `packages/ui/src/pages/Security.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { SecurityEventRecord } from '@monitor/core';
import { useTransport } from '../transport/TransportProvider.js';

export function Security() {
  const transport = useTransport();
  const [events, setEvents] = useState<SecurityEventRecord[]>([]);
  const [serverId, setServerId] = useState('');
  const [resolved, setResolved] = useState<'all' | 'open' | 'closed'>('open');
  const [hours, setHours] = useState(168);

  useEffect(() => {
    const load = async () => {
      const next = await transport.getSecurityEvents({
        serverId: serverId || undefined,
        resolved: resolved === 'all' ? undefined : resolved === 'closed',
        hours,
      });
      setEvents(next);
    };

    void load();
    return transport.onSecurityEvent(() => {
      void load();
    });
  }, [transport, serverId, resolved, hours]);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Security</h1>
        <p className="text-sm text-slate-500 mt-1">可疑进程、无主 GPU 占用和管理员处置记录。</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <input value={serverId} onChange={(event) => setServerId(event.target.value)} placeholder="按节点 ID 过滤" className="bg-dark-card border border-dark-border rounded px-3 py-2 text-sm text-slate-200" />
        <select value={resolved} onChange={(event) => setResolved(event.target.value as 'all' | 'open' | 'closed')} className="bg-dark-card border border-dark-border rounded px-3 py-2 text-sm text-slate-200">
          <option value="open">未处理</option>
          <option value="closed">已处理</option>
          <option value="all">全部</option>
        </select>
        <input type="number" value={hours} onChange={(event) => setHours(Number(event.target.value))} className="w-24 bg-dark-card border border-dark-border rounded px-3 py-2 text-sm text-slate-200" />
      </div>

      <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 border-b border-dark-border">
              <th className="text-left px-4 py-3">时间</th>
              <th className="text-left px-4 py-3">类型</th>
              <th className="text-left px-4 py-3">节点</th>
              <th className="text-left px-4 py-3">详情</th>
              <th className="text-left px-4 py-3">状态</th>
              <th className="text-right px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b border-dark-border/50">
                <td className="px-4 py-3 text-slate-400">{new Date(event.createdAt).toLocaleString('zh-CN')}</td>
                <td className="px-4 py-3 text-slate-300">{event.eventType}</td>
                <td className="px-4 py-3 text-slate-300">{event.serverId}</td>
                <td className="px-4 py-3 text-slate-400">{event.details.reason}</td>
                <td className="px-4 py-3 text-slate-400">{event.resolved ? '已处理' : '待处理'}</td>
                <td className="px-4 py-3 text-right">
                  {!event.resolved && event.eventType !== 'marked_safe' && (
                    <button onClick={() => void transport.markSecurityEventSafe(event.id)} className="px-3 py-1.5 text-xs rounded bg-accent-green/15 text-accent-green">标记安全</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

Update `packages/ui/src/App.tsx` to wire the new routes, links, and bootstrap hook:

```tsx
import { useOperatorBootstrap } from './hooks/useOperatorData.js';
import type { TransportAdapter } from './transport/types.js';
import { TaskQueue } from './pages/TaskQueue.js';
import { Security } from './pages/Security.js';

const links = [
  { to: '/', icon: DashboardIcon, label: '概览' },
  { to: '/tasks', icon: TaskIcon, label: 'Tasks' },
  { to: '/servers', icon: ServerIcon, label: '服务器' },
  { to: '/hooks', icon: HookIcon, label: '钩子规则' },
  { to: '/alerts', icon: AlertIcon, label: '告警' },
  { to: '/security', icon: ShieldIcon, label: 'Security' },
  { to: '/settings', icon: SettingsIcon, label: '设置' },
];

function AppContent() {
  useMetricsSubscription();
  useLoadInitialData();
  useOperatorBootstrap();

  return (
    <div className="min-h-screen bg-dark-bg text-slate-200">
      <SidebarNav />
      <main className="ml-52 min-h-screen">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/tasks" element={<TaskQueue />} />
          <Route path="/server/:id" element={<ServerDetail />} />
          <Route path="/servers" element={<ServersManage />} />
          <Route path="/hooks" element={<HooksManage />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/security" element={<Security />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <ToastContainer />
    </div>
  );
}

export default function App({ adapter }: { adapter?: TransportAdapter }) {
  return (
    <TransportProvider adapter={adapter}>
      <BrowserRouter>
        <AuthGate />
      </BrowserRouter>
    </TransportProvider>
  );
}
```

Do not add a “查看日志” button in this task. That feature needs a backend log API and is intentionally out of scope for Plan 4.

- [ ] **Step 4: Run the new page/route test again**

Run:
```bash
cd packages/ui && pnpm test -- tests/taskqueue-security-pages.test.tsx
```

Expected: PASS with the new navigation entries and page mounts present.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/pages/TaskQueue.tsx packages/ui/src/pages/Security.tsx packages/ui/src/App.tsx packages/ui/tests/taskqueue-security-pages.test.tsx
git commit -m "feat(ui): add tasks and security pages"
```

---

### Task 10: Update documentation and run end-to-end verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README sections that changed**

Add or update text like this in `README.md`:

```md
## Operator Visibility Surface

- Tasks page: grouped Agent queues with cancel, priority, pause, and resume actions.
- Security page: suspicious-process and unowned-GPU audit log with mark-safe workflow.
- Overview: cluster-wide GPU ownership summary.
- Server Detail: Agent-only Tasks tab, GPU allocation bars, and audit-backed process table.
- Settings: configurable mining keywords and unowned-GPU thresholds.

## Operator APIs

- `GET /api/task-queue`
- `GET /api/servers/:id/process-audit`
- `GET /api/security/events`
- `POST /api/security/events/:id/mark-safe`
- `GET /api/gpu-overview`
- `GET /api/gpu-usage/summary`
- `GET /api/gpu-usage/by-user`
```

- [ ] **Step 2: Run the core, web, and UI verification suite**

Run:
```bash
pnpm --filter @monitor/core test
pnpm --filter @monitor/core exec tsc --noEmit
pnpm --filter @monitor/web test
pnpm --filter @monitor/web exec tsc --noEmit
pnpm --filter @monitor/ui test
pnpm --filter @monitor/ui exec tsc --noEmit
pnpm --filter @monitor/ui build
pnpm run build:web
```

Expected: all test suites pass, both TypeScript checks pass, the UI builds, and the web build completes with the updated UI assets copied into `packages/web/dist/public`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document operator visibility and security surface"
```

---

## Self-Review

### Spec coverage

- Section 7 (GPU 使用归属追踪): covered by Tasks 1, 2, 3, 8, and 10.
- Section 8 (安全审计模块): covered by Tasks 1, 2, 4, 5, 6, 8, and 9.
- Section 9 (UI 变更): covered by Tasks 7, 8, and 9 for the Tasks/Security/Overview/Server Detail/Settings surfaces.
- Section 10 (新增 REST API): covered by Task 6.

### Intentional gaps

- Electron package cleanup is intentionally excluded because it is packaging/runtime work rather than operator surface work.
- Task log viewing is intentionally excluded because no backend log API exists yet; adding a fake button would create product debt.

### Placeholder scan

- No `TODO`, `TBD`, or “similar to previous task” placeholders remain.
- Every task names exact files, exact commands, and concrete code to add.

### Type consistency

- Shared queue DTO: `AgentTaskQueueGroup`
- Shared audit DTO: `ProcessAuditRow`
- Shared security event DTO: `SecurityEventRecord`
- Shared GPU DTOs: `GpuOverviewResponse`, `GpuUsageSummaryItem`, `GpuUsageTimelinePoint`
- Settings keys remain flat: `securityMiningKeywords`, `securityUnownedGpuMinutes`, `securityHighGpuUtilizationPercent`, `securityHighGpuDurationMinutes`