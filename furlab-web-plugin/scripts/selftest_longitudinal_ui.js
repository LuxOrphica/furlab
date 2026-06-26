#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const BASE_URL = process.env.SELFTEST_URL || "http://127.0.0.1:5600";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT_DIR = path.join(process.cwd(), "tmp", "selftest", "longitudinal_ui");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

async function main() {
  ensureDir(OUT_DIR);
  const report = {
    startedAt: nowIso(),
    baseUrl: BASE_URL,
    consoleErrors: [],
    pageErrors: [],
    before: null,
    afterAdd: null,
    afterRender: null,
    screenshot: null
  };

  const browser = await chromium.launch({
    executablePath: EDGE_PATH,
    headless: true
  });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") report.consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    report.pageErrors.push(String(err && err.message || err));
  });

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(500);

    report.before = await page.evaluate(() => ({
      hasApi: typeof state === "object" && typeof addLayoutByMode === "function" && typeof renderScene === "function",
      layouts: Array.isArray(state.layouts) ? state.layouts.length : -1,
      zones: Array.isArray(state.zones) ? state.zones.length : -1
    }));

    await page.evaluate(async () => {
      const zone = [
        { x: 160, y: 120 },
        { x: 760, y: 120 },
        { x: 760, y: 820 },
        { x: 160, y: 820 }
      ];
      state.details = [
        { id: 1, bbox: { minX: 160, minY: 120, maxX: 760, maxY: 820 }, entity: null }
      ];
      state.zones = [
        { id: 101, detailId: 1, name: "LONG_ZONE", points: zone, napDirectionDeg: 90 }
      ];
      state.selectedZoneId = 101;
      state.selectedDetailId = 1;
      state.uiPanel = "layouts";
      renderLayoutModeSwitch();
      renderDetailZoneTree();
      renderPropertyEditor();
      addLayoutByMode("longitudinal");
      await new Promise((resolve) => setTimeout(resolve, 1200));
      renderScene();
    });

    report.afterAdd = await page.evaluate(() => {
      const entry = Array.isArray(state.layouts) ? state.layouts.find((x) => String(x && x.mode || "") === "longitudinal") : null;
      const snap = entry && entry.runtimeSnapshot && entry.runtimeSnapshot.layoutRun ? entry.runtimeSnapshot.layoutRun : null;
      return {
        layouts: Array.isArray(state.layouts) ? state.layouts.length : -1,
        selectedLayoutId: Number(state.selectedLayoutId || 0),
        selectedZoneId: Number(state.selectedZoneId || 0),
        layoutMode: String(state.layoutMode || ""),
        layoutRunActive: !!(state.layoutRun && state.layoutRun.active),
        layoutRunZoneId: Number(state.layoutRun && state.layoutRun.selectedZoneId || 0),
        layoutRunFragments: Array.isArray(state.layoutRun && state.layoutRun.fragments) ? state.layoutRun.fragments.length : -1,
        layoutRunStatus: String(state.layoutRun && state.layoutRun.status || ""),
        entryId: Number(entry && entry.id || 0),
        entryBoundZoneId: Number(entry && entry.boundZoneId || 0),
        entrySnapshotFragments: Array.isArray(snap && snap.fragments) ? snap.fragments.length : -1,
        workspaceInfo: String((document.getElementById("workspaceInfo") && document.getElementById("workspaceInfo").textContent) || "").trim()
      };
    });

    await page.waitForTimeout(800);

    report.afterRender = await page.evaluate(() => {
      const entry = Array.isArray(state.layouts) ? state.layouts.find((x) => String(x && x.mode || "") === "longitudinal") : null;
      const snap = entry && entry.runtimeSnapshot && entry.runtimeSnapshot.layoutRun ? entry.runtimeSnapshot.layoutRun : null;
      const frag = Array.isArray(state.layoutRun && state.layoutRun.fragments) ? state.layoutRun.fragments[0] : null;
      return {
        layoutRunActive: !!(state.layoutRun && state.layoutRun.active),
        layoutRunZoneId: Number(state.layoutRun && state.layoutRun.selectedZoneId || 0),
        layoutRunFragments: Array.isArray(state.layoutRun && state.layoutRun.fragments) ? state.layoutRun.fragments.length : -1,
        firstFragmentPoints: Array.isArray(frag && frag.points) ? frag.points.length : 0,
        entrySnapshotFragments: Array.isArray(snap && snap.fragments) ? snap.fragments.length : -1,
        workspaceInfo: String((document.getElementById("workspaceInfo") && document.getElementById("workspaceInfo").textContent) || "").trim()
      };
    });

    const shot = path.join(OUT_DIR, "longitudinal_ui.png");
    await page.screenshot({ path: shot, fullPage: true });
    report.screenshot = shot;
  } finally {
    await ctx.close();
    await browser.close();
    report.finishedAt = nowIso();
    const out = path.join(OUT_DIR, `report_${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
    console.log(`SELFTEST_REPORT ${out}`);
    if (report.screenshot) console.log(`SELFTEST_SCREENSHOT ${report.screenshot}`);
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
