# Plan 2: Python Agent Foundation

> **For agentic workers:** REQUIRED: Use the `subagent-driven-development` agent (recommended) or `executing-plans` agent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone Python Agent that runs on compute nodes, collects local metrics, tracks GPU ownership, maintains a local task queue, schedules jobs autonomously, and reports minimal runtime state back to PMEOW Server.

**Architecture:** The Agent is an independent Python project under `agent/`. It has four major layers: collectors, queue/scheduler, executor, and transport. The daemon owns the local queue and scheduling decisions. The CLI only talks to the daemon over a local Unix socket. The server remains an observer/intervention point, not the primary scheduler.

**Tech Stack:** Python 3.10+, pytest, psutil, websocket-client, sqlite3, argparse, threading or asyncio (implementation choice allowed if kept consistent)

**Out of Scope:** Full server-side Agent namespace implementation, task management REST APIs, UI pages, security analysis engine, global GPU usage aggregation APIs, Conda environment management.

---

### Task 1: Bootstrap the Python Agent project

**Files:**
- Create: `agent/pyproject.toml`
- Create: `agent/README.md`
- Create: `agent/pmeow/__init__.py`
- Create: `agent/pmeow/__main__.py`
- Create: `agent/pmeow/config.py`
- Create: `agent/tests/conftest.py`
- Create: `agent/tests/test_smoke.py`

- [ ] **Step 1: Create the Python project skeleton**

Create the directory structure:
```text
agent/
  pyproject.toml
  README.md
  pmeow/
    __init__.py
    __main__.py
    config.py
  tests/
    conftest.py
    test_smoke.py
```

- [ ] **Step 2: Define package metadata and dependencies**

Create `agent/pyproject.toml` with:
- project name `pmeow-agent`
- runtime dependencies: `psutil`, `websocket-client`
- optional dev dependencies: `pytest`
- console scripts:
  - `pmeow-agent = pmeow.__main__:main`
  - `pmeow = pmeow.__main__:main`

- [ ] **Step 3: Add a minimal CLI entrypoint**

In `agent/pmeow/__main__.py`, implement a basic `main()` using `argparse` with placeholder subcommands:
- `daemon`
- `status`
- `cancel`
- `logs`
- default task submission mode using `--pvram`, `--gpu`, `--priority`

The handlers can return `NotImplementedError` for now, but argument parsing must work.

- [ ] **Step 4: Add configuration defaults**

In `agent/pmeow/config.py`, define an `AgentConfig` loader that supports:
- server URL
- agent ID override (optional)
- collection interval
- heartbeat interval
- history window seconds (default 120)
- VRAM redundancy coefficient (default 0.1)
- local state directory
- Unix socket path
- log directory

Use environment variables first, then fallback defaults.

- [ ] **Step 5: Add smoke tests**

Create `agent/tests/test_smoke.py` covering:
- package import works
- `main(['status'])` or equivalent parser path returns successfully
- config loader exposes default redundancy coefficient `0.1`

- [ ] **Step 6: Verify the project can run tests**

Run:
```bash
cd agent
python3 -m venv .venv
. .venv/bin/activate
pip install -e .[dev]
pytest
```

Expected: smoke tests pass.

- [ ] **Step 7: Commit**

```bash
git add agent/
git commit -m "feat(agent): bootstrap Python agent project and test harness"
```

---

### Task 2: Define Agent domain models and config-backed schemas

**Files:**
- Create: `agent/pmeow/models.py`
- Modify: `agent/pmeow/config.py`
- Create: `agent/tests/test_models.py`

- [ ] **Step 1: Define task and queue models**

Create `agent/pmeow/models.py` with dataclasses and enums for:
- `TaskStatus`: `queued`, `running`, `completed`, `failed`, `cancelled`
- `TaskSpec`
- `TaskRecord`
- `TaskUpdate`
- `QueueState`

Task fields must include:
- `id`
- `command`
- `cwd`
- `user`
- `require_vram_mb`
- `require_gpu_count`
- `gpu_ids`
- `priority`
- `status`
- `created_at`
- `started_at`
- `finished_at`
- `exit_code`
- `pid`

