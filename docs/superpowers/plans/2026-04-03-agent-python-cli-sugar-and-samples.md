# Agent Python CLI Sugar And PyTorch Samples Implementation Plan

> **For agentic workers:** REQUIRED: Use the `subagent-driven-development` agent (recommended) or `executing-plans` agent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Python-first attached CLI flow that queues against the local agent scheduler, prints optional GPU wait reports, then hands the same terminal over to the Python process when resources are reserved; also ship optional PyTorch sample tasks without adding `torch` as a default dependency.

**Architecture:** Keep `DaemonService` as the scheduling authority and preserve the existing `submit` command as a background-style queue submission path. Add a new attached Python path that submits an `attached_python` task, lets the daemon reserve GPUs and emit structured queue-attempt events, then runs the Python child locally in the same terminal with inherited stdin and tee'd stdout or stderr into the task log. Reuse the existing SQLite `task_events` table for structured reports, create task logs at submission time, and expose a small local RPC surface so the attached CLI can poll state, confirm launch, and report completion.

**Tech Stack:** Python 3.10+, argparse, subprocess, threading, sqlite3, pytest, monkeypatch, torch (optional and user-installed only)

---

## File Structure

- Modify: `agent/pmeow/models.py:56-100`
Responsibility: add `launching` task status plus persisted metadata for attached Python tasks, including argv, launch mode, and report preference.

- Modify: `agent/pmeow/store/database.py:13-101`
Responsibility: migrate the `tasks` table with attached-launch columns and normalize restart recovery for `launching` versus `running` tasks.

- Modify: `agent/pmeow/store/tasks.py:14-187`
Responsibility: persist the new task fields, manage attached launch reservation and confirmation, requeue expired launches, and read or write `task_events`.

- Create: `agent/pmeow/task_reporting.py`
Responsibility: format per-attempt queue reports and compact per-GPU overview strings from the current allocation snapshot.

- Modify: `agent/pmeow/daemon/service.py:34-146`
Responsibility: create task logs on submission, append structured queue reports, reserve GPUs for attached tasks instead of spawning them in the daemon, recycle expired launches, and expose service methods for attached task polling and completion.

- Modify: `agent/pmeow/daemon/socket_server.py:1-197`
Responsibility: add RPC methods for `get_task`, `get_task_events`, `confirm_attached_launch`, and `finish_attached_task`, and include attached-task fields plus `log_path` in task payloads.

- Modify: `agent/pmeow/executor/logs.py:1-31`
Responsibility: create logs at submission time and append human-readable report lines or attached-process output without truncating earlier content.

- Modify: `agent/pmeow/executor/runner.py:22-55`
Responsibility: switch daemon-managed tasks to append mode so existing task-log headers and queue reports are preserved when the background runner starts writing stdout or stderr.

- Create: `agent/pmeow/executor/attached.py`
Responsibility: run a local Python child with direct terminal input and tee its stdout or stderr to both the terminal and the task log.

- Create: `agent/pmeow/cli_python.py`
Responsibility: detect the Python sugar path, parse PMEOW flags before the first `.py` token, submit an attached task, optionally print queue reports while waiting, then launch the local Python child once the daemon reserves GPUs.

- Modify: `agent/pmeow/__main__.py:13-186`
Responsibility: dispatch to the new attached Python path before argparse subcommands while preserving every existing explicit subcommand.

- Create: `agent/pmeow/examples/__init__.py`
Responsibility: package shared optional example helpers so the tracked example scripts stay tiny and testable.

- Create: `agent/pmeow/examples/pytorch_tasks.py`
Responsibility: hold the reusable PyTorch sample-task logic with lazy `torch` import, per-GPU memory parsing, and clear install guidance when `torch` is missing.

- Create: `agent/examples/tasks/pytorch_hold.py`
Responsibility: allocate the same amount of VRAM on each visible GPU for a fixed duration.

- Create: `agent/examples/tasks/pytorch_stagger.py`
Responsibility: allocate different amounts of VRAM per visible GPU so multi-GPU placement is easy to verify.

- Create: `agent/examples/tasks/pytorch_chatty.py`
Responsibility: allocate VRAM and print periodic heartbeats so queueing, launch, and steady-state logging are all easy to observe.

- Create: `agent/tests/test_cli_python.py`
Responsibility: validate Python sugar detection, VRAM unit parsing, and the attached CLI submit or finish flow with mocked RPCs.

- Create: `agent/tests/executor/test_attached.py`
Responsibility: validate attached-process stdout, stderr, stdin forwarding, and task-log tee behavior.

- Modify: `agent/tests/store/test_tasks.py:9-189`
Responsibility: cover the new task fields, launch reservation helpers, expiry requeue, and task-event queries.

- Modify: `agent/tests/daemon/test_service.py:1-135`
Responsibility: cover queue-report emission, attached launch reservation, attached completion, and the new socket roundtrips.

- Modify: `agent/tests/executor/test_runner.py:1-124`
Responsibility: prove daemon-managed tasks append to precreated logs instead of truncating report headers.

- Modify: `agent/tests/test_e2e_smoke.py:1-89`
Responsibility: add a real attached-Python smoke test that starts a temporary daemon loop, submits a `.py` script through the new sugar path, and verifies final logs plus task status.

- Create: `agent/tests/examples/test_pytorch_tasks.py`
Responsibility: cover memory parsing and the missing-`torch` guidance without requiring `torch` in CI.

- Modify: `agent/README.md:1-126`
Responsibility: document the new Python sugar, `--report` behavior, and the optional PyTorch sample tasks while explicitly stating that users install `torch` themselves.

- Modify: `docs/user/agent-nodes.md:1-170`
Responsibility: document the node-side interactive Python workflow, queue reports, and sample task invocation examples.

### Task 1: Persist Attached Task Metadata And Structured Events

**Files:**
- Modify: `agent/pmeow/models.py:56-100`
- Modify: `agent/pmeow/store/database.py:13-101`
- Modify: `agent/pmeow/store/tasks.py:14-187`
- Modify: `agent/tests/store/test_tasks.py:9-189`

- [ ] **Step 1: Write the failing persistence tests**

Append these imports and tests to `agent/tests/store/test_tasks.py`:

```python
from pmeow.models import TaskLaunchMode, TaskStatus
from pmeow.store.tasks import (
    append_task_event,
    attach_runtime,
    cancel_task,
    confirm_attached_launch,
    create_task,
    finish_task,
    get_task,
    list_queued_tasks,
    list_task_events,
    list_tasks,
    requeue_expired_attached_launches,
    reserve_attached_launch,
)


class TestAttachedTaskPersistence:
    def test_create_and_get_attached_python_task(self, conn):
        record = create_task(conn, _spec(
            command="python demo.py --epochs 1",
            argv=["/usr/bin/python3", "demo.py", "--epochs", "1"],
            launch_mode=TaskLaunchMode.attached_python,
            report_requested=True,
        ))

        fetched = get_task(conn, record.id)
        assert fetched is not None
        assert fetched.launch_mode == TaskLaunchMode.attached_python
        assert fetched.argv == ["/usr/bin/python3", "demo.py", "--epochs", "1"]
        assert fetched.report_requested is True
        assert fetched.status == TaskStatus.queued

    def test_reserve_confirm_and_requeue_attached_launch(self, conn):
        record = create_task(conn, _spec(
            command="python demo.py",
            argv=["/usr/bin/python3", "demo.py"],
            launch_mode=TaskLaunchMode.attached_python,
        ))
        now = time.time()

        reserve_attached_launch(
            conn,
            record.id,
            gpu_ids=[0, 1],
            launch_deadline=now + 30,
            reserved_at=now,
        )
        launching = get_task(conn, record.id)
        assert launching.status == TaskStatus.launching
        assert launching.gpu_ids == [0, 1]
        assert launching.launch_deadline == pytest.approx(now + 30, abs=0.01)

        confirm_attached_launch(conn, record.id, pid=4321, started_at=now + 1)
        running = get_task(conn, record.id)
        assert running.status == TaskStatus.running
        assert running.pid == 4321

        reserve_attached_launch(
            conn,
            record.id,
            gpu_ids=[0],
            launch_deadline=now - 1,
            reserved_at=now - 5,
        )
        requeue_expired_attached_launches(conn, now=now)
        requeued = get_task(conn, record.id)
        assert requeued.status == TaskStatus.queued
        assert requeued.gpu_ids is None
        assert requeued.launch_deadline is None


class TestTaskEvents:
    def test_append_and_list_task_events(self, conn):
        record = create_task(conn, _spec())
        append_task_event(conn, record.id, "queue_probe", time.time(), {"message": "still waiting"})
        append_task_event(conn, record.id, "launch_reserved", time.time(), {"message": "gpu0 selected"})

        events = list_task_events(conn, record.id)

        assert [event["event_type"] for event in events] == ["queue_probe", "launch_reserved"]
        assert events[0]["details"]["message"] == "still waiting"
```

- [ ] **Step 2: Run the store tests to verify they fail**

Run:

```bash
cd agent
. .venv/bin/activate
pytest tests/store/test_tasks.py -v
```

Expected: FAIL with missing `TaskLaunchMode`, missing helper functions, and missing task columns such as `argv_json` or `launch_mode`.

- [ ] **Step 3: Extend the task model and database schema**

Update `agent/pmeow/models.py` and `agent/pmeow/store/database.py` so attached tasks have a stable persisted shape:

```python
class TaskStatus(enum.Enum):
    queued = "queued"
    launching = "launching"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class TaskLaunchMode(enum.Enum):
    daemon_shell = "daemon_shell"
    attached_python = "attached_python"


@dataclass
class TaskSpec:
    command: str
    cwd: str
    user: str
    require_vram_mb: int
    require_gpu_count: int = 1
    gpu_ids: Optional[list[int]] = None
    priority: int = 10
    argv: Optional[list[str]] = None
    launch_mode: TaskLaunchMode = TaskLaunchMode.daemon_shell
    report_requested: bool = False


@dataclass
class TaskRecord:
    id: str
    command: str
    cwd: str
    user: str
    require_vram_mb: int
    require_gpu_count: int
    gpu_ids: Optional[list[int]]
    priority: int
    status: TaskStatus
    created_at: float
    argv: Optional[list[str]] = None
    launch_mode: TaskLaunchMode = TaskLaunchMode.daemon_shell
    report_requested: bool = False
    launch_deadline: Optional[float] = None
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    exit_code: Optional[int] = None
    pid: Optional[int] = None
```

```python
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    command TEXT NOT NULL,
    cwd TEXT NOT NULL,
    user TEXT NOT NULL,
    require_vram_mb INTEGER NOT NULL,
    require_gpu_count INTEGER NOT NULL DEFAULT 1,
    argv_json TEXT,
    launch_mode TEXT NOT NULL DEFAULT 'daemon_shell',
    report_requested INTEGER NOT NULL DEFAULT 0,
    launch_deadline REAL,
    gpu_ids TEXT,
    priority INTEGER NOT NULL DEFAULT 10,
    status TEXT NOT NULL DEFAULT 'queued',
    created_at REAL NOT NULL,
    started_at REAL,
    finished_at REAL,
    exit_code INTEGER,
    pid INTEGER
);


def _ensure_task_columns(conn: sqlite3.Connection) -> None:
    cols = conn.execute("PRAGMA table_info(tasks)").fetchall()
    names = {row[1] for row in cols}
    if "argv_json" not in names:
        conn.execute("ALTER TABLE tasks ADD COLUMN argv_json TEXT")
    if "launch_mode" not in names:
        conn.execute("ALTER TABLE tasks ADD COLUMN launch_mode TEXT NOT NULL DEFAULT 'daemon_shell'")
    if "report_requested" not in names:
        conn.execute("ALTER TABLE tasks ADD COLUMN report_requested INTEGER NOT NULL DEFAULT 0")
    if "launch_deadline" not in names:
        conn.execute("ALTER TABLE tasks ADD COLUMN launch_deadline REAL")
    conn.commit()


def recover_interrupted_tasks(conn: sqlite3.Connection) -> None:
    now = time.time()
    rows = conn.execute(
        "SELECT id, status FROM tasks WHERE status IN ('running', 'launching')"
    ).fetchall()

    for task_id, status in rows:
        if status == "launching":
            conn.execute(
                "UPDATE tasks SET status = 'queued', gpu_ids = NULL, launch_deadline = NULL WHERE id = ?",
                (task_id,),
            )
            conn.execute(
                "DELETE FROM resource_reservations WHERE task_id = ?",
                (task_id,),
            )
            conn.execute(
                "INSERT INTO task_events (task_id, event_type, timestamp, details) VALUES (?, 'launch_requeued_after_restart', ?, NULL)",
                (task_id, now),
            )
            continue

        conn.execute(
            "UPDATE tasks SET status = 'failed', finished_at = ? WHERE id = ?",
            (now, task_id),
        )
        conn.execute(
            "INSERT INTO task_events (task_id, event_type, timestamp, details) VALUES (?, 'daemon_restart', ?, NULL)",
            (task_id, now),
        )
        conn.execute(
            "DELETE FROM resource_reservations WHERE task_id = ?",
            (task_id,),
        )

    conn.commit()
```

- [ ] **Step 4: Implement task-store helpers for attached launches and task events**

Update `agent/pmeow/store/tasks.py` so it reads and writes the new columns and exposes reusable helpers:

```python
_SELECT_COLS = (
    "id, command, cwd, user, require_vram_mb, require_gpu_count, argv_json, "
    "launch_mode, report_requested, launch_deadline, gpu_ids, priority, status, "
    "created_at, started_at, finished_at, exit_code, pid"
)


def create_task(conn: sqlite3.Connection, spec: TaskSpec) -> TaskRecord:
    task_id = str(uuid.uuid4())
    now = time.time()
    conn.execute(
        "INSERT INTO tasks "
        "(id, command, cwd, user, require_vram_mb, require_gpu_count, argv_json, launch_mode, report_requested, gpu_ids, priority, status, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)",
        (
            task_id,
            spec.command,
            spec.cwd,
            spec.user,
            spec.require_vram_mb,
            spec.require_gpu_count,
            json.dumps(spec.argv) if spec.argv is not None else None,
            spec.launch_mode.value,
            1 if spec.report_requested else 0,
            json.dumps(spec.gpu_ids) if spec.gpu_ids is not None else None,
            spec.priority,
            now,
        ),
    )
    conn.commit()
    return get_task(conn, task_id)


def reserve_attached_launch(
    conn: sqlite3.Connection,
    task_id: str,
    gpu_ids: list[int],
    launch_deadline: float,
    reserved_at: float,
) -> None:
    conn.execute(
        "UPDATE tasks SET status = 'launching', gpu_ids = ?, launch_deadline = ? WHERE id = ?",
        (json.dumps(gpu_ids), launch_deadline, task_id),
    )
    task = get_task(conn, task_id)
    vram_per_gpu = task.require_vram_mb if task else 0
    for gpu_index in gpu_ids:
        conn.execute(
            "INSERT INTO resource_reservations (task_id, gpu_index, vram_mb, created_at) VALUES (?, ?, ?, ?)",
            (task_id, gpu_index, vram_per_gpu, reserved_at),
        )
    conn.commit()


def confirm_attached_launch(conn: sqlite3.Connection, task_id: str, pid: int, started_at: float) -> None:
    conn.execute(
        "UPDATE tasks SET status = 'running', pid = ?, started_at = ?, launch_deadline = NULL WHERE id = ?",
        (pid, started_at, task_id),
    )
    conn.commit()


def requeue_expired_attached_launches(conn: sqlite3.Connection, now: float) -> list[str]:
    rows = conn.execute(
        "SELECT id FROM tasks WHERE status = 'launching' AND launch_deadline IS NOT NULL AND launch_deadline < ?",
        (now,),
    ).fetchall()
    task_ids = [row[0] for row in rows]
    for task_id in task_ids:
        conn.execute(
            "UPDATE tasks SET status = 'queued', gpu_ids = NULL, launch_deadline = NULL, pid = NULL WHERE id = ?",
            (task_id,),
        )
        conn.execute("DELETE FROM resource_reservations WHERE task_id = ?", (task_id,))
    conn.commit()
    return task_ids


def append_task_event(
    conn: sqlite3.Connection,
    task_id: str,
    event_type: str,
    timestamp: float,
    details: dict | None = None,
) -> None:
    conn.execute(
        "INSERT INTO task_events (task_id, event_type, timestamp, details) VALUES (?, ?, ?, ?)",
        (task_id, event_type, timestamp, json.dumps(details) if details is not None else None),
    )
    conn.commit()


def list_task_events(conn: sqlite3.Connection, task_id: str, after_id: int = 0) -> list[dict]:
    rows = conn.execute(
        "SELECT id, event_type, timestamp, details FROM task_events WHERE task_id = ? AND id > ? ORDER BY id ASC",
        (task_id, after_id),
    ).fetchall()
    return [
        {
            "id": row[0],
            "event_type": row[1],
            "timestamp": row[2],
            "details": json.loads(row[3]) if row[3] else None,
        }
        for row in rows
    ]
```

- [ ] **Step 5: Run the store tests again**

Run:

```bash
cd agent
. .venv/bin/activate
pytest tests/store/test_tasks.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent/pmeow/models.py agent/pmeow/store/database.py agent/pmeow/store/tasks.py agent/tests/store/test_tasks.py
git commit -m "feat(agent): persist attached python task metadata"
```

### Task 2: Create Submission-Time Logs And Daemon Queue Reports

**Files:**
- Create: `agent/pmeow/task_reporting.py`
- Modify: `agent/pmeow/executor/logs.py:1-31`
- Modify: `agent/pmeow/executor/runner.py:22-55`
- Modify: `agent/pmeow/daemon/service.py:34-146`
- Modify: `agent/tests/executor/test_runner.py:1-124`
- Modify: `agent/tests/daemon/test_service.py:1-135`

- [ ] **Step 1: Write the failing log and report tests**

Append these tests to `agent/tests/executor/test_runner.py` and `agent/tests/daemon/test_service.py`:

```python
def test_runner_appends_to_existing_task_log(self, tmp_path: object) -> None:
    log_dir = str(tmp_path)
    append_task_log_line("append-task", log_dir, "[queued] waiting for GPUs")

    runner = TaskRunner()
    task = _make_task("echo hello", cwd=str(tmp_path), task_id="append-task")
    proc = runner.start(task, gpu_ids=[0], log_dir=log_dir)
    proc.wait(timeout=10)
    runner.check_completed()

    content = read_task_log("append-task", log_dir)
    assert "[queued] waiting for GPUs" in content
    assert "hello" in content
```

```python
from types import SimpleNamespace

from pmeow.models import TaskLaunchMode, TaskStatus


def test_collect_cycle_reserves_attached_task_and_writes_report(tmp_state, monkeypatch):
    svc = DaemonService(tmp_state)
    record = svc.submit_task(_make_spec(
        command="python demo.py",
        argv=["/usr/bin/python3", "demo.py"],
        launch_mode=TaskLaunchMode.attached_python,
        report_requested=True,
        require_vram_mb=0,
        require_gpu_count=0,
    ))

    monkeypatch.setattr(
        "pmeow.daemon.service.collect_snapshot",
        lambda **kwargs: SimpleNamespace(timestamp=time.time(), gpu_allocation=None),
    )
    start_calls: list[tuple] = []
    monkeypatch.setattr(svc.runner, "start", lambda *args, **kwargs: start_calls.append(args))

    svc.collect_cycle()

    task = svc.get_task(record.id)
    assert task is not None
    assert task.status == TaskStatus.launching
    assert start_calls == []
    assert "launch reserved" in svc.get_logs(record.id).lower()


def test_collect_cycle_requeues_expired_attached_launch(tmp_state, monkeypatch):
    svc = DaemonService(tmp_state)
    record = svc.submit_task(_make_spec(
        command="python demo.py",
        argv=["/usr/bin/python3", "demo.py"],
        launch_mode=TaskLaunchMode.attached_python,
        require_vram_mb=0,
        require_gpu_count=0,
    ))
    now = time.time()
    reserve_attached_launch(svc.db, record.id, gpu_ids=[0], launch_deadline=now - 1, reserved_at=now - 5)

    monkeypatch.setattr(
        "pmeow.daemon.service.collect_snapshot",
        lambda **kwargs: SimpleNamespace(timestamp=time.time(), gpu_allocation=None),
    )
    svc.collect_cycle()

    task = svc.get_task(record.id)
    assert task is not None
    assert task.status == TaskStatus.queued
    assert task.gpu_ids is None
    assert "launch reservation expired" in svc.get_logs(record.id).lower()
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:

```bash
cd agent
. .venv/bin/activate
pytest tests/executor/test_runner.py tests/daemon/test_service.py -v
```

Expected: FAIL because `append_task_log_line` does not exist, the runner still truncates logs, and `DaemonService` does not yet expose `get_task` or attached launch behavior.

- [ ] **Step 3: Make task logs appendable from the moment a task is created**

Update `agent/pmeow/executor/logs.py` and `agent/pmeow/executor/runner.py`:

```python
def ensure_task_log(task_id: str, log_dir: str) -> str:
    os.makedirs(log_dir, exist_ok=True)
    path = get_task_log_path(task_id, log_dir)
    if not os.path.exists(path):
        open(path, "ab").close()
    return path


