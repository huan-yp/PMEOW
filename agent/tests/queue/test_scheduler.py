"""Tests for the queue scheduler and dual-ledger GPU admission logic."""

from __future__ import annotations

import time

import pytest

from pmeow.models import (
    GpuTaskAllocation,
    GpuUserProcess,
    PerGpuAllocationSummary,
    TaskSpec,
)
from pmeow.queue.history import GpuHistoryTracker
from pmeow.queue.scheduler import (
    IDLE_UTILIZATION_THRESHOLD,
    IDLE_VRAM_UTILIZATION_THRESHOLD,
    QueueScheduler,
    validate_request_possible,
)
from pmeow.store.database import open_database, close_database
from pmeow.store.tasks import create_task


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_per_gpu(
    free_by_gpu: dict[int, float],
    total: float = 24000.0,
    *,
    pmeow_tasks: dict[int, list[GpuTaskAllocation]] | None = None,
    user_processes: dict[int, list[GpuUserProcess]] | None = None,
    utilization: dict[int, float] | None = None,
    used_memory: dict[int, float] | None = None,
) -> list[PerGpuAllocationSummary]:
    """Build a list of PerGpuAllocationSummary with given effective_free_mb."""
    return [
        PerGpuAllocationSummary(
            gpu_index=idx,
            total_memory_mb=total,
            effective_free_mb=free_mb,
            pmeow_tasks=(pmeow_tasks or {}).get(idx, []),
            user_processes=(user_processes or {}).get(idx, []),
            utilization_percent=(utilization or {}).get(idx, 0.0),
            used_memory_mb=(used_memory or {}).get(idx, 0.0),
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
        result = scheduler.try_schedule(conn, per_gpu)
        decisions = result.decisions

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
        result = scheduler.try_schedule(conn, per_gpu)
        decisions = result.decisions

        assert len(decisions) >= 1
        assert decisions[0].task_id == first.id


class TestSustainedAvailability:
    def test_insufficient_sustained_history_blocks(self, conn) -> None:
        """One sample in history has unmanaged usage that leaves < 8g free → task blocked."""
        task = create_task(conn, TaskSpec(
            command="big", cwd="/tmp", user="u",
            require_vram_mb=8000, require_gpu_count=1, priority=1,
        ))

        now = time.time()
        good_sample = _make_per_gpu({0: 10000.0}, total=24000.0)
        # Bad sample: user process uses enough to leave < 8g free
        # schedulable = 24000 * 0.98 = 23520
        # need unmanaged_peak * 1.05 > 23520 - 8000 = 15520
        # so unmanaged > 15520 / 1.05 ≈ 14781
        bad_sample = _make_per_gpu(
            {0: 5000.0},
            total=24000.0,
            user_processes={0: [GpuUserProcess(
                pid=9999, user="bob", gpu_index=0,
                used_memory_mb=16000, command="train.py",
            )]},
            used_memory={0: 16000.0},
        )

        tracker = GpuHistoryTracker(window_seconds=120)
        tracker.record(now - 20, good_sample)
        tracker.record(now - 10, bad_sample)

        scheduler = QueueScheduler(tracker)
        result = scheduler.try_schedule(conn, good_sample)
        decisions = result.decisions

        assert len(decisions) == 0
        assert result.evaluations[0].reason_code == "insufficient_gpu_count"

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
        result = scheduler.try_schedule(conn, sample)
        decisions = result.decisions

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
        result = scheduler.try_schedule(conn, per_gpu)
        decisions = result.decisions

        assert len(decisions) == 1
        assert decisions[0].task_id == t1.id
        blocked = [evaluation for evaluation in result.evaluations if not evaluation.can_run]
        assert blocked[0].reason_code == "blocked_by_higher_priority"
        assert blocked[0].blocker_task_ids == [t1.id]


class TestMultiGpu:
    def test_multi_gpu_requirement(self, conn) -> None:
        """Task needs 2 GPUs, 3 available, picks best 2 (most effective free)."""
        task = create_task(conn, TaskSpec(
            command="multi", cwd="/tmp", user="u",
            require_vram_mb=6000, require_gpu_count=2, priority=1,
        ))

        # Create different unmanaged usage to differentiate effective_free:
        # GPU 0: 17000 user usage → unmanaged_peak = 17000*1.05 = 17850 → eff = 23520-17850 = 5670
        # GPU 1: 0 user usage → eff = 23520
        # GPU 2: 10000 user usage → unmanaged_peak = 10500 → eff = 23520-10500 = 13020
        per_gpu = _make_per_gpu(
            {0: 7000.0, 1: 24000.0, 2: 14000.0},
            total=24000.0,
            user_processes={
                0: [GpuUserProcess(pid=100, user="u", gpu_index=0, used_memory_mb=17000, command="")],
                2: [GpuUserProcess(pid=102, user="u", gpu_index=2, used_memory_mb=10000, command="")],
            },
            used_memory={0: 17000.0, 2: 10000.0},
        )
        tracker = GpuHistoryTracker(window_seconds=120)
        now = time.time()
        tracker.record(now - 10, per_gpu)

        scheduler = QueueScheduler(tracker)
        result = scheduler.try_schedule(conn, per_gpu)
        decisions = result.decisions

        assert len(decisions) == 1
        assert decisions[0].task_id == task.id
        # Should pick GPU 1 (23520 free) and GPU 2 (13020 free) — the two with most eff free
        assert set(decisions[0].gpu_ids) == {1, 2}


# ---------------------------------------------------------------------------
# Dual-ledger tests (spec-required scenarios)
# ---------------------------------------------------------------------------


class TestManagedReservationAuthority:
    """Scenario 1: Declared-large, observed-small managed reservation still blocks."""

    def test_large_declared_small_observed_blocks_later_task(self, conn) -> None:
        """On 4 × 24GB GPUs, first task reserves 2 GPUs at 21g.
        Later task requests 2 GPUs at 8g.  Even if observed usage is low,
        the declared 21g blocks capacity."""
        # First task already running on GPU 0 and 1 with 21g declared each
        managed_0 = GpuTaskAllocation(
            task_id="running-1", gpu_index=0, declared_vram_mb=21000, actual_vram_mb=2000,
        )
        managed_1 = GpuTaskAllocation(
            task_id="running-1", gpu_index=1, declared_vram_mb=21000, actual_vram_mb=2000,
        )
        per_gpu = _make_per_gpu(
            {0: 3000.0, 1: 3000.0, 2: 24000.0, 3: 24000.0},
            total=24000.0,
            pmeow_tasks={0: [managed_0], 1: [managed_1]},
        )
        # Second task wants 2 GPUs at 8g — GPU 0,1 only have ~3g free (24*0.98-21=2520 actual)
        t2 = create_task(conn, TaskSpec(
            command="t2", cwd="/tmp", user="u",
            require_vram_mb=8000, require_gpu_count=2, priority=1,
        ))

        tracker = GpuHistoryTracker(window_seconds=120)
        now = time.time()
        tracker.record(now - 10, per_gpu)

        scheduler = QueueScheduler(tracker)
        result = scheduler.try_schedule(conn, per_gpu)

        # t2 should be scheduled on GPU 2 and 3 (the free ones), not on 0/1
        assert len(result.decisions) == 1
        assert set(result.decisions[0].gpu_ids) == {2, 3}

    def test_managed_blocks_when_not_enough_free_gpus(self, conn) -> None:
        """2 GPUs, both with managed tasks declaring 21g.  New 8g task blocked."""
        managed_0 = GpuTaskAllocation(
            task_id="r1", gpu_index=0, declared_vram_mb=21000, actual_vram_mb=1000,
        )
        managed_1 = GpuTaskAllocation(
            task_id="r2", gpu_index=1, declared_vram_mb=21000, actual_vram_mb=1000,
        )
        per_gpu = _make_per_gpu(
            {0: 3000.0, 1: 3000.0},
            total=24000.0,
            pmeow_tasks={0: [managed_0], 1: [managed_1]},
        )
        create_task(conn, TaskSpec(
            command="wait", cwd="/tmp", user="u",
            require_vram_mb=8000, require_gpu_count=1, priority=1,
        ))

        tracker = GpuHistoryTracker(window_seconds=120)
        now = time.time()
        tracker.record(now - 10, per_gpu)

        result = QueueScheduler(tracker).try_schedule(conn, per_gpu)
        assert len(result.decisions) == 0
        assert result.evaluations[0].can_run is False


class TestImpossibleRequest:
    """Scenario 2: Physically impossible requests fail immediately."""

    def test_gpu_count_exceeds_physical(self) -> None:
        per_gpu = _make_per_gpu({0: 24000.0, 1: 24000.0})
        err = validate_request_possible(per_gpu, require_gpu_count=3, require_vram_mb=8000)
        assert err is not None
        assert "3 GPUs" in err
        assert "2" in err

    def test_vram_exceeds_physical(self) -> None:
        per_gpu = _make_per_gpu({0: 24000.0, 1: 24000.0})
        # 24000 * 0.98 = 23520 — request 25000 per GPU
        err = validate_request_possible(per_gpu, require_gpu_count=1, require_vram_mb=25000)
        assert err is not None
        assert "physical VRAM" in err

    def test_valid_request_passes(self) -> None:
        per_gpu = _make_per_gpu({0: 24000.0, 1: 24000.0})
        err = validate_request_possible(per_gpu, require_gpu_count=2, require_vram_mb=20000)
        assert err is None


class TestExclusiveOwnership:
    """Scenario 3: vram=0 behaves as strict GPU exclusivity."""

    def test_exclusive_task_blocks_later_tasks(self, conn) -> None:
        """First task is exclusive (vram=0), second shared task cannot use same GPU."""
        t1 = create_task(conn, TaskSpec(
            command="exclusive", cwd="/tmp", user="u",
            require_vram_mb=0, require_gpu_count=1, priority=1,
        ))
        t2 = create_task(conn, TaskSpec(
            command="shared", cwd="/tmp", user="u",
            require_vram_mb=4000, require_gpu_count=1, priority=2,
        ))

        per_gpu = _make_per_gpu({0: 24000.0})
        tracker = GpuHistoryTracker(window_seconds=120)
        now = time.time()
        tracker.record(now - 10, per_gpu)

        result = QueueScheduler(tracker).try_schedule(conn, per_gpu)
        assert len(result.decisions) == 1
        assert result.decisions[0].task_id == t1.id
        blocked = [e for e in result.evaluations if not e.can_run]
        assert len(blocked) == 1
        assert blocked[0].task_id == t2.id

    def test_exclusive_requires_idle_gpu(self, conn) -> None:
        """GPU with existing managed task (shared) is not eligible for exclusive."""
        managed = GpuTaskAllocation(
            task_id="existing", gpu_index=0, declared_vram_mb=8000, actual_vram_mb=4000,
        )
        per_gpu = _make_per_gpu(
            {0: 16000.0},
            total=24000.0,
            pmeow_tasks={0: [managed]},
        )
        create_task(conn, TaskSpec(
            command="excl", cwd="/tmp", user="u",
            require_vram_mb=0, require_gpu_count=1, priority=1,
        ))

        tracker = GpuHistoryTracker(window_seconds=120)
        now = time.time()
        tracker.record(now - 10, per_gpu)

        result = QueueScheduler(tracker).try_schedule(conn, per_gpu)
        assert len(result.decisions) == 0


class TestExclusiveIdleChecks:
    """Scenario 4: Exclusive idle checks use managed-current and unmanaged-history."""

    def test_managed_reservation_makes_gpu_non_idle(self, conn) -> None:
        """A GPU with any managed reservation is not idle for exclusive tasks."""
        managed = GpuTaskAllocation(
            task_id="running", gpu_index=0, declared_vram_mb=1000, actual_vram_mb=100,
        )
        per_gpu = _make_per_gpu(
            {0: 23000.0, 1: 24000.0},
            total=24000.0,
            pmeow_tasks={0: [managed]},
        )
        create_task(conn, TaskSpec(
            command="excl", cwd="/tmp", user="u",
            require_vram_mb=0, require_gpu_count=1, priority=1,
        ))

        tracker = GpuHistoryTracker(window_seconds=120)
        now = time.time()
        tracker.record(now - 10, per_gpu)

        result = QueueScheduler(tracker).try_schedule(conn, per_gpu)
        # Should be scheduled on GPU 1 (the one without managed reservation)
        assert len(result.decisions) == 1
        assert result.decisions[0].gpu_ids == [1]

    def test_unmanaged_history_above_threshold_blocks_exclusive(self, conn) -> None:
        """GPU with unmanaged usage above idle threshold in history is not idle."""
        # History sample: GPU 0 had significant user process memory
        history_gpu = _make_per_gpu(
            {0: 20000.0},
            total=24000.0,
            user_processes={0: [GpuUserProcess(
                pid=9999, user="bob", gpu_index=0,
                used_memory_mb=2000, command="train.py",
            )]},
            used_memory={0: 2000.0},
        )
        # Current: GPU 0 is now empty
        current_gpu = _make_per_gpu({0: 24000.0}, total=24000.0)

        create_task(conn, TaskSpec(
            command="excl", cwd="/tmp", user="u",
            require_vram_mb=0, require_gpu_count=1, priority=1,
        ))

        tracker = GpuHistoryTracker(window_seconds=120)
        now = time.time()
        tracker.record(now - 10, history_gpu)

        result = QueueScheduler(tracker).try_schedule(conn, current_gpu)
        # Should be blocked because history window has unmanaged usage
        assert len(result.decisions) == 0


class TestSharedDualLedger:
    """Scenario 5: Shared-capacity checks subtract both ledgers."""

    def test_both_ledgers_reduce_capacity(self, conn) -> None:
        """managed_reserved + unmanaged_peak both reduce schedulable capacity."""
        # GPU 0: managed 12g declared, plus user process using 6g in history
        managed = GpuTaskAllocation(
            task_id="r1", gpu_index=0, declared_vram_mb=12000, actual_vram_mb=8000,
        )
        history_gpu = _make_per_gpu(
            {0: 12000.0},
            total=24000.0,
            pmeow_tasks={0: [managed]},
            user_processes={0: [GpuUserProcess(
                pid=1234, user="bob", gpu_index=0,
                used_memory_mb=6000, command="app",
            )]},
            used_memory={0: 14000.0},
        )
        current_gpu = _make_per_gpu(
            {0: 12000.0},
            total=24000.0,
            pmeow_tasks={0: [managed]},
        )

        # schedulable = 24000 * 0.98 = 23520
        # managed = 12000
        # unmanaged_peak = 6000 * 1.05 = 6300
        # effective_free = 23520 - 12000 - 6300 = 5220
        create_task(conn, TaskSpec(
            command="big", cwd="/tmp", user="u",
            require_vram_mb=6000, require_gpu_count=1, priority=1,
        ))

        tracker = GpuHistoryTracker(window_seconds=120)
        now = time.time()
        tracker.record(now - 10, history_gpu)

        result = QueueScheduler(tracker).try_schedule(conn, current_gpu)
        # 6000 > 5220, should be blocked
        assert len(result.decisions) == 0

    def test_fits_when_both_ledgers_leave_room(self, conn) -> None:
        managed = GpuTaskAllocation(
            task_id="r1", gpu_index=0, declared_vram_mb=8000, actual_vram_mb=4000,
        )
        history_gpu = _make_per_gpu(
            {0: 16000.0},
            total=24000.0,
            pmeow_tasks={0: [managed]},
            user_processes={0: [GpuUserProcess(
                pid=1234, user="bob", gpu_index=0,
                used_memory_mb=2000, command="app",
            )]},
            used_memory={0: 10000.0},
        )
        current_gpu = _make_per_gpu(
            {0: 16000.0},
            total=24000.0,
            pmeow_tasks={0: [managed]},
        )

        # schedulable = 23520
        # managed = 8000
        # unmanaged_peak = 2000 * 1.05 = 2100
        # effective_free = 23520 - 8000 - 2100 = 13420
        create_task(conn, TaskSpec(
            command="small", cwd="/tmp", user="u",
            require_vram_mb=10000, require_gpu_count=1, priority=1,
        ))

        tracker = GpuHistoryTracker(window_seconds=120)
        now = time.time()
        tracker.record(now - 10, history_gpu)

        result = QueueScheduler(tracker).try_schedule(conn, current_gpu)
        assert len(result.decisions) == 1


class TestIdleThresholdBoundary:
    """Scenario 6: Idle threshold boundary coverage."""

    def test_below_threshold_is_idle(self, conn) -> None:
        """utilization < 3% AND vram_util < 3% → idle → exclusive allowed."""
        per_gpu = _make_per_gpu(
            {0: 24000.0},
            total=24000.0,
            utilization={0: 2.9},
            used_memory={0: 24000.0 * 0.029},  # 2.9% VRAM util
        )
        create_task(conn, TaskSpec(
            command="excl", cwd="/tmp", user="u",
            require_vram_mb=0, require_gpu_count=1, priority=1,
        ))

        tracker = GpuHistoryTracker(window_seconds=120)
        now = time.time()
        tracker.record(now - 10, per_gpu)

        result = QueueScheduler(tracker).try_schedule(conn, per_gpu)
        assert len(result.decisions) == 1

    def test_at_threshold_is_not_idle(self, conn) -> None:
        """utilization >= 3% → not idle → exclusive blocked."""
        per_gpu = _make_per_gpu(
            {0: 24000.0},
            total=24000.0,
            utilization={0: 3.0},
            used_memory={0: 0.0},
        )
        create_task(conn, TaskSpec(
            command="excl", cwd="/tmp", user="u",
            require_vram_mb=0, require_gpu_count=1, priority=1,
        ))

        tracker = GpuHistoryTracker(window_seconds=120)
        now = time.time()
        tracker.record(now - 10, per_gpu)

        result = QueueScheduler(tracker).try_schedule(conn, per_gpu)
        assert len(result.decisions) == 0

    def test_vram_at_threshold_is_not_idle(self, conn) -> None:
        """VRAM utilization >= 3% → not idle → exclusive blocked."""
        vram_used = 24000.0 * 0.03  # exactly 3%
        per_gpu = _make_per_gpu(
            {0: 24000.0},
            total=24000.0,
            utilization={0: 0.0},
            used_memory={0: vram_used},
        )
        create_task(conn, TaskSpec(
            command="excl", cwd="/tmp", user="u",
            require_vram_mb=0, require_gpu_count=1, priority=1,
        ))

        tracker = GpuHistoryTracker(window_seconds=120)
        now = time.time()
        tracker.record(now - 10, per_gpu)

        result = QueueScheduler(tracker).try_schedule(conn, per_gpu)
        assert len(result.decisions) == 0


class TestEvaluationLedgerSnapshot:
    """Verify evaluations carry gpu_ledgers for audit consumption."""

    def test_evaluation_contains_gpu_ledgers(self, conn) -> None:
        create_task(conn, TaskSpec(
            command="t", cwd="/tmp", user="u",
            require_vram_mb=4000, require_gpu_count=1, priority=1,
        ))
        per_gpu = _make_per_gpu({0: 20000.0})
        tracker = GpuHistoryTracker(window_seconds=120)
        now = time.time()
        tracker.record(now - 10, per_gpu)

        result = QueueScheduler(tracker).try_schedule(conn, per_gpu)
        assert len(result.evaluations) == 1
        ev = result.evaluations[0]
        assert len(ev.gpu_ledgers) == 1
        ledger = ev.gpu_ledgers[0]
        assert "managed_reserved_mb" in ledger
        assert "unmanaged_peak_mb" in ledger
        assert "exclusive_owner" in ledger
