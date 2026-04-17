"""GPU process ownership attribution and effective-free memory accounting."""

from __future__ import annotations

import os
import sys
from collections import defaultdict
from typing import Optional

import psutil

try:
    import pwd  # Unix only
except ImportError:
    pwd = None  # type: ignore[assignment]

from pmeow.models import (
    GpuAllocationSummary,
    GpuProcessInfo,
    GpuTaskAllocation,
    GpuUnknownProcess,
    GpuUserProcess,
    PerGpuAllocationSummary,
    TaskRecord,
    UserGpuUsageSummary,
)


def _read_proc_uid(pid: int) -> Optional[int]:
    """Read the real UID from /proc/<pid>/status, or None.

    Falls back to psutil on platforms without /proc (e.g. Windows).
    """
    if sys.platform != "win32":
        try:
            with open(f"/proc/{pid}/status") as f:
                for line in f:
                    if line.startswith("Uid:"):
                        return int(line.split()[1])
        except (OSError, ValueError, IndexError):
            return None
        return None
    # Windows: UID is not meaningful; return None so callers bucket
    # the process by username instead.
    return None


def _read_proc_cmdline(pid: int) -> Optional[str]:
    """Read the command line from /proc/<pid>/cmdline, or None.

    Falls back to psutil on platforms without /proc (e.g. Windows).
    """
    if sys.platform != "win32":
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                raw = f.read(4096)
            if not raw:
                return None
            return raw.replace(b"\x00", b" ").decode("utf-8", errors="replace").strip()
        except OSError:
            return None
    try:
        return " ".join(psutil.Process(pid).cmdline())
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return None


def _get_process_username(pid: int) -> Optional[str]:
    """Return the username owning *pid*, or None."""
    try:
        return psutil.Process(pid).username()
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return None


def _collect_task_process_ids(task_pid: int) -> set[int]:
    """Return the tracked task PID plus any live descendants."""
    pids = {task_pid}
    try:
        process = psutil.Process(task_pid)
        for child in process.children(recursive=True):
            pids.add(child.pid)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return pids
    return pids


def _uid_to_username(uid: int) -> str:
    if pwd is not None:
        try:
            return pwd.getpwuid(uid).pw_name
        except KeyError:
            pass
    return str(uid)


def calculate_effective_free(
    total_memory_mb: float,
    pmeow_tasks: list[GpuTaskAllocation],
    user_processes: list[GpuUserProcess],
    unknown_processes: list[GpuUnknownProcess],
    redundancy_coefficient: float,
) -> float:
    """Calculate scheduling-visible free memory for a single GPU.

    - PMEOW tasks: use declared_vram_mb (not actual)
    - Non-PMEOW (user + unknown): actual × (1 + redundancy_coefficient)
    - Clamp result to >= 0
    """
    pmeow_total = sum(t.declared_vram_mb for t in pmeow_tasks)

    non_pmeow_actual = (
        sum(p.used_memory_mb for p in user_processes)
        + sum(p.used_memory_mb for p in unknown_processes)
    )
    non_pmeow_adjusted = non_pmeow_actual * (1 + redundancy_coefficient)

    free = total_memory_mb - pmeow_total - non_pmeow_adjusted
    return max(0.0, free)


def attribute_gpu_processes(
    gpu_processes: list[GpuProcessInfo],
    running_tasks: list[TaskRecord],
    per_gpu_memory: dict[int, float],
    redundancy_coefficient: float = 0.1,
    per_gpu_used_memory: Optional[dict[int, float]] = None,
) -> GpuAllocationSummary:
    """Classify each GPU process and build an allocation summary."""

    # Build PID → TaskRecord lookup
    pid_to_task: dict[int, TaskRecord] = {}
    for task in running_tasks:
        if task.pid is not None:
            for pid in _collect_task_process_ids(task.pid):
                pid_to_task[pid] = task

    # Buckets per GPU
    task_allocs: dict[int, list[GpuTaskAllocation]] = defaultdict(list)
    user_procs: dict[int, list[GpuUserProcess]] = defaultdict(list)
    unknown_procs: dict[int, list[GpuUnknownProcess]] = defaultdict(list)

    # Track user usage for by_user summary
    user_usage: dict[str, dict[str, object]] = {}  # user → {total, gpu_set}

    for proc in gpu_processes:
        gpu_idx = proc.gpu_index
        task = pid_to_task.get(proc.pid)

        if task is not None:
            task_allocs[gpu_idx].append(GpuTaskAllocation(
                task_id=task.id,
                gpu_index=gpu_idx,
                declared_vram_mb=task.require_vram_mb,
                actual_vram_mb=proc.used_memory_mb,
            ))
            continue

        # Try to identify user via /proc or psutil
        uid = _read_proc_uid(proc.pid)
        if uid is not None:
            username: Optional[str] = _uid_to_username(uid)
        else:
            username = _get_process_username(proc.pid)

        if username is not None:
            cmdline = _read_proc_cmdline(proc.pid) or ""
            user_procs[gpu_idx].append(GpuUserProcess(
                pid=proc.pid,
                user=username,
                gpu_index=gpu_idx,
                used_memory_mb=proc.used_memory_mb,
                command=cmdline,
            ))
            # Accumulate user summary
            if username not in user_usage:
                user_usage[username] = {"total": 0.0, "gpus": set()}
            user_usage[username]["total"] += proc.used_memory_mb  # type: ignore[operator]
            user_usage[username]["gpus"].add(gpu_idx)  # type: ignore[union-attr]
            continue

        # Unidentifiable process → unknown
        unknown_procs[gpu_idx].append(GpuUnknownProcess(
            pid=proc.pid,
            gpu_index=gpu_idx,
            used_memory_mb=proc.used_memory_mb,
        ))

    # Build per-GPU summaries
    all_gpu_indices = set(per_gpu_memory.keys())
    if per_gpu_used_memory is not None:
        all_gpu_indices.update(per_gpu_used_memory.keys())
    for proc in gpu_processes:
        all_gpu_indices.add(proc.gpu_index)

    per_gpu: list[PerGpuAllocationSummary] = []
    for idx in sorted(all_gpu_indices):
        total_mem = per_gpu_memory.get(idx, 0.0)
        tasks = task_allocs.get(idx, [])
        users = user_procs.get(idx, [])
        unknowns = unknown_procs.get(idx, [])
        attributed_used = (
            sum(task.actual_vram_mb for task in tasks)
            + sum(process.used_memory_mb for process in users)
            + sum(process.used_memory_mb for process in unknowns)
        )
        actual_used = attributed_used
        if per_gpu_used_memory is not None:
            actual_used = max(actual_used, per_gpu_used_memory.get(idx, 0.0))
        eff_free = calculate_effective_free(
            total_mem, tasks, users, unknowns, redundancy_coefficient,
        )
        per_gpu.append(PerGpuAllocationSummary(
            gpu_index=idx,
            total_memory_mb=total_mem,
            used_memory_mb=actual_used,
            pmeow_tasks=tasks,
            user_processes=users,
            unknown_processes=unknowns,
            effective_free_mb=eff_free,
        ))

    # Build by-user summary
    by_user: list[UserGpuUsageSummary] = []
    for username, info in sorted(user_usage.items()):
        by_user.append(UserGpuUsageSummary(
            user=username,
            total_vram_mb=info["total"],  # type: ignore[arg-type]
            gpu_indices=sorted(info["gpus"]),  # type: ignore[arg-type]
        ))

    return GpuAllocationSummary(per_gpu=per_gpu, by_user=by_user)
