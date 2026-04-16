# Process-State Runtime Monitor First Increment Implementation Plan

> **For agentic workers:** REQUIRED: Use the `subagent-driven-development` agent (recommended) or `executing-plans` agent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a daemon-owned runtime state foundation that can register local task process trees, guarded-finalize terminal state once, recover orphaned running tasks, and attribute GPU usage to any live task-owned process for both `attached_python` and `daemon_shell`.

**Architecture:** Keep `DaemonService` as the single orchestrator, but move runtime truth into two new SQLite-backed current-state tables plus a dedicated `RuntimeMonitorLoop`. All terminal transitions should flow through one guarded finalize helper so late CLI finishes, runner callbacks, monitor orphan detection, and explicit cancel all share the same state machine and transport behavior. Reuse existing public `TaskStatus` values and existing socket methods so the first increment is additive and migration-safe.

**Tech Stack:** Python 3.10+, sqlite3, threading, psutil, subprocess, pytest, monkeypatch

---

## File Structure

- Modify: `agent/pmeow/models.py`
Responsibility: add internal runtime enums and records, plus `ProcessInfo.ppid` for process-tree ownership.

- Modify: `agent/pmeow/store/database.py`
Responsibility: create and migrate `task_runtime` plus `task_processes`, and change restart recovery so `running` tasks are reconciled by runtime recovery instead of being blindly failed.

- Create: `agent/pmeow/store/task_runtime.py`
Responsibility: own CRUD for runtime rows, current process-tree rows, PID ownership lookups, and active-runtime queries.

- Modify: `agent/pmeow/store/tasks.py`
Responsibility: add guarded finalize, funnel `finish_task` and running-task cancel through it, and ensure runtime rows plus reservations are cleaned atomically.

- Modify: `agent/pmeow/store/__init__.py`
Responsibility: export the new runtime helpers used by daemon and collectors.

- Create: `agent/pmeow/daemon/runtime_monitor.py`
Responsibility: refresh current process trees on a short interval, detect orphaned tasks, reconcile restart recovery, and invoke guarded finalize.

- Modify: `agent/pmeow/daemon/service.py`
Responsibility: start and stop the runtime monitor independently of metric collection, register root processes for both launch modes, and use guarded finalize for runner exit, CLI finish, and cancel.

- Modify: `agent/pmeow/executor/attached.py`
Responsibility: keep attached execution foreground-friendly while normalizing Ctrl+C behavior into a stable exit path the CLI can report.

- Modify: `agent/pmeow/cli_python.py`
Responsibility: keep best-effort `finish_attached_task` semantics, but always report `130` on Ctrl+C and tolerate the daemon already having finalized the task.

- Modify: `agent/pmeow/collector/processes.py`
Responsibility: collect `ppid` so host process samples can later be joined to task-owned runtime trees.

- Modify: `agent/pmeow/collector/gpu_attribution.py`
Responsibility: attribute GPU processes against any current task-owned PID, not only the task root PID.

- Modify: `agent/pmeow/collector/snapshot.py`
Responsibility: load current PID ownership from SQLite and pass it into GPU attribution.

- Create: `agent/tests/store/test_task_runtime.py`
Responsibility: validate runtime table creation, runtime/process-tree persistence, and PID ownership queries.

- Modify: `agent/tests/store/test_tasks.py`
Responsibility: validate guarded finalize idempotence, reservation cleanup, late-source handling, and running-task cancel semantics.

- Create: `agent/tests/daemon/test_runtime_monitor.py`
Responsibility: validate tree refresh, orphan detection, and daemon restart runtime recovery.

- Modify: `agent/tests/daemon/test_service.py`
Responsibility: validate service wiring for `daemon_shell` and `attached_python` runtime registration and guarded finalize behavior.

- Create: `agent/tests/executor/test_attached.py`
Responsibility: validate attached executor and CLI Ctrl+C normalization.

- Modify: `agent/tests/test_cli_python.py`
Responsibility: validate best-effort attached finish behavior and late-finish tolerance.

- Modify: `agent/tests/collector/test_gpu.py`
Responsibility: validate child-process GPU attribution and fallback to root-pid matching.

- Modify: `agent/tests/collector/test_base_collectors.py`
Responsibility: validate process collection includes `ppid`.

- Modify: `agent/tests/test_models.py`
Responsibility: validate new runtime dataclasses and `ProcessInfo` serialization.

- Modify: `docs/developer/architecture.md`
Responsibility: document the new daemon runtime-monitor layer and current-tree state tables.

- Modify: `docs/developer/testing-and-debugging.md`
Responsibility: document targeted runtime-monitor debug commands, race scenarios, and focused pytest entry points.

## Task 1: Add Runtime State Schema And Store Primitives

**Files:**
- Create: `agent/pmeow/store/task_runtime.py`
- Modify: `agent/pmeow/models.py`
- Modify: `agent/pmeow/store/database.py`
- Modify: `agent/pmeow/store/__init__.py`
- Create: `agent/tests/store/test_task_runtime.py`
- Modify: `agent/tests/test_models.py`

- [ ] **Step 1: Write the failing runtime-store tests**

Create `agent/tests/store/test_task_runtime.py` with:

