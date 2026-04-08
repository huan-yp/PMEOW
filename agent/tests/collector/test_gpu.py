"""Tests for GPU collection and attribution (mocked – no real GPU required)."""

from __future__ import annotations

import subprocess
from unittest.mock import MagicMock, mock_open, patch

import pytest

from pmeow.collector.gpu import (
    collect_gpu,
    collect_gpu_processes,
    collect_per_gpu_total_memory,
    collect_per_gpu_used_memory,
)
from pmeow.collector.gpu_attribution import (
    attribute_gpu_processes,
    calculate_effective_free,
)
from pmeow.models import (
    GpuProcessInfo,
    GpuTaskAllocation,
    GpuUnknownProcess,
    GpuUserProcess,
    TaskRecord,
    TaskStatus,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_task(task_id: str, pid: int, vram: int = 8000, gpu_ids=None) -> TaskRecord:
    return TaskRecord(
        id=task_id,
        command="train.py",
        cwd="/tmp",
        user="alice",
        require_vram_mb=vram,
        require_gpu_count=1,
        gpu_ids=gpu_ids or [0],
        priority=10,
        status=TaskStatus.running,
        created_at=0.0,
        pid=pid,
    )


def _mock_run_factory(table: dict[str, str]):
    """Return a side_effect for subprocess.run that dispatches on nvidia-smi args."""

    def _side_effect(cmd, **kwargs):
        # Match based on --query-gpu or --query-compute-apps substring
        joined = " ".join(cmd)
        for key, stdout in table.items():
            if key in joined:
                return subprocess.CompletedProcess(cmd, 0, stdout=stdout, stderr="")
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="error")

    return _side_effect


# ---------------------------------------------------------------------------
# Test: no GPU fallback
# ---------------------------------------------------------------------------


class TestNoGpuFallback:
    def test_collect_gpu_file_not_found(self):
        with patch("pmeow.collector.gpu.subprocess.run", side_effect=FileNotFoundError):
            snap = collect_gpu()
        assert snap.available is False
        assert snap.gpu_count == 0

    def test_collect_gpu_processes_file_not_found(self):
        with patch("pmeow.collector.gpu.subprocess.run", side_effect=FileNotFoundError):
            procs = collect_gpu_processes()
        assert procs == []

    def test_collect_gpu_nonzero_exit(self):
        failed = subprocess.CompletedProcess([], 1, stdout="", stderr="err")
        with patch("pmeow.collector.gpu.subprocess.run", return_value=failed):
            snap = collect_gpu()
        assert snap.available is False


# ---------------------------------------------------------------------------
# Test: per-GPU parsing
# ---------------------------------------------------------------------------


class TestPerGpuParsing:
    GPU_CSV = "24576, 1200, 45, 60\n24576, 800, 30, 55\n"

    def test_two_gpus(self):
        ok = subprocess.CompletedProcess([], 0, stdout=self.GPU_CSV, stderr="")
        with patch("pmeow.collector.gpu.subprocess.run", return_value=ok):
            snap = collect_gpu()
        assert snap.available is True
        assert snap.gpu_count == 2
        assert snap.total_memory_mb == 24576.0 + 24576.0
        assert snap.used_memory_mb == 1200.0 + 800.0
        assert snap.utilization_percent == round((45 + 30) / 2.0, 1)
        assert snap.temperature_c == 60.0

    def test_collect_per_gpu_used_memory(self):
        side = _mock_run_factory({
            "query-gpu=index,memory.used": "0, 3391\n1, 512\n",
        })
        with patch("pmeow.collector.gpu.subprocess.run", side_effect=side):
            used = collect_per_gpu_used_memory()
        assert used == {0: 3391.0, 1: 512.0}


# ---------------------------------------------------------------------------
# Test: per-process parsing
# ---------------------------------------------------------------------------


