"""Pure in-memory task queue with full lifecycle state machine.

Maintains four internal collections:
- queued: tasks waiting for GPU resources (sorted by priority, created_at)
- reserved: tasks with GPU allocated but no PID yet (internal only)
- running: tasks with PID actively running
- terminal: tasks that reached a terminal state and await report + reclaim

External components (executor, runtime monitor) submit observations into
a thread-safe buffer.  The single ``tick()`` method consumes those
observations and drives all state transitions, making TaskQueue the sole
state-machine authority.

Protocol serialisation (``to_snapshot``) exposes queued, running, and
recentlyEnded; reserved tasks appear as queued to external consumers.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from typing import Optional

from pmeow.models import (
    PublicTaskStatus,
    ScheduleEvaluation,
    TaskEndReason,
    TaskInfo,
    TaskLaunchMode,
    TaskQueueSnapshot,
    TaskRecord,
    TaskSpec,
    TaskStatus,
)

log = logging.getLogger(__name__)

# Maximum number of terminal tasks kept before force-reclaim
_MAX_TERMINAL = 64


# ------------------------------------------------------------------
# Observations — produced by executor / runtime monitor
# ------------------------------------------------------------------

@dataclass
class CompletionObservation:
    """Executor observed a subprocess exit."""
    task_id: str
    exit_code: int
    timestamp: float


@dataclass
class RuntimeObservation:
    """Runtime monitor observed a process-level anomaly."""
    task_id: str
    reason: TaskEndReason  # pid_disappeared | attach_timeout | running_no_pid
    timestamp: float


def _sort_key(task: TaskRecord) -> tuple[int, float]:
    """Sort key: lower priority number first, then earlier creation time."""
    return (task.priority, task.created_at)


def _task_to_info(task: TaskRecord) -> TaskInfo:
    """Convert internal TaskRecord to protocol-visible TaskInfo."""
    schedule_history = sorted(
        task.schedule_history,
        key=lambda entry: entry.timestamp,
        reverse=True,
    )
    return TaskInfo(
        task_id=task.id,
        status=task.public_status.value,
        command=task.command,
        cwd=task.cwd,
        user=task.user,
        launch_mode=task.launch_mode.value,
        require_vram_mb=task.require_vram_mb,
        require_gpu_count=task.require_gpu_count,
        gpu_ids=task.gpu_ids,
        priority=task.priority,
        created_at=task.created_at,
        started_at=task.started_at,
        finished_at=task.finished_at,
        pid=task.pid,
        exit_code=task.exit_code,
        end_reason=task.end_reason.value if task.end_reason else None,
        assigned_gpus=task.assigned_gpus,
        declared_vram_per_gpu=task.declared_vram_per_gpu,
        schedule_history=[
            {
                "timestamp": e.timestamp,
                "result": e.result,
                "gpuSnapshot": e.gpu_snapshot,
                "detail": e.detail,
            }
            for e in schedule_history
        ],
    )


class TaskQueue:
    """Pure in-memory task container with full lifecycle state machine."""

    def __init__(self) -> None:
        self.queued: OrderedDict[str, TaskRecord] = OrderedDict()
        self.reserved: dict[str, TaskRecord] = {}
        self.running: dict[str, TaskRecord] = {}
        self.terminal: dict[str, TaskRecord] = {}

        # Observation buffers — written by external threads, consumed by tick()
        self._completion_observations: list[CompletionObservation] = []
        self._runtime_observations: list[RuntimeObservation] = []

    # ------------------------------------------------------------------
    # Observation intake (thread-safe when caller holds the daemon lock)
    # ------------------------------------------------------------------

    def push_completion(self, obs: CompletionObservation) -> None:
        """Buffer a completion observation from the executor."""
        self._completion_observations.append(obs)

    def push_runtime(self, obs: RuntimeObservation) -> None:
        """Buffer a runtime observation from the monitor."""
        self._runtime_observations.append(obs)

    # ------------------------------------------------------------------
    # Tick — sole state-machine driver
    # ------------------------------------------------------------------

    def tick(self) -> list[str]:
        """Consume buffered observations, advance terminal states, reclaim.

        Returns IDs of tasks that transitioned to terminal in this tick.
        """
        newly_terminal: list[str] = []

        # 1. Process completion observations (executor saw subprocess exit)
        for obs in self._completion_observations:
            task = self.running.get(obs.task_id)
            if task is None:
                continue
            if obs.exit_code == 0:
                self._transition_to_terminal(
                    task, TaskStatus.succeeded, TaskEndReason.exit_zero, obs.timestamp,
                    exit_code=obs.exit_code,
                )
            else:
                self._transition_to_terminal(
                    task, TaskStatus.failed, TaskEndReason.exit_nonzero, obs.timestamp,
                    exit_code=obs.exit_code,
                )
            newly_terminal.append(task.id)
        self._completion_observations.clear()

        # 2. Process runtime observations (monitor saw anomaly)
        for obs in self._runtime_observations:
            task = (
                self.running.get(obs.task_id)
                or self.reserved.get(obs.task_id)
            )
            if task is None:
                continue
            # Skip if already terminal (completion may have won the race)
            if task.status.is_terminal:
                continue
            self._transition_to_terminal(
                task, TaskStatus.abnormal, obs.reason, obs.timestamp,
            )
            newly_terminal.append(task.id)
        self._runtime_observations.clear()

        # 3. Reclaim — remove terminal tasks that have been reported at least once
        for task_id in list(self.terminal):
            task = self.terminal[task_id]
            if task.reported_since_terminal:
                del self.terminal[task_id]

        # 4. Cap terminal size to prevent unbounded growth
        while len(self.terminal) > _MAX_TERMINAL:
            oldest_id = next(iter(self.terminal))
            del self.terminal[oldest_id]

        return newly_terminal

    # ------------------------------------------------------------------
    # Submit
    # ------------------------------------------------------------------

    def submit(self, spec: TaskSpec) -> TaskRecord:
        """Create a new task from spec and add to queued."""
        task = TaskRecord(
            id=str(uuid.uuid4()),
            status=TaskStatus.queued,
            command=spec.command,
            cwd=spec.cwd,
            user=spec.user,
            launch_mode=spec.launch_mode,
            require_vram_mb=spec.require_vram_mb,
            require_gpu_count=spec.require_gpu_count,
            gpu_ids=spec.gpu_ids,
            priority=spec.priority,
            task_name=spec.task_name or "",
            created_at=time.time(),
            argv=spec.argv,
            env_overrides=spec.env_overrides,
        )
        self.queued[task.id] = task
        self._reorder_queued()
        return task

    # ------------------------------------------------------------------
    # State transitions (active states only)
    # ------------------------------------------------------------------

    def reserve(
        self,
        task_id: str,
        gpu_ids: list[int],
        *,
        attach_deadline: Optional[float] = None,
    ) -> TaskRecord:
        """Move task from queued to reserved (GPU allocated, no PID yet)."""
        task = self.queued.pop(task_id)
        task.status = TaskStatus.reserved
        task.assigned_gpus = gpu_ids
        task.reserved_at = time.time()
        task.attach_deadline = attach_deadline
        if task.require_vram_mb > 0:
            task.declared_vram_per_gpu = task.require_vram_mb
        else:
            task.declared_vram_per_gpu = 0
        self.reserved[task_id] = task
        return task

    def start(self, task_id: str, pid: int) -> TaskRecord:
        """Move task from reserved to running (PID acquired)."""
        task = self.reserved.pop(task_id)
        task.status = TaskStatus.running
        task.pid = pid
        task.started_at = time.time()
        try:
            import psutil
            task.pid_create_time = psutil.Process(pid).create_time()
        except Exception:
            task.pid_create_time = None
        self.running[task_id] = task
        return task

    # ------------------------------------------------------------------
    # Cancel — drives task to cancelled terminal state
    # ------------------------------------------------------------------

    def cancel(self, task_id: str) -> Optional[TaskRecord]:
        """Cancel a task and move it to terminal. Returns the task if found."""
        task = self.get(task_id)
        if task is None:
            return None
        self._transition_to_terminal(
            task, TaskStatus.cancelled, TaskEndReason.cancelled, time.time(),
        )
        return task

    # ------------------------------------------------------------------
    # Legacy remove — kept for backward compat but routes through terminal
    # ------------------------------------------------------------------

    def remove(self, task_id: str) -> Optional[TaskRecord]:
        """Remove task from any internal collection."""
        for collection in (self.running, self.reserved, self.queued, self.terminal):
            task = collection.pop(task_id, None)
            if task is not None:
                return task
        return None

    # ------------------------------------------------------------------
    # Priority
    # ------------------------------------------------------------------

    def set_priority(self, task_id: str, priority: int) -> bool:
        """Update priority of a queued task. Returns True if updated."""
        task = self.queued.get(task_id)
        if task is None:
            return False
        task.priority = priority
        self._reorder_queued()
        return True

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    def get(self, task_id: str) -> Optional[TaskRecord]:
        """Find a task by ID across all collections."""
        return (
            self.queued.get(task_id)
            or self.reserved.get(task_id)
            or self.running.get(task_id)
            or self.terminal.get(task_id)
        )

    def list_queued(self) -> list[TaskRecord]:
        """Return queued tasks in priority order."""
        return list(self.queued.values())

    def list_running(self) -> list[TaskRecord]:
        """Return running tasks."""
        return list(self.running.values())

    def list_reserved(self) -> list[TaskRecord]:
        """Return reserved tasks."""
        return list(self.reserved.values())

    def list_all(self) -> list[TaskRecord]:
        """Return all tasks across all collections."""
        return (
            list(self.queued.values())
            + list(self.reserved.values())
            + list(self.running.values())
            + list(self.terminal.values())
        )

    # ------------------------------------------------------------------
    # Serialisation
    # ------------------------------------------------------------------

    def to_snapshot(self) -> TaskQueueSnapshot:
        """Build protocol-visible snapshot.

        reserved → queued; terminal tasks appear in recentlyEnded and
        get their reported_since_terminal flag set so they will be
        reclaimed on the next tick.
        """
        queued_infos: list[TaskInfo] = []
        running_infos: list[TaskInfo] = []
        recently_ended_infos: list[TaskInfo] = []

        for task in self.queued.values():
            queued_infos.append(_task_to_info(task))

        for task in self.reserved.values():
            queued_infos.append(_task_to_info(task))

        for task in self.running.values():
            running_infos.append(_task_to_info(task))

        for task in self.terminal.values():
            recently_ended_infos.append(_task_to_info(task))
            task.reported_since_terminal = True

        return TaskQueueSnapshot(
            queued=queued_infos,
            running=running_infos,
            recently_ended=recently_ended_infos,
        )

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _transition_to_terminal(
        self,
        task: TaskRecord,
        status: TaskStatus,
        reason: TaskEndReason,
        timestamp: float,
        *,
        exit_code: Optional[int] = None,
    ) -> None:
        """Move a task from its current active collection to terminal."""
        # Remove from whichever active collection it lives in
        self.running.pop(task.id, None)
        self.reserved.pop(task.id, None)
        self.queued.pop(task.id, None)

        task.status = status
        task.end_reason = reason
        task.finished_at = timestamp
        task.exit_code = exit_code
        task.reported_since_terminal = False
        self.terminal[task.id] = task

        log.info(
            "task %s → %s (reason=%s, exit_code=%s)",
            task.id, status.value, reason.value, exit_code,
        )

    def _reorder_queued(self) -> None:
        """Re-sort the queued OrderedDict by (priority, created_at)."""
        items = sorted(self.queued.items(), key=lambda kv: _sort_key(kv[1]))
        self.queued.clear()
        for k, v in items:
            self.queued[k] = v
