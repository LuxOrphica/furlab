"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const BUNDLE_ZIP_PATH = path.join(__dirname, "runtime_bundle.zip");

function fail(message) {
  console.error(`[ui-lab-portable] ${message}`);
  process.exit(1);
}

function psLiteral(input) {
  return String(input || "").replace(/'/g, "''");
}

function extractZip(zipPath, dstDir) {
  const cmd = [
    "$ErrorActionPreference='Stop';",
    `$zip='${psLiteral(zipPath)}';`,
    `$dst='${psLiteral(dstDir)}';`,
    "New-Item -ItemType Directory -Force -Path $dst | Out-Null;",
    "Expand-Archive -Path $zip -DestinationPath $dst -Force;"
  ].join(" ");

  const run = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd],
    { encoding: "utf8", timeout: 120000 }
  );

  if (run.error) return { ok: false, error: `powershell_failed: ${run.error.message}` };
  if (run.status !== 0) {
    return {
      ok: false,
      error: `expand_archive_exit_${run.status}`,
      stdout: String(run.stdout || "").trim(),
      stderr: String(run.stderr || "").trim()
    };
  }
  return { ok: true };
}

function ensureRuntimeExtracted() {
  if (!fs.existsSync(BUNDLE_ZIP_PATH)) {
    fail(`runtime bundle is missing: ${BUNDLE_ZIP_PATH}`);
  }

  const zipBuf = fs.readFileSync(BUNDLE_ZIP_PATH);
  const hash = crypto.createHash("sha256").update(zipBuf).digest("hex").slice(0, 12);
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const baseDir = path.join(localAppData, "FurLabUiLab", "portable-runtime");
  const runtimeDir = path.join(baseDir, `runtime-${hash}`);
  const marker = path.join(runtimeDir, ".ready");
  const serverEntry = path.join(runtimeDir, "tools", "ui_lab_server.js");

  if (fs.existsSync(runtimeDir) && (!fs.existsSync(marker) || !fs.existsSync(serverEntry))) {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }

  if (!fs.existsSync(marker) || !fs.existsSync(serverEntry)) {
    const tmpZip = path.join(baseDir, `bundle-${hash}.zip`);
    const tmpExtractDir = path.join(baseDir, `runtime-${hash}.tmp`);

    fs.mkdirSync(baseDir, { recursive: true });
    fs.rmSync(tmpExtractDir, { recursive: true, force: true });
    fs.mkdirSync(tmpExtractDir, { recursive: true });
    fs.writeFileSync(tmpZip, zipBuf);

    const extracted = extractZip(tmpZip, tmpExtractDir);
    fs.rmSync(tmpZip, { force: true });
    if (!extracted.ok) {
      fs.rmSync(tmpExtractDir, { recursive: true, force: true });
      fail(`runtime extraction failed: ${extracted.error}`);
    }

    fs.rmSync(runtimeDir, { recursive: true, force: true });
    fs.renameSync(tmpExtractDir, runtimeDir);
    fs.writeFileSync(marker, new Date().toISOString(), "utf8");
  }

  return runtimeDir;
}

function setDefaultDbPath(runtimeDir) {
  if (process.env.FURLAB_DB_PATH) return;

  const bundledDb = path.join(runtimeDir, "БД", "Furlab 1.accdb");
  if (fs.existsSync(bundledDb)) {
    process.env.FURLAB_DB_PATH = bundledDb;
  }
}

function main() {
  const runtimeDir = ensureRuntimeExtracted();
  setDefaultDbPath(runtimeDir);
  process.chdir(runtimeDir);

  const serverEntry = path.join(runtimeDir, "tools", "ui_lab_server.js");
  if (!fs.existsSync(serverEntry)) {
    fail(`server entry not found after extraction: ${serverEntry}`);
  }

  require(serverEntry);
}

main();