- [ ] **Step 2: Define GPU attribution models**

Add models for:
- `GpuProcessInfo`
- `GpuTaskAllocation`
- `GpuUserProcess`
- `GpuUnknownProcess`
- `PerGpuAllocationSummary`
- `UserGpuUsageSummary`
- `GpuAllocationSummary`

- [ ] **Step 3: Define collector snapshot models**

Add dataclasses for the Agent-side metrics snapshot that mirrors existing core shape and extends it with GPU attribution data:
- `MetricsSnapshot`
- nested CPU/memory/disk/network/GPU/system models as needed

Keep the top-level fields aligned with PMEOW core:
- `serverId`
- `timestamp`
- `cpu`
- `memory`
- `disk`
- `network`
- `gpu`
- `processes`
- `docker`
- `system`

Add optional `gpuAllocation` field for the future server-side extension.

- [ ] **Step 4: Add config validation helpers**

Update `agent/pmeow/config.py` to normalize:
- interval values to integers
- redundancy coefficient to float
- paths to absolute paths

Reject invalid values early.

- [ ] **Step 5: Add model tests**

Create `agent/tests/test_models.py` covering:
- default task priority = 10
- default gpu count = 1
- explicit `gpu_ids` preserved
- optional `gpuAllocation` accepted in `MetricsSnapshot`
- invalid redundancy coefficient raises error

- [ ] **Step 6: Run tests**

Run: `cd agent && . .venv/bin/activate && pytest`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add agent/pmeow/models.py agent/pmeow/config.py agent/tests/test_models.py
git commit -m "feat(agent): define task, metrics, and GPU attribution models"
```

---

### Task 3: Add local SQLite state store and repository layer

**Files:**
- Create: `agent/pmeow/store/__init__.py`
- Create: `agent/pmeow/store/database.py`
- Create: `agent/pmeow/store/tasks.py`
- Create: `agent/pmeow/store/runtime.py`
- Create: `agent/tests/store/test_tasks.py`

- [ ] **Step 1: Create SQLite bootstrap layer**

In `agent/pmeow/store/database.py`, create helpers to:
- open the Agent SQLite database under the configured state directory
- initialize schema
- close cleanly between tests

Schema must include:
- `tasks`
- `task_events`
- `runtime_state`
- `resource_reservations`

- [ ] **Step 2: Persist task queue state**

In `agent/pmeow/store/tasks.py`, implement repository methods:
- `create_task()`
- `get_task()`
- `list_tasks()`
- `list_queued_tasks()`
- `update_task_status()`
- `attach_runtime()`
- `finish_task()`
- `cancel_task()`

- [ ] **Step 3: Persist daemon runtime state**

In `agent/pmeow/store/runtime.py`, add helpers for:
- queue paused flag
- last successful registration metadata
- last known server mapping
- recent reservation records

- [ ] **Step 4: Add restart recovery semantics**

On database open, define recovery rules:
- tasks left in `running` at previous shutdown become `failed` or `queued` based on a documented policy
- stale reservations are dropped

Use the simpler policy unless there is a clear reason otherwise:
- running tasks become `failed` with a `daemon_restart` reason

- [ ] **Step 5: Add repository tests**

Create `agent/tests/store/test_tasks.py` covering:
- task insert/read
- queue ordering by priority then created time
- cancel queued task
- finish running task
- restart recovery clears stale reservations

- [ ] **Step 6: Run tests**

Run: `cd agent && . .venv/bin/activate && pytest`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add agent/pmeow/store/ agent/tests/store/test_tasks.py
git commit -m "feat(agent): add persistent local queue state store"
```

---

### Task 4: Implement base collectors for host metrics

