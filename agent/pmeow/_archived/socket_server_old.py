"""Local JSON-line protocol server for daemon control.

Uses AF_UNIX where available (Linux, macOS, Windows 10 17063+) and
falls back to a TCP loopback socket otherwise, writing the chosen port
into the *socket_path* file so clients can discover it.
"""

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
_HAS_AF_UNIX = hasattr(socket, "AF_UNIX")


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

        if _HAS_AF_UNIX:
            self._sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self._sock.bind(self.socket_path)
        else:
            # Fallback: TCP on loopback; write the port to socket_path file
            self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self._sock.bind(("127.0.0.1", 0))
            port = self._sock.getsockname()[1]
            Path(self.socket_path).write_text(str(port))
            log.info("AF_UNIX unavailable, using TCP 127.0.0.1:%d", port)

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

def _to_task_dict(rec: Any, *, log_dir: str | None = None) -> dict:
    result = {
        "id": rec.id,
        "command": rec.command,
        "cwd": rec.cwd,
        "user": rec.user,
        "require_vram_mb": rec.require_vram_mb,
        "require_gpu_count": rec.require_gpu_count,
        "argv": rec.argv,
        "launch_mode": rec.launch_mode.value,
        "report_requested": rec.report_requested,
        "launch_deadline": rec.launch_deadline,
        "gpu_ids": rec.gpu_ids,
        "priority": rec.priority,
        "status": rec.status.value,
        "created_at": rec.created_at,
        "started_at": rec.started_at,
        "finished_at": rec.finished_at,
        "exit_code": rec.exit_code,
        "pid": rec.pid,
    }
    if log_dir is not None:
        from pmeow.executor.logs import get_task_log_path
        result["log_path"] = get_task_log_path(rec.id, log_dir)
    return result


def _submit_task(svc: DaemonService, params: dict) -> dict:
    from pmeow.models import TaskLaunchMode
    spec = TaskSpec(
        command=params["command"],
        cwd=params.get("cwd", "."),
        user=params.get("user", "unknown"),
        require_vram_mb=params.get("require_vram_mb", 0),
        require_gpu_count=params.get("require_gpu_count", 1),
        gpu_ids=params.get("gpu_ids"),
        priority=params.get("priority", 10),
        argv=params.get("argv"),
        env_overrides=params.get("env_overrides"),
        launch_mode=TaskLaunchMode(params["launch_mode"]) if "launch_mode" in params else TaskLaunchMode.daemon_shell,
        report_requested=bool(params.get("report_requested", False)),
    )
    rec = svc.submit_task(spec)
    return _to_task_dict(rec, log_dir=svc.config.log_dir)


def _list_tasks(svc: DaemonService, params: dict) -> list[dict]:
    status = None
    if "status" in params and params["status"] is not None:
        status = TaskStatus(params["status"])
    return [_to_task_dict(t, log_dir=svc.config.log_dir) for t in svc.list_tasks(status)]


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


def _get_task(svc: DaemonService, params: dict) -> dict | None:
    task = svc.get_task(params["task_id"])
    return _to_task_dict(task, log_dir=svc.config.log_dir) if task is not None else None


def _get_task_events(svc: DaemonService, params: dict) -> list[dict]:
    return svc.get_task_events(params["task_id"], after_id=params.get("after_id", 0))


def _confirm_attached_launch(svc: DaemonService, params: dict) -> bool:
    return svc.confirm_attached_launch(params["task_id"], pid=params["pid"])


def _finish_attached_task(svc: DaemonService, params: dict) -> bool:
    return svc.finish_attached_task(params["task_id"], exit_code=params["exit_code"])


def _get_task_audit_detail(svc: DaemonService, params: dict) -> dict | None:
    result = svc.get_task_audit_detail(params["task_id"])
    if result is None:
        return None
    task, events, runtime = result
    audit: dict = {
        "task": _to_task_dict(task, log_dir=svc.config.log_dir),
        "events": events,
    }
    if runtime is not None:
        audit["runtime"] = {
            "launch_mode": runtime.launch_mode.value,
            "root_pid": runtime.root_pid,
            "root_created_at": runtime.root_created_at,
            "runtime_phase": runtime.runtime_phase.value,
            "first_started_at": runtime.first_started_at,
            "last_seen_at": runtime.last_seen_at,
            "finalize_source": runtime.finalize_source,
            "finalize_reason_code": runtime.finalize_reason_code,
            "last_observed_exit_code": runtime.last_observed_exit_code,
        }
    return audit


_METHODS: dict[str, Any] = {
    "submit_task": _submit_task,
    "list_tasks": _list_tasks,
    "get_task": _get_task,
    "get_task_events": _get_task_events,
    "get_task_audit_detail": _get_task_audit_detail,
    "cancel_task": _cancel_task,
    "get_logs": _get_logs,
    "confirm_attached_launch": _confirm_attached_launch,
    "finish_attached_task": _finish_attached_task,
    "pause_queue": _pause_queue,
    "resume_queue": _resume_queue,
    "get_status": _get_status,
}


# ------------------------------------------------------------------
# Client helper
# ------------------------------------------------------------------

def send_request(socket_path: str, method: str, params: dict | None = None) -> dict:
    """Connect to the daemon socket, send a JSON request, return the response.

    Detects whether the daemon is listening on AF_UNIX or TCP loopback by
    checking if *socket_path* contains a port number (TCP fallback mode).
    """
    if _HAS_AF_UNIX:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        target: str | tuple[str, int] = socket_path
    else:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        port = int(Path(socket_path).read_text().strip())
        target = ("127.0.0.1", port)

    try:
        sock.connect(target)  # type: ignore[arg-type]
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
