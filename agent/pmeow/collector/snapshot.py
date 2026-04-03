"""Assemble a full MetricsSnapshot from individual collectors."""

from __future__ import annotations

import sqlite3
import time
from typing import Optional

from pmeow.models import MetricsSnapshot, TaskStatus

from pmeow.collector.cpu import collect_cpu
from pmeow.collector.disk import collect_disk
from pmeow.collector.docker import collect_docker
from pmeow.collector.gpu import (
    collect_gpu,
    collect_gpu_processes,
    collect_per_gpu_total_memory,
    collect_per_gpu_used_memory,
)
from pmeow.collector.gpu_attribution import attribute_gpu_processes
from pmeow.collector.memory import collect_memory
from pmeow.collector.network import collect_network
from pmeow.collector.processes import collect_processes
from pmeow.collector.system import collect_system
from pmeow.store.tasks import list_tasks


def collect_snapshot(
    server_id: str,
    task_store: Optional[sqlite3.Connection] = None,
    redundancy_coefficient: float = 0.1,
) -> MetricsSnapshot:
    """Collect a full metrics snapshot for the given server."""
    gpu = collect_gpu()

    gpu_allocation = None
    if task_store is not None and gpu.available:
        gpu_procs = collect_gpu_processes()
        running_tasks = list_tasks(task_store, TaskStatus.running)
        per_gpu_mem = collect_per_gpu_total_memory()
        per_gpu_used = collect_per_gpu_used_memory()
        gpu_allocation = attribute_gpu_processes(
            gpu_procs, running_tasks, per_gpu_mem, redundancy_coefficient,
            per_gpu_used_memory=per_gpu_used,
        )

    return MetricsSnapshot(
        server_id=server_id,
        timestamp=time.time(),
        cpu=collect_cpu(),
        memory=collect_memory(),
        disk=collect_disk(),
        network=collect_network(),
        gpu=gpu,
        processes=collect_processes(),
        docker=collect_docker(),
        system=collect_system(),
        gpu_allocation=gpu_allocation,
    )
