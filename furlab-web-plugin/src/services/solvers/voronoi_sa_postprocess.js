"use strict";

const ClipperLib = require("clipper-lib");

function minBoundingRectShorter(pts) {
  if (!pts || pts.length < 3) return Infinity;
  const n = pts.length;
  let minShorter = Infinity;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len, uy = dy / len;
    const vx = -uy, vy = ux;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of pts) {
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

function runInitialPostprocess(args) {
  const resultPlacements = args.resultPlacements;
  const placements = args.placements;
  const warnings = Array.isArray(args.warnings) ? args.warnings : [];
  const disablePostprocess = !!args.disablePostprocess;
  const trace = [];
  const startCount = resultPlacements.length;

  // gap_fill disabled: produces only duplicates and slivers (0.004% coverage gain, zero real gaps closed).
  // Real gap closure must come from SA running to completion, not from post-hoc patching.
  const afterGapFillCount = resultPlacements.length;

  mergeGapFillFragments({
    resultPlacements,
    placements,
    warnings,
    disablePostprocess,
    scale: args.scale,
    sealFragment: args.sealFragment,
    coreFragmentForTerritory: args.coreFragmentForTerritory
  });
  const afterGapMergeCount = resultPlacements.length;

  let rasterAbsorbedPasses = 0;
  let rasterAbsorbedTotal = 0;
  if (!disablePostprocess && resultPlacements.length > 0) {
    for (let pass = 0; pass < 5; pass++) {
      const absorbed = args.absorbResidualCells(
        resultPlacements,
        placements,
        args.spec,
        args.finalZoneMask,
        args.absorptionCriterion
      );
      if (!absorbed) break;
      rasterAbsorbedPasses++;
      rasterAbsorbedTotal += absorbed;
    }
  }
  const afterRasterAbsorbCount = resultPlacements.length;

  const placementsBeforeDissolve = resultPlacements.length;
  const dissolveResult = (!disablePostprocess && resultPlacements.length > 0 && (args.minWidthMm > 0 || args.minLengthMm > 0))
    ? args.dissolveSmallFragments(
      resultPlacements,
      placements,
      args.spec,
      args.finalZoneMask,
      args.minWidthMm,
      args.minLengthMm
    )
    : { dissolved: 0, underThreshold: 0, belowThreshold: 0 };

  for (const rp of resultPlacements) {
    if (rp.phase === "under_threshold" || rp.phase === "dissolved") rp.status = "under_threshold";
  }

  trace.push(
    { name: "initial", fragmentsBefore: startCount },
    {
      name: "gap_fill",
      fragmentsBefore: startCount,
      fragmentsAfterFill: afterGapFillCount,
      fragmentsAfterMerge: afterGapMergeCount,
      added: Math.max(0, afterGapFillCount - startCount),
      merged: Math.max(0, afterGapFillCount - afterGapMergeCount)
    },
    {
      name: "raster_absorb",
      passes: rasterAbsorbedPasses,
      absorbedGroups: rasterAbsorbedTotal,
      fragmentsBefore: afterGapMergeCount,
      fragmentsAfter: afterRasterAbsorbCount
    },
    {
      name: "dissolve",
      fragmentsBefore: placementsBeforeDissolve,
      fragmentsAfter: resultPlacements.length,
      dissolved: dissolveResult.dissolved || 0,
      underThreshold: dissolveResult.underThreshold || 0,
      belowThreshold: dissolveResult.belowThreshold || 0
    }
  );

  return {
    placementsBeforeDissolve,
    dissolveResult,
    dissolvedCount: dissolveResult.dissolved,
    dissolvedPlacements: dissolveResult.dissolvedPlacements || [],
    gapFillFragments: resultPlacements.filter((p) => p.phase === "gap_fill").length,
    trace
  };
}

function runPolygonResidualAbsorption(args) {
  const resultPlacements = args.resultPlacements;
  const placements = args.placements;
  const warnings = Array.isArray(args.warnings) ? args.warnings : [];
  const spec = args.spec;
  const { nx, ny, r, ox, oy } = spec;
  let coveredRatio = args.coveredRatio;
  let residualAreaMm2 = args.residualAreaMm2;
  let residualPerimeterMm2 = args.residualPerimeterMm2;
  let residualInteriorMm2 = args.residualInteriorMm2;
  let uncoveredComponents = Array.isArray(args.uncoveredComponents) ? args.uncoveredComponents : [];
  let dissolvedTotal = args.dissolvedTotal;
  const trace = [];
  const minWidthMm = args.minWidthMm || 0;
  // Build set of already-placed scrap IDs — absorption must not use an already-placed scrap for a new slot.
  // Extending an existing fragment (mergeResidual) is fine; creating a new entry for a used ID is not.
  const usedPieceIds = new Set(resultPlacements.map((rp) => rp.scrapPieceId).filter(Boolean));

  // Polygon residual absorption disabled — produces duplicates/slivers; SA must cover gaps itself.
  for (let pass = 0; false && !args.disablePostprocess && pass < 5; pass++) {
    const toAbsorb = uncoveredComponents.filter(
      (c) => !c.isPerimeterSliver && c.pts && c.pts.length >= 3 && c.areaMm2 >= 9
    );
    if (toAbsorb.length === 0) break;

    const beforeResidual = residualInteriorMm2;
    const beforeCount = resultPlacements.length;
    const sc = args.scale;
    const toC = (pts) => pts.map((p) => ({ X: Math.round(p.x * sc), Y: Math.round(p.y * sc) }));
    let absorbed = 0;

    for (const comp of toAbsorb) {
      const { x: ccx, y: ccy } = comp.centroid;
      const ccol = Math.floor((ccx - ox) / r);
      const crow = Math.floor((ccy - oy) / r);
      const cCellIdx = (crow >= 0 && ccol >= 0 && crow < ny && ccol < nx) ? crow * nx + ccol : -1;
      let bestIdx = -1;
      let bestDist2 = Infinity;
      let bestPlJ = -1;

      if (cCellIdx >= 0) {
        for (let plJ = 0; plJ < placements.length; plJ++) {
          const dm = placements[plJ].denseMask;
          if (!dm || !dm[cCellIdx]) continue;
          const dx = ccx - placements[plJ].cx;
          const dy = ccy - placements[plJ].cy;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDist2) {
            bestDist2 = d2;
            bestPlJ = plJ;
          }
        }
        if (bestPlJ >= 0) {
          bestIdx = resultPlacements.findIndex((rp) => rp.scrapPieceId === placements[bestPlJ].id);
          if (bestIdx < 0) {
            // Only use a free (unused) scrap — never create a new entry for an already-placed scrap.
            if (usedPieceIds.has(placements[bestPlJ].id)) {
              warnings.push(`absorbed_skip_already_used:${placements[bestPlJ].id}`);
            } else {
              const created = createAbsorbedPlacementFromPiece({
                comp,
                placements,
                placementIndex: bestPlJ,
                resultPlacements,
                absorbed,
                minWidthMm,
                sealFragment: args.sealFragment,
                coreFragmentForTerritory: args.coreFragmentForTerritory,
                pointsToMultiPolygon: args.pointsToMultiPolygon,
                multiPolygonArea: args.multiPolygonArea
              });
              if (created) {
                usedPieceIds.add(placements[bestPlJ].id);
                warnings.push(`absorbed_created_from_internal:${placements[bestPlJ].id}`);
                absorbed++;
                continue;
              }
            }
          }
        }
      }

      if (bestIdx < 0) {
        bestDist2 = Infinity;
        for (let i = 0; i < resultPlacements.length; i++) {
          const rp = resultPlacements[i];
          const dx = ccx - (rp.x || 0);
          const dy = ccy - (rp.y || 0);
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDist2) {
            bestDist2 = d2;
            bestIdx = i;
          }
        }
      }

      if (bestIdx < 0) continue;
      const rp = resultPlacements[bestIdx];
      if (!rp.inZoneContour || rp.inZoneContour.length < 3) continue;
      const merged = mergeResidualComponentIntoPlacement({
        rp,
        comp,
        placements,
        resultPlacements,
        absorbed,
        warnings,
        scale: sc,
        toC,
        sealFragment: args.sealFragment,
        coreFragmentForTerritory: args.coreFragmentForTerritory,
        pointsToMultiPolygon: args.pointsToMultiPolygon,
        multiPolygonArea: args.multiPolygonArea
      });
      if (merged) absorbed++;
    }

    if (absorbed <= 0) break;
    const coverage = args.computeResidualCoverage(
      resultPlacements,
      args.zonePoints,
      args.zoneArea,
      spec.r,
      args.dissolvedPlacements
    );
    coveredRatio = coverage.coveredRatio;
    residualAreaMm2 = coverage.residualAreaMm2;
    residualPerimeterMm2 = coverage.residualPerimeterMm2;
    residualInteriorMm2 = coverage.residualInteriorMm2;
    uncoveredComponents = coverage.uncoveredComponents;
    dissolvedTotal = coverage.dissolvedTotal;
    trace.push({
      name: "polygon_residual_absorb",
      pass: pass + 1,
      candidates: toAbsorb.length,
      absorbed,
      fragmentsBefore: beforeCount,
      fragmentsAfter: resultPlacements.length,
      residualInteriorBeforeMm2: beforeResidual,
      residualInteriorAfterMm2: residualInteriorMm2
    });
  }

  return {
    coveredRatio,
    residualAreaMm2,
    residualPerimeterMm2,
    residualInteriorMm2,
    uncoveredComponents,
    dissolvedTotal,
    trace
  };
}

