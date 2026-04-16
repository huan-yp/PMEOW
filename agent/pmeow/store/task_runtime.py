"""Runtime state repository helpers backed by SQLite."""

from __future__ import annotations

import sqlite3
import time

import psutil

from pmeow.models import RuntimePhase, TaskLaunchMode, TaskProcessRecord, TaskRuntimeRecord


def _row_to_runtime_record(row: sqlite3.Row | tuple) -> TaskRuntimeRecord:
    (
        task_id,
        launch_mode,
        root_pid,
        root_created_at,
        runtime_phase,
        first_started_at,
        last_seen_at,
        finalize_source,
        finalize_reason_code,
        last_observed_exit_code,
        updated_at,
    ) = row
    return TaskRuntimeRecord(
        task_id=task_id,
        launch_mode=TaskLaunchMode(launch_mode),
        root_pid=root_pid,
        root_created_at=root_created_at,
        runtime_phase=RuntimePhase(runtime_phase),
        first_started_at=first_started_at,
        last_seen_at=last_seen_at,
        finalize_source=finalize_source,
        finalize_reason_code=finalize_reason_code,
        last_observed_exit_code=last_observed_exit_code,
        updated_at=updated_at,
    )


def _row_to_process_record(row: sqlite3.Row | tuple) -> TaskProcessRecord:
    (
        task_id,
        pid,
        create_time,
        ppid,
        depth,
        user,
        command,
        is_root,
        first_seen_at,
        last_seen_at,
    ) = row
    return TaskProcessRecord(
        task_id=task_id,
        pid=pid,
        create_time=create_time,
        ppid=ppid,
        depth=depth,
        user=user,
        command=command,
        is_root=bool(is_root),
        first_seen_at=first_seen_at,
        last_seen_at=last_seen_at,
    )


