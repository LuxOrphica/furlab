#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const BASE_URL = process.env.SELFTEST_URL || "http://127.0.0.1:5601";
const OUT_DIR = path.join(process.cwd(), "tmp", "selftest");
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

async function main() {
  ensureDir(OUT_DIR);
  const log = {
    startedAt: nowIso(),
    baseUrl: BASE_URL,
    checks: {},
    consoleErrors: [],
    pageErrors: [],
    screenshots: [],
    poolFunnel: null,
    assignRequest: null,
    assignResponse: null
  };

  const browser = await chromium.launch({
    executablePath: EDGE_PATH,
    headless: true
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") log.consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    log.pageErrors.push(String(err && err.message || err));
  });
  page.on("response", async (resp) => {
    try {
      const u = String(resp.url() || "");
      if (!u.includes("/api/inventory/candidates")) return;
      const j = await resp.json();
      if (j && j.ok && j.poolFunnel) log.poolFunnel = j.poolFunnel;
    } catch (_) {}
  });
  page.on("request", (req) => {
    try {
      const u = String(req.url() || "");
      if (!u.includes("/api/layout/fill/preview") || req.method() !== "POST") return;
      const body = JSON.parse(req.postData() || "{}");
      if (body && body.assignOnly === true && String(body.fillType || "") === "regular") {
        log.assignRequest = body;
      }
    } catch (_) {}
  });
  page.on("response", async (resp) => {
    try {
      const u = String(resp.url() || "");
      if (!u.includes("/api/layout/fill/preview")) return;
      const req = resp.request();
      if (!req || req.method() !== "POST") return;
      const body = JSON.parse(req.postData() || "{}");
      if (!(body && body.assignOnly === true && String(body.fillType || "") === "regular")) return;
      const j = await resp.json();
      if (j && j.ok) log.assignResponse = j;
    } catch (_) {}
  });

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(500);

    const hasApi = await page.evaluate(() => {
      return typeof state === "object"
        && typeof byId === "function"
        && typeof openInventoryStep1 === "function";
    });
    if (!hasApi) throw new Error("UI API not ready (window.state/byId/openInventoryStep1 missing)");

    await page.evaluate(() => {
      const rect = [
        { x: 200, y: 120 },
        { x: 980, y: 120 },
        { x: 980, y: 860 },
        { x: 200, y: 860 }
      ];
      if (!Array.isArray(state.zones)) state.zones = [];
      state.zones = [{ id: 9001, name: "SELFTEST_ZONE", detailId: null, points: rect }];
      state.selectedZoneId = 9001;
      state.layoutMode = "intarsia";
      state.layoutRun = {
        active: false,
        status: "idle",
        selectedZoneId: 9001,
        fragments: [],
        placements: [],
        previewLayers: { pieceIntersections: [], visibleArea: [] },
        stats: { violations: 0, intersections: 0, uncovered: 0 }
      };
      openInventoryStep1();
      byId("fillType").value = "regular";
      byId("fillRows").value = "5";
      byId("fillCols").value = "5";
      byId("fillGapX").value = "4";
      byId("fillGapY").value = "4";
      byId("fillCornerRadius").value = "4";
      syncFillTypeUi();
      setIntarsiaStepPhase(1);
      previewIntarsiaFragmentsDraft();
      renderScene();
    });

    const beforeGeom = await page.evaluate(() => {
      const fr = Array.isArray(state.layoutRun && state.layoutRun.fragments) ? state.layoutRun.fragments : [];
      const idx = Math.min(fr.length - 1, 12);
      const poly = fr[idx] && Array.isArray(fr[idx].points) ? fr[idx].points.slice(0, 4) : [];
      return JSON.stringify(poly);
    });
    await page.fill("#fillGapX", "12");
    await page.dispatchEvent("#fillGapX", "input");
    await page.waitForTimeout(500);
    const afterGeom = await page.evaluate(() => {
      const fr = Array.isArray(state.layoutRun && state.layoutRun.fragments) ? state.layoutRun.fragments : [];
      const idx = Math.min(fr.length - 1, 12);
      const poly = fr[idx] && Array.isArray(fr[idx].points) ? fr[idx].points.slice(0, 4) : [];
      return JSON.stringify(poly);
    });
    log.checks.live_preview_without_blur = {
      beforeGeom,
      afterGeom,
      changed: beforeGeom !== afterGeom
    };

    const s1 = path.join(OUT_DIR, "01_step1_open.png");
    await page.screenshot({ path: s1, fullPage: true });
    log.screenshots.push(s1);

    await page.locator("#inventoryStep1RunBtn").click();
    await page.waitForTimeout(800);

    const fragmentsAfterStep1 = await page.evaluate(() => {
      return Array.isArray(state.layoutRun && state.layoutRun.fragments)
        ? state.layoutRun.fragments.length
        : 0;
    });
    const step2Enabled = await page.evaluate(() => {
      const b = byId("inventoryStep1IntarsiaAssignBtn");
      return !!(b && !b.disabled);
    });
    log.checks.step1_to_step2 = {
      fragmentsAfterStep1,
      step2Enabled
    };

    const s2 = path.join(OUT_DIR, "02_after_step1.png");
    await page.screenshot({ path: s2, fullPage: true });
    log.screenshots.push(s2);

    await page.locator("#inventoryStep1IntarsiaAssignBtn").click();
    await page.waitForSelector("#inventoryStep2Backdrop", { state: "visible", timeout: 60000 });
    await page.waitForTimeout(1000);

    const step2Data = await page.evaluate(() => {
      const txt = (id) => String((byId(id) && byId(id).textContent) || "").trim();
      const num = (id) => {
        const t = txt(id).replace(",", ".");
        const v = Number(t);
        return Number.isFinite(v) ? v : NaN;
      };
      return {
        dbCandidates: num("invDbCandidates"),
        compatibleCandidates: num("invCompatibleCandidates"),
        totalFragments: num("invTotalFragments"),
        coveragePct: num("invCoveragePercent"),
        diagnostics: txt("invDebugInfo")
      };
    });
    log.checks.step2_assign = step2Data;

    const s3 = path.join(OUT_DIR, "03_step2_result.png");
    await page.screenshot({ path: s3, fullPage: true });
    log.screenshots.push(s3);
  } finally {
    await context.close();
    await browser.close();
    log.finishedAt = nowIso();
    const outJson = path.join(OUT_DIR, "intarsia_ui_selftest.json");
    fs.writeFileSync(outJson, JSON.stringify(log, null, 2), "utf8");
    if (log.poolFunnel) {
      const outFunnel = path.join(OUT_DIR, "intarsia_pool_funnel.json");
      fs.writeFileSync(outFunnel, JSON.stringify(log.poolFunnel, null, 2), "utf8");
      console.log(`SELFTEST_POOL_FUNNEL ${outFunnel}`);
    }
    console.log(`SELFTEST_REPORT ${outJson}`);
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
