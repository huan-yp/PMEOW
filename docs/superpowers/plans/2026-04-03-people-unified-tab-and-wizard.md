# Unified People Tab And Guided Create Flow Implementation Plan

> **For agentic workers:** REQUIRED: Use the `subagent-driven-development` agent (recommended) or `executing-plans` agent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the current people overview and people management tabs into one people landing page, then move person creation into a dedicated full-screen guided flow that starts from a server-local system user or a manual blank profile.

**Architecture:** Keep the existing person detail page unchanged. Reuse the current `PeopleOverview` page as the single landing page, repurpose `PeopleManage` into the guided creation page mounted at `/people/new`, and add one small derived backend API that returns all observed server-user candidates with current binding metadata so the wizard can show both bound and unbound accounts.

**Tech Stack:** React 18, react-router-dom, TypeScript, Vitest, Testing Library, existing `@monitor/core` person attribution APIs

---

## File Structure

- Modify: `packages/core/src/types.ts`
Responsibility: add a transport-safe `PersonBindingCandidate` type that can represent an observed server user and its current active binding, if any.

- Modify: `packages/core/src/db/person-attribution.ts`
Responsibility: add `listPersonBindingCandidates()` derived from existing attribution facts and bindings without changing schema or attribution rules.

- Modify: `packages/core/src/index.ts`
Responsibility: export the new candidate type and selector.

- Modify: `packages/core/tests/person/attribution.test.ts`
Responsibility: prove that the candidate query returns both unbound and already-bound server users with the correct metadata.

- Modify: `packages/web/src/person-routes.ts`
Responsibility: expose `GET /api/person-binding-candidates` as the thin route wrapper over the new core selector.

- Modify: `packages/ui/src/transport/types.ts`
Responsibility: add `getPersonBindingCandidates()` to the UI transport contract.

- Modify: `packages/ui/src/transport/ws-adapter.ts`
Responsibility: fetch the new API route.

- Modify: `packages/ui/src/App.tsx`
Responsibility: remove the separate sidebar entry for people management, keep a single people nav item, add `/people/new`, and preserve a compatibility redirect from `/people/manage`.

- Modify: `packages/ui/src/pages/PeopleOverview.tsx`
Responsibility: become the single people landing page focused on browsing existing people and launching the guided add flow.

- Modify: `packages/ui/src/pages/PeopleManage.tsx`
Responsibility: replace the current inline add form with the dedicated full-screen guided creation flow.

- Create: `packages/ui/tests/person-create-wizard.test.tsx`
Responsibility: cover the guided flow for both manual creation and server-user-based creation with transfer confirmation.

- Modify: `packages/ui/tests/person-pages.test.tsx`
Responsibility: update coverage for the merged landing page and the new `/people/new` route.

- Modify: `packages/ui/tests/overview-detail-settings.test.tsx`
- Modify: `packages/ui/tests/taskqueue-security-pages.test.tsx`
- Modify: `packages/ui/tests/mobile-person-pages.test.tsx`
- Modify: `packages/ui/tests/auth-gate.test.tsx`
- Modify: `packages/ui/tests/operator-bootstrap.test.tsx`
- Modify: `packages/ui/tests/use-metrics.test.tsx`
Responsibility: add a stub `getPersonBindingCandidates` method to every handwritten `TransportAdapter` mock so UI typecheck stays green.

## Task 1: Candidate Data Plumbing

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/db/person-attribution.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/tests/person/attribution.test.ts`
- Modify: `packages/web/src/person-routes.ts`
- Modify: `packages/ui/src/transport/types.ts`
- Modify: `packages/ui/src/transport/ws-adapter.ts`
- Modify: `packages/ui/tests/overview-detail-settings.test.tsx`
- Modify: `packages/ui/tests/taskqueue-security-pages.test.tsx`
- Modify: `packages/ui/tests/mobile-person-pages.test.tsx`
- Modify: `packages/ui/tests/auth-gate.test.tsx`
- Modify: `packages/ui/tests/operator-bootstrap.test.tsx`
- Modify: `packages/ui/tests/use-metrics.test.tsx`
- Modify: `packages/ui/tests/person-pages.test.tsx`

- [ ] **Step 1: Write the failing core test for all observed candidates**

Update `packages/core/tests/person/attribution.test.ts` imports and add this test:

```ts
import {
  getPersonSummaries,
  getPersonTimeline,
  getServerPersonActivity,
  listPersonBindingCandidates,
  listPersonBindingSuggestions,
  recordGpuAttributionFacts,
  recordTaskAttributionFact,
} from '../../src/db/person-attribution.js';

