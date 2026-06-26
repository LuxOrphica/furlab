"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function parseArgs(argv) {
  const out = { cases: "scripts/oracle_cases", api: "http://127.0.0.1:5600", python: "python" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cases") out.cases = argv[++i];
    else if (a === "--api") out.api = argv[++i];
    else if (a === "--python") out.python = argv[++i];
  }
  return out;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return await res.json();
}

function readCases(casesDir) {
  const dir = path.resolve(casesDir);
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".json"));
  return files.map((f) => path.join(dir, f));
}

function runOracle(pythonBin, casePath) {
  const script = path.join(__dirname, "oracle_run_case.py");
  const run = spawnSync(pythonBin, [script, "--case", casePath], { encoding: "utf8" });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    throw new Error(`oracle_exit_${run.status}: ${run.stderr || run.stdout}`);
  }
  return JSON.parse(String(run.stdout || "{}"));
}

function pieceToCandidate(piece) {
  const pts = Array.isArray(piece && piece.points) ? piece.points : [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of pts) {
    const x = Number(p && p.x);
    const y = Number(p && p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const w = Number.isFinite(minX) ? Math.max(0, maxX - minX) : 0;
  const h = Number.isFinite(minY) ? Math.max(0, maxY - minY) : 0;
  const ring = pts.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
  const contour = JSON.stringify({ path: ring });
  return {
    id: String(piece.id || ""),
    inventoryTag: String(piece.id || ""),
    areaMm2: Number(piece.areaMm2 || (w * h)),
    bboxWidthMm: w,
    bboxHeightMm: h,
    napDirectionDeg: 90,
    scrapContour: contour
  };
}

async function runJs(apiBase, caseObj) {
  const zonePoints = caseObj.zone.points || [];
  const candidates = (caseObj.pieces || []).map(pieceToCandidate);
  const params = caseObj.params || {};
  const body = {
    zone: { id: 1, points: zonePoints },
    fillType: "voronoi",
    axis: "y",
    directInventory: true,
    assignOnly: false,
    placementStrategy: "bestFit",
    strictCoverage: true,
    coverageTarget: Number(params.coverageTarget || 0.999),
    coverageEps: Number(params.coverageEps || 0.002),
    seed: Number(caseObj.seed || 0),
    qualityMode: "strict",
    rasterMm: Number(params.rFinal || 2),
    maxSolveMs: Number(params.maxSolveMs || 22000),
    maxPieces: Number(params.maxPieces || 48),
    maxPointsPerCandidate: Number(params.maxPointsPerCandidate || 90),
    candidates,
    filters: {},
    constraints: {
      napDirectionDeg: 90,
      napToleranceDeg: Number(params.napTolDeg || 15),
      requireScrapContour: true,
      minAreaMm2: Number(params.minAreaMm2 || 0) || null
    }
  };
  return await postJson(`${apiBase}/api/layout/fill/preview`, body);
}

function pickMetricsFromJs(js) {
  return {
    coveragePercent: Number(js.coveragePercent || 0),
    uncoveredMm2: Number(js.residualAreaMm2 || 0),
    overlapMm2: Number(js.overlapAreaMm2 || 0),
    placementsCount: Array.isArray(js.placements) ? js.placements.length : 0
  };
}

function diffMetrics(a, b) {
  return {
    dCoveragePercent: Number((a.coveragePercent - b.coveragePercent).toFixed(3)),
    dUncoveredMm2: Number((a.uncoveredMm2 - b.uncoveredMm2).toFixed(3)),
    dOverlapMm2: Number((a.overlapMm2 - b.overlapMm2).toFixed(3)),
    dPlacementsCount: Number(a.placementsCount - b.placementsCount)
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const cases = readCases(args.cases);
  if (!cases.length) {
    console.log("No case files found.");
    return;
  }
  const report = [];
  for (const cp of cases) {
    const caseObj = JSON.parse(fs.readFileSync(cp, "utf8"));
    const oracle = runOracle(args.python, cp);
    const jsRes = await runJs(args.api, caseObj);
    const js = pickMetricsFromJs(jsRes || {});
    const row = {
      case: path.basename(cp),
      oracle: {
        coveragePercent: Number(oracle.coveragePercent || 0),
        uncoveredMm2: Number(oracle.uncoveredMm2 || 0),
        overlapMm2: Number(oracle.overlapMm2 || 0),
        placementsCount: Number(oracle.placementsCount || 0),
      },
      js,
      diff: diffMetrics(js, oracle),
      warnings: Array.isArray(jsRes && jsRes.warnings) ? jsRes.warnings : [],
    };
    report.push(row);
    console.log(JSON.stringify(row, null, 2));
  }
  const outPath = path.resolve("tmp", "oracle_compare_report.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`Saved report: ${outPath}`);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
});
