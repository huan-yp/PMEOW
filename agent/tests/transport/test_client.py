"""Tests for AgentTransportClient."""

from __future__ import annotations

import json
import time
from unittest.mock import MagicMock, patch

import pytest

from pmeow.models import TaskStatus, TaskUpdate
from pmeow.transport.client import AgentTransportClient


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _make_client(**kwargs) -> AgentTransportClient:
    defaults = {"server_url": "ws://localhost:3000", "agent_id": "test-agent"}
    defaults.update(kwargs)
    return AgentTransportClient(**defaults)


def _force_connected(client: AgentTransportClient) -> MagicMock:
    """Simulate a connected state with a mock WebSocket."""
    mock_ws = MagicMock()
    client._ws = mock_ws
    client._connected = True
    return mock_ws


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------


class TestSendRegister:
    def test_register_payload_contains_hostname_version(self):
        client = _make_client()
        mock_ws = _force_connected(client)

        client.send_register("mybox", "0.1.0")

        mock_ws.send.assert_called_once()
        payload = json.loads(mock_ws.send.call_args[0][0])
        assert payload["event"] == "agent:register"
        assert payload["data"]["agentId"] == "test-agent"
        assert payload["data"]["hostname"] == "mybox"
        assert payload["data"]["version"] == "0.1.0"


class TestSendTaskUpdate:
    def test_task_update_serializes_correctly(self):
        client = _make_client()
        mock_ws = _force_connected(client)

        update = TaskUpdate(
            task_id="t-123",
            status=TaskStatus.running,
            started_at=1000.0,
            pid=42,
        )
        client.send_task_update(update)

        payload = json.loads(mock_ws.send.call_args[0][0])
        assert payload["event"] == "agent:taskUpdate"
        d = payload["data"]
        assert d["taskId"] == "t-123"
        assert d["status"] == "running"
        assert d["startedAt"] == 1000.0
        assert d["pid"] == 42
        assert d["finishedAt"] is None
        assert d["exitCode"] is None


class TestInboundCommands:
    def test_inbound_cancel_reaches_handler(self):
        client = _make_client()
        received = []
        client.on_command("server:cancelTask", lambda data: received.append(data))

        msg = json.dumps({"event": "server:cancelTask", "data": {"taskId": "t-99"}})
        client._handle_message(msg)

        assert len(received) == 1
        assert received[0]["taskId"] == "t-99"


class TestReconnect:
    def test_reconnect_resends_register(self):
        client = _make_client()
        mock_ws = _force_connected(client)

        # First registration
        client.send_register("mybox", "0.1.0")
        assert mock_ws.send.call_count == 1

        # Simulate disconnect
        client._connected = False
        mock_ws.reset_mock()

        # Simulate reconnect — call _on_open which should re-register
        mock_ws2 = MagicMock()
        client._ws = mock_ws2
        client._on_open(mock_ws2)

        # Should have sent the register message again
        calls = [json.loads(c[0][0]) for c in mock_ws2.send.call_args_list]
        register_calls = [c for c in calls if c["event"] == "agent:register"]
        assert len(register_calls) >= 1
        assert register_calls[0]["data"]["hostname"] == "mybox"


class TestOfflineBuffering:
    def test_offline_buffering(self):
        client = _make_client()
        # Not connected — messages should be buffered
        assert not client.connected

        for i in range(110):
            client.send_heartbeat()  # heartbeats skip when disconnected
            client.send_register(f"host-{i}", "1.0")

        # heartbeats don't buffer (they return early when disconnected)
        # registers do buffer, capped at 100
        assert len(client._buffer) == 100

    def test_buffer_flushed_on_reconnect(self):
        client = _make_client()
        # Send while disconnected
        client._send_event("agent:test", {"n": 1})
        client._send_event("agent:test", {"n": 2})
        assert len(client._buffer) == 2

        # Simulate reconnect
        mock_ws = MagicMock()
        client._ws = mock_ws
        client._on_open(mock_ws)

        # Buffer was flushed
        assert len(client._buffer) == 0
        # At least the 2 buffered messages were sent (plus re-register if applicable)
        assert mock_ws.send.call_count >= 2


class TestHeartbeat:
    def test_heartbeat_payload(self):
        client = _make_client()
        mock_ws = _force_connected(client)

        before = time.time()
        client.send_heartbeat()
        after = time.time()

        payload = json.loads(mock_ws.send.call_args[0][0])
        assert payload["event"] == "agent:heartbeat"
        assert payload["data"]["agentId"] == "test-agent"
        assert before <= payload["data"]["timestamp"] <= after
