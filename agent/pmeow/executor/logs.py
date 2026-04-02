"""Log capture helpers for task execution."""

from __future__ import annotations

import os
from collections import deque
from typing import IO


def get_task_log_path(task_id: str, log_dir: str) -> str:
    """Return the path to the log file for *task_id*."""
    return os.path.join(log_dir, f"{task_id}.log")


def open_task_log(task_id: str, log_dir: str) -> IO[bytes]:
    """Open (or create) the log file for *task_id* in binary write mode.

    Creates the log directory if it does not exist.
    """
    os.makedirs(log_dir, exist_ok=True)
    path = get_task_log_path(task_id, log_dir)
    return open(path, "wb")


def read_task_log(task_id: str, log_dir: str, tail: int = 100) -> str:
    """Read the last *tail* lines from the log file for *task_id*.

    Returns an empty string if the file does not exist.
    """
    path = get_task_log_path(task_id, log_dir)
    if not os.path.isfile(path):
        return ""
    with open(path, "r", errors="replace") as fh:
        lines = deque(fh, maxlen=tail)
    return "".join(lines)
