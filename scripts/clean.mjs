import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  "backend/dist",
  "frontend/dist",
  "frontend/tsconfig.app.tsbuildinfo",
  "frontend/tsconfig.node.tsbuildinfo",
  "frontend/vite.config.js",
  "frontend/vite.config.d.ts",
  "test-results",
  "playwright-report",
  "coverage",
];

const removed = [];
for (const relative of targets) {
  const target = path.join(root, relative);
  if (!fs.existsSync(target)) continue;
  fs.rmSync(target, { recursive: true, force: true });
  removed.push(relative);
}

console.log(removed.length ? `Cleaned: ${removed.join(", ")}` : "Workspace is already clean");
