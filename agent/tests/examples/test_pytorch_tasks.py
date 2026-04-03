from __future__ import annotations

import importlib

import pytest

from pmeow.examples.pytorch_tasks import load_torch_or_exit, parse_memories_mb


def test_parse_memories_mb_accepts_units_and_lists():
    assert parse_memories_mb("1024") == [1024]
    assert parse_memories_mb("2g,3072") == [2048, 3072]


def test_load_torch_or_exit_prints_install_guidance(monkeypatch, capsys):
    def _fail(name: str):
        raise ModuleNotFoundError(name)

    monkeypatch.setattr(importlib, "import_module", _fail)

    with pytest.raises(SystemExit) as exc_info:
        load_torch_or_exit()

    assert exc_info.value.code == 2
    assert "install a torch build yourself" in capsys.readouterr().err.lower()
