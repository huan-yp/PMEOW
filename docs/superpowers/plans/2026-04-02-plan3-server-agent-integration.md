# Plan 3: Server-Agent Integration and GPU Backend Support

> **For agentic workers:** REQUIRED: Use the `subagent-driven-development` agent (recommended) or `executing-plans` agent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Python Agents into the PMEOW server runtime so that the server can accept Agent connections, mirror task/runtime state, persist GPU allocation data, and expose a minimal read/control surface without taking over scheduling decisions from the Agent.

**Architecture:** `packages/core/` owns shared Agent protocol types, binding rules, task mirror persistence, GPU usage persistence, and Agent live-session abstractions. `packages/web/` owns the actual `/agent` Socket.IO namespace, connection lifecycle, REST read APIs, and minimal control-plane APIs. `Scheduler` remains the unified post-processing pipeline for metrics, alerts, hooks, and status updates, but it does not become a second scheduler for Agent tasks.

**Tech Stack:** TypeScript, Express, Socket.IO namespace, better-sqlite3, vitest, supertest, socket.io-client

**Out of Scope:** Security analysis engine and `security_events`; task pages and Security page UI; global GPU reporting APIs such as `/api/gpu-overview` and `/api/gpu-usage/*`; remote task submission from the server; server-side admission or queue scheduling; offline command replay.

**Precondition:** This plan assumes the server uses a Socket.IO `/agent` namespace. If the Plan 2 Agent transport implementation is still raw WebSocket only, fix the Agent client to become Socket.IO-compatible before executing the namespace tasks in this plan. Do not weaken the server runtime into a second protocol stack just to preserve a temporary client mismatch.

---

### Task 1: Add web test infrastructure and extract a testable runtime

**Files:**
- Modify: `packages/web/package.json`
- Modify: `packages/web/src/server.ts`
- Create: `packages/web/vitest.config.ts`
- Create: `packages/web/tests/setup.ts`
- Create: `packages/web/src/app.ts`
- Create: `packages/web/tests/app.smoke.test.ts`

- [ ] **Step 1: Add a web test runner and dependencies**

In `packages/web/package.json`, add:
- test scripts for vitest
- dev dependencies for `vitest`, `supertest`, and `socket.io-client`

- [ ] **Step 2: Extract the bootstrapping logic from `server.ts`**

Move runtime creation into `packages/web/src/app.ts` so tests can instantiate the Express app, HTTP server, Socket.IO server, and `Scheduler` without binding a real port.

- [ ] **Step 3: Keep `server.ts` as a thin production entrypoint**

After extraction, `packages/web/src/server.ts` should only:
- create the runtime through the factory
- listen on the configured port
- wire graceful shutdown

- [ ] **Step 4: Add a smoke test for runtime creation**

Create `packages/web/tests/app.smoke.test.ts` covering:
- app factory returns an Express app and HTTP server
- protected routes remain mounted
- the scheduler can be injected or created without throwing

- [ ] **Step 5: Run tests**

Run:
```bash
cd packages/web && pnpm test
```

Expected: web smoke tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/web/package.json packages/web/src/server.ts packages/web/src/app.ts packages/web/vitest.config.ts packages/web/tests/
git commit -m "chore(web): add testable runtime and web test harness"
```

---

### Task 2: Define Agent protocol and shared runtime types

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/src/agent/protocol.ts`
- Create: `packages/core/tests/agent/protocol.test.ts`

- [ ] **Step 1: Add runtime models for Agent-backed server state**

In `packages/core/src/types.ts`, add types for:
- Agent register payload
- Agent heartbeat payload
- Agent task update payload
- GPU allocation summary data coming from the Agent
- mirrored Agent task records used by the server read model

Keep `MetricsSnapshot` backward-compatible by making `gpuAllocation` optional.

- [ ] **Step 2: Define command payloads in a dedicated protocol module**

Create `packages/core/src/agent/protocol.ts` with discriminated unions and lightweight runtime guards for:
- Agent outbound events:
  - `agent:register`
  - `agent:metrics`
  - `agent:taskUpdate`
  - `agent:heartbeat`
- Server outbound commands:
  - `server:cancelTask`
  - `server:pauseQueue`
  - `server:resumeQueue`
  - `server:setPriority`

- [ ] **Step 3: Export the new protocol and types from core**

Update `packages/core/src/index.ts` so web can import protocol helpers directly from `@monitor/core`.

- [ ] **Step 4: Add protocol tests**

Create `packages/core/tests/agent/protocol.test.ts` covering:
- valid register payload accepted
- valid task update payload accepted
- metrics payload may contain optional `gpuAllocation`
- malformed command payload rejected

- [ ] **Step 5: Run tests**

Run:
```bash
cd packages/core && pnpm test
```

