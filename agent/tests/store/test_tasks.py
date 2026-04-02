"""Tests for the persistent local queue state store."""

from __future__ import annotations

import time

import pytest

from pmeow.models import TaskSpec, TaskStatus
from pmeow.store.database import open_database, close_database, recover_interrupted_tasks
from pmeow.store.tasks import (
    attach_runtime,
    cancel_task,
    create_task,
    finish_task,
    get_task,
    list_queued_tasks,
    list_tasks,
)
from pmeow.store.runtime import is_queue_paused, set_queue_paused


@pytest.fixture()
def conn(tmp_path):
    """Yield an open database connection in a temp directory."""
    db = open_database(tmp_path)
    yield db
    close_database(db)


def _spec(**overrides) -> TaskSpec:
    defaults = dict(
        command="python train.py",
        cwd="/home/user/project",
        user="alice",
        require_vram_mb=4096,
    )
    defaults.update(overrides)
    return TaskSpec(**defaults)


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

        fetched = get_task(conn, record.id)
        assert fetched.status == TaskStatus.cancelled

        queued = list_queued_tasks(conn)
        assert len(queued) == 0


class TestFinishRunningTask:
    def test_finish_running_task_success(self, conn):
        record = create_task(conn, _spec())
        now = time.time()
        attach_runtime(conn, record.id, pid=1234, gpu_ids=[0], started_at=now)
        finish_task(conn, record.id, exit_code=0, finished_at=now + 10)

        fetched = get_task(conn, record.id)
        assert fetched.status == TaskStatus.completed
        assert fetched.exit_code == 0

    def test_finish_running_task_failure(self, conn):
        record = create_task(conn, _spec())
        now = time.time()
        attach_runtime(conn, record.id, pid=1234, gpu_ids=[0], started_at=now)
        finish_task(conn, record.id, exit_code=1, finished_at=now + 5)

        fetched = get_task(conn, record.id)
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

        fetched = get_task(conn, record.id)
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

        fetched = get_task(conn, record.id)
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
