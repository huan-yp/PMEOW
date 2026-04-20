"""CLI entrypoint for the PMEOW agent."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import sys

from pmeow import cli_runtime


def _resolve_default_socket() -> str:
    from pmeow.config import resolve_client_socket_path
    return resolve_client_socket_path()


def _is_generic_python_command(token: str) -> bool:
    name = os.path.basename(token).lower()
    return name == "python" or name == "py" or name.startswith("python3")


def _normalize_submit_command(command_args: list[str]) -> tuple[str, list[str] | None]:
    if not command_args:
        return "", None

    return shlex.join(command_args), None


def _socket_path(args: argparse.Namespace) -> str:
    return getattr(args, "socket", None) or _resolve_default_socket()


def _cmd_status(args: argparse.Namespace) -> None:
    from pmeow.daemon.socket_server import send_request

    resp = send_request(_socket_path(args), "list_tasks")
    if not resp.get("ok"):
        print(f"error: {resp.get('error')}", file=sys.stderr)
        raise SystemExit(1)
    tasks = resp["result"]
    counts: dict[str, int] = {"queued": 0, "reserved": 0, "running": 0}
    for t in tasks:
        s = t.get("status", "")
        if s in counts:
            counts[s] += 1
    print(
        f"queued={counts['queued']}  "
        f"reserved={counts['reserved']}  "
        f"running={counts['running']}"
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

    command, argv = _normalize_submit_command(args.command_args)
    if not command:
        print("error: no command specified", file=sys.stderr)
        raise SystemExit(1)
    resp = send_request(_socket_path(args), "submit_task", {
        "command": command,
        "cwd": os.getcwd(),
        "user": os.environ.get("USER") or os.environ.get("USERNAME", "unknown"),
        "require_vram_mb": args.pvram,
        "require_gpu_count": args.gpus,
        "priority": args.priority,
        "argv": argv,
        "env_overrides": dict(os.environ),
    })
    if not resp.get("ok"):
        print(f"error: {resp.get('error')}", file=sys.stderr)
        raise SystemExit(1)
    print(json.dumps(resp["result"], indent=2))


def _cmd_tasks(args: argparse.Namespace) -> None:
    from pmeow.daemon.socket_server import send_request

    params: dict = {}
    if args.status:
        params["status"] = args.status
    resp = send_request(_socket_path(args), "list_tasks", params)
    if not resp.get("ok"):
        print(f"error: {resp.get('error')}", file=sys.stderr)
        raise SystemExit(1)
    tasks = resp["result"]
    if not tasks:
        print("no tasks")
        return
    # table header
    fmt = "{:<8}  {:<10}  {:<6}  {:<10}  {:<40}"
    print(fmt.format("ID", "STATUS", "PRI", "USER", "COMMAND"))
    print("-" * 80)
    for t in tasks:
        tid = t["id"][:8]
        cmd = (t.get("command") or "-")[:40]
        print(fmt.format(
            tid,
            t.get("status", "-"),
            t.get("priority", 0),
            t.get("user", "-")[:10],
            cmd,
        ))


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

    install_parser = sub.add_parser("install-service", help="Install the systemd service")
    install_parser.add_argument("--enable", action="store_true", help="Enable the service after installation")
    install_parser.add_argument("--start", action="store_true", help="Start the service after installation")

    sub.add_parser("uninstall-service", help="Uninstall the systemd service")

    # queue control
    sub.add_parser("status", help="Query queue status")

    cancel_parser = sub.add_parser("cancel", help="Cancel a task")
    cancel_parser.add_argument("task_id", help="ID of the task to cancel")

    logs_parser = sub.add_parser("logs", help="Get task logs")
    logs_parser.add_argument("task_id", help="ID of the task")
    logs_parser.add_argument("--tail", type=int, default=100, help="Number of lines")

    submit_parser = sub.add_parser("submit", help="Submit a task")
    submit_parser.add_argument("--pvram", type=int, default=0, help="VRAM in MB")
    submit_parser.add_argument("--gpus", dest="gpus", type=int, default=1, help="GPU count")
    submit_parser.add_argument("--gpu", dest="gpus", type=int, help=argparse.SUPPRESS)
    submit_parser.add_argument("--priority", type=int, default=10, help="Priority")
    submit_parser.add_argument("command_args", nargs=argparse.REMAINDER, help="Command to run")

    tasks_parser = sub.add_parser("tasks", help="List tasks")
    tasks_parser.add_argument(
        "--status", default=None,
        choices=["queued", "reserved", "running"],
        help="Filter by status",
    )

    return parser


_HANDLERS = {
    "run": lambda args: cli_runtime.run_foreground(args),
    "daemon": lambda args: cli_runtime.run_foreground(args),
    "start": lambda args: cli_runtime.start_background(args),
    "stop": lambda args: cli_runtime.stop_background(args),
    "restart": lambda args: cli_runtime.restart_background(args),
    "is-running": lambda args: cli_runtime.is_running(args),
    "install-service": lambda args: cli_runtime.install_service(args),
    "uninstall-service": lambda args: cli_runtime.uninstall_service(args),
    "status": _cmd_status,
    "tasks": _cmd_tasks,
    "cancel": _cmd_cancel,
    "logs": _cmd_logs,
    "submit": _cmd_submit,
}


def main(argv: list[str] | None = None) -> None:
    argv = list(sys.argv[1:] if argv is None else argv)

    from pmeow.cli_python import detect_python_invocation, run_python_invocation
    invocation = detect_python_invocation(argv)
    if invocation is not None:
        raise SystemExit(run_python_invocation(invocation))

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
