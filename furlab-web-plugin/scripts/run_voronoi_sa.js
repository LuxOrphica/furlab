#!/usr/bin/env node
/**
 * Harness для локального прогона inventory_voronoi_sa без HTTP-сервера.
 *
 * Читает oracle_case_zone_*.json, дёргает voronoiSaSolver.solve() напрямую,
 * пишет run-output в формате, совместимом с verify_voronoi_sa.py.
 *
 * Usage:
 *   node scripts/run_voronoi_sa.js <oracle_case.json> [--seed N] [--max-iter N]
 *                                  [--max-solve-ms N] [--out OUT.json]
 *                                  [--lloyd]  (force _lloydTiling:true)
 *                                  [--sa]     (force _lloydTiling:false)
 *
 * По умолчанию использует _lloydTiling как в mode/index.js (true).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const {
  createSeededRng,
  createGridSpec
} = require("../src/services/solver_primitives");
const { createVoronoiSaSolver } = require("../src/services/solvers/voronoi_sa_solver");
const { pointsToMultiPolygon, intersectMulti, diffMulti, unionMulti, multiPolygonArea } =
  require("../src/services/polygon_ops");

// ── Helpers (extracted from server.js to avoid pulling the whole server) ─────

function normalizeDeg(v) {
  let x = Number(v);
  if (!Number.isFinite(x)) return null;
  x = x % 360;
  if (x < 0) x += 360;
  return x;
}

function deltaDeg(a, b) {
  const aa = normalizeDeg(a);
  const bb = normalizeDeg(b);
  if (aa === null || bb === null) return null;
  const d = Math.abs(aa - bb);
  return Math.min(d, 360 - d);
}

function polygonBBox(points) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points || []) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function centroid(points) {
  if (!Array.isArray(points) || points.length === 0) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  return { x: sx / points.length, y: sy / points.length };
}

function rotatePoints(points, angleRad, center) {
  const c = center || { x: 0, y: 0 };
  const ca = Math.cos(angleRad);
  const sa = Math.sin(angleRad);
  return (points || []).map((p) => {
    const x = p.x - c.x;
    const y = p.y - c.y;
    return { x: c.x + x * ca - y * sa, y: c.y + x * sa + y * ca };
  });
}

// ЗЕРКАЛО СЕРВЕРА (src/server.js: parseScrapContourPoints/transformScrapPointToWorld/
// normalizeCandidateContourPoints). Скрап-контуры хранятся Y-ВНИЗ (растровые координаты),
// мир воркспейса — Y-вверх: сервер флипует Y на границе инвентаря и нормализует контур
// (дедуп + канонический старт + CCW). Harness ОБЯЗАН делать то же самое, иначе куски
// зеркалятся и реплей решает другую задачу. Вскрыто 2026-07-16: при идентичном потоке
// RNG покрытие первого куска расходилось (2037 vs 2286 клеток) — формы были отражёнными.
function _signedArea(points) {
  const pts = Array.isArray(points) ? points : [];
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += Number(a.x || 0) * Number(b.y || 0) - Number(b.x || 0) * Number(a.y || 0);
  }
  return sum * 0.5;
}

function _normalizeCandidateContourPoints(points) {
  const src = Array.isArray(points) ? points : [];
  const cleaned = [];
  const EPS = 1e-6;
  for (const p of src) {
    const x = Number(p && p.x);
    const y = Number(p && p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (cleaned.length) {
      const q = cleaned[cleaned.length - 1];
      if (Math.hypot(x - q.x, y - q.y) <= EPS) continue;
    }
    cleaned.push({ x, y });
  }
  if (cleaned.length >= 2) {
    const a = cleaned[0];
    const b = cleaned[cleaned.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= EPS) cleaned.pop();
  }
  if (cleaned.length < 3) return [];
  let start = 0;
  for (let i = 1; i < cleaned.length; i++) {
    const p = cleaned[i];
    const s = cleaned[start];
    if (p.y < s.y - EPS || (Math.abs(p.y - s.y) <= EPS && p.x < s.x - EPS)) start = i;
  }
  const out = [];
  for (let i = 0; i < cleaned.length; i++) out.push(cleaned[(start + i) % cleaned.length]);
  if (_signedArea(out) < 0) out.reverse();
  return out;
}

function parseScrapContourPoints(scrapContour) {
  // Формат oracle-кейсов: уже готовый массив {x,y} в мировых координатах — без флипа.
  if (Array.isArray(scrapContour)) {
    return scrapContour
      .map(p => ({ x: Number(p && p.x), y: Number(p && p.y) }))
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  }
  // Формат БД (строка JSON с .path): как сервер — Y-flip + нормализация.
  if (typeof scrapContour === "string") {
    try {
      const parsed = JSON.parse(scrapContour);
      const path = Array.isArray(parsed && parsed.path) ? parsed.path
        : (Array.isArray(parsed) ? parsed : []);
      const raw = [];
      for (const p of path) {
        const x = Number(p && p.x);
        const y = Number(p && p.y);
        if (Number.isFinite(x) && Number.isFinite(y)) raw.push({ x, y: -y });
      }
      return _normalizeCandidateContourPoints(raw);
    } catch (_) { return []; }
  }
  if (scrapContour && typeof scrapContour === "object" && Array.isArray(scrapContour.path)) {
    const raw = scrapContour.path
      .map(p => ({ x: Number(p && p.x), y: -Number(p && p.y) }))
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    return _normalizeCandidateContourPoints(raw);
  }
  return [];
}

// ── Build solver deps ────────────────────────────────────────────────────────

const solverDeps = {
  parseScrapContourPoints,
  centroid,
  rotatePoints,
  polygonBBox,
  normalizeDeg,
  deltaDeg,
  pointsToMultiPolygon,
  intersectMulti,
  diffMulti,
  unionMulti,
  multiPolygonArea,
  createGridSpec,
  createSeededRng
};

const voronoiSaSolver = createVoronoiSaSolver(solverDeps);

// ── CLI parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { _: [], seed: null, maxIter: null, maxSolveMs: null, out: null, lloyd: false, sa: false, assignResidual: false, overlapWeight: null, junction: false, restarts: null, swapRepair: false, tagIds: false, progress: false, deepWeight: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seed") args.seed = Number(argv[++i]);
    else if (a === "--max-iter") args.maxIter = Number(argv[++i]);
    else if (a === "--max-solve-ms") args.maxSolveMs = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--lloyd") args.lloyd = true;
    else if (a === "--sa") args.sa = true;
    else if (a === "--assign-residual") args.assignResidual = true;
    else if (a === "--overlap-weight") args.overlapWeight = Number(argv[++i]);
    else if (a === "--junction") args.junction = true;
    else if (a === "--restarts") args.restarts = Number(argv[++i]);
    else if (a === "--swap-repair") args.swapRepair = true;
    else if (a === "--tag-ids") args.tagIds = true;
    else if (a === "--progress") args.progress = true;
    else if (a === "--deep-weight") args.deepWeight = Number(argv[++i]);
    else args._.push(a);
  }
  return args;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  if (args._.length === 0) {
    console.error("Usage: node scripts/run_voronoi_sa.js <oracle_case.json> [--seed N] [--max-iter N] [--max-solve-ms N] [--out OUT.json] [--lloyd] [--sa]");
    process.exit(2);
  }

  const casePath = path.resolve(args._[0]);
  const caseData = JSON.parse(fs.readFileSync(casePath, "utf-8"));

  // Два поддерживаемых формата:
  //   1) Oracle case: { zone: {points}, pieces: [{id, points}], params, seed }
  //   2) UI run export: { zone: {points}, candidates: [{inventoryTag, scrapContour(строка-JSON), napDirectionDeg}], effectiveOptions }
  const zonePoints = caseData.zone.points.map(p => ({ x: Number(p.x), y: Number(p.y) }));
  const seed = args.seed || caseData.seed || (caseData.effectiveOptions && caseData.effectiveOptions.seed) || 1;
  const params = caseData.params || caseData.effectiveOptions || {};

  // Build candidates in solver's expected shape
  let candidates;
  if (Array.isArray(caseData.pieces)) {
    candidates = caseData.pieces.map(p => ({
      id: String(p.id),
      inventoryTag: String(p.id),
      scrapContour: p.points.map(pt => ({ x: Number(pt.x), y: Number(pt.y) })),
      napDirectionDeg: 0
    }));
  } else if (Array.isArray(caseData.candidates)) {
    candidates = caseData.candidates.map(c => ({
      id: args.tagIds ? String(c.inventoryTag || c.id) : String(c.id || c.inventoryTag),
      inventoryTag: String(c.inventoryTag || c.id),
      scrapContour: c.scrapContour, // строка-JSON или массив — parseScrapContourPoints разберёт
      napDirectionDeg: Number(c.napDirectionDeg || 0)
    }));
  } else {
    throw new Error("case file has neither .pieces (oracle) nor .candidates (run export)");
  }

  // Decide _lloydTiling
  // v5.0: default SA (--sa). Lloyd-tiling только через --lloyd (regression-тесты).
  let lloydTiling = false;
  if (args.lloyd) lloydTiling = true;

  // Фиделити: параметры берём из экспорта (effectiveOptions/params), хардкод — только fallback.
  // Иначе реплей UI-прогона решает другую задачу (вскрылось на zone 2: UI clean, harness fail).
  const options = {
    seed,
    maxSolveMs: args.maxSolveMs || params.maxSolveMs || 90000,
    maxIterations: args.maxIter || params.maxIterations || params.maxIter || 20000,
    allowanceMm: params.allowanceMm != null ? Number(params.allowanceMm) : 12,
    minWidthMm: params.minWidthMm != null ? Number(params.minWidthMm) : 70,
    minLengthMm: params.minLengthMm != null ? Number(params.minLengthMm) : 70,
    napTarget: params.napTarget != null ? Number(params.napTarget) : 90,
    napTol: params.napTol != null ? Number(params.napTol)
      : (params.napTolDeg != null ? Number(params.napTolDeg) : 15),
    overhangMm: params.overhangMm != null ? Number(params.overhangMm) : 75,
    absorptionCriterion: params.absorptionCriterion != null ? Number(params.absorptionCriterion) : 4,
    postprocessMode: "full",
    layoutMode: "inventory_voronoi_sa",
    territoryMode: "mosaic",
    _lloydTiling: lloydTiling,
    _assignAwareResidual: args.assignResidual,
    _overlapWeight: args.overlapWeight,
    _junctionConsolidation: args.junction,
    _deepOverlapWeight: args.deepWeight,
    numRestarts: args.restarts || 1,
    onProgress: args.progress ? (async () => {}) : undefined,
    _swapRepair: args.swapRepair
  };

  console.error(`[harness] case: ${path.basename(casePath)}`);
  console.error(`[harness] zone pts: ${zonePoints.length}, candidates: ${candidates.length}`);
  console.error(`[harness] seed=${seed} maxIter=${options.maxIterations} maxSolveMs=${options.maxSolveMs} lloydTiling=${lloydTiling}`);

  const t0 = Date.now();
  const result = await voronoiSaSolver.solve(zonePoints, candidates, {}, options);
  const elapsedMs = Date.now() - t0;
  console.error(`[harness] solve() done in ${elapsedMs}ms`);

  // Build run-output in verify_voronoi_sa.py-compatible format
  const runOutput = {
    exportType: "voronoi_sa_harness_run",
    name: `harness_${path.basename(casePath, ".json")}_seed${seed}_${Date.now()}`,
    zone: { id: caseData.zone.id, points: zonePoints },
    candidates,
    effectiveOptions: result && result.algorithmTrace && result.algorithmTrace.effectiveOptions
      ? result.algorithmTrace.effectiveOptions
      : options,
    placements: (result && result.placements) || [],
    metrics: {
      ok: !!(result && result.ok),
      resultStatus: result && result.resultStatus,
      failedReason: result && result.failedReason,
      coveragePercent: result && result.coveragePercent,
      coveredRatio: result && result.coveredRatio,
      residualAreaMm2: result && result.residualAreaMm2,
      residualInteriorMm2: result && result.residualInteriorMm2,
      residualPerimeterMm2: result && result.residualPerimeterMm2,
      physMissingTotalMm2: (result && result.placements || []).reduce(
        (s, p) => s + (p && p.physicalMissingMm2 > 0 ? p.physicalMissingMm2 : 0), 0
      ),
      rasterSeamArtifactMm2: 0,
      uncoveredComponentCount: Array.isArray(result && result.uncoveredComponents)
        ? result.uncoveredComponents.length : 0
    },
    uncoveredComponents: (result && result.uncoveredComponents) || [],
    absorptionDiagnostic: result && result.absorptionDiagnostic,
    invariants: result && result.invariants,
    aesthetics: result && result.aesthetics,
    multiRestartStats: result && result._multiRestartStats,
    algorithmTrace: result && result.algorithmTrace
  };

  const outPath = args.out || path.join(
    path.dirname(casePath),
    `harness_run_zone_${caseData.zone.id}_seed${seed}_${Date.now()}.json`
  );
  fs.writeFileSync(outPath, JSON.stringify(runOutput, null, 2));
  console.error(`[harness] written: ${outPath}`);

  // Quick summary to stderr
  console.error(`[harness] coverage: ${(runOutput.metrics.coveragePercent || 0).toFixed(3)}%`);
  console.error(`[harness] placements: ${runOutput.placements.length}`);
  console.error(`[harness] residualInteriorMm2: ${runOutput.metrics.residualInteriorMm2 || 0}`);
  console.error(`[harness] resultStatus: ${runOutput.metrics.resultStatus}`);
  if (runOutput.invariants && runOutput.invariants.warnings) {
    console.error(`[harness] invariants.warnings: ${runOutput.invariants.warnings.length}`);
  }
}

main().catch(err => {
  console.error("[harness] FATAL:", err && err.stack || err);
  process.exit(1);
});
