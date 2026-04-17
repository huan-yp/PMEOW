"""DaemonService — wires together collection, scheduling, and execution.

Pure in-memory version: uses TaskQueue instead of SQLite for task state.
"""

from __future__ import annotations

import logging
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
    TaskLaunchMode,
    TaskRecord,
    TaskSpec,
    TaskStatus,
)
from pmeow.queue.history import GpuHistoryTracker
from pmeow.queue.scheduler import QueueScheduler, validate_request_possible
from pmeow.reporter import Reporter
from pmeow.state.task_queue import TaskQueue
from pmeow.transport.client import AgentTransportClient

log = logging.getLogger(__name__)


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

        srv = SocketServer(self.config.socket_path, self)
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
        log.info(
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

            # Reap completed tasks via runner
            for task_id, exit_code in self.runner.check_completed():
                task = self.task_queue.get(task_id)
                if task is None:
                    continue
                self.task_queue.remove(task_id)
                log.info("task %s finished (exit=%d)", task_id, exit_code)

            # Schedule queued tasks
            queued_tasks = self.task_queue.list_queued()
            if queued_tasks:
                schedule_result = self.scheduler.try_schedule(queued_tasks, per_gpu)
                decisions = schedule_result.decisions

                for dec in decisions:
                    task = self.task_queue.get(dec.task_id)
                    if task is None:
                        continue

                    if task.launch_mode == TaskLaunchMode.attached_python:
                        # Reserve GPUs for attached launch
                        attach_deadline = time.time() + self.config.attach_timeout
                        self.task_queue.reserve(
                            task.id, dec.gpu_ids,
                            attach_deadline=attach_deadline,
                        )
                        log.info(
                            "reserved attached launch %s (gpus=%s)",
                            task.id, dec.gpu_ids,
                        )
                        continue

                    # Daemon-shell launch
                    self.task_queue.reserve(task.id, dec.gpu_ids)
                    proc = self.runner.start(task, dec.gpu_ids, self.config.log_dir)
                    self.task_queue.start(task.id, proc.pid)
                    log.info(
                        "started task %s (pid=%d, gpus=%s)",
                        task.id, proc.pid, dec.gpu_ids,
                    )

            # Build and send unified report
            task_snapshot = self.task_queue.to_snapshot()
            report = self.reporter.build(snapshot.resource_snapshot, task_snapshot)

        if self.transport:
            d = report.to_dict()
            log.info(
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
            ensure_task_log(rec.id, self.config.log_dir)
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
            if task.status == TaskStatus.running:
                self.runner.cancel(task_id)
            self.task_queue.remove(task_id)
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
        return read_task_log(task_id, self.config.log_dir)

    def set_task_priority(self, task_id: str, priority: int) -> bool:
        with self._lock:
            old_task = self.task_queue.get(task_id)
            if old_task is None:
                return False
            if not self.task_queue.set_priority(task_id, priority):
                return False
            log.info("task %s priority updated: %d -> %d", task_id, old_task.priority, priority)
            return True

    def confirm_attached_launch(self, task_id: str, pid: int) -> bool:
        with self._lock:
            task = self.task_queue.get(task_id)
            if task is None or task.status != TaskStatus.reserved:
                return False
            self.task_queue.start(task_id, pid)
            log.info("confirmed attached launch %s (pid=%d)", task_id, pid)
            return True

    def finish_attached_task(self, task_id: str, exit_code: int) -> bool:
        with self._lock:
            task = self.task_queue.get(task_id)
            if task is None or task.launch_mode != TaskLaunchMode.attached_python:
                return False
            self.task_queue.remove(task_id)
            log.info("attached task %s finished (exit=%d)", task_id, exit_code)
            return True
