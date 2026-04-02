"""Task repository — CRUD helpers around the tasks table."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from typing import Optional

from pmeow.models import TaskRecord, TaskSpec, TaskStatus


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
        started_at=started_at,
        finished_at=finished_at,
        exit_code=exit_code,
        pid=pid,
    )


_SELECT_COLS = (
    "id, command, cwd, user, require_vram_mb, require_gpu_count, "
    "gpu_ids, priority, status, created_at, started_at, finished_at, "
    "exit_code, pid"
)


def create_task(conn: sqlite3.Connection, spec: TaskSpec) -> TaskRecord:
    """Insert a new task from *spec* and return the resulting record."""
    task_id = str(uuid.uuid4())
    now = time.time()
    gpu_ids_json = json.dumps(spec.gpu_ids) if spec.gpu_ids is not None else None

    conn.execute(
        "INSERT INTO tasks "
        "(id, command, cwd, user, require_vram_mb, require_gpu_count, "
        "gpu_ids, priority, status, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)",
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
    conn.execute(
        "UPDATE tasks SET status = 'running', pid = ?, gpu_ids = ?, started_at = ? "
        "WHERE id = ?",
        (pid, gpu_ids_json, started_at, task_id),
    )

    task = get_task(conn, task_id)
    vram_per_gpu = task.require_vram_mb if task else 0
    for gpu_index in gpu_ids:
        conn.execute(
            "INSERT INTO resource_reservations (task_id, gpu_index, vram_mb, created_at) "
            "VALUES (?, ?, ?, ?)",
            (task_id, gpu_index, vram_per_gpu, started_at),
        )

    conn.commit()


def finish_task(
    conn: sqlite3.Connection, task_id: str, exit_code: int, finished_at: float
) -> None:
    """Complete a task — status is 'completed' if exit_code == 0, else 'failed'."""
    status = "completed" if exit_code == 0 else "failed"
    conn.execute(
        "UPDATE tasks SET status = ?, exit_code = ?, finished_at = ? WHERE id = ?",
        (status, exit_code, finished_at, task_id),
    )
    conn.execute(
        "DELETE FROM resource_reservations WHERE task_id = ?", (task_id,)
    )
    conn.commit()


def cancel_task(conn: sqlite3.Connection, task_id: str) -> None:
    """Cancel a task and remove any resource reservations."""
    conn.execute(
        "UPDATE tasks SET status = 'cancelled' WHERE id = ?", (task_id,)
    )
    conn.execute(
        "DELETE FROM resource_reservations WHERE task_id = ?", (task_id,)
    )
    conn.commit()
