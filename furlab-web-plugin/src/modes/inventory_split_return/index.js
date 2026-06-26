"use strict";

function normalizePlacementOrders(placements) {
  if (!Array.isArray(placements)) return [];
  return placements.map((p, idx) => {
    const solveOrder = Number.isFinite(Number(p && p.solveOrder))
      ? Number(p.solveOrder)
      : (idx + 1);
    const solveIndex = Number.isFinite(Number(p && p.solveIndex))
      ? Number(p.solveIndex)
      : Math.max(0, solveOrder - 1);
    return {
      ...p,
      solveOrder,
      solveIndex,
      renderIndex: Number.isFinite(Number(p && p.renderIndex)) ? Number(p.renderIndex) : (-solveOrder)
    };
  });
}

function buildSolveOrder(placements) {
  return normalizePlacementOrders(placements)
    .slice()
    .sort((a, b) => Number(a && a.solveOrder || 0) - Number(b && b.solveOrder || 0))
    .map((p) => String(p && (p.placementId || p.fragmentId || p.scrapPieceId || p.inventoryTag || "")))
    .filter((x) => x.length > 0);
}

function createInventorySplitReturnMode(deps) {
  const assignInventoryDirect = deps && deps.assignInventoryDirect;
  if (typeof assignInventoryDirect !== "function") {
    throw new Error("inventory_split_return mode requires assignInventoryDirect");
  }

  function getDescriptor() {
    return {
      layoutType: "inventory_split_return",
      modeVersion: "v0.3",
      displayName: "Inventory Split & Return",
      supportsPreview: true,
      supportsApply: true
    };
  }

  function validatePreview(req) {
    const zonePoints = Array.isArray(req && req.zonePoints) ? req.zonePoints : [];
    if (zonePoints.length < 3) return { ok: false, error: "zone_points_required" };
    return { ok: true };
  }

  async function preview(input) {
    const zonePoints = Array.isArray(input && input.zonePoints) ? input.zonePoints : [];
    const candidates = Array.isArray(input && input.candidates) ? input.candidates : [];
    const axis = String(input && input.axis || "y");
    const filters = input && input.filters && typeof input.filters === "object" ? input.filters : {};
    const constraints = input && input.constraints && typeof input.constraints === "object" ? input.constraints : {};
    const incomingOptions = input && input.options && typeof input.options === "object" ? input.options : {};
    const options = {
      ...incomingOptions,
      // Contract v0.1: deterministic first-on-top stack for used-visible gain.
      layerPolicy: "first_on_top",
      splitReturnEnabled: true,
      modeId: "inventory_split_return"
    };

    const direct = await assignInventoryDirect(zonePoints, candidates, axis, filters, constraints, options);
    const placements = normalizePlacementOrders(direct && direct.placements);
    return {
      ...(direct || {}),
      placements,
      splitReturnEnabled: true,
      splitReturnMode: "inventory_split_return",
      solveOrder: buildSolveOrder(placements)
    };
  }

  async function previewWrapper(wrapReq) {
    const axis = String((wrapReq.inputs && wrapReq.inputs.axis) || (wrapReq.options && wrapReq.options.axis) || "y")
      .toLowerCase() === "x" ? "x" : "y";
    const filters = wrapReq.inputs && typeof wrapReq.inputs.filters === "object" ? wrapReq.inputs.filters : {};
    const constraints = wrapReq.inputs && typeof wrapReq.inputs.constraints === "object"
      ? wrapReq.inputs.constraints
      : { requireScrapContour: true };
    const candidates = Array.isArray(wrapReq.inputs && wrapReq.inputs.candidates) ? wrapReq.inputs.candidates : [];
    const options = {
      ...(wrapReq.options || {}),
      ...(Number.isFinite(Number(wrapReq.seed)) ? { seed: Number(wrapReq.seed) } : {})
    };
    const direct = await preview({
      zonePoints: wrapReq.zonePoints,
      candidates,
      axis,
      filters,
      constraints,
      options
    });
    const strictCoverage = !!(direct && direct.strictCoverage === true);
    const fullCoverageOk = !!(direct && direct.fullCoverageOk === true);
    const resultStatus = strictCoverage && !fullCoverageOk ? "failed" : "ok";
    const solveOrder = Array.isArray(direct && direct.solveOrder) ? direct.solveOrder : [];
    const placements = Array.isArray(direct && direct.placements) ? direct.placements : [];
    const renderItems = placements.map((p, idx) => ({
      placementId: p && p.placementId != null ? p.placementId : idx,
      candidateKey: String(p && p.candidateKey || ""),
      inventoryTag: String(p && p.inventoryTag || ""),
      solveOrder: Number(p && p.solveOrder || idx + 1),
      solveIndex: Number(p && p.solveIndex != null ? p.solveIndex : idx),
      renderIndex: Number(p && p.renderIndex != null ? p.renderIndex : -(idx + 1)),
      alignedContour: Array.isArray(p && p.alignedContour) ? p.alignedContour : [],
      usedVisibleContour: Array.isArray(p && p.usedVisibleContour) ? p.usedVisibleContour : [],
      inZoneContour: Array.isArray(p && p.inZoneContour) ? p.inZoneContour : [],
      gainAreaMm2: Number(p && p.gainAreaMm2 || 0),
      overlapAreaMm2: Number(p && p.overlapAreaMm2 || 0),
      outsideAreaMm2: Number(p && p.outsideAreaMm2 || 0),
      phase: String(p && p.phase || ""),
      candidateType: String(p && p.candidateType || "original")
    }));
    return {
      ok: true,
      layoutType: "inventory_split_return",
      modeVersion: "v0.3",
      resultStatus,
      splitReturnEnabled: true,
      warnings: [],
      failedReason: resultStatus === "failed"
        ? String((direct && direct.failedReason) || "zone_not_fully_covered")
        : null,
      stats: {
        coveredRatio: Number(direct && direct.coveredRatio || 0),
        coveragePercent: Number(direct && direct.coveragePercent || 0),
        residualAreaMm2: Number(direct && direct.residualAreaMm2 || 0),
        fullCoverageOk,
        piecesCount: placements.length,
        splitEvents: Array.isArray(direct && direct.splitEvents) ? direct.splitEvents.length : 0
      },
      render: {
        renderOrderPolicy: "first_on_top",
        stackOrderPolicy: "first_on_top",
        solveOrder,
        items: renderItems
      },
      splitEvents: Array.isArray(direct && direct.splitEvents) ? direct.splitEvents : [],
      debug: {
        algorithmTrace: direct && direct.algorithmTrace ? direct.algorithmTrace : null
      }
    };
  }

  async function applyWrapper(req) {
    const placements = normalizePlacementOrders(req && req.placements);
    const fragments = Array.isArray(req && req.fragments) ? req.fragments : [];
    return {
      ok: true,
      layoutType: "inventory_split_return",
      applied: true,
      previewToken: String(req && req.previewToken || ""),
      selectedZoneId: Number(req && req.selectedZoneId || 0) || null,
      resultStatus: String(req && req.resultStatus || "ok"),
      stats: req && req.stats && typeof req.stats === "object" ? req.stats : {},
      fragments,
      placements,
      splitReturnEnabled: true,
      solveOrder: buildSolveOrder(placements),
      message: "inventory_split_return apply confirmed by server."
    };
  }

  return {
    modeId: "inventory_split_return",
    getDescriptor,
    validatePreview,
    preview,
    previewWrapper,
    applyWrapper
  };
}

module.exports = {
  createInventorySplitReturnMode
};
