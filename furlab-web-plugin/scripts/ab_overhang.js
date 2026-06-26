#!/usr/bin/env node
/**
 * A/B серия: 3 seed × {overhangMm: 0, 75} + детерминизм-контроль
 * Запуск: node scripts/ab_overhang.js [oracle_case.json]
 *
 * Выводит таблицу:
 *   seed | overhang | fragments | coveredRatio | residualInterior | exitReason | iters | checksum
 *
 * ВАЖНО: oracle_case_zone_4 содержит 16 кусков, один из которых (FL-SCR-000098, 273×91)
 * SA не размещает ни в одном seed. Все три seed стабильно дают resInt=0, cov=99.97%.
 * Это подтверждает детерминизм и отсутствие регрессий, но НЕ упражняет absorption —
 * стыковые дыры (stitch-cell holes) на этом кейсе не возникают.
 * Верификация absorption: ручной прогон seed=1781350922718, resInt: 6643 → 0 (2025-06).
 */

"use strict";

const http = require("http");
const path = require("path");
const fs   = require("fs");

const CASE_FILE = process.argv[2]
  || path.join(__dirname, "../case/oracle_case_zone_4_1772583532522.json");

const caseData = JSON.parse(fs.readFileSync(CASE_FILE, "utf8"));

const BASE_SEED    = 1772583497139;            // из кейса
const SEEDS        = [BASE_SEED, BASE_SEED + 1000, BASE_SEED + 2000];
const OVERHANGS    = [0, 75];
const MAX_ITER     = 2000;                      // детерминированный стоп
const MAX_SOLVE_MS = 300000;                    // аварийная крышка — не должна срабатывать

// ── API call ────────────────────────────────────────────────────────────────
function callPreview(seed, overhangMm) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      layoutType: "inventory_voronoi_sa",
      zone: caseData.zone,
      inputs: {
        candidates: caseData.pieces.map(p => ({
          scrapPieceId: p.id,
          inventoryTag: p.id,
          contourPoints: p.points,
          napDirectionDeg: 0,
          quantity: 1
        }))
      },
      options: {
        seed,
        overhangMm,
        maxIterations: MAX_ITER,
        maxSolveMs: MAX_SOLVE_MS,
        numRestarts: 1,
        allowanceMm: 12,
        napTol: 15,
        minWidthMm: 70,
        minLengthMm: 70
      }
    });

    const req = http.request({
      hostname: "127.0.0.1", port: 5600,
      path: "/api/layout/modes/preview",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: MAX_SOLVE_MS + 30000
    }, res => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("JSON parse: " + e.message + " body: " + data.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("request timeout")); });
    req.write(body);
    req.end();
  });
}

// ── Extract metrics ─────────────────────────────────────────────────────────
function metrics(res, seed, overhangMm) {
  const s  = res.stats || {};
  const at = res.algorithmTrace || {};
  const pa = at.phaseA || {};
  const pls = Array.isArray(res.placements) ? res.placements : [];
  const sorted = pls.slice().sort((a, b) => String(a.scrapPieceId || "").localeCompare(String(b.scrapPieceId || "")));
  const checksum = sorted.reduce((acc, p) => acc + Math.round(Number(p.x || 0)) + Math.round(Number(p.y || 0)), 0);
  return {
    seed,
    overhangMm,
    fragments:        pls.length,
    covPct:           ((s.coveredRatio || 0) * 100).toFixed(3),
    residualTotal:    Math.round(s.residualAreaMm2 || 0),
    residualInterior: Math.round(s.residualInteriorMm2 || 0),
    residualPerim:    Math.round(s.residualPerimeterMm2 || 0),
    uncovComps:       s.uncoveredComponentCount || 0,
    iters:            pa.iterations || 0,
    exitReason:       pa.exitReason || "?",
    checksum
  };
}

