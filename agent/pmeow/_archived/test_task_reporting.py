"""Tests for task_reporting.py — queue report formatting."""

from __future__ import annotations

from pmeow.models import PerGpuAllocationSummary, TaskRecord, TaskStatus
from pmeow.queue.scheduler import TaskScheduleEvaluation
from pmeow.task_reporting import (
    format_gpu_overview,
    format_history_summary,
    format_launch_report,
    format_queue_paused_report,
    format_schedule_block_report,
    format_submission_report,
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
        assert "free=11.7 GB" in result

    def test_multiple_gpus(self) -> None:
        gpus = [_make_gpu(0, free=8000.0), _make_gpu(1, free=4000.0)]
        result = format_gpu_overview(gpus)
        assert "gpu0" in result
        assert "gpu1" in result
        assert "|" in result
        assert "pending=0.0 GB" in result


class TestFormatSubmissionReport:
    def test_includes_submitter_context(self) -> None:
        task = _make_task(argv=["python", "train.py", "--epochs", "3"])
        result = format_submission_report(task)
        assert "user=tester" in result
        assert "cwd=/tmp" in result
        assert "python train.py --epochs 3" in result


class TestFormatHistorySummary:
    def test_includes_min_effective_free(self) -> None:
        result = format_history_summary({0: 4096.0, 1: 8192.0})
        assert "gpu0=4.0 GB" in result
        assert "gpu1=8.0 GB" in result


class TestFormatWaitingReport:
    def test_includes_task_requirements(self) -> None:
        task = _make_task(require_gpu_count=2, require_vram_mb=4000)
        result = format_waiting_report(task, [])
        assert "2 gpu(s)" in result
        assert "3.9 GB" in result
        assert "queue probe" in result


class TestFormatQueuePausedReport:
    def test_mentions_queue_paused(self) -> None:
        task = _make_task()
        result = format_queue_paused_report(task, [_make_gpu(0)])
        assert "queue paused" in result


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


class TestFormatScheduleBlockReport:
    def test_includes_reason_and_history(self) -> None:
        task = _make_task(require_gpu_count=1, require_vram_mb=8000)
        evaluation = TaskScheduleEvaluation(
            task_id=task.id,
            can_run=False,
            reason_code="blocked_by_higher_priority",
            current_eligible_gpu_ids=[0],
            sustained_eligible_gpu_ids=[0],
            current_effective_free_mb={0: 12000.0},
            history_min_free_mb={0: 10000.0},
            pending_vram_mb={0: 8192.0},
            blocker_task_ids=["task-0"],
        )
        result = format_schedule_block_report(task, evaluation, [_make_gpu(0, free=12000.0)])
        assert "higher-priority" in result
        assert "blockers=task-0" in result
        assert "history-summary" in result
