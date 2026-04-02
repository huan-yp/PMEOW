"""Simple key-value runtime state helpers."""

from __future__ import annotations

import sqlite3
from typing import Optional


def get_runtime_value(conn: sqlite3.Connection, key: str) -> Optional[str]:
    """Return the value for *key*, or ``None`` if not set."""
    row = conn.execute(
        "SELECT value FROM runtime_state WHERE key = ?", (key,)
    ).fetchone()
    return row[0] if row else None


def set_runtime_value(conn: sqlite3.Connection, key: str, value: str) -> None:
    """Upsert a runtime key-value pair."""
    conn.execute(
        "INSERT INTO runtime_state (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    conn.commit()


def is_queue_paused(conn: sqlite3.Connection) -> bool:
    """Return whether the task queue is paused."""
    return get_runtime_value(conn, "queue_paused") == "1"


def set_queue_paused(conn: sqlite3.Connection, paused: bool) -> None:
    """Pause or resume the task queue."""
    set_runtime_value(conn, "queue_paused", "1" if paused else "0")
