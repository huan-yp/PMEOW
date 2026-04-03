# pmeow-agent

Standalone Python agent for PMEOW GPU cluster monitoring. It runs on compute nodes, collects local metrics, tracks GPU ownership, maintains a local task queue, and connects back to the PMEOW Web service over Socket.IO.

## Requirements

- Python 3.10+
- Linux (uses `/proc` for metric collection)
- Optional: NVIDIA GPUs with `nvidia-smi` for GPU metrics

## Installation

### From PyPI

```bash
pip install pmeow-agent
```

### From source (development)

```bash
cd agent/
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
```

## Usage

### Run in the foreground

```bash
pmeow-agent run
# compatibility alias
pmeow-agent daemon
```

Foreground mode prints agent runtime logs to the console.

### Run in the background

```bash
export PMEOW_AGENT_LOG_FILE=~/.pmeow/agent.log
pmeow-agent start
pmeow-agent is-running
pmeow-agent stop
```

Background mode writes agent runtime logs to `PMEOW_AGENT_LOG_FILE` and keeps task stdout or stderr in `PMEOW_LOG_DIR`.

### Install as a systemd service

```bash
sudo pmeow-agent install-service --enable --start
sudo pmeow-agent uninstall-service
```

Systemd supervision keeps the process in the foreground and captures runtime logs in journal.

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

### Run an attached Python task

```bash
pmeow -vram=10g -gpus=2 --report train.py --epochs 50
```

Rules:

- Tokens before the first `.py` path are interpreted as PMEOW flags (`-vram`, `-gpus`, `--priority`, `--report`)
- Tokens after the script path are passed to Python unchanged
- `--report` prints queue attempts and the current GPU occupancy summary until the task starts
- Once GPUs are reserved, the same terminal becomes the Python process stdin, stdout, and stderr

### Sample scheduling tasks

PyTorch sample tasks are optional. Install a `torch` build yourself before using them. `pmeow-agent` does not declare `torch` as a default dependency.

```bash
pmeow -vram=8g -gpus=1 examples/tasks/pytorch_hold.py --gpus 1 --mem-per-gpu 7g --seconds 60
pmeow -vram=12g -gpus=2 --report examples/tasks/pytorch_stagger.py --memories 5g,11g --seconds 90
pmeow -vram=6g -gpus=1 examples/tasks/pytorch_chatty.py --gpus 1 --mem-per-gpu 4g --seconds 45 --interval 5
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
| `PMEOW_PID_FILE` | `~/.pmeow/pmeow-agent.pid` | Pid file used by background mode |
| `PMEOW_AGENT_LOG_FILE` | *(empty)* | Dedicated runtime log file used by background mode |

`PMEOW_SERVER_URL` should point at the PMEOW Web service base URL. The agent transport layer will connect to the Socket.IO `/agent` namespace automatically; do not append `/agent` yourself and do not use a raw WebSocket URL.

## State directory

By default, all agent state is stored under `~/.pmeow/`:

```
~/.pmeow/
├── pmeow.db        # SQLite database (tasks, runtime state)
├── pmeow.sock      # Unix domain socket (daemon control)
├── pmeow-agent.pid # Pid file (background mode only)
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
