import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  captureCommand,
  isPortOpen,
  repoRoot,
  runCommand,
  runWorkspaceScript,
  sleep,
  spawnManagedProcess,
  terminateChild,
  waitForChildExit,
  waitForProcessOrPort,
} from './process-utils.mjs';

const mobileDir = path.join(repoRoot, 'apps', 'mobile');
const mobileAndroidDir = path.join(mobileDir, 'android');
const mobilePackageName = 'com.pmeowmobile';
const mobileActivityName = `${mobilePackageName}/.MainActivity`;
const mobileMetroPort = Number.parseInt(process.env.PMEOW_MOBILE_METRO_PORT ?? '8081', 10);
const mobileServerPort = Number.parseInt(process.env.PORT ?? '17200', 10);
const mobileMetroConfigPath = path.join(mobileDir, 'metro.config.cjs');
const mobileLogcatPidPollIntervalMs = 1000;
const mobileMetroRestartGraceMs = 15000;
const mobileMetroRestartPollIntervalMs = 500;

function withPrependedPath(env, entries) {
  const currentPath = env.PATH ?? env.Path ?? '';
  const prefix = entries.filter(Boolean).join(path.delimiter);
  const nextPath = prefix ? (currentPath ? `${prefix}${path.delimiter}${currentPath}` : prefix) : currentPath;

  return {
    ...env,
    PATH: nextPath,
    Path: nextPath,
  };
}

