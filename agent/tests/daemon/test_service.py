"""Tests for DaemonService and socket server."""

from __future__ import annotations

import json
import os
import socket
import tempfile
import threading
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from pmeow.config import AgentConfig
from pmeow.daemon.service import DaemonService
from pmeow.daemon.socket_server import SocketServer, send_request
from pmeow.executor.logs import read_task_log
from pmeow.models import LocalUserRecord
from pmeow.models import TaskLaunchMode, TaskSpec, TaskStatus


@pytest.fixture()
def tmp_state(tmp_path):
    return AgentConfig(
        state_dir=str(tmp_path / "state"),
        socket_path=str(tmp_path / "pmeow.sock"),
        log_dir=str(tmp_path / "logs"),
        collection_interval=60,
        history_window_seconds=120,
        vram_redundancy_coefficient=0.1,
    )


@pytest.fixture()
def svc(tmp_state):
    service = DaemonService(tmp_state)
    yield service
    from pmeow.store.database import close_database
    close_database(service.db)


def _make_spec(**overrides) -> TaskSpec:
    defaults = dict(
        command="echo hello",
        cwd="/tmp",
        user="tester",
        require_vram_mb=0,
        require_gpu_count=1,
        priority=10,
    )
    defaults.update(overrides)
    return TaskSpec(**defaults)


# ------------------------------------------------------------------
# submit / list
# ------------------------------------------------------------------

def test_submit_enqueues_task(svc: DaemonService):
    rec = svc.submit_task(_make_spec())
    assert rec.status == TaskStatus.queued
    assert rec.command == "echo hello"
    content = read_task_log(rec.id, svc.config.log_dir)
    assert "task submitted: user=tester" in content
    assert "cwd=/tmp" in content


def test_submit_sends_queued_task_update_with_metadata(svc: DaemonService):
    svc.transport = MagicMock()

    rec = svc.submit_task(_make_spec(require_vram_mb=4096, require_gpu_count=2, priority=3))

    svc.transport.send_task_update.assert_called_once()
    update = svc.transport.send_task_update.call_args.args[0]
    assert update.task_id == rec.id
    assert update.status == TaskStatus.queued
    assert update.command == "echo hello"
    assert update.cwd == "/tmp"
    assert update.user == "tester"
    assert update.require_vram_mb == 4096
    assert update.require_gpu_count == 2
    assert update.priority == 3
    assert update.created_at == rec.created_at


def test_list_returns_tasks(svc: DaemonService):
    svc.submit_task(_make_spec(command="a"))
    svc.submit_task(_make_spec(command="b"))
    tasks = svc.list_tasks()
    assert len(tasks) == 2


def test_list_filters_by_status(svc: DaemonService):
    svc.submit_task(_make_spec())
    assert len(svc.list_tasks(status=TaskStatus.queued)) == 1
    assert len(svc.list_tasks(status=TaskStatus.running)) == 0


# ------------------------------------------------------------------
# pause / resume
# ------------------------------------------------------------------

def test_pause_resume_toggle(svc: DaemonService):
    qs = svc.get_queue_state()
    assert qs.paused is False

    svc.pause_queue()
    assert svc.get_queue_state().paused is True

    svc.resume_queue()
    assert svc.get_queue_state().paused is False


# ------------------------------------------------------------------
# cancel
# ------------------------------------------------------------------

def test_cancel_queued_task(svc: DaemonService):
    rec = svc.submit_task(_make_spec())
    assert svc.cancel_task(rec.id) is True

    tasks = svc.list_tasks(status=TaskStatus.cancelled)
    assert len(tasks) == 1
    assert tasks[0].id == rec.id


def test_cancel_nonexistent_returns_false(svc: DaemonService):
    assert svc.cancel_task("no-such-id") is False


# ------------------------------------------------------------------
# queue state
# ------------------------------------------------------------------

def test_queue_state_counts(svc: DaemonService):
    svc.submit_task(_make_spec())
    svc.submit_task(_make_spec())
    qs = svc.get_queue_state()
    assert qs.queued == 2
    assert qs.running == 0


