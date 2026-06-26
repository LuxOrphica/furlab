"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const {
  normalizeInventoryDirectResponse,
} = require("../src/contracts/golden_snapshot");

function parseArgs(argv) {
  const out = {
    api: "http://127.0.0.1:5600",
    baseline: path.resolve(process.cwd(), "tests/baselines/inventory_direct_golden.json"),
    update: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const b = argv[i + 1];
    if (a === "--api" && b) {
      out.api = String(b);
      i++;
    } else if (a === "--baseline" && b) {
      out.baseline = path.resolve(process.cwd(), b);
      i++;
    } else if (a === "--update") {
      out.update = true;
    }
  }
  return out;
}

function makeRectScrap(x1, y1, x2, y2) {
  return JSON.stringify({
    path: [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
    ],
  });
}

function buildRequest() {
  const seam = 12;
  return {
    zone: {
      id: 99,
      points: [
        { x: 0, y: 0 },
        { x: 250, y: 0 },
        { x: 250, y: 200 },
        { x: 0, y: 200 },
      ],
    },
    fillType: "voronoi",
    axis: "y",
    directInventory: true,
    assignOnly: false,
    placementStrategy: "bestFit",
    strictCoverage: false,
    coverageTarget: 0.99,
    coverageEps: 0.01,
    seed: 42,
    qualityMode: "strict",
    rasterMm: 5,
    maxSolveMs: 60000,
    hardMaxSolveMs: 90000,
    maxPieces: 10,
    maxPointsPerCandidate: 30,
    minGainAreaMm2: 100,
    pieceSeamReserveMm: seam,
    constraints: {
      napDirectionDeg: 90,
      napToleranceDeg: 45,
      requireScrapContour: true,
    },
    candidates: [
      {
        id: "p1",
        inventoryTag: "p1",
        areaMm2: 24000,
        bboxWidthMm: 120,
        bboxHeightMm: 200,
        napDirectionDeg: 90,
        scrapContour: makeRectScrap(0, 0, 120, 200),
      },
      {
        id: "p2",
        inventoryTag: "p2",
        areaMm2: 24000,
        bboxWidthMm: 120,
        bboxHeightMm: 200,
        napDirectionDeg: 90,
        scrapContour: makeRectScrap(0, 0, 120, 200),
      },
      {
        id: "p3",
        inventoryTag: "p3",
        areaMm2: 24000,
        bboxWidthMm: 120,
        bboxHeightMm: 200,
        napDirectionDeg: 90,
        scrapContour: makeRectScrap(0, 0, 120, 200),
      },
    ],
  };
}

function postJson(urlString, routePath, bodyObj) {
  const base = new URL(urlString);
  const data = JSON.stringify(bodyObj || {});
  const isHttps = base.protocol === "https:";
  const opts = {
    method: "POST",
    hostname: base.hostname,
    port: base.port || (isHttps ? 443 : 80),
    path: routePath,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
    },
    timeout: 60000,
  };
  const client = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(opts, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_) {}
        resolve({ statusCode: Number(res.statusCode || 0), body: parsed, rawBody: raw });
      });
    });
    req.on("timeout", () => req.destroy(new Error("request_timeout")));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function stableStringify(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function collectDiffs(expected, actual, prefix = "", out = []) {
  if (out.length >= 25) return out;
  if (Object.is(expected, actual)) return out;
  const expectedIsObject = expected && typeof expected === "object";
  const actualIsObject = actual && typeof actual === "object";
  if (!expectedIsObject || !actualIsObject) {
    out.push(`${prefix || "$"}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
    return out;
  }
  const keys = Array.from(new Set([
    ...Object.keys(expected),
    ...Object.keys(actual),
  ])).sort();
  for (const key of keys) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    collectDiffs(expected[key], actual[key], nextPrefix, out);
    if (out.length >= 25) break;
  }
  return out;
}

function loadBaseline(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function buildSnapshot(args) {
  const res = await postJson(args.api, "/api/layout/fill/preview", buildRequest());
  if (res.statusCode >= 500 || !res.body) {
    throw new Error(`HTTP ${res.statusCode}`);
  }
  return normalizeInventoryDirectResponse(res.body);
}

async function main() {
  const args = parseArgs(process.argv);
  const snapshot = await buildSnapshot(args);

  if (args.update) {
    fs.mkdirSync(path.dirname(args.baseline), { recursive: true });
    fs.writeFileSync(args.baseline, stableStringify(snapshot));
    console.log(`[golden] updated ${path.relative(process.cwd(), args.baseline)}`);
    return;
  }

  const baseline = loadBaseline(args.baseline);
  if (!baseline) {
    console.log(`[golden] baseline missing: ${path.relative(process.cwd(), args.baseline)}`);
    console.log("[golden] create it with: npm run golden:inventory-direct:update");
    process.exit(1);
  }

  if (stableStringify(baseline) !== stableStringify(snapshot)) {
    console.log("FAIL inventory_direct: golden snapshot mismatch");
    for (const line of collectDiffs(baseline, snapshot).slice(0, 12)) {
      console.log(`  ${line}`);
    }
    console.log("[golden] refresh intentionally changed baseline with: npm run golden:inventory-direct:update");
    process.exit(1);
  }

  console.log("[golden] inventory direct experimental baseline matches");
}

main().catch((err) => {
  console.error("[golden] fatal:", err && err.stack ? err.stack : String(err));
  process.exit(1);
});
