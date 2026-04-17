"""SQLite database bootstrap, schema migration, and restart recovery."""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

_SCHEMA = """\
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    command TEXT NOT NULL,
    cwd TEXT NOT NULL,
    user TEXT NOT NULL,
    require_vram_mb INTEGER NOT NULL,
    require_gpu_count INTEGER NOT NULL DEFAULT 1,
    gpu_ids TEXT,
    priority INTEGER NOT NULL DEFAULT 10,
    status TEXT NOT NULL DEFAULT 'queued',
    created_at REAL NOT NULL,
    started_at REAL,
    finished_at REAL,
    exit_code INTEGER,
    pid INTEGER
);

CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    event_type TEXT NOT NULL,
    timestamp REAL NOT NULL,
    details TEXT
);

CREATE TABLE IF NOT EXISTS runtime_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resource_reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    gpu_index INTEGER NOT NULL,
    vram_mb INTEGER NOT NULL,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS task_runtime (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id),
    launch_mode TEXT NOT NULL,
    root_pid INTEGER NOT NULL,
    root_created_at REAL,
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
    create_time REAL,
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
"""


def open_database(directory: str | Path) -> sqlite3.Connection:
    """Open (or create) the agent SQLite database under *directory*.

    Enables WAL mode and foreign keys, creates schema tables if needed,
    and runs restart recovery before returning the connection.
    """
    path = Path(directory)
    path.mkdir(parents=True, exist_ok=True)
    db_path = path / "pmeow.db"

    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(_SCHEMA)
    conn.commit()

    _ensure_task_columns(conn)
    _ensure_runtime_tracking_columns(conn)
    _migrate_event_types(conn)
    recover_interrupted_tasks(conn)
    return conn


def close_database(conn: sqlite3.Connection) -> None:
    """Close the database connection cleanly."""
    conn.close()


def _ensure_task_columns(conn: sqlite3.Connection) -> None:
    """Add columns that may be missing from older databases."""
    cols = conn.execute("PRAGMA table_info(tasks)").fetchall()
    names = {row[1] for row in cols}
    if "argv_json" not in names:
        conn.execute("ALTER TABLE tasks ADD COLUMN argv_json TEXT")
    if "env_json" not in names:
        conn.execute("ALTER TABLE tasks ADD COLUMN env_json TEXT")
    if "launch_mode" not in names:
        conn.execute(
            "ALTER TABLE tasks ADD COLUMN launch_mode TEXT NOT NULL DEFAULT 'daemon_shell'"
        )
    if "report_requested" not in names:
        conn.execute(
            "ALTER TABLE tasks ADD COLUMN report_requested INTEGER NOT NULL DEFAULT 0"
        )
    if "launch_deadline" not in names:
        conn.execute("ALTER TABLE tasks ADD COLUMN launch_deadline REAL")
    conn.commit()

def _ensure_runtime_tracking_columns(conn: sqlite3.Connection) -> None:
    runtime_cols = conn.execute("PRAGMA table_info(task_runtime)").fetchall()
    runtime_names = {row[1] for row in runtime_cols}
    if "root_created_at" not in runtime_names:
        conn.execute("ALTER TABLE task_runtime ADD COLUMN root_created_at REAL")

    process_cols = conn.execute("PRAGMA table_info(task_processes)").fetchall()
    process_names = {row[1] for row in process_cols}
    if "create_time" not in process_names:
        conn.execute("ALTER TABLE task_processes ADD COLUMN create_time REAL")
    conn.commit()


def _migrate_event_types(conn: sqlite3.Connection) -> None:
    """Rename legacy event types to their canonical names."""
    conn.execute(
        "UPDATE task_events SET event_type = 'finalized' "
        "WHERE event_type = 'runtime_finalized'"
    )
    conn.execute(
        "UPDATE task_events SET event_type = 'launch_reservation_expired' "
        "WHERE event_type = 'launch_deadline_expired'"
    )
    conn.commit()


def _clear_task_runtime_tracking(
    conn: sqlite3.Connection,
    task_ids: list[str],
) -> None:
    if not task_ids:
        return

    placeholders = ", ".join("?" for _ in task_ids)
    conn.execute(
        f"DELETE FROM task_processes WHERE task_id IN ({placeholders})",
        tuple(task_ids),
    )
    conn.execute(
        f"DELETE FROM task_runtime WHERE task_id IN ({placeholders})",
        tuple(task_ids),
    )
def recover_interrupted_tasks(conn: sqlite3.Connection) -> None:
    """Requeue any tasks left in 'launching' status after restart.

    Running-task reconciliation is handled by the runtime monitor during
    daemon startup, because it can inspect current process state instead of
    blindly forcing terminal status.
    """
    now = time.time()

    # Handle launching tasks: requeue them
    launching_ids = [
        row[0]
        for row in conn.execute(
            "SELECT id FROM tasks WHERE status = 'launching'"
        ).fetchall()
    ]
    for task_id in launching_ids:
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
            "VALUES (?, 'launch_requeued_after_restart', ?, NULL)",
            (task_id, now),
        )

    if not launching_ids:
        return

    _clear_task_runtime_tracking(conn, launching_ids)

    conn.commit()
