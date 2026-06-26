"use strict";
/**
 * Node-CLI харнесс для Роберта Тестера.
 * Вызывает /api/layout/modes/preview через HTTP (тот же путь что UI).
 * Фикстура: зона + кандидаты из последнего экспортного JSON.
 *
 * Использование:
 *   node scripts/run_solver_harness.js [--fixture <run.json>] [--seed <N>] [--out <out.json>] [--port 5600]
 *
 * Stdout: путь к записанному run-output JSON.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const FIXTURE_DIR = "F:/FURLAB/Тест/вороной тест";
const BASE_URL = "http://127.0.0.1";

const args = process.argv.slice(2);
function arg(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }

const port = Number(arg("--port") || 5600);
const outPath = arg("--out");

// --- найти фикстуру ---
let fixturePath = arg("--fixture");
if (!fixturePath) {
  const files = fs.readdirSync(FIXTURE_DIR)
    .filter(f => f.startsWith("voronoi_sa_run_zone_1_") && f.endsWith(".json"))
    .sort();
  if (!files.length) { console.error("No fixture files in", FIXTURE_DIR); process.exit(1); }
  fixturePath = path.join(FIXTURE_DIR, files[files.length - 1]);
  console.error("[harness] fixture:", fixturePath);
}

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const eo = fixture.effectiveOptions || {};
const seed = arg("--seed") != null ? Number(arg("--seed")) : (eo.seed != null ? Number(eo.seed) : 1);

// --- построить тело запроса (как в UI: inventory_voronoi_sa preview) ---
const body = JSON.stringify({
  layoutType: "inventory_voronoi_sa",
  zone: fixture.zone,
  inputs: { candidates: fixture.candidates },
  options: {
    ...eo,
    seed,
    territoryMode: eo.territoryMode || "mosaic",
    postprocessMode: eo.postprocessMode || "full",
    maxIterations: eo.maxIterations || 3000,
  }
});

console.error("[harness] POST /api/layout/modes/preview  seed=%s  port=%s  candidates=%d",
  seed, port, fixture.candidates && fixture.candidates.length);

const req = http.request({
  hostname: "127.0.0.1",
  port,
  path: "/api/layout/modes/preview",
  method: "POST",
  headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
  timeout: 180000,
}, (res) => {
  let raw = "";
  res.setEncoding("utf8");
  res.on("data", d => raw += d);
  res.on("end", () => {
    if (res.statusCode !== 200) {
      console.error("[harness] HTTP %d: %s", res.statusCode, raw.slice(0, 300));
      process.exit(1);
    }
    let result;
    try { result = JSON.parse(raw); } catch (e) {
      console.error("[harness] JSON parse error:", e.message, raw.slice(0, 200));
      process.exit(1);
    }

    // build export compatible with verify_voronoi_sa.py
    const output = {
      exportType: "voronoi_sa_run_output",
      name: "voronoi_sa_zone_1_run",
      zone: fixture.zone,
      candidates: fixture.candidates,
      effectiveOptions: { ...eo, seed },
      placements: result.placements || [],
      metrics: {
        coveragePercent: (result.stats && result.stats.coveragePercent != null) ? result.stats.coveragePercent : null,
        resultStatus: result.resultStatus || null,
        physMissingTotalMm2: (result.stats && result.stats.physicalMissingTotalMm2) || 0,
        rasterSeamArtifactMm2: (result.stats && result.stats.rasterSeamArtifactMm2) || 0,
      },
      uncoveredComponents: result.uncoveredComponents || [],
      absorptionDiagnostic: result.absorptionDiagnostic || null,
      invariants: result.invariants || null,
      algorithmTrace: result.algorithmTrace || null,
    };

    const ts = Date.now();
    const dest = outPath || path.join(FIXTURE_DIR, `voronoi_sa_run_zone_1_${ts}.json`);
    fs.writeFileSync(dest, JSON.stringify(output, null, 2));
    const covPct = output.metrics && output.metrics.coveragePercent;
    console.error(`[harness] coverage=${covPct != null ? Number(covPct).toFixed(3) : 'null'}%  placements=${output.placements.length}  written: ${dest}`);
    console.log(dest);
  });
});

req.on("error", e => { console.error("[harness] request error:", e.message); process.exit(1); });
req.on("timeout", () => { console.error("[harness] timeout"); req.destroy(); process.exit(1); });
req.write(body);
req.end();
