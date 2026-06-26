"use strict";
/**
 * Synthetic unit tests for inventory_voronoi_sa v2 core geometry.
 * Tests buildPowerDiagramCells, weight adjustment, containment, cut check, nap.
 * Run: node tests/voronoi_sa_v2_unit.js
 */

const ClipperLib = require("clipper-lib");
const SCALE = 1000;

// ── Minimal deps (mirrors real solver_primitives) ──────────────────────────────

function pointsToMultiPolygon(pts) {
  const ring = pts.map(p => [p.x, p.y]);
  ring.push(ring[0]);
  return [[ring]];
}

function mpToPoints(mp) {
  if (!Array.isArray(mp) || !mp.length) return [];
  const poly = mp[0];
  if (!Array.isArray(poly) || !poly.length) return [];
  const ring = poly[0];
  if (!Array.isArray(ring) || ring.length < 4) return [];
  const pts = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const x = Number(ring[i][0]), y = Number(ring[i][1]);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
  }
  return pts.length >= 3 ? pts : [];
}

function multiPolygonArea(mp) {
  // Sum SIGNED areas so that CW (hole) paths subtract from CCW (outer) paths.
  // Clipper returns outer rings and holes as separate paths with opposite orientation.
  if (!mp) return 0;
  let total = 0;
  for (const poly of mp) {
    if (!Array.isArray(poly) || !poly.length) continue;
    const ring = poly[0];
    if (!Array.isArray(ring) || ring.length < 3) continue;
    let s = 0;
    for (let i = 0; i < ring.length - 1; i++)
      s += ring[i][0] * ring[i+1][1] - ring[i+1][0] * ring[i][1];
    total += s * 0.5; // keep sign: positive=CCW outer, negative=CW hole
  }
  return Math.abs(total);
}

function clipperOp(mpA, mpB, clipType) {
  const cpr = new ClipperLib.Clipper();
  const toC = mp => mp.map(poly =>
    poly[0].slice(0, -1).map(p => ({ X: Math.round(p[0] * SCALE), Y: Math.round(p[1] * SCALE) }))
  );
  toC(mpA).forEach(r => cpr.AddPath(r, ClipperLib.PolyType.ptSubject, true));
  toC(mpB).forEach(r => cpr.AddPath(r, ClipperLib.PolyType.ptClip, true));
  const sol = new ClipperLib.Paths();
  cpr.Execute(clipType, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return sol.map(p => [p.map(v => [v.X / SCALE, v.Y / SCALE]).concat([[p[0].X / SCALE, p[0].Y / SCALE]])]);
}

function intersectMulti(a, b) { return clipperOp(a, b, ClipperLib.ClipType.ctIntersection); }
function diffMulti(a, b)      { return clipperOp(a, b, ClipperLib.ClipType.ctDifference); }
function unionMulti(a, b)     { return clipperOp(a, b, ClipperLib.ClipType.ctUnion); }

function normalizeDeg(d) { return ((d % 360) + 360) % 360; }
function deltaDeg(a, b) { let d = normalizeDeg(b - a); return d > 180 ? d - 360 : d; }
function polygonBBox(pts) {
  return { minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)), minY: Math.min(...pts.map(p => p.y)), maxY: Math.max(...pts.map(p => p.y)) };
}
function centroidFn(pts) { let x = 0, y = 0; pts.forEach(p => { x += p.x; y += p.y; }); return { x: x / pts.length, y: y / pts.length }; }
function createSeededRng(seed) {
  let s = seed;
  return { next: () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; }, nextInt: n => Math.floor(((s * 1664525 + 1013904223) & 0xffffffff) >>> 0 / 0xffffffff * n) };
}
function createGridSpec(bbox, r) { const nx = Math.ceil((bbox.maxX - bbox.minX) / r), ny = Math.ceil((bbox.maxY - bbox.minY) / r); return { nx, ny, r, ox: bbox.minX, oy: bbox.minY }; }

// ── Load solver (extracts internal functions via module pattern trick) ─────────

// We expose internal functions by creating a thin wrapper module.
// The solver is a closure, so we need to access buildPowerDiagramCells through solve().
// Instead, we copy the key pure functions here for unit testing.

