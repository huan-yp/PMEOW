"""Internet reachability probe.

This collector is intentionally separate from `collector/network.py` because:

- Network byte-counter collection must run every cycle to produce rates.
- Probing an external host on every collection cycle is wasteful and would
    add 5s-interval x 3s-timeout worth of outbound checks when the link is
    down. The probe is therefore cached and only refreshed on its own interval.

The probe uses the system ``ping`` command and, by default, checks whether the
node can ping ``baidu.com``. This matches the product requirement that
"能 ping 通百度就是有外网".
"""

from __future__ import annotations

import logging
import math
import os
import subprocess
import threading
import time
from dataclasses import dataclass
from typing import Optional

_DEFAULT_TARGETS = "baidu.com"
_DEFAULT_TIMEOUT_SECONDS = 3.0
_DEFAULT_INTERVAL_SECONDS = 30.0

log = logging.getLogger(__name__)


@dataclass
class InternetProbeResult:
    """Outcome of a single internet reachability probe run."""

    reachable: bool
    latency_ms: Optional[float]
    probe_target: str
    checked_at: float


def _parse_targets(raw: str) -> list[tuple[str, int]]:
    """Parse comma-separated hosts into ``(host, 0)`` tuples.

    The probe now uses ICMP ping, so only the host matters. Legacy
    ``host:port`` entries are still accepted for compatibility and the port is
    ignored.
    """
    targets: list[tuple[str, int]] = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        host = entry
        if entry.count(":") == 1:
            maybe_host, _, maybe_port = entry.rpartition(":")
            if maybe_host and maybe_port.isdigit():
                host = maybe_host
        host = host.strip()
        if not host:
            continue
        targets.append((host, 0))
    return targets


