import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Metro = require('metro');
const { createDevServerMiddleware } = require('@react-native-community/cli-server-api');
const { createDevMiddleware } = require('@react-native/dev-middleware');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const mobileDir = path.join(repoRoot, 'apps', 'mobile');
const mobileMetroConfigPath = path.join(mobileDir, 'metro.config.cjs');
const mobileMetroPort = Number.parseInt(process.env.PMEOW_MOBILE_METRO_PORT ?? '8081', 10);
const mobileMetroHost = process.env.PMEOW_MOBILE_METRO_HOST ?? 'localhost';

process.chdir(repoRoot);

const config = await Metro.loadConfig({
  config: mobileMetroConfigPath,
  cwd: repoRoot,
  host: mobileMetroHost,
  port: mobileMetroPort,
});

const devServer = createDevServerMiddleware({
  host: mobileMetroHost,
  port: mobileMetroPort,
  watchFolders: config.watchFolders,
});

const rnDevMiddleware = createDevMiddleware({
  projectRoot: config.projectRoot,
  serverBaseUrl: `http://${mobileMetroHost}:${mobileMetroPort}`,
  logger: console,
});

const server = await Metro.runServer(config, {
  host: mobileMetroHost,
  websocketEndpoints: {
    ...devServer.websocketEndpoints,
    ...rnDevMiddleware.websocketEndpoints,
  },
  unstable_extraMiddleware: [devServer.middleware, rnDevMiddleware.middleware],
});

const shutdown = () => {
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);