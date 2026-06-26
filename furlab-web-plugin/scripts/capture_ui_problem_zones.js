#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");
const { chromium } = require("playwright-core");

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "tmp", "selftest", "ui_problem_zones");
const BASE_URL = "http://127.0.0.1:5600";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

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
  const server = spawn("node", ["src/server.js"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const outLog = fs.createWriteStream(path.join(OUT_DIR, "server.out.log"), { flags: "w" });
  const errLog = fs.createWriteStream(path.join(OUT_DIR, "server.err.log"), { flags: "w" });
  server.stdout.pipe(outLog);
  server.stderr.pipe(errLog);

  try {
    await waitForHttp(BASE_URL, 20000);

    const browser = await chromium.launch({
      executablePath: EDGE_PATH,
      headless: true
    });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(600);

    await page.screenshot({ path: path.join(OUT_DIR, "01_main.png"), fullPage: true });

    await page.evaluate(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, "02_right_panel_title.png"), fullPage: true });

    await page.evaluate(() => {
      const b = document.getElementById("inventoryStep1Backdrop");
      if (b) b.style.display = "flex";
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, "03_step1_modal.png"), fullPage: true });

    await page.evaluate(() => {
      const b1 = document.getElementById("inventoryStep1Backdrop");
      const b2 = document.getElementById("inventoryStep2Backdrop");
      if (b1) b1.style.display = "none";
      if (b2) b2.style.display = "flex";
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, "04_step2_modal.png"), fullPage: true });

    await page.evaluate(() => {
      const b2 = document.getElementById("inventoryStep2Backdrop");
      const bp = document.getElementById("inventoryProgressBackdrop");
      const ul = document.getElementById("inventoryProgressSteps");
      if (b2) b2.style.display = "none";
      if (bp) bp.style.display = "flex";
      if (ul) {
        ul.innerHTML = `
          <li class="progress-step progress-step-done"><span>[x]</span><span>Worker / bootstrap</span></li>
          <li class="progress-step progress-step-active"><span>[>]</span><span>Server / geometry</span></li>
        `;
      }
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, "05_progress_modal.png"), fullPage: true });

    await page.evaluate(() => {
      if (typeof state !== "object") return;
      state.layoutMode = "inventory_manual";
      state.layoutRun = state.layoutRun || {};
      state.layoutRun.candidatePool = [
        { inventoryTag: "T-001", areaMm2: 7800, scrapContour: "{\"path\":[{\"x\":0,\"y\":0},{\"x\":60,\"y\":0},{\"x\":45,\"y\":20},{\"x\":0,\"y\":10}]}" },
        { inventoryTag: "T-002", areaMm2: 4200, scrapContour: "{\"path\":[{\"x\":0,\"y\":0},{\"x\":30,\"y\":0},{\"x\":26,\"y\":15},{\"x\":0,\"y\":10}]}" },
        { inventoryTag: "T-003", areaMm2: 1900, scrapContour: "{\"path\":[{\"x\":0,\"y\":0},{\"x\":18,\"y\":0},{\"x\":14,\"y\":8},{\"x\":0,\"y\":6}]}" }
      ];
      state.layoutRun.placements = [];
      state.layoutRun.manual = { selectedPlacementIndex: -1, statusNote: "" };
      if (typeof renderManualTrayIntoRoot === "function") renderManualTrayIntoRoot();
      const bp = document.getElementById("inventoryProgressBackdrop");
      if (bp) bp.style.display = "none";
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT_DIR, "06_manual_tray_sections.png"), fullPage: true });

    await browser.close();
    console.log(`UI_SCREENSHOTS ${OUT_DIR}`);
  } finally {
    server.kill("SIGTERM");
  }
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