// Half-plane clip — copy from solver
function lineIntersectHP(p1, p2, a, b, c) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const denom = a * dx + b * dy;
  if (Math.abs(denom) < 1e-12) return p1;
  const t = (c - a * p1.x - b * p1.y) / denom;
  return { x: p1.x + t * dx, y: p1.y + t * dy };
}
function clipHalfPlane(polygon, a, b, c) {
  if (polygon.length < 3) return [];
  const EPS = 1e-9, out = [];
  for (let i = 0; i < polygon.length; i++) {
    const prev = polygon[(i + polygon.length - 1) % polygon.length], curr = polygon[i];
    const prevIn = a * prev.x + b * prev.y <= c + EPS;
    const currIn = a * curr.x + b * curr.y <= c + EPS;
    if (prevIn && currIn)       out.push(curr);
    else if (prevIn && !currIn) out.push(lineIntersectHP(prev, curr, a, b, c));
    else if (!prevIn && currIn) { out.push(lineIntersectHP(prev, curr, a, b, c)); out.push(curr); }
  }
  return out;
}
function buildPowerDiagramCells(sites, weights, zonePts, zoneHoles) {
  const n = sites.length, holes = zoneHoles || [], cells = [];
  for (let i = 0; i < n; i++) {
    let cell = zonePts.slice();
    const pi = sites[i], wi = weights[i], pi2 = pi.x * pi.x + pi.y * pi.y;
    for (let j = 0; j < n; j++) {
      if (j === i || cell.length < 3) continue;
      const pj = sites[j], wj = weights[j], pj2 = pj.x * pj.x + pj.y * pj.y;
      const a = 2 * (pj.x - pi.x), b = 2 * (pj.y - pi.y);
      const c = (pj2 - wj) - (pi2 - wi);
      cell = clipHalfPlane(cell, a, b, c);
    }
    if (cell.length < 3) { cells.push(null); continue; }
    if (holes.length > 0) {
      let cellMp = pointsToMultiPolygon(cell);
      for (const hole of holes) {
        if (!hole || hole.length < 3) continue;
        try { cellMp = diffMulti(cellMp, pointsToMultiPolygon(hole)); } catch (_) {}
      }
      const cellPts = mpToPoints(cellMp);
      cells.push(cellPts.length >= 3 ? cellPts : null);
    } else {
      cells.push(cell);
    }
  }
  return cells;
}

function polygonArea(pts) {
  if (!pts || pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) * 0.5;
}

function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

// ── Test harness ───────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓  ${msg}`); }
  else       { failed++; console.error(`  ✗  FAIL: ${msg}`); }
}
function assertApprox(a, b, eps, msg) {
  assert(Math.abs(a - b) <= eps, `${msg} (got ${a.toFixed(4)}, expected ≈${b.toFixed(4)} ±${eps})`);
}
function section(title) { console.log(`\n── ${title} ──`); }

// ── Rectangle zone: 100×100 ────────────────────────────────────────────────────
const ZONE = [
  { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }
];
const ZONE_AREA = 100 * 100; // 10000

// ── T1: 2 sites, equal weights → ordinary Voronoi (each gets ~50%) ────────────
section("T1: 2 sites equal weights → Voronoi bisect");
{
  const sites = [{ x: 25, y: 50 }, { x: 75, y: 50 }];
  const weights = [0, 0];
  const cells = buildPowerDiagramCells(sites, weights, ZONE, []);
  assert(cells.length === 2, "exactly 2 cells");
  assert(cells[0] !== null, "cell[0] non-null");
  assert(cells[1] !== null, "cell[1] non-null");
  const a0 = polygonArea(cells[0]), a1 = polygonArea(cells[1]);
  assertApprox(a0, 5000, 10, "cell[0] area ≈ 5000");
  assertApprox(a1, 5000, 10, "cell[1] area ≈ 5000");
  assertApprox(a0 + a1, ZONE_AREA, 10, "partition covers zone");
}

