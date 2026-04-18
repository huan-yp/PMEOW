import { spawn } from 'node:child_process';
import process from 'node:process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function spawnCommand(args, options = {}) {
  return spawn(npmCommand, args, {
    stdio: 'inherit',
    env: process.env,
    cwd: process.cwd(),
    shell: process.platform === 'win32',
    ...options,
  });
}

function runCommand(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(args, options);

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Command exited due to signal ${signal}: ${args.join(' ')}`));
        return;
      }

      if ((code ?? 1) !== 0) {
        reject(new Error(`Command failed with exit code ${code ?? 1}: ${args.join(' ')}`));
        return;
      }

      resolve();
    });
  });
}

function runWorkspaceScript(workspaceName, scriptName) {
  return runCommand(['run', scriptName, `--workspace=${workspaceName}`]);
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

async function runCheckMobile() {
  await runWorkspaceScript('@monitor/server-contracts', 'build');
  await runWorkspaceScript('@monitor/app-common', 'build');
  await runWorkspaceScript('@monitor/mobile', 'typecheck');
}

async function runDevMobile() {
  await runWorkspaceScript('@monitor/server-contracts', 'build');
  await runWorkspaceScript('@monitor/app-common', 'build');
  await runWorkspaceScript('@monitor/mobile', 'start');
}

async function runMobileAndroid() {
  await runWorkspaceScript('@monitor/server-contracts', 'build');
  await runWorkspaceScript('@monitor/app-common', 'build');
  await runWorkspaceScript('@monitor/mobile', 'android');
}

async function runBuildMobileApk() {
  await runWorkspaceScript('@monitor/server-contracts', 'build');
  await runWorkspaceScript('@monitor/app-common', 'build');
  await runWorkspaceScript('@monitor/mobile', 'apk:debug');
}

async function runDevWeb() {
  await runWorkspaceScript('@monitor/server-contracts', 'build');
  await runWorkspaceScript('@monitor/app-common', 'build');
  await runWorkspaceScript('@monitor/core', 'build');

  const runtimeChild = spawnCommand(['run', 'dev', '--workspace=@monitor/web']);
  const uiChild = spawnCommand(['run', 'dev', '--workspace=@monitor/ui']);
  const children = [runtimeChild, uiChild];
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
  case 'run:mobile:android':
    await runMobileAndroid();
    break;
  case 'build:mobile:apk':
    await runBuildMobileApk();
    break;
  case 'check:web':
    await runCheckWeb();
    break;
  case 'check:mobile':
    await runCheckMobile();
    break;
  case 'dev:mobile':
    await runDevMobile();
    break;
  case 'dev:web':
    await runDevWeb();
    break;
  default:
    throw new Error(`Unknown workspace task: ${taskName ?? '(missing)'}`);
}