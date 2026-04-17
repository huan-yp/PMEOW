"""Tests for executor/runner.py — uses real subprocesses."""

from __future__ import annotations

import sys
import time

import pytest

from pmeow.executor.logs import get_task_log_path, read_task_log
from pmeow.executor.runner import TaskRunner
from pmeow.models import TaskLaunchMode, TaskRecord, TaskStatus


def _make_task(
    command: str,
    cwd: str,
    task_id: str = "test-task-1",
) -> TaskRecord:
    return TaskRecord(
        id=task_id,
        status=TaskStatus.queued,
        command=command,
        cwd=cwd,
        user="testuser",
        launch_mode=TaskLaunchMode.daemon_shell,
        require_vram_mb=0,
        require_gpu_count=0,
        gpu_ids=None,
        priority=10,
        created_at=time.time(),
    )


class TestTaskRunner:
    def test_start_and_complete_successfully(self, tmp_path: object) -> None:
        log_dir = str(tmp_path)
        runner = TaskRunner()
        task = _make_task("echo hello", cwd=str(tmp_path))

        proc = runner.start(task, gpu_ids=[0], log_dir=log_dir)
        proc.wait(timeout=10)

        completed = runner.check_completed()
        assert len(completed) == 1
        assert completed[0] == (task.id, 0)

    def test_nonzero_exit_marks_failed(self, tmp_path: object) -> None:
        log_dir = str(tmp_path)
        runner = TaskRunner()
        task = _make_task('sh -c "exit 1"', cwd=str(tmp_path))

        proc = runner.start(task, gpu_ids=[], log_dir=log_dir)
        proc.wait(timeout=10)

        completed = runner.check_completed()
        assert len(completed) == 1
        tid, rc = completed[0]
        assert tid == task.id
        assert rc == 1

    def test_cancel_running_task(self, tmp_path: object) -> None:
        log_dir = str(tmp_path)
        runner = TaskRunner()
        task = _make_task("sleep 60", cwd=str(tmp_path))

        proc = runner.start(task, gpu_ids=[0], log_dir=log_dir)
        assert runner.is_running(task.id)

        ok = runner.cancel(task.id)
        assert ok is True
        assert not runner.is_running(task.id)
        # Process should be dead
        assert proc.poll() is not None

    def test_log_file_contains_output(self, tmp_path: object) -> None:
        log_dir = str(tmp_path)
        runner = TaskRunner()
        task = _make_task("echo hello", cwd=str(tmp_path))

        proc = runner.start(task, gpu_ids=[0], log_dir=log_dir)
        proc.wait(timeout=10)
        runner.check_completed()

        content = read_task_log(task.id, log_dir)
        assert "hello" in content

    def test_cuda_visible_devices_set(self, tmp_path: object) -> None:
        log_dir = str(tmp_path)
        runner = TaskRunner()
        task = _make_task(sys.executable, cwd=str(tmp_path), task_id="cuda-test")
        task.argv = [
            sys.executable,
            "-c",
            "import os; print(os.environ.get('CUDA_VISIBLE_DEVICES', ''))",
        ]

        proc = runner.start(task, gpu_ids=[2, 5], log_dir=log_dir)
        proc.wait(timeout=10)
        runner.check_completed()

        content = read_task_log("cuda-test", log_dir)
        assert "2,5" in content

    def test_check_completed_returns_finished(self, tmp_path: object) -> None:
        log_dir = str(tmp_path)
        runner = TaskRunner()

        t1 = _make_task("echo a", cwd=str(tmp_path), task_id="task-a")
        t2 = _make_task("echo b", cwd=str(tmp_path), task_id="task-b")

        p1 = runner.start(t1, gpu_ids=[], log_dir=log_dir)
        p2 = runner.start(t2, gpu_ids=[], log_dir=log_dir)

        p1.wait(timeout=10)
        p2.wait(timeout=10)

        completed = runner.check_completed()
        ids = {tid for tid, _ in completed}
        assert ids == {"task-a", "task-b"}
        # After check_completed, tracking should be empty
        assert runner.get_running_pids() == {}

    def test_cancel_untracked_returns_true(self) -> None:
        runner = TaskRunner()
        # Cancelling a task not in runner (e.g. still queued) returns True
        assert runner.cancel("nonexistent-task") is True

    def test_get_running_pids(self, tmp_path: object) -> None:
        log_dir = str(tmp_path)
        runner = TaskRunner()
        task = _make_task("sleep 60", cwd=str(tmp_path))

        proc = runner.start(task, gpu_ids=[0], log_dir=log_dir)
        pids = runner.get_running_pids()
        assert task.id in pids
        assert pids[task.id] == proc.pid

        runner.cancel(task.id)
        assert runner.get_running_pids() == {}

    def test_runner_appends_to_existing_task_log(self, tmp_path) -> None:
        from pmeow.executor.logs import append_task_log_line

        log_dir = str(tmp_path)
        append_task_log_line("append-task", log_dir, "[queued] waiting for GPUs")
        runner = TaskRunner()
        task = _make_task("echo hello", cwd=str(tmp_path), task_id="append-task")
        proc = runner.start(task, gpu_ids=[0], log_dir=log_dir)
        proc.wait(timeout=10)
        runner.check_completed()
        content = read_task_log("append-task", log_dir)
        assert "[queued] waiting for GPUs" in content
        assert "hello" in content
