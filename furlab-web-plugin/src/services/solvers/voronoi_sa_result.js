"use strict";

function createVoronoiSaResultBuilder(deps) {
  const buildTerritoryOutput = deps.buildTerritoryOutput;
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
    const polygonAbsorptionResult = runPolygonResidualAbsorption({
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
      multiPolygonArea
    });

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
      resultStatus: realFullCoverageOk ? "ok" : "failed",
      failedReason: realFullCoverageOk ? null : "zone_not_fully_covered",
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
        version: "voronoi-sa-v4.0",
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
          underThresholdFragments: dissolveResult.underThreshold,
          belowThresholdTotal: dissolveResult.belowThreshold,
          dissolvedContoursSaved: dissolvedPlacements.length,
          postprocessMode,
          postprocessDisabled: disablePostprocess
        },
        postprocessTrace: [
          ...(topologyRepair ? [topologyRepair] : []),
          ...(Array.isArray(postprocessResult.trace) ? postprocessResult.trace : []),
          ...(Array.isArray(polygonAbsorptionResult.trace) ? polygonAbsorptionResult.trace : [])
        ]
      },
      selectionDebug: selectionDebug || null,
      absorptionDiagnostic: absorptionDiagnostic.length > 0 ? absorptionDiagnostic : null,
      invariants: resultInvariants
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

  return { formatResult, emptyResult };
}

module.exports = { createVoronoiSaResultBuilder };
