export function createLegacyLineLowLevel(deps) {
  const {
    sourceDataRef,
    canvasRef,
    polygonMaskRef,
    isInStickerExclusion,
    getEdgeDistance,
    sampleGray,
    lineMaskInfoRef,
    bfsMaskComponent,
    segmentFeaturesFromComponent,
    isCvReady,
    cvRef
  } = deps;

  function getStrokeSideBrightnessStats(p1, p2) {
    const sourceData = sourceDataRef();
    const canvas = canvasRef();
    if (!p1 || !p2 || !sourceData || !canvas) return null;
    const w = canvas.width;
    const h = canvas.height;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return null;
    const nx = -dy / len;
    const ny = dx / len;
    const offs = [5, 8];
    let aSum = 0;
    let bSum = 0;
    let n = 0;
    for (let t = 2; t <= 9; t++) {
      const a = t / 11;
      const cx = p1.x + dx * a;
      const cy = p1.y + dy * a;
      for (let i = 0; i < offs.length; i++) {
        const off = offs[i];
        const ax = Math.round(cx + nx * off);
        const ay = Math.round(cy + ny * off);
        const bx = Math.round(cx - nx * off);
        const by = Math.round(cy - ny * off);
        if (ax < 1 || ay < 1 || bx < 1 || by < 1 || ax >= w - 1 || ay >= h - 1 || bx >= w - 1 || by >= h - 1) continue;
        aSum += sampleGray(ax, ay);
        bSum += sampleGray(bx, by);
        n++;
      }
    }
    if (!n) return null;
    const aMean = aSum / n;
    const bMean = bSum / n;
    return {
      sideMean: (aMean + bMean) * 0.5,
      sideMin: Math.min(aMean, bMean),
      sideDelta: Math.abs(aMean - bMean)
    };
  }

  function toBinaryMaskFromMat(mat) {
    if (!mat || !mat.data || !mat.cols || !mat.rows) return null;
    const out = new Uint8Array(mat.cols * mat.rows);
    const d = mat.data;
    for (let i = 0; i < out.length; i++) out[i] = d[i] > 0 ? 1 : 0;
    return out;
  }

  function detectLineFromBinaryMaskHough(mask, w, h) {
    const cv = cvRef?.();
    if (!mask || !w || !h || !isCvReady?.() || !cv) return null;
    let m = null;
    let lines = null;
    try {
      m = new cv.Mat(h, w, cv.CV_8U);
      const md = m.data;
      for (let i = 0; i < md.length; i++) md[i] = mask[i] ? 255 : 0;
      lines = new cv.Mat();
      cv.HoughLinesP(m, lines, 1, Math.PI / 180, 10, 20, 10);
      if (!lines || lines.rows < 1) return null;
      const v = lines.data32S;
      let best = null;
      for (let i = 0; i < lines.rows; i++) {
        const x1 = v[i * 4];
        const y1 = v[i * 4 + 1];
        const x2 = v[i * 4 + 2];
        const y2 = v[i * 4 + 3];
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < 20) continue;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        if (isInStickerExclusion(mx, my, 14)) continue;
        const dRaw = getEdgeDistance(mx, my);
        const d = Number.isFinite(dRaw) ? dRaw : 8;
        if (d < 1.2) continue;
        const score = len + d * 0.8;
        if (!best || score > best.score) {
          best = { score, p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } };
        }
      }
      return best ? { p1: best.p1, p2: best.p2 } : null;
    } catch (_) {
      return null;
    } finally {
      if (m) m.delete();
      if (lines) lines.delete();
    }
  }

  function endpointsByPca(points) {
    if (!points || points.length < 2) return null;
    let mx = 0;
    let my = 0;
    for (let i = 0; i < points.length; i++) {
      mx += points[i].x;
      my += points[i].y;
    }
    mx /= points.length;
    my /= points.length;

    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < points.length; i++) {
      const dx = points[i].x - mx;
      const dy = points[i].y - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    const tr = sxx + syy;
    const det = sxx * syy - sxy * sxy;
    const disc = Math.max(0, tr * tr - 4 * det);
    const l1 = (tr + Math.sqrt(disc)) / 2;

    let vx = 1;
    let vy = 0;
    if (Math.abs(sxy) > 1e-6 || Math.abs(sxx - l1) > 1e-6) {
      vx = sxy;
      vy = l1 - sxx;
      const nm = Math.hypot(vx, vy);
      if (nm > 1e-6) {
        vx /= nm;
        vy /= nm;
      }
    }

    let minT = Infinity;
    let maxT = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const t = (p.x - mx) * vx + (p.y - my) * vy;
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
    if (!Number.isFinite(minT) || !Number.isFinite(maxT)) return null;

    const p1 = { x: mx + vx * minT, y: my + vy * minT };
    const p2 = { x: mx + vx * maxT, y: my + vy * maxT };
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 6) return null;
    return { p1, p2 };
  }

  function farthestPairOnComponent(comp, w) {
    if (!comp || comp.length < 2) return null;
    const pts = new Array(comp.length);
    for (let i = 0; i < comp.length; i++) {
      const idx = comp[i];
      const x = idx % w;
      const y = (idx - x) / w;
      pts[i] = { x, y };
    }
    let bestA = pts[0];
    let bestB = pts[1];
    let bestD2 = -1;
    const stride = pts.length > 1200 ? 2 : 1;
    for (let i = 0; i < pts.length; i += stride) {
      const a = pts[i];
      for (let j = i + stride; j < pts.length; j += stride) {
        const b = pts[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > bestD2) {
          bestD2 = d2;
          bestA = a;
          bestB = b;
        }
      }
    }
    if (bestD2 < 36) return null;
    return { p1: { x: bestA.x, y: bestA.y }, p2: { x: bestB.x, y: bestB.y } };
  }

  function segmentFromMaskLongestComponent(mask, w, h) {
    if (!mask || !w || !h) return null;
    const visited = new Uint8Array(w * h);
    let bestComp = null;
    let bestLen = 0;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!mask[i] || visited[i]) continue;
        const comp = bfsMaskComponent(mask, visited, x, y, w, h);
        if (!comp || comp.length < 4) continue;
        const feat = segmentFeaturesFromComponent(comp, w);
        if (!feat || feat.lengthPx < 6) continue;
        const mx = (feat.p1.x + feat.p2.x) / 2;
        const my = (feat.p1.y + feat.p2.y) / 2;
        if (isInStickerExclusion(mx, my, 8)) continue;
        if (feat.lengthPx > bestLen) {
          bestLen = feat.lengthPx;
          bestComp = comp;
        }
      }
    }
    if (!bestComp) return null;
    const pts = new Array(bestComp.length);
    for (let i = 0; i < bestComp.length; i++) {
      const idx = bestComp[i];
      const x = idx % w;
      const y = (idx - x) / w;
      pts[i] = { x, y };
    }
    return endpointsByPca(pts) || farthestPairOnComponent(bestComp, w);
  }

  function refineSegmentToStroke(p1, p2) {
    const sourceData = sourceDataRef();
    const polygonMask = polygonMaskRef();
    const canvas = canvasRef();
    const lineMaskInfo = lineMaskInfoRef?.();
    if (!p1 || !p2 || !sourceData || !polygonMask || !canvas?.width || !canvas?.height) return { p1, p2 };
    const w = canvas.width;
    const h = canvas.height;
    let vx = p2.x - p1.x;
    let vy = p2.y - p1.y;
    const len = Math.hypot(vx, vy);
    if (len < 1e-6) return { p1, p2 };
    vx /= len;
    vy /= len;

    const cx = (p1.x + p2.x) / 2;
    const cy = (p1.y + p2.y) / 2;
    const darkThr = Math.min(210, (lineMaskInfo?.threshold ?? 170) + 30);
    const maxT = Math.max(w, h);
    const step = 0.5;
    const missLimit = 10;

    const nx = -vy;
    const ny = vx;

    function hasDarkStrokeAt(x, y) {
      let darkHits = 0;
      let samples = 0;
      for (let s = -2; s <= 2; s++) {
        const sx = Math.round(x + nx * s);
        const sy = Math.round(y + ny * s);
        if (sx < 1 || sy < 1 || sx >= w - 1 || sy >= h - 1) continue;
        const idx = sy * w + sx;
        if (!polygonMask[idx] || isInStickerExclusion(sx, sy, 6)) continue;
        samples++;
        const g = sampleGray(sx, sy);
        const d = getEdgeDistance(sx, sy);
        if (g <= darkThr && d > 1.2) darkHits++;
      }
      return samples >= 3 && darkHits >= 2;
    }

    function probe(sign) {
      let lastX = cx;
      let lastY = cy;
      let miss = 0;
      for (let t = 0; t <= maxT; t += step) {
        const x = cx + vx * t * sign;
        const y = cy + vy * t * sign;
        const ix = Math.round(x);
        const iy = Math.round(y);
        if (ix < 1 || iy < 1 || ix >= w - 1 || iy >= h - 1) break;
        if (hasDarkStrokeAt(x, y)) {
          lastX = x;
          lastY = y;
          miss = 0;
        } else {
          miss++;
          if (miss > missLimit) break;
        }
      }
      return { x: lastX, y: lastY };
    }

    const a = probe(-1);
    const b = probe(1);
    let newLen = Math.hypot(b.x - a.x, b.y - a.y);

    if (newLen < 8) {
      const pts = [];
      const tHalf = Math.max(20, len * 6);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = y * w + x;
          if (!polygonMask[idx] || isInStickerExclusion(x, y, 6)) continue;
          const dx = x - cx;
          const dy = y - cy;
          const t = dx * vx + dy * vy;
          if (Math.abs(t) > tHalf) continue;
          const off = Math.abs(dx * nx + dy * ny);
          if (off > 3.5) continue;
          const g = sampleGray(x, y);
          if (g > darkThr) continue;
          if (getEdgeDistance(x, y) <= 1.2) continue;
          pts.push({ x, y, t });
        }
      }
      if (pts.length >= 8) {
        let minT = pts[0];
        let maxT = pts[0];
        for (let i = 1; i < pts.length; i++) {
          if (pts[i].t < minT.t) minT = pts[i];
          if (pts[i].t > maxT.t) maxT = pts[i];
        }
        a.x = minT.x; a.y = minT.y;
        b.x = maxT.x; b.y = maxT.y;
        newLen = Math.hypot(b.x - a.x, b.y - a.y);
      }
    }

    if (newLen < 4) return { p1, p2 };
    return { p1: a, p2: b };
  }

  return {
    getStrokeSideBrightnessStats,
    toBinaryMaskFromMat,
    detectLineFromBinaryMaskHough,
    segmentFromMaskLongestComponent,
    refineSegmentToStroke
  };
}
