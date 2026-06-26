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
  const ts = Date.now();
  const reportPath = path.join(OUT_DIR, `intarsia_e2e_${ts}.json`);
  const shot1 = path.join(OUT_DIR, `intarsia_e2e_${ts}_01_step1.png`);
  const shot2 = path.join(OUT_DIR, `intarsia_e2e_${ts}_02_step2.png`);
  const shot3 = path.join(OUT_DIR, `intarsia_e2e_${ts}_03_applied.png`);
  const shot4 = path.join(OUT_DIR, `intarsia_e2e_${ts}_04_reports.png`);

  const report = {
    baseUrl: BASE_URL,
    ts,
    steps: {
      step1_fragments_generated: { pass: false, info: "" },
      step2_assign_open: { pass: false, info: "" },
      preview_has_result: { pass: false, info: "" },
      apply_commits_layout: { pass: false, info: "" },
      reports_open: { pass: false, info: "" }
    },
    routeHits: { candidates: 0, preview: 0, apply: 0 },
    artifacts: { shot1, shot2, shot3, shot4 },
    debug: {},
    errors: []
  };

  const browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 980 } });
  const page = await ctx.newPage();

  page.on("pageerror", (e) => report.errors.push(`pageerror: ${String(e && e.message || e)}`));
  page.on("console", (m) => {
    if (m.type() === "error") report.errors.push(`console.error: ${m.text()}`);
  });
  page.on("request", (req) => {
    try {
      const method = String(req.method() || "").toUpperCase();
      const url = String(req.url() || "");
      if (method !== "POST") return;
      if (url.includes("/api/inventory/candidates")) report.routeHits.candidates += 1;
      if (url.includes("/api/layout/fill/preview")) report.routeHits.preview += 1;
      if (url.includes("/api/layout/modes/apply")) report.routeHits.apply += 1;
    } catch (_) {}
  });

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const zone = [
        { x: 620, y: 180 },
        { x: 900, y: 180 },
        { x: 900, y: 420 },
        { x: 620, y: 420 }
      ];
      state.details = [{ id: 1, bbox: { minX: 620, minY: 180, maxX: 900, maxY: 420 }, entity: null }];
      state.zones = [{ id: 1, detailId: 1, name: "Зона 1", points: zone }];
      state.selectedZoneId = 1;
      state.selectedDetailId = 1;
      state.layoutMode = "intarsia";
      state.layoutRun = state.layoutRun || {};
      state.layoutRun.allowanceMm = 12;
      renderScene();
    });

    const layoutsTab = page.locator("#layoutModeSwitch button[data-panel='layouts']");
    if (await layoutsTab.count()) await layoutsTab.click();
    await page.click("#detailZoneTree .layout-add-btn");
    await page.waitForSelector("#layoutTypeBackdrop", { state: "visible", timeout: 10000 });
    await page.click("#layoutTypeGrid .layout-type-card[data-mode='intarsia']");
    await page.click("#layoutTypeAddBtn");
    await page.waitForTimeout(250);

    await page.click("#inventoryPickBtn");
    await page.waitForSelector("#inventoryStep1Backdrop", { state: "visible", timeout: 10000 });
    await page.evaluate(() => {
      const rowsEl = document.getElementById("fillRows");
      const colsEl = document.getElementById("fillCols");
      const gapXEl = document.getElementById("fillGapX");
      const gapYEl = document.getElementById("fillGapY");
      const limitEl = document.getElementById("invLimit");
      const minAreaEl = document.getElementById("invMinArea");
      if (rowsEl) rowsEl.value = "4";
      if (colsEl) colsEl.value = "4";
      if (gapXEl) gapXEl.value = "4";
      if (gapYEl) gapYEl.value = "4";
      if (limitEl) limitEl.value = "8";
      if (minAreaEl) minAreaEl.value = "5000";
    });

    await page.click("#inventoryStep1RunBtn");
    await page.waitForTimeout(800);
    await page.screenshot({ path: shot1, fullPage: true });

    const step1State = await page.evaluate(() => {
      const lr = state && state.layoutRun ? state.layoutRun : {};
      const assignBtn = document.getElementById("inventoryStep1IntarsiaAssignBtn");
      return {
        fragments: Array.isArray(lr.fragments) ? lr.fragments.length : 0,
        assignVisible: !!(assignBtn && assignBtn.style.display !== "none"),
        assignDisabled: !!(assignBtn && assignBtn.disabled)
      };
    });
    report.steps.step1_fragments_generated = {
      pass: step1State.fragments > 0 && step1State.assignVisible && !step1State.assignDisabled,
      info: `fragments=${step1State.fragments}, assignVisible=${step1State.assignVisible}, assignDisabled=${step1State.assignDisabled}`
    };

    await page.click("#inventoryStep1IntarsiaAssignBtn");
    await page.waitForSelector("#inventoryStep2Backdrop", { state: "visible", timeout: 90000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot2, fullPage: true });

    report.steps.step2_assign_open = {
      pass: true,
      info: `candidates=${report.routeHits.candidates}, preview=${report.routeHits.preview}`
    };

    await page.waitForFunction(() => {
      const lr = state && state.layoutRun ? state.layoutRun : {};
      const debugText = String((document.getElementById("invDebugInfo") || {}).textContent || "");
      return (
        (Array.isArray(lr.placements) && lr.placements.length > 0) ||
        (Array.isArray(lr.matchedFragmentGeometry) && lr.matchedFragmentGeometry.length > 0) ||
        (typeof lr.resultStatus === "string" && lr.resultStatus.trim() !== "") ||
        /^Ошибка:/i.test(debugText)
      );
    }, { timeout: 180000 });

    const previewState = await page.evaluate(() => {
      const lr = state && state.layoutRun ? state.layoutRun : {};
      return {
        fragments: Array.isArray(lr.fragments) ? lr.fragments.length : 0,
        placements: Array.isArray(lr.placements) ? lr.placements.length : 0,
        resultStatus: String(lr.resultStatus || ""),
        status: String(lr.status || ""),
        matchedGeometry: Array.isArray(lr.matchedFragmentGeometry) ? lr.matchedFragmentGeometry.length : 0,
        coverage: Number((document.getElementById("invCoveragePercent") || {}).textContent || 0),
        debug: String((document.getElementById("invDebugInfo") || {}).textContent || "")
      };
    });
    report.steps.preview_has_result = {
      pass: previewState.fragments > 0 &&
        (previewState.placements > 0 || previewState.matchedGeometry > 0) &&
        /ok|needs_attention|failed/i.test(previewState.resultStatus),
      info: `fragments=${previewState.fragments}, placements=${previewState.placements}, matchedGeometry=${previewState.matchedGeometry}, resultStatus=${previewState.resultStatus}, status=${previewState.status}, coverage=${previewState.coverage}, debug=${previewState.debug}`
    };
    report.debug.preview = previewState;

    await page.click("#inventoryStep2ApplyBtn");
    await page.waitForSelector("#inventoryStep2Backdrop", { state: "hidden", timeout: 10000 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: shot3, fullPage: true });

    const appliedState = await page.evaluate(() => {
      const lr = state && state.layoutRun ? state.layoutRun : {};
      return {
        status: String(lr.status || ""),
        fragments: Array.isArray(lr.fragments) ? lr.fragments.length : 0,
        placements: Array.isArray(lr.placements) ? lr.placements.length : 0,
        serverApplyOk: !!(lr.serverApply && lr.serverApply.ok === true),
        serverApplyType: String(lr.serverApply && lr.serverApply.layoutType || "")
      };
    });
    report.steps.apply_commits_layout = {
      pass: appliedState.status === "applied" &&
        appliedState.serverApplyOk === true &&
        report.routeHits.apply > 0 &&
        appliedState.fragments > 0,
      info: `status=${appliedState.status}, fragments=${appliedState.fragments}, placements=${appliedState.placements}, applyHits=${report.routeHits.apply}, serverApplyOk=${appliedState.serverApplyOk}, serverApplyType=${appliedState.serverApplyType}`
    };

    const reportsBtn = page.locator("#reportsBtn");
    const reportsDisabled = await reportsBtn.isDisabled().catch(() => true);
    if (!reportsDisabled) {
      await reportsBtn.click();
      await page.waitForSelector("#reportsBackdrop", { state: "visible", timeout: 10000 });
      await page.waitForTimeout(250);
      await page.screenshot({ path: shot4, fullPage: true });
      const detailTabs = await page.locator("#reportsDetailTabs .reports-detail-tab").count().catch(() => 0);
      const rows = await page.locator("#reportsTableBody tr").count().catch(() => 0);
      report.steps.reports_open = {
        pass: detailTabs > 0 || rows > 0,
        info: `detailTabs=${detailTabs}, rows=${rows}`
      };
    } else {
      report.steps.reports_open = {
        pass: false,
        info: "reportsBtn disabled after apply"
      };
    }
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
