"""DaemonService — wires together collection, scheduling, and execution.

Pure in-memory version: uses TaskQueue instead of SQLite for task state.
"""

from __future__ import annotations

import logging
import os
import pwd
import signal
import socket
import threading
import time

from pmeow import __version__
from pmeow.collector.internet import InternetProbe, load_probe_from_env
from pmeow.collector.snapshot import collect_snapshot
from pmeow.config import AgentConfig
from pmeow.daemon.runtime_monitor import RuntimeMonitorLoop
from pmeow.executor.logs import append_task_log_line, ensure_task_log, read_task_log
from pmeow.executor.runner import TaskRunner
from pmeow.models import (
    ScheduleEvaluation,
    TaskEndReason,
    TaskLaunchMode,
    TaskRecord,
    TaskSpec,
    TaskStatus,
)
from pmeow.queue.history import GpuHistoryTracker
from pmeow.queue.scheduler import QueueScheduler, TaskScheduleEvaluation, validate_request_possible
from pmeow.reporter import Reporter
from pmeow.state.task_queue import CompletionObservation, TaskQueue
from pmeow.transport.client import AgentTransportClient

log = logging.getLogger(__name__)


def _remaining_collection_delay(
    interval_seconds: float,
    cycle_started_monotonic: float,
    now_monotonic: float,
) -> float:
    """Return the remaining delay before the next collection cycle."""
    return max(0.0, interval_seconds - (now_monotonic - cycle_started_monotonic))


