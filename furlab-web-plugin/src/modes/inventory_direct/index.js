"use strict";

const { wrapInventoryDirectPreview } = require("../wrapper");

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
      renderIndex: Number.isFinite(Number(p && p.renderIndex)) ? Number(p.renderIndex) : solveOrder
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

function createInventoryDirectMode(deps) {
  const assignInventoryDirect = deps && deps.assignInventoryDirect;
  if (typeof assignInventoryDirect !== "function") {
    throw new Error("inventory_direct mode requires assignInventoryDirect");
  }

  function getDescriptor() {
    return {
      layoutType: "inventory_direct",
      modeVersion: "v1.3",
      displayName: "Inventory Direct",
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
    const options = input && input.options && typeof input.options === "object" ? input.options : {};

    const direct = await assignInventoryDirect(zonePoints, candidates, axis, filters, constraints, options);
    const placements = normalizePlacementOrders(direct && direct.placements);
    return {
      ...(direct || {}),
      placements,
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
    return wrapInventoryDirectPreview(wrapReq, direct);
  }

  async function applyWrapper(req) {
    const placements = normalizePlacementOrders(req && req.placements);
    const fragments = Array.isArray(req && req.fragments) ? req.fragments : [];
    return {
      ok: true,
      layoutType: "inventory_direct",
      applied: true,
      previewToken: String(req && req.previewToken || ""),
      selectedZoneId: Number(req && req.selectedZoneId || 0) || null,
      resultStatus: String(req && req.resultStatus || "ok"),
      stats: req && req.stats && typeof req.stats === "object" ? req.stats : {},
      fragments,
      placements,
      solveOrder: buildSolveOrder(placements),
      message: "inventory_direct apply confirmed by server."
    };
  }

  async function suggestSingle(input) {
    const run = await preview(input);
    const placement = Array.isArray(run && run.placements)
      ? run.placements.find((x) => String(x && x.status || "") === "matched")
      : null;
    return { run, placement };
  }

  return {
    modeId: "inventory_direct",
    getDescriptor,
    validatePreview,
    preview,
    previewWrapper,
    applyWrapper,
    suggestSingle
  };
}

module.exports = {
  createInventoryDirectMode
};
