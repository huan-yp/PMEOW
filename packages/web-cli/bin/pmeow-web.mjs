#!/usr/bin/env node

import { argv, exit } from 'process';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`Usage: pmeow-web [options]

PMEOW GPU cluster monitoring and scheduling web server.

Options:
  --port <port>   Port to listen on (default: 17200, env: PORT)
  --db <path>     Path to SQLite database (env: MONITOR_DB_PATH)
  --help, -h      Show this help message
  --version, -v   Show version number

Environment variables:
  PORT              Server port (default: 17200)
  MONITOR_DB_PATH   SQLite database path (default: ./data/monitor.db)
  JWT_SECRET        Secret for JWT token signing

Examples:
  pmeow-web                          Start with defaults
  pmeow-web --port 8080              Start on port 8080
  pmeow-web --db /var/lib/pmeow.db   Use custom database path
`);
  exit(0);
}

if (argv.includes('--version') || argv.includes('-v')) {
  const require = createRequire(import.meta.url);
  const pkg = require(join(__dirname, '..', 'package.json'));
  console.log(pkg.version);
  exit(0);
}

// Parse --port
const portIdx = argv.indexOf('--port');
if (portIdx !== -1 && argv[portIdx + 1]) {
  process.env.PORT = argv[portIdx + 1];
}

// Parse --db
const dbIdx = argv.indexOf('--db');
if (dbIdx !== -1 && argv[dbIdx + 1]) {
  process.env.MONITOR_DB_PATH = argv[dbIdx + 1];
}

await import('../dist/server.mjs');
