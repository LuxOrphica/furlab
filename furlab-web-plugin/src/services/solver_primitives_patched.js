"use strict";

function normalizeSeed(seed) {
  const n = Number(seed);
  if (Number.isFinite(n)) return (n >>> 0) || 1;
  const s = String(seed || "").trim();
  if (!s) return 1;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}

// Deterministic PRNG for reproducible layouts.
function createSeededRng(seed) {
  let x = normalizeSeed(seed);
  function nextU32() {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  }
  return {
    seed: x,
    next() {
      return nextU32() / 4294967296;
    },
    nextInt(maxExclusive) {
      const m = Math.max(1, Math.floor(Number(maxExclusive) || 1));
      return Math.floor((nextU32() / 4294967296) * m);
    },
    state() {
      return x >>> 0;
    }
  };
}

// Mandatory grid quantization contract (mm units, center-sample indexing).
function createGridSpec(zoneBBox, cellMm, padCells = 1) {
  if (!zoneBBox) return null;
  const r = Math.max(0.1, Number(cellMm) || 2);
  const pad = Math.max(0, Math.floor(Number(padCells) || 1));
  const bboxMinX = Number(zoneBBox.minX);
  const bboxMinY = Number(zoneBBox.minY);
  // Snap to exact grid line when bbox is extremely close to a multiple of r.
  // This prevents "origin jitter" caused by floating point noise in DXF/PAC parsers.
  const eps = Math.max(1e-6, r * 1e-8);
  function snapFloor(v) {
    if (!Number.isFinite(v)) return 0;
    const kRound = Math.round(v / r);
    const vRound = kRound * r;
    if (Math.abs(v - vRound) <= eps) return vRound;
    return Math.floor(v / r) * r;
  }
  const ox = snapFloor(bboxMinX);
  const oy = snapFloor(bboxMinY);
  const maxX = Number(zoneBBox.maxX) + pad * r;
  const maxY = Number(zoneBBox.maxY) + pad * r;
  const minX = Number(zoneBBox.minX) - pad * r;
  const minY = Number(zoneBBox.minY) - pad * r;
  const width = Math.max(1, Math.ceil((maxX - minX) / r));
  const height = Math.max(1, Math.ceil((maxY - minY) / r));
  const spec = {
    r,
    ox: ox - pad * r,
    oy: oy - pad * r,
    width,
    height
  };
  spec.nx = width;
  spec.ny = height;
  spec.worldToCell = function worldToCell(x, y) {
    return pointToCell(spec, x, y);
  };
  spec.cellToWorld = function cellToWorld(i, j) {
    return cellCenter(spec, i, j);
  };
  return spec;
}

function cellCenter(spec, i, j) {
  return {
    x: spec.ox + (Number(i) + 0.5) * spec.r,
    y: spec.oy + (Number(j) + 0.5) * spec.r
  };
}

function pointToCell(spec, x, y) {
  const i = Math.floor((Number(x) - spec.ox) / spec.r);
  const j = Math.floor((Number(y) - spec.oy) / spec.r);
  return { i, j };
}

module.exports = {
  createSeededRng,
  createGridSpec,
  cellCenter,
  pointToCell
};
