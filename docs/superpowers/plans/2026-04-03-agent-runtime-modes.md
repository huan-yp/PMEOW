# Agent Runtime Modes Implementation Plan

> **For agentic workers:** REQUIRED: Use the `subagent-driven-development` agent (recommended) or `executing-plans` agent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add foreground console logging, self-managed background runtime control, and CLI-assisted systemd service installation for the Python agent without changing queue or task behavior.

**Architecture:** Keep `DaemonService` as the single runtime core. Add small support modules for runtime logging, background supervision, and systemd rendering, then wire them into a thin CLI runtime layer and `__main__.py`. Preserve the existing Unix-socket control plane and task log storage while separating agent runtime logs from task stdout and stderr.

**Tech Stack:** Python 3.10+, argparse, logging, os/signal/shutil/subprocess/pathlib, pytest, monkeypatch, tempfile

---

## File Structure

- Modify: `agent/pmeow/config.py:15-88`
Responsibility: extend `AgentConfig` with `pid_file` and `agent_log_file`, and load `PMEOW_PID_FILE` plus `PMEOW_AGENT_LOG_FILE` without breaking existing defaults.

- Create: `agent/pmeow/runtime_logging.py`
Responsibility: own all agent runtime logging setup so foreground mode uses the console and background mode uses a dedicated file.

- Create: `agent/pmeow/daemon/supervisor.py`
Responsibility: own pid-file lifecycle, stale-pid cleanup, fork-based background startup, shutdown signaling, and running-state checks.

- Create: `agent/pmeow/cli_runtime.py`
Responsibility: implement `run`, `start`, `stop`, `restart`, `is-running`, `install-service`, and `uninstall-service` handlers by composing config, logging, supervisor, and systemd helpers.

- Modify: `agent/pmeow/__main__.py:11-169`
Responsibility: keep parser and dispatch wiring thin, register new runtime commands, and preserve `daemon` as a compatibility alias for `run`.

- Create: `agent/pmeow/daemon/systemd.py`
Responsibility: render the systemd unit file and environment file, resolve the installed executable path, and run install or uninstall shell commands.

- Create: `agent/tests/test_runtime_logging.py`
Responsibility: validate new config fields and runtime logging sinks.

- Create: `agent/tests/daemon/test_supervisor.py`
Responsibility: validate pid-file rules, stale-pid cleanup, background stop semantics, and running-state checks.

- Create: `agent/tests/test_cli_runtime.py`
Responsibility: validate parser additions, foreground console logging behavior, background-mode validation, and `daemon` alias compatibility.

- Modify: `agent/tests/test_smoke.py:11-33`
Responsibility: keep smoke coverage for the legacy alias and the new `run` entrypoint.

- Create: `agent/tests/daemon/test_systemd.py`
Responsibility: validate unit rendering, environment-file rendering, and install or uninstall command orchestration.

- Modify: `agent/examples/pmeow-agent.service:1-17`
Responsibility: update the tracked example to `run` plus `EnvironmentFile` so it matches the new supported deployment model.

- Modify: `agent/README.md:20-113`
Responsibility: document foreground, background, and systemd flows; add `PMEOW_PID_FILE` and `PMEOW_AGENT_LOG_FILE`; clarify task logs versus runtime logs.

- Modify: `docs/user/agent-nodes.md:37-148`
Responsibility: document node-operator startup choices, local background commands, and where to read runtime logs in each mode.

- Modify: `docs/developer/local-development.md:68-203`
Responsibility: document new local development commands and runtime-path isolation advice.

- Modify: `docs/user/troubleshooting.md:153-176`
Responsibility: update the runtime log lookup guidance for foreground, background, and systemd modes.

### Task 1: Runtime Config And Logging Foundation

**Files:**
- Create: `agent/pmeow/runtime_logging.py`
- Modify: `agent/pmeow/config.py:15-88`
- Create: `agent/tests/test_runtime_logging.py`

- [ ] **Step 1: Write the failing tests**

Create `agent/tests/test_runtime_logging.py` with:

