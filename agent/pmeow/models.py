"""Domain models for the PMEOW agent.

Includes task/queue models, GPU attribution models, and collector snapshot
dataclasses that mirror the TypeScript MetricsSnapshot shape.
"""

from __future__ import annotations

import enum
import re
from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SNAKE_RE = re.compile(r"_([a-z])")

# Suffixes where the TS interface uses uppercase abbreviations.
_SUFFIX_FIXES = [
    ("Kbs", "KBs"),
    ("Mb", "MB"),
    ("Gb", "GB"),
]


def _to_camel(name: str) -> str:
    """Convert snake_case to camelCase, preserving TS abbreviations (MB, GB, KBs)."""
    result = _SNAKE_RE.sub(lambda m: m.group(1).upper(), name)
    for wrong, right in _SUFFIX_FIXES:
        if result.endswith(wrong):
            result = result[: -len(wrong)] + right
            break
    return result


def _serialize(obj: object) -> object:
    """Recursively convert a dataclass tree to camelCase dicts."""
    if isinstance(obj, enum.Enum):
        return obj.value
    if isinstance(obj, dict):
        return {_to_camel(k): _serialize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_serialize(v) for v in obj]
    if hasattr(obj, "__dataclass_fields__"):
        return {
            _to_camel(k): _serialize(v)
            for k, v in obj.__dict__.items()
            if v is not None or k in obj.__dataclass_fields__
        }
    return obj


# ---------------------------------------------------------------------------
# Task & Queue models
# ---------------------------------------------------------------------------


class TaskStatus(enum.Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


@dataclass
class TaskSpec:
    command: str
    cwd: str
    user: str
    require_vram_mb: int
    require_gpu_count: int = 1
    gpu_ids: Optional[list[int]] = None
    priority: int = 10


@dataclass
class TaskRecord:
    id: str
    command: str
    cwd: str
    user: str
    require_vram_mb: int
    require_gpu_count: int
    gpu_ids: Optional[list[int]]
    priority: int
    status: TaskStatus
    created_at: float
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    exit_code: Optional[int] = None
    pid: Optional[int] = None


@dataclass
class TaskUpdate:
    task_id: str
    status: TaskStatus
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    exit_code: Optional[int] = None
    pid: Optional[int] = None


@dataclass
class QueueState:
    paused: bool
    queued: int
    running: int
    completed: int
    failed: int
    cancelled: int


# ---------------------------------------------------------------------------
# GPU attribution models
# ---------------------------------------------------------------------------


@dataclass
class GpuProcessInfo:
    pid: int
    gpu_index: int
    used_memory_mb: float
    process_name: str


@dataclass
class GpuTaskAllocation:
    task_id: str
    gpu_index: int
    declared_vram_mb: int
    actual_vram_mb: float


@dataclass
class GpuUserProcess:
    pid: int
    user: str
    gpu_index: int
    used_memory_mb: float
    command: str


@dataclass
class GpuUnknownProcess:
    pid: int
    gpu_index: int
    used_memory_mb: float


@dataclass
class PerGpuAllocationSummary:
    gpu_index: int
    total_memory_mb: float
    pmeow_tasks: list[GpuTaskAllocation] = field(default_factory=list)
    user_processes: list[GpuUserProcess] = field(default_factory=list)
    unknown_processes: list[GpuUnknownProcess] = field(default_factory=list)
    effective_free_mb: float = 0.0


@dataclass
class UserGpuUsageSummary:
    user: str
    total_vram_mb: float
    gpu_indices: list[int] = field(default_factory=list)


@dataclass
class GpuAllocationSummary:
    per_gpu: list[PerGpuAllocationSummary] = field(default_factory=list)
    by_user: list[UserGpuUsageSummary] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Collector snapshot models (mirrors TypeScript MetricsSnapshot)
# ---------------------------------------------------------------------------


@dataclass
class CpuSnapshot:
    usage_percent: float
    core_count: int
    model_name: str
    frequency_mhz: float
    per_core_usage: list[float] = field(default_factory=list)

    def to_dict(self) -> dict:
        return _serialize(self)


@dataclass
class MemorySnapshot:
    total_mb: float
    used_mb: float
    available_mb: float
    usage_percent: float
    swap_total_mb: float
    swap_used_mb: float
    swap_percent: float

    def to_dict(self) -> dict:
        return _serialize(self)


@dataclass
class DiskInfo:
    filesystem: str
    mount_point: str
    total_gb: float
    used_gb: float
    available_gb: float
    usage_percent: float

    def to_dict(self) -> dict:
        return _serialize(self)


@dataclass
class DiskSnapshot:
    disks: list[DiskInfo] = field(default_factory=list)
    io_read_kbs: float = 0.0
    io_write_kbs: float = 0.0

    def to_dict(self) -> dict:
        return _serialize(self)


@dataclass
class NetworkInterface:
    name: str
    rx_bytes: int
    tx_bytes: int

    def to_dict(self) -> dict:
        return _serialize(self)


@dataclass
class NetworkSnapshot:
    rx_bytes_per_sec: float
    tx_bytes_per_sec: float
    interfaces: list[NetworkInterface] = field(default_factory=list)

    def to_dict(self) -> dict:
        return _serialize(self)


@dataclass
class GpuSnapshot:
    available: bool
    total_memory_mb: float
    used_memory_mb: float
    memory_usage_percent: float
    utilization_percent: float
    temperature_c: float
    gpu_count: int

    def to_dict(self) -> dict:
        return _serialize(self)


@dataclass
class ProcessInfo:
    pid: int
    user: str
    cpu_percent: float
    mem_percent: float
    rss: int
    command: str

    def to_dict(self) -> dict:
        return _serialize(self)


@dataclass
class DockerContainer:
    id: str
    name: str
    image: str
    status: str
    state: str
    ports: str
    created_at: str

    def to_dict(self) -> dict:
        return _serialize(self)


@dataclass
class SystemSnapshot:
    hostname: str
    uptime: str
    load_avg1: float
    load_avg5: float
    load_avg15: float
    kernel_version: str

    def to_dict(self) -> dict:
        return _serialize(self)


@dataclass
class MetricsSnapshot:
    server_id: str
    timestamp: float
    cpu: CpuSnapshot
    memory: MemorySnapshot
    disk: DiskSnapshot
    network: NetworkSnapshot
    gpu: GpuSnapshot
    processes: list[ProcessInfo] = field(default_factory=list)
    docker: list[DockerContainer] = field(default_factory=list)
    system: SystemSnapshot = field(default=None)  # type: ignore[assignment]
    gpu_allocation: Optional[GpuAllocationSummary] = None

    def to_dict(self) -> dict:
        """Serialize to camelCase dict matching the TypeScript MetricsSnapshot."""
        d = _serialize(self)
        # gpu_allocation is agent-only; strip if None
        if self.gpu_allocation is None:
            d.pop("gpuAllocation", None)
        return d
