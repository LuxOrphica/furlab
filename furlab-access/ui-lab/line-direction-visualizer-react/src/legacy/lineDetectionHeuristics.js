export function createLineDetectionHeuristics(deps) {
  const {
    getLineSearchMask,
    isInStickerExclusion,
    getEdgeDistance,
    sampleGray,
    canvasRef,
    modelStatsRef
  } = deps;

  function getStrokeContrastScore(p1, p2, darkThr) {
    if (!p1 || !p2) return 0;
    const lineSearch = getLineSearchMask();
    const searchMask = lineSearch?.mask;
    const reliablePolygon = !!lineSearch?.reliablePolygon;
    if (!searchMask) return 0;
    const canvas = canvasRef();
    const w = canvas.width;
    const h = canvas.height;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return 0;
    const vx = dx / len;
    const vy = dy / len;
    const nx = -vy;
    const ny = vx;

    let pass = 0;
    let total = 0;
    for (let k = 2; k <= 10; k++) {
      const t = k / 12;
      const x = p1.x + dx * t;
      const y = p1.y + dy * t;
      const cx = Math.round(x);
      const cy = Math.round(y);
      if (cx < 3 || cy < 3 || cx >= w - 3 || cy >= h - 3) continue;
      if (!searchMask[cy * w + cx]) continue;
      if (isInStickerExclusion(cx, cy, 10)) continue;
      if (reliablePolygon && getEdgeDistance(cx, cy) < 2) continue;
      const center = sampleGray(cx, cy);
      const s1x = Math.round(x + nx * 3);
      const s1y = Math.round(y + ny * 3);
      const s2x = Math.round(x - nx * 3);
      const s2y = Math.round(y - ny * 3);
      if (s1x < 1 || s1y < 1 || s1x >= w - 1 || s1y >= h - 1) continue;
      if (s2x < 1 || s2y < 1 || s2x >= w - 1 || s2y >= h - 1) continue;
      if (!searchMask[s1y * w + s1x] || !searchMask[s2y * w + s2x]) continue;
      const side = (sampleGray(s1x, s1y) + sampleGray(s2x, s2y)) * 0.5;
      total++;
      if (center <= darkThr && (side - center) >= 14) pass++;
    }
    if (total < 4) return 0;
    return pass / total;
  }

  function getAutoMinLineLengthPx() {
    const canvas = canvasRef();
    const modelStats = modelStatsRef();
    const bw = Number(modelStats?.bboxW) || Number(canvas?.width) || 0;
    const bh = Number(modelStats?.bboxH) || Number(canvas?.height) || 0;
    const base = Math.max(1, Math.min(bw, bh));
    return Math.max(58, Math.min(120, Math.round(base * 0.075)));
  }

  function isAutoSegmentPlausible(p1, p2, source) {
    if (!p1 || !p2) return false;
    const lineSearch = getLineSearchMask();
    const reliablePolygon = !!lineSearch?.reliablePolygon;
    const searchMask = lineSearch?.mask;
    const canvas = canvasRef();
    const w = canvas.width;
    const h = canvas.height;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    const minLen = getAutoMinLineLengthPx();
    const minLenForSource =
      source === "dark-line-dark-percentile-pca"
        ? Math.max(42, Math.round(minLen * 0.55))
        : minLen;
    if (len < minLenForSource) return false;

    const strictEdgeCheck =
      source !== "dark-line-pure-black" &&
      source !== "dark-line-direct-marker" &&
      source !== "dark-line-center-marker" &&
      source !== "dark-line-local-dark-marker" &&
      source !== "dark-line-thick-marker" &&
      source !== "dark-line-global-no-mask" &&
      source !== "dark-line-global-fallback" &&
      source !== "dark-line-interior-edge" &&
      source !== "dark-line-dark-percentile-pca" &&
      source !== "dark-line-any-color";

    if (reliablePolygon && strictEdgeCheck) {
      const d1 = getEdgeDistance(p1.x, p1.y);
      const d2 = getEdgeDistance(p2.x, p2.y);
      const dm = getEdgeDistance((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      if (!Number.isFinite(d1) || !Number.isFinite(d2) || !Number.isFinite(dm)) return false;
      if (Math.min(d1, d2) < 2.5) return false;
      if ((d1 + d2 + dm) / 3 < 4.0) return false;
    }

    if (source === "opencv-hough" || source === "dark-line-prototype" || source === "dark-line-marker-fast") {
      let dark = 0;
      let valid = 0;
      let inMask = 0;
      for (let t = 0; t <= 16; t++) {
        const a = t / 16;
        const x = Math.round(p1.x + dx * a);
        const y = Math.round(p1.y + dy * a);
        if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
        const d = getEdgeDistance(x, y);
        if (reliablePolygon && d < 2.0) continue;
        if (searchMask && searchMask[y * w + x]) inMask++;
        valid++;
        if (sampleGray(x, y) < 150) dark++;
      }
      if (valid < 8) return false;
      if (searchMask && inMask / valid < 0.65) return false;
      if (dark / valid < 0.62) return false;
    }
    return true;
  }

  function estimateAutoSegmentConfidence(p1, p2, source) {
    if (!p1 || !p2) return 0;
    const canvas = canvasRef();
    const minLen = getAutoMinLineLengthPx();
    const len = Math.hypot((p2.x - p1.x), (p2.y - p1.y));
    if (!Number.isFinite(len) || len < 1) return 0;

    const lenScore = Math.max(0, Math.min(1, (len - minLen * 0.9) / Math.max(12, minLen * 0.8)));
    const contrast = getStrokeContrastScore(p1, p2, 142);
    const contrastScore = Math.max(0, Math.min(1, contrast));

    const lineSearch = getLineSearchMask();
    const searchMask = lineSearch?.mask;
    const reliablePolygon = !!lineSearch?.reliablePolygon;
    const w = Number(canvas?.width || 0);
    const h = Number(canvas?.height || 0);

    let inMask = 0;
    let valid = 0;
    let edgeMin = Infinity;
    if (w > 2 && h > 2) {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      for (let t = 0; t <= 16; t++) {
        const a = t / 16;
        const x = Math.round(p1.x + dx * a);
        const y = Math.round(p1.y + dy * a);
        if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
        valid++;
        if (searchMask && searchMask[y * w + x]) inMask++;
        const d = getEdgeDistance(x, y);
        if (Number.isFinite(d) && d < edgeMin) edgeMin = d;
      }
    }
    const inMaskScore = valid > 0 ? inMask / valid : 0;
    const edgeScore = reliablePolygon
      ? Math.max(0, Math.min(1, ((Number.isFinite(edgeMin) ? edgeMin : 0) - 2.5) / 7))
      : 0.6;

    let conf = 0.3 * lenScore + 0.38 * contrastScore + 0.2 * inMaskScore + 0.12 * edgeScore;
    if (source === "dark-line-fast-hough") {
      // For nap direction we prioritize geometric stability over dark-contrast purity.
      conf = 0.5 * lenScore + 0.3 * inMaskScore + 0.2 * edgeScore;
      conf = Math.max(conf, 0.45);
    }
    if (source === "dark-line-any-color") {
      conf =
        0.42 * lenScore +
        0.28 * inMaskScore +
        0.18 * edgeScore +
        0.12 * Math.max(contrastScore, 0.2);
    }
    if (/opencv|hough|fallback/i.test(String(source || ""))) conf *= 0.92;
    return Math.max(0, Math.min(1, conf));
  }

  return {
    getStrokeContrastScore,
    getAutoMinLineLengthPx,
    isAutoSegmentPlausible,
    estimateAutoSegmentConfidence
  };
}
