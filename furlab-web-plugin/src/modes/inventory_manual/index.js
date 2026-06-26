"use strict";

function createInventoryManualMode() {
  function getDescriptor() {
    return {
      layoutType: "inventory_manual",
      modeVersion: "v0.2",
      displayName: "Inventory Manual",
      supportsPreview: true,
      supportsApply: true
    };
  }

  function validatePreview(req) {
    const zonePoints = Array.isArray(req && req.zonePoints) ? req.zonePoints : [];
    if (zonePoints.length < 3) return { ok: false, error: "zone_points_required" };
    return { ok: true };
  }

  async function previewWrapper() {
    return {
      ok: true,
      layoutType: "inventory_manual",
      modeVersion: "v0.2",
      resultStatus: "needs_attention",
      warnings: ["manual_mode_requires_ui_driven_placements"],
      failedReason: null,
      stats: {},
      render: {
        renderOrderPolicy: "solve_order",
        stackOrderPolicy: "solve_order",
        solveOrder: [],
        items: []
      },
      debug: {}
    };
  }

  async function applyWrapper(req) {
    return {
      ok: false,
      layoutType: "inventory_manual",
      error: "apply_not_implemented",
      message: "inventory_manual apply adapter is not connected yet.",
      previewToken: String(req && req.previewToken || "")
    };
  }

  return {
    modeId: "inventory_manual",
    getDescriptor,
    validatePreview,
    previewWrapper,
    applyWrapper
  };
}

module.exports = {
  createInventoryManualMode
};