def open_task_log(task_id: str, log_dir: str, append: bool = False) -> IO[bytes]:
    path = ensure_task_log(task_id, log_dir)
    return open(path, "ab" if append else "wb")


def append_task_log_line(task_id: str, log_dir: str, message: str) -> None:
    path = ensure_task_log(task_id, log_dir)
    with open(path, "ab") as fh:
        fh.write((message.rstrip("\n") + "\n").encode())
```

```python
def start(
    self, task: TaskRecord, gpu_ids: list[int], log_dir: str
) -> subprocess.Popen:
    log_fh = open_task_log(task.id, log_dir, append=True)
    env = os.environ.copy()
    env["CUDA_VISIBLE_DEVICES"] = ",".join(str(g) for g in gpu_ids)

    proc = subprocess.Popen(
        task.command,
        shell=True,
        cwd=task.cwd,
        env=env,
        stdout=log_fh,
        stderr=subprocess.STDOUT,
    )
```

- [ ] **Step 4: Add queue-report formatting and daemon-side attached launch reservation**

Create `agent/pmeow/task_reporting.py` and update `agent/pmeow/daemon/service.py` so attached tasks produce one readable report line per scheduling attempt:

```python
def format_gpu_overview(per_gpu: list[PerGpuAllocationSummary]) -> str:
    if not per_gpu:
        return "gpu-overview: no GPU allocation data available"

    parts: list[str] = []
    for gpu in per_gpu:
        parts.append(
            f"gpu{gpu.gpu_index}: free={int(gpu.effective_free_mb)}MB "
            f"pmeow={len(gpu.pmeow_tasks)} user={len(gpu.user_processes)} unknown={len(gpu.unknown_processes)}"
        )
    return "gpu-overview: " + " | ".join(parts)


def format_waiting_report(task: TaskRecord, per_gpu: list[PerGpuAllocationSummary]) -> str:
    return (
        f"queue probe: need {task.require_gpu_count} gpu(s) with >= {task.require_vram_mb}MB each; "
        f"{format_gpu_overview(per_gpu)}"
    )


def format_launch_report(task: TaskRecord, gpu_ids: list[int], per_gpu: list[PerGpuAllocationSummary]) -> str:
    selected = ",".join(str(gpu_id) for gpu_id in gpu_ids) or "cpu-only"
    return f"launch reserved: selected {selected}; {format_gpu_overview(per_gpu)}"
```

```python
def _record_task_message(self, task_id: str, event_type: str, message: str) -> None:
    append_task_event(self.db, task_id, event_type, time.time(), {"message": message})
    append_task_log_line(task_id, self.config.log_dir, message)


def submit_task(self, spec: TaskSpec) -> TaskRecord:
    with self._lock:
        task = create_task(self.db, spec)
        ensure_task_log(task.id, self.config.log_dir)
        self._record_task_message(
            task.id,
            "submitted",
            f"submitted task {task.id} mode={task.launch_mode.value} command={task.command}",
        )
        return task


def get_task(self, task_id: str) -> TaskRecord | None:
    with self._lock:
        return get_task(self.db, task_id)


def collect_cycle(self) -> None:
    snapshot = collect_snapshot(
        server_id=self.config.agent_id or "local",
        task_store=self.db,
        redundancy_coefficient=self.config.vram_redundancy_coefficient,
    )
    per_gpu = snapshot.gpu_allocation.per_gpu if snapshot.gpu_allocation else []

    with self._lock:
        expired = requeue_expired_attached_launches(self.db, now=time.time())
        for task_id in expired:
            self._record_task_message(task_id, "launch_expired", "launch reservation expired; returning task to queued state")

        self.history.record(snapshot.timestamp, per_gpu)

        if not is_queue_paused(self.db):
            queued_attached = [
                task for task in db_list_tasks(self.db, TaskStatus.queued)
                if task.launch_mode == TaskLaunchMode.attached_python
            ]
            for task in queued_attached:
                self._record_task_message(task.id, "queue_probe", format_waiting_report(task, per_gpu))

            decisions = self.scheduler.try_schedule(self.db, per_gpu)
            for decision in decisions:
                task = get_task(self.db, decision.task_id)
                if task is None:
                    continue
                if task.launch_mode == TaskLaunchMode.attached_python:
                    reserve_attached_launch(
                        self.db,
                        task.id,
                        gpu_ids=decision.gpu_ids,
                        launch_deadline=time.time() + 30,
                        reserved_at=time.time(),
                    )
                    self._record_task_message(task.id, "launch_reserved", format_launch_report(task, decision.gpu_ids, per_gpu))
                    continue

                proc = self.runner.start(task, decision.gpu_ids, self.config.log_dir)
                attach_runtime(self.db, task.id, proc.pid, decision.gpu_ids, time.time())
```

- [ ] **Step 5: Run the targeted tests again**

Run:

```bash
cd agent
. .venv/bin/activate
pytest tests/executor/test_runner.py tests/daemon/test_service.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent/pmeow/task_reporting.py agent/pmeow/executor/logs.py agent/pmeow/executor/runner.py agent/pmeow/daemon/service.py agent/tests/executor/test_runner.py agent/tests/daemon/test_service.py
git commit -m "feat(agent): add attached queue reports and submission-time task logs"
```

### Task 3: Expose Attached Task Polling And Completion Over The Local Socket API

**Files:**
- Modify: `agent/pmeow/daemon/service.py:34-220`
- Modify: `agent/pmeow/daemon/socket_server.py:1-197`
- Modify: `agent/tests/daemon/test_service.py:1-220`

- [ ] **Step 1: Write the failing service and socket tests**

Append these tests to `agent/tests/daemon/test_service.py`:

```python
def test_confirm_and_finish_attached_task(tmp_state):
    svc = DaemonService(tmp_state)
    record = svc.submit_task(_make_spec(
        command="python demo.py",
        argv=["/usr/bin/python3", "demo.py"],
        launch_mode=TaskLaunchMode.attached_python,
        require_vram_mb=0,
        require_gpu_count=0,
    ))
    now = time.time()
    reserve_attached_launch(svc.db, record.id, gpu_ids=[0], launch_deadline=now + 30, reserved_at=now)

    assert svc.confirm_attached_launch(record.id, pid=5432) is True
    running = svc.get_task(record.id)
    assert running is not None
    assert running.status == TaskStatus.running
    assert running.pid == 5432

    assert svc.finish_attached_task(record.id, exit_code=0) is True
    finished = svc.get_task(record.id)
    assert finished is not None
    assert finished.status == TaskStatus.completed
    assert finished.exit_code == 0