it('lists observed binding candidates with active binding metadata', () => {
  const now = Date.now();
  const server = createServer({
    name: 'gpu-3',
    host: 'gpu-3',
    port: 22,
    username: 'root',
    privateKeyPath: '/tmp/key',
    sourceType: 'agent',
    agentId: 'agent-3',
  });
  const alice = createPerson({ displayName: 'Alice', customFields: {} });

  createPersonBinding({
    personId: alice.id,
    serverId: server.id,
    systemUser: 'alice',
    source: 'manual',
    effectiveFrom: now - 10_000,
  });

  saveGpuUsageRows(server.id, now - 5_000, [
    { gpuIndex: 0, ownerType: 'user', ownerId: 'alice', userName: 'alice', pid: 1001, command: 'python train.py', usedMemoryMB: 4096 },
    { gpuIndex: 1, ownerType: 'user', ownerId: 'alice-lab', userName: 'alice-lab', pid: 1002, command: 'python eval.py', usedMemoryMB: 2048 },
  ]);

  recordGpuAttributionFacts(server.id, now - 5_000);

  expect(listPersonBindingCandidates()).toEqual([
    expect.objectContaining({
      serverId: server.id,
      systemUser: 'alice-lab',
      activeBinding: null,
    }),
    expect.objectContaining({
      serverId: server.id,
      systemUser: 'alice',
      activeBinding: expect.objectContaining({
        personId: alice.id,
        personDisplayName: 'Alice',
      }),
    }),
  ]);
});
```

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run:

```bash
pnpm --filter @monitor/core test -- tests/person/attribution.test.ts -t "lists observed binding candidates with active binding metadata"
```

Expected: FAIL because `listPersonBindingCandidates` is not exported yet.

- [ ] **Step 3: Add the new candidate type and derived selector**

Update `packages/core/src/types.ts` with:

```ts
export interface PersonBindingCandidate {
  serverId: string;
  serverName: string;
  systemUser: string;
  lastSeenAt: number;
  activeBinding: null | {
    bindingId: string;
    personId: string;
    personDisplayName: string;
  };
}
```

Update `packages/core/src/db/person-attribution.ts` imports and add:

```ts
import type {
  PersonAttributionFactRecord,
  PersonBindingCandidate,
  PersonBindingSuggestion,
  PersonSummaryItem,
  PersonTimelinePoint,
  ServerPersonActivity,
} from '../types.js';

