from __future__ import annotations

import io
import os
import sys

from pmeow.executor.attached import run_attached_command


def test_run_attached_command_streams_to_console_and_log(tmp_path):
    script = tmp_path / "attached_demo.py"
    script.write_text(
        "import sys\n"
        "print('stdout-line')\n"
        "print('stderr-line', file=sys.stderr)\n"
    )
    seen_pid: list[int] = []
    log_path = tmp_path / "attached.log"
    out = io.BytesIO()
    err = io.BytesIO()

    exit_code = run_attached_command(
        argv=[sys.executable, str(script)],
        cwd=str(tmp_path),
        env=os.environ.copy(),
        log_path=str(log_path),
        on_started=seen_pid.append,
        stdout_target=out,
        stderr_target=err,
    )

    assert exit_code == 0
    assert seen_pid
    assert b"stdout-line" in out.getvalue()
    assert b"stderr-line" in err.getvalue()
    log_content = log_path.read_text()
    assert "stdout-line" in log_content
    assert "stderr-line" in log_content


def test_run_attached_command_returns_nonzero_exit_code(tmp_path):
    script = tmp_path / "fail.py"
    script.write_text("import sys; sys.exit(42)\n")
    log_path = tmp_path / "fail.log"

    exit_code = run_attached_command(
        argv=[sys.executable, str(script)],
        cwd=str(tmp_path),
        env=os.environ.copy(),
        log_path=str(log_path),
        on_started=lambda pid: None,
        stdout_target=io.BytesIO(),
        stderr_target=io.BytesIO(),
    )

    assert exit_code == 42


def test_normalize_attached_exit_code_sigint_returns_130():
    import signal

    from pmeow.executor.attached import _normalize_attached_exit_code

    assert _normalize_attached_exit_code(-signal.SIGINT) == 130


def test_normalize_attached_exit_code_preserves_zero():
    from pmeow.executor.attached import _normalize_attached_exit_code

    assert _normalize_attached_exit_code(0) == 0


def test_normalize_attached_exit_code_preserves_nonzero():
    from pmeow.executor.attached import _normalize_attached_exit_code

    assert _normalize_attached_exit_code(5) == 5
