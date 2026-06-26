#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const BASE_URL = process.env.SELFTEST_URL || "http://127.0.0.1:5600";
const OUT_DIR = path.join(process.cwd(), "tmp", "selftest");
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  const outShot = path.join(OUT_DIR, "manual_mode_pcore_visible.png");
  const outJson = path.join(OUT_DIR, "manual_mode_pcore_visible.json");
  const report = { baseUrl: BASE_URL, outShot, errors: [] };
  const browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => report.errors.push(String(e && e.message || e)));
  page.on("console", (m) => { if (m.type() === "error") report.errors.push(m.text()); });
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const full = [
        { x: 720, y: 240 },
        { x: 1020, y: 220 },
        { x: 1110, y: 470 },
        { x: 860, y: 610 },
        { x: 690, y: 490 }
      ];
      const core = [
        { x: 760, y: 270 },
        { x: 980, y: 255 },
        { x: 1050, y: 455 },
        { x: 875, y: 555 },
        { x: 740, y: 470 }
      ];
      const zone = [
        { x: 600, y: 160 },
        { x: 1180, y: 160 },
        { x: 1180, y: 700 },
        { x: 600, y: 700 }
      ];

      state.zones = [{ id: 1, name: "Zone 1", points: zone }];
      state.selectedZoneId = 1;
      state.layoutMode = "inventory_manual";
      state.layoutRun = {
        active: true,
        selectedZoneId: 1,
        placements: [{
          status: "matched",
          inventoryTag: "TEST-001",
          inZoneContour: full,
          inZoneCoreContour: core,
          alignedContour: full,
          alignedCoreContour: core,
          usedVisibleContour: full,
          gainAreaMm2: 100000
        }],
        fragments: [],
        manual: { selectedPlacementIndex: 0, statusNote: "тест" },
        previewLayers: { pieceIntersections: [], visibleArea: [] }
      };

      state.layers = Object.assign({}, state.layers, {
        zones: true,
        labels: false,
        pfullZ: true,
        pcoreZ: true,
        usedGain: true,
        pieceBorders: true,
        assignedPieces: true,
        visibleCore: false,
        pieceIntersections: false
      });

      const panel = byId("displaySettingsCollapsed");
      if (panel) panel.checked = true;
      const pcoreCb = byId("layerPcoreZ");
      if (pcoreCb) pcoreCb.checked = true;
      renderScene();
    });

    await page.waitForTimeout(300);
    await page.screenshot({ path: outShot, fullPage: true });
    report.ok = true;
  } catch (e) {
    report.ok = false;
    report.errors.push(String(e && e.message || e));
  } finally {
    await ctx.close();
    await browser.close();
    fs.writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log("SELFTEST_SHOT", outShot);
    console.log("SELFTEST_REPORT", outJson);
  }
})();
