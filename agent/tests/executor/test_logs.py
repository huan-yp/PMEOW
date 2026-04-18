"""Tests for executor/logs.py."""

from __future__ import annotations

import os

from pmeow.executor.logs import (
    append_task_log_line,
    ensure_task_log,
    read_task_log,
)


def test_creates_empty_file_when_missing(tmp_path) -> None:
    log_dir = str(tmp_path / "logs")
    path = ensure_task_log("new-task", log_dir)
    assert os.path.isfile(path)
    assert os.path.getsize(path) == 0


def test_appends_line_to_new_file(tmp_path) -> None:
    log_dir = str(tmp_path)
    append_task_log_line("task-a", log_dir, "hello world")
    content = read_task_log("task-a", log_dir)
    assert "hello world" in content
