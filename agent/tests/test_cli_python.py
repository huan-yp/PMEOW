from __future__ import annotations

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
