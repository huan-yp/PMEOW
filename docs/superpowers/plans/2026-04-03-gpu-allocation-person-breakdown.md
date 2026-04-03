# GPU Allocation Person Breakdown Implementation Plan

> **For agentic workers:** REQUIRED: Use the `subagent-driven-development` agent (recommended) or `executing-plans` agent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Agent-mode GPU allocation card contents so each GPU shows VRAM occupancy by resolved person or username, backed by a dedicated derived API.

**Architecture:** Keep raw `gpuAllocation` untouched and add one derived selector in core that resolves task rows through mirrored task users plus person bindings at the latest snapshot timestamp. Expose that selector through a new read-only web route, then update the UI transport and GPU allocation card to render merged owner segments with stable colors and text legends.

**Tech Stack:** TypeScript, React 18, Express, Vitest, Testing Library, existing `@monitor/core` person-resolution helpers

---

## File Structure

- Modify: `packages/core/src/types.ts`
Responsibility: add transport-safe response types for resolved GPU allocation segments.

- Modify: `packages/core/src/db/person-attribution.ts`
Responsibility: add a derived selector that reads the latest metrics snapshot, resolves task and user ownership, merges same-owner segments per GPU, and returns a UI-ready response.

- Modify: `packages/core/src/index.ts`
Responsibility: export the new selector from the public core API.

- Modify: `packages/core/tests/person/attribution.test.ts`
Responsibility: prove that latest-snapshot GPU rows resolve to person names first, usernames second, and Unknown only when no username exists.

- Modify: `packages/web/src/agent-routes.ts`
Responsibility: expose `GET /api/servers/:id/gpu-allocation/resolved` as a thin wrapper over the new core selector.

- Modify: `packages/web/tests/agent-routes.read.test.ts`
Responsibility: verify the new route returns the latest resolved allocation and returns `null` when no GPU allocation exists.

- Modify: `packages/ui/src/transport/types.ts`
Responsibility: add `getResolvedGpuAllocation(serverId)` to the UI transport contract.

- Modify: `packages/ui/src/transport/ws-adapter.ts`
Responsibility: fetch the new resolved allocation route.

- Modify: `packages/ui/src/pages/ServerDetail.tsx`
Responsibility: load resolved GPU allocation state for Agent-mode detail pages and pass it into the GPU allocation card.

- Modify: `packages/ui/src/components/GpuAllocationBars.tsx`
Responsibility: render per-owner stacked segments, deterministic colors, and per-segment legend text.

- Modify: `packages/ui/tests/overview-detail-settings.test.tsx`
Responsibility: cover the new card output in the existing server-detail integration test harness.

- Modify: `packages/ui/tests/taskqueue-security-pages.test.tsx`
- Modify: `packages/ui/tests/mobile-person-pages.test.tsx`
- Modify: `packages/ui/tests/person-pages.test.tsx`
- Modify: `packages/ui/tests/use-metrics.test.tsx`
- Modify: `packages/ui/tests/operator-bootstrap.test.tsx`
Responsibility: add the new transport stub method to handwritten `TransportAdapter` mocks so UI typecheck remains green.

## Task 1: Core Derived Selector

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/db/person-attribution.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/tests/person/attribution.test.ts`

- [ ] **Step 1: Write the failing core test**

Update `packages/core/tests/person/attribution.test.ts` imports and add this test:

```ts
import { saveMetrics } from '../../src/db/metrics.js';
import {
  getResolvedGpuAllocation,
  getPersonSummaries,
  getPersonTimeline,
  getServerPersonActivity,
  listPersonBindingSuggestions,
  recordGpuAttributionFacts,
  recordTaskAttributionFact,
} from '../../src/db/person-attribution.js';

