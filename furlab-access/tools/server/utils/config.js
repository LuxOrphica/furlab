"use strict";

function toNumberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function loadServerConfig(env) {
  const host = String(env.UI_LAB_HOST || "127.0.0.1");
  const port = toNumberOr(env.UI_LAB_PORT, 5500);
  const writeApiKey = String(env.FURLAB_API_KEY || "").trim();
  const corsOriginsRaw = String(
    env.UI_LAB_CORS_ORIGINS ||
    "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5500,http://localhost:5500"
  );
  const dbPathOverride = String(env.FURLAB_DB_PATH || "").trim();

  const ttl = {
    dictsMs: Math.max(1, toNumberOr(env.FURLAB_DICTS_TTL_MS, 60 * 60 * 1000)),
    registryMs: Math.max(1, toNumberOr(env.FURLAB_REGISTRY_TTL_MS, 5 * 60 * 1000)),
    historyMs: Math.max(1, toNumberOr(env.FURLAB_HISTORY_TTL_MS, 60000)),
    pieceMs: Math.max(1, toNumberOr(env.FURLAB_PIECE_TTL_MS, 30000)),
    contourMs: Math.max(1, toNumberOr(env.FURLAB_CONTOUR_TTL_MS, 5 * 60 * 1000))
  };

  const timeouts = {
    registryReaderMs: Math.max(1000, toNumberOr(env.FURLAB_REGISTRY_TIMEOUT_MS, 7000)),
    pieceReaderMs: Math.max(1000, toNumberOr(env.FURLAB_PIECE_TIMEOUT_MS, 15000))
  };

  const mirror = {
    registryMaxAgeMs: Math.max(1000, toNumberOr(env.FURLAB_REGISTRY_MIRROR_MAX_AGE_MS, 30000))
  };

  return {
    host,
    port,
    writeApiKey,
    corsOriginsRaw,
    dbPathOverride,
    ttl,
    timeouts,
    mirror
  };
}

module.exports = {
  loadServerConfig
};
