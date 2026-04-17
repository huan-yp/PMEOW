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


def test_load_config_reads_log_level(monkeypatch):
    monkeypatch.setenv("PMEOW_LOG_LEVEL", "DEBUG")

    cfg = load_config()

    assert cfg.log_level == logging.DEBUG


def test_load_config_rejects_invalid_log_level(monkeypatch):
    monkeypatch.setenv("PMEOW_LOG_LEVEL", "LOUD")

    with pytest.raises(ValueError, match="PMEOW_LOG_LEVEL"):
        load_config()


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


def test_configure_runtime_logging_respects_debug_level(capsys):
    configure_runtime_logging(log_to_console=True, level=logging.DEBUG)
    logging.getLogger("pmeow.runtime").debug("debug ready")

    captured = capsys.readouterr()
    assert "debug ready" in captured.out