it('builds resolved gpu allocation from the latest snapshot using person name first and username fallback', () => {
  const now = Date.now();
  const server = createServer({
    name: 'gpu-resolved',
    host: 'gpu-resolved',
    port: 22,
    username: 'root',
    privateKeyPath: '/tmp/key',
    sourceType: 'agent',
    agentId: 'agent-resolved',
  });
  const alice = createPerson({ displayName: 'Alice', customFields: {} });

  createPersonBinding({
    personId: alice.id,
    serverId: server.id,
    systemUser: 'alice',
    source: 'manual',
    effectiveFrom: now - 10_000,
  });

  upsertAgentTask({
    serverId: server.id,
    taskId: 'task-run-1',
    status: 'running',
    user: 'alice',
    startedAt: now - 5_000,
  });

  saveMetrics({
    serverId: server.id,
    timestamp: now,
    cpu: { usagePercent: 0, coreCount: 1, modelName: 'CPU', frequencyMhz: 0, perCoreUsage: [0] },
    memory: { totalMB: 1, usedMB: 0, availableMB: 1, usagePercent: 0, swapTotalMB: 0, swapUsedMB: 0, swapPercent: 0 },
    disk: { disks: [], ioReadKBs: 0, ioWriteKBs: 0 },
    network: { rxBytesPerSec: 0, txBytesPerSec: 0, interfaces: [] },
    gpu: { available: true, totalMemoryMB: 24576, usedMemoryMB: 8704, memoryUsagePercent: 35, utilizationPercent: 0, temperatureC: 0, gpuCount: 1 },
    processes: [],
    docker: [],
    system: { hostname: 'gpu-resolved', uptime: '1 day', loadAvg1: 0, loadAvg5: 0, loadAvg15: 0, kernelVersion: '6.8.0' },
    gpuAllocation: {
      perGpu: [
        {
          gpuIndex: 0,
          totalMemoryMB: 24576,
          pmeowTasks: [{ taskId: 'task-run-1', gpuIndex: 0, declaredVramMB: 8192, actualVramMB: 6144 }],
          userProcesses: [
            { pid: 2001, user: 'alice', gpuIndex: 0, usedMemoryMB: 1024, command: 'python train.py' },
            { pid: 2002, user: 'bob', gpuIndex: 0, usedMemoryMB: 1024, command: 'python eval.py' },
          ],
          unknownProcesses: [{ pid: 2003, gpuIndex: 0, usedMemoryMB: 512, command: 'mystery' }],
          effectiveFreeMB: 16896,
        },
      ],
      byUser: [
        { user: 'alice', totalVramMB: 1024, gpuIndices: [0] },
        { user: 'bob', totalVramMB: 1024, gpuIndices: [0] },
      ],
    },
  });

  expect(getResolvedGpuAllocation(server.id)).toEqual({
    serverId: server.id,
    snapshotTimestamp: now,
    perGpu: [
      {
        gpuIndex: 0,
        totalMemoryMB: 24576,
        freeMB: 16896,
        segments: [
          {
            ownerKey: `person:${alice.id}`,
            ownerKind: 'person',
            displayName: 'Alice',
            usedMemoryMB: 7168,
            personId: alice.id,
            rawUser: 'alice',
            sourceKinds: ['task', 'user_process'],
          },
          {
            ownerKey: 'user:bob',
            ownerKind: 'user',
            displayName: 'bob',
            usedMemoryMB: 1024,
            rawUser: 'bob',
            sourceKinds: ['user_process'],
          },
          {
            ownerKey: 'unknown',
            ownerKind: 'unknown',
            displayName: 'Unknown',
            usedMemoryMB: 512,
            sourceKinds: ['unknown_process'],
          },
        ],
      },
    ],
  });
});
```

- [ ] **Step 2: Run the targeted core test and confirm it fails**

Run:

```bash
npm run test --workspace=@monitor/core -- attribution -t "builds resolved gpu allocation from the latest snapshot using person name first and username fallback"
```

Expected: FAIL because `getResolvedGpuAllocation` and the resolved response types do not exist yet.

- [ ] **Step 3: Add the resolved response types and selector**

Update `packages/core/src/types.ts` with:

```ts
export interface ResolvedGpuAllocationSegment {
  ownerKey: string;
  ownerKind: 'person' | 'user' | 'unknown';
  displayName: string;
  usedMemoryMB: number;
  personId?: string;
  rawUser?: string;
  sourceKinds: Array<'task' | 'user_process' | 'unknown_process'>;
}

