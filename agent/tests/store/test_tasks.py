"""Tests for the persistent local queue state store."""

from __future__ import annotations

import time
from typing import Optional

import pytest

from pmeow.models import TaskLaunchMode, TaskRecord, TaskSpec, TaskStatus
from pmeow.store.database import open_database, close_database, recover_interrupted_tasks
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
    update_task_priority,
)
from pmeow.store.runtime import is_queue_paused, set_queue_paused


@pytest.fixture()
def conn(tmp_path):
    """Yield an open database connection in a temp directory."""
    db = open_database(tmp_path)
    yield db
    close_database(db)


def _spec(**overrides) -> TaskSpec:
    return TaskSpec(
        command=overrides.pop("command", "python train.py"),
        cwd=overrides.pop("cwd", "/home/user/project"),
        user=overrides.pop("user", "alice"),
        require_vram_mb=overrides.pop("require_vram_mb", 4096),
        require_gpu_count=overrides.pop("require_gpu_count", 1),
        gpu_ids=overrides.pop("gpu_ids", None),
        priority=overrides.pop("priority", 10),
        argv=overrides.pop("argv", None),
        env_overrides=overrides.pop("env_overrides", None),
        launch_mode=overrides.pop("launch_mode", TaskLaunchMode.daemon_shell),
        report_requested=overrides.pop("report_requested", False),
    )


def _require_task(conn, task_id: str) -> TaskRecord:
    task = get_task(conn, task_id)
    assert task is not None
    return task


class TestCreateAndGetTask:
    def test_create_and_get_task(self, conn):
        spec = _spec()
        record = create_task(conn, spec)

        assert record.status == TaskStatus.queued
        assert record.command == "python train.py"
        assert record.user == "alice"
        assert record.require_vram_mb == 4096
        assert record.started_at is None

        fetched = get_task(conn, record.id)
        assert fetched is not None
        assert fetched.id == record.id
        assert fetched.status == TaskStatus.queued
        assert fetched.created_at == pytest.approx(record.created_at, abs=0.01)

    def test_create_and_get_task_preserves_environment_snapshot(self, conn):
        spec = _spec(env_overrides={"PATH": "/submit/bin", "PMEOW_MARKER": "frozen"})

        record = create_task(conn, spec)
        fetched = get_task(conn, record.id)

        assert record.env_overrides == {"PATH": "/submit/bin", "PMEOW_MARKER": "frozen"}
        assert fetched is not None
        assert fetched.env_overrides == {"PATH": "/submit/bin", "PMEOW_MARKER": "frozen"}

    def test_get_nonexistent_returns_none(self, conn):
        assert get_task(conn, "no-such-id") is None


class TestListQueuedOrdering:
    def test_list_queued_ordering(self, conn):
        # Lower priority number = higher priority.
        t_low = create_task(conn, _spec(priority=1, command="low"))
        time.sleep(0.01)
        t_high = create_task(conn, _spec(priority=20, command="high"))
        time.sleep(0.01)
        t_mid = create_task(conn, _spec(priority=1, command="mid"))

        queued = list_queued_tasks(conn)
        ids = [t.id for t in queued]

        assert ids == [t_low.id, t_mid.id, t_high.id]


class TestCancelQueuedTask:
    def test_cancel_queued_task(self, conn):
        record = create_task(conn, _spec())
        cancel_task(conn, record.id)

        fetched = _require_task(conn, record.id)
        assert fetched.status == TaskStatus.cancelled

        queued = list_queued_tasks(conn)
        assert len(queued) == 0


class TestFinishRunningTask:
    def test_finish_running_task_success(self, conn):
        record = create_task(conn, _spec())
        now = time.time()
        attach_runtime(conn, record.id, pid=1234, gpu_ids=[0], started_at=now)
        finish_task(conn, record.id, exit_code=0, finished_at=now + 10)

        fetched = _require_task(conn, record.id)
        assert fetched.status == TaskStatus.completed
        assert fetched.exit_code == 0

    def test_finish_running_task_failure(self, conn):
        record = create_task(conn, _spec())
        now = time.time()
        attach_runtime(conn, record.id, pid=1234, gpu_ids=[0], started_at=now)
        finish_task(conn, record.id, exit_code=1, finished_at=now + 5)

        fetched = _require_task(conn, record.id)
        assert fetched.status == TaskStatus.failed
        assert fetched.exit_code == 1


