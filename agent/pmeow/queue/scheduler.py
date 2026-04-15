"""Priority-based queue scheduler with sustained VRAM admission."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field

from pmeow.models import PerGpuAllocationSummary
from pmeow.queue.history import GpuHistoryTracker
from pmeow.store.tasks import list_queued_tasks


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


@dataclass
class ScheduleBatchResult:
    decisions: list[ScheduleDecision] = field(default_factory=list)
    evaluations: list[TaskScheduleEvaluation] = field(default_factory=list)


def _eligible_gpus(
    per_gpu: list[PerGpuAllocationSummary],
    require_vram_mb: int,
    pending: dict[int, float],
) -> set[int]:
    """Return gpu indices whose effective free minus pending reservations
    is >= *require_vram_mb*."""
    result: set[int] = set()
    for g in per_gpu:
        available = g.effective_free_mb - pending.get(g.gpu_index, 0.0)
        if available >= require_vram_mb:
            result.add(g.gpu_index)
    return result


def _all_samples(
    history: list[tuple[float, list[PerGpuAllocationSummary]]],
    current: list[PerGpuAllocationSummary],
) -> list[list[PerGpuAllocationSummary]]:
    samples = [sample for _, sample in history]
    samples.append(current)
    return samples


def _min_free_by_gpu(
    samples: list[list[PerGpuAllocationSummary]],
) -> dict[int, float]:
    min_free: dict[int, float] = {}
    for sample in samples:
        for gpu in sample:
            current = min_free.get(gpu.gpu_index)
            if current is None or gpu.effective_free_mb < current:
                min_free[gpu.gpu_index] = gpu.effective_free_mb
    return min_free


def _current_free_by_gpu(
    current: list[PerGpuAllocationSummary],
) -> dict[int, float]:
    return {gpu.gpu_index: gpu.effective_free_mb for gpu in current}


def _analyze_sustained(
    samples: list[list[PerGpuAllocationSummary]],
    require_vram_mb: int,
    require_gpu_count: int,
    pending: dict[int, float],
) -> tuple[list[int] | None, list[int], list[int]]:
    if not samples:
        return None, [], []

    current = samples[-1]
    current_eligible = sorted(_eligible_gpus(current, require_vram_mb, pending))

    eligible_per_sample: list[set[int]] = []
    for sample in samples:
        eligible = _eligible_gpus(sample, require_vram_mb, pending)
        if len(eligible) < require_gpu_count:
            return None, current_eligible, []
        eligible_per_sample.append(eligible)

    common = eligible_per_sample[0]
    for eligible in eligible_per_sample[1:]:
        common = common & eligible

    sustained_gpu_ids = sorted(common)
    if len(sustained_gpu_ids) < require_gpu_count:
        return None, current_eligible, sustained_gpu_ids

    current_free: dict[int, float] = {}
    for gpu in current:
        if gpu.gpu_index in common:
            current_free[gpu.gpu_index] = gpu.effective_free_mb - pending.get(
                gpu.gpu_index, 0.0
            )

    selected = sorted(current_free, key=lambda idx: current_free[idx], reverse=True)
    return selected[:require_gpu_count], current_eligible, sustained_gpu_ids


def check_sustained(
    history: list[tuple[float, list[PerGpuAllocationSummary]]],
    current: list[PerGpuAllocationSummary],
    require_vram_mb: int,
    require_gpu_count: int,
    pending: dict[int, float],
) -> list[int] | None:
    """Check whether **every** sample (history + current) satisfies the
    resource requirement.  Returns selected gpu_ids or ``None``."""

    # Combine all sample points: history + current
    all_samples: list[list[PerGpuAllocationSummary]] = [
        s for _, s in history
    ]
    all_samples.append(current)

    if not all_samples:
        return None

    # For each sample, compute set of eligible GPUs
    eligible_per_sample: list[set[int]] = []
    for sample in all_samples:
        eligible = _eligible_gpus(sample, require_vram_mb, pending)
        if len(eligible) < require_gpu_count:
            return None
        eligible_per_sample.append(eligible)

    # Intersection across all samples
    common = eligible_per_sample[0]
    for s in eligible_per_sample[1:]:
        common = common & s
    if len(common) < require_gpu_count:
        return None

    # Select GPUs with most effective_free_mb from the current sample
    # (spread load — prefer the ones with the most headroom)
    current_free: dict[int, float] = {}
    for g in current:
        if g.gpu_index in common:
            current_free[g.gpu_index] = g.effective_free_mb - pending.get(
                g.gpu_index, 0.0
            )

    selected = sorted(current_free, key=lambda idx: current_free[idx], reverse=True)
    return selected[:require_gpu_count]


class QueueScheduler:
    """Evaluate queued tasks, checking sustained GPU availability and
    scheduling in priority order."""

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
        samples = _all_samples(history_samples, current_per_gpu)
        history_min_free_mb = _min_free_by_gpu(samples)
        current_effective_free_mb = _current_free_by_gpu(current_per_gpu)

        result = ScheduleBatchResult()
        # Track pending VRAM reservations within this scheduling round
        pending: dict[int, float] = {}
        prior_scheduled_task_ids: list[str] = []

        for task in tasks:
            pending_snapshot = dict(pending)
            baseline_gpu_ids, _, _ = _analyze_sustained(
                samples,
                task.require_vram_mb,
                task.require_gpu_count,
                {},
            )
            gpu_ids, current_eligible_gpu_ids, sustained_eligible_gpu_ids = _analyze_sustained(
                samples,
                task.require_vram_mb,
                task.require_gpu_count,
                pending,
            )

            if gpu_ids is not None:
                result.decisions.append(ScheduleDecision(task_id=task.id, gpu_ids=gpu_ids))
                result.evaluations.append(TaskScheduleEvaluation(
                    task_id=task.id,
                    can_run=True,
                    reason_code="scheduled",
                    gpu_ids=gpu_ids,
                    current_eligible_gpu_ids=current_eligible_gpu_ids,
                    sustained_eligible_gpu_ids=sustained_eligible_gpu_ids,
                    current_effective_free_mb=current_effective_free_mb,
                    history_min_free_mb=history_min_free_mb,
                    pending_vram_mb=pending_snapshot,
                    blocker_task_ids=list(prior_scheduled_task_ids),
                ))
                # Reserve VRAM so subsequent tasks see reduced availability
                for gid in gpu_ids:
                    pending[gid] = pending.get(gid, 0.0) + task.require_vram_mb
                prior_scheduled_task_ids.append(task.id)
                continue

            if baseline_gpu_ids is not None and pending_snapshot:
                reason_code = "blocked_by_higher_priority"
            elif len(current_eligible_gpu_ids) < task.require_gpu_count:
                reason_code = "insufficient_gpu_count"
            else:
                reason_code = "sustained_window_not_satisfied"

            result.evaluations.append(TaskScheduleEvaluation(
                task_id=task.id,
                can_run=False,
                reason_code=reason_code,
                gpu_ids=[],
                current_eligible_gpu_ids=current_eligible_gpu_ids,
                sustained_eligible_gpu_ids=sustained_eligible_gpu_ids,
                current_effective_free_mb=current_effective_free_mb,
                history_min_free_mb=history_min_free_mb,
                pending_vram_mb=pending_snapshot,
                blocker_task_ids=list(prior_scheduled_task_ids),
            ))

        return result
