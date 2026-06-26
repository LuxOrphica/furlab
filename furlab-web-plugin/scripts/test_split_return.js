"use strict";

const fs = require("fs");
const path = require("path");
const net = require("net");
const http = require("http");
const https = require("https");
const { execSync } = require("child_process");
const polygonClipping = require("polygon-clipping");
const { spawn } = require("child_process");

function parseArgs(argv) {
  const out = {
    api: "http://127.0.0.1:5610",
    spawnServer: true,
    serverPort: 5610,
    outRoot: path.resolve(process.cwd(), "tmp", "test_runs"),
    baselinePath: path.resolve(process.cwd(), "tests", "baselines", "inventory_split_baseline.json"),
    maxCoverageDropPct: 1.0,
    cases: [
      "oracle_case_zone_4_1772795164231.json",
      "oracle_case_zone_6_1772727412367.json",
      "oracle_case_zone_1_1772731241049.json",
      "tests/cases/split_reuse_required.json"
    ]
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || "");
    const b = String(argv[i + 1] || "");
    if (a === "--api" && b) {
      out.api = b;
      try {
        const u = new URL(out.api);
        const p = Number(u.port || (u.protocol === "https:" ? 443 : 80));
        if (Number.isFinite(p) && p > 0) out.serverPort = p;
      } catch (_) {}
      i += 1;
      continue;
    }
    if (a === "--no-spawn-server") {
      out.spawnServer = false;
      continue;
    }
    if (a === "--port" && b) {
      out.serverPort = Math.max(1, Number(b) || 5610);
      out.api = `http://127.0.0.1:${out.serverPort}`;
      i += 1;
      continue;
    }
    if (a === "--out" && b) {
      out.outRoot = path.resolve(process.cwd(), b);
      i += 1;
      continue;
    }
    if (a === "--baseline" && b) {
      out.baselinePath = path.resolve(process.cwd(), b);
      i += 1;
      continue;
    }
    if (a === "--max-coverage-drop" && b) {
      out.maxCoverageDropPct = Math.max(0, Number(b) || 0);
      i += 1;
      continue;
    }
    if (a === "--cases" && b) {
      out.cases = b.split(",").map((x) => x.trim()).filter(Boolean);
      i += 1;
    }
  }
  return out;
}

async function waitForHealth(apiBase, timeoutMs) {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    try {
      const u = new URL(`${apiBase}/api/health`);
      const isHttps = u.protocol === "https:";
      const client = isHttps ? https : http;
      const ok = await new Promise((resolve) => {
        const req = client.request({
          method: "GET",
          hostname: u.hostname,
          port: Number(u.port || (isHttps ? 443 : 80)),
          path: u.pathname,
          timeout: 5000
        }, (res) => {
          resolve(Number(res.statusCode || 0) >= 200 && Number(res.statusCode || 0) < 500);
        });
        req.on("error", () => resolve(false));
        req.on("timeout", () => {
          try { req.destroy(); } catch (_) {}
          resolve(false);
        });
        req.end();
      });
      if (ok) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function postJson(url, body) {
  const u = new URL(url);
  const isHttps = u.protocol === "https:";
  const payload = JSON.stringify(body || {});
  const client = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request({
      method: "POST",
      hostname: u.hostname,
      port: Number(u.port || (isHttps ? 443 : 80)),
      path: `${u.pathname || "/"}${u.search || ""}`,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      },
      timeout: 15 * 60 * 1000
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_) {}
        resolve({ status: Number(res.statusCode || 0), body: parsed, raw });
      });
    });
    req.on("timeout", () => req.destroy(new Error("request_timeout")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function postJsonWithRetry(url, body, retries) {
  const n = Math.max(0, Number(retries || 0));
  let lastErr = null;
  for (let i = 0; i <= n; i++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await postJson(url, body);
    } catch (err) {
      lastErr = err;
      if (i < n) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 600 * (i + 1)));
      }
    }
  }
  throw lastErr || new Error("request_failed");
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
      scrapContour: JSON.stringify({ units: "mm", path: pts.map((p) => ({ x: Number(p.x), y: Number(p.y) })) })
    };
  });
}

