"use strict";

const fs = require("fs");
const { spawnSync } = require("child_process");

for (const dir of ["allure-results", "allure-report"]) {
  fs.rmSync(dir, { recursive: true, force: true });
}

const command = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(command, ["exec", "--", "vitest", "run"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    ALLURE: "1",
  },
});

if (result.error) {
  console.error(result.error && result.error.stack ? result.error.stack : String(result.error));
  process.exit(1);
}

process.exit(Number(result.status || 0));
