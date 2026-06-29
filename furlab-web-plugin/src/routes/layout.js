"use strict";

const fs = require("fs");
const path = require("path");

const {
  pointsToMultiPolygon,
  intersectMulti,
  multiPolygonArea,
  unionMulti,
  diffMulti
} = require("../services/polygon_ops");
const {
  buildPieceWorkingContour,
  applyReserveToPlacements
} = require("../services/piece_working_area");
const { createModeRegistry } = require("../modes/registry");
const { parsePreviewWrapperRequest } = require("../modes/wrapper");

function envMs(name, fallback, min, max) {
  const raw = Number(process.env[name]);
  const value = Number.isFinite(raw) ? raw : fallback;
  return Math.max(min, Math.min(max, value));
}

const DIRECT_INVENTORY_SOFT_CAP_MS = envMs("FURLAB_DIRECT_SOLVE_MAX_MS", 60000, 5000, 180000);
const DIRECT_INVENTORY_HARD_CAP_MS = Math.max(
  DIRECT_INVENTORY_SOFT_CAP_MS,
  envMs("FURLAB_DIRECT_SOLVE_HARD_MAX_MS", 90000, 5000, 240000)
);

function clampSolveMs(value, fallback, min, max) {
  const raw = Number(value);
  const next = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  return Math.max(min, Math.min(max, next));
}

function polygonBBox(points) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points || []) {
    const x = Number(p && p.x);
    const y = Number(p && p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const ax = Number(a && a.x);
    const ay = Number(a && a.y);
    const bx = Number(b && b.x);
    const by = Number(b && b.y);
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
    sum += ax * by - bx * ay;
  }
  return Math.abs(sum) * 0.5;
}

function cleanClosedPolygon(points, options) {
  const cfg = options && typeof options === "object" ? options : {};
  const minEdgeMm = Math.max(0.1, Number(cfg.minEdgeMm || 6));
  const spikeEdgeMm = Math.max(minEdgeMm, Number(cfg.spikeEdgeMm || 14));
  const spikeAngleDeg = Math.max(5, Math.min(90, Number(cfg.spikeAngleDeg || 32)));
  const collinearEpsMm = Math.max(0.05, Number(cfg.collinearEpsMm || 1.2));
  const maxIters = Math.max(1, Math.min(12, Number(cfg.maxIters || 6)));

  let pts = (Array.isArray(points) ? points : [])
    .map((p) => ({ x: Number(p && p.x), y: Number(p && p.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 3) return pts;

  // Drop consecutive duplicates and duplicate closing point.
  const dedup = [];
  for (const p of pts) {
    const prev = dedup[dedup.length - 1];
    if (!prev || Math.hypot(prev.x - p.x, prev.y - p.y) > 1e-6) dedup.push(p);
  }
  pts = dedup;
  if (pts.length >= 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6) pts.pop();
  }
  if (pts.length < 3) return pts;

  function pointLineDistance(p, a, b) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const wx = p.x - a.x;
    const wy = p.y - a.y;
    const len2 = vx * vx + vy * vy;
    if (len2 <= 1e-12) return Math.hypot(wx, wy);
    const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
    const px = a.x + t * vx;
    const py = a.y + t * vy;
    return Math.hypot(p.x - px, p.y - py);
  }

  for (let iter = 0; iter < maxIters; iter++) {
    let changed = false;
    if (pts.length < 4) break;
    for (let i = 0; i < pts.length; i++) {
      const n = pts.length;
      const prev = pts[(i - 1 + n) % n];
      const cur = pts[i];
      const next = pts[(i + 1) % n];
      const lenPrev = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      const lenNext = Math.hypot(next.x - cur.x, next.y - cur.y);
      if (lenPrev <= 1e-9 || lenNext <= 1e-9) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
      // Remove very short edges first.
      if (lenPrev < minEdgeMm || lenNext < minEdgeMm) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
      const ux = prev.x - cur.x;
      const uy = prev.y - cur.y;
      const vx = next.x - cur.x;
      const vy = next.y - cur.y;
      const du = Math.hypot(ux, uy);
      const dv = Math.hypot(vx, vy);
      const cosA = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / Math.max(1e-9, du * dv)));
      const angleDeg = Math.acos(cosA) * 180 / Math.PI;
      // Short sharp corner -> likely spike tip.
      if (angleDeg < spikeAngleDeg && (lenPrev < spikeEdgeMm || lenNext < spikeEdgeMm)) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
      // Nearly collinear small wobble.
      const dLine = pointLineDistance(cur, prev, next);
      if (angleDeg > 168 && dLine < collinearEpsMm) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return pts.length >= 3 ? pts : (Array.isArray(points) ? points : []);
}

function pointInPolygon(point, polygon) {
  let inside = false;
  const x = Number(point && point.x);
  const y = Number(point && point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = Number(polygon[i] && polygon[i].x);
    const yi = Number(polygon[i] && polygon[i].y);
    const xj = Number(polygon[j] && polygon[j].x);
    const yj = Number(polygon[j] && polygon[j].y);
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) continue;
    const cross = yi > y !== yj > y;
    if (!cross) continue;
    const atX = ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi;
    if (x < atX) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(a, b, c, d) {
  function orient(p, q, r) {
    return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  }
  function onSeg(p, q, r) {
    return (
      Math.min(p.x, r.x) - 1e-9 <= q.x && q.x <= Math.max(p.x, r.x) + 1e-9 &&
      Math.min(p.y, r.y) - 1e-9 <= q.y && q.y <= Math.max(p.y, r.y) + 1e-9
    );
  }
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (Math.abs(o1) <= 1e-9 && onSeg(a, c, b)) return true;
  if (Math.abs(o2) <= 1e-9 && onSeg(a, d, b)) return true;
  if (Math.abs(o3) <= 1e-9 && onSeg(c, a, d)) return true;
  if (Math.abs(o4) <= 1e-9 && onSeg(c, b, d)) return true;
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function polygonsIntersect(polyA, polyB, bbA, bbB) {
  if (!bbA || !bbB) return false;
  if (
    bbA.maxX < bbB.minX || bbB.maxX < bbA.minX ||
    bbA.maxY < bbB.minY || bbB.maxY < bbA.minY
  ) return false;
  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i];
    const a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j];
      const b2 = polyB[(j + 1) % polyB.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  if (pointInPolygon(polyA[0], polyB)) return true;
  if (pointInPolygon(polyB[0], polyA)) return true;
  return false;
}

function placementPrimaryContour(p, opts) {
  const cfg = opts && typeof opts === "object" ? opts : {};
  const preferInZone = !!cfg.preferInZoneContours;
  const candidates = preferInZone
    ? [p && p.inZoneCoreContour, p && p.inZoneContour, p && p.alignedCoreContour, p && p.alignedContour]
    : [p && p.alignedContour, p && p.alignedCoreContour, p && p.inZoneContour, p && p.inZoneCoreContour];
  for (const raw of candidates) {
    if (!Array.isArray(raw)) continue;
    const poly = raw
      .map((q) => ({ x: Number(q && q.x), y: Number(q && q.y) }))
      .filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
    if (poly.length >= 3) return poly;
  }
  return [];
}

function countPlacementIntersections(placements, options) {
  const cfg = options && typeof options === "object" ? options : {};
  const polys = (Array.isArray(placements) ? placements : [])
    .filter((p) => p && String(p.status || "") === "matched")
    .map((p) => {
      const poly = placementPrimaryContour(p, cfg);
      if (poly.length < 3) return null;
      const bb = polygonBBox(poly);
      if (!bb) return null;
      return { poly, bb };
    })
    .filter(Boolean);
  let count = 0;
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      if (!polygonsIntersect(polys[i].poly, polys[j].poly, polys[i].bb, polys[j].bb)) continue;
      if (cfg.preferInZoneContours) {
        try {
          const inter = intersectMulti(pointsToMultiPolygon(polys[i].poly), pointsToMultiPolygon(polys[j].poly));
          const area = Math.max(0, multiPolygonArea(inter));
          if (area > Math.max(0.01, Number(cfg.minOverlapAreaMm2 || 1))) count += 1;
        } catch (_) {}
      } else {
        count += 1;
      }
    }
  }
  return count;
}

function ringAreaAbs(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  let sum = 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const ax = Number(a && a[0]);
    const ay = Number(a && a[1]);
    const bx = Number(b && b[0]);
    const by = Number(b && b[1]);
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
    sum += ax * by - bx * ay;
  }
  return Math.abs(sum) * 0.5;
}