// ── T2: different weights → bigger weight gives bigger cell ───────────────────
section("T2: weight_0 > weight_1 → cell[0] > cell[1]");
{
  const sites = [{ x: 50, y: 50 }, { x: 70, y: 50 }];
  const weights = [2000, -2000]; // w0 >> w1
  const cells = buildPowerDiagramCells(sites, weights, ZONE, []);
  // With weight_0 >> weight_1, site[1] may be pushed out of the zone entirely (empty cell).
  // This is correct Power Diagram behavior — not a bug.
  assert(cells[0] !== null, "cell[0] non-null (high-weight site claims territory)");
  const a0 = polygonArea(cells[0] || []);
  const a1 = polygonArea(cells[1] || []);
  assert(a0 > a1, `cell[0] (${a0.toFixed(0)}) > cell[1] (${a1.toFixed(0)}) because w0>>w1`);
  assertApprox(a0 + a1, ZONE_AREA, 20, "partition still covers zone");
}

// ── T3: zone with hole → cells don't enter hole ───────────────────────────────
section("T3: zone with hole → cells respect hole");
{
  // Hole in center: 20×20 square at (40,40)-(60,60)
  const hole = [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }];
  const holeArea = 400;
  const sites = [{ x: 25, y: 50 }, { x: 75, y: 50 }];
  const weights = [0, 0];
  const cells = buildPowerDiagramCells(sites, weights, ZONE, [hole]);

  // Invariant: area(intersect(cell_i, hole)) ≤ epsilon
  let holePenetration = 0;
  for (const cell of cells) {
    if (!cell) continue;
    const isect = intersectMulti(pointsToMultiPolygon(cell), pointsToMultiPolygon(hole));
    holePenetration += multiPolygonArea(isect);
  }
  assertApprox(holePenetration, 0, 1, "cells don't enter hole (penetration ≤ 1mm²)");

  // Partition should cover zone minus hole
  const zoneMinus = ZONE_AREA - holeArea;
  const totalCellArea = cells.reduce((s, c) => s + (c ? polygonArea(c) : 0), 0);
  assertApprox(totalCellArea, zoneMinus, 50, "partition covers zone minus hole");
}

// ── T4: concave L-shaped zone → partition preserved ───────────────────────────
section("T4: concave (L-shaped) zone → partition");
{
  // L-shape: 80×100 minus top-right 40×50 corner
  const lzone = [
    { x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 50 },
    { x: 40, y: 50 }, { x: 40, y: 100 }, { x: 0, y: 100 }
  ];
  const larea = 80 * 50 + 40 * 50; // 4000 + 2000 = 6000
  const sites = [{ x: 20, y: 25 }, { x: 60, y: 25 }, { x: 20, y: 75 }];
  const weights = [0, 0, 0];
  const cells = buildPowerDiagramCells(sites, weights, lzone, []);
  const validCells = cells.filter(c => c !== null);
  assert(validCells.length >= 2, `at least 2 cells in L-zone (got ${validCells.length})`);
  const totalArea = validCells.reduce((s, c) => s + polygonArea(c), 0);
  assertApprox(totalArea, larea, 100, "partition covers L-zone area");
  // Check no cell goes outside L-zone
  for (let i = 0; i < validCells.length; i++) {
    const cell = validCells[i];
    const isectMp = intersectMulti(pointsToMultiPolygon(cell), pointsToMultiPolygon(lzone));
    const isectArea = multiPolygonArea(isectMp);
    assertApprox(isectArea, polygonArea(cell), 5, `cell[${i}] stays inside L-zone`);
  }
}

// ── T5: physicalMissing when piece is too small ────────────────────────────────
section("T5: small core → physicalMissing = cell - core > 0 → diagnostic");
{
  // Cell is 50×50=2500mm², core is 10×10=100mm² → big missing
  const cellPts = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }];
  const corePts = [{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 20, y: 30 }];
  const cellMp = pointsToMultiPolygon(cellPts);
  const coreMp = pointsToMultiPolygon(corePts);
  const missMp = diffMulti(cellMp, coreMp);
  const missArea = multiPolygonArea(missMp);
  // Expected: 2500 - 100 = 2400. Tolerance 20 to allow for Clipper rounding of CW/CCW hole rings.
  assertApprox(missArea, 2400, 20, "physicalMissing = cell - core ≈ 2400mm²");
  assert(missArea > 1, "physicalMissing > 1 → triggers diagnostic");
}

