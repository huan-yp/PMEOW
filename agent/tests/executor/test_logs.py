"""Tests for executor/logs.py."""

from __future__ import annotations

import os
import re

from pmeow.executor.logs import (
    append_task_log_line,
    ensure_task_log,
    format_task_log_filename,
    read_task_log,
)


def test_creates_empty_file_when_missing(tmp_path) -> None:
    path = ensure_task_log(str(tmp_path / "logs" / "20260420101010.123-new-task.log"))
    assert os.path.isfile(path)
    assert os.path.getsize(path) == 0


def test_appends_line_to_new_file(tmp_path) -> None:
    log_path = str(tmp_path / "20260420101010.123-task-a.log")
    append_task_log_line(log_path, "hello world")
    content = read_task_log(log_path)
    assert "hello world" in content
    assert re.fullmatch(r"\d{14}\.\d{3}-train-demo-1\.log", format_task_log_filename(1_713_312_000.456, "train demo/1"))
