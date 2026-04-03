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
