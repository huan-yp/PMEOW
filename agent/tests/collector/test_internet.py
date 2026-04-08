"""Tests for the internet reachability probe collector."""

from __future__ import annotations

from unittest.mock import patch

import pmeow.collector.internet as internet_mod
from pmeow.collector.internet import (
    InternetProbe,
    InternetProbeResult,
    _parse_targets,
    load_probe_from_env,
    probe_internet,
)


# ---------- _parse_targets ----------

def test_parse_targets_basic() -> None:
    targets = _parse_targets("1.1.1.1:443,8.8.8.8:53")
    assert targets == [("1.1.1.1", 443), ("8.8.8.8", 53)]


def test_parse_targets_empty_string() -> None:
    assert _parse_targets("") == []


def test_parse_targets_ignores_malformed_entries() -> None:
    targets = _parse_targets("1.1.1.1:443,badentry,:80,999.999.999.999:99999")
    # Only the first entry is valid (port 99999 > 65535 is rejected)
    assert targets == [("1.1.1.1", 443)]


def test_parse_targets_strips_whitespace() -> None:
    targets = _parse_targets(" 1.1.1.1:443 , 8.8.8.8:53 ")
    assert targets == [("1.1.1.1", 443), ("8.8.8.8", 53)]


# ---------- probe_internet ----------

def test_probe_internet_returns_reachable_on_success() -> None:
    with patch(
        "pmeow.collector.internet.socket.create_connection"
    ) as mock_conn, patch(
        "pmeow.collector.internet.time.monotonic",
        side_effect=[1.0, 1.025],
    ), patch(
        "pmeow.collector.internet.time.time",
        return_value=1712000000.0,
    ):
        mock_conn.return_value.__enter__ = lambda self: self
        mock_conn.return_value.__exit__ = lambda *args: False

        result = probe_internet([("1.1.1.1", 443)], timeout_seconds=3.0)

    assert result.reachable is True
    assert result.latency_ms == 25.0
    assert result.probe_target == "1.1.1.1:443"
    assert result.checked_at == 1712000000.0


def test_probe_internet_returns_unreachable_when_all_fail() -> None:
    with patch(
        "pmeow.collector.internet.socket.create_connection",
        side_effect=OSError("connection refused"),
    ), patch(
        "pmeow.collector.internet.time.time",
        return_value=1712000000.0,
    ):
        result = probe_internet(
            [("1.1.1.1", 443), ("8.8.8.8", 443)], timeout_seconds=3.0,
        )

    assert result.reachable is False
    assert result.latency_ms is None
    assert result.probe_target == "1.1.1.1:443"


def test_probe_internet_tries_second_target_on_first_failure() -> None:
    call_count = 0

    def _side_effect(addr, timeout):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise OSError("refused")
        cm = type("CM", (), {
            "__enter__": lambda self: self,
            "__exit__": lambda *a: False,
        })()
        return cm

    with patch(
        "pmeow.collector.internet.socket.create_connection",
        side_effect=_side_effect,
    ), patch(
        # monotonic() call trace:
        #   1st target → t0 (before connect) → raises OSError → no 2nd call
        #   2nd target → t0 (before connect) → success → t1 (after connect)
        # Total: 3 monotonic() calls.
        "pmeow.collector.internet.time.monotonic",
        side_effect=[1.0, 2.0, 2.010],
    ), patch(
        "pmeow.collector.internet.time.time",
        return_value=1712000000.0,
    ):
        result = probe_internet(
            [("1.1.1.1", 443), ("8.8.8.8", 443)], timeout_seconds=3.0,
        )

    assert result.reachable is True
    assert result.latency_ms == 10.0
    assert result.probe_target == "8.8.8.8:443"


def test_probe_internet_empty_targets() -> None:
    result = probe_internet([], timeout_seconds=3.0)
    assert result.reachable is False
    assert result.probe_target == "disabled"


# ---------- InternetProbe (caching) ----------

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
        first = probe.get(now_monotonic=100.0)
        second = probe.get(now_monotonic=110.0)  # 10s later, still within 30s interval

    assert first is second
    assert mock_probe.call_count == 1


def test_internet_probe_refreshes_after_interval_expires() -> None:
    probe = InternetProbe(
        targets=[("1.1.1.1", 443)],
        timeout_seconds=3.0,
        interval_seconds=30.0,
    )

    result1 = InternetProbeResult(
        reachable=True, latency_ms=5.0,
        probe_target="1.1.1.1:443", checked_at=1712000000.0,
    )
    result2 = InternetProbeResult(
        reachable=False, latency_ms=None,
        probe_target="1.1.1.1:443", checked_at=1712000060.0,
    )

    with patch.object(
        internet_mod, "probe_internet", side_effect=[result1, result2],
    ) as mock_probe:
        first = probe.get(now_monotonic=100.0)
        second = probe.get(now_monotonic=131.0)  # 31s later, past the 30s interval

    assert first is result1
    assert second is result2
    assert mock_probe.call_count == 2


def test_internet_probe_returns_none_when_disabled() -> None:
    probe = InternetProbe(targets=[], timeout_seconds=3.0, interval_seconds=30.0)
    assert probe.get() is None
    assert probe.enabled is False


# ---------- load_probe_from_env ----------

def test_load_probe_from_env_defaults() -> None:
    probe = load_probe_from_env(env={})
    assert probe.enabled is True


def test_load_probe_from_env_custom_targets() -> None:
    probe = load_probe_from_env(env={
        "PMEOW_INTERNET_PROBE_TARGETS": "10.0.0.1:80",
    })
    assert probe.enabled is True
    assert probe._targets == [("10.0.0.1", 80)]


def test_load_probe_from_env_empty_targets_disables() -> None:
    probe = load_probe_from_env(env={
        "PMEOW_INTERNET_PROBE_TARGETS": "",
    })
    assert probe.enabled is False
    assert probe.get() is None


def test_load_probe_from_env_bad_timeout_uses_default() -> None:
    probe = load_probe_from_env(env={
        "PMEOW_INTERNET_PROBE_TIMEOUT": "not_a_number",
    })
    assert probe._timeout_seconds == 3.0
