#!/usr/bin/env python3
"""Script-5: Verify low-priority behavior under high-priority contention."""

from __future__ import annotations

import argparse
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path

from pmeow.models import PerGpuAllocationSummary, TaskSpec
from pmeow.queue.history import GpuHistoryTracker
from pmeow.queue.scheduler import QueueScheduler
from pmeow.store.database import close_database, open_database
from pmeow.store.tasks import create_task


@dataclass
class PrioritySummary:
    high_tasks: int
    low_tasks: int
    scheduled_high: int
    scheduled_low: int
    low_starvation: bool


def _sample_gpu() -> list[PerGpuAllocationSummary]:
    return [PerGpuAllocationSummary(gpu_index=0, total_memory_mb=24000, effective_free_mb=24000)]


def _temp_root() -> Path:
    root = Path(__file__).resolve().parents[2] / ".tmp" / "test_scenarios"
    root.mkdir(parents=True, exist_ok=True)
    return root


def run(high_tasks: int, low_tasks: int) -> PrioritySummary:
    with tempfile.TemporaryDirectory(prefix="pmeow-script5-", dir=_temp_root()) as td:
        conn = open_database(td)
        try:
            # Create low priority first to verify that high priority still gets picked.
            for i in range(low_tasks):
                create_task(
                    conn,
                    TaskSpec(
                        command=f"low-{i}",
                        cwd=td,
                        user="tester",
                        require_vram_mb=12000,
                        priority=20,
                    ),
                )

            for i in range(high_tasks):
                create_task(
                    conn,
                    TaskSpec(
                        command=f"high-{i}",
                        cwd=td,
                        user="tester",
                        require_vram_mb=12000,
                        priority=1,
                    ),
                )

            per_gpu = _sample_gpu()
            tracker = GpuHistoryTracker(window_seconds=120)
            now = time.time()
            tracker.record(now - 20, per_gpu)
            tracker.record(now - 10, per_gpu)

            decisions = QueueScheduler(tracker).try_schedule(conn, per_gpu)
            chosen = [d.task_id for d in decisions]

            # identify by command prefix in DB rows associated with decisions
            rows = conn.execute(
                "SELECT id, command FROM tasks WHERE id IN ({})".format(
                    ",".join("?" for _ in chosen) if chosen else "''"
                ),
                chosen,
            ).fetchall() if chosen else []

            scheduled_high = sum(1 for _, cmd in rows if cmd.startswith("high-"))
            scheduled_low = sum(1 for _, cmd in rows if cmd.startswith("low-"))

            low_starvation = low_tasks > 0 and scheduled_low == 0

            return PrioritySummary(
                high_tasks=high_tasks,
                low_tasks=low_tasks,
                scheduled_high=scheduled_high,
                scheduled_low=scheduled_low,
                low_starvation=low_starvation,
            )
        finally:
            close_database(conn)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--high-tasks", type=int, default=10)
    parser.add_argument("--low-tasks", type=int, default=5)
    args = parser.parse_args()

    result = run(high_tasks=args.high_tasks, low_tasks=args.low_tasks)
    print("=== Script-5 Priority/Fairness ===")
    for key, value in asdict(result).items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()
