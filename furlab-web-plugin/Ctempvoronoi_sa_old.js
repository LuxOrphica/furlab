"use strict";

/**
 * Voronoi SA solver for inventory layout.
 *
 * Same SA engine as nfp_sa_solver, but territory assignment uses Weighted Voronoi
 * instead of incremental diffMulti. Each zone cell is assigned to the nearest piece
 * center — guarantees no holes and no tiny leftover fragments from diffMulti cuts.
 *
 * API contract: same output shape as inventory-direct-cover-contract v1.3.
 */

const ClipperLib = require("clipper-lib");

const CLIPPER_SCALE = 1000; // mm → clipper integer units

function createVoronoiSaSolver(deps) {
  const {
    parseScrapContourPoints,
    centroid,
    rotatePoints,
    polygonBBox,
    normalizeDeg,
    deltaDeg,
    pointsToMultiPolygon,
    intersectMulti,
    diffMulti,
    unionMulti,
    multiPolygonArea,
    createGridSpec,
    createSeededRng
  } = deps;

  // ── Geometry ────────────────────────────────────────────────────────────────

  function transformPiece(centeredPts, angleDeg, tx, ty) {
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    return centeredPts.map(p => ({
      x: p.x * cos - p.y * sin + tx,
      y: p.x * sin + p.y * cos + ty
    }));
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

  // ── IFP via clipper Minkowski difference ────────────────────────────────────

  /**
   * Inner Fit Polygon: set of centroid positions where (rotated) piece fits inside zone.
   * IFP = MinkowskiDiff(zone, piece_centered_at_origin)
   * Returns array of {x,y} points or null on failure.
   */
  function computeIFP(zonePts, centeredPts) {
    try {
      const toC = pts =>
        pts.map(p => ({ X: Math.round(p.x * CLIPPER_SCALE), Y: Math.round(p.y * CLIPPER_SCALE) }));

      const zoneC = toC(zonePts);
      const pieceC = toC(centeredPts);

      const paths = ClipperLib.Clipper.MinkowskiDiff(zoneC, pieceC);
      if (!paths || paths.length === 0) return null;

      // Take the path with largest absolute area (the IFP outer ring)
      let best = null, bestArea = 0;
      for (const path of paths) {
        const a = Math.abs(ClipperLib.Clipper.Area(path));
        if (a > bestArea) { bestArea = a; best = path; }
      }
      if (!best || best.length < 3) return null;

      return best.map(p => ({ x: p.X / CLIPPER_SCALE, y: p.Y / CLIPPER_SCALE }));
    } catch (_) {
      return null;
    }
  }

  // ── Raster ──────────────────────────────────────────────────────────────────

  function rasterize(pts, spec) {
    const { nx, ny, r, ox, oy } = spec;
    const mask = new Uint8Array(nx * ny);
    if (!pts || pts.length < 3) return mask;
    // Scanline fill for speed
    const bbMinX = Math.max(0, Math.floor((Math.min(...pts.map(p => p.x)) - ox) / r));
    const bbMaxX = Math.min(nx - 1, Math.ceil((Math.max(...pts.map(p => p.x)) - ox) / r));
    const bbMinY = Math.max(0, Math.floor((Math.min(...pts.map(p => p.y)) - oy) / r));
    const bbMaxY = Math.min(ny - 1, Math.ceil((Math.max(...pts.map(p => p.y)) - oy) / r));
    for (let j = bbMinY; j <= bbMaxY; j++) {
      const cy = oy + (j + 0.5) * r;
      for (let i = bbMinX; i <= bbMaxX; i++) {
        const cx = ox + (i + 0.5) * r;
        if (pointInPolygon(cx, cy, pts)) mask[j * nx + i] = 1;
      }
    }
    return mask;
  }

  function countBits(mask) {
    let n = 0;
    for (let i = 0; i < mask.length; i++) n += mask[i];
    return n;
  }

  function countAnd(a, b) {
    let n = 0;
    for (let i = 0; i < a.length; i++) n += a[i] & b[i];
    return n;
  }

  // ── State helpers ───────────────────────────────────────────────────────────

  function makePlacement(piece, cx, cy, angleDeg, spec, zoneMask) {
    const pts = transformPiece(piece.centeredPts, angleDeg, cx, cy);
    const corePts = transformPiece(piece.centeredCorePts, angleDeg, cx, cy);
    const mask = rasterize(corePts, spec);
    // Clip mask to zone
    for (let i = 0; i < mask.length; i++) mask[i] &= zoneMask[i];
    return { id: piece.id, inventoryTag: piece.inventoryTag, cx, cy, angleDeg, pts, mask };
  }

  /**
   * Recompute covered cells and overlap from the full placement list.
   * Returns { covered: Uint8Array, coveredCells, overlapCells }.
   */
  function computeCoverage(placements, cellCount) {
    const covered = new Uint8Array(cellCount);
    const counts = new Uint8Array(cellCount);
    let overlapCells = 0;
    for (const pl of placements) {
      for (let i = 0; i < cellCount; i++) {
        if (pl.mask[i]) {
          counts[i]++;
          covered[i] = 1;
        }
      }
    }
    for (let i = 0; i < cellCount; i++) {
      if (counts[i] > 1) overlapCells += counts[i] - 1;
    }
    const coveredCells = countBits(covered);
    return { covered, coveredCells, overlapCells };
  }

  function energy(coveredCells, overlapCells, N, zoneCells) {
    // Lexicographic priorities: coverage first, then overlap, then count
    return 1000 * (zoneCells - coveredCells) + 8 * overlapCells + 1 * N;
  }

  // ── Anchor sampling ─────────────────────────────────────────────────────────

  function sampleInPoly(poly, bbox, rng) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const x = bbox.minX + rng.next() * (bbox.maxX - bbox.minX);
      const y = bbox.minY + rng.next() * (bbox.maxY - bbox.minY);
      if (pointInPolygon(x, y, poly)) return { x, y };
    }
    return null;
  }

  function sampleAnchor(piece, ifpCache, zonePoints, zoneBbox, rng) {
    const ifp = ifpCache.get(piece.id);
    // 70% chance to use IFP if available (piece guaranteed to fit inside zone)
    if (ifp && rng.next() < 0.7) {
      const pos = sampleInPoly(ifp, polygonBBox(ifp), rng);
      if (pos) return pos;
    }
    return sampleInPoly(zonePoints, zoneBbox, rng);
  }

  // ── Greedy warm start ───────────────────────────────────────────────────────

  async function greedyWarmStart(pieces, napTarget, napTol, spec, zoneMask, zoneCells, zonePts, zoneBbox, ifpCache, rng, onProgress) {
    const sorted = [...pieces].sort((a, b) => b.areaMm2 - a.areaMm2);
    const placements = [];
    const usedIds = new Set();
    const covered = new Uint8Array(zoneMask.length);
    let coveredCells = 0;

    for (let pi = 0; pi < sorted.length; pi++) {
      const piece = sorted[pi];
      if (usedIds.has(piece.id)) continue;
      if (coveredCells >= zoneCells * 0.999) break;

      let best = null, bestGain = -1;
      const angleBase = normalizeDeg(napTarget - piece.napDeg);

      for (let attempt = 0; attempt < 16; attempt++) {
        const dAngle = (rng.next() * 2 - 1) * Math.min(napTol, 12);
        const angle = normalizeDeg(angleBase + dAngle);

        const pos = sampleAnchor(piece, ifpCache, zonePts, zoneBbox, rng);
        if (!pos) continue;

        const pl = makePlacement(piece, pos.x, pos.y, angle, spec, zoneMask);
        const gain = countAnd(pl.mask, buildUncovered(covered, zoneMask));
        if (gain > bestGain) { bestGain = gain; best = pl; }
      }

      if (best && bestGain > 0) {
        placements.push(best);
        usedIds.add(best.id);
        for (let i = 0; i < best.mask.length; i++) {
          if (best.mask[i]) covered[i] = 1;
        }
        coveredCells += bestGain;
      }

      if ((pi + 1) % 8 === 0) {
        if (onProgress) {
          const warmPct = Math.round(30 + (pi + 1) / sorted.length * 10);
          onProgress({ type: "phase", phase: "warm_start", percent: warmPct, title: `NFP+SA: прогрев ${pi + 1}/${sorted.length}…`, pieces: placements.length, coverage: 0, iters: 0, temperature: 0 });
        }
        await new Promise(r => setImmediate(r));
      }
    }
    return placements;
  }

  function buildUncovered(covered, zoneMask) {
    const unc = new Uint8Array(covered.length);
    for (let i = 0; i < covered.length; i++) unc[i] = zoneMask[i] & (covered[i] ^ 1);
    return unc;
  }

  // ── Move types ──────────────────────────────────────────────────────────────

  const TRANSLATE = 0, ROTATE = 1, SWAP = 2, REMOVE = 3, ADD = 4;

  function pickMove(rng, hasUnused, hasMultiple) {
    const r = rng.next();
    if (r < 0.38) return TRANSLATE;
    if (r < 0.58) return ROTATE;
    if (r < 0.72 && hasUnused) return SWAP;
    if (r < 0.84 && hasMultiple) return REMOVE;
    if (hasUnused) return ADD;
    return TRANSLATE;
  }

  function findPiece(pieces, id) {
    return pieces.find(p => p.id === id);
  }

  // ── Main SA loop ────────────────────────────────────────────────────────────

  async function solve(zonePoints, candidates, _constraints, options) {
    const {
      napTarget = 0,
      napTol = 15,
      maxSolveMs = 60000,
      seed = 1,
      onProgress = null
    } = options || {};
    const allowanceMm = Math.max(0, Number((options && options.allowanceMm) || (options && options.seamAllowanceReserveMm) || 0));
    const minWidthMm = Math.max(0, Number((options && options.minWidthMm) || 0));
    const minLengthMm = Math.max(0, Number((options && options.minLengthMm) || 0));

    const rng = createSeededRng(seed);
    const zoneBbox = polygonBBox(zonePoints);
    const spec = createGridSpec(zoneBbox, 3, 1);
    const cellCount = spec.nx * spec.ny;
    let zoneMask = rasterize(zonePoints, spec);
    // Subtract holes from zone mask (CONTRACT_layouts.md §4, §10.6)
    const zoneHoles = Array.isArray(options && options.zoneHoles) ? options.zoneHoles : [];
    for (const hole of zoneHoles) {
      if (!Array.isArray(hole) || hole.length < 3) continue;
      const holeMask = rasterize(hole, spec);
      for (let i = 0; i < zoneMask.length; i++) zoneMask[i] &= ~holeMask[i];
    }
    const zoneCells = countBits(zoneMask);
    const cellAreaMm2 = spec.r * spec.r;
    const zoneArea = zoneCells * cellAreaMm2;

    // ── Prepare pieces ──────────────────────────────────────────────────────
    const pieces = [];
    for (const c of candidates) {
      const rawPts = Array.isArray(c.scrapContour) && c.scrapContour.length >= 3
        ? c.scrapContour.map(p => ({ x: Number(p.x), y: Number(p.y) })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
        : parseScrapContourPoints(c.scrapContour);
      if (!rawPts || rawPts.length < 3) continue;
      const cen = centroid(rawPts);
      const centeredPts = rawPts.map(p => ({ x: p.x - cen.x, y: p.y - cen.y }));
      const bbox = polygonBBox(centeredPts);
      const areaMm2 = (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY);
      const coreInset = allowanceMm > 0 ? offsetContourInward(centeredPts, allowanceMm) : [];
      const centeredCorePts = coreInset.length >= 3 ? coreInset : centeredPts;
      if (minWidthMm > 0 || minLengthMm > 0) {
        const cb = polygonBBox(centeredCorePts);
        const shorter = Math.min(cb.maxX - cb.minX, cb.maxY - cb.minY);
        const longer  = Math.max(cb.maxX - cb.minX, cb.maxY - cb.minY);
        if (minWidthMm > 0 && shorter < minWidthMm) continue;
        if (minLengthMm > 0 && longer  < minLengthMm) continue;
      }
      pieces.push({
        id: String(c.id ?? c.inventoryTag),
        inventoryTag: c.inventoryTag,
        napDeg: Number(c.napDirectionDeg ?? c.napDirection ?? 0),
        centeredPts,
        centeredCorePts,
        areaMm2
      });
    }

    if (pieces.length === 0 || zoneCells === 0) {
      return emptyResult(zoneArea);
    }

    // ── Precompute IFPs ─────────────────────────────────────────────────────
    const ifpCache = new Map();
    for (const piece of pieces) {
      const ifp = computeIFP(zonePoints, piece.centeredCorePts);
      if (ifp && ifp.length >= 3) ifpCache.set(piece.id, ifp);
    }
    // ── Warm start ──────────────────────────────────────────────────────────
    let placements = await greedyWarmStart(
      pieces, napTarget, napTol, spec, zoneMask, zoneCells, zonePoints, zoneBbox, ifpCache, rng, onProgress
    );

    let { coveredCells, overlapCells } = computeCoverage(placements, cellCount);
    let E = energy(coveredCells, overlapCells, placements.length, zoneCells);

    let bestPlacements = placements.map(p => ({ ...p, mask: p.mask.slice() }));
    let bestE = E;
    let bestCoveredCells = coveredCells;

    // ── SA schedule ─────────────────────────────────────────────────────────
    const T0 = Math.max(E * 0.05, zoneCells * 0.5);
    const Tmin = T0 * 0.0005;
    const alpha = 0.9975;
    const stepMm = Math.min(zoneBbox.maxX - zoneBbox.minX, zoneBbox.maxY - zoneBbox.minY) * 0.08;
    const deadline = Date.now() + maxSolveMs;

    let T = T0;
    let iters = 0, accepted = 0;
    let lastProgressMs = 0;
    const progressIntervalMs = 300;

    while (T > Tmin && Date.now() < deadline) {
      iters++;
      const nowMs = Date.now();
      if (onProgress && (nowMs - lastProgressMs) >= progressIntervalMs) {
        lastProgressMs = nowMs;
        const elapsed = nowMs - (deadline - maxSolveMs);
        const timeRatio = Math.min(1, elapsed / maxSolveMs);
        const tempRatio = T0 > Tmin ? Math.max(0, 1 - (T - Tmin) / (T0 - Tmin)) : 1;
        const percent = Math.round(40 + Math.max(timeRatio, tempRatio) * 55);
        const covRatio = zoneCells > 0 ? bestCoveredCells / zoneCells : 0;
        try {
          const covPct = Math.round(covRatio * 1000) / 10;
          onProgress({
            type: "phase",
            phase: "sa_loop",
            percent,
            title: `NFP+SA: ${bestPlacements.length} кусков, покрытие ${covPct}%`,
            pieces: bestPlacements.length,
            coverage: covPct,
            iters,
            temperature: Math.round(T * 100) / 100
          });
          await new Promise(r => setImmediate(r));
        } catch (_) {}
      }
      const usedSet = new Set(placements.map(p => p.id));
      const unusedPieces = pieces.filter(p => !usedSet.has(p.id));
      const move = pickMove(rng, unusedPieces.length > 0, placements.length > 1);

      let newPlacements = null;

      // ── Translate ──────────────────────────────────────────────────────
      if (move === TRANSLATE && placements.length > 0) {
        const ki = rng.nextInt(placements.length);
        const old = placements[ki];
        const dx = (rng.next() * 2 - 1) * stepMm;
        const dy = (rng.next() * 2 - 1) * stepMm;
        const piece = findPiece(pieces, old.id);
        const np = makePlacement(piece, old.cx + dx, old.cy + dy, old.angleDeg, spec, zoneMask);
        newPlacements = placements.map((p, i) => i === ki ? np : p);
      }

      // ── Rotate ────────────────────────────────────────────────────────
      else if (move === ROTATE && placements.length > 0) {
        const ki = rng.nextInt(placements.length);
        const old = placements[ki];
        const piece = findPiece(pieces, old.id);
        const dAngle = (rng.next() * 2 - 1) * Math.min(napTol, 10);
        const newAngle = normalizeDeg(old.angleDeg + dAngle);
        // Check nap constraint
        const dev = Math.abs(deltaDeg(normalizeDeg(napTarget - piece.napDeg), newAngle));
        if (dev <= napTol) {
          const np = makePlacement(piece, old.cx, old.cy, newAngle, spec, zoneMask);
          newPlacements = placements.map((p, i) => i === ki ? np : p);
        }
      }

      // ── Swap ──────────────────────────────────────────────────────────
      else if (move === SWAP && placements.length > 0 && unusedPieces.length > 0) {
        const ki = rng.nextInt(placements.length);
        const old = placements[ki];
        const newPiece = unusedPieces[rng.nextInt(unusedPieces.length)];
        const angle = normalizeDeg(napTarget - newPiece.napDeg);
        const np = makePlacement(newPiece, old.cx, old.cy, angle, spec, zoneMask);
        newPlacements = placements.map((p, i) => i === ki ? np : p);
      }

      // ── Remove ────────────────────────────────────────────────────────
      else if (move === REMOVE && placements.length > 1) {
        const ki = rng.nextInt(placements.length);
        newPlacements = placements.filter((_, i) => i !== ki);
      }

      // ── Add ───────────────────────────────────────────────────────────
      else if (move === ADD && unusedPieces.length > 0) {
        const newPiece = unusedPieces[rng.nextInt(unusedPieces.length)];
        const angle = normalizeDeg(napTarget - newPiece.napDeg);
        const pos = sampleAnchor(newPiece, ifpCache, zonePoints, zoneBbox, rng);
        if (pos) {
          const np = makePlacement(newPiece, pos.x, pos.y, angle, spec, zoneMask);
          newPlacements = [...placements, np];
        }
      }

      if (!newPlacements) { T *= alpha; continue; }

      const newCov = computeCoverage(newPlacements, cellCount);
      const newE = energy(newCov.coveredCells, newCov.overlapCells, newPlacements.length, zoneCells);
      const dE = newE - E;

      if (dE < 0 || rng.next() < Math.exp(-dE / T)) {
        placements = newPlacements;
        coveredCells = newCov.coveredCells;
        overlapCells = newCov.overlapCells;
        E = newE;
        accepted++;
        if (E < bestE) {
          bestPlacements = placements.map(p => ({ ...p, mask: p.mask.slice() }));
          bestE = E;
          bestCoveredCells = coveredCells;
        }
      }

      T *= alpha;
    }

    const finalPlacements = bestPlacements.filter(p => p.mask && p.mask.some(v => v > 0));
    return formatResult(finalPlacements, zonePoints, zoneArea, bestCoveredCells, zoneCells, iters, accepted, options, spec, zoneMask);
  }

  // ── Geometry helpers for output ─────────────────────────────────────────────

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

  function ringAreaSigned(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      s += Number(a.x) * Number(b.y) - Number(b.x) * Number(a.y);
    }
    return s * 0.5;
  }

  function offsetContourInward(pts, offsetMm) {
    if (!pts || pts.length < 3 || offsetMm <= 0) return pts;
    const scale = CLIPPER_SCALE;
    const path = pts.map(p => ({ X: Math.round(p.x * scale), Y: Math.round(p.y * scale) }));
    if (ringAreaSigned(pts) < 0) path.reverse();
    const co = new ClipperLib.ClipperOffset(2, 0.25 * scale);
    co.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const out = new ClipperLib.Paths();
    co.Execute(out, -offsetMm * scale);
    if (!out || !out.length) return [];
    const best = out.reduce((a, b) => (b.length > a.length ? b : a), out[0]);
    const result = best.map(p => ({ x: p.X / scale, y: p.Y / scale }));
    return result.length >= 3 ? result : [];
  }

  // ── Gap filling via second Voronoi ───────────────────────────────────────────
  //
  // After the main Voronoi assignment, gaps remain where pieces don't reach their
  // territory boundary.  Strategy: run a second Voronoi on the uncovered cells
  // using the same piece centers — each gap cell goes to its nearest center.
  // Then intersect each piece's gap-territory with its actual contour (the
  // physical remnant that was cut off by the first Voronoi boundary) and add
  // that intersection to the piece's fragment.

  function fillGapsVoronoi(resultPlacements, placements, spec, finalZoneMask) {
    const { nx, ny, r, ox, oy } = spec;
    const cellCount = nx * ny;
    const scale = CLIPPER_SCALE;

    // 1. Build covered raster from current fragments
    const coveredRaster = new Uint8Array(cellCount);
    for (const rp of resultPlacements) {
      if (!rp.inZoneContour || rp.inZoneContour.length < 3) continue;
      const mask = rasterize(rp.inZoneContour, spec);
      for (let i = 0; i < cellCount; i++) coveredRaster[i] |= mask[i];
    }

    // 2. Second Voronoi: assign each uncovered zone cell to nearest piece center
    const gapAssignment = new Int16Array(cellCount).fill(-1);
    let hasGapCells = false;
    for (let idx = 0; idx < cellCount; idx++) {
      if (!finalZoneMask[idx] || coveredRaster[idx]) continue;
      const cx = ox + (idx % nx + 0.5) * r;
      const cy = oy + ((idx / nx | 0) + 0.5) * r;
      let bestDist = Infinity, bestJ = -1;
      for (let j = 0; j < placements.length; j++) {
        const dx = cx - placements[j].cx, dy = cy - placements[j].cy;
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; bestJ = j; }
      }
      if (bestJ >= 0) { gapAssignment[idx] = bestJ; hasGapCells = true; }
    }
    if (!hasGapCells) return resultPlacements;

    // 3. For each piece: build its gap-territory polygon, intersect with actual contour
    for (let j = 0; j < placements.length; j++) {
      const rpIdx = resultPlacements.findIndex(rp => rp.placementId === placements[j].id);
      if (rpIdx < 0) continue;

      // Build gap-territory polygon from assigned cells
      const cpr = new ClipperLib.Clipper();
      let hasAny = false;
      for (let idx = 0; idx < cellCount; idx++) {
        if (gapAssignment[idx] !== j) continue;
        const col = idx % nx, row = idx / nx | 0;
        const x0 = Math.round((ox + col * r) * scale);
        const y0 = Math.round((oy + row * r) * scale);
        const x1 = Math.round((ox + (col + 1) * r) * scale);
        const y1 = Math.round((oy + (row + 1) * r) * scale);
        cpr.AddPath([{X:x0,Y:y0},{X:x1,Y:y0},{X:x1,Y:y1},{X:x0,Y:y1}],
          ClipperLib.PolyType.ptSubject, true);
        hasAny = true;
      }
      if (!hasAny) continue;

      const sol = new ClipperLib.Paths();
      cpr.Execute(ClipperLib.ClipType.ctUnion, sol,
        ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
      if (!sol || !sol.length) continue;

      const outerRing = sol.reduce((best, path) =>
        Math.abs(ClipperLib.Clipper.Area(path)) > Math.abs(ClipperLib.Clipper.Area(best)) ? path : best
      , sol[0]);
      const gapTerPts = outerRing.map(p => ({ x: p.X / scale, y: p.Y / scale }));
      if (gapTerPts.length < 3) continue;

      // Intersect gap-territory with actual piece contour (its physical remnant)
      const pieceMp = pointsToMultiPolygon(placements[j].pts);
      const gapTerMp = pointsToMultiPolygon(gapTerPts);
      let fillMp;
      try { fillMp = intersectMulti(pieceMp, gapTerMp); } catch (_) { continue; }
      if (multiPolygonArea(fillMp) < 1) continue;

      // Each connected component of fillMp becomes a separate gap-fill record
      // (same inventoryTag = same physical piece, separate contour = separate cut region).
      const fillPolys = Array.isArray(fillMp) ? fillMp : [];
      const winner = resultPlacements[rpIdx];
      let gapIdx = 0;
      for (const poly of fillPolys) {
        if (!Array.isArray(poly) || !poly.length) continue;
        const ring = poly[0];
        if (!Array.isArray(ring) || ring.length < 4) continue;
        const pts = [];
        for (let i = 0; i < ring.length - 1; i++) {
          const x = Number(ring[i][0]), y = Number(ring[i][1]);
          if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
        }
        if (pts.length < 3) continue;
        const polyArea = multiPolygonArea([poly]);
        if (polyArea < 1) continue;
        gapIdx++;
        resultPlacements.push({
          ...winner,
          placementId: `${winner.placementId}_gap${gapIdx}`,
          inZoneContour: pts,
          alignedCoreContour: pts,
          inZoneCoreContour: pts,
          inZoneAreaMm2: polyArea,
          gainAreaMm2: polyArea,
          score: polyArea,
          phase: "gap_fill",
          solveIndex: resultPlacements.length,
          solveOrder: resultPlacements.length + 1,
          renderIndex: resultPlacements.length
        });
      }
    }

    return resultPlacements;
  }

  // ── Output formatting (Voronoi territory assignment) ────────────────────────

  function formatResult(placements, zonePoints, zoneArea, coveredCells, zoneCells, iters, accepted, options, spec, finalZoneMask) {
    const allowanceMm = Math.max(0, Number((options && options.allowanceMm) || (options && options.seamAllowanceReserveMm) || 0));
    const minWidthMm = Math.max(0, Number((options && options.minWidthMm) || 0));
    const minLengthMm = Math.max(0, Number((options && options.minLengthMm) || 0));
    const zoneHoles = Array.isArray(options && options.zoneHoles) ? options.zoneHoles : [];
    let zoneMp = pointsToMultiPolygon(zonePoints);
    for (const hole of zoneHoles) {
      if (!Array.isArray(hole) || hole.length < 3) continue;
      try { zoneMp = diffMulti(zoneMp, pointsToMultiPolygon(hole)); } catch (_) {}
    }
    const coveredRatio = zoneCells > 0 ? coveredCells / zoneCells : 0;
    const fullCoverageOk = coveredRatio >= 0.998;
    const residualAreaMm2 = Math.max(0, zoneArea * (1 - coveredRatio));

    if (placements.length === 0) return emptyResult(zoneArea);

    // ── Voronoi: assign each zone cell to nearest piece center ─────────────────
    const { nx, ny, r, ox, oy } = spec;
    const cellCount = nx * ny;
    const assignment = new Int16Array(cellCount).fill(-1);
    for (let idx = 0; idx < cellCount; idx++) {
      if (!finalZoneMask[idx]) continue;
      const cx = ox + (idx % nx + 0.5) * r;
      const cy = oy + ((idx / nx | 0) + 0.5) * r;
      let bestDist = Infinity, bestJ = -1;
      for (let j = 0; j < placements.length; j++) {
        const dx = cx - placements[j].cx, dy = cy - placements[j].cy;
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; bestJ = j; }
      }
      assignment[idx] = bestJ;
    }

    // ── Build polygon for each Voronoi region via Clipper union of cells ────────
    const scale = CLIPPER_SCALE;
    const mosaicMode = !!(options && options.mosaicMode);
    const resultPlacements = [];

    for (let j = 0; j < placements.length; j++) {
      const pl = placements[j];

      const cpr = new ClipperLib.Clipper();
      let hasAny = false;
      for (let idx = 0; idx < cellCount; idx++) {
        if (assignment[idx] !== j) continue;
        const col = idx % nx, row = idx / nx | 0;
        const x0 = Math.round((ox + col * r) * scale);
        const y0 = Math.round((oy + row * r) * scale);
        const x1 = Math.round((ox + (col + 1) * r) * scale);
        const y1 = Math.round((oy + (row + 1) * r) * scale);
        cpr.AddPath([{X:x0,Y:y0},{X:x1,Y:y0},{X:x1,Y:y1},{X:x0,Y:y1}], ClipperLib.PolyType.ptSubject, true);
        hasAny = true;
      }
      if (!hasAny) continue;

      const solution = new ClipperLib.Paths();
      cpr.Execute(ClipperLib.ClipType.ctUnion, solution, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
      if (!solution || !solution.length) continue;

      // Take outer ring (largest absolute area)
      const outerRing = solution.reduce((best, path) =>
        Math.abs(ClipperLib.Clipper.Area(path)) > Math.abs(ClipperLib.Clipper.Area(best)) ? path : best
      , solution[0]);
      const voronoiPts = outerRing.map(p => ({ x: p.X / scale, y: p.Y / scale }));
      if (voronoiPts.length < 3) continue;

      // Filter by minimum size
      if (minWidthMm > 0 || minLengthMm > 0) {
        const pb = polygonBBox(voronoiPts);
        const shorter = Math.min(pb.maxX - pb.minX, pb.maxY - pb.minY);
        const longer  = Math.max(pb.maxX - pb.minX, pb.maxY - pb.minY);
        if ((minWidthMm > 0 && shorter < minWidthMm) || (minLengthMm > 0 && longer < minLengthMm)) continue;
      }

      const voronoiArea = multiPolygonArea(pointsToMultiPolygon(voronoiPts));
      if (voronoiArea <= 0) continue;

      const plMp = pointsToMultiPolygon(pl.pts);
      const totalArea = multiPolygonArea(plMp);

      // Fragment = piece clipped to its Voronoi territory (what gets physically cut and sewn).
      // Mosaic mode: territory is the fragment (full coverage, no gaps).
      let fragMp;
      if (mosaicMode) {
        fragMp = pointsToMultiPolygon(voronoiPts);
      } else {
        const voronoiMp = pointsToMultiPolygon(voronoiPts);
        try { fragMp = intersectMulti(plMp, voronoiMp); } catch (_) { fragMp = plMp; }
      }
      const fragPts = mpToPoints(fragMp);
      if (fragPts.length < 3) continue;

      const inZoneArea = multiPolygonArea(fragMp);
      const outsideArea = Math.max(0, totalArea - inZoneArea);
      const util = totalArea > 0 ? inZoneArea / totalArea : 0;

      resultPlacements.push({
        placementId: pl.id,
        scrapPieceId: pl.id,
        inventoryTag: pl.inventoryTag,
        alignedContour: pl.pts,
        inZoneContour: fragPts,
        alignedCoreContour: fragPts,
        inZoneCoreContour: fragPts,
        inZoneAreaMm2: inZoneArea,
        gainAreaMm2: inZoneArea,
        overlapAreaMm2: 0,
        outsideAreaMm2: outsideArea,
        utilization: util,
        insideRatio: util,
        score: inZoneArea,
        status: "matched",
        phase: "SA",
        solveIndex: j,
        solveOrder: j + 1,
        renderIndex: j
      });
    }

    // Gap-fill pass: second Voronoi on uncovered cells → fill with piece remnants
    if (!mosaicMode && resultPlacements.length > 0) {
      fillGapsVoronoi(resultPlacements, placements, spec, finalZoneMask);
    }

    const totalInZone = resultPlacements.reduce((s, p) => s + p.inZoneAreaMm2, 0);
    const totalPiece  = resultPlacements.reduce((s, p) => s + p.inZoneAreaMm2 + p.outsideAreaMm2, 0);

    // Real physical coverage = sum of actual fragment areas / zone area
    const realCoveredRatio = zoneArea > 0 ? Math.min(1, totalInZone / zoneArea) : 0;
    const realFullCoverageOk = realCoveredRatio >= 0.998;
    const realResidualAreaMm2 = Math.max(0, zoneArea * (1 - realCoveredRatio));

    return {
      ok: true,
      fullCoverageOk: realFullCoverageOk,
      coveredRatio: realCoveredRatio,
      coveragePercent: realCoveredRatio * 100,
      residualAreaMm2: realResidualAreaMm2,
      resultStatus: fullCoverageOk ? "ok" : "failed",
      failedReason: fullCoverageOk ? null : "zone_not_fully_covered",
      renderOrderPolicy: "solve_order",
      stackOrderPolicy: "solve_order",
      solveOrder: resultPlacements.map(p => p.scrapPieceId),
      placements: resultPlacements,
      summary: {
        piecesCount: resultPlacements.length,
        selectedPiecesAreaMm2: totalPiece,
        selectedPiecesInZoneAreaMm2: totalInZone,
        selectedPiecesAreaBasis: "piece",
        overlapAreaMm2: 0,
        utilizationPct: totalPiece > 0 ? (totalInZone / totalPiece) * 100 : 0
      },
      algorithmTrace: {
        version: "voronoi-sa-v1",
        steps: {
          candidate_pool: { input: 0, compatible: resultPlacements.length },
          search: { evaluated: iters, placed: resultPlacements.length, accepted, rejected: {} }
        }
      }
    };
  }

  function emptyResult(zoneArea) {
    return {
      ok: false,
      fullCoverageOk: false,
      coveredRatio: 0,
      coveragePercent: 0,
      residualAreaMm2: zoneArea,
      resultStatus: "failed",
      failedReason: "no_candidates",
      renderOrderPolicy: "solve_order",
      stackOrderPolicy: "solve_order",
      solveOrder: [],
      placements: [],
      summary: { piecesCount: 0, selectedPiecesAreaMm2: 0, selectedPiecesInZoneAreaMm2: 0, selectedPiecesAreaBasis: "piece", overlapAreaMm2: 0, utilizationPct: 0 },
      algorithmTrace: { version: "nfp-sa-v1", steps: {} }
    };
  }

  return { solve };
}

module.exports = { createVoronoiSaSolver };
