"""Agent configuration with environment variable overrides."""

from __future__ import annotations

import os
import sys
import socket
import logging
from dataclasses import dataclass, field
from pathlib import Path


def _default_state_dir() -> str:
    return os.path.expanduser("~/.pmeow/")


@dataclass
class AgentConfig:
    server_url: str = ""
    agent_id: str | None = None
    log_level: int = logging.INFO
    collection_interval: int = 1
    history_window_seconds: int = 120
    attach_timeout: int = 30
    vram_redundancy_coefficient: float = 0.1
    state_dir: str = field(default_factory=_default_state_dir)
    socket_path: str = field(default_factory=lambda: os.path.expanduser("~/.pmeow/pmeow.sock"))
    log_dir: str = field(default_factory=lambda: os.path.expanduser("~/.pmeow/logs/"))
    pid_file: str = field(default_factory=lambda: os.path.expanduser("~/.pmeow/pmeow-agent.pid"))
    agent_log_file: str | None = None


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


def validate_optional_path(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    return validate_path(value)


def validate_log_level(value: str | int) -> int:
    """Normalize a logging level from env or CLI-compatible input."""
    if isinstance(value, int):
        return value

    raw = str(value).strip()
    if not raw:
        return logging.INFO

    if raw.isdigit():
        return int(raw)

    level = getattr(logging, raw.upper(), None)
    if isinstance(level, int):
        return level

    raise ValueError(
        f"PMEOW_LOG_LEVEL must be one of DEBUG, INFO, WARNING, ERROR, CRITICAL, got {value!r}"
    )


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
        _int("PMEOW_COLLECTION_INTERVAL", 1), "collection_interval"
    )
    log_level = validate_log_level(env.get("PMEOW_LOG_LEVEL", "INFO"))
    attach_timeout = validate_interval(
        _int("PMEOW_ATTACH_TIMEOUT", 30), "attach_timeout"
    )
    history_window_seconds = validate_interval(
        _int("PMEOW_HISTORY_WINDOW", 120), "history_window_seconds"
    )
    vram_redundancy_coefficient = validate_redundancy_coefficient(
        _float("PMEOW_VRAM_REDUNDANCY", 0.1)
    )

    state_dir = validate_path(env.get("PMEOW_STATE_DIR", "~/.pmeow/"))
    socket_path = validate_path(env.get("PMEOW_SOCKET_PATH", str(Path(state_dir) / "pmeow.sock")))
    log_dir = validate_path(env.get("PMEOW_LOG_DIR", str(Path(state_dir) / "logs")))
    pid_file = validate_path(env.get("PMEOW_PID_FILE", str(Path(state_dir) / "pmeow-agent.pid")))
    agent_log_file = validate_optional_path(env.get("PMEOW_AGENT_LOG_FILE"))

    return AgentConfig(
        server_url=env.get("PMEOW_SERVER_URL", ""),
        agent_id=agent_id,
        log_level=log_level,
        collection_interval=collection_interval,
        history_window_seconds=history_window_seconds,
        attach_timeout=attach_timeout,
        vram_redundancy_coefficient=vram_redundancy_coefficient,
        state_dir=state_dir,
        socket_path=socket_path,
        log_dir=log_dir,
        pid_file=pid_file,
        agent_log_file=agent_log_file,
    )


def warn_missing_server_url(config: AgentConfig) -> None:
    """Print a bilingual warning if PMEOW_SERVER_URL is not configured."""
    if config.server_url:
        return
    print(
        "\n"
        "⚠ PMEOW_SERVER_URL is not set. The agent will run in local-only mode (no server connection).\n"
        "⚠ PMEOW_SERVER_URL 未设置。Agent 将以本地模式运行（不连接服务器）。\n"
        "\n"
        "To configure / 配置方法:\n"
        "  export PMEOW_SERVER_URL=http://your-server:17200\n",
        file=sys.stderr,
    )
