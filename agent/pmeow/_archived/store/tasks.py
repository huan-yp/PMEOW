"""Task repository — CRUD helpers around the tasks table."""

from __future__ import annotations

from dataclasses import dataclass
import json
import sqlite3
import time
import uuid
from typing import Optional

from pmeow.models import TaskLaunchMode, TaskRecord, TaskSpec, TaskStatus
from pmeow.store.task_runtime import (
    clear_task_runtime_tracking,
    register_task_root_process,
)


_TERMINAL_STATUSES = {
    TaskStatus.completed,
    TaskStatus.failed,
    TaskStatus.cancelled,
}


def _deserialize_env_json(env_json: str | None) -> dict[str, str] | None:
    if env_json is None:
        return None
    raw = json.loads(env_json)
    if not isinstance(raw, dict):
        return None
    return {
        str(key): value
        for key, value in raw.items()
        if isinstance(value, str)
    }


def _row_to_record(row: sqlite3.Row | tuple) -> TaskRecord:
    """Convert a raw database row into a :class:`TaskRecord`."""
    (
        id_,
        command,
        cwd,
        user,
        require_vram_mb,
        require_gpu_count,
        gpu_ids_json,
        priority,
        status,
        created_at,
        started_at,
        finished_at,
        exit_code,
        pid,
        argv_json,
        env_json,
        launch_mode,
        report_requested,
        launch_deadline,
    ) = row
    return TaskRecord(
        id=id_,
        command=command,
        cwd=cwd,
        user=user,
        require_vram_mb=require_vram_mb,
        require_gpu_count=require_gpu_count,
        gpu_ids=json.loads(gpu_ids_json) if gpu_ids_json is not None else None,
        priority=priority,
        status=TaskStatus(status),
        created_at=created_at,
        argv=json.loads(argv_json) if argv_json is not None else None,
        env_overrides=_deserialize_env_json(env_json),
        launch_mode=TaskLaunchMode(launch_mode),
        report_requested=bool(report_requested),
        launch_deadline=launch_deadline,
        started_at=started_at,
        finished_at=finished_at,
        exit_code=exit_code,
        pid=pid,
    )


_SELECT_COLS = (
    "id, command, cwd, user, require_vram_mb, require_gpu_count, "
    "gpu_ids, priority, status, created_at, started_at, finished_at, "
    "exit_code, pid, argv_json, env_json, launch_mode, report_requested, launch_deadline"
)


@dataclass(frozen=True)
class GuardedFinalizeResult:
    transitioned: bool
    status: TaskStatus | None
    finished_at: float | None
    exit_code: int | None


def _insert_task_event_row(
    conn: sqlite3.Connection,
    task_id: str,
    event_type: str,
    timestamp: float,
    details: dict | None = None,
) -> None:
    serialized_details = None if details is None else json.dumps(details, sort_keys=True)
    conn.execute(
        "INSERT INTO task_events (task_id, event_type, timestamp, details) "
        "VALUES (?, ?, ?, ?)",
        (task_id, event_type, timestamp, serialized_details),
    )


def create_task(conn: sqlite3.Connection, spec: TaskSpec) -> TaskRecord:
    """Insert a new task from *spec* and return the resulting record."""
    task_id = str(uuid.uuid4())
    now = time.time()
    gpu_ids_json = json.dumps(spec.gpu_ids) if spec.gpu_ids is not None else None
    argv_json = json.dumps(spec.argv) if spec.argv is not None else None
    env_json = json.dumps(spec.env_overrides) if spec.env_overrides is not None else None

    conn.execute(
        "INSERT INTO tasks "
        "(id, command, cwd, user, require_vram_mb, require_gpu_count, "
        "gpu_ids, priority, status, created_at, argv_json, env_json, launch_mode, report_requested) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)",
        (
            task_id,
            spec.command,
            spec.cwd,
            spec.user,
            spec.require_vram_mb,
            spec.require_gpu_count,
            gpu_ids_json,
            spec.priority,
            now,
            argv_json,
            env_json,
            spec.launch_mode.value,
            int(spec.report_requested),
        ),
    )
    conn.commit()

    return TaskRecord(
        id=task_id,
        command=spec.command,
        cwd=spec.cwd,
        user=spec.user,
        require_vram_mb=spec.require_vram_mb,
        require_gpu_count=spec.require_gpu_count,
        gpu_ids=spec.gpu_ids,
        priority=spec.priority,
        status=TaskStatus.queued,
        created_at=now,
        argv=spec.argv,
        env_overrides=spec.env_overrides,
        launch_mode=spec.launch_mode,
        report_requested=spec.report_requested,
    )


def get_task(conn: sqlite3.Connection, task_id: str) -> Optional[TaskRecord]:
    """Return the task with *task_id*, or ``None`` if it does not exist."""
    row = conn.execute(
        f"SELECT {_SELECT_COLS} FROM tasks WHERE id = ?", (task_id,)
    ).fetchone()
    return _row_to_record(row) if row else None


