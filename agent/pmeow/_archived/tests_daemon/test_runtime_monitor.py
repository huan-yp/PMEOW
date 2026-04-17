from __future__ import annotations

import time
from types import SimpleNamespace

import psutil
import pytest

from pmeow.models import RuntimePhase, TaskLaunchMode, TaskProcessRecord, TaskRuntimeRecord, TaskSpec, TaskStatus
from pmeow.store.database import close_database, open_database
from pmeow.store.task_runtime import get_task_runtime, list_task_processes, replace_task_processes
from pmeow.store.tasks import attach_runtime, create_task, get_task, guarded_finalize_task, list_task_events


@pytest.fixture()
def conn(tmp_path):
    db = open_database(tmp_path)
    yield db
    close_database(db)


def _spec(**overrides) -> TaskSpec:
    return TaskSpec(
        command=overrides.pop("command", "python train.py"),
        cwd=overrides.pop("cwd", "/tmp/project"),
        user=overrides.pop("user", "alice"),
        require_vram_mb=overrides.pop("require_vram_mb", 1024),
        require_gpu_count=overrides.pop("require_gpu_count", 1),
        launch_mode=overrides.pop("launch_mode", TaskLaunchMode.daemon_shell),
        argv=overrides.pop("argv", None),
        env_overrides=overrides.pop("env_overrides", None),
        report_requested=overrides.pop("report_requested", False),
    )


def test_monitor_finalizes_orphaned_runtime(conn, monkeypatch):
    from pmeow.daemon.runtime_monitor import RuntimeMonitorLoop

    task = create_task(conn, _spec())
    now = time.time()
    attach_runtime(conn, task.id, pid=4242, gpu_ids=[0], started_at=now)

    monitor = RuntimeMonitorLoop(conn, poll_interval=0.01)
    monkeypatch.setattr(monitor, "_collect_process_tree", lambda runtime, seen_at: [])

    finalized = monitor.tick()
    fetched = get_task(conn, task.id)

    assert finalized == [task.id]
    assert fetched is not None
    assert fetched.status == TaskStatus.failed
    assert fetched.exit_code is None
    assert get_task_runtime(conn, task.id) is None
    assert list_task_processes(conn, task.id) == []

    events = list_task_events(conn, task.id)
    assert any(event["event_type"] == "runtime_orphan_detected" for event in events)


def test_monitor_serializes_database_access_with_injected_lock(conn, monkeypatch):
    from pmeow.daemon.runtime_monitor import RuntimeMonitorLoop

    class RecordingLock:
        def __init__(self):
            self.depth = 0
            self.entries = 0

        def __enter__(self):
            self.depth += 1
            self.entries += 1
            return self

        def __exit__(self, exc_type, exc, tb):
            self.depth -= 1

    task = create_task(conn, _spec())
    now = time.time()
    attach_runtime(conn, task.id, pid=4242, gpu_ids=[0], started_at=now)

    lock = RecordingLock()
    monitor = RuntimeMonitorLoop(conn, poll_interval=0.01, db_lock=lock)

    monkeypatch.setattr(
        "pmeow.daemon.runtime_monitor.list_active_task_runtimes",
        lambda _conn: (_assert_locked(lock), [get_task_runtime(conn, task.id)])[1],
    )
    monkeypatch.setattr(
        "pmeow.daemon.runtime_monitor.replace_task_processes",
        lambda _conn, _task_id, _processes: _assert_locked(lock),
    )
    monkeypatch.setattr(
        "pmeow.daemon.runtime_monitor.update_runtime_heartbeat",
        lambda _conn, _task_id, runtime_phase, seen_at: _assert_locked(lock),
    )
    monkeypatch.setattr(
        monitor,
        "_collect_process_tree",
        lambda runtime, seen_at: [
            TaskProcessRecord(
                task_id=runtime.task_id,
                pid=runtime.root_pid,
                ppid=None,
                depth=0,
                user="alice",
                command="python train.py",
                is_root=True,
                first_seen_at=runtime.first_started_at,
                last_seen_at=seen_at,
            )
        ],
    )

    monitor.tick()

    assert lock.entries >= 2


def test_monitor_recovers_running_task_without_runtime_row(conn, monkeypatch):
    from pmeow.daemon.runtime_monitor import RuntimeMonitorLoop

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
    assert fetched.exit_code is None
    assert list_task_processes(conn, task.id) == []


