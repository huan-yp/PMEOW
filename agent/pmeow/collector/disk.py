"""Disk metrics collector."""

from __future__ import annotations

import time

import psutil

from pmeow.models import DiskInfo, DiskSnapshot

_GB = 1024 ** 3

# Virtual filesystem types to skip.
_SKIP_FSTYPES = frozenset({
    "tmpfs", "devtmpfs", "squashfs", "overlay", "proc", "sysfs",
    "devpts", "cgroup", "cgroup2", "autofs", "debugfs", "hugetlbfs",
    "mqueue", "securityfs", "pstore", "binfmt_misc", "configfs",
    "fusectl", "tracefs", "fuse.lxcfs",
})
_SKIP_MOUNT_PREFIXES = frozenset({
    "/mnt/wsl",
    "/mnt/wslg",
    "/var/lib/docker",
})
_PREVIOUS_IO_SAMPLE: tuple[int, int, float] | None = None


def _is_noisy_mount_point(mount_point: str) -> bool:
    normalized = mount_point.rstrip("/") or "/"
    if normalized == "/":
        return False

    return any(
        normalized == prefix or normalized.startswith(prefix + "/")
        for prefix in _SKIP_MOUNT_PREFIXES
    )


def _compute_io_rates(io: object | None) -> tuple[float, float]:
    global _PREVIOUS_IO_SAMPLE

    if io is None:
        _PREVIOUS_IO_SAMPLE = None
        return 0.0, 0.0

    sample_at = time.monotonic()
    read_bytes = getattr(io, "read_bytes", 0)
    write_bytes = getattr(io, "write_bytes", 0)
    io_read_kbs = 0.0
    io_write_kbs = 0.0

    if _PREVIOUS_IO_SAMPLE is not None:
        prev_read, prev_write, prev_sample_at = _PREVIOUS_IO_SAMPLE
        elapsed = sample_at - prev_sample_at
        if elapsed > 0:
            io_read_kbs = round(max(0, read_bytes - prev_read) / 1024 / elapsed, 1)
            io_write_kbs = round(max(0, write_bytes - prev_write) / 1024 / elapsed, 1)

    _PREVIOUS_IO_SAMPLE = (read_bytes, write_bytes, sample_at)
    return io_read_kbs, io_write_kbs


def collect_disk() -> DiskSnapshot:
    """Collect a disk snapshot using psutil."""
    disks: list[DiskInfo] = []

    for part in psutil.disk_partitions(all=False):
        if part.fstype in _SKIP_FSTYPES:
            continue
        if _is_noisy_mount_point(part.mountpoint):
            continue
        try:
            usage = psutil.disk_usage(part.mountpoint)
        except (PermissionError, OSError):
            continue

        disks.append(DiskInfo(
            filesystem=part.device,
            mount_point=part.mountpoint,
            total_gb=round(usage.total / _GB, 2),
            used_gb=round(usage.used / _GB, 2),
            available_gb=round(usage.free / _GB, 2),
            usage_percent=round(usage.percent, 1),
        ))

    io_read_kbs, io_write_kbs = _compute_io_rates(psutil.disk_io_counters())

    return DiskSnapshot(
        disks=disks,
        io_read_kbs=io_read_kbs,
        io_write_kbs=io_write_kbs,
    )
