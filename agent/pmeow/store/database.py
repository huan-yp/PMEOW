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

    recover_interrupted_tasks(conn)
    return conn


def close_database(conn: sqlite3.Connection) -> None:
    """Close the database connection cleanly."""
    conn.close()


def recover_interrupted_tasks(conn: sqlite3.Connection) -> None:
    """Mark any tasks left in 'running' status as 'failed' and clean up.

    Called automatically by :func:`open_database` on startup so that tasks
    that were executing when the daemon last exited are correctly resolved.
    """
    now = time.time()
    cursor = conn.execute("SELECT id FROM tasks WHERE status = 'running'")
    running_ids = [row[0] for row in cursor.fetchall()]

    if not running_ids:
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
