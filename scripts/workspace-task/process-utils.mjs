import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, '..', '..');

export function spawnCommand(command, args, options = {}) {
  return spawn(command, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
    cwd: options.cwd ?? process.cwd(),
    shell: process.platform === 'win32',
    ...options,
  });
}

function pipeWithPrefix(stream, target, prefix) {
  if (!stream) {
    return;
  }

  let buffered = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/u);
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      target.write(`${prefix}${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buffered) {
      target.write(`${prefix}${buffered}\n`);
      buffered = '';
    }
  });
}

export function spawnManagedProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });

  if (options.prefix) {
    pipeWithPrefix(child.stdout, process.stdout, `${options.prefix} `);
    pipeWithPrefix(child.stderr, process.stderr, `${options.prefix} `);
  }

  return child;
}

export function waitForChildExit(child, name) {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${name} exited due to signal ${signal}`));
        return;
      }

      if ((code ?? 1) !== 0) {
        reject(new Error(`${name} exited with code ${code ?? 1}`));
        return;
      }

      resolve();
    });
  });
}

function waitForPort(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const attempt = () => {
      const socket = net.createConnection({ host, port });

      const retry = () => {
        socket.destroy();
        if (Date.now() - startTime >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(attempt, 500);
      };

      socket.once('connect', () => {
        socket.end();
        resolve();
      });
      socket.once('error', retry);
    };

    attempt();
  });
}

export function isPortOpen(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export function waitForProcessOrPort(child, name, host, port, timeoutMs) {
  return Promise.race([
    waitForPort(host, port, timeoutMs),
    waitForChildExit(child, name),
  ]);
}

export function terminateChild(child) {
  if (!child || child.killed) {
    return;
  }

  child.kill('SIGTERM');
}

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, options);

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Command exited due to signal ${signal}: ${command} ${args.join(' ')}`));
        return;
      }

      if ((code ?? 1) !== 0) {
        reject(new Error(`Command failed with exit code ${code ?? 1}: ${command} ${args.join(' ')}`));
        return;
      }

      resolve();
    });
  });
}

export function captureCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: {
        ...process.env,
        ...(options.env ?? {}),
      },
      shell: options.shell ?? process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Command exited due to signal ${signal}: ${command} ${args.join(' ')}`));
        return;
      }

      if ((code ?? 1) !== 0) {
        const stderrMessage = stderr.trim();
        reject(
          new Error(
            stderrMessage
              ? `Command failed with exit code ${code ?? 1}: ${command} ${args.join(' ')}\n${stderrMessage}`
              : `Command failed with exit code ${code ?? 1}: ${command} ${args.join(' ')}`
          )
        );
        return;
      }

      resolve(stdout.trim());
    });
  });
}

export function runWorkspaceScript(workspaceName, scriptName, options = {}) {
  return runCommand(pnpmCommand, ['--filter', workspaceName, 'run', scriptName], options);
}

export async function waitForManagedChildren(children, workerLabel = 'worker') {
  await new Promise((resolve, reject) => {
    let settled = false;
    let shuttingDown = false;

    const cleanup = () => {
      process.off('SIGINT', handleSignal);
      process.off('SIGTERM', handleSignal);
    };

    const terminateChildren = () => {
      if (shuttingDown) {
        return;
      }

      shuttingDown = true;
      for (const child of children) {
        terminateChild(child);
      }
    };

    const settle = (callback) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    const handleSignal = () => {
      terminateChildren();
      settle(resolve);
    };

    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);

    for (const child of children) {
      child.on('error', (error) => {
        terminateChildren();
        settle(() => reject(error));
      });

      child.on('exit', (code, signal) => {
        if (settled || shuttingDown) {
          return;
        }

        terminateChildren();
        if (signal || (code ?? 0) !== 0) {
          settle(() => reject(new Error(`${workerLabel} exited unexpectedly with ${signal ?? `code ${code ?? 1}`}`)));
          return;
        }

        settle(() => reject(new Error(`${workerLabel} exited unexpectedly`)));
      });
    }
  });
}