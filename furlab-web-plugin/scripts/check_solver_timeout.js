"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const API_HOST = "127.0.0.1";
const API_PORT = 5600;
const HARD_MAX_SOLVE_MS = 5000;
const REQUEST_TIMEOUT_MS = 20000;
const WALL_CLOCK_LIMIT_MS = 18000;

function postJson(routePath, body) {
  const data = JSON.stringify(body);
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: "POST",
      hostname: API_HOST,
      port: API_PORT,
      path: routePath,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
      timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let bodyObj = null;
        try { bodyObj = raw ? JSON.parse(raw) : null; } catch (err) {
          reject(new Error(`invalid_json_response: ${err.message}`));
          return;
        }
        resolve({
          statusCode: Number(res.statusCode || 0),
          durationMs: Date.now() - startedAt,
          body: bodyObj,
        });
      });
    });
    req.on("timeout", () => req.destroy(new Error("request_timeout")));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function buildRequest() {
  const oraclePath = path.join(__dirname, "../oracle_case_zone_1_1772731241049.json");
  const oracle = JSON.parse(fs.readFileSync(oraclePath, "utf8"));
  const params = oracle.params || {};
  const candidates = oracle.pieces.slice(0, 114).map((p) => {
    const pts = Array.isArray(p.points) ? p.points : [];
    return {
      id: String(p.id || ""),
      inventoryTag: String(p.id || ""),
      areaMm2: Number(p.areaMm2 || 0),
      bboxWidthMm: Number(p.bboxWidthMm || 0),
      bboxHeightMm: Number(p.bboxHeightMm || 0),
      napDirectionDeg: 90,
      scrapContour: JSON.stringify({
        path: pts.map((q) => ({ x: Number(q.x), y: Number(q.y) })),
      }),
    };
  });

  return {
    zone: { id: Number(oracle.zone.id || 1), points: oracle.zone.points },
    fillType: "voronoi",
    axis: "y",
    directInventory: true,
    assignOnly: false,
    placementStrategy: "bestFit",
    strictCoverage: false,
    coverageTarget: Math.min(0.95, Number(params.coverageTarget || 0.95)),
    coverageEps: Math.max(0.01, Number(params.coverageEps || 0.01)),
    seed: Number(oracle.seed || 1),
    qualityMode: "strict",
    rasterMm: Math.max(5, Number(params.rFinal || 5)),
    maxSolveMs: HARD_MAX_SOLVE_MS,
    hardMaxSolveMs: HARD_MAX_SOLVE_MS,
    maxPieces: Math.min(220, Number(params.maxPieces || 220)),
    maxPointsPerCandidate: Math.min(80, Number(params.maxPointsPerCandidate || 80)),
    minGainAreaMm2: 30,
    pieceSeamReserveMm: 12,
    constraints: {
      napDirectionDeg: 90,
      napToleranceDeg: Number(params.napTolDeg || 15),
      requireScrapContour: true,
    },
    candidates,
  };
}

async function main() {
  const res = await postJson("/api/layout/fill/preview", buildRequest());
  if (res.statusCode >= 500) {
    throw new Error(`server_error: HTTP ${res.statusCode}`);
  }
  if (!res.body || res.body.ok !== true) {
    throw new Error(`unexpected_response: HTTP ${res.statusCode}`);
  }
  if (res.durationMs > WALL_CLOCK_LIMIT_MS) {
    throw new Error(`timeout_contract_broken: ${res.durationMs}ms > ${WALL_CLOCK_LIMIT_MS}ms`);
  }
  const effectiveHardMaxSolveMs = Number(
    res.body.paramsSnapshot &&
    res.body.paramsSnapshot.options &&
    res.body.paramsSnapshot.options.hardMaxSolveMs
  );
  if (!Number.isFinite(effectiveHardMaxSolveMs) || effectiveHardMaxSolveMs > HARD_MAX_SOLVE_MS) {
    throw new Error(`hard_cap_not_applied: ${effectiveHardMaxSolveMs}`);
  }
  const matched = Array.isArray(res.body.placements)
    ? res.body.placements.filter((p) => p && p.status === "matched").length
    : 0;
  console.log(`[timeout] ok duration=${res.durationMs}ms hardMaxSolveMs=${effectiveHardMaxSolveMs} matched=${matched}`);
}

main().catch((err) => {
  console.error("[timeout] fatal:", err && err.stack ? err.stack : String(err));
  process.exit(1);
});
