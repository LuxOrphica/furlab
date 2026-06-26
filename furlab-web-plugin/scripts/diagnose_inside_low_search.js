#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");

const IN_FILE = path.join(process.cwd(), "tmp", "selftest", "intarsia_ui_selftest.json");
const OUT_DIR = path.join(process.cwd(), "tmp", "selftest", "inside_low_debug");
const OUT_JSON = path.join(OUT_DIR, "inside_low_debug_report.json");
const OUT_OVERLAY_DIR = path.join(OUT_DIR, "overlays");
const PORT = String(process.env.DIAG_PORT || 5647);
const BASE = `http://127.0.0.1:${PORT}`;
const MAX_CASES = Math.max(5, Math.min(10, Number(process.env.DIAG_CASES || 8)));

function waitHealth(timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http
        .get(`${BASE}/api/health`, (res) => {
          res.resume();
          if (res.statusCode === 200) return resolve();
          if (Date.now() - started > timeoutMs) return reject(new Error(`health_status_${res.statusCode}`));
          setTimeout(tick, 250);
        })
        .on("error", () => {
          if (Date.now() - started > timeoutMs) return reject(new Error("health_timeout"));
          setTimeout(tick, 250);
        });
    };
    tick();
  });
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json || json.ok === false) {
    throw new Error(`${url} -> ${(json && (json.error || json.message)) || res.status}`);
  }
  return json;
}

function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function polygonArea(points) {
  const pts = Array.isArray(points) ? points : [];
  if (pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) * 0.5;
}

function polygonBBox(points) {
  const pts = Array.isArray(points) ? points : [];
  if (!pts.length) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of pts) {
    minX = Math.min(minX, safeNum(p.x));
    minY = Math.min(minY, safeNum(p.y));
    maxX = Math.max(maxX, safeNum(p.x));
    maxY = Math.max(maxY, safeNum(p.y));
  }
  return { minX, minY, maxX, maxY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

function centroid(points) {
  const pts = Array.isArray(points) ? points : [];
  if (!pts.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += safeNum(p.x);
    y += safeNum(p.y);
  }
  return { x: x / pts.length, y: y / pts.length };
}

function pointInPolygon(point, polygon) {
  const x = safeNum(point && point.x);
  const y = safeNum(point && point.y);
  const pts = Array.isArray(polygon) ? polygon : [];
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = safeNum(pts[i].x);
    const yi = safeNum(pts[i].y);
    const xj = safeNum(pts[j].x);
    const yj = safeNum(pts[j].y);
    const intersects = ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function closedPoints(points) {
  const pts = Array.isArray(points) ? points : [];
  if (pts.length < 2) return pts.slice();
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6) return pts.slice();
  return pts.concat([{ x: a.x, y: a.y }]);
}

function samplePolyline(points, count) {
  const pts = closedPoints(points);
  if (pts.length < 2) return [];
  const segments = [];
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len <= 1e-9) continue;
    segments.push({ a, b, len });
    total += len;
  }
  if (!segments.length || total <= 1e-9) return [];
  const n = Math.max(8, Number(count || 24));
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * total;
    let acc = 0;
    let seg = segments[segments.length - 1];
    for (const s of segments) {
      if (acc + s.len >= t) {
        seg = s;
        break;
      }
      acc += s.len;
    }
    const lt = (t - acc) / (seg.len || 1);
    out.push({
      x: seg.a.x + (seg.b.x - seg.a.x) * lt,
      y: seg.a.y + (seg.b.y - seg.a.y) * lt
    });
  }
  return out;
}