```python
from __future__ import annotations

import logging

from pmeow.config import load_config
from pmeow.runtime_logging import configure_runtime_logging


def test_load_config_adds_pid_and_agent_log_paths(monkeypatch, tmp_path):
    monkeypatch.setenv("PMEOW_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("PMEOW_AGENT_LOG_FILE", str(tmp_path / "runtime" / "agent.log"))

    cfg = load_config()

    assert cfg.pid_file == str((tmp_path / "state" / "pmeow-agent.pid").resolve())
    assert cfg.agent_log_file == str((tmp_path / "runtime" / "agent.log").resolve())


def test_configure_runtime_logging_writes_to_file(tmp_path):
    log_file = tmp_path / "agent.log"

    configure_runtime_logging(log_to_console=False, log_file=str(log_file))
    logging.getLogger("pmeow.runtime").info("background ready")

    assert "background ready" in log_file.read_text()


def test_configure_runtime_logging_writes_to_console(capsys):
    configure_runtime_logging(log_to_console=True)
    logging.getLogger("pmeow.runtime").warning("foreground ready")

    captured = capsys.readouterr()
    assert "foreground ready" in captured.out
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
cd agent
. .venv/bin/activate
pytest tests/test_runtime_logging.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'pmeow.runtime_logging'` and a config-related failure because `AgentConfig` does not expose `pid_file` or `agent_log_file` yet.

- [ ] **Step 3: Extend the config model with runtime-path support**

Update `agent/pmeow/config.py` so the dataclass and loader include runtime-specific paths:

```python
@dataclass
class AgentConfig:
    server_url: str = ""
    agent_id: str | None = None
    collection_interval: int = 5
    heartbeat_interval: int = 30
    history_window_seconds: int = 120
    vram_redundancy_coefficient: float = 0.1
    state_dir: str = field(default_factory=_default_state_dir)
    socket_path: str = field(default_factory=lambda: os.path.expanduser("~/.pmeow/pmeow.sock"))
    log_dir: str = field(default_factory=lambda: os.path.expanduser("~/.pmeow/logs/"))
    pid_file: str = field(default_factory=lambda: os.path.expanduser("~/.pmeow/pmeow-agent.pid"))
    agent_log_file: str | None = None


def validate_optional_path(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    return validate_path(value)


def load_config() -> AgentConfig:
    env = os.environ

    agent_id = env.get("PMEOW_AGENT_ID") or socket.gethostname()
    state_dir = validate_path(env.get("PMEOW_STATE_DIR", "~/.pmeow/"))
    socket_path = validate_path(env.get("PMEOW_SOCKET_PATH", str(Path(state_dir) / "pmeow.sock")))
    log_dir = validate_path(env.get("PMEOW_LOG_DIR", str(Path(state_dir) / "logs")))
    pid_file = validate_path(env.get("PMEOW_PID_FILE", str(Path(state_dir) / "pmeow-agent.pid")))
    agent_log_file = validate_optional_path(env.get("PMEOW_AGENT_LOG_FILE"))

    return AgentConfig(
        server_url=env.get("PMEOW_SERVER_URL", ""),
        agent_id=agent_id,
        collection_interval=collection_interval,
        heartbeat_interval=heartbeat_interval,
        history_window_seconds=history_window_seconds,
        vram_redundancy_coefficient=vram_redundancy_coefficient,
        state_dir=state_dir,
        socket_path=socket_path,
        log_dir=log_dir,
        pid_file=pid_file,
        agent_log_file=agent_log_file,
    )
```

- [ ] **Step 4: Add the shared runtime logging module**

Create `agent/pmeow/runtime_logging.py` with:

```python
from __future__ import annotations

import logging
import sys
from pathlib import Path


LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


def configure_runtime_logging(*, log_to_console: bool, log_file: str | None = None) -> None:
    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)
        handler.close()

    root.setLevel(logging.INFO)

    if log_to_console:
        handler = logging.StreamHandler(sys.stdout)
    else:
        if not log_file:
            raise ValueError("log_file is required when log_to_console is False")
        Path(log_file).parent.mkdir(parents=True, exist_ok=True)
        handler = logging.FileHandler(log_file)

    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    root.addHandler(handler)
```

- [ ] **Step 5: Run the targeted tests again**

Run:

```bash
cd agent
. .venv/bin/activate
pytest tests/test_runtime_logging.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent/pmeow/config.py agent/pmeow/runtime_logging.py agent/tests/test_runtime_logging.py
git commit -m "feat(agent): add runtime logging foundation"
```