class TestPerProcessParsing:
    UUID_CSV = "GPU-aaa-111, 0\nGPU-bbb-222, 1\n"
    PROC_CSV = "1234, GPU-aaa-111, 2048\n5678, GPU-bbb-222, 4096\n"

    def test_process_list(self):
        side = _mock_run_factory({
            "query-gpu=uuid": self.UUID_CSV,
            "query-compute-apps": self.PROC_CSV,
        })
        with patch("pmeow.collector.gpu.subprocess.run", side_effect=side):
            procs = collect_gpu_processes()
        assert len(procs) == 2
        assert procs[0].pid == 1234
        assert procs[0].gpu_index == 0
        assert procs[0].used_memory_mb == 2048.0
        assert procs[1].pid == 5678
        assert procs[1].gpu_index == 1
        assert procs[1].used_memory_mb == 4096.0

    def test_na_memory_falls_back_to_zero(self):
        """WSL2 / vGPU environments report [N/A] for per-process memory."""
        na_csv = "1234, GPU-aaa-111, [N/A]\n5678, GPU-bbb-222, 4096\n"
        side = _mock_run_factory({
            "query-gpu=uuid": self.UUID_CSV,
            "query-compute-apps": na_csv,
        })
        with patch("pmeow.collector.gpu.subprocess.run", side_effect=side):
            procs = collect_gpu_processes()
        assert len(procs) == 2
        # N/A process still collected with 0 memory
        assert procs[0].pid == 1234
        assert procs[0].used_memory_mb == 0.0
        # Normal process unaffected
        assert procs[1].pid == 5678
        assert procs[1].used_memory_mb == 4096.0

    def test_all_na_memory(self):
        """All processes report [N/A] – all should still be collected."""
        all_na = "1234, GPU-aaa-111, [N/A]\n5678, GPU-bbb-222, [N/A]\n"
        side = _mock_run_factory({
            "query-gpu=uuid": self.UUID_CSV,
            "query-compute-apps": all_na,
        })
        with patch("pmeow.collector.gpu.subprocess.run", side_effect=side):
            procs = collect_gpu_processes()
        assert len(procs) == 2
        assert all(p.used_memory_mb == 0.0 for p in procs)


# ---------------------------------------------------------------------------
# Test: attribution – PMEOW task
# ---------------------------------------------------------------------------


class TestAttributionPmeowTask:
    def test_matching_pid(self):
        task = _make_task("task-1", pid=1234, vram=8000)
        proc = GpuProcessInfo(pid=1234, gpu_index=0, used_memory_mb=6500.0, process_name="")
        summary = attribute_gpu_processes(
            gpu_processes=[proc],
            running_tasks=[task],
            per_gpu_memory={0: 24000.0},
        )
        assert len(summary.per_gpu) == 1
        alloc = summary.per_gpu[0].pmeow_tasks[0]
        assert isinstance(alloc, GpuTaskAllocation)
        assert alloc.task_id == "task-1"
        assert alloc.declared_vram_mb == 8000
        assert alloc.actual_vram_mb == 6500.0


# ---------------------------------------------------------------------------
# Test: attribution – user process (/proc readable)
# ---------------------------------------------------------------------------


class TestAttributionUserProcess:
    def test_proc_readable(self):
        proc = GpuProcessInfo(pid=9999, gpu_index=0, used_memory_mb=3000.0, process_name="")
        status_content = "Name:\tpython\nUid:\t1000\t1000\t1000\t1000\n"
        cmdline_content = b"python\x00train.py\x00--lr=0.01"

        import builtins

        real_open = builtins.open

        def _fake_open(path, *args, **kwargs):
            if path == "/proc/9999/status":
                return mock_open(read_data=status_content)()
            if path == "/proc/9999/cmdline":
                m = MagicMock()
                m.__enter__ = lambda s: s
                m.__exit__ = MagicMock(return_value=False)
                m.read = MagicMock(return_value=cmdline_content)
                return m
            return real_open(path, *args, **kwargs)

        with patch("pmeow.collector.gpu_attribution.pwd.getpwuid") as mock_pw:
            mock_pw.return_value = MagicMock(pw_name="testuser")
            with patch("builtins.open", side_effect=_fake_open):
                summary = attribute_gpu_processes(
                    gpu_processes=[proc],
                    running_tasks=[],
                    per_gpu_memory={0: 24000.0},
                )
        assert len(summary.per_gpu[0].user_processes) == 1
        up = summary.per_gpu[0].user_processes[0]
        assert isinstance(up, GpuUserProcess)
        assert up.user == "testuser"
        assert up.used_memory_mb == 3000.0
        assert "train.py" in up.command

        assert len(summary.by_user) == 1
        assert summary.by_user[0].user == "testuser"


