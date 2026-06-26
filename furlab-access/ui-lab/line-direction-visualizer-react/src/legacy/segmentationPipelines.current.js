export function runSegmentationPipeline(input) {
  const {
    pipeline,
    w,
    h,
    size,
    sourceData,
    sampleGray,
    timeoutConfig,
    primitives,
  } = input || {};
  const {
    erodeMask,
    dilateMask,
    floodFillOuterOnTraversable,
    floodFillOuterBackground,
    extractLargestComponent,
    buildEdgeMask,
    computeMaskStats,
    buildDistanceTransform,
    countConnectedComponents,
    hashMask,
  } = primitives || {};
  const startedAt = Date.now();
  const softTimeoutMs = Number(timeoutConfig?.softTimeoutMs || 180);
  const hardTimeoutMs = Number(timeoutConfig?.hardTimeoutMs || 600);
  const activePipeline = pipeline === "v2" || pipeline === "v3" ? pipeline : "v1";
  const contourThreshold = activePipeline === "v3" ? 110 : 120;
  const tonalLow = activePipeline === "v3" ? 118 : 120;
  const tonalHigh = activePipeline === "v3" ? 236 : 230;
  // V3 refine is expensive on 2-4MP scans; we use fast primary + solidify instead.
  const useMezdraRefine = activePipeline === "v2";

  let contourSeed = new Uint8Array(size);
  let fallbackUsed = false;
  let timeoutHit = false;
  let refineApplied = false;
  const qualityFlags = [];

  if (activePipeline === "v3") {
    contourSeed = buildPrimaryMaskV3(w, h, size, sourceData);
    qualityFlags.push("primary_v3_color_tone");
  } else {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const g = sampleGray(x, y);
        if (g < contourThreshold) contourSeed[i] = 1;
      }
    }
  }

  let baseMask = new Uint8Array(size);
  let mode = `contour-${activePipeline}`;

  if (activePipeline === "v3") {
    // V3 primary is a filled mezdra mask; run direct component path.
    const opened = dilateMask(erodeMask(contourSeed, w, h, 1), w, h, 1);
    const visitedV3 = new Uint8Array(size);
    const mainV3 = extractLargestComponent(opened, visitedV3, w, h);
    for (let i = 0; i < mainV3.length; i++) baseMask[mainV3[i]] = 1;
    mode = "primary-v3-direct";
    if (!mainV3.length) {
      const tonalMask = new Uint8Array(size);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          const g = sampleGray(x, y);
          if (g >= tonalLow && g <= tonalHigh) tonalMask[idx] = 1;
        }
      }
      const visitedFallback = new Uint8Array(size);
      const tonalMain = extractLargestComponent(tonalMask, visitedFallback, w, h);
      baseMask = new Uint8Array(size);
      for (let i = 0; i < tonalMain.length; i++) baseMask[tonalMain[i]] = 1;
      mode = `tonal-fallback-${activePipeline}`;
    }
  } else {
    const contourMask = dilateMask(contourSeed, w, h, 1);
    const outerBgMask = new Uint8Array(size);
    floodFillOuterOnTraversable(contourMask, outerBgMask, w, h);
    const insideCandidate = new Uint8Array(size);
    for (let i = 0; i < size; i++) if (!outerBgMask[i]) insideCandidate[i] = 1;

    const visited = new Uint8Array(size);
    const main = extractLargestComponent(insideCandidate, visited, w, h);
    const mainMask = new Uint8Array(size);
    for (let i = 0; i < main.length; i++) mainMask[main[i]] = 1;

    const edgeMask = new Uint8Array(size);
    let edgeCount = 0;
    let polyCount = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!mainMask[i]) continue;
        polyCount++;
        if (
          outerBgMask[i - 1] || outerBgMask[i + 1] ||
          outerBgMask[i - w] || outerBgMask[i + w]
        ) {
          edgeMask[i] = 1;
          edgeCount++;
        }
      }
    }

    baseMask = mainMask;
    if (edgeCount < 20 || polyCount < 200) {
      const tonalMask = new Uint8Array(size);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          const g = sampleGray(x, y);
          if (g >= tonalLow && g <= tonalHigh) tonalMask[idx] = 1;
        }
      }
      const visited2 = new Uint8Array(size);
      const tonalMain = extractLargestComponent(tonalMask, visited2, w, h);
      baseMask = new Uint8Array(size);
      for (let i = 0; i < tonalMain.length; i++) baseMask[tonalMain[i]] = 1;
      mode = `tonal-fallback-${activePipeline}`;
    }
  }

  let finalMask = baseMask;
  if (useMezdraRefine) {
    const refined = refineMezdraMask({
      pipeline: activePipeline,
      mask: baseMask,
      w,
      h,
      sourceData,
      startedAt,
      softTimeoutMs,
      hardTimeoutMs,
      erodeMask,
      dilateMask,
      extractLargestComponent,
      computeMaskStats,
    });
    finalMask = refined.mask;
    fallbackUsed = fallbackUsed || !!refined.fallbackUsed;
    timeoutHit = timeoutHit || !!refined.timeoutHit;
    refineApplied = refineApplied || !!refined.refineApplied;
    if (refined.reason) qualityFlags.push(`refine:${refined.reason}`);
    if (refineApplied) mode = `contour-mezdra-${activePipeline}`;
  }
  // Force a solid piece silhouette for stable line ROI:
  // close gaps, keep largest component, then fill internal holes.
  finalMask = solidifyPieceMask({
    mask: finalMask,
    w,
    h,
    pipeline: activePipeline,
    dilateMask,
    erodeMask,
    extractLargestComponent,
    floodFillOuterBackground,
  });

  const finalOuter = new Uint8Array(size);
  floodFillOuterBackground(finalMask, finalOuter, w, h);
  const finalEdge = buildEdgeMask(finalMask, finalOuter, w, h);
  const st = computeMaskStats(finalMask, w, h);
  const componentCount = countConnectedComponents(finalMask, w, h);
  const processingTimeMs = Date.now() - startedAt;
  timeoutHit = timeoutHit || processingTimeMs > hardTimeoutMs;

  return {
    polygonMask: finalMask,
    outerBgMask: finalOuter,
    edgeDistanceMap: buildDistanceTransform(finalEdge.edgeMask, w, h),
    stats: {
      polygonCount: st.count,
      polygonAreaPx: st.count,
      edgeCount: finalEdge.edgeCount,
      bboxMinX: st.minX,
      bboxMinY: st.minY,
      bboxMaxX: st.maxX,
      bboxMaxY: st.maxY,
      bboxW: st.bboxW,
      bboxH: st.bboxH,
      mode,
      processingTimeMs,
      refineApplied,
      fallbackUsed,
      timeoutHit,
      componentCount,
      maskHash: hashMask(finalMask),
      qualityFlags,
    },
  };
}

