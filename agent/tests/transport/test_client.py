"""Tests for AgentTransportClient."""

from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

from pmeow.models import LocalUserRecord, LocalUsersInventory, TaskStatus, TaskUpdate
from pmeow.transport.client import AgentTransportClient, _normalize_server_url


# ------------------------------------------------------------------
# URL normalization
# ------------------------------------------------------------------


class TestNormalizeServerUrl:
    def test_bare_host_port_gets_http_scheme(self):
        assert _normalize_server_url("localhost:17200") == "http://localhost:17200"

    def test_bare_host_port_with_path(self):
        assert _normalize_server_url("myhost:3000/api") == "http://myhost:3000/api"

    def test_http_url_unchanged(self):
        assert _normalize_server_url("http://localhost:17200") == "http://localhost:17200"

    def test_https_url_unchanged(self):
        assert _normalize_server_url("https://example.com:443/path") == "https://example.com:443/path"

    def test_ws_converted_to_http(self):
        assert _normalize_server_url("ws://localhost:3000") == "http://localhost:3000"

    def test_wss_converted_to_https(self):
        assert _normalize_server_url("wss://host:443/base/") == "https://host:443/base"

    def test_trailing_slash_stripped(self):
        assert _normalize_server_url("http://host:3000/") == "http://host:3000"

    def test_ip_address_without_scheme(self):
        assert _normalize_server_url("192.168.1.1:17200") == "http://192.168.1.1:17200"


def _emit_payload(mock_client: MagicMock, call_index: int = 0) -> tuple[str, dict]:
    call = mock_client.emit.call_args_list[call_index]
    return call.args[0], call.args[1]


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _make_client(socketio_client: MagicMock, **kwargs) -> AgentTransportClient:
    defaults = {"server_url": "ws://localhost:3000", "agent_id": "test-agent"}
    defaults.update(kwargs)
    socketio_client.connected = False
    with patch("pmeow.transport.client.socketio.Client", return_value=socketio_client):
        return AgentTransportClient(**defaults)


def _force_connected(client: AgentTransportClient, socketio_client: MagicMock) -> MagicMock:
    """Simulate a connected state with a mock Socket.IO client."""
    client._connected = True
    socketio_client.connected = True
    return socketio_client


def _registered_handler(socketio_client: MagicMock, event: str):
    for call in socketio_client.on.call_args_list:
        if call.args[0] == event and call.kwargs.get("namespace") == "/agent":
            return call.args[1]
    raise AssertionError(f"no handler registered for {event}")


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------


class TestSendRegister:
    def test_register_payload_contains_hostname_version(self):
        mock_sio = MagicMock()
        client = _make_client(mock_sio)
        _force_connected(client, mock_sio)

        client.send_register("mybox", "0.1.0")

        mock_sio.emit.assert_called_once_with(
            "agent:register",
            {
                "agentId": "test-agent",
                "hostname": "mybox",
                "version": "0.1.0",
            },
            namespace="/agent",
        )

    def test_connect_uses_agent_namespace(self):
        mock_sio = MagicMock()
        client = _make_client(mock_sio, server_url="ws://localhost:3000/base/")

        client.connect()

        mock_sio.connect.assert_called_once_with(
            "http://localhost:3000/base",
            namespaces=["/agent"],
            wait=False,
        )


class TestSendTaskUpdate:
    def test_task_update_serializes_correctly(self):
        mock_sio = MagicMock()
        client = _make_client(mock_sio)
        _force_connected(client, mock_sio)

        update = TaskUpdate(
            task_id="t-123",
            status=TaskStatus.running,
            started_at=1000.0,
            pid=42,
        )
        client.send_task_update(update)

        event, d = _emit_payload(mock_sio)
        assert event == "agent:taskUpdate"
        assert d["taskId"] == "t-123"
        assert d["status"] == "running"
        assert d["startedAt"] == 1000.0
        assert d["pid"] == 42
        assert d["finishedAt"] is None
        assert d["exitCode"] is None