export interface ResolvedPerGpuAllocation {
  gpuIndex: number;
  totalMemoryMB: number;
  freeMB: number;
  segments: ResolvedGpuAllocationSegment[];
}

export interface ResolvedGpuAllocationResponse {
  serverId: string;
  snapshotTimestamp: number;
  perGpu: ResolvedPerGpuAllocation[];
}
```

Update `packages/core/src/db/person-attribution.ts` imports and add this selector and merge helper:

```ts
import { getAgentTask } from './agent-tasks.js';
import { getLatestMetrics } from './metrics.js';
import type {
  AgentTaskUpdatePayload,
  MirroredAgentTaskRecord,
  PersonBindingSuggestion,
  PersonSummaryItem,
  PersonTimelinePoint,
  ResolvedGpuAllocationResponse,
  ResolvedGpuAllocationSegment,
  ServerPersonActivity,
} from '../types.js';

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
  const allocation = metrics?.gpuAllocation;
  if (!metrics || !allocation) {
    return null;
  }

  return {
    serverId,
    snapshotTimestamp: metrics.timestamp,
    perGpu: allocation.perGpu.map((gpu) => {
      const segmentMap = new Map<string, ResolvedGpuAllocationSegment>();

      for (const taskAllocation of gpu.pmeowTasks) {
        const task = getAgentTask(taskAllocation.taskId);
        const rawUser = task?.user;
        const resolution = resolveTaskPerson(serverId, taskAllocation.taskId, rawUser ?? undefined, metrics.timestamp);

        if (resolution.person) {
          upsertResolvedSegment(segmentMap, {
            ownerKey: `person:${resolution.person.id}`,
            ownerKind: 'person',
            displayName: resolution.person.displayName,
            usedMemoryMB: taskAllocation.actualVramMB,
            personId: resolution.person.id,
            rawUser: rawUser ?? undefined,
            sourceKinds: ['task'],
          });
        } else if (rawUser) {
          upsertResolvedSegment(segmentMap, {
            ownerKey: `user:${rawUser}`,
            ownerKind: 'user',
            displayName: rawUser,
            usedMemoryMB: taskAllocation.actualVramMB,
            rawUser,
            sourceKinds: ['task'],
          });
        } else {
          upsertResolvedSegment(segmentMap, {
            ownerKey: 'unknown',
            ownerKind: 'unknown',
            displayName: 'Unknown',
            usedMemoryMB: taskAllocation.actualVramMB,
            sourceKinds: ['task'],
          });
        }
      }

      for (const process of gpu.userProcesses) {
        const resolution = resolveRawUserPerson(serverId, process.user, metrics.timestamp);
        if (resolution.person) {
          upsertResolvedSegment(segmentMap, {
            ownerKey: `person:${resolution.person.id}`,
            ownerKind: 'person',
            displayName: resolution.person.displayName,
            usedMemoryMB: process.usedMemoryMB,
            personId: resolution.person.id,
            rawUser: process.user,
            sourceKinds: ['user_process'],
          });
        } else {
          upsertResolvedSegment(segmentMap, {
            ownerKey: `user:${process.user}`,
            ownerKind: 'user',
            displayName: process.user,
            usedMemoryMB: process.usedMemoryMB,
            rawUser: process.user,
            sourceKinds: ['user_process'],
          });
        }
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

      return {
        gpuIndex: gpu.gpuIndex,
        totalMemoryMB: gpu.totalMemoryMB,
        freeMB: Math.max(gpu.effectiveFreeMB, 0),
        segments: Array.from(segmentMap.values()).sort(
          (left, right) => right.usedMemoryMB - left.usedMemoryMB || left.displayName.localeCompare(right.displayName),
        ),
      };
    }),
  };
}
```

Update `packages/core/src/index.ts` exports with:

```ts
export {
  recordGpuAttributionFacts,
  recordTaskAttributionFact,
  getPersonSummaries,
  getPersonTimeline,
  getPersonTasks,
  getServerPersonActivity,
  getResolvedGpuAllocation,
  listPersonBindingSuggestions,
} from './db/person-attribution.js';
```

- [ ] **Step 4: Run the core test again and confirm it passes**

Run:

```bash
npm run test --workspace=@monitor/core -- attribution -t "builds resolved gpu allocation from the latest snapshot using person name first and username fallback"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/db/person-attribution.ts packages/core/src/index.ts packages/core/tests/person/attribution.test.ts
git commit -m "feat: derive resolved gpu allocation"
```

## Task 2: Web Route Exposure

**Files:**
- Modify: `packages/web/src/agent-routes.ts`
- Modify: `packages/web/tests/agent-routes.read.test.ts`

- [ ] **Step 1: Write the failing web route test**

Update `packages/web/tests/agent-routes.read.test.ts` imports and add these tests:

```ts
import {
  Scheduler,
  closeDatabase,
  createPerson,
  createPersonBinding,
  createServer,
  getLatestGpuUsageByServerId,
  getLatestMetrics,
  type GpuAllocationSummary,
  type MetricsSnapshot,
} from '@monitor/core';