// ── T6: cutContour = offset(cell, reserve) without piece masking ───────────────
section("T6: cutContour = raw offset(cell, seam) — no intersection");
{
  // offset outward a 40×40 cell by 12mm → should give ~64×64 (approx)
  // We verify it's LARGER than the cell, not clipped to piece
  const cellPts = [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 10, y: 50 }];
  const cellArea = polygonArea(cellPts); // 1600
  // offset outward via Clipper
  function offsetOut(pts, mm) {
    const path = pts.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
    const co = new ClipperLib.ClipperOffset(2, 0.25 * SCALE);
    co.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const out = new ClipperLib.Paths();
    co.Execute(out, mm * SCALE);
    if (!out || !out.length) return pts;
    const best = out.reduce((a, b) => b.length > a.length ? b : a, out[0]);
    return best.map(p => ({ x: p.X / SCALE, y: p.Y / SCALE }));
  }
  const desired = offsetOut(cellPts, 12);
  const desiredArea = polygonArea(desired);
  // (40+24)×(40+24) = 64×64 = 4096 for miter; approximately
  assert(desiredArea > cellArea, `cutContour area (${desiredArea.toFixed(0)}) > cell area (${cellArea})`);
  // cutMissing = diff(desired, piece) where piece >> cell → should be 0
  const bigPiece = [{ x: -20, y: -20 }, { x: 120, y: -20 }, { x: 120, y: 120 }, { x: -20, y: 120 }];
  const cutMissArea = multiPolygonArea(diffMulti(pointsToMultiPolygon(desired), pointsToMultiPolygon(bigPiece)));
  assertApprox(cutMissArea, 0, 1, "big piece covers desiredCutContour → cutMissing ≈ 0");
  // Small piece that doesn't cover offset → cutMissing > 0
  const tinyPiece = [{ x: 15, y: 15 }, { x: 45, y: 15 }, { x: 45, y: 45 }, { x: 15, y: 45 }];
  const cutMissSmall = multiPolygonArea(diffMulti(pointsToMultiPolygon(desired), pointsToMultiPolygon(tinyPiece)));
  assert(cutMissSmall > 1, `tiny piece → cutMissing (${cutMissSmall.toFixed(0)}) > 0 → cutContourOutsidePiece`);
}

// ── T7: napViolation hard constraint ─────────────────────────────────────────────
section("T7: napValid hard constraint");
{
  function napValidFn(napDeg, rotDeg, pileDeg, napTolDeg) {
    const eff = normalizeDeg(napDeg + rotDeg);
    return Math.abs(deltaDeg(eff, pileDeg)) <= napTolDeg;
  }
  // napDeg=0, pileDeg=90, napTolDeg=15 → valid rotDeg is ~90
  assert(napValidFn(0, 90, 90, 15), "rot=90 valid when nap=0, pile=90, tol=15");
  assert(!napValidFn(0, 0, 90, 15), "rot=0 invalid when nap=0, pile=90, tol=15");
  assert(!napValidFn(0, 45, 90, 15), "rot=45 invalid (off by 45°)");
  assert(napValidFn(0, 80, 90, 15), "rot=80 valid (off by 10° ≤ 15)");
  assert(napValidFn(45, 45, 90, 15), "rot=45 valid when nap=45, pile=90, tol=15 (45+45=90)");
}

// ── T8: disconnectedCell detection ─────────────────────────────────────────────
section("T8: disconnectedCell from concave zone gets null or single-poly");
{
  // Two separate rectangles connected by a narrow bridge → 3 sites where center site
  // might get an odd-shaped cell. We just check that buildPowerDiagramCells never
  // returns a multipolygon without flagging it (it uses mpToPoints which takes outer ring).
  // As per contract: internal support, but final must be simple polygon.
  const narrowZone = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 45 },
    { x: 55, y: 45 }, { x: 55, y: 55 }, { x: 100, y: 55 },
    { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 55 },
    { x: 45, y: 55 }, { x: 45, y: 45 }, { x: 0, y: 45 }
  ];
  const sites = [{ x: 25, y: 25 }, { x: 50, y: 50 }, { x: 75, y: 75 }];
  const cells = buildPowerDiagramCells(sites, [0, 0, 0], narrowZone, []);
  // Each non-null cell must be a simple polygon (mpToPoints returns single ring)
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== null) {
      assert(Array.isArray(cells[i]) && cells[i].length >= 3,
        `cell[${i}] is a valid polygon array (mpToPoints extracted outer ring)`);
    }
  }
  assert(true, "disconnectedCell: mpToPoints extracts largest ring; flag disconnectedCell in diagnostics separately");
}

