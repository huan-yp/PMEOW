"""Process metrics collector."""

from __future__ import annotations

import psutil

from pmeow.models import ProcessInfo

_ATTRS = ["pid", "ppid", "username", "cpu_percent", "memory_percent", "memory_info", "cmdline", "name"]


def collect_processes() -> list[ProcessInfo]:
    """Collect a list of running processes using psutil."""
    result: list[ProcessInfo] = []

    for proc in psutil.process_iter(_ATTRS):
        try:
            info = proc.info  # type: ignore[attr-defined]
            cmdline = info.get("cmdline") or []
            command = " ".join(cmdline) if cmdline else (info.get("name") or "")
            mem_info = info.get("memory_info")
            rss = mem_info.rss if mem_info else 0

            result.append(ProcessInfo(
                pid=info["pid"],
                ppid=info.get("ppid"),
                user=info.get("username") or "",
                cpu_percent=round(info.get("cpu_percent") or 0.0, 1),
                mem_percent=round(info.get("memory_percent") or 0.0, 1),
                rss=rss,
                command=command,
            ))
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue

    return result
