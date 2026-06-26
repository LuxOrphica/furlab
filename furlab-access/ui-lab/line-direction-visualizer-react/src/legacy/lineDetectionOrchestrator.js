export function runAutoDetectLineSegment(ctx) {
  const {
    nowMs,
    getLineSearchMask,
    ensureRejectStats,
    isPrototypeSegmentDarkEnough,
    isAutoSegmentPlausible,
    estimateSegmentConfidence,
    setLineByAuto,
    detectors
  } = ctx;

  const autoT0 = nowMs();
  const autoSoftBudgetMs = 1200;
  const autoHardBudgetMs = 6000;
  const withinHardBudget = () => (nowMs() - autoT0) <= autoHardBudgetMs;
  const stageTrace = [];
  const trace = (name, seg) => {
    if (!seg || !seg.p1 || !seg.p2) {
      stageTrace.push(`${name}:none`);
      return;
    }
    const len = Math.hypot(seg.p2.x - seg.p1.x, seg.p2.y - seg.p1.y);
    stageTrace.push(`${name}:${len.toFixed(1)}`);
  };
  const flushTrace = () => {
    const stats = ensureRejectStats();
    stats.autoTrace = stageTrace.join(" | ");
    const spentMs = Math.max(0, Math.round(nowMs() - autoT0));
    stats.autoMs = spentMs;
    stats.autoBudgetSoftMs = autoSoftBudgetMs;
    stats.autoBudgetHardMs = autoHardBudgetMs;
    stats.autoBudgetExceeded = spentMs > autoSoftBudgetMs;
  };

  const lineSearch = getLineSearchMask();
  let bestUnknown = null;

  const tryAccept = (name, source, seg, darkRequired = true) => {
    trace(name, seg);
    if (!seg || !seg.p1 || !seg.p2) return false;
    if (darkRequired && !isPrototypeSegmentDarkEnough(seg.p1, seg.p2)) {
      stageTrace.push(`${name}:reject-dark`);
      return false;
    }
    if (!isAutoSegmentPlausible(seg.p1, seg.p2, source)) {
      stageTrace.push(`${name}:reject-plausibility`);
      return false;
    }
    const confidence = Math.max(0, Math.min(1, Number(estimateSegmentConfidence?.(seg.p1, seg.p2, source) || 0)));
    const confidenceThreshold =
      source === "dark-line-global-fallback"
        ? 0.45
        : source === "dark-line-dark-percentile-pca"
          ? 0.2
        : source === "dark-line-fast-hough"
          ? 0.25
        : source === "dark-line-interior-edge"
          ? 0.4
          : 0.5;
    if (confidence < confidenceThreshold) {
      stageTrace.push(`${name}:low-confidence(${confidence.toFixed(2)})`);
      if (!bestUnknown || confidence > bestUnknown.confidence) {
        bestUnknown = { confidence, source, detector: "dark-line", p1: seg.p1, p2: seg.p2 };
      }
      return false;
    }
    setLineByAuto("dark-line", source, seg.p1, seg.p2);
    const stats = ensureRejectStats();
    stats.lineConfidence = confidence;
    flushTrace();
    return {
      ok: true,
      status: "found",
      source,
      detector: "dark-line",
      confidence,
      p1: seg.p1,
      p2: seg.p2
    };
  };

  const runStep = (name, source, fn, darkRequired = true, forceRun = false) => {
    if (!forceRun && !withinHardBudget()) {
      stageTrace.push(`budget:skip-${name}`);
      return null;
    }
    if (forceRun && !withinHardBudget()) {
      stageTrace.push(`budget:overrun-${name}`);
    }
    const found = tryAccept(name, source, fn?.(), darkRequired);
    if (found) return found;
    return null;
  };

  const found = runStep("dark-percentile-pca", "dark-line-dark-percentile-pca", detectors.detectDarkPercentilePcaSegment, false);
  if (found) return found;

  // Final forced fallback: derive direction from ROI principal axis.
  const roiAxis = detectors.detectRoiAxisSegment?.();
  trace("roi-axis", roiAxis);
  if (roiAxis?.p1 && roiAxis?.p2) {
    setLineByAuto("dark-line", "dark-line-roi-axis", roiAxis.p1, roiAxis.p2);
    const stats = ensureRejectStats();
    stats.lineConfidence = 0.2;
    flushTrace();
    return {
      ok: true,
      status: "found",
      source: "dark-line-roi-axis",
      detector: "dark-line",
      confidence: 0.2,
      p1: roiAxis.p1,
      p2: roiAxis.p2
    };
  }

  flushTrace();
  if (bestUnknown) {
    return {
      ok: false,
      status: "unknown",
      source: bestUnknown.source,
      detector: bestUnknown.detector,
      confidence: bestUnknown.confidence,
      p1: bestUnknown.p1,
      p2: bestUnknown.p2
    };
  }
  return {
    ok: false,
    status: "not_found",
    source: "",
    detector: "dark-line",
    confidence: null,
    p1: null,
    p2: null
  };
}
