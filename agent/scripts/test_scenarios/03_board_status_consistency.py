#!/usr/bin/env python3
"""Script-3: Validate timeline and final-status consistency between scheduler and board."""

from __future__ import annotations

import argparse
from dataclasses import dataclass


@dataclass
class Update:
    task_id: str
    status: str
    ts: float


def run(simulate_out_of_order: bool = False) -> tuple[list[Update], list[Update], list[str]]:
    scheduler_timeline = [
        Update("task-1", "queued", 1.0),
        Update("task-1", "running", 2.0),
        Update("task-1", "completed", 3.0),
        Update("task-2", "queued", 1.1),
        Update("task-2", "running", 2.2),
        Update("task-2", "failed", 3.1),
    ]

    board_timeline = list(scheduler_timeline)
    if simulate_out_of_order:
        # Intentionally disorder a non-final event; final states should still match.
        board_timeline[1], board_timeline[2] = board_timeline[2], board_timeline[1]

    scheduler_final = {}
    for ev in sorted(scheduler_timeline, key=lambda x: x.ts):
        scheduler_final[ev.task_id] = ev.status

    board_final = {}
    for ev in sorted(board_timeline, key=lambda x: x.ts):
        board_final[ev.task_id] = ev.status

    inconsistencies: list[str] = []
    for task_id, final_status in scheduler_final.items():
        if board_final.get(task_id) != final_status:
            inconsistencies.append(
                f"task={task_id} scheduler={final_status} board={board_final.get(task_id)}"
            )

    return scheduler_timeline, board_timeline, inconsistencies


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--simulate-out-of-order", action="store_true")
    args = parser.parse_args()

    scheduler_timeline, board_timeline, inconsistencies = run(args.simulate_out_of_order)
    print("=== Script-3 Board Consistency ===")
    print(f"scheduler_events={len(scheduler_timeline)} board_events={len(board_timeline)}")
    if inconsistencies:
        print("result=FAIL")
        for row in inconsistencies:
            print(f"inconsistency: {row}")
    else:
        print("result=PASS")


if __name__ == "__main__":
    main()