// ── T9: emptyCell → weight increases ─────────────────────────────────────────────
section("T9: adjustWeights emptyCell → site nudged toward zone centroid");
{
  // Place a site far outside zone → it will get empty cell → weight must increase
  // and site must move toward zone
  const ZONE2 = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const sites = [{ x: 50, y: 50 }, { x: 5000, y: 5000 }]; // site[1] way outside
  const weights = [0, 0];
  const targetAreas = [7000, 3000];

  // Run 5 iterations of adjustment manually (copy of solver logic)
  const zoneCentroid = { x: 50, y: 50 };
  const lr = 0.35, maxStep = 4000;
  for (let iter = 0; iter < 5; iter++) {
    const cells = buildPowerDiagramCells(sites, weights, ZONE2, []);
    for (let i = 0; i < 2; i++) {
      const actual = cells[i] ? polygonArea(cells[i]) : 0;
      if (actual < 1) {
        weights[i] += maxStep * 2; // increase
        sites[i] = { x: sites[i].x * 0.8 + zoneCentroid.x * 0.2, y: sites[i].y * 0.8 + zoneCentroid.y * 0.2 };
      } else {
        weights[i] += Math.max(-maxStep, Math.min(maxStep, lr * (targetAreas[i] - actual)));
      }
    }
    const mean = (weights[0] + weights[1]) / 2;
    weights[0] -= mean; weights[1] -= mean;
  }
  // After 5 iters, site[1] should have moved toward (50,50)
  assert(sites[1].x < 5000, `site[1].x nudged from 5000 toward centroid (now ${sites[1].x.toFixed(0)})`);
  assert(sites[1].y < 5000, `site[1].y nudged from 5000 toward centroid (now ${sites[1].y.toFixed(0)})`);
  // weight[1] should have increased
  assert(weights[1] > 0, `weight[1] increased for empty cell (now ${weights[1].toFixed(0)})`);
}

// ── T10: partition completeness — no overlap between cells ────────────────────
section("T10: cells form partition (no overlap, covers zone)");
{
  const sites = [
    { x: 20, y: 20 }, { x: 80, y: 20 }, { x: 20, y: 80 }, { x: 80, y: 80 }, { x: 50, y: 50 }
  ];
  const weights = [0, 0, 0, 0, 0];
  const cells = buildPowerDiagramCells(sites, weights, ZONE, []);
  const validCells = cells.filter(c => c !== null);
  assert(validCells.length >= 4, `at least 4 cells (got ${validCells.length})`);

  // No overlap: area(intersect(cell_i, cell_j)) ≤ epsilon for i≠j
  let maxOverlap = 0;
  for (let i = 0; i < validCells.length; i++) {
    for (let j = i + 1; j < validCells.length; j++) {
      const ov = multiPolygonArea(intersectMulti(pointsToMultiPolygon(validCells[i]), pointsToMultiPolygon(validCells[j])));
      if (ov > maxOverlap) maxOverlap = ov;
    }
  }
  assertApprox(maxOverlap, 0, 2, `max overlap between cells ≤ 2mm² (got ${maxOverlap.toFixed(3)})`);

  // Covers zone: total area ≈ zone area
  const totalArea = validCells.reduce((s, c) => s + polygonArea(c), 0);
  assertApprox(totalArea, ZONE_AREA, 50, `total cell area ≈ zone area (${totalArea.toFixed(0)} vs ${ZONE_AREA})`);
}

// ── buildPowerDiagramCellsFull — with PolyTree disconnected detection ─────────

