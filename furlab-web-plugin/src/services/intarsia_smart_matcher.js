"use strict";

const INTARSIA_SMART_WEIGHTS = Object.freeze({
  coverageRatio: 0.24,
  insideRatio: 0.34,
  wasteRatio: 0.16,
  hiddenOverlapRisk: 0.12,
  shapeMismatch: 0.06,
  rotationPenalty: 0.03,
  scarcityPenalty: 0.05
});

function convexHull(points) {
  const pts = (Array.isArray(points) ? points : [])
    .map((p) => ({ x: Number(p && p.x), y: Number(p && p.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length <= 3) return pts;
  pts.sort((a, b) => (a.x - b.x) || (a.y - b.y));
  function cross(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function countContourBreaks(points) {
  const pts = Array.isArray(points) ? points : [];
  if (pts.length < 4) return 0;
  let breaks = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length];
    const b = pts[i];
    const c = pts[(i + 1) % pts.length];
    const ux = a.x - b.x;
    const uy = a.y - b.y;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    const du = Math.hypot(ux, uy);
    const dv = Math.hypot(vx, vy);
    if (du <= 1e-9 || dv <= 1e-9) continue;
    const cosA = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (du * dv)));
    const angleDeg = Math.acos(cosA) * 180 / Math.PI;
    if (angleDeg < 155) breaks += 1;
  }
  return breaks;
}

function classParams(className) {
  if (className === "internal") {
    return { insideTarget: 0.9, minCoverage: 0.75, minRect: 0.55, classAffinityWeight: 0.16 };
  }
  if (className === "edge") {
    return { insideTarget: 0.75, minCoverage: 0.62, minRect: 0.25, classAffinityWeight: 0.14 };
  }
  if (className === "corner") {
    return { insideTarget: 0.68, minCoverage: 0.55, minRect: 0.12, classAffinityWeight: 0.14 };
  }
  return { insideTarget: 0.6, minCoverage: 0.45, minRect: 0.0, classAffinityWeight: 0.1 };
}

function classifyFragmentType(fragment, zoneBBox, { polygonBBox, polygonArea }) {
  const bb = polygonBBox(fragment.points || []) || { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  const area = Math.max(1e-9, Number(fragment.areaMm2 || polygonArea(fragment.points || [])));
  const bbArea = Math.max(1e-9, bb.width * bb.height);
  const rectangularity = Math.max(0, Math.min(1, area / bbArea));
  const hull = convexHull(fragment.points || []);
  const hullArea = Math.max(1e-9, polygonArea(hull));
  const convexity = Math.max(0, Math.min(1, area / hullArea));
  const edgeTol = Math.max(4, Math.min(18, Math.min(zoneBBox.width, zoneBBox.height) * 0.015));
  let edgeContacts = 0;
  if (Math.abs(bb.minX - zoneBBox.minX) <= edgeTol) edgeContacts += 1;
  if (Math.abs(bb.maxX - zoneBBox.maxX) <= edgeTol) edgeContacts += 1;
  if (Math.abs(bb.minY - zoneBBox.minY) <= edgeTol) edgeContacts += 1;
  if (Math.abs(bb.maxY - zoneBBox.maxY) <= edgeTol) edgeContacts += 1;
  const minSpan = Math.max(0, Math.min(bb.width, bb.height));
  const breakCount = countContourBreaks(fragment.points || []);
  let cls = "internal";
  if (minSpan < 70 || area < 5000 || rectangularity < 0.35) cls = "low_priority";
  else if (edgeContacts >= 2) cls = "corner";
  else if (edgeContacts === 1) cls = "edge";
  return {
    className: cls,
    bbox: bb,
    rectangularity,
    convexity,
    edgeContacts,
    breakCount,
    minSpan
  };
}

function candidateShapeDescriptors(candidate) {
  const contour = Array.isArray(candidate && candidate.__scrapContourPoints) ? candidate.__scrapContourPoints : [];
  const bb = contour.length >= 3
    ? {
      minX: Math.min(...contour.map((p) => p.x)),
      minY: Math.min(...contour.map((p) => p.y)),
      maxX: Math.max(...contour.map((p) => p.x)),
      maxY: Math.max(...contour.map((p) => p.y)),
      width: Math.max(...contour.map((p) => p.x)) - Math.min(...contour.map((p) => p.x)),
      height: Math.max(...contour.map((p) => p.y)) - Math.min(...contour.map((p) => p.y))
    }
    : null;
  const area = Number(candidate && candidate.areaMm2 || 0);
  const bbArea = bb ? Math.max(1e-9, bb.width * bb.height) : 1;
  const rectangularity = Math.max(0, Math.min(1, area / bbArea));
  const breakCount = contour.length >= 3 ? countContourBreaks(contour) : 0;
  const complexity = Math.max(0, Math.min(1, (1 - rectangularity) * 0.7 + Math.min(1, breakCount / 14) * 0.3));
  return {
    bbox: bb || { width: Number(candidate && candidate.bboxWidthMm || 0), height: Number(candidate && candidate.bboxHeightMm || 0) },
    rectangularity,
    complexity
  };
}

function fragmentDifficultyScore(desc) {
  const concavityPenalty = 1 - desc.convexity;
  const edgeContactRatio = Math.max(0, Math.min(1, desc.edgeContacts / 4));
  const aspect = Math.max(desc.bbox.width, desc.bbox.height) / Math.max(1, Math.min(desc.bbox.width || 1, desc.bbox.height || 1));
  const aspectPenalty = Math.max(0, Math.min(1, (aspect - 1) / 4));
  const smallSizePenalty = desc.minSpan < 120 ? (1 - Math.max(0, desc.minSpan) / 120) : 0;
  const asymmetryPenalty = Math.max(0, Math.min(1, desc.breakCount / 12));
  return (
    0.28 * concavityPenalty +
    0.26 * edgeContactRatio +
    0.14 * aspectPenalty +
    0.20 * smallSizePenalty +
    0.12 * asymmetryPenalty
  );
}

function scoreSmartFragmentCandidate(fragmentMeta, candidate, fit, scarcityMap, opts) {
  const classCfg = classParams(fragmentMeta.className);
  const options = opts && typeof opts === "object" ? opts : {};
  const regularQualityTune = options.regularQualityTune === true;
  const w = regularQualityTune
    ? {
      coverageRatio: 0.18,
      insideRatio: 0.46,
      wasteRatio: 0.18,
      hiddenOverlapRisk: 0.18,
      shapeMismatch: 0.04,
      rotationPenalty: 0.02,
      scarcityPenalty: 0.03
    }
    : INTARSIA_SMART_WEIGHTS;
  const candidateDesc = candidateShapeDescriptors(candidate);
  const coverageRatio = Math.max(0, Math.min(1.25, Number(fit && fit.coverageRatio || 0)));
  const insideRatio = Math.max(0, Math.min(1, Number(fit && fit.insidePercent || 0) / 100));
  const overlapApprox = Math.max(0, Math.min(1, Number(fit && fit.overlapApprox || 0)));
  const wasteRatio = Math.max(0, 1 - overlapApprox);
  const outsideProxy = Math.max(0, 1 - insideRatio);
  // For regular intarsia, outside spill is the main quality loss; penalize it stronger than raw overlap.
  const hiddenOverlapRisk = Math.max(0, Math.min(1, outsideProxy * 0.75 + (1 - overlapApprox) * 0.25));
  const shapeMismatch = Math.max(0, Math.min(1, Math.abs(candidateDesc.rectangularity - fragmentMeta.rectangularity)));
  const rotationPenalty = Math.max(0, Math.min(1, Math.abs(Number(fit && fit.rotationDeg || 0)) / 180));
  const scarcityPenalty = Number(scarcityMap.get(String(candidate && candidate.inventoryTag || candidate && candidate.id || "")) || 0);
  const classAffinity = (() => {
    if (fragmentMeta.className === "internal") return 1 - candidateDesc.complexity;
    if (fragmentMeta.className === "edge" || fragmentMeta.className === "corner") return candidateDesc.complexity;
    return 0.5;
  })();
  const lowInsidePenalty = regularQualityTune
    ? Math.max(0, Math.min(1, Number(classCfg.insideTarget || 0.7) - insideRatio))
    : 0;
  const outsidePenaltyBoost = regularQualityTune
    ? Math.max(0, Math.min(1, outsideProxy - 0.55))
    : 0;
  const score =
    w.coverageRatio * coverageRatio +
    w.insideRatio * insideRatio -
    w.wasteRatio * wasteRatio -
    w.hiddenOverlapRisk * hiddenOverlapRisk -
    w.shapeMismatch * shapeMismatch -
    w.rotationPenalty * rotationPenalty -
    w.scarcityPenalty * scarcityPenalty +
    classCfg.classAffinityWeight * classAffinity -
    (regularQualityTune ? 0.22 * lowInsidePenalty : 0) -
    (regularQualityTune ? 0.16 * outsidePenaltyBoost : 0);
  return {
    score,
    metrics: {
      weights: { ...w, classAffinity: classCfg.classAffinityWeight },
      coverageRatio,
      insideRatio,
      wasteRatio,
      hiddenOverlapRisk,
      shapeMismatch,
      rotationPenalty,
      scarcityPenalty,
      classAffinity,
      lowInsidePenalty,
      outsidePenaltyBoost
    }
  };
}

function assignCandidatesIntarsiaSmart({
  fragments,
  pool,
  used,
  minAcceptFit,
  constraints,
  safeNum,
  polygonArea,
  polygonBBox,
  evaluateFragmentCandidateFit,
  normalizeDeg
}) {
  const regularMode = !!(constraints && constraints.regularCompatibility === true);
  const regularQualityTune = regularMode && !(constraints && constraints.__qualityTuneRegularV1 === false);
  const regularAssignOnlyMode = regularMode && !!(constraints && constraints.__assignOnly === true);
  const enableRegularTieBreak = regularAssignOnlyMode && !!(constraints && constraints.__enableRegularTieBreak === true);
  const tieBreakScoreDeltaRaw = Number(constraints && constraints.__tieBreakScoreDelta);
  const tieBreakScoreDelta = Number.isFinite(tieBreakScoreDeltaRaw)
    ? Math.max(0.005, Math.min(0.08, tieBreakScoreDeltaRaw))
    : 0.03;
  const tieBreakCoverageRetentionRaw = Number(constraints && constraints.__tieBreakCoverageRetention);
  const tieBreakCoverageRetention = Number.isFinite(tieBreakCoverageRetentionRaw)
    ? Math.max(0.4, Math.min(1, tieBreakCoverageRetentionRaw))
    : 0.65;
  const tieBreakMinInsideGainRaw = Number(constraints && constraints.__tieBreakMinInsideGain);
  const tieBreakMinInsideGain = Number.isFinite(tieBreakMinInsideGainRaw)
    ? Math.max(0.005, Math.min(0.2, tieBreakMinInsideGainRaw))
    : 0.05;
  const tieBreakMinOutsideGainRaw = Number(constraints && constraints.__tieBreakMinOutsideGain);
  const tieBreakMinOutsideGain = Number.isFinite(tieBreakMinOutsideGainRaw)
    ? Math.max(0.005, Math.min(0.2, tieBreakMinOutsideGainRaw))
    : 0.05;
  const debugTopKRaw = Number(constraints && constraints.__debugTopK);
  const debugTopK = Number.isFinite(debugTopKRaw) && debugTopKRaw > 0
    ? Math.max(1, Math.min(8, Math.floor(debugTopKRaw)))
    : 0;
  const debugFragmentsRaw = Array.isArray(constraints && constraints.__debugFragments)
    ? constraints.__debugFragments
    : [];
  const debugFragmentsSet = new Set(
    debugFragmentsRaw
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v))
  );
  const collectTopChoices = debugTopK > 0;
  const topChoicesByFragment = collectTopChoices ? {} : null;
  function shouldCollectTopForFragment(fragmentId) {
    if (!collectTopChoices) return false;
    if (!debugFragmentsSet.size) return true;
    return debugFragmentsSet.has(Number(fragmentId));
  }
  function summarizeTopCandidate(candidate, fit, score, metrics) {
    return {
      scrapPieceId: String(candidate && candidate.id || ""),
      inventoryTag: String(candidate && candidate.inventoryTag || ""),
      score: Math.round(Number(score || 0) * 1000) / 1000,
      fitScore: Math.round(Number(fit && fit.fitScore || 0) * 1000) / 1000,
      fitCoverageRatio: Math.round(Number(fit && fit.coverageRatio || 0) * 1000) / 1000,
      fitInsidePercent: Math.round(Number(fit && fit.insidePercent || 0) * 10) / 10,
      outsidePercent: Math.round(Math.max(0, 100 - Number(fit && fit.insidePercent || 0)) * 10) / 10,
      alignRotationDeg: Math.round(Number(fit && fit.rotationDeg || 0) * 10) / 10,
      alignOffsetX: Math.round(Number(fit && fit.offsetX || 0) * 100) / 100,
      alignOffsetY: Math.round(Number(fit && fit.offsetY || 0) * 100) / 100,
      scoreBreakdown: {
        coverageRatio: Math.round(Number(metrics && metrics.coverageRatio || 0) * 1000) / 1000,
        insideRatio: Math.round(Number(metrics && metrics.insideRatio || 0) * 1000) / 1000,
        wasteRatio: Math.round(Number(metrics && metrics.wasteRatio || 0) * 1000) / 1000,
        hiddenOverlapRisk: Math.round(Number(metrics && metrics.hiddenOverlapRisk || 0) * 1000) / 1000,
        shapeMismatch: Math.round(Number(metrics && metrics.shapeMismatch || 0) * 1000) / 1000,
        rotationPenalty: Math.round(Number(metrics && metrics.rotationPenalty || 0) * 1000) / 1000,
        scarcityPenalty: Math.round(Number(metrics && metrics.scarcityPenalty || 0) * 1000) / 1000,
        classAffinity: Math.round(Number(metrics && metrics.classAffinity || 0) * 1000) / 1000,
        lowInsidePenalty: Math.round(Number(metrics && metrics.lowInsidePenalty || 0) * 1000) / 1000,
        outsidePenaltyBoost: Math.round(Number(metrics && metrics.outsidePenaltyBoost || 0) * 1000) / 1000,
        weights: metrics && metrics.weights ? metrics.weights : null
      }
    };
  }
  function pushTopChoice(bucket, item) {
    if (!Array.isArray(bucket)) return;
    bucket.push(item);
    bucket.sort((a, b) => Number(b && b.score || 0) - Number(a && a.score || 0));
    if (bucket.length > debugTopK) bucket.length = debugTopK;
  }
  const debug = {
    checkedPairs: 0,
    rejected: {},
    rejectedSamples: {}
  };
  function markReject(reason, sample) {
    const key = String(reason || "unknown");
    debug.rejected[key] = Number(debug.rejected[key] || 0) + 1;
    if (!sample || typeof sample !== "object") return;
    if (!Array.isArray(debug.rejectedSamples[key])) debug.rejectedSamples[key] = [];
    if (debug.rejectedSamples[key].length >= 12) return;
    debug.rejectedSamples[key].push(sample);
  }
  const placements = [];
  const zoneBBox = (() => {
    const all = [];
    for (const f of fragments || []) {
      for (const p of (Array.isArray(f && f.points) ? f.points : [])) all.push(p);
    }
    return polygonBBox(all) || { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 1, height: 1 };
  })();
  const fragmentMeta = (Array.isArray(fragments) ? fragments : []).map((f) => {
    const cls = classifyFragmentType(f, zoneBBox, { polygonBBox, polygonArea });
    const difficulty = fragmentDifficultyScore(cls);
    return {
      fragment: f,
      className: cls.className,
      bbox: cls.bbox,
      rectangularity: cls.rectangularity,
      convexity: cls.convexity,
      edgeContacts: cls.edgeContacts,
      breakCount: cls.breakCount,
      minSpan: cls.minSpan,
      difficulty
    };
  });
  const classPriority = { corner: 4, edge: 3, low_priority: 2, internal: 1 };
  fragmentMeta.sort((a, b) => {
    const cp = Number(classPriority[b.className] || 0) - Number(classPriority[a.className] || 0);
    if (cp !== 0) return cp;
    if (Math.abs(b.difficulty - a.difficulty) > 1e-9) return b.difficulty - a.difficulty;
    return Number((b.fragment && b.fragment.areaMm2) || 0) - Number((a.fragment && a.fragment.areaMm2) || 0);
  });

  const scarcityMap = new Map();
  for (const c of pool) {
    const tag = String(c.inventoryTag || c.id || "");
    if (!tag) continue;
    const d = candidateShapeDescriptors(c);
    const area = Math.max(0, Number(c.areaMm2 || 0));
    const scarcity = Math.max(0, Math.min(1, 0.7 * d.complexity + 0.3 * Math.min(1, area / 70000)));
    scarcityMap.set(tag, scarcity);
  }

  for (const meta of fragmentMeta) {
    const f = meta.fragment;
    const fArea = safeNum(f.areaMm2) || polygonArea(f.points);
    const cfgBase = classParams(meta.className);
    const cfg = regularMode
      ? {
          ...cfgBase,
          insideTarget: Math.max(0.55, Number(cfgBase.insideTarget || 0.7) - 0.20),
          minCoverage: Math.max(0.12, Number(cfgBase.minCoverage || 0.6) - 0.30),
          minRect: Math.max(0, Number(cfgBase.minRect || 0) - 0.25)
        }
      : cfgBase;
    const cfgCoverageFloor = (() => {
      const x = safeNum(constraints && constraints.minCoverageRatio);
      return x === null ? cfg.minCoverage : Math.max(0.08, Math.min(1.2, Number(x)));
    })();
    const minCoverageNeed = regularMode
      ? Math.max(0.08, Math.min(0.6, cfgCoverageFloor))
      : cfg.minCoverage;
    const minInsideNeed = regularMode
      ? Math.max(0.12, Math.min(0.65, cfg.insideTarget * 0.45))
      : (cfg.insideTarget * 0.75);
    const minAreaNeed = regularMode
      ? Math.max(0.08, minCoverageNeed * 0.65)
      : (1 / Math.max(0.35, cfg.insideTarget));
    let best = null;
    const collectTop = shouldCollectTopForFragment(f.id);
    const topBucket = collectTop ? [] : null;
    for (const c of pool) {
      debug.checkedPairs += 1;
      const key = String(c.id || c.inventoryTag || "");
      if (!key || used.has(key)) continue;
      const cArea = Math.max(0, Number(c.areaMm2 || 0));
      if (!(cArea > 0)) {
        markReject("candidate_area_invalid");
        continue;
      }
      if (regularMode) {
        if (cArea + 1e-6 < fArea * minAreaNeed) {
          markReject("area_too_small_regular");
          continue;
        }
      } else if (cArea + 1e-6 < fArea / Math.max(0.35, cfg.insideTarget)) {
        markReject("area_too_small");
        continue;
      }
      const cShape = candidateShapeDescriptors(c);
      const cContour = Array.isArray(c && c.__scrapContourPoints) ? c.__scrapContourPoints : [];
      if (cContour.length < 3) {
        markReject("contour_missing");
        continue;
      }
      const needW = Number(meta.bbox.width || 0) * (meta.className === "internal" ? 0.78 : 0.62);
      const needH = Number(meta.bbox.height || 0) * (meta.className === "internal" ? 0.78 : 0.62);
      const cW = Number(cShape.bbox.width || 0);
      const cH = Number(cShape.bbox.height || 0);
      if (regularMode) {
        const needSpan = Math.min(needW, needH) * 0.9;
        const maxSpan = Math.max(cW, cH);
        if (maxSpan + 1e-6 < needSpan) {
          markReject("bbox_span_too_small_regular");
          continue;
        }
      } else if (cW + 1e-6 < needW || cH + 1e-6 < needH) {
        markReject("bbox_too_small");
        continue;
      }
      if (!regularMode && meta.className === "internal" && cShape.rectangularity + 1e-9 < cfg.minRect) {
        markReject("rectangularity_low");
        continue;
      }

      const fit = evaluateFragmentCandidateFit(f, c, {
        ...(constraints || {}),
        __searchClass: meta.className
      });
      if (!fit) {
        markReject("fit_null");
        continue;
      }
      if (Number(fit.fitScore || 0) + 1e-9 < minAcceptFit) {
        markReject("fit_score_low");
        continue;
      }
      if (Number(fit.coverageRatio || 0) + 1e-9 < minCoverageNeed) {
        markReject("coverage_low", {
          fragmentId: Number(f && f.id || 0),
          fragmentClass: String(meta && meta.className || ""),
          inventoryTag: String(c && c.inventoryTag || ""),
          scrapPieceId: String(c && c.id || ""),
          fitScore: Math.round(Number(fit.fitScore || 0) * 1000) / 1000,
          fitInsidePercent: Math.round(Number(fit.insidePercent || 0) * 10) / 10,
          fitCoverageRatio: Math.round(Number(fit.coverageRatio || 0) * 1000) / 1000,
          alignRotationDeg: Math.round(Number(fit.rotationDeg || 0) * 10) / 10,
          alignOffsetX: Math.round(Number(fit.offsetX || 0) * 100) / 100,
          alignOffsetY: Math.round(Number(fit.offsetY || 0) * 100) / 100,
          alignedContour: Array.isArray(fit.alignedContour) ? fit.alignedContour : null
        });
        continue;
      }
      if ((Number(fit.insidePercent || 0) / 100) + 1e-9 < minInsideNeed) {
        markReject("inside_low", {
          fragmentId: Number(f && f.id || 0),
          fragmentClass: String(meta && meta.className || ""),
          inventoryTag: String(c && c.inventoryTag || ""),
          scrapPieceId: String(c && c.id || ""),
          fitScore: Math.round(Number(fit.fitScore || 0) * 1000) / 1000,
          fitInsidePercent: Math.round(Number(fit.insidePercent || 0) * 10) / 10,
          fitCoverageRatio: Math.round(Number(fit.coverageRatio || 0) * 1000) / 1000,
          alignRotationDeg: Math.round(Number(fit.rotationDeg || 0) * 10) / 10,
          alignOffsetX: Math.round(Number(fit.offsetX || 0) * 100) / 100,
          alignOffsetY: Math.round(Number(fit.offsetY || 0) * 100) / 100,
          alignedContour: Array.isArray(fit.alignedContour) ? fit.alignedContour : null
        });
        continue;
      }

      const scored = scoreSmartFragmentCandidate(meta, c, fit, scarcityMap, { regularQualityTune });
      if (collectTop) {
        pushTopChoice(topBucket, summarizeTopCandidate(c, fit, scored.score, scored.metrics));
      }
      let takeAsBest = false;
      let tieBreakMeta = null;
      if (!best || scored.score > best.score + 1e-9) {
        takeAsBest = true;
      } else if (enableRegularTieBreak) {
        const scoreDelta = Number(best.score || 0) - Number(scored.score || 0);
        if (scoreDelta >= -1e-9 && scoreDelta <= tieBreakScoreDelta + 1e-9) {
          const bestCoverage = Number(best.fit && best.fit.coverageRatio || 0);
          const candCoverage = Number(fit && fit.coverageRatio || 0);
          const coverageFloor = Math.max(minCoverageNeed, bestCoverage * tieBreakCoverageRetention);
          if (candCoverage + 1e-9 >= coverageFloor) {
            const bestInside = Math.max(0, Math.min(1, Number(best.fit && best.fit.insidePercent || 0) / 100));
            const candInside = Math.max(0, Math.min(1, Number(fit && fit.insidePercent || 0) / 100));
            const bestOutside = Math.max(0, 1 - bestInside);
            const candOutside = Math.max(0, 1 - candInside);
            const insideGain = candInside - bestInside;
            const outsideGain = bestOutside - candOutside;
            const strongInside = insideGain >= tieBreakMinInsideGain;
            const strongOutside = outsideGain >= tieBreakMinOutsideGain;
            if ((strongInside && outsideGain >= -0.01) || (strongOutside && insideGain >= -0.01)) {
              takeAsBest = true;
              tieBreakMeta = {
                scoreDelta: Math.round(scoreDelta * 1000) / 1000,
                insideGain: Math.round(insideGain * 1000) / 1000,
                outsideGain: Math.round(outsideGain * 1000) / 1000,
                coverageFloor: Math.round(coverageFloor * 1000) / 1000,
                bestCoverage: Math.round(bestCoverage * 1000) / 1000,
                candidateCoverage: Math.round(candCoverage * 1000) / 1000
              };
            }
          }
        }
      }
      if (takeAsBest) {
        best = {
          c,
          fit,
          score: scored.score,
          explain: scored.metrics,
          tieBreakUsed: !!tieBreakMeta,
          tieBreakMeta
        };
      }
    }

    // Tail fallback for regular intarsia only:
    // if strict smart gates found nothing, try a softer-but-safe acceptance profile.
    if (!best && regularMode) {
      let fallbackBest = null;
      for (const c of pool) {
        const key = String(c.id || c.inventoryTag || "");
        if (!key || used.has(key)) continue;
        const fit = evaluateFragmentCandidateFit(f, c, {
          ...(constraints || {}),
          __searchClass: meta.className
        });
        if (!fit) {
          markReject("tail_fit_null");
          continue;
        }
        const fitScore = Number(fit.fitScore || 0);
        const cov = Number(fit.coverageRatio || 0);
        const inside = Number(fit.insidePercent || 0) / 100;
        const overlapApprox = Number(fit.overlapApprox || 0);
        const outsideProxy = Math.max(0, 1 - inside);
        // Quality floor: avoid "garbage" placements.
        if (fitScore < Math.max(10, Number(minAcceptFit || 0))) {
          markReject("tail_fit_score_low");
          continue;
        }
        if (cov < 0.08) {
          markReject("tail_coverage_low");
          continue;
        }
        if (inside < 0.20) {
          markReject("tail_inside_low");
          continue;
        }
        if (outsideProxy > 0.80) {
          markReject("tail_outside_high");
          continue;
        }
        // Prefer higher coverage/inside and lower outside in tail.
        const tailScore =
          (fitScore * 0.55) +
          (cov * 100 * 0.25) +
          (inside * 100 * 0.20) -
          (outsideProxy * 100 * 0.35) +
          (overlapApprox * 100 * 0.10);
        if (collectTop) {
          const tailMetrics = {
            coverageRatio: cov,
            insideRatio: inside,
            wasteRatio: Math.max(0, 1 - overlapApprox),
            hiddenOverlapRisk: Math.max(0, 1 - overlapApprox),
            shapeMismatch: 0,
            rotationPenalty: 0,
            scarcityPenalty: 0,
            classAffinity: 0,
            lowInsidePenalty: 0,
            outsidePenaltyBoost: Math.max(0, outsideProxy - 0.55),
            weights: null
          };
          pushTopChoice(topBucket, summarizeTopCandidate(c, fit, tailScore, tailMetrics));
        }
        if (!fallbackBest || tailScore > fallbackBest.tailScore + 1e-9) {
          fallbackBest = { c, fit, tailScore };
        }
      }
      if (fallbackBest) {
        best = {
          c: fallbackBest.c,
          fit: fallbackBest.fit,
          score: fallbackBest.tailScore,
          explain: {
            weights: null,
            coverageRatio: Number(fallbackBest.fit.coverageRatio || 0),
            insideRatio: Number(fallbackBest.fit.insidePercent || 0) / 100,
            wasteRatio: Math.max(0, 1 - Number(fallbackBest.fit.overlapApprox || 0)),
            hiddenOverlapRisk: Math.max(0, 1 - Number(fallbackBest.fit.overlapApprox || 0)),
            shapeMismatch: null,
            rotationPenalty: null,
            scarcityPenalty: null,
            classAffinity: null
          },
          tailFallback: true
        };
      }
    }

    if (!best) {
      if (collectTop) {
        topChoicesByFragment[String(f.id)] = {
          fragmentId: Number(f.id || 0),
          fragmentClass: meta.className,
          fragmentDifficulty: Math.round(meta.difficulty * 1000) / 1000,
          selected: null,
          topCandidates: topBucket || [],
          decision: "smart_not_found"
        };
      }
      placements.push({
        fragmentId: f.id,
        fragmentAreaMm2: fArea,
        scrapPieceId: null,
        inventoryTag: null,
        scrapContour: "",
        napDirectionDeg: null,
        bboxWidthMm: null,
        bboxHeightMm: null,
        fitScore: null,
        fitAreaRatio: null,
        fitCoverageRatio: null,
        fitOverlap: null,
        fitInsidePercent: null,
        fitChamferMm: null,
        napDeltaDeg: null,
        alignRotationDeg: null,
        napEffectiveDeg: null,
        alignOffsetX: null,
        alignOffsetY: null,
        alignedContour: null,
        status: "needs_attention",
        reason: "smart_not_found",
        fragmentClass: meta.className,
        fragmentDifficulty: Math.round(meta.difficulty * 1000) / 1000
      });
      continue;
    }

    const picked = best.c;
    const fit = best.fit;
    const key = String(picked.id || picked.inventoryTag || "");
    used.add(key);
    const baseNap = safeNum(picked.napDirectionDeg);
    const rotDeg = Number(Math.round((Number(fit.rotationDeg || 0)) * 10) / 10);
    const napEffectiveDeg = (baseNap === null) ? null : normalizeDeg(baseNap + rotDeg);
    if (collectTop) {
      topChoicesByFragment[String(f.id)] = {
        fragmentId: Number(f.id || 0),
        fragmentClass: meta.className,
        fragmentDifficulty: Math.round(meta.difficulty * 1000) / 1000,
          selected: summarizeTopCandidate(picked, fit, best.score, best.explain || {}),
          topCandidates: topBucket || [],
          decision: best.tailFallback === true
            ? "max_score_tail_fallback"
            : (best.tieBreakUsed ? "tie_break_inside_outside" : "max_score"),
          tieBreakMeta: best.tieBreakMeta || null
        };
      }
    placements.push({
      fragmentId: f.id,
      fragmentAreaMm2: fArea,
      scrapPieceId: String(picked.id || ""),
      inventoryTag: String(picked.inventoryTag || ""),
      scrapContour: String(picked.scrapContour || ""),
      napDirectionDeg: safeNum(picked.napDirectionDeg),
      bboxWidthMm: safeNum(picked.bboxWidthMm),
      bboxHeightMm: safeNum(picked.bboxHeightMm),
      fitScore: fit ? Math.round(fit.fitScore * 1000) / 1000 : null,
      fitAreaRatio: fit ? Math.round(fit.areaRatio * 1000) / 1000 : null,
      fitCoverageRatio: fit ? Math.round(fit.coverageRatio * 1000) / 1000 : null,
      fitOverlap: fit ? Math.round(fit.overlapApprox * 1000) / 1000 : null,
      fitInsidePercent: fit ? Math.round(fit.insidePercent * 10) / 10 : null,
      fitChamferMm: fit ? Math.round(fit.chamferMm * 100) / 100 : null,
      napDeltaDeg: fit && fit.napDeltaDeg !== null ? Math.round(fit.napDeltaDeg * 10) / 10 : null,
      alignRotationDeg: fit ? rotDeg : null,
      napEffectiveDeg: fit ? napEffectiveDeg : null,
      alignOffsetX: fit ? Math.round(fit.offsetX * 100) / 100 : null,
      alignOffsetY: fit ? Math.round(fit.offsetY * 100) / 100 : null,
      alignedContour: fit && Array.isArray(fit.alignedContour) ? fit.alignedContour : null,
      status: "matched",
      fragmentClass: meta.className,
      fragmentDifficulty: Math.round(meta.difficulty * 1000) / 1000,
      smartScore: Math.round(Number(best.score || 0) * 1000) / 1000,
      tailFallbackUsed: best.tailFallback === true,
      tieBreakUsed: best.tieBreakUsed === true,
      smartReason: `cov=${Math.round(Number(best.explain.coverageRatio || 0) * 100) / 100};in=${Math.round(Number(best.explain.insideRatio || 0) * 100) / 100};w=${Math.round(Number(best.explain.wasteRatio || 0) * 100) / 100};aff=${Math.round(Number(best.explain.classAffinity || 0) * 100) / 100}`,
      smartExplain: {
        weights: best.explain.weights || null,
        coverageRatio: Math.round(Number(best.explain.coverageRatio || 0) * 1000) / 1000,
        insideRatio: Math.round(Number(best.explain.insideRatio || 0) * 1000) / 1000,
        wasteRatio: Math.round(Number(best.explain.wasteRatio || 0) * 1000) / 1000,
        hiddenOverlapRisk: Math.round(Number(best.explain.hiddenOverlapRisk || 0) * 1000) / 1000,
        shapeMismatch: Math.round(Number(best.explain.shapeMismatch || 0) * 1000) / 1000,
        rotationPenalty: Math.round(Number(best.explain.rotationPenalty || 0) * 1000) / 1000,
        scarcityPenalty: Math.round(Number(best.explain.scarcityPenalty || 0) * 1000) / 1000,
        classAffinity: Math.round(Number(best.explain.classAffinity || 0) * 1000) / 1000
      }
    });
  }

  placements.sort((a, b) => Number(a.fragmentId || 0) - Number(b.fragmentId || 0));
  return {
    placements,
    breakdown: {
      checkedPairs: debug.checkedPairs,
      rejected: debug.rejected,
      rejectedSamples: debug.rejectedSamples,
      topChoicesByFragment: topChoicesByFragment || undefined
    }
  };
}

module.exports = {
  INTARSIA_SMART_WEIGHTS,
  assignCandidatesIntarsiaSmart
};
