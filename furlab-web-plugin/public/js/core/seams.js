// FurLab Seam computation helpers — pure functions, no state, no DOM
// Exposes window.FurLabSeams
// Depends on: window.FurLabGeom
(function (global) {

  function polygonArea(pts) { return window.FurLabGeom.polygonArea(pts); }

  // ---------------------------------------------------------------------------

  function toPointList(raw) {
    return (Array.isArray(raw) ? raw : [])
      .map((p) => ({ x: Number(p && p.x), y: Number(p && p.y) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  }

  function multiLargestOuterPoints(multi) {
    const polys = Array.isArray(multi) ? multi : [];
    let best = [];
    let bestArea = 0;
    for (const poly of polys) {
      const outer = Array.isArray(poly) && Array.isArray(poly[0]) ? poly[0] : null;
      if (!Array.isArray(outer) || outer.length < 4) continue;
      const pts = [];
      for (let i = 0; i < outer.length - 1; i++) {
        const x = Number(outer[i] && outer[i][0]);
        const y = Number(outer[i] && outer[i][1]);
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
      }
      if (pts.length < 3) continue;
      const area = Math.abs(polygonArea(pts));
      if (area > bestArea) {
        bestArea = area;
        best = pts;
      }
    }
    return best;
  }

  function contourBBox(points) {
    const pts = Array.isArray(points) ? points : [];
    if (pts.length < 3) return null;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of pts) {
      const x = Number(p && p.x);
      const y = Number(p && p.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  function extractOuterContoursFromMulti(multi) {
    const out = [];
    for (const poly of (Array.isArray(multi) ? multi : [])) {
      const outer = Array.isArray(poly) && Array.isArray(poly[0]) ? poly[0] : null;
      if (!Array.isArray(outer) || outer.length < 4) continue;
      const pts = [];
      for (let i = 0; i < outer.length - 1; i++) {
        const x = Number(outer[i] && outer[i][0]);
        const y = Number(outer[i] && outer[i][1]);
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
      }
      if (pts.length >= 3) out.push(pts);
    }
    return out;
  }

  function contourEdges(contour) {
    const pts = Array.isArray(contour) ? contour : [];
    if (pts.length < 3) return [];
    const edges = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ax = Number(a && a.x), ay = Number(a && a.y);
      const bx = Number(b && b.x), by = Number(b && b.y);
      if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (!(len > 1e-6)) continue;
      edges.push({ ax, ay, bx, by, dx, dy, len });
    }
    return edges;
  }

  function sharedCollinearSegment(edgeA, edgeB, opts) {
    const tolDistMm = Math.max(0.2, Number(opts && opts.tolDistMm || 0.8));
    const tolParallel = Math.max(1e-6, Number(opts && opts.tolParallel || 0.01));
    const minLenMm = Math.max(0.5, Number(opts && opts.minLenMm || 5));
    const cross = Math.abs((edgeA.dx * edgeB.dy) - (edgeA.dy * edgeB.dx));
    const denom = Math.max(1e-9, edgeA.len * edgeB.len);
    if ((cross / denom) > tolParallel) return null;
    const distPointToLine = (x, y) => Math.abs((edgeA.dx * (y - edgeA.ay)) - (edgeA.dy * (x - edgeA.ax))) / Math.max(1e-9, edgeA.len);
    if (distPointToLine(edgeB.ax, edgeB.ay) > tolDistMm) return null;
    if (distPointToLine(edgeB.bx, edgeB.by) > tolDistMm) return null;
    const ux = edgeA.dx / edgeA.len;
    const uy = edgeA.dy / edgeA.len;
    const project = (x, y) => ((x - edgeA.ax) * ux) + ((y - edgeA.ay) * uy);
    const a0 = 0;
    const a1 = edgeA.len;
    const b0 = project(edgeB.ax, edgeB.ay);
    const b1 = project(edgeB.bx, edgeB.by);
    const lo = Math.max(Math.min(a0, a1), Math.min(b0, b1));
    const hi = Math.min(Math.max(a0, a1), Math.max(b0, b1));
    const overlap = hi - lo;
    if (!(overlap >= minLenMm)) return null;
    const p1 = { x: edgeA.ax + (ux * lo), y: edgeA.ay + (uy * lo) };
    const p2 = { x: edgeA.ax + (ux * hi), y: edgeA.ay + (uy * hi) };
    return { p1, p2, lengthMm: overlap };
  }

  function seamKey(seg, aKey, bKey) {
    const q = (n) => Math.round(Number(n || 0) * 100) / 100;
    const p1 = seg && seg.p1 ? seg.p1 : { x: 0, y: 0 };
    const p2 = seg && seg.p2 ? seg.p2 : { x: 0, y: 0 };
    const pa = `${q(p1.x)},${q(p1.y)}`;
    const pb = `${q(p2.x)},${q(p2.y)}`;
    const pp = pa <= pb ? `${pa}|${pb}` : `${pb}|${pa}`;
    const aa = String(aKey || "");
    const bb = String(bKey || "");
    const ab = aa <= bb ? `${aa}::${bb}` : `${bb}::${aa}`;
    return `${ab}::${pp}`;
  }

  function pointSegDistance(pt, a, b) {
    const px = Number(pt && pt.x);
    const py = Number(pt && pt.y);
    const ax = Number(a && a.x);
    const ay = Number(a && a.y);
    const bx = Number(b && b.x);
    const by = Number(b && b.y);
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
      return Number.POSITIVE_INFINITY;
    }
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const ab2 = abx * abx + aby * aby;
    const t = ab2 > 1e-9 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2)) : 0;
    const cx = ax + abx * t;
    const cy = ay + aby * t;
    return Math.hypot(px - cx, py - cy);
  }

  function minDistancePointToEdges(pt, edges) {
    let best = Number.POSITIVE_INFINITY;
    for (const e of Array.isArray(edges) ? edges : []) {
      const d = pointSegDistance(pt, { x: e.ax, y: e.ay }, { x: e.bx, y: e.by });
      if (d < best) best = d;
    }
    return best;
  }

  function seamOnZoneBoundary(seam, zonePoints, tolMm) {
    const pts = Array.isArray(seam && seam.points) ? seam.points : [];
    if (pts.length < 2 || !Array.isArray(zonePoints) || zonePoints.length < 3) return false;
    const zoneEdges = contourEdges(zonePoints);
    if (!zoneEdges.length) return false;
    const p1 = pts[0];
    const p2 = pts[pts.length - 1];
    const pm = {
      x: (Number(p1 && p1.x || 0) + Number(p2 && p2.x || 0)) * 0.5,
      y: (Number(p1 && p1.y || 0) + Number(p2 && p2.y || 0)) * 0.5
    };
    const tol = Math.max(0.5, Number(tolMm || 1.4));
    const d1 = minDistancePointToEdges(p1, zoneEdges);
    const d2 = minDistancePointToEdges(p2, zoneEdges);
    const dm = minDistancePointToEdges(pm, zoneEdges);
    return d1 <= tol && d2 <= tol && dm <= tol;
  }

  function computeSeamSegmentsFromEdgeItems(itemsInput, opts, diagnosticsOut) {
    const diag = diagnosticsOut && typeof diagnosticsOut === "object" ? diagnosticsOut : null;
    const tolDistMm = Math.max(0.2, Number(opts && opts.tolDistMm || 0.8));
    const minLenMm = Math.max(0.5, Number(opts && opts.minLenMm || 5));
    const items = (Array.isArray(itemsInput) ? itemsInput : []).filter((x) => Array.isArray(x && x.edges) && x.edges.length > 0);
    const seams = [];
    const seen = new Set();
    let candidatePairs = 0;
    const rejectReasons = {
      same_owner: 0,
      disjoint: 0,
      point_touch_only: 0,
      shared_border_too_short: 0,
      not_collinear: 0
    };
    const pairSamples = [];
    function addReject(reason, a, b, maxSharedLenMm) {
      if (Object.prototype.hasOwnProperty.call(rejectReasons, reason)) rejectReasons[reason] += 1;
      if (pairSamples.length >= 120) return;
      pairSamples.push({
        fragmentA: Number(a && (a.fragmentId || a.placementIndex || a.idx) || 0),
        fragmentB: Number(b && (b.fragmentId || b.placementIndex || b.idx) || 0),
        ownerA: String(a && (a.scrapPieceId || a.inventoryTag || `p${a.ownerPlacementIndex}`) || ""),
        ownerB: String(b && (b.scrapPieceId || b.inventoryTag || `p${b.ownerPlacementIndex}`) || ""),
        rejectReason: String(reason || "unknown"),
        maxSharedLenMm: Math.round(Number(maxSharedLenMm || 0) * 1000) / 1000
      });
    }
    const bboxTol = tolDistMm + 1;
    function bboxDisjoint(a, b) {
      if (!a || !b) return true;
      return (
        Number(a.maxX) + bboxTol < Number(b.minX) ||
        Number(b.maxX) + bboxTol < Number(a.minX) ||
        Number(a.maxY) + bboxTol < Number(b.minY) ||
        Number(b.maxY) + bboxTol < Number(a.minY)
      );
    }
    for (let i = 0; i < items.length; i += 1) {
      const a = items[i];
      for (let j = i + 1; j < items.length; j += 1) {
        const b = items[j];
        const aKey = a.scrapPieceId || a.inventoryTag || `p${Number.isFinite(a.ownerPlacementIndex) ? a.ownerPlacementIndex : a.idx}`;
        const bKey = b.scrapPieceId || b.inventoryTag || `p${Number.isFinite(b.ownerPlacementIndex) ? b.ownerPlacementIndex : b.idx}`;
        if (aKey === bKey) {
          addReject("same_owner", a, b, 0);
          continue;
        }
        candidatePairs += 1;
        if (bboxDisjoint(a.bbox, b.bbox)) {
          addReject("disjoint", a, b, 0);
          continue;
        }
        let acceptedInPair = false;
        let hasShortShared = false;
        let hasPointTouchOnly = false;
        let hasAnyEdgeOverlap = false;
        let maxSharedLenMm = 0;
        for (const ea of a.edges) {
          const minAx = Math.min(ea.ax, ea.bx), maxAx = Math.max(ea.ax, ea.bx);
          const minAy = Math.min(ea.ay, ea.by), maxAy = Math.max(ea.ay, ea.by);
          for (const eb of b.edges) {
            const minBx = Math.min(eb.ax, eb.bx), maxBx = Math.max(eb.ax, eb.bx);
            const minBy = Math.min(eb.ay, eb.by), maxBy = Math.max(eb.ay, eb.by);
            if (maxAx + bboxTol < minBx || maxBx + bboxTol < minAx || maxAy + bboxTol < minBy || maxBy + bboxTol < minAy) continue;
            hasAnyEdgeOverlap = true;
            const endpointTouch =
              (Math.hypot(ea.ax - eb.ax, ea.ay - eb.ay) <= tolDistMm) ||
              (Math.hypot(ea.ax - eb.bx, ea.ay - eb.by) <= tolDistMm) ||
              (Math.hypot(ea.bx - eb.ax, ea.by - eb.ay) <= tolDistMm) ||
              (Math.hypot(ea.bx - eb.bx, ea.by - eb.by) <= tolDistMm);
            if (endpointTouch) hasPointTouchOnly = true;
            const segAny = sharedCollinearSegment(ea, eb, { ...(opts || {}), minLenMm: 0.1 });
            if (!segAny) continue;
            maxSharedLenMm = Math.max(maxSharedLenMm, Number(segAny.lengthMm || 0));
            if (Number(segAny.lengthMm || 0) < minLenMm) {
              hasShortShared = true;
              continue;
            }
            const key = seamKey(segAny, aKey, bKey);
            if (!seen.has(key)) {
              seen.add(key);
              seams.push({
                pieceA: {
                  placementIndex: Number.isFinite(a.ownerPlacementIndex) ? a.ownerPlacementIndex : a.idx,
                  ownerPlacementId: Number.isFinite(a.ownerPlacementId) ? a.ownerPlacementId : 0,
                  scrapPieceId: a.scrapPieceId,
                  inventoryTag: a.inventoryTag
                },
                pieceB: {
                  placementIndex: Number.isFinite(b.ownerPlacementIndex) ? b.ownerPlacementIndex : b.idx,
                  ownerPlacementId: Number.isFinite(b.ownerPlacementId) ? b.ownerPlacementId : 0,
                  scrapPieceId: b.scrapPieceId,
                  inventoryTag: b.inventoryTag
                },
                lengthMm: Math.round(Number(segAny.lengthMm || 0) * 1000) / 1000,
                points: [
                  { x: Number(segAny.p1 && segAny.p1.x || 0), y: Number(segAny.p1 && segAny.p1.y || 0) },
                  { x: Number(segAny.p2 && segAny.p2.x || 0), y: Number(segAny.p2 && segAny.p2.y || 0) }
                ]
              });
            }
            acceptedInPair = true;
          }
        }
        if (!acceptedInPair) {
          if (hasShortShared) addReject("shared_border_too_short", a, b, maxSharedLenMm);
          else if (hasPointTouchOnly) addReject("point_touch_only", a, b, maxSharedLenMm);
          else if (!hasAnyEdgeOverlap) addReject("disjoint", a, b, maxSharedLenMm);
          else addReject("not_collinear", a, b, maxSharedLenMm);
        }
      }
    }
    if (diag) {
      diag.fragmentsCount = items.length;
      diag.candidatePairs = candidatePairs;
      diag.acceptedSeams = seams.length;
      diag.rejectReasons = rejectReasons;
      diag.pairSamples = pairSamples;
    }
    return seams;
  }

  function computeSeamSegmentsFromVisibleContours(visibleContours, opts, diagnosticsOut) {
    const diag = diagnosticsOut && typeof diagnosticsOut === "object" ? diagnosticsOut : null;
    const list = Array.isArray(visibleContours) ? visibleContours : [];
    const items = list.map((vc, idx) => {
      const contours = extractOuterContoursFromMulti(vc && vc.visibleContours);
      const edges = [];
      for (const contour of contours) edges.push(...contourEdges(contour));
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const contour of contours) {
        for (const p of contour) {
          minX = Math.min(minX, Number(p && p.x));
          minY = Math.min(minY, Number(p && p.y));
          maxX = Math.max(maxX, Number(p && p.x));
          maxY = Math.max(maxY, Number(p && p.y));
        }
      }
      const bbox = Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)
        ? { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
        : null;
      return {
        idx,
        fragmentId: Number(vc && vc.ownerPlacementId || 0),
        placementIndex: Number(vc && vc.placementIndex || idx),
        ownerPlacementIndex: Number(vc && vc.placementIndex || idx),
        ownerPlacementId: Number(vc && vc.ownerPlacementId || 0),
        scrapPieceId: String(vc && vc.scrapPieceId || ""),
        inventoryTag: String(vc && vc.inventoryTag || ""),
        areaMm2: Math.max(0, Number(vc && vc.visibleAreaMm2 || 0)),
        pointCount: contours.reduce((acc, c) => acc + Number(Array.isArray(c) ? c.length : 0), 0),
        bbox,
        edges
      };
    }).filter((x) => Array.isArray(x.edges) && x.edges.length > 0);
    if (diag) {
      diag.fragments = items.map((it) => ({
        fragmentId: Number(it.fragmentId || 0),
        ownerPlacementIndex: Number.isFinite(it.ownerPlacementIndex) ? it.ownerPlacementIndex : -1,
        ownerPlacementId: Number.isFinite(it.ownerPlacementId) ? it.ownerPlacementId : 0,
        pieceId: String(it.scrapPieceId || ""),
        inventoryTag: String(it.inventoryTag || ""),
        areaMm2: Math.round(Number(it.areaMm2 || 0) * 1000) / 1000,
        pointCount: Number(it.pointCount || 0),
        bbox: it.bbox
          ? {
              minX: Math.round(it.bbox.minX * 1000) / 1000,
              minY: Math.round(it.bbox.minY * 1000) / 1000,
              maxX: Math.round(it.bbox.maxX * 1000) / 1000,
              maxY: Math.round(it.bbox.maxY * 1000) / 1000,
              width: Math.round(it.bbox.width * 1000) / 1000,
              height: Math.round(it.bbox.height * 1000) / 1000
            }
          : null
      }));
    }
    return computeSeamSegmentsFromEdgeItems(items, opts, diag);
  }

  function computeSeamSegmentsFromAppliedFragments(fragments, opts, diagnosticsOut) {
    const diag = diagnosticsOut && typeof diagnosticsOut === "object" ? diagnosticsOut : null;
    const list = (Array.isArray(fragments) ? fragments : [])
      .map((f, idx) => {
        const seamSrc = (Array.isArray(f && f.seamPoints) && f.seamPoints.length >= 3)
          ? f.seamPoints
          : (Array.isArray(f && f.points) ? f.points : []);
        const points = seamSrc
          .map((q) => ({ x: Number(q && q.x), y: Number(q && q.y) }))
          .filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
        if (points.length < 3) return null;
        const edges = contourEdges(points);
        if (!edges.length) return null;
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const p of points) {
          minX = Math.min(minX, Number(p && p.x));
          minY = Math.min(minY, Number(p && p.y));
          maxX = Math.max(maxX, Number(p && p.x));
          maxY = Math.max(maxY, Number(p && p.y));
        }
        const bbox = Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)
          ? { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
          : null;
        return {
          idx,
          fragmentId: Number(f && f.id || 0),
          ownerPlacementIndex: Number(f && f.ownerPlacementIndex),
          ownerPlacementId: Number(f && f.ownerPlacementId),
          scrapPieceId: String(f && f.scrapPieceId || ""),
          inventoryTag: String(f && f.inventoryTag || ""),
          areaMm2: Math.max(0, Number(f && f.areaMm2 || 0)),
          pointCount: points.length,
          bbox,
          edges
        };
      })
      .filter(Boolean);
    if (diag) {
      diag.fragments = list.map((it) => ({
        fragmentId: Number(it.fragmentId || 0),
        ownerPlacementIndex: Number.isFinite(it.ownerPlacementIndex) ? it.ownerPlacementIndex : -1,
        ownerPlacementId: Number.isFinite(it.ownerPlacementId) ? it.ownerPlacementId : 0,
        pieceId: String(it.scrapPieceId || ""),
        inventoryTag: String(it.inventoryTag || ""),
        areaMm2: Math.round(Number(it.areaMm2 || 0) * 1000) / 1000,
        pointCount: Number(it.pointCount || 0),
        bbox: it.bbox
          ? {
              minX: Math.round(it.bbox.minX * 1000) / 1000,
              minY: Math.round(it.bbox.minY * 1000) / 1000,
              maxX: Math.round(it.bbox.maxX * 1000) / 1000,
              maxY: Math.round(it.bbox.maxY * 1000) / 1000,
              width: Math.round(it.bbox.width * 1000) / 1000,
              height: Math.round(it.bbox.height * 1000) / 1000
            }
          : null
      }));
    }
    return computeSeamSegmentsFromEdgeItems(list, opts, diagnosticsOut);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  global.FurLabSeams = {
    toPointList,
    multiLargestOuterPoints,
    contourBBox,
    extractOuterContoursFromMulti,
    contourEdges,
    sharedCollinearSegment,
    seamKey,
    pointSegDistance,
    minDistancePointToEdges,
    seamOnZoneBoundary,
    computeSeamSegmentsFromEdgeItems,
    computeSeamSegmentsFromVisibleContours,
    computeSeamSegmentsFromAppliedFragments,
  };

})(window);