function avgNearestDistance(fromPts, toPts) {
  if (!fromPts.length || !toPts.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (const p of fromPts) {
    let best = Number.POSITIVE_INFINITY;
    for (const q of toPts) {
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum / fromPts.length;
}

function rotateAround(points, deg, center) {
  const c = center || centroid(points);
  const r = (deg * Math.PI) / 180;
  const ca = Math.cos(r);
  const sa = Math.sin(r);
  return points.map((p) => {
    const x = p.x - c.x;
    const y = p.y - c.y;
    return { x: c.x + x * ca - y * sa, y: c.y + x * sa + y * ca };
  });
}

function translate(points, dx, dy) {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

function evalFit(fragmentPoints, candidateContour, rotationDeg, shiftX, shiftY) {
  const fArea = Math.max(1e-9, polygonArea(fragmentPoints));
  const cArea = Math.max(1e-9, polygonArea(candidateContour));
  const fragSample = samplePolyline(fragmentPoints, 36);
  const candSample = samplePolyline(candidateContour, 36);
  const insideCand = candSample.length
    ? candSample.filter((p) => pointInPolygon(p, fragmentPoints)).length / candSample.length
    : 0;
  const insideFrag = fragSample.length
    ? fragSample.filter((p) => pointInPolygon(p, candidateContour)).length / fragSample.length
    : 0;
  const overlapApprox = (insideCand + insideFrag) * 0.5;
  const d1 = avgNearestDistance(candSample, fragSample);
  const d2 = avgNearestDistance(fragSample, candSample);
  const chamferMm = (d1 + d2) * 0.5;
  const fb = polygonBBox(fragmentPoints) || { width: 1, height: 1 };
  const diag = Math.max(1, Math.hypot(fb.width, fb.height));
  const chamferNorm = Math.min(1, chamferMm / (diag * 0.22));
  const areaRatio = Math.min(fArea, cArea) / Math.max(fArea, cArea);
  const coverageRatio = cArea / fArea;
  const fitScore = 44 * overlapApprox + 26 * (1 - chamferNorm) + 22 * areaRatio + 8;
  return {
    fitScore,
    insidePercent: insideCand * 100,
    overlapApprox,
    areaRatio,
    coverageRatio,
    chamferMm,
    rotationDeg,
    offsetX: shiftX,
    offsetY: shiftY,
    alignedContour: candidateContour
  };
}

function classInsideNeed(fragmentClass) {
  const base = fragmentClass === "internal"
    ? 0.9
    : (fragmentClass === "edge" ? 0.75 : (fragmentClass === "corner" ? 0.68 : 0.6));
  return Math.max(0.12, Math.min(0.65, (base - 0.2) * 0.45));
}

function polyToPath(points, tx, ty, s) {
  if (!Array.isArray(points) || points.length < 2) return "";
  const p0 = points[0];
  let d = `M ${(p0.x + tx) * s} ${(p0.y + ty) * s}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${(points[i].x + tx) * s} ${(points[i].y + ty) * s}`;
  }
  return `${d} Z`;
}

function writeOverlaySvg(outFile, fragment, autoContour, bruteContour, title) {
  const all = [].concat(fragment || [], autoContour || [], bruteContour || []);
  const bb = polygonBBox(all) || { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 };
  const pad = 20;
  const w = 900;
  const h = 700;
  const sx = (w - pad * 2) / Math.max(1, bb.width);
  const sy = (h - pad * 2) / Math.max(1, bb.height);
  const s = Math.min(sx, sy);
  const tx = -bb.minX + pad / s;
  const ty = -bb.minY + pad / s;
  const fragPath = polyToPath(fragment, tx, ty, s);
  const autoPath = polyToPath(autoContour, tx, ty, s);
  const brutePath = polyToPath(bruteContour, tx, ty, s);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n  <rect x="0" y="0" width="${w}" height="${h}" fill="#fff"/>\n  <text x="12" y="24" font-family="Consolas, monospace" font-size="14" fill="#222">${title}</text>\n  <path d="${fragPath}" fill="none" stroke="#111" stroke-width="2"/>\n  <path d="${autoPath}" fill="rgba(220,53,69,0.12)" stroke="#dc3545" stroke-width="2"/>\n  <path d="${brutePath}" fill="rgba(25,135,84,0.12)" stroke="#198754" stroke-width="2"/>\n  <rect x="12" y="34" width="10" height="10" fill="#dc3545"/><text x="28" y="43" font-size="12" font-family="Consolas, monospace">auto</text>\n  <rect x="90" y="34" width="10" height="10" fill="#198754"/><text x="106" y="43" font-size="12" font-family="Consolas, monospace">brute</text>\n</svg>`;
  fs.writeFileSync(outFile, svg, "utf8");
}

function classifyCase(autoFit, bruteFit, minInside, bestOtherScore) {
  const autoIn = Number(autoFit.insidePercent || 0) / 100;
  const bruteIn = Number(bruteFit.insidePercent || 0) / 100;
  const bruteFeasible = bruteIn + 1e-9 >= minInside;
  if (!bruteFeasible) return "truly_infeasible";
  if (Number(bruteFit.fitScore || 0) + 1e-9 < Number(bestOtherScore || 0)) return "feasible_but_loses_on_score";
  if (bruteIn - autoIn >= 0.05) return "feasible_but_search_failed";
  return "feasible_but_loses_on_score";
}

async function main() {
  if (!fs.existsSync(IN_FILE)) {
    throw new Error(`missing ${IN_FILE}; run selftest_intarsia_ui.js first`);
  }
  const data = JSON.parse(fs.readFileSync(IN_FILE, "utf8"));
  const req = data.assignRequest;
  const res = data.assignResponse;
  if (!req || !res) throw new Error("assignRequest/assignResponse missing in selftest file");

  const fragments = Array.isArray(req.fragments) ? req.fragments : [];
  const fragById = new Map(fragments.map((f) => [Number(f.id), f]));
  const classes = new Map();
  for (const p of (Array.isArray(res.placements) ? res.placements : [])) {
    classes.set(Number(p.fragmentId), String(p.fragmentClass || "internal"));
  }

  const server = spawn("node", ["src/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (d) => process.stdout.write(d.toString()));
  server.stderr.on("data", (d) => process.stderr.write(d.toString()));

  try {
    await waitHealth();
    const cases = [];
    const strategyWins = { auto: 0, brute: 0 };
    const pb = res && res.diagnostics && res.diagnostics.placementBreakdown && typeof res.diagnostics.placementBreakdown === "object"
      ? res.diagnostics.placementBreakdown
      : {};
    const insideSamples = pb && pb.rejectedSamples && Array.isArray(pb.rejectedSamples.inside_low)
      ? pb.rejectedSamples.inside_low
      : [];

    for (const it of insideSamples) {
      if (cases.length >= MAX_CASES) break;
      const fragmentId = Number(it && it.fragmentId || 0);
      const frag = fragById.get(fragmentId);
      if (!frag || !Array.isArray(frag.points) || frag.points.length < 3) continue;
      const fragmentClass = String(it && it.fragmentClass || classes.get(fragmentId) || "internal");
      const minInside = classInsideNeed(fragmentClass);
      const autoContour = Array.isArray(it && it.alignedContour) ? it.alignedContour : [];
      if (autoContour.length < 3) continue;
      const bestForFragment = await postJson(`${BASE}/api/layout/fragment/candidates`, {
        fragment: { id: fragmentId, points: frag.points },
        axis: String(req.axis || "y"),
        filters: req.filters || {},
        constraints: { ...(req.constraints || {}), minFitScore: 0 },
        candidates: req.candidates || [],
        limit: 1,
        excludeInventoryTags: []
      });
      const bestOtherScore = Array.isArray(bestForFragment.items) && bestForFragment.items.length
        ? Number(bestForFragment.items[0].fitScore || 0)
        : 0;
        const autoFit = {
          fitScore: Number(it && it.fitScore || 0),
          insidePercent: Number(it && it.fitInsidePercent || 0),
          coverageRatio: Number(it && it.fitCoverageRatio || 0),
          rotationDeg: Number(it && it.alignRotationDeg || 0),
          offsetX: Number(it && it.alignOffsetX || 0),
          offsetY: Number(it && it.alignOffsetY || 0),
          alignedContour: autoContour
        };

        const bb = polygonBBox(frag.points) || { width: 0, height: 0 };
        const shiftValsX = [-0.2, -0.1, 0, 0.1, 0.2].map((k) => k * bb.width);
        const shiftValsY = [-0.2, -0.1, 0, 0.1, 0.2].map((k) => k * bb.height);
        const angleVals = [];
        for (let a = -20; a <= 20; a += 2) angleVals.push(a);
        const c0 = centroid(autoContour);
        let bruteBest = null;
        let bruteAttempts = 0;
        for (const ad of angleVals) {
          const rotated = rotateAround(autoContour, ad, c0);
          for (const dx of shiftValsX) {
            for (const dy of shiftValsY) {
              bruteAttempts += 1;
              const moved = translate(rotated, dx, dy);
              const fit = evalFit(frag.points, moved, autoFit.rotationDeg + ad, autoFit.offsetX + dx, autoFit.offsetY + dy);
              if (!bruteBest || Number(fit.fitScore) > Number(bruteBest.fitScore)) bruteBest = fit;
            }
          }
        }
        if (!bruteBest) continue;
        const cls = classifyCase(autoFit, bruteBest, minInside, bestOtherScore);
        if (Number(bruteBest.fitScore || 0) > Number(autoFit.fitScore || 0)) strategyWins.brute += 1;
        else strategyWins.auto += 1;
        const idx = cases.length + 1;
        const overlayFile = path.join(OUT_OVERLAY_DIR, `case_${String(idx).padStart(2, "0")}_f${fragmentId}.svg`);
        writeOverlaySvg(
          overlayFile,
          frag.points,
          autoFit.alignedContour,
          bruteBest.alignedContour,
          `fragment=${fragmentId} tag=${String(it && it.inventoryTag || "")} class=${fragmentClass} verdict=${cls}`
        );
        cases.push({
          fragmentId,
          scrapPieceId: String(it && it.scrapPieceId || ""),
          inventoryTag: String(it && it.inventoryTag || ""),
          fragmentClass,
          auto: {
            angle: autoFit.rotationDeg,
            shiftX: autoFit.offsetX,
            shiftY: autoFit.offsetY,
            inside: Number(autoFit.insidePercent.toFixed(2)),
            outside: Number((100 - autoFit.insidePercent).toFixed(2)),
            coverage: Number((Number(it && it.fitCoverageRatio || 0) * 100).toFixed(2)),
            score: Number(autoFit.fitScore.toFixed(3))
          },
          brute: {
            angle: Number(bruteBest.rotationDeg.toFixed(2)),
            shiftX: Number(bruteBest.offsetX.toFixed(2)),
            shiftY: Number(bruteBest.offsetY.toFixed(2)),
            inside: Number(bruteBest.insidePercent.toFixed(2)),
            outside: Number((100 - bruteBest.insidePercent).toFixed(2)),
            coverage: Number((Number(bruteBest.coverageRatio || 0) * 100).toFixed(2)),
            score: Number(bruteBest.fitScore.toFixed(3))
          },
          verdict: cls,
          overlay: overlayFile.replace(process.cwd() + path.sep, ""),
          search: {
            autoAttemptsPerPair: 28,
            bruteAttemptsPerPair: bruteAttempts
          }
        });
    }

    const tally = { truly_infeasible: 0, feasible_but_search_failed: 0, feasible_but_loses_on_score: 0 };
    for (const c of cases) tally[c.verdict] = Number(tally[c.verdict] || 0) + 1;

    const report = {
      scope: "regular+intarsia+assignOnly",
      searchSpace: {
        auto: {
          anchors: ["centroid"],
          angleDeltasDeg: [0, -8, 8],
          shifts: ["x: -0.07*bboxW, 0, +0.07*bboxW", "y: -0.07*bboxH, 0, +0.07*bboxH"],
          attemptsPerPair: 28
        },
        bruteDenseForDebug: {
          anchors: ["centroid(auto contour)"],
          angleDeltasDeg: "[-20..+20] step 2",
          shifts: ["x: [-20%,-10%,0,+10%,+20%]*bboxW", "y: [-20%,-10%,0,+10%,+20%]*bboxH"],
          attemptsPerPair: 275
        },
        bestStrategyWins: strategyWins
      },
      cases,
      summary: tally
    };

    fs.mkdirSync(OUT_OVERLAY_DIR, { recursive: true });
    fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), "utf8");
    console.log(`INSIDE_LOW_REPORT ${OUT_JSON}`);
    console.log(JSON.stringify(report.summary, null, 2));
  } finally {
    server.kill("SIGTERM");
    setTimeout(() => {
      try {
        server.kill("SIGKILL");
      } catch (_) {}
    }, 1000);
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
