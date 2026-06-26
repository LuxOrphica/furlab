"use strict";

const { createGridSpec } = require("./solver_primitives");
const { pointsToMultiPolygon, intersectMulti, largestOuterRingPoints } = require("./polygon_ops");

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

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

const NAP_EPS_DEG = 1e-6;

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
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points || []) {
    const x = Number(p && p.x);
    const y = Number(p && p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function centroid(points) {
  if (!Array.isArray(points) || points.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += Number(p.x || 0);
    sy += Number(p.y || 0);
  }
  return { x: sx / points.length, y: sy / points.length };
}

function normalizeGridSpec(raw, fallbackR) {
  if (!raw || typeof raw !== "object") return null;
  const r = Math.max(0.1, Number(raw.r || fallbackR || 2));
  const ox = Number(raw.ox);
  const oy = Number(raw.oy);
  const widthRaw = Number(raw.width !== undefined ? raw.width : raw.nx);
  const heightRaw = Number(raw.height !== undefined ? raw.height : raw.ny);
  const width = Math.max(1, Math.floor(widthRaw));
  const height = Math.max(1, Math.floor(heightRaw));
  if (!Number.isFinite(ox) || !Number.isFinite(oy)) return null;
  if (!Number.isFinite(widthRaw) || !Number.isFinite(heightRaw)) return null;
  const spec = { r, ox, oy, width, height };
  spec.nx = width;
  spec.ny = height;
  spec.worldToCell = function worldToCell(x, y) {
    return {
      i: Math.floor((Number(x) - spec.ox) / spec.r),
      j: Math.floor((Number(y) - spec.oy) / spec.r)
    };
  };
  spec.cellToWorld = function cellToWorld(i, j) {
    return {
      x: spec.ox + (Number(i) + 0.5) * spec.r,
      y: spec.oy + (Number(j) + 0.5) * spec.r
    };
  };
  return spec;
}

function pointOnSegment(px, py, ax, ay, bx, by, eps) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const c = vx * wy - vy * wx;
  if (Math.abs(c) > eps) return false;
  const d = wx * vx + wy * vy;
  if (d < -eps) return false;
  const l2 = vx * vx + vy * vy;
  if (d - l2 > eps) return false;
  return true;
}

function pointInPolygonInclusive(pt, poly) {
  const x = Number(pt.x || 0);
  const y = Number(pt.y || 0);
  let inside = false;
  const eps = 1e-9;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = Number(poly[i].x || 0);
    const ay = Number(poly[i].y || 0);
    const bx = Number(poly[j].x || 0);
    const by = Number(poly[j].y || 0);
    if (pointOnSegment(x, y, ax, ay, bx, by, eps)) return true;
    const yi = ay > y;
    const yj = by > y;
    if (yi !== yj) {
      const xh = (bx - ax) * (y - ay) / ((by - ay) || 1e-12) + ax;
      if (x <= xh + eps) inside = !inside;
    }
  }
  return inside;
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

function translateToAnchor(points, anchor) {
  const c = centroid(points);
  const dx = Number(anchor.x || 0) - c.x;
  const dy = Number(anchor.y || 0) - c.y;
  return (points || []).map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

function createBitset(size) {
  return new Uint32Array(Math.ceil(Math.max(1, size) / 32));
}

function getBit(arr, idx) {
  return ((arr[idx >>> 5] >>> (idx & 31)) & 1) === 1;
}

function setBit(arr, idx) {
  arr[idx >>> 5] |= (1 << (idx & 31));
}

function clearBit(arr, idx) {
  arr[idx >>> 5] &= ~(1 << (idx & 31));
}

function index2d(spec, i, j) {
  return j * spec.width + i;
}

function buildZoneMask(zonePoints, spec) {
  const total = spec.width * spec.height;
  const mask = createBitset(total);
  let count = 0;
  for (let j = 0; j < spec.height; j++) {
    const y = spec.oy + (j + 0.5) * spec.r;
    for (let i = 0; i < spec.width; i++) {
      const x = spec.ox + (i + 0.5) * spec.r;
      if (!pointInPolygonInclusive({ x, y }, zonePoints)) continue;
      const idx = index2d(spec, i, j);
      setBit(mask, idx);
      count += 1;
    }
  }
  return { mask, count };
}

function polygonGridBounds(poly, spec) {
  const bb = polygonBBox(poly);
  if (!bb) return null;
  const i0 = Math.max(0, Math.floor((bb.minX - spec.ox) / spec.r - 0.5) - 1);
  const i1 = Math.min(spec.width - 1, Math.ceil((bb.maxX - spec.ox) / spec.r - 0.5) + 1);
  const j0 = Math.max(0, Math.floor((bb.minY - spec.oy) / spec.r - 0.5) - 1);
  const j1 = Math.min(spec.height - 1, Math.ceil((bb.maxY - spec.oy) / spec.r - 0.5) + 1);
  if (i1 < i0 || j1 < j0) return null;
  return { i0, i1, j0, j1 };
}

function rasterizePolygonWindow(poly, spec) {
  const gb = polygonGridBounds(poly, spec);
  if (!gb) return null;
  const width = gb.i1 - gb.i0 + 1;
  const height = gb.j1 - gb.j0 + 1;
  if (width <= 0 || height <= 0) return null;
  const rowWords = Math.ceil(width / 32);
  const mask = new Uint32Array(rowWords * height);
  let count = 0;

  for (let ry = 0; ry < height; ry++) {
    const j = gb.j0 + ry;
    const y = spec.oy + (j + 0.5) * spec.r;
    const xs = [];
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const p1 = poly[b];
      const p2 = poly[a];
      const y1 = Number(p1.y || 0);
      const y2 = Number(p2.y || 0);
      const x1 = Number(p1.x || 0);
      const x2 = Number(p2.x || 0);
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        const t = (y - y1) / ((y2 - y1) || 1e-12);
        xs.push(x1 + (x2 - x1) * t);
      }
    }
    if (!xs.length) continue;
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xL = xs[k];
      const xR = xs[k + 1];
      const iStart = Math.max(gb.i0, Math.ceil((xL - spec.ox) / spec.r - 0.5));
      const iEnd = Math.min(gb.i1, Math.floor((xR - spec.ox) / spec.r - 0.5));
      if (iEnd < iStart) continue;
      for (let i = iStart; i <= iEnd; i++) {
        const local = i - gb.i0;
        const word = ry * rowWords + (local >>> 5);
        const bit = local & 31;
        const prev = mask[word];
        const next = prev | (1 << bit);
        if (prev !== next) {
          mask[word] = next;
          count += 1;
        }
      }
    }
  }
  return { ...gb, width, height, rowWords, mask, count };
}