function multiToOuterPolygons(mp, opts) {
  const cfg = opts && typeof opts === "object" ? opts : {};
  const minAreaMm2 = Math.max(0.01, Number(cfg.minAreaMm2 || 1));
  const maxPolygons = Math.max(20, Math.min(1200, Number(cfg.maxPolygons || 500)));
  const out = [];
  for (const poly of Array.isArray(mp) ? mp : []) {
    if (!Array.isArray(poly) || poly.length === 0) continue;
    const outer = Array.isArray(poly[0]) ? poly[0] : null;
    if (!Array.isArray(outer) || outer.length < 4) continue;
    const areaMm2 = ringAreaAbs(outer);
    if (!Number.isFinite(areaMm2) || areaMm2 < minAreaMm2) continue;
    const pts = [];
    for (let i = 0; i < outer.length - 1; i++) {
      const x = Number(outer[i] && outer[i][0]);
      const y = Number(outer[i] && outer[i][1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push({ x, y });
    }
    if (pts.length < 3) continue;
    out.push({
      id: out.length + 1,
      areaMm2: Math.round(areaMm2 * 1000) / 1000,
      points: pts
    });
    if (out.length >= maxPolygons) break;
  }
  return out;
}

function buildPieceIntersectionsLayer(placements, options) {
  const cfg = options && typeof options === "object" ? options : {};
  const maxPairChecks = Math.max(200, Math.min(20000, Number(cfg.maxPairChecks || 6000)));
  const maxPolygons = Math.max(20, Math.min(1200, Number(cfg.maxPolygons || 500)));
  const minAreaMm2 = Math.max(0.01, Number(cfg.minAreaMm2 || 1));

  const prepared = (Array.isArray(placements) ? placements : [])
    .filter((p) => p && String(p.status || "") === "matched")
    .map((p) => {
      const id = Number(p.fragmentId || 0);
      const points = placementPrimaryContour(p, cfg);
      if (points.length < 3) return null;
      const bbox = polygonBBox(points);
      if (!bbox) return null;
      const mp = pointsToMultiPolygon(points);
      if (!Array.isArray(mp) || mp.length === 0) return null;
      return { id, points, bbox, mp };
    })
    .filter(Boolean);

  const polygons = [];
  const seen = new Set();
  let pairChecks = 0;
  let pairCount = 0;
  let totalAreaMm2 = 0;
  let visibleUnion = [];

  for (let i = 0; i < prepared.length; i++) {
    const a = prepared[i];
    for (let j = i + 1; j < prepared.length; j++) {
      if (pairChecks >= maxPairChecks || polygons.length >= maxPolygons) break;
      pairChecks += 1;
      const b = prepared[j];
      if (
        a.bbox.maxX < b.bbox.minX || b.bbox.maxX < a.bbox.minX ||
        a.bbox.maxY < b.bbox.minY || b.bbox.maxY < a.bbox.minY
      ) {
        continue;
      }
      const inter = intersectMulti(a.mp, b.mp);
      if (!Array.isArray(inter) || inter.length === 0) continue;
      pairCount += 1;
      visibleUnion = visibleUnion.length ? unionMulti(visibleUnion, inter) : inter;

      for (const poly of inter) {
        if (!Array.isArray(poly) || poly.length === 0) continue;
        const outer = Array.isArray(poly[0]) ? poly[0] : null;
        if (!Array.isArray(outer) || outer.length < 4) continue;
        const areaMm2 = multiPolygonArea([poly]);
        if (!Number.isFinite(areaMm2) || areaMm2 < minAreaMm2) continue;

        const pts = [];
        for (let k = 0; k < outer.length - 1; k++) {
          const x = Number(outer[k] && outer[k][0]);
          const y = Number(outer[k] && outer[k][1]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          pts.push({ x, y });
        }
        if (pts.length < 3) continue;
        const bb = polygonBBox(pts);
        if (!bb) continue;
        const key = [
          Math.round(bb.minX),
          Math.round(bb.minY),
          Math.round(bb.maxX),
          Math.round(bb.maxY),
          Math.round(areaMm2)
        ].join("|");
        if (seen.has(key)) continue;
        seen.add(key);

        polygons.push({
          id: polygons.length + 1,
          pairFragmentIds: [a.id, b.id],
          areaMm2: Math.round(areaMm2 * 1000) / 1000,
          points: pts
        });
        totalAreaMm2 += areaMm2;
        if (polygons.length >= maxPolygons) break;
      }
    }
    if (pairChecks >= maxPairChecks || polygons.length >= maxPolygons) break;
  }

  return {
    pairChecks,
    pairCount,
    totalAreaMm2: Math.round(totalAreaMm2 * 1000) / 1000,
    polygons,
    visibleAreaPolygons: multiToOuterPolygons(visibleUnion, { minAreaMm2, maxPolygons }),
    visibleAreaAreaMm2: Math.round(multiPolygonArea(visibleUnion) * 1000) / 1000
  };
}

function fragmentCentroid(pts) {
  let sx = 0, sy = 0, n = 0;
  for (const p of (Array.isArray(pts) ? pts : [])) {
    const x = Number(p && p.x), y = Number(p && p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sx += x; sy += y; n++;
  }
  return n > 0 ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
}

// Merge fragments below the size threshold into the nearest large neighbor.
// Small clipping slivers are the result of piece-overlap boolean ops and should not appear in the cut list.
function mergeSmallVisibleFragments(fragments, minW, minL, axis) {
  if ((!minW || minW <= 0) && (!minL || minL <= 0)) return fragments;
  function isSmall(f) {
    const bb = polygonBBox(f.points);
    if (!bb) return true;
    const along = axis === "x" ? bb.width : bb.height;
    const across = axis === "x" ? bb.height : bb.width;
    if (minL > 0 && along < minL) return true;
    if (minW > 0 && across < minW) return true;
    return false;
  }
  const large = [];
  const small = [];
  for (const f of fragments) {
    if (!Array.isArray(f.points) || f.points.length < 3) continue;
    (isSmall(f) ? small : large).push(f);
  }
  if (!small.length) return fragments;
  for (const sf of small) {
    if (!large.length) { large.push(sf); continue; }
    const sc = fragmentCentroid(sf.points);
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < large.length; i++) {
      const lc = fragmentCentroid(large[i].points);
      const dx = sc.x - lc.x, dy = sc.y - lc.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const sfMp = pointsToMultiPolygon(sf.points);
    const lfMp = pointsToMultiPolygon(large[bestIdx].points);
    if (sfMp && lfMp) {
      const merged = unionMulti(sfMp, lfMp);
      const ring = largestOuterRingPointsLocal(merged);
      if (ring && ring.length >= 3) {
        large[bestIdx] = { ...large[bestIdx], points: ring, areaMm2: polygonArea(ring) };
        continue;
      }
    }
    large.push(sf); // union failed — keep as-is
  }
  return large;
}

function buildVisibleMosaicModel(placements, zonePoints, options) {
  const cfg = options && typeof options === "object" ? options : {};
  const layerPolicyRaw = String(cfg.layerPolicy || "priority_on_top").toLowerCase();
  const layerPolicy = layerPolicyRaw === "first_on_top" ? "first_on_top" : "priority_on_top";
  const geometrySource = String(cfg.geometrySource || "full").toLowerCase() === "core" ? "core" : "full";
  const useCoreGeometry = geometrySource === "core";
  const preservePerPieceFragments = !!cfg.preservePerPieceFragments;
  const minAreaMm2 = Math.max(0.01, Number(cfg.minAreaMm2 || 1));
  const maxFragments = Math.max(50, Math.min(4000, Number(cfg.maxFragments || 2000)));
  const maxPolygons = Math.max(20, Math.min(1200, Number(cfg.maxPolygons || 500)));
  const preferPlacementInZoneContours = !!cfg.preferPlacementInZoneContours;
  const contourCleanCfg = {
    minEdgeMm: Math.max(2, Number(cfg.minEdgeMm || 6)),
    spikeEdgeMm: Math.max(4, Number(cfg.spikeEdgeMm || 14)),
    spikeAngleDeg: Math.max(10, Number(cfg.spikeAngleDeg || 32)),
    collinearEpsMm: Math.max(0.2, Number(cfg.collinearEpsMm || 1.2))
  };
  const includeDebug = !!(cfg && cfg.includeDebug);
  const zoneMp = (Array.isArray(cfg.zoneDomainMp) && cfg.zoneDomainMp.length)
    ? cfg.zoneDomainMp
    : pointsToMultiPolygon(Array.isArray(zonePoints) ? zonePoints : []);
  if (!Array.isArray(zoneMp) || zoneMp.length === 0) {
    return {
      fragments: [],
      visibleContours: [],
      visibleAreaPolygons: [],
      usefulAreaMm2: 0,
      selectedPiecesAreaMm2: 0,
      selectedInZoneAreaMm2: 0,
      overlapAreaMm2: 0,
      utilizationPct: 0
    };
  }

  const matched = (Array.isArray(placements) ? placements : [])
    .map((p, placementIndex) => ({ placementIndex, p }))
    .filter((x) => x && x.p && String(x.p.status || "") === "matched")
    .map((x) => {
      const p = x.p;
      let pieceMp = [];
      let inZoneMp = [];

      if (preferPlacementInZoneContours) {
        const fromPlacementMulti = Array.isArray(useCoreGeometry ? p.inZoneCoreContours : p.inZoneContours)
          ? (useCoreGeometry ? p.inZoneCoreContours : p.inZoneContours)
          : [];
        if (Array.isArray(fromPlacementMulti) && fromPlacementMulti.length > 0) {
          inZoneMp = fromPlacementMulti;
        } else {
          const fromPlacementSingle = Array.isArray(useCoreGeometry ? p.inZoneCoreContour : p.inZoneContour)
            ? (useCoreGeometry ? p.inZoneCoreContour : p.inZoneContour)
            : [];
          inZoneMp = fromPlacementSingle.length >= 3 ? pointsToMultiPolygon(fromPlacementSingle) : [];
        }
      } else {
        // Always clip by current aligned contour first.
        // Cached inZoneContours can become stale after manual drag/rotate.
        const raw = Array.isArray(useCoreGeometry ? p.alignedCoreContour : p.alignedContour)
          ? (useCoreGeometry ? p.alignedCoreContour : p.alignedContour)
          : [];
        const points = normalizeContour(raw);
        const alignedMulti = Array.isArray(useCoreGeometry ? p.alignedCoreContours : p.alignedContours)
          ? (useCoreGeometry ? p.alignedCoreContours : p.alignedContours)
          : [];
        if (Array.isArray(alignedMulti) && alignedMulti.length > 0) {
          pieceMp = alignedMulti;
        } else if (points.length >= 3) {
          pieceMp = pointsToMultiPolygon(points);
        }
        if (Array.isArray(pieceMp) && pieceMp.length) {
          inZoneMp = intersectMulti(pieceMp, zoneMp);
          // Robust fallback for manual mode: boolean kernel may fail on noisy contours
          // and return empty intersection even when piece is visually inside zone.
          if (!Array.isArray(inZoneMp) || !inZoneMp.length) {
            const insideCount = points.reduce((acc, q) => acc + (pointInPolygon(q, zonePoints) ? 1 : 0), 0);
            const center = (() => {
              let sx = 0;
              let sy = 0;
              let n = 0;
              for (const q of points) {
                const x = Number(q && q.x);
                const y = Number(q && q.y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                sx += x;
                sy += y;
                n++;
              }
              return n > 0 ? { x: sx / n, y: sy / n } : null;
            })();
            const centerInside = center ? pointInPolygon(center, zonePoints) : false;
            // Use full piece as in-zone only when geometry strongly indicates piece is inside.
            if ((insideCount >= Math.max(3, Math.floor(points.length * 0.6))) || centerInside) {
              inZoneMp = pieceMp;
            }
          }
        }
      }

      // Fallback for legacy placements without alignedContour.
      if (!Array.isArray(inZoneMp) || !inZoneMp.length) {
        const fromPlacementMulti = Array.isArray(useCoreGeometry ? p.inZoneCoreContours : p.inZoneContours)
          ? (useCoreGeometry ? p.inZoneCoreContours : p.inZoneContours)
          : [];
        if (Array.isArray(fromPlacementMulti) && fromPlacementMulti.length > 0) {
          inZoneMp = fromPlacementMulti;
        } else {
          const fromPlacementSingle = Array.isArray(useCoreGeometry ? p.inZoneCoreContour : p.inZoneContour)
            ? (useCoreGeometry ? p.inZoneCoreContour : p.inZoneContour)
            : [];
          inZoneMp = fromPlacementSingle.length >= 3 ? pointsToMultiPolygon(fromPlacementSingle) : [];
        }
      }
      if (!Array.isArray(inZoneMp) || inZoneMp.length === 0) return null;
      const inZoneAreaMm2 = Math.max(0, multiPolygonArea(inZoneMp));
      if (inZoneAreaMm2 <= 1e-9) return null;
      const fullPieceAreaMm2 = Math.max(
        0,
        (!useCoreGeometry && Number.isFinite(Number(p.scrapAreaMm2)))
          ? Number(p.scrapAreaMm2)
          : (pieceMp.length ? multiPolygonArea(pieceMp) : inZoneAreaMm2)
      );
      return {
        placementIndex: x.placementIndex,
        p,
        inZoneMp,
        inZoneAreaMm2,
        fullPieceAreaMm2
      };
    })
    .filter(Boolean);

  const topOrder = matched
    .map((item) => {
      const area = Math.max(0, Number(item.fullPieceAreaMm2 || item.inZoneAreaMm2 || 0));
      return {
        ...item,
        _sortArea: area
      };
    })
    .sort((a, b) => {
      if (layerPolicy === "first_on_top") {
        if (a.placementIndex !== b.placementIndex) return a.placementIndex - b.placementIndex;
        return b._sortArea - a._sortArea;
      }
      if (b._sortArea !== a._sortArea) return b._sortArea - a._sortArea;
      return a.placementIndex - b.placementIndex;
    });

  let coveredAboveMp = [];
  let inZoneUnionMp = [];
  let selectedInZoneAreaMm2 = 0;
  let selectedPiecesAreaMm2 = 0;
  let visibleAreaMm2Total = 0;
  const byPlacementIndex = new Map();
  const debugPlacements = [];
  const debugFragmentFlow = [];

  // Visible part of each piece is (pieceInZone - union(of all pieces above it)).
  for (let i = 0; i < topOrder.length; i++) {
    const item = topOrder[i];
    const visibleMp = preservePerPieceFragments
      ? item.inZoneMp
      : (coveredAboveMp.length
        ? diffMulti(item.inZoneMp, coveredAboveMp)
        : item.inZoneMp);
    const visibleAreaMm2 = Math.max(0, multiPolygonArea(visibleMp));
    const overlapAreaMm2 = Math.max(0, item.inZoneAreaMm2 - visibleAreaMm2);
    coveredAboveMp = coveredAboveMp.length
      ? unionMulti(coveredAboveMp, item.inZoneMp)
      : item.inZoneMp;
    inZoneUnionMp = inZoneUnionMp.length
      ? unionMulti(inZoneUnionMp, item.inZoneMp)
      : item.inZoneMp;
    selectedInZoneAreaMm2 += item.inZoneAreaMm2;
    selectedPiecesAreaMm2 += item.fullPieceAreaMm2;
    visibleAreaMm2Total += visibleAreaMm2;
    byPlacementIndex.set(item.placementIndex, {
      inZoneMp: item.inZoneMp,
      visibleMp,
      inZoneAreaMm2: item.inZoneAreaMm2,
      visibleAreaMm2,
      overlapAreaMm2,
      zOrder: i,
      fullPieceAreaMm2: item.fullPieceAreaMm2
    });
  }

  const fragments = [];
  const visibleContours = [];
  let nextFragId = 1;

  for (const item of matched) {
    const rec = byPlacementIndex.get(item.placementIndex) || {
      inZoneMp: [],
      visibleMp: [],
      inZoneAreaMm2: 0,
      visibleAreaMm2: 0,
      overlapAreaMm2: 0,
      zOrder: item.placementIndex
    };
    const ownerFragmentId = Number(item.p && item.p.fragmentId);
    const ownerPlacementId = Number.isFinite(ownerFragmentId) ? ownerFragmentId : null;
    const scrapPieceId = String(item.p && item.p.scrapPieceId || "");
    const inventoryTag = String(item.p && item.p.inventoryTag || "");
    visibleContours.push({
      placementIndex: item.placementIndex,
      ownerPlacementId,
      scrapPieceId,
      inventoryTag,
      zOrder: rec.zOrder,
      inZoneContours: rec.inZoneMp,
      visibleContours: rec.visibleMp,
      inZoneAreaMm2: Math.round(rec.inZoneAreaMm2 * 1000) / 1000,
      visibleAreaMm2: Math.round(rec.visibleAreaMm2 * 1000) / 1000,
      gainAreaMm2: Math.round(rec.visibleAreaMm2 * 1000) / 1000,
      overlapInZoneAreaMm2: Math.round(rec.overlapAreaMm2 * 1000) / 1000
    });
    if (includeDebug) {
      const aligned = Array.isArray(item && item.p && item.p.alignedContour) ? item.p.alignedContour : [];
      const alignedBBox = polygonBBox(aligned);
      debugPlacements.push({
        placementIndex: item.placementIndex,
        pieceId: String(item && item.p && item.p.scrapPieceId || ""),
        inventoryTag: String(item && item.p && item.p.inventoryTag || ""),
        rotationDeg: Number(item && item.p && item.p.alignRotationDeg || 0),
        offsetX: Number(item && item.p && item.p.alignOffsetX || 0),
        offsetY: Number(item && item.p && item.p.alignOffsetY || 0),
        areaPfull: Math.round(Math.max(0, Number(rec.fullPieceAreaMm2 || 0)) * 1000) / 1000,
        areaPfullZ: Math.round(Math.max(0, Number(rec.inZoneAreaMm2 || 0)) * 1000) / 1000,
        gain: Math.round(Math.max(0, Number(rec.visibleAreaMm2 || 0)) * 1000) / 1000,
        overlap: Math.round(Math.max(0, Number(rec.overlapAreaMm2 || 0)) * 1000) / 1000,
        outside: Math.round(Math.max(0, Number((rec.fullPieceAreaMm2 || 0) - (rec.inZoneAreaMm2 || 0))) * 1000) / 1000,
        bboxAligned: alignedBBox ? {
          minX: Number(alignedBBox.minX || 0),
          minY: Number(alignedBBox.minY || 0),
          maxX: Number(alignedBBox.maxX || 0),
          maxY: Number(alignedBBox.maxY || 0),
          width: Number(alignedBBox.width || 0),
          height: Number(alignedBBox.height || 0)
        } : null
      });
    }

    const flow = includeDebug
      ? {
          placementIndex: item.placementIndex,
          pieceId: scrapPieceId,
          inventoryTag,
          inZoneAreaMm2: Math.round(Number(rec.inZoneAreaMm2 || 0) * 1000) / 1000,
          visibleAreaMm2: Math.round(Number(rec.visibleAreaMm2 || 0) * 1000) / 1000,
          droppedReason: "",
          fragmentsAdded: 0,
          drops: {
            empty_poly: 0,
            outer_too_short: 0,
            area_below_min: 0,
            clean_too_short: 0,
            clean_area_below_min: 0
          }
        }
      : null;
    if (flow && Number(rec.visibleAreaMm2 || 0) <= 1e-9) {
      flow.droppedReason = "visible_area_zero_after_zorder";
    }

    for (const poly of Array.isArray(rec.visibleMp) ? rec.visibleMp : []) {
      if (!Array.isArray(poly) || poly.length === 0) {
        if (flow) flow.drops.empty_poly += 1;
        continue;
      }
      const outer = Array.isArray(poly[0]) ? poly[0] : null;
      if (!Array.isArray(outer) || outer.length < 4) {
        if (flow) flow.drops.outer_too_short += 1;
        continue;
      }
      const areaMm2 = multiPolygonArea([poly]);
      if (!Number.isFinite(areaMm2) || areaMm2 < minAreaMm2) {
        if (flow) flow.drops.area_below_min += 1;
        continue;
      }
      const pts = [];
      for (let i = 0; i < outer.length - 1; i++) {
        const x = Number(outer[i] && outer[i][0]);
        const y = Number(outer[i] && outer[i][1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        pts.push({ x, y });
      }
      const cleanPts = cleanClosedPolygon(pts, contourCleanCfg);
      if (!Array.isArray(cleanPts) || cleanPts.length < 3) {
        if (flow) flow.drops.clean_too_short += 1;
        continue;
      }
      const cleanAreaMm2 = polygonArea(cleanPts);
      if (!Number.isFinite(cleanAreaMm2) || cleanAreaMm2 < minAreaMm2) {
        if (flow) flow.drops.clean_area_below_min += 1;
        continue;
      }
      fragments.push({
        id: nextFragId++,
        // Canonical fragment geometry must stay identical to the boolean
        // result so adjacent fragments continue to share the same border.
        // We still run cleanClosedPolygon above as a validity filter, but we
        // no longer replace the render geometry with the cleaned contour.
        points: pts,
        seamPoints: pts,
        cleanPoints: cleanPts,
        areaMm2: Math.round(areaMm2 * 1000) / 1000,
        ownerPlacementId,
        ownerPlacementIndex: item.placementIndex,
        scrapPieceId,
        inventoryTag,
        zOrder: rec.zOrder
      });
      if (flow) flow.fragmentsAdded += 1;
      if (fragments.length >= maxFragments) break;
    }
    if (flow && !flow.droppedReason && flow.fragmentsAdded === 0) {
      flow.droppedReason = "no_fragment_after_cleanup_or_thresholds";
    }
    if (flow) debugFragmentFlow.push(flow);
    if (fragments.length >= maxFragments) break;
  }

  const usefulAreaMm2 = Math.max(0, visibleAreaMm2Total);
  const inZoneUnionAreaMm2 = Math.max(0, multiPolygonArea(inZoneUnionMp));
  const overlapAreaMm2 = Math.max(0, selectedInZoneAreaMm2 - inZoneUnionAreaMm2);
  const utilizationPct = selectedPiecesAreaMm2 > 1e-9
    ? Math.max(0, Math.min(100, (usefulAreaMm2 / selectedPiecesAreaMm2) * 100))
    : 0;

  return {
    fragments,
    visibleContours,
    visibleAreaPolygons: multiToOuterPolygons(inZoneUnionMp, { minAreaMm2, maxPolygons }),
    layerPolicy,
    geometrySource,
    usefulAreaMm2: Math.round(usefulAreaMm2 * 1000) / 1000,
    selectedPiecesAreaMm2: Math.round(selectedPiecesAreaMm2 * 1000) / 1000,
    selectedInZoneAreaMm2: Math.round(selectedInZoneAreaMm2 * 1000) / 1000,
    overlapAreaMm2: Math.round(overlapAreaMm2 * 1000) / 1000,
    utilizationPct: Math.round(utilizationPct * 1000) / 1000,
    debugPlacements,
    debugFragmentFlow
  };
}

function normalizeContour(points) {
  const out = [];
  const pushPoint = (x, y) => {
    const xn = Number(x);
    const yn = Number(y);
    if (Number.isFinite(xn) && Number.isFinite(yn)) out.push({ x: xn, y: yn });
  };
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      if (node.length >= 2 && Number.isFinite(Number(node[0])) && Number.isFinite(Number(node[1]))) {
        pushPoint(node[0], node[1]);
        return;
      }
      for (const child of node) walk(child);
      return;
    }
    if (typeof node === "object") {
      if (node.x !== undefined && node.y !== undefined) {
        pushPoint(node.x, node.y);
      }
    }
  };
  walk(points);
  return out;
}

function largestOuterRingPointsLocal(mp) {
  let best = [];
  let bestArea = 0;
  for (const poly of Array.isArray(mp) ? mp : []) {
    const outer = Array.isArray(poly) && Array.isArray(poly[0]) ? poly[0] : null;
    if (!Array.isArray(outer) || outer.length < 4) continue;
    const area = ringAreaAbs(outer);
    if (!Number.isFinite(area) || area <= bestArea) continue;
    const pts = [];
    for (let i = 0; i < outer.length - 1; i++) {
      const x = Number(outer[i] && outer[i][0]);
      const y = Number(outer[i] && outer[i][1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push({ x, y });
    }
    if (pts.length < 3) continue;
    bestArea = area;
    best = pts;
  }
  return best;
}

function fillGainCoreContours(placements, zonePoints, domainMp) {
  const list = Array.isArray(placements) ? placements : [];
  if (list.length === 0) return list;
  const zonePts = normalizeContour(zonePoints);
  if (zonePts.length < 3) return list;
  let zoneRes = [];
  try {
    zoneRes = (Array.isArray(domainMp) && domainMp.length) ? domainMp : pointsToMultiPolygon(zonePts);
  } catch (_) { return list; }
  const sorted = list.slice().sort((a, b) => Number(a && a.solveOrder || 0) - Number(b && b.solveOrder || 0));
  const gainMap = new Map();
  for (const p of sorted) {
    const coreMp = Array.isArray(p.inZoneCoreContours) && p.inZoneCoreContours.length > 0 ? p.inZoneCoreContours : [];
    if (Array.isArray(p.gainCoreContours) && p.gainCoreContours.length > 0) {
      if (coreMp.length > 0) try { zoneRes = diffMulti(zoneRes, coreMp); } catch (_) {}
      continue;
    }
    if (coreMp.length > 0) {
      let gcc = [];
      try { gcc = intersectMulti(coreMp, zoneRes); } catch (_) {}
      gainMap.set(p, gcc);
      try { zoneRes = diffMulti(zoneRes, coreMp); } catch (_) {}
    } else {
      gainMap.set(p, []);
    }
  }
  return list.map((p) => {
    if (Array.isArray(p.gainCoreContours) && p.gainCoreContours.length > 0) return p;
    const gcc = gainMap.get(p);
    if (gcc === undefined) return p;
    return { ...p, gainCoreContours: gcc };
  });
}

function enrichPlacementContoursForZone(placements, zonePoints, domainMp) {
  const list = Array.isArray(placements) ? placements : [];
  const zonePts = normalizeContour(zonePoints);
  if (zonePts.length < 3 || list.length === 0) return list;
  let zoneMp = [];
  try {
    zoneMp = (Array.isArray(domainMp) && domainMp.length) ? domainMp : pointsToMultiPolygon(zonePts);
  } catch (_) {
    return list;
  }

  const outList = list.map((pl) => {
    const p = pl && typeof pl === "object" ? pl : {};
    const out = { ...p };

    const hasInZoneContours = Array.isArray(out.inZoneContours) && out.inZoneContours.length > 0;
    const hasInZoneContour = Array.isArray(out.inZoneContour) && out.inZoneContour.length >= 3;
    if (!hasInZoneContours || !hasInZoneContour) {
      // Prefer alignedFullContour (original with seam) over alignedContour (may be eroded)
      const aligned = normalizeContour(out.alignedFullContour || out.alignedContour);
      if (aligned.length >= 3) {
        try {
          const inZoneMp = intersectMulti(pointsToMultiPolygon(aligned), zoneMp);
          if (!hasInZoneContours) out.inZoneContours = inZoneMp;
          if (!hasInZoneContour) {
            const outer = largestOuterRingPointsLocal(inZoneMp);
            out.inZoneContour = outer.length >= 3 ? outer : [];
          }
        } catch (_) {}
      }
    }

    const hasCoreContours = Array.isArray(out.inZoneCoreContours) && out.inZoneCoreContours.length > 0;
    const hasCoreContour = Array.isArray(out.inZoneCoreContour) && out.inZoneCoreContour.length >= 3;
    if (!hasCoreContours || !hasCoreContour) {
      const coreAligned = normalizeContour(out.alignedCoreContour);
      if (coreAligned.length >= 3) {
        try {
          const coreInZoneMp = intersectMulti(pointsToMultiPolygon(coreAligned), zoneMp);
          if (!hasCoreContours) out.inZoneCoreContours = coreInZoneMp;
          if (!hasCoreContour) {
            const outerCore = largestOuterRingPointsLocal(coreInZoneMp);
            out.inZoneCoreContour = outerCore.length >= 3 ? outerCore : [];
          }
          if (!Number.isFinite(Number(out.inZoneCoreAreaMm2)) || Number(out.inZoneCoreAreaMm2) <= 0) {
            out.inZoneCoreAreaMm2 = Math.max(0, multiPolygonArea(coreInZoneMp));
          }
        } catch (_) {}
      } else {
        if (!hasCoreContours) out.inZoneCoreContours = [];
        if (!hasCoreContour) out.inZoneCoreContour = [];
      }
    }

    return out;
  });

  const byFragment = new Map();
  for (let idx = 0; idx < outList.length; idx++) {
    const fragId = Number(outList[idx] && outList[idx].fragmentId || 0);
    if (!fragId) continue;
    if (!byFragment.has(fragId)) byFragment.set(fragId, []);
    byFragment.get(fragId).push({ idx, placement: outList[idx] });
  }
  for (const [, items] of byFragment) {
    if (!Array.isArray(items) || items.length < 2) continue;
    items.sort((a, b) => {
      const ai = Number(a && a.placement && a.placement.fragmentPieceIndex || 0);
      const bi = Number(b && b.placement && b.placement.fragmentPieceIndex || 0);
      if (ai !== bi) return ai - bi;
      return Number(a.idx || 0) - Number(b.idx || 0);
    });
    let coveredFullMp = [];
    let coveredCoreMp = [];
    for (const item of items) {
      const out = item.placement;
      if (!out || String(out.status || "") !== "matched") continue;
      const fullBaseMp = Array.isArray(out.inZoneContours) ? out.inZoneContours : [];
      if (fullBaseMp.length) {
        let visibleFullMp = fullBaseMp;
        try {
          visibleFullMp = coveredFullMp.length ? diffMulti(fullBaseMp, coveredFullMp) : fullBaseMp;
        } catch (_) {}
        out.inZoneContours = visibleFullMp;
        const outer = largestOuterRingPointsLocal(visibleFullMp);
        out.inZoneContour = outer.length >= 3 ? outer : [];
        try {
          coveredFullMp = coveredFullMp.length ? unionMulti(coveredFullMp, visibleFullMp) : visibleFullMp;
        } catch (_) {}
      }
      const coreBaseMp = Array.isArray(out.inZoneCoreContours) ? out.inZoneCoreContours : [];
      if (coreBaseMp.length) {
        let visibleCoreMp = coreBaseMp;
        try {
          visibleCoreMp = coveredCoreMp.length ? diffMulti(coreBaseMp, coveredCoreMp) : coreBaseMp;
        } catch (_) {}
        out.inZoneCoreContours = visibleCoreMp;
        const outerCore = largestOuterRingPointsLocal(visibleCoreMp);
        out.inZoneCoreContour = outerCore.length >= 3 ? outerCore : [];
        out.inZoneCoreAreaMm2 = Math.max(0, multiPolygonArea(visibleCoreMp));
        try {
          coveredCoreMp = coveredCoreMp.length ? unionMulti(coveredCoreMp, visibleCoreMp) : visibleCoreMp;
        } catch (_) {}
      }
    }
  }
  return outList;
}

function enrichPlacementContoursForFragments(placements, fragments, zonePoints, domainMp) {
  const list = Array.isArray(placements) ? placements : [];
  const frags = Array.isArray(fragments) ? fragments : [];
  const zonePts = normalizeContour(zonePoints);
  const fragMap = new Map();
  for (const frag of frags) {
    const fragId = Number(frag && frag.id || 0);
    const pts = normalizeContour(frag && frag.points);
    if (!fragId || pts.length < 3) continue;
    try {
      fragMap.set(fragId, { points: pts, mp: pointsToMultiPolygon(pts) });
    } catch (_) {}
  }
  if (fragMap.size === 0) return enrichPlacementContoursForZone(list, zonePts, domainMp);

  const outList = list.map((pl) => {
    const p = pl && typeof pl === "object" ? pl : {};
    const out = { ...p };
    const fragId = Number(out && out.fragmentId || 0);
    const fragRec = fragMap.get(fragId);
    if (!fragRec || !Array.isArray(fragRec.mp) || !fragRec.mp.length) return out;

    const aligned = normalizeContour(out.alignedContour);
    if (aligned.length >= 3) {
      try {
        const inFragMp = intersectMulti(pointsToMultiPolygon(aligned), fragRec.mp);
        out.inZoneContours = inFragMp;
        const outer = largestOuterRingPointsLocal(inFragMp);
        out.inZoneContour = outer.length >= 3 ? outer : [];
      } catch (_) {}
    }

    const coreAligned = normalizeContour(out.alignedCoreContour);
    if (coreAligned.length >= 3) {
      try {
        const coreInFragMp = intersectMulti(pointsToMultiPolygon(coreAligned), fragRec.mp);
        out.inZoneCoreContours = coreInFragMp;
        const outerCore = largestOuterRingPointsLocal(coreInFragMp);
        out.inZoneCoreContour = outerCore.length >= 3 ? outerCore : [];
        out.inZoneCoreAreaMm2 = Math.max(0, multiPolygonArea(coreInFragMp));
      } catch (_) {}
    } else {
      out.inZoneCoreContours = [];
      out.inZoneCoreContour = [];
    }

    return out;
  });

  const byFragment = new Map();
  for (let idx = 0; idx < outList.length; idx++) {
    const fragId = Number(outList[idx] && outList[idx].fragmentId || 0);
    if (!fragId) continue;
    if (!byFragment.has(fragId)) byFragment.set(fragId, []);
    byFragment.get(fragId).push({ idx, placement: outList[idx] });
  }
  for (const [, items] of byFragment) {
    if (!Array.isArray(items) || items.length < 2) continue;
    items.sort((a, b) => {
      const ai = Number(a && a.placement && a.placement.fragmentPieceIndex || 0);
      const bi = Number(b && b.placement && b.placement.fragmentPieceIndex || 0);
      if (ai !== bi) return ai - bi;
      return Number(a.idx || 0) - Number(b.idx || 0);
    });
    let coveredFullMp = [];
    let coveredCoreMp = [];
    for (const item of items) {
      const out = item.placement;
      if (!out || String(out.status || "") !== "matched") continue;

      const fullBaseMp = Array.isArray(out.inZoneContours) ? out.inZoneContours : [];
      if (fullBaseMp.length) {
        let visibleFullMp = fullBaseMp;
        try {
          visibleFullMp = coveredFullMp.length ? diffMulti(fullBaseMp, coveredFullMp) : fullBaseMp;
        } catch (_) {}
        out.inZoneContours = visibleFullMp;
        const outer = largestOuterRingPointsLocal(visibleFullMp);
        out.inZoneContour = outer.length >= 3 ? outer : [];
        try {
          coveredFullMp = coveredFullMp.length ? unionMulti(coveredFullMp, visibleFullMp) : visibleFullMp;
        } catch (_) {}
      }

      const coreBaseMp = Array.isArray(out.inZoneCoreContours) ? out.inZoneCoreContours : [];
      if (coreBaseMp.length) {
        let visibleCoreMp = coreBaseMp;
        try {
          visibleCoreMp = coveredCoreMp.length ? diffMulti(coreBaseMp, coveredCoreMp) : coreBaseMp;
        } catch (_) {}
        out.inZoneCoreContours = visibleCoreMp;
        const outerCore = largestOuterRingPointsLocal(visibleCoreMp);
        out.inZoneCoreContour = outerCore.length >= 3 ? outerCore : [];
        out.inZoneCoreAreaMm2 = Math.max(0, multiPolygonArea(visibleCoreMp));
        try {
          coveredCoreMp = coveredCoreMp.length ? unionMulti(coveredCoreMp, visibleCoreMp) : visibleCoreMp;
        } catch (_) {}
      }
    }
  }

  return outList;
}

function buildSplitReturnPreviewArtifacts(placements, visibleContours, options) {
  const list = Array.isArray(placements) ? placements : [];
  const visibleList = Array.isArray(visibleContours) ? visibleContours : [];
  const cfg = options && typeof options === "object" ? options : {};
  const minLeftoverAreaMm2 = Math.max(0, Number(cfg.minLeftoverAreaMm2 || 0));
  const minLeftoverSpanMm = Math.max(0, Number(cfg.minLeftoverSpanMm || 0));
  const visibleByPlacement = new Map();
  for (const vc of visibleList) {
    const idx = Number(vc && vc.placementIndex);
    if (!Number.isFinite(idx)) continue;
    visibleByPlacement.set(idx, vc);
  }
  const splitEvents = [];
  const placementsOut = list.map((p, idx) => {
    const vc = visibleByPlacement.get(idx) || null;
    const usedVisibleContours = Array.isArray(vc && vc.visibleContours) ? vc.visibleContours : [];
    const usedVisibleContour = largestOuterRingPointsLocal(usedVisibleContours);
    const usedVisibleAreaMm2 = Math.max(0, Number(vc && vc.visibleAreaMm2 || 0));
    const parentKeyRaw = String((p && p.scrapPieceId) || (p && p.inventoryTag) || `placement_${idx + 1}`);
    const parentCandidateKey = parentKeyRaw.trim() || `placement_${idx + 1}`;
    const fullAreaMm2 = Math.max(0, Number(p && p.scrapAreaMm2 || 0));
    const leftoverAreaMm2 = Math.max(0, fullAreaMm2 - usedVisibleAreaMm2);
    const spanGateOk = minLeftoverSpanMm <= 0;
    const acceptLeftover = leftoverAreaMm2 >= minLeftoverAreaMm2 && spanGateOk;
    const derivedCandidateKeys = acceptLeftover ? [`${parentCandidateKey}#g1#s1`] : [];
    splitEvents.push({
      parentCandidateKey,
      usedWorldContours: usedVisibleContours,
      usedWorldContour: usedVisibleContour,
      usedAreaMm2: Math.round(usedVisibleAreaMm2 * 1000) / 1000,
      leftoverAreaMm2: Math.round(leftoverAreaMm2 * 1000) / 1000,
      leftoverContoursLocal: [],
      derivedCandidateKeys
    });
    return {
      ...(p || {}),
      usedVisibleContours,
      usedVisibleContour,
      usedVisibleAreaMm2: Math.round(usedVisibleAreaMm2 * 1000) / 1000
    };
  });
  return { placements: placementsOut, splitEvents };
}

function ensureManualRunsStore(storePath) {
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify({ version: 1, runs: [] }, null, 2), "utf8");
  }
}

function readManualRunsStore(storePath) {
  ensureManualRunsStore(storePath);
  try {
    const raw = fs.readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      runs: Array.isArray(parsed && parsed.runs) ? parsed.runs : []
    };
  } catch (_) {
    return { version: 1, runs: [] };
  }
}

function writeManualRunsStore(storePath, payload) {
  ensureManualRunsStore(storePath);
  const next = {
    version: 1,
    runs: Array.isArray(payload && payload.runs) ? payload.runs : []
  };
  fs.writeFileSync(storePath, JSON.stringify(next, null, 2), "utf8");
}

function makeManualRunId() {
  return `mlr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getStoredLayoutDefaultName(mode) {
  const normalized = String(mode || "").trim();
  if (normalized === "longitudinal") return "Продольно-поперечная";
  if (normalized === "shifted") return "Со смещением";
  if (normalized === "radial") return "Радиальная";
  if (normalized === "transverse") return "Ёлочка";
  return "Ручная выкладка";
}

async function handleLayoutRoutes(req, res, reqUrl, deps) {
  const {
    jsonReply,
    readBodyJson,
    normalizePolygonInput,
    polygonArea,
    safeNum,
    generateRegularFragments,
    generateShiftedFragments,
    generateDiagonalFragments,
    generateRadialFragments,
    generateVoronoiFragments,
    applyNormalizeRules,
    assignCandidatesToFragments,
    assignInventoryDirect,
    nfpSaSolver,
    tilingSolver,
    voronoiSaSolver,
    rankCandidatesForFragment,
    createGridSpec,
    emitLayoutProgress,
    logger,
    tmpDir
  } = deps;
  const log = logger && typeof logger.child === "function"
    ? logger
    : { info() {}, warn() {}, error() {}, child() { return this; } };
  const manualRunsStorePath = path.join(
    String(tmpDir || path.resolve(__dirname, "..", "..", "tmp")),
    "manual_layout_runs.json"
  );
  const modeRegistry = createModeRegistry({
    assignInventoryDirect,
    nfpSaSolver,
    tilingSolver,
    voronoiSaSolver,
    generateRegularFragments,
    generateShiftedFragments,
    generateDiagonalFragments,
    generateRadialFragments,
    generateVoronoiFragments,
    applyNormalizeRules,
    assignCandidatesToFragments,
    normalizePolygonInput,
    polygonArea
  });

  // Zone domain builder — CONTRACT_layouts.md §4
  // Accepts zone with optional zoneContour.outer/holes or legacy points/holes.
  function buildZoneDomain(zone) {
    const z = (zone && typeof zone === "object") ? zone : {};
    const zc = (z.zoneContour && typeof z.zoneContour === "object") ? z.zoneContour : null;
    const outerRaw = zc ? (zc.outer || []) : (z.points || []);
    const outerPoints = normalizePolygonInput(outerRaw);
    const rawHoles = zc ? (zc.holes || []) : (z.holes || []);
    const holePoints = (Array.isArray(rawHoles) ? rawHoles : [])
      .map((h) => normalizePolygonInput(Array.isArray(h) && h.length && Array.isArray(h[0])
        ? h.map((p) => ({ x: Number(p[0]), y: Number(p[1]) })) : h))
      .filter((h) => h.length >= 3);
    let domainMp = outerPoints.length >= 3 ? pointsToMultiPolygon(outerPoints) : [];
    for (const hole of holePoints) {
      const holeMp = pointsToMultiPolygon(hole);
      if (holeMp.length) {
        try { domainMp = diffMulti(domainMp, holeMp); } catch (_) {}
      }
    }
    const outerAreaMm2 = polygonArea(outerPoints);
    const holesAreaMm2 = holePoints.reduce((s, h) => s + polygonArea(h), 0);
    return {
      outerPoints,
      holePoints,
      domainMp,
      hasHoles: holePoints.length > 0,
      outerAreaMm2,
      holesAreaMm2,
      domainAreaMm2: Math.max(0, outerAreaMm2 - holesAreaMm2)
    };
  }

  function buildContractDiag(zoneDom, fragments) {
    const holePoints = Array.isArray(zoneDom && zoneDom.holePoints) ? zoneDom.holePoints : [];
    const domainMp = Array.isArray(zoneDom && zoneDom.domainMp) ? zoneDom.domainMp : [];
    const fragList = Array.isArray(fragments) ? fragments : [];
    let holesMp = [];
    for (const hole of holePoints) {
      const hMp = pointsToMultiPolygon(hole);
      if (hMp.length) {
        try { holesMp = holesMp.length ? unionMulti(holesMp, hMp) : hMp; } catch (_) {}
      }
    }
    let fragmentsInsideHolesArea = 0;
    let fragmentsOutsideZoneDomainArea = 0;
    for (const frag of fragList) {
      const pts = Array.isArray(frag && frag.points) ? frag.points : [];
      if (pts.length < 3) continue;
      try {
        const fragMp = pointsToMultiPolygon(pts);
        if (fragMp.length && holesMp.length) {
          const inside = intersectMulti(fragMp, holesMp);
          fragmentsInsideHolesArea += multiPolygonArea(inside);
        }
        if (fragMp.length && domainMp.length) {
          const outside = diffMulti(fragMp, domainMp);
          fragmentsOutsideZoneDomainArea += multiPolygonArea(outside);
        }
      } catch (_) {}
    }
    const TOLERANCE = 1.0;
    const issues = [];
    if (fragmentsInsideHolesArea > TOLERANCE) issues.push("fragment_inside_hole");
    if (fragmentsOutsideZoneDomainArea > TOLERANCE) issues.push("fragment_outside_zone_domain");
    return {
      holesReceived: !!(zoneDom && zoneDom.hasHoles),
      usedZoneDomain: true,
      outerAreaMm2: Math.round((zoneDom && zoneDom.outerAreaMm2 || 0) * 10) / 10,
      holesCount: holePoints.length,
      holesAreaMm2: Math.round((zoneDom && zoneDom.holesAreaMm2 || 0) * 10) / 10,
      zoneDomainAreaMm2: Math.round((zoneDom && zoneDom.domainAreaMm2 || 0) * 10) / 10,
      fragmentCount: fragList.length,
      fragmentsInsideHolesArea: Math.round(fragmentsInsideHolesArea * 10) / 10,
      fragmentsOutsideZoneDomainArea: Math.round(fragmentsOutsideZoneDomainArea * 10) / 10,
      coveredRatioDenominator: "zoneDomain",
      contractValid: issues.length === 0,
      issues
    };
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/layout/modes/preview") {
    const startedAt = Date.now();
    const body = await readBodyJson(req);
const parsed = parsePreviewWrapperRequest(body);
    if (!parsed.ok) {
      log.warn({ error: parsed.error }, "mode_preview_invalid_request");
      return jsonReply(res, 400, { ok: false, error: parsed.error });
    }
    const wrapReq = parsed.value;
    const progressToken = String(body && body.progressToken || "").trim();
    const pushProgress = (payload) => {
      if (!progressToken || typeof emitLayoutProgress !== "function") return;
      try { emitLayoutProgress(progressToken, payload); } catch (_) {}
    };
    if (progressToken) {
      wrapReq.options = Object.assign({}, wrapReq.options || {}, { onProgress: pushProgress });
    }
    let mode = null;
    try {
      mode = modeRegistry.require(wrapReq.layoutType);
    } catch (e) {
      log.warn({ layoutType: wrapReq.layoutType }, "mode_preview_unsupported_layout_type");
      return jsonReply(res, 400, { ok: false, error: "layout_type_unsupported" });
    }
    if (typeof mode.validatePreview === "function") {
      const v = mode.validatePreview(wrapReq);
      if (!v || v.ok !== true) {
        log.warn({
          layoutType: wrapReq.layoutType,
          error: String(v && v.error || "invalid_preview_request"),
        }, "mode_preview_validation_failed");
        return jsonReply(res, 400, { ok: false, error: String(v && v.error || "invalid_preview_request") });
      }
    }
    if (typeof mode.previewWrapper !== "function") {
      return jsonReply(res, 501, {
        ok: false,
        error: "preview_not_implemented",
        layoutType: wrapReq.layoutType
      });
    }
    let wrapped;
    try {
      wrapped = await mode.previewWrapper(wrapReq);
    } catch (previewErr) {
      console.error("[P5_DEBUG] previewWrapper error:", previewErr && previewErr.stack || previewErr);
      log.error({ layoutType: wrapReq.layoutType, err: String(previewErr && previewErr.message || previewErr) }, "mode_preview_error");
      return jsonReply(res, 500, { ok: false, error: "preview_internal_error", detail: String(previewErr && previewErr.message || previewErr) });
    }
    log.info({
      layoutType: wrapped && wrapped.layoutType || wrapReq.layoutType,
      resultStatus: wrapped && wrapped.resultStatus,
      seed: wrapReq.seed,
      renderItems: wrapped && wrapped.render && Array.isArray(wrapped.render.items)
        ? wrapped.render.items.length
        : 0,
      durationMs: Date.now() - startedAt,
    }, "mode_preview_completed");
    const nfpZoneDom = buildZoneDomain({ points: wrapReq.zonePoints, holes: wrapReq.zoneHoles });
    // Clip fragments to zone domain (subtract holes) for hole-aware modes/preview
    if (wrapped && typeof wrapped === "object" && nfpZoneDom.hasHoles && Array.isArray(nfpZoneDom.domainMp) && nfpZoneDom.domainMp.length) {
      const rawFrags = Array.isArray(wrapped.fragments) ? wrapped.fragments : [];
      const clipped = [];
      for (const frag of rawFrags) {
        const pts = Array.isArray(frag && frag.points) ? frag.points : [];
        if (pts.length < 3) continue;
        try {
          const fragMp = pointsToMultiPolygon(pts);
          const inter = intersectMulti(fragMp, nfpZoneDom.domainMp);
          for (const poly of inter) {
            if (!Array.isArray(poly) || !poly.length || !Array.isArray(poly[0])) continue;
            const ring = poly[0];
            const clPts = [];
            for (let k = 0; k < ring.length - 1; k++) {
              const x = Number(ring[k] && ring[k][0]);
              const y = Number(ring[k] && ring[k][1]);
              if (Number.isFinite(x) && Number.isFinite(y)) clPts.push({ x, y });
            }
            if (clPts.length < 3) continue;
            clipped.push({ ...frag, points: clPts, areaMm2: polygonArea(clPts) });
          }
        } catch (_) { clipped.push(frag); }
      }
      wrapped.fragments = clipped;
      // Rebuild render.items from clipped fragments
      if (wrapped.render && Array.isArray(wrapped.render.items)) {
        wrapped.render.items = clipped.map((f, i) => ({
          id: String(f.id != null ? f.id : (i + 1)),
          contour: f.points,
          closed: true,
          renderIndex: i,
          meta: {}
        }));
      }
    }
    const nfpFragments = Array.isArray(wrapped && wrapped.fragments) ? wrapped.fragments : [];
    if (wrapped && typeof wrapped === "object") {
      wrapped._contractDiag = buildContractDiag(nfpZoneDom, nfpFragments);
    }
    return jsonReply(res, 200, wrapped);
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/layout/modes/apply") {
    const body = await readBodyJson(req);
    const layoutType = String(body && body.layoutType || "").trim();
    if (!layoutType) return jsonReply(res, 400, { ok: false, error: "layout_type_required" });
    let mode = null;
    try {
      mode = modeRegistry.require(layoutType);
    } catch (e) {
      return jsonReply(res, 400, { ok: false, error: "layout_type_unsupported" });
    }
    if (typeof mode.applyWrapper !== "function") {
      return jsonReply(res, 501, {
        ok: false,
        layoutType,
        error: "apply_not_implemented",
        message: "Mode apply adapter is not connected."
      });
    }
    const out = await mode.applyWrapper(body && typeof body === "object" ? body : {});
    return jsonReply(res, 200, out);
  }

  if (req.method === "GET" && reqUrl.pathname === "/api/layout/manual/runs") {
    const store = readManualRunsStore(manualRunsStorePath);
    const items = store.runs
      .map((x) => ({
        id: String(x && x.id || ""),
        name: String(x && x.name || getStoredLayoutDefaultName(x && x.mode || "inventory_manual")),
        mode: String(x && x.mode || "inventory_manual"),
        selectedZoneId: Number(x && x.selectedZoneId || 0) || null,
        createdAt: Number(x && x.createdAt || 0) || null,
        updatedAt: Number(x && x.updatedAt || 0) || null,
        snapshot: x && x.snapshot && typeof x.snapshot === "object" ? x.snapshot : {}
      }))
      .filter((x) => x.id)
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    return jsonReply(res, 200, { ok: true, items });
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/layout/manual/runs/save") {
    const body = await readBodyJson(req);
    const input = body && typeof body === "object" ? body : {};
    const mode = String(input.mode || "inventory_manual");
    if (mode !== "inventory_manual" && mode !== "longitudinal" && mode !== "shifted" && mode !== "transverse" && mode !== "radial" && mode !== "intarsia") return jsonReply(res, 400, { ok: false, error: "unsupported_layout_mode" });
    const snapshot = input.snapshot && typeof input.snapshot === "object" ? input.snapshot : null;
    if (!snapshot) return jsonReply(res, 400, { ok: false, error: "snapshot_required" });

    const now = Date.now();
    const store = readManualRunsStore(manualRunsStorePath);
    const runId = String(input.id || makeManualRunId());
    const index = store.runs.findIndex((x) => String(x && x.id || "") === runId);
    const createdAtPrev = index >= 0 ? Number(store.runs[index] && store.runs[index].createdAt || 0) : 0;
    const item = {
      id: runId,
      name: String(input.name || getStoredLayoutDefaultName(mode)),
      mode,
      selectedZoneId: Number(input.selectedZoneId || 0) || null,
      createdAt: createdAtPrev > 0 ? createdAtPrev : now,
      updatedAt: now,
      snapshot
    };
    if (index >= 0) store.runs[index] = item;
    else store.runs.push(item);
    writeManualRunsStore(manualRunsStorePath, store);
    return jsonReply(res, 200, {
      ok: true,
      item: {
        id: item.id,
        name: item.name,
        mode: item.mode,
        selectedZoneId: item.selectedZoneId,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      }
    });
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/layout/manual/runs/load") {
    const body = await readBodyJson(req);
    const runId = String(body && body.id || "").trim();
    if (!runId) return jsonReply(res, 400, { ok: false, error: "id_required" });
    const store = readManualRunsStore(manualRunsStorePath);
    const found = store.runs.find((x) => String(x && x.id || "") === runId) || null;
    if (!found) return jsonReply(res, 404, { ok: false, error: "not_found" });
    return jsonReply(res, 200, {
      ok: true,
      item: {
        id: String(found.id || ""),
        name: String(found.name || getStoredLayoutDefaultName(found.mode || "inventory_manual")),
        mode: String(found.mode || "inventory_manual"),
        selectedZoneId: Number(found.selectedZoneId || 0) || null,
        createdAt: Number(found.createdAt || 0) || null,
        updatedAt: Number(found.updatedAt || 0) || null,
        snapshot: found.snapshot && typeof found.snapshot === "object" ? found.snapshot : {}
      }
    });
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/layout/manual/runs/delete") {
    const body = await readBodyJson(req);
    const runId = String(body && body.id || "").trim();
    if (!runId) return jsonReply(res, 400, { ok: false, error: "id_required" });
    const store = readManualRunsStore(manualRunsStorePath);
    const before = store.runs.length;
    store.runs = store.runs.filter((x) => String(x && x.id || "") !== runId);
    if (store.runs.length === before) return jsonReply(res, 404, { ok: false, error: "not_found" });
    writeManualRunsStore(manualRunsStorePath, store);
    return jsonReply(res, 200, { ok: true, id: runId });
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/layout/fill/preview") {
    const body = await readBodyJson(req);
    const progressToken = String(reqUrl.searchParams.get("progressToken") || body.progressToken || "").trim();
    const pushProgress = (payload) => {
      if (!progressToken || typeof emitLayoutProgress !== "function") return;
      try { emitLayoutProgress(progressToken, payload); } catch (_) {}
    };
    pushProgress({ type: "phase", phase: "server_prepare", percent: 69, title: "Сервер / подготовка данных" });
    const zone = body.zone || {};
    const zoneDom = buildZoneDomain(zone);
    const zonePoints = zoneDom.outerPoints;
    const zoneDomainMp = zoneDom.domainMp;
    if (zonePoints.length < 3) return jsonReply(res, 400, { ok: false, error: "zone_points_required" });
    const areaMm2 = zoneDom.domainAreaMm2 > 0 ? zoneDom.domainAreaMm2 : polygonArea(zonePoints);
    if (areaMm2 <= 0) return jsonReply(res, 400, { ok: false, error: "invalid_zone_polygon" });
    const zBBox = polygonBBox(zonePoints);
    if (!zBBox) return jsonReply(res, 400, { ok: false, error: "zone_bbox_invalid" });
    pushProgress({ type: "phase", phase: "server_zone_geometry", percent: 72, title: "Сервер / геометрия зоны" });

    const fillType = String(body.fillType || "voronoi").toLowerCase();
    if (fillType !== "voronoi" && fillType !== "regular") {
      return jsonReply(res, 400, { ok: false, error: "unsupported_fill_type" });
    }
    const axis = String(body.axis || "y").toLowerCase() === "x" ? "x" : "y";
    const placementStrategy = String(body.placementStrategy || "bestFit");
    if (!["greedy", "bestFit", "manualAssist"].includes(placementStrategy)) {
      return jsonReply(res, 400, { ok: false, error: "unsupported_placement_strategy" });
    }
    const directInventoryPlanned = body.directInventory === true;
    const seamReserveAliasZone = safeNum(zone && zone.seamAllowanceReserveMm);
    const seamReserveAliasBody = safeNum(body.seamAllowanceReserveMm);
    const pieceSeamReserveRaw = safeNum(body.pieceSeamReserveMm);
    const options = {
      axis,
      minAreaMm2: safeNum(body.minAreaMm2) === null ? 0 : Number(body.minAreaMm2),
      maxCandidates: safeNum(body.maxCandidates) === null ? 300 : Number(body.maxCandidates),
      minFragmentWidthMm: safeNum(body.minFragmentWidthMm) === null ? (directInventoryPlanned ? 100 : 0) : Number(body.minFragmentWidthMm),
      minFragmentLengthMm: safeNum(body.minFragmentLengthMm) === null ? (directInventoryPlanned ? 100 : 0) : Number(body.minFragmentLengthMm),
      density: safeNum(body.density) === null ? 5 : Number(body.density),
      variability: safeNum(body.variability) === null ? 5 : Number(body.variability),
      anisotropy: safeNum(body.anisotropy) === null ? 5 : Number(body.anisotropy),
      rows: safeNum(body.rows) === null ? 5 : Number(body.rows),
      cols: safeNum(body.cols) === null ? 5 : Number(body.cols),
      gapX: safeNum(body.gapX) === null ? 0 : Number(body.gapX),
      gapY: safeNum(body.gapY) === null ? 0 : Number(body.gapY),
      cornerRadius: safeNum(body.cornerRadius) === null ? 0 : Number(body.cornerRadius),
      maxPieces: safeNum(body.maxPieces) === null ? 120 : Number(body.maxPieces),
      maxPieceOverlap: safeNum(body.maxPieceOverlap) === null ? 0.9 : Number(body.maxPieceOverlap),
      minInsideRatio: safeNum(body.minInsideRatio),
      minGainAreaMm2: safeNum(body.minGainAreaMm2) === null ? 60 : Number(body.minGainAreaMm2),
      enforceMinGainByArea: body.enforceMinGainByArea !== false,
      overlapPenalty: safeNum(body.overlapPenalty) === null ? 0.25 : Number(body.overlapPenalty),
      outsidePenalty: safeNum(body.outsidePenalty) === null ? 0.05 : Number(body.outsidePenalty),
      seamAllowanceReserveMm: safeNum(body.seamAllowanceReserveMm),
      pieceSeamReserveMm: pieceSeamReserveRaw !== null
        ? Number(pieceSeamReserveRaw)
        : (seamReserveAliasBody !== null
            ? Number(seamReserveAliasBody)
            : (seamReserveAliasZone !== null ? Number(seamReserveAliasZone) : 0)),
      seamEpsRatio: safeNum(body.seamEpsRatio),
      seamEpsMm2: safeNum(body.seamEpsMm2),
      coverageTarget: safeNum(body.coverageTarget),
      strictCoverage: body.strictCoverage !== false,
      strictCoverageHard: body.strictCoverageHard === true,
      coverageEps: safeNum(body.coverageEps),
      objectiveMode: String(body.objectiveMode || "default"),
      objectiveMinEfficiency: safeNum(body.objectiveMinEfficiency),
      objectivePiecePenalty: safeNum(body.objectivePiecePenalty) === null ? 0.18 : Number(body.objectivePiecePenalty),
      objectiveFragmentPenalty: safeNum(body.objectiveFragmentPenalty) === null ? 0.28 : Number(body.objectiveFragmentPenalty),
      minEfficiencyBase: safeNum(body.minEfficiencyBase) === null ? 0.20 : Number(body.minEfficiencyBase),
      phaseAEndCoverage: safeNum(body.phaseAEndCoverage) === null ? 0.42 : Number(body.phaseAEndCoverage),
      phaseAInsideMin: safeNum(body.phaseAInsideMin) === null ? 0.995 : Number(body.phaseAInsideMin),
      phaseAMaxOverlap: safeNum(body.phaseAMaxOverlap) === null ? 0.008 : Number(body.phaseAMaxOverlap),
      phaseBEfficiencyMin: safeNum(body.phaseBEfficiencyMin) === null ? 0.62 : Number(body.phaseBEfficiencyMin),
      phaseAMinPieces: safeNum(body.phaseAMinPieces) === null ? 2 : Number(body.phaseAMinPieces),
      phaseAMinGainMm2: safeNum(body.phaseAMinGainMm2) === null ? 12000 : Number(body.phaseAMinGainMm2),
      phaseAMinGainShare: safeNum(body.phaseAMinGainShare) === null ? 0.08 : Number(body.phaseAMinGainShare),
      minGainVisibleMm2: safeNum(body.minVisibleFragmentAreaMm2) === null
        ? (safeNum(body.minGainVisibleMm2) === null ? 8000 : Number(body.minGainVisibleMm2))
        : Number(body.minVisibleFragmentAreaMm2),
      minSpanMm: safeNum(body.minVisibleFragmentSpanMm) === null
        ? (safeNum(body.minSpanMm) === null ? 80 : Number(body.minSpanMm))
        : Number(body.minVisibleFragmentSpanMm),
      minVisibleFragmentAreaMm2: safeNum(body.minVisibleFragmentAreaMm2),
      minVisibleFragmentSpanMm: safeNum(body.minVisibleFragmentSpanMm),
      maxSolveMs: safeNum(body.maxSolveMs),
      hardMaxSolveMs: safeNum(body.hardMaxSolveMs),
      maxPointsPerCandidate: safeNum(body.maxPointsPerCandidate),
      coverageFirst: body.coverageFirst === undefined ? true : body.coverageFirst === true,
      enforceTimeBudget: body.enforceTimeBudget !== false,
      maxRepairAttempts: safeNum(body.maxRepairAttempts),
      repairWindow: safeNum(body.repairWindow),
      tailCoverageStart: safeNum(body.tailCoverageStart) === null ? 0.93 : Number(body.tailCoverageStart),
      tailResidualRatio: safeNum(body.tailResidualRatio) === null ? 0.03 : Number(body.tailResidualRatio),
      tailResidualLooseRatio: safeNum(body.tailResidualLooseRatio) === null ? 0.015 : Number(body.tailResidualLooseRatio),
      tailMinEfficiency: safeNum(body.tailMinEfficiency) === null ? 0.30 : Number(body.tailMinEfficiency),
      tailMinEfficiencyLoose: safeNum(body.tailMinEfficiencyLoose) === null ? 0.18 : Number(body.tailMinEfficiencyLoose),
      pocketModeStartRatio: safeNum(body.pocketModeStartRatio) === null ? 0.08 : Number(body.pocketModeStartRatio),
      pocketAreaK: safeNum(body.pocketAreaK) === null ? 2.4 : Number(body.pocketAreaK),
      tailOversizeAlpha: safeNum(body.tailOversizeAlpha) === null ? 2.4 : Number(body.tailOversizeAlpha),
      tailStallTrigger: safeNum(body.tailStallTrigger) === null ? 3 : Number(body.tailStallTrigger),
      tailPenaltyBoost: safeNum(body.tailPenaltyBoost) === null ? 2.2 : Number(body.tailPenaltyBoost),
      tailMaxPlacements: safeNum(body.tailMaxPlacements) === null ? 14 : Number(body.tailMaxPlacements),
      tailCapResidualRatio: safeNum(body.tailCapResidualRatio) === null ? 0.03 : Number(body.tailCapResidualRatio),
      tailMinGainShare: safeNum(body.tailMinGainShare) === null ? 0.22 : Number(body.tailMinGainShare),
      tailMinGainCapMm2: safeNum(body.tailMinGainCapMm2) === null ? 280 : Number(body.tailMinGainCapMm2),
      pocketCoverageThresholdA: safeNum(body.pocketCoverageThresholdA),
      pocketCoverageBonusA: safeNum(body.pocketCoverageBonusA),
      gridAnchorEnable: body.gridAnchorEnable !== false,
      gridAnchorStepFactor: safeNum(body.gridAnchorStepFactor),
      gridAnchorMax: safeNum(body.gridAnchorMax),
      cleanLayoutMode: body.cleanLayoutMode !== false,
      cleanOverlapRatioMaxAB: safeNum(body.cleanOverlapRatioMaxAB),
      cleanOverlapRatioMaxC: safeNum(body.cleanOverlapRatioMaxC),
      gridAcceptCoverageRatio: safeNum(body.gridAcceptCoverageRatio),
      cleanPiecePenalty: safeNum(body.cleanPiecePenalty),
      layerPolicy: String(body.layerPolicy || "priority_on_top"),
      solverMode: String(body.solverMode || "phasedV1"),
      rasterMm: safeNum(body.rasterMm),
      seed: safeNum(body.seed) === null ? Date.now() : Number(body.seed)
    };
    options.onProgress = (evt) => {
      if (!evt || typeof evt !== "object") return;
      pushProgress({ type: "solver", ...evt });
    };
    const qualityMode = String(body.qualityMode || "strict").toLowerCase() === "draft" ? "draft" : "strict";
    const rasterMm = qualityMode === "draft"
      ? Math.max(5, Math.min(10, Number(body.rasterMm || 5)))
      : Math.max(1, Math.min(5, Number(body.rasterMm || 2)));
    options.qualityMode = qualityMode;
    options.rasterMm = rasterMm;
    const gridSpec = createGridSpec(zBBox, rasterMm, 2);
    const filters = body.filters && typeof body.filters === "object" ? body.filters : {};
    const constraints = body.constraints && typeof body.constraints === "object" ? body.constraints : {
      napDirectionDeg: safeNum(body.napDirectionDeg),
      napToleranceDeg: safeNum(body.napToleranceDeg) === null ? 15 : Number(body.napToleranceDeg),
      napPolicy: String(body.napPolicy || "normal"),
      napWeight: safeNum(body.napWeight) === null ? 1 : Number(body.napWeight),
      allowFlip180: false,
      minAlongMm: safeNum(body.minAlongMm),
      maxAlongMm: safeNum(body.maxAlongMm),
      minAcrossMm: safeNum(body.minAcrossMm),
      maxAcrossMm: safeNum(body.maxAcrossMm),
      minAreaMm2: safeNum(body.minAreaMm2),
      maxAreaMm2: safeNum(body.maxAreaMm2),
      minCoverageRatio: 0.75
    };
    const normalizeRules = body.normalizeRules && typeof body.normalizeRules === "object" ? body.normalizeRules : {
      minFragmentWidthMm: safeNum(body.minFragmentWidthMm),
      minFragmentLengthMm: safeNum(body.minFragmentLengthMm),
      simplifyToleranceMm: safeNum(body.simplifyToleranceMm),
      mergeSmallFragments: false,
      seamAllowanceReserveMm: safeNum(body.seamAllowanceReserveMm)
    };
    const visibleMinAreaMm2 = Math.max(
      1,
      safeNum(body.minAreaMm2) === null ? 1 : Number(body.minAreaMm2)
    );
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    pushProgress({
      type: "phase",
      phase: "server_candidate_filter",
      percent: 76,
      title: "Сервер / фильтрация кандидатов",
      candidatesInput: candidates.length
    });
    const looksLikeInventoryFlow =
      (constraints && constraints.requireScrapContour === true) ||
      (Array.isArray(candidates) && candidates.some((c) => c && (c.scrapContour || c.inventoryTag)));
    const directInventory = body.directInventory === true || looksLikeInventoryFlow;
    const requestedModeId = String(body.modeId || "").trim();
    const splitReturnEnabled = requestedModeId === "inventory_split_return" || body.splitReturnEnabled === true;
    const assignOnly = body.assignOnly === true;
    const directSoftProfile = directInventory;
    if (directInventory) {
      // Soft default profile for direct inventory solver:
      // keep explicit user values untouched, relax only implicit defaults.
      if (safeNum(body.minFragmentWidthMm) === null) options.minFragmentWidthMm = 0;
      if (safeNum(body.minFragmentLengthMm) === null) options.minFragmentLengthMm = 0;
      if (safeNum(body.outsidePenalty) === null) options.outsidePenalty = 0.03;
      if (safeNum(body.minEfficiencyBase) === null) options.minEfficiencyBase = 0.12;
      if (safeNum(body.phaseAEndCoverage) === null) options.phaseAEndCoverage = 0.22;
      if (safeNum(body.phaseAInsideMin) === null) options.phaseAInsideMin = 0.90;
      if (safeNum(body.phaseAMaxOverlap) === null) options.phaseAMaxOverlap = 0.08;
      if (safeNum(body.phaseBEfficiencyMin) === null) options.phaseBEfficiencyMin = 0.42;
      if (safeNum(body.phaseAMinPieces) === null) options.phaseAMinPieces = 1;
      if (safeNum(body.phaseAMinGainMm2) === null) options.phaseAMinGainMm2 = 4000;
      if (safeNum(body.phaseAMinGainShare) === null) options.phaseAMinGainShare = 0.03;
      if (safeNum(body.minGainVisibleMm2) === null) options.minGainVisibleMm2 = Math.max(1000, Math.min(5000, areaMm2 * 0.0015));
      if (safeNum(body.minSpanMm) === null) options.minSpanMm = 60;
      if (safeNum(body.maxSolveMs) === null) options.maxSolveMs = 60000;
      if (safeNum(body.hardMaxSolveMs) === null) options.hardMaxSolveMs = 90000;
      if (safeNum(body.maxRepairAttempts) === null) options.maxRepairAttempts = 4;
      if (safeNum(body.repairWindow) === null) options.repairWindow = 30;
      if (!body.solverMode) options.solverMode = splitReturnEnabled ? "phasedV1" : "gridcoverv1";
      // Guardrail: UI may send stale strict/legacy defaults; prefer robust direct profile
      // unless caller explicitly disables it via directSoftProfile=false.
      if (directSoftProfile) {
        // Contract rule: Scenario A is acceptable only with full zone coverage.
        options.strictCoverage = true;
        options.strictCoverageHard = true;
        options.coverageTarget = 0.99999;
        options.coverageEps = 0.0005;
        options.solverMode = splitReturnEnabled
          ? String(body.solverMode || "phasedV1")
          : "gridcoverv1";
        options.cleanLayoutMode = splitReturnEnabled ? false : true;
        if (safeNum(body.maxPieces) === null) options.maxPieces = 220;
        if (safeNum(body.cleanOverlapRatioMaxAB) === null) options.cleanOverlapRatioMaxAB = 0.32;
        if (safeNum(body.cleanOverlapRatioMaxC) === null) options.cleanOverlapRatioMaxC = 0.45;
        if (safeNum(body.gridAcceptCoverageRatio) === null) options.gridAcceptCoverageRatio = 0.978;
        if (safeNum(body.cleanPiecePenalty) === null) options.cleanPiecePenalty = 0.3;
        if (body.enableLegacyFallback === undefined) options.enableLegacyFallback = false;
      }
      options.directSoftProfileApplied = !!directSoftProfile;
      options.maxSolveMs = clampSolveMs(
        options.maxSolveMs,
        60000,
        5000,
        DIRECT_INVENTORY_SOFT_CAP_MS
      );
      options.hardMaxSolveMs = clampSolveMs(
        options.hardMaxSolveMs,
        Math.max(options.maxSolveMs + 5000, Math.ceil(options.maxSolveMs * 1.5)),
        options.maxSolveMs,
        DIRECT_INVENTORY_HARD_CAP_MS
      );
      options.solveDeadlineMs = Date.now() + options.hardMaxSolveMs;
      if (splitReturnEnabled) options.layerPolicy = "first_on_top";
      if (splitReturnEnabled) {
        // Split&Return: always force soft gates — UI direct-mode profile is too strict.
        options.minGainVisibleMm2 = 40;
        options.minSpanMm = 10;
        options.phaseAMinGainMm2 = 500;
        options.phaseAInsideMin = 0.55;       // pieces may extend outside zone boundaries
        options.phaseAMaxOverlap = 0.6;       // heavy overlap is ok — first_on_top stack handles it
        options.phaseAMinGainShare = 0.005;
        options.phaseBEfficiencyMin = 0.10;
        options.minEfficiencyBase = 0.02;
        options.tailMinEfficiency = 0.05;
        options.tailMinEfficiencyLoose = 0.01;
        options.minGainAreaMm2 = 1;
        options.objectiveMode = "oneGood";
        options.objectiveMinEfficiency = 0.25; // lower than direct-mode default (0.82) since pieces partially extend outside zone
        options.maxPieceOverlap = 0.995;
        options.cleanPiecePenalty = 0;
        options.coverageFirst = true;
      }
    }

    if (assignOnly) {
      pushProgress({ type: "phase", phase: "server_assign_prepare", percent: 80, title: "Сервер / подготовка подбора по фрагментам" });
      const inFrags = Array.isArray(body.fragments) ? body.fragments : [];
      const fragments = inFrags
        .map((f, i) => {
          const pts = normalizePolygonInput(f && f.points);
          if (pts.length < 3) return null;
          return {
            id: Number.isFinite(Number(f && f.id)) ? Number(f.id) : (i + 1),
            points: pts,
            areaMm2: polygonArea(pts)
          };
        })
        .filter(Boolean);
      if (!fragments.length) return jsonReply(res, 400, { ok: false, error: "fragments_required_for_assign_only" });
      pushProgress({
        type: "solver",
        phase: "intarsia_assign_start",
        percent: 83,
        iter: 0,
        fragmentsTotal: fragments.length,
        candidatesInput: Array.isArray(candidates) ? candidates.length : 0,
        title: "Интарсия / подбор по фрагментам"
      });
      const tAssign0 = Date.now();
      const effectivePlacementStrategy = (fillType === "regular")
        ? "intarsiaSmart"
        : placementStrategy;
      const assignConstraints = { ...(constraints || {}) };
      // Ensure seam reserve reaches fragment matcher in assign-only intarsia runs.
      assignConstraints.pieceSeamReserveMm = Number.isFinite(Number(options && options.pieceSeamReserveMm))
        ? Number(options.pieceSeamReserveMm)
        : 0;
      assignConstraints.seamAllowanceReserveMm = Number.isFinite(Number(options && options.seamAllowanceReserveMm))
        ? Number(options.seamAllowanceReserveMm)
        : assignConstraints.pieceSeamReserveMm;
      if (fillType === "regular") {
        assignConstraints.__assignOnly = true;
        const explainTopKRaw = Number(body && body.explainTopK);
        const explainTopK = Number.isFinite(explainTopKRaw)
          ? Math.max(1, Math.min(5, Math.floor(explainTopKRaw)))
          : 3;
        assignConstraints.__debugTopK = explainTopK;
        const minFitRaw = safeNum(assignConstraints.minFitScore);
        assignConstraints.minFitScore = minFitRaw === null ? 0 : Math.max(0, Math.min(8, Number(minFitRaw)));
        const minCovRaw = safeNum(assignConstraints.minCoverageRatio);
        assignConstraints.minCoverageRatio = minCovRaw === null ? 0.1 : Math.max(0.05, Math.min(0.35, Number(minCovRaw)));
        assignConstraints.minAlongMm = null;
        assignConstraints.minAcrossMm = null;
        assignConstraints.minAreaMm2 = null;
        assignConstraints.regularCompatibility = true;
        assignConstraints.enforceRegularQuality = true;
        assignConstraints.maxPiecesPerFragment = 2;
        assignConstraints.fragmentCoverageTarget = 0.94;
        assignConstraints.fragmentCoverageMinAccept = 0.94;
        // Keep nap constraints active in regular assign-only mode.
        // If caller did not provide them, fall back to sane defaults.
        const napDir = safeNum(assignConstraints.napDirectionDeg);
        const napTol = safeNum(assignConstraints.napToleranceDeg);
        // Canonical default nap direction is vertical down (90 deg).
        // Default nap tolerance for regular intarsia should stay strict unless
        // the caller explicitly widens it.
        assignConstraints.napDirectionDeg = napDir === null ? 90 : Number(napDir);
        assignConstraints.napToleranceDeg = napTol === null
          ? 0
          : Math.max(0, Math.min(180, Number(napTol)));
        // Prefilter must respect the same nap gate; otherwise diagnostics shows
        // many "compatible" candidates that can never survive real fit.
        assignConstraints.prefilterNapToleranceDeg = assignConstraints.napToleranceDeg;
      }
      const intarsiaMode = modeRegistry.require("intarsia");
      let assign = intarsiaMode.assign({
        fragments,
        candidates,
        placementStrategy: effectivePlacementStrategy,
        axis,
        filters,
        constraints: assignConstraints
      });
      const primaryAssign = assign && typeof assign === "object" ? assign : null;
      let finalPlacementStrategy = effectivePlacementStrategy;
      let matchedCount = Array.isArray(assign && assign.placements)
        ? assign.placements.filter((x) => String(x && x.status || "") === "matched").length
        : 0;
      let compatibleCount = Number(assign && assign.compatibilityBreakdown && assign.compatibilityBreakdown.compatible || 0);
      if (matchedCount === 0 && effectivePlacementStrategy === "intarsiaSmart") {
        pushProgress({
          type: "solver",
          phase: "intarsia_assign_fallback_bestfit",
          percent: 86,
          iter: 1,
          title: "Интарсия / fallback bestFit"
        });
        const fallbackBest = intarsiaMode.assign({
          fragments,
          candidates,
          placementStrategy: "bestFit",
          axis,
          filters,
          constraints: assignConstraints
        });
        const fallbackBestMatched = Array.isArray(fallbackBest && fallbackBest.placements)
          ? fallbackBest.placements.filter((x) => String(x && x.status || "") === "matched").length
          : 0;
        if (fallbackBestMatched > matchedCount) {
          assign = fallbackBest;
          finalPlacementStrategy = "bestFit";
          matchedCount = fallbackBestMatched;
        }
      }
      if (matchedCount === 0 && finalPlacementStrategy !== "greedy") {
        pushProgress({
          type: "solver",
          phase: "intarsia_assign_fallback_greedy",
          percent: 89,
          iter: 2,
          title: "Интарсия / fallback greedy"
        });
        const fallbackGreedy = intarsiaMode.assign({
          fragments,
          candidates,
          placementStrategy: "greedy",
          axis,
          filters,
          constraints: assignConstraints
        });
        const fallbackGreedyMatched = Array.isArray(fallbackGreedy && fallbackGreedy.placements)
          ? fallbackGreedy.placements.filter((x) => String(x && x.status || "") === "matched").length
          : 0;
        if (fallbackGreedyMatched > matchedCount) {
          assign = fallbackGreedy;
          finalPlacementStrategy = "greedy";
          matchedCount = fallbackGreedyMatched;
        }
      }
      let usedRelaxedNapFallback = false;
      let relaxedNapFallbackDeg = null;
      if (matchedCount === 0 && fillType === "regular") {
        const relaxedNapTol = Math.max(90, Number(safeNum(assignConstraints.napToleranceDeg) || 0));
        const relaxedFilters = { ...(filters || {}), napToleranceDeg: relaxedNapTol };
        const relaxedConstraints = {
          ...assignConstraints,
          napToleranceDeg: relaxedNapTol,
          prefilterNapToleranceDeg: relaxedNapTol
        };
        const relaxedAssign = intarsiaMode.assign({
          fragments,
          candidates,
          placementStrategy: finalPlacementStrategy,
          axis,
          filters: relaxedFilters,
          constraints: relaxedConstraints
        });
        const relaxedMatched = Array.isArray(relaxedAssign && relaxedAssign.placements)
          ? relaxedAssign.placements.filter((x) => String(x && x.status || "") === "matched").length
          : 0;
        const relaxedCompatible = Number(relaxedAssign && relaxedAssign.compatibilityBreakdown && relaxedAssign.compatibilityBreakdown.compatible || 0);
        if (
          relaxedMatched > matchedCount ||
          (matchedCount === 0 && relaxedMatched === 0 && relaxedCompatible > compatibleCount)
        ) {
          assign = relaxedAssign;
          matchedCount = relaxedMatched;
          compatibleCount = relaxedCompatible;
          usedRelaxedNapFallback = true;
          relaxedNapFallbackDeg = relaxedNapTol;
        }
      }
      let usedRelaxedCoverageFallback = false;
      let relaxedCoverageFallbackValue = null;
      if (matchedCount < fragments.length && fillType === "regular") {
        const curTarget = safeNum(assignConstraints.fragmentCoverageTarget);
        const curAccept = safeNum(assignConstraints.fragmentCoverageMinAccept);
        const baseCoverage = Math.min(
          curTarget === null ? 0.94 : Number(curTarget),
          curAccept === null ? 0.94 : Number(curAccept)
        );
        const relaxedCoverage = Math.max(0.82, Math.min(0.9, baseCoverage - 0.10));
        if (relaxedCoverage + 1e-6 < baseCoverage) {
          const relaxedCoverageConstraints = {
            ...assignConstraints,
            fragmentCoverageTarget: relaxedCoverage,
            fragmentCoverageMinAccept: relaxedCoverage
          };
          const relaxedCoverageAssign = intarsiaMode.assign({
            fragments,
            candidates,
            placementStrategy: finalPlacementStrategy,
            axis,
            filters,
            constraints: relaxedCoverageConstraints
          });
          const relaxedCoverageMatched = Array.isArray(relaxedCoverageAssign && relaxedCoverageAssign.placements)
            ? relaxedCoverageAssign.placements.filter((x) => String(x && x.status || "") === "matched").length
            : 0;
          const relaxedCoverageCompatible = Number(relaxedCoverageAssign && relaxedCoverageAssign.compatibilityBreakdown && relaxedCoverageAssign.compatibilityBreakdown.compatible || 0);
          if (
            relaxedCoverageMatched > matchedCount ||
            (matchedCount === 0 && relaxedCoverageMatched === 0 && relaxedCoverageCompatible > compatibleCount)
          ) {
            assign = relaxedCoverageAssign;
            matchedCount = relaxedCoverageMatched;
            compatibleCount = relaxedCoverageCompatible;
            usedRelaxedCoverageFallback = true;
            relaxedCoverageFallbackValue = relaxedCoverage;
          }
        }
      }
      const tAssignMs = Date.now() - tAssign0;
      let placements = Array.isArray(assign && assign.placements) ? assign.placements : [];
      // Ensure piece working area (Pcore) is always materialized in assign-only flow.
      // Important: keep alignedContour as full piece geometry; store reserve result in alignedCoreContour.
      const pieceSeamReserveAssignMm = Math.max(
        0,
        Number(safeNum(options && options.pieceSeamReserveMm) ?? safeNum(options && options.seamAllowanceReserveMm) ?? 0) || 0
      );
      if (placements.length) {
        placements = placements.map((pl) => {
          const p = pl && typeof pl === "object" ? { ...pl } : {};
          const full = Array.isArray(p.alignedContour) ? p.alignedContour : [];
          if (pieceSeamReserveAssignMm > 0 && full.length >= 3) {
            const wrk = buildPieceWorkingContour(full, pieceSeamReserveAssignMm);
            if (wrk && wrk.applied && Array.isArray(wrk.contour) && wrk.contour.length >= 3) {
              p.alignedCoreContour = wrk.contour;
              p.seamStatus = "ok";
              p.seamReserveMm = pieceSeamReserveAssignMm;
              return p;
            }
            p.alignedCoreContour = full;
            p.seamStatus = String(wrk && wrk.status || "failed");
            p.seamReserveMm = pieceSeamReserveAssignMm;
            return p;
          }
          if (!Array.isArray(p.alignedCoreContour) || p.alignedCoreContour.length < 3) {
            p.alignedCoreContour = full;
          }
          if (!Number.isFinite(Number(p.seamReserveMm))) p.seamReserveMm = pieceSeamReserveAssignMm;
          if (!p.seamStatus) p.seamStatus = pieceSeamReserveAssignMm > 0 ? "failed" : "disabled";
          return p;
        });
      }
      placements = enrichPlacementContoursForFragments(placements, fragments, zonePoints, zoneDomainMp);
      const visible = buildVisibleMosaicModel(placements, zonePoints, {
        layerPolicy: options.layerPolicy,
        minAreaMm2: visibleMinAreaMm2,
        maxPolygons: 500,
        minEdgeMm: Math.max(2, rasterMm * 2),
        spikeEdgeMm: Math.max(6, rasterMm * 5),
        spikeAngleDeg: 32,
        collinearEpsMm: Math.max(0.8, rasterMm * 0.7),
        preferPlacementInZoneContours: true,
        zoneDomainMp
      });
      const unmatched = placements.filter((p) => p.status !== "matched").length;
      const intersections = countPlacementIntersections(placements, { preferInZoneContours: true });
      const pieceIntersections = buildPieceIntersectionsLayer(placements, { preferInZoneContours: true });
      const uncoveredRatio = areaMm2 > 0 ? Math.max(0, areaMm2 - Number(visible.usefulAreaMm2 || 0)) / areaMm2 : 0;
      const usefulAreaMm2 = Number(visible.usefulAreaMm2 || 0);
      const selectedInZoneAreaMm2 = Number(visible.selectedInZoneAreaMm2 || 0);
      const selectedPiecesAreaMm2 = Number(visible.selectedPiecesAreaMm2 || selectedInZoneAreaMm2);
      const overlapAreaMm2 = Number(visible.overlapAreaMm2 || Math.max(0, selectedInZoneAreaMm2 - usefulAreaMm2));
      const coveragePercent = areaMm2 > 0 ? (usefulAreaMm2 / areaMm2) * 100 : 0;
      const residualAreaMm2 = Math.max(0, areaMm2 - usefulAreaMm2);
      const utilizationPct = selectedPiecesAreaMm2 > 0 ? (usefulAreaMm2 / selectedPiecesAreaMm2) * 100 : 0;
      const wastePct = Math.max(0, 100 - utilizationPct);
      const candidateAreaBudgetMm2 = (Array.isArray(candidates) ? candidates : []).reduce((acc, c) => {
        const v = Number(c && c.areaMm2);
        return acc + (Number.isFinite(v) && v > 0 ? v : 0);
      }, 0);
      const matchedFragmentIds = new Set(
        (Array.isArray(placements) ? placements : [])
          .filter((x) => String(x && x.status || "") === "matched")
          .map((x) => Number(x && x.fragmentId || 0))
          .filter((x) => Number.isFinite(x) && x > 0)
      );
      const stats = {
        fragmentsTotal: fragments.length,
        placementsMatched: matchedFragmentIds.size,
        violations: unmatched > 0 ? 1 : 0,
        intersections,
        uncovered: uncoveredRatio > 0.015 ? 1 : 0
      };
      const warnings = [];
      if (stats.violations > 0) warnings.push("insufficient_candidates_for_fragments");
      if (stats.uncovered > 0) warnings.push("zone_not_fully_covered");
      if (finalPlacementStrategy !== effectivePlacementStrategy) {
        warnings.push(`assign_fallback_${finalPlacementStrategy}`);
      }
      if (usedRelaxedNapFallback) warnings.push(`assign_fallback_relaxed_nap_${Number(relaxedNapFallbackDeg || 0)}`);
      if (usedRelaxedCoverageFallback) warnings.push(`assign_fallback_relaxed_coverage_${Number(relaxedCoverageFallbackValue || 0)}`);
      const splitPreview = { placements, splitEvents: [] };
      const matchedPct = fragments.length > 0
        ? Math.round((stats.placementsMatched / fragments.length) * 10000) / 100
        : 0;
      const coveragePct = areaMm2 > 0
        ? Math.round((Number(usefulAreaMm2 || 0) / areaMm2) * 10000) / 100
        : 0;
      const kpi = {
        fragmentsTotal: fragments.length,
        placementsMatched: stats.placementsMatched,
        placementsUnmatched: Math.max(0, fragments.length - stats.placementsMatched),
        matchedPct,
        coveragePct,
        uncoveredRatio: Math.round(uncoveredRatio * 100000) / 100000,
        strategyRequested: placementStrategy,
        strategyUsed: finalPlacementStrategy
      };
      const compatibilityBreakdown = assign && assign.compatibilityBreakdown && typeof assign.compatibilityBreakdown === "object"
        ? assign.compatibilityBreakdown
        : null;
      const placementBreakdown = assign && assign.placementBreakdown && typeof assign.placementBreakdown === "object"
        ? { ...assign.placementBreakdown }
        : {};
      const primaryPlacementBreakdown = primaryAssign && primaryAssign.placementBreakdown && typeof primaryAssign.placementBreakdown === "object"
        ? primaryAssign.placementBreakdown
        : null;
      if (
        (!placementBreakdown.topChoicesByFragment || typeof placementBreakdown.topChoicesByFragment !== "object" || !Object.keys(placementBreakdown.topChoicesByFragment).length) &&
        primaryPlacementBreakdown &&
        primaryPlacementBreakdown.topChoicesByFragment &&
        typeof primaryPlacementBreakdown.topChoicesByFragment === "object"
      ) {
        placementBreakdown.topChoicesByFragment = primaryPlacementBreakdown.topChoicesByFragment;
      }
      if (primaryPlacementBreakdown) {
        if (primaryPlacementBreakdown.rejected && typeof primaryPlacementBreakdown.rejected === "object") {
          placementBreakdown.primaryRejected = { ...primaryPlacementBreakdown.rejected };
        }
        if (Array.isArray(primaryPlacementBreakdown.fragmentCoverageWorst)) {
          placementBreakdown.primaryFragmentCoverageWorst = primaryPlacementBreakdown.fragmentCoverageWorst.slice();
        }
        if (Number.isFinite(Number(primaryPlacementBreakdown.coveredByTargetCount))) {
          placementBreakdown.primaryCoveredByTargetCount = Number(primaryPlacementBreakdown.coveredByTargetCount || 0);
        }
        if (Number.isFinite(Number(primaryPlacementBreakdown.coveredByMinAcceptCount))) {
          placementBreakdown.primaryCoveredByMinAcceptCount = Number(primaryPlacementBreakdown.coveredByMinAcceptCount || 0);
        }
        if (Number.isFinite(Number(primaryPlacementBreakdown.fragmentCoverageAvg))) {
          placementBreakdown.primaryFragmentCoverageAvg = Number(primaryPlacementBreakdown.fragmentCoverageAvg || 0);
        }
      }
      placementBreakdown.initialPlacementStrategy = effectivePlacementStrategy;
      placementBreakdown.finalPlacementStrategy = finalPlacementStrategy;
      placementBreakdown.fallbackUsed = effectivePlacementStrategy !== finalPlacementStrategy
        ? finalPlacementStrategy
        : "";
      placementBreakdown.regularNapToleranceDeg = Number(assignConstraints.napToleranceDeg || 0);
      placementBreakdown.relaxedNapFallbackDeg = Number(relaxedNapFallbackDeg || 0);
      placementBreakdown.relaxedCoverageFallback = usedRelaxedCoverageFallback ? 1 : 0;
      placementBreakdown.relaxedCoverageFallbackValue = Number(relaxedCoverageFallbackValue || 0);
      for (const p of Array.isArray(placements) ? placements : []) {
        const status = String((p && p.status) || "unknown");
        const reason = String((p && p.reason) || (status === "matched" ? "matched" : "unknown"));
        const key = `${status}:${reason}`;
        placementBreakdown[key] = Number(placementBreakdown[key] || 0) + 1;
      }
      pushProgress({
        type: "solver",
        phase: "intarsia_assign_done",
        percent: 94,
        iter: 3,
        title: "Интарсия / подбор завершён",
        matched: stats.placementsMatched,
        fragmentsTotal: stats.fragmentsTotal,
        uncovered: stats.uncovered
      });
      return jsonReply(res, 200, {
        ok: true,
        fillType,
        axis,
        placementStrategy: finalPlacementStrategy,
        assignOnly: true,
        zone: { areaMm2 },
        paramsSnapshot: { fillType, axis, placementStrategy, options, qualityMode, rasterMm, filters, constraints, normalizeRules, assignOnly: true },
        zOrderModel: String(visible.layerPolicy || options.layerPolicy || "priority_on_top"),
        seedUsed: options.seed,
        gridSpec,
        stats,
        kpi,
        warnings,
        coveragePercent: Math.round(coveragePercent * 100) / 100,
        residualAreaMm2: Math.round(residualAreaMm2 * 1000) / 1000,
        usedAreaMm2: Math.round(usefulAreaMm2 * 1000) / 1000,
        selectedInZoneAreaMm2: Math.round(selectedInZoneAreaMm2 * 1000) / 1000,
        selectedPiecesAreaMm2: Math.round(selectedPiecesAreaMm2 * 1000) / 1000,
        overlapAreaMm2: Math.round(overlapAreaMm2 * 1000) / 1000,
        utilizationPct: Math.round(utilizationPct * 100) / 100,
        wastePct: Math.round(wastePct * 100) / 100,
        candidateAreaBudgetMm2: Math.round(candidateAreaBudgetMm2 * 1000) / 1000,
        scrapUsage: {
          usefulAreaMm2: Math.round(usefulAreaMm2 * 1000) / 1000,
          usedScrapAreaMm2: Math.round(selectedInZoneAreaMm2 * 1000) / 1000,
          scrapUtilizationPercent: Math.round(utilizationPct * 100) / 100,
          scrapWastePercent: Math.round(wastePct * 100) / 100,
          outsideAreaMm2: Math.max(0, Math.round((selectedPiecesAreaMm2 - selectedInZoneAreaMm2) * 1000) / 1000),
          outsideShareOfSelectedPct: selectedPiecesAreaMm2 > 0
            ? Math.round(((selectedPiecesAreaMm2 - selectedInZoneAreaMm2) / selectedPiecesAreaMm2) * 10000) / 100
            : 0
        },
        diagnostics: (compatibilityBreakdown || Object.keys(placementBreakdown).length)
          ? {
              compatibilityBreakdown,
              placementBreakdown
            }
          : null,
        timingMs: { matching: tAssignMs },
        usedInventoryTags: assign.usedInventoryTags,
        compatibleCandidates: assign.compatibleCandidates,
        previewLayers: {
          pieceIntersections: pieceIntersections.polygons,
          pieceIntersectionPairs: pieceIntersections.pairCount,
          pieceIntersectionAreaMm2: pieceIntersections.totalAreaMm2,
          visibleArea: visible.visibleAreaPolygons,
          visibleAreaAreaMm2: visible.usefulAreaMm2
        },
        visibleContours: visible.visibleContours,
        visibleMetrics: {
          usefulAreaMm2: visible.usefulAreaMm2,
          selectedPiecesAreaMm2: visible.selectedPiecesAreaMm2,
          selectedInZoneAreaMm2: visible.selectedInZoneAreaMm2,
          utilizationPct: visible.utilizationPct,
          overlapAreaMm2: visible.overlapAreaMm2
        },
        droppedByNormalize: 0,
        fragments: visible.fragments,
        placements: splitPreview.placements,
        splitEvents: splitPreview.splitEvents,
        _contractDiag: buildContractDiag(zoneDom, visible.fragments)
      });
    }

    if (directInventory) {
      const tDirect0 = Date.now();
      pushProgress({ type: "phase", phase: "server_place", percent: 81, title: "Сервер / размещение кусков" });
      const directMode = modeRegistry.require(splitReturnEnabled ? "inventory_split_return" : "inventory_direct");
      const direct = await directMode.preview({ zonePoints, candidates, axis, filters, constraints, options });
      direct.placements = enrichPlacementContoursForZone(direct.placements, zonePoints, zoneDomainMp);
      direct.placements = fillGainCoreContours(direct.placements, zonePoints, zoneDomainMp);
      const solveOrder = Array.isArray(direct && direct.solveOrder) ? direct.solveOrder : [];
      const tDirectMs = Date.now() - tDirect0;
      const uncoveredRatio = Number.isFinite(Number(direct.coveredRatio))
        ? Math.max(0, 1 - Number(direct.coveredRatio))
        : 1;
      const directStrict = !!(direct && direct.strictCoverage === true);
      const directFullCoverageOk = !!(direct && direct.fullCoverageOk === true);
      const directViolation = directStrict && !directFullCoverageOk;
      const resultStatus = directViolation ? "failed" : "ok";
      const failedReason = directViolation
        ? String((direct && direct.failedReason) || "zone_not_fully_covered")
        : null;
      const visible = buildVisibleMosaicModel(direct.placements, zonePoints, {
        layerPolicy: options.layerPolicy,
        minAreaMm2: visibleMinAreaMm2,
        maxPolygons: 500,
        minEdgeMm: Math.max(2, rasterMm * 2),
        spikeEdgeMm: Math.max(6, rasterMm * 5),
        spikeAngleDeg: 32,
        collinearEpsMm: Math.max(0.8, rasterMm * 0.7),
        zoneDomainMp
      });
      {
        const toPts = (arr) => arr
          .map((q) => ({ x: Number(q && q.x), y: Number(q && q.y) }))
          .filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
        function extractPts(poly) {
          const outer = Array.isArray(poly) && Array.isArray(poly[0]) ? poly[0] : null;
          if (!outer) return null;
          const pts = [];
          for (let k = 0; k < outer.length - 1; k++) {
            const x = Number(outer[k] && outer[k][0]);
            const y = Number(outer[k] && outer[k][1]);
            if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
          }
          return pts.length >= 3 ? pts : null;
        }
        const matched = [];
        for (let pi = 0; pi < direct.placements.length; pi++) {
          const p = direct.placements[pi];
          if (!p || String(p.status || "") !== "matched") continue;
          const fullMp = Array.isArray(p.inZoneContours) && p.inZoneContours.length > 0
            ? p.inZoneContours
            : (Array.isArray(p.inZoneContour) && p.inZoneContour.length >= 3
              ? pointsToMultiPolygon(toPts(p.inZoneContour)) : []);
          const coreMp = Array.isArray(p.inZoneCoreContours) && p.inZoneCoreContours.length > 0
            ? p.inZoneCoreContours
            : (Array.isArray(p.inZoneCoreContour) && p.inZoneCoreContour.length >= 3
              ? pointsToMultiPolygon(toPts(p.inZoneCoreContour)) : []);
          const gainCoreMp = Array.isArray(p.gainCoreContours) && p.gainCoreContours.length > 0
            ? p.gainCoreContours : [];
          matched.push({ pi, p, fullMp, coreMp, gainCoreMp });
        }
        // Фрагмент[i] = diffMulti(fullMp[i], coveredCoresMp).
        // Граница между кусками идёт по линии шва (вычитаем ЯДРА предшественников, не полные контуры).
        // На краях зоны fullMp доходит до границы зоны — дырок в углах нет.
        let fragId = 1;
        const solverFragments = [];
        let coveredCoresMp = [];
        for (const { pi, p, fullMp, coreMp, gainCoreMp } of matched) {
          const ownerFragmentId = Number.isFinite(Number(p.fragmentId)) ? Number(p.fragmentId) : null;
          const scrapPieceId = String(p.scrapPieceId || "");
          const inventoryTag = String(p.inventoryTag || "");
          const cutPts = Array.isArray(p.inZoneContour) && p.inZoneContour.length >= 3
            ? toPts(p.inZoneContour) : null;
          let fragmentMp = fullMp;
          if (coveredCoresMp.length > 0 && fullMp.length > 0) {
            try { fragmentMp = diffMulti(fullMp, coveredCoresMp); } catch (_) { fragmentMp = fullMp; }
          }
          if (coreMp.length > 0) {
            coveredCoresMp = coveredCoresMp.length
              ? (function () { try { return unionMulti(coveredCoresMp, coreMp); } catch (_) { return coveredCoresMp; } })()
              : coreMp;
          }
          const fragCleanOpts = {
            minEdgeMm: Math.max(2, rasterMm * 2),
            spikeEdgeMm: Math.max(6, rasterMm * 5),
            spikeAngleDeg: 32,
            collinearEpsMm: Math.max(0.8, rasterMm * 0.7)
          };
          let addedForThisPi = 0;
          for (const poly of fragmentMp) {
            const rawPts = extractPts(poly);
            if (!rawPts || rawPts.length < 3) continue;
            const pts = cleanClosedPolygon(rawPts, fragCleanOpts);
            if (!pts || pts.length < 3) continue;
            const areaMm2 = polygonArea(pts);
            if (!Number.isFinite(areaMm2) || areaMm2 < visibleMinAreaMm2) continue;
            solverFragments.push({
              id: fragId++,
              points: pts,
              cutPoints: cutPts || pts,
              seamPoints: pts,
              cleanPoints: pts,
              areaMm2: Math.round((areaMm2 || 0) * 1000) / 1000,
              ownerPlacementId: ownerFragmentId,
              ownerPlacementIndex: pi,
              scrapPieceId,
              inventoryTag,
              zOrder: pi
            });
            addedForThisPi++;
          }
          if (addedForThisPi === 0 && cutPts && cutPts.length >= 3 && coreMp.length === 0) {
            // Fallback только если у куска нет ядра совсем — используем полный контур
            solverFragments.push({
              id: fragId++,
              points: cutPts,
              cutPoints: cutPts,
              seamPoints: cutPts,
              cleanPoints: cutPts,
              areaMm2: Math.round((polygonArea(cutPts) || 0) * 1000) / 1000,
              ownerPlacementId: ownerFragmentId,
              ownerPlacementIndex: pi,
              scrapPieceId,
              inventoryTag,
              zOrder: pi,
              isFallbackFragment: true
            });
          }
        }
        if (solverFragments.length > 0) visible.fragments = solverFragments;
      }
      const splitPreview = splitReturnEnabled
        ? (
          Array.isArray(direct && direct.splitEvents)
            ? { placements: direct.placements, splitEvents: direct.splitEvents }
            : buildSplitReturnPreviewArtifacts(direct.placements, visible.visibleContours, {
              minLeftoverAreaMm2: safeNum(body.minLeftoverAreaMm2),
              minLeftoverSpanMm: safeNum(body.minLeftoverSpanMm)
            })
        )
        : { placements: direct.placements, splitEvents: [] };
      const intersectionsByContour = countPlacementIntersections(direct.placements);
      pushProgress({
        type: "phase",
        phase: "server_coverage",
        percent: 90,
        title: "Сервер / проверка покрытия",
        pieces: Array.isArray(direct.placements) ? direct.placements.length : 0,
        coverage: Number(direct.coveragePercent || 0),
        residualAreaMm2: Number(direct.residualAreaMm2 || 0)
      });
      const overlapAreaMm2 = Number(visible.overlapAreaMm2 || 0);
      const pieceIntersections = buildPieceIntersectionsLayer(direct.placements);
      const intersections = Math.max(
        intersectionsByContour,
        overlapAreaMm2 > 1e-6 ? 1 : 0,
        pieceIntersections.pairCount
      );
      const stats = {
        fragmentsTotal: visible.fragments.length,
        placementsMatched: direct.placements.filter((x) => String(x && x.status || "") === "matched").length,
        violations: directViolation ? 1 : 0,
        intersections,
        uncovered: uncoveredRatio > 0.015 ? 1 : 0
      };
      const warnings = [];
      if (direct.placements.length === 0) warnings.push("no_direct_inventory_matches");
      if (direct.rejectedByOversize > 0) warnings.push("inventory_tail_oversize_rejected");
      if (direct.tailLastChanceUsed) warnings.push("inventory_tail_last_chance_used");
      if (direct.seamCheck && direct.seamCheck.seamFullOk === false) warnings.push("inventory_seam_check_failed");
      if (direct.rejectedNoFit > 0) warnings.push("inventory_no_progress");
      if (direct.tailPieceCapHit) warnings.push("inventory_tail_piece_cap");
      if (direct.timeBudgetExceeded) warnings.push("inventory_time_budget_exceeded");
      if (directViolation) warnings.push("full_coverage_required");
      if (stats.uncovered > 0) warnings.push("zone_not_fully_covered");
      const visibleUtilizationPct = Number(visible.utilizationPct || 0);
      const visibleWastePct = Math.max(0, 100 - visibleUtilizationPct);
      pushProgress({
        type: "phase",
        phase: "server_diag",
        percent: 94,
        title: "Сервер / сбор диагностики",
        pieces: Array.isArray(direct.placements) ? direct.placements.length : 0,
        coverage: Number(direct.coveragePercent || 0),
        utilization: visibleUtilizationPct,
        tail: visibleWastePct
      });
      pushProgress({ type: "done", percent: 99, title: "Сервер / ответ готов" });
      return jsonReply(res, 200, {
        ok: true,
        resultStatus,
        failedReason,
        fillType,
        axis,
        placementStrategy,
        layoutType: splitReturnEnabled ? "inventory_split_return" : "inventory_direct",
        splitReturnEnabled,
        directInventory: true,
        zone: { areaMm2 },
        paramsSnapshot: { fillType, axis, placementStrategy, options, qualityMode, rasterMm, filters, constraints, normalizeRules, directInventory: true },
        zOrderModel: String(visible.layerPolicy || options.layerPolicy || "priority_on_top"),
        renderOrderPolicy: String(visible.layerPolicy || options.layerPolicy || "priority_on_top"),
        stackOrderPolicy: String(options.stackOrderPolicy || options.layerPolicy || visible.layerPolicy || "priority_on_top"),
        seedUsed: options.seed,
        gridSpec,
        stats,
        warnings,
        timingMs: { matching: tDirectMs },
        usedInventoryTags: direct.usedInventoryTags,
        compatibleCandidates: direct.compatibleCandidates,
        coveragePercent: Number(direct.coveragePercent || 0),
        coveredRatio: Number(direct.coveredRatio || 0),
        residualAreaMm2: Number(direct.residualAreaMm2 || 0),
        strictCoverage: directStrict,
        coverageEps: Number(direct.coverageEps || 0),
        fullCoverageOk: directFullCoverageOk,
        tailLastChanceUsed: !!direct.tailLastChanceUsed,
        seamCheck: direct.seamCheck || null,
        solveOrder,
        diagnostics: direct.diagnostics || null,
        scrapUsage: direct.scrapUsage || null,
        overlapAreaMm2: Number(visible.overlapAreaMm2 || 0),
        usedAreaMm2: Number(visible.usefulAreaMm2 || 0),
        selectedPiecesAreaMm2: Number(visible.selectedPiecesAreaMm2 || 0),
        selectedInZoneAreaMm2: Number(visible.selectedInZoneAreaMm2 || 0),
        utilizationPct: visibleUtilizationPct,
        wastePct: visibleWastePct,
        candidateAreaBudgetMm2: Number(direct.candidateAreaBudgetMm2 || 0),
        algorithmTrace: direct.algorithmTrace || null,
        previewLayers: {
          pieceIntersections: pieceIntersections.polygons,
          pieceIntersectionPairs: pieceIntersections.pairCount,
          pieceIntersectionAreaMm2: pieceIntersections.totalAreaMm2,
          visibleArea: visible.visibleAreaPolygons,
          visibleAreaAreaMm2: visible.usefulAreaMm2
        },
        visibleContours: visible.visibleContours,
        visibleMetrics: {
          usefulAreaMm2: visible.usefulAreaMm2,
          selectedPiecesAreaMm2: visible.selectedPiecesAreaMm2,
          selectedInZoneAreaMm2: visible.selectedInZoneAreaMm2,
          utilizationPct: visible.utilizationPct,
          overlapAreaMm2: visible.overlapAreaMm2
        },
        droppedByNormalize: 0,
        fragments: visible.fragments,
        placements: splitPreview.placements,
        splitEvents: splitPreview.splitEvents,
        _contractDiag: buildContractDiag(zoneDom, visible.fragments)
      });
    }

    const intarsiaMode = modeRegistry.require("intarsia");
    const built = intarsiaMode.buildFragments({
      fillType,
      zonePoints,
      options,
      normalizeRules,
      axis,
      polygonArea
    });
    const normalized = built.normalized;
    // Clip fragments to zone domain (outer - holes) so fragments don't overlap hole areas
    let fragments = built.fragments;
    if (zoneDom.hasHoles && Array.isArray(zoneDomainMp) && zoneDomainMp.length) {
      const clippedFragments = [];
      for (const frag of fragments) {
        const pts = Array.isArray(frag && frag.points) ? frag.points : [];
        if (pts.length < 3) continue;
        try {
          const fragMp = pointsToMultiPolygon(pts);
          const clipped = intersectMulti(fragMp, zoneDomainMp);
          if (!clipped.length) continue;
          for (const poly of clipped) {
            if (!Array.isArray(poly) || !poly.length || !Array.isArray(poly[0])) continue;
            const ring = poly[0];
            const clippedPts = [];
            for (let k = 0; k < ring.length - 1; k++) {
              const x = Number(ring[k] && ring[k][0]);
              const y = Number(ring[k] && ring[k][1]);
              if (Number.isFinite(x) && Number.isFinite(y)) clippedPts.push({ x, y });
            }
            if (clippedPts.length < 3) continue;
            const clippedArea = polygonArea(clippedPts);
            if (clippedArea < 1) continue;
            clippedFragments.push({ ...frag, points: clippedPts, areaMm2: clippedArea });
          }
        } catch (_) { clippedFragments.push(frag); }
      }
      let _fragId = 1;
      fragments = clippedFragments.map((f) => ({ ...f, id: _fragId++ }));
    }
    const tAssign0 = Date.now();
    const assign = intarsiaMode.assign({
      fragments,
      candidates,
      placementStrategy,
      axis,
      filters,
      constraints
    });
    const tAssignMs = Date.now() - tAssign0;
    const placements = assign.placements;
    const pieceSeamReserveMm = Math.max(
      0,
      Number(safeNum(options && options.pieceSeamReserveMm) ?? safeNum(options && options.seamAllowanceReserveMm) ?? 0) || 0
    );
    const seamAdjusted = applyReserveToPlacements(placements, pieceSeamReserveMm);
    // Populate inZoneContour / inZoneCoreContour on placements so the report can show both areas.
    const enrichedPlacements = enrichPlacementContoursForZone(seamAdjusted.placements, zonePoints, zoneDomainMp);

    const visible = buildVisibleMosaicModel(placements, zonePoints, {
      layerPolicy: options.layerPolicy,
      minAreaMm2: visibleMinAreaMm2,
      maxPolygons: 500,
      minEdgeMm: Math.max(2, rasterMm * 2),
      spikeEdgeMm: Math.max(6, rasterMm * 5),
      spikeAngleDeg: 32,
      collinearEpsMm: Math.max(0.8, rasterMm * 0.7),
      zoneDomainMp
    });
    const visibleForMetrics = buildVisibleMosaicModel(seamAdjusted.placements, zonePoints, {
      layerPolicy: options.layerPolicy,
      minAreaMm2: visibleMinAreaMm2,
      maxPolygons: 500,
      minEdgeMm: Math.max(2, rasterMm * 2),
      spikeEdgeMm: Math.max(6, rasterMm * 5),
      spikeAngleDeg: 32,
      collinearEpsMm: Math.max(0.8, rasterMm * 0.7),
      zoneDomainMp
    });
    const unmatched = placements.filter((p) => p.status !== "matched").length;
    const intersections = countPlacementIntersections(placements);
    const pieceIntersections = buildPieceIntersectionsLayer(placements);

    const uncoveredRatio = areaMm2 > 0 ? Math.max(0, areaMm2 - Number(visibleForMetrics.usefulAreaMm2 || 0)) / areaMm2 : 0;
    const stats = {
      fragmentsTotal: visible.fragments.length,
      placementsMatched: placements.filter((x) => x.status === "matched").length,
      violations: unmatched > 0 || normalized.droppedBySize > 0 ? 1 : 0,
      intersections,
      uncovered: uncoveredRatio > 0.015 ? 1 : 0
    };
    const warnings = [];
    if (stats.violations > 0) warnings.push("insufficient_candidates_for_fragments");
    if (stats.uncovered > 0) warnings.push("zone_not_fully_covered");
    if (normalized.droppedBySize > 0) warnings.push("normalize_dropped_small_fragments");
    if (tAssignMs > 8000) warnings.push("matching_slow");
    if (seamAdjusted.failed > 0) warnings.push("seam_working_area_failed_for_some_placements");

    return jsonReply(res, 200, {
      ok: true,
      fillType,
      axis,
      placementStrategy,
      zone: { areaMm2 },
      paramsSnapshot: { fillType, axis, placementStrategy, options, qualityMode, rasterMm, filters, constraints, normalizeRules },
      zOrderModel: String(visible.layerPolicy || options.layerPolicy || "priority_on_top"),
      seedUsed: options.seed,
      gridSpec,
      stats,
      warnings,
      timingMs: {
        matching: tAssignMs
      },
      usedInventoryTags: assign.usedInventoryTags,
      compatibleCandidates: assign.compatibleCandidates,
      previewLayers: {
        pieceIntersections: pieceIntersections.polygons,
        pieceIntersectionPairs: pieceIntersections.pairCount,
        pieceIntersectionAreaMm2: pieceIntersections.totalAreaMm2,
        visibleArea: visible.visibleAreaPolygons,
        visibleAreaAreaMm2: visibleForMetrics.usefulAreaMm2
      },
      visibleContours: visible.visibleContours,
      visibleMetrics: {
        usefulAreaMm2: visibleForMetrics.usefulAreaMm2,
        selectedPiecesAreaMm2: visibleForMetrics.selectedPiecesAreaMm2,
        selectedInZoneAreaMm2: visibleForMetrics.selectedInZoneAreaMm2,
        utilizationPct: visibleForMetrics.utilizationPct,
        overlapAreaMm2: visibleForMetrics.overlapAreaMm2
      },
      seamCheck: {
        reserveMm: pieceSeamReserveMm,
        changedPlacements: seamAdjusted.changed,
        failedPlacements: seamAdjusted.failed,
        mode: pieceSeamReserveMm > 0 ? "piece_working_area" : "disabled"
      },
      droppedByNormalize: normalized.droppedBySize,
      fragments: visible.fragments,
      placements: enrichedPlacements,
      _contractDiag: buildContractDiag(zoneDom, visible.fragments)
    });
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/layout/fragment/candidates") {
    const body = await readBodyJson(req);
    const fragment = body.fragment || {};
    const fragPoints = normalizePolygonInput(fragment.points);
    if (fragPoints.length < 3) return jsonReply(res, 400, { ok: false, error: "fragment_points_required" });
    const axis = String(body.axis || "y").toLowerCase() === "x" ? "x" : "y";
    const filters = body.filters && typeof body.filters === "object" ? body.filters : {};
    const constraints = body.constraints && typeof body.constraints === "object" ? body.constraints : {};
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const excludeInventoryTags = Array.isArray(body.excludeInventoryTags) ? body.excludeInventoryTags : [];
    const limit = Math.max(1, Math.min(50, Number(body.limit || 5)));
    const ranked = rankCandidatesForFragment(
      { id: Number(fragment.id || 0), points: fragPoints, areaMm2: polygonArea(fragPoints) },
      candidates,
      axis,
      filters,
      constraints,
      limit,
      excludeInventoryTags
    );
    return jsonReply(res, 200, {
      ok: true,
      totalInput: candidates.length,
      totalRanked: ranked.length,
      items: ranked
    });
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/layout/manual/evaluate") {
    try {
      const body = await readBodyJson(req);
      const zone = body.zone || {};
      const zoneDom = buildZoneDomain(zone);
      const zonePoints = zoneDom.outerPoints;
      const zoneDomainMp = zoneDom.domainMp;
      if (zonePoints.length < 3) return jsonReply(res, 400, { ok: false, error: "zone_points_required" });
      const piecePoints = normalizePolygonInput(body.piecePoints);
      if (piecePoints.length < 3) return jsonReply(res, 400, { ok: false, error: "piece_points_required" });
      const minVisibleAreaMm2 = Math.max(0, Number(body.minVisibleAreaMm2 || 0));
      const minSpanMm = Math.max(0, Number(body.minSpanMm || 0));
      const fullPieceAreaMm2 = Math.max(0, polygonArea(piecePoints));
      const seamReserveAliasZone = safeNum(zone && zone.seamAllowanceReserveMm);
      const seamReserveAliasBody = safeNum(body.seamAllowanceReserveMm);
      const seamReserveBody = safeNum(body.pieceSeamReserveMm);
      const pieceSeamReserveMm = seamReserveBody !== null
        ? Number(seamReserveBody)
        : (seamReserveAliasBody !== null ? Number(seamReserveAliasBody) : (seamReserveAliasZone !== null ? Number(seamReserveAliasZone) : 0));
      const working = buildPieceWorkingContour(piecePoints, pieceSeamReserveMm);
      const corePiecePoints = (Number(pieceSeamReserveMm) > 1e-9)
        ? ((working && working.applied && Array.isArray(working.contour) && working.contour.length >= 3) ? working.contour : [])
        : (Array.isArray(piecePoints) && piecePoints.length >= 3 ? piecePoints : []);
      const pieceAreaMm2 = Math.max(0, polygonArea(piecePoints));
      const corePieceAreaMm2 = corePiecePoints.length >= 3 ? Math.max(0, polygonArea(corePiecePoints)) : 0;

      let zoneMulti = [];
      let pieceMulti = [];
      let inZoneMp = [];
      let corePieceMulti = [];
      let inZoneCoreMp = [];
      let coveredMp = [];
      let gainMp = [];
      let gainCoreMp = [];
      try {
        zoneMulti = (Array.isArray(zoneDomainMp) && zoneDomainMp.length) ? zoneDomainMp : pointsToMultiPolygon(zonePoints);
        pieceMulti = pointsToMultiPolygon(piecePoints);
        inZoneMp = intersectMulti(pieceMulti, zoneMulti);
        if (corePiecePoints.length >= 3) {
          corePieceMulti = pointsToMultiPolygon(corePiecePoints);
          inZoneCoreMp = intersectMulti(corePieceMulti, zoneMulti);
        } else {
          inZoneCoreMp = [];
        }
      } catch (err) {
        console.warn("[manual/evaluate] base geometry op failed:", err && err.message ? err.message : err);
        return jsonReply(res, 200, {
          ok: true,
          metrics: {
            pieceAreaMm2,
            fullPieceAreaMm2,
            workingPieceAreaMm2: corePieceAreaMm2,
            seamReserveMm: Math.max(0, Number(pieceSeamReserveMm || 0)),
            seamStatus: String(working.status || "unknown"),
            gainAreaMm2: 0,
            overlapInsideMm2: 0,
            outsideWasteMm2: pieceAreaMm2,
            utilization: 0,
            inZoneAreaMm2: 0,
            visibleSpanMm: 0,
            status: "geom_error",
            statusReason: "base_geometry_op_failed"
          },
          contours: { inZone: [], inZoneCore: [], coreWorld: [], gainVisible: [], gainCore: [] }
        });
      }

      const inZoneAreaMm2 = Math.max(0, multiPolygonArea(inZoneMp));
      const inZoneCoreAreaMm2 = Math.max(0, multiPolygonArea(inZoneCoreMp));
      const coveredContours = Array.isArray(body.coveredContours) ? body.coveredContours : [];
      for (const c of coveredContours) {
        const pts = normalizePolygonInput(c);
        if (pts.length < 3) continue;
        try {
          const mp = intersectMulti(pointsToMultiPolygon(pts), zoneMulti);
          if (!Array.isArray(mp) || !mp.length) continue;
          coveredMp = coveredMp.length ? unionMulti(coveredMp, mp) : mp;
        } catch (_) {
          // Skip invalid contour; do not fail full evaluate.
        }
      }
      try {
        gainMp = coveredMp.length ? diffMulti(inZoneMp, coveredMp) : inZoneMp;
        gainCoreMp = coveredMp.length ? diffMulti(inZoneCoreMp, coveredMp) : inZoneCoreMp;
      } catch (err) {
        console.warn("[manual/evaluate] diff op failed:", err && err.message ? err.message : err);
        gainMp = inZoneMp;
        gainCoreMp = inZoneCoreMp;
      }
      const gainAreaMm2 = Math.max(0, multiPolygonArea(gainMp));
      const overlapInsideMm2 = Math.max(0, inZoneAreaMm2 - gainAreaMm2);
      const outsideWasteMm2 = Math.max(0, pieceAreaMm2 - inZoneAreaMm2);
      const utilization = pieceAreaMm2 > 1e-9 ? (gainAreaMm2 / pieceAreaMm2) : 0;
      const visibleRing = largestOuterRingPointsLocal(gainMp);
      const vb = polygonBBox(visibleRing);
      const visibleSpanMm = vb ? Math.max(Number(vb.width || 0), Number(vb.height || 0)) : 0;
      const isTiny = (minVisibleAreaMm2 > 0 && gainAreaMm2 + 1e-9 < minVisibleAreaMm2) || (minSpanMm > 0 && visibleSpanMm + 1e-9 < minSpanMm);
      return jsonReply(res, 200, {
        ok: true,
        metrics: {
          pieceAreaMm2,
          fullPieceAreaMm2,
          workingPieceAreaMm2: corePieceAreaMm2,
          seamReserveMm: Math.max(0, Number(pieceSeamReserveMm || 0)),
          seamStatus: String(working.status || "unknown"),
          gainAreaMm2,
          gainCoreAreaMm2: Math.max(0, multiPolygonArea(gainCoreMp)),
          overlapInsideMm2,
          outsideWasteMm2,
          utilization,
          inZoneAreaMm2,
          inZoneCoreAreaMm2,
          visibleSpanMm,
          status: isTiny ? "tiny_fragment" : "ok",
          statusReason: isTiny ? "below_manual_threshold" : ""
        },
        contours: {
          inZone: inZoneMp,
          inZoneCore: inZoneCoreMp,
          coreWorld: corePieceMulti,
          gainVisible: gainMp,
          gainCore: gainCoreMp
        }
      });
    } catch (err) {
      console.warn("[manual/evaluate] unexpected error:", err && err.message ? err.message : err);
      return jsonReply(res, 200, {
        ok: true,
        metrics: {
          pieceAreaMm2: 0,
          fullPieceAreaMm2: 0,
          workingPieceAreaMm2: 0,
          seamReserveMm: 0,
          seamStatus: "geom_error",
          gainAreaMm2: 0,
          overlapInsideMm2: 0,
          outsideWasteMm2: 0,
          utilization: 0,
          inZoneAreaMm2: 0,
          visibleSpanMm: 0,
          status: "geom_error",
          statusReason: "unexpected_evaluate_error"
        },
        contours: { inZone: [], inZoneCore: [], coreWorld: [], gainVisible: [], gainCore: [] }
      });
    }
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/layout/manual/recompute") {
    const body = await readBodyJson(req);
    const zone = body.zone || {};
    const selectedZoneId = Number(body.selectedZoneId || 0);
    const zoneDom = buildZoneDomain(zone);
    const zonePoints = zoneDom.outerPoints;
    const zoneDomainMp = zoneDom.domainMp;
    if (zonePoints.length < 3) return jsonReply(res, 400, { ok: false, error: "zone_points_required" });
    const placementsRaw = Array.isArray(body.placements) ? body.placements : [];
    const pieceSeamReserveMm = Math.max(0, Number(body.pieceSeamReserveMm || 0));
    const placements = placementsRaw.map((pl) => {
      const p = pl && typeof pl === "object" ? { ...pl } : {};
      const full = normalizeContour(p.alignedContour);
      if (full.length >= 3) {
        const wrk = buildPieceWorkingContour(full, pieceSeamReserveMm);
        if (wrk && wrk.applied && Array.isArray(wrk.contour) && wrk.contour.length >= 3) {
          p.alignedCoreContour = wrk.contour;
          p.alignedCoreContours = pointsToMultiPolygon(wrk.contour);
          p.seamStatus = "ok";
        } else {
          p.alignedCoreContour = full;
          p.alignedCoreContours = pointsToMultiPolygon(full);
          p.seamStatus = String((wrk && wrk.status) || (pieceSeamReserveMm > 0 ? "failed" : "disabled"));
        }
        p.seamReserveMm = pieceSeamReserveMm;
      } else if (!Array.isArray(p.alignedCoreContour) || p.alignedCoreContour.length < 3) {
        p.alignedCoreContour = [];
        p.alignedCoreContours = [];
        p.seamStatus = pieceSeamReserveMm > 0 ? "failed" : "disabled";
        p.seamReserveMm = pieceSeamReserveMm;
      }
      return p;
    });
    const layerPolicy = String(body.layerPolicy || "first_on_top");
    const minAreaMm2 = Math.max(1, Number(body.minAreaMm2 || 1));
    const rasterMm = Math.max(1, Number(body.rasterMm || 2));
    const debugManual = body.debugManual === true;
    const visible = buildVisibleMosaicModel(placements, zonePoints, {
      layerPolicy,
      minAreaMm2,
      maxPolygons: 500,
      minEdgeMm: Math.max(2, rasterMm * 2),
      spikeEdgeMm: Math.max(6, rasterMm * 5),
      spikeAngleDeg: 32,
      collinearEpsMm: Math.max(0.8, rasterMm * 0.7),
      includeDebug: debugManual,
      zoneDomainMp
    });
    let seamVisible = buildVisibleMosaicModel(placements, zonePoints, {
      layerPolicy,
      geometrySource: "core",
      minAreaMm2,
      maxPolygons: 500,
      minEdgeMm: Math.max(2, rasterMm * 2),
      spikeEdgeMm: Math.max(6, rasterMm * 5),
      spikeAngleDeg: 32,
      collinearEpsMm: Math.max(0.8, rasterMm * 0.7),
      includeDebug: debugManual,
      zoneDomainMp
    });
    let seamGeometrySource = "core_visible";
    if (
      Number(pieceSeamReserveMm || 0) > 0 &&
      Array.isArray(visible.fragments) && visible.fragments.length > 0 &&
      (!Array.isArray(seamVisible.fragments) || seamVisible.fragments.length === 0)
    ) {
      // Keep manual mode usable on geometry edge-cases: if core clipping collapses to empty
      // while full clipping is non-empty, expose explicit fallback source for diagnostics.
      seamVisible = visible;
      seamGeometrySource = "core_visible_fallback_full";
    }

    const pieceIntersections = buildPieceIntersectionsLayer(placements, { preferInZoneContours: true });
    const payload = {
      ok: true,
      layerPolicy: visible.layerPolicy,
      selectedZoneId,
      recomputeZoneId: Number(zone && zone.id || 0),
      usedZoneFallback: false,
      // Manual mode contract: final fragments are built from working/core geometry.
      fragments: seamVisible.fragments,
      fragmentsFull: visible.fragments,
      visibleContours: visible.visibleContours,
      seamVisibleContours: seamVisible.visibleContours,
      seamGeometrySource,
      pieceIntersections: pieceIntersections.polygons,
      visibleMetrics: {
        usefulAreaMm2: visible.usefulAreaMm2,
        selectedPiecesAreaMm2: visible.selectedPiecesAreaMm2,
        selectedInZoneAreaMm2: visible.selectedInZoneAreaMm2,
        utilizationPct: visible.utilizationPct,
        overlapAreaMm2: visible.overlapAreaMm2,
        pieceIntersectionPairs: pieceIntersections.pairCount,
        pieceIntersectionAreaMm2: pieceIntersections.totalAreaMm2
      }
    };
    const impossibleZero = !!(
      Array.isArray(placements) &&
      placements.length > 0 &&
      Number(visible.usefulAreaMm2 || 0) <= 1e-9 &&
      Number(visible.selectedPiecesAreaMm2 || 0) <= 1e-9
    );
    if (impossibleZero) {
      payload.warning = "manual_recompute_selected_zone_mismatch";
    }
    if (debugManual) {
      const zoneBBox = polygonBBox(zonePoints);
      payload.debug = {
        zone: {
          id: Number(zone && zone.id || 0),
          area: Math.round(Math.max(0, polygonArea(zonePoints)) * 1000) / 1000,
          bbox: zoneBBox ? {
            minX: Number(zoneBBox.minX || 0),
            minY: Number(zoneBBox.minY || 0),
            maxX: Number(zoneBBox.maxX || 0),
            maxY: Number(zoneBBox.maxY || 0),
            width: Number(zoneBBox.width || 0),
            height: Number(zoneBBox.height || 0)
          } : null
        },
        placementsReceived: Array.isArray(placements) ? placements.length : 0,
        placementsMatched: Array.isArray(placements) ? placements.filter((p) => String(p && p.status || "") === "matched").length : 0,
        placements: Array.isArray(visible.debugPlacements) ? visible.debugPlacements : [],
        seamFragmentFlow: Array.isArray(seamVisible.debugFragmentFlow) ? seamVisible.debugFragmentFlow : [],
        fullFragmentFlow: Array.isArray(visible.debugFragmentFlow) ? visible.debugFragmentFlow : [],
        selectedZoneId,
        recomputeZoneId: Number(zone && zone.id || 0),
        usedZoneFallback: false,
        seamGeometrySource,
        seamContoursCount: Array.isArray(seamVisible.visibleContours) ? seamVisible.visibleContours.length : 0,
        warning: impossibleZero ? "manual_recompute_selected_zone_mismatch" : ""
      };
      console.info("[manual/recompute][debug]", JSON.stringify(payload.debug));
    }
    return jsonReply(res, 200, payload);
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/layout/manual/suggest") {
    const body = await readBodyJson(req);
    const zone = body.zone || {};
    const zoneDom = buildZoneDomain(zone);
    const zonePoints = zoneDom.outerPoints;
    if (zonePoints.length < 3) return jsonReply(res, 400, { ok: false, error: "zone_points_required" });
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const suggestCount = Math.max(1, Math.min(10, Number(body.suggestCount || 5)));
    const axis = String(body.axis || "y").toLowerCase() === "x" ? "x" : "y";
    const filters = body.filters && typeof body.filters === "object" ? body.filters : {};
    const constraints = body.constraints && typeof body.constraints === "object" ? body.constraints : { requireScrapContour: true };
    const options = body.options && typeof body.options === "object" ? body.options : {};
    const excludes = new Set((Array.isArray(body.excludeInventoryTags) ? body.excludeInventoryTags : []).map((x) => String(x || "").trim()).filter(Boolean));

    let solveZonePoints = zonePoints.slice();
    const coveredContours = Array.isArray(body.coveredContours) ? body.coveredContours : [];
    if (coveredContours.length) {
      const zoneMp = pointsToMultiPolygon(zonePoints);
      let coveredMp = [];
      for (const c of coveredContours) {
        const pts = normalizePolygonInput(c);
        if (pts.length < 3) continue;
        const mp = intersectMulti(pointsToMultiPolygon(pts), zoneMp);
        if (!Array.isArray(mp) || !mp.length) continue;
        coveredMp = coveredMp.length ? unionMulti(coveredMp, mp) : mp;
      }
      if (coveredMp.length) {
        const residualMp = diffMulti(zoneMp, coveredMp);
        const largest = largestOuterRingPointsLocal(residualMp);
        if (largest.length >= 3) solveZonePoints = largest;
      }
    }

    const suggestions = [];
    const directMode = modeRegistry.require("inventory_direct");
    let poolLeft = candidates.slice();
    for (let i = 0; i < suggestCount; i++) {
      poolLeft = poolLeft.filter((c) => !excludes.has(String(c && (c.inventoryTag || c.id) || "").trim()));
      if (!poolLeft.length) break;
      const { run, placement: p } = await directMode.suggestSingle({
        zonePoints: solveZonePoints,
        candidates: poolLeft,
        axis,
        filters,
        constraints,
        options: {
          ...options,
          strictCoverage: false,
          strictCoverageHard: false,
          coverageTarget: 0.2,
          maxPieces: 1,
          minPieces: 1,
          maxSolveMs: Math.max(6000, Math.min(30000, Number(options.maxSolveMs || 12000))),
          hardMaxSolveMs: Math.max(12000, Math.min(60000, Number(options.hardMaxSolveMs || 24000)))
        }
      });
      if (!p) break;
      suggestions.push({
        placement: p,
        fragment: Array.isArray(run.fragments) ? (run.fragments[0] || null) : null,
        metrics: {
          gainAreaMm2: Number(p.gainAreaMm2 || 0),
          overlapAreaMm2: Number(p.overlapAreaMm2 || 0),
          outsideAreaMm2: Number(p.outsideAreaMm2 || 0),
          utilizationLocal: Number(p.utilizationLocal || 0),
          fitScore: Number(p.fitScore || 0)
        }
      });
      const takenTag = String(p.inventoryTag || "").trim();
      if (takenTag) excludes.add(takenTag);
      if (takenTag) {
        poolLeft = poolLeft.filter((c) => String(c && (c.inventoryTag || c.id) || "").trim() !== takenTag);
      }
    }
    return jsonReply(res, 200, {
      ok: true,
      suggestions
    });
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/intarsia/apply-fragments") {
    const body = await readBodyJson(req);
    const input = body && typeof body === "object" ? body : {};
    // Accept either zone.zoneContour (with holes) or legacy flat zonePoints array
    const zoneInput = input.zone && typeof input.zone === "object" ? input.zone : null;
    const legacyZonePoints = Array.isArray(input.zonePoints) ? input.zonePoints : [];
    const zoneDom = zoneInput
      ? buildZoneDomain(zoneInput)
      : buildZoneDomain({ points: legacyZonePoints });
    const zonePoints = zoneDom.outerPoints;
    const fragments = Array.isArray(input.fragments) ? input.fragments : [];
    // isSplitOp=true means strict single-fragment split validation (multipolygon + containment checks)
    const isSplitOp = input.isSplitOp === true;
    if (zonePoints.length < 3) return jsonReply(res, 400, { ok: false, error: "zone_required" });
    if (fragments.length === 0) return jsonReply(res, 400, { ok: false, error: "fragments_required" });

    const zoneMp = (Array.isArray(zoneDom.domainMp) && zoneDom.domainMp.length)
      ? zoneDom.domainMp
      : pointsToMultiPolygon(zonePoints);

    function ringToPoints(ring) {
      return (ring || []).map((p) => Array.isArray(p) ? { x: p[0], y: p[1] } : p)
        .filter((p) => Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
    }
    function mpToPointsArray(mp) {
      const result = [];
      if (!Array.isArray(mp)) return result;
      for (const poly of mp) {
        if (!Array.isArray(poly) || !poly.length) continue;
        const outer = ringToPoints(poly[0]);
        if (outer.length < 3) continue;
        result.push(outer);
      }
      return result;
    }
    function mpTotalArea(mp) {
      let total = 0;
      for (const poly of (Array.isArray(mp) ? mp : [])) {
        if (!Array.isArray(poly) || !Array.isArray(poly[0])) continue;
        const pts = ringToPoints(poly[0]);
        total += polygonArea(pts);
      }
      return total;
    }

    // Clip each fragment to zone → subZones
    const subZones = [];
    let allFragsMp = null;
    for (let i = 0; i < fragments.length; i++) {
      const fragPoints = Array.isArray(fragments[i] && fragments[i].points) ? fragments[i].points : [];
      if (fragPoints.length < 3) continue;
      const fragMp = pointsToMultiPolygon(fragPoints);
      const clipped = intersectMulti(fragMp, zoneMp);
      for (const pts of mpToPointsArray(clipped)) {
        subZones.push({ points: pts, label: `Фрагмент ${i + 1}` });
      }
      // Use clipped (not original) geometry for remainder calculation — fragments may extend outside zone.
      if (clipped && clipped.length > 0) {
        allFragsMp = allFragsMp ? unionMulti(allFragsMp, clipped) : clipped;
      }
    }

    // For split operations: validate containment and no multipolygon remainder
    if (isSplitOp && allFragsMp) {
      // Containment check: cut contour must be fully inside zone
      const cutOutside = diffMulti(allFragsMp, zoneMp);
      const cutOutsideArea = mpTotalArea(cutOutside);
      const GEOM_TOLERANCE_MM2 = 1.0; // 1 mm²
      if (cutOutsideArea > GEOM_TOLERANCE_MM2) {
        return jsonReply(res, 400, { ok: false, error: "drawn_contour_outside_zone" });
      }
    }

    // Remainder: zone minus union of all fragments
    const remainderZones = [];
    if (allFragsMp) {
      const rem = diffMulti(zoneMp, allFragsMp);
      if (Array.isArray(rem)) {
        // For split operations: block multipolygon remainder
        if (isSplitOp) {
          const outerPolygons = rem.filter((poly) => {
            if (!Array.isArray(poly) || !poly.length) return false;
            const outer = ringToPoints(poly[0]);
            return outer.length >= 3 && polygonArea(outer) > 1.0;
          });
          if (outerPolygons.length > 1) {
            return jsonReply(res, 400, { ok: false, error: "split_would_create_multipolygon" });
          }
        }
        for (const poly of rem) {
          if (!Array.isArray(poly) || !poly.length) continue;
          const outer = ringToPoints(poly[0]);
          if (outer.length < 3) continue;
          const holes = poly.slice(1).map(ringToPoints).filter((h) => h.length >= 3);
          remainderZones.push({ points: outer, holes, label: "Остаток" });
        }
      }
    }

    const splitOperationId = isSplitOp
      ? `sop_${Date.now()}_${Math.floor(Math.random() * 1000000)}`
      : null;

    return jsonReply(res, 200, { ok: true, subZones, remainderZones, splitOperationId, _contractDiag: buildContractDiag(zoneDom, subZones) });
  }

  return false;
}

module.exports = {
  handleLayoutRoutes
};
