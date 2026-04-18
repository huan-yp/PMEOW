"""Minimal Socket.IO transport client for communicating with the PMEOW server.

Simplified for the unified report protocol:
- Outbound: agent:register (on connect), agent:report (1s cycle)
- Inbound: server:cancelTask, server:setPriority, server:requestCollection
"""

from __future__ import annotations

import logging
from typing import Any, Callable
from urllib.parse import urlsplit, urlunsplit

import socketio

from pmeow.models import UnifiedReport

log = logging.getLogger(__name__)

_NAMESPACE = "/agent"

_VALID_SCHEMES = {"http", "https", "ws", "wss"}


def _normalize_server_url(server_url: str) -> str:
    parsed = urlsplit(server_url)
    if parsed.scheme not in _VALID_SCHEMES:
        server_url = "http://" + server_url
        parsed = urlsplit(server_url)
        log.info("no URL scheme provided, assuming http:// → %s", server_url)
    if parsed.scheme == "ws":
        return urlunsplit(("http", parsed.netloc, parsed.path.rstrip("/"), parsed.query, parsed.fragment))
    if parsed.scheme == "wss":
        return urlunsplit(("https", parsed.netloc, parsed.path.rstrip("/"), parsed.query, parsed.fragment))
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), parsed.query, parsed.fragment))


class AgentTransportClient:
    """Socket.IO client that speaks agent/server events on the /agent namespace.

    Simplified protocol: no heartbeat thread, no offline buffer, no task-changed
    deduplication. The unified report replaces all of those.
    """

    def __init__(
        self,
        server_url: str,
        agent_id: str,
        reconnect_delay: float = 0.5,
        reconnect_delay_max: float = 5.0,
        request_timeout: float = 3.0,
    ) -> None:
        self._server_url = _normalize_server_url(server_url)
        self._agent_id = agent_id

        self._client = socketio.Client(
            reconnection=True,
            reconnection_attempts=0,
            reconnection_delay=reconnect_delay,
            reconnection_delay_max=reconnect_delay_max,
            randomization_factor=0.1,
            logger=False,
            engineio_logger=False,
            request_timeout=request_timeout,
        )
        self._connected = False

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
        if self._connected or self._client.connected:
            return

        self._client.connect(
            self._server_url,
            namespaces=[_NAMESPACE],
            wait=False,
        )

    def disconnect(self) -> None:
        """Gracefully close the connection."""
        if self._client.connected:
            self._client.disconnect()
        self._connected = False

    # ------------------------------------------------------------------
    # Outbound events
    # ------------------------------------------------------------------

    def send_register(self, hostname: str, version: str) -> None:
        """Send registration payload. Cached for re-registration on reconnect."""
        self._register_hostname = hostname
        self._register_version = version
        payload = {
            "agentId": self._agent_id,
            "hostname": hostname,
            "version": version,
        }
        self._emit_safe("agent:register", payload)

    def send_report(self, report: UnifiedReport) -> None:
        """Send a unified report to the server."""
        if not self._connected:
            log.warning("skipping report: not connected")
            return
        ok = self._emit_safe("agent:report", report.to_dict())
        if ok:
            log.debug("emitted agent:report seq=%d", report.seq)
        else:
            log.warning("failed to emit agent:report seq=%d", report.seq)

    # ------------------------------------------------------------------
    # Inbound command registration
    # ------------------------------------------------------------------

    def on_command(self, command: str, handler: Callable[..., Any]) -> None:
        """Register a handler for an inbound server command."""
        self._handlers[command] = handler
        self._client.on(command, self._make_command_handler(command), namespace=_NAMESPACE)

    # ------------------------------------------------------------------
    # Internal: Socket.IO lifecycle
    # ------------------------------------------------------------------

    def _on_connect(self) -> None:
        log.info("connected to %s", self._server_url)
        self._connected = True
        if self._register_hostname and self._register_version:
            self.send_register(self._register_hostname, self._register_version)

    def _on_disconnect(self) -> None:
        log.info("disconnected from %s", self._server_url)
        self._connected = False

    def _on_connect_error(self, error: Any) -> None:
        log.warning("socket.io connect error: %s", error)

    # ------------------------------------------------------------------
    # Internal: emit helper
    # ------------------------------------------------------------------

    def _emit_safe(self, event: str, data: Any) -> bool:
        """Emit an event, returning True on success."""
        if not self._connected:
            return False
        try:
            self._client.emit(event, data, namespace=_NAMESPACE)
            return True
        except Exception:
            log.warning("failed to emit %s", event)
            return False

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
"""Minimal Socket.IO transport client for communicating with the PMEOW server."""
