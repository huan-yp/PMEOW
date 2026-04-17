"""GPU metrics collection via nvidia-smi."""

from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass
from typing import Optional

from pmeow.models import GpuProcessInfo, GpuSnapshot

logger = logging.getLogger(__name__)


@dataclass
class GpuCardTelemetry:
    index: int
    name: str
    temperature_c: float
    utilization_gpu: float
    utilization_memory: float
    memory_total_mb: float
    memory_used_mb: float


def _run_smi(args: list[str]) -> Optional[str]:
    """Run nvidia-smi with *args* and return stdout, or None on failure."""
    try:
        result = subprocess.run(
            ["nvidia-smi", *args],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return None
        return result.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None


_GPU_UNAVAILABLE = GpuSnapshot(
    available=False,
    total_memory_mb=0.0,
    used_memory_mb=0.0,
    memory_usage_percent=0.0,
    utilization_percent=0.0,
    temperature_c=0.0,
    gpu_count=0,
)


def _parse_smi_float(value: str) -> float:
    try:
        return float(value)
    except ValueError:
        return 0.0


def collect_gpu_card_telemetry() -> list[GpuCardTelemetry]:
    """Collect per-card GPU telemetry. Never raises."""
    output = _run_smi([
        "--query-gpu=index,name,temperature.gpu,utilization.gpu,utilization.memory,memory.total,memory.used",
        "--format=csv,noheader,nounits",
    ])
    if not output:
        return []

    cards: list[GpuCardTelemetry] = []
    for line in output.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 7:
            continue
        try:
            index = int(parts[0])
        except ValueError:
            continue
        cards.append(GpuCardTelemetry(
            index=index,
            name=parts[1],
            temperature_c=_parse_smi_float(parts[2]),
            utilization_gpu=_parse_smi_float(parts[3]),
            utilization_memory=_parse_smi_float(parts[4]),
            memory_total_mb=_parse_smi_float(parts[5]),
            memory_used_mb=_parse_smi_float(parts[6]),
        ))
    return cards


def collect_gpu() -> GpuSnapshot:
    """Collect aggregated GPU snapshot. Never raises."""
    cards = collect_gpu_card_telemetry()
    if not cards:
        output = _run_smi([
            "--query-gpu=memory.total,memory.used,utilization.gpu,temperature.gpu",
            "--format=csv,noheader,nounits",
        ])
        if not output:
            return _GPU_UNAVAILABLE

        total_mem = 0.0
        used_mem = 0.0
        util_sum = 0.0
        max_temp = 0.0
        count = 0

        for line in output.splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 4:
                continue
            try:
                t = float(parts[0])
                u = float(parts[1])
                util = float(parts[2])
                temp = float(parts[3])
            except ValueError:
                continue
            total_mem += t
            used_mem += u
            util_sum += util
            if temp > max_temp:
                max_temp = temp
            count += 1

        if count == 0:
            return _GPU_UNAVAILABLE

        usage_pct = (used_mem / total_mem * 100.0) if total_mem > 0 else 0.0

        return GpuSnapshot(
            available=True,
            total_memory_mb=total_mem,
            used_memory_mb=used_mem,
            memory_usage_percent=round(usage_pct, 1),
            utilization_percent=round(util_sum / count, 1),
            temperature_c=max_temp,
            gpu_count=count,
        )

    total_mem = sum(card.memory_total_mb for card in cards)
    used_mem = sum(card.memory_used_mb for card in cards)
    util_sum = sum(card.utilization_gpu for card in cards)
    max_temp = max(card.temperature_c for card in cards)
    count = len(cards)

    usage_pct = (used_mem / total_mem * 100.0) if total_mem > 0 else 0.0

    return GpuSnapshot(
        available=True,
        total_memory_mb=total_mem,
        used_memory_mb=used_mem,
        memory_usage_percent=round(usage_pct, 1),
        utilization_percent=round(util_sum / count, 1),
        temperature_c=max_temp,
        gpu_count=count,
    )


def _build_uuid_to_index() -> dict[str, int]:
    """Map GPU UUID → integer index via nvidia-smi."""
    output = _run_smi([
        "--query-gpu=uuid,index",
        "--format=csv,noheader",
    ])
    if not output:
        return {}
    mapping: dict[str, int] = {}
    for line in output.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 2:
            try:
                mapping[parts[0]] = int(parts[1])
            except ValueError:
                continue
    return mapping


def collect_gpu_processes() -> list[GpuProcessInfo]:
    """Collect per-process GPU memory usage. Never raises."""
    uuid_map = _build_uuid_to_index()

    output = _run_smi([
        "--query-compute-apps=pid,gpu_uuid,used_memory",
        "--format=csv,noheader,nounits",
    ])
    if not output:
        return []

    processes: list[GpuProcessInfo] = []
    for line in output.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 3:
            continue
        try:
            pid = int(parts[0])
        except ValueError:
            continue
        gpu_uuid = parts[1]
        try:
            used_mb = float(parts[2])
        except ValueError:
            # WSL2 and some virtualized GPU environments report [N/A] for
            # per-process memory.  Fall back to 0 so the process still
            # appears in attribution; log a warning so operators on real
            # servers notice the anomaly.
            logger.warning(
                "nvidia-smi reported [N/A] memory for PID %d; "
                "falling back to 0 MB (common in WSL2 / vGPU environments)",
                pid,
            )
            used_mb = 0.0
        gpu_index = uuid_map.get(gpu_uuid, 0)
        processes.append(GpuProcessInfo(
            pid=pid,
            gpu_index=gpu_index,
            used_memory_mb=used_mb,
            process_name="",
        ))
    return processes


def _collect_per_gpu_memory_field(field: str) -> dict[int, float]:
    output = _run_smi([
        f"--query-gpu=index,{field}",
        "--format=csv,noheader,nounits",
    ])
    if not output:
        return {}

    result: dict[int, float] = {}
    for line in output.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 2:
            try:
                result[int(parts[0])] = float(parts[1])
            except ValueError:
                continue
    return result


def collect_per_gpu_total_memory() -> dict[int, float]:
    """Return a mapping of gpu_index → total memory in MB."""
    return _collect_per_gpu_memory_field("memory.total")


def collect_per_gpu_used_memory() -> dict[int, float]:
    """Return a mapping of gpu_index → actual used memory in MB."""
    return _collect_per_gpu_memory_field("memory.used")


def collect_per_gpu_utilization() -> dict[int, float]:
    """Return a mapping of gpu_index → GPU utilization percent."""
    output = _run_smi([
        "--query-gpu=index,utilization.gpu",
        "--format=csv,noheader,nounits",
    ])
    if not output:
        return {}

    result: dict[int, float] = {}
    for line in output.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 2:
            try:
                result[int(parts[0])] = float(parts[1])
            except ValueError:
                continue
    return result
