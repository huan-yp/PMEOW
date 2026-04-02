"""Network metrics collector."""

from __future__ import annotations

import psutil

from pmeow.models import NetworkInterface, NetworkSnapshot


def collect_network() -> NetworkSnapshot:
    """Collect a network snapshot using psutil.

    Returns cumulative byte counters per interface.
    Rate calculation (bytes/sec) is done externally; set to 0 here.
    """
    counters = psutil.net_io_counters(pernic=True)

    interfaces = [
        NetworkInterface(
            name=name,
            rx_bytes=stats.bytes_recv,
            tx_bytes=stats.bytes_sent,
        )
        for name, stats in counters.items()
    ]

    return NetworkSnapshot(
        rx_bytes_per_sec=0.0,
        tx_bytes_per_sec=0.0,
        interfaces=interfaces,
    )
