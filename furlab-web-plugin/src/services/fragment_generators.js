"use strict";

const ClipperLib = require("clipper-lib");
const { pointsToMultiPolygon, intersectMulti, unionMulti, diffMulti } = require("./polygon_ops");
const { createSeededRng } = require("./solver_primitives");

const CLIPPER_SCALE = 1000;

function applyInwardOffset(points, offsetMm) {
  if (offsetMm <= 0 || !points || points.length < 3) return points;
  const scale = CLIPPER_SCALE;
  const path = points.map(p => ({ X: Math.round(p.x * scale), Y: Math.round(p.y * scale) }));
  const co = new ClipperLib.ClipperOffset();
  co.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const out = new ClipperLib.Paths();
  co.Execute(out, -offsetMm * scale);
  if (!out || !out.length) return null;
  const best = out.reduce((a, b) => b.length > a.length ? b : a, out[0]);
  const result = best.map(p => ({ x: p.X / scale, y: p.Y / scale }));
  return result.length >= 3 ? result : null;
}

// ---- helpers (duplicated from server.js; will be unified in a later refactor) ----

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeScale10(v, fallback = 5) {
  const n = safeNum(v);
  if (n === null) return fallback;
  if (n <= 10) return Math.max(1, Math.min(10, n));
  return Math.max(1, Math.min(10, n / 10));
}

function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) * 0.5;
}

function polygonBBox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points || []) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
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

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function randomPointInPolygon(poly, bbox, maxAttempts, randFn) {
  maxAttempts = maxAttempts || 400;
  randFn = randFn || Math.random;
  for (let i = 0; i < maxAttempts; i++) {
    const x = bbox.minX + randFn() * bbox.width;
    const y = bbox.minY + randFn() * bbox.height;
    if (pointInPolygon({ x, y }, poly)) return { x, y };
  }
  return centroid(poly);
}

function clipPolygonByHalfPlane(poly, nx, ny, c) {
  const out = [];
  if (!Array.isArray(poly) || poly.length < 3) return out;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = nx * a.x + ny * a.y + c;
    const db = nx * b.x + ny * b.y + c;
    const ina = da >= 0;
    const inb = db >= 0;
    if (ina && inb) {
      out.push({ x: b.x, y: b.y });
    } else if (ina && !inb) {
      const t = da / (da - db || 1e-9);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    } else if (!ina && inb) {
      const t = da / (da - db || 1e-9);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      out.push({ x: b.x, y: b.y });
    }
  }
  return out;
}

function splitPolygonByLine(poly, px, py, dx, dy) {
  const nx = -Number(dy || 0);
  const ny = Number(dx || 0);
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || (Math.abs(nx) < 1e-9 && Math.abs(ny) < 1e-9)) return [];
  const c = -((nx * Number(px || 0)) + (ny * Number(py || 0)));
  const a = clipPolygonByHalfPlane(poly, nx, ny, c);
  const b = clipPolygonByHalfPlane(poly, -nx, -ny, -c);
  const out = [];
  if (Array.isArray(a) && a.length >= 3) out.push(a);
  if (Array.isArray(b) && b.length >= 3) out.push(b);
  return out;
}

function clipPolygonByBand(poly, nx, ny, lower, upper) {
  let out = clipPolygonByHalfPlane(poly, nx, ny, -lower);
  out = clipPolygonByHalfPlane(out, -nx, -ny, upper);
  return out;
}

function buildRoundedRectPolygon(x0, y0, x1, y1, radiusMm) {
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const rRaw = Math.max(0, safeNum(radiusMm) || 0);
  const r = Math.max(0, Math.min(rRaw, Math.max(0, Math.min(w, h) * 0.5 - 1e-6)));
  if (!(w > 0 && h > 0)) return [];
  if (!(r > 1e-9)) {
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  }
  const seg = 4;
  const pts = [];
  const addArc = (cx, cy, a0, a1) => {
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const a = a0 + (a1 - a0) * t;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  };
  addArc(x1 - r, y0 + r, -Math.PI / 2, 0);
  addArc(x1 - r, y1 - r, 0, Math.PI / 2);
  addArc(x0 + r, y1 - r, Math.PI / 2, Math.PI);
  addArc(x0 + r, y0 + r, Math.PI, Math.PI * 1.5);
  return pts;
}

