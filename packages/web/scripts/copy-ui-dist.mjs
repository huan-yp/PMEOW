import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const uiDistPath = resolve(webRoot, "../ui/dist");
const publicDistPath = resolve(webRoot, "dist/public");

if (!existsSync(uiDistPath)) {
  throw new Error(`UI build output not found: ${uiDistPath}`);
}

rmSync(publicDistPath, { recursive: true, force: true });
mkdirSync(publicDistPath, { recursive: true });
cpSync(uiDistPath, publicDistPath, { recursive: true });