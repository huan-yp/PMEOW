"""Memory metrics collector."""

from __future__ import annotations

import psutil

from pmeow.models import MemorySnapshot

_MB = 1024 * 1024


def collect_memory() -> MemorySnapshot:
    """Collect a memory snapshot using psutil."""
    vm = psutil.virtual_memory()
    sw = psutil.swap_memory()

    return MemorySnapshot(
        total_mb=round(vm.total / _MB, 1),
        used_mb=round(vm.used / _MB, 1),
        available_mb=round(vm.available / _MB, 1),
        usage_percent=round(vm.percent, 1),
        swap_total_mb=round(sw.total / _MB, 1),
        swap_used_mb=round(sw.used / _MB, 1),
        swap_percent=round(sw.percent, 1),
    )
