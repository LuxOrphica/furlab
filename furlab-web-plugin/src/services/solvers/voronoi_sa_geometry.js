"use strict";

const ClipperLib = require("clipper-lib");

function createVoronoiSaGeometry(deps) {
  const clipperScale = deps.clipperScale || 1000;
  const pointsToMultiPolygon = deps.pointsToMultiPolygon;
  const intersectMulti = deps.intersectMulti;
  const multiPolygonArea = deps.multiPolygonArea;

  function transformPiece(centeredPts, angleDeg, tx, ty) {
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return centeredPts.map((p) => ({
      x: p.x * cos - p.y * sin + tx,
      y: p.x * sin + p.y * cos + ty
    }));
  }

  function pointInPolygon(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x;
      const yi = pts[i].y;
      const xj = pts[j].x;
      const yj = pts[j].y;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function toClipper(pts) {
    return pts.map((p) => ({
      X: Math.round(p.x * clipperScale),
      Y: Math.round(p.y * clipperScale)
    }));
  }

  function fromClipper(path) {
    return path.map((p) => ({ x: p.X / clipperScale, y: p.Y / clipperScale }));
  }

  function inflateZonePts(zonePts, offsetMm) {
    if (!offsetMm || offsetMm <= 0) return zonePts;
    try {
      const co = new ClipperLib.ClipperOffset();
      co.AddPath(toClipper(zonePts), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
      const sol = new ClipperLib.Paths();
      co.Execute(sol, Math.round(offsetMm * clipperScale));
      if (!sol || !sol.length) return zonePts;
      let best = null;
      let bestArea = 0;
      for (const p of sol) {
        const a = Math.abs(ClipperLib.Clipper.Area(p));
        if (a > bestArea) {
          bestArea = a;
          best = p;
        }
      }
      return best ? fromClipper(best) : zonePts;
    } catch (_) {
      return zonePts;
    }
  }

  function computeIFP(zonePts, centeredPts) {
    try {
      const paths = ClipperLib.Clipper.MinkowskiDiff(toClipper(zonePts), toClipper(centeredPts));
      if (!paths || paths.length === 0) return null;
      let best = null;
      let bestArea = 0;
      for (const path of paths) {
        const a = Math.abs(ClipperLib.Clipper.Area(path));
        if (a > bestArea) {
          bestArea = a;
          best = path;
        }
      }
      if (!best || best.length < 3) return null;
      return fromClipper(best);
    } catch (_) {
      return null;
    }
  }

  function sampleInPoly(poly, bbox, rng) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const x = bbox.minX + rng.next() * (bbox.maxX - bbox.minX);
      const y = bbox.minY + rng.next() * (bbox.maxY - bbox.minY);
      if (pointInPolygon(x, y, poly)) return { x, y };
    }
    return null;
  }

  function mpToPoints(mp) {
    if (!Array.isArray(mp) || !mp.length) return [];
    const poly = mp[0];
    if (!Array.isArray(poly) || !poly.length) return [];
    const ring = poly[0];
    if (!Array.isArray(ring) || ring.length < 4) return [];
    const pts = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const x = Number(ring[i][0]);
      const y = Number(ring[i][1]);
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
    }
    return pts.length >= 3 ? pts : [];
  }

  function ringAreaSigned(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      s += Number(a.x) * Number(b.y) - Number(b.x) * Number(a.y);
    }
    return s * 0.5;
  }

  function offsetContourInward(pts, offsetMm) {
    if (!pts || pts.length < 3 || offsetMm <= 0) return pts;
    const path = toClipper(pts);
    if (ringAreaSigned(pts) < 0) path.reverse();
    const co = new ClipperLib.ClipperOffset(2, 0.25 * clipperScale);
    co.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const out = new ClipperLib.Paths();
    co.Execute(out, -offsetMm * clipperScale);
    if (!out || !out.length) return [];
    const best = out.reduce((a, b) => (b.length > a.length ? b : a), out[0]);
    const result = fromClipper(best);
    return result.length >= 3 ? result : [];
  }

  function sealFragment(fragPts, placementIdx, placements) {
    if (!fragPts || fragPts.length < 3) return fragPts;
    const pl = placements[placementIdx];
    // Lloyd-tiling territories must not be clipped to piece body
    if (pl && pl._lloydTile) return fragPts;
    if (!pl || !pl.corePts || pl.corePts.length < 3) return fragPts;
    try {
      const ci = new ClipperLib.Clipper();
      ci.AddPath(toClipper(fragPts), ClipperLib.PolyType.ptSubject, true);
      ci.AddPath(toClipper(pl.corePts), ClipperLib.PolyType.ptClip, true);
      const iSol = new ClipperLib.Paths();
      ci.Execute(
        ClipperLib.ClipType.ctIntersection,
        iSol,
        ClipperLib.PolyFillType.pftNonZero,
        ClipperLib.PolyFillType.pftNonZero
      );
      const best = (iSol || []).reduce((b, p) =>
        Math.abs(ClipperLib.Clipper.Area(p)) > Math.abs(ClipperLib.Clipper.Area(b)) ? p : b, iSol[0]);
      if (!best) return fragPts;
      const clipped = fromClipper(best);
      return clipped.length >= 3 ? clipped : fragPts;
    } catch (_) {
      return fragPts;
    }
  }

  function coreFragmentForTerritory(territoryPts, placementIdx, placements) {
    if (!territoryPts || territoryPts.length < 3) return [];
    const pl = placementIdx != null ? placements[placementIdx] : null;
    // Lloyd-tiling: territory IS the fragment — no core clipping
    if (pl && pl._lloydTile) return territoryPts;
    if (!pl || !pl.corePts || pl.corePts.length < 3) return [];
    try {
      const coreMp = intersectMulti(pointsToMultiPolygon(pl.corePts), pointsToMultiPolygon(territoryPts));
      return coreMp && multiPolygonArea(coreMp) >= 1 ? mpToPoints(coreMp) : [];
    } catch (_) {
      return [];
    }
  }

  return {
    transformPiece,
    pointInPolygon,
    inflateZonePts,
    computeIFP,
    sampleInPoly,
    mpToPoints,
    ringAreaSigned,
    offsetContourInward,
    sealFragment,
    coreFragmentForTerritory
  };
}

module.exports = { createVoronoiSaGeometry };
