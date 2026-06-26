#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const forbiddenInPublicJs = [
  /\.bak$/i,
  /\.backup$/i,
  /\.orig$/i,
  /backup/i
];

function listFiles(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    const rel = path.relative(root, p).replace(/\\/g, "/");
    if (e.isDirectory()) {
      if (rel === "node_modules" || rel.startsWith(".git/")) continue;
      listFiles(p, out);
      continue;
    }
    out.push(rel);
  }
  return out;
}

function main() {
  const files = listFiles(path.join(root, "public", "js"));
  const bad = files.filter((rel) => forbiddenInPublicJs.some((rx) => rx.test(path.basename(rel))));
  if (bad.length) {
    console.error("repo:hygiene FAIL");
    for (const f of bad) console.error(` - forbidden backup in public/js: ${f}`);
    process.exit(1);
  }
  console.log("repo:hygiene PASS");
}

main();

