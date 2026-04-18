import { pnpmCommand, runWorkspaceScript, spawnCommand, waitForManagedChildren } from './process-utils.mjs';

export async function runBuildWeb() {
  await runWorkspaceScript('@monitor/server-contracts', 'build');
  await runWorkspaceScript('@monitor/app-common', 'build');
  await runWorkspaceScript('@monitor/core', 'build');
  await runWorkspaceScript('@monitor/web', 'build');
  await runWorkspaceScript('@monitor/ui', 'build');
}

export async function runCheckWeb() {
  await runBuildWeb();
  await runWorkspaceScript('@monitor/ui', 'typecheck');
  await runWorkspaceScript('@monitor/web', 'typecheck');
  await runWorkspaceScript('@monitor/core', 'test');
  await runWorkspaceScript('@monitor/web', 'test');
}

export async function runDevWeb() {
  await runWorkspaceScript('@monitor/server-contracts', 'build');
  await runWorkspaceScript('@monitor/app-common', 'build');
  await runWorkspaceScript('@monitor/core', 'build');

  const children = [
    spawnCommand(pnpmCommand, ['--filter', '@monitor/server-contracts', 'run', 'dev']),
    spawnCommand(pnpmCommand, ['--filter', '@monitor/app-common', 'run', 'dev']),
    spawnCommand(pnpmCommand, ['--filter', '@monitor/core', 'run', 'dev']),
    spawnCommand(pnpmCommand, ['--filter', '@monitor/web', 'run', 'dev']),
    spawnCommand(pnpmCommand, ['--filter', '@monitor/ui', 'run', 'dev']),
  ];

  await waitForManagedChildren(children, 'dev:web worker');
}