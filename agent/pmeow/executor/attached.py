"""Attached Python executor — runs a child process with terminal I/O and log tee."""

from __future__ import annotations

import subprocess
import sys
import threading
from typing import BinaryIO, Callable


def run_attached_python(
    *,
    argv: list[str],
    cwd: str,
    env: dict[str, str],
    log_path: str,
    on_started: Callable[[int], None],
    stdin_source: BinaryIO | None = None,
    stdout_target: BinaryIO | None = None,
    stderr_target: BinaryIO | None = None,
) -> int:
    """Run *argv* as a subprocess, tee stdout/stderr to terminal + log file.

    - stdout_target defaults to sys.stdout.buffer
    - stderr_target defaults to sys.stderr.buffer
    - If stdin_source is provided, it feeds stdin to the child
    - on_started is called with the child PID immediately after spawn
    """
    stdout_target = stdout_target or sys.stdout.buffer
    stderr_target = stderr_target or sys.stderr.buffer
    stdin_mode = subprocess.PIPE if stdin_source is not None else None

    with open(log_path, "ab") as log_fh:
        proc = subprocess.Popen(
            argv,
            cwd=cwd,
            env=env,
            stdin=stdin_mode,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        on_started(proc.pid)

        threads: list[threading.Thread] = []

        def _pump(source: BinaryIO, target: BinaryIO) -> None:
            while True:
                chunk = source.read(8192)
                if not chunk:
                    break
                target.write(chunk)
                target.flush()
                log_fh.write(chunk)
                log_fh.flush()

        if stdin_source is not None and proc.stdin is not None:
            def _feed_stdin() -> None:
                assert proc.stdin is not None
                proc.stdin.write(stdin_source.read())
                proc.stdin.close()
            stdin_thread = threading.Thread(target=_feed_stdin, daemon=True)
            stdin_thread.start()
            threads.append(stdin_thread)

        assert proc.stdout is not None
        assert proc.stderr is not None
        out_thread = threading.Thread(target=_pump, args=(proc.stdout, stdout_target), daemon=True)
        err_thread = threading.Thread(target=_pump, args=(proc.stderr, stderr_target), daemon=True)
        out_thread.start()
        err_thread.start()
        threads.extend([out_thread, err_thread])

        exit_code = proc.wait()
        for t in threads:
            t.join(timeout=5)
        return exit_code
