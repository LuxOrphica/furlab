"use strict";

const { createInventoryDirectMode } = require("./inventory_direct");
const { createIntarsiaMode } = require("./intarsia");
const { createLongitudinalMode } = require("./longitudinal");
const { createRadialMode } = require("./radial");
const { createShiftedMode } = require("./shifted");
const { createTransverseMode } = require("./transverse");
const { createInventoryManualMode } = require("./inventory_manual");
const { createInventorySplitReturnMode } = require("./inventory_split_return");
const { createInventoryVoronoiSaMode } = require("./inventory_voronoi_sa");
const { createInventoryNfpSaMode } = require("./inventory_nfp_sa");
const { createVoronoiTilesMode } = require("./voronoi_tiles");

function createModeRegistry(deps) {
  const inventoryDirect = createInventoryDirectMode(deps || {});
  const intarsia = createIntarsiaMode(deps || {});
  const longitudinal = createLongitudinalMode(deps || {});
  const radial = createRadialMode(deps || {});
  const shifted = createShiftedMode(deps || {});
  const transverse = createTransverseMode(deps || {});
  const inventoryManual = createInventoryManualMode(deps || {});
  const inventorySplitReturn = createInventorySplitReturnMode(deps || {});
  const inventoryVoronoiSa = createInventoryVoronoiSaMode(deps || {});
  const inventoryNfpSa = createInventoryNfpSaMode(deps || {});
  const voronoiTiles = createVoronoiTilesMode(deps || {});
  const modes = new Map([
    [longitudinal.modeId, longitudinal],
    [radial.modeId, radial],
    [shifted.modeId, shifted],
    [transverse.modeId, transverse],
    [inventoryDirect.modeId, inventoryDirect],
    [intarsia.modeId, intarsia],
    [inventoryManual.modeId, inventoryManual],
    [inventorySplitReturn.modeId, inventorySplitReturn],
    [inventoryVoronoiSa.modeId, inventoryVoronoiSa],
    [inventoryNfpSa.modeId, inventoryNfpSa],
    [voronoiTiles.modeId, voronoiTiles]
  ]);

  function get(modeId) {
    return modes.get(String(modeId || "").trim()) || null;
  }

  function requireMode(modeId) {
    const mode = get(modeId);
    if (!mode) throw new Error(`unknown_mode:${modeId}`);
    return mode;
  }

  return {
    get,
    require: requireMode
  };
}

module.exports = {
  createModeRegistry
};