export function listPersonBindingCandidates(): PersonBindingCandidate[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT DISTINCT
      f.serverId AS serverId,
      COALESCE(s.name, f.serverId) AS serverName,
      f.rawUser AS systemUser,
      MAX(f.timestamp) AS lastSeenAt,
      b.id AS bindingId,
      b.personId AS personId,
      p.displayName AS personDisplayName
    FROM person_attribution_facts f
    LEFT JOIN servers s ON s.id = f.serverId
    LEFT JOIN person_bindings b
      ON b.serverId = f.serverId
     AND b.systemUser = f.rawUser
     AND b.enabled = 1
     AND b.effectiveTo IS NULL
    LEFT JOIN persons p ON p.id = b.personId
    WHERE f.rawUser IS NOT NULL
      AND f.sourceType LIKE 'gpu_%'
    GROUP BY f.serverId, serverName, f.rawUser, b.id, b.personId, p.displayName
    ORDER BY CASE WHEN b.id IS NULL THEN 0 ELSE 1 END ASC, lastSeenAt DESC
  `).all() as Array<{
    serverId: string;
    serverName: string;
    systemUser: string;
    lastSeenAt: number;
    bindingId: string | null;
    personId: string | null;
    personDisplayName: string | null;
  }>;

  return rows.map((row) => ({
    serverId: row.serverId,
    serverName: row.serverName,
    systemUser: row.systemUser,
    lastSeenAt: row.lastSeenAt,
    activeBinding: row.bindingId && row.personId && row.personDisplayName
      ? {
          bindingId: row.bindingId,
          personId: row.personId,
          personDisplayName: row.personDisplayName,
        }
      : null,
  }));
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
  listPersonBindingCandidates,
  listPersonBindingSuggestions,
} from './db/person-attribution.js';
```

- [ ] **Step 4: Expose the new API and wire it through the UI transport**

Update `packages/web/src/person-routes.ts` with:

```ts
import {
  createPerson,
  createPersonBinding,
  getPersonById,
  getPersonSummaries,
  getPersonTimeline,
  getPersonTasks,
  getServerPersonActivity,
  listPersonBindingCandidates,
  listPersonBindingSuggestions,
  listPersons,
  listPersonBindings,
  updatePerson,
  updatePersonBinding,
  createPersonMobileToken,
  rotatePersonMobileToken,
  revokePersonMobileToken,
  getPersonMobileTokenStatus,
} from '@monitor/core';

app.get('/api/person-binding-candidates', (_req, res) => res.json(listPersonBindingCandidates()));
```

Update `packages/ui/src/transport/types.ts` with:

```ts
import type {
  MirroredAgentTaskRecord,
  PersonBindingCandidate,
  PersonBindingRecord,
  PersonBindingSuggestion,
  PersonRecord,
  PersonSummaryItem,
  PersonTimelinePoint,
  ServerPersonActivity,
} from '@monitor/core';

getPersonBindingCandidates(): Promise<PersonBindingCandidate[]>;
```

Update `packages/ui/src/transport/ws-adapter.ts` with:

```ts
async getPersonBindingCandidates(): Promise<PersonBindingCandidate[]> {
  return this.fetch('/api/person-binding-candidates');
}
```

Add the new mock method to every handwritten transport mock listed in this plan:

```ts
getPersonBindingCandidates: vi.fn(async () => []),
getPersonBindingSuggestions: vi.fn(async () => []),
```

- [ ] **Step 5: Run the focused regression checks**

Run:

```bash
pnpm --filter @monitor/core test -- tests/person/attribution.test.ts
pnpm --filter @monitor/ui typecheck
```

Expected: PASS. The first command proves the selector is correct; the second proves every `TransportAdapter` mock was updated.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/db/person-attribution.ts packages/core/src/index.ts packages/core/tests/person/attribution.test.ts packages/web/src/person-routes.ts packages/ui/src/transport/types.ts packages/ui/src/transport/ws-adapter.ts packages/ui/tests/overview-detail-settings.test.tsx packages/ui/tests/taskqueue-security-pages.test.tsx packages/ui/tests/mobile-person-pages.test.tsx packages/ui/tests/auth-gate.test.tsx packages/ui/tests/operator-bootstrap.test.tsx packages/ui/tests/use-metrics.test.tsx packages/ui/tests/person-pages.test.tsx
git commit -m "feat(ui): add person binding candidates"
```

---

### Task 2: Merge The People Entry Into One Landing Page

**Files:**
- Modify: `packages/ui/src/App.tsx`
- Modify: `packages/ui/src/pages/PeopleOverview.tsx`
- Modify: `packages/ui/tests/person-pages.test.tsx`

- [ ] **Step 1: Write the failing UI test for the merged entry**

Update `packages/ui/tests/person-pages.test.tsx` imports and add this test:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App.js';

it('keeps a single people nav item and launches the add flow from the landing page', async () => {
  const user = userEvent.setup();
  const transport = { ...createMockTransport(), isElectron: true };

  window.history.pushState({}, '', '/');
  const AppWithAdapter = App as unknown as (props: { adapter?: TransportAdapter }) => JSX.Element;
  render(<AppWithAdapter adapter={transport} />);

  expect(await screen.findByRole('link', { name: '人员' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: '人员管理' })).toBeNull();

  await user.click(screen.getByRole('link', { name: '人员' }));

  expect(await screen.findByRole('heading', { name: '人员' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '添加人员' })).toHaveAttribute('href', '/people/new');
});
```

- [ ] **Step 2: Run the focused UI test and confirm it fails**

Run:

```bash
pnpm --filter @monitor/ui test -- tests/person-pages.test.tsx -t "keeps a single people nav item and launches the add flow from the landing page"
```

Expected: FAIL because the sidebar still renders `人员管理`, the `/people` page still uses the old heading, and there is no `/people/new` launch link.

- [ ] **Step 3: Collapse the sidebar and repurpose the landing page**

Update `packages/ui/src/App.tsx` with:

```tsx
const links = [
  { to: '/', icon: DashboardIcon, label: '控制台' },
  { to: '/servers', icon: ServerIcon, label: '节点' },
  { to: '/people', icon: PeopleIcon, label: '人员' },
  { to: '/hooks', icon: HookIcon, label: '钩子规则' },
  { to: '/alerts', icon: AlertIcon, label: '告警' },
  { to: '/tasks', icon: TaskIcon, label: '任务调度' },
  { to: '/security', icon: ShieldIcon, label: '安全审计' },
  { to: '/settings', icon: SettingsIcon, label: '设置' },
];

<Route path="/people" element={<PeopleOverview />} />
<Route path="/people/new" element={<PeopleManage />} />
<Route path="/people/manage" element={<Navigate to="/people/new" replace />} />
<Route path="/people/:id" element={<PersonDetail />} />
```

Update `packages/ui/src/pages/PeopleOverview.tsx` with:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTransport } from '../transport/TransportProvider.js';
import type { PersonRecord, PersonSummaryItem } from '@monitor/core';

