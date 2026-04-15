"""Python sugar CLI — detect .py path in argv, submit attached task, wait, launch."""

from __future__ import annotations

import os
import shlex
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO


@dataclass
class PythonInvocation:
    socket_path: str | None
    require_vram_mb: int
    require_gpu_count: int
    priority: int
    report: bool
    script_path: str
    script_args: list[str]


def parse_vram_mb(value: str) -> int:
    """Parse a VRAM size like '10g', '512m', or '1024' (MB) to integer MB."""
    raw = value.strip().lower()
    if raw.endswith("g"):
        return int(float(raw[:-1]) * 1024)
    if raw.endswith("m"):
        return int(float(raw[:-1]))
    return int(float(raw))


def detect_python_invocation(argv: list[str]) -> PythonInvocation | None:
    """Detect Python sugar in argv. Returns None if argv is a normal subcommand.

    Rules:
    - If the first token is a known subcommand, return None
    - Tokens before the first .py path are PMEOW flags
    - Tokens after the script are passed to Python
    """
    known_subcommands = {
        "run", "daemon", "start", "stop", "restart", "is-running",
        "install-service", "uninstall-service", "status", "cancel",
        "logs", "submit", "pause", "resume",
    }
    if not argv or argv[0] in known_subcommands or argv[0] in {"-h", "--help"}:
        return None

    socket_path: str | None = None
    require_vram_mb = 0
    require_gpu_count = 1
    priority = 10
    report = False

    index = 0
    while index < len(argv):
        token = argv[index]
        if token.endswith(".py") and not token.startswith("-"):
            return PythonInvocation(
                socket_path=socket_path,
                require_vram_mb=require_vram_mb,
                require_gpu_count=require_gpu_count,
                priority=priority,
                report=report,
                script_path=str(Path(token).resolve()),
                script_args=argv[index + 1:],
            )
        if token.startswith("-vram=") or token.startswith("--vram="):
            require_vram_mb = parse_vram_mb(token.split("=", 1)[1])
        elif token in {"-vram", "--vram"}:
            index += 1
            require_vram_mb = parse_vram_mb(argv[index])
        elif token.startswith("-gpus=") or token.startswith("--gpus="):
            require_gpu_count = int(token.split("=", 1)[1])
        elif token in {"-gpus", "--gpus"}:
            index += 1
            require_gpu_count = int(argv[index])
        elif token == "--priority":
            index += 1
            priority = int(argv[index])
        elif token == "--socket":
            index += 1
            socket_path = argv[index]
        elif token == "--report":
            report = True
        else:
            raise SystemExit(f"error: unsupported PMEOW flag before script path: {token}")
        index += 1

    return None  # No .py found


_DEFAULT_SOCKET = os.path.expanduser("~/.pmeow/pmeow.sock")


def run_python_invocation(
    invocation: PythonInvocation,
    *,
    stdin_source: BinaryIO | None = None,
    stdout_target: BinaryIO | None = None,
    stderr_target: BinaryIO | None = None,
) -> int:
    """Submit an attached task, poll until launched, then run locally."""
    from pmeow.daemon.socket_server import send_request
    from pmeow.executor.attached import run_attached_python

    socket_path = invocation.socket_path or _DEFAULT_SOCKET
    argv = [sys.executable, invocation.script_path, *invocation.script_args]

    submit = send_request(socket_path, "submit_task", {
        "command": shlex.join(argv),
        "cwd": os.getcwd(),
        "user": os.environ.get("USER") or os.environ.get("USERNAME", "unknown"),
        "require_vram_mb": invocation.require_vram_mb,
        "require_gpu_count": invocation.require_gpu_count,
        "priority": invocation.priority,
        "argv": argv,
        "launch_mode": "attached_python",
        "report_requested": invocation.report,
    })
    if not submit.get("ok"):
        raise SystemExit(submit.get("error", "submit failed"))

    task_id = submit["result"]["id"]
    print(f"task_id={task_id}")
    last_event_id = 0

    while True:
        current = send_request(socket_path, "get_task", {"task_id": task_id})
        if not current.get("ok") or current.get("result") is None:
            raise SystemExit("error: task disappeared")
        task = current["result"]

        if invocation.report:
            events = send_request(socket_path, "get_task_events", {"task_id": task_id, "after_id": last_event_id})
            for event in events.get("result", []):
                details = event.get("details")
                message = details.get("message") if isinstance(details, dict) else None
                if message:
                    print(message)
                last_event_id = event["id"]

        if task["status"] == "launching":
            env = os.environ.copy()
            env["CUDA_VISIBLE_DEVICES"] = ",".join(str(g) for g in (task["gpu_ids"] or []))

            def _on_started(pid: int) -> None:
                ack = send_request(socket_path, "confirm_attached_launch", {"task_id": task_id, "pid": pid})
                if not ack.get("ok") or ack.get("result") is not True:
                    raise RuntimeError("failed to confirm attached launch")

            exit_code = run_attached_python(
                argv=task["argv"],
                cwd=task["cwd"],
                env=env,
                log_path=task["log_path"],
                on_started=_on_started,
                stdin_source=stdin_source,
                stdout_target=stdout_target,
                stderr_target=stderr_target,
            )
            send_request(socket_path, "finish_attached_task", {"task_id": task_id, "exit_code": exit_code})
            print(f"task finished exit_code={exit_code}")
            return exit_code

        if task["status"] in {"completed", "failed", "cancelled"}:
            return int(task.get("exit_code") or 0)

        time.sleep(1)
