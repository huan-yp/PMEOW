from __future__ import annotations

import argparse
import sys
import time


def _parse_mem_mb(value: str) -> int:
    raw = value.strip().lower()
    if raw.endswith("g"):
        return int(float(raw[:-1]) * 1024)
    if raw.endswith("m"):
        return int(float(raw[:-1]))
    return int(float(raw))


def _load_torch():
    try:
        import torch
    except ModuleNotFoundError as exc:
        print("torch is required for this standalone example", file=sys.stderr)
        raise SystemExit(2) from exc
    return torch


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Hold VRAM on visible GPUs without requiring pmeow installation")
    parser.add_argument("--gpus", type=int, default=1)
    parser.add_argument("--mem-per-gpu", default="1g")
    parser.add_argument("--seconds", type=int, default=60)
    parser.add_argument("--interval", type=int, default=5)
    args = parser.parse_args(argv)

    torch = _load_torch()
    mem_mb = _parse_mem_mb(args.mem_per_gpu)

    if torch.cuda.device_count() < args.gpus:
        raise SystemExit(f"expected at least {args.gpus} visible GPU(s), found {torch.cuda.device_count()}")

    buffers = []
    for index in range(args.gpus):
        torch.cuda.set_device(index)
        buffers.append(torch.empty(mem_mb * 1024 * 1024, dtype=torch.uint8, device=f"cuda:{index}"))

    for remaining in range(args.seconds, 0, -args.interval):
        print(f"holding {args.gpus} gpu(s) at {mem_mb}MB each; remaining={remaining}s")
        time.sleep(min(args.interval, remaining))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())