export function PeopleOverview() {
  const transport = useTransport();
  const [persons, setPersons] = useState<PersonRecord[]>([]);
  const [summaryRows, setSummaryRows] = useState<PersonSummaryItem[]>([]);

  useEffect(() => {
    void Promise.all([transport.getPersons(), transport.getPersonSummary()])
      .then(([nextPersons, nextSummary]) => {
        setPersons(nextPersons);
        setSummaryRows(nextSummary);
      })
      .catch(() => {
        setPersons([]);
        setSummaryRows([]);
      });
  }, [transport]);

  const summaryById = useMemo(
    () => new Map(summaryRows.map((row) => [row.personId, row])),
    [summaryRows],
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="brand-kicker">PEOPLE</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-100">人员</h1>
          <p className="mt-2 text-sm text-slate-400">浏览现有人员状态，并从这里进入引导式添加流程。</p>
        </div>
        <Link to="/people/new" className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/80">
          添加人员
        </Link>
      </div>

      {persons.length === 0 ? (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-6 text-sm text-slate-400">
          <p>尚未配置人员信息。</p>
          <Link to="/people/new" className="mt-4 inline-flex rounded-lg bg-accent-blue px-4 py-2 text-white hover:bg-accent-blue/80">
            开始添加人员
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {persons.map((person) => {
            const summary = summaryById.get(person.id);
            return (
              <Link key={person.id} to={`/people/${person.id}`} className="block rounded-2xl border border-dark-border bg-dark-card p-5 transition-colors hover:border-accent-blue/30">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-lg text-slate-100">{person.displayName}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${person.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-400'}`}>
                    {person.status === 'active' ? '活跃' : '已归档'}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-400">当前显存 {summary?.currentVramMB ?? 0} MB</p>
                <p className="mt-1 text-sm text-slate-400">运行 {summary?.runningTaskCount ?? 0} · 排队 {summary?.queuedTaskCount ?? 0}</p>
                <p className="mt-1 text-xs text-slate-500">活跃节点 {summary?.activeServerCount ?? 0}</p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Re-run the people-page regressions**

Run:

```bash
pnpm --filter @monitor/ui test -- tests/person-pages.test.tsx
```

Expected: PASS. The landing page test should prove there is only one sidebar entry and that `/people` is now the single browse-first page.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/App.tsx packages/ui/src/pages/PeopleOverview.tsx packages/ui/tests/person-pages.test.tsx
git commit -m "feat(ui): merge people landing page"
```

---

### Task 3: Replace The Old Manage Page With A Guided Create Flow

**Files:**
- Modify: `packages/ui/src/pages/PeopleManage.tsx`
- Create: `packages/ui/tests/person-create-wizard.test.tsx`
- Modify: `packages/ui/tests/person-pages.test.tsx`

- [ ] **Step 1: Write failing wizard tests for both entry modes**

Create `packages/ui/tests/person-create-wizard.test.tsx` with:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TransportProvider } from '../src/transport/TransportProvider.js';
import type { TransportAdapter } from '../src/transport/types.js';
import { PeopleManage } from '../src/pages/PeopleManage.js';

function createWizardTransport(): TransportAdapter {
  return {
    ...createMockTransport(),
    getPersonBindingCandidates: vi.fn(async () => [
      { serverId: 'server-1', serverName: 'gpu-1', systemUser: 'alice', lastSeenAt: 10, activeBinding: null },
      { serverId: 'server-2', serverName: 'gpu-2', systemUser: 'alice-lab', lastSeenAt: 9, activeBinding: null },
      {
        serverId: 'server-3',
        serverName: 'gpu-3',
        systemUser: 'alice-old',
        lastSeenAt: 8,
        activeBinding: {
          bindingId: 'binding-9',
          personId: 'person-9',
          personDisplayName: 'Legacy Alice',
        },
      },
    ]),
    createPerson: vi.fn(async (input) => ({
      id: 'person-new',
      displayName: input.displayName,
      email: input.email ?? '',
      qq: input.qq ?? '',
      note: input.note ?? '',
      customFields: input.customFields,
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    })),
  };
}

it('creates a person from a server user and transfers selected existing bindings after confirmation', async () => {
  const user = userEvent.setup();
  const transport = createWizardTransport();

  render(
    <TransportProvider adapter={transport}>
      <MemoryRouter initialEntries={['/people/new']}>
        <Routes>
          <Route path="/people/new" element={<PeopleManage />} />
          <Route path="/people/:id" element={<div>detail page</div>} />
        </Routes>
      </MemoryRouter>
    </TransportProvider>
  );

  await user.click(await screen.findByRole('button', { name: '从服务器用户开始' }));
  await user.click(await screen.findByRole('button', { name: /选择 gpu-1 · alice/i }));
  await user.click(screen.getByRole('button', { name: '下一步' }));

  await user.type(screen.getByLabelText('显示名称'), 'Alice Zhang');
  await user.click(screen.getByRole('button', { name: '下一步' }));

  await user.click(await screen.findByRole('checkbox', { name: /alice-lab/i }));
  await user.click(screen.getByRole('checkbox', { name: /alice-old/i }));
  await user.click(screen.getByRole('button', { name: '下一步' }));

  expect(screen.getByText(/Legacy Alice/)).toBeTruthy();
  await user.click(screen.getByRole('checkbox', { name: '我确认转移已绑定账号' }));
  await user.click(screen.getByRole('button', { name: '创建人员' }));

  await waitFor(() => {
    expect(transport.createPerson).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Alice Zhang' }));
    expect(transport.updatePersonBinding).toHaveBeenCalledWith('binding-9', expect.objectContaining({ enabled: false }));
    expect(transport.createPersonBinding).toHaveBeenCalledTimes(3);
  });

  expect(await screen.findByText('detail page')).toBeTruthy();
});

it('supports the manual entry path without creating bindings', async () => {
  const user = userEvent.setup();
  const transport = createWizardTransport();

  render(
    <TransportProvider adapter={transport}>
      <MemoryRouter initialEntries={['/people/new']}>
        <Routes>
          <Route path="/people/new" element={<PeopleManage />} />
          <Route path="/people/:id" element={<div>detail page</div>} />
        </Routes>
      </MemoryRouter>
    </TransportProvider>
  );

  await user.click(await screen.findByRole('button', { name: '手动创建空白人员' }));
  await user.type(screen.getByLabelText('显示名称'), 'Manual Person');
  await user.click(screen.getByRole('button', { name: '下一步' }));
  await user.click(screen.getByRole('button', { name: '下一步' }));
  await user.click(screen.getByRole('button', { name: '创建人员' }));

  await waitFor(() => {
    expect(transport.createPerson).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Manual Person' }));
    expect(transport.createPersonBinding).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the new wizard tests and confirm they fail**

Run:

```bash
pnpm --filter @monitor/ui test -- tests/person-create-wizard.test.tsx
```

Expected: FAIL because `PeopleManage` still renders the old inline form and does not support steps, candidate loading, transfer confirmation, or navigation to `/people/:id`.

- [ ] **Step 3: Implement the guided wizard in `PeopleManage`**

Replace `packages/ui/src/pages/PeopleManage.tsx` with:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTransport } from '../transport/TransportProvider.js';
import type { PersonBindingCandidate } from '@monitor/core';

type WizardMode = 'seed-user' | 'manual';
type WizardStep = 'entry' | 'seed' | 'profile' | 'bindings' | 'review';

function longestCommonSubsequence(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function scoreCandidateMatch(seedUser: string, candidateUser: string): number {
  if (seedUser === candidateUser) return 100;
  if (seedUser.includes(candidateUser) || candidateUser.includes(seedUser)) return 70;
  return longestCommonSubsequence(seedUser, candidateUser);
}

export function PeopleManage() {
  const navigate = useNavigate();
  const transport = useTransport();
  const [mode, setMode] = useState<WizardMode | null>(null);
  const [step, setStep] = useState<WizardStep>('entry');
  const [candidates, setCandidates] = useState<PersonBindingCandidate[]>([]);
  const [seed, setSeed] = useState<PersonBindingCandidate | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ displayName: '', email: '', qq: '', note: '' });

  useEffect(() => {
    void transport.getPersonBindingCandidates().then(setCandidates).catch(() => setCandidates([]));
  }, [transport]);

  const relatedCandidates = useMemo(() => {
    if (!seed) {
      return candidates;
    }
    return candidates
      .filter((candidate) => `${candidate.serverId}:${candidate.systemUser}` !== `${seed.serverId}:${seed.systemUser}`)
      .map((candidate) => ({ candidate, score: scoreCandidateMatch(seed.systemUser, candidate.systemUser) }))
      .filter((entry) => entry.score >= 2)
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.candidate);
  }, [candidates, seed]);

  const selectedCandidates = useMemo(() => {
    const items: PersonBindingCandidate[] = [];
    if (seed) {
      items.push(seed);
    }
    for (const candidate of relatedCandidates) {
      const key = `${candidate.serverId}:${candidate.systemUser}`;
      if (selectedKeys.has(key)) {
        items.push(candidate);
      }
    }
    return items;
  }, [relatedCandidates, seed, selectedKeys]);

  const needsTransferConfirmation = selectedCandidates.some(
    (candidate) => candidate.activeBinding && candidate.activeBinding.personId !== 'person-new-placeholder',
  );

  async function handleSubmit() {
    if (!form.displayName.trim()) return;
    if (needsTransferConfirmation && !confirmTransfer) return;

    setSubmitting(true);
    try {
      const person = await transport.createPerson({
        displayName: form.displayName,
        email: form.email,
        qq: form.qq,
        note: form.note,
        customFields: {},
      });

      const effectiveFrom = Date.now();

      for (const candidate of selectedCandidates) {
        if (candidate.activeBinding) {
          await transport.updatePersonBinding(candidate.activeBinding.bindingId, {
            enabled: false,
            effectiveTo: effectiveFrom,
          });
        }

        await transport.createPersonBinding({
          personId: person.id,
          serverId: candidate.serverId,
          systemUser: candidate.systemUser,
          source: 'manual',
          effectiveFrom,
        });
      }

      navigate(`/people/${person.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="brand-kicker">PEOPLE</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-100">添加人员</h1>
          <p className="mt-2 text-sm text-slate-400">先识别这个人，再决定要归并哪些服务器账号。</p>
        </div>
        <Link to="/people" className="rounded-lg border border-dark-border px-4 py-2 text-sm text-slate-300 hover:bg-white/5">
          返回人员列表
        </Link>
      </div>

      {step === 'entry' && (
        <div className="grid gap-4 md:grid-cols-2">
          <button type="button" onClick={() => { setMode('seed-user'); setStep('seed'); }} className="rounded-2xl border border-dark-border bg-dark-card p-5 text-left text-slate-100">
            从服务器用户开始
          </button>
          <button type="button" onClick={() => { setMode('manual'); setStep('profile'); }} className="rounded-2xl border border-dark-border bg-dark-card p-5 text-left text-slate-100">
            手动创建空白人员
          </button>
        </div>
      )}

      {step === 'seed' && (
        <div className="space-y-3">
          {candidates.map((candidate) => {
            const key = `${candidate.serverId}:${candidate.systemUser}`;
            return (
              <button key={key} type="button" onClick={() => setSeed(candidate)} aria-label={`选择 ${candidate.serverName} · ${candidate.systemUser}`} className={`w-full rounded-2xl border p-4 text-left ${seed && key === `${seed.serverId}:${seed.systemUser}` ? 'border-accent-blue bg-accent-blue/10' : 'border-dark-border bg-dark-card'}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-100">{candidate.serverName} · {candidate.systemUser}</span>
                  <span className="text-xs text-slate-400">
                    {candidate.activeBinding ? `已绑定到 ${candidate.activeBinding.personDisplayName}` : '未绑定'}
                  </span>
                </div>
              </button>
            );
          })}
          <div className="flex justify-between">
            <button type="button" onClick={() => setStep('entry')} className="rounded-lg border border-dark-border px-4 py-2 text-sm text-slate-300">上一步</button>
            <button type="button" disabled={!seed} onClick={() => setStep('profile')} className="rounded-lg bg-accent-blue px-4 py-2 text-sm text-white disabled:opacity-50">下一步</button>
          </div>
        </div>
      )}

      {step === 'profile' && (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-5 space-y-3">
          <label className="block text-sm text-slate-300">
            显示名称
            <input aria-label="显示名称" value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} className="mt-2 w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200" />
          </label>
          <label className="block text-sm text-slate-300">
            邮箱
            <input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className="mt-2 w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200" />
          </label>
          <label className="block text-sm text-slate-300">
            QQ
            <input value={form.qq} onChange={(event) => setForm((current) => ({ ...current, qq: event.target.value }))} className="mt-2 w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200" />
          </label>
          <label className="block text-sm text-slate-300">
            备注
            <input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} className="mt-2 w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200" />
          </label>
          <div className="flex justify-between">
            <button type="button" onClick={() => setStep(mode === 'seed-user' ? 'seed' : 'entry')} className="rounded-lg border border-dark-border px-4 py-2 text-sm text-slate-300">上一步</button>
            <button type="button" disabled={!form.displayName.trim()} onClick={() => setStep('bindings')} className="rounded-lg bg-accent-blue px-4 py-2 text-sm text-white disabled:opacity-50">下一步</button>
          </div>
        </div>
      )}

      {step === 'bindings' && (
        <div className="space-y-3">
          {mode === 'manual' && <p className="text-sm text-slate-400">手动模式下可以跳过账号归并，稍后在详情页继续补绑。</p>}
          {relatedCandidates.map((candidate) => {
            const key = `${candidate.serverId}:${candidate.systemUser}`;
            return (
              <label key={key} className="flex items-center justify-between rounded-2xl border border-dark-border bg-dark-card p-4 text-sm text-slate-200">
                <span>{candidate.serverName} · {candidate.systemUser}</span>
                <input aria-label={`${candidate.serverName} · ${candidate.systemUser}`} type="checkbox" checked={selectedKeys.has(key)} onChange={(event) => {
                  setSelectedKeys((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(key);
                    else next.delete(key);
                    return next;
                  });
                }} />
              </label>
            );
          })}
          <div className="flex justify-between">
            <button type="button" onClick={() => setStep('profile')} className="rounded-lg border border-dark-border px-4 py-2 text-sm text-slate-300">上一步</button>
            <button type="button" onClick={() => setStep('review')} className="rounded-lg bg-accent-blue px-4 py-2 text-sm text-white">下一步</button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-5 space-y-4">
          <div>
            <p className="text-sm text-slate-400">显示名称</p>
            <p className="text-slate-100">{form.displayName}</p>
          </div>
          <div className="space-y-2">
            {selectedCandidates.map((candidate) => (
              <div key={`${candidate.serverId}:${candidate.systemUser}`} className="rounded-lg border border-dark-border bg-dark-bg p-3 text-sm text-slate-200">
                <div>{candidate.serverName} · {candidate.systemUser}</div>
                {candidate.activeBinding && (
                  <div className="mt-1 text-xs text-yellow-400">当前绑定到 {candidate.activeBinding.personDisplayName}</div>
                )}
              </div>
            ))}
          </div>
          {needsTransferConfirmation && (
            <label className="flex items-center gap-2 text-sm text-yellow-300">
              <input type="checkbox" checked={confirmTransfer} onChange={(event) => setConfirmTransfer(event.target.checked)} />
              我确认转移已绑定账号
            </label>
          )}
          <div className="flex justify-between">
            <button type="button" onClick={() => setStep('bindings')} className="rounded-lg border border-dark-border px-4 py-2 text-sm text-slate-300">上一步</button>
            <button type="button" disabled={submitting || !form.displayName.trim() || (needsTransferConfirmation && !confirmTransfer)} onClick={() => void handleSubmit()} className="rounded-lg bg-accent-blue px-4 py-2 text-sm text-white disabled:opacity-50">创建人员</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Re-run wizard tests and the merged people-page tests**

Run:

```bash
pnpm --filter @monitor/ui test -- tests/person-create-wizard.test.tsx tests/person-pages.test.tsx
pnpm --filter @monitor/ui typecheck
```

Expected: PASS. The first command proves both wizard entry modes work and that transfer confirmation gates rebinding; the second catches any route or mock drift.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/pages/PeopleManage.tsx packages/ui/tests/person-create-wizard.test.tsx packages/ui/tests/person-pages.test.tsx
git commit -m "feat(ui): add guided people creation flow"
```

---

## Self-Review

### Spec coverage

- Single merged people tab: covered by Task 2.
- Browse-first landing page: covered by Task 2.
- Add-person flow launched from the landing page: covered by Task 2 and Task 3.
- Two creation entry modes with server-user-first as the recommended path: covered by Task 3.
- Show all observed system users, not just unbound ones: covered by Task 1.
- Auto-suggest related accounts using username equality or similarity, but require manual selection: covered by Task 3.
- Require only display name during creation: covered by Task 3.
- Allow rebinding already-bound accounts only with explicit confirmation: covered by Task 3.
- Navigate to the new person detail page after success: covered by Task 3.

### Placeholder scan

- No `TODO`, `TBD`, or deferred implementation notes remain.
- Every code-changing step includes concrete code.
- Every test step includes an exact command and expected result.

### Type consistency

- The new transport method is named `getPersonBindingCandidates` everywhere.
- The derived row type is consistently named `PersonBindingCandidate`.
- The guided page remains `PeopleManage` in code while routing at `/people/new`, which keeps scope light without forcing a rename pass.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-03-people-unified-tab-and-wizard.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using the `executing-plans` agent, batch execution with checkpoints

**Which approach?**