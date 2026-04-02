"""Tests for DaemonService and socket server."""

from __future__ import annotations

import json
import os
import socket
import tempfile
import threading
import time

import pytest

from pmeow.config import AgentConfig
from pmeow.daemon.service import DaemonService
from pmeow.daemon.socket_server import SocketServer, send_request
from pmeow.models import TaskSpec, TaskStatus


@pytest.fixture()
def tmp_state(tmp_path):
    return AgentConfig(
        state_dir=str(tmp_path / "state"),
        socket_path=str(tmp_path / "pmeow.sock"),
        log_dir=str(tmp_path / "logs"),
        collection_interval=60,
        history_window_seconds=120,
        vram_redundancy_coefficient=0.1,
    )


@pytest.fixture()
def svc(tmp_state):
    service = DaemonService(tmp_state)
    yield service
    from pmeow.store.database import close_database
    close_database(service.db)


def _make_spec(**overrides) -> TaskSpec:
    defaults = dict(
        command="echo hello",
        cwd="/tmp",
        user="tester",
        require_vram_mb=0,
        require_gpu_count=1,
        priority=10,
    )
    defaults.update(overrides)
    return TaskSpec(**defaults)


# ------------------------------------------------------------------
# submit / list
# ------------------------------------------------------------------

def test_submit_enqueues_task(svc: DaemonService):
    rec = svc.submit_task(_make_spec())
    assert rec.status == TaskStatus.queued
    assert rec.command == "echo hello"


def test_list_returns_tasks(svc: DaemonService):
    svc.submit_task(_make_spec(command="a"))
    svc.submit_task(_make_spec(command="b"))
    tasks = svc.list_tasks()
    assert len(tasks) == 2


def test_list_filters_by_status(svc: DaemonService):
    svc.submit_task(_make_spec())
    assert len(svc.list_tasks(status=TaskStatus.queued)) == 1
    assert len(svc.list_tasks(status=TaskStatus.running)) == 0


# ------------------------------------------------------------------
# pause / resume
# ------------------------------------------------------------------

def test_pause_resume_toggle(svc: DaemonService):
    qs = svc.get_queue_state()
    assert qs.paused is False

    svc.pause_queue()
    assert svc.get_queue_state().paused is True

    svc.resume_queue()
    assert svc.get_queue_state().paused is False


# ------------------------------------------------------------------
# cancel
# ------------------------------------------------------------------

def test_cancel_queued_task(svc: DaemonService):
    rec = svc.submit_task(_make_spec())
    assert svc.cancel_task(rec.id) is True

    tasks = svc.list_tasks(status=TaskStatus.cancelled)
    assert len(tasks) == 1
    assert tasks[0].id == rec.id


def test_cancel_nonexistent_returns_false(svc: DaemonService):
    assert svc.cancel_task("no-such-id") is False


# ------------------------------------------------------------------
# queue state
# ------------------------------------------------------------------

def test_queue_state_counts(svc: DaemonService):
    svc.submit_task(_make_spec())
    svc.submit_task(_make_spec())
    qs = svc.get_queue_state()
    assert qs.queued == 2
    assert qs.running == 0


# ------------------------------------------------------------------
# socket roundtrip
# ------------------------------------------------------------------

def test_socket_roundtrip(tmp_state):
    svc = DaemonService(tmp_state)
    srv = SocketServer(tmp_state.socket_path, svc)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    time.sleep(0.2)  # let server bind

    try:
        # submit via socket
        resp = send_request(tmp_state.socket_path, "submit_task", {
            "command": "echo hi",
            "cwd": "/tmp",
            "user": "test",
            "require_vram_mb": 0,
        })
        assert resp["ok"] is True, f"server error: {resp.get('error')}"
        task_id = resp["result"]["id"]

        # list via socket
        resp = send_request(tmp_state.socket_path, "list_tasks", {})
        assert resp["ok"] is True
        assert len(resp["result"]) == 1

        # get_status via socket
        resp = send_request(tmp_state.socket_path, "get_status", {})
        assert resp["ok"] is True
        assert resp["result"]["queued"] == 1

        # cancel via socket
        resp = send_request(tmp_state.socket_path, "cancel_task", {"task_id": task_id})
        assert resp["ok"] is True

        # unknown method
        resp = send_request(tmp_state.socket_path, "no_such_method", {})
        assert resp["ok"] is False
    finally:
        srv.shutdown()
        from pmeow.store.database import close_database
        close_database(svc.db)
