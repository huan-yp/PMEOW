"""Smoke tests for the refactored agent — validates core integration paths."""

import pytest

from pmeow.models import (
    ProcessInfo,
    ResourceSnapshot,
    TaskSpec,
    TaskStatus,
    UnifiedReport,
)
from pmeow.state.task_queue import TaskQueue


class TestUnifiedReportSerialization:
    def test_unified_report_to_dict_camel_case(self):
        from pmeow.models import ResourceSnapshot, TaskQueueSnapshot

        report = UnifiedReport(
            agent_id="test-agent",
            timestamp=1000.0,
            seq=1,
            resource_snapshot=ResourceSnapshot(),
            task_queue=TaskQueueSnapshot(),
        )
        d = report.to_dict()
        assert "agentId" in d
        assert "timestamp" in d
        assert "seq" in d
        assert "resourceSnapshot" in d
        assert "taskQueue" in d

    def test_unified_report_seq_increments(self):
        from pmeow.reporter import Reporter

        reporter = Reporter("test")
        from pmeow.models import TaskQueueSnapshot

        snapshot = ResourceSnapshot()
        r1 = reporter.build(snapshot, TaskQueueSnapshot())
        r2 = reporter.build(snapshot, TaskQueueSnapshot())
        assert r2.seq == r1.seq + 1


class TestProcessFiltering:
    def test_should_include_gpu_process(self):
        from pmeow.collector.processes import should_include_process
        p = ProcessInfo(pid=1, ppid=0, user="u", cpu_percent=0.1, mem_percent=0.1, rss=0, command="train", gpu_memory_mb=100.0)
        assert should_include_process(p) is True

    def test_should_exclude_idle_process(self):
        from pmeow.collector.processes import should_include_process
        p = ProcessInfo(pid=1, ppid=0, user="u", cpu_percent=0.5, mem_percent=0.1, rss=0, command="idle")
        assert should_include_process(p) is False

    def test_should_include_high_cpu_process(self):
        from pmeow.collector.processes import should_include_process
        p = ProcessInfo(pid=1, ppid=0, user="u", cpu_percent=5.0, mem_percent=0.1, rss=0, command="busy")
        assert should_include_process(p) is True


class TestDaemonServiceInstantiation:
    def test_daemon_service_creates_without_error(self):
        from pmeow.config import load_config
        from pmeow.daemon.service import DaemonService
        from pmeow.collector.internet import InternetProbe

        config = load_config()
        # Use a no-op probe to avoid network access
        svc = DaemonService(config, internet_probe=InternetProbe(targets=[]))
        assert svc.task_queue is not None
        assert svc.runner is not None

    def test_submit_and_cancel_task(self):
        from pmeow.config import load_config
        from pmeow.daemon.service import DaemonService
        from pmeow.collector.internet import InternetProbe

        config = load_config()
        svc = DaemonService(config, internet_probe=InternetProbe(targets=[]))
        spec = TaskSpec(command="echo hello", cwd=".", user="test", require_vram_mb=0)
        task = svc.submit_task(spec)
        assert task.status == TaskStatus.queued
        assert svc.cancel_task(task.id) is True
        assert svc.get_task(task.id) is None
