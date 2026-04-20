"""Python sugar CLI — detect .py path in argv, submit attached task, wait, launch."""

from __future__ import annotations

import os
import shlex
import shutil
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


def resolve_submission_python() -> str:
    """Resolve the caller-side Python interpreter for submitted Python tasks.

    When the CLI is installed globally but invoked from another virtual
    environment, sys.executable points at the CLI's own interpreter rather
    than the caller's. Prefer the active environment's Python so queued and
    attached Python tasks run with the same interpreter the user expects.
    """
    override = os.environ.get("PMEOW_PYTHON_EXECUTABLE")
    if override:
        return str(Path(os.path.expanduser(override)).resolve())

    candidates: list[Path] = []

    virtual_env = os.environ.get("VIRTUAL_ENV")
    if virtual_env:
        base = Path(virtual_env)
        if os.name == "nt":
            candidates.extend([base / "Scripts" / "python.exe", base / "python.exe"])
        else:
            candidates.append(base / "bin" / "python")

    conda_prefix = os.environ.get("CONDA_PREFIX")
    if conda_prefix:
        base = Path(conda_prefix)
        if os.name == "nt":
            candidates.extend([base / "python.exe", base / "Scripts" / "python.exe"])
        else:
            candidates.append(base / "bin" / "python")

    for candidate in candidates:
        if candidate.is_file():
            return str(candidate.resolve())

    path_python = shutil.which("python")
    if path_python:
        return str(Path(path_python).resolve())

    return sys.executable


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
        "logs", "submit", "tasks",
    }
    if not argv or argv[0] in known_subcommands or argv[0] in {"-h", "--help"}:
        return None

    socket_path: str | None = None
    require_vram_mb = 0
    require_gpu_count = 1
    priority = 10

    index = 0
    while index < len(argv):
        token = argv[index]
        if token.endswith(".py") and not token.startswith("-"):
            return PythonInvocation(
                socket_path=socket_path,
                require_vram_mb=require_vram_mb,
                require_gpu_count=require_gpu_count,
                priority=priority,
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
        else:
            raise SystemExit(f"error: unsupported PMEOW flag before script path: {token}")
        index += 1

    return None  # No .py found


def _resolve_default_socket() -> str:
    from pmeow.config import resolve_client_socket_path
    return resolve_client_socket_path()


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

    socket_path = invocation.socket_path or _resolve_default_socket()
    argv = [resolve_submission_python(), invocation.script_path, *invocation.script_args]

    submit = send_request(socket_path, "submit_task", {
        "command": shlex.join(argv),
        "cwd": os.getcwd(),
        "user": os.environ.get("USER") or os.environ.get("USERNAME", "unknown"),
        "require_vram_mb": invocation.require_vram_mb,
        "require_gpu_count": invocation.require_gpu_count,
        "priority": invocation.priority,
        "argv": argv,
        "launch_mode": "attached_python",
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
                    ack = send_request(socket_path, "confirm_attached_launch", {"task_id": task_id, "pid": pid})
                    if not ack.get("ok") or ack.get("result") is not True:
                        raise RuntimeError("failed to confirm attached launch")

                try:
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
                except KeyboardInterrupt:
                    exit_code = 130
                try:
                    send_request(socket_path, "finish_attached_task", {"task_id": task_id, "exit_code": exit_code})
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
