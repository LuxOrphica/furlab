"use strict";

const ClipperLib = require("clipper-lib");
const CLIPPER_SCALE_AE = 1000;

// ── v5.0 §5.3: 4 прокси эстетики ────────────────────────────────────────────
// Каждый фрагмент проверяется по 4 прокси. Абсолютные пороги (без сравнения с эталоном).
// Возвращается { perFragment: [...], passRate, summary }.
function computeAesthetics(resultPlacements, minWidthMm) {
  const perFragment = [];
  let passCount = 0;
  const total = resultPlacements.length;

  for (const rp of resultPlacements) {
    const pts = rp.inZoneCoreContour || rp.inZoneContour;
    if (!Array.isArray(pts) || pts.length < 3) {
      perFragment.push({ scrapPieceId: rp.scrapPieceId, skipped: true });
      continue;
    }

    // 1. Выпуклость: area / area(convexHull)
    const fragArea = polygonArea(pts);
    const hullPts = convexHull(pts);
    const hullArea = polygonArea(hullPts);
    const convexity = hullArea > 1 ? fragArea / hullArea : 0;

    // 2. Заполнение MBR: area / area(MBR)
    const mbrShort = minBoundingRectShorter(pts);
    const mbrLong = minBoundingRectLonger(pts);
    const mbrArea = mbrShort * mbrLong;
    const mbrFill = mbrArea > 1 ? fragArea / mbrArea : 0;

    // 3. Доля языков: area(fragment \ buffer(fragment, -minWidth/2)) / area(fragment)
    // Эрозия фрагмента на половину min-width. Если эрозия пуста → весь фрагмент — «язык».
    let tongueFraction = 0;
    try {
      const co = new ClipperLib.ClipperOffset();
      co.AddPath(toClipperAE(pts), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
      const eroded = new ClipperLib.Paths();
      const erodeDelta = -Math.round((minWidthMm / 2) * CLIPPER_SCALE_AE);
      co.Execute(eroded, erodeDelta);
      const erodedArea = (eroded || []).reduce((s, p) => s + Math.abs(ClipperLib.Clipper.Area(p)) / (CLIPPER_SCALE_AE * CLIPPER_SCALE_AE), 0);
      tongueFraction = fragArea > 1 ? Math.max(0, (fragArea - erodedArea) / fragArea) : 0;
    } catch (_) {
      tongueFraction = 0;
    }

    // 4. Прямота швов — не вычисляется на одном фрагменте (нужны соседи).
    // Пропускаем в per-fragment; v5.1 добавит межфрагментную метрику.
    const seamStraightness = null;

    // Пороги (v5.0 §5.3) — абсолютные, без сравнения с эталоном.
    const TH_CONVEXITY = 0.55;
    const TH_MBR_FILL = 0.55;
    const TH_TONGUE = 0.08;
    const passConvexity = convexity >= TH_CONVEXITY;
    const passMbrFill = mbrFill >= TH_MBR_FILL;
    const passTongue = tongueFraction <= TH_TONGUE;
    const pass = passConvexity && passMbrFill && passTongue;

    if (pass) passCount++;
    perFragment.push({
      scrapPieceId: rp.scrapPieceId,
      convexity: Math.round(convexity * 1000) / 1000,
      mbrFill: Math.round(mbrFill * 1000) / 1000,
      tongueFraction: Math.round(tongueFraction * 1000) / 1000,
      seamStraightness,
      passConvexity, passMbrFill, passTongue, pass
    });
  }

  const passRate = total > 0 ? passCount / total : 0;
  return {
    perFragment,
    passRate: Math.round(passRate * 1000) / 1000,
    passCount,
    total,
    thresholds: { convexity: 0.55, mbrFill: 0.55, tongue: 0.08 },
    summary: `pass: ${passCount}/${total} (${Math.round(passRate * 100)}%)`
  };
}

// Helpers (inline, чтобы не зависеть от deps)
function toClipperAE(pts) {
  return pts.map(p => ({ X: Math.round(p.x * CLIPPER_SCALE_AE), Y: Math.round(p.y * CLIPPER_SCALE_AE) }));
}
function polygonArea(pts) {
  if (!Array.isArray(pts) || pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) * 0.5;
}
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
function minBoundingRectShorter(pts) {
  if (!pts || pts.length < 3) return Infinity;
  const hull = convexHull(pts);
  const n = hull.length;
  if (n < 2) return Infinity;
  let minShorter = Infinity;
  for (let i = 0; i < n; i++) {
    const p1 = hull[i], p2 = hull[(i + 1) % n];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len, uy = dy / len, vx = -uy, vy = ux;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy, v = p.x * vx + p.y * vy;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const shorter = Math.min(maxU - minU, maxV - minV);
    if (shorter < minShorter) minShorter = shorter;
  }
  return minShorter;
}
function minBoundingRectLonger(pts) {
  if (!pts || pts.length < 3) return Infinity;
  const hull = convexHull(pts);
  const n = hull.length;
  if (n < 2) return Infinity;
  let maxLonger = 0;
  for (let i = 0; i < n; i++) {
    const p1 = hull[i], p2 = hull[(i + 1) % n];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len, uy = dy / len, vx = -uy, vy = ux;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy, v = p.x * vx + p.y * vy;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const longer = Math.max(maxU - minU, maxV - minV);
    if (longer > maxLonger) maxLonger = longer;
  }
  return maxLonger;
}

function createVoronoiSaResultBuilder(deps) {
  const buildTerritoryOutput = deps.buildTerritoryOutput;
  const buildPolygonalTerritoryOutput = deps.buildPolygonalTerritoryOutput || null;
  const runInitialPostprocess = deps.runInitialPostprocess;
  const runPolygonResidualAbsorption = deps.runPolygonResidualAbsorption;
  const collectDuplicatePieceWarnings = deps.collectDuplicatePieceWarnings;
  const computeAbsorptionDiagnostic = deps.computeAbsorptionDiagnostic;
  const computeResultInvariants = deps.computeResultInvariants;
  const computeResidualCoverage = deps.computeResidualCoverage;
  const CLIPPER_SCALE = deps.CLIPPER_SCALE || 1000;

  const computePowerAssign = deps.computePowerAssign;
  const polygonBBox = deps.polygonBBox;
  const pointsToMultiPolygon = deps.pointsToMultiPolygon;
  const multiPolygonArea = deps.multiPolygonArea;
  const intersectMulti = deps.intersectMulti;
  const diffMulti = deps.diffMulti;
  const unionMulti = deps.unionMulti;
  const mpToPoints = deps.mpToPoints;
  const fillGapsVoronoi = deps.fillGapsVoronoi;
  const absorbResidualCells = deps.absorbResidualCells;
  const dissolveSmallFragments = deps.dissolveSmallFragments;
  const sealFragment = deps.sealFragment;
  const coreFragmentForTerritory = deps.coreFragmentForTerritory;

  function formatResult(placements, zonePoints, zoneArea, coveredCells, zoneCells, iters, accepted, options, spec, finalZoneMask, selectionDebug, isMosaic, phaseATimeMs, phaseBStats, warnings, effectiveOptions, _exitReason, _phaseAExtra) {
    const allowanceMm = Math.max(0, Number((options && options.allowanceMm) || (options && options.seamAllowanceReserveMm) || 0));
    // min-width/length are explicit cut-quality parameters, NOT derived from allowanceMm.
    // Solver works on cores only — allowance is post-processing concern, not placement validity.
    const minWidthMm = Math.max(0, Number((options && options.minWidthMm) || 0));
    const minLengthMm = Math.max(0, Number((options && options.minLengthMm) || 0));
    const absorptionCriterion = (options && options.absorptionCriterion != null) ? Number(options.absorptionCriterion) : 4;
    const postprocessMode = String((options && options.postprocessMode) || "raw");
    const disablePostprocess = postprocessMode === "raw" || (options && options._disablePostprocess === true);
    const usePolygonal = !!(buildPolygonalTerritoryOutput && options && options.usePolygonal);
    const zoneHoles = Array.isArray(options && options.zoneHoles) ? options.zoneHoles : [];
    let zoneMp = pointsToMultiPolygon(zonePoints);
    for (const hole of zoneHoles) {
      if (!Array.isArray(hole) || hole.length < 3) continue;
      try { zoneMp = diffMulti(zoneMp, pointsToMultiPolygon(hole)); } catch (_) {}
    }

    if (placements.length === 0) return emptyResult(zoneArea);

    const { nx, ny } = spec;
    const scale = CLIPPER_SCALE;

    const territoryOutput = buildTerritoryOutput({
      placements,
      spec,
      scale,
      finalZoneMask,
      isMosaic,
      phaseBStats,
      minWidthMm,
      minLengthMm,
      allowanceMm,
      computePowerAssign,
      polygonBBox,
      pointsToMultiPolygon,
      multiPolygonArea,
      intersectMulti,
      mpToPoints,
      precomputedAssignment: _phaseAExtra && _phaseAExtra.lloydAssignment,
      lloydZoneMp: (_phaseAExtra && _phaseAExtra.lloydAssignment) ? zoneMp : null
    });
    const resultPlacements = territoryOutput.resultPlacements;
    const perfectCells = territoryOutput.perfectCells;
    const fallbackFragments = territoryOutput.fallbackFragments;
    const topologyRepair = territoryOutput.topologyRepair || null;

    if (_phaseAExtra && _phaseAExtra.lloydAssignment) {
      const _sumArea = resultPlacements.reduce((s, rp) => s + (rp.inZoneAreaMm2 || 0), 0);
      console.log(`[Lloyd BTO] resultPlacements=${resultPlacements.length} sumInZoneArea=${Math.round(_sumArea)}`);
    }

    const _fmtT0 = Date.now();
    const postprocessResult = runInitialPostprocess({
      resultPlacements,
      placements,
      spec,
      finalZoneMask,
      warnings,
      disablePostprocess,
      absorptionCriterion,
      minWidthMm,
      minLengthMm,
      scale,
      fillGapsVoronoi,
      absorbResidualCells,
      dissolveSmallFragments,
      sealFragment,
      coreFragmentForTerritory
    });
    const placementsBeforeDissolve = postprocessResult.placementsBeforeDissolve;
    const dissolveResult = postprocessResult.dissolveResult;
    const dissolvedCount = postprocessResult.dissolvedCount;
    const dissolvedPlacements = postprocessResult.dissolvedPlacements;

    console.log(`[VSA] runInitialPostprocess: ${Date.now() - _fmtT0}ms`);
    warnings.push(...collectDuplicatePieceWarnings(resultPlacements));

    const gapFillFragments = postprocessResult.gapFillFragments;

    const _fmtT1 = Date.now();
    let { coveredRatio: realCoveredRatio, residualAreaMm2: realResidualAreaMm2,
          residualPerimeterMm2, residualInteriorMm2, uncoveredComponents, dissolvedTotal } =
      computeResidualCoverage(resultPlacements, zonePoints, zoneArea, spec.r, dissolvedPlacements);
    console.log(`[VSA] computeResidualCoverage: ${Date.now() - _fmtT1}ms`);

    const _fmtT2 = Date.now();
    let polygonAbsorptionResult = null;
    if (usePolygonal) {
      // v5.0 Fix тип D: в полигональном режиме absorb запрещён (по контракту).
      // residual absorption не запускаем — physMissing = честно, не absorb.
      console.log(`[VSA-POLY] runPolygonResidualAbsorption skipped (polygonal mode)`);
    } else {
      polygonAbsorptionResult = runPolygonResidualAbsorption({
        resultPlacements,
        placements,
        warnings,
        disablePostprocess,
        spec,
        scale: CLIPPER_SCALE,
        minWidthMm,
        coveredRatio: realCoveredRatio,
        residualAreaMm2: realResidualAreaMm2,
        residualPerimeterMm2,
        residualInteriorMm2,
        uncoveredComponents,
        dissolvedTotal,
        zonePoints,
        zoneArea,
        dissolvedPlacements,
        computeResidualCoverage,
        sealFragment,
        coreFragmentForTerritory,
        pointsToMultiPolygon,
        multiPolygonArea
      });
      console.log(`[VSA] runPolygonResidualAbsorption: ${Date.now() - _fmtT2}ms`);
      realCoveredRatio = polygonAbsorptionResult.coveredRatio;
      realResidualAreaMm2 = polygonAbsorptionResult.residualAreaMm2;
      residualPerimeterMm2 = polygonAbsorptionResult.residualPerimeterMm2;
      residualInteriorMm2 = polygonAbsorptionResult.residualInteriorMm2;
      uncoveredComponents = polygonAbsorptionResult.uncoveredComponents;
      dissolvedTotal = polygonAbsorptionResult.dissolvedTotal;
      void dissolvedTotal;
    }

    // Dedup: one physical scrap = one placement. Keep highest inZoneAreaMm2 per scrapPieceId.
    // Two-pass to avoid index-tracking bugs from splice during backward iteration.
    {
      const bestByPieceId = new Map();
      for (const rp of resultPlacements) {
        const id = rp.scrapPieceId;
        if (!id) continue;
        const existing = bestByPieceId.get(id);
        if (!existing || (rp.inZoneAreaMm2 || 0) > (existing.inZoneAreaMm2 || 0)) {
          bestByPieceId.set(id, rp);
        }
      }
      for (let i = resultPlacements.length - 1; i >= 0; i--) {
        const rp = resultPlacements[i];
        if (!rp.scrapPieceId || bestByPieceId.get(rp.scrapPieceId) === rp) continue;
        warnings.push(`dedup_dropped:${rp.scrapPieceId}:phase=${rp.phase || '?'}`);
        resultPlacements.splice(i, 1);
      }
    }

    const realFullCoverageOk = realCoveredRatio >= 0.998;
    const totalPiece = resultPlacements.reduce((s, p) => s + p.inZoneAreaMm2 + p.outsideAreaMm2, 0);

    for (const rp of resultPlacements) {
      const body = rp.bodyAreaMm2 || 0;
      rp.utilization = body > 0 ? rp.inZoneAreaMm2 / body : 0;
      rp.insideRatio = rp.utilization;
      rp.lowUtilization = rp.utilization < 0.30;
    }

    const absorptionDiagnostic = computeAbsorptionDiagnostic({
      uncoveredComponents,
      placements,
      spec
    });
    const resultInvariants = computeResultInvariants({
      resultPlacements,
      zonePoints,
      zoneArea,
      realCoveredRatio,
      pointsToMultiPolygon,
      multiPolygonArea,
      allowanceMm  // v5.0: передаём allowanceMm, чтобы INV4 не срабатывал при allowanceMm=0
    });

    // ── v5.0 §5.2: 4 статуса результата ─────────────────────────────────────
    // Классификация по invariants, не по одной только coverage.
    // ok: covF ≥ 99.5% ∧ R2/R5/R6 PASS
    // partial: covF ∈ [95%, 99.5%) ∧ R2/R5/R6 PASS ∧ physMissing ≤ 1% зоны
    // insufficient_input: covF < 95% (пробуем insufficient; TODO: отличать от failed через pre-flight горл)
    // failed: R2 FAIL ИЛИ R5 FAIL ИЛИ R6 FAIL ИЛИ covF < 95% при наличии кандидатов
    const invWarnings = (resultInvariants && Array.isArray(resultInvariants.warnings))
      ? resultInvariants.warnings : [];
    const r2Fail = invWarnings.some(w => /^R2_/.test(w) || /partition/i.test(w));
    const r5Fail = invWarnings.some(w => /^R5_/.test(w) || /sub.?min/i.test(w));
    const r6Fail = invWarnings.some(w => /^R6_/.test(w) || /duplicate/i.test(w));
    const physMissingTotalMm2 = resultPlacements.reduce(
      (s, p) => s + (p && p.physicalMissingMm2 > 0 ? p.physicalMissingMm2 : 0), 0);
    const physMissingPct = zoneArea > 0 ? physMissingTotalMm2 / zoneArea * 100 : 0;
    const covF = realCoveredRatio * 100;

    let resultStatus;
    let failedReason = null;
    if (r2Fail || r5Fail || r6Fail) {
      // Жёсткое нарушение инварианта — баг солвера.
      resultStatus = "failed";
      failedReason = r2Fail ? "partition_gap_R2"
        : r5Fail ? "sub_min_fragment_R5"
        : "duplicate_scrap_R6";
    } else if (covF >= 99.5) {
      resultStatus = "ok";
    } else if (covF >= 95.0 && physMissingPct <= 1.0) {
      resultStatus = "partial";
      failedReason = "coverage_below_target_with_minor_physMissing";
    } else if (covF < 95.0 && physMissingPct > 5.0) {
      // Эвристика insufficient_input: covF низкая И physMissing значительный.
      // TODO v5.1: отличать от failed через pre-flight горл < 70 и inventory-check свободных кусков.
      resultStatus = "insufficient_input";
      failedReason = `low_coverage_${covF.toFixed(1)}pct_physMissing_${physMissingPct.toFixed(1)}pct`;
    } else {
      resultStatus = "failed";
      failedReason = `coverage_${covF.toFixed(1)}pct_below_threshold`;
    }

    return {
      ok: true,
      seed: effectiveOptions.seed,
      fullCoverageOk: realFullCoverageOk,
      coveredRatio: realCoveredRatio,
      coveragePercent: realCoveredRatio * 100,
      residualAreaMm2: realResidualAreaMm2,
      residualPerimeterMm2,
      residualInteriorMm2,
      uncoveredComponents,
      resultStatus,
      failedReason,
      renderOrderPolicy: "solve_order",
      stackOrderPolicy: "solve_order",
      solveOrder: resultPlacements.map((p) => p.scrapPieceId),
      placements: resultPlacements,
      summary: {
        piecesCount: resultPlacements.length,
        selectedPiecesAreaMm2: totalPiece,
        selectedPiecesAreaBasis: "piece",
        overlapAreaMm2: 0,
        zoneAreaMm2: Math.round(zoneArea)
      },
      algorithmTrace: {
        version: "voronoi-sa-v5.0",
        effectiveOptions,
        phaseA: {
          timeMs: phaseATimeMs || 0,
          iterations: iters,
          accepted,
          exitReason: _exitReason || "timeout",
          warmDurationMs: _phaseAExtra ? (_phaseAExtra.warmDurationMs || 0) : 0,
          alpha: _phaseAExtra ? (_phaseAExtra.saAlpha || null) : null
        },
        phaseB: phaseBStats ? {
          timeMs: phaseBStats.timeMs,
          lloydIterations: phaseBStats.lloydIterations,
          exitReason: phaseBStats.exitReason,
          notContainedTotal_start: phaseBStats.notContainedTotal_start,
          notContainedTotal_end: phaseBStats.notContainedTotal_end,
          weightAdaptationCycles: phaseBStats.weightAdaptationCycles
        } : { timeMs: 0, lloydIterations: 0, exitReason: "skipped_mode", notContainedTotal_start: 0, notContainedTotal_end: 0, weightAdaptationCycles: 0 },
        warnings: warnings || [],
        fragmentStats: {
          perfectCells,
          fallbackFragments,
          gapFillFragments,
          placementsBeforeDissolve,
          dissolvedFragments: dissolvedCount,
          underThresholdFragments: dissolveResult ? dissolveResult.underThreshold : 0,
          belowThresholdTotal: dissolveResult ? dissolveResult.belowThreshold : 0,
          dissolvedContoursSaved: dissolvedPlacements.length,
          postprocessMode,
          postprocessDisabled: disablePostprocess
        },
        postprocessTrace: [
          ...(topologyRepair ? [topologyRepair] : []),
          ...((!usePolygonal && postprocessResult && Array.isArray(postprocessResult.trace)) ? postprocessResult.trace : []),
          ...((!usePolygonal && polygonAbsorptionResult && Array.isArray(polygonAbsorptionResult.trace)) ? polygonAbsorptionResult.trace : [])
        ]
      },
      selectionDebug: selectionDebug || null,
      absorptionDiagnostic: absorptionDiagnostic.length > 0 ? absorptionDiagnostic : null,
      invariants: resultInvariants,
      // v5.0 §5.3: 4 прокси эстетики (выпуклость, заполнение MBR, доля языков; прямота швов — TODO v5.1).
      aesthetics: computeAesthetics(resultPlacements, minWidthMm)
    };
  }

  function emptyResult(zoneArea) {
    // v5.0 §5.2: нет кандидатов → insufficient_input (не баг солвера — нечего класть).
    return {
      ok: false,
      fullCoverageOk: false,
      coveredRatio: 0,
      coveragePercent: 0,
      residualAreaMm2: zoneArea,
      resultStatus: "insufficient_input",
      failedReason: "no_candidates",
      renderOrderPolicy: "solve_order",
      stackOrderPolicy: "solve_order",
      solveOrder: [],
      placements: [],
      summary: { piecesCount: 0, selectedPiecesAreaMm2: 0, selectedPiecesInZoneAreaMm2: 0, selectedPiecesAreaBasis: "piece", overlapAreaMm2: 0, utilizationPct: 0 },
      algorithmTrace: { version: "voronoi-sa-v5.0", steps: {} }
    };
  }

  return { formatResult, emptyResult };
}

module.exports = { createVoronoiSaResultBuilder };
