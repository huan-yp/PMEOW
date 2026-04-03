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


def recover_interrupted_tasks(conn: sqlite3.Connection) -> None:
    """Mark any tasks left in 'running' status as 'failed' and clean up.

    Called automatically by :func:`open_database` on startup so that tasks
    that were executing when the daemon last exited are correctly resolved.
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

    # Handle running tasks: mark as failed
    cursor = conn.execute("SELECT id FROM tasks WHERE status = 'running'")
    running_ids = [row[0] for row in cursor.fetchall()]

    if not running_ids and not launching_ids:
        return

    for task_id in running_ids:
        conn.execute(
            "UPDATE tasks SET status = 'failed', finished_at = ? WHERE id = ?",
            (now, task_id),
        )
        conn.execute(
            "INSERT INTO task_events (task_id, event_type, timestamp, details) "
            "VALUES (?, 'daemon_restart', ?, NULL)",
            (task_id, now),
        )
        conn.execute(
            "DELETE FROM resource_reservations WHERE task_id = ?",
            (task_id,),
        )

    conn.commit()