function solidifyPieceMask(ctx) {
  const {
    mask,
    w,
    h,
    pipeline,
    dilateMask,
    erodeMask,
    extractLargestComponent,
    floodFillOuterBackground,
  } = ctx || {};
  if (!mask || !w || !h) return mask;
  const size = w * h;
  const minDim = Math.max(1, Math.min(w, h));
  const imageMp = size / 1_000_000;
  // Keep solidify cheap on 2-4MP scans: heavy radii explode latency.
  const closeRadius = pipeline === "v3"
    ? (imageMp >= 2.0 ? 1 : Math.max(1, Math.min(2, Math.round(minDim * 0.004))))
    : (imageMp >= 2.0 ? 1 : Math.max(1, Math.min(2, Math.round(minDim * 0.003))));

  let work = dilateMask(mask, w, h, closeRadius);
  work = erodeMask(work, w, h, closeRadius);

  const visited = new Uint8Array(size);
  const largest = extractLargestComponent(work, visited, w, h);
  if (!largest || !largest.length) return mask;

  const main = new Uint8Array(size);
  for (let i = 0; i < largest.length; i++) main[largest[i]] = 1;

  const outer = new Uint8Array(size);
  floodFillOuterBackground(main, outer, w, h);
  const filled = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    // Everything that is not outer background is inside the piece silhouette.
    filled[i] = outer[i] ? 0 : 1;
  }

  const visited2 = new Uint8Array(size);
  const largest2 = extractLargestComponent(filled, visited2, w, h);
  if (!largest2 || !largest2.length) return main;
  const out = new Uint8Array(size);
  for (let i = 0; i < largest2.length; i++) out[largest2[i]] = 1;
  return out;
}

