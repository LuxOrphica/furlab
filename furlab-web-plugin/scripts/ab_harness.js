#!/usr/bin/env node
/**
 * A/B harness: два режима.
 *
 * Режим 1 — A/B критериев absorption на фиксированном seed:
 *   node scripts/ab_harness.js <run_output.json> --seed S
 *   Прогоняет crit=1 и crit=4, считает physical coverage + under/void.
 *
 * Режим 2 — мультирестарт, поиск лучшего seed:
 *   node scripts/ab_harness.js <run_output.json> --multistart N [--seed-start S]
 *   Прогоняет N seed'ов, для каждого считает residualInteriorMm2 + void.
 *   Показывает таблицу, выделяет лучший (min residual, min void).
 *
 * Харнесс зовёт /api/layout/modes/preview — тот же путь что UI.
 */
"use strict";

const fs   = require("fs");
const path = require("path");
const http = require("http");
const ClipperLib = require("clipper-lib");

// ── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const caseFile = args[0];
if (!caseFile) {
  console.error("Использование:");
  console.error("  A/B:          node scripts/ab_harness.js <file.json> --seed S");
  console.error("  мультирестарт: node scripts/ab_harness.js <file.json> --multistart N [--seed-start S]");
  process.exit(1);
}

const seedIdx      = args.indexOf("--seed");
const forceSeed    = seedIdx >= 0 ? Number(args[seedIdx + 1]) : null;
const apiIdx       = args.indexOf("--api");
const apiBase      = apiIdx >= 0 ? args[apiIdx + 1] : "http://127.0.0.1:5600";
const msIdx        = args.indexOf("--multistart");
const multiStart   = msIdx >= 0 ? Math.max(1, Number(args[msIdx + 1])) : 0;
const ssIdx        = args.indexOf("--seed-start");
const seedStart    = ssIdx >= 0 ? Number(args[ssIdx + 1]) : null;

const caseData = JSON.parse(fs.readFileSync(caseFile, "utf8"));
const zone = caseData.zone;
if (!zone || !Array.isArray(zone.points) || zone.points.length < 3) {
  console.error("Файл не содержит zone.points"); process.exit(1);
}
const rawCandidates = Array.isArray(caseData.candidates) ? caseData.candidates : [];
if (rawCandidates.length === 0) {
  console.error("Файл не содержит candidates — нужен свежий экспорт через «Экспорт run output»");
  process.exit(1);
}

const effectiveOpts = caseData.effectiveOptions || {};
const traceOpts = caseData.algorithmTrace && caseData.algorithmTrace.effectiveOptions;
const fileSeed = (traceOpts && traceOpts.seed) || effectiveOpts.seed || 1781456542124;

// ── HTTP ─────────────────────────────────────────────────────────────────────
function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, port: Number(u.port) || 80,
      path: u.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
    };
    const req = http.request(opts, res => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", c => buf += c);
      res.on("end", () => { try { resolve(JSON.parse(buf)); } catch(e) { reject(new Error("JSON parse: " + buf.slice(0,200))); } });
    });
    req.on("error", reject);
    req.setTimeout(120000, () => { req.destroy(new Error("timeout")); });
    req.write(data); req.end();
  });
}

async function callSolver(seed, absorptionCriterion) {
  const res = await postJson(`${apiBase}/api/layout/modes/preview`, {
    layoutType: "inventory_voronoi_sa",
    zone: { id: zone.id, points: zone.points, holes: Array.isArray(zone.holes) ? zone.holes : [] },
    inputs: { candidates: rawCandidates },
    options: {
      ...effectiveOpts,
      seed,
      absorptionCriterion,
      maxSolveMs: effectiveOpts.maxSolveMs || 90000
    }
  });
  if (!res || res.ok !== true) throw new Error(res && res.detail || res && res.error || "unknown");
  return res;
}

// ── ClipperLib ───────────────────────────────────────────────────────────────
const SCALE = 1000;
const MIN_AREA = SCALE * SCALE;

function toCli(pts) {
  return pts.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
}
function clipArea(pts) {
  return Math.abs(ClipperLib.Clipper.Area(toCli(pts))) / (SCALE * SCALE);
}