**Files:**
- Create: `agent/pmeow/collector/__init__.py`
- Create: `agent/pmeow/collector/cpu.py`
- Create: `agent/pmeow/collector/memory.py`
- Create: `agent/pmeow/collector/disk.py`
- Create: `agent/pmeow/collector/network.py`
- Create: `agent/pmeow/collector/processes.py`
- Create: `agent/pmeow/collector/system.py`
- Create: `agent/pmeow/collector/docker.py`
- Create: `agent/pmeow/collector/snapshot.py`
- Create: `agent/tests/collector/test_base_collectors.py`

- [ ] **Step 1: Implement snapshot assembly entrypoint**

In `agent/pmeow/collector/snapshot.py`, create `collect_snapshot(server_id, hostname, ...)` that assembles the base `MetricsSnapshot` from all collectors.

- [ ] **Step 2: Implement CPU, memory, disk, network, system collectors**

Use `psutil` and standard library APIs to fill fields that align with PMEOW core.

- [ ] **Step 3: Implement process collector**

Collect top-level process data with:
- pid
- user
- cpu percent
- mem percent
- rss
- command

- [ ] **Step 4: Implement Docker collector with graceful fallback**

If Docker is unavailable, collector must return an empty list rather than fail the whole snapshot.

- [ ] **Step 5: Add collector tests**

Create `agent/tests/collector/test_base_collectors.py` covering:
- snapshot has the expected top-level keys
- Docker fallback returns empty list
- process collector returns command strings
- disk collector includes mount points

- [ ] **Step 6: Run tests**

Run: `cd agent && . .venv/bin/activate && pytest`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add agent/pmeow/collector/ agent/tests/collector/test_base_collectors.py
git commit -m "feat(agent): implement base host metrics collectors"
```

---

### Task 5: Implement GPU collector and process attribution

**Files:**
- Create: `agent/pmeow/collector/gpu.py`
- Create: `agent/pmeow/collector/gpu_attribution.py`
- Create: `agent/tests/collector/test_gpu.py`

- [ ] **Step 1: Parse per-GPU and per-process `nvidia-smi` output**

In `agent/pmeow/collector/gpu.py`, implement helpers to collect:
- total memory per GPU
- used memory per GPU
- utilization
- temperature
- per-process GPU memory

If `nvidia-smi` is unavailable, return `available = false` and empty process data without crashing.

- [ ] **Step 2: Implement PID-based ownership attribution**

In `agent/pmeow/collector/gpu_attribution.py`, classify each GPU process as:
- PMEOW task process
- known user process
- unknown process

Use:
- local task repository runtime PID map for PMEOW task matching
- `/proc/<pid>` lookups for user and command discovery

- [ ] **Step 3: Build `GpuAllocationSummary`**

Calculate:
- `perGpu`
- `byUser`

For each GPU card, keep separate buckets for:
- PMEOW task allocations
- user processes
- unknown processes

- [ ] **Step 4: Define scheduling-visible memory accounting rules**

Expose a helper that returns, per GPU:
- total memory
- PMEOW declared reserved memory
- non-PMEOW actual used memory with redundancy coefficient applied
- effective free memory

Rule:
- PMEOW tasks use declared `require_vram_mb`
- non-PMEOW processes use actual usage × `(1 + redundancy_coefficient)`

- [ ] **Step 5: Add GPU tests with recorded fixtures**

Create `agent/tests/collector/test_gpu.py` covering:
- no-GPU fallback
- per-process parsing
- attribution to PMEOW task by PID
- attribution to known user by `/proc`
- unknown process fallback
- effective free memory calculation

- [ ] **Step 6: Run tests**

Run: `cd agent && . .venv/bin/activate && pytest`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add agent/pmeow/collector/gpu.py agent/pmeow/collector/gpu_attribution.py agent/tests/collector/test_gpu.py
git commit -m "feat(agent): add GPU collection and process attribution"
```

---

### Task 6: Implement queue scheduler and VRAM admission logic

**Files:**
- Create: `agent/pmeow/queue/__init__.py`
- Create: `agent/pmeow/queue/history.py`
- Create: `agent/pmeow/queue/scheduler.py`
- Create: `agent/tests/queue/test_scheduler.py`

