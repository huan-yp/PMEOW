from __future__ import annotations

import logging
import sys
from pathlib import Path


LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


def configure_runtime_logging(
    *,
    log_to_console: bool,
    log_file: str | None = None,
    level: int = logging.INFO,
) -> None:
    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)
        handler.close()

    root.setLevel(level)

    if log_to_console:
        handler = logging.StreamHandler(sys.stdout)
    else:
        if not log_file:
            raise ValueError("log_file is required when log_to_console is False")
        Path(log_file).parent.mkdir(parents=True, exist_ok=True)
        handler = logging.FileHandler(log_file)

    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    handler.setLevel(level)
    root.addHandler(handler)