function multiPolygonOuterRingsToPoints(mp) {
  const out = [];
  if (!Array.isArray(mp)) return out;
  for (const poly of mp) {
    if (!Array.isArray(poly) || !Array.isArray(poly[0]) || poly[0].length < 4) continue;
    const ring = poly[0];
    const pts = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const p = ring[i];
      const x = Number(p && p[0]);
      const y = Number(p && p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push({ x, y });
    }
    if (pts.length >= 3) out.push(pts);
  }
  return out;
}

function fillRemainderIntoFrags(frags, zoneMp) {
  if (!frags.length) return;
  try {
    let coveredMp = pointsToMultiPolygon(frags[0]);
    for (let i = 1; i < frags.length; i++) {
      try { coveredMp = unionMulti(coveredMp, pointsToMultiPolygon(frags[i])); } catch (_) {}
    }
    const remainderMp = diffMulti(zoneMp, coveredMp);
    const remainderPieces = multiPolygonOuterRingsToPoints(remainderMp);
    for (const rem of remainderPieces) {
      if (polygonArea(rem) < 10) continue;
      let rx = 0, ry = 0;
      for (const p of rem) { rx += p.x; ry += p.y; }
      rx /= rem.length; ry /= rem.length;
      let bestIdx = 0, bestDist = Infinity;
      for (let i = 0; i < frags.length; i++) {
        const f = frags[i];
        let fx = 0, fy = 0;
        for (const p of f) { fx += p.x; fy += p.y; }
        fx /= f.length; fy /= f.length;
        const d = Math.hypot(fx - rx, fy - ry);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      try {
        const merged = unionMulti(pointsToMultiPolygon(frags[bestIdx]), pointsToMultiPolygon(rem));
        const mergedPieces = multiPolygonOuterRingsToPoints(merged);
        if (mergedPieces.length === 1) {
          frags[bestIdx] = mergedPieces[0];
        } else {
          frags.push(rem);
        }
      } catch (_) { frags.push(rem); }
    }
  } catch (_) {}
}

// ================================================================
// Voronoi
// ================================================================

function _buildVoronoiCells(zonePoints, seeds, anisotropy, axis, gapMm, minArea) {
  const k = 1 + ((anisotropy - 5) / 5) * 0.8;
  const fragments = [];
  for (let i = 0; i < seeds.length; i++) {
    const pi = seeds[i];
    let cell = zonePoints.map((p) => ({ x: p.x, y: p.y }));
    for (let j = 0; j < seeds.length; j++) {
      if (i === j) continue;
      const pj = seeds[j];
      const dx = pj.x - pi.x, dy = pj.y - pi.y;
      const midx = (pi.x + pj.x) * 0.5, midy = (pi.y + pj.y) * 0.5;
      const kx = axis === "x" ? k : 1, ky = axis === "y" ? k : 1;
      const nx = -(kx * kx) * dx, ny = -(ky * ky) * dy;
      const c = midx * (dx * kx * kx) + midy * (dy * ky * ky);
      cell = clipPolygonByHalfPlane(cell, nx, ny, c);
      if (cell.length < 3) break;
    }
    if (cell.length < 3) continue;
    if (gapMm > 0) { cell = applyInwardOffset(cell, gapMm / 2); if (!cell || cell.length < 3) continue; }
    if (polygonArea(cell) < minArea) continue;
    fragments.push(cell);
  }
  return fragments;
}

function _polygonCentroid(pts) {
  let cx = 0, cy = 0, area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    area += cross;
    cx += (pts[i].x + pts[j].x) * cross;
    cy += (pts[i].y + pts[j].y) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-9) return { x: pts.reduce((s,p)=>s+p.x,0)/pts.length, y: pts.reduce((s,p)=>s+p.y,0)/pts.length };
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

function generateVoronoiFragments(zonePoints, options) {
  const area = polygonArea(zonePoints);
  const _minAreaOpt = safeNum(options.minAreaMm2);
  const minArea = _minAreaOpt !== null ? Math.max(0, _minAreaOpt) : 500;
  const subMode = String(options.subMode || "random");
  const density = normalizeScale10(options.density, 5);
  const variability = normalizeScale10(options.variability, 5);
  const anisotropy = normalizeScale10(options.anisotropy, 5);
  const gapMm = Math.max(0, safeNum(options.gapMm) || 0);
  const limit = Math.max(8, Math.min(240, safeNum(options.maxCandidates) || 500));
  const minCandidates = Math.max(1, safeNum(options.minCandidates) || 1);
  const axis = String(options.axis || "y").toLowerCase() === "x" ? "x" : "y";
  const _directCount = safeNum(options.cellCount);
  const targetCount = _directCount >= 1
    ? Math.max(minCandidates, Math.min(120, Math.round(_directCount)))
    : Math.max(minCandidates, Math.max(6, Math.min(120, Math.min(limit, Math.round((area / 12000) * (0.65 + density * 0.18))))));
  const bbox = polygonBBox(zonePoints);
  if (!bbox || bbox.width <= 0 || bbox.height <= 0) return [];
  const rng = createSeededRng(options && options.seed);

  let seeds = [];

  if (subMode === "nap") {
    // Seeds on a grid aligned with nap axis, jittered by variability
    const cols = Math.round(Math.sqrt(targetCount * (bbox.width / bbox.height)));
    const rows = Math.ceil(targetCount / Math.max(1, cols));
    const jitter = (variability / 10) * 0.4;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = bbox.x + (c + 0.5 + (rng.next() - 0.5) * jitter) * (bbox.width / cols);
        const y = bbox.y + (r + 0.5 + (rng.next() - 0.5) * jitter) * (bbox.height / rows);
        seeds.push({ x, y });
      }
    }
  } else {
    // random / uniform — start with random seeds inside polygon
    const spread = 0.15 + (variability / 10) * 0.45;
    for (let i = 0; i < targetCount; i++) {
      const p = randomPointInPolygon(zonePoints, bbox, 400, () => rng.next());
      const jx = (rng.next() - 0.5) * bbox.width * spread * 0.06;
      const jy = (rng.next() - 0.5) * bbox.height * spread * 0.06;
      seeds.push({ x: p.x + jx, y: p.y + jy });
    }
    if (subMode === "uniform") {
      // Lloyd relaxation — 5 iterations
      for (let iter = 0; iter < 5; iter++) {
        const cells = _buildVoronoiCells(zonePoints, seeds, anisotropy, axis, 0, 0);
        if (cells.length < 2) break;
        const next = cells.map(cell => _polygonCentroid(cell));
        // keep only seeds that produced a valid cell
        seeds = next.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
        if (seeds.length < 2) break;
      }
    }
  }

  return _buildVoronoiCells(zonePoints, seeds, anisotropy, axis, gapMm, minArea);
}