```python
from __future__ import annotations

import time

from pmeow.models import RuntimePhase, TaskLaunchMode, TaskProcessRecord, TaskRuntimeRecord, TaskSpec
from pmeow.store.tasks import create_task
from pmeow.store.task_runtime import (
    get_task_runtime,
    list_active_task_runtimes,
    list_task_processes,
    replace_task_processes,
    upsert_task_runtime,
)


def _spec() -> TaskSpec:
    return TaskSpec(
        command="python train.py",
        cwd="/tmp/demo",
        user="alice",
        require_vram_mb=1024,
        launch_mode=TaskLaunchMode.daemon_shell,
    )


def test_runtime_tables_round_trip(conn):
    task = create_task(conn, _spec())
    now = time.time()

    upsert_task_runtime(
        conn,
        TaskRuntimeRecord(
            task_id=task.id,
            launch_mode=TaskLaunchMode.daemon_shell,
            root_pid=4321,
            runtime_phase=RuntimePhase.registered,
            first_started_at=now,
            last_seen_at=now,
        ),
    )
    replace_task_processes(
        conn,
        task.id,
        [
            TaskProcessRecord(
                task_id=task.id,
                pid=4321,
                ppid=None,
                depth=0,
                user="alice",
                command="python train.py",
                is_root=True,
                first_seen_at=now,
                last_seen_at=now,
            ),
        ],
    )

    runtime = get_task_runtime(conn, task.id)
    processes = list_task_processes(conn, task.id)

    assert runtime is not None
    assert runtime.root_pid == 4321
    assert runtime.runtime_phase is RuntimePhase.registered
    assert [(proc.pid, proc.ppid, proc.depth, proc.is_root) for proc in processes] == [(4321, None, 0, True)]
    assert [record.task_id for record in list_active_task_runtimes(conn)] == [task.id]
```

Append to `agent/tests/test_models.py`:

```python
def test_runtime_records_serialize_to_camel_case():
    runtime = TaskRuntimeRecord(
        task_id="task-1",
        launch_mode=TaskLaunchMode.attached_python,
        root_pid=1234,
        runtime_phase=RuntimePhase.running,
        first_started_at=1.0,
        last_seen_at=2.0,
    )

    payload = runtime.to_dict()

    assert payload["taskId"] == "task-1"
    assert payload["launchMode"] == "attached_python"
    assert payload["runtimePhase"] == "running"
    assert payload["rootPid"] == 1234
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```powershell
Set-Location C:\Users\huany\Desktop\workspace\Projects\pmeow
& .\.venv\Scripts\Activate.ps1
Set-Location agent
pytest tests/store/test_task_runtime.py tests/test_models.py -k "runtime" -v
```

Expected: FAIL with `ImportError` for `pmeow.store.task_runtime` and missing `RuntimePhase` or `TaskRuntimeRecord` definitions.

- [ ] **Step 3: Add runtime models and schema migration**

Update `agent/pmeow/models.py` with internal runtime types:

```python
class RuntimePhase(enum.Enum):
    registered = "registered"
    running = "running"
    finalizing = "finalizing"
    finalized = "finalized"


@dataclass
class TaskRuntimeRecord:
    task_id: str
    launch_mode: TaskLaunchMode
    root_pid: int
    runtime_phase: RuntimePhase
    first_started_at: float
    last_seen_at: float
    finalize_source: str | None = None
    finalize_reason_code: str | None = None
    last_observed_exit_code: int | None = None
    updated_at: float | None = None

    def to_dict(self) -> dict:
        return _serialize(self)


@dataclass
class TaskProcessRecord:
    task_id: str
    pid: int
    ppid: int | None
    depth: int
    user: str
    command: str
    is_root: bool
    first_seen_at: float
    last_seen_at: float

    def to_dict(self) -> dict:
        return _serialize(self)
```

Update `agent/pmeow/store/database.py` so `_SCHEMA` and migration helpers create the new tables idempotently:

```python
CREATE TABLE IF NOT EXISTS task_runtime (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id),
    launch_mode TEXT NOT NULL,
    root_pid INTEGER NOT NULL,
    runtime_phase TEXT NOT NULL,
    first_started_at REAL NOT NULL,
    last_seen_at REAL NOT NULL,
    finalize_source TEXT,
    finalize_reason_code TEXT,
    last_observed_exit_code INTEGER,
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS task_processes (
    task_id TEXT NOT NULL REFERENCES tasks(id),
    pid INTEGER NOT NULL,
    ppid INTEGER,
    depth INTEGER NOT NULL,
    user TEXT NOT NULL,
    command TEXT NOT NULL,
    is_root INTEGER NOT NULL DEFAULT 0,
    first_seen_at REAL NOT NULL,
    last_seen_at REAL NOT NULL,
    PRIMARY KEY (task_id, pid)
);

CREATE INDEX IF NOT EXISTS idx_task_runtime_phase ON task_runtime(runtime_phase);
CREATE INDEX IF NOT EXISTS idx_task_processes_pid ON task_processes(pid);
```

- [ ] **Step 4: Add the runtime store module and exports**

Create `agent/pmeow/store/task_runtime.py` with focused CRUD helpers:

```python
from __future__ import annotations

import sqlite3
import time

from pmeow.models import RuntimePhase, TaskProcessRecord, TaskRuntimeRecord, TaskLaunchMode


def upsert_task_runtime(conn: sqlite3.Connection, record: TaskRuntimeRecord) -> None:
    conn.execute(
        """
        INSERT INTO task_runtime (
            task_id, launch_mode, root_pid, runtime_phase, first_started_at,
            last_seen_at, finalize_source, finalize_reason_code,
            last_observed_exit_code, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
            launch_mode = excluded.launch_mode,
            root_pid = excluded.root_pid,
            runtime_phase = excluded.runtime_phase,
            first_started_at = excluded.first_started_at,
            last_seen_at = excluded.last_seen_at,
            finalize_source = excluded.finalize_source,
            finalize_reason_code = excluded.finalize_reason_code,
            last_observed_exit_code = excluded.last_observed_exit_code,
            updated_at = excluded.updated_at
        """,
        (
            record.task_id,
            record.launch_mode.value,
            record.root_pid,
            record.runtime_phase.value,
            record.first_started_at,
            record.last_seen_at,
            record.finalize_source,
            record.finalize_reason_code,
            record.last_observed_exit_code,
            record.updated_at or time.time(),
        ),
    )
    conn.commit()