class TestAttachRuntimeCreatesReservations:
    def test_attach_runtime_creates_reservations(self, conn):
        record = create_task(conn, _spec(require_vram_mb=2048))
        now = time.time()
        attach_runtime(conn, record.id, pid=5678, gpu_ids=[0, 1], started_at=now)

        rows = conn.execute(
            "SELECT task_id, gpu_index, vram_mb FROM resource_reservations "
            "WHERE task_id = ? ORDER BY gpu_index",
            (record.id,),
        ).fetchall()

        assert len(rows) == 2
        assert rows[0] == (record.id, 0, 2048)
        assert rows[1] == (record.id, 1, 2048)

        fetched = _require_task(conn, record.id)
        assert fetched.status == TaskStatus.running
        assert fetched.pid == 5678
        assert fetched.gpu_ids == [0, 1]


class TestFinishTaskClearsReservations:
    def test_finish_task_clears_reservations(self, conn):
        record = create_task(conn, _spec())
        now = time.time()
        attach_runtime(conn, record.id, pid=111, gpu_ids=[0, 2], started_at=now)

        # Verify reservations exist
        count = conn.execute(
            "SELECT COUNT(*) FROM resource_reservations WHERE task_id = ?",
            (record.id,),
        ).fetchone()[0]
        assert count == 2

        finish_task(conn, record.id, exit_code=0, finished_at=now + 1)

        count = conn.execute(
            "SELECT COUNT(*) FROM resource_reservations WHERE task_id = ?",
            (record.id,),
        ).fetchone()[0]
        assert count == 0


class TestRestartRecovery:
    def test_restart_recovery(self, conn):
        record = create_task(conn, _spec())
        now = time.time()
        attach_runtime(conn, record.id, pid=999, gpu_ids=[0], started_at=now)

        # Simulate daemon restart by calling recovery again
        recover_interrupted_tasks(conn)

        fetched = _require_task(conn, record.id)
        assert fetched.status == TaskStatus.failed

        events = conn.execute(
            "SELECT event_type FROM task_events WHERE task_id = ?",
            (record.id,),
        ).fetchall()
        assert any(e[0] == "daemon_restart" for e in events)

        # Reservations should be cleaned up
        count = conn.execute(
            "SELECT COUNT(*) FROM resource_reservations WHERE task_id = ?",
            (record.id,),
        ).fetchone()[0]
        assert count == 0


class TestRuntimeState:
    def test_runtime_state(self, conn):
        assert is_queue_paused(conn) is False

        set_queue_paused(conn, True)
        assert is_queue_paused(conn) is True

        set_queue_paused(conn, False)
        assert is_queue_paused(conn) is False


class TestListTasksByStatus:
    def test_list_tasks_by_status(self, conn):
        create_task(conn, _spec(command="a"))
        create_task(conn, _spec(command="b"))
        t3 = create_task(conn, _spec(command="c"))
        cancel_task(conn, t3.id)

        queued = list_tasks(conn, status=TaskStatus.queued)
        assert len(queued) == 2

        cancelled = list_tasks(conn, status=TaskStatus.cancelled)
        assert len(cancelled) == 1
        assert cancelled[0].id == t3.id

        all_tasks = list_tasks(conn)
        assert len(all_tasks) == 3


