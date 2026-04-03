"""DaemonService — wires together collection, scheduling, and execution."""

from __future__ import annotations

import logging
import signal
import socket
import threading
import time

from pmeow import __version__
from pmeow.collector.snapshot import collect_snapshot
from pmeow.config import AgentConfig
from pmeow.executor.logs import read_task_log
from pmeow.executor.runner import TaskRunner
from pmeow.models import QueueState, TaskRecord, TaskSpec, TaskStatus, TaskUpdate
from pmeow.queue.history import GpuHistoryTracker
from pmeow.queue.scheduler import QueueScheduler
from pmeow.store.database import close_database, open_database
from pmeow.store.runtime import is_queue_paused, set_queue_paused
from pmeow.store.tasks import (
    attach_runtime,
    cancel_task as db_cancel_task,
    create_task,
    finish_task,
    get_task,
    list_tasks as db_list_tasks,
)
from pmeow.transport.client import AgentTransportClient

log = logging.getLogger(__name__)


class DaemonService:
    """Central service that coordinates collection, scheduling, and task execution."""

    def __init__(self, config: AgentConfig) -> None:
        self.config = config
        self._lock = threading.Lock()
        self._shutdown = threading.Event()

        self.db = open_database(config.state_dir)
        self.runner = TaskRunner()
        self.history = GpuHistoryTracker(window_seconds=config.history_window_seconds)
        self.scheduler = QueueScheduler(self.history)

        self.transport: AgentTransportClient | None = None
        if config.server_url:
            self.transport = AgentTransportClient(
                server_url=config.server_url,
                agent_id=config.agent_id or socket.gethostname(),
                heartbeat_interval=config.heartbeat_interval,
            )

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

        if self.transport:
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
    # Collection cycle
    # ------------------------------------------------------------------

    def collect_cycle(self) -> None:
        """Run one collection ⟶ schedule ⟶ launch iteration."""
        snapshot = collect_snapshot(
            server_id=self.config.agent_id or "local",
            task_store=self.db,
            redundancy_coefficient=self.config.vram_redundancy_coefficient,
        )

        per_gpu = (
            snapshot.gpu_allocation.per_gpu if snapshot.gpu_allocation else []
        )

        with self._lock:
            # Record GPU history
            self.history.record(snapshot.timestamp, per_gpu)

            # Reap completed tasks
            for task_id, exit_code in self.runner.check_completed():
                finished_at = time.time()
                finish_task(self.db, task_id, exit_code, finished_at)
                log.info("task %s finished (exit=%d)", task_id, exit_code)
                if self.transport:
                    self.transport.send_task_update(TaskUpdate(
                        task_id=task_id,
                        status=TaskStatus.completed if exit_code == 0 else TaskStatus.failed,
                        finished_at=finished_at,
                        exit_code=exit_code,
                    ))

            # Scheduling
            if not is_queue_paused(self.db):
                decisions = self.scheduler.try_schedule(self.db, per_gpu)
                for dec in decisions:
                    task = get_task(self.db, dec.task_id)
                    if task is None:
                        continue
                    proc = self.runner.start(task, dec.gpu_ids, self.config.log_dir)
                    started_at = time.time()
                    attach_runtime(
                        self.db, task.id, proc.pid, dec.gpu_ids, started_at
                    )
                    log.info(
                        "started task %s (pid=%d, gpus=%s)",
                        task.id, proc.pid, dec.gpu_ids,
                    )
                    if self.transport:
                        self.transport.send_task_update(TaskUpdate(
                            task_id=task.id,
                            status=TaskStatus.running,
                            started_at=started_at,
                            pid=proc.pid,
                        ))

        if self.transport:
            self.transport.send_metrics(snapshot)
            log.debug("sent metrics to server")

    # ------------------------------------------------------------------
    # Task management (thread-safe)
    # ------------------------------------------------------------------

    def submit_task(self, spec: TaskSpec) -> TaskRecord:
        with self._lock:
            return create_task(self.db, spec)

    def cancel_task(self, task_id: str) -> bool:
        with self._lock:
            task = get_task(self.db, task_id)
            if task is None:
                return False
            if task.status == TaskStatus.running:
                self.runner.cancel(task_id)
            if task.status in (TaskStatus.queued, TaskStatus.running):
                db_cancel_task(self.db, task_id)
                if self.transport:
                    self.transport.send_task_update(TaskUpdate(
                        task_id=task_id,
                        status=TaskStatus.cancelled,
                    ))
                return True
            return False

    def list_tasks(self, status: TaskStatus | None = None) -> list[TaskRecord]:
        with self._lock:
            return db_list_tasks(self.db, status)

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
                cancelled=counts["cancelled"],
            )
