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
    DiskSnapshot,
    DockerContainer,
    GpuAllocationSummary,
    GpuSnapshot,
    MemorySnapshot,
    MetricsSnapshot,
    NetworkInterface,
    NetworkSnapshot,
    PerGpuAllocationSummary,
    ProcessInfo,
    SystemSnapshot,
    TaskSpec,
    TaskStatus,
)


# ---------------------------------------------------------------------------
# TaskSpec defaults
# ---------------------------------------------------------------------------


class TestTaskSpec:
    def test_default_priority(self):
        spec = TaskSpec(command="train.py", cwd="/work", user="alice", require_vram_mb=8000)
        assert spec.priority == 10

    def test_default_gpu_count(self):
        spec = TaskSpec(command="train.py", cwd="/work", user="alice", require_vram_mb=8000)
        assert spec.require_gpu_count == 1

    def test_explicit_gpu_ids_preserved(self):
        spec = TaskSpec(
            command="train.py",
            cwd="/work",
            user="alice",
            require_vram_mb=8000,
            gpu_ids=[0, 2],
        )
        assert spec.gpu_ids == [0, 2]

    def test_gpu_ids_default_none(self):
        spec = TaskSpec(command="train.py", cwd="/work", user="alice", require_vram_mb=8000)
        assert spec.gpu_ids is None


# ---------------------------------------------------------------------------
# MetricsSnapshot
# ---------------------------------------------------------------------------


def _make_snapshot(gpu_allocation=None):
    return MetricsSnapshot(
        server_id="srv-1",
        timestamp=1000.0,
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
        disk=DiskSnapshot(
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
            io_read_kbs=100.0,
            io_write_kbs=50.0,
        ),
        network=NetworkSnapshot(
            rx_bytes_per_sec=1000.0,
            tx_bytes_per_sec=500.0,
            interfaces=[NetworkInterface(name="eth0", rx_bytes=100000, tx_bytes=50000)],
        ),
        gpu=GpuSnapshot(
            available=True,
            total_memory_mb=24576.0,
            used_memory_mb=12000.0,
            memory_usage_percent=48.8,
            utilization_percent=75.0,
            temperature_c=65.0,
            gpu_count=2,
        ),
        processes=[
            ProcessInfo(pid=1234, ppid=1, user="alice", cpu_percent=30.0, mem_percent=10.0, rss=512000, command="python train.py")
        ],
        docker=[
            DockerContainer(id="abc123", name="web", image="nginx", status="Up 2h", state="running", ports="80/tcp", created_at="2026-01-01")
        ],
        system=SystemSnapshot(
            hostname="gpu-node-1",
            uptime="5 days",
            load_avg1=1.5,
            load_avg5=1.2,
            load_avg15=1.0,
            kernel_version="5.15.0",
        ),
        gpu_allocation=gpu_allocation,
    )


