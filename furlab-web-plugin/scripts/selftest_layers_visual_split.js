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
  const browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const report = { baseUrl: BASE_URL, shots: [], checks: {}, errors: [] };
  page.on("pageerror", (e) => report.errors.push(String(e && e.message || e)));
  page.on("console", (m) => { if (m.type() === "error") report.errors.push(m.text()); });
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const zone = [
        { x: 560, y: 120 }, { x: 980, y: 120 }, { x: 980, y: 760 }, { x: 560, y: 760 }
      ];
      const frags = [];
      const w = 120, h = 120, gx = 10, gy = 10;
      let id = 1;
      for (let r = 0; r < 4; r += 1) {
        for (let c = 0; c < 3; c += 1) {
          const x = 590 + c * (w + gx);
          const y = 150 + r * (h + gy);
          const rr = 18;
          frags.push({
            id: id++,
            points: [
              { x: x + rr, y }, { x: x + w - rr, y }, { x: x + w, y: y + rr },
              { x: x + w, y: y + h - rr }, { x: x + w - rr, y: y + h }, { x: x + rr, y: y + h },
              { x, y: y + h - rr }, { x, y: y + rr }
            ]
          });
        }
      }
      const p1 = [{x:620,y:180},{x:700,y:170},{x:720,y:220},{x:660,y:260},{x:600,y:230}];
      const p2 = [{x:760,y:360},{x:840,y:330},{x:880,y:390},{x:800,y:440},{x:740,y:410}];
      const p3 = [{x:660,y:560},{x:760,y:540},{x:780,y:620},{x:690,y:670},{x:620,y:620}];
      state.zones = [{ id: 4001, name: "VIS_TEST", points: zone }];
      state.selectedZoneId = 4001;
      state.layoutRun = {
        active: true,
        selectedZoneId: 4001,
        fragments: frags,
        placements: [
          { status: "matched", fragmentId: 1, inZoneContour: p1, inZoneCoreContour: p1, usedVisibleContour: p1 },
          { status: "matched", fragmentId: 5, inZoneContour: p2, inZoneCoreContour: p2, usedVisibleContour: p2 },
          { status: "matched", fragmentId: 9, inZoneContour: p3, inZoneCoreContour: p3, usedVisibleContour: p3 }
        ],
        previewLayers: { pieceIntersections: [], visibleArea: [] }
      };
      state.layers.pieceBorders = true;
      state.layers.assignedPieces = true;
      state.layers.pfullZ = true;
      state.layers.pcoreZ = false;
      state.layers.usedGain = false;
      state.layers.visibleCore = false;
      renderScene();
      const cb = byId("displaySettingsCollapsed");
      if (cb) cb.checked = true;
    });

    const s1 = path.join(OUT_DIR, "11_layers_both_on.png");
    await page.screenshot({ path: s1, fullPage: true });
    report.shots.push(s1);

    await page.evaluate(() => {
      const c1 = byId("layerAssignedPieces");
      if (c1) { c1.checked = false; state.layers.assignedPieces = false; }
      renderScene();
    });
    await page.waitForTimeout(120);
    const s2 = path.join(OUT_DIR, "12_layers_fragments_only.png");
    await page.screenshot({ path: s2, fullPage: true });
    report.shots.push(s2);

    await page.evaluate(() => {
      const c0 = byId("layerPieceBorders");
      const c1 = byId("layerAssignedPieces");
      if (c0) { c0.checked = false; state.layers.pieceBorders = false; }
      if (c1) { c1.checked = true; state.layers.assignedPieces = true; }
      renderScene();
    });
    await page.waitForTimeout(120);
    const s3 = path.join(OUT_DIR, "13_layers_pieces_only.png");
    await page.screenshot({ path: s3, fullPage: true });
    report.shots.push(s3);

    report.checks = await page.evaluate(() => {
      return {
        pieceBorders: !!state.layers.pieceBorders,
        assignedPieces: !!state.layers.assignedPieces,
        pfullZ: !!state.layers.pfullZ,
        fragmentsCount: Array.isArray(state.layoutRun?.fragments) ? state.layoutRun.fragments.length : 0,
        placementsCount: Array.isArray(state.layoutRun?.placements) ? state.layoutRun.placements.length : 0
      };
    });
  } finally {
    await ctx.close();
    await browser.close();
    fs.writeFileSync(path.join(OUT_DIR, "visual_layers_selftest_after_fix.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log("SELFTEST_REPORT", path.join(OUT_DIR, "visual_layers_selftest_after_fix.json"));
  }
})();