function refineMezdraMask(ctx) {
  const {
    pipeline,
    mask,
    w,
    h,
    sourceData,
    startedAt,
    softTimeoutMs,
    hardTimeoutMs,
    erodeMask,
    dilateMask,
    extractLargestComponent,
    computeMaskStats,
  } = ctx || {};
  const elapsed = startedAt ? (Date.now() - startedAt) : 0;
  if (elapsed >= hardTimeoutMs) {
    return { mask, refineApplied: false, fallbackUsed: true, timeoutHit: true, reason: "hard_timeout_before_refine" };
  }
  const st = computeMaskStats(mask, w, h);
  if (st.count < 200) return { mask, refineApplied: false, fallbackUsed: false, timeoutHit: false, reason: "too_small" };
  const minDim = Math.max(1, Math.min(st.bboxW, st.bboxH));
  const imageMp = (w * h) / 1_000_000;
  const isV3 = pipeline === "v3";
  if (isV3 && sourceData) {
    const v3 = refineMezdraMaskV3EdgeAware({
      mask,
      w,
      h,
      sourceData,
      startedAt,
      hardTimeoutMs,
      erodeMask,
      dilateMask,
      extractLargestComponent,
      computeMaskStats,
    });
    if (v3.reason) return v3;
  }
  let trimRadius = isV3
    ? Math.max(2, Math.min(7, Math.round(minDim * 0.016)))
    : Math.max(2, Math.min(6, Math.round(minDim * 0.012)));
  if (isV3) {
    if (imageMp >= 2.0) trimRadius = Math.min(trimRadius, 2);
    else if (imageMp >= 1.2) trimRadius = Math.min(trimRadius, 3);
    else trimRadius = Math.min(trimRadius, 4);
  }
  const closeRadius = 1;
  const softCutoff = Math.max(40, Number(softTimeoutMs || 0));

  // Stage 1: opening to cut thin fur spikes.
  let work = dilateMask(erodeMask(mask, w, h, trimRadius), w, h, trimRadius);
  if (startedAt && (Date.now() - startedAt) >= hardTimeoutMs) {
    return { mask, refineApplied: false, fallbackUsed: true, timeoutHit: true, reason: "hard_timeout_after_stage1" };
  }
  // Stage 2: light healing if budget allows.
  if (!isV3 && (!startedAt || (Date.now() - startedAt) < softCutoff)) {
    work = erodeMask(dilateMask(work, w, h, closeRadius), w, h, closeRadius);
  }

  const visited = new Uint8Array(w * h);
  const largest = extractLargestComponent(work, visited, w, h);
  if (!largest.length) return { mask, refineApplied: false, fallbackUsed: true, timeoutHit: false, reason: "empty_after_refine" };
  const out = new Uint8Array(w * h);
  for (let i = 0; i < largest.length; i++) out[largest[i]] = 1;
  const st2 = computeMaskStats(out, w, h);
  const ratio = st2.count / Math.max(1, st.count);
  const minRatio = isV3 ? 0.38 : 0.50;
  if (ratio < minRatio || ratio > 1.03) {
    return { mask, refineApplied: false, fallbackUsed: true, timeoutHit: false, reason: "area_ratio_guard" };
  }
  const elapsedAfter = startedAt ? (Date.now() - startedAt) : 0;
  if (elapsedAfter >= hardTimeoutMs) {
    return { mask, refineApplied: false, fallbackUsed: true, timeoutHit: true, reason: "hard_timeout_after_refine" };
  }
  return { mask: out, refineApplied: true, fallbackUsed: false, timeoutHit: false, reason: "ok" };
}