it('gpu allocation resolved endpoint returns the latest person-resolved allocation', async () => {
  const { baseUrl } = await startRuntime();
  const token = await login(baseUrl);
  const api = request(baseUrl);
  const server = createServer({
    name: 'gpu-allocation-resolved',
    host: 'gpu-allocation-resolved',
    port: 22,
    username: 'root',
    privateKeyPath: '/tmp/key',
    sourceType: 'agent',
    agentId: 'agent-allocation-resolved',
  });
  const alice = createPerson({ displayName: 'Alice', customFields: {} });

  createPersonBinding({
    personId: alice.id,
    serverId: server.id,
    systemUser: 'alice',
    source: 'manual',
    effectiveFrom: DEFAULT_TIMESTAMP_MS,
  });

  const client = await connectAgent(baseUrl);

  client.emit('agent:register', {
    agentId: 'agent-allocation-resolved',
    hostname: 'gpu-allocation-resolved',
    version: '1.0.0',
  });
  client.emit('agent:taskUpdate', {
    serverId: server.id,
    taskId: 'task-new',
    status: 'running',
    user: 'alice',
    startedAt: DEFAULT_TIMESTAMP_MS + 1_500,
  });
  client.emit('agent:metrics', createSnapshot(server.id, {
    timestamp: DEFAULT_TIMESTAMP_MS + 2_000,
    gpuAllocation: createGpuAllocation('task-new', 'alice'),
  }));

  await waitForCondition(async () => {
    const response = await api
      .get(`/api/servers/${server.id}/gpu-allocation/resolved`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      serverId: server.id,
      snapshotTimestamp: DEFAULT_TIMESTAMP_MS + 2_000,
      perGpu: [
        {
          gpuIndex: 0,
          totalMemoryMB: 24576,
          freeMB: 16896,
          segments: [
            expect.objectContaining({
              ownerKey: `person:${alice.id}`,
              ownerKind: 'person',
              displayName: 'Alice',
              usedMemoryMB: 7168,
            }),
            expect.objectContaining({
              ownerKey: 'unknown',
              ownerKind: 'unknown',
              displayName: 'Unknown',
              usedMemoryMB: 512,
            }),
          ],
        },
      ],
    });
  });
});