def test_monitor_recovery_preserves_running_task_when_runtime_row_is_missing_but_pid_is_live(conn, monkeypatch):
    from pmeow.daemon.runtime_monitor import RuntimeMonitorLoop

    task = create_task(conn, _spec())
    now = time.time()
    attach_runtime(conn, task.id, pid=5151, gpu_ids=[0], started_at=now)
    conn.execute("DELETE FROM task_runtime WHERE task_id = ?", (task.id,))
    conn.execute("DELETE FROM task_processes WHERE task_id = ?", (task.id,))
    conn.commit()

    monitor = RuntimeMonitorLoop(conn, poll_interval=0.01)
    monkeypatch.setattr(monitor, "_pid_exists", lambda pid: pid == 5151)
    monkeypatch.setattr(
        monitor,
        "_collect_process_tree",
        lambda runtime, seen_at: [
            TaskProcessRecord(
                task_id=runtime.task_id,
                pid=runtime.root_pid,
                ppid=None,
                depth=0,
                user="alice",
                command="python train.py",
                is_root=True,
                first_seen_at=runtime.first_started_at,
                last_seen_at=seen_at,
            )
        ],
    )

    recovered = monitor.recover_after_restart()

    fetched = get_task(conn, task.id)
    runtime = get_task_runtime(conn, task.id)
    processes = list_task_processes(conn, task.id)

    assert recovered == []
    assert fetched is not None
    assert fetched.status == TaskStatus.running
    assert runtime is not None
    assert runtime.root_pid == 5151
    assert runtime.runtime_phase is RuntimePhase.running
    assert [proc.pid for proc in processes] == [5151]


def test_monitor_skips_orphan_event_when_finalize_already_lost_race(conn, monkeypatch):
    from pmeow.daemon.runtime_monitor import RuntimeMonitorLoop

    task = create_task(conn, _spec())
    now = time.time()
    attach_runtime(conn, task.id, pid=4242, gpu_ids=[0], started_at=now)

    monitor = RuntimeMonitorLoop(conn, poll_interval=0.01)
    monkeypatch.setattr(monitor, "_collect_process_tree", lambda runtime, seen_at: [])
    monkeypatch.setattr(
        "pmeow.daemon.runtime_monitor.guarded_finalize_task",
        lambda *_args, **_kwargs: SimpleNamespace(
            transitioned=False,
            status=TaskStatus.completed,
            finished_at=now,
            exit_code=0,
        ),
    )

    finalized = monitor.tick()
    events = list_task_events(conn, task.id)

    assert finalized == []
    assert "runtime_orphan_detected" not in [event["event_type"] for event in events]


def test_monitor_refreshes_live_process_tree(conn, monkeypatch):
    from pmeow.daemon.runtime_monitor import RuntimeMonitorLoop

    task = create_task(conn, _spec())
    now = time.time()
    attach_runtime(conn, task.id, pid=6161, gpu_ids=[0], started_at=now)

    monitor = RuntimeMonitorLoop(conn, poll_interval=0.01)

    monkeypatch.setattr(
        monitor,
        "_collect_process_tree",
        lambda runtime, seen_at: [
            TaskProcessRecord(
                task_id=runtime.task_id,
                pid=runtime.root_pid,
                ppid=None,
                depth=0,
                user="alice",
                command="python train.py",
                is_root=True,
                first_seen_at=runtime.first_started_at,
                last_seen_at=seen_at,
            ),
            TaskProcessRecord(
                task_id=runtime.task_id,
                pid=6262,
                ppid=runtime.root_pid,
                depth=1,
                user="alice",
                command="python worker.py",
                is_root=False,
                first_seen_at=seen_at,
                last_seen_at=seen_at,
            ),
        ],
    )

    finalized = monitor.tick()

    assert finalized == []

    runtime = get_task_runtime(conn, task.id)
    processes = list_task_processes(conn, task.id)

    assert runtime is not None
    assert runtime.runtime_phase is RuntimePhase.running
    assert runtime.last_seen_at >= now
    assert [(proc.pid, proc.ppid, proc.depth, proc.is_root) for proc in processes] == [
        (6161, None, 0, True),
        (6262, 6161, 1, False),
    ]


def test_monitor_treats_missing_root_create_time_as_untrusted_pid_match(conn, monkeypatch):
    from pmeow.daemon.runtime_monitor import RuntimeMonitorLoop

    observed_create_time = time.time() + 120.0
    monkeypatch.setattr("pmeow.store.task_runtime._read_process_create_time", lambda _pid: None)

    task = create_task(conn, _spec())
    attach_runtime(conn, task.id, pid=6161, gpu_ids=[0], started_at=time.time())

    monitor = RuntimeMonitorLoop(conn, poll_interval=0.01)

    class FakeProc:
        def __init__(self, pid: int, create_time_value: float):
            self.pid = pid
            self._create_time_value = create_time_value

        def oneshot(self):
            return self

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def create_time(self):
            return self._create_time_value

        def cmdline(self):
            return ["python", "train.py"]

        def name(self):
            return "python"

        def username(self):
            return "alice"

        def children(self, recursive=False):
            return []

    monkeypatch.setattr(
        "pmeow.daemon.runtime_monitor.psutil.Process",
        lambda pid: FakeProc(pid, observed_create_time),
    )

    finalized = monitor.tick()
    fetched = get_task(conn, task.id)
    runtime = get_task_runtime(conn, task.id)
    processes = list_task_processes(conn, task.id)

    assert finalized == [task.id]
    assert fetched is not None
    assert fetched.status == TaskStatus.failed
    assert runtime is None
    assert processes == []