function refineMezdraMaskV3EdgeAware(ctx) {
  const {
    mask,
    w,
    h,
    sourceData,
    startedAt,
    hardTimeoutMs,
    erodeMask,
    dilateMask,
    extractLargestComponent,
    computeMaskStats,
  } = ctx || {};
  const size = w * h;
  if (!mask || !sourceData || !size) return null;
  if (startedAt && (Date.now() - startedAt) >= hardTimeoutMs) {
    return { mask, refineApplied: false, fallbackUsed: true, timeoutHit: true, reason: "hard_timeout_before_v3_edge_aware" };
  }

  // 1) Strong mezdra seed: interior-only confident core.
  const strongSeedRaw = erodeMask(mask, w, h, Math.max(2, Math.min(4, Math.round(Math.min(w, h) * 0.0035))));
  const visitedSeed = new Uint8Array(size);
  const seedMain = extractLargestComponent(strongSeedRaw, visitedSeed, w, h);
  if (!seedMain.length) return { mask, refineApplied: false, fallbackUsed: true, timeoutHit: false, reason: "v3_seed_empty" };
  let strongSeed = new Uint8Array(size);
  for (let i = 0; i < seedMain.length; i++) strongSeed[seedMain[i]] = 1;

  // 2) Constrained grow: expand seed only inside primary candidate mask.
  const growIters = 3;
  for (let iter = 0; iter < growIters; iter++) {
    const expanded = dilateMask(strongSeed, w, h, 1);
    for (let i = 0; i < size; i++) strongSeed[i] = expanded[i] && mask[i] ? 1 : 0;
    if (startedAt && (Date.now() - startedAt) >= hardTimeoutMs) {
      return { mask, refineApplied: false, fallbackUsed: true, timeoutHit: true, reason: "hard_timeout_v3_constrained_grow" };
    }
  }

  // 3) Border band = outer ring of candidate mask.
  const inner = erodeMask(strongSeed, w, h, 1);
  const borderBand = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    borderBand[i] = strongSeed[i] && !inner[i] ? 1 : 0;
  }

  const gray = buildGrayFromRgba(w, h, sourceData);
  const coreStats = computeGrayStatsOnMask(gray, inner, w, h);
  const varThr = Math.max(16, coreStats.var * 1.10);
  const gradThr = Math.max(8, coreStats.gradMean * 1.15);

  // 4) Edge-aware fringe trim only in border band.
  const out = strongSeed.slice();
  let removed = 0;
  for (let pass = 0; pass < 3; pass++) {
    const toDrop = [];
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        const i = y * w + x;
        if (!borderBand[i] || !out[i]) continue;
        const support = countMaskAround(out, w, h, x, y, 2);
        const localVar = localGrayVariance(gray, w, h, x, y, 2);
        const localGrad = localGrayGradient(gray, w, h, x, y, 1);
      const thin = support <= 11;
      const unstableTex = localVar >= varThr || localGrad >= gradThr;
      if (thin && unstableTex) toDrop.push(i);
      }
    }
    if (!toDrop.length) break;
    for (let k = 0; k < toDrop.length; k++) out[toDrop[k]] = 0;
    removed += toDrop.length;
  }

  const visitedFinal = new Uint8Array(size);
  const finalMain = extractLargestComponent(out, visitedFinal, w, h);
  if (!finalMain.length) return { mask, refineApplied: false, fallbackUsed: true, timeoutHit: false, reason: "v3_empty_after_trim" };
  const finalMask = new Uint8Array(size);
  for (let i = 0; i < finalMain.length; i++) finalMask[finalMain[i]] = 1;
  const noFrameMask = stripFrameTouchingArtifacts(finalMask, w, h);
  if (noFrameMask) {
    finalMask.set(noFrameMask);
  }

  const stBefore = computeMaskStats(mask, w, h);
  const stAfter = computeMaskStats(finalMask, w, h);
  const ratio = stAfter.count / Math.max(1, stBefore.count);
  if (ratio < 0.40 || ratio > 1.05) {
    return { mask, refineApplied: false, fallbackUsed: true, timeoutHit: false, reason: "v3_area_ratio_guard" };
  }
  if (startedAt && (Date.now() - startedAt) >= hardTimeoutMs) {
    return { mask, refineApplied: false, fallbackUsed: true, timeoutHit: true, reason: "hard_timeout_after_v3_trim" };
  }
  return {
    mask: finalMask,
    refineApplied: true,
    fallbackUsed: false,
    timeoutHit: false,
    reason: `v3_edge_aware_ok_removed_${removed}`,
  };
}

function stripFrameTouchingArtifacts(mask, w, h) {
  const size = w * h;
  const visited = new Uint8Array(size);
  let bestNonFrame = null;
  let bestAny = null;

  const bfs = (sx, sy) => {
    const qx = [sx];
    const qy = [sy];
    let head = 0;
    visited[sy * w + sx] = 1;
    const comp = [];
    let touchesFrame = false;
    while (head < qx.length) {
      const x = qx[head];
      const y = qy[head];
      head++;
      const i = y * w + x;
      comp.push(i);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesFrame = true;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (visited[ni] || !mask[ni]) continue;
          visited[ni] = 1;
          qx.push(nx);
          qy.push(ny);
        }
      }
    }
    return { comp, touchesFrame };
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i] || visited[i]) continue;
      const c = bfs(x, y);
      if (!bestAny || c.comp.length > bestAny.comp.length) bestAny = c;
      if (!c.touchesFrame && (!bestNonFrame || c.comp.length > bestNonFrame.comp.length)) {
        bestNonFrame = c;
      }
    }
  }

  const chosen = bestNonFrame || bestAny;
  if (!chosen || !chosen.comp || !chosen.comp.length) return null;
  const out = new Uint8Array(size);
  for (let i = 0; i < chosen.comp.length; i++) out[chosen.comp[i]] = 1;
  return out;
}