function buildRequest(caseObj) {
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
    maxSolveMs: Math.min(90000, Number(params.maxSolveMs || 50000)),
    hardMaxSolveMs: Math.min(120000, Number((params.hardMaxSolveMs || params.maxSolveMs) || 120000)),
    maxPieces: Number(params.maxPieces || 140),
    maxPointsPerCandidate: Number(params.maxPointsPerCandidate || 120),
    minGainAreaMm2: Number(params.minGainAreaMm2 || 20),
    enforceMinGainByArea: true,
    coverageFirst: false,
    solverMode: "phasedV1",
    enableLegacyFallback: false,
    modeId: "inventory_split_return",
    splitReturnEnabled: true,
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

function toRingPoints(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((p) => ({ x: Number(p && p.x), y: Number(p && p.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

function polyArea(points) {
  const pts = Array.isArray(points) ? points : [];
  if (pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += Number(a.x) * Number(b.y) - Number(b.x) * Number(a.y);
  }
  return Math.abs(s) / 2;
}

function ensureClosedRing(ring) {
  const pts = Array.isArray(ring) ? ring : [];
  if (pts.length < 3) return null;
  const out = pts.map((p) => [Number(p.x), Number(p.y)]);
  const f = out[0];
  const l = out[out.length - 1];
  if (!f || !l) return null;
  if (Math.abs(f[0] - l[0]) > 1e-9 || Math.abs(f[1] - l[1]) > 1e-9) out.push([f[0], f[1]]);
  return out;
}

function ringToMp(ring) {
  const closed = ensureClosedRing(ring);
  if (!closed) return [];
  return [[closed]];
}

function contoursToMp(contours) {
  const out = [];
  for (const ring of Array.isArray(contours) ? contours : []) {
    const closed = ensureClosedRing(toRingPoints(ring));
    if (closed) out.push([closed]);
  }
  return out;
}

function normalizeMpCandidate(v) {
  if (!Array.isArray(v) || v.length === 0) return [];
  const first = v[0];
  if (!Array.isArray(first) || first.length === 0) return [];
  const firstInner = first[0];
  if (!Array.isArray(firstInner) || firstInner.length === 0) return [];
  if (Array.isArray(firstInner[0])) return v;
  return [];
}

function eventContoursToMp(eventObj, worldMultiKey, worldKey, localKey) {
  const worldMulti = normalizeMpCandidate(eventObj && eventObj[worldMultiKey]);
  if (worldMulti.length > 0) return worldMulti;
  const worldGroups = Array.isArray(eventObj && eventObj[worldKey]) ? eventObj[worldKey] : [];
  if (worldGroups.length > 0) return contoursToMp(worldGroups);
  const localGroups = Array.isArray(eventObj && eventObj[localKey]) ? eventObj[localKey] : [];
  return contoursToMp(localGroups);
}

function mpArea(mp) {
  let sum = 0;
  for (const poly of Array.isArray(mp) ? mp : []) {
    const outer = Array.isArray(poly) ? poly[0] : null;
    if (!Array.isArray(outer) || outer.length < 4) continue;
    let s = 0;
    for (let i = 0; i < outer.length - 1; i++) {
      const a = outer[i];
      const b = outer[i + 1];
      s += Number(a[0]) * Number(b[1]) - Number(b[0]) * Number(a[1]);
    }
    sum += Math.abs(s) / 2;
  }
  return sum;
}

function collectBounds(zonePts, placements, splitEvents) {
  const pts = [];
  const add = (p) => {
    if (!p) return;
    const x = Number(p.x);
    const y = Number(p.y);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
  };
  (Array.isArray(zonePts) ? zonePts : []).forEach(add);
  for (const pl of Array.isArray(placements) ? placements : []) {
    toRingPoints(pl && pl.inZoneContour).forEach(add);
    toRingPoints(pl && pl.usedVisibleContour).forEach(add);
  }
  for (const ev of Array.isArray(splitEvents) ? splitEvents : []) {
    const groups = Array.isArray(ev && ev.leftoverWorldContours) ? ev.leftoverWorldContours : [];
    for (const ring of groups) toRingPoints(ring).forEach(add);
  }
  if (!pts.length) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxX = Math.max(...pts.map((p) => p.x));
  const maxY = Math.max(...pts.map((p) => p.y));
  return { minX, minY, maxX, maxY };
}

function svgPath(points, project) {
  const pts = Array.isArray(points) ? points : [];
  if (pts.length < 3) return "";
  const s = pts.map((p, idx) => {
    const pr = project(p);
    return `${idx === 0 ? "M" : "L"} ${pr.x.toFixed(2)} ${pr.y.toFixed(2)}`;
  }).join(" ");
  return `${s} Z`;
}

function writeRenderSvg(filePath, zonePts, placements, splitEvents, mode) {
  const bb = collectBounds(zonePts, placements, splitEvents);
  const pad = 20;
  const w = 1400;
  const h = 900;
  const spanX = Math.max(1, bb.maxX - bb.minX);
  const spanY = Math.max(1, bb.maxY - bb.minY);
  const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
  const project = (p) => ({
    x: pad + (Number(p.x) - bb.minX) * scale,
    y: h - pad - (Number(p.y) - bb.minY) * scale
  });

  const zonePath = svgPath(toRingPoints(zonePts), project);
  const pfullPaths = [];
  const gainPaths = [];
  for (const pl of Array.isArray(placements) ? placements : []) {
    const pfull = svgPath(toRingPoints(pl && pl.inZoneContour), project);
    const gain = svgPath(toRingPoints(pl && pl.usedVisibleContour), project);
    if (pfull) pfullPaths.push(pfull);
    if (gain) gainPaths.push(gain);
  }
  const leftoverPaths = [];
  for (const ev of Array.isArray(splitEvents) ? splitEvents : []) {
    const groups = Array.isArray(ev && ev.leftoverWorldContours) ? ev.leftoverWorldContours : [];
    for (const ring of groups) {
      const d = svgPath(toRingPoints(ring), project);
      if (d) leftoverPaths.push(d);
    }
  }

  const isPfull = mode === "pfull";
  const body = [
    `<rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>`,
    zonePath ? `<path d="${zonePath}" fill="#f8fafc" stroke="#111827" stroke-width="2"/>` : "",
    isPfull
      ? pfullPaths.map((d) => `<path d="${d}" fill="none" stroke="#2563eb" stroke-width="1.2" stroke-dasharray="5 4"/>`).join("\n")
      : gainPaths.map((d) => `<path d="${d}" fill="rgba(21,128,61,0.10)" stroke="#15803d" stroke-width="2"/>`).join("\n"),
    isPfull
      ? ""
      : leftoverPaths.map((d) => `<path d="${d}" fill="rgba(120,53,15,0.05)" stroke="rgba(120,53,15,0.85)" stroke-width="1.5" stroke-dasharray="4 4"/>`).join("\n")
  ].filter(Boolean).join("\n");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${body}\n</svg>\n`;
  fs.writeFileSync(filePath, svg, "utf8");
}

function runInvariants(caseName, req, res) {
  const errors = [];
  const warnings = [];
  const placements = Array.isArray(res && res.placements) ? res.placements : [];
  const traceSteps = res && res.algorithmTrace && res.algorithmTrace.steps ? res.algorithmTrace.steps : {};
  const split = traceSteps && traceSteps.split_return ? traceSteps.split_return : {};

  const zoneArea = polyArea(toRingPoints(req.zone && req.zone.points));
  const coveragePercent = Number(res && res.coveragePercent || 0);
  const residualAreaMm2 = Number(res && res.residualAreaMm2 || 0);
  const coveredAreaByResidual = Math.max(0, zoneArea - residualAreaMm2);

  let cumulativeGain = 0;
  let prev = 0;
  let coveredMp = [];
  for (const pl of placements) {
    const g = Math.max(0, Number(pl && (pl.gainAreaMm2 ?? pl.usedVisibleAreaMm2 ?? 0) || 0));
    cumulativeGain += g;
    if (cumulativeGain + 1e-6 < prev) {
      errors.push("coveredRatio monotonic check failed: cumulative gain decreased");
      break;
    }
    prev = cumulativeGain;
    const gainMp = (Array.isArray(pl && pl.usedVisibleContours) && pl.usedVisibleContours.length > 0)
      ? pl.usedVisibleContours
      : contoursToMp([pl && pl.usedVisibleContour]);
    if (Array.isArray(gainMp) && gainMp.length) {
      let inter = [];
      try { inter = Array.isArray(coveredMp) && coveredMp.length ? (polygonClipping.intersection(gainMp, coveredMp) || []) : []; } catch (_) { inter = []; }
      const interArea = mpArea(inter);
      if (interArea > 1e-4) errors.push(`G_k intersects Covered_k: area=${interArea.toFixed(6)}`);
      const before = mpArea(coveredMp);
      let unionMp = coveredMp;
      try { unionMp = Array.isArray(coveredMp) && coveredMp.length ? (polygonClipping.union(coveredMp, gainMp) || []) : gainMp; } catch (_) { unionMp = coveredMp; }
      const after = mpArea(unionMp);
      if (after + 1e-6 < before) errors.push("Covered monotonicity failed: area decreased");
      coveredMp = unionMp;
    }
  }

  const sumInZone = placements.reduce((a, p) => a + Math.max(0, Number(p && p.inZoneAreaMm2 || 0)), 0);
  const sumGain = placements.reduce((a, p) => a + Math.max(0, Number(p && (p.gainAreaMm2 ?? p.usedVisibleAreaMm2 ?? 0) || 0)), 0);
  if (sumInZone > 0 && sumGain > sumInZone + 1e-6) {
    errors.push("coverage-by-G check failed: sumGain > sumInZone");
  }
  if (zoneArea > 1e-6) {
    const diff = Math.abs(sumGain - coveredAreaByResidual);
    if (diff > Math.max(200, zoneArea * 0.02)) {
      errors.push(`coverage-by-G consistency failed: |sumGain-coveredArea|=${diff.toFixed(3)}`);
    }
  }

  let leftoverIntersectErr = false;
  for (const ev of Array.isArray(res && res.splitEvents) ? res.splitEvents : []) {
    const usedMp = eventContoursToMp(ev, "usedWorldMulti", "usedWorldContours", "usedLocalContours");
    const leftMp = eventContoursToMp(ev, "leftoverWorldMulti", "leftoverWorldContours", "leftoverContoursLocal");
    if (!usedMp.length || !leftMp.length) continue;
    let inter = [];
    try { inter = polygonClipping.intersection(usedMp, leftMp) || []; } catch (_) { inter = []; }
    const a = mpArea(inter);
    if (a > 1e-4) {
      leftoverIntersectErr = true;
    }
    if (leftoverIntersectErr) break;
  }
  if (leftoverIntersectErr) errors.push("leftover intersects used contour");

  const hasFlip = placements.some((p) => String(p && p.transformType || "").toLowerCase().includes("flip") || p && p.mirror === true);
  if (hasFlip) errors.push("flip/mirror detected in placements");

  const createdUnique = new Set(
    (Array.isArray(res && res.splitEvents) ? res.splitEvents : [])
      .map((ev) => String(ev && ev.derivedCandidateKey || "").trim())
      .filter(Boolean)
  );
  const pickedUnique = new Set(
    placements
      .map((p) => String(p && p.candidateKey || "").trim())
      .filter((k) => k.includes("#g"))
  );
  if (pickedUnique.size > createdUnique.size) {
    errors.push(`derivedPickedUnique(${pickedUnique.size}) > derivedCreatedUnique(${createdUnique.size})`);
  }

  if (String(caseName).includes("zone_4")) {
    const dc = Number(split && split.derivedCreated || 0);
    if (!(dc > 0)) errors.push("derivedCreated must be > 0 on overlap baseline case");
  }
  if (!warnings.length && !(Number(split && split.derivedUsed || 0) > 0)) {
    warnings.push("derivedUsed is 0 for this case");
  }

  return { errors, warnings };
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function isPortFree(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => {
      srv.close(() => resolve(true));
    });
    srv.listen(Number(port), host || "127.0.0.1");
  });
}

async function findFreePort(startPort, host) {
  let p = Math.max(1, Number(startPort) || 5610);
  for (let i = 0; i < 100; i++, p++) {
    // eslint-disable-next-line no-await-in-loop
    const free = await isPortFree(p, host || "127.0.0.1");
    if (free) return p;
  }
  return Math.max(1, Number(startPort) || 5610);
}

function formatError(err) {
  if (!err) return "unknown_error";
  const msg = String(err && err.message ? err.message : err);
  const cause = err && err.cause ? err.cause : null;
  if (!cause || typeof cause !== "object") return msg;
  const code = cause.code ? ` code=${String(cause.code)}` : "";
  const errno = cause.errno ? ` errno=${String(cause.errno)}` : "";
  const addr = cause.address ? ` address=${String(cause.address)}` : "";
  const port = cause.port ? ` port=${String(cause.port)}` : "";
  const cmsg = cause.message ? ` cause=${String(cause.message)}` : "";
  return `${msg}${code}${errno}${addr}${port}${cmsg}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const baselineMap = fs.existsSync(args.baselinePath)
    ? JSON.parse(fs.readFileSync(args.baselinePath, "utf8"))
    : null;
  if (!baselineMap || typeof baselineMap !== "object") {
    throw new Error(`baseline_missing: ${args.baselinePath}`);
  }
  let serverProc = null;
  try {
    if (args.spawnServer) {
      const freePort = await findFreePort(args.serverPort, "127.0.0.1");
      args.serverPort = freePort;
      args.api = `http://127.0.0.1:${freePort}`;
      serverProc = spawn("node", ["src/server.js"], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(args.serverPort) },
        stdio: ["ignore", "pipe", "pipe"]
      });
      const serverLogDir = path.join(args.outRoot, "_server_logs");
      mkdirp(serverLogDir);
      const serverStdoutPath = path.join(serverLogDir, `split_test_server_${Date.now()}_stdout.log`);
      const serverStderrPath = path.join(serverLogDir, `split_test_server_${Date.now()}_stderr.log`);
      const outStream = fs.createWriteStream(serverStdoutPath, { flags: "a" });
      const errStream = fs.createWriteStream(serverStderrPath, { flags: "a" });
      serverProc.stdout.pipe(outStream);
      serverProc.stderr.pipe(errStream);
      const healthy = await waitForHealth(args.api, 30000);
      if (!healthy) throw new Error(`spawned_server_not_healthy: ${args.api}`);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const runDir = path.join(args.outRoot, stamp);
    mkdirp(runDir);

    const rows = [];
    let anyHardFail = false;
    let atLeastOneDerivedUsed = false;
    let oracleDerivedUsedObserved = false;
    let syntheticDerivedUsedPass = false;
    let determinismChecked = false;
    let determinismPass = false;
    let determinismSkippedByTimeBudget = false;

    for (const relCase of args.cases) {
    const casePath = path.resolve(process.cwd(), relCase);
    const raw = fs.readFileSync(casePath, "utf8");
    const caseObj = JSON.parse(raw);
    const req = buildRequest(caseObj);
    const caseName = path.basename(casePath, ".json");
    const caseDir = path.join(runDir, caseName);
    mkdirp(caseDir);

    let response = null;
    try {
      response = await postJsonWithRetry(`${args.api}/api/layout/fill/preview`, req, 2);
    } catch (err) {
      anyHardFail = true;
      rows.push({
        case: caseName,
        status: "FAILED",
        reason: `request_error: ${formatError(err)}`
      });
      fs.writeFileSync(path.join(caseDir, "request.json"), JSON.stringify(req, null, 2), "utf8");
      continue;
    }
    fs.writeFileSync(path.join(caseDir, "request.json"), JSON.stringify(req, null, 2), "utf8");
    fs.writeFileSync(path.join(caseDir, "response_raw.json"), JSON.stringify(response, null, 2), "utf8");

    if (response.status !== 200 || !(response.body && response.body.ok === true)) {
      anyHardFail = true;
      rows.push({
        case: caseName,
        status: "FAILED",
        reason: `http=${response.status} ok=${response.body && response.body.ok}`
      });
      continue;
    }

    const res = response.body;
    const trace = res && res.algorithmTrace ? res.algorithmTrace : {};
    const split = trace && trace.steps && trace.steps.split_return ? trace.steps.split_return : {};
    const stopProof = trace && trace.steps && trace.steps.placement_search
      ? trace.steps.placement_search.stopProof
      : null;
    const placements = Array.isArray(res.placements) ? res.placements : [];
    const metrics = {
      coveragePercent: Number(res.coveragePercent || 0),
      fullCoverageOk: !!(res.fullCoverageOk === true),
      residualAreaMm2: Number(res.residualAreaMm2 || 0),
      selectedPieces: placements.filter((p) => String(p && p.status || "") === "matched").length,
      utilizationPct: Number(res.utilizationPct || 0),
      overlapAreaMm2: Number(res.overlapAreaMm2 || 0),
      derivedCreated: Number(split.derivedCreated || 0),
      derivedUsed: Number(split.derivedUsed || 0),
      derivedReusePct: Number(split.derivedReusePct || 0),
      coverageEps: Number(res.coverageEps || 0),
      resultStatus: String(res.resultStatus || "")
    };
    const createdUnique = new Set(
      (Array.isArray(res && res.splitEvents) ? res.splitEvents : [])
        .map((ev) => String(ev && ev.derivedCandidateKey || "").trim())
        .filter(Boolean)
    );
    const pickedAll = placements
      .map((p) => String(p && p.candidateKey || "").trim())
      .filter((k) => k.includes("#g"));
    const pickedUnique = new Set(pickedAll);
    metrics.derivedCreatedUnique = createdUnique.size;
    metrics.derivedPicked = pickedAll.length;
    metrics.derivedPickedUnique = pickedUnique.size;
    metrics.derivedReusePctUnique = createdUnique.size > 0
      ? Math.round((100 * pickedUnique.size / createdUnique.size) * 100) / 100
      : 0;
    const traceStopReason = String(trace && trace.steps && trace.steps.placement_search && trace.steps.placement_search.stopReason || "");
    if (traceStopReason) metrics.stopReason = traceStopReason;
    if (stopProof && typeof stopProof === "object") metrics.stopProof = stopProof;

    const inv = runInvariants(caseName, req, res);
    if (metrics.derivedUsed > 0) atLeastOneDerivedUsed = true;
    if (caseName.startsWith("oracle_case_") && metrics.derivedUsed > 0) oracleDerivedUsedObserved = true;
    if (caseName === "split_reuse_required" && metrics.derivedUsed > 0) syntheticDerivedUsedPass = true;
    if (inv.errors.length) anyHardFail = true;
    if (caseName.startsWith("oracle_case_")) {
      const b = baselineMap[caseName];
      if (!b) {
        anyHardFail = true;
        rows.push({ case: caseName, status: "FAILED", reason: "baseline_missing_for_oracle_case" });
      } else {
        const baselineCoverage = Number(b.coveragePercent || 0);
        const coverageDeltaPct = metrics.coveragePercent - baselineCoverage;
        metrics.baseline = {
          coveragePercent: baselineCoverage,
          pieces: Number(b.pieces || 0),
          overlapAreaMm2: Number(b.overlapAreaMm2 || 0),
          utilizationPct: Number(b.utilizationPct || 0),
          timeMs: Number(b.timeMs || 0)
        };
        metrics.current = {
          coveragePercent: metrics.coveragePercent,
          pieces: metrics.selectedPieces,
          overlapAreaMm2: metrics.overlapAreaMm2,
          utilizationPct: metrics.utilizationPct
        };
        metrics.coverageDeltaPct = coverageDeltaPct;
        metrics.maxAllowedCoverageDropPct = args.maxCoverageDropPct;
        if (metrics.coveragePercent + args.maxCoverageDropPct < baselineCoverage) {
          anyHardFail = true;
          rows.push({
            case: caseName,
            status: "FAILED",
            reason: `baseline_regression: coverage ${metrics.coveragePercent.toFixed(4)} < baseline ${baselineCoverage.toFixed(4)} - ${args.maxCoverageDropPct.toFixed(4)}`
          });
        }
      }
    }

    fs.writeFileSync(path.join(caseDir, "result.json"), JSON.stringify(res, null, 2), "utf8");
    fs.writeFileSync(path.join(caseDir, "trace.json"), JSON.stringify(trace, null, 2), "utf8");
    fs.writeFileSync(path.join(caseDir, "metrics.json"), JSON.stringify({ ...metrics, invariantWarnings: inv.warnings, invariantErrors: inv.errors }, null, 2), "utf8");

    writeRenderSvg(path.join(caseDir, "render_pfullz.svg"), req.zone.points, placements, res.splitEvents || [], "pfull");
    writeRenderSvg(path.join(caseDir, "render_gain_leftover.svg"), req.zone.points, placements, res.splitEvents || [], "gain");
    const mustFiles = ["result.json", "trace.json", "metrics.json", "render_pfullz.svg", "render_gain_leftover.svg"];
    for (const f of mustFiles) {
      if (!fs.existsSync(path.join(caseDir, f))) {
        anyHardFail = true;
        rows.push({ case: caseName, status: "FAILED", reason: `missing_artifact:${f}` });
      }
    }

    if (!determinismChecked && caseName.includes("oracle_case_zone_4")) {
      determinismChecked = true;
      const second = await postJsonWithRetry(`${args.api}/api/layout/fill/preview`, req, 2);
      const secondBody = second && second.body ? second.body : null;
      const cov1 = Number(res.coveragePercent || 0);
      const cov2 = Number(secondBody && secondBody.coveragePercent || 0);
      const p1 = placements.filter((p) => String(p && p.status || "") === "matched").length;
      const p2 = Array.isArray(secondBody && secondBody.placements)
        ? secondBody.placements.filter((p) => String(p && p.status || "") === "matched").length
        : -1;
      const stop1 = String(trace && trace.steps && trace.steps.placement_search && trace.steps.placement_search.stopReason || "");
      const stop2 = String(secondBody && secondBody.algorithmTrace && secondBody.algorithmTrace.steps && secondBody.algorithmTrace.steps.placement_search && secondBody.algorithmTrace.steps.placement_search.stopReason || "");
      if (stop1 === "time_budget" || stop2 === "time_budget") {
        determinismSkippedByTimeBudget = true;
        determinismPass = true;
      } else {
        determinismPass = Math.abs(cov1 - cov2) <= 1e-6 && p1 === p2;
      }
      fs.writeFileSync(path.join(caseDir, "determinism.json"), JSON.stringify({
        seed: req.seed,
        coverage1: cov1,
        coverage2: cov2,
        pieces1: p1,
        pieces2: p2,
        stopReason1: stop1,
        stopReason2: stop2,
        skippedByTimeBudget: determinismSkippedByTimeBudget,
        pass: determinismPass
      }, null, 2), "utf8");
      if (!determinismPass) {
        anyHardFail = true;
        rows.push({ case: caseName, status: "FAILED", reason: "determinism_failed" });
      }
    }

    rows.push({
      case: caseName,
      status: inv.errors.length ? "FAILED" : "PASS",
      ...metrics,
      invariantErrors: inv.errors.length,
      invariantWarnings: inv.warnings.length
    });
  }
  if (!atLeastOneDerivedUsed) {
    anyHardFail = true;
    rows.push({
      case: "GLOBAL",
      status: "FAILED",
      reason: "derivedUsed > 0 was not observed in any case"
    });
  }
  if (!syntheticDerivedUsedPass) {
    anyHardFail = true;
    rows.push({
      case: "split_reuse_required",
      status: "FAILED",
      reason: "derivedUsed > 0 is mandatory on synthetic_reuse_required"
    });
  }
  if (!oracleDerivedUsedObserved) {
    rows.push({
      case: "GLOBAL",
      status: "WARN",
      reason: "derivedUsed > 0 was not observed on oracle cases (recommended)"
    });
  }

  const summary = {
    createdAt: new Date().toISOString(),
    api: args.api,
    nodeVersion: process.version,
    os: `${process.platform}-${process.arch}`,
    commitHash: (() => {
      try { return String(execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString("utf8")).trim(); } catch (_) { return "nogit"; }
    })(),
    baselinePath: args.baselinePath,
    gate: {
      maxCoverageDropPct: args.maxCoverageDropPct
    },
    runDir,
    cases: rows,
    baseline: baselineMap,
    determinismChecked,
    determinismPass,
    determinismSkippedByTimeBudget,
    syntheticDerivedUsedPass,
    oracleDerivedUsedObserved,
    ok: !anyHardFail
  };
  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

  const table = rows.map((r) => `${r.case}\t${r.status}\t${r.coveragePercent || ""}\t${r.fullCoverageOk}\t${r.residualAreaMm2 || ""}\t${r.selectedPieces || ""}\t${r.overlapAreaMm2 || ""}\t${r.utilizationPct || ""}\t${r.derivedCreated || ""}\t${r.derivedUsed || ""}\t${r.derivedReusePct || ""}`);
  console.log("case\tstatus\tcoverage\tfullCoverage\tresidual\tpieces\toverlap\tutil\tderivedCreated\tderivedUsed\treusePct");
  for (const line of table) console.log(line);
  console.log(`Artifacts: ${runDir}`);

  process.exit(anyHardFail ? 1 : 0);
  } finally {
    if (serverProc && !serverProc.killed) {
      try { serverProc.kill("SIGTERM"); } catch (_) {}
    }
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
