"""Unix socket JSON-line protocol server for local daemon control."""

from __future__ import annotations

import json
import logging
import os
import socket
import threading
from pathlib import Path
from typing import Any, TYPE_CHECKING

from pmeow.models import TaskSpec, TaskStatus

if TYPE_CHECKING:
    from pmeow.daemon.service import DaemonService

log = logging.getLogger(__name__)

_BUF_SIZE = 65536


class SocketServer:
    """A simple Unix-domain socket server using JSON line protocol.

    Request:  ``{"method": "...", "params": {...}}``
    Response: ``{"ok": true, "result": ...}`` or ``{"ok": false, "error": "..."}``
    """

    def __init__(self, socket_path: str, service: DaemonService) -> None:
        self.socket_path = socket_path
        self.service = service
        self._sock: socket.socket | None = None
        self._shutdown = threading.Event()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def serve_forever(self) -> None:
        self._cleanup_stale()
        Path(self.socket_path).parent.mkdir(parents=True, exist_ok=True)

        self._sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._sock.bind(self.socket_path)
        self._sock.listen(5)
        self._sock.settimeout(1.0)
        log.info("socket server listening on %s", self.socket_path)

        while not self._shutdown.is_set():
            try:
                conn, _ = self._sock.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            threading.Thread(
                target=self._handle, args=(conn,), daemon=True
            ).start()

        self._close()

    def shutdown(self) -> None:
        self._shutdown.set()

    # ------------------------------------------------------------------
    # Connection handler
    # ------------------------------------------------------------------

    def _handle(self, conn: socket.socket) -> None:
        try:
            data = conn.recv(_BUF_SIZE)
            if not data:
                return
            request = json.loads(data.decode())
            method = request.get("method", "")
            params = request.get("params", {})
            result = self._dispatch(method, params)
            resp = json.dumps({"ok": True, "result": result})
        except Exception as exc:
            resp = json.dumps({"ok": False, "error": str(exc)})
        finally:
            try:
                conn.sendall(resp.encode() + b"\n")
            except OSError:
                pass
            conn.close()

    # ------------------------------------------------------------------
    # Method dispatch
    # ------------------------------------------------------------------

    def _dispatch(self, method: str, params: dict[str, Any]) -> Any:
        handler = _METHODS.get(method)
        if handler is None:
            raise ValueError(f"unknown method: {method}")
        return handler(self.service, params)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _cleanup_stale(self) -> None:
        try:
            if os.path.exists(self.socket_path):
                os.unlink(self.socket_path)
        except OSError:
            pass

    def _close(self) -> None:
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
        try:
            os.unlink(self.socket_path)
        except OSError:
            pass


# ------------------------------------------------------------------
# RPC method implementations
# ------------------------------------------------------------------

def _to_task_dict(rec: Any) -> dict:
    return {
        "id": rec.id,
        "command": rec.command,
        "cwd": rec.cwd,
        "user": rec.user,
        "require_vram_mb": rec.require_vram_mb,
        "require_gpu_count": rec.require_gpu_count,
        "gpu_ids": rec.gpu_ids,
        "priority": rec.priority,
        "status": rec.status.value,
        "created_at": rec.created_at,
        "started_at": rec.started_at,
        "finished_at": rec.finished_at,
        "exit_code": rec.exit_code,
        "pid": rec.pid,
    }


def _submit_task(svc: DaemonService, params: dict) -> dict:
    spec = TaskSpec(
        command=params["command"],
        cwd=params.get("cwd", "."),
        user=params.get("user", "unknown"),
        require_vram_mb=params.get("require_vram_mb", 0),
        require_gpu_count=params.get("require_gpu_count", 1),
        gpu_ids=params.get("gpu_ids"),
        priority=params.get("priority", 10),
    )
    rec = svc.submit_task(spec)
    return _to_task_dict(rec)


def _list_tasks(svc: DaemonService, params: dict) -> list[dict]:
    status = None
    if "status" in params and params["status"] is not None:
        status = TaskStatus(params["status"])
    return [_to_task_dict(t) for t in svc.list_tasks(status)]


def _cancel_task(svc: DaemonService, params: dict) -> bool:
    return svc.cancel_task(params["task_id"])


def _get_logs(svc: DaemonService, params: dict) -> str:
    return svc.get_logs(params["task_id"], tail=params.get("tail", 100))


def _pause_queue(svc: DaemonService, params: dict) -> None:
    svc.pause_queue()
    return None


def _resume_queue(svc: DaemonService, params: dict) -> None:
    svc.resume_queue()
    return None


def _get_status(svc: DaemonService, params: dict) -> dict:
    qs = svc.get_queue_state()
    return {
        "paused": qs.paused,
        "queued": qs.queued,
        "running": qs.running,
        "completed": qs.completed,
        "failed": qs.failed,
        "cancelled": qs.cancelled,
    }


_METHODS: dict[str, Any] = {
    "submit_task": _submit_task,
    "list_tasks": _list_tasks,
    "cancel_task": _cancel_task,
    "get_logs": _get_logs,
    "pause_queue": _pause_queue,
    "resume_queue": _resume_queue,
    "get_status": _get_status,
}


# ------------------------------------------------------------------
# Client helper
# ------------------------------------------------------------------

def send_request(socket_path: str, method: str, params: dict | None = None) -> dict:
    """Connect to the daemon socket, send a JSON request, return the response."""
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.connect(socket_path)
        payload = json.dumps({"method": method, "params": params or {}})
        sock.sendall(payload.encode())
        sock.shutdown(socket.SHUT_WR)
        chunks: list[bytes] = []
        while True:
            chunk = sock.recv(_BUF_SIZE)
            if not chunk:
                break
            chunks.append(chunk)
        return json.loads(b"".join(chunks).decode())
    finally:
        sock.close()
