"""Report assembler — builds UnifiedReport from collected data.

Maintains a monotonically increasing sequence counter for report ordering.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from pmeow.models import (
    ResourceSnapshot,
    UnifiedReport,
)

if TYPE_CHECKING:
    from pmeow.models import TaskQueueSnapshot


class Reporter:
    """Assembles UnifiedReport from a ResourceSnapshot and TaskQueueSnapshot."""

    def __init__(self, agent_id: str) -> None:
        self._agent_id = agent_id
        self._seq = 0

    def build(
        self,
        resource_snapshot: ResourceSnapshot,
        task_snapshot: TaskQueueSnapshot,
    ) -> UnifiedReport:
        """Build a UnifiedReport from collected resources and task state."""
        self._seq += 1

        return UnifiedReport(
            agent_id=self._agent_id,
            timestamp=time.time(),
            seq=self._seq,
            resource_snapshot=resource_snapshot,
            task_queue=task_snapshot,
        )
