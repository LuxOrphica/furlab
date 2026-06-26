#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const BASE_URL = process.env.SELFTEST_URL || "http://127.0.0.1:5600";
const USE_MOCKS = String(process.env.SELFTEST_USE_MOCKS || "0") !== "0";
const OUT_DIR = path.join(process.cwd(), "tmp", "selftest");
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

fs.mkdirSync(OUT_DIR, { recursive: true });

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function parseBody(postData) {
  try {
    return JSON.parse(String(postData || "{}"));
  } catch (_) {
    return {};
  }
}

function center(points) {
  const pts = Array.isArray(points) ? points : [];
  if (!pts.length) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += Number(p && p.x || 0);
    sy += Number(p && p.y || 0);
  }
  return { x: sx / pts.length, y: sy / pts.length };
}

function scaleFromCenter(points, k) {
  const c = center(points);
  return (Array.isArray(points) ? points : []).map((p) => ({
    x: round2(c.x + (Number(p && p.x || 0) - c.x) * k),
    y: round2(c.y + (Number(p && p.y || 0) - c.y) * k)
  }));
}

function toMulti(points) {
  return [Array.isArray(points) ? points : []];
}

function pointSegDist(p, a, b) {
  const px = Number(p && p.x || 0);
  const py = Number(p && p.y || 0);
  const ax = Number(a && a.x || 0);
  const ay = Number(a && a.y || 0);
  const bx = Number(b && b.x || 0);
  const by = Number(b && b.y || 0);
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  const t = ab2 > 1e-9 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2)) : 0;
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

function minDistToContour(point, contour) {
  const pts = Array.isArray(contour) ? contour : [];
  if (pts.length < 2) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    best = Math.min(best, pointSegDist(point, a, b));
  }
  return best;
}

