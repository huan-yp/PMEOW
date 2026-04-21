"""Foreground mode CLI — parse PMEOW flags, submit attached task, wait, launch."""

from __future__ import annotations

import os
import shlex
import sys
import time
from dataclasses import dataclass
from typing import BinaryIO


@dataclass
class ForegroundInvocation:
    socket_path: str | None
    require_vram_mb: int
    require_gpu_count: int
    priority: int
    task_name: str | None
    argv: list[str]


def parse_vram_mb(value: str) -> int:
    """Parse a VRAM size like '10g', '512m', or '1024' (MB) to integer MB."""
    raw = value.strip().lower()
    if raw.endswith("g"):
        return int(float(raw[:-1]) * 1024)
    if raw.endswith("m"):
        return int(float(raw[:-1]))
    return int(float(raw))


_KNOWN_SUBCOMMANDS = frozenset({
    "run", "daemon", "start", "stop", "restart", "is-running",
    "install-service", "uninstall-service", "status", "cancel",
    "logs", "submit", "tasks",
})

# PMEOW flags that consume a following value token.
_VALUE_FLAGS = {"--vram", "--gpus", "--priority", "--socket", "--name"}


def detect_foreground_invocation(argv: list[str]) -> ForegroundInvocation | None:
    """Detect foreground mode in argv. Returns None if argv is a normal subcommand.

    Rules:
    - If the first token is a known subcommand or help/version flag, return None.
    - Tokens before the first non-PMEOW token are PMEOW flags (only standard
      ``--flag value`` form is accepted).
    - The first token that is not a recognised PMEOW flag marks the start of
      the user command; everything from that token onward is passed through
      verbatim.
    """
    if not argv or argv[0] in _KNOWN_SUBCOMMANDS or argv[0] in {"-h", "--help", "--version"}:
        return None

    socket_path: str | None = None
    require_vram_mb = 0
    require_gpu_count = 1
    priority = 10
    task_name: str | None = None

    index = 0
    while index < len(argv):
        token = argv[index]

        # As soon as we hit a token that is not a known PMEOW flag, the rest
        # is the user command.
        if token == "--vram":
            index += 1
            if index >= len(argv):
                raise SystemExit("error: --vram requires a value")
            require_vram_mb = parse_vram_mb(argv[index])
        elif token.startswith("--vram="):
            require_vram_mb = parse_vram_mb(token.split("=", 1)[1])
        elif token == "--gpus":
            index += 1
            if index >= len(argv):
                raise SystemExit("error: --gpus requires a value")
            require_gpu_count = int(argv[index])
        elif token.startswith("--gpus="):
            require_gpu_count = int(token.split("=", 1)[1])
        elif token == "--priority":
            index += 1
            if index >= len(argv):
                raise SystemExit("error: --priority requires a value")
            priority = int(argv[index])
        elif token.startswith("--priority="):
            priority = int(token.split("=", 1)[1])
        elif token == "--socket":
            index += 1
            if index >= len(argv):
                raise SystemExit("error: --socket requires a value")
            socket_path = argv[index]
        elif token.startswith("--socket="):
            socket_path = token.split("=", 1)[1]
        elif token == "--name":
            index += 1
            if index >= len(argv):
                raise SystemExit("error: --name requires a value")
            task_name = argv[index]
        elif token.startswith("--name="):
            task_name = token.split("=", 1)[1]
        else:
            # Reject single-dash long flags that look like old PMEOW syntax.
            bare = token.split("=", 1)[0]
            if bare in {"-vram", "-gpus", "-priority", "-socket"}:
                raise SystemExit(
                    f"error: {bare} is not supported; use -{bare} instead"
                )
            # First non-PMEOW token — everything from here is the command.
            command_argv = argv[index:]
            if not command_argv:
                return None
            return ForegroundInvocation(
                socket_path=socket_path,
                require_vram_mb=require_vram_mb,
                require_gpu_count=require_gpu_count,
                priority=priority,
                task_name=task_name,
                argv=command_argv,
            )
        index += 1

    # All tokens consumed by PMEOW flags, no command found.
    return None


