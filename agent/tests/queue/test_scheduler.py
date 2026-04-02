"""Tests for the queue scheduler and VRAM admission logic."""

from __future__ import annotations

import time

import pytest

from pmeow.models import PerGpuAllocationSummary, TaskSpec
from pmeow.queue.history import GpuHistoryTracker
from pmeow.queue.scheduler import QueueScheduler
from pmeow.store.database import open_database, close_database
from pmeow.store.tasks import create_task


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_per_gpu(free_by_gpu: dict[int, float], total: float = 24000.0) -> list[PerGpuAllocationSummary]:
    """Build a list of PerGpuAllocationSummary with given effective_free_mb."""
    return [
        PerGpuAllocationSummary(
            gpu_index=idx,
            total_memory_mb=total,
            effective_free_mb=free_mb,
        )
        for idx, free_mb in sorted(free_by_gpu.items())
    ]


@pytest.fixture()
def conn(tmp_path):
    db = open_database(tmp_path)
    yield db
    close_database(db)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestPriorityOrdering:
    def test_higher_priority_runs_first(self, conn) -> None:
        """Task with priority 1 is scheduled before priority 10."""
        low = create_task(conn, TaskSpec(
            command="low", cwd="/tmp", user="u",
            require_vram_mb=4000, require_gpu_count=1, priority=10,
        ))
        high = create_task(conn, TaskSpec(
            command="high", cwd="/tmp", user="u",
            require_vram_mb=4000, require_gpu_count=1, priority=1,
        ))

        per_gpu = _make_per_gpu({0: 20000.0})
        tracker = GpuHistoryTracker(window_seconds=120)
        now = time.time()
        tracker.record(now - 10, per_gpu)

        scheduler = QueueScheduler(tracker)
        decisions = scheduler.try_schedule(conn, per_gpu)

        # Both can fit, but high priority should be first
        assert len(decisions) >= 1
        assert decisions[0].task_id == high.id

    def test_same_priority_fifo_order(self, conn) -> None:
        """Same priority: earlier created_at first."""
        first = create_task(conn, TaskSpec(
            command="first", cwd="/tmp", user="u",
            require_vram_mb=4000, require_gpu_count=1, priority=5,
        ))
        second = create_task(conn, TaskSpec(
            command="second", cwd="/tmp", user="u",
            require_vram_mb=4000, require_gpu_count=1, priority=5,
        ))

        per_gpu = _make_per_gpu({0: 20000.0})
        tracker = GpuHistoryTracker(window_seconds=120)
        now = time.time()
        tracker.record(now - 10, per_gpu)

        scheduler = QueueScheduler(tracker)
        decisions = scheduler.try_schedule(conn, per_gpu)

        assert len(decisions) >= 1
        assert decisions[0].task_id == first.id


class TestSustainedAvailability:
    def test_insufficient_sustained_history_blocks(self, conn) -> None:
        """One sample in history has insufficient free memory → task blocked."""
        task = create_task(conn, TaskSpec(
            command="big", cwd="/tmp", user="u",
            require_vram_mb=8000, require_gpu_count=1, priority=1,
        ))

        now = time.time()
        good_sample = _make_per_gpu({0: 10000.0})
        bad_sample = _make_per_gpu({0: 5000.0})  # < 8000 required

        tracker = GpuHistoryTracker(window_seconds=120)
        tracker.record(now - 20, good_sample)
        tracker.record(now - 10, bad_sample)

        scheduler = QueueScheduler(tracker)
        decisions = scheduler.try_schedule(conn, good_sample)

        assert len(decisions) == 0

    def test_all_samples_pass_allows_start(self, conn) -> None:
        """All history samples have enough → task scheduled."""
        task = create_task(conn, TaskSpec(
            command="ok", cwd="/tmp", user="u",
            require_vram_mb=8000, require_gpu_count=1, priority=1,
        ))

        now = time.time()
        sample = _make_per_gpu({0: 10000.0})

        tracker = GpuHistoryTracker(window_seconds=120)
        tracker.record(now - 20, sample)
        tracker.record(now - 10, sample)

        scheduler = QueueScheduler(tracker)
        decisions = scheduler.try_schedule(conn, sample)

        assert len(decisions) == 1
        assert decisions[0].task_id == task.id
        assert decisions[0].gpu_ids == [0]


class TestReservations:
    def test_reservations_prevent_double_allocation(self, conn) -> None:
        """Two tasks each need 12000 MB on 1 GPU with 20000 MB free.
        First gets scheduled, second doesn't (only 8000 left)."""
        t1 = create_task(conn, TaskSpec(
            command="t1", cwd="/tmp", user="u",
            require_vram_mb=12000, require_gpu_count=1, priority=1,
        ))
        t2 = create_task(conn, TaskSpec(
            command="t2", cwd="/tmp", user="u",
            require_vram_mb=12000, require_gpu_count=1, priority=2,
        ))

        per_gpu = _make_per_gpu({0: 20000.0})
        tracker = GpuHistoryTracker(window_seconds=120)
        now = time.time()
        tracker.record(now - 10, per_gpu)

        scheduler = QueueScheduler(tracker)
        decisions = scheduler.try_schedule(conn, per_gpu)

        assert len(decisions) == 1
        assert decisions[0].task_id == t1.id


class TestMultiGpu:
    def test_multi_gpu_requirement(self, conn) -> None:
        """Task needs 2 GPUs, 3 available, picks best 2 (most free)."""
        task = create_task(conn, TaskSpec(
            command="multi", cwd="/tmp", user="u",
            require_vram_mb=6000, require_gpu_count=2, priority=1,
        ))

        # GPU 0: 7000 free, GPU 1: 10000 free, GPU 2: 8000 free
        per_gpu = _make_per_gpu({0: 7000.0, 1: 10000.0, 2: 8000.0})
        tracker = GpuHistoryTracker(window_seconds=120)
        now = time.time()
        tracker.record(now - 10, per_gpu)

        scheduler = QueueScheduler(tracker)
        decisions = scheduler.try_schedule(conn, per_gpu)

        assert len(decisions) == 1
        assert decisions[0].task_id == task.id
        # Should pick GPU 1 (10000) and GPU 2 (8000) — the two with most free
        assert set(decisions[0].gpu_ids) == {1, 2}
