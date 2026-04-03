/**
 * Build script for pmeow-web distribution package.
 *
 * Prerequisites: packages/core, packages/ui, and packages/web must already be
 * built (run `pnpm build:web` from the monorepo root first).
 *
 * This script:
 * 1. Bundles packages/web/dist/server.js with esbuild, inlining @monitor/core
 *    and keeping npm dependencies external.
 * 2. Copies packages/ui/dist → dist/public so the UI is served at runtime.
 */

import * as esbuild from 'esbuild';
import { cpSync, rmSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');
const monorepoRoot = join(pkgRoot, '../..');

const webDist = join(monorepoRoot, 'packages/web/dist/server.js');
const coreDist = join(monorepoRoot, 'packages/core/dist/index.js');
const uiDist = join(monorepoRoot, 'packages/ui/dist');

// Validate prerequisites
for (const [label, p] of [['web dist', webDist], ['core dist', coreDist], ['ui dist', uiDist]]) {
  if (!existsSync(p)) {
    console.error(`[web-cli] Missing ${label}: ${p}`);
    console.error('[web-cli] Run "pnpm build:web" from the monorepo root first.');
    process.exit(1);
  }
}

// Clean previous output
rmSync(join(pkgRoot, 'dist'), { recursive: true, force: true });
mkdirSync(join(pkgRoot, 'dist'), { recursive: true });

// Resolve @monitor/core to the local built core package
const coreResolvePlugin = {
  name: 'resolve-monitor-core',
  setup(build) {
    build.onResolve({ filter: /^@monitor\/core$/ }, () => ({
      path: coreDist,
    }));
  },
};

await esbuild.build({
  entryPoints: [webDist],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: join(pkgRoot, 'dist/server.mjs'),
  plugins: [coreResolvePlugin],
  external: [
    'express',
    'cors',
    'socket.io',
    'jsonwebtoken',
    'multer',
    'bcryptjs',
    'better-sqlite3',
    'ssh2',
    'cpu-features',
  ],
  // Provide require() shim for any CJS interop in the bundle
  banner: {
    js: "import { createRequire as _cjsCreateRequire } from 'module'; const require = _cjsCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});

// Copy UI static assets
cpSync(uiDist, join(pkgRoot, 'dist/public'), { recursive: true });

console.log('[web-cli] Build complete');
