"use strict";

function scorePlacementObjective(ctx) {
  const costArea = Math.max(1e-9, Number(ctx.costArea || 0));
  const gainArea = Math.max(0, Number(ctx.gainArea || 0));
  const inZoneArea = Math.max(0, Number(ctx.inZoneArea || 0));
  const overlapArea = Math.max(0, Number(ctx.overlapArea || 0));
  const outsideArea = Math.max(0, Number(ctx.outsideArea || 0));
  const coveredRatioNow = Math.max(0, Math.min(1, Number(ctx.coveredRatioNow || 0)));
  const inTailPhase = !!ctx.inTailPhase;
  const overlapPenaltyK = Math.max(0, Number(ctx.overlapPenaltyK || 0));
  const outsidePenaltyK = Math.max(0, Number(ctx.outsidePenaltyK || 0));
  const costWeight = Math.max(0.2, Math.min(4, Number(ctx.costWeight || 1)));
  const pieceCountPenaltyK = inTailPhase ? 0.12 : 0.05;
  const objectiveMode = String(ctx.objectiveMode || "default").toLowerCase();
  const objectiveMinEfficiency = Math.max(0.5, Math.min(0.99, Number(ctx.objectiveMinEfficiency || 0.82)));
  const objectivePiecePenalty = Math.max(0, Math.min(3, Number(ctx.objectivePiecePenalty || 0.18)));
  const objectiveFragmentPenalty = Math.max(0, Math.min(5, Number(ctx.objectiveFragmentPenalty || 0.28)));
  const piecesPlaced = Math.max(0, Number(ctx.piecesPlaced || 0));
  const phaseMode = String(ctx.phaseMode || (inTailPhase ? "C" : "B")).toUpperCase();
  const zoneArea = Math.max(1e-9, Number(ctx.zoneArea || 0) || costArea);

  const gainNorm = gainArea / zoneArea;
  const overlapNorm = overlapArea / zoneArea;
  const outsideNorm = outsideArea / zoneArea;
  const costNorm = costArea / zoneArea;
  const inZoneNorm = inZoneArea / zoneArea;

  const pieceCountPenalty = coveredRatioNow >= 0.9 ? pieceCountPenaltyK : (coveredRatioNow >= 0.75 ? 0.06 : 0.04);
  const utilizationPenalty = (1 - gainNorm) * (inTailPhase ? 0.75 : (coveredRatioNow >= 0.85 ? 0.45 : 0.2));
  const oversizeRatio = gainArea > 1e-9 ? Math.max(0, (inZoneArea / gainArea) - 1) : 8;
  const tailOversizeWeight = inTailPhase ? 1.6 : (coveredRatioNow >= 0.92 ? 1.15 : (coveredRatioNow >= 0.8 ? 0.7 : 0.25));
  const oversizePenalty = Math.min(8, oversizeRatio) * tailOversizeWeight;
  const piecePenalty = objectivePiecePenalty * (1 + Math.min(2, piecesPlaced / 40));

  if (objectiveMode === "onegood") {
    const efficiency = gainArea / Math.max(1e-9, costArea);
    const selectedNorm = inZoneArea / Math.max(1e-9, costArea);
    const inZoneEfficiency = gainArea / Math.max(1e-9, inZoneArea);
    const microHolePenalty = efficiency < objectiveMinEfficiency
      ? (objectiveMinEfficiency - efficiency) * (inTailPhase ? 4.8 : 3.2)
      : 0;
    if (phaseMode === "A") {
      return (
        3.0 * gainNorm -
        0.35 * costNorm -
        (overlapPenaltyK * 2.1) * overlapNorm -
        (outsidePenaltyK * 1.8) * outsideNorm -
        0.08 * (1 - selectedNorm) -
        Number(ctx.napPenaltyScore || 0) -
        piecePenalty
      );
    }
    if (phaseMode === "B") {
      const fragPenalty = objectiveFragmentPenalty * Math.max(0, 0.52 - efficiency);
      return (
        2.25 * gainNorm +
        0.75 * efficiency -
        1.05 * costNorm -
        (overlapPenaltyK * 2.0) * overlapNorm -
        (outsidePenaltyK * 1.8) * outsideNorm -
        0.12 * (1 - inZoneEfficiency) -
        Number(ctx.napPenaltyScore || 0) -
        piecePenalty -
        fragPenalty
      );
    }
    const fragPenalty = objectiveFragmentPenalty * Math.max(0, 0.62 - efficiency);
    return (
      1.55 * gainNorm +
      1.25 * efficiency -
      1.35 * costNorm -
      (overlapPenaltyK * 2.3) * overlapNorm -
      (outsidePenaltyK * 2.0) * outsideNorm -
      0.18 * (1 - inZoneEfficiency) -
      Number(ctx.napPenaltyScore || 0) -
      microHolePenalty -
      piecePenalty -
      fragPenalty
    );
  }

  return (
    costWeight * gainNorm -
    overlapPenaltyK * overlapNorm -
    outsidePenaltyK * outsideNorm -
    Number(ctx.napPenaltyScore || 0) -
    pieceCountPenalty -
    utilizationPenalty -
    oversizePenalty -
    piecePenalty
  );
}

module.exports = {
  scorePlacementObjective
};
