#!/usr/bin/env node
"use strict";
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");
const { chromium } = require("playwright-core");

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "tmp", "selftest", "reports_preview");
const BASE_URL = "http://127.0.0.1:5600";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
fs.mkdirSync(OUT_DIR, { recursive: true });

function waitForHttp(url, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get(url, (res) => { res.resume(); resolve(); });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) return reject(new Error(`Server did not respond in ${timeoutMs}ms`));
        setTimeout(ping, 250);
      });
    };
    ping();
  });
}

(async () => {
  const server = spawn("node", ["src/server.js"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  const outLog = fs.createWriteStream(path.join(OUT_DIR, "server.out.log"));
  const errLog = fs.createWriteStream(path.join(OUT_DIR, "server.err.log"));
  server.stdout.pipe(outLog); server.stderr.pipe(errLog);

  try {
    await waitForHttp(BASE_URL, 20000);
    const browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const z = [
        {x:200,y:150},{x:520,y:150},{x:520,y:520},{x:200,y:520}
      ];
      if (!window.state) return;
      state.zones = [{ id: 21, name: 'Зона 21', detailId: 2, points: z, napDirectionDeg: 90 }];
      state.selectedZoneId = 21;
      state.layoutRun = state.layoutRun || {};
      state.layoutRun.status = 'applied';
      state.layoutRun.selectedZoneId = 21;
      state.layoutRun.placements = [
        { fragmentId: 1, inventoryTag: 'FL-SCR-000563', napEffectiveDeg: 90, gainAreaMm2: 40 },
        { fragmentId: 2, inventoryTag: 'FL-SCR-000499', napEffectiveDeg: 90, gainAreaMm2: 160 },
        { fragmentId: 3, inventoryTag: 'FL-SCR-010588', napEffectiveDeg: 90, gainAreaMm2: 120 }
      ];
      state.layoutRun.fragments = [
        { id: 1, points:[{x:250,y:220},{x:300,y:210},{x:282,y:250}] , areaMm2:40, ownerPlacementId:1, ownerPlacementIndex:0 },
        { id: 2, points:[{x:320,y:280},{x:380,y:270},{x:392,y:320},{x:340,y:338},{x:315,y:305}], areaMm2:160, ownerPlacementId:2, ownerPlacementIndex:1 },
        { id: 3, points:[{x:270,y:360},{x:355,y:345},{x:355,y:372},{x:286,y:397}], areaMm2:120, ownerPlacementId:3, ownerPlacementIndex:2 }
      ];
      if (typeof renderScene === 'function') renderScene();
      const b = document.getElementById('reportsBtn');
      if (b) b.disabled = false;
      if (b) b.click();
    });

    await page.waitForTimeout(700);
    const out = path.join(OUT_DIR, `reports_modal_${Date.now()}.png`);
    await page.screenshot({ path: out, fullPage: true });
    await browser.close();
    console.log(`REPORT_SCREENSHOT ${out}`);
  } finally {
    server.kill('SIGTERM');
  }
})().catch((e) => { console.error(e); process.exit(1); });
