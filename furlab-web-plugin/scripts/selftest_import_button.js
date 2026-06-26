#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { chromium } = require("playwright-core");

const ROOT = process.cwd();
const BASE_URL = "http://127.0.0.1:5600";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT_DIR = path.join(ROOT, "tmp", "selftest", "import_button");
fs.mkdirSync(OUT_DIR, { recursive: true });

function waitForHttp(url, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Server did not respond in ${timeoutMs}ms`));
          return;
        }
        setTimeout(ping, 300);
      });
    };
    ping();
  });
}

async function run() {
  const server = spawn("node", ["src/server.js"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.pipe(fs.createWriteStream(path.join(OUT_DIR, "server.out.log"), { flags: "w" }));
  server.stderr.pipe(fs.createWriteStream(path.join(OUT_DIR, "server.err.log"), { flags: "w" }));

  const testDxf = path.join(OUT_DIR, "sample_import_test.dxf");
  fs.writeFileSync(testDxf, "0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n", "utf8");

  try {
    await waitForHttp(BASE_URL, 20000);
    const browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

    const chooserPromise = page.waitForEvent("filechooser", { timeout: 10000 });
    await page.click("#importTopBtn");
    const chooser = await chooserPromise;
    await chooser.setFiles(testDxf);

    const uploadResponse = await page.waitForResponse(
      (resp) => resp.url().includes("/api/import/dxf/preview-upload") && resp.request().method() === "POST",
      { timeout: 20000 }
    );
    const payload = await uploadResponse.json();
    if (!payload || payload.ok !== true) {
      throw new Error(`preview-upload returned not ok: ${JSON.stringify(payload)}`);
    }

    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT_DIR, "import_after_click.png"), fullPage: true });
    fs.writeFileSync(path.join(OUT_DIR, "preview_upload_response.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`IMPORT_SELFTEST_OK ${OUT_DIR}`);
    await browser.close();
  } finally {
    server.kill("SIGTERM");
  }
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});

