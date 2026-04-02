"""System metrics collector."""

from __future__ import annotations

import os
import platform
import socket
import time

import psutil

from pmeow.models import SystemSnapshot


def _format_uptime(seconds: float) -> str:
    """Format uptime seconds into a human-readable string."""
    days, rem = divmod(int(seconds), 86400)
    hours, rem = divmod(rem, 3600)
    minutes, _ = divmod(rem, 60)
    parts: list[str] = []
    if days:
        parts.append(f"{days}d")
    if hours:
        parts.append(f"{hours}h")
    parts.append(f"{minutes}m")
    return " ".join(parts)


def collect_system() -> SystemSnapshot:
    """Collect a system snapshot."""
    boot = psutil.boot_time()
    uptime_sec = time.time() - boot
    load1, load5, load15 = os.getloadavg()

    return SystemSnapshot(
        hostname=socket.gethostname(),
        uptime=_format_uptime(uptime_sec),
        load_avg1=round(load1, 2),
        load_avg5=round(load5, 2),
        load_avg15=round(load15, 2),
        kernel_version=platform.release(),
    )