function getAndroidSdkRoot() {
  const localPropertiesPath = path.join(mobileAndroidDir, 'local.properties');
  if (existsSync(localPropertiesPath)) {
    const lines = readFileSync(localPropertiesPath, 'utf8').split(/\r?\n/u);
    const sdkDirLine = lines.find((line) => line.startsWith('sdk.dir='));
    if (sdkDirLine) {
      const sdkRoot = sdkDirLine
        .slice('sdk.dir='.length)
        .trim()
        .replace(/\\:/gu, ':')
        .replace(/\\\\/gu, '\\');
      if (sdkRoot && existsSync(sdkRoot)) {
        return sdkRoot;
      }
    }
  }

  const candidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
      : null,
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function getAdbPath() {
  const sdkRoot = getAndroidSdkRoot();
  if (!sdkRoot) {
    throw new Error(
      'Android SDK root not found. Configure apps/mobile/android/local.properties, ANDROID_SDK_ROOT, or ANDROID_HOME before running mobile tasks.'
    );
  }

  const adb = path.join(sdkRoot, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  if (!existsSync(adb)) {
    throw new Error(`Android SDK adb not found: ${adb}`);
  }

  return adb;
}

function getMobileEnv() {
  const env = getJavaEnv();
  const sdkRoot = getAndroidSdkRoot();
  if (!sdkRoot) {
    return env;
  }

  const pathEntries = [
    path.join(sdkRoot, 'platform-tools'),
    path.join(sdkRoot, 'emulator'),
  ].filter((entry) => existsSync(entry));

  return withPrependedPath(
    {
      ...env,
      ANDROID_SDK_ROOT: sdkRoot,
      ANDROID_HOME: sdkRoot,
    },
    pathEntries,
  );
}

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

function startMetro() {
  return spawnManagedProcess(
    process.execPath,
    [
      path.join(repoRoot, 'scripts', 'mobile-metro-server.mjs'),
    ],
    {
      cwd: repoRoot,
      prefix: '[metro]',
    },
  );
}

function startMobileLogs(appPid) {
  return spawnManagedProcess(
    getAdbPath(),
    [
      'logcat',
      '--pid',
      String(appPid),
      '-v',
      'time',
      'ReactNative:V',
      'ReactNativeJS:V',
      'AndroidRuntime:E',
      'System.err:V',
      '*:S',
    ],
    {
      prefix: '[logcat]',
      env: getMobileEnv(),
    },
  );
}

async function getMobileAppPid() {
  try {
    const output = await captureCommand(getAdbPath(), ['shell', 'pidof', '-s', mobilePackageName], { env: getMobileEnv() });
    const pid = output.split(/\s+/u, 1)[0]?.trim() ?? '';
    return /^\d+$/u.test(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function waitForMobileAppPid(shouldStop) {
  let waitingAnnounced = false;

  while (!shouldStop()) {
    const pid = await getMobileAppPid();
    if (pid) {
      return pid;
    }

    if (!waitingAnnounced) {
      process.stdout.write(`[mobile] Waiting for ${mobilePackageName} process before attaching logcat...\n`);
      waitingAnnounced = true;
    }

    await sleep(mobileLogcatPidPollIntervalMs);
  }

  return null;
}

async function runAdbCommand(args, options = {}) {
  await runCommand(getAdbPath(), args, { ...options, env: { ...getMobileEnv(), ...(options.env ?? {}) } });
}

async function ensureAdbServer() {
  await runAdbCommand(['kill-server']);
  await runAdbCommand(['start-server']);
}

async function waitForDeviceOnline() {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await runAdbCommand(['wait-for-device']);
      const state = (await captureCommand(getAdbPath(), ['get-state'], { env: getMobileEnv() })).trim();
      if (state === 'device') {
        return;
      }
      throw new Error(`Device state is "${state}", expected "device"`);
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      process.stdout.write(`[mobile] Device not online (attempt ${attempt}/${maxAttempts}), restarting adb server...\n`);
      await ensureAdbServer();
      await sleep(2000);
    }
  }
}

async function ensureMetroReverse() {
  await ensureAdbServer();
  await waitForDeviceOnline();
  await runAdbCommand(['reverse', `tcp:${mobileMetroPort}`, `tcp:${mobileMetroPort}`]);
  await runAdbCommand(['reverse', `tcp:${mobileServerPort}`, `tcp:${mobileServerPort}`]);
}

async function installAndLaunchMobileDebugApp() {
  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const debugApkPath = path.join(mobileAndroidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

  await waitForDeviceOnline();
  await runCommand(gradlew, ['assembleDebug'], { cwd: mobileAndroidDir, env: getMobileEnv() });
  if (!existsSync(debugApkPath)) {
    throw new Error(`Debug APK not found after assembleDebug: ${debugApkPath}`);
  }
  await waitForDeviceOnline();
  await runAdbCommand(['install', '-r', debugApkPath]);
  await runAdbCommand(['reverse', `tcp:${mobileMetroPort}`, `tcp:${mobileMetroPort}`]);
  await runAdbCommand(['reverse', `tcp:${mobileServerPort}`, `tcp:${mobileServerPort}`]);
  await runAdbCommand(['shell', 'am', 'start', '-n', mobileActivityName]);
}

async function waitForPersistentLogcat(metroChild = null) {
  await new Promise((resolve, reject) => {
    let settled = false;
    let shuttingDown = false;
    let logcatChild = null;

    const cleanup = () => {
      process.off('SIGINT', handleSignal);
      process.off('SIGTERM', handleSignal);
    };

    const terminateChildren = () => {
      if (shuttingDown) {
        return;
      }

      shuttingDown = true;
      terminateChild(logcatChild);
      terminateChild(metroChild);
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

    const monitorMetro = () => {
      if (!metroChild) {
        return;
      }

      metroChild.on('error', (error) => {
        terminateChildren();
        settle(() => reject(error));
      });

      metroChild.on('exit', async (code, signal) => {
        if (settled || shuttingDown) {
          return;
        }

        const exitLabel = signal ?? `code ${code ?? 0}`;
        const graceDeadline = Date.now() + mobileMetroRestartGraceMs;

        while (!settled && !shuttingDown && Date.now() < graceDeadline) {
          const metroStillRunning = await isPortOpen('127.0.0.1', mobileMetroPort, 1000);
          if (metroStillRunning) {
            process.stdout.write(
              `[mobile] Metro process exited with ${exitLabel}, but port ${mobileMetroPort} recovered during restart. Continuing to stream logs.\n`
            );
            return;
          }

          await sleep(mobileMetroRestartPollIntervalMs);
        }

        process.stderr.write(
          `[mobile] Metro process exited with ${exitLabel} and port ${mobileMetroPort} did not recover within ${mobileMetroRestartGraceMs}ms. Log streaming will continue, but JS bundling and Fast Refresh are currently unavailable until Metro is started again.\n`
        );
      });
    };

    const startLoop = async () => {
      while (!settled && !shuttingDown) {
        const appPid = await waitForMobileAppPid(() => settled || shuttingDown);
        if (!appPid || settled || shuttingDown) {
          return;
        }

        process.stdout.write(`[mobile] Streaming logcat for ${mobilePackageName} (pid ${appPid}).\n`);

        let restartReason = null;
        let pidWatcherActive = false;
        const pidWatcher = setInterval(async () => {
          if (pidWatcherActive || settled || shuttingDown || !logcatChild) {
            return;
          }

          pidWatcherActive = true;

          try {
            const nextPid = await getMobileAppPid();

            if (settled || shuttingDown || !logcatChild || restartReason) {
              return;
            }

            if (!nextPid) {
              restartReason = `${mobilePackageName} process disappeared. Waiting for it to come back before reattaching logcat...`;
              terminateChild(logcatChild);
              return;
            }

            if (nextPid !== appPid) {
              restartReason = `${mobilePackageName} pid changed from ${appPid} to ${nextPid}. Reattaching logcat...`;
              terminateChild(logcatChild);
            }
          } finally {
            pidWatcherActive = false;
          }
        }, mobileLogcatPidPollIntervalMs);

        logcatChild = startMobileLogs(appPid);

        try {
          await waitForChildExit(logcatChild, 'logcat');
        } catch (error) {
          clearInterval(pidWatcher);
          logcatChild = null;

          if (settled || shuttingDown) {
            return;
          }

          if (restartReason) {
            process.stdout.write(`[mobile] ${restartReason}\n`);
            await sleep(200);
            continue;
          }

          process.stdout.write(`[mobile] Log stream disconnected (${error.message}). Restarting in 1s...\n`);
          await sleep(1000);
          continue;
        }

        clearInterval(pidWatcher);
        logcatChild = null;

        if (settled || shuttingDown) {
          return;
        }

        if (restartReason) {
          process.stdout.write(`[mobile] ${restartReason}\n`);
          await sleep(200);
          continue;
        }

        process.stdout.write('[mobile] Log stream ended. Restarting in 1s...\n');
        await sleep(1000);
      }
    };

    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);

    monitorMetro();
    startLoop().catch((error) => {
      terminateChildren();
      settle(() => reject(error));
    });
  });
}

export async function runBuildApk() {
  await runWorkspaceScript('@pmeow/server-contracts', 'build');
  await runWorkspaceScript('@pmeow/app-common', 'build');

  const releaseApkPath = path.join(mobileAndroidDir, 'app', 'build', 'outputs', 'apk', 'release', 'pmeow.apk');
  const releaseGeneratedAssetsDir = path.join(mobileAndroidDir, 'app', 'build', 'generated', 'assets', 'createBundleReleaseJsAndAssets');
  const releaseMergedAssetsDir = path.join(mobileAndroidDir, 'app', 'build', 'intermediates', 'assets', 'release');

  rmSync(releaseApkPath, { force: true });
  rmSync(releaseGeneratedAssetsDir, { recursive: true, force: true });
  rmSync(releaseMergedAssetsDir, { recursive: true, force: true });

  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  await runCommand(gradlew, ['assembleRelease'], { cwd: mobileAndroidDir, env: getJavaEnv() });

  if (!existsSync(releaseApkPath)) {
    throw new Error(`Release APK not found after assembleRelease: ${releaseApkPath}`);
  }

  process.stdout.write(`[mobile] Release APK built: ${releaseApkPath}\n`);
}

export async function runMobileLogsOnly() {
  await ensureAdbServer();
  await runAdbCommand(['wait-for-device']);
  await waitForPersistentLogcat();
}

export async function runDevMobile() {
  await runWorkspaceScript('@pmeow/server-contracts', 'build');
  await runWorkspaceScript('@pmeow/app-common', 'build');

  let usingExistingMetro = await isPortOpen('127.0.0.1', mobileMetroPort);
  let metroChild = usingExistingMetro ? null : startMetro();

  try {
    if (metroChild) {
      try {
        await waitForProcessOrPort(metroChild, 'metro', '127.0.0.1', mobileMetroPort, 30000);
      } catch (error) {
        const metroRecoveredOrClaimed = await isPortOpen('127.0.0.1', mobileMetroPort, 1000);
        if (!metroRecoveredOrClaimed) {
          throw error;
        }

        process.stdout.write(
          `[mobile] Metro port ${mobileMetroPort} was claimed while starting a new server. Reusing the existing Metro instance instead. JS logs will stay in the terminal that started it.\n`
        );
        metroChild = null;
        usingExistingMetro = true;
      }
    }

    if (usingExistingMetro) {
      process.stdout.write(`[mobile] Reusing existing Metro on port ${mobileMetroPort}. JS logs will stay in the terminal that started it.\n`);
    }

    await ensureMetroReverse();
    await installAndLaunchMobileDebugApp();
    process.stdout.write(`[mobile] Metro ready on port ${mobileMetroPort}, adb reverse is active, debug app installed, logs streaming. Fast Refresh now covers apps/mobile only.\n`);
    await waitForPersistentLogcat(metroChild);
  } catch (error) {
    terminateChild(metroChild);
    throw error;
  }
}
