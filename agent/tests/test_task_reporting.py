"""Tests for task_reporting.py — queue report formatting."""

from __future__ import annotations

from pmeow.models import PerGpuAllocationSummary, TaskRecord, TaskStatus
from pmeow.task_reporting import (
    format_gpu_overview,
    format_launch_report,
    format_waiting_report,
)


def _make_gpu(index: int, free: float = 8000.0) -> PerGpuAllocationSummary:
    return PerGpuAllocationSummary(
        gpu_index=index,
        total_memory_mb=16000.0,
        effective_free_mb=free,
    )


def _make_task(**overrides) -> TaskRecord:
    defaults = dict(
        id="task-1",
        command="echo hi",
        cwd="/tmp",
        user="tester",
        require_vram_mb=4000,
        require_gpu_count=2,
        gpu_ids=None,
        priority=10,
        status=TaskStatus.queued,
        created_at=1.0,
    )
    defaults.update(overrides)
    return TaskRecord(**defaults)


class TestFormatGpuOverview:
    def test_no_gpus_returns_fallback(self) -> None:
        result = format_gpu_overview([])
        assert "no GPU allocation data available" in result

    def test_single_gpu(self) -> None:
        gpus = [_make_gpu(0, free=12000.0)]
        result = format_gpu_overview(gpus)
        assert "gpu0" in result
        assert "free=12000MB" in result

    def test_multiple_gpus(self) -> None:
        gpus = [_make_gpu(0, free=8000.0), _make_gpu(1, free=4000.0)]
        result = format_gpu_overview(gpus)
        assert "gpu0" in result
        assert "gpu1" in result
        assert "|" in result


class TestFormatWaitingReport:
    def test_includes_task_requirements(self) -> None:
        task = _make_task(require_gpu_count=2, require_vram_mb=4000)
        result = format_waiting_report(task, [])
        assert "2 gpu(s)" in result
        assert "4000MB" in result
        assert "queue probe" in result


class TestFormatLaunchReport:
    def test_includes_selected_gpus(self) -> None:
        task = _make_task()
        result = format_launch_report(task, [0, 1], [])
        assert "0,1" in result
        assert "launch reserved" in result

    def test_cpu_only_fallback(self) -> None:
        task = _make_task()
        result = format_launch_report(task, [], [])
        assert "cpu-only" in result
