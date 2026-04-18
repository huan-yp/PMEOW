from __future__ import annotations

from pmeow.daemon.supervisor import prepare_pid_file


def test_prepare_pid_file_cleans_stale_pid(tmp_path, monkeypatch):
    pid_file = tmp_path / "pmeow-agent.pid"
    pid_file.write_text("4321")

    monkeypatch.setattr("pmeow.daemon.supervisor.is_process_running", lambda pid: False)

    prepare_pid_file(str(pid_file))

    assert not pid_file.exists()
