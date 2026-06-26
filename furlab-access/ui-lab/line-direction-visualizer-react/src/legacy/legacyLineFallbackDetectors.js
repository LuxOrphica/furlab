export function createLegacyLineFallbackDetectors(deps) {
  const {
    sourceDataRef,
    canvasRef,
    getLineSearchMask,
    isInStickerExclusion,
    getEdgeDistance,
    sampleGray,
    morphErode,
    morphDilate,
    bfsMaskComponent,
    segmentFeaturesFromComponent,
    toBinaryMask,
    detectLineFromBinaryMaskHough,
    getStrokeContrastScore,
    setLineMasks,
    setLineMaskInfo
  } = deps;

  function detectRelaxedDarkLinearSegment(searchMask, w, h) {
    const sourceData = sourceDataRef();
    if (!sourceData || !searchMask) return null;
    const size = w * h;
    const raw = new Uint8Array(size);
    const visited = new Uint8Array(size);
    const maxGray = 106;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!searchMask[i]) continue;
        if (isInStickerExclusion(x, y, 16)) continue;
        const p = i * 4;
        const r = sourceData[p];
        const g = sourceData[p + 1];
        const b = sourceData[p + 2];
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        const gray = sampleGray(x, y);
        if (gray <= maxGray && spread <= 70) raw[i] = 1;
      }
    }

    const clean = morphErode(morphDilate(raw, w, h, 1), w, h, 1);
    let best = null;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!clean[i] || visited[i]) continue;
        const comp = bfsMaskComponent(clean, visited, x, y, w, h);
        if (!comp || comp.length < 18 || comp.length > 9000) continue;
        const feat = segmentFeaturesFromComponent(comp, w);
        if (!feat) continue;
        if (feat.lengthPx < Math.max(34, Math.min(w, h) * 0.045)) continue;
        if (feat.linearity < 2.0 || feat.ratio < 1.5) continue;
        const mx = (feat.p1.x + feat.p2.x) * 0.5;
        const my = (feat.p1.y + feat.p2.y) * 0.5;
        if (isInStickerExclusion(mx, my, 16)) continue;
        const thickness = comp.length / Math.max(1, feat.lengthPx);
        if (thickness > 12) continue;
        const score = feat.lengthPx * 3.8 + feat.linearity * 4.5 + feat.ratio * 3.0 - thickness * 1.2;
        if (!best || score > best.score) best = { score, p1: feat.p1, p2: feat.p2 };
      }
    }
    return best ? { p1: best.p1, p2: best.p2 } : null;
  }

  function detectDominantBlackStrokeGlobal() {
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
    const step = size > 1_800_000 ? 2 : 1;

    let sum = 0;
    let sum2 = 0;
    let cnt = 0;
    for (let y = 2; y < h - 2; y += 2) {
      for (let x = 2; x < w - 2; x += 2) {
        const i = y * w + x;
        if (!searchMask[i]) continue;
        if (isInStickerExclusion(x, y, 16)) continue;
        const g = sampleGray(x, y);
        sum += g;
        sum2 += g * g;
        cnt++;
      }
    }
    const mean = cnt ? (sum / cnt) : 190;
    const variance = cnt ? Math.max(0, sum2 / cnt - mean * mean) : 0;
    const std = Math.sqrt(variance);
    const thr = Math.max(68, Math.min(126, mean - 2.6 * std));
    const minLen = Math.max(26, Math.round(Math.min(w, h) * 0.05));

    for (let y = 1; y < h - 1; y += step) {
      for (let x = 1; x < w - 1; x += step) {
        const i = y * w + x;
        if (!searchMask[i]) continue;
        if (isInStickerExclusion(x, y, 16)) continue;
        const p = i * 4;
        const r = sourceData[p];
        const g = sourceData[p + 1];
        const b = sourceData[p + 2];
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        const gray = sampleGray(x, y);
        if (gray <= thr && spread <= 92) raw[i] = 1;
      }
    }

    const clean = morphErode(morphDilate(raw, w, h, 2), w, h, 1);
    let best = null;
    let bestRelaxed = null;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!clean[i] || visited[i]) continue;
        const comp = bfsMaskComponent(clean, visited, x, y, w, h);
        if (!comp || comp.length < 12 || comp.length > 6000) continue;
        const feat = segmentFeaturesFromComponent(comp, w);
        if (!feat) continue;
        if (feat.lengthPx < minLen) continue;
        if (Math.max(feat.bboxW, feat.bboxH) > 560) continue;

        let darkCount = 0;
        for (let k = 0; k < comp.length; k++) {
          const idx = comp[k];
          const px = idx % w;
          const py = (idx - px) / w;
          if (sampleGray(px, py) <= (thr + 16)) darkCount++;
        }
        const darkRatio = darkCount / Math.max(1, comp.length);
        const contrastScore = getStrokeContrastScore(feat.p1, feat.p2, thr + 8);
        const thickness = comp.length / Math.max(1, feat.lengthPx);
        if (thickness < 0.7 || thickness > 18.5) continue;

        const strictOk =
          feat.ratio >= 1.8 &&
          feat.linearity >= 3.8 &&
          darkRatio >= 0.84 &&
          contrastScore >= 0.32 &&
          thickness <= 9.5 &&
          Math.max(feat.bboxW, feat.bboxH) <= 320;

        const strictScore =
          feat.lengthPx * 5.0 +
          feat.linearity * 7.0 +
          feat.ratio * 5.2 +
          darkRatio * 120 +
          contrastScore * 90 -
          thickness * 2.3;
        if (strictOk) {
          if (!best || strictScore > best.score) best = { score: strictScore, feat, comp };
          continue;
        }

        // Relaxed branch for thick marker strokes on uneven mezdra texture.
        if (feat.ratio < 1.35 || feat.linearity < 1.45) continue;
        if (darkRatio < 0.56) continue;
        if (contrastScore < 0.03) continue;
        const relaxedScore =
          feat.lengthPx * 3.6 +
          feat.linearity * 3.2 +
          feat.ratio * 2.8 +
          darkRatio * 78 +
          contrastScore * 42 -
          thickness * 1.1;
        if (!bestRelaxed || relaxedScore > bestRelaxed.score) {
          bestRelaxed = { score: relaxedScore, feat, comp };
        }
      }
    }
    if (!best && bestRelaxed) {
      setLineMasks(raw, clean, toBinaryMask(bestRelaxed.comp, size));
      setLineMaskInfo({ threshold: thr, mean, std, mode: "global-fallback-relaxed-component" });
      return { p1: bestRelaxed.feat.p1, p2: bestRelaxed.feat.p2 };
    }
    if (!best) {
      const houghSeg = detectLineFromBinaryMaskHough(clean, w, h);
      if (houghSeg) {
        setLineMasks(raw, clean, clean);
        setLineMaskInfo({ threshold: thr, mean, std, mode: "global-fallback-hough" });
        return houghSeg;
      }
      const relaxedSeg = detectRelaxedDarkLinearSegment(searchMask, w, h);
      if (relaxedSeg) {
        setLineMasks(raw, clean, clean);
        setLineMaskInfo({ threshold: thr, mean, std, mode: "global-fallback-relaxed" });
        return relaxedSeg;
      }
      return null;
    }
    setLineMasks(raw, clean, toBinaryMask(best.comp, size));
    setLineMaskInfo({ threshold: thr, mean, std, mode: "global-fallback" });
    return { p1: best.feat.p1, p2: best.feat.p2 };
  }

  return {
    detectDominantBlackStrokeGlobal
  };
}
