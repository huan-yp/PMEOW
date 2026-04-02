import { createWebRuntime } from './app.js';

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
  console.log(`[monitor] Web server running at http://localhost:${port}`);
} catch (error) {
  console.error('[monitor] Failed to start web server:', error);
  await runtime.stop().catch(() => {});
  process.exit(1);
}
