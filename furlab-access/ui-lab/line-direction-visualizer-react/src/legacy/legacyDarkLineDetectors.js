export function createLegacyDarkLineDetectors(deps) {
  const {
    sourceDataRef,
    polygonMaskRef,
    edgeDistanceMapRef,
    canvasRef,
    isInStickerExclusion,
    getEdgeDistance,
    sampleGray,
    morphErode,
    morphDilate,
    bfsMaskComponent,
    segmentFeaturesFromComponent,
    toBinaryMask,
    detectLineFromBinaryMaskHough,
    segmentFromMaskLongestComponent,
    refineSegmentToStroke,
    setLineMasks,
    setLineMaskInfo,
    setLineRejectStats
  } = deps;

  function detectDarkLineSegment() {
    const sourceData = sourceDataRef();
    const polygonMask = polygonMaskRef();
    const edgeDistanceMap = edgeDistanceMapRef();
    const canvas = canvasRef();
    if (!sourceData || !polygonMask || !edgeDistanceMap || !canvas?.width || !canvas?.height) return null;
    const w = canvas.width;
    const h = canvas.height;
    const size = w * h;
    const minCompPx = 4;
    const maxCompPx = 3500;
    const rawMask = new Uint8Array(size);
    const visited = new Uint8Array(size);

    let lineMaskInfo = null;
    let lineRejectStats = {
      compsTotal: 0,
      compsAreaReject: 0,
      compsTooBig: 0,
      compsSticker: 0,
      compsFeatureReject: 0,
      compsPrimaryPass: 0,
      compsPrimaryFail: 0,
      compsRelaxedPass: 0,
      compsRelaxedFail: 0,
      compsEmergencyPass: 0,
      compsEmergencyFail: 0
    };

    let sum = 0;
    let sum2 = 0;
    let cnt = 0;
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        const i = y * w + x;
        if (!polygonMask[i]) continue;
        if (isInStickerExclusion(x, y, 8)) continue;
        const d = getEdgeDistance(x, y);
        if (d < 4) continue;
        const g = sampleGray(x, y);
        sum += g;
        sum2 += g * g;
        cnt++;
      }
    }
    const mean = cnt ? sum / cnt : 180;
    const variance = cnt ? Math.max(0, sum2 / cnt - mean * mean) : 0;
    const std = Math.sqrt(variance);
    const thr = Math.max(70, Math.min(185, mean - 1.0 * std));
    lineMaskInfo = { threshold: thr, mean, std };

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!polygonMask[i]) continue;
        if (isInStickerExclusion(x, y, 8)) continue;
        const g = sampleGray(x, y);
        const d = getEdgeDistance(x, y);
        if (g < thr && d > 2.5) rawMask[i] = 1;
      }
    }

    const maskClosed = morphErode(morphDilate(rawMask, w, h, 1), w, h, 1);
    const mask = morphDilate(maskClosed, w, h, 1);

    let best = null;
    let relaxed = null;
    let emergency = null;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!mask[i] || visited[i]) continue;
        const comp = bfsMaskComponent(mask, visited, x, y, w, h);
        if (!comp) continue;
        lineRejectStats.compsTotal++;
        if (comp.length < minCompPx || comp.length > maxCompPx) {
          lineRejectStats.compsAreaReject++;
          continue;
        }

        const feat = segmentFeaturesFromComponent(comp, w);
        if (!feat) {
          lineRejectStats.compsFeatureReject++;
          continue;
        }

        if (Math.max(feat.bboxW, feat.bboxH) > 220) {
          lineRejectStats.compsTooBig++;
          continue;
        }
        if (isInStickerExclusion((feat.p1.x + feat.p2.x) / 2, (feat.p1.y + feat.p2.y) / 2, 16)) {
          lineRejectStats.compsSticker++;
          continue;
        }

        let nearEdge = 0;
        let edgeSum = 0;
        for (let k = 0; k < comp.length; k++) {
          const idx = comp[k];
          const px = idx % w;
          const py = (idx - px) / w;
          const d = getEdgeDistance(px, py);
          edgeSum += d;
          if (d < 7) nearEdge++;
        }
        const meanEdgeDist = edgeSum / comp.length;

        const primaryPass = feat.ratio >= 1.35 && feat.linearity >= 2.2 && feat.lengthPx >= 12;
        const relaxedPass = feat.lengthPx >= 9 && feat.linearity >= 1.6 && feat.ratio >= 1.15;
        const emergencyPass = feat.lengthPx >= 6;

        if (primaryPass) lineRejectStats.compsPrimaryPass++;
        else lineRejectStats.compsPrimaryFail++;
        if (relaxedPass) lineRejectStats.compsRelaxedPass++;
        else lineRejectStats.compsRelaxedFail++;
        if (emergencyPass) lineRejectStats.compsEmergencyPass++;
        else lineRejectStats.compsEmergencyFail++;

        const score =
          feat.lengthPx * 2.8 +
          feat.linearity * 5.5 +
          feat.ratio * 7.0 +
          meanEdgeDist * 1.3 -
          feat.fillRatio * 14.0;

        if (primaryPass && (!best || score > best.score)) {
          best = { score, p1: feat.p1, p2: feat.p2, feat, comp };
        }
        if (!relaxed || score > relaxed.score) {
          relaxed = { score, p1: feat.p1, p2: feat.p2, feat, comp };
        }

        const emergencyScore = feat.lengthPx * 3 + meanEdgeDist;
        if (
          (!emergency || emergencyScore > emergency.score) &&
          feat.lengthPx >= 6 &&
          Math.max(feat.bboxW, feat.bboxH) <= 220
        ) {
          emergency = { score: emergencyScore, p1: feat.p1, p2: feat.p2, feat, comp };
        }
      }
    }

    if (best) {
      setLineMasks(rawMask, mask, toBinaryMask(best.comp, size));
      lineRejectStats.selectedBy = "primary";
      setLineRejectStats(lineRejectStats);
      setLineMaskInfo(lineMaskInfo);
      return { p1: best.p1, p2: best.p2 };
    }
    if (relaxed && relaxed.feat.lengthPx >= 9 && relaxed.feat.linearity >= 1.6 && relaxed.feat.ratio >= 1.15) {
      setLineMasks(rawMask, mask, toBinaryMask(relaxed.comp, size));
      lineRejectStats.selectedBy = "relaxed";
      setLineRejectStats(lineRejectStats);
      setLineMaskInfo(lineMaskInfo);
      return { p1: relaxed.p1, p2: relaxed.p2 };
    }
    if (emergency) {
      setLineMasks(rawMask, mask, toBinaryMask(emergency.comp, size));
      lineRejectStats.selectedBy = "emergency";
      setLineRejectStats(lineRejectStats);
      setLineMaskInfo(lineMaskInfo);
      return { p1: emergency.p1, p2: emergency.p2 };
    }
    const ultimate = segmentFromMaskLongestComponent(mask, w, h);
    if (ultimate) {
      setLineMasks(rawMask, mask, mask);
      lineRejectStats.selectedBy = "ultimate";
      setLineRejectStats(lineRejectStats);
      setLineMaskInfo(lineMaskInfo);
      return { p1: ultimate.p1, p2: ultimate.p2 };
    }
    lineRejectStats.selectedBy = "none";
    setLineMasks(rawMask, mask, null);
    setLineRejectStats(lineRejectStats);
    setLineMaskInfo(lineMaskInfo);
    return null;
  }

  function detectDarkLineSegmentPrototype() {
    const sourceData = sourceDataRef();
    const polygonMask = polygonMaskRef();
    const edgeDistanceMap = edgeDistanceMapRef();
    const canvas = canvasRef();
    if (!sourceData || !polygonMask || !edgeDistanceMap || !canvas?.width || !canvas?.height) return null;
    const w = canvas.width;
    const h = canvas.height;
    const size = w * h;
    const rawMask = new Uint8Array(size);
    const stride = (w * h > 1_200_000) ? 2 : 1;

    let sum = 0;
    let sum2 = 0;
    let cnt = 0;
    for (let y = 2; y < h - 2; y += stride) {
      for (let x = 2; x < w - 2; x += stride) {
        const i = y * w + x;
        if (!polygonMask[i]) continue;
        if (isInStickerExclusion(x, y, 14)) continue;
        const d = getEdgeDistance(x, y);
        if (d < 3.0) continue;
        const g = sampleGray(x, y);
        sum += g;
        sum2 += g * g;
        cnt++;
      }
    }
    const mean = cnt ? sum / cnt : 175;
    const variance = cnt ? Math.max(0, sum2 / cnt - mean * mean) : 0;
    const std = Math.sqrt(variance);
    const thr = Math.max(72, Math.min(172, mean - 1.05 * std));
    for (let y = 1; y < h - 1; y += stride) {
      for (let x = 1; x < w - 1; x += stride) {
        const i = y * w + x;
        if (!polygonMask[i]) continue;
        if (isInStickerExclusion(x, y, 14)) continue;
        const d = getEdgeDistance(x, y);
        if (d <= 1.4) continue;
        const idx4 = i * 4;
        const r = sourceData[idx4];
        const gCh = sourceData[idx4 + 1];
        const b = sourceData[idx4 + 2];
        const spread = Math.max(r, gCh, b) - Math.min(r, gCh, b);
        const gray = sampleGray(x, y);
        if (gray < thr && spread <= 64) rawMask[i] = 1;
      }
    }

    const clean = morphErode(morphDilate(rawMask, w, h, 1), w, h, 1);

    const visited = new Uint8Array(size);
    const minLen = Math.max(16, 0.028 * Math.min(w, h));
    let best = null;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!clean[i] || visited[i]) continue;
        const comp = bfsMaskComponent(clean, visited, x, y, w, h);
        if (!comp || comp.length < 5 || comp.length > 20000) continue;
        const feat = segmentFeaturesFromComponent(comp, w);
        if (!feat) continue;
        if (feat.lengthPx < minLen) continue;
        if (feat.ratio < 1.0 || feat.linearity < 1.0) continue;

        const mx = (feat.p1.x + feat.p2.x) / 2;
        const my = (feat.p1.y + feat.p2.y) / 2;
        if (isInStickerExclusion(mx, my, 14)) continue;

        const thickness = comp.length / Math.max(1, feat.lengthPx);
        if (thickness < 0.6 || thickness > 30) continue;

        let graySum = 0;
        let edgeSum = 0;
        let veryDark = 0;
        for (let k = 0; k < comp.length; k++) {
          const idx = comp[k];
          const px = idx % w;
          const py = (idx - px) / w;
          graySum += sampleGray(px, py);
          edgeSum += getEdgeDistance(px, py);
          if (sampleGray(px, py) < 120) veryDark++;
        }
        const meanGray = graySum / comp.length;
        const meanEdgeDist = edgeSum / comp.length;
        const darkRatio = veryDark / Math.max(1, comp.length);
        if (meanGray > 190 || darkRatio < 0.1) continue;

        const score =
          feat.lengthPx * 5.5 +
          feat.linearity * 2.8 +
          feat.ratio * 2.2 +
          (200 - meanGray) * 1.3 +
          Math.min(24, meanEdgeDist) * 1.1 +
          Math.min(8, thickness) * 0.3 +
          darkRatio * 120;
        if (!best || score > best.score) {
          best = { score, p1: feat.p1, p2: feat.p2, comp };
        }
      }
    }

    let seg = best ? { p1: best.p1, p2: best.p2 } : null;
    if (!seg) seg = detectLineFromBinaryMaskHough(clean, w, h);
    if (!seg) {
      const veryDarkMask = new Uint8Array(size);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!polygonMask[i]) continue;
          if (isInStickerExclusion(x, y, 14)) continue;
          if (getEdgeDistance(x, y) <= 2.0) continue;
          if (sampleGray(x, y) < 100) veryDarkMask[i] = 1;
        }
      }
      const alt = segmentFromMaskLongestComponent(veryDarkMask, w, h);
      if (alt) seg = alt;
    }
    if (seg) {
      const orig = seg;
      const origLen = Math.hypot(orig.p2.x - orig.p1.x, orig.p2.y - orig.p1.y);
      const refined = refineSegmentToStroke(seg.p1, seg.p2);
      if (refined) {
        const refLen = Math.hypot(refined.p2.x - refined.p1.x, refined.p2.y - refined.p1.y);
        seg = (refLen >= Math.max(18, origLen * 0.65)) ? refined : orig;
      }
    }
    if (!seg) return null;

    setLineMasks(rawMask, clean, best ? toBinaryMask(best.comp, size) : clean);
    setLineMaskInfo({ threshold: thr, mean, std, mode: "prototype" });
    return seg;
  }

  return {
    detectDarkLineSegment,
    detectDarkLineSegmentPrototype
  };
}