# ------------------------------------------------------------------
# socket roundtrip
# ------------------------------------------------------------------

def test_socket_roundtrip(tmp_state):
    svc = DaemonService(tmp_state)
    srv = SocketServer(tmp_state.socket_path, svc)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    time.sleep(0.2)  # let server bind

    try:
        # submit via socket
        resp = send_request(tmp_state.socket_path, "submit_task", {
            "command": "echo hi",
            "cwd": "/tmp",
            "user": "test",
            "require_vram_mb": 0,
        })
        assert resp["ok"] is True, f"server error: {resp.get('error')}"
        task_id = resp["result"]["id"]

        # list via socket
        resp = send_request(tmp_state.socket_path, "list_tasks", {})
        assert resp["ok"] is True
        assert len(resp["result"]) == 1

        # get_status via socket
        resp = send_request(tmp_state.socket_path, "get_status", {})
        assert resp["ok"] is True
        assert resp["result"]["queued"] == 1

        # cancel via socket
        resp = send_request(tmp_state.socket_path, "cancel_task", {"task_id": task_id})
        assert resp["ok"] is True

        # unknown method
        resp = send_request(tmp_state.socket_path, "no_such_method", {})
        assert resp["ok"] is False
    finally:
        srv.shutdown()
        from pmeow.store.database import close_database
        close_database(svc.db)


# ------------------------------------------------------------------
# collect_cycle — attached task handling
# ------------------------------------------------------------------

def _fake_snapshot(per_gpu=None):
    gpu_alloc = None
    if per_gpu is not None:
        gpu_alloc = SimpleNamespace(per_gpu=per_gpu)
    return SimpleNamespace(timestamp=time.time(), gpu_allocation=gpu_alloc)


def test_collect_cycle_reserves_attached_task_and_writes_report(svc, monkeypatch):
    """Submit attached task → collect_cycle should reserve (not spawn) and write log."""
    from pmeow.models import PerGpuAllocationSummary
    from pmeow.queue.scheduler import ScheduleDecision

    gpu = PerGpuAllocationSummary(
        gpu_index=0, total_memory_mb=16000.0, effective_free_mb=12000.0,
    )

    monkeypatch.setattr(
        "pmeow.daemon.service.collect_snapshot",
        lambda **kw: _fake_snapshot(per_gpu=[gpu]),
    )
    monkeypatch.setattr(
        svc.scheduler, "try_schedule",
        lambda db, per_gpu: [ScheduleDecision(task_id=rec.id, gpu_ids=[0])],
    )

    spec = _make_spec(
        launch_mode=TaskLaunchMode.attached_python,
        report_requested=True,
    )
    rec = svc.submit_task(spec)

    svc.collect_cycle()

    # Task should be in launching state, NOT running
    from pmeow.store.tasks import get_task
    task = get_task(svc.db, rec.id)
    assert task.status == TaskStatus.launching

    # Runner should NOT have started a process
    assert svc.runner.get_running_pids() == {}

    # Log should contain "launch reserved"
    content = read_task_log(rec.id, svc.config.log_dir)
    assert "launch reserved" in content


def test_collect_cycle_requeues_expired_attached_launch(svc, monkeypatch):
    """An attached task past its deadline should be requeued by collect_cycle."""
    from pmeow.store.tasks import get_task, reserve_attached_launch

    monkeypatch.setattr(
        "pmeow.daemon.service.collect_snapshot",
        lambda **kw: _fake_snapshot(),
    )

    spec = _make_spec(launch_mode=TaskLaunchMode.attached_python)
    rec = svc.submit_task(spec)

    # Manually reserve with an already-expired deadline
    reserve_attached_launch(
        svc.db, rec.id, gpu_ids=[0],
        launch_deadline=time.time() - 10, reserved_at=time.time() - 20,
    )
    assert get_task(svc.db, rec.id).status == TaskStatus.launching

    svc.collect_cycle()

    task = get_task(svc.db, rec.id)
    assert task.status == TaskStatus.queued

    content = read_task_log(rec.id, svc.config.log_dir)
    assert "launch reservation expired" in content


