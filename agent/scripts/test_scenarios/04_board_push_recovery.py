#!/usr/bin/env python3
"""Script-4: Verify push retry/recovery semantics using AgentTransportClient offline buffer."""

from __future__ import annotations

import argparse
from dataclasses import dataclass

from pmeow.models import TaskStatus, TaskUpdate
from pmeow.transport.client import AgentTransportClient


class _FlakySocket:
    def __init__(self, fail_first_n: int) -> None:
        self.fail_first_n = fail_first_n
        self.emit_calls = 0
        self.sent: list[tuple[str, dict]] = []

    def emit(self, event: str, data: dict, namespace: str) -> None:
        self.emit_calls += 1
        if self.emit_calls <= self.fail_first_n:
            raise RuntimeError("simulated network failure")
        self.sent.append((event, data))


@dataclass
class RecoveryResult:
    fail_first_n: int
    buffered_before_recovery: int
    sent_after_recovery: int
    remaining_buffer: int


def run(fail_first_n: int) -> RecoveryResult:
    client = AgentTransportClient(server_url="http://localhost:17200", agent_id="agent-test")
    flaky = _FlakySocket(fail_first_n=fail_first_n)

    client._client = flaky  # type: ignore[attr-defined]
    client._connected = True  # type: ignore[attr-defined]

    updates = [
        TaskUpdate(task_id="task-1", status=TaskStatus.running, started_at=1.0),
        TaskUpdate(task_id="task-1", status=TaskStatus.completed, finished_at=2.0, exit_code=0),
    ]
    for update in updates:
        client.send_task_update(update)

    buffered_before = len(client._buffer)  # type: ignore[attr-defined]

    # Recover network: all subsequent emits succeed.
    flaky.fail_first_n = 0
    client._flush_buffer()  # type: ignore[attr-defined]

    return RecoveryResult(
        fail_first_n=fail_first_n,
        buffered_before_recovery=buffered_before,
        sent_after_recovery=len(flaky.sent),
        remaining_buffer=len(client._buffer),  # type: ignore[attr-defined]
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fail-first-n", type=int, default=1)
    args = parser.parse_args()

    result = run(args.fail_first_n)
    print("=== Script-4 Push Recovery ===")
    for field, value in result.__dict__.items():
        print(f"{field}: {value}")


if __name__ == "__main__":
    main()
