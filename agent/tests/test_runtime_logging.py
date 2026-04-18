from __future__ import annotations

import logging
import pytest

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
