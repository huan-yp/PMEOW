from __future__ import annotations

import errno
import os
import signal
import time
from pathlib import Path

from pmeow.config import AgentConfig
from pmeow.daemon.service import DaemonService
from pmeow.runtime_logging import configure_runtime_logging


def read_pid_file(pid_file: str) -> int | None:
    path = Path(pid_file)
    if not path.is_file():
        return None
    text = path.read_text().strip()
    return int(text) if text else None


def write_pid_file(pid_file: str, pid: int) -> None:
    path = Path(pid_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{pid}\n")


def is_process_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError as exc:
        return exc.errno == errno.EPERM
    return True


def prepare_pid_file(pid_file: str) -> None:
    existing_pid = read_pid_file(pid_file)
    if existing_pid is None:
        return
    if is_process_running(existing_pid):
        raise RuntimeError(f"agent already running with pid {existing_pid}")
    Path(pid_file).unlink(missing_ok=True)


def is_background_running(pid_file: str) -> bool:
    pid = read_pid_file(pid_file)
    return pid is not None and is_process_running(pid)


def wait_for_exit(pid: int, timeout: float) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not is_process_running(pid):
            return True
        time.sleep(0.1)
    return not is_process_running(pid)


def stop_background_process(pid_file: str, timeout: float = 5.0) -> bool:
    pid = read_pid_file(pid_file)
    if pid is None:
        return False

    os.kill(pid, signal.SIGTERM)
    exited = wait_for_exit(pid, timeout)
    if exited:
        Path(pid_file).unlink(missing_ok=True)
    return exited


def start_background_daemon(config: AgentConfig, agent_log_file: str) -> int:
    prepare_pid_file(config.pid_file)
    Path(agent_log_file).parent.mkdir(parents=True, exist_ok=True)

    pid = os.fork()
    if pid > 0:
        return pid

    os.setsid()
    os.chdir("/")

    with open(os.devnull, "rb") as null_in:
        os.dup2(null_in.fileno(), 0)
    with open(os.devnull, "ab") as null_out:
        os.dup2(null_out.fileno(), 1)
        os.dup2(null_out.fileno(), 2)

    write_pid_file(config.pid_file, os.getpid())
    configure_runtime_logging(log_to_console=False, log_file=agent_log_file)

    try:
        DaemonService(config).start()
    finally:
        Path(config.pid_file).unlink(missing_ok=True)

    os._exit(0)
