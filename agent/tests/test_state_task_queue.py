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


class TestTaskQueueSubmit:
    def test_submit_creates_queued_task(self, queue, sample_spec):
        task = queue.submit(sample_spec)
        assert task.status == TaskStatus.queued
        assert task.id in queue.queued
        assert task.command == "python train.py"

    def test_submit_assigns_unique_ids(self, queue, sample_spec):
        t1 = queue.submit(sample_spec)
        t2 = queue.submit(sample_spec)
        assert t1.id != t2.id


class TestTaskQueueTransitions:
    def test_reserve_moves_to_reserved(self, queue, sample_spec):
        task = queue.submit(sample_spec)
        reserved = queue.reserve(task.id, [0, 1])
        assert reserved.status == TaskStatus.reserved
        assert reserved.assigned_gpus == [0, 1]
        assert task.id not in queue.queued
        assert task.id in queue.reserved

    def test_start_moves_to_running(self, queue, sample_spec):
        task = queue.submit(sample_spec)
        queue.reserve(task.id, [0])
        started = queue.start(task.id, pid=12345)
        assert started.status == TaskStatus.running
        assert started.pid == 12345
        assert task.id not in queue.reserved
        assert task.id in queue.running

    def test_remove_from_running(self, queue, sample_spec):
        task = queue.submit(sample_spec)
        queue.reserve(task.id, [0])
        queue.start(task.id, pid=12345)
        removed = queue.remove(task.id)
        assert removed is not None
        assert task.id not in queue.running

    def test_remove_nonexistent_returns_none(self, queue):
        assert queue.remove("nonexistent") is None


class TestTaskQueuePriority:
    def test_set_priority(self, queue, sample_spec):
        task = queue.submit(sample_spec)
        assert queue.set_priority(task.id, 5)
        assert queue.get(task.id).priority == 5

    def test_priority_ordering(self, queue):
        low = queue.submit(TaskSpec(command="low", cwd=".", user="u", require_vram_mb=0, priority=20))
        high = queue.submit(TaskSpec(command="high", cwd=".", user="u", require_vram_mb=0, priority=1))
        queued = queue.list_queued()
        assert queued[0].id == high.id
        assert queued[1].id == low.id


class TestTaskQueueQuery:
    def test_get_from_any_state(self, queue, sample_spec):
        task = queue.submit(sample_spec)
        assert queue.get(task.id) is not None
        queue.reserve(task.id, [0])
        assert queue.get(task.id) is not None
        queue.start(task.id, pid=99)
        assert queue.get(task.id) is not None

    def test_list_all(self, queue, sample_spec):
        t1 = queue.submit(sample_spec)
        t2 = queue.submit(sample_spec)
        queue.reserve(t1.id, [0])
        assert len(queue.list_all()) == 2


class TestTaskQueueSnapshot:
    def test_to_snapshot_maps_reserved_to_queued(self, queue, sample_spec):
        task = queue.submit(sample_spec)
        queue.reserve(task.id, [0])
        snap = queue.to_snapshot()
        # Reserved tasks appear as queued in the snapshot
        assert len(snap.queued) == 1
        assert len(snap.running) == 0

    def test_to_snapshot_running(self, queue, sample_spec):
        task = queue.submit(sample_spec)
        queue.reserve(task.id, [0])
        queue.start(task.id, pid=42)
        snap = queue.to_snapshot()
        assert len(snap.queued) == 0
        assert len(snap.running) == 1
        assert snap.running[0].pid == 42
