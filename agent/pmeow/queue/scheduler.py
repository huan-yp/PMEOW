"""Priority-based queue scheduler with dual-ledger GPU admission.

Managed task reservations are authoritative (declared VRAM, not observed).
Unmanaged activity is judged by historical peak within the sliding window.
Tasks with require_vram_mb == 0 are exclusive and require fully idle GPUs.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field

from pmeow.models import PerGpuAllocationSummary
from pmeow.queue.history import GpuHistoryTracker
from pmeow.store.tasks import list_queued_tasks

# ---------------------------------------------------------------------------
# Scheduling constants — single definition block for future promotion
# ---------------------------------------------------------------------------

CAPACITY_FACTOR = 0.98
UNMANAGED_MULTIPLIER = 1.05
IDLE_UTILIZATION_THRESHOLD = 3.0  # %
IDLE_VRAM_UTILIZATION_THRESHOLD = 3.0  # %


# ---------------------------------------------------------------------------
# Per-GPU dual-ledger summary
# ---------------------------------------------------------------------------

@dataclass
class GpuLedger:
    gpu_index: int
    total_vram_mb: float
    schedulable_mb: float
    managed_reserved_mb: float
    exclusive_owner: bool
    unmanaged_peak_mb: float
    utilization_percent: float
    vram_utilization_percent: float
    effective_free_mb: float

    def to_snapshot_dict(self) -> dict:
        return {
            "gpu_index": self.gpu_index,
            "total_vram_mb": self.total_vram_mb,
            "schedulable_mb": self.schedulable_mb,
            "managed_reserved_mb": self.managed_reserved_mb,
            "exclusive_owner": self.exclusive_owner,
            "unmanaged_peak_mb": self.unmanaged_peak_mb,
            "utilization_percent": self.utilization_percent,
            "vram_utilization_percent": self.vram_utilization_percent,
            "effective_free_mb": self.effective_free_mb,
        }


# ---------------------------------------------------------------------------
# Scheduler result types
# ---------------------------------------------------------------------------

@dataclass
class ScheduleDecision:
    task_id: str
    gpu_ids: list[int]


@dataclass
class TaskScheduleEvaluation:
    task_id: str
    can_run: bool
    reason_code: str
    gpu_ids: list[int] = field(default_factory=list)
    current_eligible_gpu_ids: list[int] = field(default_factory=list)
    sustained_eligible_gpu_ids: list[int] = field(default_factory=list)
    current_effective_free_mb: dict[int, float] = field(default_factory=dict)
    history_min_free_mb: dict[int, float] = field(default_factory=dict)
    pending_vram_mb: dict[int, float] = field(default_factory=dict)
    blocker_task_ids: list[str] = field(default_factory=list)
    gpu_ledgers: list[dict] = field(default_factory=list)


@dataclass
class ScheduleBatchResult:
    decisions: list[ScheduleDecision] = field(default_factory=list)
    evaluations: list[TaskScheduleEvaluation] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Impossible-request validation (call at submit time)
# ---------------------------------------------------------------------------

def validate_request_possible(
    per_gpu: list[PerGpuAllocationSummary],
    require_gpu_count: int,
    require_vram_mb: int,
) -> str | None:
    """Return an error message if the request can never fit, else None."""
    gpu_count = len(per_gpu)
    if require_gpu_count > gpu_count:
        return (
            f"requested {require_gpu_count} GPUs but this node only has {gpu_count}"
        )
    if require_vram_mb > 0:
        capable = sum(
            1 for g in per_gpu
            if g.total_memory_mb * CAPACITY_FACTOR >= require_vram_mb
        )
        if capable < require_gpu_count:
            return (
                f"requested {require_vram_mb} MB per GPU on {require_gpu_count} GPUs, "
                f"but only {capable} GPU(s) have enough physical VRAM"
            )
    return None


# ---------------------------------------------------------------------------
# Ledger construction
# ---------------------------------------------------------------------------

def _unmanaged_mem_for_gpu(
    gpu: PerGpuAllocationSummary,
) -> float:
    """Sum of non-PMEOW process memory on a single GPU snapshot."""
    return (
        sum(p.used_memory_mb for p in gpu.user_processes)
        + sum(p.used_memory_mb for p in gpu.unknown_processes)
    )


def _build_gpu_ledgers(
    current_per_gpu: list[PerGpuAllocationSummary],
    history: list[tuple[float, list[PerGpuAllocationSummary]]],
    pending: dict[int, float],
    exclusive_pending: set[int],
) -> list[GpuLedger]:
    """Build the dual-ledger view for each GPU."""

    # Pre-compute unmanaged peak per GPU across history window
    unmanaged_peaks: dict[int, float] = {}
    for _, sample in history:
        for gpu in sample:
            mem = _unmanaged_mem_for_gpu(gpu)
            prev = unmanaged_peaks.get(gpu.gpu_index, 0.0)
            if mem > prev:
                unmanaged_peaks[gpu.gpu_index] = mem
    # Also consider current snapshot for unmanaged peak
    for gpu in current_per_gpu:
        mem = _unmanaged_mem_for_gpu(gpu)
        prev = unmanaged_peaks.get(gpu.gpu_index, 0.0)
        if mem > prev:
            unmanaged_peaks[gpu.gpu_index] = mem

    ledgers: list[GpuLedger] = []
    for gpu in current_per_gpu:
        idx = gpu.gpu_index
        schedulable = gpu.total_memory_mb * CAPACITY_FACTOR

        # Managed reserved: declared VRAM for shared tasks (vram > 0)
        managed = sum(
            t.declared_vram_mb
            for t in gpu.pmeow_tasks
            if t.declared_vram_mb > 0
        ) + pending.get(idx, 0.0)

        # Exclusive owner: any pmeow task with declared_vram == 0, or pending exclusive
        has_exclusive = (
            any(t.declared_vram_mb == 0 for t in gpu.pmeow_tasks)
            or idx in exclusive_pending
        )

        unmanaged_peak = unmanaged_peaks.get(idx, 0.0) * UNMANAGED_MULTIPLIER
        effective_free = max(0.0, schedulable - managed - unmanaged_peak)

        vram_util = (
            (gpu.used_memory_mb / gpu.total_memory_mb * 100.0)
            if gpu.total_memory_mb > 0 else 0.0
        )

        ledgers.append(GpuLedger(
            gpu_index=idx,
            total_vram_mb=gpu.total_memory_mb,
            schedulable_mb=schedulable,
            managed_reserved_mb=managed,
            exclusive_owner=has_exclusive,
            unmanaged_peak_mb=unmanaged_peak,
            utilization_percent=gpu.utilization_percent,
            vram_utilization_percent=vram_util,
            effective_free_mb=effective_free,
        ))
    return ledgers


# ---------------------------------------------------------------------------
# Admission predicates
# ---------------------------------------------------------------------------

def _eligible_shared(ledger: GpuLedger, require_vram_mb: int) -> bool:
    """Can this GPU accept a shared-capacity task requesting *require_vram_mb*?"""
    return not ledger.exclusive_owner and ledger.effective_free_mb >= require_vram_mb


def _is_gpu_idle_in_sample(
    gpu: PerGpuAllocationSummary,
) -> bool:
    """Check if a GPU has no managed tasks and low unmanaged VRAM usage in a single sample."""
    if gpu.pmeow_tasks:
        return False
    vram_util = (
        (gpu.used_memory_mb / gpu.total_memory_mb * 100.0)
        if gpu.total_memory_mb > 0 else 0.0
    )
    unmanaged_vram_util = (
        (_unmanaged_mem_for_gpu(gpu) / gpu.total_memory_mb * 100.0)
        if gpu.total_memory_mb > 0 else 0.0
    )
    return unmanaged_vram_util < IDLE_VRAM_UTILIZATION_THRESHOLD


def _eligible_exclusive(
    ledger: GpuLedger,
    history: list[tuple[float, list[PerGpuAllocationSummary]]],
    current_per_gpu: list[PerGpuAllocationSummary],
) -> bool:
    """Can this GPU accept an exclusive task?"""
    if ledger.exclusive_owner:
        return False
    if ledger.managed_reserved_mb > 0:
        return False
    # Current idle check: both utilization and VRAM utilization below threshold
    if ledger.utilization_percent >= IDLE_UTILIZATION_THRESHOLD:
        return False
    if ledger.vram_utilization_percent >= IDLE_VRAM_UTILIZATION_THRESHOLD:
        return False
    # History window: every sample must show this GPU as idle
    idx = ledger.gpu_index
    for _, sample in history:
        for gpu in sample:
            if gpu.gpu_index == idx:
                if not _is_gpu_idle_in_sample(gpu):
                    return False
                break
    # Also check current snapshot
    for gpu in current_per_gpu:
        if gpu.gpu_index == idx:
            if gpu.pmeow_tasks:
                return False
            break
    return True


class QueueScheduler:
    """Evaluate queued tasks using dual-ledger GPU admission."""

    def __init__(self, history: GpuHistoryTracker) -> None:
        self.history = history

    def try_schedule(
        self,
        conn: sqlite3.Connection,
        current_per_gpu: list[PerGpuAllocationSummary],
    ) -> ScheduleBatchResult:
        """Return schedulable tasks together with per-task scheduling diagnostics."""
        tasks = list_queued_tasks(conn)
        history_samples = self.history.get_history()

        result = ScheduleBatchResult()
        pending: dict[int, float] = {}
        exclusive_pending: set[int] = set()
        prior_scheduled_task_ids: list[str] = []

        for task in tasks:
            pending_snapshot = dict(pending)
            ledgers = _build_gpu_ledgers(
                current_per_gpu, history_samples, pending, exclusive_pending,
            )
            ledger_snapshots = [l.to_snapshot_dict() for l in ledgers]
            current_free = {l.gpu_index: l.effective_free_mb for l in ledgers}

            is_exclusive = task.require_vram_mb == 0

            if is_exclusive:
                gpu_ids = self._try_exclusive(
                    ledgers, history_samples, current_per_gpu,
                    task.require_gpu_count,
                )
            else:
                gpu_ids = self._try_shared(
                    ledgers, task.require_vram_mb, task.require_gpu_count,
                )

            if gpu_ids is not None:
                result.decisions.append(ScheduleDecision(
                    task_id=task.id, gpu_ids=gpu_ids,
                ))
                eligible_ids = [l.gpu_index for l in ledgers if (
                    _eligible_exclusive(l, history_samples, current_per_gpu)
                    if is_exclusive else _eligible_shared(l, task.require_vram_mb)
                )]
                result.evaluations.append(TaskScheduleEvaluation(
                    task_id=task.id,
                    can_run=True,
                    reason_code="scheduled",
                    gpu_ids=gpu_ids,
                    current_eligible_gpu_ids=eligible_ids,
                    sustained_eligible_gpu_ids=eligible_ids,
                    current_effective_free_mb=current_free,
                    history_min_free_mb={},
                    pending_vram_mb=pending_snapshot,
                    blocker_task_ids=list(prior_scheduled_task_ids),
                    gpu_ledgers=ledger_snapshots,
                ))
                if is_exclusive:
                    for gid in gpu_ids:
                        exclusive_pending.add(gid)
                else:
                    for gid in gpu_ids:
                        pending[gid] = pending.get(gid, 0.0) + task.require_vram_mb
                prior_scheduled_task_ids.append(task.id)
                continue

            # Blocked — determine reason
            eligible_ids = [l.gpu_index for l in ledgers if (
                _eligible_exclusive(l, history_samples, current_per_gpu)
                if is_exclusive else _eligible_shared(l, task.require_vram_mb)
            )]

            # Check if would pass without pending reservations
            baseline_ledgers = _build_gpu_ledgers(
                current_per_gpu, history_samples, {}, set(),
            )
            if is_exclusive:
                baseline_ids = self._try_exclusive(
                    baseline_ledgers, history_samples, current_per_gpu,
                    task.require_gpu_count,
                )
            else:
                baseline_ids = self._try_shared(
                    baseline_ledgers, task.require_vram_mb, task.require_gpu_count,
                )

            if baseline_ids is not None and prior_scheduled_task_ids:
                reason_code = "blocked_by_higher_priority"
            elif len(eligible_ids) < task.require_gpu_count:
                reason_code = "insufficient_gpu_count"
            else:
                reason_code = "sustained_window_not_satisfied"

            result.evaluations.append(TaskScheduleEvaluation(
                task_id=task.id,
                can_run=False,
                reason_code=reason_code,
                gpu_ids=[],
                current_eligible_gpu_ids=eligible_ids,
                sustained_eligible_gpu_ids=eligible_ids,
                current_effective_free_mb=current_free,
                history_min_free_mb={},
                pending_vram_mb=pending_snapshot,
                blocker_task_ids=list(prior_scheduled_task_ids),
                gpu_ledgers=ledger_snapshots,
            ))

        return result

    @staticmethod
    def _try_shared(
        ledgers: list[GpuLedger],
        require_vram_mb: int,
        require_gpu_count: int,
    ) -> list[int] | None:
        eligible = [
            l for l in ledgers if _eligible_shared(l, require_vram_mb)
        ]
        if len(eligible) < require_gpu_count:
            return None
        eligible.sort(key=lambda l: l.effective_free_mb, reverse=True)
        return [l.gpu_index for l in eligible[:require_gpu_count]]

    @staticmethod
    def _try_exclusive(
        ledgers: list[GpuLedger],
        history: list[tuple[float, list[PerGpuAllocationSummary]]],
        current_per_gpu: list[PerGpuAllocationSummary],
        require_gpu_count: int,
    ) -> list[int] | None:
        eligible = [
            l for l in ledgers
            if _eligible_exclusive(l, history, current_per_gpu)
        ]
        if len(eligible) < require_gpu_count:
            return None
        eligible.sort(key=lambda l: l.effective_free_mb, reverse=True)
        return [l.gpu_index for l in eligible[:require_gpu_count]]
