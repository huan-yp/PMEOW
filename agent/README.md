# pmeow-agent

Standalone Python agent for PMEOW GPU cluster monitoring. It runs on compute nodes, collects local metrics, tracks GPU ownership, maintains a local task queue, and connects back to the PMEOW Web service over Socket.IO.

## Requirements

- Python 3.10+
- Linux (uses `/proc` for metric collection)
- Optional: NVIDIA GPUs with `nvidia-smi` for GPU metrics

## Installation

```bash
cd agent/
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
```

## Usage

### Start the daemon

The daemon runs in the foreground, collecting metrics and processing the task queue:

```bash
pmeow-agent daemon
# or
python -m pmeow daemon
```

For production deployments, see [systemd service example](examples/pmeow-agent.service).

### Submit a task

```bash
pmeow-agent submit --pvram 4000 --gpu 1 -- python train.py
# or without GPU requirements
pmeow-agent submit --pvram 0 --gpu 0 -- bash run_preprocessing.sh
```

Options:
- `--pvram` — Required VRAM per GPU in MB (default: 0)
- `--gpu` — Number of GPUs required (default: 1)
- `--priority` — Priority level, lower runs first (default: 10)

### Check queue status

```bash
pmeow-agent status
```

Prints counts of queued, running, completed, failed, and cancelled tasks.

### View task logs

```bash
pmeow-agent logs <task_id>
pmeow-agent logs <task_id> --tail 50
```

### Cancel a task

```bash
pmeow-agent cancel <task_id>
```

### Pause / resume the queue

```bash
pmeow-agent pause
pmeow-agent resume
```

When paused, no new tasks are started. Running tasks continue to completion.

## Configuration

All settings are configured via environment variables. Defaults are used when a variable is not set.

| Variable | Default | Description |
|---|---|---|
| `PMEOW_SERVER_URL` | *(empty)* | PMEOW Web server base URL (e.g. `http://server:17200`) |
| `PMEOW_AGENT_ID` | hostname | Unique identifier for this agent |
| `PMEOW_COLLECTION_INTERVAL` | `5` | Seconds between metric collection cycles |
| `PMEOW_HEARTBEAT_INTERVAL` | `30` | Seconds between heartbeat reports to server |
| `PMEOW_HISTORY_WINDOW` | `120` | Seconds of GPU history kept for scheduling |
| `PMEOW_VRAM_REDUNDANCY` | `0.1` | VRAM safety margin (0.0–1.0) — fraction reserved beyond task requirements |
| `PMEOW_STATE_DIR` | `~/.pmeow/` | Directory for database and runtime state |
| `PMEOW_SOCKET_PATH` | `~/.pmeow/pmeow.sock` | Path to the Unix socket for CLI ↔ daemon communication |
| `PMEOW_LOG_DIR` | `~/.pmeow/logs/` | Directory where task stdout/stderr logs are stored |

`PMEOW_SERVER_URL` should point at the PMEOW Web service base URL. The agent transport layer will connect to the Socket.IO `/agent` namespace automatically; do not append `/agent` yourself and do not use a raw WebSocket URL.

## State directory

By default, all agent state is stored under `~/.pmeow/`:

```
~/.pmeow/
├── pmeow.db        # SQLite database (tasks, runtime state)
├── pmeow.sock      # Unix domain socket (daemon control)
└── logs/
    ├── <task_id>.log
    └── ...
```

## Development

```bash
pip install -e ".[dev]"
pytest -v
```

## Notes on server integration

- The agent sends `agent:register`, `agent:metrics`, `agent:taskUpdate`, and `agent:heartbeat` over Socket.IO.
- The server may send `server:cancelTask`, `server:pauseQueue`, `server:resumeQueue`, and `server:setPriority` back to the agent when the node is online.
- Server-side binding is hostname-based. Keep the Web server's `servers.host` value aligned with the node hostname if you want automatic binding.
