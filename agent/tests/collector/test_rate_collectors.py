"""Targeted tests for rate-based collectors."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pmeow.collector.network as network_collector
from pmeow.collector.network import collect_network


def setup_function() -> None:
    network_collector._PREVIOUS_COUNTERS = None
    network_collector._PREVIOUS_SAMPLE_AT = None


def _net_io(rx_bytes: int, tx_bytes: int) -> SimpleNamespace:
    return SimpleNamespace(bytes_recv=rx_bytes, bytes_sent=tx_bytes)


def test_collect_network_returns_rate_from_previous_sample() -> None:
    with patch(
        "pmeow.collector.network.psutil.net_io_counters",
        side_effect=[
            {"eth0": _net_io(1_000, 500)},
            {"eth0": _net_io(1_600, 800)},
        ],
    ), patch(
        "pmeow.collector.network.time.monotonic",
        side_effect=[10.0, 12.0],
    ):
        first = collect_network()
        second = collect_network()

    assert first.rx_bytes_per_sec == 0.0
    assert first.tx_bytes_per_sec == 0.0
    assert second.rx_bytes_per_sec == 300.0
    assert second.tx_bytes_per_sec == 150.0
    assert second.interfaces[0].rx_bytes == 1_600
    assert second.interfaces[0].tx_bytes == 800