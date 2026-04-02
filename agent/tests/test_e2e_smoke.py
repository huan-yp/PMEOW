"""End-to-end smoke test: daemon → submit → complete → logs."""

from __future__ import annotations

import os
import tempfile
import threading
import time

import pytest

from pmeow.config import AgentConfig
from pmeow.daemon.service import DaemonService
from pmeow.models import TaskSpec, TaskStatus


@pytest.fixture()
def daemon_service(tmp_path):
    """Create a DaemonService with a temporary state directory and short interval."""
    state_dir = str(tmp_path / "state")
    log_dir = str(tmp_path / "logs")
    socket_path = str(tmp_path / "pmeow.sock")
    os.makedirs(state_dir, exist_ok=True)
    os.makedirs(log_dir, exist_ok=True)

    config = AgentConfig(
        server_url="",
        agent_id="test-node",
        collection_interval=1,
        heartbeat_interval=30,
        history_window_seconds=60,
        vram_redundancy_coefficient=0.1,
        state_dir=state_dir,
        socket_path=socket_path,
        log_dir=log_dir,
    )
    return DaemonService(config)


def test_e2e_submit_and_complete(daemon_service: DaemonService):
    """Submit a simple task, let the daemon process it, verify completion and logs."""
    svc = daemon_service
    daemon_thread: threading.Thread | None = None

    try:
        # Start the daemon's collect loop in a background thread.
        # We can't use svc.start() because it installs signal handlers
        # (only works from main thread) and blocks.  Instead, run
        # collect_cycle() in a tight loop ourselves.
        stop = threading.Event()

        def _run_daemon():
            while not stop.is_set():
                try:
                    svc.collect_cycle()
                except Exception:
                    pass
                stop.wait(timeout=0.5)

        daemon_thread = threading.Thread(target=_run_daemon, daemon=True)
        daemon_thread.start()

        # Submit a trivial task that requires no GPU.
        spec = TaskSpec(
            command="echo hello",
            cwd=str(os.getcwd()),
            user="testuser",
            require_vram_mb=0,
            require_gpu_count=0,
            priority=10,
        )
        record = svc.submit_task(spec)
        task_id = record.id

        assert record.status == TaskStatus.queued

        # Poll until the task completes (timeout 30s).
        deadline = time.monotonic() + 30
        final_status = None
        while time.monotonic() < deadline:
            tasks = svc.list_tasks()
            task = next((t for t in tasks if t.id == task_id), None)
            if task and task.status in (TaskStatus.completed, TaskStatus.failed):
                final_status = task.status
                break
            time.sleep(0.5)

        assert final_status is not None, "task did not complete within 30s"
        assert final_status == TaskStatus.completed

        # Re-fetch for exit_code check.
        tasks = svc.list_tasks()
        task = next(t for t in tasks if t.id == task_id)
        assert task.exit_code == 0

        # Verify log file exists and contains expected output.
        log_content = svc.get_logs(task_id)
        assert "hello" in log_content

    finally:
        # Ensure clean shutdown regardless of test outcome.
        if daemon_thread is not None:
            stop.set()
            daemon_thread.join(timeout=5)
        svc.stop()