// ================================================================
// Regular (grid)
// ================================================================

function generateRegularFragments(zonePoints, options) {
  const bbox = polygonBBox(zonePoints);
  if (!bbox || bbox.width <= 0 || bbox.height <= 0) return [];
  const zoneMp = pointsToMultiPolygon(zonePoints);
  if (!Array.isArray(zoneMp) || zoneMp.length === 0) return [];
  const rng = createSeededRng(options && options.seed);
  const axis = String(options.axis || "y").toLowerCase() === "x" ? "x" : "y";
  let rows = Math.max(1, Math.min(20, safeNum(options.rows) || 5));
  let cols = Math.max(1, Math.min(20, safeNum(options.cols) || 5));
  const gapX = Math.max(0, safeNum(options.gapX) || 0);
  const gapY = Math.max(0, safeNum(options.gapY) || 0);
  const cornerRadius = Math.max(0, safeNum(options.cornerRadius) || 0);
  const variability = normalizeScale10(options.variability, 3);
  const minArea = Math.max(50, safeNum(options.minAreaMm2) || 500);
  const regularStrategy = String(options && options.regularStrategy || "").trim().toLowerCase();
  const xCuts = [bbox.minX];
  const yCuts = [bbox.minY];

  function scanlineWidestInterval(points, y) {
    const pts = Array.isArray(points) ? points : [];
    if (pts.length < 3) return null;
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ax = Number(a && a.x), ay = Number(a && a.y);
      const bx = Number(b && b.x), by = Number(b && b.y);
      if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
      if (Math.abs(ay - by) < 1e-9) continue;
      const crosses = (ay <= y && y < by) || (by <= y && y < ay);
      if (!crosses) continue;
      xs.push(ax + (bx - ax) * (y - ay) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    let widest = null;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const left = xs[i], right = xs[i + 1];
      if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) continue;
      if (!widest || (right - left) > (widest.right - widest.left)) widest = { left, right, width: right - left };
    }
    return widest;
  }

  function quantileSorted(list, q) {
    const arr = (Array.isArray(list) ? list : []).filter((v) => Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
    if (!arr.length) return null;
    if (arr.length === 1) return arr[0];
    const pos = Math.max(0, Math.min(arr.length - 1, (arr.length - 1) * q));
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return arr[lo];
    return arr[lo] * (1 - (pos - lo)) + arr[hi] * (pos - lo);
  }

  function pushUniqueCut(list, value, minGap) {
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    const gap = Math.max(1e-6, Number(minGap) || 0);
    for (const existing of list) {
      if (Math.abs(Number(existing) - v) < gap) return;
    }
    list.push(v);
  }

  if ((regularStrategy === "core_overlap" || regularStrategy === "core_grid") && axis === "y" && cols >= 2) {
    const spans = [];
    const sampleCount = 13;
    for (let i = 0; i < sampleCount; i++) {
      const t = 0.2 + (0.6 * i) / (sampleCount - 1);
      const y = bbox.minY + t * bbox.height;
      const span = scanlineWidestInterval(zonePoints, y);
      if (span && span.width > bbox.width * 0.2) spans.push(span);
    }
    const leftRef = quantileSorted(spans.map((s) => s.left), 0.75);
    const rightRef = quantileSorted(spans.map((s) => s.right), 0.25);
    if (Number.isFinite(leftRef) && Number.isFinite(rightRef) && rightRef > leftRef && cols >= 2) {
      const safeLeft = Math.max(bbox.minX, leftRef);
      const safeRight = Math.min(bbox.maxX, rightRef);
      const coreWidth = safeRight - safeLeft;
      const minUsefulCore = bbox.width * 0.2;
      if (coreWidth > minUsefulCore) {
        const minGap = bbox.width / Math.max(200, cols * 20);
        const step = regularStrategy === "core_grid" ? bbox.width / cols : coreWidth / cols;
        const origin = regularStrategy === "core_grid" ? bbox.minX : safeLeft;
        for (let c = 1; c < cols; c++) {
          const base = origin + c * step;
          const jitter = regularStrategy === "core_grid" ? 0 : (rng.next() - 0.5) * step * (variability / 10) * 0.03;
          pushUniqueCut(xCuts, base + jitter, minGap);
        }
      } else {
        for (let c = 1; c < cols; c++) {
          const base = bbox.minX + (c / cols) * bbox.width;
          const jitter = (rng.next() - 0.5) * bbox.width * (variability / 10) * 0.05;
          xCuts.push(base + jitter);
        }
      }
    } else {
      for (let c = 1; c < cols; c++) {
        const base = bbox.minX + (c / cols) * bbox.width;
        const jitter = (rng.next() - 0.5) * bbox.width * (variability / 10) * 0.05;
        xCuts.push(base + jitter);
      }
    }
  } else {
    for (let c = 1; c < cols; c++) {
      const base = bbox.minX + (c / cols) * bbox.width;
      const jitter = regularStrategy === "core_grid" ? 0 : (rng.next() - 0.5) * bbox.width * (variability / 10) * 0.05;
      xCuts.push(base + jitter);
    }
  }

  for (let r = 1; r < rows; r++) {
    const base = bbox.minY + (r / rows) * bbox.height;
    const jitter = regularStrategy === "core_grid" ? 0 : (rng.next() - 0.5) * bbox.height * (variability / 10) * 0.05;
    yCuts.push(base + jitter);
  }
  xCuts.push(bbox.maxX);
  yCuts.push(bbox.maxY);
  xCuts.sort((a, b) => a - b);
  yCuts.sort((a, b) => a - b);

  const frags = [];
  for (let ry = 0; ry < yCuts.length - 1; ry++) {
    for (let cx = 0; cx < xCuts.length - 1; cx++) {
      let x0 = xCuts[cx], y0 = yCuts[ry], x1 = xCuts[cx + 1], y1 = yCuts[ry + 1];
      if (gapX > 0) { const dx = gapX * 0.5; if (cx > 0) x0 += dx; if (cx < xCuts.length - 2) x1 -= dx; }
      if (gapY > 0) { const dy = gapY * 0.5; if (ry > 0) y0 += dy; if (ry < yCuts.length - 2) y1 -= dy; }
      if (!(x1 > x0 && y1 > y0)) continue;
      const base = (cornerRadius > 0)
        ? buildRoundedRectPolygon(x0, y0, x1, y1, cornerRadius)
        : [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
      if (!Array.isArray(base) || base.length < 3) continue;
      const baseMp = pointsToMultiPolygon(base);
      const mp = intersectMulti(baseMp, zoneMp);
      const pieces = multiPolygonOuterRingsToPoints(mp);
      let best = null, bestArea = minArea;
      for (const piece of pieces) {
        const a = polygonArea(piece);
        if (a > bestArea) { bestArea = a; best = piece; }
      }
      if (best) frags.push(best);
    }
  }
  if (gapX === 0 && gapY === 0) fillRemainderIntoFrags(frags, zoneMp);
  return frags;
}

// ================================================================
// Shifted (brick)
// ================================================================

function generateShiftedFragments(zonePoints, options) {
  const bbox = polygonBBox(zonePoints);
  if (!bbox || bbox.width <= 0 || bbox.height <= 0) return [];
  const zoneMp = pointsToMultiPolygon(zonePoints);
  if (!Array.isArray(zoneMp) || zoneMp.length === 0) return [];
  const rows = Math.max(1, Math.min(20, Math.round(safeNum(options.rows) || 5)));
  const cols = Math.max(1, Math.min(20, Math.round(safeNum(options.cols) || 5)));
  const gapX = Math.max(0, safeNum(options.gapX) || 0);
  const gapY = Math.max(0, safeNum(options.gapY) || 0);
  const cornerRadius = Math.max(0, safeNum(options.cornerRadius) || 0);
  const minArea = Math.max(50, safeNum(options.minAreaMm2) || 500);
  const shiftPercent = Math.max(-100, Math.min(100, safeNum(options.shiftPercent) || 50));
  const cellWidth = bbox.width / cols;
  const cellHeight = bbox.height / rows;
  const rowShift = cellWidth * (shiftPercent / 100);
  const frags = [];
  for (let ry = 0; ry < rows; ry++) {
    let y0 = bbox.minY + ry * cellHeight;
    let y1 = y0 + cellHeight;
    if (gapY > 0) { const dy = gapY * 0.5; if (ry > 0) y0 += dy; if (ry < rows - 1) y1 -= dy; }
    if (!(y1 > y0)) continue;
    const offset = (ry % 2 === 1) ? rowShift : 0;
    const startX = bbox.minX + (offset > 0 ? offset - cellWidth : offset);
    const cellCount = cols + (Math.abs(offset) > 1e-6 ? 1 : 0);
    for (let cx = 0; cx < cellCount; cx++) {
      let x0 = startX + cx * cellWidth;
      let x1 = x0 + cellWidth;
      if (gapX > 0) { const dx = gapX * 0.5; if (cx > 0) x0 += dx; if (cx < cellCount - 1) x1 -= dx; }
      if (!(x1 > x0)) continue;
      const base = (cornerRadius > 0)
        ? buildRoundedRectPolygon(x0, y0, x1, y1, cornerRadius)
        : [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
      if (!Array.isArray(base) || base.length < 3) continue;
      const baseMp = pointsToMultiPolygon(base);
      const mp = intersectMulti(baseMp, zoneMp);
      const pieces = multiPolygonOuterRingsToPoints(mp);
      let best = null, bestArea = minArea;
      for (const piece of pieces) {
        const a = polygonArea(piece);
        if (a > bestArea) { bestArea = a; best = piece; }
      }
      if (best) frags.push(best);
    }
  }
  if (gapX === 0 && gapY === 0) fillRemainderIntoFrags(frags, zoneMp);
  return frags;
}

// ================================================================
// Diagonal (bands / herringbone)
// ================================================================

function generateDiagonalFragments(zonePoints, options) {
  const bbox = polygonBBox(zonePoints);
  if (!bbox || bbox.width <= 0 || bbox.height <= 0) return [];
  const zoneMp = pointsToMultiPolygon(zonePoints);
  if (!Array.isArray(zoneMp) || zoneMp.length === 0) return [];
  const bandStepMm = Math.max(10, Math.min(5000, safeNum(options.bandStepMm) || Math.max(40, bbox.height / 5)));
  const gapX = Math.max(0, safeNum(options.gapX) || 0);
  const gapY = Math.max(0, safeNum(options.gapY) || 0);
  const minArea = Math.max(50, safeNum(options.minAreaMm2) || 500);
  const axisCountRaw = safeNum(options.axisCount);
  const angleDegRaw = safeNum(options.angleDeg);
  const axisCount = Math.max(0, Math.min(6, Math.round(axisCountRaw === null ? 1 : axisCountRaw)));
  const angleDeg = Math.max(-89, Math.min(89, angleDegRaw === null ? 45 : angleDegRaw));
  const slopeAbs = Math.tan((Math.abs(angleDeg) * Math.PI) / 180);
  const orientation = angleDeg >= 0 ? 1 : -1;
  const bandGapMm = Math.max(0, Math.max(gapX, gapY));
  const frags = [];

  if (axisCount === 0) {
    const rect = [
      { x: bbox.minX, y: bbox.minY }, { x: bbox.maxX, y: bbox.minY },
      { x: bbox.maxX, y: bbox.maxY }, { x: bbox.minX, y: bbox.maxY }
    ];
    const linearSlope = orientation * slopeAbs;
    let minU = Infinity, maxU = -Infinity;
    for (const p of rect) {
      const u = p.y - linearSlope * p.x;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    }
    const bandStart = Math.floor(minU / bandStepMm) - 1;
    const bandEnd = Math.ceil(maxU / bandStepMm) + 1;
    for (let band = bandStart; band <= bandEnd; band++) {
      const u0 = band * bandStepMm + bandGapMm * 0.5;
      const u1 = (band + 1) * bandStepMm - bandGapMm * 0.5;
      if (!(u1 > u0)) continue;
      const part = clipPolygonByBand(rect.slice(), -linearSlope, 1, u0, u1);
      if (!Array.isArray(part) || part.length < 3) continue;
      const partMp = pointsToMultiPolygon(part);
      const mp = intersectMulti(partMp, zoneMp);
      const pieces = multiPolygonOuterRingsToPoints(mp);
      for (const piece of pieces) {
        if (polygonArea(piece) < minArea) continue;
        frags.push(piece);
      }
    }
    if (bandGapMm === 0) fillRemainderIntoFrags(frags, zoneMp);
    return frags;
  }

  const axisXs = [];
  for (let i = 0; i < axisCount; i++) axisXs.push(bbox.minX + ((i + 0.5) / axisCount) * bbox.width);

  for (let axisIndex = 0; axisIndex < axisXs.length; axisIndex++) {
    const axisX = axisXs[axisIndex];
    const leftBound = axisIndex === 0 ? bbox.minX : (axisXs[axisIndex - 1] + axisX) * 0.5;
    const rightBound = axisIndex === axisXs.length - 1 ? bbox.maxX : (axisX + axisXs[axisIndex + 1]) * 0.5;
    const segments = [
      { side: "left",  rect: [{ x: leftBound, y: bbox.minY }, { x: axisX, y: bbox.minY }, { x: axisX, y: bbox.maxY }, { x: leftBound, y: bbox.maxY }] },
      { side: "right", rect: [{ x: axisX, y: bbox.minY }, { x: rightBound, y: bbox.minY }, { x: rightBound, y: bbox.maxY }, { x: axisX, y: bbox.maxY }] }
    ];
    for (const segment of segments) {
      const rectBBox = polygonBBox(segment.rect);
      if (!rectBBox || rectBBox.width <= 1e-6 || rectBBox.height <= 1e-6) continue;
      let minU = Infinity, maxU = -Infinity;
      for (const p of segment.rect) {
        const u = p.y - orientation * slopeAbs * Math.abs(p.x - axisX);
        minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      }
      const bandStart = Math.floor(minU / bandStepMm) - 1;
      const bandEnd = Math.ceil(maxU / bandStepMm) + 1;
      for (let band = bandStart; band <= bandEnd; band++) {
        const u0 = band * bandStepMm + bandGapMm * 0.5;
        const u1 = (band + 1) * bandStepMm - bandGapMm * 0.5;
        if (!(u1 > u0)) continue;
        let part = segment.rect.slice();
        if (segment.side === "left") {
          part = orientation >= 0
            ? clipPolygonByBand(part, slopeAbs, 1, u0 + slopeAbs * axisX, u1 + slopeAbs * axisX)
            : clipPolygonByBand(part, -slopeAbs, 1, u0 - slopeAbs * axisX, u1 - slopeAbs * axisX);
        } else {
          part = orientation >= 0
            ? clipPolygonByBand(part, -slopeAbs, 1, u0 - slopeAbs * axisX, u1 - slopeAbs * axisX)
            : clipPolygonByBand(part, slopeAbs, 1, u0 + slopeAbs * axisX, u1 + slopeAbs * axisX);
        }
        if (!Array.isArray(part) || part.length < 3) continue;
        const partMp = pointsToMultiPolygon(part);
        const mp = intersectMulti(partMp, zoneMp);
        const pieces = multiPolygonOuterRingsToPoints(mp);
        for (const piece of pieces) {
          if (polygonArea(piece) < minArea) continue;
          frags.push(piece);
        }
      }
    }
  }
  if (bandGapMm === 0) fillRemainderIntoFrags(frags, zoneMp);
  return frags;
}

// ================================================================
// Radial (rings + sectors)
// ================================================================

function generateRadialFragments(zonePoints, options) {
  const bbox = polygonBBox(zonePoints);
  if (!bbox || bbox.width <= 0 || bbox.height <= 0) return [];
  const zoneMp = pointsToMultiPolygon(zonePoints);
  if (!Array.isArray(zoneMp) || zoneMp.length === 0) return [];
  const ringCount = Math.max(1, Math.min(20, Math.round(safeNum(options.ringCount) || 4)));
  const sectorCount = Math.max(1, Math.min(36, Math.round(safeNum(options.sectorCount) || 8)));
  const rotationDeg = safeNum(options.rotationDeg) || 0;
  const innerRadiusMm = Math.max(0, safeNum(options.innerRadiusMm) || 0);
  const centerMode = String(options.centerMode || "auto").trim();
  const centerX = centerMode === "manual" && Number.isFinite(safeNum(options.centerX))
    ? safeNum(options.centerX) : (bbox.minX + bbox.maxX) * 0.5;
  const centerY = centerMode === "manual" && Number.isFinite(safeNum(options.centerY))
    ? safeNum(options.centerY) : (bbox.minY + bbox.maxY) * 0.5;
  const gapX = Math.max(0, safeNum(options.gapX) || 0);
  const gapY = Math.max(0, safeNum(options.gapY) || 0);
  const gap = Math.max(gapX, gapY);
  const minArea = Math.max(50, safeNum(options.minAreaMm2) || 500);
  const rotationRad = (rotationDeg * Math.PI) / 180;

  let maxRadius = 0;
  for (const p of zonePoints || []) {
    const x = Number(p && p.x), y = Number(p && p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    maxRadius = Math.max(maxRadius, Math.hypot(x - centerX, y - centerY));
  }
  if (!(maxRadius > 0)) return [];

  const radialSpan = Math.max(1, maxRadius - innerRadiusMm);
  const ringStep = radialSpan / ringCount;
  const sectorStep = (Math.PI * 2) / sectorCount;
  const frags = [];

  function buildSectorPolygon(r0, r1, a0, a1) {
    const arcSegments = Math.max(6, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 18)));
    const out = [];
    for (let i = 0; i <= arcSegments; i++) {
      const a = a0 + (a1 - a0) * i / arcSegments;
      out.push({ x: centerX + Math.cos(a) * r1, y: centerY + Math.sin(a) * r1 });
    }
    for (let i = arcSegments; i >= 0; i--) {
      const a = a0 + (a1 - a0) * i / arcSegments;
      out.push({ x: centerX + Math.cos(a) * r0, y: centerY + Math.sin(a) * r0 });
    }
    return out;
  }

  for (let ringIndex = 0; ringIndex < ringCount; ringIndex++) {
    let r0 = innerRadiusMm + ringIndex * ringStep;
    let r1 = innerRadiusMm + (ringIndex + 1) * ringStep;
    if (gap > 0) { const dr = gap * 0.5; if (ringIndex > 0) r0 += dr; if (ringIndex < ringCount - 1) r1 -= dr; }
    if (!(r1 > r0)) continue;
    for (let sectorIndex = 0; sectorIndex < sectorCount; sectorIndex++) {
      let a0 = rotationRad + sectorIndex * sectorStep;
      let a1 = rotationRad + (sectorIndex + 1) * sectorStep;
      if (gap > 0 && r1 > 0) {
        const da = Math.min(sectorStep * 0.45, (gap * 0.5) / Math.max(r1, 1));
        a0 += da; a1 -= da;
      }
      if (!(a1 > a0)) continue;
      const base = buildSectorPolygon(r0, r1, a0, a1);
      if (!Array.isArray(base) || base.length < 3) continue;
      const baseMp = pointsToMultiPolygon(base);
      const mp = intersectMulti(baseMp, zoneMp);
      const pieces = multiPolygonOuterRingsToPoints(mp);
      if (!pieces.length) continue;
      let largest = null, largestArea = 0;
      for (const piece of pieces) {
        const a = polygonArea(piece);
        if (a > largestArea) { largestArea = a; largest = piece; }
      }
      if (largest && largestArea >= minArea) frags.push(largest);
    }
  }
  if (gap === 0) fillRemainderIntoFrags(frags, zoneMp);
  return frags;
}

module.exports = {
  generateVoronoiFragments,
  generateRegularFragments,
  generateShiftedFragments,
  generateDiagonalFragments,
  generateRadialFragments,
  // exported for tests
  polygonArea,
  polygonBBox,
  multiPolygonOuterRingsToPoints,
  clipPolygonByBand,
  clipPolygonByHalfPlane,
  splitPolygonByLine,
};
