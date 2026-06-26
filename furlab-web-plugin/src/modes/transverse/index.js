"use strict";

const { wrapRegularFragmentPreview } = require("../wrapper");

function createTransverseMode(deps) {
  const generateDiagonalFragments = deps && deps.generateDiagonalFragments;
  const applyNormalizeRules = deps && deps.applyNormalizeRules;
  const normalizePolygonInput = deps && deps.normalizePolygonInput;
  const polygonArea = deps && deps.polygonArea;

  if (typeof generateDiagonalFragments !== "function" ||
      typeof applyNormalizeRules !== "function" ||
      typeof normalizePolygonInput !== "function" ||
      typeof polygonArea !== "function") {
    throw new Error("transverse mode requires diagonal fragment generator/normalize dependencies");
  }

  function getDescriptor() {
    return {
      layoutType: "transverse",
      modeVersion: "v0.2",
      displayName: "Ёлочка",
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
    const polyFragments = generateDiagonalFragments(zonePoints, {
      ...options,
      diagonalDirection: "\\"
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
    let built = null;
    if (inputFrags.length) {
      const fragments = inputFrags
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
      built = {
        rawFragments: fragments.slice(),
        normalized: { fragments: fragments.slice() },
        fragments
      };
    } else {
      built = buildFragments({
        zonePoints: wrapReq.zonePoints,
        options: wrapReq.options || {},
        normalizeRules: wrapReq.inputs && typeof wrapReq.inputs.normalizeRules === "object"
          ? wrapReq.inputs.normalizeRules
          : {}
      });
    }
    return wrapRegularFragmentPreview(
      wrapReq,
      built,
      "transverse",
      "v0.2",
      "Ёлочка"
    );
  }

  async function applyWrapper(req) {
    const fragments = Array.isArray(req && req.fragments) ? req.fragments : [];
    return {
      ok: true,
      layoutType: "transverse",
      applied: true,
      previewToken: String(req && req.previewToken || ""),
      selectedZoneId: Number(req && req.selectedZoneId || 0) || null,
      resultStatus: String(req && req.resultStatus || (fragments.length ? "ok" : "failed")),
      stats: req && req.stats && typeof req.stats === "object" ? req.stats : { fragmentsTotal: fragments.length },
      fragments,
      message: "transverse apply confirmed by server."
    };
  }

  return {
    modeId: "transverse",
    getDescriptor,
    validatePreview,
    buildFragments,
    previewWrapper,
    applyWrapper
  };
}

module.exports = {
  createTransverseMode
};
