"use strict";

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const out = {
    casePath: "",
    api: "http://127.0.0.1:5600",
    maxRuns: 48
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || "");
    if (a === "--case") out.casePath = String(argv[++i] || "");
    else if (a === "--api") out.api = String(argv[++i] || "");
    else if (a === "--max-runs") out.maxRuns = Math.max(1, Number(argv[++i] || 48));
  }
  return out;
}

function cartesian(arrays) {
  let acc = [[]];
  for (const arr of arrays) {
    const next = [];
    for (const x of acc) {
      for (const y of arr) next.push(x.concat([y]));
    }
    acc = next;
  }
  return acc;
}

function buildCandidatesFromCase(caseObj) {
  return (Array.isArray(caseObj && caseObj.pieces) ? caseObj.pieces : []).map((piece) => {
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
    return {
      id: String(piece && piece.id || ""),
      inventoryTag: String(piece && piece.id || ""),
      areaMm2: Number(piece && piece.areaMm2 || (w * h) || 0),
      bboxWidthMm: w,
      bboxHeightMm: h,
      napDirectionDeg: 90,
      scrapContour: JSON.stringify({ path: pts.map((p) => ({ x: Number(p.x), y: Number(p.y) })) })
    };
  });
}

function buildBaseRequest(caseObj) {
  const params = (caseObj && caseObj.params) || {};
  return {
    zone: { id: Number(caseObj.zone && caseObj.zone.id || 1), points: caseObj.zone && caseObj.zone.points || [] },
    fillType: "voronoi",
    axis: "y",
    directInventory: true,
    assignOnly: false,
    placementStrategy: "bestFit",
    strictCoverage: true,
    strictCoverageHard: true,
    coverageTarget: Number(params.coverageTarget || 0.999),
    coverageEps: Number(params.coverageEps || 0.002),
    objectiveMode: "oneGood",
    objectiveMinEfficiency: Number(params.objectiveMinEfficiency || 0.82),
    seed: Number(caseObj.seed || 1),
    qualityMode: "strict",
    rasterMm: Number(params.rFinal || 2),
    maxSolveMs: Number(params.maxSolveMs || 45000),
    hardMaxSolveMs: Number((params.hardMaxSolveMs || params.maxSolveMs) || 90000),
    maxPieces: Number(params.maxPieces || 120),
    maxPointsPerCandidate: Number(params.maxPointsPerCandidate || 120),
    minGainAreaMm2: Number(params.minGainAreaMm2 || 30),
    enforceMinGainByArea: true,
    coverageFirst: false,
    constraints: {
      napDirectionDeg: 90,
      napToleranceDeg: Number(params.napTolDeg || 15),
      requireScrapContour: true,
      minAreaMm2: Number(params.minAreaMm2 || 0) || null
    },
    filters: {},
    candidates: buildCandidatesFromCase(caseObj)
  };
}

function buildConfigs(maxRuns) {
  const dims = {
    maxPieceOverlap: [0.45, 0.6, 0.75],
    overlapPenalty: [0.8, 1.1, 1.5],
    outsidePenalty: [0.1, 0.3, 0.6],
    minGainAreaMm2: [10, 25, 45],
    tailOversizeAlpha: [2.0, 2.8, 3.6],
    coverageFirst: [false, true]
  };
  const combos = cartesian([
    dims.maxPieceOverlap,
    dims.overlapPenalty,
    dims.outsidePenalty,
    dims.minGainAreaMm2,
    dims.tailOversizeAlpha,
    dims.coverageFirst
  ]).map((c) => ({
    maxPieceOverlap: c[0],
    overlapPenalty: c[1],
    outsidePenalty: c[2],
    minGainAreaMm2: c[3],
    tailOversizeAlpha: c[4],
    coverageFirst: c[5]
  }));
  if (combos.length <= maxRuns) return combos;
  const out = [];
  const step = combos.length / maxRuns;
  for (let i = 0; i < maxRuns; i++) out.push(combos[Math.floor(i * step)]);
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

async function postJsonWithRetry(url, body, retries) {
  let lastErr = null;
  const n = Math.max(0, Number(retries || 0));
  for (let i = 0; i <= n; i++) {
    try {
      return await postJson(url, body);
    } catch (e) {
      lastErr = e;
      if (i < n) {
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
  }
  throw lastErr || new Error("post_failed");
}

function extractResult(runId, cfg, res, elapsedMs) {
  const trace = res && res.algorithmTrace && res.algorithmTrace.steps || {};
  const rej = trace && trace.placement_search && trace.placement_search.rejected || {};
  const intersections = Number(res && res.stats && res.stats.intersections || 0);
  const coverage = Number(res && res.coveragePercent || 0);
  const overlapArea = Number(res && res.overlapAreaMm2 || 0);
  const pieces = Array.isArray(res && res.placements) ? res.placements.length : 0;
  const warnings = Array.isArray(res && res.warnings) ? res.warnings : [];
  const hardFail = warnings.includes("full_coverage_required");
  const score =
    (coverage * 12) -
    (intersections * 4) -
    (overlapArea / 2500) -
    (pieces * 0.35) -
    (hardFail ? 300 : 0);
  return {
    runId,
    elapsedMs,
    score: Math.round(score * 1000) / 1000,
    coveragePercent: coverage,
    intersections,
    overlapAreaMm2: overlapArea,
    placements: pieces,
    rejected: {
      overlap: Number(rej.overlap || 0),
      lowGain: Number(rej.lowGain || 0),
      outside: Number(rej.outside || 0),
      oversize: Number(rej.oversize || 0),
      noFit: Number(rej.noFit || 0)
    },
    warnings,
    config: cfg
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.casePath) {
    throw new Error("usage: node scripts/sweep_inventory_case.js --case <path-to-case.json> [--api http://127.0.0.1:5600] [--max-runs 48]");
  }
  const casePath = path.resolve(args.casePath);
  const caseObj = JSON.parse(fs.readFileSync(casePath, "utf8"));
  const baseReq = buildBaseRequest(caseObj);
  if (!Array.isArray(baseReq.candidates) || !baseReq.candidates.length) {
    throw new Error("case_has_no_candidates");
  }
  const configs = buildConfigs(args.maxRuns);
  const rows = [];
  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i];
    const body = {
      ...baseReq,
      ...cfg
    };
    const t0 = Date.now();
    try {
      const res = await postJsonWithRetry(`${args.api}/api/layout/fill/preview`, body, 2);
      const elapsedMs = Date.now() - t0;
      rows.push(extractResult(i + 1, cfg, res || {}, elapsedMs));
      const r = rows[rows.length - 1];
      console.log(
        `#${r.runId} score=${r.score} cov=${r.coveragePercent.toFixed(2)} int=${r.intersections} ov=${r.overlapAreaMm2.toFixed(1)} pcs=${r.placements} t=${r.elapsedMs}ms`
      );
    } catch (e) {
      const elapsedMs = Date.now() - t0;
      rows.push({
        runId: i + 1,
        elapsedMs,
        score: -999999,
        error: String(e && e.message ? e.message : e),
        config: cfg
      });
      console.log(`#${i + 1} ERROR after ${elapsedMs}ms: ${String(e && e.message ? e.message : e)}`);
    }
  }
  rows.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const report = {
    casePath,
    api: args.api,
    runs: rows.length,
    createdAt: new Date().toISOString(),
    top: rows.slice(0, 15),
    all: rows
  };
  const outDir = path.resolve("tmp");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `inventory_sweep_report_${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`Saved report: ${outPath}`);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
});
