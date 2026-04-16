"""Smoke tests for the pmeow agent package."""

import pytest


def test_import():
    import pmeow
    assert isinstance(pmeow.__version__, str)


def test_cli_status():
    from pmeow.__main__ import main

    with pytest.raises((SystemExit, ConnectionRefusedError, FileNotFoundError)):
        main(["status"])


def test_cli_help():
    from pmeow.__main__ import main

    with pytest.raises(SystemExit) as exc_info:
        main(["--help"])
    assert exc_info.value.code == 0


def test_config_defaults():
    from pmeow.config import load_config

    cfg = load_config()
    assert cfg.vram_redundancy_coefficient == 0.1
    assert cfg.collection_interval == 5
    assert cfg.heartbeat_interval == 30
    assert cfg.server_url == ""


def test_cli_run_help():
    from pmeow.__main__ import main

    with pytest.raises(SystemExit) as exc_info:
        main(["run", "--help"])

    assert exc_info.value.code == 0


def test_cli_daemon_alias_parses():
    from pmeow.__main__ import build_parser

    args = build_parser().parse_args(["daemon"])
    assert args.command == "daemon"
