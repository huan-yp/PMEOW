from __future__ import annotations

import signal
import sys

import pytest

from pmeow.daemon.supervisor import (
    is_background_running,
    prepare_pid_file,
    stop_background_process,
)


def test_prepare_pid_file_rejects_live_process(tmp_path, monkeypatch):
    pid_file = tmp_path / "pmeow-agent.pid"
    pid_file.write_text("1234")

    monkeypatch.setattr("pmeow.daemon.supervisor.is_process_running", lambda pid: True)

    with pytest.raises(RuntimeError, match="already running"):
        prepare_pid_file(str(pid_file))


def test_prepare_pid_file_cleans_stale_pid(tmp_path, monkeypatch):
    pid_file = tmp_path / "pmeow-agent.pid"
    pid_file.write_text("4321")

    monkeypatch.setattr("pmeow.daemon.supervisor.is_process_running", lambda pid: False)

    prepare_pid_file(str(pid_file))

    assert not pid_file.exists()


def test_stop_background_process_signals_and_removes_pid_file(tmp_path, monkeypatch):
    pid_file = tmp_path / "pmeow-agent.pid"
    pid_file.write_text("9876")
    calls: list[tuple[int, signal.Signals]] = []

    def fake_kill(pid: int, sig: signal.Signals) -> None:
        calls.append((pid, sig))

    monkeypatch.setattr("pmeow.daemon.supervisor.os.kill", fake_kill)
    monkeypatch.setattr("pmeow.daemon.supervisor.wait_for_exit", lambda pid, timeout: True)

    assert stop_background_process(str(pid_file), timeout=1.0) is True
    if sys.platform == "win32":
        # On Windows, stop_background_process waits briefly then calls
        # os.kill only if the process hasn't exited yet.  The monkeypatched
        # wait_for_exit returns True immediately, so no kill is expected.
        assert calls == []
    else:
        assert calls == [(9876, signal.SIGTERM)]
    assert not pid_file.exists()


def test_is_background_running_returns_false_for_missing_pid_file(tmp_path):
    assert is_background_running(str(tmp_path / "missing.pid")) is False
