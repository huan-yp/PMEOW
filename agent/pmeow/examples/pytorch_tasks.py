"""Optional PyTorch sample tasks — torch is loaded at runtime, not imported at module level."""

from __future__ import annotations

import argparse
import importlib
import sys
import time


def parse_memories_mb(value: str) -> list[int]:
    """Parse comma-separated memory sizes like '2g,3072' to a list of MB ints."""
    result: list[int] = []
    for item in value.split(","):
        raw = item.strip().lower()
        if raw.endswith("g"):
            result.append(int(float(raw[:-1]) * 1024))
        elif raw.endswith("m"):
            result.append(int(float(raw[:-1])))
        else:
            result.append(int(float(raw)))
    return result


def load_torch_or_exit():
    """Import torch or exit with guidance if missing."""
    try:
        return importlib.import_module("torch")
    except ModuleNotFoundError as exc:
        print(
            "PyTorch sample tasks are optional. Install a torch build yourself that matches your CUDA runtime before running these examples.",
            file=sys.stderr,
        )
        raise SystemExit(2) from exc


def _allocate(torch, memories_mb: list[int]) -> list[object]:
    if torch.cuda.device_count() < len(memories_mb):
        raise SystemExit(f"expected at least {len(memories_mb)} visible GPU(s), found {torch.cuda.device_count()}")
    buffers: list[object] = []
    for index, mem_mb in enumerate(memories_mb):
        torch.cuda.set_device(index)
        buffers.append(torch.empty(mem_mb * 1024 * 1024, dtype=torch.uint8, device=f"cuda:{index}"))
    return buffers


def main_hold(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Hold the same amount of VRAM on each visible GPU")
    parser.add_argument("--gpus", type=int, required=True)
    parser.add_argument("--mem-per-gpu", default="1g")
    parser.add_argument("--seconds", type=int, default=60)
    parser.add_argument("--interval", type=int, default=5)
    args = parser.parse_args(argv)

    torch = load_torch_or_exit()
    memories_mb = [parse_memories_mb(args.mem_per_gpu)[0]] * args.gpus
    _allocate(torch, memories_mb)
    for remaining in range(args.seconds, 0, -args.interval):
        print(f"holding {args.gpus} gpu(s); remaining={remaining}s")
        time.sleep(min(args.interval, remaining))
    return 0


def main_stagger(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Hold different amounts of VRAM on visible GPUs")
    parser.add_argument("--memories", required=True, help="Comma-separated per-GPU sizes such as 2g,4g")
    parser.add_argument("--seconds", type=int, default=60)
    args = parser.parse_args(argv)

    torch = load_torch_or_exit()
    memories_mb = parse_memories_mb(args.memories)
    _allocate(torch, memories_mb)
    print(f"allocated memories_mb={memories_mb}")
    time.sleep(args.seconds)
    return 0


def main_chatty(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Hold VRAM and print heartbeat lines while running")
    parser.add_argument("--gpus", type=int, required=True)
    parser.add_argument("--mem-per-gpu", default="1g")
    parser.add_argument("--seconds", type=int, default=60)
    parser.add_argument("--interval", type=int, default=5)
    args = parser.parse_args(argv)

    torch = load_torch_or_exit()
    memories_mb = [parse_memories_mb(args.mem_per_gpu)[0]] * args.gpus
    _allocate(torch, memories_mb)
    elapsed = 0
    while elapsed < args.seconds:
        print(f"chatty heartbeat elapsed={elapsed}s visible_gpus={args.gpus}")
        time.sleep(args.interval)
        elapsed += args.interval
    return 0
