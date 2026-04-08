"""Tests for the base host metrics collectors."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from pmeow.collector.cpu import collect_cpu
from pmeow.collector.disk import collect_disk
from pmeow.collector.docker import collect_docker
from pmeow.collector.local_users import collect_local_users
from pmeow.collector.memory import collect_memory
from pmeow.collector.processes import collect_processes
from pmeow.collector.snapshot import collect_snapshot
from pmeow.collector.system import collect_system
from pmeow.models import (
    CpuSnapshot,
    DiskSnapshot,
    DockerContainer,
    GpuSnapshot,
    MemorySnapshot,
    MetricsSnapshot,
    NetworkSnapshot,
    ProcessInfo,
    SystemSnapshot,
)


def test_snapshot_has_expected_keys():
    snap = collect_snapshot("test-server")
    assert isinstance(snap, MetricsSnapshot)
    assert snap.server_id == "test-server"
    assert isinstance(snap.timestamp, float)
    assert isinstance(snap.cpu, CpuSnapshot)
    assert isinstance(snap.memory, MemorySnapshot)
    assert isinstance(snap.disk, DiskSnapshot)
    assert isinstance(snap.network, NetworkSnapshot)
    assert isinstance(snap.gpu, GpuSnapshot)
    assert snap.gpu.available is False
    assert isinstance(snap.processes, list)
    assert isinstance(snap.docker, list)
    assert isinstance(snap.system, SystemSnapshot)
    assert snap.gpu_allocation is None


def test_docker_fallback_returns_empty_list():
    with patch("pmeow.collector.docker.subprocess.run", side_effect=FileNotFoundError):
        result = collect_docker()
    assert result == []


def test_process_collector_returns_commands():
    procs = collect_processes()
    assert len(procs) > 0
    assert any(p.command for p in procs), "expected at least one process with a non-empty command"


def test_disk_collector_includes_mount_points():
    disk = collect_disk()
    assert len(disk.disks) > 0, "expected at least one disk partition"
    assert all(isinstance(d.mount_point, str) and d.mount_point for d in disk.disks)


def test_disk_collector_filters_etc_bind_mounts():
    """Docker-injected /etc files should be filtered out."""
    fake_parts = [
        SimpleNamespace(device="/dev/sda1", mountpoint="/", fstype="ext4", opts="rw"),
        SimpleNamespace(device="/dev/sda2", mountpoint="/etc/resolv.conf", fstype="ext4", opts="rw"),
        SimpleNamespace(device="/dev/sda2", mountpoint="/etc/hostname", fstype="ext4", opts="rw"),
        SimpleNamespace(device="/dev/sda2", mountpoint="/etc/hosts", fstype="ext4", opts="rw"),
    ]
    fake_usage = SimpleNamespace(total=500 * 1024**3, used=200 * 1024**3, free=300 * 1024**3, percent=40.0)
    fake_io = SimpleNamespace(read_bytes=0, write_bytes=0)

    with patch("pmeow.collector.disk.psutil.disk_partitions", return_value=fake_parts), \
         patch("pmeow.collector.disk.psutil.disk_usage", return_value=fake_usage), \
         patch("pmeow.collector.disk.psutil.disk_io_counters", return_value=fake_io), \
         patch("pmeow.collector.disk.os.path.isfile", return_value=False):
        disk = collect_disk()
    mount_points = [d.mount_point for d in disk.disks]
    assert "/" in mount_points
    assert "/etc/resolv.conf" not in mount_points
    assert "/etc/hostname" not in mount_points
    assert "/etc/hosts" not in mount_points


def test_disk_collector_filters_file_bind_mounts():
    """File-level bind mounts (e.g. nvidia-smi) should be filtered via os.path.isfile."""
    fake_parts = [
        SimpleNamespace(device="/dev/sda1", mountpoint="/", fstype="ext4", opts="rw"),
        SimpleNamespace(device="/dev/sda1", mountpoint="/usr/bin/nvidia-smi", fstype="ext4", opts="rw"),
        SimpleNamespace(device="/dev/sda1", mountpoint="/usr/lib/x86_64-linux-gnu/libnvidia-ml.so.570.124.06", fstype="ext4", opts="rw"),
    ]
    fake_usage = SimpleNamespace(total=500 * 1024**3, used=200 * 1024**3, free=300 * 1024**3, percent=40.0)
    fake_io = SimpleNamespace(read_bytes=0, write_bytes=0)

    def fake_isfile(path):
        return path != "/"

    with patch("pmeow.collector.disk.psutil.disk_partitions", return_value=fake_parts), \
         patch("pmeow.collector.disk.psutil.disk_usage", return_value=fake_usage), \
         patch("pmeow.collector.disk.psutil.disk_io_counters", return_value=fake_io), \
         patch("pmeow.collector.disk.os.path.isfile", side_effect=fake_isfile):
        disk = collect_disk()
    mount_points = [d.mount_point for d in disk.disks]
    assert mount_points == ["/"]


def test_disk_collector_deduplicates_same_device():
    """Multiple mounts of the same device+size should be deduplicated to the shortest path."""
    fake_parts = [
        SimpleNamespace(device="/dev/vdb", mountpoint="/mnt", fstype="ext4", opts="rw"),
        SimpleNamespace(device="/dev/vdb", mountpoint="/pfs", fstype="ext4", opts="rw"),
    ]
    fake_usage = SimpleNamespace(total=400 * 1024**3, used=270 * 1024**3, free=130 * 1024**3, percent=67.5)
    fake_io = SimpleNamespace(read_bytes=0, write_bytes=0)

    with patch("pmeow.collector.disk.psutil.disk_partitions", return_value=fake_parts), \
         patch("pmeow.collector.disk.psutil.disk_usage", return_value=fake_usage), \
         patch("pmeow.collector.disk.psutil.disk_io_counters", return_value=fake_io), \
         patch("pmeow.collector.disk.os.path.isfile", return_value=False):
        disk = collect_disk()
    mount_points = [d.mount_point for d in disk.disks]
    assert len(mount_points) == 1
    assert "/mnt" in mount_points


def test_cpu_per_core_usage_length():
    cpu = collect_cpu()
    assert len(cpu.per_core_usage) == cpu.core_count


def test_memory_values_positive():
    mem = collect_memory()
    assert mem.total_mb > 0
    assert mem.usage_percent >= 0


def test_system_has_hostname():
    sys = collect_system()
    assert isinstance(sys.hostname, str)
    assert len(sys.hostname) > 0


def test_local_user_collector_filters_system_accounts_by_default():
    entries = [
        SimpleNamespace(
            pw_name="daemon",
            pw_uid=1,
            pw_gid=1,
            pw_gecos="daemon",
            pw_dir="/usr/sbin",
            pw_shell="/usr/sbin/nologin",
        ),
        SimpleNamespace(
            pw_name="nobody",
            pw_uid=65534,
            pw_gid=65534,
            pw_gecos="nobody",
            pw_dir="/nonexistent",
            pw_shell="/usr/sbin/nologin",
        ),
        SimpleNamespace(
            pw_name="alice",
            pw_uid=1000,
            pw_gid=1000,
            pw_gecos="Alice Example",
            pw_dir="/home/alice",
            pw_shell="/bin/bash",
        ),
    ]

    with patch("pmeow.collector.local_users._read_uid_min", return_value=1000):
        with patch("pmeow.collector.local_users.pwd.getpwall", return_value=entries):
            users = collect_local_users()

    assert [user.username for user in users] == ["alice"]
    assert users[0].home == "/home/alice"
