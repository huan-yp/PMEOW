import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const runtimeRoot = path.join(repoRoot, "server", "runtime");
const runtimeEntry = path.join(runtimeRoot, "dist", "server.js");
const publicDir = path.join(repoRoot, "apps", "web", "dist");

if (!fs.existsSync(runtimeEntry)) {
  throw new Error(`Runtime build output not found: ${runtimeEntry}. Run \"npm run build:web\" first.`);
}

if (!fs.existsSync(path.join(publicDir, "index.html"))) {
  throw new Error(`Web build output not found: ${publicDir}. Run \"npm run build:web\" first.`);
}

const child = spawn(process.execPath, [runtimeEntry, ...process.argv.slice(2)], {
  cwd: runtimeRoot,
  env: {
    ...process.env,
    PMEOW_WEB_PUBLIC_DIR: publicDir,
  },
  stdio: "inherit",
});

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error("[monitor] Failed to launch runtime:", error);
  process.exit(1);
});