def _upsert_task_runtime(conn: sqlite3.Connection, record: TaskRuntimeRecord) -> None:
    updated_at = record.updated_at if record.updated_at is not None else time.time()
    conn.execute(
        """
        INSERT INTO task_runtime (
            task_id,
            launch_mode,
            root_pid,
            root_created_at,
            runtime_phase,
            first_started_at,
            last_seen_at,
            finalize_source,
            finalize_reason_code,
            last_observed_exit_code,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
            launch_mode = excluded.launch_mode,
            root_pid = excluded.root_pid,
            root_created_at = COALESCE(task_runtime.root_created_at, excluded.root_created_at),
            runtime_phase = excluded.runtime_phase,
            first_started_at = CASE
                WHEN excluded.first_started_at < task_runtime.first_started_at
                    THEN excluded.first_started_at
                ELSE task_runtime.first_started_at
            END,
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
            record.root_created_at,
            record.runtime_phase.value,
            record.first_started_at,
            record.last_seen_at,
            record.finalize_source,
            record.finalize_reason_code,
            record.last_observed_exit_code,
            updated_at,
        ),
    )


def upsert_task_runtime(conn: sqlite3.Connection, record: TaskRuntimeRecord) -> None:
    _upsert_task_runtime(conn, record)
    conn.commit()


def get_task_runtime(conn: sqlite3.Connection, task_id: str) -> TaskRuntimeRecord | None:
    row = conn.execute(
        "SELECT task_id, launch_mode, root_pid, root_created_at, runtime_phase, first_started_at, "
        "last_seen_at, finalize_source, finalize_reason_code, last_observed_exit_code, updated_at "
        "FROM task_runtime WHERE task_id = ?",
        (task_id,),
    ).fetchone()
    return _row_to_runtime_record(row) if row else None


def list_active_task_runtimes(conn: sqlite3.Connection) -> list[TaskRuntimeRecord]:
    rows = conn.execute(
        "SELECT task_id, launch_mode, root_pid, root_created_at, runtime_phase, first_started_at, "
        "last_seen_at, finalize_source, finalize_reason_code, last_observed_exit_code, updated_at "
        "FROM task_runtime WHERE runtime_phase != ? ORDER BY first_started_at ASC, task_id ASC",
        (RuntimePhase.finalized.value,),
    ).fetchall()
    return [_row_to_runtime_record(row) for row in rows]


def update_runtime_heartbeat(
    conn: sqlite3.Connection,
    task_id: str,
    *,
    runtime_phase: RuntimePhase,
    seen_at: float,
) -> None:
    conn.execute(
        "UPDATE task_runtime SET runtime_phase = ?, last_seen_at = ?, updated_at = ? WHERE task_id = ?",
        (runtime_phase.value, seen_at, seen_at, task_id),
    )
    conn.commit()


def backfill_task_runtime_root_created_at(
    conn: sqlite3.Connection,
    task_id: str,
    *,
    root_created_at: float | None,
) -> None:
    if root_created_at is None:
        return

    conn.execute(
        "UPDATE task_runtime SET root_created_at = COALESCE(root_created_at, ?), updated_at = ? WHERE task_id = ?",
        (root_created_at, time.time(), task_id),
    )
    conn.commit()


def _replace_task_processes(
    conn: sqlite3.Connection,
    task_id: str,
    records: list[TaskProcessRecord],
) -> None:
    conn.execute("DELETE FROM task_processes WHERE task_id = ?", (task_id,))
    if records:
        conn.executemany(
            """
            INSERT INTO task_processes (
                task_id,
                pid,
                create_time,
                ppid,
                depth,
                user,
                command,
                is_root,
                first_seen_at,
                last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    record.task_id,
                    record.pid,
                    record.create_time,
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


def replace_task_processes(
    conn: sqlite3.Connection,
    task_id: str,
    records: list[TaskProcessRecord],
) -> None:
    _replace_task_processes(conn, task_id, records)
    conn.commit()


def register_task_root_process(
    conn: sqlite3.Connection,
    task_id: str,
    *,
    launch_mode: TaskLaunchMode,
    pid: int,
    started_at: float,
    user: str,
    command: str,
    create_time: float | None = None,
    runtime_phase: RuntimePhase = RuntimePhase.registered,
    commit: bool = True,
) -> None:
    observed_create_time = create_time
    if observed_create_time is None:
        observed_create_time = _read_process_create_time(pid)

    _upsert_task_runtime(
        conn,
        TaskRuntimeRecord(
            task_id=task_id,
            launch_mode=launch_mode,
            root_pid=pid,
            root_created_at=observed_create_time,
            runtime_phase=runtime_phase,
            first_started_at=started_at,
            last_seen_at=started_at,
            updated_at=started_at,
        ),
    )
    _replace_task_processes(
        conn,
        task_id,
        [
            TaskProcessRecord(
                task_id=task_id,
                pid=pid,
                create_time=observed_create_time,
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
    if commit:
        conn.commit()


def clear_task_runtime_tracking(
    conn: sqlite3.Connection,
    task_id: str,
    *,
    commit: bool = True,
) -> None:
    conn.execute("DELETE FROM task_processes WHERE task_id = ?", (task_id,))
    conn.execute("DELETE FROM task_runtime WHERE task_id = ?", (task_id,))
    if commit:
        conn.commit()


def list_task_processes(conn: sqlite3.Connection, task_id: str) -> list[TaskProcessRecord]:
    rows = conn.execute(
        "SELECT task_id, pid, create_time, ppid, depth, user, command, is_root, first_seen_at, last_seen_at "
        "FROM task_processes WHERE task_id = ? ORDER BY depth ASC, pid ASC",
        (task_id,),
    ).fetchall()
    return [_row_to_process_record(row) for row in rows]


def _read_process_create_time(pid: int) -> float | None:
    try:
        return psutil.Process(pid).create_time()
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
        return None


def list_task_process_owners_by_pid(
    conn: sqlite3.Connection,
    pids: list[int],
) -> dict[int, str]:
    if not pids:
        return {}

    placeholders = ", ".join("?" for _ in pids)
    rows = conn.execute(
        f"""
        SELECT
            task_processes.pid,
            task_processes.task_id
        FROM task_processes
        JOIN task_runtime ON task_runtime.task_id = task_processes.task_id
        WHERE task_processes.pid IN ({placeholders})
          AND task_runtime.runtime_phase != ?
        ORDER BY
            task_processes.pid ASC,
            task_runtime.first_started_at DESC,
            task_runtime.updated_at DESC,
            task_processes.task_id ASC
        """,
        (*pids, RuntimePhase.finalized.value),
    ).fetchall()

    owners: dict[int, str] = {}
    for pid, task_id in rows:
        owners.setdefault(pid, task_id)
    return owners