# ---------------------------------------------------------------------------
# Test: attribution – unknown process (/proc not readable)
# ---------------------------------------------------------------------------


class TestAttributionUnknownProcess:
    def test_proc_not_readable(self):
        proc = GpuProcessInfo(pid=7777, gpu_index=1, used_memory_mb=512.0, process_name="")

        with patch("builtins.open", side_effect=OSError("Permission denied")):
            summary = attribute_gpu_processes(
                gpu_processes=[proc],
                running_tasks=[],
                per_gpu_memory={1: 24000.0},
            )
        assert len(summary.per_gpu[0].unknown_processes) == 1
        unk = summary.per_gpu[0].unknown_processes[0]
        assert isinstance(unk, GpuUnknownProcess)
        assert unk.pid == 7777
        assert unk.used_memory_mb == 512.0

    def test_preserves_used_memory_without_visible_processes(self):
        summary = attribute_gpu_processes(
            gpu_processes=[],
            running_tasks=[],
            per_gpu_memory={0: 16384.0},
            per_gpu_used_memory={0: 3391.0},
        )
        assert len(summary.per_gpu) == 1
        gpu = summary.per_gpu[0]
        assert gpu.gpu_index == 0
        assert gpu.used_memory_mb == 3391.0
        assert gpu.effective_free_mb == 16384.0


# ---------------------------------------------------------------------------
# Test: effective free memory calculation
# ---------------------------------------------------------------------------


class TestEffectiveFreeMemory:
    def test_known_values(self):
        """GPU 24000 MB, PMEOW declares 8000, user actual 4000, coeff 0.1
        expected = 24000 - 8000 - 4000*1.1 = 11600
        """
        pmeow = [GpuTaskAllocation(task_id="t1", gpu_index=0,
                                    declared_vram_mb=8000, actual_vram_mb=6000.0)]
        user = [GpuUserProcess(pid=100, user="bob", gpu_index=0,
                               used_memory_mb=4000.0, command="train")]
        unknown: list[GpuUnknownProcess] = []

        result = calculate_effective_free(
            total_memory_mb=24000.0,
            pmeow_tasks=pmeow,
            user_processes=user,
            unknown_processes=unknown,
            redundancy_coefficient=0.1,
        )
        assert result == pytest.approx(11600.0)

    def test_clamp_to_zero(self):
        pmeow = [GpuTaskAllocation(task_id="t1", gpu_index=0,
                                    declared_vram_mb=20000, actual_vram_mb=18000.0)]
        user = [GpuUserProcess(pid=100, user="bob", gpu_index=0,
                               used_memory_mb=8000.0, command="x")]
        result = calculate_effective_free(24000.0, pmeow, user, [], 0.1)
        # 24000 - 20000 - 8000*1.1 = -4800 → clamped to 0
        assert result == 0.0

    def test_unknown_processes_included(self):
        unknown = [GpuUnknownProcess(pid=1, gpu_index=0, used_memory_mb=2000.0)]
        result = calculate_effective_free(24000.0, [], [], unknown, 0.1)
        # 24000 - 0 - 2000*1.1 = 21800
        assert result == pytest.approx(21800.0)
