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
    collect_per_gpu_utilization,
)
from pmeow.collector.gpu_attribution import attribute_gpu_processes
from pmeow.collector.internet import InternetProbe
from pmeow.collector.memory import collect_memory
from pmeow.collector.network import collect_network
from pmeow.collector.processes import collect_processes
from pmeow.collector.system import collect_system
from pmeow.store.task_runtime import list_task_process_owners_by_pid
from pmeow.store.tasks import list_tasks


def collect_snapshot(
    server_id: str,
    task_store: Optional[sqlite3.Connection] = None,
    redundancy_coefficient: float = 0.1,
    internet_probe: Optional[InternetProbe] = None,
) -> MetricsSnapshot:
    """Collect a full metrics snapshot for the given server.

    ``internet_probe`` is optional and intentionally injected by the caller
    (the daemon) rather than constructed here, so tests can supply a fake
    probe without monkey-patching module state and so the daemon owns the
    probe's cached state across collection cycles.
    """
    gpu = collect_gpu()

    gpu_allocation = None
    if task_store is not None and gpu.available:
        gpu_procs = collect_gpu_processes()
        running_tasks = list_tasks(task_store, TaskStatus.running)
        per_gpu_mem = collect_per_gpu_total_memory()
        per_gpu_used = collect_per_gpu_used_memory()
        per_gpu_util = collect_per_gpu_utilization()
        gpu_pids = [p.pid for p in gpu_procs]
        task_process_pids = list_task_process_owners_by_pid(task_store, gpu_pids)
        gpu_allocation = attribute_gpu_processes(
            gpu_procs, running_tasks, per_gpu_mem, redundancy_coefficient,
            per_gpu_used_memory=per_gpu_used,
            task_process_pids=task_process_pids,
            per_gpu_utilization=per_gpu_util,
        )

    network = collect_network()
    if internet_probe is not None:
        probe_result = internet_probe.get()
        if probe_result is not None:
            network.internet_reachable = probe_result.reachable
            network.internet_latency_ms = probe_result.latency_ms
            network.internet_probe_target = probe_result.probe_target
            network.internet_probe_checked_at = probe_result.checked_at

    return MetricsSnapshot(
        server_id=server_id,
        timestamp=time.time(),
        cpu=collect_cpu(),
        memory=collect_memory(),
        disk=collect_disk(),
        network=network,
        gpu=gpu,
        processes=collect_processes(),
        docker=collect_docker(),
        system=collect_system(),
        gpu_allocation=gpu_allocation,
    )
