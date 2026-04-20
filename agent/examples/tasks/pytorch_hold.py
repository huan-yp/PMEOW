from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_main_hold():
    try:
        from pmeow.examples.pytorch_tasks import main_hold as loaded_main_hold

        return loaded_main_hold
    except ModuleNotFoundError:
        module_path = Path(__file__).resolve().parents[2] / "pmeow" / "examples" / "pytorch_tasks.py"
        spec = importlib.util.spec_from_file_location("pmeow_source_pytorch_tasks", module_path)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"failed to load PyTorch task helpers from {module_path}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.main_hold


main_hold = _load_main_hold()

if __name__ == "__main__":
    raise SystemExit(main_hold())
