"""Agent configuration with environment variable overrides."""

from __future__ import annotations

import os
import socket
from dataclasses import dataclass, field
from pathlib import Path


def _default_state_dir() -> str:
    return os.path.expanduser("~/.pmeow/")


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


def load_config() -> AgentConfig:
    """Load configuration from environment variables with fallback defaults."""
    env = os.environ

    agent_id = env.get("PMEOW_AGENT_ID") or socket.gethostname()

    def _int(key: str, default: int) -> int:
        val = env.get(key)
        return int(val) if val is not None else default

    def _float(key: str, default: float) -> float:
        val = env.get(key)
        return float(val) if val is not None else default

    return AgentConfig(
        server_url=env.get("PMEOW_SERVER_URL", ""),
        agent_id=agent_id,
        collection_interval=_int("PMEOW_COLLECTION_INTERVAL", 5),
        heartbeat_interval=_int("PMEOW_HEARTBEAT_INTERVAL", 30),
        history_window_seconds=_int("PMEOW_HISTORY_WINDOW", 120),
        vram_redundancy_coefficient=_float("PMEOW_VRAM_REDUNDANCY", 0.1),
        state_dir=os.path.expanduser(env.get("PMEOW_STATE_DIR", "~/.pmeow/")),
        socket_path=os.path.expanduser(env.get("PMEOW_SOCKET_PATH", "~/.pmeow/pmeow.sock")),
        log_dir=os.path.expanduser(env.get("PMEOW_LOG_DIR", "~/.pmeow/logs/")),
    )
