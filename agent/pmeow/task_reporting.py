"""Queue report formatting for attached Python tasks."""

from __future__ import annotations

from pmeow.models import PerGpuAllocationSummary, TaskRecord


def format_gpu_overview(per_gpu: list[PerGpuAllocationSummary]) -> str:
    if not per_gpu:
        return "gpu-overview: no GPU allocation data available"
    parts = []
    for gpu in per_gpu:
        parts.append(
            f"gpu{gpu.gpu_index}: free={int(gpu.effective_free_mb)}MB "
            f"pmeow={len(gpu.pmeow_tasks)} user={len(gpu.user_processes)} unknown={len(gpu.unknown_processes)}"
        )
    return "gpu-overview: " + " | ".join(parts)


def format_waiting_report(task: TaskRecord, per_gpu: list[PerGpuAllocationSummary]) -> str:
    return (
        f"queue probe: need {task.require_gpu_count} gpu(s) with >= {task.require_vram_mb}MB each; "
        f"{format_gpu_overview(per_gpu)}"
    )


def format_launch_report(task: TaskRecord, gpu_ids: list[int], per_gpu: list[PerGpuAllocationSummary]) -> str:
    selected = ",".join(str(g) for g in gpu_ids) or "cpu-only"
    return f"launch reserved: selected {selected}; {format_gpu_overview(per_gpu)}"
