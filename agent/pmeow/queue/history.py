"""GPU history window tracking for sustained availability checks."""

from __future__ import annotations

import time
from pmeow.models import PerGpuAllocationSummary


class GpuHistoryTracker:
    """Stores recent GPU allocation snapshots within a sliding time window."""

    def __init__(self, window_seconds: float = 5.0) -> None:
        self.window_seconds = window_seconds
        self._samples: list[tuple[float, list[PerGpuAllocationSummary]]] = []

    def record(
        self, timestamp: float, per_gpu: list[PerGpuAllocationSummary]
    ) -> None:
        """Add a sample and prune old entries."""
        self._samples.append((timestamp, per_gpu))
        self.prune(timestamp)

    def get_history(
        self, window_seconds: float | None = None
    ) -> list[tuple[float, list[PerGpuAllocationSummary]]]:
        """Return samples within *window_seconds* (default: full window)."""
        window = window_seconds if window_seconds is not None else self.window_seconds
        cutoff = time.time() - window
        return [(ts, s) for ts, s in self._samples if ts >= cutoff]

    def prune(self, now: float | None = None) -> None:
        """Remove samples older than the window."""
        if now is None:
            now = time.time()
        cutoff = now - self.window_seconds
        self._samples = [(ts, s) for ts, s in self._samples if ts >= cutoff]