Expected: core tests pass with the new protocol tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/index.ts packages/core/src/agent/protocol.ts packages/core/tests/agent/protocol.test.ts
git commit -m "feat(core): define agent protocol and shared runtime types"
```

---

### Task 3: Add database schema for task mirrors and GPU usage persistence

**Files:**
- Modify: `packages/core/src/db/database.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/src/db/agent-tasks.ts`
- Create: `packages/core/src/db/gpu-usage.ts`
- Create: `packages/core/tests/db/agent-tasks.test.ts`
- Create: `packages/core/tests/db/gpu-usage.test.ts`

- [ ] **Step 1: Add `agent_tasks` and `gpu_usage_stats` tables**

In `packages/core/src/db/database.ts`, add schema and idempotent migration logic for:
- `agent_tasks`
- `gpu_usage_stats`

`agent_tasks` should hold the server-side mirrored queue/task state.

`gpu_usage_stats` should hold flattened per-sample per-user or per-task GPU usage rows.

- [ ] **Step 2: Add repository helpers for task mirror persistence**

Create `packages/core/src/db/agent-tasks.ts` with methods such as:
- `upsertAgentTask()`
- `getAgentTask()`
- `getAgentTasksByServerId()`
- `deleteAgentTasksByServerId()`

- [ ] **Step 3: Add repository helpers for GPU usage persistence**

Create `packages/core/src/db/gpu-usage.ts` with methods such as:
- `saveGpuUsageRows()`
- `getLatestGpuUsageByServerId()`
- `cleanOldGpuUsage()`

Do not add global report queries yet. Those belong to the later plan.

- [ ] **Step 4: Add migration and repository tests**

Create tests covering:
- migrations are safe on a fresh and pre-migration database
- `agent_tasks` upsert is idempotent
- `gpu_usage_stats` writes and cleans old rows correctly

- [ ] **Step 5: Run tests**

Run: `cd packages/core && pnpm test`
Expected: core tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/database.ts packages/core/src/index.ts packages/core/src/db/agent-tasks.ts packages/core/src/db/gpu-usage.ts packages/core/tests/db/agent-tasks.test.ts packages/core/tests/db/gpu-usage.test.ts
git commit -m "feat(core): add agent task mirror and gpu usage schema"
```

---

### Task 4: Implement Agent ingest services for metrics and task updates

**Files:**
- Modify: `packages/core/src/db/metrics.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/src/agent/ingest.ts`
- Create: `packages/core/tests/agent/ingest.test.ts`

- [ ] **Step 1: Create a dedicated Agent ingest module**

Create `packages/core/src/agent/ingest.ts` that exposes server-side write paths for:
- handling an Agent metrics payload
- handling an Agent task update payload
- translating `gpuAllocation` into `gpu_usage_stats` rows

- [ ] **Step 2: Extend metrics persistence to keep `gpuAllocation`**

Update `packages/core/src/db/metrics.ts` so `MetricsSnapshot` with optional `gpuAllocation` is preserved in the JSON payload without breaking old SSH snapshots.

- [ ] **Step 3: Keep task update writes idempotent**

For repeated `taskUpdate` events, upsert by task id and preserve the latest status, timestamps, exit code, and PID as appropriate.

- [ ] **Step 4: Add ingest tests**

Create tests covering:
- metrics with `gpuAllocation` are stored and can be read back
- per-process GPU allocation data is flattened into `gpu_usage_stats`
- repeated task updates do not create duplicate task mirror rows
- task status progression does not lose fields during upsert

- [ ] **Step 5: Run tests**

Run: `cd packages/core && pnpm test`
Expected: core tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/metrics.ts packages/core/src/index.ts packages/core/src/agent/ingest.ts packages/core/tests/agent/ingest.test.ts
git commit -m "feat(core): persist agent metrics, gpu usage, and task updates"
```

---

### Task 5: Extend AgentDataSource with live session and command support

**Files:**
- Modify: `packages/core/src/datasource/types.ts`
- Modify: `packages/core/src/datasource/agent-datasource.ts`
- Modify: `packages/core/src/datasource/factory.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/tests/datasource/agent-datasource.test.ts`
- Create: `packages/core/src/agent/registry.ts`
- Create: `packages/core/tests/agent/registry.test.ts`

- [ ] **Step 1: Define a live session abstraction**

In `packages/core/src/agent/registry.ts`, define an adapter interface representing an active Agent session that can:
- emit command payloads
- expose current connection identity
- be replaced on reconnect

- [ ] **Step 2: Implement Agent session registry**

The registry should map:
- `agentId` to live session
- optional `serverId` linkage once binding is resolved
- last heartbeat timestamp

- [ ] **Step 3: Extend `AgentDataSource` with live command methods**

Update `packages/core/src/datasource/agent-datasource.ts` so it can:
- attach or replace a live session
- mark itself connected or disconnected from registry events
- send `cancelTask`, `pauseQueue`, `resumeQueue`, and `setPriority` commands

Keep these command methods Agent-only. Do not add them to generic `NodeDataSource`.

- [ ] **Step 4: Update tests**

Extend datasource tests and add registry tests covering:
- attach session marks datasource connected
- replacing a session invalidates the old one
- offline datasource rejects command dispatch cleanly
- command payloads are emitted with the expected event names and shapes

- [ ] **Step 5: Run tests**

Run: `cd packages/core && pnpm test`
Expected: core tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/datasource/types.ts packages/core/src/datasource/agent-datasource.ts packages/core/src/datasource/factory.ts packages/core/src/index.ts packages/core/tests/datasource/agent-datasource.test.ts packages/core/src/agent/registry.ts packages/core/tests/agent/registry.test.ts
git commit -m "feat(core): add agent registry and command-capable agent datasource"
```

