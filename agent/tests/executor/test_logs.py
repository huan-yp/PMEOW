"""Tests for executor/logs.py — ensure_task_log, append mode, append_task_log_line."""

from __future__ import annotations

import os

import pytest

from pmeow.executor.logs import (
    append_task_log_line,
    ensure_task_log,
    get_task_log_path,
    open_task_log,
    read_task_log,
)


class TestEnsureTaskLog:
    def test_creates_empty_file_when_missing(self, tmp_path) -> None:
        log_dir = str(tmp_path / "logs")
        path = ensure_task_log("new-task", log_dir)
        assert os.path.isfile(path)
        assert os.path.getsize(path) == 0

    def test_returns_existing_path_without_truncating(self, tmp_path) -> None:
        log_dir = str(tmp_path)
        path = get_task_log_path("existing", log_dir)
        with open(path, "w") as f:
            f.write("preexisting\n")
        returned = ensure_task_log("existing", log_dir)
        assert returned == path
        with open(path) as f:
            assert f.read() == "preexisting\n"


class TestOpenTaskLogAppend:
    def test_default_mode_truncates(self, tmp_path) -> None:
        log_dir = str(tmp_path)
        path = get_task_log_path("t1", log_dir)
        with open(path, "wb") as f:
            f.write(b"old content\n")
        fh = open_task_log("t1", log_dir)
        fh.write(b"new\n")
        fh.close()
        with open(path) as f:
            content = f.read()
        assert "old content" not in content
        assert "new" in content

    def test_append_mode_preserves(self, tmp_path) -> None:
        log_dir = str(tmp_path)
        path = get_task_log_path("t2", log_dir)
        with open(path, "wb") as f:
            f.write(b"old content\n")
        fh = open_task_log("t2", log_dir, append=True)
        fh.write(b"new\n")
        fh.close()
        with open(path) as f:
            content = f.read()
        assert "old content" in content
        assert "new" in content


class TestAppendTaskLogLine:
    def test_appends_line_to_new_file(self, tmp_path) -> None:
        log_dir = str(tmp_path)
        append_task_log_line("task-a", log_dir, "hello world")
        content = read_task_log("task-a", log_dir)
        assert "hello world" in content

    def test_appends_multiple_lines(self, tmp_path) -> None:
        log_dir = str(tmp_path)
        append_task_log_line("task-b", log_dir, "line1")
        append_task_log_line("task-b", log_dir, "line2")
        content = read_task_log("task-b", log_dir)
        assert "line1" in content
        assert "line2" in content


class TestReadTaskLog:
    def test_missing_file_raises_file_not_found(self, tmp_path) -> None:
        with pytest.raises(FileNotFoundError):
            read_task_log("missing-task", str(tmp_path))

    def test_empty_file_returns_empty_string(self, tmp_path) -> None:
        log_dir = str(tmp_path)
        ensure_task_log("empty-task", log_dir)
        assert read_task_log("empty-task", log_dir) == ""

    def test_tail_returns_last_lines_only(self, tmp_path) -> None:
        log_dir = str(tmp_path)
        append_task_log_line("tail-task", log_dir, "line1")
        append_task_log_line("tail-task", log_dir, "line2")
        append_task_log_line("tail-task", log_dir, "line3")
        assert read_task_log("tail-task", log_dir, tail=2) == "line2\nline3\n"
