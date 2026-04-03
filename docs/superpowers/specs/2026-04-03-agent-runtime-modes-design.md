# Agent Runtime Modes Design

Date: 2026-04-03

## Summary

This design adds three supported agent runtime modes:

- Foreground mode for interactive debugging with agent logs printed to the console
- Background mode managed by the CLI with pid-file based lifecycle control and agent logs written to a dedicated file
- Systemd service mode with CLI-assisted install and uninstall flows, where systemd supervises a foreground agent process and logs flow to journal

All three modes must share one daemon runtime core. The difference between them is process supervision and log sink selection, not task queue behavior or collector behavior.

## Goals

- Provide an official foreground startup path that prints agent runtime logs to the console
- Provide an official background startup path implemented by the agent CLI itself
- Provide start, stop, restart, and is-running controls for background mode
- Provide install-service and uninstall-service commands for systemd deployment
- Keep task stdout and stderr logs separate from agent runtime logs
- Preserve the existing local control plane for status, submit, logs, cancel, pause, and resume

## Non-Goals

- Supporting non-systemd service managers in v1
- Adding log rotation in v1
- Replacing the task log storage model
- Running a self-daemonized process under systemd supervision

## Current State

- The current CLI in agent/pmeow/__main__.py exposes daemon, status, logs, submit, cancel, pause, and resume
- The current daemon runtime in agent/pmeow/daemon/service.py already contains the main collection, scheduling, and execution loop
- Task logs are already stored under PMEOW_LOG_DIR via agent/pmeow/executor/logs.py
- Agent runtime logging currently uses module loggers without a shared logging initialization layer
- The existing systemd example in agent/examples/pmeow-agent.service directly starts the foreground daemon process

## Design Decisions

### 1. CLI Command Model

The CLI will be split into two responsibility groups.

Runtime control commands:

- run
- start
- stop
- restart
- is-running
- install-service
- uninstall-service

Queue and task control commands:

- status
- submit
- logs
- cancel
- pause
- resume

The runtime control commands decide how the agent process is supervised. The queue and task control commands continue to talk to the daemon over the local Unix socket and do not care whether the daemon was started in foreground mode, background mode, or by systemd.

Backward compatibility:

- The existing daemon command remains as a compatibility alias for run during the migration period
- Existing scripts using pmeow-agent daemon continue to work, but documentation moves to run as the preferred foreground entrypoint

### 2. Shared Runtime Core

All startup modes must instantiate the same runtime service and perform the same config validation before the main loop begins.

Mode-specific behavior is limited to:

- pid file lifecycle
- stdio detachment or retention
- log sink selection
- systemd unit generation and installation

The daemon main loop, socket server, collectors, scheduler, executor, and server transport remain shared across all modes.

### 3. Logging Model

Agent runtime logs and task execution logs remain separate.

Task logs:

- PMEOW_LOG_DIR remains the task stdout and stderr directory only
- No agent runtime logs are written into the task log directory by default

Agent runtime logs:

- Add a new config source named PMEOW_AGENT_LOG_FILE
- Add a CLI override such as --agent-log-file for commands that need it
- Precedence is CLI argument, then environment variable, then mode default

Log sink rules:

- run writes agent runtime logs to the console
- start requires a resolved agent log file path and writes agent runtime logs to that file
- systemd service mode writes agent runtime logs to journal by default through the foreground run path

Logging initialization:

- Introduce one shared logging setup module for the agent package
- All runtime code paths must use the same timestamped format with level, logger name, and message
- The logging setup must happen before daemon startup so early configuration failures are also visible in the selected sink

### 4. Path Model

The runtime design keeps three independent path categories.

State path group:

- PMEOW_STATE_DIR remains the base directory for local runtime state
- Add PMEOW_PID_FILE with a default of a pid file inside the state directory

Task log path group:

- PMEOW_LOG_DIR remains dedicated to task output logs

