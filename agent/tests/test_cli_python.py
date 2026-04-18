from __future__ import annotations

import io
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
        str(script),
        "--epochs",
        "3",
    ])

    assert invocation is not None
    assert invocation.require_vram_mb == 10240
    assert invocation.require_gpu_count == 2
    assert invocation.script_path == str(script.resolve())
    assert invocation.script_args == ["--epochs", "3"]


def test_detect_python_invocation_edge_cases():
    assert detect_python_invocation(["submit", "--pvram", "1024", "--", "python", "train.py"]) is None
    assert detect_python_invocation([]) is None
    assert detect_python_invocation(["-vram=10g"]) is None


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
