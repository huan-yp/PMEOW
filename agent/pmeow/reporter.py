"""Report assembler — builds UnifiedReport from collected data.

Maintains a monotonically increasing sequence counter for report ordering.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from pmeow.collector.local_users import collect_local_users
from pmeow.models import (
    ResourceSnapshot,
    UnifiedReport,
)

if TYPE_CHECKING:
    from pmeow.models import MetricsSnapshot, TaskQueueSnapshot


class Reporter:
    """Assembles UnifiedReport from a MetricsSnapshot and TaskQueueSnapshot."""

    def __init__(self, agent_id: str) -> None:
        self._agent_id = agent_id
        self._seq = 0

    def build(
        self,
        metrics: MetricsSnapshot,
        task_snapshot: TaskQueueSnapshot,
    ) -> UnifiedReport:
        """Build a UnifiedReport from collected metrics and task state.

        During transition, accepts a MetricsSnapshot and converts to
        ResourceSnapshot internally.
        """
        self._seq += 1

        local_users = collect_local_users()
        local_user_names = [u.username for u in local_users]

        resource = ResourceSnapshot(
            cpu=metrics.cpu,
            memory=metrics.memory,
            disks=list(metrics.disk.disks) if metrics.disk else [],
            network=metrics.network,
            processes=metrics.processes,
            local_users=local_user_names,
            system=metrics.system,
            gpu=metrics.gpu,
            gpu_allocation=metrics.gpu_allocation,
        )

        return UnifiedReport(
            agent_id=self._agent_id,
            timestamp=time.time(),
            seq=self._seq,
            resource_snapshot=resource,
            task_queue=task_snapshot,
        )
