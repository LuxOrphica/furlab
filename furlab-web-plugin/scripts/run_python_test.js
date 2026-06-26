"use strict";

const { spawnSync } = require("child_process");

const script = process.argv[2];
const args = process.argv.slice(3);

if (!script) {
  console.error("Usage: node scripts/run_python_test.js <script.py> [args...]");
  process.exit(2);
}

const candidates = process.platform === "win32"
  ? ["python", "py"]
  : ["python3", "python"];

let lastError = "";
for (const command of candidates) {
  const result = spawnSync(command, [script, ...args], {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (!result.error && result.status === 0) {
    process.exit(0);
  }
  if (result.error && result.error.code === "ENOENT") {
    lastError = result.error.message;
    continue;
  }
  process.exit(Number(result.status || 1));
}

console.error(`Python interpreter not found. Last error: ${lastError || "none"}`);
process.exit(1);
