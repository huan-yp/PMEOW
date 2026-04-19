import { pnpmCommand, runWorkspaceScript, spawnCommand, waitForManagedChildren } from './process-utils.mjs';

export async function runBuildWeb() {
  await runWorkspaceScript('@pmeow/server-contracts', 'build');
  await runWorkspaceScript('@pmeow/app-common', 'build');
  await runWorkspaceScript('@pmeow/core', 'build');
  await runWorkspaceScript('@pmeow/web', 'build');
  await runWorkspaceScript('@pmeow/ui', 'build');
}

export async function runCheckWeb() {
  await runBuildWeb();
  await runWorkspaceScript('@pmeow/ui', 'typecheck');
  await runWorkspaceScript('@pmeow/web', 'typecheck');
  await runWorkspaceScript('@pmeow/core', 'test');
  await runWorkspaceScript('@pmeow/web', 'test');
}

export async function runDevWeb() {
  await runWorkspaceScript('@pmeow/server-contracts', 'build');
  await runWorkspaceScript('@pmeow/app-common', 'build');
  await runWorkspaceScript('@pmeow/core', 'build');

  const children = [
    spawnCommand(pnpmCommand, ['--filter', '@pmeow/server-contracts', 'run', 'dev']),
    spawnCommand(pnpmCommand, ['--filter', '@pmeow/app-common', 'run', 'dev']),
    spawnCommand(pnpmCommand, ['--filter', '@pmeow/core', 'run', 'dev']),
    spawnCommand(pnpmCommand, ['--filter', '@pmeow/web', 'run', 'dev']),
    spawnCommand(pnpmCommand, ['--filter', '@pmeow/ui', 'run', 'dev']),
  ];

  await waitForManagedChildren(children, 'dev:web worker');
}