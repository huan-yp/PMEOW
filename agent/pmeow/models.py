"""Domain models for the PMEOW agent.

Includes task/queue models, GPU attribution models, and unified report
dataclasses shared across collection, scheduling, and transport.
"""

from __future__ import annotations

import enum
import re
from collections import deque
from dataclasses import dataclass, field, is_dataclass
from typing import Optional, cast


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
    if isinstance(obj, deque):
        return [_serialize(v) for v in obj]
    if is_dataclass(obj):
        dataclass_fields = cast(dict[str, object], getattr(obj, "__dataclass_fields__", {}))
        return {
            cast(str, getattr(dataclass_fields[k], "metadata", {}).get("alias") or _to_camel(k)): _serialize(v)
            for k, v in obj.__dict__.items()
            if v is not None or k in dataclass_fields
        }
    return obj


# ---------------------------------------------------------------------------
# Task & Queue models
# ---------------------------------------------------------------------------


class TaskStatus(enum.Enum):
    """Agent internal task states."""
    queued = "queued"
    reserved = "reserved"
    running = "running"


class PublicTaskStatus(enum.Enum):
    """Protocol-visible task states (reported to Web)."""
    queued = "queued"
    running = "running"


class ArchivedTaskStatus(enum.Enum):
    """Web archive-only terminal state."""
    ended = "ended"


class TaskLaunchMode(enum.Enum):
    daemon_shell = "daemon_shell"
    attached_python = "attached_python"


@dataclass
class TaskSpec:
    command: str
    cwd: str
    user: str
    require_vram_mb: int
    require_gpu_count: int = 1
    gpu_ids: Optional[list[int]] = None
    priority: int = 10
    argv: Optional[list[str]] = None
    env_overrides: Optional[dict[str, str]] = None
    launch_mode: TaskLaunchMode = TaskLaunchMode.daemon_shell


@dataclass
class ScheduleEvaluation:
    """Single scheduling evaluation snapshot for a queued task."""
    timestamp: float
    result: str  # "scheduled" | "blocked_by_priority" | "insufficient_gpu" | "sustained_window_not_met"
    gpu_snapshot: dict = field(default_factory=dict)
    detail: str = ""


@dataclass
class TaskRecord:
    id: str
    status: TaskStatus
    command: str
    cwd: str
    user: str
    launch_mode: TaskLaunchMode

    # Resource requirements
    require_vram_mb: int
    require_gpu_count: int
    gpu_ids: Optional[list[int]] = None  # user-requested GPU affinity
    priority: int = 10

    # Timeline
    created_at: float = 0.0
    reserved_at: Optional[float] = None
    started_at: Optional[float] = None

    # Runtime
    pid: Optional[int] = None
    pid_create_time: Optional[float] = None
    assigned_gpus: Optional[list[int]] = None  # GPUs assigned by scheduler
    declared_vram_per_gpu: Optional[int] = None  # VRAM declared per GPU (MB)

    # Schedule evaluation history
    schedule_history: deque[ScheduleEvaluation] = field(
        default_factory=lambda: deque(maxlen=5)
    )

    # attached_python specific
    attach_deadline: Optional[float] = None
    argv: Optional[list[str]] = None
    env_overrides: Optional[dict[str, str]] = None

    @property
    def public_status(self) -> PublicTaskStatus:
        """Map internal status to protocol-visible status."""
        if self.status == TaskStatus.reserved:
            return PublicTaskStatus.queued
        return PublicTaskStatus(self.status.value)


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
    used_memory_mb: float = 0.0
    pmeow_tasks: list[GpuTaskAllocation] = field(default_factory=list)
    user_processes: list[GpuUserProcess] = field(default_factory=list)
    unknown_processes: list[GpuUnknownProcess] = field(default_factory=list)
    effective_free_mb: float = 0.0
    utilization_percent: float = 0.0


@dataclass
class UserGpuUsageSummary:
    user: str
    total_vram_mb: float
    gpu_indices: list[int] = field(default_factory=list)


@dataclass
class GpuAllocationSummary:
    per_gpu: list[PerGpuAllocationSummary] = field(default_factory=list)
    by_user: list[UserGpuUsageSummary] = field(default_factory=list)


@dataclass
class GpuCardTaskReport:
    task_id: str
    declared_vram_mb: int = field(metadata={"alias": "declaredVramMb"})


@dataclass
class GpuCardUserProcessReport:
    pid: int
    user: str
    vram_mb: float = field(metadata={"alias": "vramMb"})


@dataclass
class GpuCardUnknownProcessReport:
    pid: int
    vram_mb: float = field(metadata={"alias": "vramMb"})


# ---------------------------------------------------------------------------
# GPU card report (per-card info with dual-ledger for Web)
# ---------------------------------------------------------------------------


