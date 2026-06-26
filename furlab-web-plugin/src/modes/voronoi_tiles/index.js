"use strict";

const { wrapRegularFragmentPreview } = require("../wrapper");

function createVoronoiTilesMode(deps) {
  const generateVoronoiFragments = deps && deps.generateVoronoiFragments;
  const applyNormalizeRules = deps && deps.applyNormalizeRules;
  const normalizePolygonInput = deps && deps.normalizePolygonInput;
  const polygonArea = deps && deps.polygonArea;

  if (typeof generateVoronoiFragments !== "function" ||
      typeof applyNormalizeRules !== "function" ||
      typeof normalizePolygonInput !== "function" ||
      typeof polygonArea !== "function") {
    throw new Error("voronoi_tiles mode requires generateVoronoiFragments/normalize dependencies");
  }

  function getDescriptor() {
    return {
      layoutType: "voronoi_tiles",
      modeVersion: "v0.1",
      displayName: "Мозаика Вороного",
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
    const zonePoints = Array.isArray(input && input.zonePoints) ? input.zonePoints : [];
    const options = input && input.options && typeof input.options === "object" ? input.options : {};
    const normalizeRules = input && input.normalizeRules && typeof input.normalizeRules === "object" ? input.normalizeRules : {};
    const zoneAreaMm2 = polygonArea(zonePoints);
    const maxAlongMm = Number(normalizeRules.fragmentMaxAlongMm) || 0;
    const maxAcrossMm = Number(normalizeRules.fragmentMaxAcrossMm) || 0;
    // If max size is set, ensure enough seeds so cells fit within that constraint.
    // Expected cell area ≈ maxAlong * maxAcross; needed count = zoneArea / maxCellArea.
    let minCandidates = 1;
    if (maxAlongMm > 0 && maxAcrossMm > 0) {
      const maxCellAreaMm2 = maxAlongMm * maxAcrossMm;
      minCandidates = Math.ceil(zoneAreaMm2 / maxCellAreaMm2);
    }
    // minAreaMm2 = 0: Voronoi cells tile without gaps — filtering any cell creates a hole.
    const polyFragments = generateVoronoiFragments(zonePoints, {
      subMode: options.subMode,
      cellCount: options.cellCount,
      density: options.density,
      variability: options.variability,
      anisotropy: options.anisotropy,
      gapMm: options.gapMm,
      axis: options.napAxis || "y",
      seed: options.seed,
      minAreaMm2: 0,
      minCandidates
    });
    const rawFragments = (Array.isArray(polyFragments) ? polyFragments : [])
      .map((points, i) => ({ id: i + 1, points, areaMm2: polygonArea(points) }))
      .sort((a, b) => Number(b && b.areaMm2 || 0) - Number(a && a.areaMm2 || 0));
    const normalized = applyNormalizeRules(rawFragments, normalizeRules, "y");
    return {
      rawFragments,
      normalized,
      fragments: Array.isArray(normalized && normalized.fragments) ? normalized.fragments : []
    };
  }

  async function previewWrapper(wrapReq) {
    const inputFrags = Array.isArray(wrapReq.inputs && wrapReq.inputs.fragments) ? wrapReq.inputs.fragments : [];
    const normalizeRules = wrapReq.inputs && typeof wrapReq.inputs.normalizeRules === "object"
      ? wrapReq.inputs.normalizeRules
      : {};
    let built = null;
    if (inputFrags.length) {
      const rawFragments = inputFrags
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
      const normalized = applyNormalizeRules(rawFragments, normalizeRules, "y");
      const fragments = Array.isArray(normalized && normalized.fragments) ? normalized.fragments : rawFragments;
      built = { rawFragments, normalized, fragments };
    } else {
      built = buildFragments({
        zonePoints: wrapReq.zonePoints,
        options: { ...(wrapReq.options || {}), seed: wrapReq.seed },
        normalizeRules
      });
    }
    return wrapRegularFragmentPreview(
      wrapReq,
      built,
      "voronoi_tiles",
      "v0.1",
      "Мозаика Вороного"
    );
  }

  async function applyWrapper(req) {
    const fragments = Array.isArray(req && req.fragments) ? req.fragments : [];
    return {
      ok: true,
      layoutType: "voronoi_tiles",
      applied: true,
      previewToken: String(req && req.previewToken || ""),
      selectedZoneId: Number(req && req.selectedZoneId || 0) || null,
      resultStatus: String(req && req.resultStatus || (fragments.length ? "ok" : "failed")),
      stats: req && req.stats && typeof req.stats === "object" ? req.stats : { fragmentsTotal: fragments.length },
      fragments,
      message: "voronoi_tiles apply confirmed by server."
    };
  }

  return {
    modeId: "voronoi_tiles",
    getDescriptor,
    validatePreview,
    buildFragments,
    previewWrapper,
    applyWrapper
  };
}

module.exports = {
  createVoronoiTilesMode
};
