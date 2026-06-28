"use strict";

const { wrapInventoryTilingPreview } = require("../wrapper");

function normalizePlacementOrders(placements) {
  if (!Array.isArray(placements)) return [];
  return placements.map((p, idx) => ({
    ...p,
    solveIndex: Number.isFinite(Number(p && p.solveIndex)) ? Number(p.solveIndex) : idx,
    solveOrder: Number.isFinite(Number(p && p.solveOrder)) ? Number(p.solveOrder) : idx + 1,
    renderIndex: Number.isFinite(Number(p && p.renderIndex)) ? Number(p.renderIndex) : idx
  }));
}

function buildSolveOrder(placements) {
  return normalizePlacementOrders(placements)
    .slice()
    .sort((a, b) => (a.solveOrder || 0) - (b.solveOrder || 0))
    .map(p => String(p && (p.scrapPieceId || p.inventoryTag || "")))
    .filter(x => x.length > 0);
}

function createInventoryTilingMode(deps) {
  const tilingSolver = deps && deps.tilingSolver;
  if (!tilingSolver || typeof tilingSolver.solve !== "function") {
    throw new Error("inventory_tiling mode requires tilingSolver");
  }

  function getDescriptor() {
    return {
      layoutType: "inventory_tiling",
      modeVersion: "v1.0",
      displayName: "Inventory Tiling",
      supportsPreview: true,
      supportsApply: true
    };
  }

  function validatePreview(req) {
    const zonePoints = Array.isArray(req && req.zonePoints) ? req.zonePoints : [];
    if (zonePoints.length < 3) return { ok: false, error: "zone_points_required" };
    return { ok: true };
  }

  async function previewWrapper(input) {
    const zonePoints = Array.isArray(input && input.zonePoints) ? input.zonePoints : [];
    const zoneHoles = Array.isArray(input && input.zoneHoles) ? input.zoneHoles : [];
    const inp = (input && input.inputs && typeof input.inputs === "object") ? input.inputs : {};
    const candidates = Array.isArray(inp.candidates) ? inp.candidates : [];
    const constraints = (inp.constraints && typeof inp.constraints === "object") ? inp.constraints : {};
    const options = (input && input.options && typeof input.options === "object") ? input.options : {};

    const solverCandidates = [];
    for (const c of candidates) {
      const qty = Math.max(1, Math.floor(Number(c.quantity) || 1));
      for (let i = 0; i < qty; i++) {
        const suffix = qty > 1 ? `_${i + 1}` : "";
        const baseId = String(c.scrapPieceId || c.id || c.inventoryTag || "");
        solverCandidates.push({
          id: baseId + suffix,
          inventoryTag: baseId,
          napDirectionDeg: c.napDirectionDeg ?? c.napDirection ?? 0,
          scrapContour: c.contourPoints || c.scrapContour || []
        });
      }
    }

    const onProgress = (input.options && typeof input.options.onProgress === "function") ? input.options.onProgress : null;
    const result = await tilingSolver.solve(zonePoints, solverCandidates, constraints, { ...options, zoneHoles, onProgress });
    const placements = normalizePlacementOrders(result && result.placements);
    const solved = { ...(result || {}), placements, solveOrder: buildSolveOrder(placements) };
    return wrapInventoryTilingPreview(input, solved);
  }

  async function applyWrapper(req) {
    const placements = normalizePlacementOrders(req && req.placements);
    const fragments = Array.isArray(req && req.fragments) ? req.fragments : [];
    return {
      ok: true,
      layoutType: "inventory_tiling",
      applied: true,
      previewToken: String(req && req.previewToken || ""),
      selectedZoneId: Number(req && req.selectedZoneId || 0) || null,
      resultStatus: String(req && req.resultStatus || "ok"),
      stats: (req && req.stats && typeof req.stats === "object") ? req.stats : {},
      fragments,
      placements,
      solveOrder: buildSolveOrder(placements),
      message: "inventory_tiling apply confirmed by server."
    };
  }

  return {
    modeId: "inventory_tiling",
    getDescriptor,
    validatePreview,
    previewWrapper,
    applyWrapper
  };
}

module.exports = { createInventoryTilingMode };
