"""Assemble a full MetricsSnapshot from individual collectors."""

from __future__ import annotations

import time

from pmeow.models import GpuSnapshot, MetricsSnapshot

from pmeow.collector.cpu import collect_cpu
from pmeow.collector.disk import collect_disk
from pmeow.collector.docker import collect_docker
from pmeow.collector.memory import collect_memory
from pmeow.collector.network import collect_network
from pmeow.collector.processes import collect_processes
from pmeow.collector.system import collect_system

_GPU_UNAVAILABLE = GpuSnapshot(
    available=False,
    total_memory_mb=0.0,
    used_memory_mb=0.0,
    memory_usage_percent=0.0,
    utilization_percent=0.0,
    temperature_c=0.0,
    gpu_count=0,
)


def collect_snapshot(server_id: str) -> MetricsSnapshot:
    """Collect a full metrics snapshot for the given server."""
    return MetricsSnapshot(
        server_id=server_id,
        timestamp=time.time(),
        cpu=collect_cpu(),
        memory=collect_memory(),
        disk=collect_disk(),
        network=collect_network(),
        gpu=_GPU_UNAVAILABLE,
        processes=collect_processes(),
        docker=collect_docker(),
        system=collect_system(),
        gpu_allocation=None,
    )
