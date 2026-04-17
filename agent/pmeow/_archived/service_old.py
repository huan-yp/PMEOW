"""DaemonService — wires together collection, scheduling, and execution."""

from __future__ import annotations

import logging
import signal
import socket
import threading
import time
from collections.abc import Sequence
from typing import Iterable

from pmeow import __version__
from pmeow.collector.internet import InternetProbe, load_probe_from_env
from pmeow.collector.local_users import collect_local_users
from pmeow.collector.snapshot import collect_snapshot
from pmeow.config import AgentConfig
from pmeow.daemon.runtime_monitor import RuntimeMonitorLoop
from pmeow.executor.logs import append_task_log_line, ensure_task_log, read_task_log
from pmeow.executor.runner import TaskRunner
from pmeow.models import (
    LocalUserRecord,
    LocalUsersInventory,
    QueueState,
    TaskLaunchMode,
    TaskRecord,
    TaskSpec,
    TaskStatus)
from pmeow.queue.history import GpuHistoryTracker
from pmeow.queue.scheduler import QueueScheduler, validate_request_possible
from pmeow.store.database import close_database, open_database
from pmeow.store.runtime import is_queue_paused, set_queue_paused
from pmeow.store.task_runtime import get_task_runtime
from pmeow.store.tasks import (
    append_task_event,
    attach_runtime,
    cancel_task as db_cancel_task,
    confirm_attached_launch as db_confirm_attached_launch,
    create_task,
    get_task,
    guarded_finalize_task,
    list_task_events,
    list_recent_terminal_tasks,
    list_tasks as db_list_tasks,
    requeue_expired_attached_launches,
    reserve_attached_launch,
    update_task_priority)
from pmeow.task_reporting import (
    format_launch_report,
    format_queue_paused_report,
    format_schedule_block_report,
    format_schedule_block_summary,
    format_submission_report)
from pmeow.transport.client import AgentTransportClient

log = logging.getLogger(__name__)