def test_socket_roundtrip_for_attached_methods(tmp_state):
    svc = DaemonService(tmp_state)
    srv = SocketServer(tmp_state.socket_path, svc)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    time.sleep(0.2)

    try:
        submit = send_request(tmp_state.socket_path, "submit_task", {
            "command": "python demo.py",
            "cwd": "/tmp",
            "user": "tester",
            "require_vram_mb": 0,
            "require_gpu_count": 0,
            "argv": ["/usr/bin/python3", "demo.py"],
            "launch_mode": "attached_python",
            "report_requested": True,
        })
        assert submit["ok"] is True
        task_id = submit["result"]["id"]

        reserve_attached_launch(svc.db, task_id, gpu_ids=[0], launch_deadline=time.time() + 30, reserved_at=time.time())

        current = send_request(tmp_state.socket_path, "get_task", {"task_id": task_id})
        assert current["ok"] is True
        assert current["result"]["launch_mode"] == "attached_python"
        assert current["result"]["log_path"].endswith(f"{task_id}.log")

        confirm = send_request(tmp_state.socket_path, "confirm_attached_launch", {"task_id": task_id, "pid": 6543})
        assert confirm["ok"] is True
        assert confirm["result"] is True

        finish = send_request(tmp_state.socket_path, "finish_attached_task", {"task_id": task_id, "exit_code": 0})
        assert finish["ok"] is True
        assert finish["result"] is True

        events = send_request(tmp_state.socket_path, "get_task_events", {"task_id": task_id, "after_id": 0})
        assert events["ok"] is True
        assert any(event["event_type"] == "launch_reserved" for event in events["result"])
    finally:
        srv.shutdown()
        close_database(svc.db)
```

- [ ] **Step 2: Run the daemon tests to verify they fail**

Run:

```bash
cd agent
. .venv/bin/activate
pytest tests/daemon/test_service.py -v
```

Expected: FAIL because `DaemonService` does not yet expose `confirm_attached_launch`, `finish_attached_task`, `get_task_events`, or the new socket RPC methods.

- [ ] **Step 3: Add service methods for attached launch confirmation and completion**

Update `agent/pmeow/daemon/service.py` with explicit read or write helpers for the attached CLI path:

```python
def get_task_events(self, task_id: str, after_id: int = 0) -> list[dict]:
    with self._lock:
        return list_task_events(self.db, task_id, after_id=after_id)


def confirm_attached_launch(self, task_id: str, pid: int) -> bool:
    with self._lock:
        task = get_task(self.db, task_id)
        if task is None or task.status != TaskStatus.launching:
            return False
        confirm_attached_launch(self.db, task_id, pid=pid, started_at=time.time())
        self._record_task_message(task_id, "attached_started", f"attached process started with pid={pid}")
        if self.transport:
            self.transport.send_task_update(TaskUpdate(
                task_id=task_id,
                status=TaskStatus.running,
                started_at=time.time(),
                pid=pid,
            ))
        return True


def finish_attached_task(self, task_id: str, exit_code: int) -> bool:
    with self._lock:
        task = get_task(self.db, task_id)
        if task is None or task.launch_mode != TaskLaunchMode.attached_python:
            return False
        finished_at = time.time()
        finish_task(self.db, task_id, exit_code, finished_at)
        self._record_task_message(
            task_id,
            "attached_finished",
            f"attached process finished exit_code={exit_code}",
        )
        if self.transport:
            self.transport.send_task_update(TaskUpdate(
                task_id=task_id,
                status=TaskStatus.completed if exit_code == 0 else TaskStatus.failed,
                finished_at=finished_at,
                exit_code=exit_code,
            ))
        return True
```

- [ ] **Step 4: Add socket methods and enrich task payloads**

Update `agent/pmeow/daemon/socket_server.py` so the local CLI can poll attached-task state without parsing logs:

```python
def _to_task_dict(rec: Any, *, log_dir: str | None = None) -> dict:
    result = {
        "id": rec.id,
        "command": rec.command,
        "cwd": rec.cwd,
        "user": rec.user,
        "require_vram_mb": rec.require_vram_mb,
        "require_gpu_count": rec.require_gpu_count,
        "argv": rec.argv,
        "launch_mode": rec.launch_mode.value,
        "report_requested": rec.report_requested,
        "launch_deadline": rec.launch_deadline,
        "gpu_ids": rec.gpu_ids,
        "priority": rec.priority,
        "status": rec.status.value,
        "created_at": rec.created_at,
        "started_at": rec.started_at,
        "finished_at": rec.finished_at,
        "exit_code": rec.exit_code,
        "pid": rec.pid,
    }
    if log_dir is not None:
        result["log_path"] = get_task_log_path(rec.id, log_dir)
    return result


def _get_task(svc: DaemonService, params: dict) -> dict | None:
    task = svc.get_task(params["task_id"])
    return _to_task_dict(task, log_dir=svc.config.log_dir) if task is not None else None


def _get_task_events(svc: DaemonService, params: dict) -> list[dict]:
    return svc.get_task_events(params["task_id"], after_id=params.get("after_id", 0))


def _confirm_attached_launch(svc: DaemonService, params: dict) -> bool:
    return svc.confirm_attached_launch(params["task_id"], pid=params["pid"])


def _finish_attached_task(svc: DaemonService, params: dict) -> bool:
    return svc.finish_attached_task(params["task_id"], exit_code=params["exit_code"])


_METHODS = {
    "submit_task": _submit_task,
    "list_tasks": _list_tasks,
    "get_task": _get_task,
    "get_task_events": _get_task_events,
    "cancel_task": _cancel_task,
    "get_logs": _get_logs,
    "confirm_attached_launch": _confirm_attached_launch,
    "finish_attached_task": _finish_attached_task,
    "pause_queue": _pause_queue,
    "resume_queue": _resume_queue,
    "get_status": _get_status,
}
```

- [ ] **Step 5: Run the daemon tests again**

Run:

```bash
cd agent
. .venv/bin/activate
pytest tests/daemon/test_service.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent/pmeow/daemon/service.py agent/pmeow/daemon/socket_server.py agent/tests/daemon/test_service.py
git commit -m "feat(agent): expose attached task polling over local socket api"
```

### Task 4: Build The Python Sugar CLI And Attached Executor

**Files:**
- Create: `agent/pmeow/executor/attached.py`
- Create: `agent/pmeow/cli_python.py`
- Modify: `agent/pmeow/__main__.py:13-186`
- Create: `agent/tests/executor/test_attached.py`
- Create: `agent/tests/test_cli_python.py`

- [ ] **Step 1: Write the failing parser and attached-executor tests**

Create `agent/tests/executor/test_attached.py` and `agent/tests/test_cli_python.py` with:

```python
from __future__ import annotations

import io
import os
import sys

from pmeow.executor.attached import run_attached_python