def test_collect_cycle_sends_local_users_only_when_inventory_changes(svc, monkeypatch):
    svc.transport = MagicMock()
    snapshots = [
        [
            LocalUserRecord(
                username="alice",
                uid=1000,
                gid=1000,
                gecos="Alice Example",
                home="/home/alice",
                shell="/bin/bash",
            )
        ],
        [
            LocalUserRecord(
                username="alice",
                uid=1000,
                gid=1000,
                gecos="Alice Example",
                home="/home/alice",
                shell="/bin/bash",
            )
        ],
        [
            LocalUserRecord(
                username="alice",
                uid=1000,
                gid=1000,
                gecos="Alice Example",
                home="/home/alice",
                shell="/bin/bash",
            ),
            LocalUserRecord(
                username="bob",
                uid=1001,
                gid=1001,
                gecos="Bob Example",
                home="/home/bob",
                shell="/bin/bash",
            ),
        ],
    ]

    monkeypatch.setattr(
        "pmeow.daemon.service.collect_snapshot",
        lambda **kw: _fake_snapshot(),
    )
    monkeypatch.setattr(
        "pmeow.daemon.service.collect_local_users",
        lambda: snapshots.pop(0),
    )

    svc.collect_cycle()
    svc.collect_cycle()
    svc.collect_cycle()

    assert svc.transport.send_metrics.call_count == 3
    assert svc.transport.send_local_users.call_count == 2
    first_inventory = svc.transport.send_local_users.call_args_list[0].args[0]
    second_inventory = svc.transport.send_local_users.call_args_list[1].args[0]
    assert [user.username for user in first_inventory.users] == ["alice"]
    assert [user.username for user in second_inventory.users] == ["alice", "bob"]


def test_set_task_priority_updates_queued_task_and_records_event(svc: DaemonService):
    record = svc.submit_task(_make_spec(priority=10))

    assert svc.set_task_priority(record.id, 3) is True

    updated = svc.get_task(record.id)
    assert updated is not None
    assert updated.priority == 3

    events = svc.get_task_events(record.id)
    priority_event = next(event for event in events if event["event_type"] == "priority_updated")
    assert priority_event["details"]["old_priority"] == 10
    assert priority_event["details"]["new_priority"] == 3


def test_collect_cycle_writes_schedule_block_reason_once_per_change(svc, monkeypatch):
    from pmeow.models import GpuUserProcess, PerGpuAllocationSummary

    # Unmanaged user process occupies 12000 MB; with UNMANAGED_MULTIPLIER=1.05,
    # effective_free = 16000*0.98 - 12000*1.05 = 15680 - 12600 = 3080 < 8000
    gpu = PerGpuAllocationSummary(
        gpu_index=0,
        total_memory_mb=16000.0,
        used_memory_mb=12000.0,
        user_processes=[
            GpuUserProcess(pid=9999, user="other", gpu_index=0,
                           used_memory_mb=12000.0, command="train.py"),
        ],
    )

    monkeypatch.setattr(
        "pmeow.daemon.service.collect_snapshot",
        lambda **kw: _fake_snapshot(per_gpu=[gpu]),
    )

    record = svc.submit_task(_make_spec(require_vram_mb=8000))

    svc.collect_cycle()
    svc.collect_cycle()

    events = svc.get_task_events(record.id)
    blocked = [event for event in events if event["event_type"] == "schedule_blocked"]
    assert len(blocked) == 1
    assert blocked[0]["details"]["reason_code"] == "insufficient_gpu_count"

    content = read_task_log(record.id, svc.config.log_dir)
    assert content.count("schedule blocked") == 1


def test_collect_cycle_records_queue_paused_reason(svc, monkeypatch):
    monkeypatch.setattr(
        "pmeow.daemon.service.collect_snapshot",
        lambda **kw: _fake_snapshot(),
    )

    record = svc.submit_task(_make_spec())
    svc.pause_queue()

    svc.collect_cycle()

    events = svc.get_task_events(record.id)
    paused = [event for event in events if event["event_type"] == "queue_paused"]
    assert len(paused) == 1
    assert paused[0]["details"]["reason_code"] == "queue_paused"


