"""Network metrics collector."""

from __future__ import annotations

import time

import psutil

from pmeow.models import NetworkInterface, NetworkSnapshot

_PREVIOUS_COUNTERS: dict[str, tuple[int, int]] | None = None
_PREVIOUS_SAMPLE_AT: float | None = None


def collect_network() -> NetworkSnapshot:
    """Collect a network snapshot using psutil.

    Returns cumulative byte counters per interface and a computed aggregate rate.
    """
    global _PREVIOUS_COUNTERS, _PREVIOUS_SAMPLE_AT

    counters = psutil.net_io_counters(pernic=True)
    sample_at = time.monotonic()

    interfaces = [
        NetworkInterface(
            name=name,
            rx_bytes=stats.bytes_recv,
            tx_bytes=stats.bytes_sent,
        )
        for name, stats in counters.items()
    ]

    rx_bytes_per_sec = 0.0
    tx_bytes_per_sec = 0.0

    if _PREVIOUS_COUNTERS is not None and _PREVIOUS_SAMPLE_AT is not None:
        elapsed = sample_at - _PREVIOUS_SAMPLE_AT
        if elapsed > 0:
            rx_delta = 0
            tx_delta = 0
            for name, stats in counters.items():
                previous = _PREVIOUS_COUNTERS.get(name)
                if previous is None:
                    continue
                rx_delta += max(0, stats.bytes_recv - previous[0])
                tx_delta += max(0, stats.bytes_sent - previous[1])

            rx_bytes_per_sec = round(rx_delta / elapsed, 1)
            tx_bytes_per_sec = round(tx_delta / elapsed, 1)

    _PREVIOUS_COUNTERS = {
        name: (stats.bytes_recv, stats.bytes_sent)
        for name, stats in counters.items()
    }
    _PREVIOUS_SAMPLE_AT = sample_at

    return NetworkSnapshot(
        rx_bytes_per_sec=rx_bytes_per_sec,
        tx_bytes_per_sec=tx_bytes_per_sec,
        interfaces=interfaces,
    )
