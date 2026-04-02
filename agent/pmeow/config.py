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


def validate_interval(value: int, name: str) -> int:
    """Normalize and validate an interval value (must be a positive integer)."""
    value = int(value)
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer, got {value}")
    return value


def validate_redundancy_coefficient(value: float) -> float:
    """Normalize and validate vram_redundancy_coefficient (0 <= v < 1.0)."""
    value = float(value)
    if value < 0 or value >= 1.0:
        raise ValueError(
            f"vram_redundancy_coefficient must be >= 0 and < 1.0, got {value}"
        )
    return value


def validate_path(value: str) -> str:
    """Normalize a path to an absolute path."""
    return str(Path(os.path.expanduser(value)).resolve())


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

    collection_interval = validate_interval(
        _int("PMEOW_COLLECTION_INTERVAL", 5), "collection_interval"
    )
    heartbeat_interval = validate_interval(
        _int("PMEOW_HEARTBEAT_INTERVAL", 30), "heartbeat_interval"
    )
    history_window_seconds = validate_interval(
        _int("PMEOW_HISTORY_WINDOW", 120), "history_window_seconds"
    )
    vram_redundancy_coefficient = validate_redundancy_coefficient(
        _float("PMEOW_VRAM_REDUNDANCY", 0.1)
    )

    return AgentConfig(
        server_url=env.get("PMEOW_SERVER_URL", ""),
        agent_id=agent_id,
        collection_interval=collection_interval,
        heartbeat_interval=heartbeat_interval,
        history_window_seconds=history_window_seconds,
        vram_redundancy_coefficient=vram_redundancy_coefficient,
        state_dir=validate_path(env.get("PMEOW_STATE_DIR", "~/.pmeow/")),
        socket_path=validate_path(env.get("PMEOW_SOCKET_PATH", "~/.pmeow/pmeow.sock")),
        log_dir=validate_path(env.get("PMEOW_LOG_DIR", "~/.pmeow/logs/")),
    )
