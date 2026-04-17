"""Assemble the daemon collection snapshot from individual collectors."""

from __future__ import annotations

import time
from typing import Optional, TYPE_CHECKING

from pmeow.models import (
    CollectedSnapshot,
    DiskIoSnapshot,
    GpuCardReport,
    GpuCardTaskReport,
    GpuCardUnknownProcessReport,
    GpuCardUserProcessReport,
    PerGpuAllocationSummary,
    ResourceSnapshot,
)

from pmeow.collector.cpu import collect_cpu
from pmeow.collector.disk import collect_disk
from pmeow.collector.gpu import (
    GpuCardTelemetry,
    collect_gpu_card_telemetry,
    collect_gpu_processes,
)
from pmeow.collector.gpu_attribution import attribute_gpu_processes
from pmeow.collector.internet import InternetProbe
from pmeow.collector.local_users import collect_local_users
from pmeow.collector.memory import collect_memory
from pmeow.collector.network import collect_network
from pmeow.collector.processes import collect_processes
from pmeow.collector.system import collect_system

if TYPE_CHECKING:
    from pmeow.state.task_queue import TaskQueue


def collect_snapshot(
    server_id: str,
    task_queue: Optional[TaskQueue] = None,
    redundancy_coefficient: float = 0.1,
    internet_probe: Optional[InternetProbe] = None,
) -> CollectedSnapshot:
    """Collect a full resource snapshot for the given server."""
    timestamp = time.time()
    gpu_cards = collect_gpu_card_telemetry()

    gpu_allocation = None
    gpu_pids_map: dict[int, float] = {}

    if gpu_cards:
        gpu_procs = collect_gpu_processes()
        # Build GPU PID → memory mapping for process filtering
        for gp in gpu_procs:
            gpu_pids_map[gp.pid] = gpu_pids_map.get(gp.pid, 0.0) + gp.used_memory_mb

        running_tasks = task_queue.list_running() if task_queue is not None else []
        reserved_tasks = task_queue.list_reserved() if task_queue is not None else []
        all_gpu_tasks = running_tasks + reserved_tasks

        per_gpu_mem = {card.index: card.memory_total_mb for card in gpu_cards}
        per_gpu_used = {card.index: card.memory_used_mb for card in gpu_cards}
        per_gpu_util = {card.index: card.utilization_gpu for card in gpu_cards}

        # Build PID → task_id mapping from running tasks
        task_process_pids: dict[int, str] = {}
        for task in running_tasks:
            if task.pid is not None:
                task_process_pids[task.pid] = task.id

        gpu_allocation = attribute_gpu_processes(
            gpu_procs, all_gpu_tasks, per_gpu_mem, redundancy_coefficient,
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

    # Collect processes with GPU memory info and filtering
    processes = collect_processes(
        gpu_pids=gpu_pids_map if gpu_pids_map else None,
        apply_filter=True,
    )

    disk = collect_disk()
    local_users = [user.username for user in collect_local_users()]
    per_gpu = gpu_allocation.per_gpu if gpu_allocation is not None else []

    resource_snapshot = ResourceSnapshot(
        gpu_cards=_build_gpu_cards(gpu_cards, per_gpu, redundancy_coefficient),
        cpu=collect_cpu(),
        memory=collect_memory(),
        disks=list(disk.disks),
        disk_io=DiskIoSnapshot(
            read_bytes_per_sec=disk.io_read_kbs * 1024,
            write_bytes_per_sec=disk.io_write_kbs * 1024,
        ),
        network=network,
        processes=processes,
        local_users=local_users,
        system=collect_system(),
    )

    return CollectedSnapshot(
        timestamp=timestamp,
        resource_snapshot=resource_snapshot,
        per_gpu=per_gpu,
    )


def _build_gpu_cards(
    telemetry: list[GpuCardTelemetry],
    per_gpu: list[PerGpuAllocationSummary],
    redundancy_coefficient: float,
) -> list[GpuCardReport]:
    per_gpu_by_index = {gpu.gpu_index: gpu for gpu in per_gpu}
    cards: list[GpuCardReport] = []

    for card in telemetry:
        summary = per_gpu_by_index.get(card.index)
        pmeow_tasks = summary.pmeow_tasks if summary is not None else []
        user_processes = summary.user_processes if summary is not None else []
        unknown_processes = summary.unknown_processes if summary is not None else []

        managed_reserved_mb = sum(task.declared_vram_mb for task in pmeow_tasks)
        unmanaged_actual_mb = (
            sum(process.used_memory_mb for process in user_processes)
            + sum(process.used_memory_mb for process in unknown_processes)
        )
        unmanaged_peak_mb = unmanaged_actual_mb * (1 + redundancy_coefficient)
        effective_free_mb = (
            summary.effective_free_mb
            if summary is not None
            else max(0.0, card.memory_total_mb - unmanaged_peak_mb)
        )
        actual_used_mb = summary.used_memory_mb if summary is not None else card.memory_used_mb

        cards.append(GpuCardReport(
            index=card.index,
            name=card.name,
            temperature=int(round(card.temperature_c)),
            utilization_gpu=int(round(card.utilization_gpu)),
            utilization_memory=int(round(card.utilization_memory)),
            memory_total_mb=int(round(card.memory_total_mb)),
            memory_used_mb=int(round(actual_used_mb)),
            managed_reserved_mb=int(round(managed_reserved_mb)),
            unmanaged_peak_mb=int(round(unmanaged_peak_mb)),
            effective_free_mb=int(round(effective_free_mb)),
            task_allocations=[
                GpuCardTaskReport(
                    task_id=task.task_id,
                    declared_vram_mb=task.declared_vram_mb,
                )
                for task in pmeow_tasks
            ],
            user_processes=[
                GpuCardUserProcessReport(
                    pid=process.pid,
                    user=process.user,
                    vram_mb=process.used_memory_mb,
                )
                for process in user_processes
            ],
            unknown_processes=[
                GpuCardUnknownProcessReport(
                    pid=process.pid,
                    vram_mb=process.used_memory_mb,
                )
                for process in unknown_processes
            ],
        ))

    return cards
