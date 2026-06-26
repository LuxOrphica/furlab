// Extracted from app.js (inventory step2 modal UI wiring)
(function (global) {
  function createInventoryStep2Ui(options) {
    const opts = options && typeof options === "object" ? options : {};
    const byId = typeof opts.byId === "function"
      ? opts.byId
      : (id) => global.document && global.document.getElementById(id);
    const t = typeof opts.t === "function"
      ? opts.t
      : ((_, __, fallback) => fallback || "");
    const isManualInventoryMode = typeof opts.isManualInventoryMode === "function"
      ? opts.isManualInventoryMode
      : (() => false);
    const renderPlacementExplain = typeof opts.renderPlacementExplain === "function"
      ? opts.renderPlacementExplain
      : (() => {});

    function setMetricRowVisible(valueId, visible) {
      const el = byId(valueId);
      if (!el || !el.parentElement) return;
      el.parentElement.style.display = visible ? "" : "none";
    }

    function syncModeUi() {
      const manual = isManualInventoryMode();
      setMetricRowVisible("invTotalFragments", !manual);
      setMetricRowVisible("invCoveragePercent", !manual);
      setMetricRowVisible("invResidualArea", !manual);
      setMetricRowVisible("invUsefulArea", !manual);
      setMetricRowVisible("invUsedScrapArea", !manual);
      setMetricRowVisible("invScrapUtilization", !manual);
      setMetricRowVisible("invScrapWaste", !manual);
      setMetricRowVisible("invOverlapArea", !manual);
      setMetricRowVisible("invViolations", !manual);
      setMetricRowVisible("invIntersections", !manual);
      setMetricRowVisible("invUncovered", !manual);
      setMetricRowVisible("invCandidateAreaBudget", !manual);
      setMetricRowVisible("invDbCandidates", !manual);
      setMetricRowVisible("invCompatibleCandidates", !manual);
      setMetricRowVisible("invStrategyUsed", !manual);
      setMetricRowVisible("invMatchedPct", !manual);
      setMetricRowVisible("invKpiCoveragePct", !manual);
      setMetricRowVisible("invTailCoverageStart", !manual);
      setMetricRowVisible("invTailOversizeAlpha", !manual);
      setMetricRowVisible("invRejectedOversize", !manual);
      setMetricRowVisible("invRejectedOverlap", !manual);
      setMetricRowVisible("invRejectedLowGain", !manual);
      setMetricRowVisible("invRejectedOutside", !manual);

      const exportBtnWrap = byId("inventoryStep2ExportCaseBtn") && byId("inventoryStep2ExportCaseBtn").parentElement;
      if (exportBtnWrap) exportBtnWrap.style.display = manual ? "none" : "";

      const debugHeader = byId("invDebugInfo") && byId("invDebugInfo").previousElementSibling;
      const debugBody = byId("invDebugInfo");
      const tagsHeader = byId("invUsedTags") && byId("invUsedTags").previousElementSibling;
      const tagsBody = byId("invUsedTags");
      const matchBlock = byId("invPlacementMatchBlock");
      const explainBlock = byId("invPlacementExplainBlock");
      const coverageBlock = byId("invFragmentCoverageBlock");
      if (debugHeader) debugHeader.style.display = manual ? "none" : "";
      if (debugBody) debugBody.style.display = manual ? "none" : "";
      if (tagsHeader) tagsHeader.style.display = manual ? "none" : "";
      if (tagsBody) tagsBody.style.display = manual ? "none" : "";
      if (matchBlock) matchBlock.style.display = manual ? "none" : "";
      if (explainBlock) explainBlock.style.display = manual ? "none" : "";
      if (coverageBlock) coverageBlock.style.display = manual ? "none" : "";

      const headTitle = byId("inventoryStep2Head") ? byId("inventoryStep2Head").querySelector("span") : null;
      if (headTitle) {
        headTitle.textContent = manual
          ? t("step2_title_manual", null, "Step 2. Manual pick")
          : t("step2_title_auto", null, "Step 2. Preview and tune");
      }

      const backBtn = byId("inventoryStep2BackBtn");
      if (backBtn) {
        backBtn.style.display = "";
        backBtn.textContent = t("btn_back", null, "Back");
      }
      const applyBtn = byId("inventoryStep2ApplyBtn");
      if (applyBtn) applyBtn.textContent = manual ? "OK" : t("btn_apply", null, "Apply");
      const cancelBtn = byId("inventoryStep2CancelBtn");
      if (cancelBtn) cancelBtn.textContent = t("btn_cancel", null, "Cancel");

      const recBtn = byId("inventoryManualRecomputeBtn");
      const stateEl = byId("inventoryManualState");
      const metricsEl = byId("inventoryManualMetrics");
      if (recBtn) recBtn.style.display = manual ? "none" : "";
      if (stateEl) stateEl.style.display = manual ? "none" : "";
      if (metricsEl) metricsEl.style.display = manual ? "none" : "";
      renderPlacementExplain();
    }

    return {
      setMetricRowVisible,
      syncModeUi
    };
  }

  global.FurLabInventoryStep2Ui = Object.assign({}, global.FurLabInventoryStep2Ui || {}, {
    createInventoryStep2Ui
  });
})(window);
