"use strict";

function runPhaseBLloyd(args) {
  const placements = args.placements;
  const spec = args.spec;
  const zoneMask = args.zoneMask;
  const selectedPieces = args.selectedPieces;
  const napTarget = args.napTarget;
  const napTol = args.napTol;
  const deadline = args.deadline;
  const makePlacement = args.makePlacement;
  const computePowerAssign = args.computePowerAssign;

  void napTarget;
  void napTol;

  const { nx, r, ox, oy } = spec;
  const cellCount = nx * spec.ny;
  const startB = Date.now();

  const weights = placements.map((pl) => {
    const piece = selectedPieces.find((p) => p.id === pl.id);
    return piece ? piece.areaMm2 / Math.PI : 1;
  });

  let lloydIterations = 0;
  let weightAdaptationCycles = 0;
  let notContainedStart = -1;
  let prevNotContained = Infinity;
  let exitReason = "converged";

  const cellCoverCount = new Int32Array(cellCount);
  for (const pl of placements) {
    if (!pl.mask) continue;
    for (let i = 0; i < cellCount; i++) if (zoneMask[i] && (pl.mask[i] & 1)) cellCoverCount[i]++;
  }

  while (Date.now() < deadline) {
    const powerAssign = computePowerAssign(placements, weights, spec, zoneMask);

    const notContained = new Int32Array(placements.length);
    const powerCellCount = new Int32Array(placements.length);
    for (let idx = 0; idx < cellCount; idx++) {
      if (!zoneMask[idx]) continue;
      const j = powerAssign[idx];
      if (j < 0) continue;
      powerCellCount[j]++;
      if (!placements[j].mask || !(placements[j].mask[idx] & 1)) notContained[j]++;
    }
    const notContainedTotal = notContained.reduce((s, v) => s + v, 0);
    if (notContainedStart < 0) notContainedStart = notContainedTotal;

    if (lloydIterations > 0 && Math.abs(prevNotContained - notContainedTotal) < 1) break;
    prevNotContained = notContainedTotal;

    for (let j = 0; j < placements.length; j++) {
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      for (let idx = 0; idx < cellCount; idx++) {
        if (powerAssign[idx] !== j) continue;
        sumX += ox + (idx % nx + 0.5) * r;
        sumY += oy + ((idx / nx | 0) + 0.5) * r;
        count++;
      }
      if (count === 0) continue;
      const cellCx = sumX / count;
      const cellCy = sumY / count;

      const newCx = placements[j].cx + 0.5 * (cellCx - placements[j].cx);
      const newCy = placements[j].cy + 0.5 * (cellCy - placements[j].cy);

      const piece = selectedPieces.find((p) => p.id === placements[j].id);
      if (!piece) continue;

      const newPl = makePlacement(piece, newCx, newCy, placements[j].angleDeg, spec, zoneMask);
      const oldMask = placements[j].mask;

      let wouldUncoverAny = false;
      for (let i = 0; i < cellCount; i++) {
        if (!zoneMask[i]) continue;
        if ((oldMask[i] & 1) && !(newPl.mask[i] & 1) && cellCoverCount[i] === 1) {
          wouldUncoverAny = true;
          break;
        }
      }
      if (wouldUncoverAny) continue;

      for (let i = 0; i < cellCount; i++) {
        if (!zoneMask[i]) continue;
        if ((oldMask[i] & 1) && !(newPl.mask[i] & 1)) cellCoverCount[i]--;
        if (!(oldMask[i] & 1) && (newPl.mask[i] & 1)) cellCoverCount[i]++;
      }
      placements[j] = newPl;
    }

    const powerAssign2 = computePowerAssign(placements, weights, spec, zoneMask);
    const notContained2 = new Int32Array(placements.length);
    const powerCellCount2 = new Int32Array(placements.length);
    for (let idx = 0; idx < cellCount; idx++) {
      if (!zoneMask[idx]) continue;
      const j = powerAssign2[idx];
      if (j < 0) continue;
      powerCellCount2[j]++;
      if (!placements[j].mask || !(placements[j].mask[idx] & 1)) notContained2[j]++;
    }
    for (let j = 0; j < placements.length; j++) {
      const piece = selectedPieces.find((p) => p.id === placements[j].id);
      const areaReal = piece ? piece.areaMm2 : weights[j] * Math.PI;
      if (notContained2[j] > 0) {
        weights[j] *= 0.9;
      } else {
        const powerCellArea = powerCellCount2[j] * r * r;
        if (powerCellArea < areaReal * 0.5) weights[j] *= 1.05;
      }
    }
    weightAdaptationCycles++;
    lloydIterations++;

    if (Date.now() >= deadline) {
      exitReason = "timeout";
      break;
    }
  }

  const finalPowerAssign = computePowerAssign(placements, weights, spec, zoneMask);
  let notContainedEnd = 0;
  for (let idx = 0; idx < cellCount; idx++) {
    if (!zoneMask[idx]) continue;
    const j = finalPowerAssign[idx];
    if (j >= 0 && placements[j].mask && !(placements[j].mask[idx] & 1)) notContainedEnd++;
  }

  return {
    timeMs: Date.now() - startB,
    lloydIterations,
    exitReason,
    notContainedTotal_start: notContainedStart < 0 ? 0 : notContainedStart,
    notContainedTotal_end: notContainedEnd,
    weightAdaptationCycles,
    finalWeights: weights
  };
}

module.exports = { runPhaseBLloyd };
