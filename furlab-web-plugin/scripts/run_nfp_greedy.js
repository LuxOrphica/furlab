#!/usr/bin/env node
/**
 * Харнесс для NFP Greedy: дёргает живой сервер через HTTP, как UI.
 *
 * Usage:
 *   node scripts/run_nfp_greedy.js [--url http://127.0.0.1:5600] [--zone-size 300]
 *                                   [--max-solve-ms 90000] [--out result.json]
 *
 * Шаги:
 *   1. GET /api/inventory/candidates  — получить список кандидатов
 *   2. POST /api/layout/modes/preview (inventory_nfp_sa) — запустить greedy
 *   3. Верифицировать placements, coverage, структуру ответа
 *   4. Вывести итог
 */
"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

// ── CLI args ──────────────────────────────────────────────────────────────────
function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : def;
}
const BASE_URL = arg("--url", process.env.SELFTEST_URL || "http://127.0.0.1:5600");
const ZONE_SIZE = Number(arg("--zone-size", 300));
const MAX_SOLVE_MS = Number(arg("--max-solve-ms", 90000));
const OUT_PATH = arg("--out", null);

// ── HTTP helper ───────────────────────────────────────────────────────────────
function request(urlStr, method, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === "https:" ? https : http;
    const payload = body ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
      }
    };
    const req = lib.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}\nBody: ${data.slice(0, 200)}`)); }
      });
    });
    req.on("error", reject);
    if (timeoutMs) req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout ${timeoutMs}ms`)));
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Test zone (synthetic square) ──────────────────────────────────────────────
function makeTestZone(size) {
  return {
    id: 1,
    points: [
      { x: 0, y: 0 },
      { x: size, y: 0 },
      { x: size, y: size },
      { x: 0, y: size }
    ]
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const ts = Date.now();
  const report = { baseUrl: BASE_URL, ts, steps: {}, errors: [], timings: {}, debug: {} };

  function pass(key, info) {
    report.steps[key] = { pass: true, info: String(info || "") };
    console.log(`  ✓ ${key}: ${info}`);
  }
  function fail(key, info) {
    report.steps[key] = { pass: false, info: String(info || "") };
    report.errors.push(`${key}: ${info}`);
    console.error(`  ✗ ${key}: ${info}`);
  }

  console.log(`\nNFP Greedy харнесс — ${BASE_URL}`);
  console.log(`  zone ${ZONE_SIZE}×${ZONE_SIZE}mm, maxSolveMs=${MAX_SOLVE_MS}\n`);

  // ── Step 0: server alive ──────────────────────────────────────────────────
  try {
    const r = await request(`${BASE_URL}/api/health`, "GET", null, 5000);
    pass("server_alive", `HTTP ${r.status}`);
  } catch (e) {
    fail("server_alive", e.message);
    console.error("\nСервер недоступен. Запустите: npm start\n");
    process.exit(1);
  }

  // ── Step 1: get candidates ───────────────────────────────────────────────
  console.log("1. /api/inventory/candidates...");
  const zone = makeTestZone(ZONE_SIZE);
  let candidates = [];
  let allCandidates = [];
  try {
    const t0 = Date.now();
    const r = await request(`${BASE_URL}/api/inventory/candidates`, "POST", {
      zone: { id: zone.id, points: zone.points, holes: [] },
      directInventory: true,
      onlyAvailable: true,
      includeScrapContour: true,
      napDirectionDeg: null,
      minAreaMm2: 0,
      maxCandidates: 300
    }, 30000);
    report.timings.candidatesMs = Date.now() - t0;

    if (!r.body || !r.body.ok) {
      fail("candidates", `not ok: ${r.body && r.body.error || r.status}`);
    } else {
      allCandidates = Array.isArray(r.body.items) ? r.body.items : [];
      candidates = allCandidates
        .filter((c) => c.scrapContour != null && c.scrapContour !== "")
        .map((c) => ({
          scrapPieceId: String(c.inventoryTag || c.id || ""),
          scrapContour: c.scrapContour,   // может быть строкой-JSON — сервер распарсит через parseScrapContourPoints
          napDirectionDeg: Number(c.napDirectionDeg || c.napDirection || 0),
          quantity: 1
        }));
      pass("candidates", `${allCandidates.length} всего, ${candidates.length} с контуром (${report.timings.candidatesMs}ms)`);
      report.debug.candidatesCount = allCandidates.length;
    }
  } catch (e) {
    fail("candidates", e.message);
  }

  if (!candidates.length) {
    console.log("\n  Нет кандидатов — дальнейший тест невозможен.");
    console.log("  Убедитесь, что в БД есть инвентарь (обрезки).\n");
    // Still proceed to test modes/preview with empty input
  }

  // ── Step 2: POST modes/preview ───────────────────────────────────────────
  console.log("2. POST /api/layout/modes/preview (inventory_nfp_sa)...");
  const progressToken = `nfp_harness_${ts}`;
  let previewRes = null;
  try {
    const t0 = Date.now();
    const r = await request(`${BASE_URL}/api/layout/modes/preview`, "POST", {
      layoutType: "inventory_nfp_sa",
      zone: { id: zone.id, points: zone.points, holes: [] },
      inputs: { candidates },
      progressToken,
      options: {
        maxSolveMs: MAX_SOLVE_MS,
        seed: ts,
        allowanceMm: 12,
        napTarget: 0,
        napTol: 15,
        minWidthMm: 0,
        minLengthMm: 0,
        allowThinPlacements: true
      }
    }, MAX_SOLVE_MS + 90000);
    report.timings.previewMs = Date.now() - t0;
    previewRes = r.body;

    if (r.status !== 200) {
      fail("preview_http", `HTTP ${r.status}`);
    } else if (!previewRes || previewRes.ok !== true) {
      fail("preview_ok", `ok=${previewRes && previewRes.ok}, error=${previewRes && previewRes.error}`);
    } else {
      pass("preview_ok", `ok=true (${report.timings.previewMs}ms)`);
    }
  } catch (e) {
    fail("preview_request", e.message);
  }

  // ── Step 3: verify result structure ────────────────────────────────────
  if (previewRes && previewRes.ok) {
    console.log("3. Верифицируем структуру ответа...");

    const items = Array.isArray(previewRes.render && previewRes.render.items) ? previewRes.render.items : [];
    const stats = previewRes.stats || {};
    const covRatio = Number(stats.coveredRatio || previewRes.coveragePercent / 100 || 0);
    const covPct = (covRatio * 100).toFixed(1);

    report.debug.placementsCount = items.length;
    report.debug.coveragePct = Number(covPct);
    report.debug.resultStatus = previewRes.resultStatus;
    report.debug.stats = stats;

    console.log(`   placements=${items.length}, coverage=${covPct}%, status=${previewRes.resultStatus}`);

    if (items.length > 0) {
      pass("has_placements", `${items.length} штук`);
    } else if (!candidates.length) {
      pass("has_placements", "0 (нет кандидатов — ожидаемо)");
    } else {
      fail("has_placements", "0 placements при наличии кандидатов");
    }

    if (covRatio >= 0.5 || !candidates.length) {
      pass("coverage_ok", `${covPct}%`);
    } else {
      fail("coverage_ok", `${covPct}% < 50%`);
    }

    // Check each placement has required fields
    const badItems = items.filter((it) => {
      return !Array.isArray(it.contour) || it.contour.length < 3;
    });
    if (badItems.length > 0) {
      fail("placement_contours", `${badItems.length} placements без contour`);
    } else if (items.length > 0) {
      pass("placement_contours", "все placements имеют contour");
    }

    // Check alignedCoreContour (needed for step 2 — avoids ensureManualPlacementsCoreContours API calls)
    const noCoreContour = items.filter((it) => !Array.isArray(it.alignedCoreContour) || it.alignedCoreContour.length < 3);
    if (noCoreContour.length > 0) {
      fail("aligned_core_contour", `${noCoreContour.length}/${items.length} без alignedCoreContour — step 2 будет делать API-запросы!`);
    } else if (items.length > 0) {
      pass("aligned_core_contour", `все ${items.length} placements имеют alignedCoreContour`);
    }

    // Check candidatePool (unused candidates)
    const placedTags = new Set(items.map((it) => String(it.meta && it.meta.inventoryTag || it.id || "")));
    const unusedCount = allCandidates.filter((c) => !placedTags.has(String(c.inventoryTag || c.id || ""))).length;
    pass("candidate_pool", `${unusedCount} неиспользованных кандидатов → лоток`);
    report.debug.unusedCandidates = unusedCount;

    console.log(`\n  Результат: ${items.length} кусков, покрытие ${covPct}%, лоток: ${unusedCount} кандидатов`);
    console.log(`  Время: candidates=${report.timings.candidatesMs}ms, preview=${report.timings.previewMs}ms`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const allPass = Object.values(report.steps).every((s) => s.pass);
  report.summary = {
    allPass,
    passed: Object.values(report.steps).filter((s) => s.pass).length,
    total: Object.values(report.steps).length,
    errors: report.errors.length
  };

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Итог: ${report.summary.passed}/${report.summary.total} проверок прошли — ${allPass ? "OK ✓" : "FAIL ✗"}`);
  if (report.errors.length) {
    console.log(`Ошибки:`);
    report.errors.forEach((e) => console.log(`  • ${e}`));
  }

  if (OUT_PATH || !allPass) {
    const outFile = OUT_PATH || path.join(process.cwd(), `tmp/nfp_greedy_run_${ts}.json`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
    console.log(`Отчёт: ${outFile}`);
  }
  console.log(`${"─".repeat(60)}\n`);

  process.exit(allPass ? 0 : 1);
})();
