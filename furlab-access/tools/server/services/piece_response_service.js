"use strict";

function parsePieceQueryFlags(reqUrl) {
  const includeReservation =
    reqUrl.searchParams.get("includeReservation") === "1" ||
    reqUrl.searchParams.get("include") === "reservation" ||
    reqUrl.searchParams.get("include") === "all";
  const includeHistory =
    reqUrl.searchParams.get("includeHistory") === "1" ||
    reqUrl.searchParams.get("include") === "history" ||
    reqUrl.searchParams.get("include") === "all";
  const lite =
    reqUrl.searchParams.get("lite") === "1" ||
    reqUrl.searchParams.get("lite") === "true" ||
    reqUrl.searchParams.get("mode") === "lite";
  const forceRefresh =
    reqUrl.searchParams.get("refresh") === "1" ||
    reqUrl.searchParams.get("force") === "1" ||
    reqUrl.searchParams.get("refresh") === "true" ||
    reqUrl.searchParams.get("force") === "true";
  return { includeReservation, includeHistory, lite, forceRefresh };
}

function loadPieceResponse(ctx) {
  const {
    reqUrl,
    pieceId,
    loadPieceById,
    loadPieceBundleById,
    loadPieceReservationById,
    loadPieceHistoryById
  } = ctx;
  const { includeReservation, includeHistory, lite, forceRefresh } = parsePieceQueryFlags(reqUrl);
  console.log(
    `[ui-lab] piece request url=${reqUrl.pathname}${reqUrl.search}; includeReservation=${includeReservation ? 1 : 0}; includeHistory=${includeHistory ? 1 : 0}; lite=${lite ? 1 : 0}; forceRefresh=${forceRefresh ? 1 : 0}; id=${pieceId}`
  );

  const t0 = Date.now();
  let piece = loadPieceById(pieceId, { includeReservation: false, lite, force: forceRefresh });
  if (!piece.ok && (includeReservation || includeHistory)) {
    // Fallback to bundle reader for compatibility on edge cases.
    piece = loadPieceBundleById(pieceId, { includeReservation, includeHistory });
  }
  if (!piece.ok) {
    console.warn(
      `[ui-lab] piece failed id=${pieceId}; totalMs=${Date.now() - t0}; err=${piece.error}; source=${piece.diag?.source || "?"}; copyMs=${piece.diag?.copyMs ?? "?"}; scriptMs=${piece.diag?.scriptMs ?? "?"}; parseMs=${piece.diag?.parseMs ?? "?"}`
    );
    return { ok: false, code: 400, payload: piece };
  }

  const payload = { ...piece };
  const stage = {
    piece: piece.diag || { source: "?", copyMs: 0, scriptMs: 0, parseMs: 0 },
    reservation: null,
    history: null
  };

  if (includeReservation) {
    if (Object.prototype.hasOwnProperty.call(piece, "reservation")) {
      payload.reservation = piece.reservation || null;
      if (payload.item && typeof payload.item === "object") {
        payload.item = { ...payload.item, reservation: piece.reservation || null };
      }
      stage.reservation = piece.diag || null;
    } else {
      const reservation = loadPieceReservationById(pieceId);
      stage.reservation = reservation.diag || null;
      if (reservation.ok) {
        payload.reservation = reservation.reservation || null;
        if (payload.item && typeof payload.item === "object") {
          payload.item = { ...payload.item, reservation: reservation.reservation || null };
        }
      } else {
        payload.reservationError = reservation.error || "reservation_failed";
      }
    }
  }

  if (includeHistory) {
    if (Object.prototype.hasOwnProperty.call(piece, "history")) {
      payload.history = piece.history || [];
      if (payload.item && typeof payload.item === "object") {
        payload.item = { ...payload.item, history: piece.history || [] };
      }
      stage.history = piece.diag || null;
    } else {
      const history = loadPieceHistoryById(pieceId, "");
      stage.history = history.diag || null;
      if (history.ok) {
        payload.history = history.items || [];
        if (payload.item && typeof payload.item === "object") {
          payload.item = { ...payload.item, history: history.items || [] };
        }
      } else {
        payload.historyError = history.error || "history_failed";
      }
    }
  }

  const totalMs = Date.now() - t0;
  console.log(
    `[ui-lab] piece response keys top={${Object.keys(payload).join(",")}}; item={${payload.item && typeof payload.item === "object" ? Object.keys(payload.item).join(",") : ""}}`
  );
  console.log(
    `[ui-lab] piece loaded id=${pieceId}; includeReservation=${includeReservation ? 1 : 0}; includeHistory=${includeHistory ? 1 : 0}; totalMs=${totalMs}; piece(source=${stage.piece?.source || "?"},copyMs=${stage.piece?.copyMs ?? "?"},scriptMs=${stage.piece?.scriptMs ?? "?"},parseMs=${stage.piece?.parseMs ?? "?"})` +
    `${includeReservation ? `; reservation(source=${stage.reservation?.source || "?"},copyMs=${stage.reservation?.copyMs ?? "?"},scriptMs=${stage.reservation?.scriptMs ?? "?"},parseMs=${stage.reservation?.parseMs ?? "?"})` : ""}` +
    `${includeHistory ? `; history(source=${stage.history?.source || "?"},copyMs=${stage.history?.copyMs ?? "?"},scriptMs=${stage.history?.scriptMs ?? "?"},parseMs=${stage.history?.parseMs ?? "?"})` : ""}`
  );
  return { ok: true, code: 200, payload };
}

module.exports = {
  loadPieceResponse
};
