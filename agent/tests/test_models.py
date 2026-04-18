"""Tests for pmeow domain models and config validation."""

import os

import pytest

from pmeow.config import (
    load_config,
    validate_interval,
    validate_redundancy_coefficient,
)
from pmeow.models import (
    CpuSnapshot,
    DiskInfo,
    GpuCardReport,
    GpuCardTaskReport,
    GpuCardUnknownProcessReport,
    GpuCardUserProcessReport,
    MemorySnapshot,
    NetworkInterface,
    NetworkSnapshot,
    ProcessInfo,
    ResourceSnapshot,
    SystemSnapshot,
    TaskSpec,
    TaskQueueSnapshot,
    TaskStatus,
    UnifiedReport,
)


class TestTaskSpec:
    def test_default_priority(self):
        spec = TaskSpec(command="train.py", cwd="/work", user="alice", require_vram_mb=8000)
        assert spec.priority == 10

    def test_explicit_gpu_ids_preserved(self):
        spec = TaskSpec(
            command="train.py",
            cwd="/work",
            user="alice",
            require_vram_mb=8000,
            gpu_ids=[0, 2],
        )
        assert spec.gpu_ids == [0, 2]


def _make_report():
    return UnifiedReport(
        agent_id="agent-1",
        timestamp=1000.0,
        seq=1,
        resource_snapshot=ResourceSnapshot(
            gpu_cards=[
                GpuCardReport(
                    index=0,
                    name="NVIDIA RTX 4090",
                    temperature=65,
                    utilization_gpu=75,
                    utilization_memory=49,
                    memory_total_mb=24576,
                    memory_used_mb=12000,
                    managed_reserved_mb=8000,
                    unmanaged_peak_mb=2200,
                    effective_free_mb=14376,
                    task_allocations=[
                        GpuCardTaskReport(task_id="task-1", declared_vram_mb=8000),
                    ],
                    user_processes=[
                        GpuCardUserProcessReport(pid=4321, user="bob", vram_mb=2000.0),
                    ],
                    unknown_processes=[
                        GpuCardUnknownProcessReport(pid=7777, vram_mb=200.0),
                    ],
                )
            ],
            cpu=CpuSnapshot(
                usage_percent=55.0,
                core_count=8,
                model_name="AMD EPYC",
                frequency_mhz=3500.0,
                per_core_usage=[50.0, 60.0],
            ),
            memory=MemorySnapshot(
                total_mb=32768.0,
                used_mb=16384.0,
                available_mb=16384.0,
                usage_percent=50.0,
                swap_total_mb=8192.0,
                swap_used_mb=0.0,
                swap_percent=0.0,
            ),
            disks=[
                DiskInfo(
                    filesystem="/dev/sda1",
                    mount_point="/",
                    total_gb=500.0,
                    used_gb=250.0,
                    available_gb=250.0,
                    usage_percent=50.0,
                )
            ],
            network=NetworkSnapshot(
                rx_bytes_per_sec=1000.0,
                tx_bytes_per_sec=500.0,
                interfaces=[NetworkInterface(name="eth0", rx_bytes=100000, tx_bytes=50000)],
            ),
            processes=[
                ProcessInfo(pid=1234, ppid=1, user="alice", cpu_percent=30.0, mem_percent=10.0, rss=512000, command="python train.py")
            ],
            local_users=["alice", "bob"],
            system=SystemSnapshot(
                hostname="gpu-node-1",
                uptime="5 days",
                load_avg1=1.5,
                load_avg5=1.2,
                load_avg15=1.0,
                kernel_version="5.15.0",
            ),
        ),
        task_queue=TaskQueueSnapshot(),
    )


class TestUnifiedReportSerialization:
    def test_to_dict_camel_case_keys(self):
        report = _make_report()
        d = report.to_dict()

        assert "agentId" in d
        assert "resourceSnapshot" in d
        assert "taskQueue" in d

        snapshot = d["resourceSnapshot"]
        assert "gpuCards" in snapshot

    def test_to_dict_gpu_card_keys(self):
        gpu = _make_report().to_dict()["resourceSnapshot"]["gpuCards"][0]
        assert set(gpu.keys()) == {
            "index", "name", "temperature", "utilizationGpu",
            "utilizationMemory", "memoryTotalMb", "memoryUsedMb",
            "managedReservedMb", "unmanagedPeakMb", "effectiveFreeMb",
            "taskAllocations", "userProcesses", "unknownProcesses",
        }
        assert gpu["taskAllocations"][0] == {"taskId": "task-1", "declaredVramMb": 8000, "pid": None, "user": None, "command": None, "actualVramMb": None}

    def test_to_dict_network_includes_internet_fields_when_set(self):
        report = _make_report()
        report.resource_snapshot.network.internet_reachable = True
        report.resource_snapshot.network.internet_latency_ms = 25.0
        report.resource_snapshot.network.internet_probe_target = "1.1.1.1:443"
        report.resource_snapshot.network.internet_probe_checked_at = 1712000000.0
        net = report.to_dict()["resourceSnapshot"]["network"]
        assert net["internetReachable"] is True
        assert net["internetLatencyMs"] == 25.0


class TestConfigValidation:
    def test_invalid_interval_zero(self):
        with pytest.raises(ValueError, match="positive integer"):
            validate_interval(0, "collection_interval")

    def test_valid_redundancy(self):
        assert validate_redundancy_coefficient(0.1) == pytest.approx(0.1)
        assert validate_redundancy_coefficient(0.0) == pytest.approx(0.0)

    def test_load_config_paths_absolute(self):
        cfg = load_config()
        assert os.path.isabs(cfg.state_dir)
        assert os.path.isabs(cfg.socket_path)
        assert os.path.isabs(cfg.log_dir)