// ── Run all experiments ──────────────────────────────────────────────────────
async function run() {
  const rows = [];
  const errors = [];

  // Determinism check: first seed, overhang 75, twice
  console.log("=== Детерминизм-контроль: seed[0], overhang=75, 2 прогона ===");
  for (let rep = 0; rep < 2; rep++) {
    process.stdout.write(`  прогон ${rep + 1}/2… `);
    try {
      const res = await callPreview(SEEDS[0], 75);
      const m = metrics(res, SEEDS[0], 75);
      console.log(`fragments=${m.fragments} cov=${m.covPct}% iters=${m.iters} checksum=${m.checksum}`);
      rows.push({ det: rep + 1, ...m });
    } catch (e) {
      console.error("ОШИБКА:", e.message);
      errors.push({ step: "det" + rep, e: e.message });
    }
  }

  const d = rows.filter(r => r.det);
  if (d.length === 2) {
    const ok = d[0].fragments === d[1].fragments &&
               d[0].covPct    === d[1].covPct    &&
               d[0].iters     === d[1].iters     &&
               d[0].checksum  === d[1].checksum;
    console.log(ok ? "  ✓ ДЕТЕРМИНИЗМ ОК" : "  ✗ НЕДЕТЕРМИНИЗМ — результаты разошлись!");
    if (!ok) {
      console.log("  Δfragments:", d[0].fragments - d[1].fragments);
      console.log("  Δiters:", d[0].iters - d[1].iters);
      console.log("  Δchecksum:", d[0].checksum - d[1].checksum);
    }
  }

  // A/B series: 3 seeds × 2 overhangs
  console.log("\n=== A/B серия: 3 seed × {overhang 0, 75}, maxIter=" + MAX_ITER + " ===");
  const abRows = [];
  for (const seed of SEEDS) {
    for (const ov of OVERHANGS) {
      process.stdout.write(`  seed=${seed} overhang=${ov}… `);
      try {
        const res = await callPreview(seed, ov);
        const m = metrics(res, seed, ov);
        abRows.push(m);
        console.log(`frags=${m.fragments} cov=${m.covPct}% resInt=${m.residualInterior}мм² exit=${m.exitReason}`);
      } catch (e) {
        console.error("ОШИБКА:", e.message);
        errors.push({ step: `seed=${seed} ov=${ov}`, e: e.message });
        abRows.push({ seed, overhangMm: ov, error: e.message });
      }
    }
  }

  // Print table
  console.log("\n╔══════════════════════════════════════════════════════════════════════════════════════╗");
  console.log("║ seed           │ ovhng │ frags │  cov%   │ resInt мм² │ resPer мм² │ exit           ║");
  console.log("╠══════════════════════════════════════════════════════════════════════════════════════╣");
  for (const r of abRows) {
    if (r.error) {
      console.log(`║ ${String(r.seed).padEnd(14)} │ ${String(r.overhangMm).padStart(5)} │ ERROR: ${r.error.slice(0, 50)} ║`);
      continue;
    }
    const line = [
      String(r.seed).padEnd(14),
      String(r.overhangMm).padStart(5),
      String(r.fragments).padStart(5),
      r.covPct.padStart(7),
      String(r.residualInterior).padStart(10),
      String(r.residualPerim).padStart(10),
      (r.exitReason || "?").padEnd(14)
    ].join(" │ ");
    console.log("║ " + line + " ║");
  }
  console.log("╚══════════════════════════════════════════════════════════════════════════════════════╝");

  // Delta summary
  console.log("\n=== Δ residualInterior (overhang 75 − 0) по seeds ===");
  for (const seed of SEEDS) {
    const r0  = abRows.find(r => r.seed === seed && r.overhangMm === 0);
    const r75 = abRows.find(r => r.seed === seed && r.overhangMm === 75);
    if (r0 && r75 && !r0.error && !r75.error) {
      const delta = r75.residualInterior - r0.residualInterior;
      const sign  = delta < 0 ? "↓ улучшение" : delta > 0 ? "↑ хуже" : "= без изменений";
      console.log(`  seed ${seed}: ${r0.residualInterior} → ${r75.residualInterior} мм²  Δ=${delta}  ${sign}`);
    }
  }

  if (errors.length) {
    console.log("\n=== Ошибки ===");
    errors.forEach(e => console.log(" ", e.step, ":", e.e));
  }

  // Save raw results
  const outFile = path.join(__dirname, "ab_overhang_results.json");
  fs.writeFileSync(outFile, JSON.stringify({ determinism: rows, ab: abRows, errors }, null, 2) + "\n");
  console.log("\nРезультаты сохранены:", outFile);
}

run().catch(e => { console.error("Fatal:", e); process.exit(1); });