class TestAttachedTaskPersistence:
    def test_create_and_get_attached_python_task(self, conn):
        spec = _spec(
            argv=["train.py", "--epochs", "10"],
            launch_mode=TaskLaunchMode.attached_python,
            report_requested=True,
        )
        record = create_task(conn, spec)

        assert record.argv == ["train.py", "--epochs", "10"]
        assert record.launch_mode == TaskLaunchMode.attached_python
        assert record.report_requested is True
        assert record.launch_deadline is None

        fetched = get_task(conn, record.id)
        assert fetched is not None
        assert fetched.argv == ["train.py", "--epochs", "10"]
        assert fetched.launch_mode == TaskLaunchMode.attached_python
        assert fetched.report_requested is True
        assert fetched.launch_deadline is None

    def test_reserve_confirm_and_requeue_attached_launch(self, conn):
        spec = _spec(
            launch_mode=TaskLaunchMode.attached_python,
            argv=["script.py"],
        )
        record = create_task(conn, spec)
        now = time.time()
        deadline = now + 30.0

        # Reserve the launch — status becomes launching
        reserve_attached_launch(
            conn, record.id, gpu_ids=[0, 1], launch_deadline=deadline, reserved_at=now,
        )
        fetched = _require_task(conn, record.id)
        assert fetched.status == TaskStatus.launching
        assert fetched.gpu_ids == [0, 1]
        assert fetched.launch_deadline == pytest.approx(deadline, abs=0.01)

        reservations = conn.execute(
            "SELECT COUNT(*) FROM resource_reservations WHERE task_id = ?",
            (record.id,),
        ).fetchone()[0]
        assert reservations == 2

        # Confirm the launch — status becomes running
        confirm_attached_launch(conn, record.id, pid=4242, started_at=now + 1)
        fetched = _require_task(conn, record.id)
        assert fetched.status == TaskStatus.running
        assert fetched.pid == 4242
        assert fetched.started_at == pytest.approx(now + 1, abs=0.01)
        assert fetched.launch_deadline is None

        # Create a second task with an already-expired deadline
        record2 = create_task(conn, spec)
        expired_deadline = now - 5.0
        reserve_attached_launch(
            conn, record2.id, gpu_ids=[2], launch_deadline=expired_deadline, reserved_at=now,
        )
        requeued = requeue_expired_attached_launches(conn, now)
        assert record2.id in requeued

        fetched2 = _require_task(conn, record2.id)
        assert fetched2.status == TaskStatus.queued
        assert fetched2.gpu_ids is None
        assert fetched2.launch_deadline is None

        # Reservations cleaned up
        count = conn.execute(
            "SELECT COUNT(*) FROM resource_reservations WHERE task_id = ?",
            (record2.id,),
        ).fetchone()[0]
        assert count == 0


class TestLaunchingRecoveryOnRestart:
    def test_launching_tasks_requeued_on_restart(self, conn):
        spec = _spec(launch_mode=TaskLaunchMode.attached_python)
        record = create_task(conn, spec)
        now = time.time()
        reserve_attached_launch(
            conn, record.id, gpu_ids=[0], launch_deadline=now + 30, reserved_at=now,
        )
        assert _require_task(conn, record.id).status == TaskStatus.launching

        # Simulate daemon restart
        recover_interrupted_tasks(conn)

        fetched = _require_task(conn, record.id)
        assert fetched.status == TaskStatus.queued
        assert fetched.gpu_ids is None
        assert fetched.launch_deadline is None

        events = conn.execute(
            "SELECT event_type FROM task_events WHERE task_id = ?",
            (record.id,),
        ).fetchall()
        assert any(e[0] == "launch_requeued_after_restart" for e in events)

        count = conn.execute(
            "SELECT COUNT(*) FROM resource_reservations WHERE task_id = ?",
            (record.id,),
        ).fetchone()[0]
        assert count == 0


class TestTaskEvents:
    def test_append_and_list_task_events(self, conn):
        record = create_task(conn, _spec())
        now = time.time()

        append_task_event(conn, record.id, "gpu_reserved", now, {"gpus": [0]})
        append_task_event(conn, record.id, "process_started", now + 1, None)

        events = list_task_events(conn, record.id)
        assert len(events) == 2
        assert events[0]["event_type"] == "gpu_reserved"
        assert events[0]["details"] == {"gpus": [0]}
        assert events[1]["event_type"] == "process_started"
        assert events[1]["details"] is None

        # after_id filtering
        first_id = events[0]["id"]
        filtered = list_task_events(conn, record.id, after_id=first_id)
        assert len(filtered) == 1
        assert filtered[0]["event_type"] == "process_started"

    def test_update_task_priority_only_updates_queued_tasks(self, conn):
        queued = create_task(conn, _spec(priority=10))
        running = create_task(conn, _spec(command="busy"))
        attach_runtime(conn, running.id, pid=1234, gpu_ids=[0], started_at=time.time())

        assert update_task_priority(conn, queued.id, 3) is True
        assert _require_task(conn, queued.id).priority == 3

        assert update_task_priority(conn, running.id, 1) is False
        assert _require_task(conn, running.id).priority == 10
