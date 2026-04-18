"""Background monitor for active task runtimes (in-memory version).

Scans running tasks for PID disappearance and reserved tasks for attach
timeout.  Instead of mutating the TaskQueue directly, it pushes
RuntimeObservation objects for the queue's tick() to consume.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import TYPE_CHECKING

import psutil

from pmeow.models import TaskEndReason
from pmeow.state.task_queue import RuntimeObservation

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
    ) -> None:
        self._task_queue = task_queue
        self._poll_interval = poll_interval
        self._lock = lock
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
        """One monitoring pass. Returns list of task IDs with new observations."""
        observed: list[str] = []
        now = time.time()

        with self._guard():
            # Check running tasks for dead PIDs
            for task in list(self._task_queue.running.values()):
                if task.pid is None:
                    log.warning("task %s in running state with no PID", task.id)
                    self._task_queue.push_runtime(RuntimeObservation(
                        task_id=task.id,
                        reason=TaskEndReason.running_no_pid,
                        timestamp=now,
                    ))
                    observed.append(task.id)
                    continue

                if not self._pid_alive(task.pid, task.pid_create_time):
                    log.info(
                        "task %s: PID %d disappeared",
                        task.id, task.pid,
                    )
                    self._task_queue.push_runtime(RuntimeObservation(
                        task_id=task.id,
                        reason=TaskEndReason.pid_disappeared,
                        timestamp=now,
                    ))
                    observed.append(task.id)

            # Check reserved tasks for attach timeout
            for task in list(self._task_queue.reserved.values()):
                if task.attach_deadline is not None and now > task.attach_deadline:
                    log.info(
                        "task %s: attach deadline expired",
                        task.id,
                    )
                    self._task_queue.push_runtime(RuntimeObservation(
                        task_id=task.id,
                        reason=TaskEndReason.attach_timeout,
                        timestamp=now,
                    ))
                    observed.append(task.id)

        return observed

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
