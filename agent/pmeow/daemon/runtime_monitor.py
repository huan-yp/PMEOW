"""Background monitor for active task runtimes."""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from collections import deque
from contextlib import nullcontext
from typing import Iterable

import psutil

from pmeow.models import RuntimePhase, TaskProcessRecord, TaskStatus, TaskRuntimeRecord
from pmeow.store.task_runtime import (
    backfill_task_runtime_root_created_at,
    get_task_runtime,
    list_active_task_runtimes,
    list_task_processes,
    register_task_root_process,
    replace_task_processes,
    update_runtime_heartbeat,
)
from pmeow.store.tasks import append_task_event, guarded_finalize_task, list_tasks


log = logging.getLogger(__name__)


class RuntimeMonitorLoop:
    """Refreshes process trees for active runtimes and finalizes orphans."""

    def __init__(
        self,
        conn,
        poll_interval: float = 1.0,
        db_lock=None,
        on_terminal_transition: Callable[[str], None] | None = None,
    ) -> None:
        self._conn = conn
        self._poll_interval = poll_interval
        self._db_lock = db_lock
        self._on_terminal_transition = on_terminal_transition
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
        finalized: list[str] = []
        now = time.time()

        for runtime in self._db_call(lambda: list_active_task_runtimes(self._conn)):
            processes = self._collect_process_tree(runtime, now)
            if processes:
                self._db_call(
                    lambda: self._persist_live_runtime(
                        runtime.task_id,
                        processes,
                        seen_at=now,
                    )
                )
                continue

            if self._db_call(
                lambda: self._finalize_orphaned_runtime(
                    runtime.task_id,
                    root_pid=runtime.root_pid,
                    finalized_at=now,
                )
            ):
                finalized.append(runtime.task_id)

        self._notify_terminal_transitions(finalized)
        return finalized

    def recover_after_restart(self) -> list[str]:
        recovered: list[str] = []
        now = time.time()

        for task in self._db_call(lambda: list_tasks(self._conn, status=TaskStatus.running)):
            runtime = self._db_call(lambda: get_task_runtime(self._conn, task.id))
            runtime_pid = runtime.root_pid if runtime is not None else task.pid
            if runtime_pid is None:
                if self._db_call(
                    lambda: self._finalize_missing_restart_runtime(
                        task.id,
                        finalized_at=now,
                    )
                ):
                    recovered.append(task.id)
                continue

            runtime_record = (
                runtime
                if runtime is not None
                else TaskRuntimeRecord(
                    task_id=task.id,
                    launch_mode=task.launch_mode,
                    root_pid=runtime_pid,
                    runtime_phase=RuntimePhase.running,
                    first_started_at=task.started_at or now,
                    last_seen_at=task.started_at or now,
                    updated_at=task.started_at or now,
                )
            )

            processes = self._collect_process_tree(runtime_record, now)
            if not processes:
                if self._db_call(
                    lambda: self._finalize_missing_restart_runtime(
                        task.id,
                        finalized_at=now,
                    )
                ):
                    recovered.append(task.id)
                continue

            if runtime is None:
                self._db_call(
                    lambda: register_task_root_process(
                        self._conn,
                        task.id,
                        launch_mode=task.launch_mode,
                        pid=runtime_pid,
                        started_at=task.started_at or now,
                        user=task.user,
                        command=task.command,
                        runtime_phase=RuntimePhase.running,
                        commit=False,
                    )
                )
            if self._db_call(
                lambda: self._persist_live_runtime(
                    task.id,
                    processes,
                    seen_at=now,
                )
            ):
                continue

            if self._db_call(
                lambda: self._finalize_missing_restart_runtime(
                    task.id,
                    finalized_at=now,
                )
            ):
                recovered.append(task.id)

        self._notify_terminal_transitions(recovered)
        return recovered

    def _notify_terminal_transitions(self, task_ids: list[str]) -> None:
        if self._on_terminal_transition is None:
            return

        for task_id in task_ids:
            self._on_terminal_transition(task_id)

    def _db_call(self, callback):
        with self._db_guard():
            return callback()

    def _db_guard(self):
        return self._db_lock if self._db_lock is not None else nullcontext()

    def _persist_live_runtime(
        self,
        task_id: str,
        processes: list[TaskProcessRecord],
        *,
        seen_at: float,
    ) -> bool:
        runtime = get_task_runtime(self._conn, task_id)
        if runtime is None:
            return False

        root_process = next((process for process in processes if process.is_root), None)
        if runtime.root_created_at is None and root_process is not None:
            backfill_task_runtime_root_created_at(
                self._conn,
                task_id,
                root_created_at=root_process.create_time,
            )

        replace_task_processes(self._conn, task_id, processes)
        update_runtime_heartbeat(
            self._conn,
            task_id,
            runtime_phase=RuntimePhase.running,
            seen_at=seen_at,
        )
        return True

    def _finalize_orphaned_runtime(
        self,
        task_id: str,
        *,
        root_pid: int,
        finalized_at: float,
    ) -> bool:
        outcome = guarded_finalize_task(
            self._conn,
            task_id,
            status=TaskStatus.failed,
            finished_at=finalized_at,
            exit_code=None,
            finalize_source="monitor_orphan",
            finalize_reason_code="orphaned",
        )
        if not outcome.transitioned:
            return False

        append_task_event(
            self._conn,
            task_id,
            "runtime_orphan_detected",
            finalized_at,
            {
                "root_pid": root_pid,
                "finalize_source": "monitor_orphan",
                "reason_code": "orphaned",
            },
        )
        return True

    def _finalize_missing_restart_runtime(
        self,
        task_id: str,
        *,
        finalized_at: float,
    ) -> bool:
        outcome = guarded_finalize_task(
            self._conn,
            task_id,
            status=TaskStatus.failed,
            finished_at=finalized_at,
            exit_code=None,
            finalize_source="daemon_restart_recovery",
            finalize_reason_code="missing_runtime_or_process",
        )
        if not outcome.transitioned:
            return False

        append_task_event(
            self._conn,
            task_id,
            "daemon_restart",
            finalized_at,
            {
                "finalize_source": "daemon_restart_recovery",
                "reason_code": "missing_runtime_or_process",
            },
        )
        return True

    @staticmethod
    def _create_time_matches(expected: float | None, actual: float | None) -> bool:
        if expected is None or actual is None:
            return expected is None and actual is None
        return abs(expected - actual) <= 1e-3

    def _pid_exists(self, pid: int) -> bool:
        return psutil.pid_exists(pid)

    def _try_get_process(self, pid: int, expected_create_time: float | None = None) -> psutil.Process | None:
        try:
            process = psutil.Process(pid)
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            return None
        if expected_create_time is None:
            return None

        try:
            actual_create_time = process.create_time()
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            return None
        if not self._create_time_matches(expected_create_time, actual_create_time):
            return None
        return process

    def _collect_process_tree(
        self,
        runtime: TaskRuntimeRecord,
        seen_at: float,
    ) -> list[TaskProcessRecord]:
        prior_processes = {
            record.pid: record
            for record in self._db_call(
                lambda: list_task_processes(self._conn, runtime.task_id)
            )
        }
        root_expected_create_time = runtime.root_created_at
        if root_expected_create_time is None and runtime.root_pid in prior_processes:
            root_expected_create_time = prior_processes[runtime.root_pid].create_time
        live_prior_processes = {
            record.pid: proc
            for record in sorted(prior_processes.values(), key=lambda record: (record.depth, record.pid))
            if (proc := self._try_get_process(record.pid, record.create_time)) is not None
        }

        queue: deque[tuple[psutil.Process, int, int | None]] = deque()
        seeded_pids: set[int] = set()

        root = self._try_get_process(runtime.root_pid, root_expected_create_time)
        if root is not None:
            queue.append((root, 0, None))
            seeded_pids.add(root.pid)

        for record in sorted(prior_processes.values(), key=lambda current: (current.depth, current.pid)):
            proc = live_prior_processes.get(record.pid)
            if proc is None or proc.pid in seeded_pids:
                continue
            if record.ppid is not None and record.ppid in live_prior_processes:
                continue
            queue.append((proc, 0, None))
            seeded_pids.add(proc.pid)

        if not queue:
            return []

        result: list[TaskProcessRecord] = []
        seen_pids: set[int] = set()

        while queue:
            proc, depth, parent_pid = queue.popleft()
            if proc.pid in seen_pids:
                continue
            try:
                with proc.oneshot():
                    create_time = proc.create_time()
                    command_parts = proc.cmdline()
                    command = " ".join(command_parts) or proc.name()
                    previous = prior_processes.get(proc.pid)
                    if previous is not None and not self._create_time_matches(previous.create_time, create_time):
                        previous = None
                    result.append(
                        TaskProcessRecord(
                            task_id=runtime.task_id,
                            pid=proc.pid,
                            create_time=create_time,
                            ppid=parent_pid,
                            depth=depth,
                            user=proc.username(),
                            command=command,
                            is_root=parent_pid is None,
                            first_seen_at=(
                                previous.first_seen_at if previous is not None else seen_at
                            ),
                            last_seen_at=seen_at,
                        )
                    )
                    children: Iterable[psutil.Process] = proc.children(recursive=False)
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue

            seen_pids.add(proc.pid)
            for child in children:
                queue.append((child, depth + 1, proc.pid))

        return result