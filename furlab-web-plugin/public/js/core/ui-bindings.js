// Extracted from app.js: bulk UI event bindings.
(function (global) {
  function createUiBindings(options) {
    const opts = options && typeof options === "object" ? options : {};
    const byId = typeof opts.byId === "function" ? opts.byId : () => null;
    const api = typeof opts.api === "function" ? opts.api : async () => ({ ok: false, error: "api_unavailable" });
    const state = opts.state || {};
    const renderScene = typeof opts.renderScene === "function" ? opts.renderScene : () => {};
    const clampInputNumber = typeof opts.clampInputNumber === "function" ? opts.clampInputNumber : () => {};
    const previewIntarsiaFragmentsDraft = typeof opts.previewIntarsiaFragmentsDraft === "function" ? opts.previewIntarsiaFragmentsDraft : () => {};
    const setIntarsiaStepPhase = typeof opts.setIntarsiaStepPhase === "function" ? opts.setIntarsiaStepPhase : () => {};
    const runInventoryPickFlow = typeof opts.runInventoryPickFlow === "function" ? opts.runInventoryPickFlow : () => {};
    const closeInventoryStep1 = typeof opts.closeInventoryStep1 === "function" ? opts.closeInventoryStep1 : () => {};
    const closeInventoryStep2 = typeof opts.closeInventoryStep2 === "function" ? opts.closeInventoryStep2 : () => {};
    const openInventoryStep1 = typeof opts.openInventoryStep1 === "function" ? opts.openInventoryStep1 : () => {};
    const buildOracleCaseFromCurrentPreview = typeof opts.buildOracleCaseFromCurrentPreview === "function" ? opts.buildOracleCaseFromCurrentPreview : () => null;
    const downloadJsonFile = typeof opts.downloadJsonFile === "function" ? opts.downloadJsonFile : () => {};
    const requestInventoryManualSuggestions = typeof opts.requestInventoryManualSuggestions === "function" ? opts.requestInventoryManualSuggestions : async () => {};
    const recomputeInventoryManualVisibility = typeof opts.recomputeInventoryManualVisibility === "function" ? opts.recomputeInventoryManualVisibility : async () => {};
    const undoInventoryManualPlacement = typeof opts.undoInventoryManualPlacement === "function" ? opts.undoInventoryManualPlacement : async () => {};
    const closeReplaceCandidateModal = typeof opts.closeReplaceCandidateModal === "function" ? opts.closeReplaceCandidateModal : () => {};
    const closeLayoutTypePicker = typeof opts.closeLayoutTypePicker === "function" ? opts.closeLayoutTypePicker : () => {};
    const layoutTypePicker = opts.layoutTypePicker || null;
    const addLayoutByMode = typeof opts.addLayoutByMode === "function" ? opts.addLayoutByMode : () => {};
    const addMaterialById = typeof opts.addMaterialById === "function" ? opts.addMaterialById : async () => {};
    const isManualInventoryMode = typeof opts.isManualInventoryMode === "function" ? opts.isManualInventoryMode : () => false;
    const renderLayoutModeSwitch = typeof opts.renderLayoutModeSwitch === "function" ? opts.renderLayoutModeSwitch : () => {};
    const renderDetailZoneTree = typeof opts.renderDetailZoneTree === "function" ? opts.renderDetailZoneTree : () => {};
    const renderPropertyEditor = typeof opts.renderPropertyEditor === "function" ? opts.renderPropertyEditor : () => {};
    const syncFillTypeUi = typeof opts.syncFillTypeUi === "function" ? opts.syncFillTypeUi : () => {};
    const getPreviewToken = typeof opts.getPreviewToken === "function" ? opts.getPreviewToken : () => "";

    function mapLayoutModeToApplyType(mode) {
      const m = String(mode || "");
      if (m === "inventory") return "inventory_direct";
      if (m === "inventory_split_return") return "inventory_split_return";
      return m;
    }

    let intarsiaDraftPreviewTimer = null;
    const scheduleIntarsiaDraftPreview = (delayMs) => {
      if (intarsiaDraftPreviewTimer) clearTimeout(intarsiaDraftPreviewTimer);
      intarsiaDraftPreviewTimer = setTimeout(() => {
        intarsiaDraftPreviewTimer = null;
        const step1Backdrop = byId("inventoryStep1Backdrop");
        if (state.layoutMode === "intarsia" && step1Backdrop && step1Backdrop.style.display === "flex") {
          previewIntarsiaFragmentsDraft();
        }
      }, Math.max(0, Number(delayMs || 0)));
    };

    function bindMainControls() {
      byId("layerPattern").onchange = (e) => { state.layers.pattern = !!e.target.checked; renderScene(); };
      byId("layerZones").onchange = (e) => { state.layers.zones = !!e.target.checked; renderScene(); };
      byId("layerZoneMaterials").onchange = (e) => { state.layers.zoneMaterials = !!e.target.checked; renderScene(); };
      byId("layerSelection").onchange = (e) => { state.layers.selection = !!e.target.checked; renderScene(); };
      byId("layerGuides").onchange = (e) => { state.layers.guides = !!e.target.checked; renderScene(); };
      byId("layerVisibleArea").onchange = (e) => { state.layers.visibleArea = !!e.target.checked; renderScene(); };
      byId("layerPieceIntersections").onchange = (e) => { state.layers.pieceIntersections = !!e.target.checked; renderScene(); };
      byId("layerPieceBorders").onchange = (e) => { state.layers.pieceBorders = !!e.target.checked; renderScene(); };
      byId("layerAssignedPieces").onchange = (e) => { state.layers.assignedPieces = !!e.target.checked; renderScene(); };
      byId("layerPfullZ").onchange = (e) => { state.layers.pfullZ = !!e.target.checked; renderScene(); };
      byId("layerUsedGain").onchange = (e) => { state.layers.usedGain = !!e.target.checked; renderScene(); };
      byId("layerPcoreZ").onchange = (e) => { state.layers.pcoreZ = !!e.target.checked; renderScene(); };
      byId("layerVisibleCore").onchange = (e) => { state.layers.visibleCore = !!e.target.checked; renderScene(); };
      const layerSplitLeftoversEl = byId("layerSplitLeftovers"); if (layerSplitLeftoversEl) layerSplitLeftoversEl.onchange = (e) => { state.layers.splitLeftovers = !!e.target.checked; renderScene(); };
      byId("layerCoverageHoles").onchange = (e) => { state.layers.coverageHoles = !!e.target.checked; renderScene(); };
      byId("majorContoursOnly").onchange = (e) => { state.view.majorContoursOnly = !e.target.checked; renderScene(); };
      byId("zprjCompactView").onchange = (e) => { state.view.zprjCompactView = !!e.target.checked; renderScene(); };
      byId("partsMode").onchange = (e) => { state.view.partsMode = String(e.target.value || "main"); renderScene(); };
      byId("closedContoursOnly").onchange = (e) => { state.view.closedContoursOnly = !!e.target.checked; renderScene(); };
      byId("autoCloseContours").onchange = (e) => { state.view.autoCloseContours = !!e.target.checked; renderScene(); };
      byId("smartCloseGaps").onchange = (e) => { state.view.smartCloseGaps = !!e.target.checked; renderScene(); };
      byId("gapTolerance").onchange = (e) => { state.view.gapTolerance = Math.max(2, Number(e.target.value || 40)); renderScene(); };
      byId("rejectNoisyContours").onchange = (e) => { state.view.rejectNoisyContours = !!e.target.checked; renderScene(); };
      byId("highlightSelectedDetail").onchange = (e) => { state.view.highlightSelectedDetail = !!e.target.checked; renderScene(); };
      byId("patternNamesOnly").onchange = (e) => { state.view.patternNamesOnly = !!e.target.checked; renderScene(); };
      byId("minContourPoints").onchange = (e) => { state.view.minContourPoints = Math.max(4, Number(e.target.value || 40)); renderScene(); };
      byId("maxContours").onchange = (e) => { state.view.maxContours = Math.max(10, Number(e.target.value || 120)); renderScene(); };
      byId("showDetailLabels").onchange = (e) => { state.view.showDetailLabels = !!e.target.checked; renderScene(); };

      byId("fillRows").oninput = () => scheduleIntarsiaDraftPreview(120);
      byId("fillCols").oninput = () => scheduleIntarsiaDraftPreview(120);
      byId("fillGapX").oninput = () => scheduleIntarsiaDraftPreview(120);
      byId("fillGapY").oninput = () => scheduleIntarsiaDraftPreview(120);
      byId("fillCornerRadius").oninput = () => scheduleIntarsiaDraftPreview(120);
      byId("fillDensity").onblur = () => clampInputNumber("fillDensity", 0, 100, 50);
      byId("fillVariability").onblur = () => clampInputNumber("fillVariability", 0, 100, 50);
      byId("fillAnisotropy").onblur = () => clampInputNumber("fillAnisotropy", 0, 100, 50);
      byId("fillRows").onblur = () => {
        clampInputNumber("fillRows", 2, 20, 5);
        const step1Backdrop = byId("inventoryStep1Backdrop");
        if (state.layoutMode === "intarsia" && step1Backdrop && step1Backdrop.style.display === "flex") previewIntarsiaFragmentsDraft();
      };
      byId("fillCols").onblur = () => {
        clampInputNumber("fillCols", 2, 20, 5);
        const step1Backdrop = byId("inventoryStep1Backdrop");
        if (state.layoutMode === "intarsia" && step1Backdrop && step1Backdrop.style.display === "flex") previewIntarsiaFragmentsDraft();
      };
      byId("fillGapX").onblur = () => {
        clampInputNumber("fillGapX", 0, 1000, 0);
        const step1Backdrop = byId("inventoryStep1Backdrop");
        if (state.layoutMode === "intarsia" && step1Backdrop && step1Backdrop.style.display === "flex") previewIntarsiaFragmentsDraft();
      };
      byId("fillGapY").onblur = () => {
        clampInputNumber("fillGapY", 0, 1000, 0);
        const step1Backdrop = byId("inventoryStep1Backdrop");
        if (state.layoutMode === "intarsia" && step1Backdrop && step1Backdrop.style.display === "flex") previewIntarsiaFragmentsDraft();
      };
      byId("fillCornerRadius").onblur = () => {
        clampInputNumber("fillCornerRadius", 0, 1000, 0);
        const step1Backdrop = byId("inventoryStep1Backdrop");
        if (state.layoutMode === "intarsia" && step1Backdrop && step1Backdrop.style.display === "flex") previewIntarsiaFragmentsDraft();
      };

      byId("invLimit").onblur = () => clampInputNumber("invLimit", 10, 2000, 300);
      byId("invNapTol").oninput = () => {
        const el = byId("invNapTol");
        if (!el) return;
        el.dataset.userTouched = "1";
        if (state.layoutRun && typeof state.layoutRun === "object") {
          state.layoutRun.__napTolTouchedByUser = true;
        }
      };
      byId("invNapTol").onblur = () => clampInputNumber("invNapTol", 0, 180, 15);
      function syncMinAreaFromDimensions() {
        const w = Math.max(0, Number(byId("minFragmentWidthMm") && byId("minFragmentWidthMm").value || 0));
        const h = Math.max(0, Number(byId("minFragmentLengthMm") && byId("minFragmentLengthMm").value || 0));
        const el = byId("invMinArea");
        if (el) el.value = String(w * h);
      }
      byId("minFragmentWidthMm").onblur = () => { clampInputNumber("minFragmentWidthMm", 0, 10000, 100); syncMinAreaFromDimensions(); };
      byId("minFragmentLengthMm").onblur = () => { clampInputNumber("minFragmentLengthMm", 0, 10000, 100); syncMinAreaFromDimensions(); };
      syncMinAreaFromDimensions();
      byId("fillType").onchange = () => syncFillTypeUi();
      byId("inventoryScenario").onchange = () => syncFillTypeUi();
      byId("inventoryStep1RunBtn").onclick = () => {
        if (state.layoutMode === "intarsia") setIntarsiaStepPhase(1);
        runInventoryPickFlow();
      };
      byId("inventoryStep1IntarsiaAssignBtn").onclick = () => {
        if (state.layoutMode === "intarsia") {
          const frags = Array.isArray(state.layoutRun && state.layoutRun.fragments) ? state.layoutRun.fragments : [];
          if (!frags.length) {
            const workspaceInfo = byId("workspaceInfo");
            if (workspaceInfo) workspaceInfo.textContent = "Сначала выполните Шаг 1: сгенерируйте фрагменты.";
            setIntarsiaStepPhase(1);
            return;
          }
          setIntarsiaStepPhase(2);
        }
        runInventoryPickFlow({ intarsiaAssignOnly: true });
      };
      byId("inventoryStep1CancelBtn").onclick = () => closeInventoryStep1();
      byId("inventoryStep1CloseBtn").onclick = () => closeInventoryStep1();
      byId("inventoryStep2CloseBtn").onclick = () => closeInventoryStep2();
      byId("inventoryStep2CancelBtn").onclick = () => {
        closeInventoryStep2();
        state.layoutRun.status = "idle";
        renderScene();
      };
      byId("inventoryStep2BackBtn").onclick = () => {
        closeInventoryStep2();
        openInventoryStep1();
      };
      byId("inventoryStep2ExportCaseBtn").onclick = () => {
        const workspaceInfo = byId("workspaceInfo");
        // Prefer run-output export (contains solver geometry) over legacy oracle input snapshot
        const runOut = buildRunOutputExport && buildRunOutputExport();
        if (runOut) {
          const zoneId = Number(runOut.zone && runOut.zone.id || 0);
          const fileName = `voronoi_sa_run_zone_${zoneId}_${Date.now()}.json`;
          downloadJsonFile(fileName, runOut);
          if (workspaceInfo) workspaceInfo.textContent = `Экспортирован run output: ${fileName} (placements=${runOut.placements.length}, uncoveredComponents=${runOut.uncoveredComponents.length})`;
          return;
        }
        const caseObj = buildOracleCaseFromCurrentPreview();
        if (!caseObj) {
          if (workspaceInfo) workspaceInfo.textContent = "Экспорт case: нет активной зоны или пула кандидатов.";
          return;
        }
        const zoneId = Number(caseObj.zone && caseObj.zone.id || 0);
        const fileName = `oracle_case_zone_${zoneId}_${Date.now()}.json`;
        downloadJsonFile(fileName, caseObj);
        if (workspaceInfo) workspaceInfo.textContent = `Экспортирован case: ${fileName} (pieces=${caseObj.pieces.length})`;
      };
      const manualSuggestBtn = byId("inventoryManualSuggestBtn");
      if (manualSuggestBtn) manualSuggestBtn.onclick = () => { void requestInventoryManualSuggestions(); };
      const manualRecomputeBtn = byId("inventoryManualRecomputeBtn");
      if (manualRecomputeBtn) manualRecomputeBtn.onclick = () => { void recomputeInventoryManualVisibility(); };
      byId("replaceCandidateCloseBtn").onclick = () => closeReplaceCandidateModal();
      byId("replaceCandidateCancelBtn").onclick = () => closeReplaceCandidateModal();
      byId("layoutTypeCloseBtn").onclick = () => closeLayoutTypePicker();
      byId("layoutTypeCancelBtn").onclick = () => closeLayoutTypePicker();
      byId("layoutTypeAddBtn").onclick = async () => {
        const selectedKey = (layoutTypePicker && typeof layoutTypePicker.getSelectedKey === "function")
          ? String(layoutTypePicker.getSelectedKey() || "")
          : ((layoutTypePicker && typeof layoutTypePicker.getSelectedMode === "function")
              ? String(layoutTypePicker.getSelectedMode() || "")
              : "");
        if (!selectedKey) return;
        if (String(state.libraryPickerMode || "layouts") === "materials") {
          await addMaterialById(selectedKey);
          closeLayoutTypePicker();
          return;
        }
        const selectedMode = selectedKey;
        if (!selectedMode) return;
        addLayoutByMode(selectedMode);
        closeLayoutTypePicker();
      };
      byId("inventoryStep2ApplyBtn").onclick = async () => {
        if (byId("inventoryStep2ApplyBtn").disabled) {
          const workspaceInfo = byId("workspaceInfo");
          if (workspaceInfo) workspaceInfo.textContent = "Нельзя применить: зона покрыта не полностью.";
          return;
        }
        if (isManualInventoryMode()) {
          await recomputeInventoryManualVisibility();
          if (state.layoutRun && state.layoutRun.manual) {
            state.layoutRun.manual.activePiece = null;
            state.layoutRun.manual.lastEvalContours = null;
            state.layoutRun.manual.selectedCandidateTag = "";
            state.layoutRun.manual.statusNote = "manual_editing";
          }
          state.layoutRun.status = "preview";
          closeInventoryStep2();
          const workspaceInfo = byId("workspaceInfo");
          if (workspaceInfo) workspaceInfo.textContent = "Manual mode: place pieces, then use Evaluate/Apply in tray.";
          renderScene();
          return;
        }
        const layoutType = mapLayoutModeToApplyType(state.layoutMode);
        const selectedZoneId = Number(state.layoutRun && state.layoutRun.selectedZoneId || state.selectedZoneId || 0) || null;
        const applyRes = await api("/api/layout/modes/apply", "POST", {
          layoutType,
          previewToken: String(getPreviewToken() || ""),
          selectedZoneId,
          resultStatus: String(state.layoutRun && state.layoutRun.resultStatus || "ok"),
          stats: state.layoutRun && state.layoutRun.stats ? state.layoutRun.stats : {},
          placements: Array.isArray(state.layoutRun && state.layoutRun.placements) ? state.layoutRun.placements : [],
          fragments: Array.isArray(state.layoutRun && state.layoutRun.fragments) ? state.layoutRun.fragments : [],
          candidatePool: Array.isArray(state.layoutRun && state.layoutRun.candidatePool) ? state.layoutRun.candidatePool : [],
          strategy: String(state.layoutRun && state.layoutRun.strategy || state.layoutMode || ""),
          inventoryScenario: String(state.layoutRun && state.layoutRun.inventoryScenario || "A"),
          paramsSnapshot: state.layoutRun && state.layoutRun.paramsSnapshot ? state.layoutRun.paramsSnapshot : null,
          zone: selectedZoneId ? { id: selectedZoneId } : null
        });
        if (!applyRes || applyRes.ok !== true) {
          const workspaceInfo = byId("workspaceInfo");
          if (workspaceInfo) workspaceInfo.textContent = `Apply failed: ${String(applyRes && (applyRes.message || applyRes.error) || "unknown")}`;
          return;
        }
        state.layoutRun.serverApply = applyRes;
        state.layoutRun.status = "applied";
        closeInventoryStep2();
        const workspaceInfo = byId("workspaceInfo");
        if (workspaceInfo) workspaceInfo.textContent = `???????? ?????????: ${state.layoutRun.fragments.length} ??????????`;
        renderScene();
      };
      byId("layoutModeSwitch").querySelectorAll("button[data-panel]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.uiPanel = String(btn.getAttribute("data-panel") || "zones");
          if (state.uiPanel === "materials" && !state.selectedMaterialId && Array.isArray(state.zones)) {
            const currentZone = state.zones.find((item) => Number(item && item.id || 0) === Number(state.selectedZoneId || 0)) || null;
            if (currentZone && currentZone.materialId) {
              state.selectedMaterialId = String(currentZone.materialId);
            }
          }
          renderLayoutModeSwitch();
          renderDetailZoneTree();
          renderPropertyEditor();
        });
      });
    }

    return { bindMainControls };
  }

  global.FurLabUiBindings = Object.assign({}, global.FurLabUiBindings || {}, {
    createUiBindings
  });
})(window);
