"use strict";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Number(v)));
}

function resolveInventoryDirectConfig(params) {
  const {
    options,
    sourceConstraints,
    zoneArea,
    candidateAreaBudgetMm2,
    normalizeDeg,
    NAP_EPS_DEG
  } = params;

  const maxPieces = Math.max(1, Math.min(260, Number(options && options.maxPieces || 140)));
  const minPieces = Math.max(1, Math.min(maxPieces, Number(options && options.minPieces || 3)));
  const enforceHardFragmentLimits = !!(options && options.enforceHardFragmentLimits === true);
  const minFragmentAreaMm2Hard = enforceHardFragmentLimits
    ? Math.max(0, Number((options && options.minAreaMm2) ?? 0))
    : 0;
  const minFragmentWidthMmHard = enforceHardFragmentLimits
    ? Math.max(0, Number((options && options.minFragmentWidthMm) ?? 0))
    : 0;
  const minFragmentLengthMmHard = enforceHardFragmentLimits
    ? Math.max(0, Number((options && options.minFragmentLengthMm) ?? 0))
    : 0;

  const coverageFirst = !(options && options.coverageFirst === false);
  const enforceTimeBudget = !options || options.enforceTimeBudget !== false;
  const maxPieceOverlap = clamp(options && options.maxPieceOverlap || 0.9, 0, 1);
  const overlapPenalty = clamp(options && options.overlapPenalty || (coverageFirst ? 0.25 : 1.0), 0, 2);
  const outsidePenalty = clamp(options && options.outsidePenalty || (coverageFirst ? 0.05 : 0.35), 0, 3);
  const costWeight = clamp(options && options.costWeight || 1.0, 0.2, 4);
  const minGainAreaMm2 = Math.max(5, Number(options && options.minGainAreaMm2 || Math.max(40, zoneArea * 0.0002)));

  const coverageTarget = clamp(options && options.coverageTarget || 0.999, 0.65, 0.99999);
  const strictCoverage = options && options.strictCoverage !== false;
  const strictCoverageHard = !!(options && options.strictCoverageHard === true);
  const coverageEps = clamp(options && options.coverageEps || 0.002, 0.0005, 0.02);
  const theoreticalMaxCoverageRatio = zoneArea > 1e-9
    ? Math.max(0, Math.min(1, candidateAreaBudgetMm2 / zoneArea))
    : 0;
  const coverageTargetReachable = theoreticalMaxCoverageRatio + coverageEps >= coverageTarget;
  const strictCoverageEffective = strictCoverage && (strictCoverageHard || coverageTargetReachable);
  const overlapAversionMode = !coverageTargetReachable && !strictCoverageHard;
  const objectiveMode = String((options && options.objectiveMode) || "default").toLowerCase();
  const objectiveMinEfficiency = clamp((options && options.objectiveMinEfficiency) ?? 0.82, 0.5, 0.99);
  const objectivePiecePenalty = clamp((options && options.objectivePiecePenalty) ?? 0.18, 0.01, 2.0);
  const objectiveFragmentPenalty = clamp((options && options.objectiveFragmentPenalty) ?? 0.28, 0, 3.0);
  const minEfficiencyBase = clamp((options && options.minEfficiencyBase) ?? 0.2, 0.01, 0.95);
  const phaseAEndCoverage = clamp((options && options.phaseAEndCoverage) ?? 0.22, 0.1, 0.9);
  const phaseAInsideMin = clamp((options && options.phaseAInsideMin) ?? 0.90, 0.75, 1.0);
  const phaseAMaxOverlap = clamp((options && options.phaseAMaxOverlap) ?? 0.08, 0.0, 0.7);
  const phaseBEfficiencyMin = clamp((options && options.phaseBEfficiencyMin) ?? 0.42, 0.05, 0.95);
  const phaseAMinPieces = clamp((options && options.phaseAMinPieces) ?? 1, 0, 24);
  const phaseAMinGainMm2 = clamp((options && options.phaseAMinGainMm2) ?? 4000, 1, 500000);
  const phaseAMinGainShare = clamp((options && options.phaseAMinGainShare) ?? 0.03, 0, 0.9);
  const minVisibleFragmentAreaMm2 = clamp(
    (options && (options.minVisibleFragmentAreaMm2 ?? options.minGainVisibleMm2)) ?? Math.max(250, Math.min(5000, zoneArea * 0.0015)),
    0,
    500000
  );
  const minVisibleFragmentSpanMm = clamp((options && (options.minVisibleFragmentSpanMm ?? options.minSpanMm)) ?? 60, 0, 2000);
  const pieceSeamReserveMm = Math.max(0, Number((options && options.pieceSeamReserveMm) ?? 0) || 0);
  const seamEpsRatio = clamp((options && options.seamEpsRatio) ?? 0.005, 0.0001, 0.05);
  const seamEpsMm2 = Math.max(0, Number((options && options.seamEpsMm2) ?? 0) || 0);

  const napTolDeg = clamp((sourceConstraints && sourceConstraints.napToleranceDeg) ?? 15, 0, 180);
  const targetNapDeg = normalizeDeg(sourceConstraints && sourceConstraints.napDirectionDeg);
  const napPolicyRaw = String(sourceConstraints && sourceConstraints.napPolicy || "normal").toLowerCase();
  const napPolicy = napPolicyRaw === "strict" || napPolicyRaw === "free" ? napPolicyRaw : "normal";
  const allowFlip180 = false;
  const hardNapLock = targetNapDeg !== null && napPolicy !== "free" && napTolDeg <= NAP_EPS_DEG;
  const napWeight = clamp(
    sourceConstraints && sourceConstraints.napWeight !== undefined
      ? sourceConstraints.napWeight
      : (napPolicy === "strict" ? 2.5 : (napPolicy === "normal" ? 1.0 : 0.2)),
    0,
    5
  );

  const minInsideRatio = clamp(options && options.minInsideRatio || (coverageFirst ? 0 : 0.2), 0, 1);
  const maxSolveMs = clamp(options && options.maxSolveMs || 60000, 5000, 300000);
  const hardMaxSolveMsRaw = clamp(options && options.hardMaxSolveMs || 180000, 5000, 600000);
  const hardMaxSolveMs = Math.max(maxSolveMs, hardMaxSolveMsRaw);
  const maxPointsPerCandidate = Math.max(24, Math.min(220, Number(options && options.maxPointsPerCandidate || 90)));
  const solverMode = String((options && options.solverMode) || "phasedV1").toLowerCase();
  const rasterMm = clamp(options && options.rasterMm || 2, 1, 10);

  const tailCoverageStart = clamp((options && options.tailCoverageStart) ?? 0.93, 0.7, 0.99999);
  const tailResidualRatio = clamp((options && options.tailResidualRatio) ?? 0.03, 0.001, 0.2);
  const tailResidualMm2 = Math.max(1, zoneArea * tailResidualRatio);
  const tailResidualLooseRatio = clamp((options && options.tailResidualLooseRatio) ?? 0.015, 0.001, 0.2);
  const tailMinEfficiency = clamp((options && options.tailMinEfficiency) ?? 0.3, 0.01, 0.95);
  const tailMinEfficiencyLoose = clamp((options && options.tailMinEfficiencyLoose) ?? 0.18, 0.01, 0.95);
  const pocketModeStartRatio = clamp((options && options.pocketModeStartRatio) ?? 0.08, 0.005, 0.2);
  const pocketAreaK = clamp((options && options.pocketAreaK) ?? 2.4, 1.2, 8.0);
  const tailOversizeAlpha = clamp((options && options.tailOversizeAlpha) ?? 2.4, 1.05, 12);
  const tailStallTrigger = clamp((options && options.tailStallTrigger) ?? 3, 1, 12);
  const tailPenaltyBoost = clamp((options && options.tailPenaltyBoost) ?? 2.2, 1, 4);
  const tailMaxPlacements = clamp((options && options.tailMaxPlacements) ?? 14, 0, 80);
  const tailCapResidualRatio = clamp((options && options.tailCapResidualRatio) ?? 0.03, 0.001, 0.2);
  const tailMinGainShare = clamp((options && options.tailMinGainShare) ?? 0.22, 0.01, 0.9);
  const tailMinGainCapMm2 = clamp((options && options.tailMinGainCapMm2) ?? 280, 10, 5000);
  const layerPolicyRaw = String((options && options.layerPolicy) || "first_on_top").toLowerCase();
  const layerPolicy = layerPolicyRaw === "first_on_top" ? "first_on_top" : "priority_on_top";
  const pocketCoverageThresholdA = clamp((options && options.pocketCoverageThresholdA) ?? 0.8, 0.4, 0.99);
  const pocketCoverageBonusA = clamp((options && options.pocketCoverageBonusA) ?? 0.6, 0, 6);
  const gridAnchorEnable = !options || options.gridAnchorEnable !== false;
  const gridAnchorStepFactor = clamp((options && options.gridAnchorStepFactor) ?? 1.0, 0.5, 3.0);
  const gridAnchorMax = clamp((options && options.gridAnchorMax) ?? 160, 16, 600);
  const cleanLayoutMode = !options || options.cleanLayoutMode !== false;
  const cleanOverlapRatioMaxAB = clamp((options && options.cleanOverlapRatioMaxAB) ?? 0.35, 0.02, 0.95);
  const cleanOverlapRatioMaxC = clamp((options && options.cleanOverlapRatioMaxC) ?? 0.5, 0.02, 0.98);
  const gridAcceptCoverageRatio = clamp((options && options.gridAcceptCoverageRatio) ?? 0.975, 0.7, 0.99999);
  const cleanPiecePenalty = clamp((options && options.cleanPiecePenalty) ?? 0.22, 0, 4);

  const maxRepairAttempts = clamp(options && options.maxRepairAttempts || 3, 0, 8);
  const repairWindow = clamp(options && options.repairWindow || 24, 1, 80);

  return {
    maxPieces,
    minPieces,
    minFragmentAreaMm2Hard,
    minFragmentWidthMmHard,
    minFragmentLengthMmHard,
    coverageFirst,
    enforceTimeBudget,
    maxPieceOverlap,
    overlapPenalty,
    outsidePenalty,
    costWeight,
    minGainAreaMm2,
    coverageTarget,
    strictCoverage,
    strictCoverageHard,
    coverageEps,
    theoreticalMaxCoverageRatio,
    coverageTargetReachable,
    strictCoverageEffective,
    overlapAversionMode,
    objectiveMode,
    objectiveMinEfficiency,
    objectivePiecePenalty,
    objectiveFragmentPenalty,
    minEfficiencyBase,
    phaseAEndCoverage,
    phaseAInsideMin,
    phaseAMaxOverlap,
    phaseBEfficiencyMin,
    phaseAMinPieces,
    phaseAMinGainMm2,
    phaseAMinGainShare,
    minGainVisibleMm2: minVisibleFragmentAreaMm2,
    minSpanMm: minVisibleFragmentSpanMm,
    minVisibleFragmentAreaMm2,
    minVisibleFragmentSpanMm,
    pieceSeamReserveMm,
    seamEpsRatio,
    seamEpsMm2,
    napTolDeg,
    targetNapDeg,
    napPolicy,
    allowFlip180,
    hardNapLock,
    napWeight,
    minInsideRatio,
    maxSolveMs,
    hardMaxSolveMs,
    maxPointsPerCandidate,
    solverMode,
    rasterMm,
    tailCoverageStart,
    tailResidualRatio,
    tailResidualMm2,
    tailResidualLooseRatio,
    tailMinEfficiency,
    tailMinEfficiencyLoose,
    pocketModeStartRatio,
    pocketAreaK,
    tailOversizeAlpha,
    tailStallTrigger,
    tailPenaltyBoost,
    tailMaxPlacements,
    tailCapResidualRatio,
    tailMinGainShare,
    tailMinGainCapMm2,
    layerPolicy,
    pocketCoverageThresholdA,
    pocketCoverageBonusA,
    gridAnchorEnable,
    gridAnchorStepFactor,
    gridAnchorMax,
    cleanLayoutMode,
    cleanOverlapRatioMaxAB,
    cleanOverlapRatioMaxC,
    gridAcceptCoverageRatio,
    cleanPiecePenalty,
    maxRepairAttempts,
    repairWindow
  };
}

module.exports = {
  resolveInventoryDirectConfig
};