def test_run_attached_python_streams_to_console_and_log(tmp_path, capsys):
    script = tmp_path / "attached_demo.py"
    script.write_text(
        "import sys\n"
        "print('stdout-line')\n"
        "print('stderr-line', file=sys.stderr)\n"
    )
    seen_pid: list[int] = []
    log_path = tmp_path / "attached.log"

    exit_code = run_attached_python(
        argv=[sys.executable, str(script)],
        cwd=str(tmp_path),
        env=os.environ.copy(),
        log_path=str(log_path),
        on_started=seen_pid.append,
    )

    captured = capsys.readouterr()
    assert exit_code == 0
    assert seen_pid
    assert "stdout-line" in captured.out
    assert "stderr-line" in captured.err
    assert "stdout-line" in log_path.read_text()
    assert "stderr-line" in log_path.read_text()


def test_run_attached_python_forwards_stdin(tmp_path, capsys):
    script = tmp_path / "stdin_demo.py"
    script.write_text("print(input())\n")
    log_path = tmp_path / "stdin.log"

    exit_code = run_attached_python(
        argv=[sys.executable, str(script)],
        cwd=str(tmp_path),
        env=os.environ.copy(),
        log_path=str(log_path),
        stdin_source=io.BytesIO(b"hello from stdin\\n"),
        on_started=lambda pid: None,
    )

    assert exit_code == 0
    assert "hello from stdin" in capsys.readouterr().out
```

```python
from __future__ import annotations

import os

from pmeow.cli_python import detect_python_invocation, parse_vram_mb


def test_parse_vram_mb_accepts_gigabytes_and_megabytes():
    assert parse_vram_mb("10g") == 10240
    assert parse_vram_mb("512m") == 512
    assert parse_vram_mb("0") == 0


def test_detect_python_invocation_splits_flags_and_script_args(tmp_path):
    script = tmp_path / "train.py"
    script.write_text("print('hi')\n")

    invocation = detect_python_invocation([
        "-vram=10g",
        "-gpus=2",
        "--report",
        str(script),
        "--epochs",
        "3",
    ])

    assert invocation is not None
    assert invocation.require_vram_mb == 10240
    assert invocation.require_gpu_count == 2
    assert invocation.report is True
    assert invocation.script_path == str(script.resolve())
    assert invocation.script_args == ["--epochs", "3"]


