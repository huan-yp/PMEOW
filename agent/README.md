# pmeow-agent

Standalone Python agent for PMEOW GPU cluster monitoring. Runs on compute nodes to collect metrics, track GPU ownership, and maintain a local task queue.

## Quick Start

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
pmeow-agent status
```

## Development

```bash
pip install -e ".[dev]"
pytest -v
```
