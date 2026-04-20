from __future__ import annotations

import logging
import shlex
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


def test_submit_freezes_current_cwd_and_environment_without_rewriting_python(monkeypatch, tmp_path):
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

    main(["submit", "--name", "nightly-train", "python", "train.py", "--epochs", "3"])

    params = captured["params"]
    assert captured["method"] == "submit_task"
    assert params["cwd"] == str(tmp_path)
    assert params["env_overrides"]["PMEOW_TEST_ENV"] == "submit-snapshot"
    assert params["argv"] is None
    assert params["task_name"] == "nightly-train"
    assert params["command"] == shlex.join(["python", "train.py", "--epochs", "3"])
