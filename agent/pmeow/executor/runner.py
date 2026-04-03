"""TaskRunner — subprocess lifecycle management for queued tasks."""

from __future__ import annotations

import os
import signal
import subprocess
from typing import IO, Optional

from pmeow.executor.logs import open_task_log
from pmeow.models import TaskRecord


class TaskRunner:
    """Manages subprocess execution for tasks.

    Tracks running processes and their log file handles so they can be
    polled for completion or cancelled on demand.
    """

    def __init__(self) -> None:
        self._procs: dict[str, subprocess.Popen] = {}
        self._logs: dict[str, IO[bytes]] = {}

    # ------------------------------------------------------------------
    # Launch
    # ------------------------------------------------------------------

    def start(
        self, task: TaskRecord, gpu_ids: list[int], log_dir: str
    ) -> subprocess.Popen:
        """Launch *task* as a subprocess and begin tracking it.

        Sets ``CUDA_VISIBLE_DEVICES``, redirects stdout+stderr to a log
        file, and runs the command inside the task's ``cwd``.
        """
        log_fh = open_task_log(task.id, log_dir, append=True)
        env = os.environ.copy()
        env["CUDA_VISIBLE_DEVICES"] = ",".join(str(g) for g in gpu_ids)

        proc = subprocess.Popen(
            task.command,
            shell=True,
            cwd=task.cwd,
            env=env,
            stdout=log_fh,
            stderr=subprocess.STDOUT,
        )

        self._procs[task.id] = proc
        self._logs[task.id] = log_fh
        return proc

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    def is_running(self, task_id: str) -> bool:
        """Return ``True`` if *task_id* is tracked and still alive."""
        proc = self._procs.get(task_id)
        if proc is None:
            return False
        return proc.poll() is None

    def poll(self, task_id: str) -> Optional[int]:
        """Check whether the process for *task_id* has finished.

        Returns the exit code if finished, or ``None`` if still running.
        Returns ``None`` when *task_id* is not tracked.
        """
        proc = self._procs.get(task_id)
        if proc is None:
            return None
        return proc.poll()

    def get_running_pids(self) -> dict[str, int]:
        """Return a mapping of *task_id* → *pid* for all tracked tasks."""
        return {tid: p.pid for tid, p in self._procs.items()}

    # ------------------------------------------------------------------
    # Completion
    # ------------------------------------------------------------------

    def check_completed(self) -> list[tuple[str, int]]:
        """Poll all tracked processes and return those that finished.

        Returns a list of ``(task_id, exit_code)`` pairs.  Finished
        entries are removed from tracking and their log files are closed.
        """
        completed: list[tuple[str, int]] = []
        for task_id in list(self._procs):
            rc = self._procs[task_id].poll()
            if rc is not None:
                completed.append((task_id, rc))
                self._cleanup(task_id)
        return completed

    # ------------------------------------------------------------------
    # Cancellation
    # ------------------------------------------------------------------

    def cancel(self, task_id: str) -> bool:
        """Cancel a running task.

        Sends SIGTERM, waits up to 5 seconds, then SIGKILL if the
        process is still alive.  Returns ``True`` if the task was found
        and terminated (or was not tracked, i.e. still queued).
        """
        proc = self._procs.get(task_id)
        if proc is None:
            # Not tracked — either queued or unknown; the daemon handles
            # DB-level cancellation for queued tasks.
            return True

        try:
            proc.terminate()  # SIGTERM
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()  # SIGKILL
                proc.wait()
        except OSError:
            pass  # Already dead

        self._cleanup(task_id)
        return True

    def terminate(self, task_id: str) -> None:
        """Send SIGTERM then SIGKILL after a brief wait."""
        proc = self._procs.get(task_id)
        if proc is None:
            return
        try:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        except OSError:
            pass

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _cleanup(self, task_id: str) -> None:
        """Remove tracking entries and close the log file handle."""
        self._procs.pop(task_id, None)
        log_fh = self._logs.pop(task_id, None)
        if log_fh is not None:
            try:
                log_fh.close()
            except OSError:
                pass
