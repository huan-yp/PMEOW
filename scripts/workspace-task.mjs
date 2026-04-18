import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function getJavaEnv() {
  const configPath = path.join(repoRoot, '.java-home.local');
  if (!existsSync(configPath)) {
    return { ...process.env };
  }

  const raw = readFileSync(configPath, 'utf8').trim();
  const javaHome = raw.replace(/^JAVA_HOME\s*=\s*/u, '').replace(/^["']|["']$/gu, '');
  if (!javaHome || !existsSync(javaHome)) {
    return { ...process.env };
  }

  const javaBin = path.join(javaHome, 'bin');
  const currentPath = process.env.PATH ?? process.env.Path ?? '';
  return {
    ...process.env,
    JAVA_HOME: javaHome,
    PATH: currentPath ? `${javaBin}${path.delimiter}${currentPath}` : javaBin,
    Path: currentPath ? `${javaBin}${path.delimiter}${currentPath}` : javaBin,
  };
}

function spawnCommand(command, args, options = {}) {
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

function runCommand(command, args, options = {}) {
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

function runWorkspaceScript(workspaceName, scriptName, options = {}) {
  return runCommand(pnpmCommand, ['--filter', workspaceName, 'run', scriptName], options);
}

async function runBuildWeb() {
  await runWorkspaceScript('@monitor/server-contracts', 'build');
  await runWorkspaceScript('@monitor/app-common', 'build');
  await runWorkspaceScript('@monitor/core', 'build');
  await runWorkspaceScript('@monitor/web', 'build');
  await runWorkspaceScript('@monitor/ui', 'build');
}

async function runCheckWeb() {
  await runBuildWeb();
  await runWorkspaceScript('@monitor/ui', 'typecheck');
  await runWorkspaceScript('@monitor/web', 'typecheck');
  await runWorkspaceScript('@monitor/core', 'test');
  await runWorkspaceScript('@monitor/web', 'test');
}

async function runBuildApk() {
  await runWorkspaceScript('@monitor/server-contracts', 'build');
  await runWorkspaceScript('@monitor/app-common', 'build');

  const androidDir = path.join(repoRoot, 'apps', 'mobile', 'android');
  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  await runCommand(gradlew, ['assembleRelease'], { cwd: androidDir, env: getJavaEnv() });
}

async function runDevWeb() {
  await runWorkspaceScript('@monitor/server-contracts', 'build');
  await runWorkspaceScript('@monitor/app-common', 'build');
  await runWorkspaceScript('@monitor/core', 'build');

  const contractsChild = spawnCommand(pnpmCommand, ['--filter', '@monitor/server-contracts', 'run', 'dev']);
  const commonChild = spawnCommand(pnpmCommand, ['--filter', '@monitor/app-common', 'run', 'dev']);
  const coreChild = spawnCommand(pnpmCommand, ['--filter', '@monitor/core', 'run', 'dev']);
  const runtimeChild = spawnCommand(pnpmCommand, ['--filter', '@monitor/web', 'run', 'dev']);
  const uiChild = spawnCommand(pnpmCommand, ['--filter', '@monitor/ui', 'run', 'dev']);
  const children = [contractsChild, commonChild, coreChild, runtimeChild, uiChild];
  let shuttingDown = false;

  const terminateChildren = (signal = 'SIGTERM') => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    for (const child of children) {
      if (!child.killed) {
        child.kill(signal);
      }
    }
  };

  process.on('SIGINT', () => terminateChildren('SIGINT'));
  process.on('SIGTERM', () => terminateChildren('SIGTERM'));

  await new Promise((resolve, reject) => {
    let settled = false;
    let remaining = children.length;

    const handleExit = (code, signal) => {
      remaining -= 1;

      if (!settled && (signal || (code ?? 0) !== 0)) {
        settled = true;
        terminateChildren(signal ?? 'SIGTERM');
        reject(new Error(`dev:web worker exited unexpectedly with ${signal ?? `code ${code ?? 1}`}`));
        return;
      }

      if (!settled && remaining === 0) {
        settled = true;
        resolve();
      }
    };

    for (const child of children) {
      child.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        terminateChildren();
        reject(error);
      });
      child.on('exit', handleExit);
    }
  });
}

const taskName = process.argv[2];

switch (taskName) {
  case 'build:web':
    await runBuildWeb();
    break;
  case 'check:web':
    await runCheckWeb();
    break;
  case 'dev:web':
    await runDevWeb();
    break;
  case 'build:apk':
    await runBuildApk();
    break;
  default:
    throw new Error(`Unknown workspace task: ${taskName ?? '(missing)'}`);
}
