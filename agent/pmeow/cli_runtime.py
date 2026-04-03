from __future__ import annotations

import sys
from dataclasses import replace

from pmeow.config import load_config, validate_path
from pmeow.daemon.service import DaemonService
from pmeow.daemon.supervisor import (
    is_background_running,
    start_background_daemon,
    stop_background_process,
)
from pmeow.runtime_logging import configure_runtime_logging


def _runtime_config(args, *, require_agent_log_file: bool = False):
    config = load_config()
    override = getattr(args, "agent_log_file", None)
    if override:
        config = replace(config, agent_log_file=validate_path(override))
    if require_agent_log_file and not config.agent_log_file:
        print(
            "error: background mode requires --agent-log-file or PMEOW_AGENT_LOG_FILE",
            file=sys.stderr,
        )
        raise SystemExit(1)
    return config


def run_foreground(args) -> None:
    config = load_config()
    configure_runtime_logging(log_to_console=True)
    DaemonService(config).start()


def start_background(args) -> None:
    config = _runtime_config(args, require_agent_log_file=True)
    pid = start_background_daemon(config, config.agent_log_file)
    print(f"started: pid={pid}")


def stop_background(args) -> None:
    config = load_config()
    if not stop_background_process(config.pid_file, timeout=5.0):
        print("not running", file=sys.stderr)
        raise SystemExit(1)
    print("stopped")


def restart_background(args) -> None:
    config = _runtime_config(args, require_agent_log_file=True)
    stop_background_process(config.pid_file, timeout=5.0)
    pid = start_background_daemon(config, config.agent_log_file)
    print(f"restarted: pid={pid}")


def is_running(args) -> None:
    config = load_config()
    if is_background_running(config.pid_file):
        print("running")
        return
    print("not running", file=sys.stderr)
    raise SystemExit(1)


def install_service(args) -> None:
    from pathlib import Path

    from pmeow.daemon.systemd import (
        SystemdServicePaths,
        install_systemd_service,
        resolve_agent_executable,
    )

    config = load_config()
    paths = SystemdServicePaths(
        service_name="pmeow-agent",
        unit_path=Path("/etc/systemd/system/pmeow-agent.service"),
        environment_path=Path("/etc/pmeow-agent/pmeow-agent.env"),
    )
    install_systemd_service(
        config=config,
        executable_path=resolve_agent_executable(),
        working_directory=str(Path.cwd().resolve()),
        paths=paths,
        enable=args.enable,
        start=args.start,
    )
    print("installed service")


def uninstall_service(args) -> None:
    from pathlib import Path

    from pmeow.daemon.systemd import SystemdServicePaths, uninstall_systemd_service

    paths = SystemdServicePaths(
        service_name="pmeow-agent",
        unit_path=Path("/etc/systemd/system/pmeow-agent.service"),
        environment_path=Path("/etc/pmeow-agent/pmeow-agent.env"),
    )
    uninstall_systemd_service(paths=paths)
    print("uninstalled service")
