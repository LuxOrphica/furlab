"use strict";

const { wrapInventoryVoronoiSaPreview } = require("../wrapper");

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

// variant.modeId / variant.partitionV2 — второй режим "Voronoi SA v2" переиспользует
// тот же солвер, отличаясь только построением партиции (core-aware power-диаграмма).
function createInventoryVoronoiSaMode(deps, variant) {
  const _modeId = String((variant && variant.modeId) || "inventory_voronoi_sa");
  const _partitionV2 = !!(variant && variant.partitionV2);
  const voronoiSaSolver = deps && deps.voronoiSaSolver;
  if (!voronoiSaSolver || typeof voronoiSaSolver.solve !== "function") {
    throw new Error("inventory_voronoi_sa mode requires voronoiSaSolver");
  }

  function getDescriptor() {
    return {
      layoutType: _modeId,
      modeVersion: "v3.1",
      displayName: _partitionV2 ? "Inventory Voronoi+SA v2" : "Inventory Voronoi+SA",
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
    const result = await voronoiSaSolver.solve(zonePoints, solverCandidates, constraints, {
      ...options,
      zoneHoles,
      onProgress,
      layoutMode: _modeId,
      territoryMode: "mosaic",
      _partitionV2: _partitionV2,
      postprocessMode: "full",
      // v5.0 §3 R7: SA-ветка активна по умолчанию (_lloydTiling: false).
      // Lloyd-tiling можно включить явно через options._lloydTiling для regression-тестов.
      _lloydTiling: options && options._lloydTiling === true ? true : false
    });
    const placements = normalizePlacementOrders(result && result.placements);
    const solved = { ...(result || {}), placements, solveOrder: buildSolveOrder(placements) };
    return wrapInventoryVoronoiSaPreview(input, solved, _modeId);
  }

  async function applyWrapper(req) {
    const placements = normalizePlacementOrders(req && req.placements);
    const fragments = Array.isArray(req && req.fragments) ? req.fragments : [];
    return {
      ok: true,
      layoutType: _modeId,
      applied: true,
      previewToken: String(req && req.previewToken || ""),
      selectedZoneId: Number(req && req.selectedZoneId || 0) || null,
      resultStatus: String(req && req.resultStatus || "ok"),
      stats: (req && req.stats && typeof req.stats === "object") ? req.stats : {},
      fragments,
      placements,
      solveOrder: buildSolveOrder(placements),
      message: _modeId + " apply confirmed by server."
    };
  }

  return {
    modeId: _modeId,
    getDescriptor,
    validatePreview,
    previewWrapper,
    applyWrapper
  };
}

module.exports = { createInventoryVoronoiSaMode };