---

### Task 6: Implement Agent binding by hostname and datasource refresh rules

**Files:**
- Modify: `packages/core/src/db/servers.ts`
- Modify: `packages/core/src/scheduler.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/tests/db/servers.test.ts`
- Create: `packages/core/src/agent/binding.ts`
- Create: `packages/core/tests/agent/binding.test.ts`

- [ ] **Step 1: Create a binding service for registration resolution**

In `packages/core/src/agent/binding.ts`, implement rules for:
- exact hostname matching against `servers.host`
- unique match means automatic bind
- multiple matches means unresolved conflict
- same `agentId` reconnect means restore the previous binding

- [ ] **Step 2: Extend servers repository with binding helpers**

Add helpers to:
- bind an `agentId` to a server
- read a server by `agentId`
- read possible server matches by hostname

- [ ] **Step 3: Refresh scheduler datasources when binding changes**

Update `packages/core/src/scheduler.ts` so when a server is newly switched from SSH to Agent mode:
- old SSH datasource is disconnected
- fresh Agent datasource is attached
- duplicated collection paths do not remain active

- [ ] **Step 4: Add binding tests**

Create tests covering:
- unique hostname auto-binds and flips `sourceType` to `agent`
- duplicate hostname refuses automatic bind
- reconnecting same `agentId` recovers previous server binding
- datasource refresh does not leave a stale SSH connection path alive

- [ ] **Step 5: Run tests**

Run: `cd packages/core && pnpm test`
Expected: core tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/servers.ts packages/core/src/scheduler.ts packages/core/src/index.ts packages/core/tests/db/servers.test.ts packages/core/src/agent/binding.ts packages/core/tests/agent/binding.test.ts
git commit -m "feat(core): bind agents to servers by hostname"
```

---

### Task 7: Add the `/agent` namespace and heartbeat lifecycle in web

**Files:**
- Modify: `packages/web/src/app.ts`
- Create: `packages/web/src/agent-namespace.ts`
- Create: `packages/web/tests/agent-namespace.test.ts`

- [ ] **Step 1: Create a dedicated Agent namespace module**

In `packages/web/src/agent-namespace.ts`, set up the `/agent` Socket.IO namespace and connection lifecycle handling.

- [ ] **Step 2: Handle register, heartbeat, and disconnect**

On the namespace connection, support:
- `agent:register`
- `agent:heartbeat`
- `disconnect`

Wire these events into the registry and binding services.

- [ ] **Step 3: Add heartbeat timeout handling**

Implement a timeout sweep so missed heartbeats mark the Agent datasource as disconnected while preserving last known task and GPU mirror state.

- [ ] **Step 4: Add namespace lifecycle tests**

Create tests covering:
- register creates or replaces a live session
- heartbeats refresh last-seen state
- disconnect marks the Agent offline
- reconnect with the same `agentId` replaces the old session cleanly

- [ ] **Step 5: Run tests**

Run: `cd packages/web && pnpm test`
Expected: web tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app.ts packages/web/src/agent-namespace.ts packages/web/tests/agent-namespace.test.ts
git commit -m "feat(web): add agent namespace and heartbeat lifecycle"
```

---

### Task 8: Ingest Agent updates and expose minimal read APIs

**Files:**
- Modify: `packages/web/src/app.ts`
- Modify: `packages/web/src/agent-namespace.ts`
- Create: `packages/web/src/agent-routes.ts`
- Create: `packages/web/tests/agent-routes.read.test.ts`

- [ ] **Step 1: Wire metrics and task update ingress into core services**

Update the namespace handling so:
- `agent:metrics` goes through the Agent ingest service and then through the existing scheduler post-processing path where appropriate
- `agent:taskUpdate` updates the task mirror read model

- [ ] **Step 2: Add minimal read-only APIs**

Create `packages/web/src/agent-routes.ts` and add:
- `GET /api/servers/:id/tasks`
- `GET /api/servers/:id/tasks/:taskId`
- `GET /api/servers/:id/gpu-allocation`

