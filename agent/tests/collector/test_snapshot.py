from __future__ import annotations

from pmeow.collector.gpu import GpuCardTelemetry
from pmeow.collector.snapshot import _build_gpu_cards
from pmeow.models import (
    GpuTaskAllocation,
    PerGpuAllocationSummary,
    VramMode,
)


def test_build_gpu_cards_treats_zero_vram_task_as_full_gpu_reservation() -> None:
    cards = _build_gpu_cards(
        telemetry=[
            GpuCardTelemetry(
                index=1,
                name="RTX 3090",
                temperature_c=42.0,
                utilization_gpu=0.0,
                utilization_memory=0.0,
                memory_total_mb=24576.0,
                memory_used_mb=4300.0,
            )
        ],
        per_gpu=[
            PerGpuAllocationSummary(
                gpu_index=1,
                total_memory_mb=24576.0,
                used_memory_mb=4300.0,
                pmeow_tasks=[
                    GpuTaskAllocation(
                        task_id="task-exclusive",
                        gpu_index=1,
                        declared_vram_mb=0,
                        actual_vram_mb=4300.0,
                        vram_mode=VramMode.exclusive_auto,
                        exclusive_active=True,
                    )
                ],
                user_processes=[],
                unknown_processes=[],
                effective_free_mb=24576.0,
                utilization_percent=0.0,
            )
        ],
        redundancy_coefficient=0.1,
    )

    assert len(cards) == 1
    card = cards[0]
    assert card.managed_reserved_mb == 24576
    assert card.effective_free_mb == 0
    assert card.memory_used_mb == 4300
    assert len(card.task_allocations) == 1
    assert card.task_allocations[0].declared_vram_mb == 24576
