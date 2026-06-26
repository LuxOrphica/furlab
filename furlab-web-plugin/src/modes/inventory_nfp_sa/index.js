"use strict";

const { wrapInventoryNfpSaPreview } = require("../wrapper");

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

function createInventoryNfpSaMode(deps) {
  const nfpSaSolver = deps && deps.nfpSaSolver;
  if (!nfpSaSolver || typeof nfpSaSolver.solve !== "function") {
    throw new Error("inventory_nfp_sa mode requires nfpSaSolver");
  }

  function getDescriptor() {
    return {
      layoutType: "inventory_nfp_sa",
      modeVersion: "v1.0",
      displayName: "Inventory NFP+SA",
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
    // Holes support: subtract zone holes from the solve domain (CONTRACT_layouts.md §4)
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
    const result = await nfpSaSolver.solve(zonePoints, solverCandidates, constraints, { ...options, zoneHoles, onProgress });
    const placements = normalizePlacementOrders(result && result.placements);
    const solved = { ...(result || {}), placements, solveOrder: buildSolveOrder(placements) };
    return wrapInventoryNfpSaPreview(input, solved);
  }

  async function applyWrapper(req) {
    const placements = normalizePlacementOrders(req && req.placements);
    const fragments = Array.isArray(req && req.fragments) ? req.fragments : [];
    return {
      ok: true,
      layoutType: "inventory_nfp_sa",
      applied: true,
      previewToken: String(req && req.previewToken || ""),
      selectedZoneId: Number(req && req.selectedZoneId || 0) || null,
      resultStatus: String(req && req.resultStatus || "ok"),
      stats: (req && req.stats && typeof req.stats === "object") ? req.stats : {},
      fragments,
      placements,
      solveOrder: buildSolveOrder(placements),
      message: "inventory_nfp_sa apply confirmed by server."
    };
  }

  return {
    modeId: "inventory_nfp_sa",
    getDescriptor,
    validatePreview,
    previewWrapper,
    applyWrapper
  };
}

module.exports = { createInventoryNfpSaMode };
