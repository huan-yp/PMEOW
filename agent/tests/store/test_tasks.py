"""Tests for the persistent local queue state store."""

from __future__ import annotations

import time
from typing import Optional

import pytest

from pmeow.models import (
    RuntimePhase,
    TaskLaunchMode,
    TaskProcessRecord,
    TaskRecord,
    TaskRuntimeRecord,
    TaskSpec,
    TaskStatus,
)
from pmeow.store.database import close_database, open_database, recover_interrupted_tasks
from pmeow.store.task_runtime import (
    get_task_runtime,
    list_task_processes,
    replace_task_processes,
    upsert_task_runtime,
)
from pmeow.store.tasks import (
    append_task_event,
    attach_runtime,
    cancel_task,
    confirm_attached_launch,
    create_task,
    finish_task,
    guarded_finalize_task,
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
        outcome = finish_task(conn, record.id, exit_code=0, finished_at=now + 10)

        assert outcome.transitioned is True
        assert outcome.status == TaskStatus.completed
        assert outcome.finished_at == now + 10
        assert outcome.exit_code == 0

        fetched = _require_task(conn, record.id)
        assert fetched.status == TaskStatus.completed
        assert fetched.exit_code == 0

    def test_finish_running_task_failure(self, conn):
        record = create_task(conn, _spec())
        now = time.time()
        attach_runtime(conn, record.id, pid=1234, gpu_ids=[0], started_at=now)
        outcome = finish_task(conn, record.id, exit_code=1, finished_at=now + 5)

        assert outcome.transitioned is True
        assert outcome.status == TaskStatus.failed
        assert outcome.finished_at == now + 5
        assert outcome.exit_code == 1

        fetched = _require_task(conn, record.id)
        assert fetched.status == TaskStatus.failed
        assert fetched.exit_code == 1

    def test_finish_task_reports_duplicate_finalize_without_transition(self, conn):
        record = create_task(conn, _spec())
        now = time.time()
        attach_runtime(conn, record.id, pid=1234, gpu_ids=[0], started_at=now)

        first = finish_task(conn, record.id, exit_code=0, finished_at=now + 5)
        second = finish_task(conn, record.id, exit_code=1, finished_at=now + 10)

        assert first.transitioned is True
        assert second.transitioned is False
        assert second.status == TaskStatus.completed
        assert second.finished_at == now + 5
        assert second.exit_code == 0

        fetched = _require_task(conn, record.id)
        assert fetched.status == TaskStatus.completed
        assert fetched.finished_at == now + 5
        assert fetched.exit_code == 0


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

        runtime = get_task_runtime(conn, record.id)
        processes = list_task_processes(conn, record.id)

        assert runtime is not None
        assert runtime.launch_mode is TaskLaunchMode.daemon_shell
        assert runtime.root_pid == 5678
        assert runtime.runtime_phase is RuntimePhase.registered
        assert [(proc.pid, proc.ppid, proc.depth, proc.is_root) for proc in processes] == [
            (5678, None, 0, True)
        ]

    def test_attach_runtime_preserves_unknown_root_create_time(self, conn, monkeypatch):
        monkeypatch.setattr("pmeow.store.task_runtime._read_process_create_time", lambda _pid: None)

        record = create_task(conn, _spec())
        attach_runtime(conn, record.id, pid=5678, gpu_ids=[0], started_at=100.0)

        runtime = get_task_runtime(conn, record.id)
        processes = list_task_processes(conn, record.id)

        assert runtime is not None
        assert runtime.root_created_at is None
        assert [(proc.pid, proc.create_time, proc.is_root) for proc in processes] == [
            (5678, None, True)
        ]

    def test_duplicate_attach_runtime_is_no_op(self, conn):
        record = create_task(conn, _spec(require_vram_mb=2048))

        attach_runtime(conn, record.id, pid=5678, gpu_ids=[0, 1], started_at=100.0)
        attach_runtime(conn, record.id, pid=9999, gpu_ids=[0, 1], started_at=200.0)

        fetched = _require_task(conn, record.id)
        assert fetched.status == TaskStatus.running
        assert fetched.pid == 5678
        assert fetched.started_at == 100.0
        assert fetched.gpu_ids == [0, 1]

        reservations = conn.execute(
            "SELECT gpu_index, vram_mb, created_at FROM resource_reservations "
            "WHERE task_id = ? ORDER BY gpu_index, created_at",
            (record.id,),
        ).fetchall()
        assert reservations == [(0, 2048, 100.0), (1, 2048, 100.0)]

        runtime = get_task_runtime(conn, record.id)
        processes = list_task_processes(conn, record.id)

        assert runtime is not None
        assert runtime.root_pid == 5678
        assert runtime.first_started_at == 100.0
        assert runtime.last_seen_at == 100.0
        assert [(proc.pid, proc.first_seen_at, proc.last_seen_at) for proc in processes] == [
            (5678, 100.0, 100.0)
        ]


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


class TestGuardedFinalize:
    def test_guarded_finalize_only_applies_once(self, conn):
        record = create_task(conn, _spec())
        now = time.time()
        attach_runtime(conn, record.id, pid=9001, gpu_ids=[0], started_at=now)

        upsert_task_runtime(
            conn,
            TaskRuntimeRecord(
                task_id=record.id,
                launch_mode=TaskLaunchMode.daemon_shell,
                root_pid=9001,
                runtime_phase=RuntimePhase.running,
                first_started_at=now,
                last_seen_at=now,
                updated_at=now,
            ),
        )
        replace_task_processes(
            conn,
            record.id,
            [
                TaskProcessRecord(
                    task_id=record.id,
                    pid=9001,
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

        late_events = [
            event
            for event in list_task_events(conn, record.id)
            if event["event_type"] == "runtime_finalize_ignored_late_source"
        ]
        assert len(late_events) == 1
        assert late_events[0]["details"] == {
            "finalize_reason_code": "orphaned",
            "finalize_source": "monitor_orphan",
            "late_exit_code": 1,
        }

    def test_guarded_finalize_clears_runtime_rows_and_reservations(self, conn):
        record = create_task(conn, _spec())
        now = time.time()
        attach_runtime(conn, record.id, pid=1111, gpu_ids=[0, 1], started_at=now)

        upsert_task_runtime(
            conn,
            TaskRuntimeRecord(
                task_id=record.id,
                launch_mode=TaskLaunchMode.daemon_shell,
                root_pid=1111,
                runtime_phase=RuntimePhase.running,
                first_started_at=now,
                last_seen_at=now,
                updated_at=now,
            ),
        )
        replace_task_processes(
            conn,
            record.id,
            [
                TaskProcessRecord(
                    task_id=record.id,
                    pid=1111,
                    ppid=None,
                    depth=0,
                    user="alice",
                    command="python train.py",
                    is_root=True,
                    first_seen_at=now,
                    last_seen_at=now,
                ),
                TaskProcessRecord(
                    task_id=record.id,
                    pid=2222,
                    ppid=1111,
                    depth=1,
                    user="alice",
                    command="python worker.py",
                    is_root=False,
                    first_seen_at=now,
                    last_seen_at=now,
                ),
            ],
        )

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


class TestCancelRunningTask:
    def test_cancel_running_task_clears_runtime_tracking(self, conn):
        record = create_task(conn, _spec())
        now = time.time()
        attach_runtime(conn, record.id, pid=7777, gpu_ids=[0], started_at=now)

        upsert_task_runtime(
            conn,
            TaskRuntimeRecord(
                task_id=record.id,
                launch_mode=TaskLaunchMode.daemon_shell,
                root_pid=7777,
                runtime_phase=RuntimePhase.running,
                first_started_at=now,
                last_seen_at=now,
                updated_at=now,
            ),
        )
        replace_task_processes(
            conn,
            record.id,
            [
                TaskProcessRecord(
                    task_id=record.id,
                    pid=7777,
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

        cancel_task(conn, record.id)

        fetched = _require_task(conn, record.id)
        assert fetched.status == TaskStatus.cancelled
        assert fetched.finished_at is not None
        assert get_task_runtime(conn, record.id) is None
        assert list_task_processes(conn, record.id) == []
        assert conn.execute(
            "SELECT COUNT(*) FROM resource_reservations WHERE task_id = ?",
            (record.id,),
        ).fetchone()[0] == 0

        finalized_events = [
            event
            for event in list_task_events(conn, record.id)
            if event["event_type"] == "runtime_finalized"
        ]
        assert len(finalized_events) == 1
        assert finalized_events[0]["details"] == {
            "exit_code": None,
            "finalize_reason_code": None,
            "finalize_source": "cancel_request",
            "status": "cancelled",
        }


class TestRestartRecovery:
    def test_restart_recovery_leaves_running_tasks_for_monitor_reconciliation(self, conn):
        record = create_task(conn, _spec())
        now = time.time()
        attach_runtime(conn, record.id, pid=999, gpu_ids=[0], started_at=now)

        # Simulate daemon restart by calling recovery again
        recover_interrupted_tasks(conn)

        fetched = _require_task(conn, record.id)
        assert fetched.status == TaskStatus.running
        assert fetched.finished_at is None
        assert fetched.exit_code is None

        events = conn.execute(
            "SELECT event_type FROM task_events WHERE task_id = ?",
            (record.id,),
        ).fetchall()
        assert not any(e[0] == "daemon_restart" for e in events)

        count = conn.execute(
            "SELECT COUNT(*) FROM resource_reservations WHERE task_id = ?",
            (record.id,),
        ).fetchone()[0]
        assert count == 1
        assert get_task_runtime(conn, record.id) is not None
        assert list_task_processes(conn, record.id) != []

    def test_open_database_reopen_is_idempotent_and_preserves_running_runtime_state(self, tmp_path):
        conn = open_database(tmp_path)
        task = create_task(conn, _spec())

        attach_runtime(conn, task.id, pid=999, gpu_ids=[0], started_at=100.0)
        upsert_task_runtime(
            conn,
            TaskRuntimeRecord(
                task_id=task.id,
                launch_mode=TaskLaunchMode.daemon_shell,
                root_pid=999,
                runtime_phase=RuntimePhase.running,
                first_started_at=100.0,
                last_seen_at=120.0,
                updated_at=120.0,
            ),
        )
        replace_task_processes(
            conn,
            task.id,
            [
                TaskProcessRecord(
                    task_id=task.id,
                    pid=999,
                    ppid=None,
                    depth=0,
                    user="alice",
                    command="python train.py",
                    is_root=True,
                    first_seen_at=100.0,
                    last_seen_at=120.0,
                ),
            ],
        )
        close_database(conn)

        reopened = open_database(tmp_path)
        try:
            fetched = _require_task(reopened, task.id)
            assert fetched.status == TaskStatus.running

            runtime = get_task_runtime(reopened, task.id)
            processes = list_task_processes(reopened, task.id)

            assert runtime is not None
            assert runtime.root_pid == 999
            assert processes != []

            events = reopened.execute(
                "SELECT event_type FROM task_events WHERE task_id = ?",
                (task.id,),
            ).fetchall()
            assert [event_type for (event_type,) in events].count("daemon_restart") == 0
        finally:
            close_database(reopened)

        reopened_again = open_database(tmp_path)
        try:
            fetched_again = _require_task(reopened_again, task.id)
            assert fetched_again.status == TaskStatus.running

            runtime_again = get_task_runtime(reopened_again, task.id)
            processes_again = list_task_processes(reopened_again, task.id)

            assert runtime_again is not None
            assert runtime_again.root_pid == 999
            assert processes_again != []

            events_again = reopened_again.execute(
                "SELECT event_type FROM task_events WHERE task_id = ?",
                (task.id,),
            ).fetchall()
            assert [event_type for (event_type,) in events_again].count("daemon_restart") == 0
        finally:
            close_database(reopened_again)

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

        runtime = get_task_runtime(conn, record.id)
        processes = list_task_processes(conn, record.id)

        assert runtime is not None
        assert runtime.launch_mode is TaskLaunchMode.attached_python
        assert runtime.root_pid == 4242
        assert runtime.runtime_phase is RuntimePhase.registered
        assert [(proc.pid, proc.ppid, proc.depth, proc.is_root) for proc in processes] == [
            (4242, None, 0, True)
        ]

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

    def test_duplicate_confirm_attached_launch_is_no_op(self, conn):
        spec = _spec(
            launch_mode=TaskLaunchMode.attached_python,
            argv=["script.py"],
        )
        record = create_task(conn, spec)

        reserve_attached_launch(
            conn,
            record.id,
            gpu_ids=[0],
            launch_deadline=150.0,
            reserved_at=100.0,
        )
        confirm_attached_launch(conn, record.id, pid=4242, started_at=101.0)
        confirm_attached_launch(conn, record.id, pid=9999, started_at=202.0)

        fetched = _require_task(conn, record.id)
        assert fetched.status == TaskStatus.running
        assert fetched.pid == 4242
        assert fetched.started_at == 101.0
        assert fetched.launch_deadline is None

        runtime = get_task_runtime(conn, record.id)
        processes = list_task_processes(conn, record.id)

        assert runtime is not None
        assert runtime.root_pid == 4242
        assert runtime.first_started_at == 101.0
        assert runtime.last_seen_at == 101.0
        assert [(proc.pid, proc.first_seen_at, proc.last_seen_at) for proc in processes] == [
            (4242, 101.0, 101.0)
        ]

        reservations = conn.execute(
            "SELECT gpu_index, vram_mb, created_at FROM resource_reservations WHERE task_id = ?",
            (record.id,),
        ).fetchall()
        assert reservations == [(0, spec.require_vram_mb, 100.0)]


class TestLateAttachAndConfirmAreNoOps:
    @pytest.mark.parametrize(
        ("terminal_status", "setup"),
        [
            (TaskStatus.cancelled, "cancelled_before_reserve"),
            (TaskStatus.completed, "finalized_after_confirm"),
        ],
    )
    def test_late_reserve_attached_launch_does_not_mutate_terminal_tasks(
        self, conn, terminal_status, setup
    ):
        record = create_task(conn, _spec(launch_mode=TaskLaunchMode.attached_python))

        if setup == "cancelled_before_reserve":
            cancel_task(conn, record.id)
            expected_finished_at = None
            expected_exit_code = None
            expected_pid = None
        else:
            reserve_attached_launch(
                conn,
                record.id,
                gpu_ids=[0],
                launch_deadline=15.0,
                reserved_at=10.0,
            )
            confirm_attached_launch(conn, record.id, pid=3333, started_at=11.0)
            result = guarded_finalize_task(
                conn,
                record.id,
                status=TaskStatus.completed,
                finished_at=20.0,
                exit_code=0,
                finalize_source="test_finalize",
            )
            assert result.transitioned is True
            expected_finished_at = 20.0
            expected_exit_code = 0
            expected_pid = 3333

        reserve_attached_launch(
            conn,
            record.id,
            gpu_ids=[7],
            launch_deadline=40.0,
            reserved_at=30.0,
        )

        fetched = _require_task(conn, record.id)
        assert fetched.status is terminal_status
        assert fetched.finished_at == expected_finished_at
        assert fetched.exit_code == expected_exit_code
        assert fetched.pid == expected_pid
        assert fetched.gpu_ids == ([0] if setup == "finalized_after_confirm" else None)
        assert fetched.launch_deadline is None

        assert conn.execute(
            "SELECT COUNT(*) FROM resource_reservations WHERE task_id = ?",
            (record.id,),
        ).fetchone()[0] == 0
        assert get_task_runtime(conn, record.id) is None
        assert list_task_processes(conn, record.id) == []

    @pytest.mark.parametrize(
        ("terminal_status", "setup"),
        [
            (TaskStatus.cancelled, "cancelled_before_attach"),
            (TaskStatus.completed, "finalized_after_attach"),
        ],
    )
    def test_late_attach_runtime_does_not_reopen_terminal_tasks(
        self, conn, terminal_status, setup
    ):
        record = create_task(conn, _spec())

        if setup == "cancelled_before_attach":
            cancel_task(conn, record.id)
            expected_finished_at = None
            expected_exit_code = None
        else:
            attach_runtime(conn, record.id, pid=1111, gpu_ids=[0], started_at=10.0)
            result = guarded_finalize_task(
                conn,
                record.id,
                status=TaskStatus.completed,
                finished_at=20.0,
                exit_code=0,
                finalize_source="test_finalize",
            )
            assert result.transitioned is True
            expected_finished_at = 20.0
            expected_exit_code = 0

        attach_runtime(conn, record.id, pid=2222, gpu_ids=[1], started_at=30.0)

        fetched = _require_task(conn, record.id)
        assert fetched.status is terminal_status
        assert fetched.finished_at == expected_finished_at
        assert fetched.exit_code == expected_exit_code
        assert fetched.pid == (1111 if setup == "finalized_after_attach" else None)

        assert conn.execute(
            "SELECT COUNT(*) FROM resource_reservations WHERE task_id = ?",
            (record.id,),
        ).fetchone()[0] == 0
        assert get_task_runtime(conn, record.id) is None
        assert list_task_processes(conn, record.id) == []

    @pytest.mark.parametrize(
        ("terminal_status", "setup"),
        [
            (TaskStatus.cancelled, "cancelled_before_confirm"),
            (TaskStatus.completed, "finalized_after_confirm"),
        ],
    )
    def test_late_confirm_attached_launch_does_not_reopen_terminal_tasks(
        self, conn, terminal_status, setup
    ):
        record = create_task(conn, _spec(launch_mode=TaskLaunchMode.attached_python))

        if setup == "cancelled_before_confirm":
            cancel_task(conn, record.id)
            expected_finished_at = None
            expected_exit_code = None
        else:
            reserve_attached_launch(
                conn,
                record.id,
                gpu_ids=[0],
                launch_deadline=15.0,
                reserved_at=10.0,
            )
            confirm_attached_launch(conn, record.id, pid=3333, started_at=11.0)
            result = guarded_finalize_task(
                conn,
                record.id,
                status=TaskStatus.completed,
                finished_at=20.0,
                exit_code=0,
                finalize_source="test_finalize",
            )
            assert result.transitioned is True
            expected_finished_at = 20.0
            expected_exit_code = 0

        confirm_attached_launch(conn, record.id, pid=4444, started_at=30.0)

        fetched = _require_task(conn, record.id)
        assert fetched.status is terminal_status
        assert fetched.finished_at == expected_finished_at
        assert fetched.exit_code == expected_exit_code
        assert fetched.pid == (3333 if setup == "finalized_after_confirm" else None)
        assert fetched.launch_deadline is None

        assert conn.execute(
            "SELECT COUNT(*) FROM resource_reservations WHERE task_id = ?",
            (record.id,),
        ).fetchone()[0] == 0
        assert get_task_runtime(conn, record.id) is None
        assert list_task_processes(conn, record.id) == []


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
