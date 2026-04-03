"""Targeted tests for rate-based collectors and noisy mount filtering."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pmeow.collector.disk as disk_collector
import pmeow.collector.network as network_collector
from pmeow.collector.disk import collect_disk
from pmeow.collector.network import collect_network


def setup_function() -> None:
    disk_collector._PREVIOUS_IO_SAMPLE = None
    network_collector._PREVIOUS_COUNTERS = None
    network_collector._PREVIOUS_SAMPLE_AT = None


def _partition(device: str, mountpoint: str, fstype: str) -> SimpleNamespace:
    return SimpleNamespace(device=device, mountpoint=mountpoint, fstype=fstype)


def _usage(total_gb: float, used_gb: float, free_gb: float, percent: float) -> SimpleNamespace:
    gb = 1024 ** 3
    return SimpleNamespace(
        total=int(total_gb * gb),
        used=int(used_gb * gb),
        free=int(free_gb * gb),
        percent=percent,
    )


def _disk_io(read_bytes: int, write_bytes: int) -> SimpleNamespace:
    return SimpleNamespace(read_bytes=read_bytes, write_bytes=write_bytes)


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


def test_collect_disk_filters_noisy_mounts() -> None:
    partitions = [
        _partition("/dev/sda1", "/", "ext4"),
        _partition("/dev/sdb1", "/data", "xfs"),
        _partition("docker-desktop", "/mnt/wsl/docker-desktop/cli-tools", "9p"),
        _partition("docker-bind", "/mnt/wsl/docker-desktop-bind-mounts/Ubuntu/hash", "ext4"),
        _partition("/dev/sdc1", "/mnt/wslg/distro", "ext4"),
        _partition("overlay", "/var/lib/docker", "ext4"),
    ]
    usage_by_mount = {
        "/": _usage(100.0, 34.0, 66.0, 34.0),
        "/data": _usage(500.0, 120.0, 380.0, 24.0),
    }

    with patch("pmeow.collector.disk.psutil.disk_partitions", return_value=partitions), patch(
        "pmeow.collector.disk.psutil.disk_usage",
        side_effect=lambda mountpoint: usage_by_mount[mountpoint],
    ), patch(
        "pmeow.collector.disk.psutil.disk_io_counters",
        return_value=_disk_io(0, 0),
    ), patch(
        "pmeow.collector.disk.time.monotonic",
        return_value=1.0,
    ):
        snapshot = collect_disk()

    assert [disk.mount_point for disk in snapshot.disks] == ["/", "/data"]


def test_collect_disk_returns_rate_from_previous_sample() -> None:
    partitions = [_partition("/dev/sda1", "/", "ext4")]
    usage = _usage(100.0, 40.0, 60.0, 40.0)

    with patch("pmeow.collector.disk.psutil.disk_partitions", return_value=partitions), patch(
        "pmeow.collector.disk.psutil.disk_usage",
        return_value=usage,
    ), patch(
        "pmeow.collector.disk.psutil.disk_io_counters",
        side_effect=[_disk_io(1_024, 2_048), _disk_io(5_120, 8_192)],
    ), patch(
        "pmeow.collector.disk.time.monotonic",
        side_effect=[10.0, 12.0],
    ):
        first = collect_disk()
        second = collect_disk()

    assert first.io_read_kbs == 0.0
    assert first.io_write_kbs == 0.0
    assert second.io_read_kbs == 2.0
    assert second.io_write_kbs == 3.0