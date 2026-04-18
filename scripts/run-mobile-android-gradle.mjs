import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const androidDir = resolve(here, '..', 'apps', 'mobile', 'android');
const gradleExecutable = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const gradleArgs = process.argv.slice(2);

const result = spawnSync(gradleExecutable, gradleArgs.length > 0 ? gradleArgs : ['assembleDebug'], {
  cwd: androidDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);