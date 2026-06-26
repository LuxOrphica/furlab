"use strict";

function applyTargetedCycle(args) {
  const baseResult = args.baseResult;
  const saFinalPlacements = args.saFinalPlacements;
  const zonePoints = args.zonePoints;
  const zoneArea = args.zoneArea;
  const zoneCells = args.zoneCells;
  const pieces = args.pieces;
  const ifpCacheTight = args.ifpCacheTight;
  const ifpCacheWide = args.ifpCacheWide;
  const spec = args.spec;
  const zoneMask = args.zoneMask;
  const cellCount = args.cellCount;
  const napTarget = args.napTarget;
  const napTol = args.napTol;
  const overhangMm = args.overhangMm;
  const isMosaic = args.isMosaic;
  const selectionDebug = args.selectionDebug;
  const phaseATimeMs = args.phaseATimeMs;
  const phaseBStats = args.phaseBStats;
  const warnings = args.warnings;
  const effectiveOptions = args.effectiveOptions;
  const options = args.options;
  const computeCoverage = args.computeCoverage;
  const formatResult = args.formatResult;
  const pointInPolygon = args.pointInPolygon;
  const polygonBBox = args.polygonBBox;
  const normalizeDeg = args.normalizeDeg;
  const deltaDeg = args.deltaDeg;
  const makePlacement = args.makePlacement;

  if (isMosaic) return baseResult;
  if (!saFinalPlacements || saFinalPlacements.length === 0) return baseResult;

  const { iters, accepted } = (() => {
    const at = baseResult.algorithmTrace;
    return {
      iters: (at && at.phaseA && at.phaseA.iterations) || 0,
      accepted: (at && at.phaseA && at.phaseA.accepted) || 0
    };
  })();

  const fmtResult = (pls) => {
    const cov = computeCoverage(pls, cellCount).coveredCells;
    return formatResult(pls, zonePoints, zoneArea, cov, zoneCells,
      iters, accepted, options, spec, zoneMask,
      selectionDebug, isMosaic, phaseATimeMs, phaseBStats, warnings, effectiveOptions);
  };

  const MAX_TC_ITERS = 8;
  const TC_CANDIDATES = 16;
  const tc_r = spec.r;
  const TC_OFFSETS = [
    [0, 0],
    [tc_r * 3, 0], [-tc_r * 3, 0], [0, tc_r * 3], [0, -tc_r * 3],
    [tc_r * 5, tc_r * 5], [-tc_r * 5, -tc_r * 5]
  ];

  let tcPlacements = saFinalPlacements.slice();

  const outputUsedIds = new Set(
    (Array.isArray(baseResult && baseResult.placements) ? baseResult.placements : [])
      .map((p) => String(p && (p.scrapPieceId || p.inventoryTag || "")))
      .filter(Boolean)
  );
  let unusedForTC = pieces
    .filter((p) => !outputUsedIds.has(p.id))
    .sort((a, b) => b.areaMm2 - a.areaMm2);

  const getResInt = (r) => (r && r.residualInteriorMm2) || 0;
  const getComps = (r) => (r && Array.isArray(r.uncoveredComponents) ? r.uncoveredComponents : []);

  let currentResult = baseResult;
  let currentResInt = getResInt(baseResult);
  let tcPatchCount = 0;
  const tcDiag = [];

  for (let tc = 0; tc < MAX_TC_ITERS && unusedForTC.length > 0 && currentResInt > 0; tc++) {
    const components = getComps(currentResult)
      .filter((c) => !c.isPerimeterSliver && c.areaMm2 >= 18)
      .sort((a, b) => b.areaMm2 - a.areaMm2);
    if (components.length === 0) break;

    let patchAccepted = false;

    for (const comp of components) {
      const { x: ccx, y: ccy } = comp.centroid;
      const { minX: cbMinX, minY: cbMinY, maxX: cbMaxX, maxY: cbMaxY } = comp.bbox;
      const { nx, ny, r: gr, ox, oy } = spec;

      const compMask = new Uint8Array(cellCount);
      const compPts = Array.isArray(comp.pts) ? comp.pts : null;
      if (compPts && compPts.length >= 3) {
        const colMin = Math.max(0, Math.floor((cbMinX - ox) / gr));
        const colMax = Math.min(nx - 1, Math.ceil((cbMaxX - ox) / gr));
        const rowMin = Math.max(0, Math.floor((cbMinY - oy) / gr));
        const rowMax = Math.min(ny - 1, Math.ceil((cbMaxY - oy) / gr));
        for (let row = rowMin; row <= rowMax; row++) {
          for (let col = colMin; col <= colMax; col++) {
            const cx = ox + (col + 0.5) * gr;
            const cy = oy + (row + 0.5) * gr;
            if (pointInPolygon(cx, cy, compPts)) compMask[row * nx + col] = 1;
          }
        }
      } else {
        const colMin = Math.max(0, Math.floor((cbMinX - ox) / gr));
        const colMax = Math.min(nx - 1, Math.ceil((cbMaxX - ox) / gr));
        const rowMin = Math.max(0, Math.floor((cbMinY - oy) / gr));
        const rowMax = Math.min(ny - 1, Math.ceil((cbMaxY - oy) / gr));
        for (let row = rowMin; row <= rowMax; row++) {
          for (let col = colMin; col <= colMax; col++) compMask[row * nx + col] = 1;
        }
      }
      const compMaskCells = compMask.reduce((s, v) => s + v, 0);

      const topPieces = unusedForTC.slice(0, TC_CANDIDATES);
      let bestGain = 0;
      let bestNp = null;
      let bestPieceId = null;
      let probesTotal = 0;
      let ifpMiss = 0;
      let napMiss = 0;

      for (const piece of topPieces) {
        const ifp = (overhangMm > 0 && ifpCacheWide.get(piece.id)) || ifpCacheTight.get(piece.id);
        if (!ifp) {
          ifpMiss++;
          continue;
        }
        const pbb = polygonBBox(piece.centeredCorePts || piece.centeredPts || []);
        const pxSpan = pbb ? Math.max(0, pbb.maxX - pbb.minX) : 0;
        const pySpan = pbb ? Math.max(0, pbb.maxY - pbb.minY) : 0;
        const dynamicOffsets = TC_OFFSETS.concat([
          [pxSpan * 0.25, 0], [-pxSpan * 0.25, 0], [0, pySpan * 0.25], [0, -pySpan * 0.25],
          [pxSpan * 0.50, 0], [-pxSpan * 0.50, 0], [0, pySpan * 0.50], [0, -pySpan * 0.50],
          [pxSpan * 0.25, pySpan * 0.25], [-pxSpan * 0.25, pySpan * 0.25],
          [pxSpan * 0.25, -pySpan * 0.25], [-pxSpan * 0.25, -pySpan * 0.25]
        ]);

        for (const [dx, dy] of dynamicOffsets) {
          const px = ccx + dx;
          const py = ccy + dy;
          if (!pointInPolygon(px, py, ifp)) continue;

          const baseAngle = normalizeDeg(napTarget - piece.napDeg);
          for (const angle of [baseAngle, normalizeDeg(baseAngle + 90)]) {
            const dev = Math.abs(deltaDeg(normalizeDeg(napTarget - piece.napDeg), angle));
            if (dev > napTol && napTol < 45) {
              napMiss++;
              continue;
            }

            probesTotal++;
            const np = makePlacement(piece, px, py, angle, spec, zoneMask);
            let gain = 0;
            for (let i = 0; i < cellCount; i++) if ((np.mask[i] & 1) && compMask[i]) gain++;
            if (gain > bestGain) {
              bestGain = gain;
              bestNp = np;
              bestPieceId = piece.id;
            }
          }
        }
      }

      let patchResult = "no_candidate";
      if (bestNp) {
        const candidatePls = [...tcPlacements.filter((p) => p.id !== bestPieceId), bestNp];
        const candidateResult = fmtResult(candidatePls);
        const candidateResInt = getResInt(candidateResult);

        if (candidateResInt < currentResInt) {
          tcPlacements = candidatePls;
          currentResult = candidateResult;
          currentResInt = candidateResInt;
          outputUsedIds.add(bestPieceId);
          unusedForTC = unusedForTC.filter((p) => p.id !== bestPieceId);
          tcPatchCount++;
          patchAccepted = true;
          patchResult = "accepted";
        } else {
          patchResult = `rejected_resInt_${candidateResInt}_vs_${currentResInt}`;
        }
      }

      if (tcDiag.length < 6) {
        tcDiag.push({
          iter: tc,
          compAreAMm2: comp.areaMm2,
          compBbox: `${Math.round(cbMaxX - cbMinX)}x${Math.round(cbMaxY - cbMinY)}`,
          compMaskCells,
          centroid: { x: Math.round(ccx), y: Math.round(ccy) },
          unusedLeft: unusedForTC.length,
          ifpMiss,
          napMiss,
          probesTotal,
          bestGain,
          bestPieceId,
          patchResult
        });
      }

      if (patchAccepted) break;
    }

    if (!patchAccepted) break;
  }

  if (currentResult.algorithmTrace) {
    currentResult.algorithmTrace.targetedCycle = {
      ran: true,
      patchCount: tcPatchCount,
      unusedCount: unusedForTC.length,
      initialResInt: getResInt(baseResult),
      finalResInt: currentResInt,
      diag: tcDiag
    };
  }
  return currentResult;
}

module.exports = { applyTargetedCycle };
