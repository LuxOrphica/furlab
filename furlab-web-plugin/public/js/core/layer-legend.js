// Extracted from app.js (layer legend counters/titles)
(function (global) {
  function createLayerLegend(options) {
    const opts = options && typeof options === "object" ? options : {};
    const byId = typeof opts.byId === "function"
      ? opts.byId
      : (id) => global.document && global.document.getElementById(id);
    const getStats = typeof opts.getStats === "function"
      ? opts.getStats
      : (() => ({ fragmentsCount: 0, matchedPiecesCount: 0, manualBeforeApply: false }));
    const t = typeof opts.t === "function"
      ? opts.t
      : ((_, __, fallback) => fallback || "");

    function syncCounters() {
      const stats = getStats() || {};
      const matchedPiecesCount = Number(stats.matchedPiecesCount || 0);
      const manualBeforeApply = !!stats.manualBeforeApply;
      const fragLabel = byId("layerPieceBordersLabel");
      const pieceLabel = byId("layerAssignedPiecesLabel");
      const pieceToggle = byId("layerAssignedPieces");
      if (fragLabel) {
        fragLabel.textContent = t("layer_fragments_label", null, "Фрагменты");
      }
      if (pieceLabel) pieceLabel.textContent = `${t("layer_pieces_label", null, "Matched pieces")} (${matchedPiecesCount})`;
      if (pieceToggle) {
        pieceToggle.title = matchedPiecesCount > 0
          ? ""
          : t("layer_no_matched_pieces", null, "No matched pieces in current result");
      }
    }

    return { syncCounters };
  }

  global.FurLabLayerLegend = Object.assign({}, global.FurLabLayerLegend || {}, {
    createLayerLegend
  });
})(window);