# ------------------------------------------------------------------
# attached task confirm / finish / events
# ------------------------------------------------------------------

def test_confirm_and_finish_attached_task(tmp_state):
    from pmeow.store.tasks import reserve_attached_launch
    from pmeow.store.database import close_database

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
    close_database(svc.db)


def test_finish_attached_task_duplicate_exit_skips_fresh_completion_side_effects(tmp_state):
    from pmeow.store.database import close_database
    from pmeow.store.tasks import reserve_attached_launch

    svc = DaemonService(tmp_state)
    svc.transport = MagicMock()
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
    svc.transport.reset_mock()

    assert svc.finish_attached_task(record.id, exit_code=0) is True

    first_events = svc.get_task_events(record.id)
    assert [event["event_type"] for event in first_events].count("attached_finished") == 1
    svc.transport.send_task_update.assert_called_once()

    svc.transport.reset_mock()
    assert svc.finish_attached_task(record.id, exit_code=1) is False
    svc.transport.send_task_update.assert_not_called()

    finished = svc.get_task(record.id)
    assert finished is not None
    assert finished.status == TaskStatus.completed
    assert finished.exit_code == 0

    second_events = svc.get_task_events(record.id)
    assert [event["event_type"] for event in second_events].count("attached_finished") == 1
    close_database(svc.db)


@pytest.mark.parametrize(
    "setup",
    ["queued", "launching"],
)
def test_finish_attached_task_finalizes_non_running_attached_task(tmp_state, setup):
    from pmeow.store.database import close_database
    from pmeow.store.tasks import reserve_attached_launch

    svc = DaemonService(tmp_state)
    svc.transport = MagicMock()
    record = svc.submit_task(_make_spec(
        command="python demo.py",
        argv=["/usr/bin/python3", "demo.py"],
        launch_mode=TaskLaunchMode.attached_python,
        require_vram_mb=0,
        require_gpu_count=0,
    ))

    if setup == "launching":
        now = time.time()
        reserve_attached_launch(
            svc.db,
            record.id,
            gpu_ids=[0],
            launch_deadline=now + 30,
            reserved_at=now,
        )

    svc.transport.reset_mock()

    assert svc.finish_attached_task(record.id, exit_code=0) is True

    fetched = svc.get_task(record.id)
    assert fetched is not None
    assert fetched.status == TaskStatus.completed
    assert fetched.finished_at is not None
    assert fetched.exit_code == 0

    assert [event["event_type"] for event in svc.get_task_events(record.id)].count("attached_finished") == 1
    svc.transport.send_task_update.assert_called_once()
    close_database(svc.db)


def test_socket_roundtrip_for_attached_methods(tmp_state):
    from pmeow.store.tasks import reserve_attached_launch
    from pmeow.store.database import close_database

    svc = DaemonService(tmp_state)
    srv = SocketServer(tmp_state.socket_path, svc)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    time.sleep(0.2)

    try:
        # submit an attached task via socket
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
        assert submit["result"]["launch_mode"] == "attached_python"
        assert submit["result"]["report_requested"] is True

        # reserve launch (directly on DB since it's the daemon's job)
        reserve_attached_launch(svc.db, task_id, gpu_ids=[0], launch_deadline=time.time() + 30, reserved_at=time.time())

        # get_task
        current = send_request(tmp_state.socket_path, "get_task", {"task_id": task_id})
        assert current["ok"] is True
        assert current["result"]["launch_mode"] == "attached_python"
        assert current["result"]["log_path"].endswith(f"{task_id}.log")
        assert current["result"]["status"] == "launching"

        # confirm_attached_launch
        confirm = send_request(tmp_state.socket_path, "confirm_attached_launch", {"task_id": task_id, "pid": 6543})
        assert confirm["ok"] is True
        assert confirm["result"] is True

        # verify running
        current = send_request(tmp_state.socket_path, "get_task", {"task_id": task_id})
        assert current["result"]["status"] == "running"
        assert current["result"]["pid"] == 6543

        # finish_attached_task
        finish = send_request(tmp_state.socket_path, "finish_attached_task", {"task_id": task_id, "exit_code": 0})
        assert finish["ok"] is True
        assert finish["result"] is True

        # get_task_events
        events = send_request(tmp_state.socket_path, "get_task_events", {"task_id": task_id, "after_id": 0})
        assert events["ok"] is True
        event_types = [e["event_type"] for e in events["result"]]
        assert "submitted" in event_types
        assert "process_started" in event_types
        assert "attached_finished" in event_types
        submitted = next(event for event in events["result"] if event["event_type"] == "submitted")
        assert submitted["details"]["user"] == "tester"
    finally:
        srv.shutdown()
        close_database(svc.db)