---

### Task 2: Background Supervisor And Pid-File Lifecycle

**Files:**
- Create: `agent/pmeow/daemon/supervisor.py`
- Create: `agent/tests/daemon/test_supervisor.py`

- [ ] **Step 1: Write the failing supervisor tests**

Create `agent/tests/daemon/test_supervisor.py` with:

```python
from __future__ import annotations

import signal

import pytest

from pmeow.daemon.supervisor import (
    is_background_running,
    prepare_pid_file,
    stop_background_process,
)


def test_prepare_pid_file_rejects_live_process(tmp_path, monkeypatch):
    pid_file = tmp_path / "pmeow-agent.pid"
    pid_file.write_text("1234")

    monkeypatch.setattr("pmeow.daemon.supervisor.is_process_running", lambda pid: True)

    with pytest.raises(RuntimeError, match="already running"):
        prepare_pid_file(str(pid_file))


def test_prepare_pid_file_cleans_stale_pid(tmp_path, monkeypatch):
    pid_file = tmp_path / "pmeow-agent.pid"
    pid_file.write_text("4321")

    monkeypatch.setattr("pmeow.daemon.supervisor.is_process_running", lambda pid: False)

    prepare_pid_file(str(pid_file))

    assert not pid_file.exists()


def test_stop_background_process_signals_and_removes_pid_file(tmp_path, monkeypatch):
    pid_file = tmp_path / "pmeow-agent.pid"
    pid_file.write_text("9876")
    calls: list[tuple[int, signal.Signals]] = []

    def fake_kill(pid: int, sig: signal.Signals) -> None:
        calls.append((pid, sig))

    monkeypatch.setattr("pmeow.daemon.supervisor.os.kill", fake_kill)
    monkeypatch.setattr("pmeow.daemon.supervisor.wait_for_exit", lambda pid, timeout: True)

    assert stop_background_process(str(pid_file), timeout=1.0) is True
    assert calls == [(9876, signal.SIGTERM)]
    assert not pid_file.exists()


def test_is_background_running_returns_false_for_missing_pid_file(tmp_path):
    assert is_background_running(str(tmp_path / "missing.pid")) is False
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
cd agent
. .venv/bin/activate
pytest tests/daemon/test_supervisor.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'pmeow.daemon.supervisor'`.

- [ ] **Step 3: Implement pid-file and background lifecycle helpers**

Create `agent/pmeow/daemon/supervisor.py` with:

```python
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
```

- [ ] **Step 4: Run the targeted supervisor tests again**

Run:

```bash
cd agent
. .venv/bin/activate
pytest tests/daemon/test_supervisor.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/pmeow/daemon/supervisor.py agent/tests/daemon/test_supervisor.py
git commit -m "feat(agent): add background supervisor lifecycle"
```

---

### Task 3: CLI Runtime Commands And Foreground Or Background Behavior

**Files:**
- Create: `agent/pmeow/cli_runtime.py`
- Modify: `agent/pmeow/__main__.py:11-169`
- Create: `agent/tests/test_cli_runtime.py`
- Modify: `agent/tests/test_smoke.py:11-33`

- [ ] **Step 1: Write the failing CLI tests**

Create `agent/tests/test_cli_runtime.py` with:

```python
from __future__ import annotations

import logging

import pytest

from pmeow.__main__ import build_parser, main
from pmeow.cli_runtime import run_foreground, start_background


def test_build_parser_accepts_runtime_commands():
    parser = build_parser()

    assert parser.parse_args(["run"]).command == "run"
    assert parser.parse_args(["stop"]).command == "stop"
    assert parser.parse_args(["restart", "--agent-log-file", "/tmp/agent.log"]).command == "restart"
    assert parser.parse_args(["is-running"]).command == "is-running"


def test_daemon_alias_dispatches_to_foreground_handler(monkeypatch):
    called: list[str] = []

    monkeypatch.setattr("pmeow.cli_runtime.run_foreground", lambda args: called.append(args.command))

    main(["daemon"])

    assert called == ["daemon"]


def test_run_foreground_writes_runtime_logs_to_console(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PMEOW_STATE_DIR", str(tmp_path / "state"))

    class FakeService:
        def __init__(self, config):
            self.config = config

        def start(self):
            logging.getLogger("pmeow.runtime").info("foreground ready")

    monkeypatch.setattr("pmeow.cli_runtime.DaemonService", FakeService)

    run_foreground(type("Args", (), {"command": "run"})())

    assert "foreground ready" in capsys.readouterr().out


def test_start_background_requires_agent_log_file(monkeypatch, tmp_path):
    monkeypatch.setenv("PMEOW_STATE_DIR", str(tmp_path / "state"))

    with pytest.raises(SystemExit) as exc_info:
        start_background(type("Args", (), {"agent_log_file": None})())

    assert exc_info.value.code == 1
```

