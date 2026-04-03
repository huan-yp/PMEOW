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