function createAbsorbedPlacementFromPiece(args) {
  const pl = args.placements[args.placementIndex];
  const compPts = args.sealFragment(args.comp.pts, args.placementIndex, args.placements);
  const compArea = compPts && compPts.length >= 3
    ? args.multiPolygonArea(args.pointsToMultiPolygon(compPts))
    : 0;
  if (compArea < 1) return false;
  // Reject slivers: use MBR shorter side, not bbox (bbox overestimates width for rotated fragments).
  if (args.minWidthMm > 0 && compPts && compPts.length >= 3) {
    if (minBoundingRectShorter(compPts) <= args.minWidthMm) return false;
  }
  const pieceArea = pl.pts && pl.pts.length >= 3
    ? args.multiPolygonArea(args.pointsToMultiPolygon(pl.pts))
    : compArea;
  args.resultPlacements.push({
    placementId: `${pl.id}_abs${args.absorbed + 1}`,
    scrapPieceId: pl.id,
    inventoryTag: pl.inventoryTag,
    x: pl.cx,
    y: pl.cy,
    angleDeg: pl.angleDeg,
    alignedContour: pl.pts,
    inZoneContour: compPts,
    alignedCoreContour: pl.corePts,
    inZoneCoreContour: args.coreFragmentForTerritory(compPts, args.placementIndex, args.placements),
    inZoneAreaMm2: compArea,
    gainAreaMm2: compArea,
    overlapAreaMm2: 0,
    outsideAreaMm2: Math.max(0, pieceArea - compArea),
    bodyAreaMm2: Math.round(pieceArea),
    utilization: pieceArea > 0 ? compArea / pieceArea : 0,
    insideRatio: pieceArea > 0 ? compArea / pieceArea : 0,
    lowUtilization: pieceArea > 0 ? compArea / pieceArea < 0.30 : false,
    score: compArea,
    status: "matched",
    phase: "absorbed",
    fragmentType: "absorbed_component",
    physicalMissingMm2: 0,
    isTerritoryPlaceholder: false,
    isGapFill: true,
    solveIndex: args.resultPlacements.length,
    solveOrder: args.resultPlacements.length + 1,
    renderIndex: args.resultPlacements.length
  });
  return true;
}

