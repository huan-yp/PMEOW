from __future__ import annotations

import io

from pmeow.cli_foreground import detect_foreground_invocation, parse_vram_mb


def test_parse_vram_mb_accepts_gigabytes_and_megabytes():
    assert parse_vram_mb("10g") == 10240
    assert parse_vram_mb("512m") == 512
    assert parse_vram_mb("0") == 0


def test_detect_foreground_invocation_splits_flags_and_command(tmp_path):
    invocation = detect_foreground_invocation([
        "--vram=10g",
        "--gpus=2",
        "--name=nightly-train",
        "python",
        "train.py",
        "--epochs",
        "3",
    ])

    assert invocation is not None
    assert invocation.require_vram_mb == 10240
    assert invocation.requested_vram_mb == 10240
    assert invocation.vram_mode == "shared"
    assert invocation.require_gpu_count == 2
    assert invocation.task_name == "nightly-train"
    assert invocation.argv == ["python", "train.py", "--epochs", "3"]


def test_detect_foreground_invocation_defaults_to_omitted_vram():
    invocation = detect_foreground_invocation([
        "--gpus=1",
        "sh",
        "run.sh",
    ])

    assert invocation is not None
    assert invocation.require_vram_mb == 0
    assert invocation.requested_vram_mb is None
    assert invocation.vram_mode == "exclusive_auto"
    assert invocation.argv == ["sh", "run.sh"]


def test_detect_foreground_invocation_edge_cases():
    assert detect_foreground_invocation(["submit", "--vram", "1024", "python", "train.py"]) is None
    assert detect_foreground_invocation([]) is None
    assert detect_foreground_invocation(["--vram=10g"]) is None
    assert detect_foreground_invocation(["--help"]) is None
    assert detect_foreground_invocation(["status"]) is None


def test_detect_foreground_invocation_no_single_dash_flags():
    """Single-dash long flags like -vram are no longer accepted."""
    import pytest

    with pytest.raises(SystemExit):
        detect_foreground_invocation(["-vram=10g", "python", "train.py"])


def test_detect_foreground_invocation_transparent_passthrough():
    """PMEOW flags after the command boundary belong to the child."""
    invocation = detect_foreground_invocation([
        "--gpus=2",
        "python",
        "-m",
        "torch.distributed.run",
        "--gpus=4",
    ])

    assert invocation is not None
    assert invocation.argv == ["python", "-m", "torch.distributed.run", "--gpus=4"]
    assert invocation.require_gpu_count == 2


def test_run_foreground_invocation_submits_with_explicit_argv(monkeypatch, tmp_path):
    from pmeow.cli_foreground import ForegroundInvocation, run_foreground_invocation

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

    exit_code = run_foreground_invocation(
        ForegroundInvocation(
            socket_path="socket",
            require_vram_mb=0,
            requested_vram_mb=None,
            vram_mode="exclusive_auto",
            require_gpu_count=1,
            priority=10,
            task_name="nightly-train",
            argv=["python", "train.py", "--epochs", "3"],
        ),
        stdout_target=io.BytesIO(),
        stderr_target=io.BytesIO(),
    )

    params = captured["params"]
    assert exit_code == 0
    assert params["cwd"] == str(tmp_path)
    assert params["argv"] == ["python", "train.py", "--epochs", "3"]
    assert params["launch_mode"] == "foreground"
    assert params["task_name"] == "nightly-train"
    assert params["require_vram_mb"] == 0
    assert params["requested_vram_mb"] is None
    assert params["vram_mode"] == "exclusive_auto"
