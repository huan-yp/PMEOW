#!/usr/bin/env python3
"""Script-2: Burst-schedule many tasks and summarize stability metrics."""

from __future__ import annotations

import argparse
import statistics
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
class StabilitySummary:
    total_tasks: int
    scheduled_tasks: int
    unscheduled_tasks: int
    success_rate: float
    avg_wait_seconds: float
    max_wait_seconds: float


def _per_gpu(gpu_count: int, free_per_gpu_mb: float) -> list[PerGpuAllocationSummary]:
    return [
        PerGpuAllocationSummary(
            gpu_index=i,
            total_memory_mb=24000,
            effective_free_mb=free_per_gpu_mb,
        )
        for i in range(gpu_count)
    ]


def _temp_root() -> Path:
    root = Path(__file__).resolve().parents[2] / ".tmp" / "test_scenarios"
    root.mkdir(parents=True, exist_ok=True)
    return root


def run(task_count: int, gpu_count: int, required_vram_mb: int) -> StabilitySummary:
    with tempfile.TemporaryDirectory(prefix="pmeow-script2-", dir=_temp_root()) as td:
        conn = open_database(td)
        try:
            submit_ts: list[float] = []
            for i in range(task_count):
                submit_ts.append(time.time())
                create_task(
                    conn,
                    TaskSpec(
                        command=f"task-{i}",
                        cwd=td,
                        user="tester",
                        require_vram_mb=required_vram_mb,
                        priority=5,
                    ),
                )

            per_gpu = _per_gpu(gpu_count=gpu_count, free_per_gpu_mb=24000)
            tracker = GpuHistoryTracker(window_seconds=120)
            now = time.time()
            tracker.record(now - 10, per_gpu)
            decisions = QueueScheduler(tracker).try_schedule(conn, per_gpu)

            wait_samples = [max(now - ts, 0) for ts in submit_ts]
            scheduled = len(decisions)
            total = task_count

            return StabilitySummary(
                total_tasks=total,
                scheduled_tasks=scheduled,
                unscheduled_tasks=total - scheduled,
                success_rate=(scheduled / total) if total else 1.0,
                avg_wait_seconds=statistics.mean(wait_samples) if wait_samples else 0.0,
                max_wait_seconds=max(wait_samples) if wait_samples else 0.0,
            )
        finally:
            close_database(conn)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task-count", type=int, default=100)
    parser.add_argument("--gpu-count", type=int, default=4)
    parser.add_argument("--required-vram-mb", type=int, default=8000)
    args = parser.parse_args()

    summary = run(args.task_count, args.gpu_count, args.required_vram_mb)
    print("=== Script-2 High-Concurrency Stability Summary ===")
    for k, v in asdict(summary).items():
        print(f"{k}: {v}")


if __name__ == "__main__":
    main()
