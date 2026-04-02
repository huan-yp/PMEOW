"""Disk metrics collector."""

from __future__ import annotations

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


def collect_disk() -> DiskSnapshot:
    """Collect a disk snapshot using psutil."""
    disks: list[DiskInfo] = []

    for part in psutil.disk_partitions(all=False):
        if part.fstype in _SKIP_FSTYPES:
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

    io = psutil.disk_io_counters()
    io_read_kbs = round(io.read_bytes / 1024, 1) if io else 0.0
    io_write_kbs = round(io.write_bytes / 1024, 1) if io else 0.0

    return DiskSnapshot(
        disks=disks,
        io_read_kbs=io_read_kbs,
        io_write_kbs=io_write_kbs,
    )
