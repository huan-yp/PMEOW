"""Disk metrics collector."""

from __future__ import annotations

import os
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

# Exact mount points injected by Docker / container runtimes.
_SKIP_MOUNT_EXACT = frozenset({
    "/etc/resolv.conf",
    "/etc/hostname",
    "/etc/hosts",
})
_PREVIOUS_IO_SAMPLE: tuple[int, int, float] | None = None


def _is_noisy_mount_point(mount_point: str) -> bool:
    normalized = mount_point.rstrip("/") or "/"
    if normalized == "/":
        return False

    # Exact matches (Docker-injected config files).
    if normalized in _SKIP_MOUNT_EXACT:
        return True

    # File-level bind mounts (e.g. /usr/bin/nvidia-smi, /usr/lib/.../lib*.so.*).
    # These are individual files mounted from the host, not real partitions.
    if os.path.isfile(mount_point):
        return True

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

    # Deduplicate: when multiple mount points map to the same physical device
    # and capacity (e.g. /mnt and /pfs both backed by the same volume), keep
    # only the one with the shortest mount path.
    seen: dict[tuple[str, float], DiskInfo] = {}
    for d in disks:
        key = (d.filesystem, d.total_gb)
        existing = seen.get(key)
        if existing is None or len(d.mount_point) < len(existing.mount_point):
            seen[key] = d
    disks = list(seen.values())

    io_read_kbs, io_write_kbs = _compute_io_rates(psutil.disk_io_counters())

    return DiskSnapshot(
        disks=disks,
        io_read_kbs=io_read_kbs,
        io_write_kbs=io_write_kbs,
    )
