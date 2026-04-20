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
import struct
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

    def __init__(self, socket_path: str, service: DaemonService, *, socket_group: str = "") -> None:
        self.socket_path = socket_path
        self.service = service
        self.socket_group = socket_group
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
            # Set socket permissions for multi-user access
            if self.socket_group:
                import grp as _grp
                try:
                    gid = _grp.getgrnam(self.socket_group).gr_gid
                    os.chown(self.socket_path, -1, gid)
                    os.chmod(self.socket_path, 0o0770)
                except (KeyError, OSError) as exc:
                    log.warning("failed to set socket group %s: %s", self.socket_group, exc)
            elif os.getuid() == 0:
                os.chmod(self.socket_path, 0o0666)
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
        resp = json.dumps({"ok": False, "error": "internal server error"})
        peer_uid: int | None = None
        peer_gid: int | None = None
        try:
            # Extract peer credentials on Linux
            if _HAS_AF_UNIX and hasattr(socket, "SO_PEERCRED"):
                try:
                    cred = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("iII"))
                    _pid, peer_uid, peer_gid = struct.unpack("iII", cred)
                except (OSError, struct.error):
                    pass
            data = conn.recv(_BUF_SIZE)
            if not data:
                return
            request = json.loads(data.decode())
            method = request.get("method", "")
            params = request.get("params", {})
            result = self._dispatch(method, params, peer_uid=peer_uid, peer_gid=peer_gid)
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

    def _dispatch(self, method: str, params: dict[str, Any], *, peer_uid: int | None = None, peer_gid: int | None = None) -> Any:
        handler = _METHODS.get(method)
        if handler is None:
            raise ValueError(f"unknown method: {method}")
        if method == "submit_task" and peer_uid is not None:
            params["_peer_uid"] = peer_uid
            params["_peer_gid"] = peer_gid
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
        "gpu_ids": rec.gpu_ids,
        "assigned_gpus": rec.assigned_gpus,
        "priority": rec.priority,
        "status": rec.status.value,
        "created_at": rec.created_at,
        "started_at": rec.started_at,
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
        submit_uid=params.get("_peer_uid"),
        submit_gid=params.get("_peer_gid"),
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


def _get_task(svc: DaemonService, params: dict) -> dict | None:
    task = svc.get_task(params["task_id"])
    return _to_task_dict(task, log_dir=svc.config.log_dir) if task is not None else None


def _confirm_attached_launch(svc: DaemonService, params: dict) -> bool:
    return svc.confirm_attached_launch(params["task_id"], pid=params["pid"])


def _finish_attached_task(svc: DaemonService, params: dict) -> bool:
    return svc.finish_attached_task(params["task_id"], exit_code=params["exit_code"])


def _set_priority(svc: DaemonService, params: dict) -> bool:
    return svc.set_task_priority(params["task_id"], int(params["priority"]))


_METHODS: dict[str, Any] = {
    "submit_task": _submit_task,
    "list_tasks": _list_tasks,
    "get_task": _get_task,
    "cancel_task": _cancel_task,
    "get_logs": _get_logs,
    "confirm_attached_launch": _confirm_attached_launch,
    "finish_attached_task": _finish_attached_task,
    "set_priority": _set_priority,
}


# ------------------------------------------------------------------
# Client helper
# ------------------------------------------------------------------

def send_request(socket_path: str, method: str, params: dict | None = None) -> dict:
    """Connect to the daemon socket, send a JSON request, return the response."""
    if _HAS_AF_UNIX:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        target: str | tuple[str, int] = socket_path
    else:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        port = int(Path(socket_path).read_text().strip())
        target = ("127.0.0.1", port)

    try:
        try:
            sock.connect(target)  # type: ignore[arg-type]
        except PermissionError as exc:
            raise RuntimeError(
                f"permission denied while connecting to daemon socket {socket_path}. "
                "The daemon may be running under a different Unix user or using a "
                "socket path that your current user cannot access. Set PMEOW_SOCKET_PATH "
                "or use --socket to point at the active daemon socket, and ensure the "
                "socket directory permissions allow access."
            ) from exc
        except ConnectionRefusedError as exc:
            raise RuntimeError(
                f"connection refused for daemon socket {socket_path}. "
                "The socket file may be stale, or the daemon may be listening on a "
                "different path. Check pmeow-agent service status and PMEOW_SOCKET_PATH."
            ) from exc
        except FileNotFoundError as exc:
            raise RuntimeError(
                f"daemon socket {socket_path} does not exist. "
                "Start pmeow-agent first, or set PMEOW_SOCKET_PATH / --socket to the "
                "active daemon socket path."
            ) from exc
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