def test_detect_python_invocation_skips_submit_subcommand():
    assert detect_python_invocation(["submit", "--pvram", "1024", "--", "python", "train.py"]) is None
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
cd agent
. .venv/bin/activate
pytest tests/executor/test_attached.py tests/test_cli_python.py -v
```

Expected: FAIL with `ModuleNotFoundError` for `pmeow.executor.attached` and `pmeow.cli_python`.

- [ ] **Step 3: Add the attached executor and the Python-sugar parser**

Create `agent/pmeow/executor/attached.py` and `agent/pmeow/cli_python.py` with these core functions:

```python
def run_attached_python(
    *,
    argv: list[str],
    cwd: str,
    env: dict[str, str],
    log_path: str,
    on_started: Callable[[int], None],
    stdin_source: BinaryIO | None = None,
    stdout_target: BinaryIO | None = None,
    stderr_target: BinaryIO | None = None,
) -> int:
    stdout_target = stdout_target or sys.stdout.buffer
    stderr_target = stderr_target or sys.stderr.buffer
    stdin_mode = subprocess.PIPE if stdin_source is not None else None

    with open(log_path, "ab") as log_fh:
        proc = subprocess.Popen(
            argv,
            cwd=cwd,
            env=env,
            stdin=stdin_mode,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        on_started(proc.pid)

        threads: list[threading.Thread] = []

        def _pump(source: BinaryIO, target: BinaryIO) -> None:
            while True:
                chunk = source.read(8192)
                if not chunk:
                    break
                target.write(chunk)
                target.flush()
                log_fh.write(chunk)
                log_fh.flush()

        if stdin_source is not None and proc.stdin is not None:
            def _feed_stdin() -> None:
                proc.stdin.write(stdin_source.read())
                proc.stdin.close()

            stdin_thread = threading.Thread(target=_feed_stdin, daemon=True)
            stdin_thread.start()
            threads.append(stdin_thread)

        assert proc.stdout is not None
        assert proc.stderr is not None
        threads.append(threading.Thread(target=_pump, args=(proc.stdout, stdout_target), daemon=True))
        threads.append(threading.Thread(target=_pump, args=(proc.stderr, stderr_target), daemon=True))

        for thread in threads:
            thread.start()

        exit_code = proc.wait()
        for thread in threads:
            thread.join(timeout=5)
        return exit_code
```

```python
@dataclass
class PythonInvocation:
    socket_path: str | None
    require_vram_mb: int
    require_gpu_count: int
    priority: int
    report: bool
    script_path: str
    script_args: list[str]


def parse_vram_mb(value: str) -> int:
    raw = value.strip().lower()
    if raw.endswith("g"):
        return int(float(raw[:-1]) * 1024)
    if raw.endswith("m"):
        return int(float(raw[:-1]))
    return int(float(raw))


def detect_python_invocation(argv: list[str]) -> PythonInvocation | None:
    known_subcommands = {
        "run", "daemon", "start", "stop", "restart", "is-running",
        "install-service", "uninstall-service", "status", "cancel",
        "logs", "submit", "pause", "resume",
    }
    if not argv or argv[0] in known_subcommands:
        return None

    socket_path: str | None = None
    require_vram_mb = 0
    require_gpu_count = 1
    priority = 10
    report = False

    index = 0
    while index < len(argv):
        token = argv[index]
        if token.endswith(".py") and not token.startswith("-"):
            return PythonInvocation(
                socket_path=socket_path,
                require_vram_mb=require_vram_mb,
                require_gpu_count=require_gpu_count,
                priority=priority,
                report=report,
                script_path=str(Path(token).resolve()),
                script_args=argv[index + 1 :],
            )
        if token.startswith("-vram=") or token.startswith("--vram="):
            require_vram_mb = parse_vram_mb(token.split("=", 1)[1])
        elif token in {"-vram", "--vram"}:
            require_vram_mb = parse_vram_mb(argv[index + 1])
            index += 1
        elif token.startswith("-gpus=") or token.startswith("--gpus="):
            require_gpu_count = int(token.split("=", 1)[1])
        elif token in {"-gpus", "--gpus"}:
            require_gpu_count = int(argv[index + 1])
            index += 1
        elif token in {"--priority"}:
            priority = int(argv[index + 1])
            index += 1
        elif token == "--socket":
            socket_path = argv[index + 1]
            index += 1
        elif token == "--report":
            report = True
        else:
            raise SystemExit(f"error: unsupported PMEOW flag before script path: {token}")
        index += 1

    return None
```

- [ ] **Step 4: Wire the parser into the main entrypoint and add the attached submit loop**

Update `agent/pmeow/cli_python.py` and `agent/pmeow/__main__.py` so the new path submits, waits, reports, launches, and finishes cleanly:

```python
def run_python_invocation(
    invocation: PythonInvocation,
    *,
    stdin_source: BinaryIO | None = None,
    stdout_target: BinaryIO | None = None,
    stderr_target: BinaryIO | None = None,
) -> int:
    socket_path = invocation.socket_path or _DEFAULT_SOCKET
    argv = [sys.executable, invocation.script_path, *invocation.script_args]

    submit = send_request(socket_path, "submit_task", {
        "command": shlex.join(argv),
        "cwd": os.getcwd(),
        "user": os.environ.get("USER", "unknown"),
        "require_vram_mb": invocation.require_vram_mb,
        "require_gpu_count": invocation.require_gpu_count,
        "priority": invocation.priority,
        "argv": argv,
        "launch_mode": "attached_python",
        "report_requested": invocation.report,
    })
    if not submit.get("ok"):
        raise SystemExit(submit.get("error", "submit failed"))

    task_id = submit["result"]["id"]
    print(f"task_id={task_id}")
    last_event_id = 0

    while True:
        current = send_request(socket_path, "get_task", {"task_id": task_id})
        if not current.get("ok") or current.get("result") is None:
            raise SystemExit("error: task disappeared")
        task = current["result"]

        if invocation.report:
            events = send_request(socket_path, "get_task_events", {"task_id": task_id, "after_id": last_event_id})
            for event in events.get("result", []):
                message = (event.get("details") or {}).get("message")
                if message:
                    print(message)
                last_event_id = event["id"]

        if task["status"] == "launching":
            env = os.environ.copy()
            env["CUDA_VISIBLE_DEVICES"] = ",".join(str(gpu_id) for gpu_id in (task["gpu_ids"] or []))
            exit_code_holder = {"value": 1}

            def _on_started(pid: int) -> None:
                ack = send_request(socket_path, "confirm_attached_launch", {"task_id": task_id, "pid": pid})
                if not ack.get("ok") or ack.get("result") is not True:
                    raise RuntimeError("failed to confirm attached launch")

            exit_code_holder["value"] = run_attached_python(
                argv=task["argv"],
                cwd=task["cwd"],
                env=env,
                log_path=task["log_path"],
                on_started=_on_started,
                stdin_source=stdin_source,
                stdout_target=stdout_target,
                stderr_target=stderr_target,
            )
            send_request(socket_path, "finish_attached_task", {"task_id": task_id, "exit_code": exit_code_holder["value"]})
            print(f"task finished exit_code={exit_code_holder['value']}")
            return exit_code_holder["value"]

        if task["status"] in {"completed", "failed", "cancelled"}:
            return int(task.get("exit_code") or 0)

        time.sleep(1)
```

```python
def main(argv: list[str] | None = None) -> None:
    argv = list(sys.argv[1:] if argv is None else argv)
    invocation = detect_python_invocation(argv)
    if invocation is not None:
        raise SystemExit(run_python_invocation(invocation))

    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command is None:
        parser.print_help()
        raise SystemExit(1)

    handler = _HANDLERS.get(args.command)
    if handler is None:
        parser.print_help()
        raise SystemExit(1)

    handler(args)
```

- [ ] **Step 5: Run the CLI and executor tests again**

Run:

```bash
cd agent
. .venv/bin/activate
pytest tests/executor/test_attached.py tests/test_cli_python.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent/pmeow/executor/attached.py agent/pmeow/cli_python.py agent/pmeow/__main__.py agent/tests/executor/test_attached.py agent/tests/test_cli_python.py
git commit -m "feat(agent): add attached python cli sugar"
```

### Task 5: Add End-To-End Coverage, Optional PyTorch Samples, And User Docs

**Files:**
- Create: `agent/pmeow/examples/__init__.py`
- Create: `agent/pmeow/examples/pytorch_tasks.py`
- Create: `agent/examples/tasks/pytorch_hold.py`
- Create: `agent/examples/tasks/pytorch_stagger.py`
- Create: `agent/examples/tasks/pytorch_chatty.py`
- Create: `agent/tests/examples/test_pytorch_tasks.py`
- Modify: `agent/tests/test_e2e_smoke.py:1-89`
- Modify: `agent/README.md:1-126`
- Modify: `docs/user/agent-nodes.md:1-170`

- [ ] **Step 1: Write the failing end-to-end and sample-helper tests**

Create `agent/tests/examples/test_pytorch_tasks.py` and append one smoke test to `agent/tests/test_e2e_smoke.py`:

```python
from __future__ import annotations

import importlib

import pytest

from pmeow.examples.pytorch_tasks import load_torch_or_exit, parse_memories_mb


def test_parse_memories_mb_accepts_units_and_lists():
    assert parse_memories_mb("1024") == [1024]
    assert parse_memories_mb("2g,3072") == [2048, 3072]


def test_load_torch_or_exit_prints_install_guidance(monkeypatch, capsys):
    def _fail(name: str):
        raise ModuleNotFoundError(name)

    monkeypatch.setattr(importlib, "import_module", _fail)

    with pytest.raises(SystemExit) as exc_info:
        load_torch_or_exit()

    assert exc_info.value.code == 2
    assert "install a torch build yourself" in capsys.readouterr().err.lower()
```

```python
def test_e2e_attached_python_flow(tmp_path):
    state_dir = str(tmp_path / "state")
    log_dir = str(tmp_path / "logs")
    socket_path = str(tmp_path / "pmeow.sock")
    script = tmp_path / "attached_demo.py"
    script.write_text(
        "print('attached hello')\n"
        "print(input())\n"
    )

    config = AgentConfig(
        server_url="",
        agent_id="attached-node",
        collection_interval=1,
        heartbeat_interval=30,
        history_window_seconds=30,
        vram_redundancy_coefficient=0.1,
        state_dir=state_dir,
        socket_path=socket_path,
        log_dir=log_dir,
    )
    svc = DaemonService(config)
    srv = SocketServer(socket_path, svc)
    srv_thread = threading.Thread(target=srv.serve_forever, daemon=True)
    srv_thread.start()
    time.sleep(0.2)

    stop = threading.Event()

    def _loop():
        while not stop.is_set():
            svc.collect_cycle()
            stop.wait(0.2)

    daemon_thread = threading.Thread(target=_loop, daemon=True)
    daemon_thread.start()

    try:
        exit_code = run_python_invocation(
            PythonInvocation(
                socket_path=socket_path,
                require_vram_mb=0,
                require_gpu_count=0,
                priority=10,
                report=True,
                script_path=str(script.resolve()),
                script_args=[],
            ),
            stdin_source=io.BytesIO(b"hello from stdin\\n"),
        )

        assert exit_code == 0
        task = svc.list_tasks()[0]
        assert task.status == TaskStatus.completed
        content = svc.get_logs(task.id)
        assert "attached hello" in content
        assert "hello from stdin" in content
    finally:
        stop.set()
        daemon_thread.join(timeout=5)
        srv.shutdown()
        close_database(svc.db)
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
cd agent
. .venv/bin/activate
pytest tests/examples/test_pytorch_tasks.py tests/test_e2e_smoke.py -v
```

Expected: FAIL with `ModuleNotFoundError` for `pmeow.examples.pytorch_tasks` and missing imports for the attached end-to-end path.

- [ ] **Step 3: Add the optional PyTorch sample helper and the tracked sample scripts**

Create `agent/pmeow/examples/pytorch_tasks.py` and the three tiny wrapper scripts:

```python
def parse_memories_mb(value: str) -> list[int]:
    result: list[int] = []
    for item in value.split(","):
        raw = item.strip().lower()
        if raw.endswith("g"):
            result.append(int(float(raw[:-1]) * 1024))
        elif raw.endswith("m"):
            result.append(int(float(raw[:-1])))
        else:
            result.append(int(float(raw)))
    return result


def load_torch_or_exit():
    try:
        return importlib.import_module("torch")
    except ModuleNotFoundError as exc:
        print(
            "PyTorch sample tasks are optional. Install a torch build yourself that matches your CUDA runtime before running these examples.",
            file=sys.stderr,
        )
        raise SystemExit(2) from exc


def _allocate(torch, memories_mb: list[int]) -> list[object]:
    if torch.cuda.device_count() < len(memories_mb):
        raise SystemExit(f"expected at least {len(memories_mb)} visible GPU(s), found {torch.cuda.device_count()}")
    buffers: list[object] = []
    for index, mem_mb in enumerate(memories_mb):
        torch.cuda.set_device(index)
        buffers.append(torch.empty(mem_mb * 1024 * 1024, dtype=torch.uint8, device=f"cuda:{index}"))
    return buffers


def main_hold(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Hold the same amount of VRAM on each visible GPU")
    parser.add_argument("--gpus", type=int, required=True)
    parser.add_argument("--mem-per-gpu", default="1g")
    parser.add_argument("--seconds", type=int, default=60)
    parser.add_argument("--interval", type=int, default=5)
    args = parser.parse_args(argv)

    torch = load_torch_or_exit()
    memories_mb = [parse_memories_mb(args.mem_per_gpu)[0]] * args.gpus
    _allocate(torch, memories_mb)
    for remaining in range(args.seconds, 0, -args.interval):
        print(f"holding {args.gpus} gpu(s); remaining={remaining}s")
        time.sleep(min(args.interval, remaining))
    return 0


def main_stagger(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Hold different amounts of VRAM on visible GPUs")
    parser.add_argument("--memories", required=True, help="Comma-separated per-GPU sizes such as 2g,4g")
    parser.add_argument("--seconds", type=int, default=60)
    args = parser.parse_args(argv)

    torch = load_torch_or_exit()
    memories_mb = parse_memories_mb(args.memories)
    _allocate(torch, memories_mb)
    print(f"allocated memories_mb={memories_mb}")
    time.sleep(args.seconds)
    return 0


def main_chatty(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Hold VRAM and print heartbeat lines while running")
    parser.add_argument("--gpus", type=int, required=True)
    parser.add_argument("--mem-per-gpu", default="1g")
    parser.add_argument("--seconds", type=int, default=60)
    parser.add_argument("--interval", type=int, default=5)
    args = parser.parse_args(argv)

    torch = load_torch_or_exit()
    memories_mb = [parse_memories_mb(args.mem_per_gpu)[0]] * args.gpus
    _allocate(torch, memories_mb)
    elapsed = 0
    while elapsed < args.seconds:
        print(f"chatty heartbeat elapsed={elapsed}s visible_gpus={args.gpus}")
        time.sleep(args.interval)
        elapsed += args.interval
    return 0
```

```python
from pmeow.examples.pytorch_tasks import main_hold


if __name__ == "__main__":
    raise SystemExit(main_hold())
```

```python
from pmeow.examples.pytorch_tasks import main_stagger


if __name__ == "__main__":
    raise SystemExit(main_stagger())
```

```python
from pmeow.examples.pytorch_tasks import main_chatty


if __name__ == "__main__":
    raise SystemExit(main_chatty())
```

- [ ] **Step 4: Update the user-facing docs and keep `torch` out of default dependencies**

Do not modify `agent/pyproject.toml`. Instead, update `agent/README.md` and `docs/user/agent-nodes.md` with explicit examples and the optional-dependency note:

````md
### Run an attached Python task

```bash
pmeow -vram=10g -gpus=2 --report examples/tasks/pytorch_hold.py --gpus 2 --mem-per-gpu 9g --seconds 120
```

Rules:

- tokens before the first `.py` path are interpreted as PMEOW flags
- tokens after the script path are passed to Python unchanged
- `--report` prints queue attempts and the current GPU occupancy summary until the task starts
- once GPUs are reserved, the same terminal becomes the Python process stdin, stdout, and stderr

PyTorch sample tasks are optional. Install a `torch` build yourself before using them. `pmeow-agent` does not declare `torch` as a default dependency.

### Sample scheduling tasks

```bash
pmeow -vram=8g -gpus=1 examples/tasks/pytorch_hold.py --gpus 1 --mem-per-gpu 7g --seconds 60
pmeow -vram=12g -gpus=2 --report examples/tasks/pytorch_stagger.py --memories 5g,11g --seconds 90
pmeow -vram=6g -gpus=1 examples/tasks/pytorch_chatty.py --gpus 1 --mem-per-gpu 4g --seconds 45 --interval 5
```
````

- [ ] **Step 5: Run the targeted tests and then the full agent suite**

Run:

```bash
cd agent
. .venv/bin/activate
pytest tests/store/test_tasks.py tests/daemon/test_service.py tests/executor/test_runner.py tests/executor/test_attached.py tests/test_cli_python.py tests/examples/test_pytorch_tasks.py tests/test_e2e_smoke.py -v
pytest -v
```

Expected: PASS. No `torch` installation should be required for the test suite.

- [ ] **Step 6: Commit**

```bash
git add agent/pmeow/examples/__init__.py agent/pmeow/examples/pytorch_tasks.py agent/examples/tasks/pytorch_hold.py agent/examples/tasks/pytorch_stagger.py agent/examples/tasks/pytorch_chatty.py agent/tests/examples/test_pytorch_tasks.py agent/tests/test_e2e_smoke.py agent/README.md docs/user/agent-nodes.md
git commit -m "feat(agent): add attached python samples and optional pytorch tasks"
```

## Self-Review

### Spec Coverage

- Python sugar path with PMEOW flags before the script and Python args after the script is implemented in Task 4.
- `--report` queue-attempt reporting and GPU occupancy summaries are implemented in Tasks 2 and 3.
- Same-terminal stdin, stdout, and stderr handoff is implemented in Task 4.
- Task-log continuity from submission through execution is implemented in Task 2.
- Optional PyTorch examples with user-managed `torch` installation are implemented in Task 5.

### Placeholder Scan

- No `TODO`, `TBD`, or “similar to previous task” placeholders remain.
- Every code-changing step includes concrete code and every verification step includes an exact command.

### Type Consistency

- `TaskLaunchMode.attached_python` is used consistently across the model, store, daemon, socket API, CLI, tests, and docs.
- `TaskStatus.launching` is the only new intermediate state, and the daemon, socket payloads, and CLI polling all treat it consistently.
- Attached-task argv is always persisted as `argv_json` in storage and exposed as `argv` over the local socket API.