def _resolve_default_socket() -> str:
    from pmeow.config import resolve_client_socket_path
    return resolve_client_socket_path()


def _format_launch_failure_reason(exc: BaseException) -> str:
    detail = str(exc).strip()
    if detail:
        return f"{type(exc).__name__}: {detail}"
    return type(exc).__name__


def run_foreground_invocation(
    invocation: ForegroundInvocation,
    *,
    stdin_source: BinaryIO | None = None,
    stdout_target: BinaryIO | None = None,
    stderr_target: BinaryIO | None = None,
) -> int:
    """Submit a foreground attached task, poll until launched, then run locally."""
    from pmeow.daemon.socket_server import send_request
    from pmeow.executor.attached import run_attached_command

    socket_path = invocation.socket_path or _resolve_default_socket()
    argv = invocation.argv

    submit = send_request(socket_path, "submit_task", {
        "command": shlex.join(argv),
        "cwd": os.getcwd(),
        "user": os.environ.get("USER") or os.environ.get("USERNAME", "unknown"),
        "require_vram_mb": invocation.require_vram_mb,
        "require_gpu_count": invocation.require_gpu_count,
        "priority": invocation.priority,
        "argv": argv,
        "task_name": invocation.task_name,
        "launch_mode": "foreground",
    })
    if not submit.get("ok"):
        raise SystemExit(submit.get("error", "submit failed"))

    task_id = submit["result"]["id"]
    print(f"task_id={task_id}")

    try:
        while True:
            current = send_request(socket_path, "get_task", {"task_id": task_id})
            if not current.get("ok") or current.get("result") is None:
                raise SystemExit("error: task disappeared")
            task = current["result"]

            if task["status"] == "reserved":
                env = os.environ.copy()
                env["CUDA_VISIBLE_DEVICES"] = ",".join(str(g) for g in (task["assigned_gpus"] or task["gpu_ids"] or []))

                def _on_started(pid: int) -> None:
                    ack = send_request(socket_path, "confirm_foreground_launch", {"task_id": task_id, "pid": pid})
                    if not ack.get("ok") or ack.get("result") is not True:
                        raise RuntimeError("failed to confirm foreground launch")

                try:
                    exit_code = run_attached_command(
                        argv=task["argv"],
                        cwd=task["cwd"],
                        env=env,
                        log_path=task["log_path"],
                        on_started=_on_started,
                        stdin_source=stdin_source,
                        stdout_target=stdout_target,
                        stderr_target=stderr_target,
                    )
                except KeyboardInterrupt:
                    exit_code = 130
                except Exception as exc:
                    reason = _format_launch_failure_reason(exc)
                    try:
                        response = send_request(
                            socket_path,
                            "fail_foreground_launch",
                            {"task_id": task_id, "reason": reason},
                        )
                        if not response.get("ok") or response.get("result") is not True:
                            print("warning: daemon rejected launch failure report", file=sys.stderr)
                    except Exception:
                        print("warning: failed to notify daemon of launch failure", file=sys.stderr)
                    print(f"error: failed to start foreground task: {reason}", file=sys.stderr)
                    return 1
                try:
                    send_request(socket_path, "finish_foreground_task", {"task_id": task_id, "exit_code": exit_code})
                except Exception:
                    print("warning: failed to notify daemon of task completion", file=sys.stderr)
                print(f"task finished exit_code={exit_code}")
                return exit_code

            if task["status"] not in {"queued", "reserved", "running"}:
                # Task no longer active (removed from queue)
                print("task is no longer active")
                return 0

            time.sleep(1)
    except KeyboardInterrupt:
        try:
            send_request(socket_path, "cancel_task", {"task_id": task_id})
        except Exception:
            print("warning: failed to cancel task on daemon", file=sys.stderr)
        print(f"task cancelled task_id={task_id}")
        return 130