function mergeResidualComponentIntoPlacement(args) {
  try {
    const cpr = new ClipperLib.Clipper();
    cpr.AddPath(args.toC(args.rp.inZoneContour), ClipperLib.PolyType.ptSubject, true);
    cpr.AddPath(args.toC(args.comp.pts), ClipperLib.PolyType.ptClip, true);
    const sol = new ClipperLib.Paths();
    cpr.Execute(
      ClipperLib.ClipType.ctUnion,
      sol,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero
    );
    if (sol && sol.length === 1) {
      const outer = sol.reduce((best, path) =>
        Math.abs(ClipperLib.Clipper.Area(path)) > Math.abs(ClipperLib.Clipper.Area(best))
          ? path
          : best
      , sol[0]);
      const rawPts = outer.map((p) => ({ x: p.X / args.scale, y: p.Y / args.scale }));
      const plIdx = args.placements.findIndex((pl) => pl.id === args.rp.scrapPieceId);
      const newPts = plIdx >= 0 ? args.sealFragment(rawPts, plIdx, args.placements) : rawPts;
      args.rp.inZoneContour = newPts;
      const pl = plIdx >= 0 ? args.placements[plIdx] : null;
      args.rp.alignedCoreContour = (pl && pl.corePts) || newPts;
      args.rp.inZoneCoreContour = args.coreFragmentForTerritory(newPts, plIdx, args.placements);
      args.rp.inZoneAreaMm2 = args.multiPolygonArea(args.pointsToMultiPolygon(newPts));
      args.rp.score = args.rp.inZoneAreaMm2;
      return true;
    }
    if (sol && sol.length > 1) {
      // Disconnected union would require a duplicate scrapPieceId — one physical scrap can't be in two places.
      // Leave this residual component as a gap rather than creating a phantom duplicate.
      args.warnings.push(`absorbed_skip_disconnected:${args.rp.scrapPieceId}:components=${sol.length}`);
      return false;
    }
  } catch (_) {}
  return false;
}