def test_start_wires_runtime_monitor_lifecycle_independently_of_collect_cycle(tmp_state, monkeypatch):
    started: list[str] = []

    class FakeSocketServer:
        def __init__(self, _socket_path, _service):
            pass

        def serve_forever(self):
            started.append("socket")

        def shutdown(self):
            started.append("socket_shutdown")

    class FakeRuntimeMonitor:
        def __init__(self, conn, poll_interval=1.0, db_lock=None, on_terminal_transition=None):
            self.conn = conn
            self.poll_interval = poll_interval
            self.db_lock = db_lock
            self.on_terminal_transition = on_terminal_transition

        def recover_after_restart(self):
            started.append("recover")
            return []

        def run_forever(self):
            started.append("monitor_run")

        def stop(self):
            started.append("monitor_stop")

    monkeypatch.setattr("pmeow.daemon.service.RuntimeMonitorLoop", FakeRuntimeMonitor)
    monkeypatch.setattr("pmeow.daemon.socket_server.SocketServer", FakeSocketServer)
    monkeypatch.setattr("pmeow.daemon.service.signal.signal", lambda *_args, **_kwargs: None)

    svc = DaemonService(tmp_state)
    monkeypatch.setattr(
        svc,
        "collect_cycle",
        lambda: (started.append("collect"), svc.stop()),
    )

    svc.start()

    assert started.index("recover") < started.index("monitor_run")
    assert started.index("monitor_run") < started.index("collect")
    assert started.index("collect") < started.index("monitor_stop")
    assert "monitor_stop" in started
    assert started[-1] == "socket_shutdown"


def test_start_completes_restart_recovery_before_socket_server_becomes_available(tmp_state, monkeypatch):
    started: list[str] = []

    class FakeThread:
        def __init__(self, *, target, daemon):
            self._target = target
            self.daemon = daemon

        def start(self):
            self._target()

        def join(self, timeout=None):
            started.append("joined")

    class FakeSocketServer:
        def __init__(self, _socket_path, _service):
            pass

        def serve_forever(self):
            started.append("socket")

        def shutdown(self):
            started.append("socket_shutdown")

    class FakeRuntimeMonitor:
        def __init__(self, conn, poll_interval=1.0, db_lock=None, on_terminal_transition=None):
            self.conn = conn
            self.poll_interval = poll_interval
            self.db_lock = db_lock
            self.on_terminal_transition = on_terminal_transition

        def recover_after_restart(self):
            started.append("recover")
            return []

        def run_forever(self):
            started.append("monitor_run")

        def stop(self):
            started.append("monitor_stop")

    monkeypatch.setattr("pmeow.daemon.service.RuntimeMonitorLoop", FakeRuntimeMonitor)
    monkeypatch.setattr("pmeow.daemon.socket_server.SocketServer", FakeSocketServer)
    monkeypatch.setattr("pmeow.daemon.service.threading.Thread", FakeThread)
    monkeypatch.setattr("pmeow.daemon.service.signal.signal", lambda *_args, **_kwargs: None)

    svc = DaemonService(tmp_state)
    monkeypatch.setattr(
        svc,
        "collect_cycle",
        lambda: (started.append("collect"), svc.stop()),
    )

    svc.start()

    assert started.index("recover") < started.index("socket")
    assert started.index("socket") < started.index("monitor_run")