- [ ] **Step 2: Run the CLI tests to verify they fail**

Run:

```bash
cd agent
. .venv/bin/activate
pytest tests/test_cli_runtime.py -v
```

Expected: FAIL with `SystemExit: 2` from `argparse` because `run`, `stop`, `restart`, and `is-running` are not registered yet.

- [ ] **Step 3: Add the runtime command handlers**

Create `agent/pmeow/cli_runtime.py` with:

```python
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
```

- [ ] **Step 4: Register the runtime commands and preserve the alias**

Update `agent/pmeow/__main__.py` so the parser and handler map include the new runtime commands:

```python
from pmeow import cli_runtime


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pmeow",
        description="PMEOW agent — GPU cluster monitoring and task scheduling",
    )
    parser.add_argument("--socket", default=None, help="Path to daemon Unix socket")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("run", help="Run the agent in the foreground")
    sub.add_parser("daemon", help="Compatibility alias for foreground run")

    start_parser = sub.add_parser("start", help="Start the agent in the background")
    start_parser.add_argument("--agent-log-file", default=None, help="Path to the runtime log file")

    sub.add_parser("stop", help="Stop the background agent")

    restart_parser = sub.add_parser("restart", help="Restart the background agent")
    restart_parser.add_argument("--agent-log-file", default=None, help="Path to the runtime log file")

    sub.add_parser("is-running", help="Check whether the background agent is running")

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
    "run": cli_runtime.run_foreground,
    "daemon": cli_runtime.run_foreground,
    "start": cli_runtime.start_background,
    "stop": cli_runtime.stop_background,
    "restart": cli_runtime.restart_background,
    "is-running": cli_runtime.is_running,
    "status": _cmd_status,
    "cancel": _cmd_cancel,
    "logs": _cmd_logs,
    "submit": _cmd_submit,
    "pause": _cmd_pause,
    "resume": _cmd_resume,
}
```

Update `agent/tests/test_smoke.py` so the suite still covers both the legacy alias and the new entrypoint:

```python
def test_cli_run_help():
    from pmeow.__main__ import main

    with pytest.raises(SystemExit) as exc_info:
        main(["run", "--help"])

    assert exc_info.value.code == 0


def test_cli_daemon_alias_parses():
    from pmeow.__main__ import build_parser

    args = build_parser().parse_args(["daemon"])
    assert args.command == "daemon"
```

- [ ] **Step 5: Run the CLI and smoke tests again**

Run:

```bash
cd agent
. .venv/bin/activate
pytest tests/test_cli_runtime.py tests/test_smoke.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent/pmeow/cli_runtime.py agent/pmeow/__main__.py agent/tests/test_cli_runtime.py agent/tests/test_smoke.py
git commit -m "feat(agent): add runtime mode CLI commands"
```

---

### Task 4: Systemd Install And Uninstall Workflow

**Files:**
- Create: `agent/pmeow/daemon/systemd.py`
- Modify: `agent/pmeow/cli_runtime.py`
- Modify: `agent/pmeow/__main__.py:106-169`
- Modify: `agent/tests/test_cli_runtime.py`
- Create: `agent/tests/daemon/test_systemd.py`
- Modify: `agent/examples/pmeow-agent.service:1-17`

- [ ] **Step 1: Write the failing systemd tests**

Create `agent/tests/daemon/test_systemd.py` with:

