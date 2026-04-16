from __future__ import annotations

import io
import os
import sys
import threading
import time

from pmeow.executor.attached import run_attached_python


class _ThreadSafeCapture:
    def __init__(self) -> None:
        self._buffer = bytearray()
        self._lock = threading.Lock()

    def write(self, chunk: bytes) -> int:
        with self._lock:
            self._buffer.extend(chunk)
        return len(chunk)

    def flush(self) -> None:
        return None

    def getvalue(self) -> bytes:
        with self._lock:
            return bytes(self._buffer)


def test_run_attached_python_streams_to_console_and_log(tmp_path):
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

    exit_code = run_attached_python(
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


def test_run_attached_python_forwards_stdin(tmp_path):
    script = tmp_path / "stdin_demo.py"
    script.write_text("print(input())\n")
    log_path = tmp_path / "stdin.log"
    out = io.BytesIO()

    exit_code = run_attached_python(
        argv=[sys.executable, str(script)],
        cwd=str(tmp_path),
        env=os.environ.copy(),
        log_path=str(log_path),
        stdin_source=io.BytesIO(b"hello from stdin\n"),
        on_started=lambda pid: None,
        stdout_target=out,
    )

    assert exit_code == 0
    assert b"hello from stdin" in out.getvalue()


def test_run_attached_python_returns_nonzero_exit_code(tmp_path):
    script = tmp_path / "fail.py"
    script.write_text("import sys; sys.exit(42)\n")
    log_path = tmp_path / "fail.log"

    exit_code = run_attached_python(
        argv=[sys.executable, str(script)],
        cwd=str(tmp_path),
        env=os.environ.copy(),
        log_path=str(log_path),
        on_started=lambda pid: None,
        stdout_target=io.BytesIO(),
        stderr_target=io.BytesIO(),
    )

    assert exit_code == 42


def test_run_attached_python_streams_stdout_before_process_exit(tmp_path):
    script = tmp_path / "slow_output.py"
    script.write_text(
        "import time\n"
        "print('stdout-live')\n"
        "time.sleep(0.8)\n"
    )
    log_path = tmp_path / "slow_output.log"
    out = _ThreadSafeCapture()
    result: dict[str, int] = {}

    thread = threading.Thread(
        target=lambda: result.setdefault(
            "exit_code",
            run_attached_python(
                argv=[sys.executable, str(script)],
                cwd=str(tmp_path),
                env=os.environ.copy(),
                log_path=str(log_path),
                on_started=lambda pid: None,
                stdout_target=out,
                stderr_target=io.BytesIO(),
            ),
        ),
        daemon=True,
    )
    thread.start()

    deadline = time.monotonic() + 0.4
    while time.monotonic() < deadline and b"stdout-live" not in out.getvalue():
        time.sleep(0.02)

    assert b"stdout-live" in out.getvalue()

    thread.join(timeout=3)
    assert result["exit_code"] == 0
