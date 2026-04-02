"""CPU metrics collector."""

from __future__ import annotations

import platform

import psutil

from pmeow.models import CpuSnapshot


def _read_cpu_model() -> str:
    """Read CPU model name from /proc/cpuinfo, falling back to platform."""
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or "unknown"


def collect_cpu() -> CpuSnapshot:
    """Collect a CPU snapshot using psutil."""
    per_core = psutil.cpu_percent(percpu=True)
    overall = sum(per_core) / len(per_core) if per_core else 0.0
    core_count = psutil.cpu_count(logical=True) or 1
    freq = psutil.cpu_freq()
    frequency_mhz = freq.current if freq else 0.0
    model_name = _read_cpu_model()

    return CpuSnapshot(
        usage_percent=round(overall, 1),
        core_count=core_count,
        model_name=model_name,
        frequency_mhz=round(frequency_mhz, 1),
        per_core_usage=per_core,
    )