function evaluateWindow(win, zoneMask, coveredMask, spec) {
  if (!win || !win.mask || win.count <= 0) {
    return { insideCount: 0, outsideCount: 0, gainCount: 0, overlapCount: 0 };
  }
  let inside = 0;
  let outside = 0;
  let gain = 0;
  let overlap = 0;

  for (let ry = 0; ry < win.height; ry++) {
    const j = win.j0 + ry;
    for (let w = 0; w < win.rowWords; w++) {
      let word = win.mask[ry * win.rowWords + w] >>> 0;
      while (word) {
        const lsb = word & -word;
        const bit = 31 - Math.clz32(lsb);
        const i = win.i0 + (w << 5) + bit;
        if (i <= win.i1) {
          const idx = index2d(spec, i, j);
          if (getBit(zoneMask, idx)) {
            inside += 1;
            if (getBit(coveredMask, idx)) overlap += 1;
            else gain += 1;
          } else {
            outside += 1;
          }
        }
        word ^= lsb;
      }
    }
  }
  return { insideCount: inside, outsideCount: outside, gainCount: gain, overlapCount: overlap };
}

function commitWindow(win, zoneMask, coveredMask, uncoveredMask, spec) {
  if (!win || !win.mask) return 0;
  let newly = 0;
  for (let ry = 0; ry < win.height; ry++) {
    const j = win.j0 + ry;
    for (let w = 0; w < win.rowWords; w++) {
      let word = win.mask[ry * win.rowWords + w] >>> 0;
      while (word) {
        const lsb = word & -word;
        const bit = 31 - Math.clz32(lsb);
        const i = win.i0 + (w << 5) + bit;
        if (i <= win.i1) {
          const idx = index2d(spec, i, j);
          if (getBit(zoneMask, idx) && !getBit(coveredMask, idx)) {
            setBit(coveredMask, idx);
            clearBit(uncoveredMask, idx);
            newly += 1;
          }
        }
        word ^= lsb;
      }
    }
  }
  return newly;
}

