from __future__ import annotations

import time

import pytest

from pmeow.collector.internet import InternetProbe
from pmeow.config import AgentConfig
from pmeow.daemon.service import DaemonService
from pmeow.executor.logs import read_task_log
from pmeow.models import (
    CollectedSnapshot,
    PerGpuAllocationSummary,
    ResourceSnapshot,
    TaskLaunchMode,
    TaskSpec,
    TaskStatus,
)
from pmeow.queue.scheduler import ScheduleBatchResult, ScheduleDecision, TaskScheduleEvaluation


def _make_service(tmp_path) -> DaemonService:
    state_dir = tmp_path / "state"
    return DaemonService(
        AgentConfig(
            server_url="",
            agent_id="test-agent",
            collection_interval=1,
            history_window_seconds=120,
            attach_timeout=30,
            state_dir=str(state_dir),
            socket_path=str(state_dir / "pmeow.sock"),
            log_dir=str(state_dir / "logs"),
        ),
        internet_probe=InternetProbe(targets=[]),
    )


def _make_snapshot() -> CollectedSnapshot:
    gpu = PerGpuAllocationSummary(
        gpu_index=0,
        total_memory_mb=16000.0,
        effective_free_mb=12000.0,
    )
    return CollectedSnapshot(
        timestamp=time.time(),
        resource_snapshot=ResourceSnapshot(),
        per_gpu=[gpu],
    )


def test_collect_cycle_records_blocked_schedule_history_and_log(monkeypatch, tmp_path) -> None:
    svc = _make_service(tmp_path)
    task = svc.submit_task(
        TaskSpec(
            command="python train.py",
            cwd=str(tmp_path),
            user="alice",
            require_vram_mb=4096,
            require_gpu_count=1,
            launch_mode=TaskLaunchMode.attached_python,
        )
    )

    monkeypatch.setattr("pmeow.daemon.service.collect_snapshot", lambda **_: _make_snapshot())
    monkeypatch.setattr(
        svc.scheduler,
        "try_schedule",
        lambda queued_tasks, per_gpu: ScheduleBatchResult(
            decisions=[],
            evaluations=[
                TaskScheduleEvaluation(
                    task_id=task.id,
                    can_run=False,
                    reason_code="blocked_by_higher_priority",
                    gpu_ids=[],
                    current_eligible_gpu_ids=[0],
                    sustained_eligible_gpu_ids=[0],
                    current_effective_free_mb={0: 12000.0},
                    pending_vram_mb={0: 4096.0},
                    blocker_task_ids=["task-high"],
                )
            ],
        ),
    )

    svc.collect_cycle()

    current = svc.get_task(task.id)
    assert current is not None
    assert current.status == TaskStatus.queued
    assert len(current.schedule_history) == 1
    assert current.schedule_history[0].result == "blocked_by_priority"

    snapshot = svc.task_queue.to_snapshot()
    assert snapshot.queued[0].schedule_history[0]["result"] == "blocked_by_priority"

    log_content = read_task_log(task.id, svc.config.log_dir)
    assert "submitted task" in log_content
    assert "schedule blocked_by_priority" in log_content
    assert "blocked by higher-priority reservations" in log_content


def test_attached_lifecycle_logs_and_get_logs_tail(monkeypatch, tmp_path) -> None:
    svc = _make_service(tmp_path)
    task = svc.submit_task(
        TaskSpec(
            command="python train.py",
            cwd=str(tmp_path),
            user="alice",
            require_vram_mb=2048,
            require_gpu_count=1,
            launch_mode=TaskLaunchMode.attached_python,
        )
    )

    monkeypatch.setattr("pmeow.daemon.service.collect_snapshot", lambda **_: _make_snapshot())
    monkeypatch.setattr(
        svc.scheduler,
        "try_schedule",
        lambda queued_tasks, per_gpu: ScheduleBatchResult(
            decisions=[ScheduleDecision(task_id=task.id, gpu_ids=[0])],
            evaluations=[
                TaskScheduleEvaluation(
                    task_id=task.id,
                    can_run=True,
                    reason_code="scheduled",
                    gpu_ids=[0],
                    current_eligible_gpu_ids=[0],
                    sustained_eligible_gpu_ids=[0],
                    current_effective_free_mb={0: 12000.0},
                    pending_vram_mb={},
                    blocker_task_ids=[],
                )
            ],
        ),
    )

    svc.collect_cycle()
    assert svc.confirm_attached_launch(task.id, pid=4321) is True
    assert svc.finish_attached_task(task.id, exit_code=0) is True

    tail = svc.get_logs(task.id, tail=2)
    assert tail == (
        f"task started: pid=4321 task_id={task.id}\n"
        f"task finished: exit_code=0 task_id={task.id}\n"
    )


def test_get_logs_raises_when_file_missing(tmp_path) -> None:
    svc = _make_service(tmp_path)
    with pytest.raises(FileNotFoundError, match="log file not found for task missing-task"):
        svc.get_logs("missing-task")