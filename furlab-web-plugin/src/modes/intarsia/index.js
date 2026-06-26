"use strict";

const { wrapIntarsiaPreview } = require("../wrapper");

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

function createIntarsiaMode(deps) {
  const generateRegularFragments = deps && deps.generateRegularFragments;
  const generateVoronoiFragments = deps && deps.generateVoronoiFragments;
  const applyNormalizeRules = deps && deps.applyNormalizeRules;
  const assignCandidatesToFragments = deps && deps.assignCandidatesToFragments;
  const normalizePolygonInput = deps && deps.normalizePolygonInput;
  const polygonArea = deps && deps.polygonArea;

  if (typeof generateRegularFragments !== "function" ||
      typeof generateVoronoiFragments !== "function" ||
      typeof applyNormalizeRules !== "function" ||
      typeof assignCandidatesToFragments !== "function" ||
      typeof normalizePolygonInput !== "function" ||
      typeof polygonArea !== "function") {
    throw new Error("intarsia mode requires generator/normalize/assign dependencies");
  }

  function getDescriptor() {
    return {
      layoutType: "intarsia",
      modeVersion: "v0.2",
      displayName: "Intarsia",
      supportsPreview: true,
      supportsApply: true
    };
  }

  function validatePreview(req) {
    const zonePoints = Array.isArray(req && req.zonePoints) ? req.zonePoints : [];
    if (zonePoints.length < 3) return { ok: false, error: "zone_points_required" };
    return { ok: true };
  }

  function buildFragments(input) {
    const fillType = String(input && input.fillType || "voronoi");
    const zonePoints = Array.isArray(input && input.zonePoints) ? input.zonePoints : [];
    const options = input && input.options && typeof input.options === "object" ? input.options : {};
    const normalizeRules = input && input.normalizeRules && typeof input.normalizeRules === "object" ? input.normalizeRules : {};
    const axis = String(input && input.axis || "y");
    const polygonAreaFn = typeof (input && input.polygonArea) === "function" ? input.polygonArea : polygonArea;

    const polyFragments = fillType === "regular"
      ? generateRegularFragments(zonePoints, options)
      : generateVoronoiFragments(zonePoints, options);
    const rawFragments = (Array.isArray(polyFragments) ? polyFragments : [])
      .map((points, i) => ({ id: i + 1, points, areaMm2: polygonAreaFn(points) }))
      .sort((a, b) => Number(b && b.areaMm2 || 0) - Number(a && a.areaMm2 || 0));
    const normalized = applyNormalizeRules(rawFragments, normalizeRules, axis);

    return {
      rawFragments,
      normalized,
      fragments: Array.isArray(normalized && normalized.fragments) ? normalized.fragments : []
    };
  }

  function assign(input) {
    const fragments = Array.isArray(input && input.fragments) ? input.fragments : [];
    const candidates = Array.isArray(input && input.candidates) ? input.candidates : [];
    const placementStrategy = String(input && input.placementStrategy || "bestFit");
    const axis = String(input && input.axis || "y");
    const filters = input && input.filters && typeof input.filters === "object" ? input.filters : {};
    const constraints = input && input.constraints && typeof input.constraints === "object" ? input.constraints : {};

    return assignCandidatesToFragments(
      fragments,
      candidates,
      placementStrategy,
      axis,
      filters,
      constraints
    );
  }

  async function previewWrapper(wrapReq) {
    const axis = String((wrapReq.inputs && wrapReq.inputs.axis) || (wrapReq.options && wrapReq.options.axis) || "y")
      .toLowerCase() === "x" ? "x" : "y";
    const filters = wrapReq.inputs && typeof wrapReq.inputs.filters === "object" ? wrapReq.inputs.filters : {};
    const constraints = wrapReq.inputs && typeof wrapReq.inputs.constraints === "object"
      ? wrapReq.inputs.constraints
      : { requireScrapContour: true };
    const candidates = Array.isArray(wrapReq.inputs && wrapReq.inputs.candidates) ? wrapReq.inputs.candidates : [];
    let fragments = [];
    const inputFrags = Array.isArray(wrapReq.inputs && wrapReq.inputs.fragments) ? wrapReq.inputs.fragments : [];
    if (inputFrags.length) {
      fragments = inputFrags
        .map((f, i) => {
          const pts = normalizePolygonInput(f && f.points);
          if (pts.length < 3) return null;
          return {
            id: Number.isFinite(Number(f && f.id)) ? Number(f.id) : (i + 1),
            points: pts,
            areaMm2: polygonArea(pts)
          };
        })
        .filter(Boolean);
    } else {
      const built = buildFragments({
        fillType: String(wrapReq.inputs && wrapReq.inputs.fillType || "voronoi"),
        zonePoints: wrapReq.zonePoints,
        options: wrapReq.options || {},
        normalizeRules: wrapReq.inputs && typeof wrapReq.inputs.normalizeRules === "object" ? wrapReq.inputs.normalizeRules : {},
        axis,
        polygonArea
      });
      fragments = built.fragments;
    }
    const assigned = assign({
      fragments,
      candidates,
      placementStrategy: String(wrapReq.inputs && wrapReq.inputs.placementStrategy || "bestFit"),
      axis,
      filters,
      constraints
    });
    return wrapIntarsiaPreview(wrapReq, assigned);
  }

  async function applyWrapper(req) {
    const placements = normalizePlacementOrders(req && req.placements);
    const fragments = Array.isArray(req && req.fragments) ? req.fragments : [];
    return {
      ok: true,
      layoutType: "intarsia",
      applied: true,
      previewToken: String(req && req.previewToken || ""),
      selectedZoneId: Number(req && req.selectedZoneId || 0) || null,
      resultStatus: String(req && req.resultStatus || "ok"),
      stats: req && req.stats && typeof req.stats === "object" ? req.stats : {},
      fragments,
      placements,
      solveOrder: buildSolveOrder(placements),
      message: "intarsia apply confirmed by server."
    };
  }

  return {
    modeId: "intarsia",
    getDescriptor,
    validatePreview,
    buildFragments,
    assign,
    previewWrapper,
    applyWrapper
  };
}

module.exports = {
  createIntarsiaMode
};
