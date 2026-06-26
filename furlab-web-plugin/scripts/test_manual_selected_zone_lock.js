#!/usr/bin/env node
"use strict";

const { chromium } = require("playwright-core");

const BASE_URL = process.env.SELFTEST_URL || "http://127.0.0.1:5600";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function buildRect(x0, y0, x1, y1) {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 }
  ];
}

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  let recomputeRequestBody = null;

  await page.route("**/api/layout/manual/recompute", async (route) => {
    try {
      recomputeRequestBody = JSON.parse(route.request().postData() || "{}");
    } catch (_) {
      recomputeRequestBody = null;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        selectedZoneId: Number(recomputeRequestBody && recomputeRequestBody.selectedZoneId || 0),
        recomputeZoneId: Number(recomputeRequestBody && recomputeRequestBody.zone && recomputeRequestBody.zone.id || 0),
        usedZoneFallback: false,
        layerPolicy: "first_on_top",
        fragments: [],
        visibleContours: [],
        visibleMetrics: {
          usefulAreaMm2: 0,
          selectedPiecesAreaMm2: 0,
          selectedInZoneAreaMm2: 0,
          utilizationPct: 0,
          overlapAreaMm2: 0
        }
      })
    });
  });

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const zone1 = [
        { x: 100, y: 100 },
        { x: 380, y: 100 },
        { x: 380, y: 380 },
        { x: 100, y: 380 }
      ];
      const zone2 = [
        { x: 520, y: 120 },
        { x: 860, y: 120 },
        { x: 860, y: 520 },
        { x: 520, y: 520 }
      ];
      state.details = [
        { id: 1, bbox: { minX: 100, minY: 100, maxX: 380, maxY: 380 }, entity: null },
        { id: 2, bbox: { minX: 520, minY: 120, maxX: 860, maxY: 520 }, entity: null }
      ];
      state.zones = [
        { id: 1, detailId: 1, name: "Zone 1", points: zone1, napDirectionDeg: 90 },
        { id: 2, detailId: 2, name: "Zone 2", points: zone2, napDirectionDeg: 90 }
      ];
      state.selectedZoneId = 1;
      state.selectedDetailId = 1;
      state.layoutMode = "inventory_manual";
      state.layoutRun = state.layoutRun || {};
      state.layoutRun.mode = "inventory_manual";
      state.layoutRun.selectedZoneId = 1;
      state.layoutRun.placements = [{
        status: "matched",
        scrapPieceId: "mock-piece-1",
        inventoryTag: "MOCK-1",
        alignedContour: [
          { x: 620, y: 180 },
          { x: 790, y: 180 },
          { x: 790, y: 340 },
          { x: 620, y: 340 }
        ]
      }];
      state.layoutRun.manual = {
        suggestions: [],
        lastMetrics: null,
        selectedCandidateTag: "",
        activePiece: null,
        lastEvalContours: null,
        statusNote: "",
        selectedPlacementIndex: -1
      };
      renderScene();
    });

    await page.click("#workspace");
    await page.keyboard.press("Control+E");
    await page.waitForTimeout(300);

    if (!recomputeRequestBody) {
      throw new Error("manual_recompute_not_called");
    }
    const selectedZoneId = Number(recomputeRequestBody.selectedZoneId || 0);
    const recomputeZoneId = Number(recomputeRequestBody.zone && recomputeRequestBody.zone.id || 0);
    const pass = selectedZoneId === 1 && recomputeZoneId === 1;
    if (!pass) {
      throw new Error(`zone_lock_failed:selected=${selectedZoneId}:recompute=${recomputeZoneId}`);
    }
    console.log(JSON.stringify({
      ok: true,
      test: "manual_selected_zone_lock",
      selectedZoneId,
      recomputeZoneId
    }));
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    test: "manual_selected_zone_lock",
    error: String(err && err.message ? err.message : err)
  }));
  process.exit(1);
});