def replace_task_processes(conn: sqlite3.Connection, task_id: str, records: list[TaskProcessRecord]) -> None:
    conn.execute("DELETE FROM task_processes WHERE task_id = ?", (task_id,))
    conn.executemany(
        """
        INSERT INTO task_processes (
            task_id, pid, ppid, depth, user, command, is_root, first_seen_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                record.task_id,
                record.pid,
                record.ppid,
                record.depth,
                record.user,
                record.command,
                int(record.is_root),
                record.first_seen_at,
                record.last_seen_at,
            )
            for record in records
        ],
    )
    conn.commit()
```

Update `agent/pmeow/store/__init__.py` so daemon and collectors can import the new helpers directly.

- [ ] **Step 5: Run the runtime-store tests again**

Run:

```powershell
Set-Location C:\Users\huany\Desktop\workspace\Projects\pmeow
& .\.venv\Scripts\Activate.ps1
Set-Location agent
pytest tests/store/test_task_runtime.py tests/test_models.py -k "runtime" -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent/pmeow/models.py agent/pmeow/store/database.py agent/pmeow/store/task_runtime.py agent/pmeow/store/__init__.py agent/tests/store/test_task_runtime.py agent/tests/test_models.py
git commit -m "feat(agent): add runtime state tables and store helpers"
```

---

## Task 2: Add Guarded Finalize And Shared Root-Process Registration

**Files:**
- Modify: `agent/pmeow/store/tasks.py`
- Modify: `agent/pmeow/store/task_runtime.py`
- Modify: `agent/tests/store/test_tasks.py`

- [ ] **Step 1: Write the failing finalize-guard tests**

Append to `agent/tests/store/test_tasks.py`:

```python
def test_guarded_finalize_only_applies_once(conn):
    record = create_task(conn, _spec())
    now = time.time()
    attach_runtime(conn, record.id, pid=9001, gpu_ids=[0], started_at=now)

    first = guarded_finalize_task(
        conn,
        record.id,
        status=TaskStatus.failed,
        finished_at=now + 5,
        exit_code=130,
        finalize_source="cli_finish",
        finalize_reason_code="ctrl_c",
    )
    second = guarded_finalize_task(
        conn,
        record.id,
        status=TaskStatus.failed,
        finished_at=now + 6,
        exit_code=1,
        finalize_source="monitor_orphan",
        finalize_reason_code="orphaned",
    )

    assert first.transitioned is True
    assert second.transitioned is False

    fetched = _require_task(conn, record.id)
    assert fetched.status == TaskStatus.failed
    assert fetched.exit_code == 130

    events = list_task_events(conn, record.id)
    assert any(event["event_type"] == "runtime_finalize_ignored_late_source" for event in events)


def test_guarded_finalize_clears_runtime_rows_and_reservations(conn):
    record = create_task(conn, _spec())
    now = time.time()
    attach_runtime(conn, record.id, pid=1111, gpu_ids=[0, 1], started_at=now)

    outcome = guarded_finalize_task(
        conn,
        record.id,
        status=TaskStatus.completed,
        finished_at=now + 2,
        exit_code=0,
        finalize_source="runner_exit",
    )

    assert outcome.transitioned is True
    assert get_task_runtime(conn, record.id) is None
    assert list_task_processes(conn, record.id) == []
    assert conn.execute(
        "SELECT COUNT(*) FROM resource_reservations WHERE task_id = ?",
        (record.id,),
    ).fetchone()[0] == 0
```

- [ ] **Step 2: Run the store tests to verify they fail**

Run:

```powershell
Set-Location C:\Users\huany\Desktop\workspace\Projects\pmeow
& .\.venv\Scripts\Activate.ps1
Set-Location agent
pytest tests/store/test_tasks.py -k "guarded_finalize" -v
```

Expected: FAIL because `guarded_finalize_task` and runtime cleanup do not exist.

- [ ] **Step 3: Add a single guarded finalize result type and implementation**

Add a focused outcome record near the task-store helpers:

```python
@dataclass
class FinalizeOutcome:
    transitioned: bool
    status: TaskStatus | None
    finished_at: float | None
    exit_code: int | None


def guarded_finalize_task(
    conn: sqlite3.Connection,
    task_id: str,
    *,
    status: TaskStatus,
    finished_at: float,
    exit_code: int | None,
    finalize_source: str,
    finalize_reason_code: str | None = None,
) -> FinalizeOutcome:
    task = get_task(conn, task_id)
    if task is None:
        return FinalizeOutcome(False, None, None, None)

    if task.status in {TaskStatus.completed, TaskStatus.failed, TaskStatus.cancelled}:
        append_task_event(
            conn,
            task_id,
            "runtime_finalize_ignored_late_source",
            finished_at,
            {
                "finalize_source": finalize_source,
                "finalize_reason_code": finalize_reason_code,
                "late_exit_code": exit_code,
            },
        )
        return FinalizeOutcome(False, task.status, task.finished_at, task.exit_code)

    conn.execute(
        "UPDATE tasks SET status = ?, exit_code = ?, finished_at = ? WHERE id = ?",
        (status.value, exit_code, finished_at, task_id),
    )
    conn.execute("DELETE FROM resource_reservations WHERE task_id = ?", (task_id,))
    conn.execute("DELETE FROM task_processes WHERE task_id = ?", (task_id,))
    conn.execute("DELETE FROM task_runtime WHERE task_id = ?", (task_id,))
    conn.commit()

    append_task_event(
        conn,
        task_id,
        "runtime_finalized",
        finished_at,
        {
            "status": status.value,
            "finalize_source": finalize_source,
            "finalize_reason_code": finalize_reason_code,
            "exit_code": exit_code,
        },
    )
    return FinalizeOutcome(True, status, finished_at, exit_code)
```

- [ ] **Step 4: Funnel existing launch and finish helpers through shared runtime registration**

Refactor `attach_runtime`, `confirm_attached_launch`, `finish_task`, and running-task cancel paths to share registration and guarded finalize:

```python
def _register_root_process(
    conn: sqlite3.Connection,
    task_id: str,
    *,
    launch_mode: TaskLaunchMode,
    pid: int,
    started_at: float,
    command: str,
    user: str,
) -> None:
    upsert_task_runtime(
        conn,
        TaskRuntimeRecord(
            task_id=task_id,
            launch_mode=launch_mode,
            root_pid=pid,
            runtime_phase=RuntimePhase.registered,
            first_started_at=started_at,
            last_seen_at=started_at,
        ),
    )
    replace_task_processes(
        conn,
        task_id,
        [
            TaskProcessRecord(
                task_id=task_id,
                pid=pid,
                ppid=None,
                depth=0,
                user=user,
                command=command,
                is_root=True,
                first_seen_at=started_at,
                last_seen_at=started_at,
            )
        ],
    )


def finish_task(conn: sqlite3.Connection, task_id: str, exit_code: int, finished_at: float) -> None:
    status = TaskStatus.completed if exit_code == 0 else TaskStatus.failed
    guarded_finalize_task(
        conn,
        task_id,
        status=status,
        finished_at=finished_at,
        exit_code=exit_code,
        finalize_source="legacy_finish",
    )
```

Keep `finish_task` as a thin compatibility wrapper for now so existing callers continue to work while later tasks switch to explicit finalize sources.

- [ ] **Step 5: Run the store regression tests again**

Run:

```powershell
Set-Location C:\Users\huany\Desktop\workspace\Projects\pmeow
& .\.venv\Scripts\Activate.ps1
Set-Location agent
pytest tests/store/test_tasks.py tests/store/test_task_runtime.py -k "guarded_finalize or attached or runtime_tables" -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent/pmeow/store/tasks.py agent/pmeow/store/task_runtime.py agent/tests/store/test_tasks.py
git commit -m "feat(agent): guard runtime finalization and root registration"
```

---

## Task 3: Add RuntimeMonitorLoop And Restart Recovery

**Files:**
- Create: `agent/pmeow/daemon/runtime_monitor.py`
- Modify: `agent/pmeow/daemon/service.py`
- Modify: `agent/pmeow/store/database.py`
- Modify: `agent/pmeow/store/task_runtime.py`
- Create: `agent/tests/daemon/test_runtime_monitor.py`
- Modify: `agent/tests/daemon/test_service.py`

- [ ] **Step 1: Write the failing monitor-loop tests**

Create `agent/tests/daemon/test_runtime_monitor.py` with:

```python
from __future__ import annotations

import time

from pmeow.daemon.runtime_monitor import RuntimeMonitorLoop
from pmeow.models import TaskLaunchMode, TaskStatus
from pmeow.store.tasks import create_task


def test_monitor_finalizes_orphaned_runtime(conn, monkeypatch):
    task = create_task(conn, _spec())
    now = time.time()
    attach_runtime(conn, task.id, pid=4242, gpu_ids=[0], started_at=now)

    monitor = RuntimeMonitorLoop(conn, poll_interval=0.01)
    monkeypatch.setattr(monitor, "_collect_process_tree", lambda runtime: [])

    finalized = monitor.tick()
    fetched = get_task(conn, task.id)

    assert finalized == [task.id]
    assert fetched is not None
    assert fetched.status == TaskStatus.failed
    assert fetched.exit_code is None
    events = list_task_events(conn, task.id)
    assert any(event["event_type"] == "runtime_orphan_detected" for event in events)


def test_monitor_recovers_running_task_without_runtime_row(conn, monkeypatch):
    task = create_task(conn, _spec())
    attach_runtime(conn, task.id, pid=5151, gpu_ids=[0], started_at=time.time())
    conn.execute("DELETE FROM task_runtime WHERE task_id = ?", (task.id,))
    conn.commit()

    monitor = RuntimeMonitorLoop(conn, poll_interval=0.01)
    monkeypatch.setattr(monitor, "_pid_exists", lambda pid: False)

    recovered = monitor.recover_after_restart()
    fetched = get_task(conn, task.id)

    assert recovered == [task.id]
    assert fetched is not None
    assert fetched.status == TaskStatus.failed
```

- [ ] **Step 2: Run the monitor tests to verify they fail**

Run:

```powershell
Set-Location C:\Users\huany\Desktop\workspace\Projects\pmeow
& .\.venv\Scripts\Activate.ps1
Set-Location agent
pytest tests/daemon/test_runtime_monitor.py -v
```

Expected: FAIL with `ModuleNotFoundError` for `pmeow.daemon.runtime_monitor`.

- [ ] **Step 3: Create the monitor loop with tree refresh and orphan finalize**

Create `agent/pmeow/daemon/runtime_monitor.py` with a narrow public surface:

```python
from __future__ import annotations

import threading
import time
from collections import deque

import psutil

from pmeow.models import RuntimePhase, TaskProcessRecord, TaskStatus
from pmeow.store.task_runtime import list_active_task_runtimes, replace_task_processes, update_runtime_heartbeat
from pmeow.store.tasks import append_task_event, guarded_finalize_task, get_task


class RuntimeMonitorLoop:
    def __init__(self, conn, poll_interval: float = 1.0) -> None:
        self._conn = conn
        self._poll_interval = poll_interval
        self._stop = threading.Event()

    def tick(self) -> list[str]:
        finalized: list[str] = []
        now = time.time()

        for runtime in list_active_task_runtimes(self._conn):
            processes = self._collect_process_tree(runtime)
            if processes:
                replace_task_processes(self._conn, runtime.task_id, processes)
                update_runtime_heartbeat(self._conn, runtime.task_id, RuntimePhase.running, now)
                continue

            append_task_event(
                self._conn,
                runtime.task_id,
                "runtime_orphan_detected",
                now,
                {"root_pid": runtime.root_pid, "finalize_source": "monitor_orphan", "reason_code": "orphaned"},
            )
            outcome = guarded_finalize_task(
                self._conn,
                runtime.task_id,
                status=TaskStatus.failed,
                finished_at=now,
                exit_code=None,
                finalize_source="monitor_orphan",
                finalize_reason_code="orphaned",
            )
            if outcome.transitioned:
                finalized.append(runtime.task_id)
        return finalized

    def _collect_process_tree(self, runtime) -> list[TaskProcessRecord]:
        root = psutil.Process(runtime.root_pid)
        queue = deque([(root, 0, None)])
        now = time.time()
        result: list[TaskProcessRecord] = []
        while queue:
            proc, depth, parent_pid = queue.popleft()
            with proc.oneshot():
                result.append(
                    TaskProcessRecord(
                        task_id=runtime.task_id,
                        pid=proc.pid,
                        ppid=parent_pid,
                        depth=depth,
                        user=proc.username(),
                        command=" ".join(proc.cmdline()) or proc.name(),
                        is_root=depth == 0,
                        first_seen_at=now,
                        last_seen_at=now,
                    )
                )
            for child in proc.children(recursive=False):
                queue.append((child, depth + 1, proc.pid))
        return result
```

- [ ] **Step 4: Wire monitor lifecycle and restart recovery into the daemon**

Update `agent/pmeow/store/database.py` so restart recovery only requeues `launching` tasks. Move `running`-task reconciliation into the monitor and service startup:

```python
def recover_interrupted_tasks(conn: sqlite3.Connection) -> None:
    now = time.time()
    launching_ids = [row[0] for row in conn.execute("SELECT id FROM tasks WHERE status = 'launching'").fetchall()]
    for task_id in launching_ids:
        ...
    conn.commit()
```

Then update `agent/pmeow/daemon/service.py`:

```python
self.runtime_monitor = RuntimeMonitorLoop(self.db, poll_interval=1.0)

def start(self) -> None:
    ...
    self.runtime_monitor.recover_after_restart()
    monitor_thread = threading.Thread(target=self.runtime_monitor.run_forever, daemon=True)
    monitor_thread.start()
    try:
        while not self._shutdown.is_set():
            self.collect_cycle()
            self._shutdown.wait(timeout=self.config.collection_interval)
    finally:
        self.runtime_monitor.stop()
        monitor_thread.join(timeout=5)
```

Do not reuse `collect_cycle` timing for runtime monitoring; keep the monitor on its own interval.

- [ ] **Step 5: Run the monitor and daemon tests again**

Run:

```powershell
Set-Location C:\Users\huany\Desktop\workspace\Projects\pmeow
& .\.venv\Scripts\Activate.ps1
Set-Location agent
pytest tests/daemon/test_runtime_monitor.py tests/daemon/test_service.py -k "runtime_monitor or restart" -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent/pmeow/daemon/runtime_monitor.py agent/pmeow/daemon/service.py agent/pmeow/store/database.py agent/pmeow/store/task_runtime.py agent/tests/daemon/test_runtime_monitor.py agent/tests/daemon/test_service.py
git commit -m "feat(agent): add runtime monitor loop and restart recovery"
```

---

## Task 4: Integrate Guarded Runtime Handling For Attached And Daemon-Shell Tasks

**Files:**
- Modify: `agent/pmeow/daemon/service.py`
- Modify: `agent/pmeow/cli_python.py`
- Modify: `agent/pmeow/executor/attached.py`
- Create: `agent/tests/executor/test_attached.py`
- Modify: `agent/tests/test_cli_python.py`
- Modify: `agent/tests/daemon/test_service.py`

- [ ] **Step 1: Write the failing integration tests for late finish and Ctrl+C**

Append to `agent/tests/test_cli_python.py`:

```python
def test_run_python_invocation_reports_ctrl_c_as_exit_130(monkeypatch, tmp_path):
    from pmeow.cli_python import PythonInvocation, run_python_invocation

    script = tmp_path / "demo.py"
    script.write_text("print('hi')\n")
    finish_calls: list[int] = []

    def fake_send_request(_socket_path, method, params=None):
        params = params or {}
        if method == "submit_task":
            return {"ok": True, "result": {"id": "task-1"}}
        if method == "get_task":
            return {"ok": True, "result": {"status": "launching", "argv": [sys.executable, str(script)], "cwd": str(tmp_path), "gpu_ids": [], "log_path": str(tmp_path / "task.log")}}
        if method == "confirm_attached_launch":
            return {"ok": True, "result": True}
        if method == "finish_attached_task":
            finish_calls.append(params["exit_code"])
            return {"ok": True, "result": True}
        raise AssertionError(method)

    def fake_run_attached_python(**kwargs):
        kwargs["on_started"](4321)
        raise KeyboardInterrupt

    monkeypatch.setattr("pmeow.daemon.socket_server.send_request", fake_send_request)
    monkeypatch.setattr("pmeow.executor.attached.run_attached_python", fake_run_attached_python)

    exit_code = run_python_invocation(
        PythonInvocation(
            socket_path="socket",
            require_vram_mb=0,
            require_gpu_count=0,
            priority=10,
            report=False,
            script_path=str(script),
            script_args=[],
        )
    )

    assert exit_code == 130
    assert finish_calls == [130]
```

Create `agent/tests/executor/test_attached.py` with:

```python
from __future__ import annotations

import subprocess

from pmeow.executor.attached import _normalize_attached_exit_code


def test_normalize_attached_exit_code_maps_sigint_to_130():
    assert _normalize_attached_exit_code(-2) == 130
    assert _normalize_attached_exit_code(0) == 0
    assert _normalize_attached_exit_code(5) == 5
```

- [ ] **Step 2: Run the integration tests to verify they fail**

Run:

```powershell
Set-Location C:\Users\huany\Desktop\workspace\Projects\pmeow
& .\.venv\Scripts\Activate.ps1
Set-Location agent
pytest tests/test_cli_python.py tests/executor/test_attached.py -k "130 or attached" -v
```

Expected: FAIL because Ctrl+C is not normalized and `_normalize_attached_exit_code` does not exist.

- [ ] **Step 3: Make service finalization source-aware for both launch modes**

Update `agent/pmeow/daemon/service.py` so each source uses guarded finalize exactly once:

```python
for task_id, exit_code in self.runner.check_completed():
    task = get_task(self.db, task_id)
    if task is None:
        continue
    finished_at = time.time()
    outcome = guarded_finalize_task(
        self.db,
        task_id,
        status=TaskStatus.completed if exit_code == 0 else TaskStatus.failed,
        finished_at=finished_at,
        exit_code=exit_code,
        finalize_source="runner_exit",
    )
    if outcome.transitioned and self.transport:
        self.transport.send_task_update(...)


def finish_attached_task(self, task_id: str, exit_code: int) -> bool:
    ...
    outcome = guarded_finalize_task(
        self.db,
        task_id,
        status=TaskStatus.completed if exit_code == 0 else TaskStatus.failed,
        finished_at=finished_at,
        exit_code=exit_code,
        finalize_source="cli_finish",
        finalize_reason_code="ctrl_c" if exit_code == 130 else None,
    )
    if outcome.transitioned and self.transport:
        self.transport.send_task_update(...)
    return True
```

Also update `cancel_task` so `running` tasks use `guarded_finalize_task(... finalize_source="cancel", finalize_reason_code="explicit_cancel")` after `self.runner.cancel(task_id)` and queued tasks keep the current direct cancel path.

- [ ] **Step 4: Normalize attached Ctrl+C and keep finish best-effort**

Update `agent/pmeow/executor/attached.py` and `agent/pmeow/cli_python.py`:

```python
def _normalize_attached_exit_code(exit_code: int) -> int:
    return 130 if exit_code == -signal.SIGINT else exit_code


exit_code = _normalize_attached_exit_code(proc.wait())
```

```python
try:
    exit_code = run_attached_python(...)
except KeyboardInterrupt:
    exit_code = 130

ack = send_request(socket_path, "finish_attached_task", {"task_id": task_id, "exit_code": exit_code})
if not ack.get("ok"):
    print("warning: best-effort finish request failed", file=sys.stderr)
return exit_code
```

Do not fail the CLI when the daemon returns `False`; by this point the monitor may already have finalized the task.

- [ ] **Step 5: Run the attached integration tests again**

Run:

```powershell
Set-Location C:\Users\huany\Desktop\workspace\Projects\pmeow
& .\.venv\Scripts\Activate.ps1
Set-Location agent
pytest tests/daemon/test_service.py tests/test_cli_python.py tests/executor/test_attached.py -k "attached or cancel or 130" -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent/pmeow/daemon/service.py agent/pmeow/cli_python.py agent/pmeow/executor/attached.py agent/tests/test_cli_python.py agent/tests/executor/test_attached.py agent/tests/daemon/test_service.py
git commit -m "feat(agent): integrate guarded runtime handling for attached tasks"
```

---

## Task 5: Attribute Process Trees And GPU Usage By Any Owned PID

**Files:**
- Modify: `agent/pmeow/models.py`
- Modify: `agent/pmeow/collector/processes.py`
- Modify: `agent/pmeow/collector/gpu_attribution.py`
- Modify: `agent/pmeow/collector/snapshot.py`
- Modify: `agent/pmeow/store/task_runtime.py`
- Modify: `agent/tests/collector/test_gpu.py`
- Modify: `agent/tests/collector/test_base_collectors.py`
- Modify: `agent/tests/test_models.py`

- [ ] **Step 1: Write the failing collector and attribution tests**

Append to `agent/tests/collector/test_gpu.py`:

```python
def test_matching_child_pid_via_runtime_tree():
    task = _make_task("task-1", pid=1234, vram=8000)
    proc = GpuProcessInfo(pid=5678, gpu_index=0, used_memory_mb=6500.0, process_name="")

    summary = attribute_gpu_processes(
        gpu_processes=[proc],
        running_tasks=[task],
        per_gpu_memory={0: 24000.0},
        task_process_index={5678: task},
    )

    alloc = summary.per_gpu[0].pmeow_tasks[0]
    assert alloc.task_id == "task-1"
    assert alloc.actual_vram_mb == 6500.0
```

Append to `agent/tests/collector/test_base_collectors.py`:

```python
def test_process_collector_includes_ppid(monkeypatch):
    fake_proc = MagicMock()
    fake_proc.info = {
        "pid": 1234,
        "ppid": 222,
        "username": "alice",
        "cpu_percent": 1.0,
        "memory_percent": 2.0,
        "memory_info": SimpleNamespace(rss=1024),
        "cmdline": ["python", "train.py"],
        "name": "python",
    }

    monkeypatch.setattr("pmeow.collector.processes.psutil.process_iter", lambda _attrs: [fake_proc])

    procs = collect_processes()

    assert procs == [
        ProcessInfo(
            pid=1234,
            ppid=222,
            user="alice",
            cpu_percent=1.0,
            mem_percent=2.0,
            rss=1024,
            command="python train.py",
        )
    ]
```

- [ ] **Step 2: Run the collector tests to verify they fail**

Run:

```powershell
Set-Location C:\Users\huany\Desktop\workspace\Projects\pmeow
& .\.venv\Scripts\Activate.ps1
Set-Location agent
pytest tests/collector/test_gpu.py tests/collector/test_base_collectors.py tests/test_models.py -k "ppid or child_pid or runtime_tree" -v
```

Expected: FAIL because `ProcessInfo` lacks `ppid` and GPU attribution ignores child-process ownership.

- [ ] **Step 3: Extend process collection and runtime PID ownership lookup**

Update `agent/pmeow/models.py` and `agent/pmeow/collector/processes.py`:

```python
@dataclass
class ProcessInfo:
    pid: int
    ppid: int | None
    user: str
    cpu_percent: float
    mem_percent: float
    rss: int
    command: str
```

```python
_ATTRS = ["pid", "ppid", "username", "cpu_percent", "memory_percent", "memory_info", "cmdline", "name"]

result.append(ProcessInfo(
    pid=info["pid"],
    ppid=info.get("ppid"),
    user=info.get("username") or "",
    cpu_percent=round(info.get("cpu_percent") or 0.0, 1),
    mem_percent=round(info.get("memory_percent") or 0.0, 1),
    rss=rss,
    command=command,
))
```

Add a runtime ownership query in `agent/pmeow/store/task_runtime.py`:

```python
def build_task_process_index(conn: sqlite3.Connection) -> dict[int, TaskRecord]:
    rows = conn.execute(
        """
        SELECT tp.pid, t.id, t.command, t.cwd, t.user, t.require_vram_mb,
               t.require_gpu_count, t.gpu_ids, t.priority, t.status, t.created_at,
               t.started_at, t.finished_at, t.exit_code, t.pid, t.argv_json,
               t.env_json, t.launch_mode, t.report_requested, t.launch_deadline
        FROM task_processes tp
        JOIN tasks t ON t.id = tp.task_id
        WHERE t.status = 'running'
        """
    ).fetchall()
    return {row[0]: _row_to_record(row[1:]) for row in rows}
```

- [ ] **Step 4: Update GPU attribution and snapshot assembly to use current-tree ownership**

Update `agent/pmeow/collector/gpu_attribution.py` and `agent/pmeow/collector/snapshot.py`:

```python
def attribute_gpu_processes(
    gpu_processes: list[GpuProcessInfo],
    running_tasks: list[TaskRecord],
    per_gpu_memory: dict[int, float],
    redundancy_coefficient: float = 0.1,
    per_gpu_used_memory: dict[int, float] | None = None,
    task_process_index: dict[int, TaskRecord] | None = None,
) -> GpuAllocationSummary:
    pid_to_task = dict(task_process_index or {})
    for task in running_tasks:
        if task.pid is not None:
            pid_to_task.setdefault(task.pid, task)
```

```python
running_tasks = list_tasks(task_store, TaskStatus.running)
task_process_index = build_task_process_index(task_store)
gpu_allocation = attribute_gpu_processes(
    gpu_procs,
    running_tasks,
    per_gpu_mem,
    redundancy_coefficient,
    per_gpu_used_memory=per_gpu_used,
    task_process_index=task_process_index,
)
```

- [ ] **Step 5: Run the collector regression tests again**

Run:

```powershell
Set-Location C:\Users\huany\Desktop\workspace\Projects\pmeow
& .\.venv\Scripts\Activate.ps1
Set-Location agent
pytest tests/collector/test_gpu.py tests/collector/test_base_collectors.py tests/test_models.py -k "ppid or child_pid or runtime_tree" -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent/pmeow/models.py agent/pmeow/collector/processes.py agent/pmeow/collector/gpu_attribution.py agent/pmeow/collector/snapshot.py agent/pmeow/store/task_runtime.py agent/tests/collector/test_gpu.py agent/tests/collector/test_base_collectors.py agent/tests/test_models.py
git commit -m "feat(agent): attribute process trees and gpu usage by owned pid"
```

---

## Task 6: Lock Down Race Regressions, Docs, And End-To-End Verification

**Files:**
- Modify: `agent/tests/store/test_tasks.py`
- Modify: `agent/tests/daemon/test_runtime_monitor.py`
- Modify: `docs/developer/architecture.md`
- Modify: `docs/developer/testing-and-debugging.md`

- [ ] **Step 1: Add the last race-regression tests**

Append to `agent/tests/store/test_tasks.py`:

```python
def test_late_cli_finish_does_not_override_monitor_orphan_finalize(conn):
    record = create_task(conn, _spec(launch_mode=TaskLaunchMode.attached_python))
    now = time.time()
    attach_runtime(conn, record.id, pid=7777, gpu_ids=[0], started_at=now)

    orphan = guarded_finalize_task(
        conn,
        record.id,
        status=TaskStatus.failed,
        finished_at=now + 1,
        exit_code=None,
        finalize_source="monitor_orphan",
        finalize_reason_code="orphaned",
    )
    late = guarded_finalize_task(
        conn,
        record.id,
        status=TaskStatus.failed,
        finished_at=now + 2,
        exit_code=130,
        finalize_source="cli_finish",
        finalize_reason_code="ctrl_c",
    )

    assert orphan.transitioned is True
    assert late.transitioned is False
    assert _require_task(conn, record.id).exit_code is None
```

Append to `agent/tests/daemon/test_runtime_monitor.py`:

```python
def test_explicit_cancel_beats_runner_exit(conn):
    task = create_task(conn, _spec())
    now = time.time()
    attach_runtime(conn, task.id, pid=3131, gpu_ids=[0], started_at=now)

    cancel = guarded_finalize_task(
        conn,
        task.id,
        status=TaskStatus.cancelled,
        finished_at=now + 1,
        exit_code=None,
        finalize_source="cancel",
        finalize_reason_code="explicit_cancel",
    )
    runner = guarded_finalize_task(
        conn,
        task.id,
        status=TaskStatus.failed,
        finished_at=now + 2,
        exit_code=1,
        finalize_source="runner_exit",
    )

    assert cancel.transitioned is True
    assert runner.transitioned is False
    assert get_task(conn, task.id).status == TaskStatus.cancelled
```

- [ ] **Step 2: Run the race-regression tests to verify they fail**

Run:

```powershell
Set-Location C:\Users\huany\Desktop\workspace\Projects\pmeow
& .\.venv\Scripts\Activate.ps1
Set-Location agent
pytest tests/store/test_tasks.py tests/daemon/test_runtime_monitor.py -k "late_cli_finish or explicit_cancel" -v
```

Expected: FAIL until all finalize-source precedence rules are in place.

- [ ] **Step 3: Update architecture and debugging docs**

Add a short section to `docs/developer/architecture.md`:

```markdown
### Runtime Monitor Loop

The daemon now owns task liveness through `task_runtime` and `task_processes`.
`collect_cycle()` still handles metrics and scheduling, but terminal convergence for
local tasks is driven by `RuntimeMonitorLoop`, which refreshes current process trees
and funnels `runner_exit`, `cli_finish`, `cancel`, and orphan detection through the
same guarded finalize path.
```

Add a focused debug section to `docs/developer/testing-and-debugging.md`:

```markdown
## Runtime Monitor Debugging

- `pytest tests/daemon/test_runtime_monitor.py -v`
- `pytest tests/store/test_tasks.py -k guarded_finalize -v`
- inspect `task_events` for `runtime_orphan_detected`, `runtime_finalized`, and `runtime_finalize_ignored_late_source`
- on Windows, validate behavior with psutil-backed liveness checks rather than signal assumptions
```

- [ ] **Step 4: Run the focused suites and the full agent regression suite**

Run:

```powershell
Set-Location C:\Users\huany\Desktop\workspace\Projects\pmeow
& .\.venv\Scripts\Activate.ps1
Set-Location agent
pytest tests/store/test_task_runtime.py tests/store/test_tasks.py tests/daemon/test_runtime_monitor.py tests/daemon/test_service.py tests/test_cli_python.py tests/executor/test_attached.py tests/collector/test_gpu.py tests/collector/test_base_collectors.py tests/test_models.py -v
pytest -v
```

Expected: PASS. If `pytest -v` surfaces unrelated pre-existing failures, capture them separately and do not fold unrelated fixes into this increment.

- [ ] **Step 5: Commit**

```bash
git add agent/tests/store/test_tasks.py agent/tests/daemon/test_runtime_monitor.py docs/developer/architecture.md docs/developer/testing-and-debugging.md
git commit -m "test(agent): lock runtime monitor race regressions"
```

---

## Race Conditions And Migration Notes

- Late `cli_finish` after monitor orphan finalize: do not special-case callers. Always route terminal writes through `guarded_finalize_task()` and log `runtime_finalize_ignored_late_source` when the task is already terminal.

- `cancel` versus `runner_exit`: treat `cancel` as the highest-priority local source by attempting it first and letting the guard reject any later runner callback.

- PID reuse: never keep stale `task_processes` rows after finalize. The monitor should replace the full current tree each tick, not incrementally accumulate dead PIDs.

- Existing databases: the schema migration must be additive and idempotent. On older databases, `task_runtime` and `task_processes` will be empty; `recover_after_restart()` must reconcile `tasks.status = 'running'` rows even when no runtime row exists.

- Windows behavior: rely on psutil existence and child enumeration rather than interpreting console signals. Use `130` only as the normalized CLI-reported Ctrl+C exit code.

- Transport deduplication: only send a terminal `taskUpdate` when `FinalizeOutcome.transitioned` is `True`. Late sources should still produce task events, but not duplicate transport updates.

## Verification Matrix

- Runtime schema and store: `pytest tests/store/test_task_runtime.py tests/store/test_tasks.py -k "runtime or guarded_finalize" -v`
- Monitor and service wiring: `pytest tests/daemon/test_runtime_monitor.py tests/daemon/test_service.py -k "runtime_monitor or attached or restart" -v`
- Attached CLI behavior: `pytest tests/test_cli_python.py tests/executor/test_attached.py -k "130 or attached" -v`
- Process and GPU attribution: `pytest tests/collector/test_gpu.py tests/collector/test_base_collectors.py tests/test_models.py -k "ppid or child_pid or runtime_tree" -v`
- Full regression: `pytest -v`

## Self-Review

- Spec coverage: the plan covers runtime state foundation, guarded finalize, monitor loop, `attached_python` and `daemon_shell` integration, process-tree-based GPU attribution, restart recovery, and test coverage.

- Placeholder scan: no `TODO`, `TBD`, or task references without concrete file targets, code, and commands remain.

- Type consistency: `RuntimePhase`, `TaskRuntimeRecord`, `TaskProcessRecord`, `FinalizeOutcome`, `guarded_finalize_task()`, and `build_task_process_index()` are used consistently across later tasks.
