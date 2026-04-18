"""Process metrics collector."""

from __future__ import annotations

from collections import defaultdict
from typing import Optional

import psutil

from pmeow.models import ProcessInfo, UserResourceSummary

_ATTRS = ["pid", "ppid", "username", "cpu_percent", "memory_percent", "memory_info", "cmdline", "name"]
_BYTES_PER_MB = 1024 * 1024


def should_include_process(proc: ProcessInfo) -> bool:
    """Filter out low-resource background processes.

    Keep a process if it has any GPU memory usage or CPU >= 2%.
    """
    if proc.gpu_memory_mb > 0:
        return True
    if proc.cpu_percent >= 2.0:
        return True
    return False


def collect_processes(
    *,
    gpu_pids: Optional[dict[int, float]] = None,
    apply_filter: bool = False,
) -> list[ProcessInfo]:
    """Collect a list of running processes using psutil.

    Args:
        gpu_pids: mapping of PID → GPU memory (MB) for GPU-using processes.
        apply_filter: if True, filter out low-resource background processes.
    """
    gpu_pids = gpu_pids or {}
    result: list[ProcessInfo] = []

    for proc in psutil.process_iter(_ATTRS):
        try:
            info = proc.info  # type: ignore[attr-defined]
            cmdline = info.get("cmdline") or []
            command = " ".join(cmdline) if cmdline else (info.get("name") or "")
            mem_info = info.get("memory_info")
            rss = mem_info.rss if mem_info else 0
            pid = info["pid"]

            p = ProcessInfo(
                pid=pid,
                ppid=info.get("ppid"),
                user=info.get("username") or "",
                cpu_percent=round(info.get("cpu_percent") or 0.0, 1),
                mem_percent=round(info.get("memory_percent") or 0.0, 1),
                rss=rss,
                command=command,
                gpu_memory_mb=gpu_pids.get(pid, 0.0),
            )

            if apply_filter and not should_include_process(p):
                continue

            result.append(p)
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue

    return result


def aggregate_processes_by_user(processes: list[ProcessInfo]) -> list[UserResourceSummary]:
    buckets: dict[str, dict[str, float | int]] = defaultdict(lambda: {
        "total_cpu_percent": 0.0,
        "total_rss_mb": 0.0,
        "total_vram_mb": 0.0,
        "process_count": 0,
    })

    for process in processes:
        user = process.user.strip()
        if not user:
            continue

        bucket = buckets[user]
        bucket["total_cpu_percent"] += process.cpu_percent
        bucket["total_rss_mb"] += process.rss / _BYTES_PER_MB
        bucket["total_vram_mb"] += process.gpu_memory_mb
        bucket["process_count"] += 1

    return [
        UserResourceSummary(
            user=user,
            total_cpu_percent=round(float(bucket["total_cpu_percent"]), 1),
            total_rss_mb=round(float(bucket["total_rss_mb"]), 1),
            total_vram_mb=round(float(bucket["total_vram_mb"]), 1),
            process_count=int(bucket["process_count"]),
        )
        for user, bucket in sorted(buckets.items())
    ]
