#!/usr/bin/env python3
"""Script-1: Validate same-time scheduling and shared-resource conflict behavior."""

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
class Result:
    mode: str
    total_tasks: int
    scheduled_tasks: int
    blocked_tasks: int
    scheduled_task_ids: list[str]


def _per_gpu(free_mb: float) -> list[PerGpuAllocationSummary]:
    return [
        PerGpuAllocationSummary(
            gpu_index=0,
            total_memory_mb=24000,
            effective_free_mb=free_mb,
        )
    ]


def _temp_root() -> Path:
    root = Path(__file__).resolve().parents[2] / ".tmp" / "test_scenarios"
    root.mkdir(parents=True, exist_ok=True)
    return root


def run(mode: str) -> Result:
    with tempfile.TemporaryDirectory(prefix="pmeow-script1-", dir=_temp_root()) as td:
        conn = open_database(td)
        try:
            if mode == "no_conflict":
                specs = [
                    TaskSpec(command="task-a", cwd=td, user="tester", require_vram_mb=8000, priority=5),
                    TaskSpec(command="task-b", cwd=td, user="tester", require_vram_mb=8000, priority=5),
                ]
            else:
                specs = [
                    TaskSpec(command="task-a", cwd=td, user="tester", require_vram_mb=13000, priority=5),
                    TaskSpec(command="task-b", cwd=td, user="tester", require_vram_mb=13000, priority=5),
                ]

            created = [create_task(conn, spec) for spec in specs]
            per_gpu = _per_gpu(24000)
            tracker = GpuHistoryTracker(window_seconds=120)
            now = time.time()
            tracker.record(now - 10, per_gpu)

            decisions = QueueScheduler(tracker).try_schedule(conn, per_gpu)
            scheduled_ids = [d.task_id for d in decisions]

            return Result(
                mode=mode,
                total_tasks=len(created),
                scheduled_tasks=len(scheduled_ids),
                blocked_tasks=len(created) - len(scheduled_ids),
                scheduled_task_ids=scheduled_ids,
            )
        finally:
            close_database(conn)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=["no_conflict", "shared_conflict"],
        default="shared_conflict",
        help="Test mode: non-conflicting tasks or shared-resource conflict tasks.",
    )
    args = parser.parse_args()

    result = run(args.mode)
    print("=== Script-1 Concurrent/Conflict Result ===")
    for k, v in asdict(result).items():
        print(f"{k}: {v}")


if __name__ == "__main__":
    main()