function firstUncoveredCell(uncoveredMask, spec, startIdx) {
  const total = spec.width * spec.height;
  const start = Math.max(0, Math.min(total - 1, Number(startIdx || 0)));
  for (let n = 0; n < total; n++) {
    const idx = (start + n) % total;
    if (!getBit(uncoveredMask, idx)) continue;
    const j = Math.floor(idx / spec.width);
    const i = idx - j * spec.width;
    return {
      idx,
      i,
      j,
      x: spec.ox + (i + 0.5) * spec.r,
      y: spec.oy + (j + 0.5) * spec.r
    };
  }
  return null;
}

async function solveCoverGrid(params) {
  const zonePoints = Array.isArray(params && params.zonePoints) ? params.zonePoints : [];
  const candidates = Array.isArray(params && params.candidates) ? params.candidates : [];
  const constraints = params && params.constraints ? params.constraints : {};
  const options = params && params.options ? params.options : {};
  if (zonePoints.length < 3) return { ok: false, error: "zone_points_required" };

  const zoneBBox = polygonBBox(zonePoints);
  if (!zoneBBox) return { ok: false, error: "zone_bbox_invalid" };
  const zoneArea = polygonArea(zonePoints);
  if (zoneArea <= 0) return { ok: false, error: "zone_area_invalid" };

  const r = Math.max(1, Math.min(10, Number(options.rasterMm || 2)));
  const padCells = Math.max(0, Math.floor(Number(options.padCells !== undefined ? options.padCells : 2)));
  const gridSpec = normalizeGridSpec(options.gridSpec, r) || createGridSpec(zoneBBox, r, padCells);
  if (!gridSpec || !Number.isFinite(gridSpec.width) || !Number.isFinite(gridSpec.height)) {
    return { ok: false, error: "grid_spec_invalid" };
  }
  const totalCells = gridSpec.width * gridSpec.height;
  const zoneData = buildZoneMask(zonePoints, gridSpec);
  const zoneMask = zoneData.mask;

  // Erode zone boundary by pieceSeamReserveMm so cells within seam-reserve distance
  // from zone edge are not required to be covered by cores — they'll be covered by
  // the seam allowance of adjacent pieces' full contours.
  const seamReserveCells = Math.max(0, Math.ceil(
    Number(options.pieceSeamReserveMm || 0) / Math.max(1e-9, gridSpec.r)
  ));
  let coverageMask = zoneMask;
  let targetCellCount = zoneData.count;
  if (seamReserveCells > 0) {
    const eroded = createBitset(totalCells);
    let erodedCount = 0;
    for (let j = 0; j < gridSpec.height; j++) {
      for (let i = 0; i < gridSpec.width; i++) {
        const idx = index2d(gridSpec, i, j);
        if (!getBit(zoneMask, idx)) continue;
        // Check all 4-neighbors within seamReserveCells radius are also in zone
        let ok = true;
        outer: for (let dj = -seamReserveCells; dj <= seamReserveCells; dj++) {
          for (let di = -seamReserveCells; di <= seamReserveCells; di++) {
            if (Math.abs(di) + Math.abs(dj) > seamReserveCells) continue; // Manhattan
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || ni >= gridSpec.width || nj < 0 || nj >= gridSpec.height) {
              ok = false; break outer;
            }
            if (!getBit(zoneMask, index2d(gridSpec, ni, nj))) {
              ok = false; break outer;
            }
          }
        }
        if (ok) { setBit(eroded, idx); erodedCount++; }
      }
    }
    if (erodedCount > 0) {
      coverageMask = eroded;
      targetCellCount = erodedCount;
    }
  }

  const coveredMask = createBitset(totalCells);
  const uncoveredMask = new Uint32Array(coverageMask);
  let uncoveredCount = targetCellCount;

  const napTol = Math.max(0, Math.min(180, Number((constraints && constraints.napToleranceDeg) ?? 15)));
  const napTarget = normalizeDeg(constraints.napDirectionDeg);
  const allowFlip180 = false;
  const napWeight = Math.max(0, Math.min(5, Number(constraints.napWeight || 1)));
  const coverageTarget = Math.max(0.65, Math.min(0.99999, Number(options.coverageTarget || 0.9999)));
  const coverageEps = Math.max(0.0005, Math.min(0.02, Number(options.coverageEps || 0.0005)));
  const overlapPenalty = Math.max(0, Math.min(3, Number(options.overlapPenalty || 0.25)));
  const outsidePenalty = Math.max(0, Math.min(3, Number(options.outsidePenalty || 0.05)));
  const coverageFirst = options.coverageFirst === true;
  const strictCoverage = options.strictCoverage !== false;
  const strictCoverageHard = options.strictCoverageHard === true;
  const maxPieceOverlap = Math.max(0, Math.min(1, Number(options.maxPieceOverlap || 0.9)));
  const tailCoverageStart = Math.max(0.7, Math.min(0.99999, Number(options.tailCoverageStart || 0.95)));
  const tailResidualRatio = Math.max(0.001, Math.min(0.2, Number(options.tailResidualRatio || 0.03)));
  const tailOversizeAlpha = Math.max(1.05, Math.min(12, Number(options.tailOversizeAlpha || 3.2)));
  const tailPenaltyBoost = Math.max(1, Math.min(4, Number(options.tailPenaltyBoost || 1.7)));
  const maxPieces = Math.max(1, Math.min(400, Number(options.maxPieces || 240)));
  const maxSolveMs = Math.max(5000, Math.min(1200000, Number(options.hardMaxSolveMs || options.maxSolveMs || 600000)));
  const onProgress = options && typeof options.onProgress === "function" ? options.onProgress : null;
  const objectiveMode = String((options && options.objectiveMode) || "default").toLowerCase();
  const objectiveMinEfficiency = Math.max(0.5, Math.min(0.99, Number((options && options.objectiveMinEfficiency) ?? 0.82)));
  const minGainCellsBase = Math.max(1, Math.floor(Number((options && options.minGainCells) ?? 1)));
  const minGainAreaMm2 = Math.max(0, Number((options && (options.minGainAreaMm2 ?? options.minAreaMm2)) ?? 0));
  const enforceMinGainByArea = options && options.enforceMinGainByArea !== false && minGainAreaMm2 > 0;
  const minGainCellsByArea = minGainAreaMm2 > 0
    ? Math.max(1, Math.ceil(minGainAreaMm2 / Math.max(1e-9, gridSpec.r * gridSpec.r)))
    : 1;
  const minGainCells = enforceMinGainByArea
    ? Math.max(minGainCellsBase, minGainCellsByArea)
    : minGainCellsBase;
  const startMs = Date.now();
  const tailResidualCells = Math.max(1, Math.floor(targetCellCount * tailResidualRatio));

  const used = new Set();
  const placements = [];
  const fragments = [];
  let overlapAreaMm2 = 0;
  let nextFragId = 1;
  let evaluated = 0;
  let iterCount = 0;
  let rejectedByOverlap = 0;
  let rejectedByCoverage = 0;
  let rejectedByOutside = 0;
  let rejectedByOversize = 0;
  let rejectedNoFit = 0;
  let noProgressStreak = 0;
  const noProgressBreakMain = (strictCoverage || strictCoverageHard) ? 60 : 5;
  const noProgressBreakTail = (strictCoverage || strictCoverageHard) ? 120 : 8;
  let lastProgressEmitAt = 0;
  let lastProgressIter = 0;

  function emitProgress(payload) {
    if (!onProgress) return;
    try { onProgress(payload); } catch (_) {}
  }

  emitProgress({
    phase: "placement_search_start",
    percent: 82,
    title: "Server / placement search",
    pieces: 0,
    coverage: 0,
    evaluated: 0,
    rejected: { overlap: 0, lowGain: 0, outside: 0, oversize: 0, noFit: 0 }
  });

  const templates = candidates
    .map((c, i) => {
      const contour = Array.isArray(c.__scrapContourPoints) ? c.__scrapContourPoints : [];
      if (contour.length < 3) return null;
      const coreContour = Array.isArray(c.__coreContourPoints) && c.__coreContourPoints.length >= 3
        ? c.__coreContourPoints : contour;
      const centered = translateToAnchor(contour, { x: 0, y: 0 });
      const coreCentered = coreContour !== contour ? translateToAnchor(coreContour, { x: 0, y: 0 }) : centered;
      return {
        idx: i,
        c,
        key: `${String(c.id || "").trim()}|${String(c.inventoryTag || "").trim()}|${i}`,
        contour,
        centered,
        coreCentered,
        hasCore: coreContour !== contour,
        area: safeNum(c.areaMm2) || polygonArea(contour),
        napDirectionDeg: normalizeDeg(c.napDirectionDeg)
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.area || 0) - Number(a.area || 0));

  function napDeviation(rotDeg, tpl) {
    if (napTarget === null || tpl.napDirectionDeg === null) return 0;
    const rotated = normalizeDeg(tpl.napDirectionDeg + rotDeg);
    const d0 = deltaDeg(napTarget, rotated);
    if (d0 === null) return 0;
    if (!allowFlip180) return d0;
    const d1 = deltaDeg(napTarget, normalizeDeg(rotated + 180));
    return d1 === null ? d0 : Math.min(d0, d1);
  }

  for (let iter = 0; iter < maxPieces; iter++) {
    if ((iter % 2) === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    iterCount += 1;
    if ((Date.now() - startMs) > maxSolveMs) break;
    if (uncoveredCount <= 0) break;

    const targetStartIdx = (iterCount * 7919) % Math.max(1, totalCells);
    const target = firstUncoveredCell(uncoveredMask, gridSpec, targetStartIdx);
    if (!target) break;

    let best = null;
    const freeAreaRatio = targetCellCount > 0 ? (uncoveredCount / targetCellCount) : 0;
    const coveredRatioNow = targetCellCount > 0 ? Math.max(0, Math.min(1, (targetCellCount - uncoveredCount) / targetCellCount)) : 0;
    const inTailPhase = coveredRatioNow >= tailCoverageStart || uncoveredCount <= tailResidualCells || noProgressStreak >= 2;
    const tailRescueMode = (strictCoverage || strictCoverageHard) && inTailPhase && noProgressStreak >= 8;
    const angleStep = napTol <= 12 ? 3 : (napTol <= 30 ? 6 : 12);
    const dynamicTol = napTarget === null ? 180 : napTol;
    const adaptiveOverlapPenalty = overlapPenalty * (coveredRatioNow >= 0.9 ? 1.45 : (coveredRatioNow >= 0.8 ? 1.2 : 1)) * (inTailPhase ? tailPenaltyBoost : 1);
    const adaptiveOutsidePenalty = outsidePenalty * (coveredRatioNow >= 0.9 ? 1.1 : 1) * (inTailPhase ? tailPenaltyBoost : 1);
    const dynamicMinGainCellsBase = inTailPhase
      ? Math.max(enforceMinGainByArea ? minGainCellsByArea : 1, Math.floor(minGainCells * 0.5))
      : minGainCells;
    const dynamicMinGainCells = noProgressStreak >= 2
      ? Math.max(1, Math.floor(dynamicMinGainCellsBase * 0.5))
      : dynamicMinGainCellsBase;
    const overlapSoftLimit = inTailPhase
      ? Math.max(maxPieceOverlap, 0.78)
      : Math.max(maxPieceOverlap, 0.55);
    const overlapHardLimit = inTailPhase ? 0.995 : 0.97;

    for (const tpl of templates) {
      if (used.has(tpl.key)) continue;
      const pref = (napTarget !== null && tpl.napDirectionDeg !== null)
        ? ((napTarget - tpl.napDirectionDeg + 540) % 360) - 180
        : 0;
      const minRot = pref - dynamicTol;
      const maxRot = pref + dynamicTol;
      const offsets = freeAreaRatio < 0.2
        ? [{ dx: 0, dy: 0 }, { dx: -6, dy: 0 }, { dx: 6, dy: 0 }, { dx: 0, dy: -6 }, { dx: 0, dy: 6 }]
        : [{ dx: 0, dy: 0 }];

      for (let a = minRot; a <= maxRot + 1e-9; a += angleStep) {
        const dNap = napDeviation(a, tpl);
        if (napTarget !== null) {
          if (dynamicTol <= 0) {
            if (dNap > NAP_EPS_DEG) continue;
          } else if (dNap > dynamicTol + NAP_EPS_DEG) {
            continue;
          }
        }
        const rot = (a * Math.PI) / 180;
        const rotated = rotatePoints(tpl.centered, rot, { x: 0, y: 0 });
        const coreRotated = tpl.hasCore ? rotatePoints(tpl.coreCentered, rot, { x: 0, y: 0 }) : rotated;
        for (const off of offsets) {
          evaluated += 1;
          const contour = translateToAnchor(rotated, { x: target.x + off.dx, y: target.y + off.dy });
          const win = rasterizePolygonWindow(contour, gridSpec);
          if (!win) continue;
          const coreContourPlaced = tpl.hasCore ? translateToAnchor(coreRotated, { x: target.x + off.dx, y: target.y + off.dy }) : contour;
          const coreWin = tpl.hasCore ? (rasterizePolygonWindow(coreContourPlaced, gridSpec) || win) : win;
          // gain = new required cells covered by CORE (coverageMask = eroded zone, excl. boundary seam strip)
          // inside/overlap/outside = full zoneMask for placement quality scoring
          const sCore = evaluateWindow(coreWin, coverageMask, coveredMask, gridSpec);
          const sFull = tpl.hasCore ? evaluateWindow(win, zoneMask, coveredMask, gridSpec) : sCore;
          const s = { ...sFull, gainCount: sCore.gainCount };
          if (s.gainCount < dynamicMinGainCells) {
            rejectedByCoverage += 1;
            continue;
          }
          const insideCount = Math.max(1, s.insideCount);
          const overlapRatio = s.overlapCount / insideCount;
          // Overlap is primarily a soft penalty; keep only a very hard cap to avoid pathological picks.
          if (!coverageFirst && overlapRatio > overlapHardLimit) {
            rejectedByOverlap += 1;
            continue;
          }
          if (inTailPhase && !(strictCoverage || strictCoverageHard) && !tailRescueMode && s.insideCount > tailOversizeAlpha * Math.max(1, s.gainCount)) {
            rejectedByOversize += 1;
            continue;
          }
          const efficiencyRatio = s.gainCount / Math.max(1, s.insideCount);
          const residualRatioNow = targetCellCount > 0 ? (uncoveredCount / targetCellCount) : 1;
          const tailEffMin = (strictCoverage || strictCoverageHard)
            ? (tailRescueMode ? 0.005 : (residualRatioNow <= 0.02 ? 0.02 : 0.08))
            : (tailRescueMode ? 0.02 : (residualRatioNow <= 0.02 ? 0.10 : 0.25));
          if (inTailPhase && efficiencyRatio + 1e-9 < tailEffMin) {
            rejectedByCoverage += 1;
            continue;
          }
          const napPenaltyDen = dynamicTol > NAP_EPS_DEG ? dynamicTol : 1;
          const napPenalty = napWeight * (dNap / napPenaltyDen) * 10;
          const gainNorm = s.gainCount / Math.max(1, s.insideCount);
          const utilizationPenalty = (1 - gainNorm) * (inTailPhase ? 12 : 3);
          const tailSizePenalty = inTailPhase ? 0.08 * s.insideCount : 0;
          let score;
          const softOverlapPenalty = (!coverageFirst && overlapRatio > overlapSoftLimit)
            ? (overlapRatio - overlapSoftLimit) * (inTailPhase ? 40 : 28)
            : 0;
          if (objectiveMode === "onegood") {
            const efficiency = s.gainCount / Math.max(1, s.insideCount);
            const microHolePenalty = efficiency < objectiveMinEfficiency
              ? (objectiveMinEfficiency - efficiency) * (inTailPhase ? 24 : 16)
              : 0;
            const piecePenalty = inTailPhase ? 9 : 6;
            score =
              1.1 * s.gainCount -
              0.42 * s.insideCount -
              (adaptiveOverlapPenalty * 1.35) * s.overlapCount -
              (adaptiveOutsidePenalty * 1.2) * s.outsideCount -
              napPenalty -
              piecePenalty -
              microHolePenalty -
              softOverlapPenalty;
          } else {
            score =
              s.gainCount -
              adaptiveOverlapPenalty * s.overlapCount -
              adaptiveOutsidePenalty * s.outsideCount -
              napPenalty -
              utilizationPenalty -
              tailSizePenalty -
              softOverlapPenalty;
          }
          if (
            !best ||
            score > best.score + 1e-9 ||
            (Math.abs(score - best.score) <= 1e-9 && s.insideCount < Number(best.s && best.s.insideCount || Number.POSITIVE_INFINITY))
          ) {
            best = { tpl, contour, win: coreWin, score, s, angleDeg: a, dNap }; // win=coreWin for commitWindow
          }
        }
      }
    }


    if (Date.now() - lastProgressEmitAt > 450 || iter - lastProgressIter >= 5) {
      emitProgress({
        phase: "placement_search",
        percent: 83 + Math.min(7, coveredRatioNow * 7),
        title: "Server / placement search",
        iterations: iterCount,
        evaluated,
        pieces: placements.length,
        coverage: coveredRatioNow * 100,
        residualAreaMm2: uncoveredCount * gridSpec.r * gridSpec.r,
        rejected: {
          overlap: rejectedByOverlap,
          lowGain: rejectedByCoverage,
          outside: rejectedByOutside,
          oversize: rejectedByOversize,
          noFit: rejectedNoFit
        },
        thresholds: {
          overlapHardLimit,
          dynamicMinGainCells,
          inTailPhase,
          coverageFirst,
          noProgressStreak
        }
      });
      lastProgressEmitAt = Date.now();
      lastProgressIter = iter;
    }

    if (!best) {
      rejectedNoFit += 1;
      noProgressStreak += 1;
      emitProgress({
        phase: "placement_search_stall",
        percent: 90,
        title: "Server / placement stalled",
        iterations: iterCount,
        evaluated,
        pieces: placements.length,
        coverage: coveredRatioNow * 100,
        residualAreaMm2: uncoveredCount * gridSpec.r * gridSpec.r,
        rejected: {
          overlap: rejectedByOverlap,
          lowGain: rejectedByCoverage,
          outside: rejectedByOutside,
          oversize: rejectedByOversize,
          noFit: rejectedNoFit
        },
        thresholds: {
          overlapHardLimit,
          dynamicMinGainCells,
          inTailPhase,
          coverageFirst,
          noProgressStreak
        }
      });
      // Do not stop immediately on one bad anchor; try another uncovered cell next iteration.
      if (noProgressStreak >= (inTailPhase ? noProgressBreakTail : noProgressBreakMain)) break;
      continue;
    }
    used.add(best.tpl.key);
    const newly = commitWindow(best.win, coverageMask, coveredMask, uncoveredMask, gridSpec);
    if (newly <= 0) continue;
    noProgressStreak = 0;
    uncoveredCount = Math.max(0, uncoveredCount - newly);
    overlapAreaMm2 += Math.max(0, best.s.overlapCount) * gridSpec.r * gridSpec.r;

    const inZoneMulti = intersectMulti(pointsToMultiPolygon(best.contour), pointsToMultiPolygon(zonePoints));
    const fragPoints = largestOuterRingPoints(inZoneMulti).length >= 3 ? largestOuterRingPoints(inZoneMulti) : best.contour;
    const fragArea = polygonArea(fragPoints);
    const fragId = nextFragId++;
    fragments.push({ id: fragId, points: fragPoints, areaMm2: fragArea });
    placements.push({
      fragmentId: fragId,
      fragmentAreaMm2: fragArea,
      gainAreaMm2: Math.max(0, best.s.gainCount) * gridSpec.r * gridSpec.r,
      inZoneAreaMm2: Math.max(0, best.s.insideCount) * gridSpec.r * gridSpec.r,
      overlapAreaMm2: Math.max(0, best.s.overlapCount) * gridSpec.r * gridSpec.r,
      outsideAreaMm2: Math.max(0, best.s.outsideCount) * gridSpec.r * gridSpec.r,
      scrapAreaMm2: Math.max(0, Number(best.tpl.area || 0)),
      utilizationLocal: Math.max(0, Math.min(1, best.s.gainCount / Math.max(1, best.s.insideCount))),
      scrapPieceId: String(best.tpl.c.id || ""),
      inventoryTag: String(best.tpl.c.inventoryTag || ""),
      scrapContour: String(best.tpl.c.scrapContour || ""),
      napDirectionDeg: safeNum(best.tpl.c.napDirectionDeg),
      bboxWidthMm: safeNum(best.tpl.c.bboxWidthMm),
      bboxHeightMm: safeNum(best.tpl.c.bboxHeightMm),
      fitScore: Math.round(Math.max(0, best.score) * 1000) / 1000,
      fitAreaRatio: null,
      fitCoverageRatio: null,
      fitOverlap: best.s.insideCount > 0 ? Math.round((best.s.overlapCount / best.s.insideCount) * 1000) / 1000 : 0,
      fitInsidePercent: best.s.insideCount > 0 ? Math.round((best.s.insideCount / Math.max(1, best.s.insideCount + best.s.outsideCount)) * 1000) / 10 : 0,
      fitNapPenalty: Math.round(best.dNap * 100) / 100,
      fitChamferMm: null,
      napDeltaDeg: Math.round(best.dNap * 10) / 10,
      alignRotationDeg: Math.round(best.angleDeg * 10) / 10,
      napEffectiveDeg: Number.isFinite(Number(best.tpl.c && best.tpl.c.napDirectionDeg))
        ? Math.round(normalizeDeg(Number(best.tpl.c.napDirectionDeg) + Number(best.angleDeg || 0)) * 10) / 10
        : null,
      alignOffsetX: 0,
      alignOffsetY: 0,
      alignedContour: best.contour,
      status: "matched"
    });
    emitProgress({
      phase: "piece_accepted",
      percent: 89,
      title: "Server / accepted piece",
      pieceAreaMm2: Math.max(0, Number(best.tpl.area || 0)),
      gainAreaMm2: Math.max(0, best.s.gainCount) * gridSpec.r * gridSpec.r,
      overlapInsideMm2: Math.max(0, best.s.overlapCount) * gridSpec.r * gridSpec.r,
      outsideMm2: Math.max(0, best.s.outsideCount) * gridSpec.r * gridSpec.r,
      score: Number(best.score || 0),
      pieces: placements.length,
      coverage: (targetCellCount > 0 ? Math.max(0, Math.min(1, (targetCellCount - uncoveredCount) / targetCellCount)) : 0) * 100
    });

    const now = Date.now();
    if (
      now - lastProgressEmitAt > 350 ||
      iter - lastProgressIter >= 6 ||
      uncoveredCount <= tailResidualCells
    ) {
      noProgressStreak = 0;
      const coveredRatioNow = targetCellCount > 0
        ? Math.max(0, Math.min(1, (targetCellCount - uncoveredCount) / targetCellCount))
        : 0;
      emitProgress({
        phase: "placement_search",
        percent: 83 + Math.min(9, coveredRatioNow * 9),
        title: "Server / placement search",
        iterations: iterCount,
        evaluated,
        pieces: placements.length,
        coverage: coveredRatioNow * 100,
        residualAreaMm2: uncoveredCount * gridSpec.r * gridSpec.r,
        rejected: {
          overlap: rejectedByOverlap,
          lowGain: rejectedByCoverage,
          outside: rejectedByOutside,
          oversize: rejectedByOversize,
          noFit: rejectedNoFit
        },
        thresholds: {
          overlapHardLimit,
          dynamicMinGainCells,
          inTailPhase,
          coverageFirst,
          noProgressStreak
        }
      });
      lastProgressEmitAt = now;
      lastProgressIter = iter;
    }
  }

  const coveredRatio = targetCellCount > 0 ? Math.max(0, Math.min(1, (targetCellCount - uncoveredCount) / targetCellCount)) : 0;
  const residualAreaMm2 = uncoveredCount * gridSpec.r * gridSpec.r;
  const fullCoverageOk = coveredRatio >= (1 - coverageEps);
  emitProgress({
    phase: "placement_search_done",
    percent: 92,
    title: "Server / coverage check",
    iterations: iterCount,
    evaluated,
    pieces: placements.length,
    coverage: coveredRatio * 100,
    residualAreaMm2,
    rejected: {
      overlap: rejectedByOverlap,
      lowGain: rejectedByCoverage,
      outside: rejectedByOutside,
      oversize: rejectedByOversize,
      noFit: rejectedNoFit
    }
  });
  return {
    ok: true,
    fragments,
    placements,
    compatibleCandidates: templates.length,
    usedInventoryTags: placements.map((p) => p.inventoryTag),
    rejectedByOverlap,
    rejectedByCoverage,
    rejectedByOutside,
    rejectedByOversize,
    rejectedNoFit,
    coveredRatio,
    coveragePercent: coveredRatio * 100,
    residualAreaMm2,
    overlapAreaMm2,
    candidateAreaBudgetMm2: templates.reduce((a, t) => a + Math.max(0, Number(t.area || 0)), 0),
    timeBudgetExceeded: (Date.now() - startMs) > maxSolveMs && !fullCoverageOk,
    strictCoverage: true,
    coverageEps,
    fullCoverageOk: fullCoverageOk && coveredRatio >= coverageTarget - coverageEps,
    algorithmTrace: {
      version: "gridCoverV1",
      steps: {
        candidate_pool: { input: candidates.length, compatible: templates.length, templates: templates.length },
        placement_search: {
          iterations: iterCount,
          evaluated,
          placed: placements.length,
          rejected: {
            overlap: rejectedByOverlap,
            outside: rejectedByOutside,
            lowGain: rejectedByCoverage,
            oversize: rejectedByOversize,
            noFit: rejectedNoFit
          }
        },
        repair_repack: { enabled: false, attempts: 0, placementsReused: placements.length },
        strict_final_check: {
          strictCoverage: true,
          coverageTarget,
          coverageEps,
          coveredRatio,
          fullCoverageOk,
          failedReason: fullCoverageOk ? null : "zone_not_fully_covered"
        }
      }
    },
    gridSpec
  };
}

module.exports = {
  solveCoverGrid
};