class TestMetricsSnapshot:
    def test_gpu_allocation_none(self):
        snap = _make_snapshot(gpu_allocation=None)
        assert snap.gpu_allocation is None

    def test_gpu_allocation_accepted(self):
        alloc = GpuAllocationSummary(
            per_gpu=[
                PerGpuAllocationSummary(
                    gpu_index=0,
                    total_memory_mb=24576.0,
                    used_memory_mb=4096.0,
                    effective_free_mb=12000.0,
                )
            ],
        )
        snap = _make_snapshot(gpu_allocation=alloc)
        assert snap.gpu_allocation is not None
        assert snap.gpu_allocation.per_gpu[0].gpu_index == 0

    def test_to_dict_camel_case_keys(self):
        snap = _make_snapshot()
        d = snap.to_dict()

        # Top-level keys must be camelCase matching TS
        assert "serverId" in d
        assert "timestamp" in d
        assert "cpu" in d
        assert "memory" in d
        assert "disk" in d
        assert "network" in d
        assert "gpu" in d
        assert "processes" in d
        assert "docker" in d
        assert "system" in d
        # gpuAllocation should be absent when None
        assert "gpuAllocation" not in d

    def test_to_dict_cpu_keys(self):
        d = _make_snapshot().to_dict()
        cpu = d["cpu"]
        assert set(cpu.keys()) == {"usagePercent", "coreCount", "modelName", "frequencyMhz", "perCoreUsage"}

    def test_to_dict_memory_keys(self):
        d = _make_snapshot().to_dict()
        mem = d["memory"]
        assert set(mem.keys()) == {
            "totalMB", "usedMB", "availableMB", "usagePercent",
            "swapTotalMB", "swapUsedMB", "swapPercent",
        }

    def test_to_dict_disk_keys(self):
        d = _make_snapshot().to_dict()
        disk = d["disk"]
        assert "disks" in disk
        assert "ioReadKBs" in disk  # ioReadKBs — note the 'KB' stays lowercase after 'Read'
        assert "ioWriteKBs" in disk
        di = disk["disks"][0]
        assert set(di.keys()) == {"filesystem", "mountPoint", "totalGB", "usedGB", "availableGB", "usagePercent"}

    def test_to_dict_network_keys(self):
        d = _make_snapshot().to_dict()
        net = d["network"]
        assert "rxBytesPerSec" in net
        assert "txBytesPerSec" in net
        iface = net["interfaces"][0]
        assert set(iface.keys()) == {"name", "rxBytes", "txBytes"}

    def test_to_dict_network_omits_internet_fields_when_not_set(self):
        """When the probe has not run, the optional internet fields must be
        absent from the serialized dict — not present-but-null — so the TS
        consumer treats them as ``undefined``."""
        d = _make_snapshot().to_dict()
        net = d["network"]
        assert "internetReachable" not in net
        assert "internetLatencyMs" not in net
        assert "internetProbeTarget" not in net
        assert "internetProbeCheckedAt" not in net

    def test_to_dict_network_includes_internet_fields_when_set(self):
        snap = _make_snapshot()
        snap.network.internet_reachable = True
        snap.network.internet_latency_ms = 25.0
        snap.network.internet_probe_target = "1.1.1.1:443"
        snap.network.internet_probe_checked_at = 1712000000.0
        d = snap.to_dict()
        net = d["network"]
        assert net["internetReachable"] is True
        assert net["internetLatencyMs"] == 25.0
        assert net["internetProbeTarget"] == "1.1.1.1:443"
        assert net["internetProbeCheckedAt"] == 1712000000.0

    def test_to_dict_network_internet_unreachable_keeps_null_latency(self):
        snap = _make_snapshot()
        snap.network.internet_reachable = False
        snap.network.internet_latency_ms = None
        snap.network.internet_probe_target = "1.1.1.1:443"
        snap.network.internet_probe_checked_at = 1712000000.0
        d = snap.to_dict()
        net = d["network"]
        assert net["internetReachable"] is False
        assert net["internetLatencyMs"] is None

    def test_to_dict_gpu_keys(self):
        d = _make_snapshot().to_dict()
        gpu = d["gpu"]
        assert set(gpu.keys()) == {
            "available", "totalMemoryMB", "usedMemoryMB",
            "memoryUsagePercent", "utilizationPercent", "temperatureC", "gpuCount",
        }

    def test_to_dict_process_keys(self):
        d = _make_snapshot().to_dict()
        proc = d["processes"][0]
        assert set(proc.keys()) == {"pid", "ppid", "user", "cpuPercent", "memPercent", "rss", "command"}

    def test_to_dict_docker_keys(self):
        d = _make_snapshot().to_dict()
        dc = d["docker"][0]
        assert set(dc.keys()) == {"id", "name", "image", "status", "state", "ports", "createdAt"}

    def test_to_dict_system_keys(self):
        d = _make_snapshot().to_dict()
        sys_ = d["system"]
        assert set(sys_.keys()) == {
            "hostname", "uptime", "loadAvg1", "loadAvg5", "loadAvg15", "kernelVersion",
        }

    def test_to_dict_with_gpu_allocation(self):
        alloc = GpuAllocationSummary(
            per_gpu=[PerGpuAllocationSummary(gpu_index=0, total_memory_mb=24576.0, used_memory_mb=2048.0)],
        )
        d = _make_snapshot(gpu_allocation=alloc).to_dict()
        assert "gpuAllocation" in d
        assert d["gpuAllocation"]["perGpu"][0]["gpuIndex"] == 0
        assert d["gpuAllocation"]["perGpu"][0]["usedMemoryMB"] == 2048.0


# ---------------------------------------------------------------------------
# Config validation
# ---------------------------------------------------------------------------


class TestConfigValidation:
    def test_invalid_interval_zero(self):
        with pytest.raises(ValueError, match="positive integer"):
            validate_interval(0, "collection_interval")

    def test_invalid_interval_negative(self):
        with pytest.raises(ValueError, match="positive integer"):
            validate_interval(-5, "heartbeat_interval")

    def test_valid_interval(self):
        assert validate_interval(10, "x") == 10

    def test_invalid_redundancy_negative(self):
        with pytest.raises(ValueError, match="vram_redundancy_coefficient"):
            validate_redundancy_coefficient(-0.1)

    def test_invalid_redundancy_one(self):
        with pytest.raises(ValueError, match="vram_redundancy_coefficient"):
            validate_redundancy_coefficient(1.0)

    def test_valid_redundancy(self):
        assert validate_redundancy_coefficient(0.1) == pytest.approx(0.1)
        assert validate_redundancy_coefficient(0.0) == pytest.approx(0.0)

    def test_load_config_invalid_interval_env(self, monkeypatch):
        monkeypatch.setenv("PMEOW_COLLECTION_INTERVAL", "0")
        with pytest.raises(ValueError):
            load_config()

    def test_load_config_invalid_redundancy_env(self, monkeypatch):
        monkeypatch.setenv("PMEOW_VRAM_REDUNDANCY", "1.0")
        with pytest.raises(ValueError):
            load_config()

    def test_load_config_paths_absolute(self):
        cfg = load_config()
        assert os.path.isabs(cfg.state_dir)
        assert os.path.isabs(cfg.socket_path)
        assert os.path.isabs(cfg.log_dir)
