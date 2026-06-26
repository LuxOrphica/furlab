"use strict";

function wrapSignedDeg(v) {
  let x = Number(v || 0);
  while (x > 180) x -= 360;
  while (x <= -180) x += 360;
  return x;
}

function computeNapDeviation(targetDeg, rotatedDeg, allowFlip, deps) {
  const deltaDeg = deps && deps.deltaDeg;
  const normalizeDeg = deps && deps.normalizeDeg;
  if (typeof deltaDeg !== "function" || typeof normalizeDeg !== "function") return null;
  const d0 = deltaDeg(targetDeg, rotatedDeg);
  if (d0 === null) return null;
  if (!allowFlip) return d0;
  const d180 = deltaDeg(targetDeg, normalizeDeg(Number(rotatedDeg || 0) + 180));
  if (d180 === null) return d0;
  return Math.abs(d0) <= Math.abs(d180) ? d0 : d180;
}

module.exports = {
  wrapSignedDeg,
  computeNapDeviation
};
