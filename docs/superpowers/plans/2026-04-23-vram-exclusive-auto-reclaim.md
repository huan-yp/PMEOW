# VRAM Exclusive Auto Reclaim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement explicit VRAM mode semantics and per-GPU one-shot auto reclaim for `exclusive_auto` tasks.

**Architecture:** `vramMode` and `requestedVramMb` become the canonical task semantics. Agent scheduling and GPU attribution use per-GPU reclaim maps to decide whether each GPU remains exclusive or has returned to shared accounting. Server and clients persist and render the same canonical fields.

**Tech Stack:** Python dataclasses for the agent, TypeScript contracts/server, SQLite via `better-sqlite3`, React web UI, React Native mobile UI.

---

### Task 1: Agent Task Model And CLI Semantics

**Files:**
- Modify: `agent/pmeow/models.py`
- Modify: `agent/pmeow/__main__.py`
- Modify: `agent/pmeow/cli_foreground.py`
- Modify: `agent/pmeow/daemon/socket_server.py`
- Modify: `agent/pmeow/state/task_queue.py`

- [ ] Add `VramMode` enum and task fields for `requested_vram_mb`, `vram_mode`, `auto_observe_window_sec`, `auto_peak_vram_by_gpu_mb`, `auto_reclaimed_vram_by_gpu_mb`, and `auto_reclaim_done`.
- [ ] Make dict serialization safe for integer GPU keys by stringifying non-string dict keys.
- [ ] Make CLI submit and foreground mode emit `requested_vram_mb` and `vram_mode` directly: omitted VRAM maps to `exclusive_auto`; explicit 0 and positive values map to `shared`.
- [ ] Make socket submission normalize missing new fields by the new rule only: omitted means `exclusive_auto`, otherwise `shared`.
- [ ] Copy the new fields from `TaskSpec` into `TaskRecord` and `TaskInfo`.

### Task 2: Agent Scheduling, Attribution, And Per-GPU Reclaim

**Files:**
- Modify: `agent/pmeow/queue/scheduler.py`
- Modify: `agent/pmeow/collector/gpu_attribution.py`
- Modify: `agent/pmeow/collector/snapshot.py`
- Modify: `agent/pmeow/daemon/service.py`

- [ ] Change scheduler exclusivity to `vram_mode == exclusive_auto`, not `require_vram_mb == 0` or `declared_vram_mb == 0`.
- [ ] Add per-GPU helper logic so a reclaimed GPU uses `auto_reclaimed_vram_by_gpu_mb[gpu_id]`, while a `null` or missing value remains exclusive.
- [ ] Update GPU attribution to expose per-GPU `exclusive_active` and declared reservation values.
- [ ] Add daemon observation logic after collection and queue tick: record `auto_peak_vram_by_gpu_mb[gpu_id]`, decide each assigned GPU independently after the window, and log observed/reclaimed/skipped events.
- [ ] Include VRAM mode and auto reclaim fields in schedule snapshots and task logs.

### Task 3: Contracts, Protocol, And Persistence

**Files:**
- Modify: `server/contracts/src/types.ts`
- Modify: `server/contracts/src/protocol.ts`
- Modify: `server/core/src/db/database.ts`
- Modify: `server/core/src/db/tasks.ts`

- [ ] Add `VramMode`, task fields, and wider schedule snapshot typing to contracts.
- [ ] Normalize wire reports with `vramMode` and `requestedVramMb`; do not keep omit-field fallback.
- [ ] Add SQLite columns for requested VRAM, mode, observe window, per-GPU peak JSON, per-GPU reclaim JSON, and reclaim done.
- [ ] Map task rows to API objects with parsed per-GPU JSON maps.
- [ ] Upsert the new task fields from incoming reports.

### Task 4: Web And Mobile Rendering

**Files:**
- Modify: `apps/web/src/utils/vram.ts`
- Modify: `apps/web/src/components/TaskBrowser.tsx`
- Modify: `apps/web/src/pages/TaskDetail.tsx`
- Modify: `apps/web/src/hooks/useMetrics.ts`
- Modify: `apps/mobile/src/components/common.tsx`
- Modify: `apps/mobile/src/screens/PersonTaskDetailScreen.tsx`

- [ ] Render task VRAM from `vramMode` and `requestedVramMb`.
- [ ] Remove omit-field fallback from Web and Mobile rendering.
- [ ] Add task-detail display for observe window, per-GPU peak, and per-GPU reclaim status.
- [ ] Ensure realtime task-event mapping copies all new fields into the local task model.

### Task 5: Verification

**Files:**
- Read only: package and project config files as needed.

- [ ] Do not add automated tests.
- [ ] Run focused Python syntax/import checks for edited agent modules.
- [ ] Run focused TypeScript checks if the repository exposes a practical command.
- [ ] If a check is blocked by existing unrelated workspace changes, report the blocker explicitly.
