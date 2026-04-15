from __future__ import annotations

import logging
import os
import shlex
import sys
from typing import Any

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


def test_build_parser_accepts_systemd_commands():
    parser = build_parser()

    assert parser.parse_args(["install-service"]).command == "install-service"
    assert parser.parse_args(["install-service", "--enable", "--start"]).start is True
    assert parser.parse_args(["uninstall-service"]).command == "uninstall-service"


def test_run_foreground_warns_when_server_url_missing(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PMEOW_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.delenv("PMEOW_SERVER_URL", raising=False)

    class FakeService:
        def __init__(self, config):
            pass

        def start(self):
            pass

    monkeypatch.setattr("pmeow.cli_runtime.DaemonService", FakeService)

    run_foreground(type("Args", (), {"command": "run"})())

    stderr = capsys.readouterr().err
    assert "PMEOW_SERVER_URL" in stderr
    assert "export PMEOW_SERVER_URL=" in stderr


def test_run_foreground_no_warning_when_server_url_set(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PMEOW_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("PMEOW_SERVER_URL", "http://localhost:17200")

    class FakeService:
        def __init__(self, config):
            pass

        def start(self):
            pass

    monkeypatch.setattr("pmeow.cli_runtime.DaemonService", FakeService)

    run_foreground(type("Args", (), {"command": "run"})())

    stderr = capsys.readouterr().err
    assert "PMEOW_SERVER_URL" not in stderr


def test_start_background_warns_when_server_url_missing(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PMEOW_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.delenv("PMEOW_SERVER_URL", raising=False)

    with pytest.raises(SystemExit):
        start_background(type("Args", (), {"agent_log_file": None})())

    stderr = capsys.readouterr().err
    assert "PMEOW_SERVER_URL" in stderr


def test_submit_freezes_current_cwd_environment_and_python_interpreter(monkeypatch, tmp_path):
    captured: dict[str, Any] = {}

    def fake_send_request(socket_path, method, params):
        captured["socket_path"] = socket_path
        captured["method"] = method
        captured["params"] = params
        return {"ok": True, "result": {"id": "task-1"}}

    monkeypatch.setattr("pmeow.daemon.socket_server.send_request", fake_send_request)
    monkeypatch.setenv("USER", "tester")
    monkeypatch.setenv("PMEOW_TEST_ENV", "submit-snapshot")
    monkeypatch.chdir(tmp_path)

    main(["submit", "python", "train.py", "--epochs", "3"])

    params = captured["params"]
    assert captured["method"] == "submit_task"
    assert params["cwd"] == str(tmp_path)
    assert params["env_overrides"]["PMEOW_TEST_ENV"] == "submit-snapshot"
    assert params["argv"] == [sys.executable, "train.py", "--epochs", "3"]
    assert params["command"] == shlex.join([sys.executable, "train.py", "--epochs", "3"])
