"""CLI entrypoint for the PMEOW agent."""

from __future__ import annotations

import argparse
import json
import os
import sys

from pmeow import cli_runtime


_DEFAULT_SOCKET = os.path.expanduser("~/.pmeow/pmeow.sock")


def _socket_path(args: argparse.Namespace) -> str:
    return getattr(args, "socket", None) or _DEFAULT_SOCKET


def _cmd_status(args: argparse.Namespace) -> None:
    from pmeow.daemon.socket_server import send_request

    resp = send_request(_socket_path(args), "get_status")
    if not resp.get("ok"):
        print(f"error: {resp.get('error')}", file=sys.stderr)
        raise SystemExit(1)
    r = resp["result"]
    print(
        f"paused={r['paused']}  queued={r['queued']}  "
        f"running={r['running']}  completed={r['completed']}  "
        f"failed={r['failed']}  cancelled={r['cancelled']}"
    )


def _cmd_cancel(args: argparse.Namespace) -> None:
    from pmeow.daemon.socket_server import send_request

    resp = send_request(_socket_path(args), "cancel_task", {"task_id": args.task_id})
    if not resp.get("ok"):
        print(f"error: {resp.get('error')}", file=sys.stderr)
        raise SystemExit(1)
    print(f"cancelled: {resp['result']}")


def _cmd_logs(args: argparse.Namespace) -> None:
    from pmeow.daemon.socket_server import send_request

    resp = send_request(
        _socket_path(args), "get_logs",
        {"task_id": args.task_id, "tail": args.tail},
    )
    if not resp.get("ok"):
        print(f"error: {resp.get('error')}", file=sys.stderr)
        raise SystemExit(1)
    print(resp["result"], end="")


def _cmd_submit(args: argparse.Namespace) -> None:
    from pmeow.daemon.socket_server import send_request

    command = " ".join(args.command_args)
    if not command:
        print("error: no command specified", file=sys.stderr)
        raise SystemExit(1)
    resp = send_request(_socket_path(args), "submit_task", {
        "command": command,
        "cwd": os.getcwd(),
        "user": os.environ.get("USER", "unknown"),
        "require_vram_mb": args.pvram,
        "require_gpu_count": args.gpu,
        "priority": args.priority,
    })
    if not resp.get("ok"):
        print(f"error: {resp.get('error')}", file=sys.stderr)
        raise SystemExit(1)
    print(json.dumps(resp["result"], indent=2))


def _cmd_pause(args: argparse.Namespace) -> None:
    from pmeow.daemon.socket_server import send_request

    resp = send_request(_socket_path(args), "pause_queue")
    if not resp.get("ok"):
        print(f"error: {resp.get('error')}", file=sys.stderr)
        raise SystemExit(1)
    print("queue paused")


def _cmd_resume(args: argparse.Namespace) -> None:
    from pmeow.daemon.socket_server import send_request

    resp = send_request(_socket_path(args), "resume_queue")
    if not resp.get("ok"):
        print(f"error: {resp.get('error')}", file=sys.stderr)
        raise SystemExit(1)
    print("queue resumed")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pmeow",
        description="PMEOW agent — GPU cluster monitoring and task scheduling",
    )
    parser.add_argument(
        "--socket", default=None, help="Path to daemon Unix socket"
    )
    sub = parser.add_subparsers(dest="command")

    # runtime
    sub.add_parser("run", help="Run the agent in the foreground")
    sub.add_parser("daemon", help="Compatibility alias for foreground run")

    start_parser = sub.add_parser("start", help="Start the agent in the background")
    start_parser.add_argument("--agent-log-file", default=None, help="Path to the runtime log file")

    sub.add_parser("stop", help="Stop the background agent")

    restart_parser = sub.add_parser("restart", help="Restart the background agent")
    restart_parser.add_argument("--agent-log-file", default=None, help="Path to the runtime log file")

    sub.add_parser("is-running", help="Check whether the background agent is running")

    # queue control
    sub.add_parser("status", help="Query queue status")

    cancel_parser = sub.add_parser("cancel", help="Cancel a task")
    cancel_parser.add_argument("task_id", help="ID of the task to cancel")

    logs_parser = sub.add_parser("logs", help="Get task logs")
    logs_parser.add_argument("task_id", help="ID of the task")
    logs_parser.add_argument("--tail", type=int, default=100, help="Number of lines")

    submit_parser = sub.add_parser("submit", help="Submit a task")
    submit_parser.add_argument("--pvram", type=int, default=0, help="VRAM in MB")
    submit_parser.add_argument("--gpu", type=int, default=1, help="GPU count")
    submit_parser.add_argument("--priority", type=int, default=10, help="Priority")
    submit_parser.add_argument("command_args", nargs=argparse.REMAINDER, help="Command to run")

    sub.add_parser("pause", help="Pause the task queue")
    sub.add_parser("resume", help="Resume the task queue")

    return parser


_HANDLERS = {
    "run": lambda args: cli_runtime.run_foreground(args),
    "daemon": lambda args: cli_runtime.run_foreground(args),
    "start": lambda args: cli_runtime.start_background(args),
    "stop": lambda args: cli_runtime.stop_background(args),
    "restart": lambda args: cli_runtime.restart_background(args),
    "is-running": lambda args: cli_runtime.is_running(args),
    "status": _cmd_status,
    "cancel": _cmd_cancel,
    "logs": _cmd_logs,
    "submit": _cmd_submit,
    "pause": _cmd_pause,
    "resume": _cmd_resume,
}


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command is None:
        parser.print_help()
        raise SystemExit(1)

    handler = _HANDLERS.get(args.command)
    if handler is None:
        parser.print_help()
        raise SystemExit(1)

    handler(args)


if __name__ == "__main__":
    main()
