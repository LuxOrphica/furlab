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

function parseScrapContourPoints(scrapContour) {
  // Accept already-parsed array of {x,y} OR JSON string with .path OR JSON string of array
  if (Array.isArray(scrapContour)) {
    return scrapContour
      .map(p => ({ x: Number(p && p.x), y: Number(p && p.y) }))
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  }
  if (typeof scrapContour === "string") {
    try {
      const parsed = JSON.parse(scrapContour);
      if (Array.isArray(parsed)) return parseScrapContourPoints(parsed);
      if (parsed && Array.isArray(parsed.path)) return parseScrapContourPoints(parsed.path);
    } catch (_) {}
  }
  if (scrapContour && typeof scrapContour === "object" && Array.isArray(scrapContour.path)) {
    return parseScrapContourPoints(scrapContour.path);
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
  const args = { _: [], seed: null, maxIter: null, maxSolveMs: null, out: null, lloyd: false, sa: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seed") args.seed = Number(argv[++i]);
    else if (a === "--max-iter") args.maxIter = Number(argv[++i]);
    else if (a === "--max-solve-ms") args.maxSolveMs = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--lloyd") args.lloyd = true;
    else if (a === "--sa") args.sa = true;
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

  // Oracle case format:
  //   zone: { id, points: [{x,y}...] }
  //   pieces: [{ id, points: [{x,y}...], areaMm2 }]
  //   params: { ... solver params ... }
  //   seed
  const zonePoints = caseData.zone.points.map(p => ({ x: Number(p.x), y: Number(p.y) }));
  const seed = args.seed || caseData.seed || 1;
  const params = caseData.params || {};

  // Build candidates in solver's expected shape
  const candidates = caseData.pieces.map(p => ({
    id: String(p.id),
    inventoryTag: String(p.id),
    scrapContour: p.points.map(pt => ({ x: Number(pt.x), y: Number(pt.y) })),
    napDirectionDeg: 0
  }));

  // Decide _lloydTiling
  // v5.0: default SA (--sa). Lloyd-tiling только через --lloyd (regression-тесты).
  let lloydTiling = false;
  if (args.lloyd) lloydTiling = true;

  const options = {
    seed,
    maxSolveMs: args.maxSolveMs || params.maxSolveMs || 90000,
    maxIterations: args.maxIter || params.maxIter || 20000,
    allowanceMm: 12,
    minWidthMm: 70,
    minLengthMm: 70,
    napTarget: 90,
    napTol: 15,
    overhangMm: 75,
    absorptionCriterion: 4,
    postprocessMode: "full",
    layoutMode: "inventory_voronoi_sa",
    territoryMode: "mosaic",
    _lloydTiling: lloydTiling
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
