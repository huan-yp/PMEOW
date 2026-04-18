from __future__ import annotations

from pmeow.daemon.systemd import render_unit_file


def test_render_unit_file_uses_run_and_environment_file():
    unit = render_unit_file(
        executable_path="/opt/pmeow-agent/.venv/bin/pmeow-agent",
        working_directory="/opt/pmeow-agent",
        environment_file="/etc/pmeow-agent/pmeow-agent.env",
        service_name="pmeow-agent",
    )

    assert "ExecStart=/opt/pmeow-agent/.venv/bin/pmeow-agent run" in unit
    assert "EnvironmentFile=/etc/pmeow-agent/pmeow-agent.env" in unit
    assert "Type=simple" in unit
