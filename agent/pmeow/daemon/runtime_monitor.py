"""Background monitor for active task runtimes (in-memory version).

Scans running tasks for PID disappearance and reserved tasks for attach
timeout. Operates on the in-memory TaskQueue instead of SQLite.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from typing import TYPE_CHECKING

import psutil

if TYPE_CHECKING:
    from pmeow.state.task_queue import TaskQueue

log = logging.getLogger(__name__)


class RuntimeMonitorLoop:
    """Scans running tasks for dead PIDs and reserved tasks for attach timeout."""

    def __init__(
        self,
        task_queue: TaskQueue,
        poll_interval: float = 1.0,
        lock: threading.Lock | None = None,
        on_task_removed: Callable[[str], None] | None = None,
    ) -> None:
        self._task_queue = task_queue
        self._poll_interval = poll_interval
        self._lock = lock
        self._on_task_removed = on_task_removed
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def run_forever(self) -> None:
        while not self._stop.is_set():
            try:
                self.tick()
            except Exception:
                log.exception("runtime monitor tick failed")
            self._stop.wait(timeout=self._poll_interval)

    def tick(self) -> list[str]:
        """One monitoring pass. Returns list of removed task IDs."""
        removed: list[str] = []
        now = time.time()

        with self._guard():
            # Check running tasks for dead PIDs
            for task in list(self._task_queue.running.values()):
                if task.pid is None:
                    # No PID — should not happen in running state
                    log.warning("task %s in running state with no PID, removing", task.id)
                    self._task_queue.remove(task.id)
                    removed.append(task.id)
                    continue

                if not self._pid_alive(task.pid, task.pid_create_time):
                    log.info(
                        "task %s: PID %d disappeared, removing from active queue",
                        task.id, task.pid,
                    )
                    self._task_queue.remove(task.id)
                    removed.append(task.id)

            # Check reserved tasks for attach timeout
            for task in list(self._task_queue.reserved.values()):
                if task.attach_deadline is not None and now > task.attach_deadline:
                    log.info(
                        "task %s: attach deadline expired, removing from active queue",
                        task.id,
                    )
                    self._task_queue.remove(task.id)
                    removed.append(task.id)

        if self._on_task_removed:
            for task_id in removed:
                self._on_task_removed(task_id)

        return removed

    def _guard(self):
        """Return the lock as a context manager, or a no-op."""
        if self._lock is not None:
            return self._lock
        from contextlib import nullcontext
        return nullcontext()

    @staticmethod
    def _pid_alive(pid: int, expected_create_time: float | None = None) -> bool:
        """Check if a process is alive, optionally validating create_time."""
        try:
            proc = psutil.Process(pid)
            if expected_create_time is not None:
                actual = proc.create_time()
                if abs(actual - expected_create_time) > 1e-3:
                    return False  # PID reused by a different process
            return proc.is_running()
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            return False
