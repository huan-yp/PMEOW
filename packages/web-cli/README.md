# pmeow-web

PMEOW GPU cluster monitoring and scheduling web server.

## Installation

```bash
npm install -g pmeow-web
```

## Usage

```bash
# Start with defaults (port 17200)
pmeow-web

# Custom port
pmeow-web --port 8080

# Custom database path
pmeow-web --db /var/lib/pmeow/monitor.db
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `17200` | Server port |
| `MONITOR_DB_PATH` | `./data/monitor.db` | SQLite database path |
| `JWT_SECRET` | *(random)* | Secret for JWT signing (set for persistent sessions) |

## Documentation

See the [PMEOW repository](https://github.com/huan-yp/PMEOW) for full documentation.
