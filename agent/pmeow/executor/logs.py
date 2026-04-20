"""Log capture helpers for task execution."""

from __future__ import annotations

from collections import deque
from datetime import datetime
import os
import re
from typing import IO


_TASK_NAME_PATTERN = re.compile(r"[^A-Za-z0-9_-]+")


def default_task_name(task_id: str) -> str:
    """Return the default display-friendly name for a task id."""
    return task_id.split("-", 1)[0] or task_id[:8]


def normalize_task_name(task_name: str) -> str:
    """Normalize user-provided task names for safe filesystem usage."""
    collapsed = _TASK_NAME_PATTERN.sub("-", task_name.strip())
    normalized = collapsed.strip("-_")
    return normalized[:64] or "task"


def format_task_log_filename(created_at: float, task_name: str) -> str:
    """Format the task log file name as yyyymmddhhmmss.mmm-name.log."""
    timestamp = datetime.fromtimestamp(created_at)
    millis = int(timestamp.microsecond / 1000)
    return f"{timestamp.strftime('%Y%m%d%H%M%S')}.{millis:03d}-{normalize_task_name(task_name)}.log"


def build_task_log_path(log_dir: str, created_at: float, task_name: str) -> str:
    """Return the full log path for a task."""
    return os.path.join(log_dir, format_task_log_filename(created_at, task_name))


def ensure_task_log(log_path: str) -> str:
    """Create the log directory and an empty log file if it doesn't exist.

    Returns the path to the log file. Existing files are not truncated.
    """
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    if not os.path.exists(log_path):
        open(log_path, "xb").close()
    return log_path


def open_task_log(log_path: str, append: bool = False) -> IO[bytes]:
    """Open (or create) the log file in binary write mode.

    Creates the log directory if it does not exist.
    When *append* is ``True``, existing content is preserved.
    """
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    return open(log_path, "ab" if append else "wb")


def append_task_log_line(log_path: str, message: str) -> None:
    """Append a single text line to the task log file."""
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    with open(log_path, "a") as fh:
        fh.write(message + "\n")


def read_task_log(log_path: str, tail: int = 100) -> str:
    """Read the last *tail* lines from a task log file.

    Raises FileNotFoundError if the file does not exist.
    """
    if not os.path.isfile(log_path):
        raise FileNotFoundError(log_path)
    with open(log_path, "r", errors="replace") as fh:
        lines = deque(fh, maxlen=tail)
    return "".join(lines)