def test_monitor_keeps_task_running_when_root_is_dead_but_child_is_alive(conn, monkeypatch):
    from pmeow.daemon.runtime_monitor import RuntimeMonitorLoop

    task = create_task(conn, _spec())
    now = time.time()
    attach_runtime(conn, task.id, pid=6161, gpu_ids=[0], started_at=now)
    replace_task_processes(
        conn,
        task.id,
        [
            TaskProcessRecord(
                task_id=task.id,
                pid=6161,
                create_time=now,
                ppid=None,
                depth=0,
                user="alice",
                command="python train.py",
                is_root=True,
                first_seen_at=now,
                last_seen_at=now,
            ),
            TaskProcessRecord(
                task_id=task.id,
                pid=6262,
                create_time=now,
                ppid=6161,
                depth=1,
                user="alice",
                command="python worker.py",
                is_root=False,
                first_seen_at=now,
                last_seen_at=now,
            ),
        ],
    )

    monitor = RuntimeMonitorLoop(conn, poll_interval=0.01)

    class FakeProc:
        def __init__(self, pid: int, *, create_time_value: float, children: list[FakeProc] | None = None):
            self.pid = pid
            self._create_time_value = create_time_value
            self._children = children or []

        def oneshot(self):
            return self

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def create_time(self):
            return self._create_time_value

        def cmdline(self):
            return ["python", "worker.py"]

        def name(self):
            return "python"

        def username(self):
            return "alice"

        def children(self, recursive=False):
            return list(self._children)

    fake_processes = {6262: FakeProc(6262, create_time_value=now)}

    def fake_process(pid: int):
        if pid == 6161:
            raise psutil.NoSuchProcess(pid)
        return fake_processes[pid]

    monkeypatch.setattr("pmeow.daemon.runtime_monitor.psutil.Process", fake_process)

    finalized = monitor.tick()
    fetched = get_task(conn, task.id)
    runtime = get_task_runtime(conn, task.id)
    processes = list_task_processes(conn, task.id)

    assert finalized == []
    assert fetched is not None
    assert fetched.status == TaskStatus.running
    assert runtime is not None
    assert [proc.pid for proc in processes] == [6262]


def test_monitor_recovery_keeps_task_running_when_root_is_dead_but_child_is_alive(conn, monkeypatch):
    from pmeow.daemon.runtime_monitor import RuntimeMonitorLoop

    task = create_task(conn, _spec())
    now = time.time()
    attach_runtime(conn, task.id, pid=6161, gpu_ids=[0], started_at=now)
    replace_task_processes(
        conn,
        task.id,
        [
            TaskProcessRecord(
                task_id=task.id,
                pid=6161,
                create_time=now,
                ppid=None,
                depth=0,
                user="alice",
                command="python train.py",
                is_root=True,
                first_seen_at=now,
                last_seen_at=now,
            ),
            TaskProcessRecord(
                task_id=task.id,
                pid=6262,
                create_time=now,
                ppid=6161,
                depth=1,
                user="alice",
                command="python worker.py",
                is_root=False,
                first_seen_at=now,
                last_seen_at=now,
            ),
        ],
    )

    monitor = RuntimeMonitorLoop(conn, poll_interval=0.01)

    class FakeProc:
        def __init__(self, pid: int, *, create_time_value: float, children: list[FakeProc] | None = None):
            self.pid = pid
            self._create_time_value = create_time_value
            self._children = children or []

        def oneshot(self):
            return self

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def create_time(self):
            return self._create_time_value

        def cmdline(self):
            return ["python", "worker.py"]

        def name(self):
            return "python"

        def username(self):
            return "alice"

        def children(self, recursive=False):
            return list(self._children)

    fake_processes = {6262: FakeProc(6262, create_time_value=now)}

    def fake_process(pid: int):
        if pid == 6161:
            raise psutil.NoSuchProcess(pid)
        return fake_processes[pid]

    monkeypatch.setattr(monitor, "_pid_exists", lambda pid: False)
    monkeypatch.setattr("pmeow.daemon.runtime_monitor.psutil.Process", fake_process)

    recovered = monitor.recover_after_restart()
    fetched = get_task(conn, task.id)
    runtime = get_task_runtime(conn, task.id)
    processes = list_task_processes(conn, task.id)

    assert recovered == []
    assert fetched is not None
    assert fetched.status == TaskStatus.running
    assert runtime is not None
    assert [proc.pid for proc in processes] == [6262]