def list_tasks(
    conn: sqlite3.Connection, status: Optional[TaskStatus] = None
) -> list[TaskRecord]:
    """Return all tasks, optionally filtered by *status*."""
    if status is not None:
        rows = conn.execute(
            f"SELECT {_SELECT_COLS} FROM tasks WHERE status = ?",
            (status.value,),
        ).fetchall()
    else:
        rows = conn.execute(f"SELECT {_SELECT_COLS} FROM tasks").fetchall()
    return [_row_to_record(r) for r in rows]


def list_queued_tasks(conn: sqlite3.Connection) -> list[TaskRecord]:
    """Return queued tasks ordered by priority ASC, then created_at ASC."""
    rows = conn.execute(
        f"SELECT {_SELECT_COLS} FROM tasks WHERE status = 'queued' "
        "ORDER BY priority ASC, created_at ASC"
    ).fetchall()
    return [_row_to_record(r) for r in rows]

def list_recent_terminal_tasks(
    conn: sqlite3.Connection, limit: int = 20
) -> list[TaskRecord]:
    """Return recently finished tasks (completed, failed, cancelled) ordered by finished_at DESC."""
    rows = conn.execute(
        f"SELECT {_SELECT_COLS} FROM tasks WHERE status IN ('completed', 'failed', 'cancelled') "
        "ORDER BY finished_at DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [_row_to_record(r) for r in rows]


def update_task_status(
    conn: sqlite3.Connection, task_id: str, status: TaskStatus
) -> None:
    """Set the status of *task_id*."""
    conn.execute(
        "UPDATE tasks SET status = ? WHERE id = ?", (status.value, task_id)
    )
    conn.commit()


def attach_runtime(
    conn: sqlite3.Connection,
    task_id: str,
    pid: int,
    gpu_ids: list[int],
    started_at: float,
) -> None:
    """Transition a task to running and create resource reservations."""
    gpu_ids_json = json.dumps(gpu_ids)
    cursor = conn.execute(
        "UPDATE tasks SET status = 'running', pid = ?, gpu_ids = ?, started_at = ? "
        "WHERE id = ? AND status = 'queued'",
        (pid, gpu_ids_json, started_at, task_id),
    )
    if cursor.rowcount == 0:
        return

    task = get_task(conn, task_id)
    vram_per_gpu = task.require_vram_mb if task else 0
    for gpu_index in gpu_ids:
        conn.execute(
            "INSERT INTO resource_reservations (task_id, gpu_index, vram_mb, created_at) "
            "VALUES (?, ?, ?, ?)",
            (task_id, gpu_index, vram_per_gpu, started_at),
        )

    if task is not None:
        register_task_root_process(
            conn,
            task_id,
            launch_mode=task.launch_mode,
            pid=pid,
            started_at=started_at,
            user=task.user,
            command=task.command,
            commit=False,
        )

    conn.commit()


def finish_task(
    conn: sqlite3.Connection, task_id: str, exit_code: int, finished_at: float
) -> GuardedFinalizeResult:
    """Complete a task — status is 'completed' if exit_code == 0, else 'failed'."""
    status = TaskStatus.completed if exit_code == 0 else TaskStatus.failed
    return guarded_finalize_task(
        conn,
        task_id,
        status=status,
        finished_at=finished_at,
        exit_code=exit_code,
        finalize_source="legacy_finish",
    )


def guarded_finalize_task(
    conn: sqlite3.Connection,
    task_id: str,
    *,
    status: TaskStatus,
    finished_at: float,
    exit_code: int | None,
    finalize_source: str,
    finalize_reason_code: str | None = None,
) -> GuardedFinalizeResult:
    if status not in _TERMINAL_STATUSES:
        raise ValueError("guarded_finalize_task requires a terminal status")

    terminal_values = tuple(task_status.value for task_status in _TERMINAL_STATUSES)
    placeholders = ", ".join("?" for _ in terminal_values)
    cursor = conn.execute(
        f"UPDATE tasks SET status = ?, exit_code = ?, finished_at = ? WHERE id = ? "
        f"AND status NOT IN ({placeholders})",
        (status.value, exit_code, finished_at, task_id, *terminal_values),
    )
    if cursor.rowcount == 0:
        task = get_task(conn, task_id)
        if task is None:
            return GuardedFinalizeResult(False, None, None, None)

        _insert_task_event_row(
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
        conn.commit()
        return GuardedFinalizeResult(False, task.status, task.finished_at, task.exit_code)

    conn.execute("DELETE FROM resource_reservations WHERE task_id = ?", (task_id,))
    clear_task_runtime_tracking(conn, task_id, commit=False)

    # Retrieve last known runtime info for the finalized event
    task = get_task(conn, task_id)
    last_pid = task.pid if task else None
    last_gpu_ids = task.gpu_ids if task else None

    _insert_task_event_row(
        conn,
        task_id,
        "finalized",
        finished_at,
        {
            "status": status.value,
            "finalize_source": finalize_source,
            "finalize_reason_code": finalize_reason_code,
            "exit_code": exit_code,
            "last_pid": last_pid,
            "last_gpu_ids": last_gpu_ids,
            "finished_at": finished_at,
        },
    )
    conn.commit()
    return GuardedFinalizeResult(True, status, finished_at, exit_code)


def cancel_task(conn: sqlite3.Connection, task_id: str) -> None:
    """Cancel a task and remove any resource reservations."""
    task = get_task(conn, task_id)
    if task is None or task.status in _TERMINAL_STATUSES:
        return

    if task.status is TaskStatus.running:
        guarded_finalize_task(
            conn,
            task_id,
            status=TaskStatus.cancelled,
            finished_at=time.time(),
            exit_code=None,
            finalize_source="cancel_request",
        )
        return

    conn.execute(
        "UPDATE tasks SET status = 'cancelled' WHERE id = ?", (task_id,)
    )
    conn.execute(
        "DELETE FROM resource_reservations WHERE task_id = ?", (task_id,)
    )
    clear_task_runtime_tracking(conn, task_id, commit=False)
    conn.commit()


def reserve_attached_launch(
    conn: sqlite3.Connection,
    task_id: str,
    gpu_ids: list[int],
    launch_deadline: float,
    reserved_at: float,
) -> None:
    """Reserve GPUs for an attached launch — sets status to 'launching'."""
    gpu_ids_json = json.dumps(gpu_ids)
    cursor = conn.execute(
        "UPDATE tasks SET status = 'launching', gpu_ids = ?, launch_deadline = ? "
        "WHERE id = ? AND status = 'queued'",
        (gpu_ids_json, launch_deadline, task_id),
    )
    if cursor.rowcount == 0:
        return

    task = get_task(conn, task_id)
    vram_per_gpu = task.require_vram_mb if task else 0
    for gpu_index in gpu_ids:
        conn.execute(
            "INSERT INTO resource_reservations (task_id, gpu_index, vram_mb, created_at) "
            "VALUES (?, ?, ?, ?)",
            (task_id, gpu_index, vram_per_gpu, reserved_at),
        )
    conn.commit()


def confirm_attached_launch(
    conn: sqlite3.Connection,
    task_id: str,
    pid: int,
    started_at: float,
) -> None:
    """Confirm an attached launch — sets status to 'running', clears deadline."""
    cursor = conn.execute(
        "UPDATE tasks SET status = 'running', pid = ?, started_at = ?, "
        "launch_deadline = NULL WHERE id = ? AND status = 'launching'",
        (pid, started_at, task_id),
    )
    if cursor.rowcount == 0:
        return

    task = get_task(conn, task_id)
    if task is not None:
        register_task_root_process(
            conn,
            task_id,
            launch_mode=task.launch_mode,
            pid=pid,
            started_at=started_at,
            user=task.user,
            command=task.command,
            commit=False,
        )

    conn.commit()


def requeue_expired_attached_launches(
    conn: sqlite3.Connection, now: float
) -> list[str]:
    """Requeue launching tasks whose deadline has passed. Returns requeued IDs."""
    rows = conn.execute(
        "SELECT id FROM tasks WHERE status = 'launching' AND launch_deadline < ?",
        (now,),
    ).fetchall()
    requeued_ids = [row[0] for row in rows]
    for task_id in requeued_ids:
        conn.execute(
            "UPDATE tasks SET status = 'queued', gpu_ids = NULL, launch_deadline = NULL "
            "WHERE id = ?",
            (task_id,),
        )
        conn.execute(
            "DELETE FROM resource_reservations WHERE task_id = ?",
            (task_id,),
        )
        conn.execute(
            "INSERT INTO task_events (task_id, event_type, timestamp, details) "
            "VALUES (?, 'launch_reservation_expired', ?, NULL)",
            (task_id, now),
        )
    if requeued_ids:
        conn.commit()
    return requeued_ids


def append_task_event(
    conn: sqlite3.Connection,
    task_id: str,
    event_type: str,
    timestamp: float,
    details: dict | None = None,
) -> None:
    """Insert a structured event into the task_events table."""
    serialized_details = None if details is None else json.dumps(details, sort_keys=True)

    conn.execute(
        "INSERT INTO task_events (task_id, event_type, timestamp, details) "
        "VALUES (?, ?, ?, ?)",
        (task_id, event_type, timestamp, serialized_details),
    )
    conn.commit()


def list_task_events(
    conn: sqlite3.Connection,
    task_id: str,
    after_id: int = 0,
) -> list[dict]:
    """Return task events for *task_id*, optionally after a given event id."""
    rows = conn.execute(
        "SELECT id, task_id, event_type, timestamp, details "
        "FROM task_events WHERE task_id = ? AND id > ? ORDER BY id ASC",
        (task_id, after_id),
    ).fetchall()
    return [
        {
            "id": r[0],
            "task_id": r[1],
            "event_type": r[2],
            "timestamp": r[3],
            "details": None if not r[4] else json.loads(r[4]),
        }
        for r in rows
    ]


def update_task_priority(
    conn: sqlite3.Connection,
    task_id: str,
    priority: int,
) -> bool:
    """Update a queued task's priority. Returns True if a row changed."""
    cursor = conn.execute(
        "UPDATE tasks SET priority = ? WHERE id = ? AND status = 'queued'",
        (priority, task_id),
    )
    conn.commit()
    return cursor.rowcount > 0
