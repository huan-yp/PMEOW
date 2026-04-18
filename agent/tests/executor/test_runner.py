"""Tests for executor/runner.py — uses real subprocesses."""

from __future__ import annotations

import sys
import time

from pmeow.executor.logs import read_task_log
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
    def test_start_and_complete_successfully(self, tmp_path) -> None:
        log_dir = str(tmp_path)
        runner = TaskRunner()
        task = _make_task("echo hello", cwd=str(tmp_path))

        proc = runner.start(task, gpu_ids=[0], log_dir=log_dir)
        proc.wait(timeout=10)

        completed = runner.check_completed()
        assert len(completed) == 1
        assert completed[0] == (task.id, 0)

    def test_cancel_running_task(self, tmp_path) -> None:
        log_dir = str(tmp_path)
        runner = TaskRunner()
        task = _make_task("sleep 60", cwd=str(tmp_path))

        proc = runner.start(task, gpu_ids=[0], log_dir=log_dir)
        assert runner.is_running(task.id)

        ok = runner.cancel(task.id)
        assert ok is True
        assert not runner.is_running(task.id)
        assert proc.poll() is not None

    def test_cuda_visible_devices_set(self, tmp_path) -> None:
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