- [ ] **Step 1: Implement history window tracking**

In `agent/pmeow/queue/history.py`, keep the recent GPU snapshots for the last 120 seconds (default, configurable).

- [ ] **Step 2: Enforce sustained availability rule**

In `agent/pmeow/queue/scheduler.py`, when deciding if a queued task can start:
- combine the immediate sample taken at submit time with the recent history window
- require that **every sample point** in the window satisfies the resource requirement
- do not use an average-based rule

- [ ] **Step 3: Implement priority-based scheduling**

Traverse queued tasks in this order:
- lower `priority` first
- then earlier `created_at`

- [ ] **Step 4: Implement GPU selection and reservation handling**

Select the most suitable GPUs by effective free VRAM and maintain local reservations so that a burst of starts does not over-allocate before the next real sample arrives.

- [ ] **Step 5: Add scheduler tests**

Create `agent/tests/queue/test_scheduler.py` covering:
- higher priority runs first
- same priority respects FIFO order
- insufficient sustained history blocks start
- immediate sample plus history window allows start
- reservations prevent double allocation
- multi-GPU requirement picks enough cards

- [ ] **Step 6: Run tests**

Run: `cd agent && . .venv/bin/activate && pytest`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add agent/pmeow/queue/ agent/tests/queue/test_scheduler.py
git commit -m "feat(agent): implement local queue scheduler and VRAM admission rules"
```

---

### Task 7: Implement task executor and lifecycle transitions

**Files:**
- Create: `agent/pmeow/executor/__init__.py`
- Create: `agent/pmeow/executor/runner.py`
- Create: `agent/pmeow/executor/logs.py`
- Create: `agent/tests/executor/test_runner.py`

- [ ] **Step 1: Implement subprocess launch**

In `agent/pmeow/executor/runner.py`, add an executor that:
- starts the selected task command
- sets `CUDA_VISIBLE_DEVICES`
- runs in the declared working directory
- records PID and start time

- [ ] **Step 2: Capture stdout/stderr to task logs**

In `agent/pmeow/executor/logs.py`, persist per-task log files under the configured log directory.

- [ ] **Step 3: Implement completion and failure handling**

When a process exits:
- mark task `completed` for exit code 0
- mark task `failed` otherwise
- store `finished_at` and `exit_code`
- release reservations immediately

- [ ] **Step 4: Implement cancellation**

Support cancelling:
- queued tasks directly
- running tasks by sending termination to the subprocess, then updating state

- [ ] **Step 5: Add executor tests**

Create `agent/tests/executor/test_runner.py` covering:
- launches a short test command successfully
- non-zero exit marks task failed
- cancellation updates status
- log file contains process output

- [ ] **Step 6: Run tests**

Run: `cd agent && . .venv/bin/activate && pytest`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add agent/pmeow/executor/ agent/tests/executor/test_runner.py
git commit -m "feat(agent): implement task execution and lifecycle management"
```

---

### Task 8: Implement daemon orchestration and local control socket

**Files:**
- Create: `agent/pmeow/daemon/__init__.py`
- Create: `agent/pmeow/daemon/service.py`
- Create: `agent/pmeow/daemon/socket_server.py`
- Modify: `agent/pmeow/__main__.py`
- Create: `agent/tests/daemon/test_service.py`

- [ ] **Step 1: Implement daemon service loop**

In `agent/pmeow/daemon/service.py`, wire together:
- state store
- collectors
- history tracker
- scheduler
- executor
- transport client (stubbed if not ready)

The daemon loop must:
- collect metrics periodically
- trigger scheduling after sample completion
- trigger scheduling immediately after submit or task exit

- [ ] **Step 2: Implement local Unix socket control plane**

In `agent/pmeow/daemon/socket_server.py`, add request handlers for:
- `submit_task`
- `list_tasks`
- `cancel_task`
- `get_logs`
- `pause_queue`
- `resume_queue`

- [ ] **Step 3: Connect CLI subcommands to the local control plane**

