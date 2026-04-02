"""Priority-based queue scheduler with sustained VRAM admission."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field

from pmeow.models import PerGpuAllocationSummary, TaskRecord
from pmeow.queue.history import GpuHistoryTracker
from pmeow.store.tasks import list_queued_tasks


@dataclass
class ScheduleDecision:
    task_id: str
    gpu_ids: list[int]


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
    ) -> list[ScheduleDecision]:
        """Return a list of tasks that can start now, with their gpu assignments."""
        tasks = list_queued_tasks(conn)
        history_samples = self.history.get_history()

        decisions: list[ScheduleDecision] = []
        # Track pending VRAM reservations within this scheduling round
        pending: dict[int, float] = {}

        for task in tasks:
            gpu_ids = check_sustained(
                history_samples,
                current_per_gpu,
                task.require_vram_mb,
                task.require_gpu_count,
                pending,
            )
            if gpu_ids is not None:
                decisions.append(ScheduleDecision(task_id=task.id, gpu_ids=gpu_ids))
                # Reserve VRAM so subsequent tasks see reduced availability
                for gid in gpu_ids:
                    pending[gid] = pending.get(gid, 0.0) + task.require_vram_mb

        return decisions
