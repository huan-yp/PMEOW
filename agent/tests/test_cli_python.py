from __future__ import annotations

import io
import os
import sys

from pmeow.cli_python import detect_python_invocation, parse_vram_mb


def test_parse_vram_mb_accepts_gigabytes_and_megabytes():
    assert parse_vram_mb("10g") == 10240
    assert parse_vram_mb("512m") == 512
    assert parse_vram_mb("0") == 0


def test_detect_python_invocation_splits_flags_and_script_args(tmp_path):
    script = tmp_path / "train.py"
    script.write_text("print('hi')\n")

    invocation = detect_python_invocation([
        "-vram=10g",
        "-gpus=2",
        "--report",
        str(script),
        "--epochs",
        "3",
    ])

    assert invocation is not None
    assert invocation.require_vram_mb == 10240
    assert invocation.require_gpu_count == 2
    assert invocation.report is True
    assert invocation.script_path == str(script.resolve())
    assert invocation.script_args == ["--epochs", "3"]


def test_detect_python_invocation_skips_submit_subcommand():
    assert detect_python_invocation(["submit", "--pvram", "1024", "--", "python", "train.py"]) is None


def test_detect_python_invocation_returns_none_for_empty():
    assert detect_python_invocation([]) is None


def test_detect_python_invocation_returns_none_for_no_py_file():
    assert detect_python_invocation(["-vram=10g", "--report"]) is None


def test_detect_python_invocation_space_separated_vram(tmp_path):
    script = tmp_path / "run.py"
    script.write_text("")

    invocation = detect_python_invocation(["--vram", "2g", str(script)])

    assert invocation is not None
    assert invocation.require_vram_mb == 2048


def test_detect_python_invocation_space_separated_gpus(tmp_path):
    script = tmp_path / "run.py"
    script.write_text("")

    invocation = detect_python_invocation(["--gpus", "4", str(script)])

    assert invocation is not None
    assert invocation.require_gpu_count == 4


def test_run_python_invocation_uses_username_fallback(monkeypatch, tmp_path):
    from pmeow.cli_python import PythonInvocation, run_python_invocation

    script = tmp_path / "demo.py"
    script.write_text("print('hi')\n")
    seen_users: list[str] = []

    def fake_send_request(socket_path, method, params=None):
        params = params or {}
        if method == "submit_task":
            seen_users.append(params["user"])
            return {"ok": True, "result": {"id": "task-1"}}
        if method == "get_task":
            return {"ok": True, "result": {"status": "completed", "exit_code": 0}}
        raise AssertionError(f"unexpected method: {method}")

    monkeypatch.setattr("pmeow.daemon.socket_server.send_request", fake_send_request)
    monkeypatch.delenv("USER", raising=False)
    monkeypatch.setenv("USERNAME", "windows-user")

    exit_code = run_python_invocation(
        PythonInvocation(
            socket_path="socket",
            require_vram_mb=0,
            require_gpu_count=1,
            priority=10,
            report=False,
            script_path=str(script),
            script_args=[],
        ),
        stdout_target=io.BytesIO(),
        stderr_target=io.BytesIO(),
    )

    assert exit_code == 0
    assert seen_users == ["windows-user"]


def test_run_python_invocation_submits_with_current_cwd_and_interpreter(monkeypatch, tmp_path):
    from pmeow.cli_python import PythonInvocation, run_python_invocation

    script = tmp_path / "demo.py"
    script.write_text("print('hi')\n")
    captured: dict[str, object] = {}

    def fake_send_request(socket_path, method, params=None):
        params = params or {}
        if method == "submit_task":
            captured["params"] = params
            return {"ok": True, "result": {"id": "task-1"}}
        if method == "get_task":
            return {"ok": True, "result": {"status": "completed", "exit_code": 0}}
        raise AssertionError(f"unexpected method: {method}")

    monkeypatch.setattr("pmeow.daemon.socket_server.send_request", fake_send_request)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("USER", "tester")

    exit_code = run_python_invocation(
        PythonInvocation(
            socket_path="socket",
            require_vram_mb=0,
            require_gpu_count=1,
            priority=10,
            report=False,
            script_path=str(script),
            script_args=["--epochs", "3"],
        ),
        stdout_target=io.BytesIO(),
        stderr_target=io.BytesIO(),
    )

    params = captured["params"]
    assert exit_code == 0
    assert params["cwd"] == str(tmp_path)
    assert params["argv"] == [sys.executable, str(script), "--epochs", "3"]


def test_run_python_invocation_attached_launch_uses_task_cwd_and_current_environment(monkeypatch, tmp_path):
    from pmeow.cli_python import PythonInvocation, run_python_invocation

    script = tmp_path / "demo.py"
    script.write_text("print('hi')\n")
    launch_calls: list[dict[str, object]] = []
    finished: list[int] = []
    task_cwd = str(tmp_path / "runtime-cwd")

    def fake_send_request(socket_path, method, params=None):
        params = params or {}
        if method == "submit_task":
            return {"ok": True, "result": {"id": "task-1"}}
        if method == "get_task":
            return {
                "ok": True,
                "result": {
                    "status": "launching",
                    "argv": [sys.executable, str(script)],
                    "cwd": task_cwd,
                    "gpu_ids": [1, 3],
                    "log_path": str(tmp_path / "task.log"),
                },
            }
        if method == "confirm_attached_launch":
            return {"ok": True, "result": True}
        if method == "finish_attached_task":
            finished.append(params["exit_code"])
            return {"ok": True, "result": True}
        raise AssertionError(f"unexpected method: {method}")

    def fake_run_attached_python(**kwargs):
        launch_calls.append(kwargs)
        kwargs["on_started"](4321)
        return 0

    monkeypatch.setattr("pmeow.daemon.socket_server.send_request", fake_send_request)
    monkeypatch.setattr("pmeow.executor.attached.run_attached_python", fake_run_attached_python)
    monkeypatch.setenv("USER", "tester")
    monkeypatch.setenv("PMEOW_ATTACHED_MARKER", "attached-env")

    exit_code = run_python_invocation(
        PythonInvocation(
            socket_path="socket",
            require_vram_mb=0,
            require_gpu_count=0,
            priority=10,
            report=False,
            script_path=str(script),
            script_args=[],
        ),
        stdout_target=io.BytesIO(),
        stderr_target=io.BytesIO(),
    )

    assert exit_code == 0
    assert finished == [0]
    assert len(launch_calls) == 1
    launch = launch_calls[0]
    assert launch["cwd"] == task_cwd
    assert launch["argv"] == [sys.executable, str(script)]
    assert launch["env"]["PMEOW_ATTACHED_MARKER"] == "attached-env"
    assert launch["env"]["CUDA_VISIBLE_DEVICES"] == "1,3"