def _probe_once(host: str, port: int, timeout_seconds: float) -> Optional[float]:
    """Ping ``host`` once and return latency in milliseconds on success."""
    del port

    timeout = max(1, int(math.ceil(timeout_seconds)))
    t0 = time.monotonic()
    try:
        result = subprocess.run(
            ["ping", "-c", "1", "-W", str(timeout), host],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if result.returncode == 0:
            return round((time.monotonic() - t0) * 1000.0, 1)
    except OSError:
        return None
    return None


def probe_internet(
    targets: list[tuple[str, int]],
    timeout_seconds: float,
) -> InternetProbeResult:
    """Try each target in order until one ping succeeds.

    The first successful target wins and its latency is reported. If every
    target fails, the result is marked unreachable and ``latency_ms`` is
    ``None``. The ``probe_target`` field is always set to the first host
    attempted so UI consumers can display the current probe target even when
    the probe failed.
    """
    now = time.time()
    if not targets:
        # Empty target list means "probe disabled" — signal unreachable with
        # a dummy probe_target so the UI does not show a blank string.
        return InternetProbeResult(
            reachable=False,
            latency_ms=None,
            probe_target="disabled",
            checked_at=now,
        )

    first_target = targets[0][0]
    for host, port in targets:
        latency = _probe_once(host, port, timeout_seconds)
        if latency is not None:
            return InternetProbeResult(
                reachable=True,
                latency_ms=latency,
                probe_target=host,
                checked_at=now,
            )
    return InternetProbeResult(
        reachable=False,
        latency_ms=None,
        probe_target=first_target,
        checked_at=now,
    )


class InternetProbe:
    """Cached internet reachability probe.

    Wrap ``probe_internet`` with an interval-based cache so repeated metrics
    cycles do not hammer the probe targets. The cache is monotonic-time based
    so wall-clock jumps never skip a refresh.
    """

    def __init__(
        self,
        targets: Optional[list[tuple[str, int]]] = None,
        timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS,
        interval_seconds: float = _DEFAULT_INTERVAL_SECONDS,
    ) -> None:
        self._targets = targets if targets is not None else _parse_targets(_DEFAULT_TARGETS)
        self._timeout_seconds = timeout_seconds
        self._interval_seconds = interval_seconds
        self._lock = threading.Lock()
        self._last_result: Optional[InternetProbeResult] = None
        self._last_run_monotonic: Optional[float] = None
        self._refreshing = False
        self._worker: threading.Thread | None = None
        self._stopped = False

    @property
    def enabled(self) -> bool:
        """True when this probe has at least one valid target configured."""
        return bool(self._targets)

    def get(self, now_monotonic: Optional[float] = None) -> Optional[InternetProbeResult]:
        """Return the current cached probe result without blocking.

        Returns ``None`` when the probe is disabled (no targets configured);
        callers should treat this as "no data to report".
        """
        if not self._targets:
            return None
        with self._lock:
            return self._last_result

    def refresh_async(self, now_monotonic: Optional[float] = None) -> bool:
        """Schedule a background probe refresh when the cache is stale."""
        if not self._targets:
            return False

        now = now_monotonic if now_monotonic is not None else time.monotonic()
        with self._lock:
            if self._stopped or self._refreshing:
                return False
            if (
                self._last_run_monotonic is not None
                and (now - self._last_run_monotonic) < self._interval_seconds
            ):
                return False

            self._refreshing = True
            worker = threading.Thread(
                target=self._run_refresh,
                args=(now,),
                name="pmeow-internet-probe",
                daemon=True,
            )
            self._worker = worker
            worker.start()
            return True

    def stop(self, timeout: float = 0.0) -> None:
        """Prevent new refreshes and optionally wait for the active worker."""
        with self._lock:
            self._stopped = True
            worker = self._worker
        if worker is not None and timeout > 0:
            worker.join(timeout=timeout)

    def _run_refresh(self, started_monotonic: float) -> None:
        result: Optional[InternetProbeResult] = None
        try:
            result = probe_internet(self._targets, self._timeout_seconds)
        except Exception:
            log.exception("internet probe refresh failed")
        finally:
            current = threading.current_thread()
            with self._lock:
                if result is not None:
                    self._last_result = result
                    self._last_run_monotonic = started_monotonic
                self._refreshing = False
                if self._worker is current:
                    self._worker = None


def load_probe_from_env(env: Optional[dict[str, str]] = None) -> InternetProbe:
        """Build an ``InternetProbe`` from ``PMEOW_INTERNET_PROBE_*`` env vars.

        Supported variables:

        - ``PMEOW_INTERNET_PROBE_TARGETS``: comma-separated host list. Default
            ``"baidu.com"``. Legacy ``host:port`` entries are accepted but the port
            is ignored. Set to an empty string to disable the probe entirely.
        - ``PMEOW_INTERNET_PROBE_TIMEOUT``: per-target ping timeout in seconds.
            Default ``3.0``.
        - ``PMEOW_INTERNET_PROBE_INTERVAL``: minimum seconds between probe runs.
            Default ``30.0``. Shorter intervals waste bandwidth; longer intervals
            delay detection of WAN outages.
        """
    env_map = env if env is not None else os.environ
    raw_targets = env_map.get("PMEOW_INTERNET_PROBE_TARGETS", _DEFAULT_TARGETS)
    targets = _parse_targets(raw_targets)
    try:
        timeout_seconds = float(env_map.get("PMEOW_INTERNET_PROBE_TIMEOUT", _DEFAULT_TIMEOUT_SECONDS))
    except ValueError:
        timeout_seconds = _DEFAULT_TIMEOUT_SECONDS
    try:
        interval_seconds = float(env_map.get("PMEOW_INTERNET_PROBE_INTERVAL", _DEFAULT_INTERVAL_SECONDS))
    except ValueError:
        interval_seconds = _DEFAULT_INTERVAL_SECONDS
    if timeout_seconds <= 0:
        timeout_seconds = _DEFAULT_TIMEOUT_SECONDS
    if interval_seconds <= 0:
        interval_seconds = _DEFAULT_INTERVAL_SECONDS
    return InternetProbe(
        targets=targets,
        timeout_seconds=timeout_seconds,
        interval_seconds=interval_seconds,
    )