@dataclass
class GpuCardReport:
    index: int
    name: str
    temperature: int
    utilization_gpu: int       # compute utilization %
    utilization_memory: int    # memory utilization %
    memory_total_mb: int = field(metadata={"alias": "memoryTotalMb"})
    memory_used_mb: int = field(metadata={"alias": "memoryUsedMb"})  # actual physical usage

    # Dual-ledger fields
    managed_reserved_mb: int = field(metadata={"alias": "managedReservedMb"})  # PMEOW task declared reservation total
    unmanaged_peak_mb: int = field(metadata={"alias": "unmanagedPeakMb"})      # non-PMEOW process window peak × 1.05
    effective_free_mb: int = field(metadata={"alias": "effectiveFreeMb"})      # schedulable - managed - unmanaged

    # Attribution info
    task_allocations: list[GpuCardTaskReport] = field(default_factory=list)
    user_processes: list[GpuCardUserProcessReport] = field(default_factory=list)
    unknown_processes: list[GpuCardUnknownProcessReport] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Collector snapshot models
# ---------------------------------------------------------------------------


@dataclass
class CpuSnapshot:
    usage_percent: float
    core_count: int
    model_name: str
    frequency_mhz: float
    per_core_usage: list[float] = field(default_factory=list)


@dataclass
class MemorySnapshot:
    total_mb: float
    used_mb: float
    available_mb: float
    usage_percent: float
    swap_total_mb: float
    swap_used_mb: float
    swap_percent: float


@dataclass
class DiskInfo:
    filesystem: str
    mount_point: str
    total_gb: float
    used_gb: float
    available_gb: float
    usage_percent: float


@dataclass
class DiskSnapshot:
    disks: list[DiskInfo] = field(default_factory=list)
    io_read_kbs: float = 0.0
    io_write_kbs: float = 0.0


@dataclass
class NetworkInterface:
    name: str
    rx_bytes: int
    tx_bytes: int


@dataclass
class NetworkSnapshot:
    rx_bytes_per_sec: float
    tx_bytes_per_sec: float
    interfaces: list[NetworkInterface] = field(default_factory=list)
    internet_reachable: Optional[bool] = None
    internet_latency_ms: Optional[float] = None
    internet_probe_target: Optional[str] = None
    internet_probe_checked_at: Optional[float] = None


@dataclass
class GpuSnapshot:
    available: bool
    total_memory_mb: float
    used_memory_mb: float
    memory_usage_percent: float
    utilization_percent: float
    temperature_c: float
    gpu_count: int


@dataclass
class ProcessInfo:
    pid: int
    ppid: int | None
    user: str
    cpu_percent: float
    mem_percent: float
    rss: int
    command: str
    gpu_memory_mb: float = 0.0  # GPU memory usage for filtering


@dataclass
class SystemSnapshot:
    hostname: str
    uptime: str
    load_avg1: float
    load_avg5: float
    load_avg15: float
    kernel_version: str


@dataclass
class LocalUserRecord:
    username: str
    uid: int
    gid: int
    gecos: str
    home: str
    shell: str


# ---------------------------------------------------------------------------
# Unified report models
# ---------------------------------------------------------------------------


@dataclass
class TaskInfo:
    """Serializable task info for protocol/report snapshots."""
    task_id: str
    status: str  # "queued" | "running"
    command: str
    cwd: str
    user: str
    launch_mode: str
    require_vram_mb: int
    require_gpu_count: int
    gpu_ids: Optional[list[int]]
    priority: int
    created_at: float
    started_at: Optional[float] = None
    pid: Optional[int] = None
    assigned_gpus: Optional[list[int]] = None
    declared_vram_per_gpu: Optional[int] = None
    schedule_history: list[dict] = field(default_factory=list)


@dataclass
class TaskQueueSnapshot:
    """Serializable view of active tasks for protocol."""
    queued: list[TaskInfo] = field(default_factory=list)
    running: list[TaskInfo] = field(default_factory=list)


@dataclass
class ResourceSnapshot:
    """Complete resource snapshot published to Web."""
    gpu_cards: list[GpuCardReport] = field(default_factory=list)
    cpu: Optional[CpuSnapshot] = None
    memory: Optional[MemorySnapshot] = None
    disks: list[DiskInfo] = field(default_factory=list)
    network: Optional[NetworkSnapshot] = None
    processes: list[ProcessInfo] = field(default_factory=list)
    local_users: list[str] = field(default_factory=list)
    system: Optional[SystemSnapshot] = None


@dataclass
class CollectedSnapshot:
    """Collector output used internally by the daemon loop."""
    timestamp: float
    resource_snapshot: ResourceSnapshot
    per_gpu: list[PerGpuAllocationSummary] = field(default_factory=list)


@dataclass
class UnifiedReport:
    """Top-level unified report pushed to Web every tick."""
    agent_id: str
    timestamp: float
    seq: int

    resource_snapshot: ResourceSnapshot
    task_queue: TaskQueueSnapshot

    def to_dict(self) -> dict:
        """Serialize to camelCase dict for Socket.IO transport."""
        d = cast(dict, _serialize(self))
        # Strip None-valued optional fields from network sub-dict
        rs = cast(dict, d.get("resourceSnapshot", {}))
        net = rs.get("network")
        if isinstance(net, dict):
            if net.get("internetReachable") is None and net.get("internetProbeCheckedAt") is None:
                for key in ("internetReachable", "internetLatencyMs",
                            "internetProbeTarget", "internetProbeCheckedAt"):
                    net.pop(key, None)
        return d
