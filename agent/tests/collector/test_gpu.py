"""Tests for GPU collection and attribution (mocked – no real GPU required)."""

from __future__ import annotations

import subprocess
from unittest.mock import patch

import pytest

from pmeow.collector.gpu import collect_gpu
from pmeow.collector.gpu_attribution import (
    attribute_gpu_processes,
    calculate_effective_free,
)
from pmeow.models import (
    GpuProcessInfo,
    GpuTaskAllocation,
    GpuUnknownProcess,
    GpuUserProcess,
    TaskLaunchMode,
    TaskRecord,
    TaskStatus,
)


def _make_task(task_id: str, pid: int, vram: int = 8000, gpu_ids=None) -> TaskRecord:
    return TaskRecord(
        id=task_id,
        status=TaskStatus.running,
        command="train.py",
        cwd="/tmp",
        user="alice",
        launch_mode=TaskLaunchMode.background,
        require_vram_mb=vram,
        require_gpu_count=1,
        gpu_ids=gpu_ids or [0],
        priority=10,
        created_at=0.0,
        pid=pid,
    )


def test_collect_gpu_file_not_found():
    with patch("pmeow.collector.gpu.subprocess.run", side_effect=FileNotFoundError):
        snap = collect_gpu()
    assert snap.available is False
    assert snap.gpu_count == 0


def test_two_gpus():
    csv = "24576, 1200, 45, 60\n24576, 800, 30, 55\n"
    ok = subprocess.CompletedProcess([], 0, stdout=csv, stderr="")
    with patch("pmeow.collector.gpu.subprocess.run", return_value=ok):
        snap = collect_gpu()
    assert snap.available is True
    assert snap.gpu_count == 2
    assert snap.total_memory_mb == 24576.0 + 24576.0
    assert snap.used_memory_mb == 1200.0 + 800.0


def test_matching_pid():
    task = _make_task("task-1", pid=1234, vram=8000)
    proc = GpuProcessInfo(pid=1234, gpu_index=0, used_memory_mb=6500.0, process_name="")
    summary = attribute_gpu_processes(
        gpu_processes=[proc],
        running_tasks=[task],
        per_gpu_memory={0: 24000.0},
    )
    assert len(summary.per_gpu) == 1
    alloc = summary.per_gpu[0].pmeow_tasks[0]
    assert isinstance(alloc, GpuTaskAllocation)
    assert alloc.task_id == "task-1"
    assert alloc.declared_vram_mb == 8000
    assert alloc.actual_vram_mb == 6500.0


def test_known_values():
    pmeow = [GpuTaskAllocation(task_id="t1", gpu_index=0,
                                declared_vram_mb=8000, actual_vram_mb=6000.0)]
    user = [GpuUserProcess(pid=100, user="bob", gpu_index=0,
                           used_memory_mb=4000.0, command="train")]
    result = calculate_effective_free(
        total_memory_mb=24000.0,
        pmeow_tasks=pmeow,
        user_processes=user,
        unknown_processes=[],
        redundancy_coefficient=0.1,
    )
    assert result == pytest.approx(11600.0)
