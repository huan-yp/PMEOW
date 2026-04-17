"""Queue report formatting for attached Python tasks."""

from __future__ import annotations

import shlex

from pmeow.models import PerGpuAllocationSummary, TaskRecord
from pmeow.queue.scheduler import TaskScheduleEvaluation


def format_vram_gb(megabytes: float) -> str:
    return f"{megabytes / 1024:.1f} GB"


def format_gpu_overview(
    per_gpu: list[PerGpuAllocationSummary],
    pending_vram_mb: dict[int, float] | None = None,
) -> str:
    if not per_gpu:
        return "gpu-overview: no GPU allocation data available"
    parts = []
    pending_vram_mb = pending_vram_mb or {}
    for gpu in per_gpu:
        parts.append(
            f"gpu{gpu.gpu_index}: free={format_vram_gb(gpu.effective_free_mb)} "
            f"pending={format_vram_gb(pending_vram_mb.get(gpu.gpu_index, 0.0))} "
            f"pmeow={len(gpu.pmeow_tasks)} user={len(gpu.user_processes)} unknown={len(gpu.unknown_processes)}"
        )
    return "gpu-overview: " + " | ".join(parts)


def format_history_summary(history_min_free_mb: dict[int, float]) -> str:
    if not history_min_free_mb:
        return "history-summary: no GPU history available"
    parts = [
        f"gpu{gpu_index}={format_vram_gb(history_min_free_mb[gpu_index])}"
        for gpu_index in sorted(history_min_free_mb)
    ]
    return "history-summary: min-effective-free " + " | ".join(parts)


def format_submission_report(task: TaskRecord) -> str:
    command_text = shlex.join(task.argv) if task.argv else task.command
    return (
        f"task submitted: user={task.user} cwd={task.cwd} mode={task.launch_mode.value}; "
        f"need {task.require_gpu_count} gpu(s) with >= {format_vram_gb(task.require_vram_mb)} each; "
        f"argv={command_text}"
    )


def format_queue_paused_report(
    task: TaskRecord,
    per_gpu: list[PerGpuAllocationSummary],
) -> str:
    return (
        f"schedule blocked (queue paused): need {task.require_gpu_count} gpu(s) with >= "
        f"{format_vram_gb(task.require_vram_mb)} each; {format_gpu_overview(per_gpu)}"
    )


def format_schedule_block_summary(
    task: TaskRecord,
    evaluation: TaskScheduleEvaluation,
) -> str:
    if evaluation.reason_code == "blocked_by_higher_priority":
        blocker_text = ",".join(evaluation.blocker_task_ids) or "unknown"
        return f"higher-priority reservations this round: blockers={blocker_text}"
    if evaluation.reason_code == "sustained_window_not_satisfied":
        common = ",".join(str(gpu_id) for gpu_id in evaluation.sustained_eligible_gpu_ids) or "none"
        return f"sustained window not satisfied: common_gpus={common}"
    eligible = ",".join(str(gpu_id) for gpu_id in evaluation.current_eligible_gpu_ids) or "none"
    return (
        f"not enough eligible GPUs now: need={task.require_gpu_count} "
        f"eligible_now={eligible}"
    )


def format_schedule_block_report(
    task: TaskRecord,
    evaluation: TaskScheduleEvaluation,
    per_gpu: list[PerGpuAllocationSummary],
) -> str:
    reason_text = {
        "blocked_by_higher_priority": "blocked by higher-priority reservations in this scheduling round",
        "insufficient_gpu_count": "not enough currently eligible GPUs",
        "sustained_window_not_satisfied": "sustained availability window not satisfied",
    }.get(evaluation.reason_code, evaluation.reason_code)

    current_eligible = ",".join(str(gpu_id) for gpu_id in evaluation.current_eligible_gpu_ids) or "none"
    sustained_eligible = ",".join(str(gpu_id) for gpu_id in evaluation.sustained_eligible_gpu_ids) or "none"
    parts = [
        f"schedule blocked ({reason_text}): need {task.require_gpu_count} gpu(s) with >= {format_vram_gb(task.require_vram_mb)} each",
        f"eligible-now={current_eligible}",
        f"sustained-common={sustained_eligible}",
    ]
    if evaluation.blocker_task_ids:
        parts.append(f"blockers={','.join(evaluation.blocker_task_ids)}")
    parts.append(format_gpu_overview(per_gpu, evaluation.pending_vram_mb))
    parts.append(format_history_summary(evaluation.history_min_free_mb))
    return "; ".join(parts)


def format_waiting_report(task: TaskRecord, per_gpu: list[PerGpuAllocationSummary]) -> str:
    return (
        f"queue probe: need {task.require_gpu_count} gpu(s) with >= {format_vram_gb(task.require_vram_mb)} each; "
        f"{format_gpu_overview(per_gpu)}"
    )


def format_launch_report(task: TaskRecord, gpu_ids: list[int], per_gpu: list[PerGpuAllocationSummary]) -> str:
    selected = ",".join(str(g) for g in gpu_ids) or "cpu-only"
    return f"launch reserved: selected {selected}; {format_gpu_overview(per_gpu)}"