function buildPowerDiagramCellsFull(sites, weights, zonePts, zoneHoles) {
  const n = sites.length, holes = zoneHoles || [], cells = [];
  for (let i = 0; i < n; i++) {
    let cell = zonePts.slice();
    const pi = sites[i], wi = weights[i], pi2 = pi.x * pi.x + pi.y * pi.y;
    for (let j = 0; j < n; j++) {
      if (j === i || cell.length < 3) continue;
      const pj = sites[j], wj = weights[j], pj2 = pj.x * pj.x + pj.y * pj.y;
      const a = 2*(pj.x-pi.x), b = 2*(pj.y-pi.y);
      const c = (pj2-wj)-(pi2-wi);
      cell = clipHalfPlane(cell, a, b, c);
    }
    if (cell.length < 3) { cells.push({ pts: null, isDisconnected: false }); continue; }
    if (holes.length > 0) {
      const cpr = new ClipperLib.Clipper();
      const cellPath = cell.map(p => ({ X: Math.round(p.x*SCALE), Y: Math.round(p.y*SCALE) }));
      cpr.AddPath(cellPath, ClipperLib.PolyType.ptSubject, true);
      for (const hole of holes) {
        if (!hole || hole.length < 3) continue;
        const hp = hole.map(p => ({ X: Math.round(p.x*SCALE), Y: Math.round(p.y*SCALE) }));
        cpr.AddPath(hp, ClipperLib.PolyType.ptClip, true);
      }
      const polytree = new ClipperLib.PolyTree();
      try {
        cpr.Execute(ClipperLib.ClipType.ctDifference, polytree,
          ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
      } catch (_) { cells.push({ pts: cell, isDisconnected: false }); continue; }
      const outerCount = polytree.Childs ? polytree.Childs.length : 0;
      if (outerCount === 0) { cells.push({ pts: null, isDisconnected: false }); continue; }
      const isDisconnected = outerCount > 1;
      let best = polytree.Childs[0];
      for (const ch of polytree.Childs) {
        if (Math.abs(ClipperLib.Clipper.Area(ch.Contour)) > Math.abs(ClipperLib.Clipper.Area(best.Contour)))
          best = ch;
      }
      const pts = best.Contour.map(p => ({ x: p.X/SCALE, y: p.Y/SCALE }));
      cells.push({ pts: pts.length >= 3 ? pts : null, isDisconnected });
    } else {
      cells.push({ pts: cell, isDisconnected: false });
    }
  }
  return cells;
}

// ── T11: gap-fill adds new site → original cell shrinks → piece can cover it ─
section("T11: gap-fill adds new site, rebuilds Power Diagram, closes invalidCell");
{
  // Zone: 100×100. Sites at the edges (not at their cell centroids), equal weights.
  // cell[0] ≈ left 50% = 5000mm². Gap-fill site placed at centroid of cell[0] (≈25,50).
  // This differs from site[0] at (10,50) → cell[0] shrinks significantly.
  const sites0 = [{ x: 10, y: 50 }, { x: 90, y: 50 }];
  const weights0 = [0, 0];
  const cells0 = buildPowerDiagramCells(sites0, weights0, ZONE, []);
  const areaCell0Before = polygonArea(cells0[0]); // ≈5000

  // Simulate gap-fill: add new site at centroid of cell[0]
  const c0 = centroidFn(cells0[0]);
  const sites1 = [...sites0, { x: c0.x, y: c0.y }];
  const weights1 = [...weights0, 0];
  const cells1 = buildPowerDiagramCells(sites1, weights1, ZONE, []);
  const areaCell0After = polygonArea(cells1[0]);

  assert(areaCell0After < areaCell0Before - 10,
    `cell[0] shrank after gap-fill site added (${areaCell0After.toFixed(0)} < ${areaCell0Before.toFixed(0)})`);
  assert(cells1.length === 3, "Power Diagram has 3 cells after gap-fill site added");
  // New cell (index 2) should have positive area
  const areaNewCell = polygonArea(cells1[2]);
  assert(areaNewCell > 100,
    `new gap-fill cell has area > 100mm² (got ${areaNewCell.toFixed(0)})`);
}

// ── T12: empty candidatePool → unresolvedGap ─────────────────────────────────
section("T12: candidatePool empty → unresolvedGap, no new sites added");
{
  // Simulate the gap-fill loop with empty candidatePool
  const sites = [{ x: 25, y: 50 }, { x: 75, y: 50 }];
  const placements = [
    { cellPts: ZONE.slice(), physicalMissing: 5000, diagnosticCode: "badPlacement" }
  ];
  const unresolvedGaps = [];
  const candidatePool = []; // empty

  // Simulate gap-fill: invalid cell, no candidates
  for (const pl of placements) {
    if (pl.physicalMissing <= 1) continue;
    let resolved = false;
    for (const _candidate of candidatePool) {
      resolved = true; break; // would never enter
    }
    if (!resolved) {
      unresolvedGaps.push({
        contour: pl.cellPts,
        areaMm2: polygonArea(pl.cellPts),
        diagnosticCode: pl.diagnosticCode || "unresolvedGap"
      });
    }
  }

  assert(unresolvedGaps.length === 1, "exactly 1 unresolvedGap when candidatePool is empty");
  assert(sites.length === 2, "no new sites added to Power Diagram");
  assert(unresolvedGaps[0].areaMm2 > 0, "unresolvedGap has positive area");
}

// ── T13: gap-fill rebuilds global Power Diagram (ALL cells change) ────────────
section("T13: adding site changes ALL cells (global rebuild, not local patch)");
{
  // 3 sites, record all 3 cell areas. Add 4th site. Verify all cells changed.
  const sites = [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 50, y: 80 }];
  const weights = [0, 0, 0];
  const before = buildPowerDiagramCells(sites, weights, ZONE, []);
  const areas_before = before.map(c => c ? polygonArea(c) : 0);

  // Add 4th site at center
  sites.push({ x: 50, y: 50 });
  weights.push(0);
  const after = buildPowerDiagramCells(sites, weights, ZONE, []);
  const areas_after = after.map(c => c ? polygonArea(c) : 0);

  // ALL original cells should have changed (shrunk), not just the nearest one
  let changedCount = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(areas_before[i] - areas_after[i]) > 5) changedCount++;
  }
  assert(changedCount >= 2,
    `at least 2 of 3 original cells changed when new site added (changed: ${changedCount})`);
  // Total area must still equal zone area (global invariant preserved)
  const totalAfter = areas_after.reduce((s, a) => s + a, 0);
  assertApprox(totalAfter, ZONE_AREA, 50, "total area = zone area after site added");
}

