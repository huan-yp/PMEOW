from __future__ import annotations

from pmeow.examples.pytorch_tasks import parse_memories_mb


def test_parse_memories_mb_accepts_units_and_lists():
    assert parse_memories_mb("1024") == [1024]
    assert parse_memories_mb("2g,3072") == [2048, 3072]
