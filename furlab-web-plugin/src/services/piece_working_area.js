"use strict";

const ClipperLib = require("clipper-lib");

function ringAreaSigned(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += Number(a.x || 0) * Number(b.y || 0) - Number(b.x || 0) * Number(a.y || 0);
  }
  return s * 0.5;
}

function pointsToClipperPath(points, scale) {
  const out = [];
  for (const p of Array.isArray(points) ? points : []) {
    const x = Number(p && p.x);
    const y = Number(p && p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ X: Math.round(x * scale), Y: Math.round(y * scale) });
  }
  if (out.length < 3) return [];
  const dedup = [];
  for (let i = 0; i < out.length; i++) {
    const cur = out[i];
    const prev = dedup[dedup.length - 1];
    if (!prev || prev.X !== cur.X || prev.Y !== cur.Y) dedup.push(cur);
  }
  if (dedup.length >= 2) {
    const first = dedup[0];
    const last = dedup[dedup.length - 1];
    if (first.X === last.X && first.Y === last.Y) dedup.pop();
  }
  return dedup.length >= 3 ? dedup : [];
}

function clipperPathToPoints(path, scale) {
  if (!Array.isArray(path) || path.length < 3) return [];
  return path.map((p) => ({ x: Number(p.X) / scale, y: Number(p.Y) / scale }));
}

function insetPathBest(cleanedPath, reserveMm, scale) {
  const reserve = Number.isFinite(Number(reserveMm)) ? Math.max(0, Number(reserveMm)) : 0;
  if (!(reserve > 1e-9)) return [];
  const co = new ClipperLib.ClipperOffset(2, 0.25 * scale);
  co.AddPath(cleanedPath, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const out = new ClipperLib.Paths();
  co.Execute(out, -reserve * scale);
  if (!Array.isArray(out) || !out.length) return [];
  let best = null;
  let bestArea = 0;
  for (const path of out) {
    const pts = clipperPathToPoints(path, scale);
    if (pts.length < 3) continue;
    const area = Math.abs(ringAreaSigned(pts));
    if (area > bestArea) {
      bestArea = area;
      best = pts;
    }
  }
  return (best && best.length >= 3 && bestArea > 1e-9) ? best : [];
}

function outsetPath(points, reserveMm) {
  const src = Array.isArray(points) ? points : [];
  const reserve = Number.isFinite(Number(reserveMm)) ? Math.max(0, Number(reserveMm)) : 0;
  if (src.length < 3 || !(reserve > 1e-9)) return src.length >= 3 ? src : [];
  const scale = 1000;
  const raw = pointsToClipperPath(src, scale);
  if (raw.length < 3) return src;
  const cleaned = ClipperLib.Clipper.CleanPolygon(raw, 2);
  if (!Array.isArray(cleaned) || cleaned.length < 3) return src;
  const co = new ClipperLib.ClipperOffset(2, 0.25 * scale);
  co.AddPath(cleaned, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const out = new ClipperLib.Paths();
  co.Execute(out, reserve * scale);
  if (!Array.isArray(out) || !out.length) return src;
  let best = null;
  let bestArea = 0;
  for (const path of out) {
    const pts = clipperPathToPoints(path, scale);
    if (pts.length < 3) continue;
    const area = Math.abs(ringAreaSigned(pts));
    if (area > bestArea) { bestArea = area; best = pts; }
  }
  return (best && best.length >= 3) ? best : src;
}

function buildPieceWorkingContour(points, reserveMm) {
  const src = Array.isArray(points) ? points.slice() : [];
  const reserve = Number.isFinite(Number(reserveMm)) ? Math.max(0, Number(reserveMm)) : 0;
  if (src.length < 3) {
    return { contour: [], reserveMm: reserve, applied: false, status: "invalid_input" };
  }
  if (!(reserve > 1e-9)) {
    return { contour: src, reserveMm: 0, applied: false, status: "no_reserve" };
  }

  const scale = 1000;
  const raw = pointsToClipperPath(src, scale);
  if (raw.length < 3) {
    return { contour: src, reserveMm: reserve, applied: false, status: "invalid_input" };
  }
  const cleaned = ClipperLib.Clipper.CleanPolygon(raw, 2);
  if (!Array.isArray(cleaned) || cleaned.length < 3) {
    return { contour: src, reserveMm: reserve, applied: false, status: "clean_failed" };
  }

  const bestAtRequested = insetPathBest(cleaned, reserve, scale);
  if (bestAtRequested.length >= 3) {
    return { contour: bestAtRequested, reserveMm: reserve, applied: true, status: "ok" };
  }

  // If requested reserve collapses geometry, pick maximum feasible reserve.
  let lo = 0;
  let hi = reserve;
  let best = [];
  let bestReserve = 0;
  for (let i = 0; i < 14; i += 1) {
    const mid = (lo + hi) * 0.5;
    const candidate = insetPathBest(cleaned, mid, scale);
    if (candidate.length >= 3) {
      best = candidate;
      bestReserve = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  if (best.length >= 3 && bestReserve > 1e-6) {
    return { contour: best, reserveMm: bestReserve, applied: true, status: "reserve_clamped" };
  }
  return { contour: src, reserveMm: reserve, applied: false, status: "reserve_too_large" };
}

function applyReserveToPlacements(placements, reserveMm) {
  const reserve = Number.isFinite(Number(reserveMm)) ? Math.max(0, Number(reserveMm)) : 0;
  if (!(reserve > 1e-9)) {
    return {
      placements: Array.isArray(placements) ? placements.slice() : [],
      reserveMm: 0,
      changed: 0,
      failed: 0
    };
  }
  let changed = 0;
  let failed = 0;
  const out = [];
  for (const p of Array.isArray(placements) ? placements : []) {
    const contour = Array.isArray(p && p.alignedContour) ? p.alignedContour : [];
    if (contour.length < 3) {
      out.push(p);
      continue;
    }
    const wrk = buildPieceWorkingContour(contour, reserve);
    if (wrk.applied && Array.isArray(wrk.contour) && wrk.contour.length >= 3) {
      changed += 1;
      // Keep original full contour as alignedFullContour; replace alignedContour with core
      // so buildVisibleMosaicModel uses eroded geometry for coverage metrics.
      out.push({ ...p, alignedFullContour: contour, alignedCoreContour: wrk.contour, alignedContour: wrk.contour, seamStatus: "ok", seamReserveMm: reserve });
    } else {
      failed += 1;
      out.push({ ...p, alignedFullContour: contour, seamStatus: String(wrk.status || "failed"), seamReserveMm: reserve });
    }
  }
  return { placements: out, reserveMm: reserve, changed, failed };
}

module.exports = {
  buildPieceWorkingContour,
  applyReserveToPlacements,
  outsetPath
};
