"""Minimal Socket.IO transport client for communicating with the PMEOW server."""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from typing import Any, Callable
from urllib.parse import urlsplit, urlunsplit

import socketio

from pmeow.models import LocalUsersInventory, MetricsSnapshot, TaskUpdate

log = logging.getLogger(__name__)

_NAMESPACE = "/agent"
_MAX_BUFFER = 100
_MAX_BACKOFF = 60


_VALID_SCHEMES = {"http", "https", "ws", "wss"}


def _normalize_server_url(server_url: str) -> str:
    parsed = urlsplit(server_url)
    if parsed.scheme not in _VALID_SCHEMES:
        # e.g. "localhost:17200" → urlsplit puts "localhost" in scheme, "17200" in path
        server_url = "http://" + server_url
        parsed = urlsplit(server_url)
        log.info("no URL scheme provided, assuming http:// → %s", server_url)
    if parsed.scheme == "ws":
        return urlunsplit(("http", parsed.netloc, parsed.path.rstrip("/"), parsed.query, parsed.fragment))
    if parsed.scheme == "wss":
        return urlunsplit(("https", parsed.netloc, parsed.path.rstrip("/"), parsed.query, parsed.fragment))
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), parsed.query, parsed.fragment))


class AgentTransportClient:
    """Socket.IO client that speaks agent/server events on the /agent namespace."""

    def __init__(
        self,
        server_url: str,
        agent_id: str,
        heartbeat_interval: int = 30,
    ) -> None:
        self._server_url = _normalize_server_url(server_url)
        self._agent_id = agent_id
        self._heartbeat_interval = heartbeat_interval

        self._client = socketio.Client(
            reconnection=True,
            reconnection_attempts=0,
            reconnection_delay=1,
            reconnection_delay_max=_MAX_BACKOFF,
            logger=False,
            engineio_logger=False,
        )
        self._heartbeat_thread: threading.Thread | None = None
        self._connected = False
        self._shutdown = threading.Event()
        self._lock = threading.Lock()

        # Offline buffer (bounded)
        self._buffer: deque[tuple[str, Any]] = deque(maxlen=_MAX_BUFFER)

        # Registration info for re-register on reconnect
        self._register_hostname: str | None = None
        self._register_version: str | None = None

        # Inbound command handlers
        self._handlers: dict[str, Callable[..., Any]] = {}

        self._client.on("connect", self._on_connect, namespace=_NAMESPACE)
        self._client.on("disconnect", self._on_disconnect, namespace=_NAMESPACE)
        self._client.on("connect_error", self._on_connect_error, namespace=_NAMESPACE)

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def connected(self) -> bool:
        return self._connected

    # ------------------------------------------------------------------
    # Connect / disconnect
    # ------------------------------------------------------------------

    def connect(self) -> None:
        """Open the Socket.IO connection and leave reconnects to the client."""
        self._shutdown.clear()
        self._start_heartbeat()

        if self._connected or self._client.connected:
            return

        self._client.connect(
            self._server_url,
            namespaces=[_NAMESPACE],
            wait=False,
        )

    def disconnect(self) -> None:
        """Gracefully close the connection and stop background threads."""
        self._shutdown.set()
        if self._client.connected:
            self._client.disconnect()
        else:
            self._connected = False
        if self._heartbeat_thread and self._heartbeat_thread.is_alive():
            self._heartbeat_thread.join(timeout=5)

    # ------------------------------------------------------------------
    # Outbound events
    # ------------------------------------------------------------------

    def send_register(self, hostname: str, version: str) -> None:
        self._register_hostname = hostname
        self._register_version = version
        payload = {
            "agentId": self._agent_id,
            "hostname": hostname,
            "version": version,
        }
        with self._lock:
            if self._connected:
                self._emit_or_buffer_locked("agent:register", payload, prepend_on_failure=True)

    def send_metrics(self, snapshot: MetricsSnapshot) -> None:
        self._send_event("agent:metrics", snapshot.to_dict())

    def send_task_update(self, update: TaskUpdate) -> None:
        self._send_event("agent:taskUpdate", {
            "taskId": update.task_id,
            "status": update.status.value,
            "command": update.command,
            "cwd": update.cwd,
            "user": update.user,
            "requireVramMB": update.require_vram_mb,
            "requireGpuCount": update.require_gpu_count,
            "gpuIds": update.gpu_ids,
            "priority": update.priority,
            "createdAt": update.created_at,
            "startedAt": update.started_at,
            "finishedAt": update.finished_at,
            "exitCode": update.exit_code,
            "pid": update.pid,
        })

    def send_local_users(self, inventory: LocalUsersInventory) -> None:
        payload = inventory.to_dict()
        payload["agentId"] = self._agent_id
        self._send_event("agent:localUsers", payload)

    def send_heartbeat(self) -> None:
        if not self._connected:
            return
        self._send_event("agent:heartbeat", {
            "agentId": self._agent_id,
            "timestamp": time.time(),
        })

    # ------------------------------------------------------------------
    # Inbound command registration
    # ------------------------------------------------------------------

    def on_command(self, command: str, handler: Callable[..., Any]) -> None:
        self._handlers[command] = handler
        self._client.on(command, self._make_command_handler(command), namespace=_NAMESPACE)

    # ------------------------------------------------------------------
    # Internal: send helper
    # ------------------------------------------------------------------

    def _send_event(self, event: str, data: Any) -> None:
        with self._lock:
            if self._connected and self._emit_locked(event, data):
                return
            self._buffer.append((event, data))

    # ------------------------------------------------------------------
    # Internal: Socket.IO lifecycle
    # ------------------------------------------------------------------

    def _on_connect(self) -> None:
        log.info("connected to %s", self._server_url)
        with self._lock:
            self._connected = True
            if self._register_hostname and self._register_version:
                self._emit_or_buffer_locked(
                    "agent:register",
                    {
                        "agentId": self._agent_id,
                        "hostname": self._register_hostname,
                        "version": self._register_version,
                    },
                    prepend_on_failure=True,
                )
            self._flush_buffer_locked()

    def _on_disconnect(self) -> None:
        log.info("disconnected from %s", self._server_url)
        with self._lock:
            self._connected = False

    def _on_connect_error(self, error: Any) -> None:
        log.warning("socket.io connect error: %s", error)

    # ------------------------------------------------------------------
    # Internal: flush offline buffer
    # ------------------------------------------------------------------

    def _flush_buffer(self) -> None:
        with self._lock:
            self._flush_buffer_locked()

    def _emit_locked(self, event: str, data: Any) -> bool:
        try:
            self._client.emit(event, data, namespace=_NAMESPACE)
            return True
        except Exception:
            log.warning("send failed, buffering message")
            return False

    def _emit_or_buffer_locked(self, event: str, data: Any, *, prepend_on_failure: bool = False) -> None:
        if self._emit_locked(event, data):
            return
        if prepend_on_failure:
            self._buffer.appendleft((event, data))
            return
        self._buffer.append((event, data))

    def _flush_buffer_locked(self) -> None:
        while self._buffer and self._connected:
            event, data = self._buffer.popleft()
            if self._emit_locked(event, data):
                continue
            self._buffer.appendleft((event, data))
            break

    # ------------------------------------------------------------------
    # Internal: heartbeat thread
    # ------------------------------------------------------------------

    def _start_heartbeat(self) -> None:
        if self._heartbeat_thread and self._heartbeat_thread.is_alive():
            return

        def _loop() -> None:
            while not self._shutdown.wait(timeout=self._heartbeat_interval):
                if self._connected:
                    self.send_heartbeat()

        self._heartbeat_thread = threading.Thread(target=_loop, daemon=True)
        self._heartbeat_thread.start()

    # ------------------------------------------------------------------
    # Internal: inbound command dispatch
    # ------------------------------------------------------------------

    def _make_command_handler(self, command: str) -> Callable[[Any], Any]:
        def _handle(data: Any) -> Any:
            return self._dispatch_command(command, data)

        return _handle

    def _dispatch_command(self, command: str, data: Any) -> Any:
        handler = self._handlers.get(command)
        if handler:
            try:
                return handler(data)
            except Exception:
                log.exception("handler error for %s", command)
                raise
        else:
            log.debug("no handler for event %s", command)
        return None