The GPU allocation endpoint should read from the latest mirrored metrics snapshot. Do not add global GPU report endpoints yet.

- [ ] **Step 3: Keep live and persisted state distinct**

If an Agent disconnects, read APIs must still return the last known mirrored task and GPU state instead of clearing everything.

- [ ] **Step 4: Add read API tests**

Create tests covering:
- metrics ingress preserves `gpuAllocation`
- task update ingress feeds the task mirror API
- GPU allocation endpoint returns the latest mirrored allocation
- disconnect does not erase persisted read state

- [ ] **Step 5: Run tests**

Run: `cd packages/web && pnpm test`
Expected: web tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app.ts packages/web/src/agent-namespace.ts packages/web/src/agent-routes.ts packages/web/tests/agent-routes.read.test.ts
git commit -m "feat(web): ingest agent updates and expose task read APIs"
```

---

### Task 9: Add the minimal Agent control-plane APIs

**Files:**
- Modify: `packages/web/src/agent-routes.ts`
- Modify: `packages/web/src/agent-namespace.ts`
- Modify: `packages/core/src/agent/registry.ts`
- Modify: `packages/core/src/datasource/agent-datasource.ts`
- Create: `packages/web/tests/agent-routes.control.test.ts`

- [ ] **Step 1: Add REST endpoints for minimal server-side intervention**

Add these routes:
- `POST /api/servers/:id/tasks/:taskId/cancel`
- `POST /api/servers/:id/queue/pause`
- `POST /api/servers/:id/queue/resume`
- `POST /api/servers/:id/tasks/:taskId/priority`

- [ ] **Step 2: Define strict delivery semantics**

The API should:
- return success only when the command is accepted for dispatch
- return `409` when the server exists but no live Agent session is attached
- return `404` when the server or task does not exist
- avoid mutating the mirrored task state optimistically before the Agent sends back a `taskUpdate`

- [ ] **Step 3: Dispatch through the registry-backed datasource**

Route handlers should resolve the Agent datasource and send the correct command payload instead of writing directly to DB tables.

- [ ] **Step 4: Add control API tests**

Create tests covering:
- cancel command reaches the Agent session
- pause and resume commands reach the Agent session
- set-priority validates request body and dispatches the correct payload
- offline Agent returns `409`

- [ ] **Step 5: Run tests**

Run: `cd packages/web && pnpm test`
Expected: web tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/agent-routes.ts packages/web/src/agent-namespace.ts packages/core/src/agent/registry.ts packages/core/src/datasource/agent-datasource.ts packages/web/tests/agent-routes.control.test.ts
git commit -m "feat(web): add minimal agent control plane APIs"
```

---

### Task 10: End-to-end server integration verification

**Files:**
- Modify: `packages/web/package.json`
- Modify: `packages/web/tests/setup.ts`
- Create: `packages/web/tests/agent-integration.test.ts`

- [ ] **Step 1: Build a reusable Agent test stub**

In the web test suite, add a Socket.IO client stub that can behave like a Python Agent for:
- register
- heartbeat
- metrics
- task updates
- receiving commands

- [ ] **Step 2: Add a full integration test**

Create `packages/web/tests/agent-integration.test.ts` covering the happy path:
- unique hostname registration auto-binds the Agent
- source type flips to `agent`
- metrics with `gpuAllocation` flow into `metrics` and `gpu_usage_stats`
- task updates populate the mirrored task API
- control APIs deliver commands back to the stub Agent

- [ ] **Step 3: Add recovery-path coverage**

Extend the integration tests to cover:
- heartbeat timeout marks the Agent offline
- last known read model data survives disconnect
- reconnect with the same `agentId` restores the live session
- after reconnect, new metrics and commands still work

- [ ] **Step 4: Run verification**

Run:
```bash
cd /home/dev/workspace/Projects/pmeow && pnpm --filter @monitor/core test
cd /home/dev/workspace/Projects/pmeow && pnpm --filter @monitor/web test
cd /home/dev/workspace/Projects/pmeow && pnpm --filter @monitor/web exec tsc --noEmit
cd /home/dev/workspace/Projects/pmeow && pnpm --filter @monitor/core exec tsc --noEmit
```

Expected:
- all core tests pass
- all web tests pass
- TypeScript checks pass in core and web

- [ ] **Step 5: Commit**

```bash
git add packages/web/package.json packages/web/tests/setup.ts packages/web/tests/agent-integration.test.ts
git commit -m "test(web): cover agent integration and reconnect recovery"
```

---

## Notes for the Next Plan

After Plan 3 is complete, Plan 4 should focus on the user-facing and analysis-facing surface:
- Tasks page and queue visualization
- ServerDetail task tab and GPU allocation UI
- Overview GPU user distribution cards
- Security event generation and review workflow
- global GPU reporting APIs needed by those pages