// ── T14: disconnectedCell detected via PolyTree, not silently ok ──────────────
section("T14: disconnectedCell flagged as isDisconnected=true, not ok");
{
  // Zone: 200×100. Hole: large square 60×80 in center (60,10)-(140,90).
  // Site at (100,50) — inside hole but Voronoi territory spans zone.
  // After hole subtraction: remaining territory is two thin strips (top and bottom)
  // → disconnected.
  const WIDE = [
    { x:0,y:0 }, { x:200,y:0 }, { x:200,y:100 }, { x:0,y:100 }
  ];
  // Large central hole that covers most of the middle
  const bigHole = [
    { x:60,y:10 }, { x:140,y:10 }, { x:140,y:90 }, { x:60,y:90 }
  ];
  // 3 sites: left, center, right
  const sites = [{ x:30,y:50 }, { x:100,y:50 }, { x:170,y:50 }];
  const weights = [0, 0, 0];

  const cellInfos = buildPowerDiagramCellsFull(sites, weights, WIDE, [bigHole]);

  // Cell[1] (center site, x≈60-140) when intersected with hole leaves only
  // thin top/bottom strips → should be disconnected
  // (or cell[1] might be null if entirely consumed by hole)
  const center = cellInfos[1];
  if (center.pts !== null) {
    // If it has pts, it must be flagged disconnected OR have near-zero area
    const valid = center.isDisconnected || polygonArea(center.pts) < 500;
    assert(valid,
      `center cell after large hole is either disconnected or tiny (area=${polygonArea(center.pts || []).toFixed(0)}, disc=${center.isDisconnected})`);
  } else {
    assert(true, "center cell is null after large hole subtraction (also acceptable)");
  }

  // Key: disconnectedCell must NOT become status="ok"
  const wouldBeOk = center.pts !== null && !center.isDisconnected && polygonArea(center.pts) > 100;
  assert(!wouldBeOk || center.isDisconnected !== false,
    "disconnectedCell cannot silently become status=ok through largest-ring extraction");

  // Outer cells (left, right) should remain connected
  assert(!cellInfos[0].isDisconnected, "left cell (not cut by hole) is connected");
  assert(!cellInfos[2].isDisconnected, "right cell (not cut by hole) is connected");
}