class TestSendLocalUsers:
    def test_local_users_payload_serializes_correctly(self):
        mock_sio = MagicMock()
        client = _make_client(mock_sio)
        _force_connected(client, mock_sio)

        inventory = LocalUsersInventory(
            timestamp=1000.0,
            users=[
                LocalUserRecord(
                    username="alice",
                    uid=1000,
                    gid=1000,
                    gecos="Alice Example",
                    home="/home/alice",
                    shell="/bin/bash",
                )
            ],
        )

        client.send_local_users(inventory)

        event, payload = _emit_payload(mock_sio)
        assert event == "agent:localUsers"
        assert payload["agentId"] == "test-agent"
        assert payload["timestamp"] == 1000.0
        assert payload["users"] == [{
            "username": "alice",
            "uid": 1000,
            "gid": 1000,
            "gecos": "Alice Example",
            "home": "/home/alice",
            "shell": "/bin/bash",
        }]


class TestInboundCommands:
    def test_inbound_cancel_reaches_handler(self):
        mock_sio = MagicMock()
        client = _make_client(mock_sio)
        received = []
        client.on_command("server:cancelTask", lambda data: received.append(data))

        handler = _registered_handler(mock_sio, "server:cancelTask")
        handler({"taskId": "t-99"})

        assert len(received) == 1
        assert received[0]["taskId"] == "t-99"

    def test_inbound_handler_return_value_is_propagated(self):
        mock_sio = MagicMock()
        client = _make_client(mock_sio)
        client.on_command("server:getTaskEvents", lambda data: [{"id": 1, "task_id": data["taskId"]}])

        handler = _registered_handler(mock_sio, "server:getTaskEvents")
        result = handler({"taskId": "t-42"})

        assert result == [{"id": 1, "task_id": "t-42"}]


class TestReconnect:
    def test_reconnect_resends_register(self):
        mock_sio = MagicMock()
        client = _make_client(mock_sio)
        _force_connected(client, mock_sio)

        # First registration
        client.send_register("mybox", "0.1.0")
        assert mock_sio.emit.call_count == 1

        # Simulate disconnect
        client._on_disconnect()
        mock_sio.emit.reset_mock()

        # Simulate reconnect — _on_connect should re-register
        client._on_connect()

        # Should have sent the register message again
        assert mock_sio.emit.call_count >= 1
        event, data = _emit_payload(mock_sio)
        assert event == "agent:register"
        assert data["hostname"] == "mybox"


class TestOfflineBuffering:
    def test_offline_buffering(self):
        mock_sio = MagicMock()
        client = _make_client(mock_sio)
        # Not connected — messages should be buffered
        assert not client.connected

        for i in range(110):
            client.send_heartbeat()  # heartbeats skip when disconnected
            client.send_register(f"host-{i}", "1.0")

        # heartbeats don't buffer (they return early when disconnected)
        # registers do buffer, capped at 100
        assert len(client._buffer) == 100
        assert mock_sio.emit.call_count == 0

    def test_buffer_flushed_on_reconnect(self):
        mock_sio = MagicMock()
        client = _make_client(mock_sio)
        # Send while disconnected
        client._send_event("agent:test", {"n": 1})
        client._send_event("agent:test", {"n": 2})
        assert len(client._buffer) == 2

        # Simulate reconnect
        client._on_connect()

        # Buffer was flushed
        assert len(client._buffer) == 0
        assert mock_sio.emit.call_count == 2
        assert _emit_payload(mock_sio, 0) == ("agent:test", {"n": 1})
        assert _emit_payload(mock_sio, 1) == ("agent:test", {"n": 2})


class TestHeartbeat:
    def test_heartbeat_payload(self):
        mock_sio = MagicMock()
        client = _make_client(mock_sio)
        _force_connected(client, mock_sio)

        before = time.time()
        client.send_heartbeat()
        after = time.time()

        event, payload = _emit_payload(mock_sio)
        assert event == "agent:heartbeat"
        assert payload["agentId"] == "test-agent"
        assert before <= payload["timestamp"] <= after

    def test_heartbeat_is_skipped_while_disconnected(self):
        mock_sio = MagicMock()
        client = _make_client(mock_sio)

        client.send_heartbeat()

        mock_sio.emit.assert_not_called()
