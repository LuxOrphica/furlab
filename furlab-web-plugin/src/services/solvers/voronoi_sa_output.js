"use strict";

const ClipperLib = require("clipper-lib");

// Convex hull (Andrew's monotone chain). Returns hull vertices in CCW order.
function convexHull(pts) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const sorted = pts.slice().sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

// Minimum width of a polygon = shorter side of its minimum-area bounding rectangle.
// Applies rotating calipers on the convex hull (exact, matches Shapely minimum_rotated_rectangle).
// Returns Infinity for degenerate input.
function minBoundingRectShorter(pts) {
  if (!pts || pts.length < 3) return Infinity;
  const hull = convexHull(pts);
  const n = hull.length;
  if (n < 2) return Infinity;
  let minShorter = Infinity;
  for (let i = 0; i < n; i++) {
    const p1 = hull[i];
    const p2 = hull[(i + 1) % n];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len, uy = dy / len;
    const vx = -uy, vy = ux;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy;
      const v = p.x * vx + p.y * vy;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const shorter = Math.min(maxU - minU, maxV - minV);
    if (shorter < minShorter) minShorter = shorter;
  }
  return minShorter;
}

function buildTerritoryOutput(args) {
  const placements = args.placements;
  const spec = args.spec;
  const { nx, ny, r, ox, oy } = spec;
  const cellCount = nx * ny;
  const scale = args.scale;
  const _t0 = Date.now();
  let assignment;
  if (args.precomputedAssignment) {
    assignment = args.precomputedAssignment;
    console.log(`[VSA] buildAssignment: precomputed (skipped)`);
  } else {
    assignment = buildAssignment({
      placements,
      spec,
      finalZoneMask: args.finalZoneMask,
      isMosaic: args.isMosaic,
      phaseBStats: args.phaseBStats,
      computePowerAssign: args.computePowerAssign
    });
    console.log(`[VSA] buildAssignment: ${Date.now() - _t0}ms`);
  }

  // ─── CPT PH-0: Core Coverage Pre-computation ──────────────────────────────
  // cov[k][idx] = area(intersect(core_k_poly, cell_rect_idx)) in mm².
  // Stored as covByCell[idx] = [{k, areaMm2}, ...].
  // Only computed for zone cells within each core's bbox.
  const _tCPT0 = Date.now();
  const finalZoneMask = args.finalZoneMask;
  const covByCell = new Array(cellCount); // sparse: undefined = uncovered

  for (let k = 0; k < placements.length; k++) {
    const pl = placements[k];
    if (!pl.corePts || pl.corePts.length < 3) continue;

    // bbox of core_k in mm
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const p of pl.corePts) {
      if (p.x < bx0) bx0 = p.x; if (p.x > bx1) bx1 = p.x;
      if (p.y < by0) by0 = p.y; if (p.y > by1) by1 = p.y;
    }

    // Core path in Clipper units
    const corePath = pl.corePts.map(p => ({ X: Math.round(p.x * scale), Y: Math.round(p.y * scale) }));

    // Cell range overlapping bbox
    const colMin = Math.max(0, Math.floor((bx0 - ox) / r));
    const colMax = Math.min(nx - 1, Math.ceil((bx1 - ox) / r));
    const rowMin = Math.max(0, Math.floor((by0 - oy) / r));
    const rowMax = Math.min(ny - 1, Math.ceil((by1 - oy) / r));

    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        const idx = row * nx + col;
        if (!finalZoneMask[idx]) continue;

        const cx0 = Math.round((ox + col * r) * scale);
        const cy0 = Math.round((oy + row * r) * scale);
        const cx1 = Math.round((ox + (col + 1) * r) * scale);
        const cy1 = Math.round((oy + (row + 1) * r) * scale);
        const cellPath = [{ X: cx0, Y: cy0 }, { X: cx1, Y: cy0 }, { X: cx1, Y: cy1 }, { X: cx0, Y: cy1 }];

        const cpr0 = new ClipperLib.Clipper();
        cpr0.AddPath(corePath, ClipperLib.PolyType.ptSubject, true);
        cpr0.AddPath(cellPath, ClipperLib.PolyType.ptClip, true);
        const sol0 = new ClipperLib.Paths();
        cpr0.Execute(ClipperLib.ClipType.ctIntersection, sol0,
          ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

        let areaMm2 = 0;
        if (sol0 && sol0.length > 0) {
          for (const path of sol0) areaMm2 += Math.abs(ClipperLib.Clipper.Area(path)) / (scale * scale);
        }
        if (areaMm2 < 0.01) continue; // sub-pixel, skip

        if (!covByCell[idx]) covByCell[idx] = [];
        covByCell[idx].push({ k, areaMm2 });
      }
    }
  }
  console.log(`[CPT-PH0] precompute: ${Date.now() - _tCPT0}ms`);

  // ─── CPT PH-1a: Safe Assignment Correction (exclusive + unowned only) ───
  // Reassigns cells where the current Voronoi owner has ZERO core coverage.
  // Safe because the owner's fragment for this cell is already zero — losing
  // it cannot reduce owner's fragment or thin the owner.
  // Contested cells (owner IS among candidates) are left for PH-1b, which
  // runs AFTER PH-3 Expand in the Voronoi-state (fat donors) — this order
  // allows Expand to work and prevents cascade-thin.
  const _tCPT1 = Date.now();
  let cpt1Exclusive = 0, cpt1Unowned = 0;

  for (let idx = 0; idx < cellCount; idx++) {
    if (!finalZoneMask[idx]) continue;
    const cands = covByCell[idx];
    if (!cands || cands.length === 0) continue; // no core coverage — keep Voronoi

    const currentJ = assignment[idx];
    if (currentJ >= 0 && cands.some(c => c.k === currentJ)) continue; // owner has coverage — keep

    // Owner has zero coverage → safe to reassign to argmax.
    // Sort: areaMm2 desc, tie-break: tag asc, k asc (deterministic)
    cands.sort((a, b) => {
      const da = b.areaMm2 - a.areaMm2;
      if (Math.abs(da) > 0.001) return da;
      const ta = placements[a.k].inventoryTag || '', tb = placements[b.k].inventoryTag || '';
      return ta < tb ? -1 : ta > tb ? 1 : a.k - b.k;
    });
    assignment[idx] = cands[0].k;
    if (cands.length === 1) cpt1Exclusive++;
    else cpt1Unowned++;
  }
  console.log(`[CPT-PH1a] exclusive=${cpt1Exclusive} unowned=${cpt1Unowned} time=${Date.now() - _tCPT1}ms`);

  const _t1 = Date.now();
  const topologyRepair = repairDisconnectedAssignment({
    assignment,
    placements,
    spec,
    cellCount,
    territoryMode: args.isMosaic ? "mosaic" : "restricted_voronoi"
  });

  console.log(`[VSA] repairDisconnected: ${Date.now() - _t1}ms`);
  const _t2 = Date.now();
  const resultPlacements = [];
  const survivorByJ = new Uint8Array(placements.length);
  const thinFromPass1 = new Set(); // survivors deferred from Pass 1 minWidth drop

  for (let j = 0; j < placements.length; j++) {
    const pl = placements[j];
    const cpr = new ClipperLib.Clipper();
    let hasAny = false;

    for (let idx = 0; idx < cellCount; idx++) {
      if (assignment[idx] !== j) continue;
      const col = idx % nx;
      const row = idx / nx | 0;
      const x0 = Math.round((ox + col * r) * scale);
      const y0 = Math.round((oy + row * r) * scale);
      const x1 = Math.round((ox + (col + 1) * r) * scale);
      const y1 = Math.round((oy + (row + 1) * r) * scale);
      cpr.AddPath([{ X: x0, Y: y0 }, { X: x1, Y: y0 }, { X: x1, Y: y1 }, { X: x0, Y: y1 }], ClipperLib.PolyType.ptSubject, true);
      hasAny = true;
    }
    if (!hasAny) continue;

    const solution = new ClipperLib.Paths();
    cpr.Execute(ClipperLib.ClipType.ctUnion, solution, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    if (!solution || !solution.length) continue;

    // Lloyd-mode diagnostic: log per-tile solution
    if (args.precomputedAssignment) {
      const _sAreas = solution.map(p => Math.round(Math.abs(ClipperLib.Clipper.Area(p)) / (scale * scale)));
      let _cellsJ = 0; for (let _i = 0; _i < cellCount; _i++) if (assignment[_i] === j) _cellsJ++;
      console.log(`[LT-BTO] j=${j} cells=${_cellsJ} solution.paths=${solution.length} areas=[${_sAreas.join(',')}]`);
    }

    const outerRing = solution.reduce((best, path) =>
      Math.abs(ClipperLib.Clipper.Area(path)) > Math.abs(ClipperLib.Clipper.Area(best)) ? path : best
    , solution[0]);
    const cellPts = outerRing.map((p) => ({ x: p.X / scale, y: p.Y / scale }));
    if (cellPts.length < 3) continue;

    const cellMp = args.pointsToMultiPolygon(cellPts);
    if (args.multiPolygonArea(cellMp) <= 0) continue;

    // Fragment = core ∩ territory ∩ zone (contract R1).
    // physMissingMm2 = territory area - fragment area (where territory exists but core doesn't reach).
    let fragMp;
    let territoryAreaForPhysMissing = 0;
    if (args.precomputedAssignment) {
      const territoryMp = args.lloydZoneMp
        ? args.intersectMulti(cellMp, args.lloydZoneMp)
        : cellMp;
      territoryAreaForPhysMissing = args.multiPolygonArea(territoryMp);
      const coreMp = args.pointsToMultiPolygon(pl.corePts);
      fragMp = args.intersectMulti(coreMp, territoryMp);
    } else {
      const coreMp = args.pointsToMultiPolygon(pl.corePts);
      fragMp = args.intersectMulti(coreMp, cellMp);
    }
    if (args.multiPolygonArea(fragMp) < 1) continue;

    const fragPhase = args.isMosaic ? "lloyd" : "SA";
    const inZoneArea = args.multiPolygonArea(fragMp);

    const inZoneContour = args.mpToPoints(fragMp);
    if (inZoneContour.length < 3) { console.log(`[VSA-SKIP] j=${j} reason=contour<3 aF=${inZoneArea.toFixed(0)}`); continue; }

    // Pass 1 minWidth check: NOTE only — defer drop to Pass 2.5 repair.
    // Pass 3 safety net will drop if unrepairable.
    if (args.minWidthMm > 0) {
      const shorter = minBoundingRectShorter(inZoneContour);
      if (shorter <= args.minWidthMm) {
        console.log(`[VSA-THIN] j=${j}(${placements[j].inventoryTag}) mbr=${shorter.toFixed(1)} deferred to repair`);
        thinFromPass1.add(j); // track for Pass 3 rebuild
        // intentionally NOT dropped here
      }
    }
    if (args.minLengthMm > 0) {
      const pb = args.polygonBBox(inZoneContour);
      const longer = Math.max(pb.maxX - pb.minX, pb.maxY - pb.minY);
      if (longer <= args.minLengthMm) { console.log(`[VSA-SKIP] j=${j} reason=minLength longer=${longer.toFixed(1)} aF=${inZoneArea.toFixed(0)}`); continue; }
    }

    resultPlacements.push({
      placementId: pl.id,
      scrapPieceId: pl.id,
      inventoryTag: pl.inventoryTag,
      x: pl.cx,
      y: pl.cy,
      angleDeg: pl.angleDeg,
      alignedContour: pl.pts,
      alignedCoreContour: pl.corePts,
      rawTerritoryContour: cellPts,
      inZoneContour,
      inZoneCoreContour: inZoneContour,
      inZoneAreaMm2: inZoneArea,
      gainAreaMm2: inZoneArea,
      overlapAreaMm2: 0,
      outsideAreaMm2: 0,
      physMissingMm2: Math.max(0, Math.round(territoryAreaForPhysMissing - inZoneArea)),
      bodyAreaMm2: Math.round(inZoneArea),
      utilization: 1,
      insideRatio: 1,
      lowUtilization: false,
      score: inZoneArea,
      status: "matched",
      phase: fragPhase,
      fragmentType: "cell",
      solveIndex: j,
      solveOrder: j + 1,
      renderIndex: j
    });
    survivorByJ[j] = 1;
  }

  // ─── A1: Drop Redundant Survivors (excl=0) ──────────────────────────────
  // A survivor whose every cell is also covered by at least one other piece
  // (excl=0) is redundant: dropping it loses no coverage. Runs after Pass 1
  // (survivorByJ known) and before Pass 2 BFS (freed cells eligible for neighbours).
  {
    const _tA1 = Date.now();
    let a1Dropped = 0;
    for (let k = 0; k < placements.length; k++) {
      if (!survivorByJ[k]) continue;
      let exclCount = 0;
      for (let idx = 0; idx < cellCount; idx++) {
        if (assignment[idx] !== k) continue;
        const cands = covByCell[idx];
        if (cands && cands.length === 1 && cands[0].k === k) { exclCount++; break; } // found one — enough
      }
      if (exclCount > 0) continue;
      survivorByJ[k] = 0;
      for (let i = resultPlacements.length - 1; i >= 0; i--) {
        if (resultPlacements[i].solveIndex === k) { resultPlacements.splice(i, 1); break; }
      }
      a1Dropped++;
      console.log(`[CPT-A1-DROP] k=${k}(${placements[k].inventoryTag}) redundant (excl=0)`);
    }
    console.log(`[CPT-A1] dropped_redundant=${a1Dropped} time=${Date.now() - _tA1}ms`);
  }

  // Pass 2: BFS redistribution — expand survivor territories into adjacent filtered cells.
  // Adjacency constraint guarantees each survivor's territory stays connected → frag stays 1 polygon.
  // Cells unreachable via BFS (no adjacent survivor with core coverage) → -1 (physMissing orphan).
  const _t3 = Date.now();
  const affectedSurvivors = new Set();
  {
    const processed = new Uint8Array(cellCount);
    const candidateOwner = new Int16Array(cellCount).fill(-1);
    // Thin survivors (thinFromPass1) are NOT seeds — their cells stay eligible for fat-survivor capture,
    // restoring the pre-CPT behaviour where fat survivors absorbed thin-piece territory via BFS.
    for (let idx = 0; idx < cellCount; idx++) {
      if (assignment[idx] >= 0 && survivorByJ[assignment[idx]] && !thinFromPass1.has(assignment[idx])) processed[idx] = 1;
    }
    const bfsQ = [];
    // Seed queue: for each fat-survivor cell, enqueue its unprocessed filtered neighbors
    for (let idx = 0; idx < cellCount; idx++) {
      if (!processed[idx]) continue;
      const k = assignment[idx];
      const col = idx % nx, row = idx / nx | 0;
      const nbrs = [];
      if (col > 0) nbrs.push(idx - 1);
      if (col < nx - 1) nbrs.push(idx + 1);
      if (row > 0) nbrs.push(idx - nx);
      if (row < ny - 1) nbrs.push(idx + nx);
      for (const ni of nbrs) {
        if (processed[ni] || candidateOwner[ni] >= 0) continue;
        const nj = assignment[ni];
        if (nj < 0 || (survivorByJ[nj] && !thinFromPass1.has(nj))) continue; // unassigned or fat-survivor — skip
        if (!placements[k].mask || !(placements[k].mask[ni] & 1)) continue;
        candidateOwner[ni] = k;
        bfsQ.push(ni);
      }
    }
    let qi = 0;
    while (qi < bfsQ.length) {
      const idx = bfsQ[qi++];
      if (processed[idx]) continue;
      const k = candidateOwner[idx];
      if (k < 0) continue;
      processed[idx] = 1;
      assignment[idx] = k;
      affectedSurvivors.add(k);
      const col = idx % nx, row = idx / nx | 0;
      const nbrs = [];
      if (col > 0) nbrs.push(idx - 1);
      if (col < nx - 1) nbrs.push(idx + 1);
      if (row > 0) nbrs.push(idx - nx);
      if (row < ny - 1) nbrs.push(idx + nx);
      for (const ni of nbrs) {
        if (processed[ni] || candidateOwner[ni] >= 0) continue;
        const nj = assignment[ni];
        if (nj < 0 || (survivorByJ[nj] && !thinFromPass1.has(nj))) continue;
        if (!placements[k].mask || !(placements[k].mask[ni] & 1)) continue;
        candidateOwner[ni] = k;
        bfsQ.push(ni);
      }
    }
    // Cells still unprocessed and filtered → orphan
    for (let idx = 0; idx < cellCount; idx++) {
      if (!processed[idx] && assignment[idx] >= 0 && !survivorByJ[assignment[idx]]) {
        assignment[idx] = -1;
      }
    }
  }

  // Pass 4: adjacent-only orphan sweep.
  // After BFS, some -1 cells sit at triple-territory junctions where BFS adjacency could not reach
  // them from their covering survivor (blocked by a neighbour's territory). If a survivor cell is
  // adjacent to the orphan AND its core mask covers the orphan → reassign (connected growth,
  // territory stays 1 polygon). Cells reachable only via non-adjacent core overlap remain -1.
  {
    let _p4InZone = 0, _p4Closed = 0, _p4NoCover = 0, _p4NoAdj = 0;
    for (let idx = 0; idx < cellCount; idx++) {
      if (assignment[idx] !== -1) continue; // not an orphan
      if (!args.finalZoneMask || !args.finalZoneMask[idx]) continue; // skip out-of-zone cells
      _p4InZone++;
      const col = idx % nx, row = idx / nx | 0;
      const nbrs = [];
      if (col > 0) nbrs.push(idx - 1);
      if (col < nx - 1) nbrs.push(idx + 1);
      if (row > 0) nbrs.push(idx - nx);
      if (row < ny - 1) nbrs.push(idx + nx);
      let bestK = -1, anyAdj = false;
      for (const ni of nbrs) {
        const nk = assignment[ni];
        if (nk < 0 || !survivorByJ[nk]) continue;
        anyAdj = true;
        if (!placements[nk].mask || !(placements[nk].mask[idx] & 1)) continue;
        bestK = nk;
        break;
      }
      if (bestK >= 0) {
        assignment[idx] = bestK;
        affectedSurvivors.add(bestK);
        _p4Closed++;
      } else if (!anyAdj) { _p4NoAdj++; } else { _p4NoCover++; }
    }
    console.log(`[VSA-P4] inZone=${_p4InZone} closed=${_p4Closed} noAdj=${_p4NoAdj} noCover=${_p4NoCover}`);
  }
  console.log(`[VSA] orphan sweep pass4: affected=${affectedSurvivors.size}`);

  // ─── CPT PH-3: MBR Enforcement (Expand or Absorb, single pass) ──────────
  // After PH-1 full-contested assignment, some pieces may be thin because their
  // best-covered cells were taken by a winner-piece in PH-1 (donor effect).
  // For each thin survivor (tag asc, k asc — deterministic):
  //   Attempt E: steal border cells from adjacent survivors that keep ≥ minWidthMm
  //              and remain connected after the steal. Priority: cells where k's
  //              core has maximum coverage (covByCell).
  //   If Expand fails → Absorb: remove k, redistribute cells in PH-4.
  // ONE pass only. No oscillation: expanded pieces grow, never shrink; absorbed
  // pieces never return. Donor-safety guard prevents cascading thin-ification.
  //
  // Absorb audit (per advisor contract):
  //   exclusive-thin (exclMbr < minWidth): correct absorb — no valid exclusive fragment possible.
  //   contested-thin (exclMbr >= minWidth): BUG — Expand should have succeeded.
  // Helper: compute (territory union → intersect core) fragment for piece k.
  // Returns { ctr: pts[], nPolyOuter: number } or null if empty.
  // Used by PH-3 (expand/absorb check) and PH-1b (exact donor-MBR guard).
  const computeFragInfo = (k) => {
      const pl = placements[k];
      const cpr = new ClipperLib.Clipper();
      let hasAny = false;
      for (let idx = 0; idx < cellCount; idx++) {
        if (assignment[idx] !== k) continue;
        const col = idx % nx, row = idx / nx | 0;
        const x0 = Math.round((ox + col * r) * scale);
        const y0 = Math.round((oy + row * r) * scale);
        const x1 = Math.round((ox + (col + 1) * r) * scale);
        const y1 = Math.round((oy + (row + 1) * r) * scale);
        cpr.AddPath([{ X: x0, Y: y0 }, { X: x1, Y: y0 }, { X: x1, Y: y1 }, { X: x0, Y: y1 }], ClipperLib.PolyType.ptSubject, true);
        hasAny = true;
      }
      if (!hasAny) return null;
      const sol = new ClipperLib.Paths();
      cpr.Execute(ClipperLib.ClipType.ctUnion, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
      if (!sol || !sol.length) return null;
      const nPolyOuter = sol.filter(p => ClipperLib.Clipper.Area(p) > 0).length;
      const ring = sol.reduce((best, p) =>
        ClipperLib.Clipper.Area(p) > ClipperLib.Clipper.Area(best) ? p : best, sol[0]);
      const cellPts = ring.map(p => ({ x: p.X / scale, y: p.Y / scale }));
      if (cellPts.length < 3) return null;
      const cellMp = args.pointsToMultiPolygon(cellPts);
      const coreMp = args.pointsToMultiPolygon(pl.corePts);
      const fragMp = args.intersectMulti(coreMp, cellMp);
      if (args.multiPolygonArea(fragMp) < 1) return null;
      // Mirror Pass 3: if fragMp is multipolygon, take largest component only.
      // mpToPoints on a multipolygon would return all vertices → MBR over-estimated.
      let usedFragMp = fragMp;
      if (Array.isArray(fragMp) && fragMp.length > 1) {
        let bestPoly = fragMp[0], bestA = 0;
        for (const poly of fragMp) {
          const a = args.multiPolygonArea([poly]);
          if (a > bestA) { bestA = a; bestPoly = poly; }
        }
        usedFragMp = [bestPoly];
      }
      const ctr = args.mpToPoints(usedFragMp);
      if (!ctr || ctr.length < 3) return null;
      return { ctr, nPolyOuter };
  };

  const absorbedSet = new Set();
  {
    // Deterministic order: tag asc, k asc.
    const survivorKs = [];
    for (let k = 0; k < placements.length; k++) {
      if (survivorByJ[k]) survivorKs.push(k);
    }
    survivorKs.sort((a, b) => {
      const ta = placements[a].inventoryTag || '', tb = placements[b].inventoryTag || '';
      return ta < tb ? -1 : ta > tb ? 1 : a - b;
    });

    let ph3Expand = 0, ph3Retreat = 0, ph3Absorb = 0;

    for (const k of survivorKs) {
      if (absorbedSet.has(k)) continue;
      const fi = computeFragInfo(k);
      if (!fi) {
        // No territory at all — absorb immediately.
        console.log(`[CPT-ABSORB] k=${k}(${placements[k].inventoryTag}) reason=no-territory`);
        absorbedSet.add(k); survivorByJ[k] = 0; ph3Absorb++;
        continue;
      }
      const shorter = minBoundingRectShorter(fi.ctr);
      if (shorter > args.minWidthMm) continue; // ok — passes minWidth check

      // --- Attempt E: expand by stealing border cells from adjacent survivors ---
      const borderCells = [];
      for (let idx = 0; idx < cellCount; idx++) {
        const j = assignment[idx];
        if (j < 0 || j === k || !survivorByJ[j] || absorbedSet.has(j)) continue;
        const col = idx % nx, row = idx / nx | 0;
        let adjToK = false;
        if (col > 0 && assignment[idx - 1] === k) adjToK = true;
        else if (col < nx - 1 && assignment[idx + 1] === k) adjToK = true;
        else if (row > 0 && assignment[idx - nx] === k) adjToK = true;
        else if (row < ny - 1 && assignment[idx + nx] === k) adjToK = true;
        if (!adjToK) continue;
        // Priority: cells where k's core has maximum coverage (argmax covByCell).
        const kCov = (covByCell[idx] || []).find(c => c.k === k);
        borderCells.push({ idx, donor_j: j, kArea: kCov ? kCov.areaMm2 : 0 });
      }
      // Sort: k-coverage desc (steal cells where k's core is strongest), then tag asc, idx asc.
      borderCells.sort((a, b) => {
        const da = b.kArea - a.kArea;
        if (Math.abs(da) > 0.001) return da;
        const ta = placements[a.donor_j].inventoryTag || '', tb = placements[b.donor_j].inventoryTag || '';
        return ta < tb ? -1 : ta > tb ? 1 : a.idx - b.idx;
      });

      let expanded = false;
      for (const { idx, donor_j } of borderCells) {
        assignment[idx] = k; // tentative steal
        const fj = computeFragInfo(donor_j);
        const donorOk = fj && fj.nPolyOuter === 1 && minBoundingRectShorter(fj.ctr) > args.minWidthMm;
        if (!donorOk) { assignment[idx] = donor_j; continue; } // rollback — donor becomes invalid
        const fk2 = computeFragInfo(k);
        if (fk2 && minBoundingRectShorter(fk2.ctr) > args.minWidthMm) {
          affectedSurvivors.add(k); affectedSurvivors.add(donor_j);
          expanded = true; ph3Expand++;
          break;
        }
        assignment[idx] = donor_j; // rollback — k still thin
      }
      if (expanded) continue;

      // --- Retreat to exclusive: give up contested-won cells, keep exclusive-only territory ---
      // Contested cells currently won by k may form thin protrusions that drag MBR down.
      // If exclusive-only fragment MBR >= minWidth, k is valid without those protrusions.
      // Per advisor condition 4: absorb only if exclusive-only MBR < minWidth.
      {
        const retreatedCells = [];
        for (let idx = 0; idx < cellCount; idx++) {
          if (assignment[idx] !== k) continue;
          const cands = covByCell[idx];
          if (!cands || cands.length <= 1) continue; // exclusive — keep
          // contested cell currently won by k → give to second-best candidate
          const second = cands.find(c => c.k !== k);
          if (second) retreatedCells.push({ idx, secondK: second.k });
        }
        if (retreatedCells.length > 0) {
          for (const { idx, secondK } of retreatedCells) assignment[idx] = secondK;
          const feExcl = computeFragInfo(k);
          const exclMbr = feExcl ? minBoundingRectShorter(feExcl.ctr) : 0;
          if (feExcl && exclMbr > args.minWidthMm) {
            // Exclusive-only territory is sufficient — retreat is valid.
            for (const { idx, secondK } of retreatedCells) affectedSurvivors.add(secondK);
            affectedSurvivors.add(k);
            console.log(`[CPT-RETREAT] k=${k}(${placements[k].inventoryTag}) fullMbr=${shorter.toFixed(1)} exclMbr=${exclMbr.toFixed(1)} retreated=${retreatedCells.length} cells`);
            ph3Retreat++;
            continue; // not absorbed
          }
          // Exclusive not sufficient — restore contested cells and fall through to absorb
          for (const { idx } of retreatedCells) assignment[idx] = k;
        }
      }

      // --- Absorb: Expand and Retreat both failed ---
      // Audit log: distinguish exclusive-thin (correct absorb) from contested-thin (potential bug).
      let exclCellCount = 0;
      for (let idx = 0; idx < cellCount; idx++) {
        if (assignment[idx] !== k) continue;
        const cands = covByCell[idx];
        if (cands && cands.length === 1 && cands[0].k === k) exclCellCount++;
      }
      const absorbReason = exclCellCount === 0 ? 'no-exclusive' :
        shorter < args.minWidthMm * 0.5 ? 'exclusive-very-thin' : 'expand-and-retreat-failed';
      console.log(`[CPT-ABSORB] k=${k}(${placements[k].inventoryTag}) mbr=${shorter.toFixed(1)} exclCells=${exclCellCount} reason=${absorbReason}`);
      absorbedSet.add(k); survivorByJ[k] = 0; ph3Absorb++;
    }

    // Remove absorbed pieces from resultPlacements.
    if (absorbedSet.size > 0) {
      for (let i = resultPlacements.length - 1; i >= 0; i--) {
        if (absorbedSet.has(resultPlacements[i].solveIndex)) resultPlacements.splice(i, 1);
      }
    }
    console.log(`[CPT-PH3] expand=${ph3Expand} retreat=${ph3Retreat} absorb=${ph3Absorb} absorbedSet=${absorbedSet.size}`);
  }

  // ─── CPT PH-4: Absorbed Cells BFS Redistribution ─────────────────────────
  // Absorbed pieces' cells are reassigned to adjacent surviving pieces via BFS.
  // Priority: survivor whose core has highest covByCell area for that cell
  //   (INV-4: cells where a wide neighbour covers → it gets the cell, covF preserved).
  // Cells unreachable by any adjacent survivor → orphan (-1, physMissing).
  if (absorbedSet.size > 0) {
    const processed4 = new Uint8Array(cellCount);
    const candOwner4 = new Int16Array(cellCount).fill(-1);
    const candArea4  = new Float32Array(cellCount);

    for (let idx = 0; idx < cellCount; idx++) {
      if (assignment[idx] >= 0 && survivorByJ[assignment[idx]]) processed4[idx] = 1;
    }
    const bfsQ4 = [];
    for (let idx = 0; idx < cellCount; idx++) {
      if (!processed4[idx]) continue;
      const k = assignment[idx];
      const col = idx % nx, row = idx / nx | 0;
      const nbrs = [];
      if (col > 0) nbrs.push(idx - 1);
      if (col < nx - 1) nbrs.push(idx + 1);
      if (row > 0) nbrs.push(idx - nx);
      if (row < ny - 1) nbrs.push(idx + nx);
      for (const ni of nbrs) {
        if (processed4[ni]) continue;
        const nj = assignment[ni];
        if (nj < 0 || survivorByJ[nj]) continue; // already reassigned or another survivor
        const niCov = (covByCell[ni] || []).find(c => c.k === k);
        const niArea = niCov ? niCov.areaMm2 : 0;
        if (candOwner4[ni] < 0 || niArea > candArea4[ni]) {
          candOwner4[ni] = k;
          candArea4[ni] = niArea;
          bfsQ4.push(ni);
        }
      }
    }
    let qi4 = 0;
    while (qi4 < bfsQ4.length) {
      const idx = bfsQ4[qi4++];
      if (processed4[idx]) continue;
      const k = candOwner4[idx];
      if (k < 0) continue;
      processed4[idx] = 1;
      assignment[idx] = k;
      affectedSurvivors.add(k);
      const col = idx % nx, row = idx / nx | 0;
      const nbrs = [];
      if (col > 0) nbrs.push(idx - 1);
      if (col < nx - 1) nbrs.push(idx + 1);
      if (row > 0) nbrs.push(idx - nx);
      if (row < ny - 1) nbrs.push(idx + nx);
      for (const ni of nbrs) {
        if (processed4[ni]) continue;
        const nj = assignment[ni];
        if (nj < 0 || survivorByJ[nj]) continue;
        const niCov = (covByCell[ni] || []).find(c => c.k === k);
        const niArea = niCov ? niCov.areaMm2 : 0;
        if (candOwner4[ni] < 0 || niArea > candArea4[ni]) {
          candOwner4[ni] = k;
          candArea4[ni] = niArea;
          bfsQ4.push(ni);
        }
      }
    }
    // Unclaimed absorbed cells → orphan.
    for (let idx = 0; idx < cellCount; idx++) {
      if (!processed4[idx] && assignment[idx] >= 0 && absorbedSet.has(assignment[idx])) {
        assignment[idx] = -1;
      }
    }
    console.log(`[CPT-PH4] absorbed BFS redistribution done`);
  }

  // ─── B: Width-Anchored Contested Distribution (BFS from zone boundary) ──
  // Contested cells (≥2 cores cover) are processed boundary-first (zone-edge
  // cells first, then interior). Each cell goes to argmax(covByCell area) winner
  // IF the current Voronoi owner's anchor_MBR ≥ minWidthMm.
  // anchor_MBR = MBR of core_k ∩ union(excl_k cells). Checked ONE-TIME per donor:
  // excl cells are stable (never given away), so the anchor never degrades.
  // No rollback, no cascade-thin.
  {
    const _tB = Date.now();

    // 1. Compute anchor_MBR per survivor (excl cells only).
    const anchorMBR = new Float32Array(placements.length);
    for (let k = 0; k < placements.length; k++) {
      if (!survivorByJ[k] || absorbedSet.has(k)) continue;
      const cpr_a = new ClipperLib.Clipper();
      let hasExcl = false;
      for (let idx = 0; idx < cellCount; idx++) {
        if (assignment[idx] !== k) continue;
        const cands = covByCell[idx];
        if (!cands || cands.length !== 1 || cands[0].k !== k) continue;
        const col = idx % nx, row = idx / nx | 0;
        const x0 = Math.round((ox + col * r) * scale), y0 = Math.round((oy + row * r) * scale);
        const x1 = Math.round((ox + (col+1) * r) * scale), y1 = Math.round((oy + (row+1) * r) * scale);
        cpr_a.AddPath([{X:x0,Y:y0},{X:x1,Y:y0},{X:x1,Y:y1},{X:x0,Y:y1}], ClipperLib.PolyType.ptSubject, true);
        hasExcl = true;
      }
      if (!hasExcl) { anchorMBR[k] = 0; continue; }
      const sol_a = new ClipperLib.Paths();
      cpr_a.Execute(ClipperLib.ClipType.ctUnion, sol_a, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
      if (!sol_a || !sol_a.length) { anchorMBR[k] = 0; continue; }
      const ring_a = sol_a.reduce((b, p) => ClipperLib.Clipper.Area(p) > ClipperLib.Clipper.Area(b) ? p : b, sol_a[0]);
      const cellPts_a = ring_a.map(p => ({x: p.X/scale, y: p.Y/scale}));
      if (cellPts_a.length < 3) { anchorMBR[k] = 0; continue; }
      const fragMp_a = args.intersectMulti(args.pointsToMultiPolygon(cellPts_a), args.pointsToMultiPolygon(placements[k].corePts));
      if (args.multiPolygonArea(fragMp_a) < 1) { anchorMBR[k] = 0; continue; }
      let usedFrag_a = fragMp_a;
      if (Array.isArray(fragMp_a) && fragMp_a.length > 1) {
        let best = fragMp_a[0], bestA = 0;
        for (const p of fragMp_a) { const a = args.multiPolygonArea([p]); if (a > bestA) { bestA = a; best = p; } }
        usedFrag_a = [best];
      }
      const ctr_a = args.mpToPoints(usedFrag_a);
      anchorMBR[k] = (ctr_a && ctr_a.length >= 3) ? minBoundingRectShorter(ctr_a) : 0;
    }

    // 2. Compute boundary_dist per zone cell (BFS from zone edge inward).
    const boundaryDist = new Int16Array(cellCount).fill(32767);
    const bfsEdge = [];
    for (let idx = 0; idx < cellCount; idx++) {
      if (!finalZoneMask[idx]) continue;
      const col = idx % nx, row = idx / nx | 0;
      let isEdge = (col === 0 || col === nx-1 || row === 0 || row === ny-1);
      if (!isEdge) {
        for (const ni of [idx-1, idx+1, idx-nx, idx+nx]) {
          if (!finalZoneMask[ni]) { isEdge = true; break; }
        }
      }
      if (isEdge) { boundaryDist[idx] = 0; bfsEdge.push(idx); }
    }
    for (let qe = 0; qe < bfsEdge.length; qe++) {
      const idx = bfsEdge[qe], d = boundaryDist[idx];
      const col = idx % nx, row = idx / nx | 0;
      for (const ni of [col>0?idx-1:-1, col<nx-1?idx+1:-1, row>0?idx-nx:-1, row<ny-1?idx+nx:-1]) {
        if (ni < 0 || !finalZoneMask[ni]) continue;
        if (boundaryDist[ni] > d + 1) { boundaryDist[ni] = d + 1; bfsEdge.push(ni); }
      }
    }

    // 3. Collect contested cells and sort boundary-first.
    const contestedB = [];
    for (let idx = 0; idx < cellCount; idx++) {
      if (!finalZoneMask[idx]) continue;
      const cands = covByCell[idx];
      if (!cands || cands.length <= 1) continue;
      const currentJ = assignment[idx];
      if (currentJ < 0 || !survivorByJ[currentJ] || absorbedSet.has(currentJ)) continue;
      if (!cands.some(c => c.k === currentJ)) continue; // unowned — PH-1a handled
      let bestK = -1, bestArea = -1;
      for (const c of cands) {
        if (!survivorByJ[c.k] || absorbedSet.has(c.k)) continue;
        if (c.areaMm2 > bestArea) { bestArea = c.areaMm2; bestK = c.k; }
        else if (c.areaMm2 === bestArea && bestK >= 0) {
          const ta = placements[c.k].inventoryTag || '', tb = placements[bestK].inventoryTag || '';
          if (ta < tb || (ta === tb && c.k < bestK)) bestK = c.k;
        }
      }
      if (bestK < 0 || bestK === currentJ) continue;
      const ownerArea = cands.find(c => c.k === currentJ).areaMm2;
      contestedB.push({ idx, ownerJ: currentJ, argmaxK: bestK, margin: bestArea - ownerArea, dist: boundaryDist[idx] });
    }
    contestedB.sort((a, b) => {
      if (a.dist !== b.dist) return a.dist - b.dist;
      if (Math.abs(b.margin - a.margin) > 0.001) return b.margin - a.margin;
      const ta = placements[a.argmaxK].inventoryTag || '', tb = placements[b.argmaxK].inventoryTag || '';
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.idx - b.idx;
    });

    // 4. Assign: give cell to argmax if donor anchor_MBR ≥ minWidthMm.
    let bMoved = 0, bGuarded = 0, bStale = 0;
    for (const { idx, ownerJ, argmaxK } of contestedB) {
      if (assignment[idx] !== ownerJ) { bStale++; continue; }
      if (!survivorByJ[ownerJ] || absorbedSet.has(ownerJ)) { bStale++; continue; }
      if (!survivorByJ[argmaxK] || absorbedSet.has(argmaxK)) { bStale++; continue; }
      if (anchorMBR[ownerJ] >= args.minWidthMm) {
        assignment[idx] = argmaxK;
        affectedSurvivors.add(ownerJ);
        affectedSurvivors.add(argmaxK);
        bMoved++;
      } else {
        bGuarded++;
      }
    }
    console.log(`[CPT-B] contested=${contestedB.length} moved=${bMoved} guarded=${bGuarded} stale=${bStale} time=${Date.now() - _tB}ms`);
  }

  // ─── v5.0 Pass 5: Final R2 Safety-Net ──────────────────────────────────
  // После всех post-processing pass'ов некоторые клетки могут:
  //   (a) остаться assignment=-1 (orphan), даже если их накрывает ядро
  //   (b) быть назначены куску, чьё ядро НЕ накрывает их, но другой кусок накрывает
  // Оба случая — partition-gap (нарушение R2).
  // Pass 5 переназначает такие клетки на кусок, чьё ядро их накрывает.
  {
    const _t5 = Date.now();
    let p5Closed = 0, p5NoCover = 0, p5Reassigned = 0;
    for (let idx = 0; idx < cellCount; idx++) {
      if (!finalZoneMask[idx]) continue;
      const cands = covByCell[idx];
      if (!cands || cands.length === 0) continue;
      const currentJ = assignment[idx];
      const currentCovers = currentJ >= 0 && cands.some(c => c.k === currentJ && survivorByJ[c.k]);
      if (currentCovers) continue;
      let bestCand = null;
      for (const c of cands) {
        if (!survivorByJ[c.k]) continue;
        if (!bestCand || c.areaMm2 > bestCand.areaMm2 ||
            (c.areaMm2 === bestCand.areaMm2 &&
             (placements[c.k].inventoryTag || '') < (placements[bestCand.k].inventoryTag || ''))) {
          bestCand = c;
        }
      }
      if (bestCand) {
        if (currentJ === -1) p5Closed++;
        else p5Reassigned++;
        assignment[idx] = bestCand.k;
        affectedSurvivors.add(bestCand.k);
        if (currentJ >= 0 && survivorByJ[currentJ]) affectedSurvivors.add(currentJ);
      } else {
        p5NoCover++;
      }
    }
    console.log(`[VSA-P5] R2 safety-net: closed=${p5Closed} reassigned=${p5Reassigned} noCover=${p5NoCover} time=${Date.now() - _t5}ms`);
  }

  // Pass 3: rebuild fragment for each affected survivor.
  // Rebuild scope: survivors whose territory changed in Pass 2 BFS, Pass 4 orphan sweep,
  // PH-3 Expand, or PH-4 redistribution. thinFromPass1 is included so safety-net drop
  // can apply if the piece is still thin after PH-3 (should be rare — PH-3 handles it).
  {
    for (const k of thinFromPass1) {
      if (survivorByJ[k] && !absorbedSet.has(k)) affectedSurvivors.add(k);
    }
  }
  if (affectedSurvivors.size > 0) {
    const rpIndexByJ = new Map();
    for (let i = 0; i < resultPlacements.length; i++) rpIndexByJ.set(resultPlacements[i].solveIndex, i);
    const dropIndices = new Set();
    for (const k of affectedSurvivors) {
      const pl = placements[k];
      const cpr2 = new ClipperLib.Clipper();
      for (let idx = 0; idx < cellCount; idx++) {
        if (assignment[idx] !== k) continue;
        const col = idx % nx, row = idx / nx | 0;
        const x0 = Math.round((ox + col * r) * scale);
        const y0 = Math.round((oy + row * r) * scale);
        const x1 = Math.round((ox + (col + 1) * r) * scale);
        const y1 = Math.round((oy + (row + 1) * r) * scale);
        cpr2.AddPath([{ X: x0, Y: y0 }, { X: x1, Y: y0 }, { X: x1, Y: y1 }, { X: x0, Y: y1 }], ClipperLib.PolyType.ptSubject, true);
      }
      const sol2 = new ClipperLib.Paths();
      cpr2.Execute(ClipperLib.ClipType.ctUnion, sol2, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
      if (!sol2 || !sol2.length) continue;
      const ring2 = sol2.reduce((best, path) =>
        Math.abs(ClipperLib.Clipper.Area(path)) > Math.abs(ClipperLib.Clipper.Area(best)) ? path : best, sol2[0]);
      const cellPts2 = ring2.map((p) => ({ x: p.X / scale, y: p.Y / scale }));
      if (cellPts2.length < 3) continue;
      const cellMp2 = args.pointsToMultiPolygon(cellPts2);
      // Fragment = core ∩ territory ∩ zone (contract R1).
      let fragMp2;
      let territoryAreaForPhysMissing2 = 0;
      if (args.precomputedAssignment) {
        const territoryMp2 = args.lloydZoneMp
          ? args.intersectMulti(cellMp2, args.lloydZoneMp)
          : cellMp2;
        territoryAreaForPhysMissing2 = args.multiPolygonArea(territoryMp2);
        const coreMp2 = args.pointsToMultiPolygon(pl.corePts);
        fragMp2 = args.intersectMulti(coreMp2, territoryMp2);
      } else {
        const coreMp2 = args.pointsToMultiPolygon(pl.corePts);
        fragMp2 = args.intersectMulti(coreMp2, cellMp2);
      }
      if (args.multiPolygonArea(fragMp2) < 1) continue;
      // Guard: if intersection produced multiple components, take the largest by area.
      // BFS adjacency in Pass 2 should prevent this, but log if it occurs.
      let usedFragMp = fragMp2;
      if (Array.isArray(fragMp2) && fragMp2.length > 1) {
        let bestPoly = fragMp2[0], bestA = 0;
        for (const poly of fragMp2) {
          const a = args.multiPolygonArea([poly]);
          if (a > bestA) { bestA = a; bestPoly = poly; }
        }
        usedFragMp = [bestPoly];
        console.log(`[VSA-WARN] k=${k} fragMp2.nPolys=${fragMp2.length} taking largest=${bestA.toFixed(0)} of total=${args.multiPolygonArea(fragMp2).toFixed(0)}`);
      }
      const inZoneArea2 = args.multiPolygonArea(usedFragMp);
      if (inZoneArea2 < 1) continue;
      const inZoneContour2 = args.mpToPoints(usedFragMp);
      if (inZoneContour2.length < 3) continue;
      // Safety net: if still thin after all repair passes → NOTE + drop (guarantees Axis3=0).
      if (args.minWidthMm > 0) {
        const shorter2 = minBoundingRectShorter(inZoneContour2);
        if (shorter2 <= args.minWidthMm) {
          console.log(`[VSA-SAFETY-DROP] k=${k}(${placements[k].inventoryTag}) mbr=${shorter2.toFixed(1)} still thin after repair — dropping`);
          const rpIdx0 = rpIndexByJ.get(k);
          if (rpIdx0 != null) dropIndices.add(rpIdx0);
          continue;
        }
      }
      const rpIdx = rpIndexByJ.get(k);
      if (rpIdx == null) continue;
      const rp = resultPlacements[rpIdx];
      rp.rawTerritoryContour = cellPts2;
      rp.inZoneContour = inZoneContour2;
      rp.inZoneCoreContour = inZoneContour2;
      rp.inZoneAreaMm2 = inZoneArea2;
      rp.gainAreaMm2 = inZoneArea2;
      rp.physMissingMm2 = Math.max(0, Math.round(territoryAreaForPhysMissing2 - inZoneArea2));
      rp.bodyAreaMm2 = Math.round(inZoneArea2);
      rp.score = inZoneArea2;
    }
    // Apply safety-net drops (thin survivors unrepairable by Pass 2.5).
    if (dropIndices.size > 0) {
      for (let i = resultPlacements.length - 1; i >= 0; i--) {
        if (dropIndices.has(i)) resultPlacements.splice(i, 1);
      }
      console.log(`[VSA-SAFETY-DROP] total dropped=${dropIndices.size}`);
    }
  }
  console.log(`[VSA] redistribution: ${Date.now() - _t3}ms affectedSurvivors=${affectedSurvivors.size}`);

  console.log(`[VSA] clipper territory loop: ${Date.now() - _t2}ms for ${placements.length} pieces → ${resultPlacements.length} frags`);
  return { assignment, resultPlacements, topologyRepair };
}

function buildAssignment(args) {
  const { placements, spec, finalZoneMask, isMosaic, phaseBStats } = args;
  const { nx, ny, r, ox, oy } = spec;
  const cellCount = nx * ny;
  if (isMosaic && phaseBStats && phaseBStats.finalWeights) {
    return args.computePowerAssign(placements, phaseBStats.finalWeights, spec, finalZoneMask);
  }

  const assignment = new Int16Array(cellCount).fill(-1);
  for (let idx = 0; idx < cellCount; idx++) {
    if (!finalZoneMask[idx]) continue;
    const cx = ox + (idx % nx + 0.5) * r;
    const cy = oy + ((idx / nx | 0) + 0.5) * r;
    let bestDist = Infinity;
    let bestJ = -1;
    for (let j = 0; j < placements.length; j++) {
      if (!placements[j].mask || !(placements[j].mask[idx] & 1)) continue;
      const dx = cx - placements[j].cx;
      const dy = cy - placements[j].cy;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        bestJ = j;
      }
    }
    assignment[idx] = bestJ;
  }
  return assignment;
}

function repairDisconnectedAssignment(args) {
  const { assignment, placements, spec, cellCount } = args;
  const { nx, r, ox, oy } = spec;
  const ny = spec.ny;
  const stats = {
    name: "territory_topology_repair",
    territoryMode: args.territoryMode || "restricted_voronoi",
    piecesChecked: 0,
    piecesRepaired: 0,
    componentsBefore: 0,
    componentsAfter: 0,
    reassignedCells: 0,
    orphanCells: 0
  };
  const cellsPerPiece = new Int32Array(placements.length);
  for (let idx = 0; idx < cellCount; idx++) {
    const j = assignment[idx];
    if (j >= 0) cellsPerPiece[j]++;
  }
  const order = Array.from({ length: placements.length }, (_, i) => i)
    .sort((a, b) => cellsPerPiece[b] - cellsPerPiece[a]);

  for (const j of order) {
    if (cellsPerPiece[j] < 2) continue;
    stats.piecesChecked++;
    const localVisited = new Uint8Array(cellCount);
    const components = [];
    for (let startIdx = 0; startIdx < cellCount; startIdx++) {
      if (assignment[startIdx] !== j || localVisited[startIdx]) continue;
      const comp = [];
      const queue = [startIdx];
      localVisited[startIdx] = 1;
      let qi = 0;
      while (qi < queue.length) {
        const idx = queue[qi++];
        comp.push(idx);
        const col = idx % nx;
        const row = idx / nx | 0;
        const nbrs = [];
        if (col > 0) nbrs.push(idx - 1);
        if (col < nx - 1) nbrs.push(idx + 1);
        if (row > 0) nbrs.push(idx - nx);
        if (row < ny - 1) nbrs.push(idx + nx);
        for (const ni of nbrs) {
          if (assignment[ni] === j && !localVisited[ni]) {
            localVisited[ni] = 1;
            queue.push(ni);
          }
        }
      }
      components.push(comp);
    }
    stats.componentsBefore += components.length;
    if (components.length <= 1) continue;
    stats.piecesRepaired++;
    components.sort((a, b) => b.length - a.length);
    for (let ci = 1; ci < components.length; ci++) {
      for (const idx of components[ci]) {
        const cx = ox + (idx % nx + 0.5) * r;
        const cy = oy + ((idx / nx | 0) + 0.5) * r;
        let bestDist2 = Infinity;
        let bestK = -1;
        for (let k = 0; k < placements.length; k++) {
          if (k === j) continue;
          if (!placements[k].mask || !(placements[k].mask[idx] & 1)) continue;
          const dx = cx - placements[k].cx;
          const dy = cy - placements[k].cy;
          const d = dx * dx + dy * dy;
          if (d < bestDist2) {
            bestDist2 = d;
            bestK = k;
          }
        }
        if (bestK < 0) {
          for (let k = 0; k < placements.length; k++) {
            if (k === j) continue;
            const dx = cx - placements[k].cx;
            const dy = cy - placements[k].cy;
            const d = dx * dx + dy * dy;
            if (d < bestDist2) {
              bestDist2 = d;
              bestK = k;
            }
          }
        }
        if (bestK >= 0) {
          assignment[idx] = bestK;
          stats.reassignedCells++;
        } else {
          assignment[idx] = -1;
          stats.orphanCells++;
        }
      }
    }
  }
  stats.componentsAfter = countAssignedComponents({ assignment, placements, spec, cellCount });
  return stats;
}

function countAssignedComponents(args) {
  const { assignment, placements, spec, cellCount } = args;
  const { nx } = spec;
  const ny = spec.ny;
  let total = 0;
  for (let j = 0; j < placements.length; j++) {
    const visited = new Uint8Array(cellCount);
    for (let startIdx = 0; startIdx < cellCount; startIdx++) {
      if (assignment[startIdx] !== j || visited[startIdx]) continue;
      total++;
      const queue = [startIdx];
      visited[startIdx] = 1;
      let qi = 0;
      while (qi < queue.length) {
        const idx = queue[qi++];
        const col = idx % nx;
        const row = idx / nx | 0;
        const nbrs = [];
        if (col > 0) nbrs.push(idx - 1);
        if (col < nx - 1) nbrs.push(idx + 1);
        if (row > 0) nbrs.push(idx - nx);
        if (row < ny - 1) nbrs.push(idx + nx);
        for (const ni of nbrs) {
          if (assignment[ni] === j && !visited[ni]) {
            visited[ni] = 1;
            queue.push(ni);
          }
        }
      }
    }
  }
  return total;
}

function computeNotContainedPerPiece(args) {
  const notContainedPerPiece = new Int32Array(args.placements.length);
  for (let idx = 0; idx < args.cellCount; idx++) {
    if (!args.finalZoneMask[idx]) continue;
    const j = args.assignment[idx];
    if (j < 0) continue;
    if (!args.placements[j].mask || !(args.placements[j].mask[idx] & 1)) notContainedPerPiece[j]++;
  }
  return notContainedPerPiece;
}

module.exports = { buildTerritoryOutput };
