"use strict";

const polygonClipping = require("polygon-clipping");

function ringAreaAbs(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += Number(a[0] || 0) * Number(b[1] || 0) - Number(b[0] || 0) * Number(a[1] || 0);
  }
  return Math.abs(s) * 0.5;
}

function pointsToRing(points) {
  const ring = [];
  for (const p of points || []) {
    const x = Number(p && p.x);
    const y = Number(p && p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    // Round lightly to reduce numeric noise that can break boolean ops.
    ring.push([Number(x.toFixed(6)), Number(y.toFixed(6))]);
  }
  if (ring.length < 3) return [];
  const dedup = [];
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i];
    const prev = dedup[dedup.length - 1];
    if (!prev || prev[0] !== cur[0] || prev[1] !== cur[1]) dedup.push(cur);
  }
  if (dedup.length < 3) return [];
  const first = dedup[0];
  const last = dedup[dedup.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) dedup.push([first[0], first[1]]);
  if (dedup.length < 4) return [];
  return dedup;
}

function pointsToMultiPolygon(points) {
  const ring = pointsToRing(points);
  if (ring.length < 4) return [];
  return [[[...ring]]];
}

function normalizeMultiPolygon(mp) {
  if (!Array.isArray(mp)) return [];
  const out = [];
  for (const poly of mp) {
    if (!Array.isArray(poly) || poly.length === 0) continue;
    const rings = [];
    for (const r of poly) {
      if (!Array.isArray(r) || r.length < 4) continue;
      const clean = [];
      for (const p of r) {
        const x = Number(p && p[0]);
        const y = Number(p && p[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        clean.push([Number(x.toFixed(6)), Number(y.toFixed(6))]);
      }
      if (clean.length < 4) continue;
      const f = clean[0];
      const l = clean[clean.length - 1];
      if (f[0] !== l[0] || f[1] !== l[1]) clean.push([f[0], f[1]]);
      if (clean.length < 4) continue;
      if (ringAreaAbs(clean) <= 1e-9) continue;
      rings.push(clean);
    }
    if (rings.length) out.push(rings);
  }
  return out;
}

function safeOp(fallback, fn) {
  try {
    return normalizeMultiPolygon(fn());
  } catch (_) {
    return fallback;
  }
}

function multiPolygonArea(mp) {
  const multi = normalizeMultiPolygon(mp);
  let total = 0;
  for (const poly of multi) {
    if (!Array.isArray(poly) || poly.length === 0) continue;
    // polygon-clipping keeps outer ring first, then holes.
    const outer = ringAreaAbs(poly[0] || []);
    let holes = 0;
    for (let i = 1; i < poly.length; i++) holes += ringAreaAbs(poly[i] || []);
    total += Math.max(0, outer - holes);
  }
  return total;
}

function unionMulti(a, b) {
  if ((!a || a.length === 0) && (!b || b.length === 0)) return [];
  if (!a || a.length === 0) return normalizeMultiPolygon(b);
  if (!b || b.length === 0) return normalizeMultiPolygon(a);
  const na = normalizeMultiPolygon(a);
  const nb = normalizeMultiPolygon(b);
  return safeOp(na, () => polygonClipping.union(na, nb));
}

function intersectMulti(a, b) {
  if (!a || a.length === 0 || !b || b.length === 0) return [];
  const na = normalizeMultiPolygon(a);
  const nb = normalizeMultiPolygon(b);
  if (!na.length || !nb.length) return [];
  return safeOp([], () => polygonClipping.intersection(na, nb));
}

function diffMulti(a, b) {
  if (!a || a.length === 0) return [];
  if (!b || b.length === 0) return normalizeMultiPolygon(a);
  const na = normalizeMultiPolygon(a);
  const nb = normalizeMultiPolygon(b);
  if (!na.length) return [];
  if (!nb.length) return na;
  // If boolean kernel fails on a pathological contour, keep previous residual.
  return safeOp(na, () => polygonClipping.difference(na, nb));
}

function largestOuterRingPoints(mp) {
  const multi = normalizeMultiPolygon(mp);
  let best = null;
  let bestArea = 0;
  for (const poly of multi) {
    const ring = Array.isArray(poly) ? poly[0] : null;
    if (!Array.isArray(ring) || ring.length < 4) continue;
    const a = ringAreaAbs(ring);
    if (a > bestArea) {
      bestArea = a;
      best = ring;
    }
  }
  if (!best) return [];
  const out = [];
  const max = best.length - 1; // skip duplicated closing vertex
  for (let i = 0; i < max; i++) {
    const p = best[i];
    out.push({ x: Number(p[0]), y: Number(p[1]) });
  }
  return out;
}

function residualAnchors(mp) {
  const multi = normalizeMultiPolygon(mp);
  const anchors = [];
  for (const poly of multi) {
    const ring = Array.isArray(poly) ? poly[0] : null;
    if (!Array.isArray(ring) || ring.length < 4) continue;
    let sx = 0;
    let sy = 0;
    let cnt = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      sx += Number(ring[i][0]);
      sy += Number(ring[i][1]);
      cnt += 1;
    }
    if (cnt > 0) anchors.push({ x: sx / cnt, y: sy / cnt });
    const step = Math.max(1, Math.floor((ring.length - 1) / 10));
    for (let i = 0; i < ring.length - 1; i += step) {
      anchors.push({ x: Number(ring[i][0]), y: Number(ring[i][1]) });
    }
  }
  return anchors;
}

module.exports = {
  pointsToMultiPolygon,
  multiPolygonArea,
  unionMulti,
  intersectMulti,
  diffMulti,
  largestOuterRingPoints,
  residualAnchors
};