function mergeGapFillFragments(args) {
  const resultPlacements = args.resultPlacements;
  const placements = args.placements;
  const warnings = args.warnings;
  const scale = args.scale;
  if (args.disablePostprocess) return;

  for (let i = resultPlacements.length - 1; i >= 0; i--) {
    const rp = resultPlacements[i];
    if (rp.phase !== "gap_fill") continue;
    const parentIdx = resultPlacements.findIndex(
      (p) => p.scrapPieceId === rp.scrapPieceId && p.phase !== "gap_fill"
    );
    if (parentIdx < 0) continue;
    const parent = resultPlacements[parentIdx];

    if (
      parent.inZoneContour && parent.inZoneContour.length >= 3 &&
      rp.inZoneContour && rp.inZoneContour.length >= 3
    ) {
      try {
        const cpr = new ClipperLib.Clipper();
        const toC = (pts) => pts.map((p) => ({ X: Math.round(p.x * scale), Y: Math.round(p.y * scale) }));
        cpr.AddPath(toC(parent.inZoneContour), ClipperLib.PolyType.ptSubject, true);
        cpr.AddPath(toC(rp.inZoneContour), ClipperLib.PolyType.ptSubject, true);
        const sol = new ClipperLib.Paths();
        cpr.Execute(
          ClipperLib.ClipType.ctUnion,
          sol,
          ClipperLib.PolyFillType.pftNonZero,
          ClipperLib.PolyFillType.pftNonZero
        );
        if (sol && sol.length === 1) {
          const outerRing = sol.reduce((best, path) =>
            Math.abs(ClipperLib.Clipper.Area(path)) > Math.abs(ClipperLib.Clipper.Area(best)) ? path : best
          , sol[0]);
          const mergedRaw = outerRing.map((p) => ({ x: p.X / scale, y: p.Y / scale }));
          const plIdx = placements.findIndex((pl) => pl.id === parent.scrapPieceId);
          const mergedClipped = plIdx >= 0 ? args.sealFragment(mergedRaw, plIdx, placements) : mergedRaw;
          parent.inZoneContour = mergedClipped;
          const pl = plIdx >= 0 ? placements[plIdx] : null;
          parent.alignedCoreContour = (pl && pl.corePts) || mergedClipped;
          parent.inZoneCoreContour = args.coreFragmentForTerritory(parent.inZoneContour, plIdx, placements);
        } else if (sol && sol.length > 1) {
          rp.isGapFill = true;
          warnings.push(`gap_fill_kept_disconnected:${rp.scrapPieceId}:components=${sol.length}`);
          continue;
        }
      } catch (_) {}
    }
    parent.inZoneAreaMm2 += rp.inZoneAreaMm2;
    parent.score = parent.inZoneAreaMm2;
    resultPlacements.splice(i, 1);
  }
}

