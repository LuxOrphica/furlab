"use strict";

function roundNumber(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const scale = 10 ** digits;
  return Math.round(n * scale) / scale;
}

function compactPoint(point) {
  return {
    x: roundNumber(point && point.x),
    y: roundNumber(point && point.y),
  };
}

function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += Number(a.x || 0) * Number(b.y || 0) - Number(b.x || 0) * Number(a.y || 0);
  }
  return Math.abs(sum) / 2;
}

function bboxForPoints(points) {
  const valid = Array.isArray(points)
    ? points.filter((p) => Number.isFinite(Number(p && p.x)) && Number.isFinite(Number(p && p.y)))
    : [];
  if (!valid.length) return null;
  const xs = valid.map((p) => Number(p.x));
  const ys = valid.map((p) => Number(p.y));
  return {
    minX: roundNumber(Math.min(...xs)),
    minY: roundNumber(Math.min(...ys)),
    maxX: roundNumber(Math.max(...xs)),
    maxY: roundNumber(Math.max(...ys)),
  };
}

function normalizeRenderItem(item) {
  const contour = Array.isArray(item && item.contour) ? item.contour : [];
  const meta = item && item.meta && typeof item.meta === "object" ? item.meta : {};
  return {
    id: String(item && item.id != null ? item.id : ""),
    renderIndex: roundNumber(item && item.renderIndex, 6),
    closed: item && item.closed === true,
    status: String(meta.status || ""),
    areaMm2: roundNumber(meta.areaMm2 != null ? meta.areaMm2 : polygonArea(contour)),
    bbox: bboxForPoints(contour),
    contour: contour.map(compactPoint),
  };
}

function normalizeModePreviewResponse(response) {
  const body = response && typeof response === "object" ? response : {};
  const render = body.render && typeof body.render === "object" ? body.render : {};
  const items = Array.isArray(render.items) ? render.items : [];
  const stats = body.stats && typeof body.stats === "object" ? body.stats : {};

  return {
    ok: body.ok === true,
    layoutType: String(body.layoutType || ""),
    modeVersion: String(body.modeVersion || ""),
    resultStatus: String(body.resultStatus || ""),
    failedReason: body.failedReason == null ? null : String(body.failedReason),
    warnings: Array.isArray(body.warnings) ? body.warnings.map(String).sort() : [],
    stats: {
      fragmentsTotal: roundNumber(stats.fragmentsTotal, 6),
      rawFragmentsTotal: roundNumber(stats.rawFragmentsTotal, 6),
      droppedByNormalize: roundNumber(stats.droppedByNormalize, 6),
      totalAreaMm2: roundNumber(stats.totalAreaMm2),
      coveragePercent: roundNumber(stats.coveragePercent),
    },
    render: {
      renderOrderPolicy: String(render.renderOrderPolicy || ""),
      stackOrderPolicy: String(render.stackOrderPolicy || ""),
      solveOrder: Array.isArray(render.solveOrder) ? render.solveOrder.map(String) : [],
      itemCount: items.length,
      items: items.map(normalizeRenderItem),
    },
  };
}

function normalizePlacement(placement) {
  const contour = Array.isArray(placement && placement.alignedContour) ? placement.alignedContour : [];
  const coreContour = Array.isArray(placement && placement.alignedCoreContour)
    ? placement.alignedCoreContour
    : [];
  return {
    placementId: String(
      (placement && placement.placementId) ||
      (placement && placement.fragmentId) ||
      (placement && placement.scrapPieceId) ||
      (placement && placement.inventoryTag) ||
      ""
    ),
    inventoryTag: String(placement && placement.inventoryTag || ""),
    status: String(placement && placement.status || ""),
    solveOrder: roundNumber(placement && placement.solveOrder, 6),
    fitScore: roundNumber(placement && placement.fitScore),
    fitAreaRatio: roundNumber(placement && placement.fitAreaRatio),
    fitCoverageRatio: roundNumber(placement && placement.fitCoverageRatio),
    fitOverlap: roundNumber(placement && placement.fitOverlap),
    fitInsidePercent: roundNumber(placement && placement.fitInsidePercent),
    inZoneAreaMm2: roundNumber(placement && placement.inZoneAreaMm2),
    inZoneCoreAreaMm2: roundNumber(placement && placement.inZoneCoreAreaMm2),
    usedVisibleAreaMm2: roundNumber(placement && placement.usedVisibleAreaMm2),
    alignedContourAreaMm2: roundNumber(polygonArea(contour)),
    alignedCoreContourAreaMm2: roundNumber(polygonArea(coreContour)),
    alignedContourBbox: bboxForPoints(contour),
    alignedCoreContourBbox: bboxForPoints(coreContour),
  };
}

function normalizeFragment(fragment) {
  const points = Array.isArray(fragment && fragment.points) ? fragment.points : [];
  return {
    id: String(fragment && fragment.id != null ? fragment.id : ""),
    ownerPlacementIndex: roundNumber(fragment && fragment.ownerPlacementIndex, 6),
    areaMm2: roundNumber(fragment && fragment.areaMm2),
    computedAreaMm2: roundNumber(polygonArea(points)),
    bbox: bboxForPoints(points),
    pointCount: points.length,
  };
}

function normalizeInventoryDirectResponse(response) {
  const body = response && typeof response === "object" ? response : {};
  const placements = Array.isArray(body.placements) ? body.placements : [];
  const fragments = Array.isArray(body.fragments) ? body.fragments : [];
  const matched = placements.filter((p) => String(p && p.status || "") === "matched");

  return {
    ok: body.ok === true,
    resultStatus: String(body.resultStatus || ""),
    failedReason: body.failedReason == null ? null : String(body.failedReason),
    coveragePercent: roundNumber(body.coveragePercent),
    coveredRatio: roundNumber(body.coveredRatio),
    residualAreaMm2: roundNumber(body.residualAreaMm2),
    fullCoverageOk: body.fullCoverageOk === true,
    counts: {
      placements: placements.length,
      matched: matched.length,
      fragments: fragments.length,
      usedInventoryTags: Array.isArray(body.usedInventoryTags) ? body.usedInventoryTags.length : null,
    },
    placements: placements.map(normalizePlacement),
    fragments: fragments.map(normalizeFragment),
  };
}

module.exports = {
  roundNumber,
  polygonArea,
  bboxForPoints,
  normalizeModePreviewResponse,
  normalizeInventoryDirectResponse,
};
