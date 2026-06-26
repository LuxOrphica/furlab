export function createLineDetectionDetectors(deps) {
  const {
    sourceDataRef,
    canvasRef,
    sourceCanvasRef,
    isCvReady,
    cvRef,
    getLineSearchMask,
    isInStickerExclusion,
    getEdgeDistance,
    sampleGray,
    buildDistanceTransform,
    getStrokeSideBrightnessStats,
    morphErode,
    morphDilate,
    bfsMaskComponent,
    segmentFeaturesFromComponent,
    toBinaryMask,
    toBinaryMaskFromMat,
    detectLineFromBinaryMaskHough,
    getAutoMinLineLengthPx,
    getStrokeContrastScore,
    setLineMasks,
    setLineMaskInfo
  } = deps;

  function getMaskCenterAndCoverage(mask, w, h) {
    if (!mask || !w || !h) return null;
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (!mask[row + x]) continue;
        sumX += x;
        sumY += y;
        count++;
      }
    }
    if (!count) return null;
    return {
      cx: sumX / count,
      cy: sumY / count,
      coverage: count / Math.max(1, w * h)
    };
  }

  function eigFromCov(cxx, cyy, cxy) {
    const tr = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc;
    const l2 = tr / 2 - disc;
    const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    return { l1, l2, angle };
  }

  function analyzeDarkComponent(points, w, h, luminance) {
    const n = points.length;
    if (n < 12) return null;
    let sumX = 0;
    let sumY = 0;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    for (let i = 0; i < n; i++) {
      const idx = points[i];
      const x = idx % w;
      const y = (idx - x) / w;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const cx = sumX / n;
    const cy = sumY / n;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      const idx = points[i];
      const x = idx % w;
      const y = (idx - x) / w;
      const dx = x - cx;
      const dy = y - cy;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    const cxx = sxx / n;
    const cyy = syy / n;
    const cxy = sxy / n;
    const { l1, l2, angle } = eigFromCov(cxx, cyy, cxy);
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    let minT = Infinity;
    let maxT = -Infinity;
    for (let i = 0; i < n; i++) {
      const idx = points[i];
      const x = idx % w;
      const y = (idx - x) / w;
      const t = (x - cx) * ux + (y - cy) * uy;
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
    const length = Math.max(0, maxT - minT);
    const bboxW = maxX - minX + 1;
    const bboxH = maxY - minY + 1;
    const fillRatio = n / Math.max(1, bboxW * bboxH);
    const elongation = l1 / Math.max(0.001, l2);
    const strokeWidth = n / Math.max(1, length);

    let sumLum = 0;
    let p10Lum = 255;
    if (luminance) {
      const vals = new Array(n);
      for (let i = 0; i < n; i++) {
        const lum = luminance[points[i]];
        vals[i] = lum;
        sumLum += lum;
      }
      vals.sort((a, b) => a - b);
      p10Lum = vals[Math.max(0, Math.min(vals.length - 1, Math.floor(vals.length * 0.1)))];
    } else {
      p10Lum = 180;
      sumLum = n * 180;
    }
    const meanLum = sumLum / Math.max(1, n);
    const nx = (cx - w / 2) / Math.max(1, w / 2);
    const ny = (cy - h / 2) / Math.max(1, h / 2);
    const centerDist = Math.min(1, Math.hypot(nx, ny));
    const lineLike = Math.max(0, Math.min(1, (elongation - 2.2) / 18));
    const widthLike = Math.max(0, Math.min(1, 1 - Math.abs(strokeWidth - 3.5) / 3.5));
    const lengthLike = Math.max(0, Math.min(1, (length - 10) / 120));
    const centerLike = 1 - centerDist;
    const darkLike = Math.max(0, Math.min(1, (170 - meanLum) / 90)) * 0.6 +
      Math.max(0, Math.min(1, (145 - p10Lum) / 80)) * 0.4;
    const score =
      lineLike * 0.3 +
      widthLike * 0.2 +
      lengthLike * 0.15 +
      centerLike * 0.1 +
      darkLike * 0.25;
    return {
      score,
      start: { x: cx + minT * ux, y: cy + minT * uy },
      end: { x: cx + maxT * ux, y: cy + maxT * uy },
      elongation,
      length,
      bboxW,
      bboxH,
      strokeWidth,
      meanLum,
      p10Lum,
      count: n
    };
  }

  function detectDarkPercentilePcaSegment() {
    const sourceData = sourceDataRef();
    const canvas = canvasRef();
    if (!sourceData || !canvas?.width || !canvas?.height) return null;
    const lineSearch = getLineSearchMask();
    const searchMask = lineSearch?.mask;
    if (!searchMask) return null;
    const w = canvas.width;
    const h = canvas.height;
    const size = w * h;
    const luminance = new Uint8Array(size);
    const hist = new Uint32Array(256);
    const eligibleIdx = [];
    let eligible = 0;

    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        if (!searchMask[i]) continue;
        if (isInStickerExclusion(x, y, 18)) continue;
        const p = i * 4;
        const r = sourceData[p];
        const g = sourceData[p + 1];
        const b = sourceData[p + 2];
        const lum = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
        luminance[i] = lum;
        hist[lum]++;
        eligibleIdx.push(i);
        eligible++;
      }
    }
    if (eligible < 60) return null;
    const darkPct = 0.02;
    const target = Math.max(1, Math.floor(eligible * darkPct));
    let cum = 0;
    let threshold = 255;
    for (let v = 0; v < 256; v++) {
      cum += hist[v];
      if (cum >= target) {
        threshold = v;
        break;
      }
    }

    const dark = new Uint8Array(size);
    const visited = new Uint8Array(size);
    let darkCount = 0;
    for (let k = 0; k < eligibleIdx.length; k++) {
      const i = eligibleIdx[k];
      if (luminance[i] <= threshold) {
        dark[i] = 1;
        darkCount++;
      }
    }
    if (darkCount < 18) return null;

    const neighbors = [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1];
    let best = null;
    for (let k = 0; k < eligibleIdx.length; k++) {
      const i = eligibleIdx[k];
      if (!dark[i] || visited[i]) continue;
      const queue = [i];
      visited[i] = 1;
      const pts = [];
      while (queue.length) {
        const cur = queue.pop();
        pts.push(cur);
        const cx = cur % w;
        const cy = (cur - cx) / w;
        for (let k = 0; k < neighbors.length; k++) {
          const ni = cur + neighbors[k];
          if (ni < 0 || ni >= size) continue;
          const nx = ni % w;
          const ny = (ni - nx) / w;
          if (Math.abs(nx - cx) > 1 || Math.abs(ny - cy) > 1) continue;
          if (!dark[ni] || visited[ni]) continue;
          visited[ni] = 1;
          queue.push(ni);
        }
      }
      const cand = analyzeDarkComponent(pts, w, h, luminance);
      if (!cand) continue;
      if (cand.length < Math.max(18, Math.min(w, h) * 0.04)) continue;
      if (cand.length > Math.max(120, Math.min(w, h) * 0.42)) continue;
      if (cand.elongation < 2.2) continue;
      if (Math.max(cand.bboxW, cand.bboxH) > Math.max(140, Math.min(w, h) * 0.5)) continue;
      if (cand.count > Math.max(12000, eligible * 0.22)) continue;
      if (cand.meanLum > 168) continue;
      if (cand.p10Lum > 152) continue;
      const mx = (cand.start.x + cand.end.x) * 0.5;
      const my = (cand.start.y + cand.end.y) * 0.5;
      if (isInStickerExclusion(mx, my, 22)) continue;
      if (!best || cand.score > best.score) best = cand;
    }

    if (!best || best.score < 0.08) return null;
    setLineMasks(dark, dark, dark);
    setLineMaskInfo({
      mode: "dark-percentile-pca",
      threshold,
      darkPercent: darkPct,
      darkCount
    });
    return { p1: best.start, p2: best.end };
  }

  function detectRoiAxisSegment() {
    const canvas = canvasRef();
    if (!canvas?.width || !canvas?.height) return null;
    const lineSearch = getLineSearchMask();
    const searchMask = lineSearch?.mask;
    if (!searchMask) return null;
    const w = canvas.width;
    const h = canvas.height;
    const points = [];
    const step = 4;
    for (let y = 0; y < h; y += step) {
      const row = y * w;
      for (let x = 0; x < w; x += step) {
        if (!searchMask[row + x]) continue;
        if (isInStickerExclusion(x, y, 16)) continue;
        points.push([x, y]);
      }
    }
    if (points.length < 24) return null;
    let mx = 0;
    let my = 0;
    for (let i = 0; i < points.length; i++) {
      mx += points[i][0];
      my += points[i][1];
    }
    mx /= points.length;
    my /= points.length;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < points.length; i++) {
      const dx = points[i][0] - mx;
      const dy = points[i][1] - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    const tr = sxx + syy;
    const det = sxx * syy - sxy * sxy;
    const disc = Math.max(0, tr * tr - 4 * det);
    const lambda = 0.5 * (tr + Math.sqrt(disc));
    let vx = sxy;
    let vy = lambda - sxx;
    const vlen = Math.hypot(vx, vy);
    if (!Number.isFinite(vlen) || vlen < 1e-6) return null;
    vx /= vlen;
    vy /= vlen;
    let tMin = Infinity;
    let tMax = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const t = (points[i][0] - mx) * vx + (points[i][1] - my) * vy;
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
    }
    if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || (tMax - tMin) < 18) return null;
    const p1 = { x: mx + vx * tMin, y: my + vy * tMin };
    const p2 = { x: mx + vx * tMax, y: my + vy * tMax };
    const axisLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const axisMax = Math.max(120, Math.min(w, h) * 0.45);
    // Prevent "whole piece diagonal" fallback; ROI-axis is only a short emergency direction.
    if (axisLen > axisMax) return null;
    setLineMaskInfo({ mode: "roi-axis" });
    return { p1, p2 };
  }

  function detectPureBlackStrokeSegment() {
    const sourceData = sourceDataRef();
    const canvas = canvasRef();
    if (!sourceData || !canvas?.width || !canvas?.height) return null;
    const lineSearch = getLineSearchMask();
    const searchMask = lineSearch?.mask;
    const reliablePolygon = !!lineSearch?.reliablePolygon;
    if (!searchMask) return null;

    const w = canvas.width;
    const h = canvas.height;
    const size = w * h;
    const raw = new Uint8Array(size);
    const visited = new Uint8Array(size);
    const edgeMin = 0;
    const minLen = Math.max(getAutoMinLineLengthPx(), Math.round(Math.min(w, h) * 0.08));
    const maxLen = Math.max(300, Math.round(Math.min(w, h) * 0.42));
    const minX = Math.floor(w * 0.14);
    const maxX = Math.ceil(w * 0.86);
    const minY = Math.floor(h * 0.16);
    const maxY = Math.ceil(h * 0.90);

    for (let y = minY; y < maxY; y++) {
      const row = y * w;
      for (let x = minX; x < maxX; x++) {
        const i = row + x;
        if (!searchMask[i]) continue;
        if (isInStickerExclusion(x, y, 36)) continue;
        if (edgeMin > 0 && getEdgeDistance(x, y) < edgeMin) continue;
        const p = i * 4;
        const r = sourceData[p];
        const g = sourceData[p + 1];
        const b = sourceData[p + 2];
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        // Строгий кандидат "маркерной" черноты: не весь темный шум текстуры, а именно черный штрих.
        if (gray <= 78 && spread <= 70) raw[i] = 1;
      }
    }

    // Opening сначала убирает мелкий темный шум, затем возвращает форму штриха.
    const clean = morphDilate(morphErode(raw, w, h, 1), w, h, 1);
    let best = null;
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const i = y * w + x;
        if (!clean[i] || visited[i]) continue;
        const comp = bfsMaskComponent(clean, visited, x, y, w, h);
        if (!comp || comp.length < 18 || comp.length > 12000) continue;
        const feat = segmentFeaturesFromComponent(comp, w);
        if (!feat) continue;
        if (feat.lengthPx < minLen || feat.lengthPx > maxLen) continue;
        if (feat.linearity < 2.2 || feat.ratio < 1.8) continue;

        const mx = (feat.p1.x + feat.p2.x) * 0.5;
        const my = (feat.p1.y + feat.p2.y) * 0.5;
        if (isInStickerExclusion(mx, my, 36)) continue;

        let darkCount = 0;
        for (let k = 0; k < comp.length; k++) {
          const idx = comp[k];
          const px = idx % w;
          const py = (idx - px) / w;
          if (sampleGray(px, py) <= 104) darkCount++;
        }
        const darkRatio = darkCount / Math.max(1, comp.length);
        if (darkRatio < 0.65) continue;

        const thickness = comp.length / Math.max(1, feat.lengthPx);
        if (thickness < 1.4 || thickness > 12.5) continue;

        const contrast = getStrokeContrastScore(feat.p1, feat.p2, 122);
        if (contrast < 0.06) continue;

        const score =
          feat.lengthPx * 8.0 +
          feat.linearity * 9.5 +
          feat.ratio * 6.5 +
          darkRatio * 135 +
          contrast * 92 -
          thickness * 1.6;
        if (!best || score > best.score) best = { score, feat, comp };
      }
    }

    if (!best) return null;
    setLineMasks(raw, clean, toBinaryMask(best.comp, size));
    setLineMaskInfo({ threshold: 78, mean: 0, std: 0, mode: "pure-black" });
    return { p1: best.feat.p1, p2: best.feat.p2 };
  }

  function detectThickBlackStrokeSegment() {
    const sourceData = sourceDataRef();
    const canvas = canvasRef();
    if (!sourceData || !canvas?.width || !canvas?.height) return null;
    const lineSearch = getLineSearchMask();
    const searchMask = lineSearch?.mask;
    if (!searchMask) return null;

    const w = canvas.width;
    const h = canvas.height;
    const size = w * h;
    const raw = new Uint8Array(size);
    const visited = new Uint8Array(size);
    const edgeMin = 2;
    let rawCount = 0;

    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const i = row + x;
        if (!searchMask[i]) continue;
        if (isInStickerExclusion(x, y, 26)) continue;
        if (getEdgeDistance(x, y) < edgeMin) continue;
        const p = i * 4;
        const r = sourceData[p];
        const g = sourceData[p + 1];
        const b = sourceData[p + 2];
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        if (gray <= 120 && spread <= 85) {
          raw[i] = 1;
          rawCount++;
        }
      }
    }
    if (rawCount < 20) return null;

    const clean = morphDilate(morphErode(raw, w, h, 1), w, h, 1);
    const minLen = Math.max(24, Math.round(getAutoMinLineLengthPx() * 0.5));
    const maxLen = Math.max(220, Math.round(Math.min(w, h) * 0.5));
    let best = null;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!clean[i] || visited[i]) continue;
        const comp = bfsMaskComponent(clean, visited, x, y, w, h);
        if (!comp || comp.length < 24 || comp.length > 50000) continue;
        const feat = segmentFeaturesFromComponent(comp, w);
        if (!feat) continue;
        if (feat.lengthPx < minLen || feat.lengthPx > maxLen) continue;
        if (feat.linearity < 1.5 && feat.ratio < 1.5) continue;

        const mx = (feat.p1.x + feat.p2.x) * 0.5;
        const my = (feat.p1.y + feat.p2.y) * 0.5;
        if (isInStickerExclusion(mx, my, 26)) continue;

        let darkCount = 0;
        for (let k = 0; k < comp.length; k++) {
          const idx = comp[k];
          const px = idx % w;
          const py = (idx - px) / w;
          if (sampleGray(px, py) <= 138) darkCount++;
        }
        const darkRatio = darkCount / Math.max(1, comp.length);
        if (darkRatio < 0.58) continue;

        const thickness = comp.length / Math.max(1, feat.lengthPx);
        if (thickness < 1.4 || thickness > 24) continue;

        const contrast = getStrokeContrastScore(feat.p1, feat.p2, 158);
        if (contrast < 0.02) continue;

        const score =
          feat.lengthPx * 4.2 +
          Math.min(20, feat.linearity) * 2.1 +
          darkRatio * 95 +
          contrast * 45 -
          Math.abs(thickness - 6.5) * 1.2;
        if (!best || score > best.score) best = { score, feat, comp };
      }
    }

    if (!best) return null;
    setLineMasks(raw, clean, toBinaryMask(best.comp, size));
    setLineMaskInfo({ threshold: 120, mean: 0, std: 0, mode: "thick-marker", rawCount });
    return { p1: best.feat.p1, p2: best.feat.p2 };
  }

  function detectMezdraMinusQrDominantStroke() {
    const sourceData = sourceDataRef();
    const canvas = canvasRef();
    if (!sourceData || !canvas?.width || !canvas?.height) return null;
    const lineSearch = getLineSearchMask();
    const searchMask = lineSearch?.mask;
    if (!searchMask) return null;

    const w = canvas.width;
    const h = canvas.height;
    const size = w * h;
    const raw = new Uint8Array(size);
    const visited = new Uint8Array(size);
    const graySamples = [];

    for (let y = 1; y < h - 1; y += 2) {
      const row = y * w;
      for (let x = 1; x < w - 1; x += 2) {
        const i = row + x;
        if (!searchMask[i]) continue;
        if (isInStickerExclusion(x, y, 24)) continue;
        if (getEdgeDistance(x, y) < 1) continue;
        graySamples.push(sampleGray(x, y));
      }
    }
    if (graySamples.length < 48) return null;
    graySamples.sort((a, b) => a - b);
    const q10 = graySamples[Math.max(0, Math.min(graySamples.length - 1, Math.round(graySamples.length * 0.10)))];
    const thr = Math.max(78, Math.min(146, q10 + 18));

    let rawCount = 0;
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const i = row + x;
        if (!searchMask[i]) continue;
        if (isInStickerExclusion(x, y, 24)) continue;
        if (getEdgeDistance(x, y) < 1) continue;
        const p = i * 4;
        const r = sourceData[p];
        const g = sourceData[p + 1];
        const b = sourceData[p + 2];
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        const gray = sampleGray(x, y);
        const isDarkInk = gray <= thr;
        const isSaturatedInk = spread >= 120 && gray <= 200;
        if (isDarkInk || isSaturatedInk) {
          raw[i] = 1;
          rawCount++;
        }
      }
    }
    if (rawCount < 18) return null;

    const clean = morphDilate(morphErode(raw, w, h, 1), w, h, 1);
    const minLen = Math.max(22, Math.round(getAutoMinLineLengthPx() * 0.42));
    const maxLen = Math.max(420, Math.round(Math.min(w, h) * 0.6));
    let best = null;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!clean[i] || visited[i]) continue;
        const comp = bfsMaskComponent(clean, visited, x, y, w, h);
        if (!comp || comp.length < 16 || comp.length > 90000) continue;
        const feat = segmentFeaturesFromComponent(comp, w);
        if (!feat) continue;
        if (feat.lengthPx < minLen || feat.lengthPx > maxLen) continue;
        if (Math.max(feat.bboxW, feat.bboxH) > 760) continue;

        const mx = (feat.p1.x + feat.p2.x) * 0.5;
        const my = (feat.p1.y + feat.p2.y) * 0.5;
        if (isInStickerExclusion(mx, my, 24)) continue;

        let inkCount = 0;
        for (let k = 0; k < comp.length; k++) {
          const idx = comp[k];
          const px = idx % w;
          const py = (idx - px) / w;
          const p = idx * 4;
          const r = sourceData[p];
          const g = sourceData[p + 1];
          const b = sourceData[p + 2];
          const spread = Math.max(r, g, b) - Math.min(r, g, b);
          const gray = sampleGray(px, py);
          if (gray <= (thr + 18) || (spread >= 120 && gray <= 205)) inkCount++;
        }
        const inkRatio = inkCount / Math.max(1, comp.length);
        if (inkRatio < 0.42) continue;
        const thickness = comp.length / Math.max(1, feat.lengthPx);
        if (thickness < 1.1 || thickness > 26) continue;
        const contrast = getStrokeContrastScore(feat.p1, feat.p2, thr + 10);
        if (contrast < 0.02) continue;

        const score =
          feat.lengthPx * 4.6 +
          Math.min(18, feat.linearity || 0) * 2.2 +
          Math.min(18, feat.ratio || 0) * 1.8 +
          inkRatio * 90 +
          contrast * 38 -
          Math.abs(thickness - 6.0) * 0.9;
        if (!best || score > best.score) best = { score, feat, comp };
      }
    }

    if (!best) return null;
    setLineMasks(raw, clean, toBinaryMask(best.comp, size));
    setLineMaskInfo({ threshold: thr, mean: q10, std: 0, mode: "mezdra-minus-qr", rawCount });
    return { p1: best.feat.p1, p2: best.feat.p2 };
  }

  function detectMarkerStrokeBlackhatCV() {
    const sourceData = sourceDataRef();
    const canvas = canvasRef();
    const cv = cvRef?.();
    if (!sourceData || !canvas?.width || !canvas?.height || !isCvReady?.() || !cv) return null;
    const lineSearch = getLineSearchMask();
    const searchMask = lineSearch?.mask;
    const reliablePolygon = !!lineSearch?.reliablePolygon;
    if (!searchMask) return null;
    const w = canvas.width;
    const h = canvas.height;
    const size = w * h;
    const edgeMin = reliablePolygon ? Math.max(16, Math.round(Math.min(w, h) * 0.02)) : 8;
    let gray = null;
    let bh = null;
    let bin = null;
    let kernel = null;
    let openKernel = null;
    try {
      gray = new cv.Mat(h, w, cv.CV_8U);
      const gd = gray.data;
      for (let i = 0; i < size; i++) {
        const p = i * 4;
        const r = sourceData[p];
        const g = sourceData[p + 1];
        const b = sourceData[p + 2];
        gd[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }
      bh = new cv.Mat();
      kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(15, 15));
      cv.morphologyEx(gray, bh, cv.MORPH_BLACKHAT, kernel);
      bin = new cv.Mat();
      cv.threshold(bh, bin, 22, 255, cv.THRESH_BINARY);
      openKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      cv.morphologyEx(bin, bin, cv.MORPH_OPEN, openKernel);

      const raw = new Uint8Array(size);
      const bd = bin.data;
      for (let y = 1; y < h - 1; y++) {
        const row = y * w;
        for (let x = 1; x < w - 1; x++) {
          const i = row + x;
          if (!bd[i]) continue;
          if (!searchMask[i]) continue;
          if (isInStickerExclusion(x, y, 32)) continue;
          if (getEdgeDistance(x, y) < edgeMin) continue;
          raw[i] = 1;
        }
      }
      const clean = morphErode(morphDilate(raw, w, h, 1), w, h, 1);
      const visited = new Uint8Array(size);
      const minLen = Math.max(60, Math.round(Math.min(w, h) * 0.08));
      const maxLen = Math.max(280, Math.round(Math.min(w, h) * 0.38));
      let best = null;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!clean[i] || visited[i]) continue;
          const comp = bfsMaskComponent(clean, visited, x, y, w, h);
          if (!comp || comp.length < 28 || comp.length > 14000) continue;
          const feat = segmentFeaturesFromComponent(comp, w);
          if (!feat) continue;
          if (feat.lengthPx < minLen || feat.lengthPx > maxLen) continue;
          if (feat.linearity < 2.4 || feat.ratio < 2.0) continue;
          const mx = (feat.p1.x + feat.p2.x) * 0.5;
          const my = (feat.p1.y + feat.p2.y) * 0.5;
          if (isInStickerExclusion(mx, my, 32)) continue;
          const thickness = comp.length / Math.max(1, feat.lengthPx);
          if (thickness < 1.8 || thickness > 12.5) continue;
          const contrast = getStrokeContrastScore(feat.p1, feat.p2, 145);
          if (contrast < 0.14) continue;
          const score = feat.lengthPx * 6.5 + feat.linearity * 8.0 + feat.ratio * 5.0 + contrast * 70 - thickness * 2.0;
          if (!best || score > best.score) best = { score, feat, comp };
        }
      }
      if (!best) return null;
      setLineMasks(raw, clean, toBinaryMask(best.comp, size));
      setLineMaskInfo({ threshold: 22, mean: 0, std: 0, mode: "blackhat" });
      return { p1: best.feat.p1, p2: best.feat.p2 };
    } catch (_) {
      return null;
    } finally {
      if (gray) gray.delete();
      if (bh) bh.delete();
      if (bin) bin.delete();
      if (kernel) kernel.delete();
      if (openKernel) openKernel.delete();
    }
  }

  function detectMarkerStrokeCenterBias() {
    const sourceData = sourceDataRef();
    const canvas = canvasRef();
    if (!sourceData || !canvas?.width || !canvas?.height) return null;
    const lineSearch = getLineSearchMask();
    const searchMask = lineSearch?.mask;
    const reliablePolygon = !!lineSearch?.reliablePolygon;
    if (!searchMask) return null;
    const w = canvas.width;
    const h = canvas.height;
    const size = w * h;
    const raw = new Uint8Array(size);
    const visited = new Uint8Array(size);
    const cx = w * 0.5;
    const cy = h * 0.54;
    const minX = Math.floor(w * 0.14);
    const maxX = Math.ceil(w * 0.86);
    const minY = Math.floor(h * 0.16);
    const maxY = Math.ceil(h * 0.9);
    const edgeMin = reliablePolygon ? Math.max(20, Math.round(Math.min(w, h) * 0.026)) : 8;

    for (let y = minY; y < maxY; y++) {
      const row = y * w;
      for (let x = minX; x < maxX; x++) {
        const i = row + x;
        if (!searchMask[i]) continue;
        if (isInStickerExclusion(x, y, 36)) continue;
        if (getEdgeDistance(x, y) < edgeMin) continue;
        const gray = sampleGray(x, y);
        const sideAvg = (
          sampleGray(x + 2, y) +
          sampleGray(x - 2, y) +
          sampleGray(x, y + 2) +
          sampleGray(x, y - 2)
        ) * 0.25;
        if (gray <= 132 && (sideAvg - gray) >= 10) raw[i] = 1;
      }
    }

    const clean = morphErode(morphDilate(raw, w, h, 1), w, h, 1);
    const minLen = Math.max(70, Math.round(Math.min(w, h) * 0.09));
    const maxLen = Math.max(280, Math.round(Math.min(w, h) * 0.38));
    let best = null;
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const i = y * w + x;
        if (!clean[i] || visited[i]) continue;
        const comp = bfsMaskComponent(clean, visited, x, y, w, h);
        if (!comp || comp.length < 32 || comp.length > 12000) continue;
        const feat = segmentFeaturesFromComponent(comp, w);
        if (!feat) continue;
        if (feat.lengthPx < minLen || feat.lengthPx > maxLen) continue;
        if (feat.linearity < 2.6 || feat.ratio < 2.2) continue;
        if (Math.max(feat.bboxW, feat.bboxH) > 420) continue;
        const mx = (feat.p1.x + feat.p2.x) * 0.5;
        const my = (feat.p1.y + feat.p2.y) * 0.5;
        if (isInStickerExclusion(mx, my, 36)) continue;

        let dark = 0;
        for (let k = 0; k < comp.length; k++) {
          const idx = comp[k];
          const px = idx % w;
          const py = (idx - px) / w;
          if (sampleGray(px, py) <= 112) dark++;
        }
        const darkRatio = dark / Math.max(1, comp.length);
        if (darkRatio < 0.72) continue;
        const thickness = comp.length / Math.max(1, feat.lengthPx);
        if (thickness < 2.7 || thickness > 11.2) continue;
        const contrast = getStrokeContrastScore(feat.p1, feat.p2, 138);
        if (contrast < 0.14) continue;
        const centerDist = Math.hypot(mx - cx, my - cy);
        const score =
          feat.lengthPx * 7.2 +
          feat.linearity * 8.5 +
          feat.ratio * 5.6 +
          darkRatio * 110 +
          contrast * 72 -
          thickness * 2.4 -
          centerDist * 0.08;
        if (!best || score > best.score) best = { score, feat, comp };
      }
    }
    if (!best) return null;
    setLineMasks(raw, clean, toBinaryMask(best.comp, size));
    setLineMaskInfo({ threshold: 132, mean: 0, std: 0, mode: "center-marker" });
    return { p1: best.feat.p1, p2: best.feat.p2 };
  }

  function detectConstrainedMarkerStroke() {
    const sourceData = sourceDataRef();
    const canvas = canvasRef();
    const cv = cvRef?.();
    if (!sourceData || !canvas?.width || !canvas?.height || !isCvReady?.() || !cv) return null;
    const w = canvas.width;
    const h = canvas.height;
    const size = w * h;
    const lineSearch = getLineSearchMask();
    const searchMask = lineSearch?.mask;
    if (!searchMask) return null;
    const reliablePolygon = !!lineSearch?.reliablePolygon;

    const innerEdgeMin = reliablePolygon ? Math.max(6, Math.round(Math.min(w, h) * 0.012)) : 3;
    const innerMask = new Uint8Array(size);
    let innerCount = 0;
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const i = row + x;
        if (!searchMask[i]) continue;
        if (isInStickerExclusion(x, y, 28)) continue;
        if (getEdgeDistance(x, y) < innerEdgeMin) continue;
        innerMask[i] = 1;
        innerCount++;
      }
    }
    if (innerCount < Math.max(600, Math.round(size * 0.01))) return null;

    let gray = null;
    let blur = null;
    try {
      gray = new cv.Mat(h, w, cv.CV_8U);
      const gd = gray.data;
      for (let i = 0; i < size; i++) {
        const p = i * 4;
        const r = sourceData[p];
        const g = sourceData[p + 1];
        const b = sourceData[p + 2];
        gd[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }
      blur = new cv.Mat();
      cv.GaussianBlur(gray, blur, new cv.Size(31, 31), 0, 0, cv.BORDER_DEFAULT);
      const bd = blur.data;

      const raw = new Uint8Array(size);
      for (let y = 1; y < h - 1; y++) {
        const row = y * w;
        for (let x = 1; x < w - 1; x++) {
          const i = row + x;
          if (!innerMask[i]) continue;
          const p = i * 4;
          const r = sourceData[p];
          const g = sourceData[p + 1];
          const b = sourceData[p + 2];
          const spread = Math.max(r, g, b) - Math.min(r, g, b);
          const gv = gd[i];
          const localDark = bd[i] - gv;
          if (gv <= 140 && localDark >= 16 && spread <= 84) raw[i] = 1;
        }
      }

      const clean = morphErode(morphDilate(raw, w, h, 1), w, h, 1);
      const visited = new Uint8Array(size);
      let best = null;
      const minLen = Math.max(64, Math.round(Math.min(w, h) * 0.08));
      const maxLen = Math.max(160, Math.round(Math.min(w, h) * 0.34));
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!clean[i] || visited[i]) continue;
          const comp = bfsMaskComponent(clean, visited, x, y, w, h);
          if (!comp || comp.length < 26 || comp.length > 9000) continue;
          const feat = segmentFeaturesFromComponent(comp, w);
          if (!feat) continue;
          if (feat.lengthPx < minLen || feat.lengthPx > maxLen) continue;
          if (feat.linearity < 3.8 || feat.ratio < 2.8) continue;
          if (Math.max(feat.bboxW, feat.bboxH) > 360) continue;

          const mx = (feat.p1.x + feat.p2.x) * 0.5;
          const my = (feat.p1.y + feat.p2.y) * 0.5;
          if (isInStickerExclusion(mx, my, 18)) continue;

          let darkCount = 0;
          let localDarkSum = 0;
          let edgeMin = Infinity;
          for (let k = 0; k < comp.length; k++) {
            const idx = comp[k];
            const px = idx % w;
            const py = (idx - px) / w;
            const gvv = gd[idx];
            if (gvv <= 150) darkCount++;
            localDarkSum += (bd[idx] - gvv);
            const ed = getEdgeDistance(px, py);
            if (Number.isFinite(ed) && ed < edgeMin) edgeMin = ed;
          }
          const darkRatio = darkCount / Math.max(1, comp.length);
          if (darkRatio < 0.82) continue;
          if (edgeMin < innerEdgeMin) continue;
          const localDarkMean = localDarkSum / Math.max(1, comp.length);
          if (localDarkMean < 18) continue;

          const thickness = comp.length / Math.max(1, feat.lengthPx);
          if (thickness < 2.6 || thickness > 9.8) continue;

          const contrast = getStrokeContrastScore(feat.p1, feat.p2, 146);
          if (contrast < 0.22) continue;

          const score =
            feat.lengthPx * 6.0 +
            feat.linearity * 7.8 +
            feat.ratio * 5.0 +
            darkRatio * 95 +
            localDarkMean * 4.2 +
            contrast * 72 -
            thickness * 2.1;
          if (!best || score > best.score) best = { score, feat, comp };
        }
      }
      if (!best) return null;
      setLineMasks(raw, clean, toBinaryMask(best.comp, size));
      setLineMaskInfo({ threshold: 140, mean: 0, std: 0, mode: "constrained-marker" });
      return { p1: best.feat.p1, p2: best.feat.p2 };
    } catch (_) {
      return null;
    } finally {
      if (gray) gray.delete();
      if (blur) blur.delete();
    }
  }

  function detectLocalDarkMarkerSegment() {
    const sourceData = sourceDataRef();
    const canvas = canvasRef();
    if (!sourceData || !canvas?.width || !canvas?.height) return null;
    const lineSearch = getLineSearchMask();
    const searchMask = lineSearch?.mask;
    if (!searchMask) return null;

    const w = canvas.width;
    const h = canvas.height;
    const size = w * h;
    const minDim = Math.min(w, h);
    const edgeMargin = Math.max(12, Math.round(minDim * 0.02));
    const qrMargin = 34;
    const minX = Math.floor(w * 0.14);
    const maxX = Math.ceil(w * 0.86);
    const minY = Math.floor(h * 0.16);
    const maxY = Math.ceil(h * 0.9);

    const innerMask = new Uint8Array(size);
    const gray = new Uint8Array(size);
    let innerCount = 0;
    let fallbackInnerCount = 0;
    for (let y = minY; y < maxY; y++) {
      const row = y * w;
      for (let x = minX; x < maxX; x++) {
        const i = row + x;
        const p = i * 4;
        const g = Math.round(0.299 * sourceData[p] + 0.587 * sourceData[p + 1] + 0.114 * sourceData[p + 2]);
        gray[i] = g;
        if (!searchMask[i]) continue;
        if (isInStickerExclusion(x, y, qrMargin)) continue;
        const edgeD = getEdgeDistance(x, y);
        if (Number.isFinite(edgeD) && edgeD < edgeMargin) continue;
        innerMask[i] = 1;
        innerCount++;
      }
    }
    const minInner = Math.max(1400, Math.round(size * 0.002));
    if (innerCount < minInner) {
      // Fallback ROI: center-biased body region without polygon dependency.
      for (let y = minY; y < maxY; y++) {
        const row = y * w;
        for (let x = minX; x < maxX; x++) {
          const i = row + x;
          if (innerMask[i]) continue;
          if (isInStickerExclusion(x, y, qrMargin)) continue;
          const edgeToFrame = Math.min(x, y, w - 1 - x, h - 1 - y);
          if (edgeToFrame < edgeMargin) continue;
          innerMask[i] = 1;
          fallbackInnerCount++;
        }
      }
      innerCount += fallbackInnerCount;
    }
    if (innerCount < minInner) return null;

    // Stage A: hard-black marker pass (very strict color gate, fast and robust for marker ink).
    const hardRaw = new Uint8Array(size);
    let hardCount = 0;
    for (let y = minY; y < maxY; y++) {
      const row = y * w;
      for (let x = minX; x < maxX; x++) {
        const i = row + x;
        if (!innerMask[i]) continue;
        const p = i * 4;
        const r = sourceData[p];
        const g = sourceData[p + 1];
        const b = sourceData[p + 2];
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        if (gray[i] <= 76 && spread <= 56) {
          hardRaw[i] = 1;
          hardCount++;
        }
      }
    }
    if (hardCount >= 24) {
      const hardClean = morphDilate(morphErode(hardRaw, w, h, 1), w, h, 1);
      const hardVisited = new Uint8Array(size);
      const hardMinLen = Math.max(34, Math.round(minDim * 0.05));
      const hardMaxLen = Math.max(380, Math.round(minDim * 0.46));
      let hardBest = null;
      for (let y = minY; y < maxY; y++) {
        for (let x = minX; x < maxX; x++) {
          const i = y * w + x;
          if (!hardClean[i] || hardVisited[i]) continue;
          const comp = bfsMaskComponent(hardClean, hardVisited, x, y, w, h);
          if (!comp || comp.length < 14 || comp.length > 12000) continue;
          const feat = segmentFeaturesFromComponent(comp, w);
          if (!feat) continue;
          if (feat.lengthPx < hardMinLen || feat.lengthPx > hardMaxLen) continue;
          if (feat.linearity < 1.8 || feat.ratio < 1.5) continue;

          const mx = (feat.p1.x + feat.p2.x) * 0.5;
          const my = (feat.p1.y + feat.p2.y) * 0.5;
          if (isInStickerExclusion(mx, my, qrMargin)) continue;
          const edgeDistRaw = getEdgeDistance(mx, my);
          const edgeDist = Number.isFinite(edgeDistRaw) ? edgeDistRaw : (edgeMargin + 1);
          if (edgeDist < edgeMargin) continue;

          const straightness = Math.hypot(feat.p2.x - feat.p1.x, feat.p2.y - feat.p1.y) / Math.max(1, feat.lengthPx);
          if (straightness < 0.54) continue;
          const thickness = comp.length / Math.max(1, feat.lengthPx);
          if (thickness < 1.1 || thickness > 15.0) continue;

          // Anti-sticker: QR on white label has very bright local background.
          let sideSum = 0;
          let sideCnt = 0;
          const step = Math.max(1, Math.floor(comp.length / 80));
          for (let k = 0; k < comp.length; k += step) {
            const idx = comp[k];
            const px = idx % w;
            const py = (idx - px) / w;
            const probes = [
              [px + 4, py], [px - 4, py], [px, py + 4], [px, py - 4]
            ];
            for (let t = 0; t < probes.length; t++) {
              const sx = probes[t][0];
              const sy = probes[t][1];
              if (sx < 1 || sy < 1 || sx >= w - 1 || sy >= h - 1) continue;
              if (!innerMask[sy * w + sx]) continue;
              sideSum += sampleGray(sx, sy);
              sideCnt++;
            }
          }
          const sideMean = sideCnt > 0 ? (sideSum / sideCnt) : 0;
          if (sideCnt > 12 && sideMean > 222) continue;

          const contrast = getStrokeContrastScore(feat.p1, feat.p2, 128);
          if (contrast < 0.04) continue;

          const score =
            feat.lengthPx * 7.2 +
            feat.linearity * 6.5 +
            feat.ratio * 4.0 +
            straightness * 50 +
            contrast * 65 -
            Math.abs(thickness - 3.6) * 4.5;
          if (!hardBest || score > hardBest.score) hardBest = { score, feat, comp };
        }
      }
      if (hardBest) {
        setLineMasks(hardRaw, hardClean, toBinaryMask(hardBest.comp, size));
        setLineMaskInfo({
          threshold: 76,
          mean: 0,
          std: 0,
          mode: "local-hard-black",
          edgeMargin,
          candidates: 1,
          innerCount,
          rawCount: hardCount
        });
        return { p1: hardBest.feat.p1, p2: hardBest.feat.p2 };
      }
    }

    // Build integral image to estimate local background around each pixel.
    const iw = w + 1;
    const ih = h + 1;
    const integral = new Float64Array(iw * ih);
    for (let y = 1; y <= h; y++) {
      let rowSum = 0;
      const srcRow = (y - 1) * w;
      const dstRow = y * iw;
      const prevRow = (y - 1) * iw;
      for (let x = 1; x <= w; x++) {
        rowSum += gray[srcRow + (x - 1)];
        integral[dstRow + x] = integral[prevRow + x] + rowSum;
      }
    }
    const rectMean = (x0, y0, x1, y1) => {
      const xa = Math.max(0, Math.min(w - 1, x0));
      const ya = Math.max(0, Math.min(h - 1, y0));
      const xb = Math.max(0, Math.min(w - 1, x1));
      const yb = Math.max(0, Math.min(h - 1, y1));
      if (xb < xa || yb < ya) return 0;
      const A = ya * iw + xa;
      const B = ya * iw + (xb + 1);
      const C = (yb + 1) * iw + xa;
      const D = (yb + 1) * iw + (xb + 1);
      const sum = integral[D] - integral[B] - integral[C] + integral[A];
      const area = (xb - xa + 1) * (yb - ya + 1);
      return area > 0 ? sum / area : 0;
    };

    const dark = new Uint8Array(size);
    const hist = new Uint32Array(256);
    const bgRadius = Math.max(14, Math.round(minDim * 0.018));
    for (let y = minY; y < maxY; y++) {
      const row = y * w;
      for (let x = minX; x < maxX; x++) {
        const i = row + x;
        if (!innerMask[i]) continue;
        const bg = rectMean(x - bgRadius, y - bgRadius, x + bgRadius, y + bgRadius);
        const dv = Math.max(0, Math.min(255, Math.round(bg - gray[i])));
        dark[i] = dv;
        hist[dv]++;
      }
    }

    const percentileFromHist = (histo, p) => {
      const target = Math.max(1, Math.round(innerCount * p));
      let acc = 0;
      for (let i = 0; i < histo.length; i++) {
        acc += histo[i];
        if (acc >= target) return i;
      }
      return histo.length - 1;
    };
    const medianDark = percentileFromHist(hist, 0.5);

    const madHist = new Uint32Array(256);
    for (let y = minY; y < maxY; y++) {
      const row = y * w;
      for (let x = minX; x < maxX; x++) {
        const i = row + x;
        if (!innerMask[i]) continue;
        const dev = Math.abs(dark[i] - medianDark);
        madHist[Math.min(255, dev)]++;
      }
    }
    const mad = percentileFromHist(madHist, 0.5);
    const thr = Math.max(8, Math.min(160, Math.round(medianDark + Math.max(5, 2 * Math.max(3, mad)))));

    const raw = new Uint8Array(size);
    let rawCount = 0;
    for (let y = minY; y < maxY; y++) {
      const row = y * w;
      for (let x = minX; x < maxX; x++) {
        const i = row + x;
        if (!innerMask[i]) continue;
        if (dark[i] >= thr) {
          raw[i] = 1;
          rawCount++;
        }
      }
    }

    // Gentle clean-up: opening + closing to suppress texture dots and keep marker-like strokes.
    const opened = morphDilate(morphErode(raw, w, h, 1), w, h, 1);
    const clean = morphErode(morphDilate(opened, w, h, 1), w, h, 1);

    const visited = new Uint8Array(size);
    const minLen = Math.max(38, Math.round(minDim * 0.055));
    const maxLen = Math.max(360, Math.round(minDim * 0.42));
    let best = null;
    let second = null;
    let compCount = 0;

    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const i = y * w + x;
        if (!clean[i] || visited[i]) continue;
        const comp = bfsMaskComponent(clean, visited, x, y, w, h);
        if (!comp || comp.length < 18 || comp.length > 14000) continue;
        compCount++;
        const feat = segmentFeaturesFromComponent(comp, w);
        if (!feat) continue;
        if (feat.lengthPx < minLen || feat.lengthPx > maxLen) continue;
        if (feat.ratio < 1.3 || feat.linearity < 1.5) continue;

        const mx = (feat.p1.x + feat.p2.x) * 0.5;
        const my = (feat.p1.y + feat.p2.y) * 0.5;
        if (isInStickerExclusion(mx, my, qrMargin)) continue;

        const edgeDistRaw = getEdgeDistance(mx, my);
        const edgeDist = Number.isFinite(edgeDistRaw) ? edgeDistRaw : (edgeMargin + 1);
        if (edgeDist < edgeMargin) continue;

        const straightness = Math.hypot(feat.p2.x - feat.p1.x, feat.p2.y - feat.p1.y) / Math.max(1, feat.lengthPx);
        if (straightness < 0.5) continue;

        const thickness = comp.length / Math.max(1, feat.lengthPx);
        if (thickness < 1.2 || thickness > 14.0) continue;

        let darkSum = 0;
        let darkP90Hist = new Uint16Array(256);
        let strongDark = 0;
        for (let k = 0; k < comp.length; k++) {
          const idx = comp[k];
          const v = dark[idx];
          darkSum += v;
          darkP90Hist[v]++;
          if (v >= thr + 8) strongDark++;
        }
        const meanDark = darkSum / Math.max(1, comp.length);
        const p90Dark = (() => {
          const tgt = Math.max(1, Math.round(comp.length * 0.9));
          let acc = 0;
          for (let j = 0; j < 256; j++) {
            acc += darkP90Hist[j];
            if (acc >= tgt) return j;
          }
          return 0;
        })();
        const strongRatio = strongDark / Math.max(1, comp.length);
        if (strongRatio < 0.08) continue;

        const normDark = Math.min(1, meanDark / 70);
        const normAspect = Math.min(1, feat.ratio / 7);
        const normStraight = Math.min(1, straightness / 0.95);
        const normWidth = Math.max(0, 1 - Math.abs(thickness - 4.0) / 4.0);
        const normEdge = Math.min(1, edgeDist / 50);
        const normP90 = Math.min(1, p90Dark / 90);
        const score =
          0.28 * normDark +
          0.18 * normAspect +
          0.2 * normStraight +
          0.12 * normWidth +
          0.12 * normEdge +
          0.1 * normP90;

        const cand = { score, feat, comp };
        if (!best || score > best.score) {
          second = best;
          best = cand;
        } else if (!second || score > second.score) {
          second = cand;
        }
      }
    }

    if (!best || best.score < 0.42 || (second && (best.score - second.score) < 0.02)) {
      // If component scoring fails, try Hough over cleaned local-dark mask.
      const houghSeg = detectLineFromBinaryMaskHough?.(clean, w, h);
      if (houghSeg?.p1 && houghSeg?.p2) {
        setLineMasks(raw, clean, clean);
        setLineMaskInfo({
          threshold: thr,
          mean: medianDark,
          std: mad,
          mode: "local-dark-hough",
          edgeMargin,
          candidates: compCount,
          innerCount,
          rawCount
        });
        return { p1: houghSeg.p1, p2: houghSeg.p2 };
      }
      setLineMasks(raw, clean, clean);
      setLineMaskInfo({
        threshold: thr,
        mean: medianDark,
        std: mad,
        mode: "local-dark-none",
        edgeMargin,
        candidates: compCount,
        innerCount,
        rawCount
      });
      return null;
    }

    setLineMasks(raw, clean, toBinaryMask(best.comp, size));
    setLineMaskInfo({
      threshold: thr,
      mean: medianDark,
      std: mad,
      mode: "local-dark-marker",
      edgeMargin,
      candidates: second ? 2 : 1
    });
    return { p1: best.feat.p1, p2: best.feat.p2 };
  }

  function detectDirectBlackMarkerSegment() {
    const sourceData = sourceDataRef();
    const canvas = canvasRef();
    if (!sourceData || !canvas?.width || !canvas?.height) return null;
    const lineSearch = getLineSearchMask();
    const searchMask = lineSearch?.mask;
    const reliablePolygon = !!lineSearch?.reliablePolygon;
    if (!searchMask) return null;
    const w = canvas.width;
    const h = canvas.height;
    const size = w * h;
    const raw = new Uint8Array(size);
    const visited = new Uint8Array(size);

    let sum = 0;
    let sum2 = 0;
    let cnt = 0;
    for (let y = 2; y < h - 2; y += 2) {
      const row = y * w;
      for (let x = 2; x < w - 2; x += 2) {
        const i = row + x;
        if (!searchMask[i]) continue;
        if (isInStickerExclusion(x, y, 14)) continue;
        if (reliablePolygon && getEdgeDistance(x, y) < 3) continue;
        const g = sampleGray(x, y);
        sum += g;
        sum2 += g * g;
        cnt++;
      }
    }
    const mean = cnt ? (sum / cnt) : 190;
    const variance = cnt ? Math.max(0, sum2 / cnt - mean * mean) : 0;
    const std = Math.sqrt(variance);
    const darkThr = Math.max(58, Math.min(118, mean - 3.3 * std));
    const maxLen = Math.max(180, Math.round(Math.min(w, h) * 0.34));
    const edgeMin = 0;
    const minX = Math.floor(w * 0.14);
    const maxX = Math.ceil(w * 0.86);
    const minY = Math.floor(h * 0.16);
    const maxY = Math.ceil(h * 0.90);
    for (let y = minY; y < maxY; y++) {
      const row = y * w;
      for (let x = minX; x < maxX; x++) {
        const i = row + x;
        if (!searchMask[i]) continue;
        if (isInStickerExclusion(x, y, 14)) continue;
        if (edgeMin > 0 && getEdgeDistance(x, y) < edgeMin) continue;
        const p = i * 4;
        const r = sourceData[p];
        const g = sourceData[p + 1];
        const b = sourceData[p + 2];
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        const gray = sampleGray(x, y);
        if (gray <= darkThr && spread <= 86) raw[i] = 1;
      }
    }

    const clean = morphErode(morphDilate(raw, w, h, 1), w, h, 1);
    let best = null;
    const minLen = Math.max(36, Math.round(Math.min(w, h) * 0.065));
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const i = y * w + x;
        if (!clean[i] || visited[i]) continue;
        const comp = bfsMaskComponent(clean, visited, x, y, w, h);
        if (!comp || comp.length < 24 || comp.length > 9000) continue;
        const feat = segmentFeaturesFromComponent(comp, w);
        if (!feat) continue;
        if (feat.lengthPx < minLen) continue;
        if (feat.lengthPx > maxLen) continue;
        if (feat.linearity < 3.2 || feat.ratio < 2.1) continue;
        if (Math.max(feat.bboxW, feat.bboxH) > 340) continue;
        const mx = (feat.p1.x + feat.p2.x) * 0.5;
        const my = (feat.p1.y + feat.p2.y) * 0.5;
        if (isInStickerExclusion(mx, my, 18)) continue;

        let darkCount = 0;
        for (let k = 0; k < comp.length; k++) {
          const idx = comp[k];
          const px = idx % w;
          const py = (idx - px) / w;
          if (sampleGray(px, py) <= (darkThr + 22)) darkCount++;
        }
        const darkRatio = darkCount / Math.max(1, comp.length);
        if (darkRatio < 0.74) continue;

        const contrast = getStrokeContrastScore(feat.p1, feat.p2, darkThr + 18);
        if (contrast < 0.18) continue;

        // Anti-sticker: reject components sitting on very bright paper background (QR label).
        let sideSum = 0;
        let sideCnt = 0;
        const step = Math.max(1, Math.floor(comp.length / 80));
        for (let k = 0; k < comp.length; k += step) {
          const idx = comp[k];
          const px = idx % w;
          const py = (idx - px) / w;
          const probes = [
            [px + 4, py], [px - 4, py], [px, py + 4], [px, py - 4]
          ];
          for (let t = 0; t < probes.length; t++) {
            const sx = probes[t][0];
            const sy = probes[t][1];
            if (sx < 1 || sy < 1 || sx >= w - 1 || sy >= h - 1) continue;
            if (!searchMask[sy * w + sx]) continue;
            sideSum += sampleGray(sx, sy);
            sideCnt++;
          }
        }
        const sideMean = sideCnt > 0 ? (sideSum / sideCnt) : 0;
        if (sideCnt > 12 && sideMean > 222) continue;

        const thickness = comp.length / Math.max(1, feat.lengthPx);
        if (thickness < 2.2 || thickness > 12.5) continue;

        const score =
          feat.lengthPx * 6.0 +
          feat.linearity * 7.5 +
          feat.ratio * 5.4 +
          darkRatio * 95 +
          contrast * 75 -
          thickness * 2.2;
        if (!best || score > best.score) best = { score, feat, comp };
      }
    }
    if (!best) {
      // Fast fallback: Hough on strict black mask, still constrained by ROI/sticker.
      const houghSeg = detectLineFromBinaryMaskHough?.(clean, w, h);
      if (!houghSeg?.p1 || !houghSeg?.p2) return null;
      const mx = (houghSeg.p1.x + houghSeg.p2.x) * 0.5;
      const my = (houghSeg.p1.y + houghSeg.p2.y) * 0.5;
      if (isInStickerExclusion(mx, my, 18)) return null;
      setLineMasks(raw, clean, clean);
      setLineMaskInfo({ threshold: darkThr, mean, std, mode: "direct-marker-hough" });
      return { p1: houghSeg.p1, p2: houghSeg.p2 };
    }
    setLineMasks(raw, clean, toBinaryMask(best.comp, size));
    setLineMaskInfo({ threshold: darkThr, mean, std, mode: "direct-marker" });
    return { p1: best.feat.p1, p2: best.feat.p2 };
  }

  function detectGlobalMarkerHoughRelaxed() {
    const sourceData = sourceDataRef();
    const canvas = canvasRef();
    const cv = cvRef?.();
    if (!sourceData || !canvas?.width || !canvas?.height || !isCvReady?.() || !cv) return null;
    const w = canvas.width;
    const h = canvas.height;
    let gray = null;
    let bin = null;
    let lines = null;
    try {
      gray = new cv.Mat(h, w, cv.CV_8U);
      const gd = gray.data;
      for (let i = 0; i < w * h; i++) {
        const p = i * 4;
        const r = sourceData[p];
        const g = sourceData[p + 1];
        const b = sourceData[p + 2];
        gd[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }
      bin = new cv.Mat(h, w, cv.CV_8U);
      cv.threshold(gray, bin, 110, 255, cv.THRESH_BINARY_INV);
      const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      cv.morphologyEx(bin, bin, cv.MORPH_OPEN, k);
      cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, k);
      k.delete();

      lines = new cv.Mat();
      const minLineLength = Math.max(36, Math.round(Math.min(w, h) * 0.06));
      const maxLineLength = Math.max(180, Math.round(Math.min(w, h) * 0.34));
      const maxGap = Math.max(10, Math.round(Math.min(w, h) * 0.014));
      cv.HoughLinesP(bin, lines, 1, Math.PI / 180, 14, minLineLength, maxGap);
      if (!lines || lines.rows < 1) return null;

      const border = Math.max(16, Math.round(Math.min(w, h) * 0.06));
      const cx = w * 0.5;
      const cy = h * 0.5;
      let best = null;
      const v = lines.data32S;
      const maxRows = Math.min(lines.rows, 420);
      for (let i = 0; i < maxRows; i++) {
        const x1 = v[i * 4];
        const y1 = v[i * 4 + 1];
        const x2 = v[i * 4 + 2];
        const y2 = v[i * 4 + 3];
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < minLineLength || len > maxLineLength) continue;
        const mx = (x1 + x2) * 0.5;
        const my = (y1 + y2) * 0.5;
        if (mx < border || my < border || mx > (w - border) || my > (h - border)) continue;
        if (isInStickerExclusion(mx, my, 32)) continue;

        let dark = 0;
        let valid = 0;
        for (let t = 0; t <= 18; t++) {
          const a = t / 18;
          const sx = Math.round(x1 + (x2 - x1) * a);
          const sy = Math.round(y1 + (y2 - y1) * a);
          if (sx < 1 || sy < 1 || sx >= w - 1 || sy >= h - 1) continue;
          valid++;
          if (sampleGray(sx, sy) <= 128) dark++;
        }
        if (valid < 8) continue;
        const darkRatio = dark / valid;
        if (darkRatio < 0.7) continue;
        const contrast = getStrokeContrastScore({ x: x1, y: y1 }, { x: x2, y: y2 }, 138);
        if (contrast < 0.1) continue;
        const ang = Math.abs(Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI);
        const nonHorizontal = ang > 25 ? 1 : 0.35;
        const centerDist = Math.hypot(mx - cx, my - cy);
        const score = len * 6.2 + darkRatio * 110 + contrast * 60 + nonHorizontal * 42 - centerDist * 0.12;
        if (!best || score > best.score) best = { score, p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } };
      }
      if (!best) return null;
      const mask = toBinaryMaskFromMat(bin);
      setLineMasks(mask, mask, mask);
      setLineMaskInfo({ threshold: 110, mean: 0, std: 0, mode: "global-hough-relaxed" });
      return { p1: best.p1, p2: best.p2 };
    } catch (_) {
      return null;
    } finally {
      if (gray) gray.delete();
      if (bin) bin.delete();
      if (lines) lines.delete();
    }
  }

  function detectFastGlobalBlackMarkerHough() {
    const sourceData = sourceDataRef();
    const canvas = canvasRef();
    const cv = cvRef?.();
    if (!sourceData || !canvas?.width || !canvas?.height || !isCvReady?.() || !cv) return null;
    const w = canvas.width;
    const h = canvas.height;
    const lineSearch = getLineSearchMask();
    const searchMask = lineSearch?.mask;
    if (!searchMask) return null;
    const searchDist = buildDistanceTransform(searchMask, w, h);

    const maskStats = getMaskCenterAndCoverage(searchMask, w, h);
    const centerX = maskStats?.cx ?? (w * 0.5);
    const centerY = maskStats?.cy ?? (h * 0.5);

    let gray = null;
    let bin = null;
    let lines = null;
    try {
      gray = new cv.Mat(h, w, cv.CV_8U);
      const gd = gray.data;
      for (let i = 0; i < w * h; i++) {
        const p = i * 4;
        const r = sourceData[p];
        const g = sourceData[p + 1];
        const b = sourceData[p + 2];
        gd[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }

      bin = new cv.Mat(h, w, cv.CV_8U);
      cv.threshold(gray, bin, 96, 255, cv.THRESH_BINARY_INV);

      const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      cv.morphologyEx(bin, bin, cv.MORPH_OPEN, k);
      cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, k);
      k.delete();

      lines = new cv.Mat();
      const minLineLength = Math.max(28, Math.round(Math.min(w, h) * 0.05));
      const maxLineLength = Math.max(120, Math.round(Math.min(w, h) * 0.18));
      const maxGap = Math.max(8, Math.round(Math.min(w, h) * 0.01));
      cv.HoughLinesP(bin, lines, 1, Math.PI / 180, 22, minLineLength, maxGap);
      if (!lines || lines.rows < 1) {
        setLineMaskInfo({ mode: "fast-hough-none" });
        return null;
      }

      let best = null;
      let bestRelaxed = null;
      let bestEmergency = null;
      let bestLastResort = null;
      let strictPassed = 0;
      let relaxedPassed = 0;
      let emergencyPassed = 0;
      let lastResortPassed = 0;
      const v = lines.data32S;
      const borderMargin = Math.max(18, Math.round(Math.min(w, h) * 0.09));
      for (let i = 0; i < lines.rows; i++) {
        const x1 = v[i * 4];
        const y1 = v[i * 4 + 1];
        const x2 = v[i * 4 + 2];
        const y2 = v[i * 4 + 3];

        const p1 = { x: x1, y: y1 };
        const p2 = { x: x2, y: y2 };
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < minLineLength || len > maxLineLength) {
          // Keep a wider length window for relaxed fallback.
          const relaxedMaxLen = Math.max(maxLineLength * 2, Math.round(Math.min(w, h) * 0.36));
          if (len < Math.max(14, Math.round(minLineLength * 0.7)) || len > relaxedMaxLen) continue;
        }

        const mx = (x1 + x2) * 0.5;
        const my = (y1 + y2) * 0.5;
        if (mx < 2 || my < 2 || mx >= w - 2 || my >= h - 2) continue;
        if (mx < borderMargin || my < borderMargin || mx > (w - borderMargin) || my > (h - borderMargin)) {
          const relaxedMargin = Math.max(10, Math.round(Math.min(w, h) * 0.05));
          if (mx < relaxedMargin || my < relaxedMargin || mx > (w - relaxedMargin) || my > (h - relaxedMargin)) continue;
        }
        if (isInStickerExclusion(mx, my, 28)) continue;
        const mix = Math.round(mx);
        const miy = Math.round(my);
        const si = miy * w + mix;
        const dMid = searchDist?.[si] ?? 0;
        const d1 = searchDist?.[Math.round(y1) * w + Math.round(x1)] ?? 0;
        const d2 = searchDist?.[Math.round(y2) * w + Math.round(x2)] ?? 0;
        if (Math.min(dMid, d1, d2) < 2) continue;

        let valid = 0;
        let dark = 0;
        let spreadSum = 0;
        for (let t = 0; t <= 20; t++) {
          const a = t / 20;
          const sx = Math.round(x1 + (x2 - x1) * a);
          const sy = Math.round(y1 + (y2 - y1) * a);
          if (sx < 1 || sy < 1 || sx >= w - 1 || sy >= h - 1) continue;
          const si = sy * w + sx;
          if (!searchMask[si]) continue;
          valid++;
          const gray = sampleGray(sx, sy);
          if (gray < 130) dark++;
          const p = si * 4;
          const r = sourceData[p];
          const g = sourceData[p + 1];
          const b = sourceData[p + 2];
          spreadSum += (Math.max(r, g, b) - Math.min(r, g, b));
        }
        if (valid < 6) continue;
        // Always keep an interior fallback candidate for nap direction, even when color heuristics are unstable.
        if (
          len >= Math.max(20, Math.round(minLineLength * 0.5)) &&
          len <= Math.max(maxLineLength * 2.4, Math.round(Math.min(w, h) * 0.5)) &&
          dMid >= 1.6
        ) {
          const interiorFallbackScore =
            len * 2.2 +
            dMid * 5.6 -
            centerDist * 0.06;
          lastResortPassed++;
          if (!bestLastResort || interiorFallbackScore > bestLastResort.score) {
            bestLastResort = { score: interiorFallbackScore, p1, p2 };
          }
        }

        const darkRatio = dark / valid;
        if (darkRatio < 0.45) continue;
        const avgSpread = spreadSum / valid;
        if (avgSpread > 58) continue;

        const contrastScore = getStrokeContrastScore(p1, p2, 142);
        if (contrastScore < 0.05) continue;
        const sideStats = getStrokeSideBrightnessStats(p1, p2);
        if (!sideStats) continue;
        if (sideStats.sideMin < 85) continue;
        if (sideStats.sideDelta > 120) continue;

        const centerDist = Math.hypot(mx - centerX, my - centerY);
        const strictScore =
          len * 5.8 +
          darkRatio * 110 +
          contrastScore * 85 +
          sideStats.sideMean * 0.22 -
          sideStats.sideDelta * 0.65 -
          centerDist * 0.14 +
          dMid * 1.6;
        if (
          darkRatio >= 0.62 &&
          contrastScore >= 0.12 &&
          sideStats.sideMin >= 105 &&
          sideStats.sideDelta <= 92
        ) {
          strictPassed++;
          if (!best || strictScore > best.score) best = { score: strictScore, p1, p2 };
        } else {
          const relaxedScore =
            len * 3.2 +
            darkRatio * 52 +
            contrastScore * 45 -
            centerDist * 0.08 +
            dMid * 1.1;
          relaxedPassed++;
          if (!bestRelaxed || relaxedScore > bestRelaxed.score) bestRelaxed = { score: relaxedScore, p1, p2 };
        }

        // Emergency capture for obvious thick marker strokes.
        if (
          len >= Math.max(18, Math.round(minLineLength * 0.55)) &&
          darkRatio >= 0.36 &&
          contrastScore >= 0.015 &&
          sideStats.sideMin >= 70 &&
          sideStats.sideDelta <= 145 &&
          dMid >= 1.4
        ) {
          const emergencyScore =
            len * 2.0 +
            darkRatio * 34 +
            contrastScore * 28 +
            dMid * 0.9 -
            centerDist * 0.05;
          emergencyPassed++;
          if (!bestEmergency || emergencyScore > bestEmergency.score) {
            bestEmergency = { score: emergencyScore, p1, p2 };
          }
        }

        // Last-resort branch: choose dominant inner-segment line even when color/contrast heuristics are unstable.
        if (
          len >= Math.max(20, Math.round(minLineLength * 0.5)) &&
          len <= Math.max(maxLineLength * 2.2, Math.round(Math.min(w, h) * 0.42)) &&
          dMid >= 1.6 &&
          valid >= 7
        ) {
          const lastResortScore =
            len * 2.3 +
            dMid * 4.2 -
            centerDist * 0.05;
          lastResortPassed++;
          if (!bestLastResort || lastResortScore > bestLastResort.score) {
            bestLastResort = { score: lastResortScore, p1, p2 };
          }
        }
      }

      const mask = toBinaryMaskFromMat(bin);
      setLineMasks(mask, mask, mask);
      let winner = best || bestRelaxed || bestEmergency || bestLastResort;
      let selectedBy = best
        ? "strict"
        : bestRelaxed
          ? "relaxed"
          : bestEmergency
            ? "emergency"
            : bestLastResort
              ? "last-resort"
              : "none";

      // Hard fallback for nap-direction KPI: if heuristics reject everything,
      // choose the best geometric line that is clearly inside ROI and outside QR.
      if (!winner && lines.rows > 0) {
        let hard = null;
        const maxRows2 = Math.min(lines.rows, 320);
        for (let i = 0; i < maxRows2; i++) {
          const x1 = v[i * 4];
          const y1 = v[i * 4 + 1];
          const x2 = v[i * 4 + 2];
          const y2 = v[i * 4 + 3];
          const len = Math.hypot(x2 - x1, y2 - y1);
          if (len < Math.max(22, Math.round(minLineLength * 0.45))) continue;
          if (len > Math.max(maxLineLength * 2.6, Math.round(Math.min(w, h) * 0.58))) continue;
          const mx = (x1 + x2) * 0.5;
          const my = (y1 + y2) * 0.5;
          if (mx < 2 || my < 2 || mx >= w - 2 || my >= h - 2) continue;
          if (isInStickerExclusion(mx, my, 24)) continue;
          const mix = Math.round(mx);
          const miy = Math.round(my);
          if (!searchMask[miy * w + mix]) continue;
          const centerDist = Math.hypot(mx - centerX, my - centerY);
          const score = len * 2.8 - centerDist * 0.03;
          if (!hard || score > hard.score) hard = { score, p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } };
        }
        if (hard) {
          winner = hard;
          selectedBy = "hard-fallback";
        }
      }
      setLineMaskInfo({
        mode: winner ? "fast-hough" : "fast-hough-none",
        searchMaskSource: lineSearch?.source || "-",
        searchMaskCoverage: maskStats?.coverage ?? 0,
        candidates: Number(lines?.rows || 0),
        strictPassed,
        relaxedPassed,
        emergencyPassed,
        lastResortPassed,
        selectedBy
      });
      return winner ? { p1: winner.p1, p2: winner.p2 } : null;
    } catch (_) {
      return null;
    } finally {
      if (gray) gray.delete();
      if (bin) bin.delete();
      if (lines) lines.delete();
    }
  }

  function detectAnyColorMarkerSegment() {
    const sourceData = sourceDataRef();
    const canvas = canvasRef();
    const cv = cvRef?.();
    if (!sourceData || !canvas?.width || !canvas?.height || !isCvReady?.() || !cv) return null;
    const lineSearch = getLineSearchMask();
    const searchMask = lineSearch?.mask;
    if (!searchMask) return null;

    const w = canvas.width;
    const h = canvas.height;
    const size = w * h;
    const edgeMask = new Uint8Array(size);
    const maxLen = Math.max(360, Math.round(Math.min(w, h) * 0.62));

    let gray = null;
    let edges = null;
    let houghMask = null;
    let lines = null;
    try {
      gray = new cv.Mat(h, w, cv.CV_8U);
      const gd = gray.data;
      for (let i = 0; i < size; i++) {
        const p = i * 4;
        const r = sourceData[p];
        const g = sourceData[p + 1];
        const b = sourceData[p + 2];
        gd[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }
      cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);

      edges = new cv.Mat();
      cv.Canny(gray, edges, 48, 138, 3, true);

      houghMask = new cv.Mat(h, w, cv.CV_8U);
      const hd = houghMask.data;
      const ed = edges.data;
      let edgeCount = 0;
      for (let y = 1; y < h - 1; y++) {
        const row = y * w;
        for (let x = 1; x < w - 1; x++) {
          const i = row + x;
          if (!ed[i]) continue;
          if (!searchMask[i]) continue;
          if (isInStickerExclusion(x, y, 24)) continue;
          if (getEdgeDistance(x, y) < 1) continue;
          edgeMask[i] = 1;
          hd[i] = 255;
          edgeCount++;
        }
      }
      if (edgeCount < 26) return null;

      lines = new cv.Mat();
      const minLineLength = Math.max(24, Math.round(getAutoMinLineLengthPx() * 0.45));
      const maxGap = Math.max(8, Math.round(Math.min(w, h) * 0.015));
      cv.HoughLinesP(houghMask, lines, 1, Math.PI / 180, 16, minLineLength, maxGap);
      if (!lines || lines.rows < 1) return null;

      let best = null;
      const cx = w * 0.5;
      const cy = h * 0.55;
      const v = lines.data32S;
      for (let i = 0; i < lines.rows; i++) {
        const x1 = v[i * 4];
        const y1 = v[i * 4 + 1];
        const x2 = v[i * 4 + 2];
        const y2 = v[i * 4 + 3];

        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        if (len < minLineLength || len > maxLen) continue;

        const p1 = { x: x1, y: y1 };
        const p2 = { x: x2, y: y2 };
        const mx = (x1 + x2) * 0.5;
        const my = (y1 + y2) * 0.5;
        if (isInStickerExclusion(mx, my, 24)) continue;
        if (getEdgeDistance(mx, my) < 1) continue;

        const invLen = 1 / Math.max(1, len);
        const nx = -dy * invLen;
        const ny = dx * invLen;
        let valid = 0;
        let edgeHits = 0;
        let spreadSum = 0;
        let sideDeltaSum = 0;
        for (let t = 0; t <= 20; t++) {
          const a = t / 20;
          const sx = Math.round(x1 + dx * a);
          const sy = Math.round(y1 + dy * a);
          if (sx < 2 || sy < 2 || sx >= w - 2 || sy >= h - 2) continue;
          const si = sy * w + sx;
          if (!searchMask[si]) continue;
          if (isInStickerExclusion(sx, sy, 20)) continue;
          valid++;
          if (edgeMask[si]) edgeHits++;
          const p = si * 4;
          const r = sourceData[p];
          const g = sourceData[p + 1];
          const b = sourceData[p + 2];
          spreadSum += (Math.max(r, g, b) - Math.min(r, g, b));

          const centerGray = sampleGray(sx, sy);
          const s1x = Math.round(sx + nx * 3);
          const s1y = Math.round(sy + ny * 3);
          const s2x = Math.round(sx - nx * 3);
          const s2y = Math.round(sy - ny * 3);
          if (s1x < 1 || s1y < 1 || s1x >= w - 1 || s1y >= h - 1) continue;
          if (s2x < 1 || s2y < 1 || s2x >= w - 1 || s2y >= h - 1) continue;
          if (!searchMask[s1y * w + s1x] || !searchMask[s2y * w + s2x]) continue;
          const side = (sampleGray(s1x, s1y) + sampleGray(s2x, s2y)) * 0.5;
          sideDeltaSum += Math.abs(side - centerGray);
        }
        if (valid < 7) continue;
        const edgeRatio = edgeHits / valid;
        if (edgeRatio < 0.52) continue;
        const meanSpread = spreadSum / valid;
        const meanSideDelta = sideDeltaSum / valid;
        if (meanSpread < 20 && meanSideDelta < 8) continue;

        const centerDist = Math.hypot(mx - cx, my - cy);
        const score =
          len * 3.9 +
          edgeRatio * 90 +
          meanSpread * 0.7 +
          meanSideDelta * 1.9 -
          centerDist * 0.06;
        if (!best || score > best.score) best = { score, p1, p2 };
      }

      if (!best) return null;
      setLineMasks(edgeMask, edgeMask, edgeMask);
      setLineMaskInfo({
        mode: "any-color-hough",
        candidates: Number(lines?.rows || 0),
        searchMaskSource: lineSearch?.source || "-"
      });
      return { p1: best.p1, p2: best.p2 };
    } catch (_) {
      return null;
    } finally {
      if (gray) gray.delete();
      if (edges) edges.delete();
      if (houghMask) houghMask.delete();
      if (lines) lines.delete();
    }
  }

  function detectInteriorEdgeHoughSegment() {
    const sourceData = sourceDataRef();
    const canvas = canvasRef();
    const cv = cvRef?.();
    if (!sourceData || !canvas?.width || !canvas?.height || !isCvReady?.() || !cv) return null;
    const lineSearch = getLineSearchMask();
    const searchMask = lineSearch?.mask;
    if (!searchMask) return null;

    const w = canvas.width;
    const h = canvas.height;
    const size = w * h;
    const edgeMask = new Uint8Array(size);
    let gray = null;
    let edges = null;
    let masked = null;
    let lines = null;
    try {
      gray = new cv.Mat(h, w, cv.CV_8U);
      const gd = gray.data;
      for (let i = 0; i < size; i++) {
        const p = i * 4;
        const r = sourceData[p];
        const g = sourceData[p + 1];
        const b = sourceData[p + 2];
        gd[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }
      cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
      edges = new cv.Mat();
      cv.Canny(gray, edges, 42, 124, 3, true);

      masked = new cv.Mat(h, w, cv.CV_8U);
      const md = masked.data;
      const ed = edges.data;
      let count = 0;
      for (let y = 1; y < h - 1; y++) {
        const row = y * w;
        for (let x = 1; x < w - 1; x++) {
          const i = row + x;
          if (!ed[i]) continue;
          if (!searchMask[i]) continue;
          if (isInStickerExclusion(x, y, 20)) continue;
          if (getEdgeDistance(x, y) < 2) continue;
          md[i] = 255;
          edgeMask[i] = 1;
          count++;
        }
      }
      if (count < 20) return null;

      lines = new cv.Mat();
      const minLineLength = Math.max(24, Math.round(getAutoMinLineLengthPx() * 0.42));
      const maxGap = Math.max(8, Math.round(Math.min(w, h) * 0.018));
      cv.HoughLinesP(masked, lines, 1, Math.PI / 180, 14, minLineLength, maxGap);
      if (!lines || lines.rows < 1) return null;

      const v = lines.data32S;
      const maxRows = Math.min(lines.rows, 260);
      const maxLen = Math.max(360, Math.round(Math.min(w, h) * 0.64));
      let best = null;
      for (let i = 0; i < maxRows; i++) {
        const x1 = v[i * 4];
        const y1 = v[i * 4 + 1];
        const x2 = v[i * 4 + 2];
        const y2 = v[i * 4 + 3];
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < minLineLength || len > maxLen) continue;

        const p1 = { x: x1, y: y1 };
        const p2 = { x: x2, y: y2 };
        const mx = (x1 + x2) * 0.5;
        const my = (y1 + y2) * 0.5;
        if (isInStickerExclusion(mx, my, 20)) continue;

        let valid = 0;
        let edgeHits = 0;
        let edgeDistSum = 0;
        for (let t = 0; t <= 14; t++) {
          const a = t / 14;
          const sx = Math.round(x1 + (x2 - x1) * a);
          const sy = Math.round(y1 + (y2 - y1) * a);
          if (sx < 1 || sy < 1 || sx >= w - 1 || sy >= h - 1) continue;
          const si = sy * w + sx;
          if (!searchMask[si]) continue;
          valid++;
          if (edgeMask[si]) edgeHits++;
          const d = getEdgeDistance(sx, sy);
          if (Number.isFinite(d)) edgeDistSum += d;
        }
        if (valid < 6) continue;
        const edgeRatio = edgeHits / valid;
        if (edgeRatio < 0.45) continue;
        const avgEdgeDist = edgeDistSum / valid;
        if (avgEdgeDist < 3.0) continue;

        const score = len * 3.6 + avgEdgeDist * 18 + edgeRatio * 65;
        if (!best || score > best.score) best = { score, p1, p2 };
      }

      if (!best) return null;
      setLineMasks(edgeMask, edgeMask, edgeMask);
      setLineMaskInfo({
        mode: "interior-edge-hough",
        candidates: Number(lines?.rows || 0),
        searchMaskSource: lineSearch?.source || "-"
      });
      return { p1: best.p1, p2: best.p2 };
    } catch (_) {
      return null;
    } finally {
      if (gray) gray.delete();
      if (edges) edges.delete();
      if (masked) masked.delete();
      if (lines) lines.delete();
    }
  }

  function detectForceEdgeDirectionSegment() {
    const sourceData = sourceDataRef();
    const canvas = canvasRef();
    const cv = cvRef?.();
    if (!sourceData || !canvas?.width || !canvas?.height || !isCvReady?.() || !cv) return null;
    const lineSearch = getLineSearchMask();
    const searchMask = lineSearch?.mask;
    if (!searchMask) return null;

    const w = canvas.width;
    const h = canvas.height;
    const size = w * h;
    let gray = null;
    let edges = null;
    let masked = null;
    let lines = null;
    try {
      gray = new cv.Mat(h, w, cv.CV_8U);
      const gd = gray.data;
      for (let i = 0; i < size; i++) {
        const p = i * 4;
        const r = sourceData[p];
        const g = sourceData[p + 1];
        const b = sourceData[p + 2];
        gd[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }
      edges = new cv.Mat();
      cv.Canny(gray, edges, 36, 110, 3, true);
      masked = new cv.Mat(h, w, cv.CV_8U);
      const ed = edges.data;
      const md = masked.data;
      for (let y = 1; y < h - 1; y++) {
        const row = y * w;
        for (let x = 1; x < w - 1; x++) {
          const i = row + x;
          if (!ed[i]) continue;
          if (!searchMask[i]) continue;
          if (isInStickerExclusion(x, y, 20)) continue;
          if (getEdgeDistance(x, y) < 2) continue;
          md[i] = 255;
        }
      }

      lines = new cv.Mat();
      const minLineLength = Math.max(20, Math.round(getAutoMinLineLengthPx() * 0.4));
      cv.HoughLinesP(masked, lines, 1, Math.PI / 180, 10, minLineLength, 18);
      if (!lines || lines.rows < 1) return null;
      const v = lines.data32S;
      const cx = w * 0.5;
      const cy = h * 0.55;
      let best = null;
      const maxRows = Math.min(lines.rows, 420);
      for (let i = 0; i < maxRows; i++) {
        const x1 = v[i * 4];
        const y1 = v[i * 4 + 1];
        const x2 = v[i * 4 + 2];
        const y2 = v[i * 4 + 3];
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < minLineLength) continue;
        const mx = (x1 + x2) * 0.5;
        const my = (y1 + y2) * 0.5;
        if (isInStickerExclusion(mx, my, 20)) continue;
        if (mx < 2 || my < 2 || mx >= w - 2 || my >= h - 2) continue;
        const mi = Math.round(my) * w + Math.round(mx);
        if (!searchMask[mi]) continue;
        const edgeD = getEdgeDistance(mx, my);
        if (!Number.isFinite(edgeD) || edgeD < 2) continue;
        const centerDist = Math.hypot(mx - cx, my - cy);
        const score = len * 2.9 + edgeD * 7.0 - centerDist * 0.04;
        if (!best || score > best.score) best = { score, p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } };
      }
      if (!best) return null;
      setLineMaskInfo({ mode: "force-edge-direction", candidates: Number(lines?.rows || 0) });
      return { p1: best.p1, p2: best.p2 };
    } catch (_) {
      return null;
    } finally {
      if (gray) gray.delete();
      if (edges) edges.delete();
      if (masked) masked.delete();
      if (lines) lines.delete();
    }
  }

  function detectLineSegmentOpenCV() {
    const sourceData = sourceDataRef();
    const canvas = canvasRef();
    const sourceCanvas = sourceCanvasRef?.();
    const cv = cvRef?.();
    if (!isCvReady?.() || !cv || !cv.Mat || !sourceCanvas?.width) return null;
    if (!sourceData || !canvas?.width || !canvas?.height) return null;
    const lineSearch = getLineSearchMask();
    const searchMask = lineSearch?.mask;
    const reliablePolygon = !!lineSearch?.reliablePolygon;
    if (!searchMask) return null;

    let src = null;
    let gray = null;
    let dark = null;
    let poly = null;
    let masked = null;
    let kernel = null;
    let lines = null;
    let blur = null;
    let edges = null;
    try {
      const w = canvas.width;
      const h = canvas.height;
      let sum = 0;
      let sum2 = 0;
      let cnt = 0;
      for (let y = 2; y < h - 2; y += 2) {
        for (let x = 2; x < w - 2; x += 2) {
          const i = y * w + x;
          if (!searchMask[i]) continue;
          if (isInStickerExclusion(x, y, 28)) continue;
          if (reliablePolygon && getEdgeDistance(x, y) < 3.5) continue;
          const g = sampleGray(x, y);
          sum += g;
          sum2 += g * g;
          cnt++;
        }
      }
      const mean = cnt ? sum / cnt : 190;
      const variance = cnt ? Math.max(0, sum2 / cnt - mean * mean) : 0;
      const std = Math.sqrt(variance);
      const thrBlack = Math.max(62, Math.min(145, mean - 2.0 * std));

      src = cv.imread(sourceCanvas);
      gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      dark = new cv.Mat();
      cv.threshold(gray, dark, thrBlack, 255, cv.THRESH_BINARY_INV);

      poly = new cv.Mat(h, w, cv.CV_8U);
      const pd = poly.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          pd[i] = searchMask[i] && !isInStickerExclusion(x, y, 10) ? 255 : 0;
        }
      }

      masked = new cv.Mat();
      cv.bitwise_and(dark, poly, masked);

      kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      cv.morphologyEx(masked, masked, cv.MORPH_CLOSE, kernel);
      cv.morphologyEx(masked, masked, cv.MORPH_OPEN, kernel);

      lines = new cv.Mat();
      const minLen = Math.max(20, getAutoMinLineLengthPx());
      cv.HoughLinesP(masked, lines, 1, Math.PI / 180, 18, minLen, 28);
      let best = null;
      const evalLine = (x1, y1, x2, y2, baseWeight = 1.0) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        if (len < minLen) return;

        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        if (isInStickerExclusion(mx, my, 28)) return;
        const edgeD = getEdgeDistance(mx, my);
        if (reliablePolygon && edgeD < 4.0) return;

        const invLen = 1 / Math.max(1, len);
        const nx = -dy * invLen;
        const ny = dx * invLen;

        let darkSamples = 0;
        let samples = 0;
        let contrastPass = 0;
        for (let t = 0; t <= 24; t++) {
          const a = t / 24;
          const sx = Math.round(x1 + dx * a);
          const sy = Math.round(y1 + dy * a);
          if (sx < 2 || sy < 2 || sx >= w - 2 || sy >= h - 2) continue;
          const pi = sy * w + sx;
          if (!searchMask[pi] || isInStickerExclusion(sx, sy, 28)) continue;
          if (reliablePolygon && getEdgeDistance(sx, sy) < 3.5) continue;
          const gCenter = sampleGray(sx, sy);
          samples++;
          if (gCenter <= (thrBlack + 12)) darkSamples++;

          const s1x = Math.round(sx + nx * 3);
          const s1y = Math.round(sy + ny * 3);
          const s2x = Math.round(sx - nx * 3);
          const s2y = Math.round(sy - ny * 3);
          if (s1x < 1 || s1y < 1 || s1x >= w - 1 || s1y >= h - 1) continue;
          if (s2x < 1 || s2y < 1 || s2x >= w - 1 || s2y >= h - 1) continue;
          if (!searchMask[s1y * w + s1x] || !searchMask[s2y * w + s2x]) continue;
          const side = (sampleGray(s1x, s1y) + sampleGray(s2x, s2y)) * 0.5;
          if ((side - gCenter) >= 10) contrastPass++;
        }
        if (samples < 10) return;
        const darkRatio = darkSamples / samples;
        const contrastRatio = contrastPass / samples;
        if (darkRatio < 0.66) return;
        if (contrastRatio < 0.33) return;

        const score = (len * 3.2 + edgeD * 1.2 + darkRatio * 90 + contrastRatio * 70) * baseWeight;
        if (!best || score > best.score) {
          best = { score, p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } };
        }
      };

      if (lines && lines.rows > 0) {
        const v = lines.data32S;
        for (let i = 0; i < lines.rows; i++) {
          evalLine(v[i * 4], v[i * 4 + 1], v[i * 4 + 2], v[i * 4 + 3], 1.0);
        }
      }

      if (!best) {
        blur = new cv.Mat();
        cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
        edges = new cv.Mat();
        cv.Canny(blur, edges, Math.max(18, thrBlack * 0.45), Math.max(48, thrBlack * 0.95), 3, false);
        cv.bitwise_and(edges, poly, edges);

        lines.delete();
        lines = new cv.Mat();
        cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 20, Math.max(minLen, 28), 12);
        if (lines && lines.rows > 0) {
          const vv = lines.data32S;
          for (let i = 0; i < lines.rows; i++) {
            evalLine(vv[i * 4], vv[i * 4 + 1], vv[i * 4 + 2], vv[i * 4 + 3], 0.92);
          }
        }
      }
      return best ? { p1: best.p1, p2: best.p2 } : null;
    } catch (_) {
      return null;
    } finally {
      if (src) src.delete();
      if (gray) gray.delete();
      if (dark) dark.delete();
      if (poly) poly.delete();
      if (masked) masked.delete();
      if (kernel) kernel.delete();
      if (lines) lines.delete();
      if (blur) blur.delete();
      if (edges) edges.delete();
    }
  }

  function detectGlobalBlackMarkerNoMask() {
    const sourceData = sourceDataRef();
    const canvas = canvasRef();
    if (!sourceData || !canvas?.width || !canvas?.height) return null;
    const w = canvas.width;
    const h = canvas.height;
    const size = w * h;
    const raw = new Uint8Array(size);
    const visited = new Uint8Array(size);
    const border = Math.max(12, Math.round(Math.min(w, h) * 0.06));
    const cx = w * 0.5;
    const cy = h * 0.5;

    for (let y = border; y < h - border; y++) {
      const row = y * w;
      for (let x = border; x < w - border; x++) {
        if (isInStickerExclusion(x, y, 20)) continue;
        const i = row + x;
        const p = i * 4;
        const r = sourceData[p];
        const g = sourceData[p + 1];
        const b = sourceData[p + 2];
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        const gray = sampleGray(x, y);
        if (gray <= 98 && spread <= 92) raw[i] = 1;
      }
    }

    const clean = morphErode(morphDilate(raw, w, h, 1), w, h, 1);
    let best = null;
    const minLen = Math.max(42, Math.round(Math.min(w, h) * 0.07));
    const maxLen = Math.max(180, Math.round(Math.min(w, h) * 0.34));
    for (let y = border; y < h - border; y++) {
      for (let x = border; x < w - border; x++) {
        const i = y * w + x;
        if (!clean[i] || visited[i]) continue;
        const comp = bfsMaskComponent(clean, visited, x, y, w, h);
        if (!comp || comp.length < 28 || comp.length > 12000) continue;
        const feat = segmentFeaturesFromComponent(comp, w);
        if (!feat) continue;
        if (feat.lengthPx < minLen) continue;
        if (feat.lengthPx > maxLen) continue;
        if (feat.linearity < 2.1 || feat.ratio < 1.5) continue;
        if (Math.max(feat.bboxW, feat.bboxH) > 420) continue;
        const mx = (feat.p1.x + feat.p2.x) * 0.5;
        const my = (feat.p1.y + feat.p2.y) * 0.5;
        if (isInStickerExclusion(mx, my, 32)) continue;

        let darkCount = 0;
        for (let k = 0; k < comp.length; k++) {
          const idx = comp[k];
          const px = idx % w;
          const py = (idx - px) / w;
          if (sampleGray(px, py) < 122) darkCount++;
        }
        const darkRatio = darkCount / Math.max(1, comp.length);
        if (darkRatio < 0.72) continue;
        const contrast = getStrokeContrastScore(feat.p1, feat.p2, 138);
        if (contrast < 0.12) continue;
        const thickness = comp.length / Math.max(1, feat.lengthPx);
        if (thickness < 2.4 || thickness > 14.5) continue;
        const centerDist = Math.hypot(mx - cx, my - cy);
        const score =
          feat.lengthPx * 6.4 +
          feat.linearity * 8.0 +
          feat.ratio * 4.2 +
          darkRatio * 90 +
          contrast * 70 -
          thickness * 1.7 -
          centerDist * 0.11;
        if (!best || score > best.score) best = { score, feat, comp };
      }
    }
    if (!best) return null;
    setLineMasks(raw, clean, toBinaryMask(best.comp, size));
    setLineMaskInfo({ threshold: 98, mean: 0, std: 0, mode: "global-direct" });
    return { p1: best.feat.p1, p2: best.feat.p2 };
  }

  function detectLastChanceMarkerSegment() {
    const sourceData = sourceDataRef();
    const canvas = canvasRef();
    if (!sourceData || !canvas?.width || !canvas?.height) return null;
    const w = canvas.width;
    const h = canvas.height;
    const size = w * h;
    const raw = new Uint8Array(size);
    const visited = new Uint8Array(size);
    const minX = Math.floor(w * 0.2);
    const maxX = Math.ceil(w * 0.8);
    const minY = Math.floor(h * 0.2);
    const maxY = Math.ceil(h * 0.86);
    const cx = w * 0.5;
    const cy = h * 0.52;

    for (let y = minY; y < maxY; y++) {
      const row = y * w;
      for (let x = minX; x < maxX; x++) {
        if (isInStickerExclusion(x, y, 36)) continue;
        const i = row + x;
        const gray = sampleGray(x, y);
        if (gray <= 110) raw[i] = 1;
      }
    }
    const clean = raw;
    let best = null;
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const i = y * w + x;
        if (!clean[i] || visited[i]) continue;
        const comp = bfsMaskComponent(clean, visited, x, y, w, h);
        if (!comp || comp.length < 30 || comp.length > 30000) continue;
        const feat = segmentFeaturesFromComponent(comp, w);
        if (!feat) continue;
        if (feat.lengthPx < 64 || feat.lengthPx > 500) continue;
        if (feat.ratio < 2.8) continue;
        if (feat.linearity < 3.2) continue;
        const mx = (feat.p1.x + feat.p2.x) * 0.5;
        const my = (feat.p1.y + feat.p2.y) * 0.5;
        if (isInStickerExclusion(mx, my, 32)) continue;

        let darkCount = 0;
        for (let k = 0; k < comp.length; k++) {
          const idx = comp[k];
          const px = idx % w;
          const py = (idx - px) / w;
          if (sampleGray(px, py) < 130) darkCount++;
        }
        const darkRatio = darkCount / Math.max(1, comp.length);
        if (darkRatio < 0.72) continue;
        const contrast = getStrokeContrastScore(feat.p1, feat.p2, 142);
        if (contrast < 0.12) continue;
        const thickness = comp.length / Math.max(1, feat.lengthPx);
        if (thickness < 1.7 || thickness > 16.5) continue;
        const centerDist = Math.hypot(mx - cx, my - cy);
        const score =
          feat.lengthPx * 5.1 +
          feat.linearity * 5.9 +
          feat.ratio * 4.1 +
          darkRatio * 85 +
          contrast * 56 -
          thickness * 1.3 -
          centerDist * 0.05;
        if (!best || score > best.score) best = { score, feat, comp };
      }
    }
    if (!best) return null;
    setLineMasks(raw, clean, toBinaryMask(best.comp, size));
    setLineMaskInfo({ threshold: 110, mean: 0, std: 0, mode: "last-chance" });
    return { p1: best.feat.p1, p2: best.feat.p2 };
  }

  return {
    detectDarkPercentilePcaSegment,
    detectRoiAxisSegment,
    detectThickBlackStrokeSegment,
    detectMezdraMinusQrDominantStroke,
    detectLocalDarkMarkerSegment,
    detectPureBlackStrokeSegment,
    detectMarkerStrokeBlackhatCV,
    detectMarkerStrokeCenterBias,
    detectConstrainedMarkerStroke,
    detectGlobalBlackMarkerNoMask,
    detectLastChanceMarkerSegment,
    detectDirectBlackMarkerSegment,
    detectGlobalMarkerHoughRelaxed,
    detectFastGlobalBlackMarkerHough,
    detectInteriorEdgeHoughSegment,
    detectAnyColorMarkerSegment,
    detectForceEdgeDirectionSegment,
    detectLineSegmentOpenCV
  };
}