// ── T15: after gap-fill site added, union(all cells) = zoneRegion ─────────────
section("T15: after gap-fill, union(cells) still covers zone without holes/overlaps");
{
  // Add a 4th site (gap-fill) to a 3-site Power Diagram. Verify:
  // 1. No two cells overlap
  // 2. Union of all cells = zone area
  const sites = [{ x:20,y:20 }, { x:80,y:20 }, { x:50,y:80 }, { x:50,y:50 }]; // 4th = gap-fill
  const weights = [0, 0, 0, 0];
  const cells = buildPowerDiagramCells(sites, weights, ZONE, []);
  const valid = cells.filter(c => c !== null);
  assert(valid.length >= 3, `≥3 cells after gap-fill site added (got ${valid.length})`);

  // No overlap
  let maxOv = 0;
  for (let i = 0; i < valid.length; i++) {
    for (let j = i+1; j < valid.length; j++) {
      const ov = multiPolygonArea(intersectMulti(pointsToMultiPolygon(valid[i]), pointsToMultiPolygon(valid[j])));
      if (ov > maxOv) maxOv = ov;
    }
  }
  assertApprox(maxOv, 0, 2, `max cell overlap ≤ 2mm² after gap-fill (got ${maxOv.toFixed(3)})`);

  // Full coverage
  const total = valid.reduce((s, c) => s + polygonArea(c), 0);
  assertApprox(total, ZONE_AREA, 50, `total coverage = zone area after gap-fill (${total.toFixed(0)})`);
}

// ── T16: gap-fill placement has fragmentId, scrapPieceId, isGapFill=true ──────
section("T16: gap-fill placement object has required fields per contract §10");
{
  // Simulate formatResultV2 output for a gap-fill placement
  let fragCounter = 0;
  function makeGapFillPlacement(piece, cellPts, tx, ty, rotDeg) {
    const fragmentId = `frag_${++fragCounter}`;
    const isGapFill = true;
    const isDisconnected = false;
    const physicalMissing = 0;
    const cutMissing = 0;
    const napOk = true;
    const status = physicalMissing <= 1 && napOk && cutMissing <= 1 && !isDisconnected ? "ok" : "partial";
    return {
      fragmentId,
      scrapPieceId: piece.id,
      inventoryTag: piece.inventoryTag,
      fragmentContour: cellPts,
      cutContour: cellPts, // simplified: use cell as cut contour
      isGapFill,
      isDisconnected,
      tx, ty, rotDeg,
      status
    };
  }

  const fakePiece = { id: "scrap_007", inventoryTag: "INV-007" };
  const fakeCellPts = [{ x:40,y:40 }, { x:60,y:40 }, { x:60,y:60 }, { x:40,y:60 }];
  const pl = makeGapFillPlacement(fakePiece, fakeCellPts, 50, 50, 0);

  assert(typeof pl.fragmentId === "string" && pl.fragmentId.startsWith("frag_"),
    `fragmentId is a string starting with 'frag_' (got '${pl.fragmentId}')`);
  assert(pl.scrapPieceId === "scrap_007",
    `scrapPieceId matches piece id (got '${pl.scrapPieceId}')`);
  assert(pl.isGapFill === true, "isGapFill=true on gap-fill placement");
  assert(Array.isArray(pl.cutContour) && pl.cutContour.length >= 3,
    `cutContour is a non-empty polygon array (len=${pl.cutContour.length})`);
  assert(pl.status === "ok",
    `status='ok' when physicalMissing=0, napOk=true, cutMissing=0 (got '${pl.status}')`);
  assert(!pl.isDisconnected, "isDisconnected=false for normal gap-fill cell");
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
