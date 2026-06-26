// Zone / detail / placement spatial lookup helpers — delegated via window.FurLabZoneLookups
(function (global) {

  let _state = null;
  let _isInventoryLike = null;
  let _isManualMode = null;

  function init(ctx) {
    _state = ctx.state;
    _isInventoryLike = ctx.isInventoryLikeLayoutMode;
    _isManualMode = ctx.isManualInventoryMode;
  }

  // ---------------------------------------------------------------------------
  // Utility aliases (resolved at call time — no load-order dependency)
  // ---------------------------------------------------------------------------
  function distance2(a, b)         { return window.FurLabUtils.distance2(a, b); }
  function pointInPolygon(pt, poly) { return window.FurLabUtils.pointInPolygon(pt, poly); }
  function dist2Seg(p, a, b)        { return window.FurLabUtils.dist2PointToSegment(p, a, b); }

  // ---------------------------------------------------------------------------
  // Zone / vertex lookups
  // ---------------------------------------------------------------------------
  function findZoneAt(worldPoint) {
    for (let i = _state.zones.length - 1; i >= 0; i--) {
      const z = _state.zones[i];
      if (z.points.length >= 3 && pointInPolygon(worldPoint, z.points)) return z;
    }
    return null;
  }

  function findVertexAt(worldPoint, thresholdPx = 14) {
    const zone = _state.zones.find((z) => Number(z && z.id) === Number(_state.selectedZoneId));
    if (!zone) return null;
    const thr = thresholdPx / _state.viewport.scale;
    const thr2 = thr * thr;
    let best = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (let i = 0; i < zone.points.length; i++) {
      const d2 = distance2(worldPoint, zone.points[i]);
      if (d2 > thr2) continue;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { zone, vertexIndex: i, distance2: d2 };
      }
    }
    return best;
  }

  function findNearestVertexInSelectedZone(worldPoint) {
    const zone = _state.zones.find((z) => Number(z && z.id) === Number(_state.selectedZoneId));
    if (!zone || !Array.isArray(zone.points) || zone.points.length === 0) return null;
    let best = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (let i = 0; i < zone.points.length; i++) {
      const d2 = distance2(worldPoint, zone.points[i]);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { zone, vertexIndex: i, distance2: d2 };
      }
    }
    return best;
  }

  function findLayoutFragmentAt(worldPoint) {
    if (!_state.layoutRun.active) return null;
    const zoneId = Number(_state.layoutRun.selectedZoneId || 0);
    if (!zoneId) return null;
    const frags = Array.isArray(_state.layoutRun.fragments) ? _state.layoutRun.fragments : [];
    for (let i = frags.length - 1; i >= 0; i--) {
      const f = frags[i];
      const pts = Array.isArray(f && f.points) ? f.points : [];
      if (pts.length >= 3 && pointInPolygon(worldPoint, pts)) {
        return { fragmentId: Number(f.id || 0), zoneId };
      }
    }
    const isDirectInv = _isInventoryLike(_state.layoutMode) && !_isManualMode();
    if (isDirectInv) {
      const placements = Array.isArray(_state.layoutRun.placements) ? _state.layoutRun.placements : [];
      for (let i = placements.length - 1; i >= 0; i--) {
        const p = placements[i];
        if (!p || String(p.status || "") !== "matched") continue;
        const pts = Array.isArray(p.inZoneCoreContour) && p.inZoneCoreContour.length >= 3
          ? p.inZoneCoreContour
          : (Array.isArray(p.alignedCoreContour) && p.alignedCoreContour.length >= 3 ? p.alignedCoreContour : []);
        if (pts.length >= 3 && pointInPolygon(worldPoint, pts)) {
          const frag = frags.find((f) => Number(f.ownerPlacementIndex) === i);
          if (frag) return { fragmentId: Number(frag.id || 0), zoneId };
          console.warn("[findLayoutFragmentAt] placement hit but no fragment found", {
            pi: i, tag: p.inventoryTag, scrap: p.scrapPieceId,
            fragOwners: frags.map((f) => Number(f.ownerPlacementIndex))
          });
        }
      }
      for (let i = placements.length - 1; i >= 0; i--) {
        const p = placements[i];
        if (!p || String(p.status || "") !== "matched") continue;
        const pts = Array.isArray(p.inZoneContour) && p.inZoneContour.length >= 3
          ? p.inZoneContour : [];
        if (pts.length >= 3 && pointInPolygon(worldPoint, pts)) {
          const frag = frags.find((f) => Number(f.ownerPlacementIndex) === i);
          if (frag) return { fragmentId: Number(frag.id || 0), zoneId };
          console.warn("[findLayoutFragmentAt] inZoneContour hit but no fragment found", {
            pi: i, tag: p.inventoryTag, scrap: p.scrapPieceId,
            fragOwners: frags.map((f) => Number(f.ownerPlacementIndex))
          });
        }
      }
    }
    return null;
  }

  function findManualPlacementAt(worldPoint) {
    if (!_isManualMode()) return null;
    const placements = Array.isArray(_state.layoutRun && _state.layoutRun.placements) ? _state.layoutRun.placements : [];
    for (let i = placements.length - 1; i >= 0; i--) {
      const p = placements[i];
      if (!p || String(p.status || "") !== "matched") continue;
      const pts = Array.isArray(p.alignedContour) ? p.alignedContour : [];
      if (pts.length >= 3 && pointInPolygon(worldPoint, pts)) return { placementIndex: i, placement: p };
    }
    return null;
  }

  function findDetailAt(worldPoint, thresholdPx = 8) {
    if (!Array.isArray(_state.details) || _state.details.length === 0) return null;
    const thr = thresholdPx / _state.viewport.scale;
    const thr2 = thr * thr;
    let best = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    const focusedZone = _state.zones.find((z) => Number(z.id) === Number(_state.selectedZoneId || 0)) || null;
    const focusedDetailId = focusedZone ? Number(focusedZone.detailId || 0) : 0;
    const detailsToRender = focusedDetailId
      ? _state.details.filter((d) => Number(d.id) === focusedDetailId)
      : _state.details;

    for (const d of detailsToRender) {
      const e = d && d.entity;
      const pts = Array.isArray(e && e.points) ? e.points : [];
      if (pts.length < 2) continue;
      let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
      for (const p of pts) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      if (
        worldPoint.x < minX - thr || worldPoint.x > maxX + thr ||
        worldPoint.y < minY - thr || worldPoint.y > maxY + thr
      ) continue;
      if (e.closed && pts.length >= 3 && pointInPolygon(worldPoint, pts)) return d;
      for (let i = 0; i + 1 < pts.length; i++) {
        const d2 = dist2Seg(worldPoint, pts[i], pts[i + 1]);
        if (d2 <= thr2 && d2 < bestD2) {
          bestD2 = d2;
          best = d;
        }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Detail boundary helpers
  // ---------------------------------------------------------------------------
  const _detailBoundaryCache = new Map();

  function getDetailBoundaryPointsForZone(zone) {
    const detailId = Number(zone && zone.detailId || 0) || 0;
    if (!detailId) return [];
    if (_detailBoundaryCache.has(detailId)) return _detailBoundaryCache.get(detailId);
    let result = [];
    if (Array.isArray(_state.details)) {
      const detail = _state.details.find((item) => Number(item && item.id || 0) === detailId) || null;
      const pts = Array.isArray(detail && detail.entity && detail.entity.points) ? detail.entity.points : [];
      if (pts.length >= 3) result = pts;
    }
    if (result.length < 3 && Array.isArray(_state.zones)) {
      const baseZone = _state.zones.find((z) =>
        Number(z && z.detailId || 0) === detailId && String(z && z.originType || "") === "base"
      ) || null;
      const basePts = Array.isArray(baseZone && baseZone.points) ? baseZone.points : [];
      if (basePts.length >= 3) result = basePts;
    }
    _detailBoundaryCache.set(detailId, result);
    return result;
  }

  function invalidateDetailBoundaryCache() { _detailBoundaryCache.clear(); }

  function projectPointToBoundary(points, worldPoint) {
    const pts = Array.isArray(points) ? points : [];
    if (pts.length < 2 || !worldPoint) return null;
    let best = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    const closed = pts.length >= 3;
    const last = closed ? pts.length : (pts.length - 1);
    for (let i = 0; i < last; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const vx = b.x - a.x, vy = b.y - a.y;
      const wx = worldPoint.x - a.x, wy = worldPoint.y - a.y;
      const c2 = vx * vx + vy * vy;
      if (c2 <= 1e-9) continue;
      const t = Math.max(0, Math.min(1, (vx * wx + vy * wy) / c2));
      const projected = { x: a.x + t * vx, y: a.y + t * vy };
      const d2 = distance2(worldPoint, projected);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { x: projected.x, y: projected.y, distance2: d2 };
      }
    }
    return best;
  }

  function isZoneVertexOnDetailBoundary(zone, vertexIndex, thresholdPx = 8) {
    const pts = Array.isArray(zone && zone.points) ? zone.points : [];
    const idx = Number(vertexIndex);
    if (!Number.isFinite(idx) || idx < 0 || idx >= pts.length) return false;
    const detailBoundary = getDetailBoundaryPointsForZone(zone);
    if (detailBoundary.length < 2) return false;
    const projected = projectPointToBoundary(detailBoundary, pts[idx]);
    if (!projected) return false;
    const thresholdMm = thresholdPx / Math.max(0.0001, Number(_state.viewport && _state.viewport.scale || 1));
    return Number(projected.distance2 || 0) <= thresholdMm * thresholdMm;
  }

  function isZoneVertexOnSharedBoundary(zone, vertexIndex, thresholdPx = 8) {
    const pts = Array.isArray(zone && zone.points) ? zone.points : [];
    const idx = Number(vertexIndex);
    if (!Number.isFinite(idx) || idx < 0 || idx >= pts.length) return false;
    const thresholdMm = thresholdPx / Math.max(0.0001, Number(_state.viewport && _state.viewport.scale || 1));
    const threshold2 = thresholdMm * thresholdMm;
    const point = pts[idx];
    const siblings = (Array.isArray(_state.zones) ? _state.zones : []).filter((item) =>
      Number(item && item.id || 0) !== Number(zone && zone.id || 0)
      && Number(item && item.detailId || 0) === Number(zone && zone.detailId || 0)
      && Array.isArray(item && item.points)
      && item.points.length >= 2
    );
    for (const sibling of siblings) {
      const projected = projectPointToBoundary(sibling.points, point);
      if (projected && Number(projected.distance2 || 0) <= threshold2) return true;
    }
    return false;
  }

  function findSharedBoundaryVertexLinks(zone, vertexIndex, thresholdPx = 8) {
    const pts = Array.isArray(zone && zone.points) ? zone.points : [];
    const idx = Number(vertexIndex);
    if (!Number.isFinite(idx) || idx < 0 || idx >= pts.length) return [];
    const thresholdMm = thresholdPx / Math.max(0.0001, Number(_state.viewport && _state.viewport.scale || 1));
    const threshold2 = thresholdMm * thresholdMm;
    const point = pts[idx];
    const links = [];
    const siblings = (Array.isArray(_state.zones) ? _state.zones : []).filter((item) =>
      Number(item && item.id || 0) !== Number(zone && zone.id || 0)
      && Number(item && item.detailId || 0) === Number(zone && zone.detailId || 0)
      && Array.isArray(item && item.points)
      && item.points.length >= 2
    );
    for (const sibling of siblings) {
      let bestIndex = -1;
      let bestD2 = Number.POSITIVE_INFINITY;
      for (let i = 0; i < sibling.points.length; i++) {
        const d2 = distance2(point, sibling.points[i]);
        if (d2 < bestD2) {
          bestD2 = d2;
          bestIndex = i;
        }
      }
      if (bestIndex >= 0 && bestD2 <= threshold2) {
        links.push({
          zoneId: Number(sibling.id || 0) || null,
          vertexIndex: bestIndex,
          from: { x: Number(sibling.points[bestIndex].x), y: Number(sibling.points[bestIndex].y) }
        });
      }
    }
    return links;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  global.FurLabZoneLookups = {
    init,
    findZoneAt,
    findVertexAt,
    findNearestVertexInSelectedZone,
    findLayoutFragmentAt,
    findManualPlacementAt,
    findDetailAt,
    getDetailBoundaryPointsForZone,
    invalidateDetailBoundaryCache,
    projectPointToBoundary,
    isZoneVertexOnDetailBoundary,
    isZoneVertexOnSharedBoundary,
    findSharedBoundaryVertexLinks,
  };

})(window);
