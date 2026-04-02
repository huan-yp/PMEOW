"""Minimal WebSocket transport client for communicating with the PMEOW server."""

from __future__ import annotations

import json
import logging
import threading
import time
from collections import deque
from typing import Any, Callable

import websocket

from pmeow.models import MetricsSnapshot, TaskUpdate

log = logging.getLogger(__name__)

_MAX_BUFFER = 100
_MAX_BACKOFF = 60


class AgentTransportClient:
    """Plain-WebSocket client that speaks JSON envelopes to the PMEOW server."""

    def __init__(
        self,
        server_url: str,
        agent_id: str,
        heartbeat_interval: int = 30,
    ) -> None:
        self._server_url = server_url
        self._agent_id = agent_id
        self._heartbeat_interval = heartbeat_interval

        self._ws: websocket.WebSocketApp | None = None
        self._ws_thread: threading.Thread | None = None
        self._heartbeat_thread: threading.Thread | None = None
        self._connected = False
        self._shutdown = threading.Event()
        self._lock = threading.Lock()

        # Reconnection state
        self._backoff = 1
        self._auto_reconnect = True

        # Offline buffer (bounded)
        self._buffer: deque[str] = deque(maxlen=_MAX_BUFFER)

        # Registration info for re-register on reconnect
        self._register_hostname: str | None = None
        self._register_version: str | None = None

        # Inbound command handlers
        self._handlers: dict[str, Callable[..., Any]] = {}

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
        """Open WebSocket connection in a background thread."""
        self._shutdown.clear()
        self._auto_reconnect = True
        self._start_ws()

    def disconnect(self) -> None:
        """Gracefully close the connection and stop background threads."""
        self._auto_reconnect = False
        self._shutdown.set()
        if self._ws:
            self._ws.close()
        if self._ws_thread and self._ws_thread.is_alive():
            self._ws_thread.join(timeout=5)
        if self._heartbeat_thread and self._heartbeat_thread.is_alive():
            self._heartbeat_thread.join(timeout=5)

    # ------------------------------------------------------------------
    # Outbound events
    # ------------------------------------------------------------------

    def send_register(self, hostname: str, version: str) -> None:
        self._register_hostname = hostname
        self._register_version = version
        self._send_event("agent:register", {
            "agentId": self._agent_id,
            "hostname": hostname,
            "version": version,
        })

    def send_metrics(self, snapshot: MetricsSnapshot) -> None:
        self._send_event("agent:metrics", snapshot.to_dict())

    def send_task_update(self, update: TaskUpdate) -> None:
        self._send_event("agent:taskUpdate", {
            "taskId": update.task_id,
            "status": update.status.value,
            "startedAt": update.started_at,
            "finishedAt": update.finished_at,
            "exitCode": update.exit_code,
            "pid": update.pid,
        })

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

    # ------------------------------------------------------------------
    # Internal: send helper
    # ------------------------------------------------------------------

    def _send_event(self, event: str, data: Any) -> None:
        payload = json.dumps({"event": event, "data": data})
        with self._lock:
            if self._connected and self._ws:
                try:
                    self._ws.send(payload)
                    return
                except Exception:
                    log.warning("send failed, buffering message")
            self._buffer.append(payload)

    # ------------------------------------------------------------------
    # Internal: WebSocket lifecycle
    # ------------------------------------------------------------------

    def _start_ws(self) -> None:
        self._ws = websocket.WebSocketApp(
            self._server_url,
            on_open=self._on_open,
            on_message=self._on_message,
            on_error=self._on_error,
            on_close=self._on_close,
        )
        self._ws_thread = threading.Thread(
            target=self._ws.run_forever, daemon=True,
        )
        self._ws_thread.start()

    def _on_open(self, ws: websocket.WebSocketApp) -> None:
        log.info("connected to %s", self._server_url)
        with self._lock:
            self._connected = True
            self._backoff = 1

        # Flush buffered messages
        self._flush_buffer()

        # Re-register if we have previously registered
        if self._register_hostname and self._register_version:
            self.send_register(self._register_hostname, self._register_version)

        # Start heartbeat thread
        self._start_heartbeat()

    def _on_message(self, ws: websocket.WebSocketApp, message: str) -> None:
        self._handle_message(message)

    def _on_error(self, ws: websocket.WebSocketApp, error: Exception) -> None:
        log.warning("websocket error: %s", error)

    def _on_close(
        self,
        ws: websocket.WebSocketApp,
        close_status: int | None,
        close_msg: str | None,
    ) -> None:
        log.info("disconnected (status=%s)", close_status)
        with self._lock:
            self._connected = False

        if self._auto_reconnect and not self._shutdown.is_set():
            self._reconnect()

    # ------------------------------------------------------------------
    # Internal: reconnection with exponential backoff
    # ------------------------------------------------------------------

    def _reconnect(self) -> None:
        delay = self._backoff
        log.info("reconnecting in %ds…", delay)
        if not self._shutdown.wait(timeout=delay):
            self._backoff = min(self._backoff * 2, _MAX_BACKOFF)
            self._start_ws()

    # ------------------------------------------------------------------
    # Internal: flush offline buffer
    # ------------------------------------------------------------------

    def _flush_buffer(self) -> None:
        with self._lock:
            while self._buffer and self._connected and self._ws:
                msg = self._buffer.popleft()
                try:
                    self._ws.send(msg)
                except Exception:
                    self._buffer.appendleft(msg)
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
    # Internal: inbound message dispatch
    # ------------------------------------------------------------------

    def _handle_message(self, message: str) -> None:
        try:
            parsed = json.loads(message)
        except json.JSONDecodeError:
            log.warning("ignoring non-JSON message")
            return

        event = parsed.get("event")
        data = parsed.get("data", {})

        handler = self._handlers.get(event)
        if handler:
            try:
                handler(data)
            except Exception:
                log.exception("handler error for %s", event)
        else:
            log.debug("no handler for event %s", event)
