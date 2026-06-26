"use strict";

function buildCandidatePool(params) {
  const {
    candidates,
    filters,
    constraints,
    axis,
    maxPointsPerCandidate,
    parseScrapContourPoints,
    polygonBBox,
    transformScrapNapDegToWorld,
    safeNum,
    polygonArea,
    isCandidateCompatible,
    translateToAnchor,
    samplePolyline,
    normalizeDeg
  } = params;

  function simplifyContourForSearch(points, maxPts) {
    const src = Array.isArray(points) ? points : [];
    const lim = Math.max(16, Math.floor(Number(maxPts) || 90));
    if (src.length <= lim) return src;
    const pts = [];
    for (const p of src) {
      const x = Number(p && p.x);
      const y = Number(p && p.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const prev = pts[pts.length - 1];
      if (!prev || Math.hypot(prev.x - x, prev.y - y) > 1e-9) pts.push({ x, y });
    }
    if (pts.length <= lim || pts.length < 3) return pts.length >= 3 ? pts : src;

    function pointSegDistance(p, a, b) {
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

    function simplifyRdpOpen(input, eps) {
      if (input.length <= 2) return input.slice();
      const keep = new Uint8Array(input.length);
      keep[0] = 1;
      keep[input.length - 1] = 1;
      const stack = [[0, input.length - 1]];
      while (stack.length) {
        const [s, e] = stack.pop();
        let bestIdx = -1;
        let bestDist = eps;
        for (let i = s + 1; i < e; i++) {
          const d = pointSegDistance(input[i], input[s], input[e]);
          if (d > bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
        if (bestIdx > s && bestIdx < e) {
          keep[bestIdx] = 1;
          stack.push([s, bestIdx], [bestIdx, e]);
        }
      }
      const out = [];
      for (let i = 0; i < input.length; i++) if (keep[i]) out.push(input[i]);
      return out;
    }

    let work = pts;
    if (work.length >= 3) {
      const first = work[0];
      const last = work[work.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-9) work = work.slice(0, -1);
    }
    if (work.length <= lim || work.length < 3) return work.length >= 3 ? work : src;
    const bb = polygonBBox(work);
    const diag = bb ? Math.hypot(bb.width, bb.height) : 0;
    let eps = Math.max(0.05, diag * 0.0015);
    let simplified = simplifyRdpOpen(work, eps);
    for (let i = 0; i < 10 && simplified.length > lim; i++) {
      eps *= 1.6;
      simplified = simplifyRdpOpen(work, eps);
    }
    if (simplified.length > lim) {
      const step = Math.max(1, Math.ceil(simplified.length / lim));
      const sampled = [];
      for (let i = 0; i < simplified.length; i += step) sampled.push(simplified[i]);
      simplified = sampled;
    }
    return simplified.length >= 3 ? simplified : work;
  }

  const sourceConstraints = constraints || {};
  const directConstraints = {
    ...(constraints || {}),
    minCoverageRatio: 0,
    minAreaMm2: null,
    minAlongMm: null,
    minAcrossMm: null,
    napDirectionDeg: null,
    napToleranceDeg: null
  };
  const prepared = (Array.isArray(candidates) ? candidates : []).map((c) => {
    const contour = parseScrapContourPoints(c && c.scrapContour);
    const bb = contour.length >= 3 ? polygonBBox(contour) : null;
    return {
      ...c,
      napDirectionDeg: transformScrapNapDegToWorld(c && c.napDirectionDeg),
      areaMm2: contour.length >= 3 ? polygonArea(contour) : (safeNum(c && c.areaMm2) || 0),
      bboxWidthMm: bb ? bb.width : safeNum(c && c.bboxWidthMm),
      bboxHeightMm: bb ? bb.height : safeNum(c && c.bboxHeightMm),
      __scrapContourPoints: contour
    };
  });
  let pool = prepared.filter((c) => isCandidateCompatible(c, filters || {}, directConstraints, axis));
  if (!pool.length) {
    const relaxedConstraints = {
      minAreaMm2: null,
      maxAreaMm2: null,
      minAlongMm: null,
      maxAlongMm: null,
      minAcrossMm: null,
      maxAcrossMm: null,
      napDirectionDeg: null,
      napToleranceDeg: null,
      requireScrapContour: true
    };
    pool = prepared.filter((c) => isCandidateCompatible(c, filters || {}, relaxedConstraints, axis));
  }
  function candidateEffectiveAreaMm2(c) {
    const direct = Math.max(0, Number(c && c.areaMm2 || 0));
    if (direct > 0) return direct;
    const contour = Array.isArray(c && c.__scrapContourPoints) ? c.__scrapContourPoints : [];
    return contour.length >= 3 ? Math.max(0, polygonArea(contour)) : 0;
  }
  const candidateAreaBudgetMm2 = pool.reduce((acc, c) => acc + candidateEffectiveAreaMm2(c), 0);
  const scrapAreaByKey = new Map();
  for (const c of pool) {
    const a = Math.max(0, Number(c && c.areaMm2 || 0));
    if (!(a > 0)) continue;
    const idKey = String(c && c.id || "").trim();
    const tagKey = String(c && c.inventoryTag || "").trim();
    if (idKey) scrapAreaByKey.set(`id:${idKey}`, a);
    if (tagKey) scrapAreaByKey.set(`tag:${tagKey}`, a);
  }
  const candidateTemplates = pool
    .map((c, idx) => {
      const rawContour = Array.isArray(c.__scrapContourPoints) ? c.__scrapContourPoints : [];
      if (rawContour.length < 3) return null;
      const fastContour = simplifyContourForSearch(rawContour, maxPointsPerCandidate);
      const bb = polygonBBox(fastContour);
      if (!bb || bb.width <= 0 || bb.height <= 0) return null;
      const centered = translateToAnchor(fastContour, { x: 0, y: 0 });
      const contourSample = samplePolyline(fastContour, 20);
      return {
        c,
        idx,
        key: `${String(c.id || "").trim()}|${String(c.inventoryTag || "").trim()}|${idx}`,
        centered,
        area: safeNum(c.areaMm2) || polygonArea(rawContour),
        sampleContour: contourSample,
        napDirectionDeg: normalizeDeg(c && c.napDirectionDeg)
      };
    })
    .filter(Boolean);

  return {
    sourceConstraints,
    directConstraints,
    pool,
    candidateAreaBudgetMm2,
    scrapAreaByKey,
    candidateTemplates
  };
}

module.exports = {
  buildCandidatePool
};

