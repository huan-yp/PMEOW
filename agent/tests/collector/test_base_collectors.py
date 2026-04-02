"""Tests for the base host metrics collectors."""

from __future__ import annotations

from unittest.mock import patch

from pmeow.collector.cpu import collect_cpu
from pmeow.collector.disk import collect_disk
from pmeow.collector.docker import collect_docker
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