```python
from __future__ import annotations

from pathlib import Path

from pmeow.config import AgentConfig
from pmeow.daemon.systemd import (
    SystemdServicePaths,
    install_systemd_service,
    render_environment_file,
    render_unit_file,
)


def test_render_unit_file_uses_run_and_environment_file():
    unit = render_unit_file(
        executable_path="/opt/pmeow-agent/.venv/bin/pmeow-agent",
        working_directory="/opt/pmeow-agent",
        environment_file="/etc/pmeow-agent/pmeow-agent.env",
        service_name="pmeow-agent",
    )

    assert "ExecStart=/opt/pmeow-agent/.venv/bin/pmeow-agent run" in unit
    assert "EnvironmentFile=/etc/pmeow-agent/pmeow-agent.env" in unit
    assert "Type=simple" in unit


def test_render_environment_file_serializes_agent_paths(tmp_path):
    cfg = AgentConfig(
        server_url="http://server:17200",
        state_dir=str(tmp_path / "state"),
        socket_path=str(tmp_path / "state" / "pmeow.sock"),
        log_dir=str(tmp_path / "logs"),
        pid_file=str(tmp_path / "state" / "pmeow-agent.pid"),
    )

    env_text = render_environment_file(cfg)

    assert "PMEOW_SERVER_URL=http://server:17200" in env_text
    assert f"PMEOW_STATE_DIR={cfg.state_dir}" in env_text
    assert f"PMEOW_LOG_DIR={cfg.log_dir}" in env_text


def test_install_systemd_service_writes_files_and_reload_calls(tmp_path, monkeypatch):
    cfg = AgentConfig(
        server_url="http://server:17200",
        state_dir=str(tmp_path / "state"),
        socket_path=str(tmp_path / "state" / "pmeow.sock"),
        log_dir=str(tmp_path / "logs"),
        pid_file=str(tmp_path / "state" / "pmeow-agent.pid"),
    )
    paths = SystemdServicePaths(
        service_name="pmeow-agent",
        unit_path=tmp_path / "pmeow-agent.service",
        environment_path=tmp_path / "pmeow-agent.env",
    )
    calls: list[list[str]] = []

    monkeypatch.setattr(
        "pmeow.daemon.systemd.subprocess.run",
        lambda cmd, check: calls.append(cmd),
    )

    install_systemd_service(
        config=cfg,
        executable_path="/opt/pmeow-agent/.venv/bin/pmeow-agent",
        working_directory="/opt/pmeow-agent",
        paths=paths,
        enable=False,
        start=False,
    )

    assert paths.unit_path.exists()
    assert paths.environment_path.exists()
    assert calls == [["systemctl", "daemon-reload"]]
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
cd agent
. .venv/bin/activate
pytest tests/daemon/test_systemd.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'pmeow.daemon.systemd'`.

- [ ] **Step 3: Implement systemd rendering and install helpers**

Create `agent/pmeow/daemon/systemd.py` with:

```python
from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from pmeow.config import AgentConfig


@dataclass(frozen=True)
class SystemdServicePaths:
    service_name: str
    unit_path: Path
    environment_path: Path


def render_unit_file(*, executable_path: str, working_directory: str, environment_file: str, service_name: str) -> str:
    return f"""[Unit]
Description=PMEOW Agent Daemon
After=network.target

[Service]
Type=simple
WorkingDirectory={working_directory}
EnvironmentFile={environment_file}
ExecStart={executable_path} run
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
"""


def render_environment_file(config: AgentConfig) -> str:
    lines = [
        f"PMEOW_SERVER_URL={config.server_url}",
        f"PMEOW_AGENT_ID={config.agent_id or ''}",
        f"PMEOW_COLLECTION_INTERVAL={config.collection_interval}",
        f"PMEOW_HEARTBEAT_INTERVAL={config.heartbeat_interval}",
        f"PMEOW_HISTORY_WINDOW={config.history_window_seconds}",
        f"PMEOW_VRAM_REDUNDANCY={config.vram_redundancy_coefficient}",
        f"PMEOW_STATE_DIR={config.state_dir}",
        f"PMEOW_SOCKET_PATH={config.socket_path}",
        f"PMEOW_LOG_DIR={config.log_dir}",
    ]
    return "\n".join(lines) + "\n"


def resolve_agent_executable() -> str:
    executable = shutil.which("pmeow-agent")
    if not executable:
        raise RuntimeError("pmeow-agent executable not found in PATH")
    return str(Path(executable).resolve())


def install_systemd_service(*, config: AgentConfig, executable_path: str, working_directory: str, paths: SystemdServicePaths, enable: bool, start: bool) -> None:
    paths.unit_path.parent.mkdir(parents=True, exist_ok=True)
    paths.environment_path.parent.mkdir(parents=True, exist_ok=True)
    paths.unit_path.write_text(
        render_unit_file(
            executable_path=executable_path,
            working_directory=working_directory,
            environment_file=str(paths.environment_path),
            service_name=paths.service_name,
        )
    )
    paths.environment_path.write_text(render_environment_file(config))

    subprocess.run(["systemctl", "daemon-reload"], check=True)
    if enable:
        subprocess.run(["systemctl", "enable", paths.service_name], check=True)
    if start:
        subprocess.run(["systemctl", "start", paths.service_name], check=True)


def uninstall_systemd_service(*, paths: SystemdServicePaths) -> None:
    subprocess.run(["systemctl", "stop", paths.service_name], check=False)
    subprocess.run(["systemctl", "disable", paths.service_name], check=False)
    paths.unit_path.unlink(missing_ok=True)
    subprocess.run(["systemctl", "daemon-reload"], check=True)
```

