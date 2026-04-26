"""Tests for the internet reachability probe collector."""

from __future__ import annotations

import threading
from unittest.mock import Mock, patch

import pmeow.collector.internet as internet_mod
from pmeow.collector.internet import (
    InternetProbe,
    InternetProbeResult,
    _parse_targets,
    load_probe_from_env,
    probe_internet,
)


def test_parse_targets_basic() -> None:
    targets = _parse_targets("1.1.1.1:443,8.8.8.8:53")
    assert targets == [("1.1.1.1", 0), ("8.8.8.8", 0)]


def test_probe_internet_returns_reachable_on_success() -> None:
    with patch(
        "pmeow.collector.internet.subprocess.run",
        return_value=Mock(returncode=0),
    ) as mock_ping, patch(
        "pmeow.collector.internet.time.monotonic",
        side_effect=[1.0, 1.025],
    ), patch(
        "pmeow.collector.internet.time.time",
        return_value=1712000000.0,
    ):
        result = probe_internet([("1.1.1.1", 0)], timeout_seconds=3.0)

    assert result.reachable is True
    assert result.latency_ms == 25.0
    assert result.probe_target == "1.1.1.1"
    assert result.checked_at == 1712000000.0
    mock_ping.assert_called_once()


def test_internet_probe_caches_result_within_interval() -> None:
    probe = InternetProbe(
        targets=[("1.1.1.1", 443)],
        timeout_seconds=3.0,
        interval_seconds=30.0,
    )

    fake_result = InternetProbeResult(
        reachable=True,
        latency_ms=5.0,
        probe_target="1.1.1.1:443",
        checked_at=1712000000.0,
    )

    with patch.object(
        internet_mod, "probe_internet", return_value=fake_result,
    ) as mock_probe:
        started = probe.refresh_async(now_monotonic=100.0)
        probe.stop(timeout=1.0)

        first = probe.get(now_monotonic=100.0)
        second = probe.get(now_monotonic=110.0)

    assert started is True
    assert first is second
    assert mock_probe.call_count == 1


def test_load_probe_from_env_defaults() -> None:
    probe = load_probe_from_env(env={})
    assert probe.enabled is True