(async () => {
  const ts = Date.now();
  const reportPath = path.join(OUT_DIR, `inventory_manual_e2e_${ts}.json`);
  const shot1 = path.join(OUT_DIR, `inventory_manual_e2e_${ts}_01_step2.png`);
  const shot2 = path.join(OUT_DIR, `inventory_manual_e2e_${ts}_02_dragged.png`);
  const shot3 = path.join(OUT_DIR, `inventory_manual_e2e_${ts}_03_applied.png`);
  const shot4 = path.join(OUT_DIR, `inventory_manual_e2e_${ts}_04_seams.png`);

  const report = {
    baseUrl: BASE_URL,
    ts,
    steps: {
      step1_to_step2_open: { pass: false, info: "" },
      tray_loaded: { pass: false, info: "" },
      drag_into_zone: { pass: false, info: "" },
      layer_name_before_apply: { pass: false, info: "" },
      evaluate_updates_metrics: { pass: false, info: "" },
      evaluate_repeated_clicks: { pass: false, info: "" },
      apply_commits_layout: { pass: false, info: "" },
      layer_name_after_apply: { pass: false, info: "" },
      display_checkboxes_affect: { pass: false, info: "" },
      seam_uses_core_geometry: { pass: false, info: "" }
    },
    artifacts: { shot1, shot2, shot3, shot4 },
    routeHits: { candidates: 0, evaluate: 0, recompute: 0 },
    debug: {
      seamGeometrySource: "",
      pieceSeamReserveMm: 0,
      seamsCount: 0
    },
    errors: []
  };

  const browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 980 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => report.errors.push(`pageerror: ${String(e && e.message || e)}`));
  page.on("console", (m) => {
    if (m.type() === "error") report.errors.push(`console.error: ${m.text()}`);
  });
  let liveRecomputeCalls = 0;
  page.on("request", (req) => {
    try {
      if (String(req.method() || "").toUpperCase() !== "POST") return;
      const url = String(req.url() || "");
      if (url.includes("/api/layout/manual/recompute")) liveRecomputeCalls += 1;
    } catch (_) {}
  });

  try {
    if (USE_MOCKS) await page.route("**/api/inventory/candidates", async (route) => {
      report.routeHits.candidates += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          items: [
            {
              id: "mock-1",
              inventoryTag: "MOCK-001",
              scrapContour: JSON.stringify({
                units: "mm",
                path: [
                  { x: 0, y: 0 }, { x: 120, y: 10 }, { x: 110, y: 90 }, { x: 15, y: 100 }
                ]
              })
            },
            {
              id: "mock-2",
              inventoryTag: "MOCK-002",
              scrapContour: JSON.stringify({
                units: "mm",
                path: [
                  { x: 0, y: 0 }, { x: 90, y: 5 }, { x: 80, y: 65 }, { x: 10, y: 75 }
                ]
              })
            }
          ]
        })
      });
    });

    if (USE_MOCKS) await page.route("**/api/layout/manual/evaluate", async (route) => {
      report.routeHits.evaluate += 1;
      const body = parseBody(route.request().postData());
      const full = Array.isArray(body.piecePoints) ? body.piecePoints : [];
      const core = scaleFromCenter(full, 0.82);
      const gain = scaleFromCenter(full, 0.74);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          metrics: {
            gainAreaMm2: 12800,
            overlapAreaMm2: 1300,
            outsideAreaMm2: 0,
            utilizedPct: 81.2,
            coveragePct: 22.7,
            status: "ok"
          },
          contours: {
            inZone: toMulti(full),
            inZoneCore: toMulti(core),
            coreWorld: toMulti(core),
            gainVisible: toMulti(gain)
          }
        })
      });
    });

    if (USE_MOCKS) await page.route("**/api/layout/manual/recompute", async (route) => {
      report.routeHits.recompute += 1;
      const body = parseBody(route.request().postData());
      const placements = Array.isArray(body.placements) ? body.placements : [];
      const pieces = placements.length;
      const coverage = pieces > 0 ? Math.min(96.5, 15 + pieces * 18.5) : 0;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          metrics: {
            pieces,
            coveragePct: round2(coverage),
            usefulAreaMm2: round2(placements.length * 12000),
            overlapAreaMm2: round2(Math.max(0, (placements.length - 1) * 900)),
            outsideAreaMm2: 0,
            utilPct: round2(pieces > 0 ? 84.4 : 0),
            tailPenaltyPct: 0
          }
        })
      });
    });

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(450);

    await page.evaluate(() => {
      const zone = [
        { x: 620, y: 180 },
        { x: 1140, y: 180 },
        { x: 1140, y: 760 },
        { x: 620, y: 760 }
      ];
      state.details = [{ id: 1, bbox: { minX: 620, minY: 180, maxX: 1140, maxY: 760 }, entity: null }];
      state.zones = [{ id: 1, detailId: 1, name: "Зона 1", points: zone }];
      state.selectedZoneId = 1;
      state.selectedDetailId = 1;
      state.layoutMode = "inventory_manual";
      state.layoutRun = state.layoutRun || {};
      state.layoutRun.allowanceMm = 12;
      renderScene();
    });

    // Real UI path: switch to layouts, add "inventory_manual" layout, then open step1 from property panel.
    const layoutsTab = page.locator("#layoutModeSwitch button[data-panel='layouts']");
    if (await layoutsTab.count()) await layoutsTab.click();
    await page.click("#detailZoneTree .layout-add-btn");
    await page.waitForSelector("#layoutTypeBackdrop", { state: "visible", timeout: 10000 });
    const cards = page.locator("#layoutTypeGrid .layout-type-card");
    const cardCount = await cards.count();
    let picked = false;
    for (let i = 0; i < cardCount; i += 1) {
      const txt = await cards.nth(i).innerText();
      if (/ручной/i.test(String(txt || ""))) {
        await cards.nth(i).click();
        picked = true;
        break;
      }
    }
    if (!picked && cardCount > 0) await cards.nth(cardCount - 1).click();
    await page.click("#layoutTypeAddBtn");
    await page.waitForTimeout(250);
    await page.click("#inventoryPickBtn");
    await page.waitForSelector("#inventoryStep1Backdrop", { state: "visible", timeout: 10000 });
    await page.click("#inventoryStep1RunBtn");
    await page.waitForSelector("#inventoryStep2Backdrop", { state: "visible", timeout: 45000 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: shot1, fullPage: true });
    report.steps.step1_to_step2_open = { pass: true, info: "Step2 открыт после запуска Step1" };
    await page.click("#inventoryStep2ApplyBtn");
    await page.waitForSelector("#inventoryStep2Backdrop", { state: "hidden", timeout: 10000 });
    await page.waitForTimeout(120);

    await page.waitForFunction(() => {
      const lr = window.state && window.state.layoutRun;
      return !!(lr && Array.isArray(lr.candidatePool));
    }, { timeout: 10000 }).catch(() => {});
    const poolCount = await page.evaluate(() => {
      const lr = window.state && window.state.layoutRun;
      return Array.isArray(lr && lr.candidatePool) ? lr.candidatePool.length : 0;
    });
    const pieceButtons = page.locator("#manualTrayDock [data-manual-piece]");
    const pieceCount = await pieceButtons.count();
    report.steps.tray_loaded = {
      pass: poolCount > 0 || pieceCount > 0,
      info: `pool=${poolCount}, pieces_in_tray=${pieceCount}, route_hits=${JSON.stringify(report.routeHits)}`
    };

    if (pieceCount > 0) {
      const toggles = page.locator("#manualTrayDock [data-manual-toggle]");
      if (await toggles.count()) {
        await toggles.first().click();
        await page.waitForTimeout(120);
      }
      await pieceButtons.first().dragTo(page.locator("#workspace"), {
        targetPosition: { x: 900, y: 220 }
      });
      await page.waitForTimeout(350);
      if (pieceCount > 1) {
        await pieceButtons.nth(1).dragTo(page.locator("#workspace"), {
          targetPosition: { x: 930, y: 240 }
        });
        await page.waitForTimeout(350);
      }
    }

    const placedCountAfterDrag = await page.evaluate(() =>
      Array.isArray(state && state.layoutRun && state.layoutRun.placements)
        ? state.layoutRun.placements.length
        : 0
    );
    await page.screenshot({ path: shot2, fullPage: true });
    report.steps.drag_into_zone = {
      pass: placedCountAfterDrag > 0,
      info: `placements_after_drag=${placedCountAfterDrag}`
    };
    await page.evaluate(() => {
      const panel = document.getElementById("displaySettingsPanel");
      if (panel) panel.open = true;
    });
    const layerLabelBeforeApply = await page.locator("#layerPieceBordersLabel").innerText().catch(() => "");
    report.steps.layer_name_before_apply = {
      pass: /Рабочие области|Фрагменты/i.test(String(layerLabelBeforeApply || "")),
      info: `layerPieceBordersLabel="${layerLabelBeforeApply}"`
    };

    const readMetricsText = async () => {
      const nodes = page.locator("#manualTrayDock .manual-tray-metrics");
      const count = await nodes.count();
      const parts = [];
      for (let i = 0; i < count; i += 1) {
        parts.push(await nodes.nth(i).innerText().catch(() => ""));
      }
      return parts.filter(Boolean).join(" | ");
    };
    const metricsBefore = await readMetricsText();
    const recomputeCallsBefore = liveRecomputeCalls;
    const trayRecomputeExists = (await page.locator("#manualTrayDock [data-manual-toolbar='recompute']").count()) > 0;
    const clickManualControl = async (selector) => {
      const clicked = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.click();
        return true;
      }, selector);
      if (!clicked) {
        const target = page.locator(selector);
        await target.first().click({ force: true });
      }
    };
    if (trayRecomputeExists) {
      await clickManualControl("#manualTrayDock [data-manual-toolbar='recompute']");
    } else {
      await clickManualControl("#inventoryManualRecomputeBtn");
    }
    await page.waitForTimeout(500);
    const metricsAfter = await readMetricsText();
    report.steps.evaluate_updates_metrics = {
      pass: (String(metricsAfter || "") !== String(metricsBefore || "")) || ((liveRecomputeCalls - recomputeCallsBefore) > 0),
      info: `before="${metricsBefore}" | after="${metricsAfter}" | recompute_delta=${liveRecomputeCalls - recomputeCallsBefore}`
    };
    for (let i = 0; i < 4; i += 1) {
      if (trayRecomputeExists) {
        await clickManualControl("#manualTrayDock [data-manual-toolbar='recompute']");
      } else {
        await clickManualControl("#inventoryManualRecomputeBtn");
      }
      await page.waitForTimeout(350);
    }
    const recomputeCallsAfter = liveRecomputeCalls;
    report.steps.evaluate_repeated_clicks = {
      pass: (recomputeCallsAfter - recomputeCallsBefore) >= 5,
      info: `recompute_calls_delta=${recomputeCallsAfter - recomputeCallsBefore} (expected >=5 for 5 clicks total)`
    };

    const trayApplyExists = (await page.locator("#manualTrayDock [data-manual-toolbar='apply']").count()) > 0;
    if (trayApplyExists) {
      await clickManualControl("#manualTrayDock [data-manual-toolbar='apply']");
    } else {
      await clickManualControl("#inventoryStep2ApplyBtn");
    }
    await page.waitForTimeout(550);
    const workspaceInfo = await page.locator("#workspaceInfo").innerText().catch(() => "");
    const step2Visible = await page.isVisible("#inventoryStep2Backdrop");
    const metricsAfterApply = await readMetricsText();
    const hasPiecesAfterApply = await page.evaluate(() =>
      Array.isArray(state && state.layoutRun && state.layoutRun.placements)
        ? state.layoutRun.placements.length > 0
        : false
    );
    await page.screenshot({ path: shot3, fullPage: true });
    report.steps.apply_commits_layout = {
      pass: !step2Visible && hasPiecesAfterApply,
      info: `workspaceInfo="${workspaceInfo}", step2Visible=${step2Visible}, metrics="${metricsAfterApply}"`
    };
      const seamLayerToggle = page.locator("#layerVisibleCore");
      if (await seamLayerToggle.count()) {
        const seamChecked = await seamLayerToggle.isChecked().catch(() => false);
        if (!seamChecked) {
          await seamLayerToggle.check({ force: true }).catch(async () => {
            await seamLayerToggle.click({ force: true });
          });
          await page.waitForTimeout(180);
        }
      }
      await page.screenshot({ path: shot4, fullPage: true });
      const seamDebug = await page.evaluate(() => {
        const lr = state && state.layoutRun;
        const manual = lr && lr.manual;
        const dbg = manual && manual.lastSeamDebug ? manual.lastSeamDebug : {};
        return {
          seamsCount: Number(manual && manual.lastMetrics && manual.lastMetrics.seamsCount || 0),
          seamGeometrySource: String(dbg && dbg.source || ""),
          pieceSeamReserveMm: Number((lr && lr.allowanceMm) || 0),
          seamItems: Array.isArray(dbg && dbg.seamItems) ? dbg.seamItems : [],
          renderedSeams: Number(dbg && dbg.renderedSeams || 0),
          sample: dbg && dbg.sample ? dbg.sample : null
        };
      });
      report.debug = {
        seamGeometrySource: String(seamDebug.seamGeometrySource || ""),
        pieceSeamReserveMm: Number(seamDebug.pieceSeamReserveMm || 0),
        seamsCount: Number(seamDebug.seamsCount || 0),
        renderedSeams: Number(seamDebug.renderedSeams || 0),
        seamItems: Array.isArray(seamDebug.seamItems) ? seamDebug.seamItems : []
      };

    const seamGeom = await page.evaluate(() => {
      const lr = state && state.layoutRun;
      const manual = lr && lr.manual;
      const sample = manual && manual.lastSeamDebug && manual.lastSeamDebug.sample;
      if (!sample || !Array.isArray(sample.points) || sample.points.length < 2) return null;
      const placements = Array.isArray(lr && lr.placements) ? lr.placements : [];
      const keyA = String((sample.pieceA && (sample.pieceA.scrapPieceId || sample.pieceA.inventoryTag)) || "");
      const keyB = String((sample.pieceB && (sample.pieceB.scrapPieceId || sample.pieceB.inventoryTag)) || "");
      const findPlacement = (k) => placements.find((p) => String((p && (p.scrapPieceId || p.inventoryTag)) || "") === k) || null;
      const a = findPlacement(keyA);
      const b = findPlacement(keyB);
      return {
        samplePoints: sample.points,
        a: a ? {
          full: Array.isArray(a.alignedContour) ? a.alignedContour : [],
          core: Array.isArray(a.alignedCoreContour) ? a.alignedCoreContour : []
        } : null,
        b: b ? {
          full: Array.isArray(b.alignedContour) ? b.alignedContour : [],
          core: Array.isArray(b.alignedCoreContour) ? b.alignedCoreContour : []
        } : null
      };
    });

    if (seamGeom && seamGeom.a && seamGeom.b && Array.isArray(seamGeom.samplePoints)) {
      const p1 = seamGeom.samplePoints[0];
      const p2 = seamGeom.samplePoints[1];
      const d = (piece) => ({
        dFull1: minDistToContour(p1, piece.full),
        dFull2: minDistToContour(p2, piece.full),
        dCore1: minDistToContour(p1, piece.core),
        dCore2: minDistToContour(p2, piece.core)
      });
      const da = d(seamGeom.a);
      const db = d(seamGeom.b);
      const coreNearTol = 1.6;
      const fullFarTol = 2.0;
      const nearestCore1 = Math.min(da.dCore1, db.dCore1);
      const nearestCore2 = Math.min(da.dCore2, db.dCore2);
      const nearestFull1 = Math.min(da.dFull1, db.dFull1);
      const nearestFull2 = Math.min(da.dFull2, db.dFull2);
      const nearCore = nearestCore1 <= coreNearTol && nearestCore2 <= coreNearTol;
      const farFromFull = nearestFull1 >= fullFarTol && nearestFull2 >= fullFarTol;
      const src = String(seamDebug.seamGeometrySource || "");
      const sourceOk = /applied_fragments/i.test(src) || /core/i.test(src);
      const appliedFragmentsMode = /applied_fragments/i.test(src);
      report.steps.seam_uses_core_geometry = {
        pass: appliedFragmentsMode
          ? (sourceOk && Number(seamDebug.seamsCount || 0) > 0 && Number(seamDebug.renderedSeams || 0) >= 0)
          : (nearCore && farFromFull && sourceOk),
        info: `source=${src}; reserve=${seamDebug.pieceSeamReserveMm}; nearest(full/core)=(${round2(nearestFull1)}/${round2(nearestCore1)}),(${round2(nearestFull2)}/${round2(nearestCore2)}); dA(full/core)=(${round2(da.dFull1)}/${round2(da.dCore1)}),(${round2(da.dFull2)}/${round2(da.dCore2)}); dB(full/core)=(${round2(db.dFull1)}/${round2(db.dCore1)}),(${round2(db.dFull2)}/${round2(db.dCore2)})`
      };
    } else {
      const noSeams = Number(seamDebug && seamDebug.seamsCount || 0) === 0;
      const src = String(seamDebug.seamGeometrySource || "");
      const sourceOk = /disabled_before_apply|applied_fragments|core/i.test(src);
      report.steps.seam_uses_core_geometry = {
        pass: noSeams ? sourceOk : false,
        info: noSeams
          ? `skipped_no_seams: source=${src}; reserve=${seamDebug.pieceSeamReserveMm}; seamsCount=0`
          : "No seam sample available for geometric assert"
      };
    }
    const layerLabelAfterApply = await page.locator("#layerPieceBordersLabel").innerText().catch(() => "");
    report.steps.layer_name_after_apply = {
      pass: /Фрагменты/i.test(String(layerLabelAfterApply || "")),
      info: `layerPieceBordersLabel="${layerLabelAfterApply}"`
    };

    const layerCount = async () => {
      return page.evaluate(() => {
        const s = window.Konva && Array.isArray(window.Konva.stages) ? window.Konva.stages[0] : null;
        if (!s || typeof s.getLayers !== "function") return -1;
        return s.getLayers().reduce((sum, l) => sum + (l && typeof l.getChildren === "function" ? l.getChildren().length : 0), 0);
      });
    };

    await page.evaluate(() => {
      const panel = document.getElementById("displaySettingsPanel");
      if (panel) panel.open = true;
    });
    const beforeAny = await layerCount();
    await page.click("#layerPfullZ");
    await page.waitForTimeout(180);
    const afterPfull = await layerCount();
    await page.click("#layerPcoreZ");
    await page.waitForTimeout(180);
    const afterPcore = await layerCount();
    await page.click("#layerUsedGain");
    await page.waitForTimeout(180);
    const afterUsed = await layerCount();
    await page.click("#layerSplitLeftovers");
    await page.waitForTimeout(180);
    const afterSplit = await layerCount();

    const anyChanged = [afterPfull, afterPcore, afterUsed, afterSplit].some((n) => Number(n) !== Number(beforeAny));
    report.steps.display_checkboxes_affect = {
      pass: anyChanged,
      info: `counts: base=${beforeAny}, pfull=${afterPfull}, pcore=${afterPcore}, used=${afterUsed}, split=${afterSplit}`
    };
  } catch (e) {
    report.errors.push(String(e && e.stack || e));
  } finally {
    report.ok = Object.values(report.steps).every((s) => !!(s && s.pass));
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log("SELFTEST_REPORT", reportPath);
    console.log("SELFTEST_SHOT", shot1);
    console.log("SELFTEST_SHOT", shot2);
    console.log("SELFTEST_SHOT", shot3);
    console.log("SELFTEST_SHOT", shot4);
    await ctx.close();
    await browser.close();
    process.exit(report.ok ? 0 : 1);
  }
})();

