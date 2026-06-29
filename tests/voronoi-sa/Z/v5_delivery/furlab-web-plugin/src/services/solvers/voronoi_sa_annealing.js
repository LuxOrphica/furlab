"use strict";

const MOVES = Object.freeze({
  TRANSLATE: 0,
  ROTATE: 1,
  SWAP: 2,
  REMOVE: 3,
  ADD: 4
});

function energy(coveredCells, overlapCells, placementCount, zoneCells, sliverCount) {
  // 1000 per uncovered cell >> 100 per sliver >> 1 per piece
  // → coverage is top priority; eliminating slivers second; fewer pieces third
  return 1000 * (zoneCells - coveredCells) + 8 * overlapCells + 100 * (sliverCount || 0) + placementCount;
}

function buildUncovered(covered, zoneMask) {
  const unc = new Uint8Array(covered.length);
  for (let i = 0; i < covered.length; i++) unc[i] = zoneMask[i] & (covered[i] ^ 1);
  return unc;
}

function pickMove(rng, hasUnused, hasMultiple) {
  // v5.0 §3 R6: вращение запрещено. ROTATE убран из pickMove.
  // Перераспределение вероятностей: TRANSLATE 0.45, SWAP 0.20, REMOVE 0.15, ADD 0.20.
  const r = rng.next();
  if (r < 0.45) return MOVES.TRANSLATE;
  if (r < 0.65 && hasUnused) return MOVES.SWAP;
  if (r < 0.80 && hasMultiple) return MOVES.REMOVE;
  if (hasUnused) return MOVES.ADD;
  return MOVES.TRANSLATE;
}

module.exports = {
  MOVES,
  energy,
  buildUncovered,
  pickMove
};