- [ ] **Step 4: Wire the service commands and update the tracked example**

Extend `agent/pmeow/cli_runtime.py` with service handlers:

```python
from pathlib import Path

from pmeow.daemon.systemd import (
    SystemdServicePaths,
    install_systemd_service,
    resolve_agent_executable,
    uninstall_systemd_service,
)


def install_service(args) -> None:
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
    paths = SystemdServicePaths(
        service_name="pmeow-agent",
        unit_path=Path("/etc/systemd/system/pmeow-agent.service"),
        environment_path=Path("/etc/pmeow-agent/pmeow-agent.env"),
    )
    uninstall_systemd_service(paths=paths)
    print("uninstalled service")
```

Extend `agent/pmeow/__main__.py` with parser entries and dispatch:

```python
install_parser = sub.add_parser("install-service", help="Install the systemd service")
install_parser.add_argument("--enable", action="store_true", help="Enable the service after installation")
install_parser.add_argument("--start", action="store_true", help="Start the service after installation")

sub.add_parser("uninstall-service", help="Uninstall the systemd service")

_HANDLERS.update({
    "install-service": cli_runtime.install_service,
    "uninstall-service": cli_runtime.uninstall_service,
})
```

Extend `agent/tests/test_cli_runtime.py` so parser coverage also includes the systemd commands:

```python
def test_build_parser_accepts_systemd_commands():
    parser = build_parser()

    assert parser.parse_args(["install-service"]).command == "install-service"
    assert parser.parse_args(["install-service", "--enable", "--start"]).start is True
    assert parser.parse_args(["uninstall-service"]).command == "uninstall-service"
```

Update `agent/examples/pmeow-agent.service` to match the supported deployment model:

```ini
[Unit]
Description=PMEOW Agent Daemon
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/pmeow-agent
EnvironmentFile=/etc/pmeow-agent/pmeow-agent.env
ExecStart=/opt/pmeow-agent/.venv/bin/pmeow-agent run
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 5: Run the systemd and CLI tests again**

Run:

```bash
cd agent
. .venv/bin/activate
pytest tests/daemon/test_systemd.py tests/test_cli_runtime.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent/pmeow/daemon/systemd.py agent/pmeow/cli_runtime.py agent/pmeow/__main__.py agent/tests/test_cli_runtime.py agent/tests/daemon/test_systemd.py agent/examples/pmeow-agent.service
git commit -m "feat(agent): add systemd service install workflow"
```

---

### Task 5: Documentation, Operator Guidance, And Final Regression

**Files:**
- Modify: `agent/README.md:20-113`
- Modify: `docs/user/agent-nodes.md:37-148`
- Modify: `docs/developer/local-development.md:68-203`
- Modify: `docs/user/troubleshooting.md:153-176`

- [ ] **Step 1: Update the agent README with the three runtime modes**

Replace the startup section in `agent/README.md` with content shaped like this:

````md
### Run in the foreground

```bash
pmeow-agent run
# compatibility alias
pmeow-agent daemon
```

Foreground mode prints agent runtime logs to the console.

### Run in the background

```bash
export PMEOW_AGENT_LOG_FILE=~/.pmeow/agent.log
pmeow-agent start
pmeow-agent is-running
pmeow-agent stop
```

Background mode writes agent runtime logs to `PMEOW_AGENT_LOG_FILE` and keeps task stdout or stderr in `PMEOW_LOG_DIR`.

### Install as a systemd service

```bash
sudo pmeow-agent install-service --enable --start
sudo pmeow-agent uninstall-service
```

Systemd supervision keeps the process in the foreground and captures runtime logs in journal.
````

Also extend the configuration table with:

```md
| `PMEOW_PID_FILE` | `~/.pmeow/pmeow-agent.pid` | Pid file used by background mode |
| `PMEOW_AGENT_LOG_FILE` | *(empty)* | Dedicated runtime log file used by background mode |
```

Update the state-directory example to:

```text
~/.pmeow/
├── pmeow.db
├── pmeow.sock
├── pmeow-agent.pid
└── logs/
```

- [ ] **Step 2: Update the node-operator guide with mode selection and log lookup**

Add the following operator-facing guidance to `docs/user/agent-nodes.md`:

````md
## 三种启动方式

### 前台

```bash
export PMEOW_SERVER_URL=http://your-server:17200
pmeow-agent run
```

适合初次接入和现场排障，runtime log 直接看当前终端。

### 后台

```bash
export PMEOW_SERVER_URL=http://your-server:17200
export PMEOW_AGENT_LOG_FILE=~/.pmeow/agent.log
pmeow-agent start
pmeow-agent is-running
pmeow-agent stop
```

适合不想长期占用终端、但还没切到 systemd 的节点。

### systemd

```bash
sudo pmeow-agent install-service --enable --start
sudo journalctl -u pmeow-agent -f
```

适合长期托管。systemd 负责进程生命周期，journal 负责 runtime log。
````

Keep the queue-control examples exactly as they are after the new startup section.

Also update the local-file section to:

```text
~/.pmeow/
├── pmeow.db
├── pmeow.sock
├── pmeow-agent.pid
└── logs/
```

- [ ] **Step 3: Update the developer guide and troubleshooting map**

Add these command examples to `docs/developer/local-development.md`:

````md
### 单独开发 Agent

```bash
cd agent
. .venv/bin/activate
pmeow-agent run

# 后台模式
PMEOW_AGENT_LOG_FILE=$PWD/.tmp/agent.log pmeow-agent start
pmeow-agent is-running
pmeow-agent stop
```

如果你同时跑多个本地 Agent 实例，除了拆分 `PMEOW_STATE_DIR` 和 `PMEOW_SOCKET_PATH`，也要拆分 `PMEOW_PID_FILE` 和 `PMEOW_AGENT_LOG_FILE`。
````

Update `docs/user/troubleshooting.md` so the runtime-log lookup section becomes:

```md
### Agent 节点

- 本地状态目录：默认 `~/.pmeow/`
- 本地数据库：`~/.pmeow/pmeow.db`
- 控制 socket：`~/.pmeow/pmeow.sock`
- 后台 pid file：`PMEOW_PID_FILE`
- 任务日志目录：`~/.pmeow/logs/`
- 前台模式 runtime log：当前启动终端
- 后台模式 runtime log：`PMEOW_AGENT_LOG_FILE`
- systemd 模式 runtime log：`journalctl -u pmeow-agent`
```

- [ ] **Step 4: Run the final regression and manual command checks**

Run:

```bash
cd agent
. .venv/bin/activate
pytest -v
python -m pmeow --help
python -m pmeow run --help
python -m pmeow install-service --help
```

Expected:

- `pytest -v` PASS
- top-level help lists `run`, `start`, `stop`, `restart`, `is-running`, `install-service`, `uninstall-service`, and the legacy `daemon` alias
- subcommand help exits with status code 0

- [ ] **Step 5: Commit**

```bash
git add agent/README.md docs/user/agent-nodes.md docs/developer/local-development.md docs/user/troubleshooting.md
git commit -m "docs(agent): document runtime modes and operations"
```