it('gpu allocation resolved endpoint returns null when no gpu allocation exists', async () => {
  const { baseUrl } = await startRuntime();
  const token = await login(baseUrl);
  const api = request(baseUrl);
  const server = createServer({
    name: 'gpu-allocation-resolved-null',
    host: 'gpu-allocation-resolved-null',
    port: 22,
    username: 'root',
    privateKeyPath: '/tmp/key',
    sourceType: 'agent',
    agentId: 'agent-allocation-resolved-null',
  });

  const response = await api
    .get(`/api/servers/${server.id}/gpu-allocation/resolved`)
    .set('Authorization', `Bearer ${token}`);

  expect(response.status).toBe(200);
  expect(response.body).toBeNull();
});
```

- [ ] **Step 2: Run the targeted web tests and confirm they fail**

Run:

```bash
npm run build:core && npm run test --workspace=@monitor/web -- agent-routes.read -t "gpu allocation resolved endpoint"
```

Expected: FAIL because the resolved route does not exist yet.

- [ ] **Step 3: Add the new read-only route**

Update `packages/web/src/agent-routes.ts` imports and route table with:

```ts
import {
  AgentDataSource,
  getAgentTask,
  getAgentTasksByServerId,
  getLatestMetrics,
  getResolvedGpuAllocation,
  getServerById,
  isServerSetPriorityPayload,
} from '@monitor/core';

app.get('/api/servers/:id/gpu-allocation/resolved', (req: Request, res: Response) => {
  const serverId = requireServer(req, res);
  if (!serverId) {
    return;
  }

  res.json(getResolvedGpuAllocation(serverId));
});
```

- [ ] **Step 4: Run the web tests again and confirm they pass**

Run:

```bash
npm run build:core && npm run test --workspace=@monitor/web -- agent-routes.read -t "gpu allocation resolved endpoint"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/agent-routes.ts packages/web/tests/agent-routes.read.test.ts
git commit -m "feat: expose resolved gpu allocation route"
```

## Task 3: UI Transport And GPU Card Rendering

**Files:**
- Modify: `packages/ui/src/transport/types.ts`
- Modify: `packages/ui/src/transport/ws-adapter.ts`
- Modify: `packages/ui/src/pages/ServerDetail.tsx`
- Modify: `packages/ui/src/components/GpuAllocationBars.tsx`
- Modify: `packages/ui/tests/overview-detail-settings.test.tsx`
- Modify: `packages/ui/tests/taskqueue-security-pages.test.tsx`
- Modify: `packages/ui/tests/mobile-person-pages.test.tsx`
- Modify: `packages/ui/tests/person-pages.test.tsx`
- Modify: `packages/ui/tests/use-metrics.test.tsx`
- Modify: `packages/ui/tests/operator-bootstrap.test.tsx`

- [ ] **Step 1: Write the failing UI test for the new card output**

Update `packages/ui/tests/overview-detail-settings.test.tsx` imports, transport stub, and add this test:

```ts
import type {
  AgentTaskQueueGroup,
  AlertEvent,
  AlertRecord,
  AppSettings,
  GpuOverviewResponse,
  GpuUsageSummaryItem,
  HookLog,
  HookRule,
  HookRuleInput,
  MetricsSnapshot,
  ProcessAuditRow,
  ResolvedGpuAllocationResponse,
  SecurityEventRecord,
  ServerConfig,
  ServerInput,
  ServerStatus,
} from '@monitor/core';

