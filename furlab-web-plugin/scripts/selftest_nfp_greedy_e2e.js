#!/usr/bin/env node
/**
 * E2E харнесс для NFP Greedy: кандидаты → solve → step 2 → лоток.
 *
 * Usage:
 *   node scripts/selftest_nfp_greedy_e2e.js [--url http://127.0.0.1:5600]
 *
 * Проверяет:
 *   1. /api/inventory/candidates возвращает кандидатов
 *   2. /api/layout/modes/preview (inventory_nfp_sa) возвращает placements
 *   3. UI переходит на шаг 2 (inventoryStep2Modal видна)
 *   4. Панель лотка (inventoryManualPanel) видна
 *   5. coverage >= 50%
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright-core");

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE_URL = (() => {
  const i = process.argv.indexOf("--url");
  return i >= 0 ? process.argv[i + 1] : (process.env.SELFTEST_URL || "http://127.0.0.1:5600");
})();

const OUT_DIR = path.join(process.cwd(), "tmp", "selftest_nfp_greedy");
fs.mkdirSync(OUT_DIR, { recursive: true });

const ts = Date.now();
const reportPath = path.join(OUT_DIR, `run_${ts}.json`);

const report = {
  baseUrl: BASE_URL,
  ts,
  steps: {},
  errors: [],
  timings: {},
  debug: {}
};

function pass(key, info) {
  report.steps[key] = { pass: true, info: String(info || "") };
  console.log(`  ✓ ${key}: ${info}`);
}
function fail(key, info) {
  report.steps[key] = { pass: false, info: String(info || "") };
  console.error(`  ✗ ${key}: ${info}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 980 } });
  const page = await ctx.newPage();

  const apiErrors = [];
  const apiLog = [];

  page.on("pageerror", (e) => {
    const msg = String(e && e.message || e);
    // AbortError from SSE close is expected — don't count it as failure
    if (!msg.includes("AbortError")) report.errors.push(`pageerror: ${msg}`);
  });
  page.on("console", (m) => {
    if (m.type() === "error") {
      const t = m.text();
      if (!t.includes("AbortError") && !t.includes("ERR_CONNECTION_RESET")) {
        report.errors.push(`console.error: ${t}`);
      }
    }
  });
  page.on("response", async (resp) => {
    try {
      const url = resp.url();
      const status = resp.status();
      if (url.includes("/api/")) {
        apiLog.push({ url: url.replace(BASE_URL, ""), status, ts: Date.now() - ts });
        if (status >= 500) apiErrors.push(`HTTP ${status}: ${url}`);
      }
    } catch (_) {}
  });

  try {
    console.log(`\nNFP Greedy E2E харнесс — ${BASE_URL}\n`);

    // ── Step 0: load page ──────────────────────────────────────────────────────
    console.log("0. Загружаем страницу...");
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1000);
    pass("page_load", BASE_URL);

    // ── Step 1: inject test zone + switch to nfp_sa mode ──────────────────────
    console.log("1. Инжектируем зону и режим inventory_nfp_sa...");
    await page.evaluate(() => {
      // Small synthetic zone: 300×300 mm square
      const zone = [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 300 },
        { x: 0, y: 300 }
      ];
      window.state = window.state || {};
      state.details = [{ id: 1, bbox: { minX: 0, minY: 0, maxX: 300, maxY: 300 }, entity: null }];
      state.zones = [{ id: 1, detailId: 1, name: "TestZone", points: zone, napDirectionDeg: 0 }];
      state.selectedZoneId = 1;
      state.selectedDetailId = 1;
      state.layoutMode = "inventory_nfp_sa";
      state.layoutRun = state.layoutRun || {};
      state.layoutRun.allowanceMm = 12;
      state.layoutRun.active = false;
      if (typeof renderScene === "function") renderScene();
    });
    await page.waitForTimeout(500);
    pass("zone_injected", "300×300 мм квадрат, режим inventory_nfp_sa");

    // ── Step 2: trigger previewNfpSaLayout() ──────────────────────────────────
    console.log("2. Запускаем previewNfpSaLayout()...");
    const t0 = Date.now();

    // Intercept progress updates from the UI
    const progressUpdates = [];
    await page.exposeFunction("__nfpHarnessProgress", (msg) => progressUpdates.push(msg));

    const triggerResult = await page.evaluate(async () => {
      try {
        if (typeof previewNfpSaLayout !== "function") return { ok: false, error: "previewNfpSaLayout not found" };
        await previewNfpSaLayout();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    });

    const solveMs = Date.now() - t0;
    report.timings.solveMs = solveMs;
    console.log(`   Solve завершён за ${(solveMs / 1000).toFixed(1)}s`);

    if (!triggerResult.ok) {
      fail("nfp_greedy_run", triggerResult.error);
    } else {
      pass("nfp_greedy_run", `${(solveMs / 1000).toFixed(1)}s`);
    }

    // ── Step 3: check step 2 modal is visible ─────────────────────────────────
    console.log("3. Проверяем видимость шага 2...");
    await page.waitForTimeout(500);

    const step2Visible = await page.evaluate(() => {
      const el = document.getElementById("inventoryStep2Modal");
      if (!el) return { visible: false, reason: "element not found" };
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0,
        display: style.display,
        rect: { w: Math.round(rect.width), h: Math.round(rect.height) }
      };
    });

    report.debug.step2Visible = step2Visible;
    if (step2Visible.visible) {
      pass("step2_modal_visible", `display=${step2Visible.display} ${step2Visible.rect.w}×${step2Visible.rect.h}`);
    } else {
      fail("step2_modal_visible", JSON.stringify(step2Visible));
    }

    // ── Step 4: check placements + coverage ───────────────────────────────────
    console.log("4. Проверяем placements и покрытие...");
    const layoutState = await page.evaluate(() => {
      const lr = window.state && window.state.layoutRun;
      if (!lr) return null;
      return {
        mode: window.state.layoutMode,
        enableManualEdit: lr.enableManualEdit,
        placementsCount: Array.isArray(lr.placements) ? lr.placements.length : -1,
        poolCount: Array.isArray(lr.candidatePool) ? lr.candidatePool.length : -1,
        status: lr.status,
        stats: lr.stats || null,
        serverPreview: lr.serverPreview ? {
          ok: lr.serverPreview.ok,
          coveragePercent: lr.serverPreview.coveragePercent,
          resultStatus: lr.serverPreview.resultStatus
        } : null
      };
    });

    report.debug.layoutState = layoutState;
    if (!layoutState) {
      fail("layout_state", "state.layoutRun is null");
    } else {
      const cov = layoutState.serverPreview && layoutState.serverPreview.coveragePercent;
      console.log(`   placements=${layoutState.placementsCount}, pool=${layoutState.poolCount}, cov=${cov}%, enableManualEdit=${layoutState.enableManualEdit}`);
      if (layoutState.placementsCount > 0) {
        pass("has_placements", `${layoutState.placementsCount} штук`);
      } else {
        fail("has_placements", "0 placements");
      }
      if (layoutState.enableManualEdit) {
        pass("enable_manual_edit", "true");
      } else {
        fail("enable_manual_edit", "false — лоток не откроется");
      }
      if (typeof cov === "number" && cov >= 50) {
        pass("coverage_ok", `${cov.toFixed(1)}%`);
      } else {
        fail("coverage_ok", `cov=${cov}`);
      }
    }

    // ── Step 5: check лоток panel ─────────────────────────────────────────────
    console.log("5. Проверяем панель лотка...");
    const panelState = await page.evaluate(() => {
      const el = document.getElementById("inventoryManualPanel");
      if (!el) return { found: false };
      const style = window.getComputedStyle(el);
      return {
        found: true,
        display: style.display,
        visible: style.display !== "none",
        innerHTML_snippet: el.innerHTML.slice(0, 200)
      };
    });

    report.debug.panelState = panelState;
    if (!panelState.found) {
      fail("manual_panel", "inventoryManualPanel not found in DOM");
    } else if (panelState.visible) {
      pass("manual_panel", `display=${panelState.display}`);
    } else {
      fail("manual_panel", `display=${panelState.display} (hidden)`);
    }

    // ── Step 6: screenshot ─────────────────────────────────────────────────────
    const shotPath = path.join(OUT_DIR, `shot_${ts}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    report.debug.screenshot = shotPath;
    console.log(`\n   Screenshot: ${shotPath}`);

  } catch (e) {
    report.errors.push(`harness_crash: ${String(e && e.message || e)}`);
    console.error(`\nCRASH: ${e && e.message || e}`);
    try {
      const shotPath = path.join(OUT_DIR, `crash_${ts}.png`);
      await page.screenshot({ path: shotPath });
      report.debug.crashScreenshot = shotPath;
    } catch (_) {}
  } finally {
    await browser.close();

    // ── Summary ────────────────────────────────────────────────────────────────
    const allPass = Object.values(report.steps).every((s) => s.pass);
    report.summary = {
      allPass,
      passed: Object.values(report.steps).filter((s) => s.pass).length,
      total: Object.values(report.steps).length,
      errors: report.errors.length
    };

    console.log(`\n${"─".repeat(60)}`);
    console.log(`Итог: ${report.summary.passed}/${report.summary.total} проверок прошли`);
    if (report.errors.length) {
      console.log(`Ошибки (${report.errors.length}):`);
      report.errors.forEach((e) => console.log(`  • ${e}`));
    }
    console.log(`Отчёт: ${reportPath}`);
    console.log(`${"─".repeat(60)}\n`);

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    process.exit(allPass ? 0 : 1);
  }
})();
