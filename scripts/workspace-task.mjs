import { runBuildApk, runDevMobile, runMobileLogsOnly } from './workspace-task/mobile-tasks.mjs';
import { runBuildWeb, runCheckWeb, runDevWeb } from './workspace-task/web-tasks.mjs';

const taskName = process.argv[2];

const taskHandlers = {
  'build:web': runBuildWeb,
  'check:web': runCheckWeb,
  'dev:web': runDevWeb,
  'dev:mobile': runDevMobile,
  'dev:mobile:logs': runMobileLogsOnly,
  'build:apk': runBuildApk,
};

const taskHandler = taskHandlers[taskName];

if (!taskHandler) {
  throw new Error(`Unknown workspace task: ${taskName ?? '(missing)'}`);
}

await taskHandler();
