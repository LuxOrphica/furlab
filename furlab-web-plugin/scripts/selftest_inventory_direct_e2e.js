#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const BASE_URL = process.env.SELFTEST_URL || "http://127.0.0.1:5600";
const OUT_DIR = path.join(process.cwd(), "tmp", "selftest");
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

fs.mkdirSync(OUT_DIR, { recursive: true });

function numText(text) {
  const m = String(text || "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

(async () => {
  const ts = Date.now();
  const reportPath = path.join(OUT_DIR, `inventory_direct_e2e_${ts}.json`);
  const shot1 = path.join(OUT_DIR, `inventory_direct_e2e_${ts}_01_step2.png`);
  const shot2 = path.join(OUT_DIR, `inventory_direct_e2e_${ts}_02_applied.png`);
  const shot3 = path.join(OUT_DIR, `inventory_direct_e2e_${ts}_03_reports.png`);

  const report = {
    baseUrl: BASE_URL,
    ts,
    steps: {
      step1_to_step2_open: { pass: false, info: "" },
      preview_requested: { pass: false, info: "" },
      preview_has_result: { pass: false, info: "" },
      apply_commits_layout: { pass: false, info: "" },
      reports_open: { pass: false, info: "" }
    },
    routeHits: { candidates: 0, preview: 0, apply: 0 },
    artifacts: { shot1, shot2, shot3 },
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
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const zone = [
        { x: 620, y: 180 },
        { x: 780, y: 180 },
        { x: 780, y: 340 },
        { x: 620, y: 340 }
      ];
      state.details = [{ id: 1, bbox: { minX: 620, minY: 180, maxX: 780, maxY: 340 }, entity: null }];
      state.zones = [{ id: 1, detailId: 1, name: "Зона 1", points: zone }];
      state.selectedZoneId = 1;
      state.selectedDetailId = 1;
      state.layoutMode = "inventory";
      state.layoutRun = state.layoutRun || {};
      state.layoutRun.allowanceMm = 12;
      renderScene();
    });

    const layoutsTab = page.locator("#layoutModeSwitch button[data-panel='layouts']");
    if (await layoutsTab.count()) await layoutsTab.click();
    await page.click("#detailZoneTree .layout-add-btn");
    await page.waitForSelector("#layoutTypeBackdrop", { state: "visible", timeout: 10000 });
    await page.click("#layoutTypeGrid .layout-type-card[data-mode='inventory']");
    await page.click("#layoutTypeAddBtn");
    await page.waitForTimeout(250);

    await page.click("#inventoryPickBtn");
    await page.waitForSelector("#inventoryStep1Backdrop", { state: "visible", timeout: 10000 });
    await page.evaluate(() => {
      const limitEl = document.getElementById("invLimit");
      const minAreaEl = document.getElementById("invMinArea");
      const napTolEl = document.getElementById("invNapTol");
      if (limitEl) limitEl.value = "5";
      if (minAreaEl) minAreaEl.value = "5000";
      if (napTolEl) napTolEl.value = "5";
    });
    await page.click("#inventoryStep1RunBtn");
    await page.waitForSelector("#inventoryStep2Backdrop", { state: "visible", timeout: 90000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot1, fullPage: true });

    report.steps.step1_to_step2_open = {
      pass: true,
      info: "Step 2 открыт после запуска Step 1"
    };
    report.steps.preview_requested = {
      pass: report.routeHits.candidates > 0 && report.routeHits.preview > 0,
      info: `candidates=${report.routeHits.candidates}, preview=${report.routeHits.preview}`
    };

    const previewState = await page.evaluate(() => {
      const lr = state && state.layoutRun ? state.layoutRun : {};
      return {
        fragments: Array.isArray(lr.fragments) ? lr.fragments.length : 0,
        placements: Array.isArray(lr.placements) ? lr.placements.length : 0,
        resultStatus: String(lr.resultStatus || ""),
        status: String(lr.status || ""),
        coverage: Number((document.getElementById("invCoveragePercent") || {}).textContent || 0),
        residual: Number((document.getElementById("invResidualArea") || {}).textContent || 0)
      };
    });
    const coverageText = await page.locator("#invCoveragePercent").innerText().catch(() => "");
    const fragmentsText = await page.locator("#invTotalFragments").innerText().catch(() => "");
    report.steps.preview_has_result = {
      pass: previewState.fragments > 0 || previewState.placements > 0 || /ok|needs_attention|failed/i.test(previewState.resultStatus),
      info: `fragments=${previewState.fragments}, placements=${previewState.placements}, resultStatus=${previewState.resultStatus}, status=${previewState.status}, coverage=${coverageText}, totalFragments=${fragmentsText}`
    };
    report.debug.preview = {
      coveragePercent: numText(coverageText),
      totalFragments: numText(fragmentsText),
      ...previewState
    };

    await page.click("#inventoryStep2ApplyBtn");
    await page.waitForSelector("#inventoryStep2Backdrop", { state: "hidden", timeout: 10000 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: shot2, fullPage: true });

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
        (appliedState.fragments > 0 || appliedState.placements > 0),
      info: `status=${appliedState.status}, fragments=${appliedState.fragments}, placements=${appliedState.placements}, applyHits=${report.routeHits.apply}, serverApplyOk=${appliedState.serverApplyOk}, serverApplyType=${appliedState.serverApplyType}`
    };

    const reportsBtn = page.locator("#reportsBtn");
    const reportsDisabled = await reportsBtn.isDisabled().catch(() => true);
    if (!reportsDisabled) {
      await reportsBtn.click();
      await page.waitForSelector("#reportsBackdrop", { state: "visible", timeout: 10000 });
      await page.waitForTimeout(250);
      await page.screenshot({ path: shot3, fullPage: true });
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
    await ctx.close();
    await browser.close();
    process.exit(report.ok ? 0 : 1);
  }
})();
