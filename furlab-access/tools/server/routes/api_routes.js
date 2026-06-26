"use strict";

const { handleSystemRoutes } = require("./system_routes");
const { handleRegistryRoutes } = require("./registry_routes");
const { handleHistoryRoutes } = require("./history_routes");
const { handlePieceRoutes } = require("./piece_routes");
const { handleTrainingRoutes } = require("./training_routes");
const { handleQrRegistryRoutes } = require("./qr_registry_routes");
const { handleLayoutRunRoutes } = require("./layout_run_routes");

async function handleApiRequest(ctx) {
  const systemHandled = await handleSystemRoutes(ctx);
  if (systemHandled !== false) return systemHandled;
  const registryHandled = await handleRegistryRoutes(ctx);
  if (registryHandled !== false) return registryHandled;
  const historyHandled = await handleHistoryRoutes(ctx);
  if (historyHandled !== false) return historyHandled;
  const pieceHandled = await handlePieceRoutes(ctx);
  if (pieceHandled !== false) return pieceHandled;
  const qrRegistryHandled = await handleQrRegistryRoutes(ctx);
  if (qrRegistryHandled !== false) return qrRegistryHandled;
  const trainingHandled = await handleTrainingRoutes(ctx);
  if (trainingHandled !== false) return trainingHandled;
  const layoutRunHandled = await handleLayoutRunRoutes(ctx);
  if (layoutRunHandled !== false) return layoutRunHandled;
  return ctx.reply(404, { ok: false, error: "api_not_found" });
}

module.exports = {
  handleApiRequest
};