class DaemonService:
    """Central service that coordinates collection, scheduling, and task execution."""

    def __init__(
        self,
        config: AgentConfig,
        internet_probe: InternetProbe | None = None) -> None:
        self.config = config
        self._lock = threading.Lock()
        self._shutdown = threading.Event()

        self.db = open_database(config.state_dir)
        self.runner = TaskRunner()
        self.runtime_monitor = RuntimeMonitorLoop(
            self.db,
            poll_interval=1.0,
            db_lock=self._lock,
            on_terminal_transition=self._emit_runtime_monitor_terminal_update)
        self.history = GpuHistoryTracker(window_seconds=config.history_window_seconds)
        self.scheduler = QueueScheduler(self.history)
        # The probe carries its own cache state across collection cycles, so
        # it must live on the service (not be recreated per cycle). Tests can
        # inject a fake probe to avoid touching the network.
        self.internet_probe = internet_probe if internet_probe is not None else load_probe_from_env()

        self.transport: AgentTransportClient | None = None
        if config.server_url:
            self.transport = AgentTransportClient(
                server_url=config.server_url,
                agent_id=config.agent_id or socket.gethostname(),
                heartbeat_interval=config.heartbeat_interval)
        self._last_local_users_signature: tuple[tuple[str, int, int, str, str, str], ...] | None = None
        self._last_queue_reason_signatures: dict[str, tuple] = {}
        self._last_per_gpu: list | None = None

    def _serialize_task(self, task: TaskRecord) -> dict:
        """Convert a TaskRecord to a camelCase dict for the web server."""
        return {
            "taskId": task.id,
            "status": task.status.value,
            "command": task.command,
            "cwd": task.cwd,
            "user": task.user,
            "requireVramMB": task.require_vram_mb,
            "requireGpuCount": task.require_gpu_count,
            "gpuIds": task.gpu_ids,
            "priority": task.priority,
            "createdAt": task.created_at,
            "startedAt": task.started_at,
            "finishedAt": task.finished_at,
            "exitCode": task.exit_code,
            "pid": task.pid,
        }

    def get_task_queue(self) -> dict:
        """Return current task queue snapshot for web server pull requests."""
        with self._lock:
            queued = db_list_tasks(self.db, TaskStatus.queued)
            launching = db_list_tasks(self.db, TaskStatus.launching)
            running = db_list_tasks(self.db, TaskStatus.running)
            recent = list_recent_terminal_tasks(self.db, limit=20)
            return {
                "queued": [self._serialize_task(t) for t in queued + launching],
                "running": [self._serialize_task(t) for t in running],
                "recent": [self._serialize_task(t) for t in recent],
            }

    def _emit_runtime_monitor_terminal_update(self, task_id: str) -> None:
        if not self.transport:
            return

        with self._lock:
            task = get_task(self.db, task_id)
            if task is None or task.status not in {
                TaskStatus.completed,
                TaskStatus.failed,
                TaskStatus.cancelled,
            }:
                return
            self.transport.send_task_changed()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Blocking main loop — runs collection cycles until shutdown."""
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)

        from pmeow.daemon.socket_server import SocketServer

        srv = SocketServer(self.config.socket_path, self)
        self.runtime_monitor.recover_after_restart()
        srv_thread = threading.Thread(target=srv.serve_forever, daemon=True)
        srv_thread.start()
        monitor_thread = threading.Thread(target=self.runtime_monitor.run_forever, daemon=True)
        monitor_thread.start()

        if self.transport:
            self._register_transport_commands()
            self.transport.connect()
            self.transport.send_register(
                hostname=socket.gethostname(),
                version=__version__)
            log.info(
                "transport connecting to %s (agent_id=%s)",
                self.config.server_url,
                self.config.agent_id)

        log.info("daemon started (interval=%ds)", self.config.collection_interval)
        try:
            while not self._shutdown.is_set():
                try:
                    self.collect_cycle()
                except Exception:
                    log.exception("collection cycle error")
                self._shutdown.wait(timeout=self.config.collection_interval)
        finally:
            self.runtime_monitor.stop()
            monitor_thread.join(timeout=5)
            if self.transport:
                self.transport.disconnect()
            srv.shutdown()
            close_database(self.db)
            log.info("daemon stopped")

    def stop(self) -> None:
        """Signal the daemon to shut down."""
        self._shutdown.set()

    def _handle_signal(self, signum: int, frame: object) -> None:
        log.info("received signal %d, shutting down", signum)
        self.stop()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _record_task_message(
        self,
        task_id: str,
        event_type: str,
        message: str,
        *,
        details: dict | None = None) -> None:
        """Write *message* to both the task log file and the task_events table."""
        append_task_log_line(task_id, self.config.log_dir, message)
        append_task_event(
            self.db,
            task_id,
            event_type,
            time.time(),
            details if details is not None else {"message": message})

    def _register_transport_commands(self) -> None:
        if not self.transport:
            return

        self.transport.on_command(
            "server:cancelTask",
            lambda data: self.cancel_task(str(data["taskId"])))
        self.transport.on_command(
            "server:pauseQueue",
            lambda _data: self.pause_queue())
        self.transport.on_command(
            "server:resumeQueue",
            lambda _data: self.resume_queue())
        self.transport.on_command(
            "server:setPriority",
            lambda data: self.set_task_priority(str(data["taskId"]), int(data["priority"])))
        self.transport.on_command(
            "server:getTaskEvents",
            lambda data: self.get_task_events(
                str(data["taskId"]),
                after_id=int(data.get("afterId", 0))))
        self.transport.on_command(
            "server:getTaskAuditDetail",
            lambda data: self._handle_get_task_audit_detail(data))
        self.transport.on_command(
            "server:getTaskQueue",
            lambda _data: self.get_task_queue(),
        )

    def _clear_queue_reason(self, task_id: str) -> None:
        self._last_queue_reason_signatures.pop(task_id, None)

    def _queue_reason_signature(
        self,
        reason_code: str,
        current_eligible_gpu_ids: Sequence[int] = (),
        sustained_eligible_gpu_ids: Sequence[int] = (),
        blocker_task_ids: Sequence[str] = ()) -> tuple:
        return (
            reason_code,
            tuple(current_eligible_gpu_ids),
            tuple(sustained_eligible_gpu_ids),
            tuple(blocker_task_ids))

    def _record_queue_waiting(
        self,
        task: TaskRecord,
        *,
        event_type: str,
        signature: tuple,
        daemon_summary: str,
        message: str,
        details: dict) -> None:
        if self._last_queue_reason_signatures.get(task.id) == signature:
            return

        self._last_queue_reason_signatures[task.id] = signature
        self._record_task_message(task.id, event_type, message, details=details)
        log.info("task %s waiting: %s", task.id, daemon_summary)

    # ------------------------------------------------------------------
    # Collection cycle
    # ------------------------------------------------------------------

    def _local_user_signature(
        self, users: Iterable[LocalUserRecord]) -> tuple[tuple[str, int, int, str, str, str], ...]:
        return tuple(
            (user.username, user.uid, user.gid, user.gecos, user.home, user.shell)
            for user in users
        )

    def _send_local_users_if_changed(self, timestamp: float) -> None:
        if not self.transport:
            return

        try:
            users = collect_local_users()
        except Exception:
            log.exception("local user collection failed")
            return

        signature = self._local_user_signature(users)
        if signature == self._last_local_users_signature:
            return

        self._last_local_users_signature = signature
        self.transport.send_local_users(LocalUsersInventory(
            timestamp=timestamp,
            users=users))

    def collect_cycle(self) -> None:
        """Run one collection ⟶ schedule ⟶ launch iteration."""
        snapshot = collect_snapshot(
            server_id=self.config.agent_id or "local",
            task_store=self.db,
            redundancy_coefficient=self.config.vram_redundancy_coefficient,
            internet_probe=self.internet_probe)

        per_gpu = (
            snapshot.gpu_allocation.per_gpu if snapshot.gpu_allocation else []
        )

        with self._lock:
            self._last_per_gpu = per_gpu
            # Record GPU history
            self.history.record(snapshot.timestamp, per_gpu)

            # Requeue expired attached launches
            requeued = requeue_expired_attached_launches(self.db, time.time())
            for task_id in requeued:
                self._clear_queue_reason(task_id)
                self._record_task_message(
                    task_id, "launch_reservation_expired",
                    "launch reservation expired — task requeued")
                log.info("task %s: launch reservation expired, requeued", task_id)

            # Reap completed tasks
            for task_id, exit_code in self.runner.check_completed():
                task = get_task(self.db, task_id)
                if task is None:
                    continue
                finished_at = time.time()
                status = TaskStatus.completed if exit_code == 0 else TaskStatus.failed
                outcome = guarded_finalize_task(
                    self.db, task_id,
                    status=status, finished_at=finished_at, exit_code=exit_code,
                    finalize_source="runner_exit")
                if not outcome.transitioned:
                    continue
                self._clear_queue_reason(task_id)
                log.info("task %s finished (exit=%d)", task_id, exit_code)
                if self.transport:
                    self.transport.send_task_changed()

            queued_tasks = db_list_tasks(self.db, TaskStatus.queued)
            queued_by_id = {task.id: task for task in queued_tasks}

            # Scheduling
            if is_queue_paused(self.db):
                for task in queued_tasks:
                    message = format_queue_paused_report(task, per_gpu)
                    self._record_queue_waiting(
                        task,
                        event_type="queue_paused",
                        signature=self._queue_reason_signature("queue_paused"),
                        daemon_summary="queue paused",
                        message=message,
                        details={
                            "message": message,
                            "reason_code": "queue_paused",
                        })
            else:
                schedule_result = self.scheduler.try_schedule(self.db, per_gpu)
                if isinstance(schedule_result, list):
                    decisions = schedule_result
                    evaluations = []
                else:
                    decisions = schedule_result.decisions
                    evaluations = schedule_result.evaluations

                for evaluation in evaluations:
                    task = queued_by_id.get(evaluation.task_id)
                    if task is None:
                        continue
                    if evaluation.can_run:
                        self._clear_queue_reason(task.id)
                        continue

                    message = format_schedule_block_report(task, evaluation, per_gpu)
                    self._record_queue_waiting(
                        task,
                        event_type="schedule_blocked",
                        signature=self._queue_reason_signature(
                            evaluation.reason_code,
                            evaluation.current_eligible_gpu_ids,
                            evaluation.sustained_eligible_gpu_ids,
                            evaluation.blocker_task_ids),
                        daemon_summary=format_schedule_block_summary(task, evaluation),
                        message=message,
                        details={
                            "message": message,
                            "reason_code": evaluation.reason_code,
                            "current_eligible_gpu_ids": evaluation.current_eligible_gpu_ids,
                            "sustained_eligible_gpu_ids": evaluation.sustained_eligible_gpu_ids,
                            "current_effective_free_mb": evaluation.current_effective_free_mb,
                            "history_min_free_mb": evaluation.history_min_free_mb,
                            "pending_vram_mb": evaluation.pending_vram_mb,
                            "blocker_task_ids": evaluation.blocker_task_ids,
                            "gpu_ledgers": evaluation.gpu_ledgers,
                        })

                for dec in decisions:
                    task = get_task(self.db, dec.task_id)
                    if task is None:
                        continue
                    self._clear_queue_reason(task.id)

                    # Find the matching evaluation for audit snapshot
                    eval_for_task = next(
                        (e for e in evaluations if e.task_id == dec.task_id and e.can_run),
                        None)
                    schedule_details: dict = {
                        "gpu_ids": dec.gpu_ids,
                        "require_vram_mb": task.require_vram_mb,
                        "require_gpu_count": task.require_gpu_count,
                        "priority": task.priority,
                        "launch_mode": task.launch_mode.value,
                    }
                    if eval_for_task is not None:
                        schedule_details["gpu_ledgers"] = eval_for_task.gpu_ledgers
                        schedule_details["blocker_task_ids"] = eval_for_task.blocker_task_ids

                    self._record_task_message(
                        task.id, "schedule_started",
                        f"scheduled on GPUs {dec.gpu_ids}",
                        details=schedule_details)

                    if task.launch_mode == TaskLaunchMode.attached_python:
                        # Reserve GPUs for attached launch instead of spawning
                        launch_deadline = time.time() + 30.0
                        reserve_attached_launch(
                            self.db, task.id, dec.gpu_ids,
                            launch_deadline, time.time())
                        msg = format_launch_report(task, dec.gpu_ids, per_gpu)
                        self._record_task_message(task.id, "launch_reserved", msg)
                        log.info(
                            "reserved attached launch %s (gpus=%s)",
                            task.id, dec.gpu_ids)
                        continue

                    proc = self.runner.start(task, dec.gpu_ids, self.config.log_dir)
                    started_at = time.time()
                    attach_runtime(
                        self.db, task.id, proc.pid, dec.gpu_ids, started_at
                    )
                    self._record_task_message(
                        task.id, "process_started",
                        f"process started (pid={proc.pid}, gpus={dec.gpu_ids})",
                        details={
                            "pid": proc.pid,
                            "gpu_ids": dec.gpu_ids,
                            "launch_mode": task.launch_mode.value,
                        })
                    log.info(
                        "started task %s (pid=%d, gpus=%s)",
                        task.id, proc.pid, dec.gpu_ids)
                    if self.transport:
                        self.transport.send_task_changed()

        if self.transport:
            self._send_local_users_if_changed(snapshot.timestamp)
            self.transport.send_metrics(snapshot)
            log.debug("sent metrics to server")

    # ------------------------------------------------------------------
    # Task management (thread-safe)
    # ------------------------------------------------------------------

    def submit_task(self, spec: TaskSpec) -> TaskRecord:
        with self._lock:
            if self._last_per_gpu:
                err = validate_request_possible(
                    self._last_per_gpu,
                    spec.require_gpu_count,
                    spec.require_vram_mb)
                if err is not None:
                    raise ValueError(err)
            rec = create_task(self.db, spec)
            ensure_task_log(rec.id, self.config.log_dir)
            message = format_submission_report(rec)
            self._record_task_message(
                rec.id, "submitted",
                message,
                details={
                    "message": message,
                    "user": rec.user,
                    "cwd": rec.cwd,
                    "argv": rec.argv,
                    "command": rec.command,
                    "launch_mode": rec.launch_mode.value,
                    "require_vram_mb": rec.require_vram_mb,
                    "require_gpu_count": rec.require_gpu_count,
                    "priority": rec.priority,
                })
            log.info(
                "submitted task %s user=%s mode=%s cwd=%s",
                rec.id,
                rec.user,
                rec.launch_mode.value,
                rec.cwd)
            if self.transport:
                self.transport.send_task_changed()
            return rec

    def cancel_task(self, task_id: str) -> bool:
        with self._lock:
            task = get_task(self.db, task_id)
            if task is None:
                return False
            if task.status == TaskStatus.running:
                self.runner.cancel(task_id)
                outcome = guarded_finalize_task(
                    self.db, task_id,
                    status=TaskStatus.cancelled,
                    finished_at=time.time(),
                    exit_code=None,
                    finalize_source="cancel",
                    finalize_reason_code="explicit_cancel")
                if outcome.transitioned:
                    self._clear_queue_reason(task_id)
                    if self.transport:
                        self.transport.send_task_changed()
                return outcome.transitioned
            if task.status == TaskStatus.queued:
                db_cancel_task(self.db, task_id)
                self._clear_queue_reason(task_id)
                if self.transport:
                    self.transport.send_task_changed()
                return True
            return False

    def list_tasks(self, status: TaskStatus | None = None) -> list[TaskRecord]:
        with self._lock:
            return db_list_tasks(self.db, status)

    def get_task(self, task_id: str) -> TaskRecord | None:
        with self._lock:
            return get_task(self.db, task_id)

    def get_logs(self, task_id: str, tail: int = 100) -> str:
        return read_task_log(task_id, self.config.log_dir)

    def pause_queue(self) -> None:
        with self._lock:
            set_queue_paused(self.db, True)

    def resume_queue(self) -> None:
        with self._lock:
            set_queue_paused(self.db, False)

    def get_queue_state(self) -> QueueState:
        with self._lock:
            tasks = db_list_tasks(self.db)
            counts: dict[str, int] = {s.value: 0 for s in TaskStatus}
            for t in tasks:
                counts[t.status.value] += 1
            return QueueState(
                paused=is_queue_paused(self.db),
                queued=counts["queued"],
                running=counts["running"],
                completed=counts["completed"],
                failed=counts["failed"],
                cancelled=counts["cancelled"])

    def get_task_events(self, task_id: str, after_id: int = 0) -> list[dict]:
        with self._lock:
            return list_task_events(self.db, task_id, after_id=after_id)

    def get_task_audit_detail(self, task_id: str) -> tuple | None:
        """Return (task, events, runtime) for the audit detail command.

        Returns None if the task doesn't exist.
        """
        with self._lock:
            task = get_task(self.db, task_id)
            if task is None:
                return None
            events = list_task_events(self.db, task_id)
            runtime = get_task_runtime(self.db, task_id)
            return task, events, runtime

    def _handle_get_task_audit_detail(self, data: dict) -> dict | None:
        result = self.get_task_audit_detail(str(data["taskId"]))
        if result is None:
            return None
        task, events, runtime = result
        audit: dict = {
            "task": {
                "id": task.id,
                "command": task.command,
                "cwd": task.cwd,
                "user": task.user,
                "require_vram_mb": task.require_vram_mb,
                "require_gpu_count": task.require_gpu_count,
                "priority": task.priority,
                "launch_mode": task.launch_mode.value,
                "status": task.status.value,
                "gpu_ids": task.gpu_ids,
                "created_at": task.created_at,
                "started_at": task.started_at,
                "finished_at": task.finished_at,
                "exit_code": task.exit_code,
                "pid": task.pid,
            },
            "events": events,
        }
        if runtime is not None:
            audit["runtime"] = {
                "launch_mode": runtime.launch_mode.value,
                "root_pid": runtime.root_pid,
                "root_created_at": runtime.root_created_at,
                "runtime_phase": runtime.runtime_phase.value,
                "first_started_at": runtime.first_started_at,
                "last_seen_at": runtime.last_seen_at,
                "finalize_source": runtime.finalize_source,
                "finalize_reason_code": runtime.finalize_reason_code,
                "last_observed_exit_code": runtime.last_observed_exit_code,
            }
        return audit

    def set_task_priority(self, task_id: str, priority: int) -> bool:
        with self._lock:
            task = get_task(self.db, task_id)
            if task is None or task.status != TaskStatus.queued:
                return False
            if not update_task_priority(self.db, task_id, priority):
                return False

            message = f"task priority updated: {task.priority} -> {priority}"
            self._record_task_message(
                task_id,
                "priority_updated",
                message,
                details={
                    "message": message,
                    "old_priority": task.priority,
                    "new_priority": priority,
                })
            log.info("task %s priority updated: %d -> %d", task_id, task.priority, priority)
            return True

    def confirm_attached_launch(self, task_id: str, pid: int) -> bool:
        with self._lock:
            task = get_task(self.db, task_id)
            if task is None or task.status != TaskStatus.launching:
                return False
            db_confirm_attached_launch(self.db, task_id, pid=pid, started_at=time.time())
            self._clear_queue_reason(task_id)
            self._record_task_message(
                task_id, "process_started",
                f"attached process started pid={pid}",
                details={
                    "pid": pid,
                    "gpu_ids": task.gpu_ids,
                    "launch_mode": task.launch_mode.value,
                })
            if self.transport:
                started_at = time.time()
                self.transport.send_task_changed()
            return True

    def finish_attached_task(self, task_id: str, exit_code: int) -> bool:
        with self._lock:
            task = get_task(self.db, task_id)
            if task is None or task.launch_mode != TaskLaunchMode.attached_python:
                return False
            finished_at = time.time()
            status = TaskStatus.completed if exit_code == 0 else TaskStatus.failed
            outcome = guarded_finalize_task(
                self.db, task_id,
                status=status, finished_at=finished_at, exit_code=exit_code,
                finalize_source="cli_finish",
                finalize_reason_code="ctrl_c" if exit_code == 130 else None)
            if not outcome.transitioned:
                return False
            self._clear_queue_reason(task_id)
            self._record_task_message(task_id, "attached_finished", f"attached process finished exit_code={exit_code}")
            if self.transport:
                self.transport.send_task_changed()
            return True
