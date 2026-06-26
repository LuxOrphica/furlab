#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const BASE_URL = process.env.SELFTEST_URL || "http://127.0.0.1:5600";
const OUT_DIR = path.join(process.cwd(), "tmp", "selftest");
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function mmRect(x0, y0, x1, y1) {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 }
  ];
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ts = Date.now();
  const shot = path.join(OUT_DIR, `manual_seams_visual_${ts}.png`);
  const report = path.join(OUT_DIR, `manual_seams_visual_${ts}.json`);

  const browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 980 } });
  const page = await ctx.newPage();

  const payloadVisibleContours = [
    {
      placementIndex: 0,
      ownerPlacementId: 1,
      scrapPieceId: "A",
      inventoryTag: "A",
      visibleContours: [[[
        [620, 200], [760, 200], [760, 360], [620, 360], [620, 200]
      ]]]
    },
    {
      placementIndex: 1,
      ownerPlacementId: 2,
      scrapPieceId: "B",
      inventoryTag: "B",
      visibleContours: [[[
        [760, 210], [900, 210], [900, 370], [760, 370], [760, 210]
      ]]]
    },
    {
      placementIndex: 2,
      ownerPlacementId: 3,
      scrapPieceId: "C",
      inventoryTag: "C",
      visibleContours: [[[
        [640, 360], [820, 360], [820, 500], [640, 500], [640, 360]
      ]]]
    }
  ];
  const payloadSeamVisibleContours = [
    {
      placementIndex: 0,
      ownerPlacementId: 1,
      scrapPieceId: "A",
      inventoryTag: "A",
      visibleContours: [[[
        [632, 212], [748, 212], [748, 348], [632, 348], [632, 212]
      ]]]
    },
    {
      placementIndex: 1,
      ownerPlacementId: 2,
      scrapPieceId: "B",
      inventoryTag: "B",
      visibleContours: [[[
        [748, 222], [864, 222], [864, 358], [748, 358], [748, 222]
      ]]]
    },
    {
      placementIndex: 2,
      ownerPlacementId: 3,
      scrapPieceId: "C",
      inventoryTag: "C",
      visibleContours: [[[
        [652, 348], [808, 348], [808, 464], [652, 464], [652, 348]
      ]]]
    }
  ];
  const payloadFragments = [
    {
      id: 101,
      ownerPlacementId: 1,
      ownerPlacementIndex: 0,
      scrapPieceId: "A",
      inventoryTag: "A",
      points: [
        { x: 632, y: 212 }, { x: 748, y: 212 }, { x: 748, y: 348 }, { x: 632, y: 348 }
      ]
    },
    {
      id: 102,
      ownerPlacementId: 2,
      ownerPlacementIndex: 1,
      scrapPieceId: "B",
      inventoryTag: "B",
      points: [
        { x: 748, y: 212 }, { x: 864, y: 212 }, { x: 864, y: 348 }, { x: 748, y: 348 }
      ]
    },
    {
      id: 103,
      ownerPlacementId: 3,
      ownerPlacementIndex: 2,
      scrapPieceId: "C",
      inventoryTag: "C",
      points: [
        { x: 632, y: 348 }, { x: 864, y: 348 }, { x: 864, y: 464 }, { x: 632, y: 464 }
      ]
    }
  ];

  let recomputeCalls = 0;
  await page.route("**/api/layout/manual/recompute", async (route) => {
    recomputeCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        selectedZoneId: 1,
        recomputeZoneId: 1,
        usedZoneFallback: false,
        layerPolicy: "first_on_top",
        fragments: payloadFragments,
        visibleContours: payloadVisibleContours,
        seamVisibleContours: payloadSeamVisibleContours,
        seamGeometrySource: "core_visible",
        visibleMetrics: {
          usefulAreaMm2: 70000,
          selectedPiecesAreaMm2: 76000,
          selectedInZoneAreaMm2: 75000,
          utilizationPct: 92.1,
          overlapAreaMm2: 5000
        }
      })
    });
  });

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const r = (x0, y0, x1, y1) => ([
        { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }
      ]);
      state.details = [{ id: 1, bbox: { minX: 560, minY: 140, maxX: 980, maxY: 560 }, entity: null, name: "Деталь 1" }];
      state.zones = [{ id: 1, detailId: 1, name: "Зона 1", napDirectionDeg: 90, points: [
        { x: 560, y: 140 }, { x: 980, y: 140 }, { x: 980, y: 560 }, { x: 560, y: 560 }
      ] }];
      state.selectedDetailId = 1;
      state.selectedZoneId = 1;
      state.layoutMode = "inventory_manual";
      state.layoutRun = state.layoutRun || {};
      state.layoutRun.mode = "inventory_manual";
      state.layoutRun.active = true;
      state.layoutRun.status = "applied";
      state.layoutRun.selectedZoneId = 1;
      state.layoutRun.allowanceMm = 12;
      state.layoutRun.placements = [
        { status: "matched", fragmentId: 1, scrapPieceId: "A", inventoryTag: "A", alignedContour: r(620, 200, 760, 360), alignedCoreContour: r(632, 212, 748, 348) },
        { status: "matched", fragmentId: 2, scrapPieceId: "B", inventoryTag: "B", alignedContour: r(760, 210, 900, 370), alignedCoreContour: r(772, 222, 888, 358) },
        { status: "matched", fragmentId: 3, scrapPieceId: "C", inventoryTag: "C", alignedContour: r(640, 360, 820, 500), alignedCoreContour: r(652, 372, 808, 488) }
      ];
      state.layoutRun.manual = {
        suggestions: [],
        lastMetrics: null,
        selectedCandidateTag: "",
        activePiece: null,
        lastEvalContours: null,
        statusNote: "",
        selectedPlacementIndex: -1
      };
      state.layers.pfullZ = true;
      state.layers.pcoreZ = true;
      state.layers.visibleCore = false; // включим через UI, чтобы чекбокс отражал состояние
      state.layers.usedGain = false;
      state.layers.pieceBorders = false;
      state.layers.assignedPieces = true;
      state.view.showDetailLabels = false;
      renderScene();
    });
    await page.click('[data-manual-toolbar="recompute"]');
    await page.waitForTimeout(500);

    await page.click("#workspace");
    await page.keyboard.press("Control+E");
    await page.waitForTimeout(400);

    const settingsSummary = page.locator("#displaySettingsPanel summary");
    if (await settingsSummary.count()) {
      const txt = await settingsSummary.first().innerText();
      if (!/▾|▼/.test(txt)) await settingsSummary.first().click();
    }
    await page.evaluate(() => {
      const setChecked = (id, checked) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.checked = !!checked;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      setChecked("layerPfullZ", true);
      setChecked("layerPcoreZ", true);
      setChecked("layerVisibleCore", true); // Швы
      setChecked("layerUsedGain", false);
      setChecked("layerPieceBorders", false);
    });
    await page.waitForTimeout(300);

    const summary = await page.evaluate(() => ({
      seamsLayerEnabled: !!(state.layers && state.layers.visibleCore),
      seamsCheckboxChecked: !!(document.getElementById("layerVisibleCore") && document.getElementById("layerVisibleCore").checked),
      pcoreLayerEnabled: !!(state.layers && state.layers.pcoreZ),
      pcoreCheckboxChecked: !!(document.getElementById("layerPcoreZ") && document.getElementById("layerPcoreZ").checked),
      seamsCount: Number(state.layoutRun && state.layoutRun.manual && state.layoutRun.manual.lastMetrics && state.layoutRun.manual.lastMetrics.seamsCount || 0),
      seamsDebug: state.layoutRun && state.layoutRun.manual ? (state.layoutRun.manual.lastSeamDebug || null) : null,
      visibleAreaCount: Number(state.layoutRun && state.layoutRun.previewLayers && Array.isArray(state.layoutRun.previewLayers.visibleArea) ? state.layoutRun.previewLayers.visibleArea.length : 0)
    }));
    if (!summary.seamsLayerEnabled || !summary.seamsCheckboxChecked) {
      throw new Error("SELFTEST_INVALID_SCREENSHOT: seams layer is not enabled before capture");
    }
    const seamsBuilt = Number(summary && summary.seamsDebug && summary.seamsDebug.seamsCount || 0);
    if (seamsBuilt <= 0) {
      throw new Error(`SELFTEST_INVALID_SCREENSHOT: seams not built (seamsBuilt=${seamsBuilt})`);
    }

    await page.screenshot({ path: shot, fullPage: true });
    fs.writeFileSync(report, JSON.stringify({ ok: true, summary, shot, recomputeCalls }, null, 2), "utf8");
    console.log(`SELFTEST_REPORT ${report}`);
    console.log(`SELFTEST_SHOT ${shot}`);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