function buildPrimaryMaskV3(w, h, size, sourceData) {
  const mask = new Uint8Array(size);
  const d = sourceData;
  if (!d) return mask;
  const profile = estimateMezdraProfile(w, h, d);
  const { r0, g0, b0, l0 } = profile;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = i * 4;
      const r = d[p];
      const g = d[p + 1];
      const b = d[p + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      const dr = r - r0;
      const dg = g - g0;
      const db = b - b0;
      const colorDist2 = dr * dr + dg * dg + db * db;
      const isWarm = (r >= g - 10) && (g >= b - 18);
      const inTone = lum >= Math.max(90, l0 - 30) && lum <= Math.min(232, l0 + 34);
      const lowTextureColor = colorDist2 <= 2400;
      const lowSat = sat <= 72;
      const likelyWhiteFur = lum > Math.min(245, l0 + 30) && sat < 32;
      const likelyDarkBg = lum < Math.max(40, l0 - 58);
      if (inTone && isWarm && lowTextureColor && lowSat && !likelyWhiteFur && !likelyDarkBg) {
        mask[i] = 1;
      }
    }
  }
  return mask;
}

function estimateMezdraProfile(w, h, rgba) {
  const x0 = Math.max(0, Math.floor(w * 0.3));
  const y0 = Math.max(0, Math.floor(h * 0.3));
  const x1 = Math.min(w, Math.ceil(w * 0.7));
  const y1 = Math.min(h, Math.ceil(h * 0.7));
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sl = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * w + x) * 4;
      const r = rgba[p];
      const g = rgba[p + 1];
      const b = rgba[p + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum < 60 || lum > 250) continue;
      sr += r;
      sg += g;
      sb += b;
      sl += lum;
      n++;
    }
  }
  if (!n) return { r0: 170, g0: 160, b0: 145, l0: 160 };
  return {
    r0: sr / n,
    g0: sg / n,
    b0: sb / n,
    l0: sl / n,
  };
}

function buildGrayFromRgba(w, h, rgba) {
  const size = w * h;
  const gray = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const p = i * 4;
    gray[i] = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
  }
  return gray;
}

function countMaskAround(mask, w, h, cx, cy, r) {
  let c = 0;
  for (let yy = cy - r; yy <= cy + r; yy++) {
    for (let xx = cx - r; xx <= cx + r; xx++) {
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      if (mask[yy * w + xx]) c++;
    }
  }
  return c;
}

function localGrayVariance(gray, w, h, cx, cy, r) {
  let n = 0;
  let s = 0;
  let s2 = 0;
  for (let yy = cy - r; yy <= cy + r; yy++) {
    for (let xx = cx - r; xx <= cx + r; xx++) {
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const v = gray[yy * w + xx];
      s += v;
      s2 += v * v;
      n++;
    }
  }
  if (!n) return 0;
  const m = s / n;
  return Math.max(0, s2 / n - m * m);
}

function localGrayGradient(gray, w, h, x, y, r) {
  let sum = 0;
  let n = 0;
  for (let yy = y - r; yy <= y + r; yy++) {
    for (let xx = x - r; xx <= x + r; xx++) {
      if (xx <= 0 || yy <= 0 || xx >= w - 1 || yy >= h - 1) continue;
      const gx = Math.abs(gray[yy * w + (xx + 1)] - gray[yy * w + (xx - 1)]);
      const gy = Math.abs(gray[(yy + 1) * w + xx] - gray[(yy - 1) * w + xx]);
      sum += gx + gy;
      n++;
    }
  }
  return n ? sum / n : 0;
}

function computeGrayStatsOnMask(gray, mask, w, h) {
  let n = 0;
  let s = 0;
  let s2 = 0;
  let gradSum = 0;
  let gradN = 0;
  const len = Math.min(gray.length, mask.length);
  for (let i = 0; i < len; i++) {
    if (!mask[i]) continue;
    const v = gray[i];
    n++;
    s += v;
    s2 += v * v;
  }
  if (!n) return { mean: 0, var: 0, gradMean: 0 };
  const mean = s / n;
  const varv = Math.max(0, s2 / n - mean * mean);
  // Lightweight proxy of core gradient.
  const ww = Math.max(1, Number(w || 0));
  const hh = Math.max(1, Number(h || 0));
  for (let y = 1; y < hh - 1; y += 4) {
    for (let x = 1; x < ww - 1; x += 4) {
      const idx = y * ww + x;
      if (idx >= len || !mask[idx]) continue;
      const gx = Math.abs(gray[idx + 1] - gray[idx - 1]);
      const gy = Math.abs(gray[idx + ww] - gray[idx - ww]);
      gradSum += gx + gy;
      gradN++;
    }
  }
  return { mean, var: varv, gradMean: gradN ? gradSum / gradN : 0 };
}
