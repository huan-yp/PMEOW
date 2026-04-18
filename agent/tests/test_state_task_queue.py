"""Smoke tests for the in-memory TaskQueue."""

import time

import pytest

from pmeow.models import TaskSpec, TaskStatus
from pmeow.state.task_queue import TaskQueue


@pytest.fixture
def queue():
    return TaskQueue()


@pytest.fixture
def sample_spec():
    return TaskSpec(
        command="python train.py",
        cwd="/work",
        user="alice",
        require_vram_mb=8000,
    )


class TestTaskQueueBasics:
    def test_submit_creates_queued_task(self, queue, sample_spec):
        task = queue.submit(sample_spec)
        assert task.status == TaskStatus.queued
        assert task.id in queue.queued
        assert task.command == "python train.py"

    def test_start_moves_to_running(self, queue, sample_spec):
        task = queue.submit(sample_spec)
        queue.reserve(task.id, [0])
        started = queue.start(task.id, pid=12345)
        assert started.status == TaskStatus.running
        assert started.pid == 12345
        assert task.id in queue.running

    def test_priority_ordering(self, queue):
        low = queue.submit(TaskSpec(command="low", cwd=".", user="u", require_vram_mb=0, priority=20))
        high = queue.submit(TaskSpec(command="high", cwd=".", user="u", require_vram_mb=0, priority=1))
        queued = queue.list_queued()
        assert queued[0].id == high.id
        assert queued[1].id == low.id

    def test_to_snapshot_running(self, queue, sample_spec):
        task = queue.submit(sample_spec)
        queue.reserve(task.id, [0])
        queue.start(task.id, pid=42)
        snap = queue.to_snapshot()
        assert len(snap.queued) == 0
        assert len(snap.running) == 1
        assert snap.running[0].pid == 42
