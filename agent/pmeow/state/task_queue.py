"""Pure in-memory task queue replacing the SQLite store layer.

Maintains three internal collections:
- queued: tasks waiting for GPU resources (sorted by priority, created_at)
- reserved: tasks with GPU allocated but no PID yet (internal only)
- running: tasks with PID actively running

Protocol serialisation (to_snapshot) only exposes queued and running;
reserved tasks appear as queued to external consumers.
"""

from __future__ import annotations

import time
import uuid
from collections import OrderedDict
from typing import Optional

from pmeow.models import (
    PublicTaskStatus,
    ScheduleEvaluation,
    TaskInfo,
    TaskLaunchMode,
    TaskQueueSnapshot,
    TaskRecord,
    TaskSpec,
    TaskStatus,
)


def _sort_key(task: TaskRecord) -> tuple[int, float]:
    """Sort key: lower priority number first, then earlier creation time."""
    return (task.priority, task.created_at)


def _task_to_info(task: TaskRecord) -> TaskInfo:
    """Convert internal TaskRecord to protocol-visible TaskInfo."""
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
        pid=task.pid,
        assigned_gpus=task.assigned_gpus,
        declared_vram_per_gpu=task.declared_vram_per_gpu,
        schedule_history=[
            {
                "timestamp": e.timestamp,
                "result": e.result,
                "gpuSnapshot": e.gpu_snapshot,
                "detail": e.detail,
            }
            for e in task.schedule_history
        ],
    )


class TaskQueue:
    """Pure in-memory task container with priority-ordered queue."""

    def __init__(self) -> None:
        self.queued: OrderedDict[str, TaskRecord] = OrderedDict()
        self.reserved: dict[str, TaskRecord] = {}
        self.running: dict[str, TaskRecord] = {}

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
            created_at=time.time(),
            argv=spec.argv,
            env_overrides=spec.env_overrides,
        )
        self.queued[task.id] = task
        self._reorder_queued()
        return task

    # ------------------------------------------------------------------
    # State transitions
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

    def remove(self, task_id: str) -> Optional[TaskRecord]:
        """Remove task from any internal collection (task ended/lost)."""
        for collection in (self.running, self.reserved, self.queued):
            task = collection.pop(task_id, None)
            if task is not None:
                return task
        return None

    # ------------------------------------------------------------------
    # Cancel
    # ------------------------------------------------------------------

    def cancel(self, task_id: str) -> Optional[TaskRecord]:
        """Cancel and remove a task. Returns the task if found."""
        return self.remove(task_id)

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
        )

    # ------------------------------------------------------------------
    # Serialisation
    # ------------------------------------------------------------------

    def to_snapshot(self) -> TaskQueueSnapshot:
        """Build protocol-visible snapshot (reserved mapped to queued)."""
        queued_infos: list[TaskInfo] = []
        running_infos: list[TaskInfo] = []

        # Queued tasks
        for task in self.queued.values():
            queued_infos.append(_task_to_info(task))

        # Reserved tasks appear as queued externally
        for task in self.reserved.values():
            queued_infos.append(_task_to_info(task))

        # Running tasks
        for task in self.running.values():
            running_infos.append(_task_to_info(task))

        return TaskQueueSnapshot(queued=queued_infos, running=running_infos)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _reorder_queued(self) -> None:
        """Re-sort the queued OrderedDict by (priority, created_at)."""
        items = sorted(self.queued.items(), key=lambda kv: _sort_key(kv[1]))
        self.queued.clear()
        for k, v in items:
            self.queued[k] = v