def test_monitor_treats_reused_root_pid_with_different_create_time_as_dead(conn, monkeypatch):
    from pmeow.daemon.runtime_monitor import RuntimeMonitorLoop

    task = create_task(conn, _spec())
    now = time.time()
    attach_runtime(conn, task.id, pid=5151, gpu_ids=[0], started_at=now)
    conn.execute("DELETE FROM task_runtime WHERE task_id = ?", (task.id,))
    conn.execute("DELETE FROM task_processes WHERE task_id = ?", (task.id,))
    conn.commit()

    reused_root_create_time = now + 120.0
    conn.execute(
        "INSERT INTO task_runtime ("
        "task_id, launch_mode, root_pid, root_created_at, runtime_phase, "
        "first_started_at, last_seen_at, finalize_source, finalize_reason_code, "
        "last_observed_exit_code, updated_at"
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            task.id,
            TaskLaunchMode.daemon_shell.value,
            5151,
            now,
            RuntimePhase.running.value,
            now,
            now,
            None,
            None,
            None,
            now,
        ),
    )
    conn.execute(
        "INSERT INTO task_processes ("
        "task_id, pid, ppid, depth, user, command, is_root, first_seen_at, last_seen_at, create_time"
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (task.id, 5151, None, 0, "alice", "python train.py", 1, now, now, now),
    )
    conn.commit()

    monitor = RuntimeMonitorLoop(conn, poll_interval=0.01)

    class FakeProc:
        def __init__(self, pid: int, create_time_value: float):
            self.pid = pid
            self._create_time_value = create_time_value

        def oneshot(self):
            return self

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def create_time(self):
            return self._create_time_value

        def cmdline(self):
            return ["python", "different_job.py"]

        def name(self):
            return "python"

        def username(self):
            return "alice"

        def children(self, recursive=False):
            return []

    monkeypatch.setattr(
        "pmeow.daemon.runtime_monitor.psutil.Process",
        lambda pid: FakeProc(pid, reused_root_create_time),
    )

    recovered = monitor.recover_after_restart()
    fetched = get_task(conn, task.id)

    assert recovered == [task.id]
    assert fetched is not None
    assert fetched.status == TaskStatus.failed
    assert get_task_runtime(conn, task.id) is None
    assert list_task_processes(conn, task.id) == []


def test_monitor_does_not_restore_task_processes_after_concurrent_finalize(conn, monkeypatch):
    from pmeow.daemon.runtime_monitor import RuntimeMonitorLoop

    task = create_task(conn, _spec())
    now = time.time()
    attach_runtime(conn, task.id, pid=7171, gpu_ids=[0], started_at=now)

    monitor = RuntimeMonitorLoop(conn, poll_interval=0.01)

    def finalize_before_persist(runtime, seen_at):
        guarded_finalize_task(
            conn,
            runtime.task_id,
            status=TaskStatus.failed,
            finished_at=seen_at,
            exit_code=None,
            finalize_source="test_race_finalize",
        )
        return [
            TaskProcessRecord(
                task_id=runtime.task_id,
                pid=runtime.root_pid,
                ppid=None,
                depth=0,
                user="alice",
                command="python train.py",
                is_root=True,
                first_seen_at=runtime.first_started_at,
                last_seen_at=seen_at,
            )
        ]

    monkeypatch.setattr(monitor, "_collect_process_tree", finalize_before_persist)

    finalized = monitor.tick()
    fetched = get_task(conn, task.id)

    assert finalized == []
    assert fetched is not None
    assert fetched.status == TaskStatus.failed
    assert get_task_runtime(conn, task.id) is None
    assert list_task_processes(conn, task.id) == []


def test_run_forever_logs_tick_errors_and_continues(conn, monkeypatch, caplog):
    from pmeow.daemon.runtime_monitor import RuntimeMonitorLoop

    monitor = RuntimeMonitorLoop(conn, poll_interval=0.0)
    calls: list[str] = []

    def fake_tick():
        calls.append("tick")
        if len(calls) == 1:
            raise RuntimeError("tick boom")
        monitor.stop()
        return []

    monkeypatch.setattr(monitor, "tick", fake_tick)

    with caplog.at_level("ERROR"):
        monitor.run_forever()

    assert calls == ["tick", "tick"]
    assert "tick boom" in caplog.text


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


def _assert_locked(lock) -> None:
    assert lock.depth > 0