"""CLI entrypoint for the PMEOW agent."""

from __future__ import annotations

import argparse
import sys


def _cmd_daemon(args: argparse.Namespace) -> None:
    print("daemon: not implemented")
    raise SystemExit(1)


def _cmd_status(args: argparse.Namespace) -> None:
    print("status: not implemented")
    raise SystemExit(1)


def _cmd_cancel(args: argparse.Namespace) -> None:
    print("cancel: not implemented")
    raise SystemExit(1)


def _cmd_logs(args: argparse.Namespace) -> None:
    print("logs: not implemented")
    raise SystemExit(1)


def _cmd_submit(args: argparse.Namespace) -> None:
    print("submit: not implemented")
    raise SystemExit(1)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pmeow",
        description="PMEOW agent — GPU cluster monitoring and task scheduling",
    )
    sub = parser.add_subparsers(dest="command")

    # daemon
    sub.add_parser("daemon", help="Start the agent daemon")

    # status
    sub.add_parser("status", help="Query task status")

    # cancel
    sub.add_parser("cancel", help="Cancel a task")

    # logs
    sub.add_parser("logs", help="Get task logs")

    # submit (default mode)
    submit_parser = sub.add_parser("submit", help="Submit a task")
    submit_parser.add_argument("--pvram", type=int, default=0, help="VRAM in MB")
    submit_parser.add_argument("--gpu", type=int, default=1, help="GPU count")
    submit_parser.add_argument("--priority", type=int, default=0, help="Priority")
    submit_parser.add_argument("command_args", nargs=argparse.REMAINDER, help="Command to run")

    return parser


_HANDLERS = {
    "daemon": _cmd_daemon,
    "status": _cmd_status,
    "cancel": _cmd_cancel,
    "logs": _cmd_logs,
    "submit": _cmd_submit,
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
