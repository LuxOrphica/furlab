"use strict";

const fs = require("fs");
const path = require("path");

function hasServerAt(baseDir) {
  const serverPath = path.join(baseDir, "tools", "ui_lab_server.js");
  return fs.existsSync(serverPath) ? serverPath : null;
}

function resolveProjectRoot() {
  const candidates = [];

  if (process.pkg) {
    const exeDir = path.dirname(process.execPath);
    candidates.push(exeDir, path.resolve(exeDir, ".."), path.resolve(exeDir, "..", ".."));
  } else {
    candidates.push(path.resolve(__dirname, ".."));
  }

  for (const dir of candidates) {
    const serverPath = hasServerAt(dir);
    if (serverPath) return { rootDir: dir, serverPath };
  }

  return null;
}

const resolved = resolveProjectRoot();
if (!resolved) {
  const hint = process.pkg
    ? "Expected tools/ui_lab_server.js next to .exe or one folder above."
    : "Expected tools/ui_lab_server.js in project root.";
  console.error(`[ui-lab-exe] server entry not found. ${hint}`);
  process.exit(1);
}

process.chdir(resolved.rootDir);
require(resolved.serverPath);