function computePhysicalCoverage(placements, zonePts) {
  const zoneArea = clipArea(zonePts);
  const cprUnion = new ClipperLib.Clipper();
  let anyAdded = false;
  for (const rp of placements) {
    if (rp.phase === "dissolved") continue;
    const terrPts  = Array.isArray(rp.inZoneContour)  && rp.inZoneContour.length  >= 3 ? rp.inZoneContour  : [];
    const piecePts = Array.isArray(rp.alignedContour)  && rp.alignedContour.length >= 3 ? rp.alignedContour : terrPts;
    if (terrPts.length < 3) continue;
    if (piecePts.length >= 3 && piecePts !== terrPts) {
      try {
        const ci = new ClipperLib.Clipper();
        ci.AddPath(toCli(piecePts), ClipperLib.PolyType.ptSubject, true);
        ci.AddPath(toCli(terrPts),  ClipperLib.PolyType.ptClip,    true);
        const iSol = new ClipperLib.Paths();
        ci.Execute(ClipperLib.ClipType.ctIntersection, iSol,
          ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
        for (const p of (iSol || [])) {
          if (Math.abs(ClipperLib.Clipper.Area(p)) >= MIN_AREA) {
            cprUnion.AddPath(p, ClipperLib.PolyType.ptSubject, true);
            anyAdded = true;
          }
        }
      } catch (_) {}
    } else {
      const cp = toCli(terrPts);
      if (Math.abs(ClipperLib.Clipper.Area(cp)) >= MIN_AREA) {
        cprUnion.AddPath(cp, ClipperLib.PolyType.ptSubject, true);
        anyAdded = true;
      }
    }
  }
  if (!anyAdded) return { coveragePct: 0, coveredMm2: 0, residualMm2: Math.round(zoneArea), zoneArea: Math.round(zoneArea), sumMm2: 0 };

  // Сумма (без дедупликации) — для диагностики двойного счёта
  const unionSolSum = new ClipperLib.Paths();
  cprUnion.Execute(ClipperLib.ClipType.ctUnion, unionSolSum,
    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const sumBeforeClip = (unionSolSum || []).reduce((s, p) => s + Math.abs(ClipperLib.Clipper.Area(p)) / (SCALE * SCALE), 0);

  // Клипаем union по зоне — гарантируем ≤ zoneArea (убирает выход SA за границу зоны)
  const finalClipper = new ClipperLib.Clipper();
  for (const p of (unionSolSum || [])) finalClipper.AddPath(p, ClipperLib.PolyType.ptSubject, true);
  finalClipper.AddPath(toCli(zonePts), ClipperLib.PolyType.ptClip, true);
  const clippedSol = new ClipperLib.Paths();
  finalClipper.Execute(ClipperLib.ClipType.ctIntersection, clippedSol,
    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const coveredMm2 = (clippedSol || []).reduce((s, p) => s + Math.abs(ClipperLib.Clipper.Area(p)) / (SCALE * SCALE), 0);

  return {
    coveragePct: (coveredMm2 / zoneArea) * 100,
    coveredMm2:  Math.round(coveredMm2),
    residualMm2: Math.round(zoneArea - coveredMm2),
    zoneArea:    Math.round(zoneArea),
    sumMm2:      Math.round(sumBeforeClip) // для диагностики: >coveredMm2 = перекрытие фрагментов
  };
}

function classifyResidual(placements, zonePts) {
  const clipDiff = new ClipperLib.Clipper();
  clipDiff.AddPath(toCli(zonePts), ClipperLib.PolyType.ptSubject, true);
  for (const rp of placements) {
    if (rp.phase === "dissolved") continue;
    const terrPts = Array.isArray(rp.inZoneContour) && rp.inZoneContour.length >= 3 ? rp.inZoneContour : null;
    if (terrPts) clipDiff.AddPath(toCli(terrPts), ClipperLib.PolyType.ptClip, true);
  }
  const residSol = new ClipperLib.Paths();
  clipDiff.Execute(ClipperLib.ClipType.ctDifference, residSol,
    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

  let underCount = 0, voidCount = 0, underMm2 = 0, voidMm2 = 0;
  const holes = [];
  for (const hole of (residSol || [])) {
    const holeArea = Math.abs(ClipperLib.Clipper.Area(hole)) / (SCALE * SCALE);
    if (holeArea < 1) continue;
    let covFraction = 0;
    for (const rp of placements) {
      if (rp.phase === "dissolved") continue;
      const piecePts = Array.isArray(rp.alignedContour) && rp.alignedContour.length >= 3 ? rp.alignedContour : null;
      if (!piecePts) continue;
      try {
        const ci = new ClipperLib.Clipper();
        ci.AddPath(hole, ClipperLib.PolyType.ptSubject, true);
        ci.AddPath(toCli(piecePts), ClipperLib.PolyType.ptClip, true);
        const iSol = new ClipperLib.Paths();
        ci.Execute(ClipperLib.ClipType.ctIntersection, iSol,
          ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
        const iArea = (iSol || []).reduce((s, p) => s + Math.abs(ClipperLib.Clipper.Area(p)), 0) / (SCALE * SCALE);
        covFraction += iArea / holeArea;
        if (covFraction > 0.05) break;
      } catch (_) {}
    }
    const isUnder = covFraction > 0.05;
    holes.push({ area: Math.round(holeArea), underFrac: covFraction, isUnder });
    if (isUnder) { underCount++; underMm2 += holeArea; }
    else         { voidCount++;  voidMm2  += holeArea; }
  }
  return { underCount, voidCount, underMm2: Math.round(underMm2), voidMm2: Math.round(voidMm2), holes };
}

/**
 * Попарная проверка перекрытий inZoneContour.
 * Если Σ(piece∩terr) > Union(piece∩terr) — значит inZoneContour'ы перекрываются.
 * Возвращает суммарную площадь перекрытий и список пар с перекрытием >1mm².
 */
function checkFragmentOverlaps(placements) {
  const frags = placements
    .filter(rp => rp.phase !== "dissolved" && Array.isArray(rp.inZoneContour) && rp.inZoneContour.length >= 3)
    .map(rp => ({ tag: rp.inventoryTag || rp.scrapPieceId || "?", cli: toCli(rp.inZoneContour) }));

  let totalOverlapMm2 = 0;
  const pairs = [];
  for (let i = 0; i < frags.length; i++) {
    for (let j = i + 1; j < frags.length; j++) {
      try {
        const ci = new ClipperLib.Clipper();
        ci.AddPath(frags[i].cli, ClipperLib.PolyType.ptSubject, true);
        ci.AddPath(frags[j].cli, ClipperLib.PolyType.ptClip, true);
        const iSol = new ClipperLib.Paths();
        ci.Execute(ClipperLib.ClipType.ctIntersection, iSol,
          ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
        const area = (iSol || []).reduce((s, p) => s + Math.abs(ClipperLib.Clipper.Area(p)), 0) / (SCALE * SCALE);
        if (area >= 1) {
          totalOverlapMm2 += area;
          pairs.push({ i: frags[i].tag, j: frags[j].tag, mm2: Math.round(area) });
        }
      } catch (_) {}
    }
  }
  return { totalOverlapMm2: Math.round(totalOverlapMm2), pairs };
}

function phaseStr(placements) {
  const ph = {};
  for (const p of placements) ph[p.phase || "?"] = (ph[p.phase || "?"] || 0) + 1;
  return Object.entries(ph).map(([k,v]) => `${k}:${v}`).join(" ");
}

function printTable(rows, cols, hdrs) {
  const widths = cols.map((c,i) => Math.max(hdrs[i].length, ...rows.map(r => String(r[c]).length)));
  const pad = (s, w) => String(s).padEnd(w);
  const sep = widths.map(w => "-".repeat(w)).join("  ");
  console.log(hdrs.map((h,i) => pad(h, widths[i])).join("  "));
  console.log(sep);
  for (const r of rows) console.log(cols.map((c,i) => pad(r[c], widths[i])).join("  "));
}

// ═══════════════════════════════════════════════════════════════════════════
// Режим 1: A/B на фиксированном seed
// ═══════════════════════════════════════════════════════════════════════════
async function runAB(seed) {
  const CONFIGS = [
    { label: "crit=1  center-only",  absorptionCriterion: 1 },
    { label: "crit=4  majority≥3/5", absorptionCriterion: 4 }
  ];

  console.log(`\n${"═".repeat(70)}`);
  console.log(` A/B: crit=1 vs crit=4    seed=${seed}`);
  console.log(`${"═".repeat(70)}`);

  const results = [];
  for (const cfg of CONFIGS) {
    process.stdout.write(`▶ ${cfg.label} ... `);
    const t0 = Date.now();
    const res = await callSolver(seed, cfg.absorptionCriterion);
    const ms = Date.now() - t0;
    const pl = Array.isArray(res.placements) ? res.placements : [];
    const cov = computePhysicalCoverage(pl, zone.points);
    const cls = classifyResidual(pl, zone.points);
    console.log(`${ms}ms  pieces=${pl.length}`);
    const ovl = checkFragmentOverlaps(pl);
    console.log(`   union∩zone=${cov.coveredMm2}mm²  sum=${cov.sumMm2}mm²  overlap_inZone=${ovl.totalOverlapMm2}mm²`);
    results.push({
      label:       cfg.label,
      ms,
      pieces:      pl.length,
      phases:      phaseStr(pl),
      harnessCov:  cov.coveragePct.toFixed(2) + "%",
      sumMm2:      cov.sumMm2,
      residMm2:    cov.residualMm2,
      overlapMm2:  ovl.totalOverlapMm2,
      under:       `${cls.underCount}(${cls.underMm2}mm²)`,
      void:        `${cls.voidCount}(${cls.voidMm2}mm²)`,
      solverCov:   (res.coveragePercent || 0).toFixed(2) + "%",
      solverRI:    res.residualInteriorMm2 || 0
    });
    // Детали дыр
    if (cls.holes.length > 0) {
      const bigHoles = cls.holes.filter(h => h.area >= 10);
      if (bigHoles.length > 0) console.log(`   дыры ≥10мм²: ${bigHoles.map(h => `${h.area}мм²(under${Math.round(h.underFrac*100)}%)`).join(", ")}`);
    }
    // Пары с перекрытием
    if (ovl.pairs.length > 0) {
      console.log(`   перекрытия inZoneContour: ${ovl.pairs.slice(0,5).map(p=>`${p.i}×${p.j}=${p.mm2}mm²`).join(", ")}${ovl.pairs.length>5?" …":""}`)
    }
  }

  console.log();
  printTable(results,
    ["label","pieces","harnessCov","sumMm2","residMm2","overlapMm2","under","void","solverCov","solverRI","ms"],
    ["Критерий","Кусков","Union∩zone","Σ(frag∩zone)","Остаток мм²","Overlap мм²","UNDER","VOID","Солвер%","Интерьер мм²","мс"]
  );

  const outFile = path.join(path.dirname(caseFile), `ab_crit_seed${seed}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ mode: "ab", seed, results }, null, 2), "utf8");
  console.log(`\n→ ${outFile}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Режим 2: мультирестарт — N seed'ов, найти лучший
// ═══════════════════════════════════════════════════════════════════════════
async function runMultistart(n, baseSeeds) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(` Мультирестарт: ${n} seed'ов`);
  console.log(`${"═".repeat(70)}`);

  const results = [];
  for (let i = 0; i < n; i++) {
    const seed = baseSeeds[i];
    process.stdout.write(`▶ seed=${seed} ... `);
    const t0 = Date.now();
    // Используем crit=4 (наш дефолт) для мультирестарта
    const res = await callSolver(seed, 4);
    const ms = Date.now() - t0;
    const pl = Array.isArray(res.placements) ? res.placements : [];
    const cov = computePhysicalCoverage(pl, zone.points);
    const cls = classifyResidual(pl, zone.points);
    const mark = cls.voidMm2 < 50 ? " ✓ absorbable" : cls.voidMm2 < 500 ? " ~ partial" : " ✗ void";
    console.log(`${ms}ms  pieces=${pl.length}  cov=${cov.coveragePct.toFixed(1)}%  void=${cls.voidMm2}mm²${mark}`);
    results.push({
      seed: String(seed),
      ms,
      pieces:    pl.length,
      harnessCov: cov.coveragePct.toFixed(2) + "%",
      residMm2:  cov.residualMm2,
      under:     `${cls.underCount}(${cls.underMm2}mm²)`,
      void:      `${cls.voidCount}(${cls.voidMm2}mm²)`,
      solverRI:  res.residualInteriorMm2 || 0,
      mark:      mark.trim()
    });
  }

  // Сортировка по void ascending
  const sorted = [...results].sort((a,b) => {
    const va = parseInt(a.void); const vb = parseInt(b.void);
    if (va !== vb) return va - vb;
    return a.residMm2 - b.residMm2;
  });

  console.log("\n── По void ascending (лучший наверху) ──");
  printTable(sorted,
    ["seed","pieces","harnessCov","residMm2","under","void","solverRI","ms","mark"],
    ["Seed","Кусков","Хар.покр.","Остаток мм²","UNDER","VOID","Интерьер мм²","мс","Статус"]
  );

  const bestSeed = sorted[0] && sorted[0].seed;
  console.log(`\nЛучший seed: ${bestSeed} (min void=${sorted[0] && sorted[0].void})`);

  const outFile = path.join(path.dirname(caseFile), `multistart_${n}seeds.json`);
  fs.writeFileSync(outFile, JSON.stringify({ mode: "multistart", n, results: sorted }, null, 2), "utf8");
  console.log(`→ ${outFile}`);

  return bestSeed;
}

// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(`Кейс: ${path.basename(caseFile)}`);
  console.log(`API : ${apiBase}`);
  console.log(`Канд.: ${rawCandidates.length}  Зона: ${zone.points.length} точек`);

  if (multiStart > 0) {
    // Режим 2: мультирестарт
    const base = seedStart != null ? seedStart : fileSeed;
    // Генерируем N seed'ов с шагом 100000 от базового
    const seeds = Array.from({ length: multiStart }, (_, i) => base + i * 100000);
    const bestSeed = await runMultistart(multiStart, seeds);

    // Если найден хороший seed — сразу прогоняем A/B на нём
    if (bestSeed) {
      console.log(`\nA/B на лучшем seed=${bestSeed}:`);
      await runAB(Number(bestSeed));
    }
  } else {
    // Режим 1: A/B на конкретном seed
    const seed = forceSeed != null ? forceSeed : fileSeed;
    await runAB(seed);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
