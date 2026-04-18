import { createWebRuntime } from './app.js';

if (process.argv.includes('--debug-reports') && !process.env.PMEOW_WEB_DEBUG_REPORTS) {
  process.env.PMEOW_WEB_DEBUG_REPORTS = '1';
}

const runtime = createWebRuntime();
let shuttingDown = false;

const shutdown = async (): Promise<void> => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log('[monitor] Shutting down...');

  try {
    await runtime.stop();
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});

try {
  const port = await runtime.start();
  const address = runtime.httpServer.address();
  if (address && typeof address === 'object') {
    const localHost = address.address === '0.0.0.0' ? 'localhost' : address.address;
    const browserHost = localHost.includes(':') ? `[${localHost}]` : localHost;
    console.log(
      `[monitor] Web server listening on ${address.address}:${address.port} (local: http://${browserHost}:${address.port})`,
    );
  } else {
    console.log(`[monitor] Web server running on port ${port}`);
  }
} catch (error) {
  console.error('[monitor] Failed to start web server:', error);
  await runtime.stop().catch(() => {});
  process.exit(1);
}