function createVoronoiSaFragmentPostprocess(deps) {
  const CLIPPER_SCALE = deps.CLIPPER_SCALE || 1000;
  const rasterize = deps.rasterize;
  const buildCellToFrag = deps.buildCellToFrag;
  const rebuildFragPoly = deps.rebuildFragPoly;
  const polygonBBox = deps.polygonBBox;
  const pointsToMultiPolygon = deps.pointsToMultiPolygon;
  const intersectMulti = deps.intersectMulti;
  const multiPolygonArea = deps.multiPolygonArea;
  const sealFragment = deps.sealFragment;
  const coreFragmentForTerritory = deps.coreFragmentForTerritory;

  // ── Gap filling: physical coverage first, then nearest-center fallback ───────
  //
  // For each uncovered zone cell:
  //   1. If any piece's raster mask physically covers it → assign to that piece
  //   2. Otherwise → assign to nearest piece center (Voronoi fallback)
  // Then intersect each piece's gap-territory with its actual contour.

  function fillGapsVoronoi(resultPlacements, placements, spec, finalZoneMask, usedPieceIds, minWidthMm) {
    const scale = CLIPPER_SCALE;
    const { nx, ny, r, ox, oy } = spec;
    const cellCount = nx * ny;

    // 1. Build covered raster from current fragments (skip territory placeholders — they don't represent physical coverage)
    const coveredRaster = new Uint8Array(cellCount);
    for (const rp of resultPlacements) {
      if (!rp.inZoneContour || rp.inZoneContour.length < 3) continue;
      if (rp.isTerritoryPlaceholder) continue; // placeholder = piece doesn't reach territory → treat as gap
      const mask = rasterize(rp.inZoneContour, spec);
      for (let i = 0; i < cellCount; i++) coveredRaster[i] |= (mask[i] & 1); // bit0: conservative coverage
    }

    // 2. Assign each uncovered zone cell: physical mask first, nearest center fallback
    const gapAssignment = new Int16Array(cellCount).fill(-1);
    let hasGapCells = false;
    for (let idx = 0; idx < cellCount; idx++) {
      if (!finalZoneMask[idx] || coveredRaster[idx]) continue;
      let bestJ = -1;

      // Physical coverage check (bit1 eligibility): piece reaches this cell by any corner
      for (let j = 0; j < placements.length; j++) {
        if (placements[j].mask && (placements[j].mask[idx] & 2)) { bestJ = j; break; }
      }

      // Fallback: nearest piece center (Voronoi)
      if (bestJ < 0) {
        const cx = ox + (idx % nx + 0.5) * r;
        const cy = oy + ((idx / nx | 0) + 0.5) * r;
        let bestDist = Infinity;
        for (let j = 0; j < placements.length; j++) {
          const dx = cx - placements[j].cx, dy = cy - placements[j].cy;
          const d = dx * dx + dy * dy;
          if (d < bestDist) { bestDist = d; bestJ = j; }
        }
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
        // Reject if scrap already placed (can't physically be in two locations)
        if (usedPieceIds && usedPieceIds.has(winner.scrapPieceId)) continue;
        // Reject slivers via MBR shorter side
        if (minWidthMm > 0 && minBoundingRectShorter(pts) <= minWidthMm) continue;
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

  // ── Post-processing passes ───────────────────────────────────────────────────

  // Absorb residual zone cells (not covered by any fragment) into existing fragments
  // using eligibility (bit1). Extends the nearest eligible fragment's polygon.
  function absorbResidualCells(resultPlacements, placements, spec, finalZoneMask, absorptionCriterion) {
    if (absorptionCriterion == null) absorptionCriterion = 4;
    const { nx, ny, r, ox, oy } = spec;
    const cellCount = nx * ny;

    // Build covered raster (bit0) from physical fragment contours (skip territory placeholders)
    const covered = new Uint8Array(cellCount);
    for (const rp of resultPlacements) {
      if (!rp.inZoneContour || rp.inZoneContour.length < 3) continue;
      if (rp.isTerritoryPlaceholder) continue; // placeholder = piece doesn't physically cover territory
      const m = rasterize(rp.inZoneContour, spec);
      for (let i = 0; i < cellCount; i++) covered[i] |= (m[i] & 1);
    }

    // Find residual zone cells
    const residualByFrag = new Map(); // fragIndex → [cellIdx, ...]
    for (let idx = 0; idx < cellCount; idx++) {
      if (!finalZoneMask[idx] || covered[idx]) continue;
      // Find eligible piece by full contour (bit0 of fullMask) — includes seam allowance reach
      let bestJ = -1, bestDist = Infinity;
      const cx = ox + (idx % nx + 0.5) * r;
      const cy = oy + ((idx / nx | 0) + 0.5) * r;
      for (let j = 0; j < placements.length; j++) {
        const fm = placements[j].fullMask;
        if (!fm || !(fm[idx] & absorptionCriterion)) continue;
        const dx = cx - placements[j].cx, dy = cy - placements[j].cy;
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; bestJ = j; }
      }
      if (bestJ < 0) continue;
      // Map piece j → its fragment index
      const fi = resultPlacements.findIndex(rp => rp.scrapPieceId === placements[bestJ].id ||
        (rp.inventoryTag === placements[bestJ].inventoryTag && rp.phase !== "gap_fill"));
      if (fi < 0) continue;
      if (!residualByFrag.has(fi)) residualByFrag.set(fi, []);
      residualByFrag.get(fi).push(idx);
    }
    if (residualByFrag.size === 0) return 0;

    // Extend each affected fragment's polygon
    // Build reverse lookup: scrapPieceId → placements index (for sealFragment)
    const pieceIdToPlIdx = new Map();
    for (let i = 0; i < placements.length; i++) pieceIdToPlIdx.set(placements[i].id, i);

    const cellToFrag = buildCellToFrag(resultPlacements, spec, finalZoneMask);
    for (const [fi, newCells] of residualByFrag) {
      // Collect current cells of this fragment
      const existingCells = [];
      for (let i = 0; i < cellCount; i++) if (cellToFrag[i] === fi) existingCells.push(i);
      const allCells = existingCells.concat(newCells);
      const rawPts = rebuildFragPoly(allCells, spec);
      if (!rawPts) continue;
      const rp = resultPlacements[fi];
      // Stage-8 fix: clip territory to piece boundary (inZoneContour ⊆ piece)
      const plIdx = pieceIdToPlIdx.get(rp.scrapPieceId);
      const newPts = plIdx != null ? sealFragment(rawPts, plIdx, placements) : rawPts;
      const newArea = multiPolygonArea(pointsToMultiPolygon(newPts));
      if (newArea < 1) continue;
      rp.inZoneContour = newPts;
      // core = piece's own core pts (real inset of piece body), not territory polygon
      const plAbs = plIdx != null ? placements[plIdx] : null;
      rp.alignedCoreContour = (plAbs && plAbs.corePts) || newPts;
      rp.inZoneCoreContour = coreFragmentForTerritory(newPts, plIdx, placements);
      rp.inZoneAreaMm2 = newArea;
      rp.gainAreaMm2 = newArea;
      rp.score = newArea;
    }
    return residualByFrag.size;
  }

  // Dissolve small fragments (bbox below minWidthMm × minLengthMm) into neighbors.
  // Reassigns cells only to pieces with eligibility (mask & 2).
  // Returns count of dissolved fragments.
  function dissolveSmallFragments(resultPlacements, placements, spec, finalZoneMask, minWidthMm, minLengthMm) {
    if (!minWidthMm && !minLengthMm) return 0;

    function failsThreshold(pts) {
      if (!pts || pts.length < 3) return true;
      const bb = polygonBBox(pts);
      const w = bb.maxX - bb.minX, h = bb.maxY - bb.minY;
      return Math.min(w, h) < minWidthMm || Math.max(w, h) < minLengthMm;
    }

    const { nx, ny, r, ox, oy } = spec;
    const cellCount = nx * ny;
    let totalDissolved = 0;
    let totalUnderThreshold = 0;
    let totalBelowThreshold = 0;
    const dissolvedPlacements = [];

    for (let pass = 0; pass < 10; pass++) {
      // Sort by area ascending to dissolve smallest first
      const candidates = resultPlacements
        .map((rp, fi) => ({ fi, rp }))
        .filter(({ rp }) => rp.phase !== "gap_fill" && rp.phase !== "under_threshold" && rp.phase !== "dissolved" && failsThreshold(rp.inZoneContour))
        .sort((a, b) => (a.rp.inZoneAreaMm2 || 0) - (b.rp.inZoneAreaMm2 || 0));

      if (pass === 0) totalBelowThreshold = candidates.length;
      if (candidates.length === 0) break;

      let changed = false;
      const cellToFrag = buildCellToFrag(resultPlacements, spec, finalZoneMask);
      const grewFrags = new Set(); // track which fragments absorbed cells this pass

      for (const { fi, rp } of candidates) {
        // Get cells of this fragment
        const myCells = [];
        for (let i = 0; i < cellCount; i++) if (cellToFrag[i] === fi) myCells.push(i);
        if (myCells.length === 0) { rp.phase = "under_threshold"; totalUnderThreshold++; continue; }

        // For each cell, find eligible receiver (piece with mask & 2, different piece than ours)
        const cellReceiver = new Map(); // cellIdx → receiver fragIndex
        let allAssigned = true;
        for (const idx of myCells) {
          let bestFi = -1, bestDist = Infinity;
          const cx = ox + (idx % nx + 0.5) * r;
          const cy = oy + ((idx / nx | 0) + 0.5) * r;
          for (let j = 0; j < placements.length; j++) {
            if (placements[j].id === rp.scrapPieceId) continue;
            if (!placements[j].mask || !(placements[j].mask[idx] & 2)) continue;
            // Find this piece's fragment
            const targetFi = resultPlacements.findIndex((r2, i2) =>
              i2 !== fi && r2.scrapPieceId === placements[j].id);
            if (targetFi < 0) continue;
            const dx = cx - placements[j].cx, dy = cy - placements[j].cy;
            const d = dx * dx + dy * dy;
            if (d < bestDist) { bestDist = d; bestFi = targetFi; }
          }
          if (bestFi >= 0) {
            cellReceiver.set(idx, bestFi);
          } else {
            allAssigned = false;
          }
        }

        if (!allAssigned) {
          rp.phase = "under_threshold";
          totalUnderThreshold++;
          continue;
        }

        // Redistribute cells: update cellToFrag and collect cells per receiver
        const receiverCells = new Map(); // receiverFi → new cells
        for (const [idx, receiverFi] of cellReceiver) {
          cellToFrag[idx] = receiverFi;
          if (!receiverCells.has(receiverFi)) receiverCells.set(receiverFi, []);
          receiverCells.get(receiverFi).push(idx);
        }

        // Rebuild polygons for receivers
        // Build reverse lookup for sealFragment
        const pieceIdToPlIdxD = new Map();
        for (let _i = 0; _i < placements.length; _i++) pieceIdToPlIdxD.set(placements[_i].id, _i);

        for (const [receiverFi, addedCells] of receiverCells) {
          const existingCells = [];
          for (let i = 0; i < cellCount; i++) if (cellToFrag[i] === receiverFi) existingCells.push(i);
          const allCells = existingCells.concat(addedCells);
          const rawPts = rebuildFragPoly(allCells, spec);
          if (!rawPts) continue;
          const recv = resultPlacements[receiverFi];
          // Stage-8 fix: clip territory to piece boundary
          const plIdxD = pieceIdToPlIdxD.get(recv.scrapPieceId);
          const newPts = plIdxD != null ? sealFragment(rawPts, plIdxD, placements) : rawPts;
          const newArea = multiPolygonArea(pointsToMultiPolygon(newPts));
          recv.inZoneContour = newPts;
          // core = piece's own core pts (real inset), not territory
          const plD = plIdxD != null ? placements[plIdxD] : null;
          recv.alignedCoreContour = (plD && plD.corePts) || newPts;
          recv.inZoneCoreContour = coreFragmentForTerritory(newPts, plIdxD, placements);
          recv.inZoneAreaMm2 = newArea;
          recv.gainAreaMm2 = newArea;
          recv.score = newArea;
          grewFrags.add(receiverFi);
        }

        // Save a snapshot before clearing (for overlap analysis)
        dissolvedPlacements.push({
          scrapPieceId: rp.scrapPieceId, inventoryTag: rp.inventoryTag,
          inZoneContour: rp.inZoneContour.slice(), inZoneAreaMm2: rp.inZoneAreaMm2
        });
        // Mark dissolved fragment
        rp.inZoneContour = [];
        rp.inZoneAreaMm2 = 0;
        rp.phase = "dissolved";
        cellToFrag.fill(-1, 0, 0); // not needed, rebuilt next pass
        changed = true;
        totalDissolved++;
      }

      if (!changed) break;

      // Recheck only fragments that grew (remove from resultPlacements if now dissolved)
      // dissolved fragments are marked with phase="dissolved", keep them in array for now
    }

    // Remove dissolved fragments from resultPlacements in-place
    let wi = 0;
    for (let ri = 0; ri < resultPlacements.length; ri++) {
      if (resultPlacements[ri].phase !== "dissolved") {
        resultPlacements[wi++] = resultPlacements[ri];
      }
    }
    resultPlacements.length = wi;

    return { dissolved: totalDissolved, underThreshold: totalUnderThreshold, belowThreshold: totalBelowThreshold, dissolvedPlacements };
  }


  return { fillGapsVoronoi, absorbResidualCells, dissolveSmallFragments };
}
function collectDuplicatePieceWarnings(resultPlacements) {
  const warnings = [];
  const pieceIdCount = new Map();
  for (const rp of resultPlacements) {
    pieceIdCount.set(rp.scrapPieceId, (pieceIdCount.get(rp.scrapPieceId) || 0) + 1);
  }
  for (const [pid, cnt] of pieceIdCount) {
    if (cnt > 1) warnings.push(`duplicate_scrapPieceId:${pid}:count=${cnt}`);
  }
  return warnings;
}

module.exports = {
  createVoronoiSaFragmentPostprocess,
  runInitialPostprocess,
  runPolygonResidualAbsorption,
  collectDuplicatePieceWarnings
};