@pytest.mark.parametrize("trigger", ["recover", "monitor"])
def test_start_sends_terminal_task_update_for_runtime_monitor_transitions(tmp_state, monkeypatch, trigger):
    from pmeow.store.tasks import attach_runtime

    started: list[str] = []
    terminal_task_id: str | None = None

    class FakeThread:
        def __init__(self, *, target, daemon):
            self._target = target
            self.daemon = daemon

        def start(self):
            self._target()

        def join(self, timeout=None):
            started.append("joined")

    class FakeSocketServer:
        def __init__(self, _socket_path, _service):
            pass

        def serve_forever(self):
            started.append("socket")

        def shutdown(self):
            started.append("socket_shutdown")

    class FakeRuntimeMonitor:
        def __init__(self, conn, poll_interval=1.0, db_lock=None, on_terminal_transition=None):
            self.conn = conn
            self.poll_interval = poll_interval
            self.db_lock = db_lock
            self.on_terminal_transition = on_terminal_transition

        def recover_after_restart(self):
            started.append("recover")
            if trigger == "recover":
                self.conn.execute(
                    "UPDATE tasks SET status = 'failed', finished_at = ?, exit_code = NULL WHERE id = ?",
                    (time.time(), terminal_task_id),
                )
                self.conn.commit()
                assert self.on_terminal_transition is not None
                self.on_terminal_transition(terminal_task_id)
            return []

        def run_forever(self):
            started.append("monitor_run")
            if trigger == "monitor":
                self.conn.execute(
                    "UPDATE tasks SET status = 'failed', finished_at = ?, exit_code = NULL WHERE id = ?",
                    (time.time(), terminal_task_id),
                )
                self.conn.commit()
                assert self.on_terminal_transition is not None
                self.on_terminal_transition(terminal_task_id)
            service.stop()

        def stop(self):
            started.append("monitor_stop")

    monkeypatch.setattr("pmeow.daemon.service.RuntimeMonitorLoop", FakeRuntimeMonitor)
    monkeypatch.setattr("pmeow.daemon.socket_server.SocketServer", FakeSocketServer)
    monkeypatch.setattr("pmeow.daemon.service.threading.Thread", FakeThread)
    monkeypatch.setattr("pmeow.daemon.service.signal.signal", lambda *_args, **_kwargs: None)

    service = DaemonService(tmp_state)
    service.transport = MagicMock()
    task = service.submit_task(_make_spec())
    terminal_task_id = task.id
    attach_runtime(service.db, task.id, pid=5252, gpu_ids=[0], started_at=time.time())
    service.transport.reset_mock()
    monkeypatch.setattr(service, "collect_cycle", lambda: service.stop())

    service.start()

    service.transport.send_task_update.assert_called_once()
    update = service.transport.send_task_update.call_args.args[0]
    assert update.task_id == task.id
    assert update.status == TaskStatus.failed
    assert update.finished_at is not None


def test_finish_attached_task_uses_cli_finish_finalize_source(tmp_state):
    from pmeow.store.database import close_database
    from pmeow.store.tasks import list_task_events, reserve_attached_launch

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
    svc.confirm_attached_launch(record.id, pid=5432)

    svc.finish_attached_task(record.id, exit_code=0)

    events = list_task_events(svc.db, record.id)
    finalized = [e for e in events if e["event_type"] == "finalized"]
    assert len(finalized) == 1
    assert finalized[0]["details"]["finalize_source"] == "cli_finish"
    close_database(svc.db)


def test_collect_cycle_runner_exit_uses_runner_exit_finalize_source(svc, monkeypatch):
    from pmeow.store.tasks import attach_runtime, list_task_events

    monkeypatch.setattr(
        "pmeow.daemon.service.collect_snapshot",
        lambda **kw: _fake_snapshot(),
    )

    record = svc.submit_task(_make_spec())
    attach_runtime(svc.db, record.id, pid=1234, gpu_ids=[0], started_at=time.time())
    monkeypatch.setattr(svc.runner, "check_completed", lambda: [(record.id, 0)])

    svc.collect_cycle()

    events = list_task_events(svc.db, record.id)
    finalized = [e for e in events if e["event_type"] == "finalized"]
    assert len(finalized) == 1
    assert finalized[0]["details"]["finalize_source"] == "runner_exit"
