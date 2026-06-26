"use strict";

const { loadPieceResponse } = require("../services/piece_response_service");

async function handlePieceRoutes(ctx) {
  const {
    req,
    reqUrl,
    reply,
    denyWrite,
    readBodyJson,
    loadPieceById,
    loadPieceBundleById,
    loadPieceReservationById,
    loadPieceHistoryById,
    loadPieceContourById,
    transitionPieceStatus,
    updatePieceFields,
    inventoryTagExists,
    saveScrapPiece,
    invalidateRegistryCache
  } = ctx;

  if (req.method === "GET" && reqUrl.pathname === "/api/piece-exists") {
    const inventoryTag = String(reqUrl.searchParams.get("inventoryTag") || "").trim();
    const result = inventoryTagExists(inventoryTag);
    return reply(result.ok ? 200 : 400, result);
  }

  if ((req.method === "GET" || req.method === "POST") && reqUrl.pathname.startsWith("/api/piece/")) {
    const parts = reqUrl.pathname.split("/").filter(Boolean);
    if (parts.length >= 3) {
      const pieceId = decodeURIComponent(parts[2] || "");
      if (parts.length === 3) {
        if (req.method !== "GET") return reply(405, { ok: false, error: "method_not_allowed" });
        const readResult = loadPieceResponse({
          reqUrl,
          pieceId,
          loadPieceById,
          loadPieceBundleById,
          loadPieceReservationById,
          loadPieceHistoryById
        });
        return reply(readResult.code, readResult.payload);
      }
      if (parts.length === 4 && parts[3] === "reservation") {
        if (req.method !== "GET") return reply(405, { ok: false, error: "method_not_allowed" });
        const reservation = loadPieceReservationById(pieceId);
        return reply(reservation.ok ? 200 : 400, reservation);
      }
      if (parts.length === 4 && parts[3] === "history") {
        if (req.method !== "GET") return reply(405, { ok: false, error: "method_not_allowed" });
        const history = loadPieceHistoryById(pieceId, "");
        return reply(history.ok ? 200 : 400, history);
      }
      if (parts.length === 4 && parts[3] === "contour") {
        if (req.method !== "GET") return reply(405, { ok: false, error: "method_not_allowed" });
        const contour = loadPieceContourById(pieceId);
        return reply(contour.ok ? 200 : 400, contour);
      }
      if (parts.length === 4 && /^(reserve|release|use)$/i.test(parts[3])) {
        if (req.method !== "POST") return reply(405, { ok: false, error: "method_not_allowed" });
        const denied = denyWrite();
        if (denied) return denied;
        const payload = await readBodyJson(req);
        const result = transitionPieceStatus(pieceId, parts[3], payload);
        return reply(result.ok ? 200 : 400, result);
      }
      if (parts.length === 4 && parts[3] === "update") {
        if (req.method !== "POST") return reply(405, { ok: false, error: "method_not_allowed" });
        const denied = denyWrite();
        if (denied) return denied;
        const payload = await readBodyJson(req);
        const result = updatePieceFields(pieceId, payload);
        return reply(result.ok ? 200 : 400, result);
      }
    }
    return reply(404, { ok: false, error: "api_not_found" });
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/save-scrap-piece") {
    const denied = denyWrite();
    if (denied) return denied;
    const payload = await readBodyJson(req);
    const result = saveScrapPiece(payload);
    if (!result.ok && result.error === "already_exists") {
      return reply(409, result);
    }
    if (result.ok) invalidateRegistryCache();
    return reply(result.ok ? 200 : 400, result);
  }

  return false;
}

module.exports = {
  handlePieceRoutes
};