Update `agent/pmeow/__main__.py` so that CLI commands talk to the daemon instead of mutating local state directly.

- [ ] **Step 4: Add daemon tests**

Create `agent/tests/daemon/test_service.py` covering:
- submit command enqueues a task
- list command returns queued/running/completed tasks
- pause/resume toggles scheduler state
- task exit triggers another schedule attempt

- [ ] **Step 5: Run tests**

Run: `cd agent && . .venv/bin/activate && pytest`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add agent/pmeow/daemon/ agent/pmeow/__main__.py agent/tests/daemon/test_service.py
git commit -m "feat(agent): add daemon loop and local control socket"
```

---

### Task 9: Implement minimal Agent transport client

**Files:**
- Create: `agent/pmeow/transport/__init__.py`
- Create: `agent/pmeow/transport/client.py`
- Create: `agent/tests/transport/test_client.py`

- [ ] **Step 1: Define the minimal outbound event set**

In `agent/pmeow/transport/client.py`, implement methods for:
- `send_register()`
- `send_metrics()`
- `send_task_update()`
- `send_heartbeat()`

Only support the Plan 2 event set:
- `agent:register`
- `agent:metrics`
- `agent:taskUpdate`
- `agent:heartbeat`

- [ ] **Step 2: Define the minimal inbound control commands**

Support handlers for:
- `server:cancelTask`
- `server:pauseQueue`
- `server:resumeQueue`
- `server:setPriority`

These handlers may call into the daemon service layer directly.

- [ ] **Step 3: Implement reconnect and offline buffering**

If the server connection drops:
- reconnect automatically
- keep heartbeats paused while disconnected
- buffer a bounded number of task updates and metrics payloads

Keep the implementation minimal. Do not add server-side namespace work here.

- [ ] **Step 4: Add transport tests**

Create `agent/tests/transport/test_client.py` covering:
- register payload contains hostname/version
- task update payload serializes correctly
- inbound cancel command reaches service layer
- reconnect path resends register

- [ ] **Step 5: Run tests**

Run: `cd agent && . .venv/bin/activate && pytest`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add agent/pmeow/transport/ agent/tests/transport/test_client.py
git commit -m "feat(agent): add minimal server transport client"
```

---

### Task 10: End-to-end verification and packaging notes

**Files:**
- Modify: `agent/README.md`
- Create: `agent/examples/pmeow-agent.service`
- Create: `agent/tests/test_e2e_smoke.py`

- [ ] **Step 1: Add operator-facing README instructions**

Document:
- required Python version
- virtualenv setup
- how to start daemon
- how to submit a task
- how to inspect status/logs
- how to configure server URL and state directory

- [ ] **Step 2: Add a systemd example**

Create `agent/examples/pmeow-agent.service` with a minimal service definition that runs the daemon under a fixed working directory.

- [ ] **Step 3: Add an end-to-end local smoke test**

Create `agent/tests/test_e2e_smoke.py` that starts the daemon in a temporary directory, submits a small local command, waits for completion, and verifies:
- task enters queue
- task starts
- task completes
- logs are written

- [ ] **Step 4: Run full verification**

Run:
```bash
cd agent
. .venv/bin/activate
pytest
python -m pmeow --help
python -m pmeow-agent --help
```

Expected:
- all tests pass
- both console entrypoints parse successfully

- [ ] **Step 5: Commit**

```bash
git add agent/README.md agent/examples/pmeow-agent.service agent/tests/test_e2e_smoke.py
git commit -m "docs(agent): add deployment notes and end-to-end verification"
```

---

## Notes for the Next Plan

After Plan 2 is complete, Plan 3 should integrate the Agent with the server-side runtime by implementing:
- actual Agent WebSocket session handling on the server
- full `AgentDataSource` command channel support
- task queue REST APIs and Socket.IO broadcasts
- GPU allocation persistence on the server side

Plan 4 should remain focused on:
- security event generation and review workflow
- UI pages for tasks, GPU allocation, and security
- global GPU usage reporting and audit analysis