class DaemonService:
    """Central service that coordinates collection, scheduling, and task execution."""

    def __init__(
        self,
        config: AgentConfig,
        internet_probe: InternetProbe | None = None,
    ) -> None:
        self.config = config
        self._lock = threading.Lock()
        self._shutdown = threading.Event()

        self.task_queue = TaskQueue()
        self.runner = TaskRunner()
        self._submit_credentials: dict[str, tuple[int | None, int | None]] = {}
        self._task_log_dirs: dict[str, str] = {}
        self.runtime_monitor = RuntimeMonitorLoop(
            self.task_queue,
            poll_interval=1.0,
            lock=self._lock,
        )
        self.history = GpuHistoryTracker(window_seconds=config.history_window_seconds)
        self.scheduler = QueueScheduler(self.history)
        self.internet_probe = internet_probe if internet_probe is not None else load_probe_from_env()

        agent_id = config.agent_id or socket.gethostname()
        self.reporter = Reporter(agent_id)

        self.transport: AgentTransportClient | None = None
        if config.server_url:
            self.transport = AgentTransportClient(
                server_url=config.server_url,
                agent_id=agent_id,
                reconnect_delay=config.ws_reconnect_delay,
                reconnect_delay_max=config.ws_reconnect_delay_max,
                request_timeout=config.ws_request_timeout,
            )
        self._last_per_gpu: list | None = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Blocking main loop — runs collection cycles until shutdown."""
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)

        from pmeow.daemon.socket_server import SocketServer

        srv = SocketServer(self.config.socket_path, self, socket_group=self.config.socket_group)
        srv_thread = threading.Thread(target=srv.serve_forever, daemon=True)
        srv_thread.start()
        monitor_thread = threading.Thread(target=self.runtime_monitor.run_forever, daemon=True)
        monitor_thread.start()

        if self.transport:
            self._register_transport_commands()
            self.transport.connect()
            self.transport.send_register(
                hostname=socket.gethostname(),
                version=__version__,
            )
            log.info(
                "transport connecting to %s (agent_id=%s)",
                self.config.server_url,
                self.config.agent_id,
            )

        log.info("daemon started (interval=%ds)", self.config.collection_interval)
        if self.internet_probe is not None:
            self.internet_probe.refresh_async()

        try:
            while not self._shutdown.is_set():
                cycle_started = time.monotonic()
                try:
                    self.collect_cycle()
                except Exception:
                    log.exception("collection cycle error")
                delay = _remaining_collection_delay(
                    self.config.collection_interval,
                    cycle_started,
                    time.monotonic(),
                )
                if self._shutdown.wait(timeout=delay):
                    break
        finally:
            self.runtime_monitor.stop()
            monitor_thread.join(timeout=5)
            if self.internet_probe is not None:
                self.internet_probe.stop()
            if self.transport:
                self.transport.disconnect()
            srv.shutdown()
            log.info("daemon stopped")

    def stop(self) -> None:
        """Signal the daemon to shut down."""
        self._shutdown.set()

    def _handle_signal(self, signum: int, frame: object) -> None:
        log.info("received signal %d, shutting down", signum)
        self.stop()

    # ------------------------------------------------------------------
    # Transport command registration
    # ------------------------------------------------------------------

    def _register_transport_commands(self) -> None:
        if not self.transport:
            return

        self.transport.on_command(
            "server:cancelTask",
            lambda data: self.cancel_task(str(data["taskId"])),
        )
        self.transport.on_command(
            "server:setPriority",
            lambda data: self.set_task_priority(str(data["taskId"]), int(data["priority"])),
        )

    # ------------------------------------------------------------------
    # Collection cycle
    # ------------------------------------------------------------------

    def collect_cycle(self) -> None:
        """Run one collection → schedule → launch → report iteration."""
        t0 = time.time()
        snapshot = collect_snapshot(
            server_id=self.config.agent_id or "local",
            task_queue=self.task_queue,
            redundancy_coefficient=self.config.vram_redundancy_coefficient,
            internet_probe=self.internet_probe,
        )
        collect_ms = (time.time() - t0) * 1000
        log.debug(
            "collected snapshot: cpu=%.1f%% mem=%.0f/%dMB gpus=%d procs=%d (%.0fms)",
            snapshot.resource_snapshot.cpu.usage_percent if snapshot.resource_snapshot.cpu else 0,
            snapshot.resource_snapshot.memory.used_mb if snapshot.resource_snapshot.memory else 0,
            snapshot.resource_snapshot.memory.total_mb if snapshot.resource_snapshot.memory else 0,
            len(snapshot.resource_snapshot.gpu_cards),
            len(snapshot.resource_snapshot.processes),
            collect_ms,
        )

        per_gpu = snapshot.per_gpu

        with self._lock:
            self._last_per_gpu = per_gpu
            # Record GPU history
            self.history.record(snapshot.timestamp, per_gpu)

            # Push completion observations from runner
            now = time.time()
            for task_id, exit_code in self.runner.check_completed():
                self._submit_credentials.pop(task_id, None)
                self.task_queue.push_completion(CompletionObservation(
                    task_id=task_id,
                    exit_code=exit_code,
                    timestamp=now,
                ))
                self._append_task_message(
                    task_id,
                    self._format_finished_message(task_id, exit_code),
                )

            # Tick the state machine — consumes observations, reclaims reported terminals
            self.task_queue.tick()
            live_task_ids = {task.id for task in self.task_queue.list_all()}
            for task_id in list(self._task_log_dirs):
                if task_id not in live_task_ids:
                    self._task_log_dirs.pop(task_id, None)

            # Schedule queued tasks
            queued_tasks = self.task_queue.list_queued()
            if queued_tasks:
                schedule_result = self.scheduler.try_schedule(queued_tasks, per_gpu)
                evaluation_map = {
                    evaluation.task_id: evaluation
                    for evaluation in schedule_result.evaluations
                }

                for task in queued_tasks:
                    evaluation = evaluation_map.get(task.id)
                    if evaluation is None:
                        continue
                    self._record_schedule_evaluation(task, evaluation)

                decisions = schedule_result.decisions

                for dec in decisions:
                    task = self.task_queue.get(dec.task_id)
                    if task is None:
                        continue

                    if task.launch_mode == TaskLaunchMode.foreground:
                        # Reserve GPUs for foreground launch
                        attach_deadline = time.time() + self.config.attach_timeout
                        self.task_queue.reserve(
                            task.id, dec.gpu_ids,
                            attach_deadline=attach_deadline,
                        )
                        self._append_task_message(
                            task.id,
                            self._format_launch_reserved_message(dec.gpu_ids),
                        )
                        log.info(
                            "reserved foreground launch %s (gpus=%s)",
                            task.id, dec.gpu_ids,
                        )
                        continue

                    # Daemon-shell launch
                    self.task_queue.reserve(task.id, dec.gpu_ids)
                    self._append_task_message(
                        task.id,
                        self._format_launch_reserved_message(dec.gpu_ids),
                    )
                    cred = self._submit_credentials.get(task.id, (None, None))
                    proc = self.runner.start(
                        task, dec.gpu_ids, self.get_task_log_dir(task.id),
                        submit_uid=cred[0], submit_gid=cred[1],
                    )
                    self.task_queue.start(task.id, proc.pid)
                    self._append_task_message(
                        task.id,
                        self._format_started_message(task.id, proc.pid),
                    )
                    log.info(
                        "started task %s (pid=%d, gpus=%s)",
                        task.id, proc.pid, dec.gpu_ids,
                    )

            # Build and send unified report
            task_snapshot = self.task_queue.to_snapshot()
            report = self.reporter.build(snapshot.resource_snapshot, task_snapshot)

        if self.transport:
            d = report.to_dict()
            log.debug(
                "sending report seq=%d ts=%.1f tasks=%d+%d keys=%s",
                report.seq,
                report.timestamp,
                len(report.task_queue.queued),
                len(report.task_queue.running),
                list(d.get("resourceSnapshot", {}).keys()),
            )
            self.transport.send_report(report)

    # ------------------------------------------------------------------
    # Task management (thread-safe)
    # ------------------------------------------------------------------

    def submit_task(self, spec: TaskSpec) -> TaskRecord:
        with self._lock:
            if self._last_per_gpu:
                err = validate_request_possible(
                    self._last_per_gpu,
                    spec.require_gpu_count,
                    spec.require_vram_mb,
                )
                if err is not None:
                    raise ValueError(err)
            rec = self.task_queue.submit(spec)
            rec.task_log_dir = self._resolve_task_log_dir(spec.submit_uid)
            self._submit_credentials[rec.id] = (spec.submit_uid, spec.submit_gid)
            self._task_log_dirs[rec.id] = rec.task_log_dir
            log_path = ensure_task_log(rec.id, rec.task_log_dir)
            self._handover_task_log_ownership(
                log_path,
                log_dir=rec.task_log_dir,
                submit_uid=spec.submit_uid,
                submit_gid=spec.submit_gid,
            )
            self._append_task_message(rec.id, self._format_submitted_message(rec))
            log.info(
                "submitted task %s user=%s mode=%s cwd=%s",
                rec.id, rec.user, rec.launch_mode.value, rec.cwd,
            )
            return rec

    def cancel_task(self, task_id: str) -> bool:
        with self._lock:
            task = self.task_queue.get(task_id)
            if task is None:
                return False
            self._submit_credentials.pop(task_id, None)
            if task.status == TaskStatus.running:
                self.runner.cancel(task_id)
            self.task_queue.cancel(task_id)
            log.info("cancelled task %s", task_id)
            return True

    def list_tasks(self, status: TaskStatus | None = None) -> list[TaskRecord]:
        with self._lock:
            if status is None:
                return self.task_queue.list_all()
            if status == TaskStatus.queued:
                return self.task_queue.list_queued()
            if status == TaskStatus.reserved:
                return self.task_queue.list_reserved()
            if status == TaskStatus.running:
                return self.task_queue.list_running()
            return []

    def get_task(self, task_id: str) -> TaskRecord | None:
        with self._lock:
            return self.task_queue.get(task_id)

    def get_logs(self, task_id: str, tail: int = 100) -> str:
        try:
            return read_task_log(task_id, self.get_task_log_dir(task_id), tail=tail)
        except FileNotFoundError as exc:
            raise FileNotFoundError(f"log file not found for task {task_id}") from exc

    def get_task_log_dir(self, task_id: str) -> str:
        task = self.task_queue.get(task_id)
        if task is not None and task.task_log_dir:
            return task.task_log_dir
        return self._task_log_dirs.get(task_id, self.config.log_dir)

    def get_task_log_path(self, task_id: str) -> str:
        from pmeow.executor.logs import get_task_log_path

        return get_task_log_path(task_id, self.get_task_log_dir(task_id))

    def set_task_priority(self, task_id: str, priority: int) -> bool:
        with self._lock:
            old_task = self.task_queue.get(task_id)
            if old_task is None:
                return False
            if not self.task_queue.set_priority(task_id, priority):
                return False
            log.info("task %s priority updated: %d -> %d", task_id, old_task.priority, priority)
            return True

    def confirm_foreground_launch(self, task_id: str, pid: int) -> bool:
        with self._lock:
            task = self.task_queue.get(task_id)
            if task is None or task.status != TaskStatus.reserved:
                return False
            self.task_queue.start(task_id, pid)
            self._append_task_message(task_id, self._format_started_message(task_id, pid))
            log.info("confirmed foreground launch %s (pid=%d)", task_id, pid)
            return True

    def finish_foreground_task(self, task_id: str, exit_code: int) -> bool:
        with self._lock:
            task = self.task_queue.get(task_id)
            if task is None or task.launch_mode != TaskLaunchMode.foreground:
                return False
            self._append_task_message(task_id, self._format_finished_message(task_id, exit_code))
            self.task_queue.push_completion(CompletionObservation(
                task_id=task_id,
                exit_code=exit_code,
                timestamp=time.time(),
            ))
            self.task_queue.tick()
            log.info("foreground task %s finished (exit=%d)", task_id, exit_code)
            return True

    # ------------------------------------------------------------------
    # Task diagnostics
    # ------------------------------------------------------------------

    def _append_task_message(self, task_id: str, message: str) -> None:
        append_task_log_line(task_id, self.get_task_log_dir(task_id), message)

    def _resolve_task_log_dir(self, submit_uid: int | None) -> str:
        if os.getuid() != 0 or submit_uid is None or submit_uid == 0:
            return self.config.log_dir
        try:
            home_dir = pwd.getpwuid(submit_uid).pw_dir
        except KeyError:
            log.warning("submit_uid=%d has no passwd entry, falling back to daemon log dir", submit_uid)
            return self.config.log_dir
        return os.path.join(home_dir, ".pmeow", "logs")

    def _handover_task_log_ownership(
        self,
        log_path: str,
        *,
        log_dir: str,
        submit_uid: int | None,
        submit_gid: int | None,
    ) -> None:
        if os.getuid() != 0 or submit_uid is None or submit_uid == 0:
            return

        target_gid = submit_gid if submit_gid is not None else -1
        home_pmeow_dir = os.path.dirname(log_dir)
        for path in (home_pmeow_dir, log_dir, log_path):
            try:
                os.chown(path, submit_uid, target_gid)
            except OSError:
                log.exception("failed to hand over task log path %s", path)

    def _record_schedule_evaluation(
        self,
        task: TaskRecord,
        evaluation: TaskScheduleEvaluation,
    ) -> None:
        entry = ScheduleEvaluation(
            timestamp=time.time(),
            result=self._map_schedule_result(evaluation.reason_code),
            gpu_snapshot=self._build_schedule_gpu_snapshot(task, evaluation),
            detail=self._format_schedule_detail(task, evaluation),
        )
        task.schedule_history.append(entry)
        self._append_task_message(task.id, f"schedule {entry.result}: {entry.detail}")

    def _map_schedule_result(self, reason_code: str) -> str:
        return {
            "scheduled": "scheduled",
            "blocked_by_higher_priority": "blocked_by_priority",
            "insufficient_gpu_count": "insufficient_gpu",
            "sustained_window_not_satisfied": "sustained_window_not_met",
        }.get(reason_code, "insufficient_gpu")

    def _build_schedule_gpu_snapshot(
        self,
        task: TaskRecord,
        evaluation: TaskScheduleEvaluation,
    ) -> dict[str, float | int]:
        snapshot: dict[str, float | int] = {
            "requestedGpuCount": task.require_gpu_count,
            "requestedVramMb": task.require_vram_mb,
            "eligibleNowCount": len(evaluation.current_eligible_gpu_ids),
            "eligibleSustainedCount": len(evaluation.sustained_eligible_gpu_ids),
            "selectedGpuCount": len(evaluation.gpu_ids),
            "blockerCount": len(evaluation.blocker_task_ids),
        }
        for gpu_id, free_mb in evaluation.current_effective_free_mb.items():
            snapshot[f"effectiveFreeMb.gpu{gpu_id}"] = round(free_mb, 2)
        for gpu_id, pending_mb in evaluation.pending_vram_mb.items():
            snapshot[f"pendingVramMb.gpu{gpu_id}"] = round(pending_mb, 2)
        return snapshot

    def _format_schedule_detail(
        self,
        task: TaskRecord,
        evaluation: TaskScheduleEvaluation,
    ) -> str:
        selected = self._format_gpu_ids(evaluation.gpu_ids)
        eligible_now = self._format_gpu_ids(evaluation.current_eligible_gpu_ids)
        sustained = self._format_gpu_ids(evaluation.sustained_eligible_gpu_ids)
        effective_free = self._format_effective_free(evaluation.current_effective_free_mb)

        if evaluation.reason_code == "scheduled":
            return (
                f"need {task.require_gpu_count} GPU(s) with >= {task.require_vram_mb} MB; "
                f"selected={selected}; eligible_now={eligible_now}; effective_free={effective_free}"
            )
        if evaluation.reason_code == "blocked_by_higher_priority":
            blockers = ",".join(evaluation.blocker_task_ids) or "none"
            return (
                f"blocked by higher-priority reservations; need {task.require_gpu_count} GPU(s) with >= "
                f"{task.require_vram_mb} MB; blockers={blockers}; eligible_now={eligible_now}; "
                f"effective_free={effective_free}"
            )
        if evaluation.reason_code == "sustained_window_not_satisfied":
            return (
                f"sustained availability window not satisfied; need {task.require_gpu_count} GPU(s) with >= "
                f"{task.require_vram_mb} MB; eligible_now={eligible_now}; sustained_common={sustained}; "
                f"effective_free={effective_free}"
            )
        return (
            f"not enough eligible GPUs; need {task.require_gpu_count} GPU(s) with >= {task.require_vram_mb} MB; "
            f"eligible_now={eligible_now}; sustained_common={sustained}; effective_free={effective_free}"
        )

    def _format_submitted_message(self, task: TaskRecord) -> str:
        return (
            f"submitted task {task.id} mode={task.launch_mode.value} user={task.user} cwd={task.cwd}; "
            f"need {task.require_gpu_count} GPU(s) with >= {task.require_vram_mb} MB"
        )

    def _format_launch_reserved_message(self, gpu_ids: list[int]) -> str:
        return f"launch reserved: selected {self._format_gpu_ids(gpu_ids)}"

    def _format_started_message(self, task_id: str, pid: int) -> str:
        return f"task started: pid={pid} task_id={task_id}"

    def _format_finished_message(self, task_id: str, exit_code: int) -> str:
        return f"task finished: exit_code={exit_code} task_id={task_id}"

    def _format_gpu_ids(self, gpu_ids: list[int]) -> str:
        return ",".join(str(gpu_id) for gpu_id in gpu_ids) or "none"

    def _format_effective_free(self, current_effective_free_mb: dict[int, float]) -> str:
        if not current_effective_free_mb:
            return "none"
        return ", ".join(
            f"gpu{gpu_id}={round(free_mb, 2)}MB"
            for gpu_id, free_mb in sorted(current_effective_free_mb.items())
        )