Agent runtime log path group:

- PMEOW_AGENT_LOG_FILE points to the dedicated agent runtime log file used by background mode

This separation avoids mixing daemon lifecycle diagnostics with task output and reduces ambiguity during incident debugging.

### 5. Background Mode Behavior

Background mode is implemented by the CLI itself.

start:

- Validates configuration, writable paths, and pid-file state before daemonizing
- Refuses to start when the pid file points at a live agent process
- Cleans up a stale pid file and continues when the pid file is no longer valid
- Detaches the child process and records the child pid in PMEOW_PID_FILE

stop:

- Reads the pid file
- Sends a termination signal to the background agent process
- Waits for process exit within a bounded timeout
- Removes the pid file when shutdown completes

restart:

- Performs stop followed by start

is-running:

- Reads the pid file
- Verifies that the process still exists
- Returns a clear non-zero exit status when the pid file is stale or the process is gone

Background mode is intended for machines where the operator wants the agent to stay running without holding a terminal open, but does not want to deploy a system service.

### 6. Systemd Service Model

Systemd supervision must use the foreground runtime path rather than the self-daemonizing background path.

install-service:

- Targets system-level systemd by default
- Writes a unit file to /etc/systemd/system/pmeow-agent.service by default
- Writes a dedicated environment file to /etc/pmeow-agent/pmeow-agent.env by default
- Resolves the current pmeow-agent executable path and uses run in ExecStart
- Runs systemctl daemon-reload after writing the unit file
- May optionally enable and start the service, but service supervision is always delegated to systemd

Recommended unit characteristics:

- Type=simple
- Restart=on-failure
- RestartSec=10
- EnvironmentFile points to the generated environment file
- Logging goes to journal

uninstall-service:

- Stops the service if it exists
- Disables the service if it is enabled
- Removes the managed unit file
- Runs systemctl daemon-reload after removal
- Leaves the environment file in place by default to avoid destroying operator-managed configuration

Boundary rule:

- systemd mode always uses run
- start and stop are only for non-systemd background operation

### 7. Error Handling and Idempotency

Validation must happen before foreground startup, background daemonization, or service installation performs irreversible actions.

Runtime validation failures:

- Invalid intervals or invalid config values fail fast
- Missing or unwritable agent log file path causes start to fail before daemonization
- Missing or unwritable state directory causes startup to fail before daemonization
- Unusable socket path causes startup to fail before daemonization

Pid-file rules:

- A live pid file is treated as an already-running instance and blocks start
- A stale pid file is cleaned automatically

Service installation failures:

- Missing systemd tooling fails with a clear message
- Missing permissions to write system paths fails with a clear message
- Failure to resolve the installed executable path fails before files are written

Idempotency expectations:

- Re-running install-service updates the managed unit file and environment file deterministically
- Re-running uninstall-service on an already-removed service reports a no-op outcome rather than a hard failure

### 8. Testing Strategy

Unit tests:

- CLI parsing for new runtime control commands
- Logging setup behavior for console and file sinks
- Pid-file validation and stale-pid cleanup
- Systemd unit rendering and environment-file rendering

Integration tests:

- run prints runtime logs to the console
- start detaches successfully, writes a pid file, and writes runtime logs to the configured agent log file
- stop and restart manage the pid lifecycle correctly
- Existing queue control commands continue to work against a background or service-managed daemon through the Unix socket

Documentation updates:

- agent/README.md
- docs/user/agent-nodes.md
- docs/developer/local-development.md
- The existing service example in agent/examples/pmeow-agent.service

## User Experience Summary

The intended operator experience is:

- Use run when actively watching agent logs in a terminal
- Use start when a local background process is enough and the operator wants runtime logs in a dedicated file
- Use install-service for long-running managed deployments where systemd should supervise the process and journal should capture runtime logs

This keeps one runtime core, three supervision modes, and two clearly separated logging domains.