it('renders resolved owner names in the gpu allocation card', async () => {
  const transport = createMockTransport();
  const server = createServer();

  useStore.setState({
    servers: [server],
    statuses: new Map([[server.id, createStatus(server.id)]]),
    latestMetrics: new Map([[server.id, createMetricsSnapshot(server.id)]]),
    taskQueueGroups: [],
  });

  transport.getResolvedGpuAllocation = vi.fn(async (_serverId: string) => ({
    serverId: server.id,
    snapshotTimestamp: 1_710_000_000_000,
    perGpu: [
      {
        gpuIndex: 0,
        totalMemoryMB: 24576,
        freeMB: 16896,
        segments: [
          {
            ownerKey: 'person:person-1',
            ownerKind: 'person',
            displayName: 'Alice',
            usedMemoryMB: 7168,
            personId: 'person-1',
            rawUser: 'alice',
            sourceKinds: ['task', 'user_process'],
          },
          {
            ownerKey: 'user:bob',
            ownerKind: 'user',
            displayName: 'bob',
            usedMemoryMB: 512,
            rawUser: 'bob',
            sourceKinds: ['user_process'],
          },
        ],
      },
    ],
  } satisfies ResolvedGpuAllocationResponse));

  renderWithProviders(
    <Routes>
      <Route path="/server/:id" element={<ServerDetail />} />
    </Routes>,
    transport,
    `/server/${server.id}`,
  );

  expect(await screen.findByText('Alice 7168 MB')).toBeInTheDocument();
  expect(screen.getByText('bob 512 MB')).toBeInTheDocument();
  expect(screen.queryByText('Task 6144 MB')).not.toBeInTheDocument();
  expect(screen.queryByText('User 4096 MB')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the targeted UI test and confirm it fails**

Run:

```bash
npm run build:core && npm run test --workspace=@monitor/ui -- overview-detail-settings -t "renders resolved owner names in the gpu allocation card"
```

Expected: FAIL because the transport method and UI rendering path do not exist yet.

- [ ] **Step 3: Wire the transport, detail page, card component, and mock updates**

Update `packages/ui/src/transport/types.ts` with:

```ts
import type {
  ServerConfig, ServerInput, MetricsSnapshot, ServerStatus,
  HookRule, HookRuleInput, HookLog, AppSettings, AlertEvent, AlertRecord,
  AgentTaskQueueGroup, AgentTaskUpdatePayload, GpuOverviewResponse,
  GpuUsageSummaryItem, GpuUsageTimelinePoint, ProcessAuditRow, SecurityEventRecord,
  PersonRecord, PersonBindingRecord, PersonBindingSuggestion,
  PersonSummaryItem, PersonTimelinePoint, ResolvedGpuAllocationResponse, ServerPersonActivity,
  MirroredAgentTaskRecord,
} from '@monitor/core';

export interface TransportAdapter {
  // ...existing methods...
  getResolvedGpuAllocation(serverId: string): Promise<ResolvedGpuAllocationResponse | null>;
}
```

Update `packages/ui/src/transport/ws-adapter.ts` with:

```ts
import type {
  ServerConfig, ServerInput, MetricsSnapshot, ServerStatus,
  HookRule, HookRuleInput, HookLog, AppSettings, AlertEvent, AlertRecord,
  AgentTaskQueueGroup, AgentTaskUpdatePayload, GpuOverviewResponse,
  GpuUsageSummaryItem, GpuUsageTimelinePoint, ProcessAuditRow, SecurityEventRecord,
  PersonRecord, PersonBindingRecord, PersonBindingSuggestion,
  PersonSummaryItem, PersonTimelinePoint, ResolvedGpuAllocationResponse, ServerPersonActivity,
  MirroredAgentTaskRecord,
} from '@monitor/core';

async getResolvedGpuAllocation(serverId: string): Promise<ResolvedGpuAllocationResponse | null> {
  return this.fetch(`/api/servers/${serverId}/gpu-allocation/resolved`);
}
```

Update `packages/ui/src/pages/ServerDetail.tsx` with:

```ts
import type { MetricsSnapshot, ProcessAuditRow, ResolvedGpuAllocationResponse, ServerPersonActivity } from '@monitor/core';

const [resolvedGpuAllocation, setResolvedGpuAllocation] = useState<ResolvedGpuAllocationResponse | null>(null);

useLayoutEffect(() => {
  setHistory([]);
  setProcessAudit([]);
  setResolvedGpuAllocation(null);
}, [id]);

useEffect(() => {
  if (!id) return;
  void transport.getResolvedGpuAllocation(id).then(setResolvedGpuAllocation).catch(() => setResolvedGpuAllocation(null));
}, [id, transport]);

<GpuAllocationBars allocation={resolvedGpuAllocation} />
```

Update `packages/ui/src/components/GpuAllocationBars.tsx` with:

```ts
import type { ResolvedGpuAllocationResponse, ResolvedGpuAllocationSegment } from '@monitor/core';

interface Props {
  allocation?: ResolvedGpuAllocationResponse | null;
}

const OWNER_SEGMENT_CLASSES = [
  'bg-sky-500',
  'bg-emerald-500',
  'bg-cyan-500',
  'bg-rose-500',
  'bg-orange-500',
  'bg-lime-500',
];

function hashOwnerKey(ownerKey: string): number {
  let hash = 0;
  for (const char of ownerKey) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function getSegmentClassName(segment: ResolvedGpuAllocationSegment): string {
  if (segment.ownerKind === 'unknown') {
    return 'bg-amber-500';
  }

  return OWNER_SEGMENT_CLASSES[hashOwnerKey(segment.ownerKey) % OWNER_SEGMENT_CLASSES.length];
}

export function GpuAllocationBars({ allocation }: Props) {
  if (!allocation || allocation.perGpu.length === 0) {
    return (
      <div className="rounded-lg border border-dark-border bg-dark-card p-4">
        <h3 className="text-sm text-slate-300 mb-2">GPU 分配</h3>
        <p className="text-sm text-slate-500">暂无 GPU 分配数据</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dark-border bg-dark-card p-4">
      <h3 className="text-sm text-slate-300 mb-3">GPU 分配</h3>
      <div className="space-y-3">
        {allocation.perGpu.map((gpu) => {
          const totalMB = gpu.totalMemoryMB || 1;
          return (
            <div key={gpu.gpuIndex}>
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>GPU {gpu.gpuIndex}</span>
                <span>{gpu.totalMemoryMB} MB</span>
              </div>
              <div className="flex h-3 overflow-hidden rounded-full bg-dark-bg border border-dark-border/70">
                {gpu.segments.map((segment) => (
                  <div
                    key={segment.ownerKey}
                    className={getSegmentClassName(segment)}
                    style={{ width: `${(segment.usedMemoryMB / totalMB) * 100}%` }}
                    title={`${segment.displayName}: ${segment.usedMemoryMB} MB`}
                  />
                ))}
                {gpu.freeMB > 0 && (
                  <div
                    className="bg-slate-700"
                    style={{ width: `${(gpu.freeMB / totalMB) * 100}%` }}
                    title={`Free: ${gpu.freeMB} MB`}
                  />
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
                {gpu.segments.map((segment) => (
                  <span key={segment.ownerKey}>{segment.displayName} {segment.usedMemoryMB} MB</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

Add the new stub method to each handwritten mock:

```ts
// packages/ui/tests/overview-detail-settings.test.tsx
getResolvedGpuAllocation: vi.fn(async (_serverId: string) => null),

// packages/ui/tests/taskqueue-security-pages.test.tsx
getResolvedGpuAllocation: vi.fn(async (_serverId: string) => null),

// packages/ui/tests/mobile-person-pages.test.tsx
getResolvedGpuAllocation: vi.fn(async (_serverId: string) => null),

// packages/ui/tests/person-pages.test.tsx
getResolvedGpuAllocation: vi.fn(async (_serverId: string) => null),

// packages/ui/tests/use-metrics.test.tsx
getResolvedGpuAllocation: vi.fn(async (_serverId: string) => null),

// packages/ui/tests/operator-bootstrap.test.tsx
getResolvedGpuAllocation: vi.fn(async (_serverId: string) => null),
```

- [ ] **Step 4: Run the UI verification commands and confirm they pass**

Run:

```bash
npm run build:core && npm run test --workspace=@monitor/ui -- overview-detail-settings -t "renders resolved owner names in the gpu allocation card"
npm run typecheck --workspace=@monitor/ui
```

Expected: both commands PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/transport/types.ts packages/ui/src/transport/ws-adapter.ts packages/ui/src/pages/ServerDetail.tsx packages/ui/src/components/GpuAllocationBars.tsx packages/ui/tests/overview-detail-settings.test.tsx packages/ui/tests/taskqueue-security-pages.test.tsx packages/ui/tests/mobile-person-pages.test.tsx packages/ui/tests/person-pages.test.tsx packages/ui/tests/use-metrics.test.tsx packages/ui/tests/operator-bootstrap.test.tsx
git commit -m "feat: show gpu allocation by person"
```