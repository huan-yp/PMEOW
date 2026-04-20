"""TaskRunner — subprocess lifecycle management for queued tasks."""

from __future__ import annotations

import logging
import os
import pwd
import signal
import subprocess
from typing import IO, Optional

from pmeow.executor.logs import open_task_log
from pmeow.models import TaskRecord

log = logging.getLogger(__name__)


def _make_demote_fn(uid: int, gid: int):
    """Return a preexec_fn that drops privileges to the given uid/gid."""

    def _demote():
        os.setgid(gid)
        try:
            supplementary = os.getgrouplist(pwd.getpwuid(uid).pw_name, gid)
            os.setgroups(supplementary)
        except (KeyError, OSError):
            os.setgroups([gid])
        os.setuid(uid)

    return _demote


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
        self,
        task: TaskRecord,
        gpu_ids: list[int],
        *,
        submit_uid: int | None = None,
        submit_gid: int | None = None,
    ) -> subprocess.Popen:
        """Launch *task* as a subprocess and begin tracking it.

        Sets ``CUDA_VISIBLE_DEVICES``, redirects stdout+stderr to a log
        file, and runs the command inside the task's ``cwd``.
        """
        if task.task_log_path is None:
            raise ValueError(f"task {task.id} is missing task_log_path")
        log_fh = open_task_log(task.task_log_path, append=True)
        env = task.env_overrides.copy() if task.env_overrides is not None else os.environ.copy()
        env["CUDA_VISIBLE_DEVICES"] = ",".join(str(g) for g in gpu_ids)

        # Privilege dropping: if daemon is root and submitter identity known, run as submitter
        preexec_fn = None
        if os.getuid() == 0 and submit_uid is not None and submit_uid != 0:
            uid = submit_uid
            gid = submit_gid if submit_gid is not None else uid
            preexec_fn = _make_demote_fn(uid, gid)
            try:
                pw = pwd.getpwuid(uid)
                env.setdefault("HOME", pw.pw_dir)
                env.setdefault("USER", pw.pw_name)
                env.setdefault("LOGNAME", pw.pw_name)
            except KeyError:
                log.warning("submit_uid=%d has no passwd entry, HOME/USER not set", uid)

        popen_args: str | list[str]
        use_shell: bool
        if task.argv:
            popen_args = task.argv
            use_shell = False
        else:
            popen_args = task.command
            use_shell = True

        proc = subprocess.Popen(
            popen_args,
            shell=use_shell,
            cwd=task.cwd,
            env=env,
            stdout=log_fh,
            stderr=subprocess.STDOUT,
            preexec_fn=preexec_fn,
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
