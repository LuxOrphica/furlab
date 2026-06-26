// Pattern entity filtering/normalization — window.FurLabPatternEntities
(function (global) {

  let _state = null;
  let _getPreviewSourceType = null;

  function init(ctx) {
    _state = ctx.state;
    _getPreviewSourceType = ctx.getPreviewSourceType;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------
  function segmentIntersection(a, b, c, d) {
    function orient(p, q, r) {
      return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    }
    function onSeg(p, q, r) {
      return Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x) &&
        Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);
    }
    const o1 = orient(a, b, c), o2 = orient(a, b, d);
    const o3 = orient(c, d, a), o4 = orient(c, d, b);
    if ((o1 > 0 && o2 < 0 || o1 < 0 && o2 > 0) && (o3 > 0 && o4 < 0 || o3 < 0 && o4 > 0)) return true;
    if (o1 === 0 && onSeg(a, c, b)) return true;
    if (o2 === 0 && onSeg(a, d, b)) return true;
    if (o3 === 0 && onSeg(c, a, d)) return true;
    if (o4 === 0 && onSeg(c, b, d)) return true;
    return false;
  }

  function contourLooksNoisy(points, bbox) {
    if (!Array.isArray(points) || points.length < 8) return true;
    const w = Math.max(1, Number(bbox && bbox.width || 0));
    const h = Math.max(1, Number(bbox && bbox.height || 0));
    const perimeter = 2 * (w + h);
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      length += Math.hypot(dx, dy);
    }
    if (length > perimeter * 7.5) return true;
    const n = points.length;
    if (n > 2200) return true;
    let intersections = 0;
    const maxChecks = 2500;
    let checks = 0;
    for (let i = 0; i + 1 < n - 1; i++) {
      const a = points[i], b = points[i + 1];
      for (let j = i + 2; j + 1 < n; j++) {
        if (i === 0 && j === n - 2) continue;
        const c = points[j], d = points[j + 1];
        if (segmentIntersection(a, b, c, d)) {
          intersections++;
          if (intersections > 14) return true;
        }
        checks++;
        if (checks >= maxChecks) break;
      }
      if (checks >= maxChecks) break;
    }
    return false;
  }

  function bridgeIntersectsTooMuch(points, bridgeA, bridgeB) {
    let hits = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i], b = points[i + 1];
      if (!a || !b) continue;
      if (i === 0 || i === points.length - 2) continue;
      if (segmentIntersection(bridgeA, bridgeB, a, b)) {
        hits++;
        if (hits > 2) return true;
      }
    }
    return false;
  }

  function normEntity(e) {
    const pts = Array.isArray(e && e.points) ? e.points : [];
    if (pts.length < 2) return { entity: e, closedEff: !!(e && e.closed), bbox: null, area: 0, smartClosed: false };
    let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
    for (const p of pts) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const w = Number.isFinite(minX) ? (maxX - minX) : 0;
    const h = Number.isFinite(minY) ? (maxY - minY) : 0;
    const diag = Math.hypot(w, h);
    const first = pts[0];
    const last = pts[pts.length - 1];
    const endDist = Math.hypot(last.x - first.x, last.y - first.y);
    const nearClosed = endDist <= Math.max(2, diag * 0.025);
    const closedEff = !!(e && e.closed) || nearClosed;
    if (closedEff && _state.view.autoCloseContours && (!e.closed) && nearClosed) {
      const np = pts.slice();
      np.push({ x: first.x, y: first.y });
      return {
        entity: { ...e, points: np, closed: true, smartClosed: true, smartCloseBridge: { from: { ...last }, to: { ...first }, dist: endDist } },
        closedEff: true,
        bbox: { minX, minY, maxX, maxY, width: w, height: h },
        area: w * h,
        smartClosed: true
      };
    }
    const bbox = { minX, minY, maxX, maxY, width: w, height: h };
    if (!closedEff && _state.view.smartCloseGaps && pts.length >= 3) {
      const tolAbs = Math.max(2, Number(_state.view.gapTolerance || 40));
      const tolRel = Math.max(2, diag * 0.08);
      const tol = Math.max(tolAbs, tolRel);
      const maxBridge = Math.max(tolAbs, Math.min(Math.max(w, h) * 0.3, (w + h) * 0.35));
      if (endDist <= tol && endDist <= maxBridge && !bridgeIntersectsTooMuch(pts, last, first)) {
        const np = pts.slice();
        np.push({ x: first.x, y: first.y });
        return {
          entity: { ...e, points: np, closed: true, smartClosed: true, smartCloseBridge: { from: { ...last }, to: { ...first }, dist: endDist } },
          closedEff: true,
          bbox,
          noisy: contourLooksNoisy(np, bbox),
          area: w * h,
          smartClosed: true
        };
      }
    }
    return {
      entity: e,
      closedEff,
      bbox,
      noisy: contourLooksNoisy(pts, bbox),
      area: w * h,
      smartClosed: false
    };
  }

  // ---------------------------------------------------------------------------
  // Main export
  // ---------------------------------------------------------------------------
  function getRenderablePatternEntities() {
    const g = _state.patternGeometry;
    if (!g || !Array.isArray(g.entities)) {
      _state.filterStats = { total: 0, noisy: 0, open: 0, minPoints: 0, tooSmall: 0, dedup: 0, capped: 0, shown: 0, smartClosed: 0 };
      return [];
    }
    const src = g.entities;
    const stats = { total: src.length, noisy: 0, open: 0, minPoints: 0, tooSmall: 0, dedup: 0, capped: 0, shown: 0, smartClosed: 0, fallbackRaw: 0 };

    const normalized = src.map(normEntity);
    stats.smartClosed = normalized.filter((x) => x.smartClosed === true).length;

    if (!_state.view.majorContoursOnly) {
      stats.shown = src.length;
      _state.filterStats = stats;
      return src;
    }

    const previewSourceType = _getPreviewSourceType();
    const modeAll = String(_state.view.partsMode || "main") === "all";
    const compactZprj = previewSourceType === "zprj" && _state.view.zprjCompactView === true;
    const minPointsUser = Math.max(4, Number(_state.view.minContourPoints || 0));
    const maxContoursUser = Math.max(10, Number(_state.view.maxContours || 0));
    const minPointsBase = modeAll ? Math.min(minPointsUser, 12) : minPointsUser;
    const maxContoursBase = modeAll ? Math.max(maxContoursUser, 400) : maxContoursUser;
    const minPoints = compactZprj ? Math.max(minPointsBase, 24) : minPointsBase;
    const maxContours = compactZprj ? Math.min(maxContoursBase, 80) : maxContoursBase;
    const rejectNoisy = compactZprj ? true : (modeAll ? false : !!_state.view.rejectNoisyContours);
    const minWidthHeight = modeAll ? 3 : 8;

    const scored = [];
    for (const n of normalized) {
      const e = n.entity;
      const pts = Array.isArray(e && e.points) ? e.points : [];
      const isClosed = !!n.closedEff;
      if (rejectNoisy && n.noisy) { stats.noisy++; continue; }
      if (_state.view.closedContoursOnly && !isClosed) { stats.open++; continue; }
      const requiredPoints = isClosed ? minPoints : Math.round(minPoints * 1.6);
      if (pts.length < requiredPoints) { stats.minPoints++; continue; }
      const b = n.bbox;
      if (!b) continue;
      if (b.width < minWidthHeight || b.height < minWidthHeight) { stats.tooSmall++; continue; }
      const score = n.area + pts.length * 10 + (isClosed ? 1000000 : 0);
      scored.push({ e, score, bbox: b });
    }
    scored.sort((a, b) => b.score - a.score);

    const dedup = [];
    const out = [];
    for (const s of scored) {
      const b = s.bbox;
      const dup = dedup.some((d) =>
        Math.abs(d.minX - b.minX) < 3 &&
        Math.abs(d.minY - b.minY) < 3 &&
        Math.abs(d.maxX - b.maxX) < 3 &&
        Math.abs(d.maxY - b.maxY) < 3
      );
      if (dup) { stats.dedup++; continue; }
      dedup.push(b);
      out.push(s.e);
      if (out.length >= maxContours) {
        stats.capped = Math.max(0, scored.length - out.length - stats.dedup);
        break;
      }
    }

    if (out.length === 0 && src.length > 0) {
      stats.fallbackRaw = 1;
      stats.shown = src.length;
      _state.filterStats = stats;
      return src;
    }
    stats.shown = out.length;
    _state.filterStats = stats;
    return out;
  }

  // ---------------------------------------------------------------------------
  // computeDetailsFromEntities — pure, no state
  // ---------------------------------------------------------------------------
  function computeDetailsFromEntities(entities) {
    const detailCandidates = [];
    for (const e of entities) {
      const pts = Array.isArray(e.points) ? e.points : [];
      if (pts.length < 10) continue;
      let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
      for (const p of pts) {
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) continue;
      const width = maxX - minX;
      const height = maxY - minY;
      const area = width * height;
      if (width < 15 || height < 15 || area < 400) continue;
      detailCandidates.push({ entity: e, bbox: { minX, minY, maxX, maxY, width, height }, area, points: pts.length });
    }
    detailCandidates.sort((a, b) => b.area - a.area);
    const dedup = [];
    for (const d of detailCandidates) {
      const isDup = dedup.some((x) =>
        Math.abs(x.bbox.minX - d.bbox.minX) < 4 &&
        Math.abs(x.bbox.minY - d.bbox.minY) < 4 &&
        Math.abs(x.bbox.maxX - d.bbox.maxX) < 4 &&
        Math.abs(x.bbox.maxY - d.bbox.maxY) < 4
      );
      if (!isDup) dedup.push(d);
    }
    return dedup.slice(0, 400).map((d, i) => ({
      id: i + 1,
      name: `Деталь ${i + 1}`,
      bbox: d.bbox,
      area: d.area,
      points: d.points,
      entity: d.entity
    }));
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  global.FurLabPatternEntities = {
    init,
    getRenderablePatternEntities,
    computeDetailsFromEntities,
  };

})(window);
