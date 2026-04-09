"""Internet reachability probe.

This collector is intentionally separate from `collector/network.py` because:

- Network byte-counter collection must run every cycle to produce rates.
- Probing an external host on every collection cycle is wasteful and would
  add 5s-interval x 3s-timeout worth of outbound TCP attempts when the link is
  down. The probe is therefore cached and only refreshed on its own interval.

The probe uses TCP ``connect(target_host, target_port)`` rather than ICMP ping
because ICMP is commonly blocked on hardened hosts and requires extra
privileges, while TCP 443 is almost always allowed outbound.
"""

from __future__ import annotations

import os
import socket
import time
from dataclasses import dataclass
from typing import Optional

_DEFAULT_TARGETS = "1.1.1.1:443,8.8.8.8:443"
_DEFAULT_TIMEOUT_SECONDS = 3.0
_DEFAULT_INTERVAL_SECONDS = 30.0


@dataclass
class InternetProbeResult:
    """Outcome of a single internet reachability probe run."""

    reachable: bool
    latency_ms: Optional[float]
    probe_target: str
    checked_at: float


def _parse_targets(raw: str) -> list[tuple[str, int]]:
    """Parse ``"host:port,host:port"`` into validated ``(host, port)`` tuples.

    Silently drops malformed entries so a typo in the env var does not crash
    the agent. Returns an empty list when ``raw`` is empty or all entries are
    invalid; callers must treat that as "probe disabled".
    """
    targets: list[tuple[str, int]] = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        host, _, port_str = entry.rpartition(":")
        if not host or not port_str:
            continue
        try:
            port = int(port_str)
        except ValueError:
            continue
        if not (0 < port < 65536):
            continue
        targets.append((host, port))
    return targets


def _probe_once(host: str, port: int, timeout_seconds: float) -> Optional[float]:
    """Attempt a TCP connect to ``host:port``.

    Returns the latency in milliseconds on success, or ``None`` if the connect
    failed or timed out. Uses ``monotonic`` so the latency is not affected by
    wall-clock adjustments between start and finish.
    """
    t0 = time.monotonic()
    try:
        with socket.create_connection((host, port), timeout=timeout_seconds):
            return round((time.monotonic() - t0) * 1000.0, 1)
    except OSError:
        return None


def probe_internet(
    targets: list[tuple[str, int]],
    timeout_seconds: float,
) -> InternetProbeResult:
    """Try each target in order until one succeeds.

    The first successful target wins and its latency is reported. If every
    target fails, the result is marked unreachable and ``latency_ms`` is
    ``None``. The ``probe_target`` field is always set to the *first* target
    attempted so UI consumers can display "probe target=1.1.1.1:443" even when
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

    first_target = f"{targets[0][0]}:{targets[0][1]}"
    for host, port in targets:
        latency = _probe_once(host, port, timeout_seconds)
        if latency is not None:
            return InternetProbeResult(
                reachable=True,
                latency_ms=latency,
                probe_target=f"{host}:{port}",
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
        self._last_result: Optional[InternetProbeResult] = None
        self._last_run_monotonic: Optional[float] = None

    @property
    def enabled(self) -> bool:
        """True when this probe has at least one valid target configured."""
        return bool(self._targets)

    def get(self, now_monotonic: Optional[float] = None) -> Optional[InternetProbeResult]:
        """Return the current cached probe result, refreshing if stale.

        Returns ``None`` when the probe is disabled (no targets configured);
        callers should treat this as "no data to report".
        """
        if not self._targets:
            return None
        now = now_monotonic if now_monotonic is not None else time.monotonic()
        if (
            self._last_result is None
            or self._last_run_monotonic is None
            or (now - self._last_run_monotonic) >= self._interval_seconds
        ):
            self._last_result = probe_internet(self._targets, self._timeout_seconds)
            self._last_run_monotonic = now
        return self._last_result


def load_probe_from_env(env: Optional[dict[str, str]] = None) -> InternetProbe:
    """Build an ``InternetProbe`` from ``PMEOW_INTERNET_PROBE_*`` env vars.

    Supported variables:

    - ``PMEOW_INTERNET_PROBE_TARGETS``: comma-separated ``host:port`` list.
      Default ``"1.1.1.1:443,8.8.8.8:443"``. Set to an empty string to
      disable the probe entirely.
    - ``PMEOW_INTERNET_PROBE_TIMEOUT``: per-target TCP connect timeout in
      seconds. Default ``3.0``.
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
