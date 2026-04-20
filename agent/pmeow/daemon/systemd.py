from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from pmeow.config import AgentConfig, SYSTEMD_SOCKET_PATH


@dataclass(frozen=True)
class SystemdServicePaths:
    service_name: str
    unit_path: Path
    environment_path: Path


def render_unit_file(*, executable_path: str, working_directory: str, environment_file: str, service_name: str, socket_group: str = "") -> str:
    supplementary = f"SupplementaryGroups={socket_group}\n" if socket_group else ""
    chmod_cmd = (
        f"ExecStartPost=/bin/chmod 0770 /run/{service_name}/pmeow.sock\n"
        if socket_group
        else f"ExecStartPost=/bin/chmod 0666 /run/{service_name}/pmeow.sock\n"
    )
    return f"""[Unit]
Description=PMEOW Agent Daemon
After=network.target

[Service]
Type=simple
WorkingDirectory={working_directory}
EnvironmentFile={environment_file}
RuntimeDirectory={service_name}
RuntimeDirectoryMode=0755
{supplementary}ExecStart={executable_path} run
{chmod_cmd}Restart=on-failure
RestartSec=10
UMask=0002

[Install]
WantedBy=multi-user.target
"""


def render_environment_file(config: AgentConfig) -> str:
    lines = [
        f"PMEOW_SERVER_URL={config.server_url}",
        f"PMEOW_AGENT_ID={config.agent_id or ''}",
        f"PMEOW_WS_RECONNECT_DELAY={config.ws_reconnect_delay}",
        f"PMEOW_WS_RECONNECT_DELAY_MAX={config.ws_reconnect_delay_max}",
        f"PMEOW_WS_REQUEST_TIMEOUT={config.ws_request_timeout}",
        f"PMEOW_COLLECTION_INTERVAL={config.collection_interval}",
        f"PMEOW_ATTACH_TIMEOUT={config.attach_timeout}",
        f"PMEOW_HISTORY_WINDOW={config.history_window_seconds}",
        f"PMEOW_VRAM_REDUNDANCY={config.vram_redundancy_coefficient}",
        f"PMEOW_STATE_DIR={config.state_dir}",
        f"PMEOW_SOCKET_PATH={SYSTEMD_SOCKET_PATH}",
        f"PMEOW_LOG_DIR={config.log_dir}",
    ]
    if config.socket_group:
        lines.append(f"PMEOW_SOCKET_GROUP={config.socket_group}")
    return "\n".join(lines) + "\n"


def resolve_agent_executable() -> str:
    executable = shutil.which("pmeow-agent")
    if not executable:
        raise RuntimeError("pmeow-agent executable not found in PATH")
    return str(Path(executable).resolve())


def install_systemd_service(*, config: AgentConfig, executable_path: str, working_directory: str, paths: SystemdServicePaths, enable: bool, start: bool) -> None:
    Path(working_directory).mkdir(parents=True, exist_ok=True)
    paths.unit_path.parent.mkdir(parents=True, exist_ok=True)
    paths.environment_path.parent.mkdir(parents=True, exist_ok=True)
    paths.unit_path.write_text(
        render_unit_file(
            executable_path=executable_path,
            working_directory=working_directory,
            environment_file=str(paths.environment_path),
            service_name=paths.service_name,
            socket_group=config.socket_group,
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
