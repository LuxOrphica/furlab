// In FurLab, default grain/nap direction in 2D is vertical down.
    const DEFAULT_NAP_DIRECTION_DEG = 90;
    const INVENTORY_OPTIMIZATION_DEFAULT = "sew_quality_economy";
    const INVENTORY_OPTIMIZATION_PROFILE = {
      key: "sew_quality_economy",
      label: "Sew quality / Economy",
      description: "Goals: full coverage, fewer pieces and seams, higher utilization.",
      options: {
        strictCoverage: true,
        strictCoverageHard: true,
        coverageTarget: 0.99999,
        coverageEps: 0.0005,
        solverMode: "phasedV1",
        maxSolveMs: 45000,
        hardMaxSolveMs: 90000,
        maxPieces: 160,
        maxPointsPerCandidate: 120,
        minGainAreaMm2: 60,
        objectiveMode: "oneGood",
        objectiveMinEfficiency: 0.82,
        objectivePiecePenalty: 0.18,
        objectiveFragmentPenalty: 0.28,
        minEfficiencyBase: 0.20,
        phaseAEndCoverage: 0.22,
        phaseAInsideMin: 0.90,
        phaseAMaxOverlap: 0.08,
        phaseBEfficiencyMin: 0.42,
        phaseAMinPieces: 1,
        phaseAMinGainMm2: 4000,
        phaseAMinGainShare: 0.03,
        minGainVisibleMm2: 10000,
        minSpanMm: 100,
        enforceMinGainByArea: true,
        coverageFirst: false,
        enforceTimeBudget: true,
        maxRepairAttempts: 4,
        repairWindow: 28,
        tailCoverageStart: 0.93,
        tailResidualRatio: 0.03,
        tailResidualLooseRatio: 0.015,
        tailMinEfficiency: 0.30,
        tailMinEfficiencyLoose: 0.18,
        pocketModeStartRatio: 0.08,
        pocketAreaK: 2.4,
        tailOversizeAlpha: 2.4,
        tailStallTrigger: 3,
        tailPenaltyBoost: 2.2,
        tailMaxPlacements: 14,
        tailCapResidualRatio: 0.03,
        tailMinGainShare: 0.22,
        tailMinGainCapMm2: 280,
        layerPolicy: "first_on_top",
        maxPieceOverlap: 0.95,
        overlapPenalty: 0.25,
        outsidePenalty: 0.05,
        minInsideRatio: 0.01
      }
    };
    const ENGINEERING_STYLES = (window.FurLabStyles && window.FurLabStyles.ENGINEERING_STYLES) || {};
    const i18nRu = window.FurLabI18nRu && typeof window.FurLabI18nRu === "object" ? window.FurLabI18nRu : {};
    const t = typeof i18nRu.t === "function"
      ? (key, vars, fallback) => i18nRu.t(key, vars, fallback)
      : (_key, _vars, fallback) => String(fallback || "");

    INVENTORY_OPTIMIZATION_PROFILE.label = t("optimization_profile_label", null, "Sew quality / Economy");
    INVENTORY_OPTIMIZATION_PROFILE.description = t(
      "optimization_profile_description",
      null,
      "Выкладка строится из контуров кусков инвентаря. Алгоритм жадно подбирает куски, минимизируя непокрытый остаток."
    );

    let discoveredFiles = [];
    let discoveredZprjFile = "";
    let previewToken = "";
    let previewSourceType = "dxf";
    let previewItems = [];
    let selectedIndexes = new Set();
    let activePreviewIndex = null;

    const state = (window.FurLabState && typeof window.FurLabState.createInitialState === "function")
      ? window.FurLabState.createInitialState(DEFAULT_NAP_DIRECTION_DEG)
      : {};
    const progressApi = window.FurLabProgress || {};
    const reportsState = { model: null, selectedDetailId: null };
    if (window.FurLabReports) window.FurLabReports.init({ state, reportsState, getSelectedLayoutEntry: () => getSelectedLayoutEntry() });


    function byId(id) { return document.getElementById(id); }
    function getHandleConfig() {
      const s = Math.max(0.5, Math.min(3, Number(state.ui && state.ui.handleScale) || 1));
      return {
        vertexR:        4 * s,        // normal vertex visual radius
        boundaryR:      5.5 * s,      // shared/part boundary vertex
        hoveredR:       6.5 * s,      // hovered vertex
        activeR:        7.5 * s,      // selected vertex
        activeGlowR:    10 * s,       // glow behind active vertex
        dotR:           1.4 * s,      // center dot (non-active)
        dotActiveR:     2 * s,        // center dot (active)
        dotHoveredR:    1.7 * s,      // center dot (hovered)
        curveHandleR:   5.5 * s,      // curve handle visible circle
        curveGlowR:     9 * s,        // curve handle hit/glow area
        curveCenterR:   5 * s,        // selected vertex in curve mode
        addVertexR:     4.5 * s,      // edge hover marker (add-vertex)
        addVertexGlowR: 8 * s,        // edge hover glow
        draftDotR:      3 * s,        // draft zone dot
        strokeW:        1.4 * s,      // boundary vertex stroke
        strokeWActive:  1.6 * s,      // active vertex stroke
      };
    }
    let _statusToastTimer = null;
    function showStatusToast(text, durationMs) {
      const el = document.getElementById("statusToast");
      if (!el) return;
      el.textContent = text || "";
      el.style.display = text ? "block" : "none";
      if (_statusToastTimer) { clearTimeout(_statusToastTimer); _statusToastTimer = null; }
      if (text && durationMs > 0) {
        _statusToastTimer = setTimeout(() => { el.style.display = "none"; _statusToastTimer = null; }, durationMs);
      }
    }
    // Proxy workspaceInfo so all .textContent assignments go to toast
    window.addEventListener("DOMContentLoaded", function patchWorkspaceInfo() {
      const real = document.getElementById("workspaceInfo");
      if (!real) return;
      Object.defineProperty(real, "textContent", {
        set(v) { showStatusToast(v, v ? 6000 : 0); },
        get() { const t = document.getElementById("statusToast"); return t ? t.textContent : ""; },
        configurable: true
      });
    }, { once: true });
    // §3.9 Precision Aids — статус-строка редактора
    function setPrecisionAid(data) {
      const bar = document.getElementById("precisionBar");
      if (!bar) return;
      if (!data) { bar.style.display = "none"; bar.textContent = ""; return; }
      const { tool, zoneId, ring, vertexIndex, x, y, dx, dy, boundaryType, affectedCount, lengthMm, angleDeg } = data;
      const parts = [];
      if (tool) parts.push(tool);
      if (zoneId) parts.push("Зона " + zoneId);
      if (ring) parts.push(ring);
      if (Number.isFinite(vertexIndex)) parts.push("v" + vertexIndex);
      if (Number.isFinite(x) && Number.isFinite(y)) parts.push("x = " + x.toFixed(2) + " мм y = " + y.toFixed(2) + " мм");
      if (Number.isFinite(dx) && Number.isFinite(dy)) parts.push("dx " + (dx >= 0 ? "+" : "") + dx.toFixed(2) + " мм dy " + (dy >= 0 ? "+" : "") + dy.toFixed(2) + " мм");
      if (boundaryType) parts.push(boundaryType);
      if (Number.isFinite(affectedCount) && affectedCount > 0) parts.push("affectedZones = " + affectedCount);
      if (Number.isFinite(lengthMm)) parts.push("L = " + lengthMm.toFixed(2) + " мм");
      if (Number.isFinite(angleDeg)) parts.push(angleDeg.toFixed(1) + "°");
      bar.textContent = parts.join(" | ");
      bar.style.display = parts.length ? "" : "none";
    }

    async function refreshBuildTag() {
      const tagNode = byId("buildTag");
      if (!tagNode) return;
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        const j = await r.json();
        const id = String(j && j.buildId ? j.buildId : "unknown");
        tagNode.textContent = `build: ${id}`;
      } catch (_) {
        tagNode.textContent = "build: unavailable";
      }
    }
    const parseLocaleNumber = (...a) => window.FurLabUtils.parseLocaleNumber(...a);
    function getCurrentManualAllowanceMm() {
      const fromLayoutEditor = parseLocaleNumber(byId("layoutAllowanceInput") && byId("layoutAllowanceInput").value, null);
      if (Number.isFinite(Number(fromLayoutEditor))) return Math.max(0, Number(fromLayoutEditor));
      const fromStepInput = parseLocaleNumber(byId("pieceSeamReserveMm") && byId("pieceSeamReserveMm").value, null);
      if (Number.isFinite(Number(fromStepInput))) return Math.max(0, Number(fromStepInput));
      const fromInvReadonly = parseLocaleNumber(byId("invAllowanceMm") && byId("invAllowanceMm").value, null);
      if (Number.isFinite(Number(fromInvReadonly))) return Math.max(0, Number(fromInvReadonly));
      const fromState = parseLocaleNumber(state.layoutRun && state.layoutRun.allowanceMm, null);
      if (Number.isFinite(Number(fromState))) return Math.max(0, Number(fromState));
      return 12;
    }
    const normalizeDeg = (...a) => window.FurLabUtils.normalizeDeg(...a);
    function getZoneNapDirectionDeg(zone) {
      return normalizeDeg(zone && zone.napDirectionDeg, DEFAULT_NAP_DIRECTION_DEG);
    }
    function show(id, obj) {
      const el = byId(id);
      const text = JSON.stringify(obj, null, 2);
      el.textContent = text;
      el.style.display = text ? "block" : "none";
    }
    const safeText = (v) => window.FurLabUtils.safeText(v);
    const escapeHtml = (v) => window.FurLabUtils.escapeHtml(v);
    // reportsState is declared above (before FurLabReports.init)
    const REPORT_MIN_FRAGMENT_AREA_MM2 = 50;
    function getLayoutSnapshotForReports(entry) {
      const e = entry && typeof entry === "object" ? entry : null;
      if (!e) return null;
      if (Number(state.selectedLayoutId || 0) === Number(e.id || 0) && state.layoutRun && typeof state.layoutRun === "object") {
        return {
          selectedZoneId: Number(e.boundZoneId || state.layoutRun.selectedZoneId || state.selectedZoneId || 0) || null,
          selectedDetailId: Number(e.boundDetailId || state.selectedDetailId || 0) || null,
          layoutRun: state.layoutRun
        };
      }
      if (e.runtimeSnapshot && typeof e.runtimeSnapshot === "object" && e.runtimeSnapshot.layoutRun) {
        return e.runtimeSnapshot;
      }
      return null;
    }
    function findPlacementForFragmentInSnapshot(snapshot, fragmentOrId) {
      const snap = snapshot && typeof snapshot === "object" ? snapshot : null;
      const placements = Array.isArray(snap && snap.layoutRun && snap.layoutRun.placements) ? snap.layoutRun.placements : [];
      const fragments = Array.isArray(snap && snap.layoutRun && snap.layoutRun.fragments) ? snap.layoutRun.fragments : [];
      const frag = (fragmentOrId && typeof fragmentOrId === "object")
        ? fragmentOrId
        : fragments.find((f) => Number(f && f.id || 0) === Number(fragmentOrId || 0));
      if (!frag) return null;
      const ownerPlacementIndex = Number(frag.ownerPlacementIndex);
      if (Number.isFinite(ownerPlacementIndex) && ownerPlacementIndex >= 0 && ownerPlacementIndex < placements.length) {
        return placements[ownerPlacementIndex] || null;
      }
      const ownerPlacementId = Number(frag.ownerPlacementId || 0);
      if (ownerPlacementId) {
        return placements.find((p) => Number(p && p.fragmentId || 0) === ownerPlacementId) || null;
      }
      const fragId = Number(frag.id || 0);
      return placements.find((p) => Number(p && p.fragmentId || 0) === fragId) || null;
    }
    // Reports functions delegated to window.FurLabReports (core/reports.js)
    const canOpenReports = () => window.FurLabReports ? window.FurLabReports.canOpenReports() : false;
    function isInventoryModeForReports(mode) {
      const m = String(mode || "").trim().toLowerCase();
      return m === "inventory_manual" || m === "inventory_direct" || m === "inventory_split_return";
    }
    const escapeCsv = (v) => window.FurLabUtils.escapeCsv(v);
    const napSymbolByDeg = (d) => window.FurLabUtils.napSymbolByDeg(d);
    const finiteNumOrNaN = (v) => window.FurLabUtils.finiteNumOrNaN(v);
    const normalizeContourArrayForReports = (raw) => window.FurLabUtils.normalizeContourArray(raw);
    const buildReportsModel = () => window.FurLabReports ? window.FurLabReports.buildReportsModel() : null;
    const renderReportsPrintAll = (model) => window.FurLabReports && window.FurLabReports.renderReportsPrintAll(model);
    const renderReportsView = (detailId) => window.FurLabReports && window.FurLabReports.renderReportsView(detailId);
    const updateReportsButtonState = () => window.FurLabReports && window.FurLabReports.updateReportsButtonState();
    const closeReportsModal = () => window.FurLabReports && window.FurLabReports.closeReportsModal();
    const openReportsModal = () => window.FurLabReports && window.FurLabReports.openReportsModal();

    function findPlacementForFragment(fragmentOrId) {
      const placements = Array.isArray(state.layoutRun.placements) ? state.layoutRun.placements : [];
      const frag = (fragmentOrId && typeof fragmentOrId === "object")
        ? fragmentOrId
        : (Array.isArray(state.layoutRun.fragments)
          ? state.layoutRun.fragments.find((f) => Number(f.id || 0) === Number(fragmentOrId || 0))
          : null);
      if (!frag) return null;
      const ownerPlacementIndex = Number(frag.ownerPlacementIndex);
      if (Number.isFinite(ownerPlacementIndex) && ownerPlacementIndex >= 0 && ownerPlacementIndex < placements.length) {
        return placements[ownerPlacementIndex] || null;
      }
      const ownerPlacementId = Number(frag.ownerPlacementId);
      if (Number.isFinite(ownerPlacementId)) {
        const byOwner = placements.find((p) => Number(p && p.fragmentId || 0) === ownerPlacementId);
        if (byOwner) return byOwner;
        return null;
      }
      const fragId = Number(frag.id || 0);
      return placements.find((p) => Number(p && p.fragmentId || 0) === fragId) || null;
    }
    let coverSolverWorker = null;
    let coverWorkerSeq = 1;
    let inventoryProgressStartedAt = 0;
    let inventoryProgressTimerId = null;
    let inventoryProgressLastTs = 0;
    let inventoryProgressLastSig = "";
    let inventoryRunSeq = 0;
    let inventoryLiveHistory = [];
    let inventoryLiveLastPhase = "";
    let inventoryLiveLastReason = "";
    let inventoryLiveLastEvalBucket = -1;
    let inventoryLiveLastRenderAt = 0;
    let intarsiaStepPhase = 1;
    let manualEvalSeq = 0;
    let manualEvalDebounceId = null;
    const inventoryProgressController = (
      window.FurLabProgressController &&
      typeof window.FurLabProgressController.createProgressController === "function"
    )
      ? window.FurLabProgressController.createProgressController({
        fetch: (...args) => fetch(...args),
        setProgress: (percent, title) => setInventoryProgress(percent, title),
        onEvent: (payload) => handleInventoryProgressEvent(payload),
        setLiveText: (text) => {
          setInventoryProgressStatus(text);
        }
      })
      : null;
    const inventoryProgressView = (
      window.FurLabProgressView &&
      typeof window.FurLabProgressView.createProgressView === "function"
    )
      ? window.FurLabProgressView.createProgressView({ byId })
      : null;
    const inventoryProgressUi = (
      window.FurLabInventoryProgressUi &&
      typeof window.FurLabInventoryProgressUi.createInventoryProgressUi === "function"
    )
      ? window.FurLabInventoryProgressUi.createInventoryProgressUi({
        byId,
        onStepUpdate: (titleText, p) => {
          if (titleText && inventoryProgressView && typeof inventoryProgressView.updateSteps === "function") {
            inventoryProgressView.updateSteps(titleText, p);
          }
        }
      })
      : null;
    const inventoryModalDragApi = window.FurLabInventoryModalDrag || {};
    const inventoryModalDrag = (typeof inventoryModalDragApi.createInventoryModalDrag === "function")
      ? inventoryModalDragApi.createInventoryModalDrag({ byId })
      : null;
    const inventoryStepModalBridgeApi = window.FurLabInventoryStepModalBridge || {};
    const inventoryStepModalBridge = (typeof inventoryStepModalBridgeApi.createInventoryStepModalBridge === "function")
      ? inventoryStepModalBridgeApi.createInventoryStepModalBridge({ inventoryModalDrag })
      : {};
    const NOOP = () => {};
    const ensureInventoryStep1ModalPosition = inventoryStepModalBridge.ensureInventoryStep1ModalPosition || NOOP;
    const setupInventoryStep1Drag = inventoryStepModalBridge.setupInventoryStep1Drag || NOOP;
    const prepareInventoryStep2Modal = inventoryStepModalBridge.prepareInventoryStep2Modal || NOOP;
    const manualTrayInteractionsApi = window.FurLabManualTrayInteractions || {};
    const manualTrayViewApi = window.FurLabManualTrayView || {};
    const manualTrayView = (typeof manualTrayViewApi.createManualTrayView === "function")
      ? manualTrayViewApi.createManualTrayView({ t })
      : null;
    const manualTrayInteractions = (typeof manualTrayInteractionsApi.createManualTrayInteractions === "function")
      ? manualTrayInteractionsApi.createManualTrayInteractions({
        byId,
        isManualInventoryMode: () => isManualInventoryMode(),
        screenToWorld: (sx, sy) => screenToWorld(sx, sy),
        onPickByTag: (tag, world) => {
          const pool = Array.isArray(state.layoutRun && state.layoutRun.candidatePool) ? state.layoutRun.candidatePool : [];
          const picked = pool.find((c) => String(c && (c.inventoryTag || c.id) || "") === String(tag || "")) || null;
          if (!picked) return null;
          addManualPlacementFromCandidate(picked, world);
          return picked;
        },
        onRenderTray: () => {
          renderManualTrayIntoRoot();
        }
      })
      : null;
    const intarsiaPreviewApi = window.FurLabIntarsiaPreview || {};
    const intarsiaPreview = (typeof intarsiaPreviewApi.createIntarsiaPreview === "function")
      ? intarsiaPreviewApi.createIntarsiaPreview({
        state,
        byId,
        generateFragmentsForZone: (...args) => generateFragmentsForZone(...args),
        refreshIntarsiaDerivedFragmentLimits: () => refreshIntarsiaDerivedFragmentLimits(),
        renderScene: () => renderScene(),
        getEffectiveZonePoints: (zone) => getEffectiveZonePoints(zone)
      })
      : null;
    const detailZoneTreeViewApi = window.FurLabDetailZoneTreeView || {};
    const detailZoneTreeView = (typeof detailZoneTreeViewApi.createDetailZoneTreeView === "function")
      ? detailZoneTreeViewApi.createDetailZoneTreeView({
        byId,
        state,
        openLayoutTypePicker: () => openLayoutTypePicker(),
        applyLayoutMode: (mode) => applyLayoutMode(mode),
        getLayoutModeTitle: (mode) => getLayoutModeTitle(mode),
        getLayoutModeThumbSvg: (mode) => getLayoutModeThumbSvg(mode),
        renderLayoutModeSwitch: () => renderLayoutModeSwitch(),
        renderPropertyEditor: () => renderPropertyEditor(),
        renderScene: () => renderScene(),
        fitBBoxToView: (bbox) => fitBBoxToView(bbox),
        contourThumbSvg: (points, closed, holes) => contourThumbSvg(points, closed, holes),
        fitPointsToView: (points) => fitPointsToView(points),
        findPlacementForFragment: (fragmentOrId) => findPlacementForFragment(fragmentOrId),
        saveLayoutEntry: (entry) => saveLayoutEntry(entry),
        openLayoutEntry: (entry) => openLayoutEntry(entry),
        selectLayoutEntry: (entry) => selectLayoutEntry(entry),
        deleteLayoutEntry: (entry) => deleteLayoutEntry(entry),
        openZoneContextMenu: (payload) => openZoneContextMenu(payload),
        openMaterialLibrary: (zone) => openMaterialLibrary(zone),
        buildMaterialPreviewSvgMarkup: (material) => buildMaterialPreviewSvgMarkup(material),
        getFurMaterialById: (materialId) => getFurMaterialById(materialId),
        removeProjectMaterialById: (materialId) => removeProjectMaterialById(materialId),
        assignMaterialToZone: (zone, material) => assignMaterialToZone(zone, material)
      })
      : null;
    const propertyEditorViewApi = window.FurLabPropertyEditorView || {};
    const propertyEditorView = (typeof propertyEditorViewApi.createPropertyEditorView === "function")
      ? propertyEditorViewApi.createPropertyEditorView({
        byId,
        state,
        getZoneNapDirectionDeg: (zone) => getZoneNapDirectionDeg(zone),
        setZoneNapDirectionDeg: (zoneId, deg) => {
          const z = state.zones.find((x) => Number(x && x.id) === Number(zoneId));
          if (!z) return null;
          z.napDirectionDeg = normalizeDeg(deg, DEFAULT_NAP_DIRECTION_DEG);
          if (Number(state.layoutRun && state.layoutRun.selectedZoneId || 0) === Number(z.id)) {
            state.layoutRun.lastNapDirectionDeg = z.napDirectionDeg;
          }
          z.revision = (Number.isFinite(Number(z.revision)) && Number(z.revision) > 0 ? Number(z.revision) : 1) + 1;
          invalidateZoneDerivedData(z);
          renderScene();
          void persistZonesForCurrentWorkspace();
          return z.napDirectionDeg;
        },
        findPlacementForFragment: (fragmentOrId) => findPlacementForFragment(fragmentOrId),
        polygonArea: (points) => polygonArea(points),
        polylineLength: (points, closed) => polylineLength(points, closed),
        DEFAULT_NAP_DIRECTION_DEG,
        getLayoutModeTitle: (mode) => getLayoutModeTitle(mode),
        isManualInventoryMode: () => isManualInventoryMode(),
        api: (...args) => api(...args),
        closeReplaceCandidateModal: () => closeReplaceCandidateModal(),
        openReplaceCandidateModal: () => openReplaceCandidateModal(),
        renderPlacementRows: (rows) => renderPlacementRows(rows),
        renderDetailZoneTree: () => renderDetailZoneTree(),
        renderScene: () => renderScene(),
        openInventoryStep1: (mode) => openInventoryStep1(mode),
        renderManualTrayIntoRoot: () => renderManualTrayIntoRoot(),
        saveLayoutEntry: (entry) => saveLayoutEntry(entry),
        markLayoutDirty: (entry, dirty) => markLayoutDirty(entry, dirty),
        getFurMaterialById: (materialId) => getFurMaterialById(materialId),
        ensureFurMaterialLoaded: async (materialId) => {
          const before = getFurMaterialById(materialId);
          const loaded = await loadFurMaterialDetails(materialId);
          if (loaded && loaded !== before) {
            renderPropertyEditor();
          }
          return loaded;
        },
        getRadialAutoCenter: () => {
          const zone = resolveCurrentRadialZone();
          return zone ? getZoneCenterPoint(zone) : null;
        },
        applyIntarsiaFragmentsToZone: (zoneId) => applyIntarsiaFragmentsToZone(zoneId),
        applyIntarsiaFragmentToZone: (fragmentId, zoneId) => applyIntarsiaFragmentToZone(fragmentId, zoneId),
        promoteFragmentsToZones: () => promoteFragmentsToZones(),
        previewIntarsiaFragmentsDraft: () => previewIntarsiaFragmentsDraft(),
        importSvgContours: (file, scale) => {
          const rerenderPropEditor = () => {
            if (propertyEditorView && typeof propertyEditorView.renderPropertyEditor === "function") {
              propertyEditorView.renderPropertyEditor();
            }
          };
          if (!file) {
            state.intarsiaSvgFragments = null;
            state.intarsiaSvgFileName = null;
            state.layoutRun.fragments = [];
            state.layoutRun.fillType = null;
            state.layoutRun.active = false;
            const modeEl = byId("fillGridMode");
            if (modeEl) { modeEl.value = "grid"; syncGridModeUi(); }
            rerenderPropEditor();
            renderScene();
            return;
          }
          const reader = new FileReader();
          reader.onload = (ev) => {
            const result = parseSvgContours(ev.target.result, scale);
            if (result.error || !result.contours.length) {
              state.intarsiaSvgFragments = null;
            } else {
              // Center imported contours on the selected zone
              const zone = state.zones && state.zones.find((z) => Number(z && z.id) === Number(state.selectedZoneId))
                || (Array.isArray(state.zones) ? state.zones[0] : null);
              let contours = result.contours;
              if (zone && Array.isArray(zone.points) && zone.points.length >= 3) {
                // zone bounding box center
                const zx = zone.points.map((p) => p.x), zy = zone.points.map((p) => p.y);
                const zCx = (Math.min(...zx) + Math.max(...zx)) / 2;
                const zCy = (Math.min(...zy) + Math.max(...zy)) / 2;
                // contours bounding box center
                const allPts = contours.flat();
                const ax = allPts.map((p) => p.x), ay = allPts.map((p) => p.y);
                const cCx = (Math.min(...ax) + Math.max(...ax)) / 2;
                const cCy = (Math.min(...ay) + Math.max(...ay)) / 2;
                const dx = zCx - cCx, dy = zCy - cCy;
                contours = contours.map((pts) => pts.map((p) => ({ x: p.x + dx, y: p.y + dy })));
              }
              const existing = Array.isArray(state.intarsiaSvgFragments) ? state.intarsiaSvgFragments : [];
              const maxId = existing.reduce((m, f) => Math.max(m, Number(f && f.id || 0)), 0);
              const newFrags = contours.map((pts, idx) => ({ id: maxId + idx + 1, points: pts }));
              state.intarsiaSvgFragments = existing.concat(newFrags);
              state.layoutRun.fillType = "import_svg";
              const modeEl = byId("fillGridMode");
              if (modeEl) { modeEl.value = "import_svg"; syncGridModeUi(); }
            }
            rerenderPropEditor();
            previewIntarsiaFragmentsDraft();
          };
          reader.readAsText(file);
        }
      })
      : null;
    const layerLegend = (
      window.FurLabLayerLegend &&
      typeof window.FurLabLayerLegend.createLayerLegend === "function"
    )
      ? window.FurLabLayerLegend.createLayerLegend({
        byId,
        t,
        getStats: () => ({
          fragmentsCount: Array.isArray(state.layoutRun && state.layoutRun.fragments) ? state.layoutRun.fragments.length : 0,
          manualBeforeApply: isManualInventoryMode() && String(state.layoutRun && state.layoutRun.status || "") !== "applied",
          matchedPiecesCount: Array.isArray(state.layoutRun && state.layoutRun.placements)
            ? state.layoutRun.placements.filter((p) => String(p && p.status || "") === "matched").length
            : 0
        })
      })
      : null;
    const inventoryStep2Ui = (
      window.FurLabInventoryStep2Ui &&
      typeof window.FurLabInventoryStep2Ui.createInventoryStep2Ui === "function"
    )
      ? window.FurLabInventoryStep2Ui.createInventoryStep2Ui({
        byId,
        t,
        isManualInventoryMode: () => isManualInventoryMode(),
        renderPlacementExplain: () => renderPlacementExplain()
      })
      : null;
    function updateInventoryProgressKpis(input) {
      if (inventoryProgressView && typeof inventoryProgressView.updateKpis === "function") {
        inventoryProgressView.updateKpis(input);
      }
    }

    function ensureCoverSolverWorker() {
      if (coverSolverWorker) return coverSolverWorker;
      if (typeof Worker === "undefined") return null;
      coverSolverWorker = new Worker("/workers/cover_solver_worker.js");
      return coverSolverWorker;
    }

    function resetInventoryProgressMonotonic() {
      if (inventoryProgressUi && typeof inventoryProgressUi.resetMonotonic === "function") {
        inventoryProgressUi.resetMonotonic();
      }
    }

    function setInventoryProgress(percent, titleText, options) {
      if (inventoryProgressUi && typeof inventoryProgressUi.setProgress === "function") {
        inventoryProgressUi.setProgress(percent, titleText, options);
        return;
      }
      const bar = byId("inventoryProgressBar");
      const text = byId("inventoryProgressText");
      const title = byId("inventoryProgressTitle");
      const incoming = Math.max(0, Math.min(100, Number(percent) || 0));
      if (bar) bar.style.width = `${incoming}%`;
      if (text) text.textContent = `${Math.round(incoming)}%`;
      if (title && titleText) title.textContent = titleText;
      if (titleText && inventoryProgressView && typeof inventoryProgressView.updateSteps === "function") {
        inventoryProgressView.updateSteps(titleText, incoming);
      }
    }

    function setInventoryProgressStatus(text) {
      const el = byId("inventoryProgressStatus");
      if (!el) return;
      const raw = String(text || "").trim();
      if (!raw) {
        el.textContent = "Ожидание телеметрии...";
        return;
      }
      el.textContent = raw.replace(/\s*\n+\s*/g, " | ");
    }

    function addInventoryProgressNote(text) {
      const msg = String(text || "").trim();
      if (!msg) return;
      const stamp = new Date().toLocaleTimeString();
      inventoryLiveHistory.push(`[${stamp}] ${msg}`);
      if (inventoryLiveHistory.length > 12) inventoryLiveHistory = inventoryLiveHistory.slice(-12);
      const tail = inventoryLiveHistory.slice(-2).join(" В· ");
      setInventoryProgressStatus(`${t("checkpoints_title", null, "Checkpoints")}: ${tail}`);
    }

    const formatDurationClock = typeof progressApi.formatDurationClock === "function"
      ? progressApi.formatDurationClock
      : ((ms) => {
        const totalSec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
        const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
        const ss = String(totalSec % 60).padStart(2, "0");
        return `${mm}:${ss}`;
      });
    function updateInventoryProgressTimer() {
      if (inventoryProgressUi && typeof inventoryProgressUi.updateTimer === "function") {
        inventoryProgressUi.updateTimer(inventoryProgressStartedAt, formatDurationClock);
        return;
      }
      const el = byId("inventoryProgressTimer");
      if (!el || !inventoryProgressStartedAt) return;
      el.textContent = formatDurationClock(Date.now() - inventoryProgressStartedAt);
    }

    function startServerPreviewProgressTicker() {
      const phases = Array.isArray(progressApi.SERVER_PREVIEW_PROGRESS_PHASES) && progressApi.SERVER_PREVIEW_PROGRESS_PHASES.length
        ? progressApi.SERVER_PREVIEW_PROGRESS_PHASES
        : ["Server / phases"];
      if (inventoryProgressController && typeof inventoryProgressController.startTicker === "function") {
        inventoryProgressController.startTicker(phases);
        return;
      }
      let tickIndex = 0;
      let percent = 68;
      const timerId = setInterval(() => {
        const label = phases[tickIndex % phases.length];
        tickIndex += 1;
        percent = Math.min(94, percent + 1.3);
        setInventoryProgress(percent, label);
      }, 1300);
      startServerPreviewProgressTicker.__fallbackTimer = timerId;
    }

    function stopServerPreviewProgressTicker() {
      if (inventoryProgressController && typeof inventoryProgressController.stopTicker === "function") {
        inventoryProgressController.stopTicker();
        return;
      }
      const timerId = startServerPreviewProgressTicker.__fallbackTimer;
      if (timerId) clearInterval(timerId);
      startServerPreviewProgressTicker.__fallbackTimer = null;
    }

    function closeInventoryProgressStream() {
      if (inventoryProgressController && typeof inventoryProgressController.closeStream === "function") {
        inventoryProgressController.closeStream();
      }
    }

    const createProgressToken = typeof progressApi.createProgressToken === "function"
      ? progressApi.createProgressToken
      : (() => `p_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
    function handleInventoryProgressEvent(payload) {
      const p = payload && typeof payload === "object" ? payload : {};
      const sign = typeof progressApi.buildProgressSignature === "function"
        ? progressApi.buildProgressSignature(p)
        : { ts: Number(p.ts), sig: "" };
      const ts = Number(sign.ts);
      const sig = String(sign.sig || "");
      if (Number.isFinite(ts) && ts < inventoryProgressLastTs) return;
      if (sig && sig === inventoryProgressLastSig) return;
      if (Number.isFinite(ts)) inventoryProgressLastTs = ts;
      inventoryProgressLastSig = sig;

      const isTelemetryEvent = typeof progressApi.isTelemetryEvent === "function"
        ? !!progressApi.isTelemetryEvent(p)
        : false;
      if (isTelemetryEvent && inventoryProgressController && typeof inventoryProgressController.setHadEvent === "function") {
        inventoryProgressController.setHadEvent(true);
      }

      if (Number.isFinite(Number(p.percent)) && p.title) {
        setInventoryProgress(Number(p.percent), String(p.title));
      } else if (p.title) {
        const fallbackPercent = (inventoryProgressController && typeof inventoryProgressController.getServerPercent === "function")
          ? inventoryProgressController.getServerPercent()
          : 68;
        setInventoryProgress(fallbackPercent, String(p.title));
      }

      const mergedKpi = typeof progressApi.mergeMonotonicKpi === "function"
        ? progressApi.mergeMonotonicKpi((inventoryProgressView && inventoryProgressView.getKpiState ? inventoryProgressView.getKpiState() : {}), p)
        : (inventoryProgressView && inventoryProgressView.getKpiState ? inventoryProgressView.getKpiState() : {});
      updateInventoryProgressKpis(mergedKpi);

      const phaseRu = (progressApi.PHASE_RU && typeof progressApi.PHASE_RU === "object") ? progressApi.PHASE_RU : {};
      const reasonRu = (progressApi.REASON_RU && typeof progressApi.REASON_RU === "object") ? progressApi.REASON_RU : {};
      const described = typeof progressApi.describeProgressEvent === "function"
        ? progressApi.describeProgressEvent(p, phaseRu, reasonRu)
        : { phaseRaw: "-", reasonRaw: "", phaseLabel: "-", reasonLabel: "", lines: [], evalBucket: 0, shortLine: "-" };

      const phaseRaw = described.phaseRaw;
      const reasonRaw = described.reasonRaw;
      const lines = Array.isArray(described.lines) ? described.lines : [];
      const now = Date.now();
      const evalBucket = Number.isFinite(Number(described.evalBucket)) ? Number(described.evalBucket) : 0;
      const phaseChanged = phaseRaw !== inventoryLiveLastPhase;
      const reasonChanged = reasonRaw !== inventoryLiveLastReason;
      const evalStepChanged = evalBucket !== inventoryLiveLastEvalBucket;

      if (phaseChanged || reasonChanged || evalStepChanged) {
        const stamp = new Date(now).toLocaleTimeString();
        const short = `[${stamp}] ${String(described.shortLine || described.phaseLabel || phaseRaw)}`;
        inventoryLiveHistory.push(short);
        if (inventoryLiveHistory.length > 12) inventoryLiveHistory = inventoryLiveHistory.slice(-12);
        inventoryLiveLastPhase = phaseRaw;
        inventoryLiveLastReason = reasonRaw;
        inventoryLiveLastEvalBucket = evalBucket;
      }

      if (now - inventoryLiveLastRenderAt > 300 || phaseChanged || reasonChanged) {
        const current = lines[0] || described.shortLine || described.phaseLabel || phaseRaw || "processing";
        setInventoryProgressStatus(current);
        inventoryLiveLastRenderAt = now;
      }
      if (Number.isFinite(Number(p.iterations)) || Number.isFinite(Number(p.evaluated))) {
        const dbg = byId("invDebugInfo");
        if (dbg) {
          const iter = Number.isFinite(Number(p.iterations)) ? Number(p.iterations) : "-";
          const ev = Number.isFinite(Number(p.evaluated)) ? Number(p.evaluated) : "-";
          dbg.textContent = `phase=${phaseRaw || "-"} iter=${iter} evaluated=${ev}`;
        }
      }
    }

    function openInventoryProgressStream(progressToken) {
      if (inventoryProgressController && typeof inventoryProgressController.openStream === "function") {
        inventoryProgressController.openStream(progressToken);
      }
    }

    function appendServerTraceProgress(trace) {
      if (!trace || typeof trace !== "object") return;
      const snap = typeof progressApi.buildTraceProgressSnapshot === "function"
        ? progressApi.buildTraceProgressSnapshot(trace)
        : null;
      const lines = snap && Array.isArray(snap.progressLines) ? snap.progressLines : [];
      const kpi = snap && snap.kpi && typeof snap.kpi === "object" ? snap.kpi : null;
      if (lines[0]) setInventoryProgress(95, String(lines[0]));
        setInventoryProgress(96, t("progress_result_build", null, "Building result"));
      if (lines[2]) setInventoryProgress(97, String(lines[2]));
      if (lines[3]) setInventoryProgress(98, String(lines[3]));
      if (kpi) updateInventoryProgressKpis(kpi);
    }

    function runCoverWorkerJob(mode, zonePoints, config, candidates, onProgress) {
      return new Promise((resolve, reject) => {
        const w = ensureCoverSolverWorker();
        if (!w) {
          resolve({ ok: false, skipped: true, reason: "worker_unavailable" });
          return;
        }
        const jobId = coverWorkerSeq++;
        const timeout = setTimeout(() => {
          try { w.postMessage({ type: "cancel", jobId }); } catch (_) {}
          cleanup();
          reject(new Error("cover_worker_timeout"));
        }, 15000);

        const cleanup = () => {
          clearTimeout(timeout);
          w.removeEventListener("message", onMessage);
          w.removeEventListener("error", onError);
        };

        const onError = (e) => {
          cleanup();
          reject(new Error((e && e.message) ? e.message : "cover_worker_error"));
        };
        const onMessage = (e) => {
          const msg = e && e.data ? e.data : null;
          if (!msg || Number(msg.jobId) !== Number(jobId)) return;
          if (msg.type === "progress") {
            if (typeof onProgress === "function") onProgress(msg);
            return;
          }
          if (msg.type === "done") {
            cleanup();
            resolve(msg);
            return;
          }
          if (msg.type === "error") {
            cleanup();
            reject(new Error(msg.error || "cover_worker_failed"));
          }
        };

        w.addEventListener("message", onMessage);
        w.addEventListener("error", onError);
        w.postMessage({
          type: "start",
          jobId,
          payload: {
            mode: String(mode || "bootstrap"),
            zonePoints,
            config: config || {},
            candidates: Array.isArray(candidates) ? candidates : []
          }
        });
      });
    }

    function buildOracleCaseFromCurrentPreview() {
      const zone = state.zones.find((z) => Number(z.id) === Number(state.selectedZoneId || 0));
      if (!zone || !Array.isArray(zone.points) || zone.points.length < 3) return null;
      const pool = Array.isArray(state.layoutRun.candidatePool) ? state.layoutRun.candidatePool : [];
      const pieces = [];
      for (const c of pool) {
        const contour = parseScrapContourPoints(c && c.scrapContour);
        if (!Array.isArray(contour) || contour.length < 3) continue;
        pieces.push({
          id: String((c && (c.inventoryTag || c.id)) || ""),
          points: contour.map((p) => ({ x: Number(p.x), y: Number(p.y) })),
          areaMm2: Number(c && c.areaMm2 || 0)
        });
      }
      if (!pieces.length) return null;
      const seed = Number(state.layoutRun.lastSeed || Date.now());
      const snap = state.layoutRun && state.layoutRun.paramsSnapshot && typeof state.layoutRun.paramsSnapshot === "object"
        ? state.layoutRun.paramsSnapshot
        : {};
      const opt = snap.options && typeof snap.options === "object" ? snap.options : {};
      const cst = snap.constraints && typeof snap.constraints === "object" ? snap.constraints : {};
      const napTol = Number.isFinite(Number(cst.napToleranceDeg))
        ? Number(cst.napToleranceDeg)
        : getEffectiveNapToleranceDegForCurrentRun();
      return {
        name: `zone_${zone.id}_${new Date().toISOString().replace(/[:.]/g, "-")}`,
        seed,
        zone: {
          id: Number(zone.id),
          points: zone.points.map((p) => ({ x: Number(p.x), y: Number(p.y) }))
        },
        pieces,
        params: {
          rPreview: Number.isFinite(Number(opt.rasterMm)) ? Number(opt.rasterMm) : 10,
          rFinal: Number.isFinite(Number(opt.rasterMm)) ? Number(opt.rasterMm) : 2,
          thetaMin: -napTol,
          thetaMax: napTol,
          nAngles: 12,
          lambdaOverlap: Number.isFinite(Number(opt.overlapPenalty)) ? Number(opt.overlapPenalty) : 1,
          maxIter: Number.isFinite(Number(opt.maxRepairAttempts)) ? Number(opt.maxRepairAttempts) * 100 : 300,
          coverageTarget: Number.isFinite(Number(opt.coverageTarget)) ? Number(opt.coverageTarget) : 0.999,
          coverageEps: Number.isFinite(Number(opt.coverageEps)) ? Number(opt.coverageEps) : 0.002,
          maxSolveMs: Number.isFinite(Number(opt.maxSolveMs)) ? Number(opt.maxSolveMs) : 22000,
          maxPieces: Number.isFinite(Number(opt.maxPieces)) ? Number(opt.maxPieces) : 48,
          maxPointsPerCandidate: Number.isFinite(Number(opt.maxPointsPerCandidate)) ? Number(opt.maxPointsPerCandidate) : 90,
          napTolDeg: napTol,
          minAreaMm2: Number.isFinite(Number(opt.minAreaMm2))
            ? Number(opt.minAreaMm2)
            : (Number(byId("invMinArea").value || 0) || 0),
          tailCoverageStart: Number.isFinite(Number(opt.tailCoverageStart)) ? Number(opt.tailCoverageStart) : undefined,
          tailResidualRatio: Number.isFinite(Number(opt.tailResidualRatio)) ? Number(opt.tailResidualRatio) : undefined,
          tailMinEfficiency: Number.isFinite(Number(opt.tailMinEfficiency)) ? Number(opt.tailMinEfficiency) : undefined,
          tailMinEfficiencyLoose: Number.isFinite(Number(opt.tailMinEfficiencyLoose)) ? Number(opt.tailMinEfficiencyLoose) : undefined,
          pocketModeStartRatio: Number.isFinite(Number(opt.pocketModeStartRatio)) ? Number(opt.pocketModeStartRatio) : undefined,
          pocketAreaK: Number.isFinite(Number(opt.pocketAreaK)) ? Number(opt.pocketAreaK) : undefined
        }
      };
    }

    function buildRunOutputExport() {
      return window.FurLabInventoryVoronoiSaMonitor
        ? window.FurLabInventoryVoronoiSaMonitor.createRunOutputExport({ state })
        : null;
    }

    function downloadJsonFile(fileName, obj) {
      const text = JSON.stringify(obj, null, 2);
      const blob = new Blob([text], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    let W = 1280, H = 760;
    const stage = new Konva.Stage({ container: "workspace", width: W, height: H });
    function getToolCursorMode() {
      const tool = String(state.tool || "select");
      if (tool === "split-zone") return "split";
      if (tool === "add-vertex") return "add-point";
      if (tool === "edit-vertex" || tool === "curve-vertex" || tool === "smooth-vertex") return "edit-point";
      if (tool === "draw-zone") return "pen";
      if (tool === "draw-rect" || tool === "draw-ellipse") return "crosshair";
      return "select";
    }
    function setWorkspaceCursor(mode) {
      const el = stage && stage.container ? stage.container() : null;
      if (!el) return;
      const nextMode = String(mode || "").trim() || getToolCursorMode();
      const cursorMap = {
        select: "url('/assets/tool-cursors/select.svg') 2 2, auto",
        pen: "url('/assets/tool-cursors/pen.svg') 2 2, auto",
        split: "crosshair",
        "add-point": "url('/assets/tool-cursors/add-point.svg') 5 126, auto",
        "edit-point": "url('/assets/tool-cursors/edit-point.svg') 5 95, auto"
      };
      if (nextMode === "grab") el.style.cursor = "grab";
      else if (nextMode === "grabbing") el.style.cursor = "grabbing";
      else if (nextMode === "none") el.style.cursor = "";
      else el.style.cursor = cursorMap[nextMode] || cursorMap.select;
    }
    function syncWorkspaceSize() {
      const el = byId("workspace");
      if (!el) return;
      const nextW = Math.max(640, Math.floor(el.clientWidth || 1280));
      const nextH = Math.max(400, Math.floor(el.clientHeight || 760));
      if (nextW === W && nextH === H) return;
      W = nextW; H = nextH;
      stage.width(W);
      stage.height(H);
      renderScene();
    }
    window.addEventListener("resize", syncWorkspaceSize);
    setTimeout(syncWorkspaceSize, 0);
    const layerGuides = new Konva.Layer();
    const layerContent = new Konva.Layer();
    const layerOverlay = new Konva.Layer();
    const layerSelection = new Konva.Layer();
    stage.add(layerGuides);
    stage.add(layerContent);
    stage.add(layerOverlay);
    stage.add(layerSelection);
    const layerPattern = layerContent;
    const layerFragments = layerContent;
    const layerVisibleArea = layerOverlay;
    const layerPreview = layerOverlay;
    const layerZones = layerOverlay;
    const layerUi = layerSelection;

    function worldToScreen(p) {
      return { x: p.x * state.viewport.scale + state.viewport.offsetX, y: H - (p.y * state.viewport.scale + state.viewport.offsetY) };
    }
    function screenToWorld(x, y) {
      return { x: (x - state.viewport.offsetX) / state.viewport.scale, y: ((H - y) - state.viewport.offsetY) / state.viewport.scale };
    }

    const distance2 = (a, b) => window.FurLabUtils.distance2(a, b);
    const pointInPolygon = (point, polygon) => window.FurLabUtils.pointInPolygon(point, polygon);
    const dist2PointToSegment = (p, a, b) => window.FurLabUtils.dist2PointToSegment(p, a, b);
    // Zone/detail/placement spatial lookups — delegated to window.FurLabZoneLookups (core/zone-lookups.js)
    const findZoneAt = (wp) => window.FurLabZoneLookups.findZoneAt(wp);
    const findVertexAt = (wp, thr) => window.FurLabZoneLookups.findVertexAt(wp, thr);
    const findNearestVertexInSelectedZone = (wp) => window.FurLabZoneLookups.findNearestVertexInSelectedZone(wp);
    const findLayoutFragmentAt = (wp) => window.FurLabZoneLookups.findLayoutFragmentAt(wp);
    const findManualPlacementAt = (wp) => window.FurLabZoneLookups.findManualPlacementAt(wp);
    const findDetailAt = (wp, thr) => window.FurLabZoneLookups.findDetailAt(wp, thr);
    const getDetailBoundaryPointsForZone = (z) => window.FurLabZoneLookups.getDetailBoundaryPointsForZone(z);
    const invalidateDetailBoundaryCache = () => window.FurLabZoneLookups.invalidateDetailBoundaryCache();
    const projectPointToBoundary = (pts, wp) => window.FurLabZoneLookups.projectPointToBoundary(pts, wp);
    const isZoneVertexOnDetailBoundary = (z, vi, thr) => window.FurLabZoneLookups.isZoneVertexOnDetailBoundary(z, vi, thr);
    const isZoneVertexOnSharedBoundary = (z, vi, thr) => window.FurLabZoneLookups.isZoneVertexOnSharedBoundary(z, vi, thr);
    const findSharedBoundaryVertexLinks = (z, vi, thr) => window.FurLabZoneLookups.findSharedBoundaryVertexLinks(z, vi, thr);
    const findSharedBoundaryEdgeLinks = (z, idx) => window.FurLabZoneLookups.findSharedBoundaryEdgeLinks(z, idx);
    const ensureSharedBoundaryVertex = (z, vi) => window.FurLabZoneLookups.ensureSharedBoundaryVertex(z, vi);
    function isVertexEditingTool(tool) {
      return ["edit-vertex", "add-vertex", "smooth-vertex", "curve-vertex"].includes(String(tool || ""));
    }
    const buildRectZonePoints = (a, b) => window.FurLabUtils.buildRectZonePoints(a, b);
    const buildEllipseZonePoints = (...a) => window.FurLabUtils.buildEllipseZonePoints(...a);
    function createZoneFromPoints(points, options = {}) {
      const pts = Array.isArray(points)
        ? points
            .map((p) => ({ x: Number(p && p.x), y: Number(p && p.y) }))
            .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
        : [];
      if (pts.length < 3) return false;
      const zoneId = state.nextZoneId++;
      const detailId = Number(options && options.detailId || state.selectedDetailId || 0) || null;
      const parentZoneIdOpt = Number(options && options.parentZoneId || 0) || null;
      function resolveZoneName() {
        if (options && options.name) return String(options.name);
        if (parentZoneIdOpt) {
          const parent = (Array.isArray(state.zones) ? state.zones : []).find((z) => Number(z && z.id || 0) === parentZoneIdOpt);
          const parentName = (parent && parent.name) || (options.parentZoneSnapshot && options.parentZoneSnapshot.name) || `Зона ${parentZoneIdOpt}`;
          const parentSuffix = String(parentName).replace(/^Зона\s*/i, "");
          const siblingCount = (Array.isArray(state.zones) ? state.zones : []).filter((z) => Number(z && z.parentZoneId || 0) === parentZoneIdOpt && Number(z && z.detailId || 0) === detailId).length;
          return `Зона ${parentSuffix}.${siblingCount + 1}`;
        }
        const detailSuffix = detailId ? String(detailId) : String(zoneId);
        const siblingsInDetail = (Array.isArray(state.zones) ? state.zones : []).filter((z) => Number(z && z.detailId || 0) === detailId).length;
        return `Зона ${detailSuffix}.${siblingsInDetail + 1}`;
      }
      const zone = {
        id: zoneId,
        name: options && options.name ? String(options.name) : resolveZoneName(),
        detailId,
        napDirectionDeg: DEFAULT_NAP_DIRECTION_DEG,
        originType: String(options && options.originType || "manual").trim().toLowerCase() || "manual",
        parentZoneId: Number(options && options.parentZoneId || 0) || null,
        parentZoneSnapshot: options && options.parentZoneSnapshot && typeof options.parentZoneSnapshot === "object"
          ? JSON.parse(JSON.stringify(options.parentZoneSnapshot))
          : null,
        splitOperationId: options && options.splitOperationId && String(options.splitOperationId).trim() ? String(options.splitOperationId).trim() : null,
        splitDepth: Number.isFinite(Number(options && options.splitDepth)) && Number(options.splitDepth) >= 0 ? Number(options.splitDepth) : 0,
        revision: 1,
        schemaVersion: 1,
        points: pts,
        holes: Array.isArray(options && options.holes) ? options.holes : [],
        holeBoundaryLinks: Array.isArray(options && options.holeBoundaryLinks) ? options.holeBoundaryLinks : []
      };
      // All drawing tools require a selected parent zone — no independent zone creation via UI
      // Capture parentZoneId BEFORE executeCommand because it overwrites state.selectedZoneId
      let capturedParentZoneId = null;
      if (!options.skipSubtract && detailId) {
        const parentZone = (Array.isArray(state.zones) ? state.zones : []).find(
          (z) => Number(z && z.id || 0) === Number(state.selectedZoneId || 0)
        );
        if (!parentZone || Number(parentZone.detailId || 0) !== detailId) {
          if (byId("workspaceInfo")) byId("workspaceInfo").textContent = "[target_zone_not_selected] Сначала выберите зону для разреза.";
          state.draftZone = [];
          renderScene();
          return false;
        }
        capturedParentZoneId = Number(parentZone.id || 0);
      }
      const cmd = { type: "create-zone", zone };
      executeCommand(cmd);
      pushCommand(cmd);
      state.draftZone = [];
      renderScene();
      if (!options.skipSubtract && detailId && capturedParentZoneId) {
        void (async () => {
          await subtractZoneFromOverlapping(zone, capturedParentZoneId);
          if (!options.skipPersist) void persistZonesForCurrentWorkspace();
        })();
      } else if (!options.skipPersist) {
        void persistZonesForCurrentWorkspace();
      }
      return true;
    }
    function removeSelectedZoneVertex() {
      const _setInfo = (t) => { const el = typeof byId === "function" ? byId("workspaceInfo") : document.getElementById("workspaceInfo"); if (el) el.textContent = t; };
      const zone = state.zones.find((z) => Number(z && z.id || 0) === Number(state.selectedZoneId || 0)) || null;
      const vertexIndex = Number(state.selectedVertexIndex);
      if (!zone || !Array.isArray(zone.points) || zone.points.length <= 3) return false;
      if (!Number.isFinite(vertexIndex) || vertexIndex < 0 || vertexIndex >= zone.points.length) return false;
      const onPartBoundary = isZoneVertexOnDetailBoundary(zone, vertexIndex);
      const onSharedBoundary = isZoneVertexOnSharedBoundary(zone, vertexIndex);
      if (onPartBoundary) {
        if (onSharedBoundary) {
          _setInfo("shared_boundary_endpoint_delete_requires_merge: удалите разрез целиком.");
        } else {
          _setInfo("part_boundary_locked: нельзя удалить вершину контура детали.");
        }
        renderScene();
        return false;
      }
      if (onSharedBoundary) {
        // Atomic delete from all zones
        const links = findSharedBoundaryVertexLinks(zone, vertexIndex, 10);
        const point = { ...zone.points[vertexIndex] };
        const moves = [{ zoneId: Number(zone.id || 0) || null, vertexIndex, point }];
        zone.points.splice(vertexIndex, 1);
        for (const link of links) {
          const sibling = (Array.isArray(state.zones) ? state.zones : []).find((z) => Number(z && z.id || 0) === Number(link.zoneId || 0));
          if (!sibling || !Array.isArray(sibling.points)) continue;
          const sibVi = Number(link.vertexIndex);
          if (sibVi < 0 || sibVi >= sibling.points.length) continue;
          moves.push({ zoneId: Number(sibling.id || 0) || null, vertexIndex: sibVi, point: { ...sibling.points[sibVi] } });
          sibling.points.splice(sibVi, 1);
        }
        {
          const _geom2 = typeof window !== "undefined" && window.FurLabGeom;
          const _lookups2 = typeof window !== "undefined" && window.FurLabZoneLookups;
          const detailBoundary2 = _lookups2 ? _lookups2.getDetailBoundaryPointsForZone(zone) : [];
          let partErrors2 = [];
          if (detailBoundary2.length >= 3 && _geom2 && typeof _geom2.validatePartZonePartition === "function") {
            const detailId2 = Number(zone.detailId || 0);
            const zonesForPart2 = (Array.isArray(state.zones) ? state.zones : []).filter(
              (z) => Number(z && z.detailId || 0) === detailId2 && Array.isArray(z.points) && z.points.length >= 3
            );
            partErrors2 = _geom2.validatePartZonePartition(detailBoundary2, zonesForPart2).filter((i) => String(i.severity || "") === "error");
          }
          if (partErrors2.length > 0) {
            for (const m of moves) {
              const z2 = (Array.isArray(state.zones) ? state.zones : []).find((z) => Number(z && z.id || 0) === Number(m.zoneId || 0));
              if (z2 && Array.isArray(z2.points)) z2.points.splice(m.vertexIndex, 0, { ...m.point });
            }
            _setInfo("Нельзя: удаление нарушает разбиение зон.");
            renderScene();
            return false;
          }
        }
        pushCommand({ type: "delete-shared-boundary-vertex", moves });
        state.selectedVertexIndex = Math.max(0, Math.min(vertexIndex, zone.points.length - 1));
        void persistZonesForCurrentWorkspace();
        renderScene();
        return true;
      }
      const point = { ...zone.points[vertexIndex] };
      zone.points.splice(vertexIndex, 1);
      pushCommand({ type: "delete-vertex", zoneId: Number(zone.id || 0) || null, vertexIndex, point });
      state.selectedVertexIndex = Math.max(0, Math.min(vertexIndex, zone.points.length - 1));
      void persistZonesForCurrentWorkspace();
      renderScene();
      return true;
    }

    function pushCommand(cmd) { state.history.undo.push(cmd); state.history.redo = []; }
    function cloneZoneStateForCommand(zone) {
      const z = zone && typeof zone === "object" ? zone : null;
      if (!z) return null;
      return {
        id: Number(z.id || 0) || null,
        name: String(z.name || "").trim(),
        detailId: Number(z.detailId || 0) || null,
        napDirectionDeg: normalizeDeg(z.napDirectionDeg, DEFAULT_NAP_DIRECTION_DEG),
        originType: String(z.originType || "").trim() || null,
        parentZoneId: Number(z.parentZoneId || 0) || null,
        parentZoneSnapshot: z.parentZoneSnapshot && typeof z.parentZoneSnapshot === "object"
          ? JSON.parse(JSON.stringify(z.parentZoneSnapshot))
          : null,
        splitOperationId: z.splitOperationId && String(z.splitOperationId).trim() ? String(z.splitOperationId).trim() : null,
        splitDepth: Number.isFinite(Number(z.splitDepth)) && Number(z.splitDepth) >= 0 ? Number(z.splitDepth) : 0,
        revision: Number.isFinite(Number(z.revision)) && Number(z.revision) > 0 ? Number(z.revision) : 1,
        schemaVersion: Number.isFinite(Number(z.schemaVersion)) && Number(z.schemaVersion) > 0 ? Number(z.schemaVersion) : 1,
        points: (Array.isArray(z.points) ? z.points : []).map((p) => ({ ...p })),
        holes: normalizeHoles(z.holes, z.id),
        holeBoundaryLinks: Array.isArray(z.holeBoundaryLinks) ? JSON.parse(JSON.stringify(z.holeBoundaryLinks)) : [],
        promoteOperationId: z.promoteOperationId && String(z.promoteOperationId).trim() ? String(z.promoteOperationId).trim() : null,
        sourceLayoutRunId: z.sourceLayoutRunId && String(z.sourceLayoutRunId).trim() ? String(z.sourceLayoutRunId).trim() : null,
        sourceFragmentId: Number.isFinite(Number(z.sourceFragmentId)) && Number(z.sourceFragmentId) > 0 ? Number(z.sourceFragmentId) : null
      };
    }
    function materializeZoneFromCommand(zone) {
      const z = cloneZoneStateForCommand(zone);
      if (!z) return null;
      return z;
    }
    const smoothZoneVertexPoints = (...a) => window.FurLabUtils.smoothZoneVertexPoints(...a);

    function clearCurveEdit(options = {}) {
      const restore = options && options.restore === true;
      const ce = state.curveEdit && typeof state.curveEdit === "object" ? state.curveEdit : null;
      if (restore && ce) {
        const zone = state.zones.find((x) => Number(x && x.id || 0) === Number(ce.zoneId || 0)) || null;
        if (zone && Array.isArray(ce.basePoints) && ce.basePoints.length >= 3) {
          zone.points = ce.basePoints.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
        }
        // Restore sibling zones (atomic sharedBoundary curve sync)
        if (Array.isArray(ce.siblingLinks)) {
          for (const sl of ce.siblingLinks) {
            if (!Array.isArray(sl.basePoints) || sl.basePoints.length === 0) continue;
            const sibling = (Array.isArray(state.zones) ? state.zones : []).find((z) => Number(z && z.id || 0) === Number(sl.zoneId || 0));
            if (sibling) sibling.points = sl.basePoints.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
          }
        }
      }
      state.curveEdit = null;
    }

    function beginCurveEdit(zone, vertexIndex, strength = 0.28) {
      const z = zone && typeof zone === "object" ? zone : null;
      if (!z || !Array.isArray(z.points) || z.points.length < 3) {
        clearCurveEdit({ restore: true });
        return false;
      }
      state.selectedZoneId = Number(z.id || 0) || null;
      state.curveEdit = {
        zoneId: Number(z.id || 0) || null,
        vertexIndex: ((Number(vertexIndex || 0) % z.points.length) + z.points.length) % z.points.length,
        strength: Math.max(0.08, Math.min(0.48, Number(strength) || 0.28)),
        basePoints: z.points.map((p) => ({ x: Number(p.x), y: Number(p.y) }))
      };
      return true;
    }

    function getCurveEditContext() {
      const ce = state.curveEdit && typeof state.curveEdit === "object" ? state.curveEdit : null;
      if (!ce || String(state.tool || "") !== "curve-vertex") return null;
      const zone = state.zones.find((x) => Number(x && x.id || 0) === Number(ce.zoneId || 0)) || null;
      const basePoints = Array.isArray(ce.basePoints) ? ce.basePoints.map((p) => ({ x: Number(p.x), y: Number(p.y) })) : [];
      if (!zone || basePoints.length < 3) return null;
      const n = basePoints.length;
      const idx = ((Number(ce.vertexIndex || 0) % n) + n) % n;
      const prev = basePoints[(idx - 1 + n) % n];
      const cur = basePoints[idx];
      const next = basePoints[(idx + 1) % n];
      const vPrev = { x: prev.x - cur.x, y: prev.y - cur.y };
      const vNext = { x: next.x - cur.x, y: next.y - cur.y };
      const lenPrev = Math.hypot(vPrev.x, vPrev.y);
      const lenNext = Math.hypot(vNext.x, vNext.y);
      if (!(lenPrev > 1e-6 && lenNext > 1e-6)) return null;
      const uPrev = { x: vPrev.x / lenPrev, y: vPrev.y / lenPrev };
      const uNext = { x: vNext.x / lenNext, y: vNext.y / lenNext };
      const minLen = Math.max(1e-6, Math.min(lenPrev, lenNext));
      const worldMinHandleLen = Math.max(12 / Math.max(0.001, Number(state.viewport && state.viewport.scale || 1)), minLen * 0.08);
      const handleLen = Math.max(worldMinHandleLen, minLen * Math.max(0.08, Math.min(0.48, Number(ce.strength) || 0.28)));
      return {
        zone,
        basePoints,
        vertexIndex: idx,
        strength: Math.max(0.08, Math.min(0.48, Number(ce.strength) || 0.28)),
        cur,
        uPrev,
        uNext,
        minLen,
        handleLen,
        handlePrev: { x: cur.x + uPrev.x * handleLen, y: cur.y + uPrev.y * handleLen },
        handleNext: { x: cur.x + uNext.x * handleLen, y: cur.y + uNext.y * handleLen }
      };
    }

    function clampPointsToDetailBoundary(pts, zone) {
      const boundary = getDetailBoundaryPointsForZone(zone);
      if (!Array.isArray(boundary) || boundary.length < 3) return pts;
      return pts.map((p) => {
        if (pointInPolygon(p, boundary)) return p;
        const proj = projectPointToBoundary(boundary, p);
        return proj ? { x: proj.x, y: proj.y } : p;
      });
    }

    function applyCurveEditPreview(strength) {
      const ctx = getCurveEditContext();
      if (!ctx) return false;
      const nextStrength = Math.max(0.08, Math.min(0.48, Number(strength) || ctx.strength));
      const nextPoints = smoothZoneVertexPoints(ctx.basePoints, ctx.vertexIndex, nextStrength);
      if (!Array.isArray(nextPoints) || nextPoints.length < ctx.basePoints.length + 2) return false;
      ctx.zone.points = clampPointsToDetailBoundary(nextPoints, ctx.zone).map((p) => ({ x: Number(p.x), y: Number(p.y) }));
      state.curveEdit.strength = nextStrength;
      // Apply same curve to sibling zones (atomic sharedBoundary curve sync — CONTRACT §3.6)
      // sibling stores the shared boundary in reversed order, so smoothZoneVertexPoints at
      // sibling.vertexIndex produces the geometrically identical curve reversed: quad_sib(t) = quad(1-t)
      const ce = state.curveEdit;
      if (Array.isArray(ce.siblingLinks) && ce.siblingLinks.length > 0) {
        for (const sl of ce.siblingLinks) {
          if (!Array.isArray(sl.basePoints) || sl.basePoints.length < 3) continue;
          const sibling = (Array.isArray(state.zones) ? state.zones : []).find((z) => Number(z && z.id || 0) === Number(sl.zoneId || 0));
          if (!sibling) continue;
          const sibNext = smoothZoneVertexPoints(sl.basePoints, sl.vertexIndex, nextStrength);
          if (Array.isArray(sibNext) && sibNext.length >= sl.basePoints.length + 2) {
            sibling.points = sibNext.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
          }
        }
      }
      return true;
    }

    function commitCurveEdit() {
      const ctx = getCurveEditContext();
      if (!ctx) return false;
      const zone = ctx.zone;
      const beforePoints = ctx.basePoints.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
      const afterPoints = (Array.isArray(zone.points) ? zone.points : []).map((p) => ({ x: Number(p.x), y: Number(p.y) }));
      // Capture siblingLinks before clearCurveEdit (they are in state.curveEdit, not in ctx)
      const siblingLinks = Array.isArray(state.curveEdit && state.curveEdit.siblingLinks) ? state.curveEdit.siblingLinks : [];
      clearCurveEdit();
      state.selectedVertexIndex = null;
      const changed = beforePoints.length !== afterPoints.length || beforePoints.some((p, i) => Math.abs(p.x - afterPoints[i].x) > 1e-6 || Math.abs(p.y - afterPoints[i].y) > 1e-6);
      if (changed) {
        // Primary zone already updated by applyCurveEditPreview.
        // Sibling zones already updated atomically by applyCurveEditPreview (siblingLinks).
        // Collect sibling before/after for the undo command.
        const siblingChanges = [];
        for (const sl of siblingLinks) {
          const sibling = (Array.isArray(state.zones) ? state.zones : []).find((z) => Number(z && z.id || 0) === Number(sl.zoneId || 0));
          if (!sibling || !Array.isArray(sibling.points) || sibling.points.length < 3) continue;
          // sl.basePoints = pre-curve sibling state; sibling.points = post-curve (updated by preview)
          siblingChanges.push({ zone: sibling, beforePoints: sl.basePoints.map((p) => ({ x: p.x, y: p.y })) });
        }
        // Partition gate: validate after all tentative changes
        const _lookups = typeof window !== "undefined" && window.FurLabZoneLookups;
        const _geom = typeof window !== "undefined" && window.FurLabGeom;
        const detailBoundary = _lookups ? _lookups.getDetailBoundaryPointsForZone(zone) : [];
        let partErrors = [];
        if (detailBoundary.length >= 3 && _geom && typeof _geom.validatePartZonePartition === "function") {
          const detailId = Number(zone.detailId || 0);
          const zonesForPart = (Array.isArray(state.zones) ? state.zones : []).filter(
            (z) => Number(z && z.detailId || 0) === detailId && Array.isArray(z.points) && z.points.length >= 3
          );
          const issues = _geom.validatePartZonePartition(detailBoundary, zonesForPart);
          partErrors = issues.filter((i) => String(i.severity || "") === "error");
        }
        if (partErrors.length > 0) {
          // Rollback primary zone and all siblings (all were already updated by preview)
          zone.points = beforePoints.map((p) => ({ ...p }));
          for (const sc of siblingChanges) {
            sc.zone.points = sc.beforePoints.map((p) => ({ ...p }));
          }
          const infoEl = byId("workspaceInfo");
          if (infoEl) infoEl.textContent = "Нельзя: кривизна нарушает разбиение зон (" + (partErrors[0].code || "gap/overlap") + ").";
          return false;
        }
        // Commit: record sibling beforePoints, push single compound command
        const siblingCmdChanges = siblingChanges.map((sc) => ({
          zoneId: Number(sc.zone.id || 0) || null,
          beforePoints: sc.beforePoints,
          afterPoints: sc.zone.points.map((p) => ({ ...p }))
        }));
        pushCommand({
          type: "curve-vertex",
          zoneId: Number(zone.id || 0) || null,
          beforePoints,
          afterPoints,
          siblingChanges: siblingCmdChanges
        });
        zone.revision = (Number.isFinite(Number(zone.revision)) && Number(zone.revision) > 0 ? Number(zone.revision) : 1) + 1;
        invalidateZoneDerivedData(zone);
        for (const sc of siblingChanges) {
          sc.zone.revision = (Number.isFinite(Number(sc.zone.revision)) && Number(sc.zone.revision) > 0 ? Number(sc.zone.revision) : 1) + 1;
          invalidateZoneDerivedData(sc.zone);
        }
        renderPropertyEditor();
        void persistZonesForCurrentWorkspace();
      }
      return changed;
    }
    function executeCommand(cmd) {
      if (cmd.type === "create-zone") {
        const zone = materializeZoneFromCommand(cmd.zone);
        if (!zone) return;
        state.zones.push(zone);
        state.selectedZoneId = cmd.zone.id;
      } else if (cmd.type === "split-zone") {
        state.zones = state.zones.filter((z) => Number(z && z.id) !== Number(cmd.originalZone && cmd.originalZone.id));
        for (const zone of (Array.isArray(cmd.newZones) ? cmd.newZones : [])) {
          const nextZone = materializeZoneFromCommand(zone);
          if (nextZone) state.zones.push(nextZone);
        }
        state.selectedZoneId = Number(cmd.newZones && cmd.newZones[0] && cmd.newZones[0].id || 0) || null;
      } else if (cmd.type === "add-vertex") {
        const z = state.zones.find((x) => x.id === cmd.zoneId);
        if (!z) return;
        const insertIndex = Math.max(0, Math.min(Array.isArray(z.points) ? z.points.length : 0, Number(cmd.insertIndex || 0)));
        z.points.splice(insertIndex, 0, { ...cmd.point });
        state.selectedZoneId = Number(z.id || 0) || null;
        state.selectedVertexIndex = insertIndex;
      } else if (cmd.type === "add-shared-boundary-vertex") {
        for (const move of (Array.isArray(cmd.moves) ? cmd.moves : [])) {
          const z = state.zones.find((x) => x.id === move.zoneId);
          if (!z || !Array.isArray(z.points)) continue;
          const insertIndex = Math.max(0, Math.min(z.points.length, Number(move.insertIndex || 0)));
          z.points.splice(insertIndex, 0, { ...move.point });
        }
      } else if (cmd.type === "delete-vertex") {
        const z = state.zones.find((x) => x.id === cmd.zoneId);
        if (!z) return;
        const idx = Math.max(0, Math.min(Array.isArray(z.points) ? z.points.length : 0, Number(cmd.vertexIndex || 0)));
        z.points.splice(idx, 0, { ...cmd.point });
        state.selectedZoneId = Number(z.id || 0) || null;
        state.selectedVertexIndex = idx;
      } else if (cmd.type === "smooth-vertex" || cmd.type === "curve-vertex") {
        const z = state.zones.find((x) => x.id === cmd.zoneId);
        if (!z) return;
        z.points = (Array.isArray(cmd.afterPoints) ? cmd.afterPoints : []).map((p) => ({ ...p }));
        state.selectedZoneId = Number(z.id || 0) || null;
        for (const sc of (Array.isArray(cmd.siblingChanges) ? cmd.siblingChanges : [])) {
          const sz = state.zones.find((x) => x.id === sc.zoneId);
          if (sz) sz.points = (Array.isArray(sc.afterPoints) ? sc.afterPoints : []).map((p) => ({ ...p }));
        }
      } else if (cmd.type === "move-vertex") {
        const z = state.zones.find((x) => x.id === cmd.zoneId); if (!z) return; z.points[cmd.vertexIndex] = { ...cmd.to };
      } else if (cmd.type === "move-shared-vertices") {
        for (const move of (Array.isArray(cmd.moves) ? cmd.moves : [])) {
          const z = state.zones.find((x) => x.id === move.zoneId);
          if (!z) continue;
          const idx = Number(move.vertexIndex);
          if (!Number.isFinite(idx) || idx < 0) continue;
          if (move.isHoleLink) {
            const holeIdx = Number(move.holeIndex);
            const holeObj = Array.isArray(z.holes) ? z.holes[holeIdx] : null;
            const hole = holeContour(holeObj);
            if (!hole.length || idx >= hole.length) continue;
            const n = hole.length;
            const fEl = n > 1 && hole[0] && hole[n-1] && Math.abs(hole[0].x-hole[n-1].x)<0.01 && Math.abs(hole[0].y-hole[n-1].y)<0.01;
            hole[idx] = { ...move.to };
            if (fEl) { if (idx===0) hole[n-1]={...move.to}; else if (idx===n-1) hole[0]={...move.to}; }
          } else {
            if (!Array.isArray(z.points) || idx >= z.points.length) continue;
            z.points[idx] = { ...move.to };
          }
        }
      } else if (cmd.type === "promote-to-zones") {
        // §19.5: remove parent zone, add promoted zones
        state.zones = state.zones.filter((z) => Number(z && z.id) !== Number(cmd.parentZoneSnapshot && cmd.parentZoneSnapshot.id));
        for (const zone of (Array.isArray(cmd.promotedZones) ? cmd.promotedZones : [])) {
          const next = materializeZoneFromCommand(zone);
          if (next) state.zones.push(next);
        }
        state.selectedZoneId = Number(cmd.promotedZones && cmd.promotedZones[0] && cmd.promotedZones[0].id || 0) || null;
      } else if (cmd.type === "delete-shared-boundary-vertex") {
        // redo: delete again (moves stored with before-point)
        for (const m of (Array.isArray(cmd.moves) ? cmd.moves : [])) {
          const z = state.zones.find((x) => Number(x && x.id || 0) === Number(m.zoneId || 0));
          if (!z || !Array.isArray(z.points)) continue;
          const idx = Number(m.vertexIndex || 0);
          if (idx >= 0 && idx < z.points.length) z.points.splice(idx, 1);
        }
        state.selectedVertexIndex = null;
      }
    }
    function revertCommand(cmd) {
      if (cmd.type === "create-zone") {
        state.zones = state.zones.filter((z) => z.id !== cmd.zone.id);
        if (state.selectedZoneId === cmd.zone.id) state.selectedZoneId = null;
      } else if (cmd.type === "split-zone") {
        state.zones = state.zones.filter((z) => !Array.isArray(cmd.newZones) || !cmd.newZones.some((next) => Number(next && next.id) === Number(z && z.id)));
        const originalZone = materializeZoneFromCommand(cmd.originalZone);
        if (originalZone) state.zones.push(originalZone);
        state.selectedZoneId = Number(cmd.originalZone && cmd.originalZone.id || 0) || null;
      } else if (cmd.type === "add-vertex") {
        const z = state.zones.find((x) => x.id === cmd.zoneId);
        if (!z) return;
        const idx = Number(cmd.insertIndex || 0);
        if (idx >= 0 && idx < z.points.length) z.points.splice(idx, 1);
        state.selectedZoneId = Number(z.id || 0) || null;
        state.selectedVertexIndex = null;
      } else if (cmd.type === "add-shared-boundary-vertex") {
        // Undo in reverse order to preserve indices
        const moves = Array.isArray(cmd.moves) ? [...cmd.moves].reverse() : [];
        for (const move of moves) {
          const z = state.zones.find((x) => x.id === move.zoneId);
          if (!z || !Array.isArray(z.points)) continue;
          const idx = Number(move.insertIndex || 0);
          if (idx >= 0 && idx < z.points.length) z.points.splice(idx, 1);
        }
        state.selectedVertexIndex = null;
      } else if (cmd.type === "delete-vertex") {
        const z = state.zones.find((x) => x.id === cmd.zoneId);
        if (!z) return;
        const idx = Number(cmd.vertexIndex || 0);
        if (idx >= 0 && idx <= z.points.length) z.points.splice(idx, 0, { ...cmd.point });
        state.selectedZoneId = Number(z.id || 0) || null;
        state.selectedVertexIndex = idx;
      } else if (cmd.type === "delete-shared-boundary-vertex") {
        // Restore in reverse order to preserve indices
        const moves = Array.isArray(cmd.moves) ? [...cmd.moves].reverse() : [];
        for (const m of moves) {
          const z = state.zones.find((x) => Number(x && x.id || 0) === Number(m.zoneId || 0));
          if (!z || !Array.isArray(z.points)) continue;
          const idx = Number(m.vertexIndex || 0);
          if (idx >= 0 && idx <= z.points.length) z.points.splice(idx, 0, { ...m.point });
        }
        if (moves.length > 0) {
          const first = moves[moves.length - 1]; // reversed, so last = original primary
          state.selectedZoneId = Number(first.zoneId || 0) || null;
          state.selectedVertexIndex = Number(first.vertexIndex || 0);
        }
      } else if (cmd.type === "smooth-vertex" || cmd.type === "curve-vertex") {
        const z = state.zones.find((x) => x.id === cmd.zoneId);
        if (!z) return;
        z.points = (Array.isArray(cmd.beforePoints) ? cmd.beforePoints : []).map((p) => ({ ...p }));
        state.selectedZoneId = Number(z.id || 0) || null;
        for (const sc of (Array.isArray(cmd.siblingChanges) ? cmd.siblingChanges : [])) {
          const sz = state.zones.find((x) => x.id === sc.zoneId);
          if (sz) sz.points = (Array.isArray(sc.beforePoints) ? sc.beforePoints : []).map((p) => ({ ...p }));
        }
      } else if (cmd.type === "move-vertex") {
        const z = state.zones.find((x) => x.id === cmd.zoneId); if (!z) return; z.points[cmd.vertexIndex] = { ...cmd.from };
      } else if (cmd.type === "move-shared-vertices") {
        for (const move of (Array.isArray(cmd.moves) ? cmd.moves : [])) {
          const z = state.zones.find((x) => x.id === move.zoneId);
          if (!z) continue;
          const idx = Number(move.vertexIndex);
          if (!Number.isFinite(idx) || idx < 0) continue;
          if (move.isHoleLink) {
            const holeIdx = Number(move.holeIndex);
            const holeObj = Array.isArray(z.holes) ? z.holes[holeIdx] : null;
            const hole = holeContour(holeObj);
            if (!hole.length || idx >= hole.length) continue;
            const n = hole.length;
            const fEl = n > 1 && hole[0] && hole[n-1] && Math.abs(hole[0].x-hole[n-1].x)<0.01 && Math.abs(hole[0].y-hole[n-1].y)<0.01;
            hole[idx] = { ...move.from };
            if (fEl) { if (idx===0) hole[n-1]={...move.from}; else if (idx===n-1) hole[0]={...move.from}; }
          } else {
            if (!Array.isArray(z.points) || idx >= z.points.length) continue;
            z.points[idx] = { ...move.from };
          }
        }
      } else if (cmd.type === "promote-to-zones") {
        // §19.5 undo: remove promoted zones, restore parent
        state.zones = state.zones.filter((z) => !(Array.isArray(cmd.promotedZones) && cmd.promotedZones.some((p) => Number(p && p.id) === Number(z && z.id))));
        const parent = materializeZoneFromCommand(cmd.parentZoneSnapshot);
        if (parent) state.zones.push(parent);
        state.selectedZoneId = Number(cmd.parentZoneSnapshot && cmd.parentZoneSnapshot.id || 0) || null;
      }
    }
    function undo() { const cmd = state.history.undo.pop(); if (!cmd) return; revertCommand(cmd); state.history.redo.push(cmd); renderScene(); void persistZonesCurrentNoReload(); }
    function redo() { const cmd = state.history.redo.pop(); if (!cmd) return; executeCommand(cmd); state.history.undo.push(cmd); renderScene(); void persistZonesCurrentNoReload(); }
    async function persistZonesCurrentNoReload() {
      const workspaceKey = buildZonesWorkspaceKey();
      if (!workspaceKey) return;
      const zones = (Array.isArray(state.zones) ? state.zones : []).map(normalizeZoneForPersistence).filter(Boolean);
      await api("/api/zones/save", "POST", { workspaceKey, selectedZoneId: Number(state.selectedZoneId || 0) || null, zones }, 20000);
    }

    function fitPatternToView() {
      const g = state.patternGeometry; if (!g || !g.bbox) return;
      const b = g.bbox; const m = 20;
      const w = Math.max(1, b.width), h = Math.max(1, b.height);
      const s = Math.max(0.05, Math.min((W - 2 * m) / w, (H - 2 * m) / h));
      state.viewport.scale = s;
      state.viewport.offsetX = m - b.minX * s + (W - 2 * m - w * s) / 2;
      state.viewport.offsetY = m - b.minY * s + (H - 2 * m - h * s) / 2;
    }

    function zoomAtCenter(factor) {
      const px = W / 2;
      const py = H / 2;
      const wb = screenToWorld(px, py);
      state.viewport.scale = Math.max(0.02, Math.min(500, state.viewport.scale * factor));
      state.viewport.offsetX = px - wb.x * state.viewport.scale;
      state.viewport.offsetY = (H - py) - wb.y * state.viewport.scale;
    }

    function linePoints(points) {
      const out = [];
      for (const p of points) {
        const s = worldToScreen(p);
        out.push(s.x, s.y);
      }
      return out;
    }

    const normalizeHexColor = (...a) => window.FurLabHatch.normalizeHexColor(...a);
    const clamp01 = (...a) => window.FurLabHatch.clamp01(...a);
    const hexToRgb = (...a) => window.FurLabHatch.hexToRgb(...a);
    const rgbaFromHex = (...a) => window.FurLabHatch.rgbaFromHex(...a);
    const computeMaterialHatchColor = (...a) => window.FurLabHatch.computeMaterialHatchColor(...a);
    const normalizeRange = (...a) => window.FurLabHatch.normalizeRange(...a);
    const getMaterialPatternSpec = (m) => window.FurLabHatch.getMaterialPatternSpec(m);
    const buildWavyLinePoints = (...a) => window.FurLabHatch.buildWavyLinePoints(...a);
    const buildWavyDashSegmentPoints = (...a) => window.FurLabHatch.buildWavyDashSegmentPoints(...a);
    const buildMaterialPreviewSvgMarkup = (m) => window.FurLabHatch.buildMaterialPreviewSvgMarkup(m);
    const buildMaterialPreviewSvg = (m) => window.FurLabHatch.buildMaterialPreviewSvg(m);
    const buildMaterialPatternPreviewStyle = (m) => window.FurLabHatch.buildMaterialPatternPreviewStyle(m);
    const describeMaterialPatternDebug = (m) => window.FurLabHatch.describeMaterialPatternDebug(m);
    const getZoneMaterialVisual = (m) => window.FurLabHatch.getZoneMaterialVisual(m);
    const buildHatchTile = (v, l) => window.FurLabHatch.buildHatchTile(v, l);

    function addZoneMaterialOverlay(layer, zone, visual) {
      const pts = Array.isArray(zone && zone.points) ? zone.points : [];
      if (pts.length < 3) return;
      const screenPts = pts.map((p) => worldToScreen(p));
      // §19 / §18.1: hole-aware — material must not paint inside holes (evenodd)
      const zHoles = Array.isArray(zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [];
      const hasHoles = zHoles.length > 0;
      const screenHoles = hasHoles ? zHoles.map((h) => h.map((p) => worldToScreen(p))) : [];
      const layerSpecs = Array.isArray(visual.layers) ? visual.layers : [];
      const angleDeg = Number(visual.angleRad || 0) * 180 / Math.PI;
      for (const layerSpec of layerSpecs) {
        const tile = buildHatchTile(visual, layerSpec);
        if (!tile) continue;
        const shape = new Konva.Shape({
          listening: false,
          fillPatternImage: tile,
          fillPatternRepeat: 'repeat',
          fillPatternRotation: angleDeg,
          stroke: null,
          strokeWidth: 0,
          sceneFunc(ctx2d, shape) {
            const nc = ctx2d._context || ctx2d;
            nc.save();
            nc.beginPath();
            for (let i = 0; i < screenPts.length; i++) {
              const p = screenPts[i];
              if (i === 0) nc.moveTo(p.x, p.y); else nc.lineTo(p.x, p.y);
            }
            nc.closePath();
            if (hasHoles) {
              for (const holePts of screenHoles) {
                for (let i = 0; i < holePts.length; i++) {
                  const p = holePts[i];
                  if (i === 0) nc.moveTo(p.x, p.y); else nc.lineTo(p.x, p.y);
                }
                nc.closePath();
              }
              nc.clip('evenodd');
            } else {
              nc.clip();
            }
            ctx2d.fillShape(shape);
            nc.restore();
          }
        });
        layer.add(shape);
      }
    }

    // (kept for potential reuse)
    function _addParallelHatchLegacy(hatchGroup, centerX, centerY, diag, visual, options) {
      const opts = options && typeof options === 'object' ? options : {};
      const useWave = !!opts.wave;
      const baseDash = Array.isArray(opts.dash) ? opts.dash : visual.dash;
      const strokeWidth = Math.max(0.45, Number(opts.strokeWidth || visual.strokeWidth));
      const stroke = opts.stroke || visual.hatchStroke;
      const angle = visual.angleRad;
      const dirX = Math.cos(angle); const dirY = Math.sin(angle);
      const normalX = -dirY; const normalY = dirX;
      const spacing = Math.max(5, Number(opts.spacing || visual.spacing));
      const amplitude = Number(opts.amplitude || visual.bendAmplitude || 2);
      const wavelength = Number(opts.wavelength || Math.max(12, visual.curlRadiusPx * 2));
      const pad = strokeWidth + 2;
      const size = Math.ceil(diag * 2 + pad * 2);
      const offscreen = document.createElement("canvas");
      offscreen.width = size; offscreen.height = size;
      const ctx2d = offscreen.getContext("2d");
      ctx2d.strokeStyle = stroke; ctx2d.lineWidth = strokeWidth; ctx2d.lineCap = "round"; ctx2d.lineJoin = "round";
      const lox = size / 2; const loy = size / 2;
      for (let offset = -diag; offset <= diag; offset += spacing) {
        const anchorX = normalX * offset; const anchorY = normalY * offset;
        if (useWave) {
          const dashLen = Math.max(1.2, baseDash[0]); const gapLen = Math.max(1.2, baseDash[1]);
          ctx2d.beginPath();
          for (let t = -diag; t <= diag; t += dashLen + gapLen) {
            const tEnd = Math.min(diag, t + dashLen);
            if (tEnd <= t) continue;
            const wpts = buildWavyDashSegmentPoints(anchorX, anchorY, dirX, dirY, normalX, normalY, t, tEnd, amplitude, wavelength);
            if (wpts.length < 4) continue;
            ctx2d.moveTo(lox + wpts[0], loy + wpts[1]);
            for (let wi = 2; wi < wpts.length; wi += 2) ctx2d.lineTo(lox + wpts[wi], loy + wpts[wi + 1]);
          }
          ctx2d.stroke();
        } else {
          const dashLen = Math.max(1.2, baseDash[0]); const gapLen = Math.max(1.2, baseDash[1]);
          ctx2d.setLineDash([dashLen, gapLen]);
          ctx2d.beginPath();
          ctx2d.moveTo(lox + anchorX - dirX * diag, loy + anchorY - dirY * diag);
          ctx2d.lineTo(lox + anchorX + dirX * diag, loy + anchorY + dirY * diag);
          ctx2d.stroke();
        }
      }
      ctx2d.setLineDash([]);
      hatchGroup.add(new Konva.Image({
        image: offscreen,
        x: centerX - size / 2,
        y: centerY - size / 2,
        width: size,
        height: size,
        listening: false
      }));
    }


    const getRenderablePatternEntities = () => window.FurLabPatternEntities.getRenderablePatternEntities();

    const computeDetailsFromEntities = (entities) => window.FurLabPatternEntities.computeDetailsFromEntities(entities);

    function fitBBoxToView(bbox) {
      if (!bbox) return;
      const m = 24;
      const w = Math.max(1, Number(bbox.width || 0));
      const h = Math.max(1, Number(bbox.height || 0));
      const s = Math.max(0.05, Math.min((W - 2 * m) / w, (H - 2 * m) / h));
      state.viewport.scale = s;
      state.viewport.offsetX = m - bbox.minX * s + (W - 2 * m - w * s) / 2;
      state.viewport.offsetY = m - bbox.minY * s + (H - 2 * m - h * s) / 2;
    }

    function fitPointsToView(points) {
      const pts = Array.isArray(points) ? points : [];
      if (pts.length < 2) return;
      const bb = polygonBBox(pts);
      if (
        !bb ||
        !Number.isFinite(bb.minX) || !Number.isFinite(bb.minY) ||
        !Number.isFinite(bb.maxX) || !Number.isFinite(bb.maxY)
      ) return;
      fitBBoxToView(bb);
    }

    const segmentIntersectionGlobal = (...a) => window.FurLabUtils.segmentIntersectionGlobal(...a);

    function closeSelectedGapConservative() {
      const selected = state.details.find((d) => d.id === state.selectedDetailId);
      if (!selected || !selected.entity) {
        byId("workspaceInfo").textContent = "No selected detail to close. Select detail first.";
        return;
      }
      const e = selected.entity;
      const pts = Array.isArray(e.points) ? e.points : [];
      if (pts.length < 4) {
        byId("workspaceInfo").textContent = "Selected contour is too short.";
        return;
      }
      const first = pts[0];
      const last = pts[pts.length - 1];
      const endDist = Math.hypot(last.x - first.x, last.y - first.y);
      const alreadyClosed = endDist <= 1e-6;
      if (alreadyClosed || e.closed === true) {
        byId("workspaceInfo").textContent = "Selected contour is already closed.";
        return;
      }

      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const p of pts) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      const diag = Math.hypot(w, h);
      // Force mode requested: connect ends regardless of gap/intersections.

      const np = pts.slice();
      np.push({ x: first.x, y: first.y });
      e.points = np;
      e.closed = true;
      e.smartCloseBridge = { from: { ...last }, to: { ...first }, dist: endDist, manual: true };
      renderScene();
      byId("workspaceInfo").textContent = `Selected contour force-closed (gap=${endDist.toFixed(2)}).`;
    }

    const updateProjectUi = () => window.FurLabProject && window.FurLabProject.updateProjectUi();
    const parseScrapContourPoints = (txt) => window.FurLabSvgParse.parseScrapContourPoints(txt);
    const translatePoints = (points, dx, dy) => window.FurLabGeom.translatePoints(points, dx, dy);
    const rotatePoints = (points, angleRad, center) => window.FurLabGeom.rotatePoints(points, angleRad, center);

    function initZonesFromDetails(allowedDetailIds) {
      if (!Array.isArray(state.details) || state.details.length === 0) {
        state.zones = [];
        state.selectedZoneId = null;
        state.selectedFragmentId = null;
        state.nextZoneId = 1;
        return;
      }
      const newZones = [];
      let zid = 1;
      for (const d of state.details) {
        if (allowedDetailIds instanceof Set && !allowedDetailIds.has(d.id)) continue;
        const e = d && d.entity;
        const pts = Array.isArray(e && e.points) ? e.points : [];
        if (pts.length < 3) continue;
        newZones.push({
          id: zid,
          name: `Зона ${zid}`,
          detailId: d.id,
          materialId: null,
          materialName: null,
          napDirectionDeg: DEFAULT_NAP_DIRECTION_DEG,
          originType: "base",
          parentZoneId: null,
          revision: 1,
          schemaVersion: 1,
          splitOperationId: null,
          splitDepth: 0,
          holes: [],
          points: pts.map((p) => ({ x: p.x, y: p.y }))
        });
        zid++;
      }
      state.zones = newZones;
      state.nextZoneId = zid;
      state.selectedZoneId = newZones.length ? newZones[0].id : null;
      state.selectedFragmentId = null;
      if (newZones.length) state.selectedDetailId = Number(newZones[0].detailId || state.selectedDetailId || 1);
      // Persist canonical contours into stable store so they survive after base zones are split.
      if (window.FurLabZoneLookups && typeof window.FurLabZoneLookups.registerDetailContour === "function") {
        for (const d of state.details) {
          const pts = Array.isArray(d && d.entity && d.entity.points) ? d.entity.points : [];
          if (pts.length >= 3) window.FurLabZoneLookups.registerDetailContour(d.id, pts);
        }
      }
      if (typeof updateProjectUi === "function") updateProjectUi();
    }

    function reconcileZonesWithDetails(zones) {
      const list = Array.isArray(zones) ? zones.map((zone) => ({ ...zone, points: Array.isArray(zone && zone.points) ? zone.points.map((p) => ({ x: p.x, y: p.y })) : [], holes: normalizeHoles(zone && zone.holes, zone && zone.id) })) : [];
      const details = Array.isArray(state.details) ? state.details : [];
      if (!details.length) return list;
      const coveredDetailIds = new Set(list.map((zone) => Number(zone && zone.detailId || 0)).filter((id) => id > 0));
      let nextId = list.reduce((maxId, zone) => Math.max(maxId, Number(zone && zone.id || 0)), 0) + 1;
      for (const detail of details) {
        const detailId = Number(detail && detail.id || 0) || 0;
        if (detailId <= 0 || coveredDetailIds.has(detailId)) continue;
        const pts = Array.isArray(detail && detail.entity && detail.entity.points) ? detail.entity.points : [];
        if (pts.length < 3) continue;
        list.push({
          id: nextId,
          name: `???? ${nextId}`,
          detailId,
          materialId: null,
          materialName: null,
          napDirectionDeg: DEFAULT_NAP_DIRECTION_DEG,
          originType: 'base',
          parentZoneId: null,
          parentZoneSnapshot: null,
          points: pts.map((p) => ({ x: p.x, y: p.y }))
        });
        coveredDetailIds.add(detailId);
        nextId += 1;
      }
      return list;
    }

    // §ZoneHole helpers — canonical hole format: { id: string, contour: Point[] }
    // holeContour(h): works with both legacy Point[] and new ZoneHole — returns Point[]
    function holeContour(h) {
      return Array.isArray(h) ? h : (Array.isArray(h && h.contour) ? h.contour : []);
    }

    // normalizeHoles: converts Point[][] | ZoneHole[] → ZoneHole[]
    // Stable ids: if already has id → keep; otherwise generate from zoneId + index
    function normalizeHoles(holesRaw, zoneId) {
      if (!Array.isArray(holesRaw)) return [];
      return holesRaw
        .map((h, i) => {
          const contour = holeContour(h);
          const pts = contour
            .map((p) => ({ x: Number(p && p.x), y: Number(p && p.y) }))
            .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
          if (pts.length < 3) return null;
          const id = (h && typeof h.id === "string" && h.id) ? h.id : `h-${zoneId}-${i}`;
          return { id, contour: pts };
        })
        .filter(Boolean);
    }

    function normalizeZoneForPersistence(zone) {
      if (!zone || typeof zone !== "object") return null;
      const id = Number(zone.id);
      const detailId = Number(zone.detailId);
      const points = (Array.isArray(zone.points) ? zone.points : [])
        .map((p) => ({ x: Number(p && p.x), y: Number(p && p.y) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(detailId) || detailId <= 0 || points.length < 3) return null;
      return {
        id,
        name: String(zone.name || `Зона ${id}`),
        detailId,
        materialId: zone.materialId !== undefined && zone.materialId !== null && String(zone.materialId).trim()
          ? String(zone.materialId).trim()
          : null,
        materialName: zone.materialName !== undefined && zone.materialName !== null && String(zone.materialName).trim()
          ? String(zone.materialName).trim()
          : null,
        napDirectionDeg: Number.isFinite(Number(zone.napDirectionDeg)) ? Number(zone.napDirectionDeg) : DEFAULT_NAP_DIRECTION_DEG,
        originType: ["base", "split", "manual", "promoted"].includes(String(zone.originType || "").trim().toLowerCase())
          ? String(zone.originType || "").trim().toLowerCase()
          : "base",
        parentZoneId: Number(zone.parentZoneId || 0) || null,
        parentZoneSnapshot: zone.parentZoneSnapshot && typeof zone.parentZoneSnapshot === "object"
          ? {
              id: Number(zone.parentZoneSnapshot.id || 0) || null,
              name: String(zone.parentZoneSnapshot.name || ""),
              detailId: Number(zone.parentZoneSnapshot.detailId || 0) || null,
              materialId: zone.parentZoneSnapshot.materialId !== undefined && zone.parentZoneSnapshot.materialId !== null && String(zone.parentZoneSnapshot.materialId).trim()
                ? String(zone.parentZoneSnapshot.materialId).trim()
                : null,
              materialName: zone.parentZoneSnapshot.materialName !== undefined && zone.parentZoneSnapshot.materialName !== null && String(zone.parentZoneSnapshot.materialName).trim()
                ? String(zone.parentZoneSnapshot.materialName).trim()
                : null,
              napDirectionDeg: Number.isFinite(Number(zone.parentZoneSnapshot.napDirectionDeg))
                ? Number(zone.parentZoneSnapshot.napDirectionDeg)
                : DEFAULT_NAP_DIRECTION_DEG,
              originType: ["base", "split", "manual"].includes(String(zone.parentZoneSnapshot.originType || "").trim().toLowerCase())
                ? String(zone.parentZoneSnapshot.originType || "").trim().toLowerCase()
                : "base",
              parentZoneId: Number(zone.parentZoneSnapshot.parentZoneId || 0) || null,
              points: (Array.isArray(zone.parentZoneSnapshot.points) ? zone.parentZoneSnapshot.points : [])
                .map((p) => ({ x: Number(p && p.x), y: Number(p && p.y) }))
                .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
            }
          : null,
        points,
        holes: Array.isArray(zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [],
        revision: Number.isFinite(Number(zone.revision)) && Number(zone.revision) > 0 ? Number(zone.revision) : 1,
        schemaVersion: Number.isFinite(Number(zone.schemaVersion)) && Number(zone.schemaVersion) > 0 ? Number(zone.schemaVersion) : 1,
        splitOperationId: zone.splitOperationId && String(zone.splitOperationId).trim() ? String(zone.splitOperationId).trim() : null,
        splitDepth: Number.isFinite(Number(zone.splitDepth)) && Number(zone.splitDepth) >= 0 ? Number(zone.splitDepth) : 0,
        holeBoundaryLinks: Array.isArray(zone.holeBoundaryLinks) ? zone.holeBoundaryLinks.map((hbl) => ({ ...hbl })) : []
      };
    }

    const api = (typeof window.furlabApi === "function")
      ? window.furlabApi
      : async function(path, method, body, timeoutMs) {
          const ctrl = new AbortController();
          const ms = Math.max(1000, Number(timeoutMs || 45000));
          const t = setTimeout(() => ctrl.abort(), ms);
          try {
            const res = await fetch(path, {
              method,
              headers: { "Content-Type": "application/json" },
              body: body ? JSON.stringify(body) : undefined,
              signal: ctrl.signal
            });
            return await res.json();
          } finally {
            clearTimeout(t);
          }
        };

    // ---------------------------------------------------------------------------
    // Materials helpers — declared early (needed by ZonesPersistence.init below)
    // ---------------------------------------------------------------------------
    const loadFurMaterialDetails = (id, f) => window.FurLabMaterials ? window.FurLabMaterials.loadFurMaterialDetails(id, f) : Promise.resolve(null);
    const ensureProjectMaterialEntry = (m) => window.FurLabMaterials ? window.FurLabMaterials.ensureProjectMaterialEntry(m) : null;

    // ---------------------------------------------------------------------------
    // Zones persistence — delegated to window.FurLabZonesPersistence (core/zones-persistence.js)
    // ---------------------------------------------------------------------------
    if (window.FurLabZonesPersistence) window.FurLabZonesPersistence.init({
      state,
      api,
      normalizeZoneForPersistence,
      reconcileZonesWithDetails,
      migrateLoadedZoneOriginTypes: (zones) => migrateLoadedZoneOriginTypes(zones),
      ensureProjectMaterialEntry,
      loadFurMaterialDetails,
      initZonesFromDetails,
      clearActiveLayoutRuntime: (...args) => clearActiveLayoutRuntime(...args),
      render: { renderScene: () => renderScene(), renderLayoutModeSwitch: () => renderLayoutModeSwitch(), renderDetailZoneTree: () => renderDetailZoneTree(), renderPropertyEditor: () => renderPropertyEditor() },
    });
    const buildZonesWorkspaceKey = () => window.FurLabZonesPersistence ? window.FurLabZonesPersistence.buildZonesWorkspaceKey() : "";
    const buildZoneValidationPayload = () => window.FurLabZonesPersistence ? window.FurLabZonesPersistence.buildZoneValidationPayload() : {};
    const validateZonesForCurrentWorkspace = () => window.FurLabZonesPersistence ? window.FurLabZonesPersistence.validateZonesForCurrentWorkspace() : Promise.resolve();
    const persistZonesForCurrentWorkspace = () => window.FurLabZonesPersistence ? window.FurLabZonesPersistence.persistZonesForCurrentWorkspace() : Promise.resolve();
    const loadZonesForCurrentWorkspace = (opts) => window.FurLabZonesPersistence ? window.FurLabZonesPersistence.loadZonesForCurrentWorkspace(opts) : Promise.resolve();
    const resetZonesForCurrentWorkspace = () => window.FurLabZonesPersistence ? window.FurLabZonesPersistence.resetZonesForCurrentWorkspace() : Promise.resolve();

    // ---------------------------------------------------------------------------
    // commitZoneMutation — единый шлюз для всех изменений state.zones
    // ---------------------------------------------------------------------------

    function getOrAutoRegisterPartContour(detailId) {
      const lookups = window.FurLabZoneLookups;
      if (!lookups) return [];
      if (typeof lookups.isDetailBoundaryKnown === "function" && lookups.isDetailBoundaryKnown(detailId)) {
        const z0 = (Array.isArray(state.zones) ? state.zones : []).find((z) => Number(z && z.detailId || 0) === detailId);
        return z0 ? lookups.getDetailBoundaryPointsForZone(z0) : [];
      }
      // Auto-compute from union of all zones for this detail
      const pc = (typeof window !== "undefined" && window.polygonClipping) || null;
      const zonesForUnion = (Array.isArray(state.zones) ? state.zones : []).filter(
        (z) => Number(z && z.detailId || 0) === detailId && Array.isArray(z.points) && z.points.length >= 3
      );
      if (zonesForUnion.length === 0) return [];
      // Fallback for single zone: use its points directly (no polygonClipping needed)
      if (zonesForUnion.length === 1) {
        const pts = zonesForUnion[0].points;
        if (typeof lookups.registerDetailContour === "function") lookups.registerDetailContour(detailId, pts);
        return pts;
      }
      if (!pc) return [];
      try {
        const multiPolys = zonesForUnion.map((z) => [z.points.map((p) => [p.x, p.y])]);
        let unionResult = [multiPolys[0]];
        for (let i = 1; i < multiPolys.length; i++) unionResult = pc.union(unionResult, [multiPolys[i]]);
        if (Array.isArray(unionResult) && unionResult.length > 0 && Array.isArray(unionResult[0]) && unionResult[0].length > 0) {
          const outerRing = unionResult[0][0];
          if (Array.isArray(outerRing) && outerRing.length >= 3) {
            const contourPts = outerRing.slice(0, -1).map(([x, y]) => ({ x, y }));
            if (typeof lookups.registerDetailContour === "function") lookups.registerDetailContour(detailId, contourPts);
            return contourPts;
          }
        }
      } catch (_) {}
      return [];
    }

    function computePartitionMetrics(partContour, zonesForPart) {
      const geom = window.FurLabGeom;
      const pc = (typeof window !== "undefined" && window.polygonClipping) || null;
      const result = { partArea: 0, unionArea: 0, gapArea: 0, overlapArea: 0, partitionValid: false };
      if (!geom || typeof geom.polygonArea !== "function") return result;
      if (!Array.isArray(partContour) || partContour.length < 3) return result;
      result.partArea = Math.abs(geom.polygonArea(partContour));
      const validZones = (Array.isArray(zonesForPart) ? zonesForPart : []).filter(
        (z) => Array.isArray(z.points) && z.points.length >= 3
      );
      if (validZones.length === 0) return result;
      // Net area = outer - holes
      const zoneNetArea = (z) => {
        let a = Math.abs(geom.polygonArea(z.points));
        if (Array.isArray(z.holes)) z.holes.forEach((h) => { const pts = holeContour(h); if (pts.length >= 3) a -= Math.abs(geom.polygonArea(pts)); });
        return Math.max(0, a);
      };
      const sumAreas = validZones.reduce((s, z) => s + zoneNetArea(z), 0);
      if (validZones.length === 1 || !pc) {
        // Single zone or no polygonClipping: union = sum of areas, no overlap possible
        result.unionArea = sumAreas;
        result.gapArea = Math.max(0, result.partArea - result.unionArea);
        result.overlapArea = 0;
        result.partitionValid = result.gapArea < 1 && result.overlapArea < 1;
        return result;
      }
      try {
        // polygonClipping expects MultiPolygon = Polygon[] = Ring[][]; include holes as inner rings
        const multiPolys = validZones.map((z) => {
          const rings = [z.points.map((p) => [p.x, p.y])];
          if (Array.isArray(z.holes)) z.holes.forEach((h) => { const pts = holeContour(h); if (pts.length >= 3) rings.push(pts.map((p) => [p.x, p.y])); });
          return rings; // Polygon = Ring[][], not MultiPolygon
        });
        let unionResult = [multiPolys[0]]; // wrap as MultiPolygon
        for (let i = 1; i < multiPolys.length; i++) unionResult = pc.union(unionResult, [multiPolys[i]]);
        if (Array.isArray(unionResult) && unionResult.length > 0 && Array.isArray(unionResult[0]) && unionResult[0].length > 0) {
          const outer = unionResult[0][0];
          if (Array.isArray(outer) && outer.length >= 3) {
            result.unionArea = Math.abs(geom.polygonArea(outer.map(([x, y]) => ({ x, y }))));
          }
        }
        result.overlapArea = Math.max(0, sumAreas - result.unionArea);
        result.gapArea = Math.max(0, result.partArea - result.unionArea);
        result.partitionValid = result.gapArea < 1 && result.overlapArea < 1;
      } catch (_) {}
      return result;
    }

    function updateDebugOverlay() {
      const panel = typeof document !== "undefined" && document.getElementById("devOverlay");
      if (!panel) return;
      const devEnabled = (typeof window !== "undefined" && window.__furlab_dev_overlay) || false;
      if (!devEnabled) { panel.style.display = "none"; return; }
      panel.style.display = "";
      const detailId = Number(state.selectedDetailId || 0) || null;
      const allZones = Array.isArray(state.zones) ? state.zones : [];
      const zonesForPart = detailId ? allZones.filter((z) => Number(z.detailId || 0) === detailId) : [];
      const partContour = detailId ? getOrAutoRegisterPartContour(detailId) : [];
      const metrics = computePartitionMetrics(partContour, zonesForPart);
      const treeEl = typeof document !== "undefined" && document.getElementById("detailZoneTree");
      const treeCount = treeEl ? treeEl.querySelectorAll(".zone-row").length : "?";
      const allZonesCount = allZones.length;
      const hasPartContour = partContour.length >= 3;
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      set("dev_partId", detailId || "—");
      set("dev_zonesCount", zonesForPart.length + " / " + allZonesCount);
      set("dev_partArea", metrics.partArea > 0 ? metrics.partArea.toFixed(0) + " мм²" : "— (нет контура)");
      set("dev_unionArea", metrics.unionArea > 0 ? metrics.unionArea.toFixed(0) + " мм²" : "—");
      set("dev_gapArea", hasPartContour ? metrics.gapArea.toFixed(1) + " мм²" : "—");
      set("dev_overlapArea", hasPartContour ? metrics.overlapArea.toFixed(1) + " мм²" : "—");
      const validEl = document.getElementById("dev_partitionValid");
      if (validEl) {
        if (!hasPartContour) {
          validEl.textContent = "— (нет контура)";
          validEl.className = "";
        } else {
          validEl.textContent = metrics.partitionValid ? "✓ PASS" : "✗ FAIL";
          validEl.className = metrics.partitionValid ? "valid" : "invalid";
        }
      }
      set("dev_selectedZone", state.selectedZoneId || "—");
      const selZ = allZones.find((z) => Number(z.id || 0) === Number(state.selectedZoneId || 0)) || null;
      const selOriginType = selZ ? String(selZ.originType || "—") : "—";
      const selIsLast = selZ ? isLastZoneInDetail(selZ) : false;
      const selVertexIdx = typeof state.selectedVertexIndex === "number" ? state.selectedVertexIndex : null;
      const selIsOnPartBound = selZ && selVertexIdx !== null
        ? isZoneVertexOnDetailBoundary(selZ, selVertexIdx)
        : false;
      // Zone-level lock: base or sole zone. Vertex-level lock: boundary vertex.
      const selZoneLocked = selZ && (selOriginType === "base" || selIsLast);
      const selLocked = selZoneLocked || selIsOnPartBound;
      set("dev_originType", selOriginType);
      set("dev_isLastZone", selZ ? (selIsLast ? "true" : "false") : "—");
      const _lkps = window.FurLabZoneLookups;
      const _did = selZ ? Number(selZ.detailId || 0) : 0;
      const _bsrc = !_did ? "—"
        : (_lkps && _lkps.isDetailBoundaryKnown && _lkps.isDetailBoundaryKnown(_did))
          ? (Array.isArray(allZones) && allZones.some((z) => Number(z.detailId || 0) === _did && z.originType === "base") && !Array.isArray(state.details) ? "registered_cache" : "canonical_dxf_or_cache")
          : "union_fallback";
      set("dev_boundarySource", _bsrc);
      const boundEl = document.getElementById("dev_isOnPartBound");
      if (boundEl) {
        boundEl.textContent = selZ ? (selVertexIdx !== null ? (selIsOnPartBound ? "true (v" + selVertexIdx + ")" : "false (v" + selVertexIdx + ")") : "no vertex") : "—";
        boundEl.className = selIsOnPartBound ? "invalid" : "";
      }
      const lockEl = document.getElementById("dev_editLock");
      if (lockEl) {
        lockEl.textContent = selZ ? (selLocked ? "🔒 part_boundary_locked" : "✓ editable") : "—";
        lockEl.className = selLocked ? "invalid" : (selZ ? "valid" : "");
      }
      set("dev_rendered", allZonesCount);
      set("dev_tree", treeCount);
      set("dev_lastOp", state._lastCommitOp || "—");
      // Zone geometry validation for selected zone
      const geomIssues = selZ ? validateZoneGeometryClient(selZ) : [];
      const geomErrors = geomIssues.filter((i) => i.severity === "error");
      const geomEl = document.getElementById("dev_zoneGeom");
      if (geomEl) {
        if (!selZ) { geomEl.textContent = "—"; geomEl.className = ""; }
        else if (geomErrors.length === 0) { geomEl.textContent = "✓ OK"; geomEl.className = "valid"; }
        else { geomEl.textContent = "✗ " + geomErrors.map((i) => i.code).join(", "); geomEl.className = "invalid"; }
      }
      const partitionOk = !hasPartContour || metrics.partitionValid || zonesForPart.length === 0;
      const geomOk = geomErrors.length === 0;
      panel.className = "dev-overlay" + ((partitionOk && geomOk) ? "" : " invalid");
      set("dev_handleScale", (Math.max(0.5, Math.min(3, Number(state.ui && state.ui.handleScale) || 1))).toFixed(2) + "×");
    }

    function updateLayoutContractMonitor(diag, meta) {
      if (diag && typeof diag === "object") {
        window.__lcm_lastDiag = diag;
        window.__lcm_lastMeta = meta || null;
        // Persist diag into current layout entry so it survives selectLayoutEntry
        const _lcmEntry = getSelectedLayoutEntry();
        if (_lcmEntry) { _lcmEntry._lcmDiag = diag; _lcmEntry._lcmMeta = meta || null; }
      }
      const panel = typeof document !== "undefined" && document.getElementById("layoutContractMonitor");
      if (!panel) return;
      const devEnabled = (typeof window !== "undefined" && window.__furlab_lcm_overlay) || false;
      if (!devEnabled) { panel.style.display = "none"; return; }
      panel.style.display = "";
      if (!diag || typeof diag !== "object") return;
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      const m = meta || {};
      set("lcm_endpoint", m.endpoint || "—");
      set("lcm_layoutType", m.layoutType || diag.layoutType || "—");
      const payloadHasHoles = !!(m.payloadHasHoles);
      set("lcm_payloadHasHoles", payloadHasHoles ? "✓ true" : "✗ false (legacy)");
      set("lcm_holesReceived", diag.holesReceived ? "✓ true" : "false");
      set("lcm_usedZoneDomain", diag.usedZoneDomain ? "✓ true" : "false");
      set("lcm_outerArea", diag.outerAreaMm2 != null ? diag.outerAreaMm2.toFixed(0) + " мм²" : "—");
      set("lcm_holesCount", diag.holesCount != null ? String(diag.holesCount) : "—");
      set("lcm_holesArea", diag.holesAreaMm2 != null ? diag.holesAreaMm2.toFixed(0) + " мм²" : "—");
      set("lcm_zoneDomainArea", diag.zoneDomainAreaMm2 != null ? diag.zoneDomainAreaMm2.toFixed(0) + " мм²" : "—");
      set("lcm_fragmentCount", diag.fragmentCount != null ? String(diag.fragmentCount) : "—");
      const insideHoles = diag.fragmentsInsideHolesArea || 0;
      set("lcm_inHolesArea", insideHoles.toFixed(1) + " мм²" + (insideHoles > 1 ? " ⚠" : ""));
      const outsideDomain = diag.fragmentsOutsideZoneDomainArea || 0;
      set("lcm_outsideDomainArea", outsideDomain.toFixed(1) + " мм²" + (outsideDomain > 1 ? " ⚠" : ""));
      set("lcm_covRatioDenom", diag.coveredRatioDenominator || "—");
      const issues = Array.isArray(diag.issues) ? diag.issues : [];
      set("lcm_issues", issues.length ? issues.join(", ") : "✓ none");
      const validEl = document.getElementById("lcm_contractValid");
      const badgeEl = document.getElementById("lcm_badge");
      const noHoles = !payloadHasHoles || !diag.holesReceived || diag.holesCount === 0;
      if (validEl) {
        if (!diag.contractValid) {
          validEl.textContent = "✗ FAIL";
          validEl.className = "invalid";
        } else if (noHoles) {
          validEl.textContent = "~ NO_HOLES";
          validEl.className = "warn";
        } else {
          validEl.textContent = "✓ PASS";
          validEl.className = "valid";
        }
      }
      if (badgeEl) {
        if (!diag.contractValid) {
          badgeEl.textContent = "CONTRACT FAIL";
          badgeEl.className = "red";
        } else if (noHoles) {
          badgeEl.textContent = "NO HOLES (ok)";
          badgeEl.className = "yellow";
        } else {
          badgeEl.textContent = "CONTRACT OK";
          badgeEl.className = "green";
        }
      }
      panel.className = "dev-overlay" + (!diag.contractValid ? " invalid" : (noHoles ? " warn" : ""));
    }

    function updateVoronoiSaMonitor(res) {
      if (!window.FurLabInventoryVoronoiSaMonitor) return;
      window.FurLabInventoryVoronoiSaMonitor.updateMonitor({
        res,
        buildRunOutputExport,
        downloadJsonFile
      });
    }

    // commitZoneMutation — применяет candidateZones если они проходят валидацию.
    // beforeZones используется для rollback при ошибке.
    // affectedDetailId — detalь для которой проверяем partition.
    // skipValidation — для системных операций (load, undo).
    // validateOnly: true — только валидирует, не меняет state.zones (используется когда executeCommand делает apply).
    // validateOnly: false (default) — валидирует + state.zones = candidateZones + persist.
    async function commitZoneMutation({ operationType, beforeZones, candidateZones, affectedDetailId, skipValidation, deferPersist, validateOnly }) {
      const geomMod = window.FurLabGeom;
      if (!skipValidation) {
        // 1. Geometry invariant: каждая candidate зона должна быть геометрически корректна
        const geomErrors = [];
        for (const z of candidateZones) {
          const issues = validateZoneGeometryClient(z);
          for (const issue of issues) {
            if (String(issue.severity || "") === "error") geomErrors.push({ zoneId: z.id, issue });
          }
        }
        if (geomErrors.length > 0) {
          if (!validateOnly) { state.zones = beforeZones; renderScene(); }
          const msg = `[geometry_error] ${geomErrors[0].issue.message || geomErrors[0].issue.code} (zone ${geomErrors[0].zoneId})`;
          if (typeof byId === "function" && byId("workspaceInfo")) byId("workspaceInfo").textContent = msg;
          updateDebugOverlay();
          return { ok: false, reason: "geometry", issues: geomErrors };
        }

        // 2. Partition invariant: candidateZones для affectedDetailId должны покрывать деталь без пробелов и перекрытий
        if (affectedDetailId && geomMod && typeof geomMod.validatePartZonePartition === "function") {
          const partContour = getOrAutoRegisterPartContour(affectedDetailId);
          if (partContour.length >= 3) {
            const candidatesForPart = candidateZones.filter((z) => Number(z.detailId || 0) === affectedDetailId);
            const partIssues = geomMod.validatePartZonePartition(partContour, candidatesForPart);
            const partErrors = partIssues.filter((i) => String(i.severity || "") === "error");
            if (partErrors.length > 0) {
              if (!validateOnly) { state.zones = beforeZones; renderScene(); }
              const msg = `[partition_error:${operationType}] ${partErrors[0].message || partErrors[0].code}`;
              if (typeof byId === "function" && byId("workspaceInfo")) byId("workspaceInfo").textContent = msg;
              updateDebugOverlay();
              return { ok: false, reason: "partition", issues: partErrors };
            }
          }
        }
      }

      // 3. Commit — пропускаем если validateOnly (state меняет executeCommand)
      if (!validateOnly) {
        state.zones = candidateZones;
        invalidateDetailBoundaryCache(); // зоны изменились — контур детали нужно пересчитать
      }
      state._lastCommitOp = operationType || "unknown";
      if (!validateOnly && !deferPersist) await persistZonesForCurrentWorkspace();
      if (!validateOnly) { renderScene(); updateDebugOverlay(); }
      return { ok: true, metrics: affectedDetailId ? computePartitionMetrics(getOrAutoRegisterPartContour(affectedDetailId), candidateZones.filter((z) => Number(z.detailId || 0) === affectedDetailId)) : null };
    }

    // ---------------------------------------------------------------------------
    // Materials catalog — delegated to window.FurLabMaterials (core/materials.js)
    // ---------------------------------------------------------------------------
    if (window.FurLabMaterials) window.FurLabMaterials.init({
      state,
      api,
      renderPropertyEditor: () => renderPropertyEditor(),
    });
    const loadMaterialsDict = (f) => window.FurLabMaterials ? window.FurLabMaterials.loadMaterialsDict(f) : Promise.resolve([]);
    const loadFurMaterialsCatalog = (f) => window.FurLabMaterials ? window.FurLabMaterials.loadFurMaterialsCatalog(f) : Promise.resolve([]);
    const getFurMaterialById = (id) => window.FurLabMaterials ? window.FurLabMaterials.getFurMaterialById(id) : null;

    async function removeProjectMaterialById(materialId) {
      const id = String(materialId || "").trim();
      if (!id) return false;
      const assignedZones = (Array.isArray(state.zones) ? state.zones : []).filter((zone) => String(zone && zone.materialId || "").trim() === id);
      const material = getFurMaterialById(id) || (Array.isArray(state.projectMaterials) ? state.projectMaterials.find((item) => String(item && item.id || "") === id) : null) || null;
      const materialName = String(material && (material.name || material.materialName) || id);
      if (assignedZones.length > 0) {
        const ok = window.confirm(`Мех "${materialName}" назначен ${assignedZones.length} зон(ам). Снять назначение и удалить его из проекта?`);
        if (!ok) return false;
        for (const zone of assignedZones) {
          const json = await assignMaterialToZone(zone, { id: null, name: null });
          if (!json || !json.ok) {
            byId("workspaceInfo").textContent = `Ошибка снятия материала с зоны: ${String(json && json.error || "unknown")}`;
            return false;
          }
        }
      }
      state.projectMaterials = (Array.isArray(state.projectMaterials) ? state.projectMaterials : []).filter((item) => String(item && item.id || "") !== id);
      if (state.furMaterialDetailsById && typeof state.furMaterialDetailsById === "object") {
        delete state.furMaterialDetailsById[id];
      }
      if (String(state.selectedMaterialId || "") === id) {
        const next = Array.isArray(state.projectMaterials) && state.projectMaterials.length > 0 ? state.projectMaterials[0] : null;
        state.selectedMaterialId = String(next && next.id || "");
      }
      renderDetailZoneTree();
      renderPropertyEditor();
      renderScene();
      byId("workspaceInfo").textContent = `Мех удалён из проекта: ${materialName}`;
      return true;
    }

    async function assignMaterialToZone(zone, material) {
      const z = zone && typeof zone === "object" ? zone : null;
      if (!z) return { ok: false, error: "zone_required" };
      const workspaceKey = buildZonesWorkspaceKey();
      if (!workspaceKey) return { ok: false, error: "zones_workspace_missing" };
      const materialId = material && material.id !== undefined && material.id !== null && String(material.id).trim()
        ? String(material.id).trim()
        : null;
      const materialName = material && material.name !== undefined && material.name !== null && String(material.name).trim()
        ? String(material.name).trim()
        : null;
      const zoneId = Number(z.id || 0) || 0;
      if (zoneId > 0 && z.materialId && Array.isArray(state.layouts)) {
        const hasFragments = state.layouts.some(
          (le) => isFragmentOnlyLayoutMode(String(le && le.mode || "")) &&
            Number(le.boundZoneId || 0) === zoneId &&
            Array.isArray(le.layoutRun && le.layoutRun.fragments) &&
            le.layoutRun.fragments.length > 0
        );
        if (hasFragments) {
          if (!confirm("Материал меха изменён. Фрагменты выкладки будут пересчитаны. Продолжить?")) {
            return { ok: false, error: "cancelled_by_user" };
          }
        }
      }
      const json = await api(`/api/project/zones/${encodeURIComponent(String(Number(z.id || 0) || 0))}/material`, "POST", {
        workspaceKey,
        materialId,
        materialName
      }, 20000);
        if (json && json.ok) {
          const targetZone = state.zones.find((z2) => Number(z2 && z2.id || 0) === zoneId);
          if (targetZone) {
            targetZone.materialId = materialId || undefined;
            targetZone.materialName = materialName || undefined;
            targetZone.revision = (Number.isFinite(Number(targetZone.revision)) && Number(targetZone.revision) > 0 ? Number(targetZone.revision) : 1) + 1;
            invalidateZoneDerivedData(targetZone);
          }
          if (materialId) ensureProjectMaterialEntry({ id: materialId, name: materialName });
          const changedZoneId = Number(z.id || 0) || 0;
          if (changedZoneId > 0 && Array.isArray(state.layouts)) {
            for (const le of state.layouts) {
              if (isFragmentOnlyLayoutMode(String(le && le.mode || "")) && Number(le.boundZoneId || 0) === changedZoneId) {
                le.isDirty = true;
              }
            }
          }
          await validateZonesForCurrentWorkspace();
          renderDetailZoneTree();
          renderPropertyEditor();
        renderScene();
        const assignedName = materialName || materialId || "не выбран";
        byId("workspaceInfo").textContent = materialId
          ? `Материал назначен зоне: ${assignedName}`
          : "Материал зоны снят.";
      }
      return json;
    }

    async function openMaterialLibrary(zone) {
      state.libraryPickerMode = "materials";
      state.pendingZoneMaterialZoneId = zone && typeof zone === "object"
        ? (Number(zone.id || 0) || null)
        : null;
      await loadFurMaterialsCatalog();
      if (layoutTypePicker && typeof layoutTypePicker.open === "function") {
        layoutTypePicker.open();
        return;
      }
      byId("layoutTypeBackdrop").style.display = "flex";
    }

    async function addMaterialById(materialId) {
      const id = String(materialId || "").trim();
      if (!id) return;
      const catalog = await loadFurMaterialsCatalog();
      const material = catalog.find((item) => String(item.id || "") === id) || { id, name: id };
      ensureProjectMaterialEntry(material);
      state.selectedMaterialId = id;
      await loadFurMaterialDetails(id);
      const zoneId = Number(state.pendingZoneMaterialZoneId || state.selectedZoneId || 0) || 0;
      if (zoneId > 0) {
        const zone = state.zones.find((item) => Number(item && item.id || 0) === zoneId) || null;
        if (zone) {
          const conflictZone = (Array.isArray(state.zones) ? state.zones : []).find((z) =>
            z && Number(z.id || 0) !== zoneId && String(z.materialId || "").trim() === id
          );
          if (conflictZone) {
            const conflictName = String(conflictZone.name || `Зона ${conflictZone.id}`);
            byId("workspaceInfo").textContent = `Мех уже назначен зоне "${conflictName}". Один мех — одна зона.`;
            closeLayoutTypePicker();
            return;
          }
          const json = await assignMaterialToZone(zone, material);
          if (!json || !json.ok) {
            byId("workspaceInfo").textContent = `Ошибка назначения материала: ${String(json && json.error || "unknown")}`;
            return;
          }
        }
      }
      state.uiPanel = "materials";
      renderLayoutModeSwitch();
      renderDetailZoneTree();
      renderPropertyEditor();
    }

    function openZoneMaterialModal(zone, items) {
      const z = zone && typeof zone === "object" ? zone : null;
      const list = Array.isArray(items) ? items : [];
      if (!z) return;
      const backdrop = byId("zoneMaterialBackdrop");
      const title = byId("zoneMaterialTitle");
      const info = byId("zoneMaterialInfo");
      const select = byId("zoneMaterialSelect");
      if (!backdrop || !title || !info || !select) return;
      title.textContent = `Меховой материал: ${String(z.name || `Зона ${z.id}`)}`;
      info.textContent = list.length
        ? `Найдено материалов: ${list.length}`
        : "Материалы в базе не найдены.";
      select.innerHTML = [`<option value="">Не назначен</option>`]
        .concat(list.map((item) => {
          const label = item.piecesCount > 0
            ? `${escapeHtml(item.name || item.id)} (${Number(item.piecesCount)} шт.)`
            : `${escapeHtml(item.name || item.id)}`;
          return `<option value="${escapeHtml(item.id)}">${label}</option>`;
        }))
        .join("");
      select.value = String(z.materialId || "");
      state.pendingZoneMaterialZoneId = Number(z.id || 0) || null;
      backdrop.style.display = "flex";
    }

    function closeZoneMaterialModal() {
      const backdrop = byId("zoneMaterialBackdrop");
      if (backdrop) backdrop.style.display = "none";
      state.pendingZoneMaterialZoneId = null;
    }

    // ---------------------------------------------------------------------------
    // Zone classification — delegated to window.FurLabZoneClassify (core/zone-classify.js)
    // ---------------------------------------------------------------------------
    if (window.FurLabZoneLookups) window.FurLabZoneLookups.init({
      state,
      isInventoryLikeLayoutMode: (mode) => isInventoryLikeLayoutMode(mode),
      isManualInventoryMode: () => isManualInventoryMode(),
    });
    if (window.FurLabPatternEntities) window.FurLabPatternEntities.init({
      state,
      getPreviewSourceType: () => previewSourceType,
    });
    if (window.FurLabZoneClassify) window.FurLabZoneClassify.init({ state });
    const getDetailContourPoints = (id) => window.FurLabZoneClassify ? window.FurLabZoneClassify.getDetailContourPoints(id) : [];
    const pointsMatchExactly = (a, b, tol) => window.FurLabZoneClassify ? window.FurLabZoneClassify.pointsMatchExactly(a, b, tol) : false;
    const isLikelyBaseZone = (z) => window.FurLabZoneClassify ? window.FurLabZoneClassify.isLikelyBaseZone(z) : false;
    const isLegacyManualZone = (z) => window.FurLabZoneClassify ? window.FurLabZoneClassify.isLegacyManualZone(z) : false;
    const migrateLoadedZoneOriginTypes = (zones) => window.FurLabZoneClassify ? window.FurLabZoneClassify.migrateLoadedZoneOriginTypes(zones) : false;
    function migrateLoadedZonesClient(zones) {
      const list = Array.isArray(zones) ? zones : [];
      for (const z of list) {
        if (!z || typeof z !== "object") continue;
        if (!Number.isFinite(Number(z.revision)) || Number(z.revision) <= 0) z.revision = 1;
        if (!Number.isFinite(Number(z.schemaVersion)) || Number(z.schemaVersion) <= 0) z.schemaVersion = 1;
        if (z.splitOperationId === undefined) z.splitOperationId = null;
        if (z.splitDepth === undefined) z.splitDepth = 0;
        if (z.parentZoneId === undefined) z.parentZoneId = null;
        if (z.parentZoneSnapshot === undefined) z.parentZoneSnapshot = null;
        if (z.holes === undefined) z.holes = [];
        if (!Array.isArray(z.holeBoundaryLinks)) z.holeBoundaryLinks = [];
        if (z.promoteOperationId === undefined) z.promoteOperationId = null;
        if (z.sourceLayoutRunId === undefined) z.sourceLayoutRunId = null;
        if (z.sourceFragmentId === undefined) z.sourceFragmentId = null;
        if (String(z.originType || "") === "split" && !z.parentZoneSnapshot && !z.splitOperationId) {
          z._legacySplitMissingSnapshot = true;
        }
      }
      migrateLoadedZoneOriginTypes(list);
    }
    const isSplitDerivedZone = (z) => window.FurLabZoneClassify ? window.FurLabZoneClassify.isSplitDerivedZone(z) : false;
    const isManualZone = (z) => window.FurLabZoneClassify ? window.FurLabZoneClassify.isManualZone(z) : false;
    const getRelatedSplitZones = (z) => window.FurLabZoneClassify ? window.FurLabZoneClassify.getRelatedSplitZones(z) : [];
    const hasSplitDescendants = (z) => window.FurLabZoneClassify ? window.FurLabZoneClassify.hasSplitDescendants(z) : false;
    const canRestoreParentZone = (z) => window.FurLabZoneClassify ? window.FurLabZoneClassify.canRestoreParentZone(z) : false;
    const isLastZoneInDetail = (z) => window.FurLabZoneClassify ? window.FurLabZoneClassify.isLastZoneInDetail(z) : false;
    const canDeleteZone = (z) => window.FurLabZoneClassify ? window.FurLabZoneClassify.canDeleteZone(z) : false;

    let zoneContextMenuEl = null;

    function ensureZoneContextMenu() {
      if (zoneContextMenuEl && zoneContextMenuEl.isConnected) return zoneContextMenuEl;
      const menu = document.createElement("div");
      menu.className = "zone-context-menu";
      menu.setAttribute("role", "menu");
      document.body.appendChild(menu);
      const hide = (e) => {
        if (!menu.classList.contains("open")) return;
        if (e && menu.contains(e.target)) return;
        hideZoneContextMenu();
      };
      document.addEventListener("mousedown", hide, true);
      document.addEventListener("scroll", () => hideZoneContextMenu(), true);
      document.addEventListener("keydown", (e) => {
        if (String(e && e.key || "") === "Escape") hideZoneContextMenu();
      });
      zoneContextMenuEl = menu;
      return menu;
    }

    function hideZoneContextMenu() {
      const menu = zoneContextMenuEl;
      if (!menu) return;
      menu.classList.remove("open");
      menu.style.left = "-9999px";
      menu.style.top = "-9999px";
      menu.innerHTML = "";
    }

    function selectZoneForEditing(zone) {
      const z = zone && typeof zone === "object" ? zone : null;
      if (!z) return;
      state.selectedZoneId = Number(z.id || 0) || null;
      state.selectedDetailId = Number(z.detailId || state.selectedDetailId || 0) || state.selectedDetailId;
      state.selectedFragmentId = null;
      setWorkspaceTool("edit-vertex", { skipRender: true });
      fitPointsToView(z.points);
      renderScene();
      renderDetailZoneTree();
      renderPropertyEditor();
    }

    async function deleteZoneEntry(zone, options) {
      const z = zone && typeof zone === "object" ? zone : null;
      if (!z) return false;
      const zoneId = Number(z.id || 0) || 0;
      if (zoneId <= 0) return false;
      if (!canDeleteZone(z)) {
        byId("workspaceInfo").textContent = isLastZoneInDetail(z)
          ? "[base_zone_cannot_be_deleted] Базовую зону детали удалять нельзя."
          : isSplitDerivedZone(z)
            ? "Нельзя отменить это разбиение, пока существуют дочерние зоны более глубокого уровня."
            : "Эту зону сейчас нельзя удалить.";
        return false;
      }
      const isManual = isManualZone(z);
      const relatedSplitZones = isManual ? [] : getRelatedSplitZones(z);
      const affectedZoneIds = new Set(relatedSplitZones.map((item) => Number(item && item.id || 0)).filter((id) => id > 0));
      affectedZoneIds.add(zoneId);
      const dependentLayouts = (Array.isArray(state.layouts) ? state.layouts : []).filter((entry) => affectedZoneIds.has(Number(entry && entry.boundZoneId || 0)));
      const parentZoneName = String(z && z.parentZoneSnapshot && z.parentZoneSnapshot.name || `Зона ${Number(z.parentZoneId || 0) || ""}`).trim();
      const message = isManual
        ? (dependentLayouts.length
          ? `Удалить зону "${String(z.name || `Зона ${zoneId}`)}"? Связанные выкладки (${dependentLayouts.length}) будут удалены.`
          : `Удалить зону "${String(z.name || `Зона ${zoneId}`)}"?`)
        : (dependentLayouts.length
          ? `Отменить разбиение и восстановить "${parentZoneName}"? Связанные выкладки (${dependentLayouts.length}) будут удалены.`
          : `Отменить разбиение и восстановить "${parentZoneName}"?`);
      const skipConfirm = options && options.skipConfirm;
      if (!skipConfirm && typeof window.confirm === "function" && !window.confirm(message)) return false;
      hideZoneContextMenu();
      // Silently remove dependent layouts without intermediate renders
      for (const entry of dependentLayouts.slice()) {
        if (entry.persistedRunId) {
          const res = await api("/api/layout/manual/runs/delete", "POST", { id: entry.persistedRunId });
          const notFound = String(res && res.error || "") === "not_found";
          if (res && !res.ok && !notFound) {
            byId("workspaceInfo").textContent = `Ошибка удаления выкладки: ${String(res && res.error || "unknown")}`;
            return false;
          }
        }
        state.layouts = state.layouts.filter((x) => Number(x.id) !== Number(entry.id));
      }
      // If the currently selected layout was removed, clear the runtime and pick next
      const selectedStillExists = state.layouts.some((x) => Number(x.id) === Number(state.selectedLayoutId || 0));
      if (!selectedStillExists) {
        state.selectedLayoutId = state.layouts.length ? state.layouts[0].id : null;
        clearActiveLayoutRuntime();
      }
      const workspaceKey = buildZonesWorkspaceKey();
      const json = await api("/api/zones/delete", "POST", { workspaceKey, zoneId }, 20000);
      if (!json || !json.ok) {
        byId("workspaceInfo").textContent = `Ошибка удаления зоны: ${String(json && json.error || "unknown")}`;
        return false;
      }
      const savedZones = Array.isArray(json.zones) ? json.zones : [];
      state.zones = savedZones;
      state.nextZoneId = savedZones.reduce((maxId, item) => Math.max(maxId, Number(item && item.id || 0)), 0) + 1;
      if (!savedZones.some((item) => Number(item && item.id || 0) === Number(state.selectedZoneId || 0))) {
        const sibling = savedZones.find((item) => Number(item && item.detailId || 0) === Number(z.detailId || 0)) || savedZones[0] || null;
        state.selectedZoneId = Number(sibling && sibling.id || 0) || null;
        state.selectedDetailId = Number(sibling && sibling.detailId || z.detailId || state.selectedDetailId || 0) || state.selectedDetailId;
      }
      state.selectedFragmentId = null;
      await validateZonesForCurrentWorkspace();
      invalidateZoneDerivedData(z);
      const restoredZone = isManual
        ? (savedZones.find((item) => Number(item && item.detailId || 0) === Number(z.detailId || 0)) || null)
        : (savedZones.find((item) => Number(item && item.id || 0) === Number(z.parentZoneId || 0))
          || savedZones.find((item) => Number(item && item.detailId || 0) === Number(z.detailId || 0))
          || null);
      if (restoredZone) {
        state.selectedZoneId = Number(restoredZone.id || 0) || state.selectedZoneId;
        state.selectedDetailId = Number(restoredZone.detailId || 0) || state.selectedDetailId;
      }
      byId("workspaceInfo").textContent = isManual
        ? `Зона удалена: ${String(z.name || `Зона ${zoneId}`)}`
        : `Разбиение отменено. Восстановлена зона: ${String(restoredZone && restoredZone.name || parentZoneName || `Зона ${Number(z.parentZoneId || 0) || ""}`)}`;
      state.uiPanel = "zones";
      renderLayoutModeSwitch();
      renderDetailZoneTree();
      renderPropertyEditor();
      renderScene();
      return true;
    }

    async function subtractZoneFromOverlapping(newZone, explicitParentZoneId) {
      if (!newZone || !Array.isArray(newZone.points) || newZone.points.length < 3) return;
      const detailId = Number(newZone.detailId || 0);
      // Use the explicitly captured parentZoneId (captured before executeCommand overwrites selectedZoneId)
      const targetParentId = Number(explicitParentZoneId || 0) || Number(state.selectedZoneId || 0);
      const existing = (Array.isArray(state.zones) ? state.zones : []).find(
        (z) => Number(z && z.id || 0) === targetParentId &&
               Number(z && z.detailId || 0) === detailId &&
               Number(z && z.id || 0) !== Number(newZone.id || 0)
      );
      if (!existing) return;
      let changed = false;
      {

        const res = await api("/api/intarsia/apply-fragments", "POST", {
          zone: { points: existing.points, holes: Array.isArray(existing.holes) ? existing.holes.map(holeContour).filter((h) => h.length >= 3) : [] },
          fragments: [{ points: newZone.points }],
          isSplitOp: true
        });
        if (!res || !res.ok) {
          const err = String(res && res.error || "");
          if (typeof byId === "function" && byId("workspaceInfo")) {
            byId("workspaceInfo").textContent = err === "drawn_contour_outside_zone"
              ? "Контур выходит за пределы зоны — вычитание отменено."
              : err === "split_would_create_multipolygon"
                ? "Результат вычитания несвязный — вычитание отменено."
                : "Ошибка вычитания — операция отменена.";
          }
          // Remove the temporary zone that was just created
          state.zones = state.zones.filter((z) => Number(z && z.id || 0) !== Number(newZone.id || 0));
          if (state.history.undo.length > 0) {
            const last = state.history.undo[state.history.undo.length - 1];
            if (last && last.type === "create-zone" && Number(last.zone && last.zone.id) === Number(newZone.id)) {
              state.history.undo.pop();
            }
          }
          renderScene();
          return;
        }
        const remainder = (res.remainderZones || []).find((rz) => Array.isArray(rz.points) && rz.points.length >= 3);
        if (!remainder) return;
        // Capture state before structural changes for commitZoneMutation rollback
        const beforeZonesSnap = (Array.isArray(state.zones) ? state.zones : []).map((z) => Object.assign({}, z, { points: z.points ? z.points.slice() : [] }));
        const origId = Number(existing.id || 0);
        const splitOperationId = res.splitOperationId || null;
        const splitDepth = Number.isFinite(Number(existing.splitDepth)) ? Number(existing.splitDepth) + 1 : 1;

        // Build parent snapshot for restoration on delete
        const parentSnapshot = {
          id: origId,
          name: String(existing.name || `Зона ${origId}`),
          detailId,
          materialId: existing.materialId !== undefined && existing.materialId !== null && String(existing.materialId).trim() ? String(existing.materialId).trim() : null,
          materialName: existing.materialName !== undefined && existing.materialName !== null && String(existing.materialName).trim() ? String(existing.materialName).trim() : null,
          napDirectionDeg: Number.isFinite(Number(existing.napDirectionDeg)) ? Number(existing.napDirectionDeg) : 90,
          originType: String(existing.originType || "base"),
          parentZoneId: Number(existing.parentZoneId || 0) || null,
          points: existing.points.map((p) => ({ x: Number(p.x), y: Number(p.y) }))
        };
        // Replace create-zone command for newZone with split-zone command for clean undo
        const lastCmd = state.history.undo.length > 0 ? state.history.undo[state.history.undo.length - 1] : null;
        if (lastCmd && lastCmd.type === "create-zone" && Number(lastCmd.zone && lastCmd.zone.id) === Number(newZone.id)) {
          state.history.undo.pop();
        }
        // Tag the drawn zone as split-derived so deletion restores the parent
        const drawnInState = state.zones.find((z) => Number(z && z.id || 0) === Number(newZone.id || 0));
        if (drawnInState) {
          drawnInState.originType = "split";
          drawnInState.parentZoneId = origId;
          drawnInState.parentZoneSnapshot = parentSnapshot;
          drawnInState.splitOperationId = splitOperationId;
          drawnInState.splitDepth = splitDepth;
          drawnInState.revision = 1;
        }
        // Delete original zone, create remainder with split metadata
        state.zones = (Array.isArray(state.zones) ? state.zones : []).filter((z) => Number(z && z.id || 0) !== origId);
        const remainderName = String(existing.name || '') + '.1';
        createZoneFromPoints(remainder.points, {
          detailId,
          name: remainderName,
          originType: "split",
          parentZoneId: origId,
          parentZoneSnapshot: parentSnapshot,
          splitOperationId,
          splitDepth,
          holes: normalizeHoles(remainder.holes, null),
          skipPersist: true,
          skipSubtract: true
        });
        // Fix naming collision: drawn zone got same name as remainder (siblingCount was 0 at creation time)
        if (drawnInState && drawnInState.name === remainderName) {
          const sibCount = (Array.isArray(state.zones) ? state.zones : []).filter((z) => Number(z && z.parentZoneId || 0) === origId).length;
          drawnInState.name = String(existing.name || '') + '.' + sibCount;
        }
        // Push split-zone command for undo support
        const remainderInState = state.zones.find((z) => Number(z && z.id || 0) !== Number(newZone.id || 0) && String(z && z.name || '') === remainderName && Number(z && z.detailId || 0) === detailId);
        // Wire holeBoundaryLinks: each hole in remainder ↔ cut zone outer (§9.2)
        if (remainderInState && drawnInState && Array.isArray(remainderInState.holes) && remainderInState.holes.length > 0) {
          remainderInState.holeBoundaryLinks = remainderInState.holes.map((_, holeIndex) => ({
            remainderZoneId: remainderInState.id,
            holeIndex,
            adjacentZoneId: drawnInState.id,
            adjacentBoundary: "outer",
            splitOperationId
          }));
        }
        // commitZoneMutation — validate + commit (persist deferred to createZoneFromPoints caller)
        const candidateZonesSnap = (Array.isArray(state.zones) ? state.zones : []).slice();
        const commitResult = await commitZoneMutation({
          operationType: "draw-zone",
          beforeZones: beforeZonesSnap,
          candidateZones: candidateZonesSnap,
          affectedDetailId: detailId,
          deferPersist: true
        });
        if (!commitResult.ok) {
          // commitZoneMutation восстановил state.zones = beforeZonesSnap (включает newZone + исходный parent).
          // Дополнительно удаляем newZone — он не должен остаться после отказа.
          state.zones = (Array.isArray(state.zones) ? state.zones : []).filter(
            (z) => Number(z && z.id || 0) !== Number(newZone.id || 0)
          );
          if (state.history.undo.length > 0) {
            const last = state.history.undo[state.history.undo.length - 1];
            if (last && last.type === "create-zone" && Number(last.zone && last.zone.id) === Number(newZone.id)) state.history.undo.pop();
          }
          renderScene();
          return;
        }
        const splitCmd = {
          type: "split-zone",
          originalZone: cloneZoneStateForCommand(existing),
          newZones: [
            remainderInState ? cloneZoneStateForCommand(remainderInState) : null,
            drawnInState ? cloneZoneStateForCommand(drawnInState) : null
          ].filter(Boolean)
        };
        pushCommand(splitCmd);
        invalidateZoneDerivedData(existing);
        changed = true;
      }
      if (changed) {
        renderScene();
        renderDetailZoneTree();
      }
    }

    // §19: Etap 1 — intarsia produces Layout result (Fragment[] + remainingArea), NOT Zone.
    // state.zones is NOT modified. Parent zone is NOT deleted.
    async function applyIntarsiaFragmentsToZone(zoneId) {
      const zone = state.zones.find((z) => Number(z && z.id || 0) === Number(zoneId || 0));
      if (!zone || !Array.isArray(zone.points) || zone.points.length < 3) {
        byId("workspaceInfo").textContent = "Зона не найдена";
        return;
      }
      const svgFrags = Array.isArray(state.intarsiaSvgFragments) ? state.intarsiaSvgFragments : [];
      const runFrags = Array.isArray(state.layoutRun && state.layoutRun.fragments) ? state.layoutRun.fragments : [];
      const sourceFragments = svgFrags.length > 0 ? svgFrags : runFrags;
      if (sourceFragments.length === 0) {
        byId("workspaceInfo").textContent = "Нет фрагментов для применения";
        return;
      }
      byId("workspaceInfo").textContent = "Обработка интарсии…";
      const res = await api("/api/intarsia/apply-fragments", "POST", {
        zone: { points: zone.points, holes: Array.isArray(zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [] },
        fragments: sourceFragments.map((f) => ({ points: f.points }))
      });
      if (!res || !res.ok) {
        byId("workspaceInfo").textContent = `Ошибка: ${String(res && res.error || "unknown")}`;
        return;
      }
      updateLayoutContractMonitor(res._contractDiag, {
        endpoint: "intarsia/apply-fragments",
        layoutType: "intarsia",
        payloadHasHoles: Array.isArray(zone.holes) && zone.holes.length > 0
      });

      // Build clipped fragments (Layout result — NOT zones, §19.2)
      const clippedFragments = (res.subZones || [])
        .filter((sz) => Array.isArray(sz.points) && sz.points.length >= 3)
        .map((sz, i) => ({
          id: Number(sourceFragments[i] && sourceFragments[i].id || 0) || (i + 1),
          points: sz.points.map((p) => ({ x: Number(p.x), y: Number(p.y) })),
          label: sz.label || (sourceFragments[i] && sourceFragments[i].label) || `Фрагмент ${i + 1}`
        }));

      // Build remainingArea (NOT a zone — lives in layoutRun only, §19.2)
      const firstRemainder = (res.remainderZones || []).find((rz) => Array.isArray(rz.points) && rz.points.length >= 3) || null;
      const remainingArea = firstRemainder ? {
        outer: firstRemainder.points.map((p) => ({ x: Number(p.x), y: Number(p.y) })),
        holes: normalizeHoles(firstRemainder.holes, null)
      } : null;

      // Store result in layoutRun — state.zones unchanged, parent zone NOT deleted
      state.layoutRun.active = true;
      state.layoutRun.status = "applied";
      state.layoutRun.fragments = clippedFragments;
      state.layoutRun.remainingArea = remainingArea;
      state.layoutRun.selectedZoneId = Number(zone.id || 0);
      state.layoutRun.fillType = svgFrags.length > 0 ? "import_svg" : state.layoutRun.fillType;

      // Clear source SVG fragments; layoutRun.fragments now holds the clipped result
      if (svgFrags.length > 0) state.intarsiaSvgFragments = [];
      state.selectedFragmentId = null;

      byId("workspaceInfo").textContent = `Интарсия: нарезано ${clippedFragments.length} фрагм. Нажмите «Создать зоны» для применения.`;
      renderScene();
    }

    // §19: Etap 1 — single-fragment clip: adds clipped fragment to layoutRun, NOT a Zone.
    // state.zones unchanged, parent zone NOT deleted.
    async function applyIntarsiaFragmentToZone(fragmentId, zoneId) {
      const zone = state.zones.find((z) => Number(z && z.id || 0) === Number(zoneId || 0));
      if (!zone || !Array.isArray(zone.points) || zone.points.length < 3) {
        byId("workspaceInfo").textContent = "Зона не найдена";
        return;
      }
      const frag = (Array.isArray(state.intarsiaSvgFragments) ? state.intarsiaSvgFragments : [])
        .find((f) => Number(f && f.id || 0) === Number(fragmentId || 0));
      if (!frag || !Array.isArray(frag.points) || frag.points.length < 3) {
        byId("workspaceInfo").textContent = "Фрагмент не найден";
        return;
      }
      byId("workspaceInfo").textContent = "Обработка фрагмента…";
      const res = await api("/api/intarsia/apply-fragments", "POST", {
        zone: { points: zone.points, holes: Array.isArray(zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [] },
        fragments: [{ points: frag.points }]
      });
      if (!res || !res.ok) {
        byId("workspaceInfo").textContent = `Ошибка: ${String(res && res.error || "unknown")}`;
        return;
      }
      updateLayoutContractMonitor(res._contractDiag, {
        endpoint: "intarsia/apply-fragments",
        layoutType: "intarsia",
        payloadHasHoles: Array.isArray(zone.holes) && zone.holes.length > 0
      });

      // Clip result — add to layoutRun.fragments, do NOT create zones
      const clippedPts = (res.subZones || []).find((sz) => Array.isArray(sz.points) && sz.points.length >= 3);
      if (clippedPts) {
        const clippedFrag = { id: Number(frag.id || 0), points: clippedPts.points.map((p) => ({ x: Number(p.x), y: Number(p.y) })), label: frag.label || `Фрагмент ${frag.id}` };
        state.layoutRun.fragments = [
          ...(Array.isArray(state.layoutRun.fragments) ? state.layoutRun.fragments.filter((f) => Number(f && f.id || 0) !== Number(frag.id || 0)) : []),
          clippedFrag
        ];
      }

      // Update remainingArea (NOT a zone)
      const firstRemainder = (res.remainderZones || []).find((rz) => Array.isArray(rz.points) && rz.points.length >= 3) || null;
      state.layoutRun.remainingArea = firstRemainder ? {
        outer: firstRemainder.points.map((p) => ({ x: Number(p.x), y: Number(p.y) })),
        holes: normalizeHoles(firstRemainder.holes, null)
      } : null;
      state.layoutRun.active = true;
      state.layoutRun.selectedZoneId = Number(zone.id || 0);

      // Remove from SVG fragments list
      state.intarsiaSvgFragments = (Array.isArray(state.intarsiaSvgFragments) ? state.intarsiaSvgFragments : [])
        .filter((f) => Number(f && f.id || 0) !== Number(fragmentId || 0));
      state.selectedFragmentId = null;

      byId("workspaceInfo").textContent = `Фрагмент ${fragmentId} обработан`;
      renderScene();
      renderDetailZoneTree();
      renderPropertyEditor();
    }

    // §19.5 — PromoteFragmentsToZones: convert layoutRun result into actual Zone partition.
    // Only call after intarsia/layout run is applied (status === "applied").
    // state.zones is NOT modified during apply; only here, on explicit user command.
    async function promoteFragmentsToZones() {
      const lr = state.layoutRun;
      const parentZoneId = Number(lr && lr.selectedZoneId || 0);
      if (!parentZoneId) {
        byId("workspaceInfo").textContent = "[promote_no_parent_zone] Зона-источник не определена";
        return;
      }
      const parentZone = (Array.isArray(state.zones) ? state.zones : []).find((z) => Number(z && z.id || 0) === parentZoneId) || null;
      if (!parentZone) {
        byId("workspaceInfo").textContent = "[promote_no_parent_zone] Родительская зона не найдена";
        return;
      }
      if (!lr.active || String(lr.status || "") !== "applied") {
        byId("workspaceInfo").textContent = "[promote_no_layout_run] Нет активного результата выкладки для преобразования";
        return;
      }
      const fragments = (Array.isArray(lr.fragments) ? lr.fragments : [])
        .filter((f) => Array.isArray(f && f.points) && f.points.length >= 3);
      if (fragments.length === 0 && !lr.remainingArea) {
        byId("workspaceInfo").textContent = "[promote_no_fragments] Нет фрагментов или остатка для преобразования";
        return;
      }

      // Guard: зона уже разбита — нельзя promote поверх существующих дочерних зон
      const existingChildren = (Array.isArray(state.zones) ? state.zones : [])
        .filter((z) => Number(z && z.parentZoneId || 0) === parentZoneId);
      if (existingChildren.length > 0) {
        byId("workspaceInfo").textContent = `[promote_already_split] Зона уже разбита на ${existingChildren.length} частей. Отмените предыдущую операцию (Ctrl+Z) перед повторным применением.`;
        return;
      }

      // Guard: предупреждение при большом количестве фрагментов (сложный SVG)
      const totalZonesWillBeCreated = fragments.length + (lr.remainingArea ? 1 : 0);
      if (totalZonesWillBeCreated > 5) {
        const ok = window.confirm(
          `SVG содержит ${fragments.length} контуров → будет создано ${totalZonesWillBeCreated} зон.\n` +
          `Это может быть слишком сложная структура. Продолжить?`
        );
        if (!ok) {
          byId("workspaceInfo").textContent = `[promote_cancelled] Операция отменена пользователем (${fragments.length} фрагментов).`;
          return;
        }
      }

      const promoteOperationId = `promote-${parentZoneId}-${String(Date.now()).slice(-8)}`;
      const sourceLayoutRunId = `lr-zone-${parentZoneId}`;
      const parentZoneSnapshot = cloneZoneStateForCommand(parentZone);

      // Build candidate promoted zones
      const promotedZones = [];
      const parentNameSuffix = String(parentZone.name || `Зона ${parentZoneId}`).replace(/^Зона\s*/i, "");

      // Fragment zones (originType: "promoted", sourceFragmentId set)
      for (let i = 0; i < fragments.length; i++) {
        const frag = fragments[i];
        const zoneId = state.nextZoneId++;
        promotedZones.push({
          id: zoneId,
          name: `Зона ${parentNameSuffix}.${i + 1}`,
          detailId: parentZone.detailId,
          napDirectionDeg: parentZone.napDirectionDeg,
          originType: "promoted",
          parentZoneId: parentZoneId,
          parentZoneSnapshot,
          splitOperationId: null,
          splitDepth: 0,
          revision: 1,
          schemaVersion: 1,
          promoteOperationId,
          sourceLayoutRunId,
          sourceFragmentId: Number(frag.id || 0) || null,
          points: frag.points.map((p) => ({ x: Number(p.x), y: Number(p.y) })),
          holes: [],
          holeBoundaryLinks: []
        });
      }

      // Remainder zone (originType: "promoted", holes may link to fragment zones)
      if (lr.remainingArea && Array.isArray(lr.remainingArea.outer) && lr.remainingArea.outer.length >= 3) {
        const zoneId = state.nextZoneId++;
        const remHoles = (Array.isArray(lr.remainingArea.holes) ? lr.remainingArea.holes : [])
          .filter((h) => holeContour(h).length >= 3);
        const holeBoundaryLinks = remHoles.map((_, holeIndex) => {
          const adj = promotedZones[holeIndex] || null;
          if (!adj) return null;
          return {
            remainderZoneId: zoneId,
            holeIndex,
            holeId: `h-${zoneId}-${holeIndex}`,
            adjacentZoneId: adj.id,
            adjacentBoundary: "outer",
            promoteOperationId,
            sourceLayoutRunId,
            sourceFragmentId: adj.sourceFragmentId
          };
        }).filter(Boolean);
        promotedZones.push({
          id: zoneId,
          name: `Зона ${parentNameSuffix}.${fragments.length + 1}`,
          detailId: parentZone.detailId,
          napDirectionDeg: parentZone.napDirectionDeg,
          originType: "promoted",
          parentZoneId: parentZoneId,
          parentZoneSnapshot,
          splitOperationId: null,
          splitDepth: 0,
          revision: 1,
          schemaVersion: 1,
          promoteOperationId,
          sourceLayoutRunId,
          sourceFragmentId: null,
          points: lr.remainingArea.outer.map((p) => ({ x: Number(p.x), y: Number(p.y) })),
          holes: normalizeHoles(remHoles, zoneId),
          holeBoundaryLinks
        });
      }

      if (promotedZones.length === 0) {
        byId("workspaceInfo").textContent = "[promote_no_candidates] Нет кандидатов для преобразования";
        return;
      }

      // commitZoneMutation — validate partition before commit
      const beforeZonesPromote = (Array.isArray(state.zones) ? state.zones : []).map((z) => Object.assign({}, z, { points: z.points ? z.points.slice() : [] }));
      const candidateZonesPromote = [
        ...beforeZonesPromote.filter((z) => Number(z.id || 0) !== parentZoneId),
        ...promotedZones
      ];
      const promoteCommitResult = await commitZoneMutation({
        operationType: "promote",
        beforeZones: beforeZonesPromote,
        candidateZones: candidateZonesPromote,
        affectedDetailId: Number(parentZone.detailId || 0),
        deferPersist: true,
        validateOnly: true
      });
      if (!promoteCommitResult.ok) return;

      // Commit via undo/redo
      const cmd = {
        type: "promote-to-zones",
        parentZoneSnapshot,
        promotedZones: promotedZones.map((z) => cloneZoneStateForCommand(z)),
        promoteOperationId
      };
      executeCommand(cmd);
      pushCommand(cmd);

      // Clear layoutRun — promote consumed the result
      state.layoutRun.active = false;
      state.layoutRun.status = "idle";
      state.layoutRun.fragments = [];
      state.layoutRun.remainingArea = null;
      state.layoutRun.selectedZoneId = null;

      state.selectedZoneId = Number(promotedZones[0] && promotedZones[0].id || 0) || null;
      byId("workspaceInfo").textContent = `Преобразовано: ${promotedZones.length} зон (promoteOperationId: ${promoteOperationId})`;
      renderScene();
      renderDetailZoneTree();
      renderPropertyEditor();
      void persistZonesCurrentNoReload();
    }

    function openIntarsiaFragmentContextMenu(payload) {
      const zoneId = Number(payload && payload.zoneId || 0);
      const menu = ensureZoneContextMenu();
      menu.innerHTML = "";
      const addItem = (label, onClick, options) => {
        const cfg = options && typeof options === "object" ? options : {};
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "zone-context-menu-btn";
        btn.disabled = !!cfg.disabled;
        btn.innerHTML = `<span>${escapeHtml(label)}</span>`;
        if (typeof onClick === "function" && !cfg.disabled) {
          btn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try { await onClick(); } finally { hideZoneContextMenu(); }
          });
        }
        menu.appendChild(btn);
      };
      const addSeparator = () => {
        const sep = document.createElement("div");
        sep.className = "zone-context-menu-sep";
        menu.appendChild(sep);
      };

      addItem("Удалить фрагмент", () => {
        const delId = Number(state.selectedFragmentId);
        if (Array.isArray(state.intarsiaSvgFragments)) {
          state.intarsiaSvgFragments = state.intarsiaSvgFragments.filter((f) => Number(f && f.id || 0) !== delId);
        }
        if (Array.isArray(state.layoutRun && state.layoutRun.fragments)) {
          state.layoutRun.fragments = state.layoutRun.fragments.filter((f) => Number(f && f.id || 0) !== delId);
        }
        state.selectedFragmentId = null;
        renderScene();
      });
      addSeparator();
      addItem("Разбить зону по всем фрагментам", async () => {
        await applyIntarsiaFragmentsToZone(zoneId);
        if (String(state.layoutRun && state.layoutRun.status || "") === "applied") {
          await promoteFragmentsToZones();
          renderDetailZoneTree();
        }
      }, { disabled: !zoneId });

      menu.classList.add("open");
      menu.style.left = "0px";
      menu.style.top = "0px";
      const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
      const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
      const rect = menu.getBoundingClientRect();
      const left = Math.max(6, Math.min(Number(payload && payload.x || 0), vw - rect.width - 6));
      const top = Math.max(6, Math.min(Number(payload && payload.y || 0), vh - rect.height - 6));
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    }

    function openZoneContextMenu(payload) {
      const zone = payload && payload.zone && typeof payload.zone === "object" ? payload.zone : null;
      if (!zone) return;
      state.selectedZoneId = Number(zone.id || 0) || null;
      state.selectedDetailId = Number(zone.detailId || state.selectedDetailId || 0) || state.selectedDetailId;
      state.selectedFragmentId = null;
      const menu = ensureZoneContextMenu();
      menu.innerHTML = "";
      const addItem = (label, onClick, options) => {
        const cfg = options && typeof options === "object" ? options : {};
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "zone-context-menu-btn" + (cfg.danger ? " zone-context-menu-btn--danger" : "");
        btn.disabled = !!cfg.disabled;
        btn.innerHTML = `<span>${escapeHtml(label)}</span>${cfg.shortcut ? `<span class="zone-context-menu-shortcut">${escapeHtml(cfg.shortcut)}</span>` : ""}`;
        if (typeof onClick === "function" && !cfg.disabled) {
          btn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
              await onClick();
            } finally {
              hideZoneContextMenu();
            }
          });
        }
        menu.appendChild(btn);
      };
      const addSeparator = () => {
        const sep = document.createElement("div");
        sep.className = "zone-context-menu-sep";
        menu.appendChild(sep);
      };

      addItem("Редактировать зону", () => {
        selectZoneForEditing(zone);
      });
      addItem("Объединить зоны", () => deleteZoneEntry(zone), { disabled: !canRestoreParentZone(zone) });
      addSeparator();
      addItem("Выбрать меховой материал", async () => {
        await openMaterialLibrary(zone);
      }, { shortcut: "Ctrl+Shift+M" });
      if (zone.materialId) {
        addItem("Убрать мех", async () => {
          await assignMaterialToZone(zone, null);
        });
      }
      addItem("Выбрать обработку", null, { disabled: true, shortcut: "Ctrl+Shift+O" });
      addItem("Выбрать выкладку", () => {
        state.uiPanel = "layouts";
        renderLayoutModeSwitch();
        renderDetailZoneTree();
        renderPropertyEditor();
        openLayoutTypePicker();
      }, { shortcut: "Ctrl+Shift+V" });
      addSeparator();
      addItem("Удалить зону", () => deleteZoneEntry(zone), { disabled: !canDeleteZone(zone), danger: true });

      menu.classList.add("open");
      menu.style.left = "0px";
      menu.style.top = "0px";
      const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
      const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
      const rect = menu.getBoundingClientRect();
      const left = Math.max(6, Math.min(Number(payload && payload.x || 0), vw - rect.width - 6));
      const top = Math.max(6, Math.min(Number(payload && payload.y || 0), vh - rect.height - 6));
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      renderDetailZoneTree();
      renderPropertyEditor();
      renderScene();
    }

    // ---------------------------------------------------------------------------
    // Geometry helpers — delegated to window.FurLabGeom (core/geom.js)
    // ---------------------------------------------------------------------------
    const contourThumbSvg = (pts, closed, holes) => window.FurLabGeom.contourThumbSvg(pts, closed, holes);

    function renderDetailZoneTree() {
      if (detailZoneTreeView && typeof detailZoneTreeView.renderDetailZoneTree === "function") {
        detailZoneTreeView.renderDetailZoneTree();
      }
    }

    const polygonArea = (pts) => window.FurLabGeom.polygonArea(pts);
    const polylineLength = (pts, closed) => window.FurLabGeom.polylineLength(pts, closed);

    const normalizeContourArray = (raw) => window.FurLabUtils.normalizeContourArray(raw);

    const clipPolygonByHalfPlane = (poly, nx, ny, c) => window.FurLabGeom.clipPolygonByHalfPlane(poly, nx, ny, c);
    const centroid = (pts) => window.FurLabGeom.centroid(pts);
    const polygonBBox = (pts) => window.FurLabGeom.polygonBBox(pts);
    const randomPointInPolygon = (poly, bbox, n) => window.FurLabGeom.randomPointInPolygon(poly, bbox, n);
    const clipPolygonToRect = (poly, x0, y0, x1, y1) => window.FurLabGeom.clipPolygonToRect(poly, x0, y0, x1, y1);
    const splitPolygonByLine = (poly, px, py, dx, dy) => window.FurLabGeom.splitPolygonByLine(poly, px, py, dx, dy);

    function zoneSplitDerivedIds(zoneId) {
      const base = Number(zoneId || 0) || 0;
      const taken = new Set((Array.isArray(state.zones) ? state.zones : []).map((zone) => Number(zone && zone.id || 0)).filter((id) => id > 0));
      const preferredA = Number(`${base}1`);
      const preferredB = Number(`${base}2`);
      if (preferredA > 0 && preferredB > 0 && !taken.has(preferredA) && !taken.has(preferredB) && preferredA !== preferredB) {
        return [preferredA, preferredB];
      }
      const out = [];
      while (out.length < 2) {
        const nextId = Number(state.nextZoneId || 1) || 1;
        state.nextZoneId = nextId + 1;
        if (taken.has(nextId) || out.includes(nextId)) continue;
        out.push(nextId);
      }
      return out;
    }

    async function splitSelectedZoneByLine(fromPoint, toPoint) {
      const zone = state.zones.find((item) => Number(item && item.id || 0) === Number(state.selectedZoneId || 0)) || null;
      if (!zone || !Array.isArray(zone.points) || zone.points.length < 3) {
        byId("workspaceInfo").textContent = "[target_zone_not_selected] Зона не выбрана для разделения.";
        return false;
      }
      const a = fromPoint && Number.isFinite(Number(fromPoint.x)) && Number.isFinite(Number(fromPoint.y)) ? fromPoint : null;
      const b = toPoint && Number.isFinite(Number(toPoint.x)) && Number.isFinite(Number(toPoint.y)) ? toPoint : null;
      if (!a || !b) {
        byId("workspaceInfo").textContent = "Линия разделения не задана.";
        return false;
      }
      const dx = Number(b.x) - Number(a.x);
      const dy = Number(b.y) - Number(a.y);
      if (Math.hypot(dx, dy) < 1e-6) {
        byId("workspaceInfo").textContent = "Линия разделения слишком короткая.";
        return false;
      }
      const parts = splitPolygonByLine(zone.points, a.x, a.y, dx, dy)
        .filter((poly) => Array.isArray(poly) && poly.length >= 3)
        .filter((poly) => polygonArea(poly) > 1);
      if (parts.length !== 2) {
        byId("workspaceInfo").textContent = "Линия не разделила зону на две корректные части.";
        return false;
      }
      const boundLayouts = (Array.isArray(state.layouts) ? state.layouts : []).filter(
        (l) => l && Number(l.boundZoneId || 0) === Number(zone.id)
      );
      if (boundLayouts.length > 0) {
        const names = boundLayouts.map((l) => String(l.name || l.mode || l.id)).join(", ");
        const ok = window.confirm(
          `У зоны «${zone.name || zone.id}» есть выкладк${boundLayouts.length === 1 ? "а" : "и"}: ${names}.\\n\\nПри разделении зоны ${boundLayouts.length === 1 ? "она будет удалена" : "они будут удалены"}. Продолжить?`
        );
        if (!ok) {
          state.draftSplitLine = [];
          renderScene();
          return false;
        }
      }
      const [newIdA, newIdB] = zoneSplitDerivedIds(zone.id);
      state.nextZoneId = Math.max(Number(state.nextZoneId || 1), newIdA + 1, newIdB + 1);
      const parentDisplayName = String(zone.name || `Зона ${zone.id}`);
      const newNameA = `${parentDisplayName}.1`;
      const newNameB = `${parentDisplayName}.2`;
      const sortedParts = parts
        .map((points) => ({ points, center: centroid(points), area: polygonArea(points) }))
        .sort((left, right) => {
          if (Math.abs(left.center.x - right.center.x) > 1e-6) return left.center.x - right.center.x;
          return left.center.y - right.center.y;
        });
      const cmd = {
        type: "split-zone",
        originalZone: {
          id: zone.id,
          name: String(zone.name || `Зона ${zone.id}`),
          detailId: Number(zone.detailId || 0) || null,
          materialId: zone.materialId !== undefined && zone.materialId !== null && String(zone.materialId).trim()
            ? String(zone.materialId).trim()
            : null,
          materialName: zone.materialName !== undefined && zone.materialName !== null && String(zone.materialName).trim()
            ? String(zone.materialName).trim()
            : null,
          napDirectionDeg: normalizeDeg(zone.napDirectionDeg, DEFAULT_NAP_DIRECTION_DEG),
          originType: ["base", "split", "manual", "promoted"].includes(String(zone.originType || "").trim().toLowerCase())
            ? String(zone.originType || "").trim().toLowerCase()
            : "base",
          parentZoneId: Number(zone.parentZoneId || 0) || null,
          points: zone.points.map((p) => ({ x: Number(p.x), y: Number(p.y) }))
        },
        newZones: [
          {
            id: newIdA,
            name: newNameA,
            detailId: Number(zone.detailId || 0) || null,
            materialId: zone.materialId !== undefined && zone.materialId !== null && String(zone.materialId).trim()
              ? String(zone.materialId).trim()
              : null,
            materialName: zone.materialName !== undefined && zone.materialName !== null && String(zone.materialName).trim()
              ? String(zone.materialName).trim()
              : null,
            napDirectionDeg: normalizeDeg(zone.napDirectionDeg, DEFAULT_NAP_DIRECTION_DEG),
            originType: "split",
            parentZoneId: Number(zone.id || 0) || null,
            parentZoneSnapshot: {
              id: zone.id,
              name: String(zone.name || `Зона ${zone.id}`),
              detailId: Number(zone.detailId || 0) || null,
              materialId: zone.materialId !== undefined && zone.materialId !== null && String(zone.materialId).trim()
                ? String(zone.materialId).trim()
                : null,
              materialName: zone.materialName !== undefined && zone.materialName !== null && String(zone.materialName).trim()
                ? String(zone.materialName).trim()
                : null,
              napDirectionDeg: normalizeDeg(zone.napDirectionDeg, DEFAULT_NAP_DIRECTION_DEG),
              originType: ["base", "split", "manual", "promoted"].includes(String(zone.originType || "").trim().toLowerCase())
                ? String(zone.originType || "").trim().toLowerCase()
                : "base",
              parentZoneId: Number(zone.parentZoneId || 0) || null,
              points: zone.points.map((p) => ({ x: Number(p.x), y: Number(p.y) }))
            },
            points: sortedParts[0].points.map((p) => ({ x: Number(p.x), y: Number(p.y) })),
            holes: (Array.isArray(zone.holes) ? zone.holes : []).filter((h) => holeContour(h).length >= 3 && pointInPolygon(centroid(holeContour(h)), sortedParts[0].points))
          },
          {
            id: newIdB,
            name: newNameB,
            detailId: Number(zone.detailId || 0) || null,
            materialId: zone.materialId !== undefined && zone.materialId !== null && String(zone.materialId).trim()
              ? String(zone.materialId).trim()
              : null,
            materialName: zone.materialName !== undefined && zone.materialName !== null && String(zone.materialName).trim()
              ? String(zone.materialName).trim()
              : null,
            napDirectionDeg: normalizeDeg(zone.napDirectionDeg, DEFAULT_NAP_DIRECTION_DEG),
            originType: "split",
            parentZoneId: Number(zone.id || 0) || null,
            parentZoneSnapshot: {
              id: zone.id,
              name: String(zone.name || `Зона ${zone.id}`),
              detailId: Number(zone.detailId || 0) || null,
              materialId: zone.materialId !== undefined && zone.materialId !== null && String(zone.materialId).trim()
                ? String(zone.materialId).trim()
                : null,
              materialName: zone.materialName !== undefined && zone.materialName !== null && String(zone.materialName).trim()
                ? String(zone.materialName).trim()
                : null,
              napDirectionDeg: normalizeDeg(zone.napDirectionDeg, DEFAULT_NAP_DIRECTION_DEG),
              originType: ["base", "split", "manual", "promoted"].includes(String(zone.originType || "").trim().toLowerCase())
                ? String(zone.originType || "").trim().toLowerCase()
                : "base",
              parentZoneId: Number(zone.parentZoneId || 0) || null,
              points: zone.points.map((p) => ({ x: Number(p.x), y: Number(p.y) }))
            },
            points: sortedParts[1].points.map((p) => ({ x: Number(p.x), y: Number(p.y) })),
            holes: (Array.isArray(zone.holes) ? zone.holes : []).filter((h) => holeContour(h).length >= 3 && !pointInPolygon(centroid(holeContour(h)), sortedParts[0].points))
          }
        ]
      };
      // Build candidateZones for commitZoneMutation (before executing command)
      const detailId = Number(zone.detailId || 0);
      const beforeZonesSnap = (Array.isArray(state.zones) ? state.zones : []).map((z) => Object.assign({}, z, { points: z.points ? z.points.slice() : [] }));
      // Distribute holes of original zone to the correct split part by centroid
      const zoneHoles = Array.isArray(zone.holes) ? zone.holes : [];
      const holesA = [], holesB = [];
      for (const hole of zoneHoles) {
        const hpts = holeContour(hole);
        if (hpts.length < 3) continue;
        const hc = centroid(hpts);
        (pointInPolygon(hc, sortedParts[0].points) ? holesA : holesB).push(hole);
      }
      // candidateZones = all zones replacing zone with newIdA + newIdB
      const allCandidateZones = [
        ...beforeZonesSnap.filter((z) => Number(z.id || 0) !== Number(zone.id || 0)),
        { id: newIdA, detailId, originType: "split", points: sortedParts[0].points, holes: holesA },
        { id: newIdB, detailId, originType: "split", points: sortedParts[1].points, holes: holesB }
      ];
      const splitCommitResult = await commitZoneMutation({
        operationType: "split-line",
        beforeZones: beforeZonesSnap,
        candidateZones: allCandidateZones,
        affectedDetailId: detailId,
        deferPersist: true,
        validateOnly: true
      });
      if (!splitCommitResult.ok) return false;
      executeCommand(cmd);
      pushCommand(cmd);
      state.draftSplitLine = [];
      renderScene();
      await persistZonesForCurrentWorkspace();
      byId("workspaceInfo").textContent = `Зона ${zone.id} разделена на ${newIdA} и ${newIdB}.`;
      return true;
    }
    async function commitDraftSplitLine() {
      const line = Array.isArray(state.draftSplitLine) ? state.draftSplitLine : [];
      if (line.length < 2) {
        byId("workspaceInfo").textContent = "Линия зонирования: поставьте две точки разделения.";
        return false;
      }
      const ok = await splitSelectedZoneByLine(line[0], line[1]);
      if (!ok && Array.isArray(state.draftSplitLine) && state.draftSplitLine.length >= 2) {
        byId("workspaceInfo").textContent = byId("workspaceInfo").textContent || "Линия зонирования: скорректируйте точки разреза.";
      }
      return ok;
    }

    const clipPolygonByBand = (poly, nx, ny, lo, hi) => window.FurLabGeom.clipPolygonByBand(poly, nx, ny, lo, hi);
    const toBooleanMulti = (pts) => window.FurLabGeom.toBooleanMulti(pts);
    const fromBooleanMultiOuter = (mp) => window.FurLabGeom.fromBooleanMultiOuter(mp);
    const toBooleanMultiFromMultiOuter = (polys) => window.FurLabGeom.toBooleanMultiFromMultiOuter(polys);
    const computeCoverageHoles = (zPts, cPts) => window.FurLabGeom.computeCoverageHoles(zPts, cPts);
    const computeCoverageHolesForZone = (zone, cPts) => window.FurLabGeom.computeCoverageHolesForZone(zone, cPts);
    const zoneEffectiveArea = (zone) => window.FurLabGeom.zoneEffectiveArea(zone);
    const extractCoreMultiFromPlacement = (pl) => window.FurLabGeom.extractCoreMultiFromPlacement(pl);
    const buildRoundedRectPolygon = (x0, y0, x1, y1, r) => window.FurLabGeom.buildRoundedRectPolygon(x0, y0, x1, y1, r);

    // ---------------------------------------------------------------------------
    // Fragment generation — delegated to window.FurLabFragments (core/fragments.js)
    // ---------------------------------------------------------------------------
    const generateVoronoiFragments = (pts, opts) => window.FurLabFragments.generateVoronoiFragments(pts, opts);
    const generateRegularFragments = (pts, opts) => window.FurLabFragments.generateRegularFragments(pts, opts);
    const generateShiftedFragments = (pts, opts) => window.FurLabFragments.generateShiftedFragments(pts, opts);
    const generateDiagonalFragments = (pts, opts) => window.FurLabFragments.generateDiagonalFragments(pts, opts);
    const generateRadialFragments = (pts, opts) => window.FurLabFragments.generateRadialFragments(pts, opts);
    const generateFragmentsForZone = (pts, opts) => window.FurLabFragments.generateFragmentsForZone(pts, opts);

    // Build zoneDomain multipolygon for a zone (outer minus holes via clipper).
    function buildZoneDomainForZone(zone) {
      const geom = window.FurLabGeom;
      if (!geom || typeof geom.buildZoneDomain !== "function") return null;
      const outer = Array.isArray(zone && zone.points) ? zone.points : [];
      const holes = Array.isArray(zone && zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [];
      return geom.buildZoneDomain(outer, holes);
    }

    // Clip fragment contours to zoneDomain (outer minus holes). Replaces centroid-based filterFragmentsByHoles.
    // Accepts fragments as {points, ...} array. Returns new array with clipped contours.
    function clipFragmentsByZoneDomain(fragments, zone) {
      const holes = Array.isArray(zone && zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [];
      if (!holes.length) return fragments;
      const geom = window.FurLabGeom;
      if (!geom || typeof geom.clipContoursToZoneDomain !== "function") {
        // fallback: old centroid filter
        const pip = geom && geom.pointInPolygon;
        if (!pip) return fragments;
        return fragments.filter((f) => {
          const pts = Array.isArray(f && f.points) ? f.points : [];
          if (!pts.length) return true;
          const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
          const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
          return !holes.some((hole) => pip({ x: cx, y: cy }, hole));
        });
      }
      const zoneDomain = buildZoneDomainForZone(zone);
      if (!zoneDomain) return fragments;
      const result = [];
      for (const frag of fragments) {
        const pts = Array.isArray(frag && frag.points) ? frag.points : [];
        const clipped = geom.clipContoursToZoneDomain([pts], zoneDomain);
        for (const c of clipped) result.push(Object.assign({}, frag, { points: c }));
      }
      return result;
    }

    // Get effective zone points for layout generation — bridges holes into outer contour
    function getEffectiveZonePoints(zone) {
      const outer = Array.isArray(zone && zone.points) ? zone.points : [];
      const holes = Array.isArray(zone && zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [];
      if (!holes.length) return outer;
      // Bridge each hole into the outer contour — reverse hole winding so hole area is OUTSIDE
      let result = outer.slice();
      for (const hole of holes) {
        let bestDist = Infinity, bestOi = 0, bestHi = 0;
        for (let oi = 0; oi < result.length; oi++) {
          for (let hi = 0; hi < hole.length; hi++) {
            const dx = result[oi].x - hole[hi].x, dy = result[oi].y - hole[hi].y;
            const d = dx * dx + dy * dy;
            if (d < bestDist) { bestDist = d; bestOi = oi; bestHi = hi; }
          }
        }
        // Reverse hole so its interior is excluded from the polygon
        const reversedHole = hole.slice().reverse();
        const startIdx = reversedHole.length - 1 - bestHi;
        const rotatedHole = reversedHole.slice(startIdx).concat(reversedHole.slice(0, startIdx + 1));
        result = result.slice(0, bestOi + 1).concat(rotatedHole).concat(result.slice(bestOi));
      }
      return result;
    }

    // (old generateVoronoiFragments body removed — now in core/fragments.js)
    function refreshIntarsiaDerivedFragmentLimits() {
      const minAreaEl = byId("invMinArea");
      const minWEl = byId("minFragmentWidthMm");
      const minLEl = byId("minFragmentLengthMm");
      if (!minAreaEl || !minWEl || !minLEl) return;
      const isIntarsia = state.layoutMode === "intarsia";
      minAreaEl.disabled = isIntarsia;
      minWEl.disabled = isIntarsia;
      minLEl.disabled = isIntarsia;
      if (!isIntarsia) return;
      const frags = Array.isArray(state.layoutRun && state.layoutRun.fragments) ? state.layoutRun.fragments : [];
      if (!frags.length) {
        minAreaEl.value = "0";
        minWEl.value = "0";
        minLEl.value = "0";
        return;
      }
      let minArea = Number.POSITIVE_INFINITY;
      let minW = Number.POSITIVE_INFINITY;
      let minH = Number.POSITIVE_INFINITY;
      for (const f of frags) {
        const pts = Array.isArray(f && f.points) ? f.points : [];
        if (pts.length < 3) continue;
        const area = polygonArea(pts);
        const bb = polygonBBox(pts);
        if (!(bb && Number.isFinite(area))) continue;
        minArea = Math.min(minArea, Math.max(0, area));
        minW = Math.min(minW, Math.max(0, bb.width));
        minH = Math.min(minH, Math.max(0, bb.height));
      }
      minAreaEl.value = Number.isFinite(minArea) ? String(Math.round(minArea)) : "0";
      minWEl.value = Number.isFinite(minW) ? String(Math.round(minW)) : "0";
      minLEl.value = Number.isFinite(minH) ? String(Math.round(minH)) : "0";
    }

    function buildCurrentFragmentThresholdBasis() {
      const frags = Array.isArray(state.layoutRun && state.layoutRun.fragments) ? state.layoutRun.fragments : [];
      if (!frags.length) {
        return {
          kind: "none",
          source: "no_fragments",
          fragmentsCount: 0
        };
      }
      let minArea = Number.POSITIVE_INFINITY;
      let minW = Number.POSITIVE_INFINITY;
      let minH = Number.POSITIVE_INFINITY;
      let sumArea = 0;
      let sumW = 0;
      let sumH = 0;
      let count = 0;
      for (const f of frags) {
        const pts = Array.isArray(f && f.points) ? f.points : [];
        if (pts.length < 3) continue;
        const bb = polygonBBox(pts);
        const area = polygonArea(pts);
        if (!bb || !Number.isFinite(area)) continue;
        const w = Math.max(0, Number(bb.width || 0));
        const h = Math.max(0, Number(bb.height || 0));
        minArea = Math.min(minArea, area);
        minW = Math.min(minW, w);
        minH = Math.min(minH, h);
        sumArea += area;
        sumW += w;
        sumH += h;
        count += 1;
      }
      return {
        kind: "global_prefilter",
        source: "min_fragment_after_clipping",
        fragmentsCount: count,
        minAreaMm2: Number.isFinite(minArea) ? Math.round(minArea) : null,
        minWidthMm: Number.isFinite(minW) ? Math.round(minW) : null,
        minHeightMm: Number.isFinite(minH) ? Math.round(minH) : null,
        avgAreaMm2: count > 0 ? Math.round(sumArea / count) : null,
        avgWidthMm: count > 0 ? Math.round(sumW / count) : null,
        avgHeightMm: count > 0 ? Math.round(sumH / count) : null
      };
    }

    function setIntarsiaStepPhase(phase) {
      intarsiaStepPhase = phase === 2 ? 2 : 1;
      const isIntarsia = state.layoutMode === "intarsia";
      const step1Fields = byId("intarsiaStep1GridFields");
      const step2Fields = byId("intarsiaStep2CandidateFields");
      const step1Btn = byId("inventoryStep1RunBtn");
      const step2Btn = byId("inventoryStep1IntarsiaAssignBtn");
      const hintEl = byId("inventoryStep1FlowHint");
      const hasIntarsiaFragments = (
        isIntarsia &&
        state.layoutRun &&
        Number(state.layoutRun.selectedZoneId || 0) === Number(state.selectedZoneId || 0) &&
        Array.isArray(state.layoutRun.fragments) &&
        state.layoutRun.fragments.length > 0
      );
      if (isIntarsia && intarsiaStepPhase === 2 && !hasIntarsiaFragments) intarsiaStepPhase = 1;
      if (!isIntarsia) {
        if (step1Fields) step1Fields.style.display = "block";
        if (step2Fields) step2Fields.style.display = "block";
        if (step1Btn) step1Btn.textContent = t("btn_pick", null, "Pick");
        if (step2Btn) step2Btn.style.display = "none";
        if (hintEl) hintEl.textContent = "";
        refreshIntarsiaDerivedFragmentLimits();
        return;
      }
      if (step1Fields) step1Fields.style.display = "block";
      if (step2Fields) step2Fields.style.display = "none";
      if (step1Btn) step1Btn.textContent = "Создать зоны из фрагментов";
      if (step2Btn) step2Btn.style.display = "none";
      const hasSvg = Array.isArray(state.intarsiaSvgFragments) && state.intarsiaSvgFragments.length > 0;
      if (hintEl) {
        hintEl.textContent = hasSvg
          ? `Загружено контуров: ${state.intarsiaSvgFragments.length}. Нажмите «Создать зоны из фрагментов».`
          : "Загрузите SVG с контурами или нарисуйте полигоны, затем нажмите кнопку.";
      }
      refreshIntarsiaDerivedFragmentLimits();
    }

    function syncFillTypeUi() {
      const intarsiaMode = state.layoutMode === "intarsia";
      const fillType = String(byId("fillType").value || "voronoi");
      const inventoryMode = isInventoryLikeLayoutMode(state.layoutMode);
      if (inventoryMode) byId("inventoryScenario").value = "A";
      const scenario = inventoryMode ? "A" : String(byId("inventoryScenario").value || "A");
      byId("inventoryScenarioRow").style.display = "none";
      byId("inventoryScenarioHint").style.display = inventoryMode ? "block" : "none";
      const optimizationRowEl = byId("inventoryOptimizationRow");
      if (optimizationRowEl) optimizationRowEl.style.display = "none";
      byId("inventoryOptimizationHint").style.display = inventoryMode && scenario === "A" ? "block" : "none";
      byId("fillTypeRow").style.display = (inventoryMode || intarsiaMode) ? "none" : "grid";
      byId("placementStrategyRow").style.display = (inventoryMode || intarsiaMode) ? "none" : "grid";
      const step1RunBtn = byId("inventoryStep1RunBtn");
      const step1IntarsiaAssignBtn = byId("inventoryStep1IntarsiaAssignBtn");
      if (inventoryMode) {
        const optimizationPreset = INVENTORY_OPTIMIZATION_PROFILE;
        byId("placementStrategy").value = "bestFit";
        byId("fillVoronoiFields").style.display = "none";
        byId("fillRegularFields").style.display = "none";
        byId("inventoryScenarioHint").textContent = state.layoutMode === "inventory_manual"
          ? t("scenario_hint_manual", null, "Настройте параметры подбора и загрузите кандидатов в лоток.")
          : (state.layoutMode === "inventory_split_return"
            ? t("scenario_hint_split", null, "Split & Return: only visible part is used, leftover returns to pool.")
            : t("scenario_hint_inventory", null, "Layout is generated directly from inventory piece contours."));
        byId("inventoryOptimizationHint").textContent = state.layoutMode === "inventory_manual" ? "" : (optimizationPreset.description || "");
        byId("inventoryStep1Title").textContent = state.layoutMode === "inventory_manual"
          ? t("step1_title_manual", null, "Step 1. Manual placement + hints")
          : (state.layoutMode === "inventory_split_return"
            ? t("step1_title_split", null, "Step 1. Split & Return settings")
            : t("step1_title_inventory", null, "Step 1. Inventory pick settings"));
        if (step1RunBtn) step1RunBtn.textContent = t("btn_pick", null, "Pick");
        if (step1IntarsiaAssignBtn) step1IntarsiaAssignBtn.style.display = "none";
      } else if (intarsiaMode) {
        byId("placementStrategy").value = "bestFit";
        byId("fillVoronoiFields").style.display = "none";
        byId("fillRegularFields").style.display = "block";
        byId("inventoryOptimizationHint").textContent = "";
        const curGridMode = String(byId("fillGridMode") && byId("fillGridMode").value || "grid");
        byId("inventoryStep1Title").textContent = "\u0428\u0430\u0433 1. \u0418\u043d\u0442\u0430\u0440\u0441\u0438\u044f";
        if (step1IntarsiaAssignBtn) step1IntarsiaAssignBtn.style.display = "inline-block";
      } else {
        byId("fillVoronoiFields").style.display = fillType === "voronoi" ? "block" : "none";
        byId("fillRegularFields").style.display = fillType === "regular" ? "block" : "none";
        byId("inventoryOptimizationHint").textContent = "";
        byId("inventoryStep1Title").textContent = t("step1_title_fill_residual", null, "Step 1. Fill residual");
        if (step1RunBtn) step1RunBtn.textContent = t("btn_pick", null, "Pick");
        if (step1IntarsiaAssignBtn) step1IntarsiaAssignBtn.style.display = "none";
      }
      const isManualMode = state.layoutMode === "inventory_manual";
      const allowanceMmRow = byId("invAllowanceMmRow");
      if (allowanceMmRow) allowanceMmRow.style.display = isManualMode ? "none" : "";
      const sizeFilterRow = byId("invSizeFilterRow");
      if (sizeFilterRow) sizeFilterRow.style.display = isManualMode ? "none" : "";
      const furFilterRow = byId("invFurFilterRow");
      if (furFilterRow) furFilterRow.style.display = isManualMode ? "grid" : "none";
      const furSel = byId("invFurMaterialFilter");
      if (furSel && isManualMode) {
        function buildFurOptions(catalog) {
          const cur = String(state.manualFurMaterialFilterId || "");
          furSel.innerHTML = `<option value="">Неважно</option>` +
            catalog.map((m) => `<option value="${String(m.id).replace(/"/g, "&quot;")}">${String(m.name || m.id).replace(/</g, "&lt;")}</option>`).join("");
          furSel.value = cur;
        }
        const catalog = Array.isArray(state.furMaterialsCatalog) ? state.furMaterialsCatalog : [];
        if (catalog.length === 0) {
          loadFurMaterialsCatalog().then(() => {
            const sel2 = byId("invFurMaterialFilter");
            if (!sel2) return;
            buildFurOptions(Array.isArray(state.furMaterialsCatalog) ? state.furMaterialsCatalog : []);
          }).catch(() => {});
        } else {
          buildFurOptions(catalog);
        }
        furSel.onchange = () => { state.manualFurMaterialFilterId = furSel.value; };
      }
      syncGridModeUi();
      setIntarsiaStepPhase(intarsiaStepPhase);
      syncRegularIntarsiaNapToleranceUi();
    }

    // SVG parsing — delegated to window.FurLabSvgParse (core/svg-parse.js)
    const parseSvgPathToPoints = (d, scale) => window.FurLabSvgParse.parseSvgPathToPoints(d, scale);
    const parseSvgContours = (svg, scale) => window.FurLabSvgParse.parseSvgContours(svg, scale);

    function syncGridModeUi() {
      const modeEl = byId("fillGridMode");
      if (!modeEl) return;
      const mode = String(modeEl.value || "grid");
      const gridEl = document.querySelector(".fill-mode-grid");
      const radialEl = document.querySelector(".fill-mode-radial");
      const bandsEl = document.querySelector(".fill-mode-bands");
      const voronoiEl = document.querySelector(".fill-mode-voronoi");
      const importSvgEl = document.querySelector(".fill-mode-import-svg");
      if (gridEl) gridEl.style.display = mode === "grid" ? "" : "none";
      if (radialEl) radialEl.style.display = mode === "radial" ? "" : "none";
      if (bandsEl) bandsEl.style.display = mode === "bands" ? "" : "none";
      if (voronoiEl) voronoiEl.style.display = mode === "voronoi" ? "" : "none";
      if (importSvgEl) importSvgEl.style.display = mode === "import_svg" ? "" : "none";
      // Sync fillType for server: voronoi mode в†’ fillType=voronoi, others в†’ regular
      const fillTypeEl = byId("fillType");
      if (fillTypeEl) fillTypeEl.value = mode === "voronoi" ? "voronoi" : "regular";
      // Center X/Y visible only when manual center selected
      const centerManualEl = document.querySelector(".fill-center-manual");
      const centerModeEl = byId("fillCenterMode");
      if (centerManualEl && centerModeEl) {
        centerManualEl.style.display = centerModeEl.value === "manual" ? "" : "none";
      }
    }

    function setNapToleranceInputValue(nextValue, markTouched) {
      const el = byId("invNapTol");
      if (!el) return;
      const safe = Math.max(0, Math.min(180, Number(nextValue)));
      el.value = String(Number.isFinite(safe) ? safe : 15);
      const touched = markTouched === true;
      el.dataset.userTouched = touched ? "1" : "0";
      if (state.layoutRun && typeof state.layoutRun === "object") {
        state.layoutRun.__napTolTouchedByUser = touched;
      }
    }

    function syncRegularIntarsiaNapToleranceUi() {
      const el = byId("invNapTol");
      if (!el) return;
      const isRegularIntarsia = state.layoutMode === "intarsia"
        && String(byId("fillType") && byId("fillType").value || "") === "regular";
      if (!isRegularIntarsia) return;
      const persistedNapTol = Number(
        state.layoutRun
        && state.layoutRun.lastConstraints
        && state.layoutRun.lastConstraints.napToleranceDeg
      );
      if (Number.isFinite(persistedNapTol)) {
        setNapToleranceInputValue(persistedNapTol, true);
        return;
      }
      const userTouched = el.dataset.userTouched === "1"
        || !!(state.layoutRun && state.layoutRun.__napTolTouchedByUser);
      if (userTouched) return;
      const current = Number(el.value);
      if (!Number.isFinite(current) || Math.abs(current - 15) <= 1e-6) {
        setNapToleranceInputValue(0, false);
      }
    }

    function getEffectiveNapToleranceDegForCurrentRun() {
      const isRegularIntarsia = state.layoutMode === "intarsia"
        && String(byId("fillType") && byId("fillType").value || "") === "regular";
      const savedNapTol = Number(
        state.layoutRun
        && state.layoutRun.lastConstraints
        && state.layoutRun.lastConstraints.napToleranceDeg
      );
      if (Number.isFinite(savedNapTol)) return Math.max(0, Math.min(180, savedNapTol));
      const el = byId("invNapTol");
      const raw = Number(el && el.value);
      const userTouched = !!(el && el.dataset && el.dataset.userTouched === "1")
        || !!(state.layoutRun && state.layoutRun.__napTolTouchedByUser);
      if (isRegularIntarsia && !userTouched) {
        return 0;
      }
      return Number.isFinite(raw) ? Math.max(0, Math.min(180, raw)) : 15;
    }

    function toScale10(input, fallback = 5) {
      const n = Number(input);
      if (!Number.isFinite(n)) return fallback;
      if (n <= 10) return Math.max(1, Math.min(10, n));
      return Math.max(1, Math.min(10, n / 10));
    }

    function clampInputNumber(id, min, max, fallback) {
      const el = byId(id);
      if (!el) return;
      const n = Number(el.value);
      const next = Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
      el.value = String(next);
    }
    const placementExplainViewApi = window.FurLabPlacementExplainView || {};
    const placementExplainView = (typeof placementExplainViewApi.createPlacementExplainView === "function")
      ? placementExplainViewApi.createPlacementExplainView({
        byId,
        state,
        polygonArea,
        toBooleanMulti,
        toBooleanMultiFromMultiOuter,
        fromBooleanMultiOuter,
        centroid,
        rotatePoints,
        translatePoints,
        parseScrapContourPoints,
        findPlacementForFragment,
        isManualInventoryMode: () => isManualInventoryMode(),
        DEFAULT_NAP_DIRECTION_DEG
      })
      : null;

    function renderPlacementRows(rows) {
      if (placementExplainView && typeof placementExplainView.renderPlacementRows === "function") {
        placementExplainView.renderPlacementRows(rows);
      }
    }

    function renderFragmentCoverageQuality(rows) {
      if (placementExplainView && typeof placementExplainView.renderFragmentCoverageQuality === "function") {
        placementExplainView.renderFragmentCoverageQuality(rows);
      }
    }

    function renderPlacementExplain() {
      if (placementExplainView && typeof placementExplainView.renderPlacementExplain === "function") {
        placementExplainView.renderPlacementExplain();
      }
    }

function renderSplitEvents(events) {
      const wrap = byId("invSplitEventsBlock");
      const body = byId("invSplitEvents");
      if (!wrap || !body) return;
      const list = Array.isArray(events) ? events : [];
      if (!list.length) {
        wrap.style.display = "none";
        body.textContent = "";
        return;
      }
      wrap.style.display = "";
      const lines = list.slice(0, 80).map((e, i) => {
        const parent = String(e && e.parentCandidateKey || "-");
        const child = String(e && e.derivedCandidateKey || "-");
        const g = Number.isFinite(Number(e && e.generation)) ? Number(e.generation) : 1;
        const s = Number.isFinite(Number(e && e.splitIndex)) ? Number(e.splitIndex) : (i + 1);
        const used = Number(e && e.usedAreaMm2 || 0).toFixed(1);
        const left = Number(e && e.leftoverAreaMm2 || 0).toFixed(1);
        return `${i + 1}. ${parent} -> ${child} (g=${g}, s=${s}, used=${used}, left=${left})`;
      });
      body.textContent = lines.join("\\n");
    }

    function isManualInventoryMode() {
      return String(state.layoutMode || "") === "inventory_manual";
    }

    function renderInventoryManualPanel() {
      syncInventoryStep2ModeUi();
      const root = byId("inventoryManualPanel");
      if (!root) return;
      root.style.display = isManualInventoryMode() ? "block" : "none";
      if (!isManualInventoryMode()) return;

      const metricsEl = byId("inventoryManualMetrics");
      const stateEl = byId("inventoryManualState");
      const summaryEl = byId("inventoryManualSummary");
      const mm = state.layoutRun && state.layoutRun.manual ? state.layoutRun.manual.lastMetrics : null;
      const manual = state.layoutRun && state.layoutRun.manual ? state.layoutRun.manual : null;
      const placements = Array.isArray(state.layoutRun && state.layoutRun.placements) ? state.layoutRun.placements : [];
      const loadedCount = Array.isArray(state.layoutRun && state.layoutRun.candidatePool)
        ? state.layoutRun.candidatePool.length
        : 0;

      const selectedIdx = Number(manual && manual.selectedPlacementIndex);
      const selectedPlacement = Number.isFinite(selectedIdx) && selectedIdx >= 0 && selectedIdx < placements.length ? placements[selectedIdx] : null;
      const hasSelected = !!selectedPlacement;
      const selectedTag = hasSelected
        ? String(selectedPlacement.inventoryTag || `#${selectedIdx + 1}`)
        : t("manual_selected_none", null, "нет");
      const activeNapRaw = manual && manual.activePiece && Number.isFinite(Number(manual.activePiece.napDirectionDeg))
        ? Number(manual.activePiece.napDirectionDeg)
        : null;
      const selectedNapDeg = hasSelected
        ? (Number.isFinite(Number(selectedPlacement.napEffectiveDeg))
            ? Number(selectedPlacement.napEffectiveDeg)
            : (Number.isFinite(Number(selectedPlacement.napDirectionDeg))
                ? Number(selectedPlacement.napDirectionDeg)
                : null))
        : activeNapRaw;
      const selectedNapText = Number.isFinite(selectedNapDeg)
        ? `${((((selectedNapDeg % 360) + 360) % 360)).toFixed(1)}В°`
        : "-";
      const noteText = manual && manual.statusNote ? String(manual.statusNote).trim() : "";

      if (stateEl) {
        stateEl.textContent = noteText
          ? `${t("manual_status_prefix", null, "Статус")}: ${noteText}`
          : `${t("manual_status_prefix", null, "Статус")}: ${t("manual_status_ready", null, "готов к размещению")}`;
      }

      if (metricsEl) {
        if (!mm) {
          metricsEl.textContent = "gain=- | util=- | статус=-";
        } else {
          const reason = String(mm.statusReason || "").trim();
          metricsEl.textContent = `gain=${Number(mm.gainAreaMm2 || 0).toFixed(0)} мм² | util=${(Number(mm.utilizationLocal || 0) * 100).toFixed(1)}% | статус=${String(mm.status || "ok")}${reason ? ` (${reason})` : ""}`;
        }
      }

      if (summaryEl) {
        const zone = getManualZone();
        const zoneArea = zone ? Math.max(0, Number(zoneEffectiveArea(zone) || 0)) : 0;
        const usefulArea = placements.reduce((a, p) => a + Number(p && p.gainAreaMm2 || 0), 0);
        const coverage = zoneArea > 0 ? (usefulArea / zoneArea) * 100 : 0;
        if (placements.length <= 0) {
          summaryEl.textContent = t("manual_summary_loaded", { loaded: loadedCount }, `Лоток: ${loadedCount}`);
        } else {
          const napPart = t("manual_summary_nap", { nap: selectedNapText }, `nap: ${selectedNapText}`);
          summaryEl.textContent = t(
            "manual_summary_full",
            {
              loaded: loadedCount,
              onField: placements.length,
              coverage: coverage.toFixed(1),
              selected: selectedTag,
              nap: napPart
            },
            `Лоток: ${loadedCount} | На поле: ${placements.length} | Покрытие: ${coverage.toFixed(1)}% | Выбран: ${selectedTag} | ${napPart}`
          );
        }
      }
    }

    function setInventoryMetricRowVisible(valueId, visible) {
      if (inventoryStep2Ui && typeof inventoryStep2Ui.setMetricRowVisible === "function") {
        inventoryStep2Ui.setMetricRowVisible(valueId, visible);
      } else {
        const el = byId(valueId);
        if (!el || !el.parentElement) return;
        el.parentElement.style.display = visible ? "" : "none";
      }
    }

    function syncInventoryStep2ModeUi() {
      if (inventoryStep2Ui && typeof inventoryStep2Ui.syncModeUi === "function") {
        inventoryStep2Ui.syncModeUi();
        return;
      }
    }

    function getManualZone(referencePoints) {
      const zones = Array.isArray(state.zones) ? state.zones : [];
      if (!zones.length) return null;
      const validZone = (z) => Array.isArray(z && z.points) && z.points.length >= 3;
      const refPts = Array.isArray(referencePoints) ? referencePoints : [];
      if (refPts.length >= 3) {
        const c = centroid(refPts);
        const byRef = findZoneAt(c);
        if (byRef && validZone(byRef)) return byRef;
      }

      const selectedId = Number(state.layoutRun.selectedZoneId || state.selectedZoneId);
      const bySelected = zones.find((z) => Number(z.id) === selectedId && validZone(z)) || null;
      if (bySelected) return bySelected;

      const manual = state.layoutRun && state.layoutRun.manual ? state.layoutRun.manual : null;
      const activePts = manual && manual.activePiece && Array.isArray(manual.activePiece.points)
        ? manual.activePiece.points
        : [];
      if (activePts.length >= 3) {
        const c = centroid(activePts);
        const byActive = findZoneAt(c);
        if (byActive && validZone(byActive)) return byActive;
      }

      const placements = Array.isArray(state.layoutRun && state.layoutRun.placements) ? state.layoutRun.placements : [];
      for (let i = placements.length - 1; i >= 0; i--) {
        const pts = Array.isArray(placements[i] && placements[i].alignedContour) ? placements[i].alignedContour : [];
        if (pts.length < 3) continue;
        const c = centroid(pts);
        const byPlacement = findZoneAt(c);
        if (byPlacement && validZone(byPlacement)) return byPlacement;
      }

      // Final fallback for initialization-only cases.
      return zones.find((z) => validZone(z)) || null;
    }

    function getManualZoneForPlacements(placements) {
      const zones = Array.isArray(state.zones) ? state.zones : [];
      const list = Array.isArray(placements) ? placements : [];
      if (!zones.length || !list.length) return null;
      let bestZone = null;
      let bestScore = -1;
      for (const z of zones) {
        const zPts = Array.isArray(z && z.points) ? z.points : [];
        if (zPts.length < 3) continue;
        let score = 0;
        for (const pl of list) {
          const pts = Array.isArray(pl && pl.alignedContour) ? pl.alignedContour : [];
          if (pts.length < 3) continue;
          // Count how many vertices of the placed contour are inside this zone.
          // This is robust enough for manual mode and avoids wrong selected-zone fallback.
          for (const p of pts) {
            if (pointInPolygon(p, zPts)) score++;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          bestZone = z;
        }
      }
      return bestScore > 0 ? bestZone : null;
    }

    function getManualCoveredContours() {
      return (state.layoutRun.fragments || [])
        .map((f) => Array.isArray(f && f.points) ? f.points : [])
        .filter((pts) => pts.length >= 3);
    }

    // ---------------------------------------------------------------------------
    // Seam computation — delegated to window.FurLabSeams (core/seams.js)
    // ---------------------------------------------------------------------------
    const toPointList = (raw) => window.FurLabSeams.toPointList(raw);
    const multiLargestOuterPoints = (mp) => window.FurLabSeams.multiLargestOuterPoints(mp);
    const contourBBox = (pts) => window.FurLabSeams.contourBBox(pts);
    const extractOuterContoursFromMulti = (mp) => window.FurLabSeams.extractOuterContoursFromMulti(mp);
    const contourEdges = (c) => window.FurLabSeams.contourEdges(c);
    const sharedCollinearSegment = (a, b, opts) => window.FurLabSeams.sharedCollinearSegment(a, b, opts);
    const seamKey = (seg, ak, bk) => window.FurLabSeams.seamKey(seg, ak, bk);
    const pointSegDistance = (pt, a, b) => window.FurLabSeams.pointSegDistance(pt, a, b);
    const minDistancePointToEdges = (pt, edges) => window.FurLabSeams.minDistancePointToEdges(pt, edges);
    const seamOnZoneBoundary = (seam, zPts, tol) => window.FurLabSeams.seamOnZoneBoundary(seam, zPts, tol);
    const computeSeamSegmentsFromEdgeItems = (items, opts, diag) => window.FurLabSeams.computeSeamSegmentsFromEdgeItems(items, opts, diag);
    const computeSeamSegmentsFromVisibleContours = (vc, opts, diag) => window.FurLabSeams.computeSeamSegmentsFromVisibleContours(vc, opts, diag);
    const computeSeamSegmentsFromAppliedFragments = (frags, opts, diag) => window.FurLabSeams.computeSeamSegmentsFromAppliedFragments(frags, opts, diag);
    function updateManualActivePiecePoints(nextPoints) {
      const manual = state.layoutRun && state.layoutRun.manual ? state.layoutRun.manual : null;
      const ap = manual && manual.activePiece ? manual.activePiece : null;
      if (!ap) return;
      const pts = toPointList(nextPoints);
      if (pts.length < 3) return;
      ap.points = pts;
      ap.center = centroid(pts);
    }

    async function evaluateManualActivePieceNow() {
      if (!isManualInventoryMode()) return;
      const manual = state.layoutRun && state.layoutRun.manual ? state.layoutRun.manual : null;
      const ap = manual && manual.activePiece ? manual.activePiece : null;
      const zone = getManualZone(ap.points);
      if (!ap || !Array.isArray(ap.points) || ap.points.length < 3 || !zone) {
        if (manual) {
          manual.lastMetrics = null;
          manual.lastEvalContours = null;
        }
        renderInventoryManualPanel();
        renderScene();
        return;
      }
      const seq = ++manualEvalSeq;
      const res = await api("/api/layout/manual/evaluate", "POST", {
        zone: { id: zone.id, points: zone.points || [], holes: Array.isArray(zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [] },
        piecePoints: ap.points,
        coveredContours: getManualCoveredContours(),
        pieceSeamReserveMm: getCurrentManualAllowanceMm(),
        minVisibleAreaMm2: 6000,
        minSpanMm: 70
      }).catch(() => null);
      if (seq !== manualEvalSeq) return;
      state.layoutRun.manual = state.layoutRun.manual || { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
      if (!res || !res.ok) {
        state.layoutRun.manual.lastMetrics = {
          gainAreaMm2: 0,
          overlapAreaMm2: 0,
          outsideAreaMm2: 0,
          utilizationLocal: 0,
          coveragePct: 0,
          status: "error",
          statusReason: String(res && (res.error || res.errorCode) || "manual_recompute_failed")
        };
        state.layoutRun.manual.statusNote = "оценка не получена";
        renderInventoryManualPanel();
        renderManualTrayIntoRoot();
        renderScene();
        return;
      }
      const mm = res.metrics || {};
      manual.lastMetrics = {
        pieceAreaMm2: Number(mm.pieceAreaMm2 || 0),
        gainAreaMm2: Number(mm.gainAreaMm2 || 0),
        overlapAreaMm2: Number(mm.overlapInsideMm2 || 0),
        outsideAreaMm2: Number(mm.outsideWasteMm2 || 0),
        utilizationLocal: Number(mm.utilization || 0),
        status: String(mm.status || "ok"),
        statusReason: String(mm.statusReason || ""),
        visibleSpanMm: Number(mm.visibleSpanMm || 0),
        inZoneAreaMm2: Number(mm.inZoneAreaMm2 || 0),
        inZoneCoreAreaMm2: Number(mm.inZoneCoreAreaMm2 || 0),
        gainCoreAreaMm2: Number(mm.gainCoreAreaMm2 || 0)
      };
      manual.lastEvalContours = res.contours && typeof res.contours === "object" ? res.contours : null;
      renderInventoryManualPanel();
      renderScene();
    }

    async function evaluateManualActivePieceDirect() {
      const manual = state.layoutRun && state.layoutRun.manual ? state.layoutRun.manual : null;
      const ap = manual && manual.activePiece ? manual.activePiece : null;
      const zone = getManualZone(ap.points);
      if (!manual || !ap || !Array.isArray(ap.points) || ap.points.length < 3 || !zone) return null;
      const res = await api("/api/layout/manual/evaluate", "POST", {
        zone: { id: zone.id, points: zone.points || [], holes: Array.isArray(zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [] },
        piecePoints: ap.points,
        coveredContours: getManualCoveredContours(),
        pieceSeamReserveMm: getCurrentManualAllowanceMm(),
        minVisibleAreaMm2: 6000,
        minSpanMm: 70
      }).catch(() => null);
      if (!res || !res.ok) return null;
      const mm = res.metrics || {};
      manual.lastMetrics = {
        pieceAreaMm2: Number(mm.pieceAreaMm2 || 0),
        gainAreaMm2: Number(mm.gainAreaMm2 || 0),
        overlapAreaMm2: Number(mm.overlapInsideMm2 || 0),
        outsideAreaMm2: Number(mm.outsideWasteMm2 || 0),
        utilizationLocal: Number(mm.utilization || 0),
        status: String(mm.status || "ok"),
        statusReason: String(mm.statusReason || ""),
        visibleSpanMm: Number(mm.visibleSpanMm || 0),
        inZoneAreaMm2: Number(mm.inZoneAreaMm2 || 0),
        inZoneCoreAreaMm2: Number(mm.inZoneCoreAreaMm2 || 0),
        gainCoreAreaMm2: Number(mm.gainCoreAreaMm2 || 0)
      };
      manual.lastEvalContours = res.contours && typeof res.contours === "object" ? res.contours : null;
      return manual.lastMetrics;
    }

    async function ensureManualPlacementsCoreContours() {
      if (!isManualInventoryMode()) return;
      const zone = getManualZone();
      if (!zone) return;
      const placements = Array.isArray(state.layoutRun && state.layoutRun.placements) ? state.layoutRun.placements : [];
      if (!placements.length) return;
      const seamMm = getCurrentManualAllowanceMm();
      const targets = placements.filter((p) => Array.isArray(p && p.alignedContour) && p.alignedContour.length >= 3);
      if (!targets.length) return;
      for (const p of targets) {
        try {
          const res = await api("/api/layout/manual/evaluate", "POST", {
            zone: { id: zone.id, points: zone.points || [], holes: Array.isArray(zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [] },
            piecePoints: p.alignedContour || [],
            coveredContours: [],
            pieceSeamReserveMm: seamMm
          });
          if (!res || !res.ok || !res.contours) continue;
          const ctr = res.contours;
          // Only update core contour if erosion actually produced a result вЂ" don't overwrite good data with empty
          if (Array.isArray(ctr.coreWorld) && ctr.coreWorld.length > 0) {
            p.alignedCoreContours = ctr.coreWorld;
            p.alignedCoreContour = multiLargestOuterPoints(p.alignedCoreContours);
          }
          p.inZoneCoreContours = Array.isArray(ctr.inZoneCore) ? ctr.inZoneCore : [];
          p.inZoneCoreContour = multiLargestOuterPoints(p.inZoneCoreContours);
          p.inZoneCoreAreaMm2 = Number(res && res.metrics && res.metrics.inZoneCoreAreaMm2 || 0);
          p.seamStatus = String(res && res.metrics && res.metrics.seamStatus || (seamMm > 0 ? "failed" : "disabled"));
          p.seamReserveMm = seamMm;
        } catch (_) {
          // Keep placement unchanged on transport/runtime errors.
        }
      }
    }

    function scheduleManualActivePieceEval() {
      if (manualEvalDebounceId) clearTimeout(manualEvalDebounceId);
      manualEvalDebounceId = setTimeout(() => {
        manualEvalDebounceId = null;
        void evaluateManualActivePieceNow();
      }, 90);
    }

    function activateManualPieceFromCandidate(candidate, anchorWorld) {
      if (!isManualInventoryMode()) return;
      const c = candidate && typeof candidate === "object" ? candidate : null;
      if (!c) return;
      const contourRaw = parseScrapContourPoints(c.scrapContour);
      const contour = toPointList(contourRaw);
      if (contour.length < 3) return;
      const zone = getManualZone(contour);
      const zoneCenter = zone ? centroid(zone.points || []) : { x: 0, y: 0 };
      const targetCenter = anchorWorld && Number.isFinite(Number(anchorWorld.x)) && Number.isFinite(Number(anchorWorld.y))
        ? { x: Number(anchorWorld.x), y: Number(anchorWorld.y) }
        : zoneCenter;
      const partCenter = centroid(contour);
      const moved = translatePoints(contour, targetCenter.x - partCenter.x, targetCenter.y - partCenter.y);
      state.layoutRun.manual = state.layoutRun.manual || { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
      state.layoutRun.manual.selectedCandidateTag = String(c.inventoryTag || c.id || "");
      state.layoutRun.manual.activePiece = {
        inventoryTag: String(c.inventoryTag || c.id || ""),
        scrapPieceId: String(c.scrapPieceId || c.id || ""),
        candidate: c,
        points: moved,
        center: centroid(moved),
        rotationDeg: 0
      };
      state.layoutRun.manual.statusNote = "не зафиксирован";
      state.layoutRun.manual.lastMetrics = null;
      state.layoutRun.manual.lastEvalContours = null;
      renderInventoryManualPanel();
      renderScene();
    }

    function addManualPlacementFromCandidate(candidate, anchorWorld) {
      if (!isManualInventoryMode()) return null;
      const c = candidate && typeof candidate === "object" ? candidate : null;
      if (!c) return null;
      const contour = toPointList(parseScrapContourPoints(c.scrapContour));
      if (contour.length < 3) return null;
      const zone = getManualZone();
      const zoneCenter = zone ? centroid(zone.points || []) : { x: 0, y: 0 };
      const targetCenter = anchorWorld && Number.isFinite(Number(anchorWorld.x)) && Number.isFinite(Number(anchorWorld.y))
        ? { x: Number(anchorWorld.x), y: Number(anchorWorld.y) }
        : zoneCenter;
      const partCenter = centroid(contour);
      const moved = translatePoints(contour, targetCenter.x - partCenter.x, targetCenter.y - partCenter.y);
      state.layoutRun.manual = state.layoutRun.manual || { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
      const nextId = (state.layoutRun.placements || []).length + 1;
      const p = {
        status: "matched",
        fragmentId: nextId,
        fragmentAreaMm2: 0,
        gainAreaMm2: 0,
        overlapAreaMm2: 0,
        outsideAreaMm2: 0,
        utilizationLocal: 0,
        scrapAreaMm2: Number(c && c.areaMm2 || 0),
        inventoryTag: String(c.inventoryTag || c.id || ""),
        scrapPieceId: String(c.scrapPieceId || c.id || ""),
        materialId: String(c.materialId || ""),
        alignedContour: moved,
        inZoneContour: moved.slice(),
        inZoneContours: [],
        alignedCoreContour: [],
        alignedCoreContours: [],
        inZoneCoreContour: [],
        inZoneCoreContours: [],
        inZoneCoreAreaMm2: 0
      };
      state.layoutRun.placements = (state.layoutRun.placements || []).concat([p]);
      state.layoutRun.manual.selectedPlacementIndex = state.layoutRun.placements.length - 1;
      state.layoutRun.manual.selectedCandidateTag = String(c.inventoryTag || c.id || "");
      state.layoutRun.manual.activePiece = null;
      state.layoutRun.manual.lastMetrics = null;
      state.layoutRun.manual.lastEvalContours = null;
      state.layoutRun.manual.statusNote = "кусок добавлен (ручной режим)";
      byId("invTotalFragments").textContent = String(state.layoutRun.placements.length);
      renderPlacementRows(state.layoutRun.placements || []);
      renderInventoryManualPanel();
      renderScene();
      void requestManualRecomputeFromUi();
      // Important: when adding directly from tray, compute Pfull/Pcore metrics immediately,
      // otherwise "Припуск куска" has no geometry to render for this placement.
      const coveredBefore = getManualCoveredContours();
      void (async () => {
        try {
          const zoneNow = getManualZone(moved);
          if (!zoneNow) return;
          const evalRes = await api("/api/layout/manual/evaluate", "POST", {
            zone: { id: zoneNow.id, points: zoneNow.points || [], holes: Array.isArray(zoneNow.holes) ? zoneNow.holes.map(holeContour).filter((h) => h.length >= 3) : [] },
            piecePoints: moved,
            coveredContours: coveredBefore,
            pieceSeamReserveMm: getCurrentManualAllowanceMm(),
            minVisibleAreaMm2: 6000,
            minSpanMm: 70
          }).catch(() => null);
          if (!evalRes || !evalRes.ok) return;
          const mm = evalRes.metrics || {};
          const ctr = evalRes.contours || {};
          p.gainAreaMm2 = Number(mm.gainAreaMm2 || 0);
          p.fragmentAreaMm2 = Number(mm.gainAreaMm2 || 0);
          p.overlapAreaMm2 = Number(mm.overlapInsideMm2 || 0);
          p.outsideAreaMm2 = Number(mm.outsideWasteMm2 || 0);
          p.utilizationLocal = Number(mm.utilization || 0);
          p.scrapAreaMm2 = Number(mm.pieceAreaMm2 || p.scrapAreaMm2 || 0);
          p.inZoneContours = Array.isArray(ctr.inZone) ? ctr.inZone : [];
          p.inZoneContour = multiLargestOuterPoints(p.inZoneContours);
          p.alignedCoreContours = Array.isArray(ctr.coreWorld) ? ctr.coreWorld : [];
          p.alignedCoreContour = multiLargestOuterPoints(p.alignedCoreContours);
          p.inZoneCoreContours = Array.isArray(ctr.inZoneCore) ? ctr.inZoneCore : [];
          p.inZoneCoreContour = multiLargestOuterPoints(p.inZoneCoreContours);
          p.inZoneCoreAreaMm2 = Number(mm.inZoneCoreAreaMm2 || 0);
          updateManualStatsFromPlacements();
          renderPlacementRows(state.layoutRun.placements || []);
          renderScene();
          void requestManualRecomputeFromUi();
        } catch (_) {}
      })();
      return p;
    }

    async function commitInventoryManualActivePiece() {
      if (!isManualInventoryMode()) return;
      const manual = state.layoutRun && state.layoutRun.manual ? state.layoutRun.manual : null;
      const ap = manual && manual.activePiece ? manual.activePiece : null;
      if (!ap || !Array.isArray(ap.points) || ap.points.length < 3) return;
      if (manualEvalDebounceId) {
        clearTimeout(manualEvalDebounceId);
        manualEvalDebounceId = null;
      }
      if (manual && !manual.lastMetrics) await evaluateManualActivePieceDirect();
      const mm = manual && manual.lastMetrics ? manual.lastMetrics : null;
      const inZoneArea = Number(mm && mm.inZoneAreaMm2 || 0);
      const gainArea = Number(mm && mm.gainAreaMm2 || 0);
      if (!mm || inZoneArea <= 0) {
        const reason = String(mm && mm.statusReason || "").trim();
        byId("invDebugInfo").textContent = `manual_commit_rejected: piece_outside_zone${reason ? ` (${reason})` : ""}`;
        if (manual) manual.statusNote = t("manual_status_not_fixed_outside", null, "Not fixed: piece is outside zone");
        return;
      }
      const nextId = (state.layoutRun.placements || []).length + 1;
      const inZoneMp = manual && manual.lastEvalContours ? manual.lastEvalContours.inZone : [];
      const inZoneContour = multiLargestOuterPoints(inZoneMp);
      const inZoneCoreMp = manual && manual.lastEvalContours ? manual.lastEvalContours.inZoneCore : [];
      const inZoneCoreContour = multiLargestOuterPoints(inZoneCoreMp);
      const coreWorldMp = manual && manual.lastEvalContours ? manual.lastEvalContours.coreWorld : [];
      const alignedCoreContour = multiLargestOuterPoints(coreWorldMp);
      const p = {
        status: "matched",
        fragmentId: nextId,
        fragmentAreaMm2: Math.max(0, gainArea),
        gainAreaMm2: Math.max(0, gainArea),
        overlapAreaMm2: Number(mm.overlapAreaMm2 || 0),
        outsideAreaMm2: Number(mm.outsideAreaMm2 || 0),
        utilizationLocal: Number(mm.utilizationLocal || 0),
        scrapAreaMm2: Number(mm.pieceAreaMm2 || 0),
        inventoryTag: String(ap.inventoryTag || ""),
        scrapPieceId: String(ap.scrapPieceId || ""),
        alignedContour: toPointList(ap.points),
        alignedCoreContour,
        alignedCoreContours: Array.isArray(coreWorldMp) ? coreWorldMp : [],
        inZoneContour,
        inZoneContours: Array.isArray(inZoneMp) ? inZoneMp : [],
        inZoneCoreContour,
        inZoneCoreContours: Array.isArray(inZoneCoreMp) ? inZoneCoreMp : [],
        inZoneCoreAreaMm2: Number(mm && mm.inZoneCoreAreaMm2 || 0)
      };
      state.layoutRun.placements = (state.layoutRun.placements || []).concat([p]);
      state.layoutRun.manual.lastMetrics = null;
      state.layoutRun.manual.lastEvalContours = null;
      state.layoutRun.manual.activePiece = null;
      state.layoutRun.manual.statusNote = gainArea > 0 ? "зафиксирован" : "зафиксирован (без прироста)";
      updateManualStatsFromPlacements();
      renderPlacementRows(state.layoutRun.placements || []);
      await recomputeInventoryManualVisibility();
      renderInventoryManualPanel();
      renderScene();
    }

    async function recomputeInventoryManualVisibility() {
      if (!isManualInventoryMode()) return false;
      state.layoutRun.manual = state.layoutRun.manual || { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
      const recomputeSeq = Number(state.layoutRun.manual.recomputeSeq || 0) + 1;
      state.layoutRun.manual.recomputeSeq = recomputeSeq;
      const isStale = () => {
        const currentSeq = Number(state.layoutRun && state.layoutRun.manual && state.layoutRun.manual.recomputeSeq || 0);
        return currentSeq !== recomputeSeq;
      };
      const placements = Array.isArray(state.layoutRun.placements) ? state.layoutRun.placements : [];
      const selectedLayout = getSelectedLayoutEntry();
      const boundZone = selectedLayout && String(selectedLayout.mode || "") === "inventory_manual"
        ? ensureManualLayoutBinding(selectedLayout)
        : null;
      const selectedZoneId = Number(
        boundZone && boundZone.id
        || state.layoutRun && state.layoutRun.selectedZoneId
        || state.selectedZoneId
        || 0
      );
      const zoneBySelectedId = (Array.isArray(state.zones) ? state.zones : []).find((z) => Number(z && z.id || 0) === selectedZoneId) || null;
      const zoneByPlacements = getManualZoneForPlacements(placements);
      const refContour = placements.length
        ? (Array.isArray(placements[placements.length - 1] && placements[placements.length - 1].alignedContour)
          ? placements[placements.length - 1].alignedContour
          : [])
        : [];
      let zone = zoneBySelectedId || zoneByPlacements || getManualZone(refContour);
      if (!zone) {
        state.layoutRun.manual.lastMetrics = {
          gainAreaMm2: 0,
          overlapAreaMm2: 0,
          outsideAreaMm2: 0,
          utilizationLocal: 0,
          coveragePct: 0,
          status: "error",
          statusReason: "manual_zone_not_selected",
          recomputeSeq
        };
        state.layoutRun.manual.statusNote = "manual_zone_not_selected";
        renderInventoryManualPanel();
        renderManualTrayIntoRoot();
        renderScene();
        return false;
      }
      if (selectedLayout && String(selectedLayout.mode || "") === "inventory_manual") {
        selectedLayout.boundZoneId = Number(zone && zone.id || selectedLayout.boundZoneId || 0) || null;
        selectedLayout.boundDetailId = Number(zone && zone.detailId || selectedLayout.boundDetailId || 0) || null;
      }
      state.layoutRun.selectedZoneId = Number(zone && zone.id || selectedZoneId || 0) || null;
      await ensureManualPlacementsCoreContours();
      const toFlatContour = (raw) => {
        const out = [];
        const push = (x, y) => {
          const xn = Number(x);
          const yn = Number(y);
          if (Number.isFinite(xn) && Number.isFinite(yn)) out.push({ x: xn, y: yn });
        };
        const walk = (node) => {
          if (!node) return;
          if (Array.isArray(node)) {
            if (node.length >= 2 && Number.isFinite(Number(node[0])) && Number.isFinite(Number(node[1]))) {
              push(node[0], node[1]);
              return;
            }
            for (const child of node) walk(child);
            return;
          }
          if (typeof node === "object" && node.x !== undefined && node.y !== undefined) {
            push(node.x, node.y);
          }
        };
        walk(raw);
        return out;
      };
      // Manual mode: evaluate all actually placed contours, even if status got lost.
      const placementsForEval = placements
        .map((p) => {
          const alignedSingle = toFlatContour(p && p.alignedContour);
          const alignedMulti = toFlatContour(p && p.alignedContours);
          const alignedContour = alignedSingle.length >= 3 ? alignedSingle : (alignedMulti.length >= 3 ? alignedMulti : []);
          if (alignedContour.length < 3) return null;
          return { ...p, alignedContour, status: "matched" };
        })
        .filter(Boolean);
      const debugPlacementsPreview = placementsForEval.map((p, idx) => ({
        index: idx,
        pieceId: String(p && p.scrapPieceId || ""),
        inventoryTag: String(p && p.inventoryTag || ""),
        alignOffsetX: Number(p && p.alignOffsetX || 0),
        alignOffsetY: Number(p && p.alignOffsetY || 0),
        rotationDeg: Number(p && p.alignRotationDeg || 0),
        bboxWorld: contourBBox(p && p.alignedContour)
      }));
      const callRecomputeForZone = async (z) => {
        return api("/api/layout/manual/recompute", "POST", {
          zone: { id: z.id, points: z.points || [], holes: Array.isArray(z.holes) ? z.holes.map(holeContour).filter((h) => h.length >= 3) : [] },
          selectedZoneId: Number(z && z.id || selectedZoneId || 0) || null,
          placements: placementsForEval,
          pieceSeamReserveMm: getCurrentManualAllowanceMm(),
          layerPolicy: "first_on_top",
          minAreaMm2: 1,
          rasterMm: 2,
          debugManual: true
        });
      };
      let res = null;
      try {
        res = await callRecomputeForZone(zone);
      } catch (err) {
        res = { ok: false, error: String(err && err.message ? err.message : "manual_recompute_request_failed") };
      }
      if (isStale()) return false;
      const looksImpossibleZero = !!(res && res.ok && placementsForEval.length > 0 && Number(res.visibleMetrics && res.visibleMetrics.usefulAreaMm2 || 0) <= 1e-9 && Number(res.visibleMetrics && res.visibleMetrics.selectedPiecesAreaMm2 || 0) <= 1e-9);
      // Manual layouts are bound to a zone, but saved bindings can drift after reopening
      // or switching between multiple manual layouts. If a recompute returns impossible all-zero
      // metrics while pieces are visibly placed, retry against the zone inferred from placements.
      const allowZoneFallbackDiagnostics = !!zoneByPlacements && Number(zoneByPlacements && zoneByPlacements.id || 0) > 0;
      let usedZoneFallback = false;
      let recomputeDebug = null;
      if (looksImpossibleZero && allowZoneFallbackDiagnostics) {
        const placementZoneId = Number(zoneByPlacements && zoneByPlacements.id || 0);
        const selectedZoneNumericId = Number(zone && zone.id || 0);
        if (placementZoneId > 0 && placementZoneId !== selectedZoneNumericId) {
          try {
            const zz = await callRecomputeForZone(zoneByPlacements);
            if (isStale()) return false;
            const useful = Number(zz && zz.visibleMetrics && zz.visibleMetrics.usefulAreaMm2 || 0);
            const inZone = Number(zz && zz.visibleMetrics && zz.visibleMetrics.selectedInZoneAreaMm2 || 0);
            if (zz && zz.ok && (useful > 1e-9 || inZone > 1e-9 || (Array.isArray(zz.fragments) && zz.fragments.length > 0))) {
              res = zz;
              zone = zoneByPlacements;
              state.layoutRun.selectedZoneId = placementZoneId;
              state.selectedZoneId = placementZoneId;
              if (selectedLayout && String(selectedLayout.mode || "") === "inventory_manual") {
                selectedLayout.boundZoneId = placementZoneId;
                selectedLayout.boundDetailId = Number(zoneByPlacements && zoneByPlacements.detailId || selectedLayout.boundDetailId || 0) || null;
              }
              state.layoutRun.manual.statusNote = `ручная выкладка перепривязана к зоне ${placementZoneId}`;
              usedZoneFallback = true;
            }
          } catch (_) {}
        }
        if (usedZoneFallback) {
          usedZoneFallback = true;
          console.warn("[manual/recompute][front] impossible zero fixed by zone fallback", {
            originalSelectedZoneId: selectedZoneId,
            selectedZoneId: Number(zone && zone.id || 0),
            usefulAreaMm2: Number(res.visibleMetrics && res.visibleMetrics.usefulAreaMm2 || 0),
            selectedInZoneAreaMm2: Number(res.visibleMetrics && res.visibleMetrics.selectedInZoneAreaMm2 || 0),
            placements: placementsForEval.length
          });
        }
      }
      if (looksImpossibleZero) {
        console.warn("[manual/recompute][front] manual_recompute_selected_zone_mismatch", {
          selectedZoneId,
          recomputeZoneId: Number(zone && zone.id || 0),
          placements: placementsForEval.length,
          usedZoneFallback
        });
      }
      try {
        const debug = res && res.debug && typeof res.debug === "object" ? res.debug : null;
        if (debug) {
          recomputeDebug = debug;
          debug.usedZoneFallback = usedZoneFallback;
          debug.selectedZoneId = selectedZoneId;
          debug.recomputeZoneId = Number(zone && zone.id || 0);
          const firstScene = debugPlacementsPreview[0] || null;
          const firstEval = Array.isArray(debug.placements) ? (debug.placements[0] || null) : null;
          console.info("[manual/recompute][front] payload placements:", debugPlacementsPreview.length, debugPlacementsPreview);
          console.info("[manual/recompute][front] first placement scene vs evaluated:", { firstScene, firstEval });
          console.info("[manual/recompute][front] backend debug:", debug);
          if (state.layoutRun && state.layoutRun.manual) state.layoutRun.manual.lastRecomputeDiagnostics = debug;
        }
      } catch (_) {}
      if (isStale()) return false;
      if (!res || !res.ok) {
        state.layoutRun.manual.lastMetrics = {
          gainAreaMm2: 0,
          overlapAreaMm2: 0,
          outsideAreaMm2: 0,
          utilizationLocal: 0,
          coveragePct: 0,
          status: "error",
          statusReason: String(res && (res.error || res.errorCode) || "manual_recompute_failed"),
          recomputeSeq
        };
        state.layoutRun.manual.statusNote = "оценка не получена";
        renderInventoryManualPanel();
        renderManualTrayIntoRoot();
        renderScene();
        return false;
      }
      state.layoutRun.fragments = clipFragmentsByZoneDomain(Array.isArray(res.fragments) ? res.fragments : [], zone);
      const visibleContours = Array.isArray(res.visibleContours) ? res.visibleContours : [];
      const hasBackendSeamContours = Array.isArray(res.seamVisibleContours);
      const seamVisibleContours = hasBackendSeamContours ? res.seamVisibleContours : visibleContours;
      const seamGeometrySource = String(res.seamGeometrySource || (hasBackendSeamContours ? "backend_seam" : "visible"));
      const manualApplied = isManualInventoryMode() && String(state.layoutRun && state.layoutRun.status || "") === "applied";
      const isDirectInventory = isInventoryLikeLayoutMode(state.layoutMode) && !isManualInventoryMode();
      let seamSegments = [];
      const seamDiag = {};
      let seamSourceResolved = manualApplied ? "applied_fragments" : (isDirectInventory ? "direct_core" : "disabled_before_apply");
      if (manualApplied) {
        const appliedFragments = Array.isArray(res.fragments) ? res.fragments : [];
        seamSegments = computeSeamSegmentsFromAppliedFragments(appliedFragments, {
          minLenMm: 3,
          tolDistMm: 2.5,
          tolParallel: 0.35
        }, seamDiag);
        if (!Array.isArray(seamSegments) || seamSegments.length === 0) {
          seamSegments = computeSeamSegmentsFromVisibleContours(Array.isArray(seamVisibleContours) ? seamVisibleContours : [], {
            minLenMm: 3,
            tolDistMm: 2.5,
            tolParallel: 0.35
          }, seamDiag);
        }
        seamSourceResolved = `applied_fragments:${seamGeometrySource}`;
      } else if (!isDirectInventory && Array.isArray(res.fragments) && res.fragments.length >= 2) {
        // Regular layout вЂ" compute shared seam segments between adjacent fragments.
        seamSegments = computeSeamSegmentsFromAppliedFragments(res.fragments, {
          minLenMm: 3,
          tolDistMm: 2.5,
          tolParallel: 0.35
        }, seamDiag);
        seamSourceResolved = `regular:${seamGeometrySource}`;
      } else if (isDirectInventory) {
        // Seams from core geometry: adjacent core contours are ~2Г—seam_allowance apart,
        // so tolDistMm must span that gap (typically 24mm for 12mm allowance).
        const coreSeamContours = Array.isArray(res.seamVisibleContours) ? res.seamVisibleContours : seamVisibleContours;
        console.log("[seam-debug] directInventory seamVisibleContours:", coreSeamContours && coreSeamContours.length, "hasBackend:", Array.isArray(res.seamVisibleContours));
        seamSegments = computeSeamSegmentsFromVisibleContours(coreSeamContours, {
          minLenMm: 5,
          tolDistMm: 28,
          tolParallel: 0.35
        }, seamDiag);
        console.log("[seam-debug] result segments:", seamSegments && seamSegments.length, "diag:", JSON.stringify(seamDiag).slice(0, 200));
        seamSourceResolved = `direct_core:${seamGeometrySource}`;
      }
      if (seamSegments.length > 0) {
        const beforeBoundaryDrop = Array.isArray(seamSegments) ? seamSegments.length : 0;
        seamSegments = (Array.isArray(seamSegments) ? seamSegments : []).filter((seg) => !seamOnZoneBoundary(seg, zone && zone.points, 1.6));
        seamDiag.boundaryDropped = Math.max(0, beforeBoundaryDrop - seamSegments.length);
      }
      const coverageContours = manualApplied
        ? (Array.isArray(res.fragments)
          ? res.fragments
              .map((f) => normalizeContourArray((f && (f.points || f.cleanPoints || f.seamPoints)) || []))
              .filter((poly) => Array.isArray(poly) && poly.length >= 3)
          : [])
        : visibleContours;
      const coverageHoles = computeCoverageHolesForZone(zone, coverageContours);
      state.layoutRun.previewLayers = {
        pieceIntersections: Array.isArray(res.pieceIntersections) ? res.pieceIntersections : [],
        visibleArea: visibleContours,
        coverageHoles,
        seams: seamSegments
      };
      const vm = res.visibleMetrics || {};
      const zoneArea = Math.max(0, Number(zoneEffectiveArea(zone) || 0));
      const usefulArea = Number(vm.usefulAreaMm2 || 0);
      const selectedPiecesArea = Number(vm.selectedPiecesAreaMm2 || 0);
      const selectedInZoneArea = Number(vm.selectedInZoneAreaMm2 || 0);
      const overlapArea = Number(vm.overlapAreaMm2 || 0);
      const outsideArea = Math.max(0, selectedPiecesArea - selectedInZoneArea);
      const utilizationLocal = selectedPiecesArea > 0 ? (usefulArea / selectedPiecesArea) : 0;
      const coveragePct = zoneArea > 0 ? (usefulArea / zoneArea) * 100 : 0;
      const seamsCount = Array.isArray(seamSegments) ? seamSegments.length : 0;
      const seamsTotalLengthMm = (Array.isArray(seamSegments) ? seamSegments : []).reduce((acc, s) => acc + Number(s && s.lengthMm || 0), 0);
      const seamItems = (Array.isArray(seamSegments) ? seamSegments : []).map((s, idx) => {
        const pts = Array.isArray(s && s.points) ? s.points : [];
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const p of pts) {
          const x = Number(p && p.x);
          const y = Number(p && p.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
        const hasBBox = Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY);
        return {
          index: idx,
          pointCount: pts.length,
          bbox: hasBBox ? {
            minX: Math.round(minX * 1000) / 1000,
            minY: Math.round(minY * 1000) / 1000,
            maxX: Math.round(maxX * 1000) / 1000,
            maxY: Math.round(maxY * 1000) / 1000,
            width: Math.round((maxX - minX) * 1000) / 1000,
            height: Math.round((maxY - minY) * 1000) / 1000
          } : null
        };
      });
      state.layoutRun.manual.lastMetrics = {
        gainAreaMm2: usefulArea,
        overlapAreaMm2: overlapArea,
        outsideAreaMm2: outsideArea,
        utilizationLocal,
        coveragePct,
        seamsCount,
        seamsTotalLengthMm,
        status: "ok",
        recomputeSeq
      };
      state.layoutRun.manual.lastSeamDebug = {
        source: seamSourceResolved,
        seamContoursCount: Array.isArray(seamVisibleContours) ? seamVisibleContours.length : 0,
        seamsCount,
        fragmentsCount: Number(seamDiag.fragmentsCount || 0),
        candidatePairs: Number(seamDiag.candidatePairs || 0),
        acceptedSeams: Number(seamDiag.acceptedSeams || 0),
        boundaryDropped: Number(seamDiag.boundaryDropped || 0),
        rejectReasons: seamDiag.rejectReasons || {},
        fragments: Array.isArray(seamDiag.fragments) ? seamDiag.fragments : [],
        pairSamples: Array.isArray(seamDiag.pairSamples) ? seamDiag.pairSamples : [],
        seamItems,
        seamsTotalLengthMm: Math.round(seamsTotalLengthMm * 1000) / 1000,
        sample: seamsCount > 0 ? seamSegments[0] : null,
        usedZoneFallback: !!usedZoneFallback,
        selectedZoneId: Number(selectedZoneId || 0),
        recomputeZoneId: Number(zone && zone.id || 0),
        zoneByPlacementsId: Number(zoneByPlacements && zoneByPlacements.id || 0),
        layerEnabled: !!(state.layers && state.layers.visibleCore),
        renderedSeams: 0
      };
      if (recomputeDebug && Array.isArray(recomputeDebug.seamFragmentFlow)) {
        const flow = recomputeDebug.seamFragmentFlow;
        const byReason = {};
        let zeroVisible = 0;
        for (const it of flow) {
          if (Number(it && it.visibleAreaMm2 || 0) <= 1e-9) zeroVisible += 1;
          const r = String(it && it.droppedReason || "");
          if (r) byReason[r] = Number(byReason[r] || 0) + 1;
        }
        state.layoutRun.manual.lastSeamDebug.fragmentFlowSummary = {
          items: flow.length,
          zeroVisible,
          byReason
        };
      }
      console.info("[manual/seams][debug]", state.layoutRun.manual.lastSeamDebug);
      state.layoutRun.manual.statusNote = "оценка обновлена";
      byId("invUsefulArea").textContent = Number(vm.usefulAreaMm2 || 0).toFixed(1);
      byId("invUsedScrapArea").textContent = Number(vm.selectedInZoneAreaMm2 || 0).toFixed(1);
      byId("invScrapUtilization").textContent = Number(vm.utilizationPct || 0).toFixed(2);
      byId("invOverlapArea").textContent = Number(vm.overlapAreaMm2 || 0).toFixed(1);
      renderInventoryManualPanel();
      renderManualTrayIntoRoot();
      renderScene();
      return true;
    }

    async function requestManualRecomputeFromUi() {
      if (!isManualInventoryMode()) return false;
      state.layoutRun.manual = state.layoutRun.manual || { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
      const manual = state.layoutRun.manual;
      manual.recomputeUiQueue = Math.max(0, Number(manual.recomputeUiQueue || 0)) + 1;
      if (manual.recomputeUiRunning) return true;
      manual.recomputeUiRunning = true;
      let ok = true;
      try {
        while (Number(manual.recomputeUiQueue || 0) > 0) {
          manual.recomputeUiQueue = Math.max(0, Number(manual.recomputeUiQueue || 0) - 1);
          const res = await recomputeInventoryManualVisibility();
          if (res === false) ok = false;
        }
      } finally {
        manual.recomputeUiRunning = false;
        manual.recomputeUiQueue = 0;
      }
      return ok;
    }

    async function applyInventoryManualNow() {
      if (!isManualInventoryMode()) return false;
      state.layoutRun.status = "applied";
      const recomputeOk = await recomputeInventoryManualVisibility();
      if (recomputeOk === false) return false;
      state.layoutRun.manual = state.layoutRun.manual || { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
      state.layoutRun.manual.activePiece = null;
      state.layoutRun.manual.lastEvalContours = null;
      state.layoutRun.manual.selectedCandidateTag = "";
      const placements = Array.isArray(state.layoutRun && state.layoutRun.placements) ? state.layoutRun.placements : [];
      state.layoutRun.manual.statusNote = placements.length
        ? `применено: ${placements.length} кусков`
        : "применено";
      const selectedManualLayout = Array.isArray(state.layouts)
        ? state.layouts.find((x) => Number(x && x.id || 0) === Number(state.selectedLayoutId || 0) && String(x && x.mode || "") === "inventory_manual")
        : null;
      let autosaveOk = false;
      if (selectedManualLayout) {
        try {
          const saveRes = await saveLayoutEntry(selectedManualLayout);
          autosaveOk = !!(saveRes && saveRes.ok);
        } catch (_) {
          autosaveOk = false;
        }
      }
      // Commit placements to furlab-access traceability log
      if (placements.length > 0) {
        try {
          const zone = state.zones.find((z) => Number(z && z.id) === Number(state.selectedZoneId));
          const commitPayload = {
            runRef: String(selectedManualLayout && selectedManualLayout.persistedRunId || ""),
            zoneName: String(zone && zone.name || String(state.selectedZoneId || "")),
            placements: placements.map((p) => {
              const contour = Array.isArray(p.alignedContour) ? p.alignedContour : [];
              const cx = contour.length ? contour.reduce((s, pt) => s + (pt.x || 0), 0) / contour.length : 0;
              const cy = contour.length ? contour.reduce((s, pt) => s + (pt.y || 0), 0) / contour.length : 0;
              return {
                inventoryTag: String(p.inventoryTag || ""),
                scrapPieceId: String(p.scrapPieceId || ""),
                rotationDeg: Number.isFinite(Number(p.rotationDeg || p.alignRotationDeg)) ? Number(p.rotationDeg || p.alignRotationDeg) : 0,
                offsetXmm: Math.round(cx * 10) / 10,
                offsetYmm: Math.round(cy * 10) / 10,
                resultContourSnapshot: contour.length ? JSON.stringify(contour) : null
              };
            })
          };
          await api("/api/ac-proxy/layout-runs/commit", "POST", commitPayload, 10000);
        } catch (_) {
          // non-critical вЂ" traceability commit failure should not block apply
        }
      }
      renderInventoryManualPanel();
      renderManualTrayIntoRoot();
      const workspaceInfo = byId("workspaceInfo");
      if (workspaceInfo) {
        workspaceInfo.textContent = autosaveOk
          ? `Ручная выкладка применена и сохранена: ${placements.length} кусков`
          : `Ручная выкладка применена: ${placements.length} кусков`;
      }
      // Auto-enable fragments layer so results are visible right after Apply
      if (!state.layers.pieceBorders) {
        state.layers.pieceBorders = true;
        const _pbChk = byId("layerPieceBorders"); if (_pbChk) _pbChk.checked = true;
      }
      const step2Backdrop = byId("inventoryStep2Backdrop");
      if (step2Backdrop && step2Backdrop.style.display === "flex") closeInventoryStep2();
      renderScene();
      return true;
    }

    function updateManualStatsFromPlacements() {
      if (!isManualInventoryMode()) return;
      const placements = Array.isArray(state.layoutRun.placements) ? state.layoutRun.placements : [];
      byId("invTotalFragments").textContent = String(placements.length);
      const gain = placements.reduce((a, p) => a + Number(p && p.gainAreaMm2 || 0), 0);
      const pieceArea = placements.reduce((a, p) => a + Number(p && p.scrapAreaMm2 || 0), 0);
      const overlap = placements.reduce((a, p) => a + Number(p && p.overlapAreaMm2 || 0), 0);
      const outside = placements.reduce((a, p) => a + Number(p && p.outsideAreaMm2 || 0), 0);
      byId("invUsefulArea").textContent = gain.toFixed(1);
      byId("invUsedScrapArea").textContent = pieceArea.toFixed(1);
      byId("invScrapUtilization").textContent = pieceArea > 0 ? ((gain / pieceArea) * 100).toFixed(2) : "0.00";
      byId("invScrapWaste").textContent = pieceArea > 0 ? (100 - ((gain / pieceArea) * 100)).toFixed(2) : "0.00";
      byId("invOverlapArea").textContent = overlap.toFixed(1);
      byId("invRejectedOutside").textContent = outside.toFixed(0);
    }

    async function requestInventoryManualSuggestions() {
      if (!isManualInventoryMode()) return;
      const selectedLayout = getSelectedLayoutEntry();
      const boundZoneId = Number(selectedLayout && String(selectedLayout.mode || "") === "inventory_manual" ? selectedLayout.boundZoneId : 0) || 0;
      const zone = state.zones.find((z) => Number(z.id) === Number(boundZoneId || state.layoutRun.selectedZoneId || state.selectedZoneId));
      if (!zone) return;
      const coveredContours = (state.layoutRun.fragments || [])
        .map((f) => Array.isArray(f && f.points) ? f.points : [])
        .filter((pts) => pts.length >= 3);
      const res = await api("/api/layout/manual/suggest", "POST", {
        zone: { id: zone.id, points: zone.points || [], holes: Array.isArray(zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [] },
        axis: state.layoutRun.lastAxis || "y",
        candidates: state.layoutRun.candidatePool || [],
        constraints: state.layoutRun.lastConstraints || {},
        filters: state.layoutRun.lastFilters || {},
        options: INVENTORY_OPTIMIZATION_PROFILE.options || {},
        excludeInventoryTags: [],
        coveredContours,
        suggestCount: 5
      });
      if (!res || !res.ok) return;
      state.layoutRun.manual = state.layoutRun.manual || { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
      state.layoutRun.manual.suggestions = Array.isArray(res.suggestions) ? res.suggestions : [];
      renderInventoryManualPanel();
    }

    async function applyInventoryManualSuggestion(index) {
      if (!isManualInventoryMode()) return;
      const list = Array.isArray(state.layoutRun && state.layoutRun.manual && state.layoutRun.manual.suggestions)
        ? state.layoutRun.manual.suggestions
        : [];
      const s = list[Number(index)];
      if (!s || !s.placement) return;
      const p = { ...s.placement, status: "matched" };
      const nextId = (state.layoutRun.placements || []).length + 1;
      if (!Number.isFinite(Number(p.fragmentId))) p.fragmentId = nextId;
      if (!Number.isFinite(Number(p.fragmentAreaMm2))) p.fragmentAreaMm2 = Number(p.gainAreaMm2 || 0);
      state.layoutRun.placements = (state.layoutRun.placements || []).concat([p]);
      const fr = s.fragment && Array.isArray(s.fragment.points)
        ? { id: Number(p.fragmentId), points: s.fragment.points, areaMm2: Number(s.fragment.areaMm2 || p.fragmentAreaMm2 || 0) }
        : null;
      if (fr) state.layoutRun.fragments = (state.layoutRun.fragments || []).concat([fr]);
      state.layoutRun.manual = state.layoutRun.manual || { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
      state.layoutRun.manual.lastMetrics = s.metrics || null;
      updateManualStatsFromPlacements();
      renderPlacementRows(state.layoutRun.placements || []);
      renderInventoryManualPanel();
      await requestManualRecomputeFromUi();
    }

    function removeInventoryManualPlacementByIndex(index, noteText) {
      if (!isManualInventoryMode()) return false;
      const placements = Array.isArray(state.layoutRun.placements) ? state.layoutRun.placements.slice() : [];
      const idx = Number(index);
      if (!Number.isFinite(idx) || idx < 0 || idx >= placements.length) return false;
      const removed = placements[idx];
      state.layoutRun.placements = placements.filter((_, i) => i !== idx);
      const fragments = Array.isArray(state.layoutRun.fragments) ? state.layoutRun.fragments.slice() : [];
      const pid = Number(removed && removed.fragmentId || 0);
      state.layoutRun.fragments = fragments.filter((f) => Number(f && f.id || 0) !== pid);
      state.layoutRun.manual = state.layoutRun.manual || { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
      const nextSel = Math.min(idx, Math.max(0, (state.layoutRun.placements || []).length - 1));
      state.layoutRun.manual.selectedPlacementIndex = (state.layoutRun.placements || []).length ? nextSel : -1;
      state.layoutRun.manual.statusNote = noteText || "кусок удален";
      state.layoutRun.manual.lastMetrics = null;
      updateManualStatsFromPlacements();
      renderPlacementRows(state.layoutRun.placements || []);
      renderInventoryManualPanel();
      renderManualTrayIntoRoot();
      renderScene();
      void requestManualRecomputeFromUi();
      return true;
    }

    function moveInventoryManualPlacementZ(index, direction) {
      if (!isManualInventoryMode()) return false;
      const placements = Array.isArray(state.layoutRun.placements) ? state.layoutRun.placements.slice() : [];
      const idx = Number(index);
      const dir = Number(direction);
      if (!Number.isFinite(idx) || !Number.isFinite(dir) || idx < 0 || idx >= placements.length) return false;
      const targetIdx = idx + (dir > 0 ? 1 : -1);
      if (targetIdx < 0 || targetIdx >= placements.length) return false;
      const tmp = placements[idx];
      placements[idx] = placements[targetIdx];
      placements[targetIdx] = tmp;
      state.layoutRun.placements = placements;
      state.layoutRun.manual = state.layoutRun.manual || { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
      state.layoutRun.manual.selectedPlacementIndex = targetIdx;
      state.layoutRun.manual.statusNote = dir > 0 ? "кусок поднят по слою" : "кусок опущен по слою";
      state.layoutRun.manual.lastMetrics = null;
      renderPlacementRows(state.layoutRun.placements || []);
      renderInventoryManualPanel();
      renderScene();
      void requestManualRecomputeFromUi();
      return true;
    }

    function moveInventoryManualPlacementToEdge(index, where) {
      if (!isManualInventoryMode()) return false;
      const placements = Array.isArray(state.layoutRun.placements) ? state.layoutRun.placements.slice() : [];
      const idx = Number(index);
      if (!Number.isFinite(idx) || idx < 0 || idx >= placements.length) return false;
      const item = placements[idx];
      placements.splice(idx, 1);
      let targetIdx = 0;
      if (String(where || "") === "back") {
        placements.push(item);
        targetIdx = placements.length - 1;
      } else {
        placements.unshift(item);
        targetIdx = 0;
      }
      state.layoutRun.placements = placements;
      state.layoutRun.manual = state.layoutRun.manual || { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
      state.layoutRun.manual.selectedPlacementIndex = targetIdx;
      state.layoutRun.manual.statusNote = String(where || "") === "back"
        ? "кусок отправлен назад по слою"
        : "кусок поднят на передний план";
      state.layoutRun.manual.lastMetrics = null;
      renderPlacementRows(state.layoutRun.placements || []);
      renderInventoryManualPanel();
      renderScene();
      void requestManualRecomputeFromUi();
      return true;
    }

    function rotateInventoryManualPlacement(index, deltaDeg) {
      if (!isManualInventoryMode()) return false;
      const placements = Array.isArray(state.layoutRun.placements) ? state.layoutRun.placements : [];
      const idx = Number(index);
      const dd = Number(deltaDeg);
      if (!Number.isFinite(idx) || idx < 0 || idx >= placements.length || !Number.isFinite(dd) || Math.abs(dd) < 1e-9) return false;
      const pl = placements[idx];
      const contour = Array.isArray(pl && pl.alignedContour) ? pl.alignedContour : [];
      if (contour.length < 3) return false;
      const center = centroid(contour);
      const rad = (dd * Math.PI) / 180;
      const toPointObj = (q) => {
        if (Array.isArray(q) && q.length >= 2) {
          const x = Number(q[0]);
          const y = Number(q[1]);
          if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
        }
        const x = Number(q && q.x);
        const y = Number(q && q.y);
        if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
        return null;
      };
      const isPointLike = (v) => !!toPointObj(v);
      const rotateOne = (list) => {
        if (!Array.isArray(list)) return list;
        return list.map((q) => {
          const src = toPointObj(q) || { x: Number(q && q.x), y: Number(q && q.y) };
          const out = rotatePoints([{ x: Number(src.x), y: Number(src.y) }], rad, center);
          return (Array.isArray(out) && out[0]) ? out[0] : src;
        }).filter((q) => Number.isFinite(Number(q && q.x)) && Number.isFinite(Number(q && q.y)));
      };
      const rotatePolyOrContour = (poly) => {
        if (!Array.isArray(poly) || !poly.length) return poly;
        if (Array.isArray(poly[0]) && (poly[0].length === 0 || isPointLike(poly[0][0]))) {
          return poly.map((ring) => rotateOne(ring));
        }
        return rotateOne(poly);
      };
      const rotateMany = (multi) => Array.isArray(multi) ? multi.map((poly) => rotatePolyOrContour(poly)) : multi;
      pl.alignedContour = rotateOne(pl.alignedContour);
      pl.inZoneContour = rotateOne(pl.inZoneContour);
      pl.alignedCoreContour = rotateOne(pl.alignedCoreContour);
      pl.inZoneCoreContour = rotateOne(pl.inZoneCoreContour);
      pl.usedVisibleContour = rotateOne(pl.usedVisibleContour);
      pl.alignedCoreContours = rotateMany(pl.alignedCoreContours);
      pl.inZoneContours = rotateMany(pl.inZoneContours);
      pl.inZoneCoreContours = rotateMany(pl.inZoneCoreContours);
      pl.usedVisibleContours = rotateMany(pl.usedVisibleContours);
      const prevRot = Number(pl.alignRotationDeg || 0);
      pl.alignRotationDeg = prevRot + dd;
      const baseNap = Number.isFinite(Number(pl.napDirectionDeg)) ? Number(pl.napDirectionDeg) : Number(state.layoutRun.lastNapDirectionDeg || DEFAULT_NAP_DIRECTION_DEG);
      pl.napEffectiveDeg = baseNap + Number(pl.alignRotationDeg || 0);
      state.layoutRun.manual = state.layoutRun.manual || { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
      state.layoutRun.manual.selectedPlacementIndex = idx;
      state.layoutRun.manual.statusNote = "кусок повернут";
      state.layoutRun.manual.lastMetrics = null;
      renderPlacementRows(state.layoutRun.placements || []);
      renderInventoryManualPanel();
      renderScene();
      void requestManualRecomputeFromUi();
      return true;
    }

    function pushManualUndoCommand(cmd) {
      if (!state.layoutRun) return;
      if (!Array.isArray(state.layoutRun.manualUndoStack)) state.layoutRun.manualUndoStack = [];
      state.layoutRun.manualUndoStack.push(cmd);
      state.layoutRun.manualRedoStack = [];
    }

    function applyManualMoveGeom(idx, geom) {
      const placements = Array.isArray(state.layoutRun && state.layoutRun.placements) ? state.layoutRun.placements : [];
      const pl = Number.isFinite(idx) && idx >= 0 ? placements[idx] : null;
      if (!pl || !geom) return;
      pl.alignedContour = Array.isArray(geom.alignedContour) ? geom.alignedContour.map((p) => ({ ...p })) : pl.alignedContour;
      if (Array.isArray(geom.inZoneContour)) pl.inZoneContour = geom.inZoneContour.map((p) => ({ ...p }));
      if (Array.isArray(geom.inZoneCoreContour)) pl.inZoneCoreContour = geom.inZoneCoreContour.map((p) => ({ ...p }));
    }

    async function undoInventoryManualPlacement() {
      if (!isManualInventoryMode()) return;
      const undoStack = Array.isArray(state.layoutRun && state.layoutRun.manualUndoStack) ? state.layoutRun.manualUndoStack : [];
      if (undoStack.length > 0) {
        const cmd = undoStack.pop();
        if (!Array.isArray(state.layoutRun.manualRedoStack)) state.layoutRun.manualRedoStack = [];
        state.layoutRun.manualRedoStack.push(cmd);
        if (cmd.type === "move-placement") {
          applyManualMoveGeom(cmd.idx, cmd.before);
          markLayoutDirty();
          renderScene();
        } else if (cmd.type === "remove-placement") {
          state.layoutRun.placements.splice(cmd.idx, 0, cmd.placement);
          markLayoutDirty();
          renderScene();
          renderPropertyEditor();
        }
        return;
      }
      // fallback: remove last placement
      const placements = Array.isArray(state.layoutRun.placements) ? state.layoutRun.placements.slice() : [];
      if (!placements.length) return;
      removeInventoryManualPlacementByIndex(placements.length - 1, "последний кусок удален (Undo)");
    }

    function redoInventoryManualPlacement() {
      if (!isManualInventoryMode()) return;
      const redoStack = Array.isArray(state.layoutRun && state.layoutRun.manualRedoStack) ? state.layoutRun.manualRedoStack : [];
      if (!redoStack.length) return;
      const cmd = redoStack.pop();
      if (!Array.isArray(state.layoutRun.manualUndoStack)) state.layoutRun.manualUndoStack = [];
      state.layoutRun.manualUndoStack.push(cmd);
      if (cmd.type === "move-placement") {
        applyManualMoveGeom(cmd.idx, cmd.after);
        markLayoutDirty();
        renderScene();
      } else if (cmd.type === "remove-placement") {
        state.layoutRun.placements.splice(cmd.idx, 1);
        markLayoutDirty();
        renderScene();
        renderPropertyEditor();
      }
    }

    function buildManualTraySections(items) {
      const arr = Array.isArray(items) ? items.slice() : [];
      const sizesCm = arr
        .map((c) => getManualCandidateSizeCm(c))
        .filter((a) => Number.isFinite(a))
        .sort((a, b) => a - b);
      const pickQ = (q) => {
        if (!sizesCm.length) return 0;
        const pos = Math.max(0, Math.min(1, q)) * (sizesCm.length - 1);
        const lo = Math.floor(pos);
        const hi = Math.ceil(pos);
        if (lo === hi) return sizesCm[lo];
        const t = pos - lo;
        return sizesCm[lo] * (1 - t) + sizesCm[hi] * t;
      };
      const q33 = pickQ(0.33);
      const q66 = pickQ(0.66);
      const large = [];
      const medium = [];
      const small = [];
      for (const c of arr) {
        const s = Number(getManualCandidateSizeCm(c) || 0);
        if (s >= q66) large.push(c);
        else if (s <= q33) small.push(c);
        else medium.push(c);
      }
      return { large, medium, small, q33Cm: q33, q66Cm: q66 };
    }

    function getManualTrayThumbSvg(candidate, referenceSizeMm) {
      const pts = toPointList(parseScrapContourPoints(candidate && candidate.scrapContour));
      if (pts.length < 3) {
        return '<svg class="manual-piece-thumb" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"></svg>';
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      const vw = 100;
      const vh = 100;
      const pad = 4;
      const localMax = Math.max(w, h);
      // Keep previews visually large; only lightly normalize very small pieces inside section.
      const refRaw = Number(referenceSizeMm || 0);
      const ref = Math.max(1, Number.isFinite(refRaw) && refRaw > 0 ? Math.min(refRaw, localMax * 1.15) : localMax);
      const sx = (vw - pad * 2) / ref;
      const sy = (vh - pad * 2) / ref;
      const s = Math.max(0.0001, Math.min(sx, sy));
      const ox = pad + (vw - pad * 2 - w * s) * 0.5;
      const oy = pad + (vh - pad * 2 - h * s) * 0.5;
      const d = pts.map((p, i) => {
        const x = (ox + (p.x - minX) * s).toFixed(2);
        const y = (vh - (oy + (p.y - minY) * s)).toFixed(2);
        return `${i === 0 ? "M" : "L"}${x} ${y}`;
      }).join(" ") + " Z";
      return `<svg class="manual-piece-thumb" viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="rgba(0,0,0,0.03)" stroke="#444" stroke-width="1"/></svg>`;
    }

    function getManualCandidateSizeCm(candidate) {
      const pts = toPointList(parseScrapContourPoints(candidate && candidate.scrapContour));
      if (pts.length >= 3) {
        const bb = polygonBBox(pts);
        if (bb) {
          const maxMm = Math.max(Number(bb.width || 0), Number(bb.height || 0));
          if (Number.isFinite(maxMm) && maxMm > 0) return maxMm / 10;
        }
      }
      const area = Number(candidate && candidate.areaMm2 || 0);
      if (!Number.isFinite(area) || area <= 0) return 0;
      // Fallback: equivalent square side in cm.
      return Math.sqrt(area) / 10;
    }

    function formatSectionRangeCm(kind, sections) {
      const q33 = Number(sections && sections.q33Cm || 0);
      const q66 = Number(sections && sections.q66Cm || 0);
      const unitCm = t("unit_cm", null, "cm");
      if (!(q33 > 0) || !(q66 > 0)) return "(\\u2014)";
      if (kind === "small") return `(<=${q33.toFixed(1)} ${unitCm})`;
      if (kind === "large") return `(>=${q66.toFixed(1)} ${unitCm})`;
      return `(${q33.toFixed(1)}-${q66.toFixed(1)} ${unitCm})`;
    }

    function renderManualTrayIntoRoot() {
      const host = byId("manualTrayDock");
      if (!host) return;
      // Ensure fixed structure: resize handle + content div
      if (!byId("manualTrayResizeHandle")) {
        const h = document.createElement("div");
        h.className = "manual-tray-resize-handle";
        h.id = "manualTrayResizeHandle";
        host.insertBefore(h, host.firstChild);
        initManualTrayResizeHandle(h, host);
      }
      if (!byId("manualTrayContent")) {
        const c = document.createElement("div");
        c.id = "manualTrayContent";
        host.appendChild(c);
      }
      if (!isManualInventoryMode()) {
        host.classList.remove("active");
        const c = byId("manualTrayContent");
        if (c) c.innerHTML = "";
        host.style.left = "10px";
        host.style.right = "10px";
        host.style.bottom = "10px";
        host.style.top = "auto";
        host.style.width = "auto";
        return;
      }
      host.classList.add("active");
      const poolAll = Array.isArray(state.layoutRun && state.layoutRun.candidatePool) ? state.layoutRun.candidatePool : [];
      const usedCounts = new Map();
      const placements = Array.isArray(state.layoutRun && state.layoutRun.placements) ? state.layoutRun.placements : [];
      for (const p of placements) {
        if (!p || String(p.status || "") !== "matched") continue;
        const tag = String(p.inventoryTag || p.id || "").trim();
        if (!tag) continue;
        usedCounts.set(tag, Number(usedCounts.get(tag) || 0) + 1);
      }
      const consumed = new Map();
      const pool = [];
      for (const c of poolAll) {
        const tag = String(c && (c.inventoryTag || c.id) || "").trim();
        if (!tag) {
          pool.push(c);
          continue;
        }
        const used = Number(usedCounts.get(tag) || 0);
        const seen = Number(consumed.get(tag) || 0);
        if (seen < used) {
          consumed.set(tag, seen + 1);
          continue;
        }
        pool.push(c);
      }
      if (!pool.length) {
        host.innerHTML = "";
        return;
      }
      const sections = buildManualTraySections(pool);
      const maxSectionSizeMm = (list) => {
        const arr = Array.isArray(list) ? list : [];
        let maxMm = 0;
        for (const c of arr) {
          const mm = Number(getManualCandidateSizeCm(c) || 0) * 10;
          if (Number.isFinite(mm) && mm > maxMm) maxMm = mm;
        }
        return maxMm > 0 ? maxMm : 1;
      };
      const sectionScaleMm = {
        large: maxSectionSizeMm(sections.large),
        medium: maxSectionSizeMm(sections.medium),
        small: maxSectionSizeMm(sections.small)
      };
      state.layoutRun.manual = state.layoutRun.manual || { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
      const selectedTag = String(state.layoutRun.manual.selectedCandidateTag || "");
      const selectedPlacementIndex = Number(state.layoutRun.manual.selectedPlacementIndex);
      const mm = state.layoutRun.manual && state.layoutRun.manual.lastMetrics ? state.layoutRun.manual.lastMetrics : null;
      const placedCount = Array.isArray(state.layoutRun && state.layoutRun.placements)
        ? state.layoutRun.placements.filter((p) => Array.isArray(p && p.alignedContour) && p.alignedContour.length >= 3).length
        : 0;
      const zoneForMetrics = getManualZoneForPlacements(state.layoutRun && state.layoutRun.placements) || getManualZone();
      const zoneAreaForMetrics = zoneForMetrics ? Math.max(0, Number(polygonArea(zoneForMetrics.points || []) || 0)) : 0;
      const metricsLine = mm
        ? (
          t(
            "manual_metrics_line",
            {
              pieces: placedCount,
              coverage: Number(mm.coveragePct || 0).toFixed(2),
              gain: Number(mm.gainAreaMm2 || 0).toFixed(1),
              overlap: Number(mm.overlapAreaMm2 || 0).toFixed(1),
              outside: Number(mm.outsideAreaMm2 || 0).toFixed(1),
              util: (Number(mm.utilizationLocal || 0) * 100).toFixed(2),
              zoneArea: zoneAreaForMetrics.toFixed(1),
              status: String(mm.status || "ok"),
              reason: mm.statusReason ? ` (${String(mm.statusReason)})` : ""
            },
            `Оценка: кусков=${placedCount} | покрытие=${Number(mm.coveragePct || 0).toFixed(2)}% | полезно=${Number(mm.gainAreaMm2 || 0).toFixed(1)} мм² | зона=${zoneAreaForMetrics.toFixed(1)} мм² | перекрытие=${Number(mm.overlapAreaMm2 || 0).toFixed(1)} мм² | outside=${Number(mm.outsideAreaMm2 || 0).toFixed(1)} мм² | util=${(Number(mm.utilizationLocal || 0) * 100).toFixed(2)}%`
          )
          + ((String(mm.status || "ok") !== "ok")
            ? ` | status=${String(mm.status || "")}${mm.statusReason ? ` (${String(mm.statusReason)})` : ""}`
            : "")
        )
        : t("manual_metrics_prompt", { pieces: placedCount }, `Оценка: кусков=${placedCount} | нажмите "Оценить"`);
      const selectedPlacement = Number.isFinite(selectedPlacementIndex) && selectedPlacementIndex >= 0 && selectedPlacementIndex < placements.length
        ? placements[selectedPlacementIndex]
        : null;
      const selectedInfoLine = selectedPlacement
        ? `Выбран: ${String(selectedPlacement.inventoryTag || selectedPlacement.scrapPieceId || `#${selectedPlacementIndex + 1}`)} | угол=${Number(selectedPlacement.alignRotationDeg || 0).toFixed(1)}° | слой=${selectedPlacementIndex + 1}/${placements.length}`
        : "Выбран: нет";
      const seamDbg = state.layoutRun && state.layoutRun.manual && state.layoutRun.manual.lastSeamDebug
        ? state.layoutRun.manual.lastSeamDebug
        : null;
      const seamRejectSummary = (() => {
        const rej = seamDbg && seamDbg.rejectReasons && typeof seamDbg.rejectReasons === "object"
          ? seamDbg.rejectReasons
          : null;
        if (!rej) return "";
        const order = ["same_owner", "disjoint", "point_touch_only", "shared_border_too_short", "not_collinear"];
        const parts = [];
        for (const key of order) {
          const count = Number(rej[key] || 0);
          if (count > 0) parts.push(`${key}=${count}`);
        }
        return parts.length ? ` | reject=${parts.join(",")}` : "";
      })();
      const seamDebugLine = seamDbg
        ? `Швы: built=${Number(seamDbg.seamsCount || 0)} | rendered=${Number(seamDbg.renderedSeams || 0)} | seamContours=${Number(seamDbg.seamContoursCount || 0)} | frags=${Number(seamDbg.fragmentsCount || 0)} | pairs=${Number(seamDbg.candidatePairs || 0)} | source=${String(seamDbg.source || "unknown")} | layer=${(state.layers && state.layers.visibleCore) ? "on" : "off"} | selectedZone=${Number(seamDbg.selectedZoneId || 0)} | recomputeZone=${Number(seamDbg.recomputeZoneId || 0)} | zoneByPlacements=${Number(seamDbg.zoneByPlacementsId || 0)}${seamDbg.usedZoneFallback ? " | rebind=1" : ""}${seamRejectSummary}${(Number(seamDbg.fragmentsCount||0)<2 || Number(seamDbg.candidatePairs||0)<1) ? " | no_seams_reason=not_enough_fragments_or_pairs" : ""}`
        : "";
      const seamFlowSummary = (() => {
        const s = seamDbg && seamDbg.fragmentFlowSummary && typeof seamDbg.fragmentFlowSummary === "object"
          ? seamDbg.fragmentFlowSummary
          : null;
        if (!s) return "";
        const reasonsObj = s.byReason && typeof s.byReason === "object" ? s.byReason : {};
        const reasonKeys = Object.keys(reasonsObj).filter((k) => Number(reasonsObj[k] || 0) > 0).sort();
        const reasons = reasonKeys.map((k) => `${k}=${Number(reasonsObj[k] || 0)}`).join(",");
        return `coreFlow: items=${Number(s.items || 0)} | zeroVisible=${Number(s.zeroVisible || 0)}${reasons ? ` | reasons=${reasons}` : ""}`;
      })();
      const seamExcludedSummary = (() => {
        const diagnostics = state.layoutRun && state.layoutRun.manual && state.layoutRun.manual.lastRecomputeDiagnostics
          ? state.layoutRun.manual.lastRecomputeDiagnostics
          : null;
        const placementsAll = Array.isArray(state.layoutRun && state.layoutRun.placements) ? state.layoutRun.placements : [];
        const flow = diagnostics && Array.isArray(diagnostics.seamFragmentFlow) ? diagnostics.seamFragmentFlow : [];
        if (!placementsAll.length) return "";
        const excluded = [];
        const flowByKey = new Map();
        for (const it of flow) {
          const key = `${String(it && it.pieceId || "")}|${String(it && it.inventoryTag || "")}|${Number(it && it.placementIndex || -1)}`;
          flowByKey.set(key, it);
        }
        for (let i = 0; i < placementsAll.length; i += 1) {
          const p = placementsAll[i] || {};
          const key = `${String(p.scrapPieceId || "")}|${String(p.inventoryTag || "")}|${i}`;
          const tag = String(p.inventoryTag || p.scrapPieceId || `#${i + 1}`);
          const st = String(p.status || "");
          const flowRec = flowByKey.get(key) || null;
          if (st !== "matched") {
            excluded.push(`${tag}:status=${st || "unknown"}`);
            continue;
          }
          if (!flowRec) {
            excluded.push(`${tag}:missing_in_core_flow`);
            continue;
          }
          const added = Number(flowRec.fragmentsAdded || 0);
          const reason = String(flowRec.droppedReason || "");
          if (added <= 0) {
            excluded.push(`${tag}:${reason || "no_fragment_after_cleanup_or_thresholds"}`);
          }
        }
        return excluded.length ? `excluded(${excluded.length}): ${excluded.join(" | ")}` : "";
      })();
      const trayOpen = (state.layoutRun.manual.trayOpen && typeof state.layoutRun.manual.trayOpen === "object")
        ? state.layoutRun.manual.trayOpen
        : { large: false, medium: false, small: false, all: false };
      state.layoutRun.manual.trayOpen = trayOpen;
      const contentEl = byId("manualTrayContent") || host;
      if (manualTrayView && typeof manualTrayView.renderHtml === "function") {
        contentEl.innerHTML = manualTrayView.renderHtml({
          sections,
          trayOpen,
          debugOpen: !!(state.layoutRun.manual && state.layoutRun.manual.debugOpen),
          selectedTag,
          metricsLine,
          selectedInfoLine,
          seamDebugLine,
          seamFlowSummary,
          seamExcludedSummary,
          rotateStepDeg: Math.max(1, Math.round(Number((state.layoutRun && state.layoutRun.manual && state.layoutRun.manual.rotateStepDeg) || 5))),
          getThumbSvg: (c, sectionKey) => getManualTrayThumbSvg(c, sectionScaleMm[String(sectionKey || "")] || 0),
          formatSectionRangeCm: (kind, sectionsInput) => formatSectionRangeCm(kind, sectionsInput),
          noDataHtml: `<div class="tree-empty">${t("no_data", null, "-")}</div>`
        });
      } else {
        contentEl.innerHTML = '';
      }
      contentEl.querySelectorAll("button[data-manual-toolbar]").forEach((btn) => {
        btn.onclick = async () => {
          const action = String(btn.getAttribute("data-manual-toolbar") || "");
          try {
            if (action === "recompute") {
              await requestManualRecomputeFromUi();
              return;
            }
            if (action === "apply") {
              await applyInventoryManualNow();
              return;
            }
            const selIdx = Number(state.layoutRun && state.layoutRun.manual && state.layoutRun.manual.selectedPlacementIndex);
            const rotStep = Math.max(1, Math.round(Number((state.layoutRun && state.layoutRun.manual && state.layoutRun.manual.rotateStepDeg) || 5)));
            if (!Number.isFinite(selIdx) || selIdx < 0) return;
            if (action === "rotate-left") {
              rotateInventoryManualPlacement(selIdx, -rotStep);
              return;
            }
            if (action === "rotate-right") {
              rotateInventoryManualPlacement(selIdx, rotStep);
              return;
            }
            if (action === "z-up") {
              moveInventoryManualPlacementZ(selIdx, -1);
              return;
            }
            if (action === "z-down") {
              moveInventoryManualPlacementZ(selIdx, +1);
              return;
            }
            if (action === "z-front") {
              moveInventoryManualPlacementToEdge(selIdx, "front");
              return;
            }
            if (action === "z-back") {
              moveInventoryManualPlacementToEdge(selIdx, "back");
              return;
            }
            if (action === "rotate-step-plus") {
              state.layoutRun.manual = state.layoutRun.manual || { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
              state.layoutRun.manual.rotateStepDeg = Math.min(90, rotStep + 1);
              renderManualTrayIntoRoot();
              return;
            }
            if (action === "rotate-step-minus") {
              state.layoutRun.manual = state.layoutRun.manual || { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
              state.layoutRun.manual.rotateStepDeg = Math.max(1, rotStep - 1);
              renderManualTrayIntoRoot();
            }
          } catch (err) {
            const manual = state.layoutRun && state.layoutRun.manual ? state.layoutRun.manual : null;
            if (manual) {
              manual.statusNote = String(err && err.message ? err.message : "manual_toolbar_action_failed");
            }
            renderInventoryManualPanel();
            renderManualTrayIntoRoot();
          }
        };
      });
      contentEl.querySelectorAll("button[data-manual-toggle]").forEach((btn) => {
        btn.onclick = () => {
          const key = String(btn.getAttribute("data-manual-toggle") || "");
          if (!key) return;
          trayOpen[key] = !trayOpen[key];
          renderManualTrayIntoRoot();
        };
      });
      contentEl.querySelectorAll("button[data-manual-debug-toggle]").forEach((btn) => {
        btn.onclick = () => {
          state.layoutRun.manual = state.layoutRun.manual || { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
          state.layoutRun.manual.debugOpen = !state.layoutRun.manual.debugOpen;
          renderManualTrayIntoRoot();
        };
      });
      contentEl.querySelectorAll("button[data-manual-piece]").forEach((btn) => {
        btn.ondragstart = (e) => {
          const tag = String(btn.getAttribute("data-manual-piece") || "");
          if (!tag || !e.dataTransfer) return;
          e.dataTransfer.setData("text/manual-piece-tag", tag);
          e.dataTransfer.effectAllowed = "copy";
        };
      });
      ensureManualTrayDragBehavior();
      ensureManualTrayDnD();
    }

    function ensureManualTrayDragBehavior() {
      if (manualTrayInteractions && typeof manualTrayInteractions.ensureDragBehavior === "function") {
        manualTrayInteractions.ensureDragBehavior();
      }
    }


    function ensureManualTrayDnD() {
      if (manualTrayInteractions && typeof manualTrayInteractions.ensureDnD === "function") {
        manualTrayInteractions.ensureDnD();
      }
    }

    function initManualTrayResizeHandle(handle, dock) {
      if (!handle || !dock) return;
      if (handle._resizeInited) return;
      handle._resizeInited = true;
      let startY = 0;
      let startHeight = 0;
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        startY = e.clientY;
        startHeight = dock.offsetHeight;
        const onMove = (ev) => {
          const dy = startY - ev.clientY;
          const newH = Math.max(80, Math.min(window.innerHeight * 0.85, startHeight + dy));
          dock.style.height = newH + "px";
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    }

    const dominantAxisAngle = (points) => window.FurLabGeom.dominantAxisAngle(points);
    const rectPointsCentered = (cx, cy, w, h) => window.FurLabGeom.rectPointsCentered(cx, cy, w, h);

    function drawNapArrow(layer, centerWorld, angleDeg, lengthMm) {
      const len = Math.max(10, Number(lengthMm || 18));
      const safeAngle = Number.isFinite(Number(angleDeg)) ? Number(angleDeg) : DEFAULT_NAP_DIRECTION_DEG;
      const a = (safeAngle * Math.PI) / 180;
      // Angle contract: 0deg from +X, clockwise, Y-down (UI/DB).
      // World space here is Y-up, so Y component must be inverted for drawing.
      const p1 = { x: centerWorld.x - Math.cos(a) * len * 0.5, y: centerWorld.y + Math.sin(a) * len * 0.5 };
      const p2 = { x: centerWorld.x + Math.cos(a) * len * 0.5, y: centerWorld.y - Math.sin(a) * len * 0.5 };
      const s1 = worldToScreen(p1);
      const s2 = worldToScreen(p2);
      layer.add(new Konva.Arrow({
        points: [s1.x, s1.y, s2.x, s2.y],
        stroke: ENGINEERING_STYLES.napArrow.stroke,
        fill: ENGINEERING_STYLES.napArrow.fill,
        pointerLength: 6,
        pointerWidth: 5,
        strokeWidth: ENGINEERING_STYLES.napArrow.strokeWidth
      }));
    }

    // Layout mode API — thin wrappers over window.FurLabLayoutModes
    function getLayoutModeTitle(mode) { const a = window.FurLabLayoutModes; return a && typeof a.getLayoutModeTitle === "function" ? a.getLayoutModeTitle(mode) : String(mode || ""); }
    function isInventoryLikeLayoutMode(mode) { const a = window.FurLabLayoutModes; return a && typeof a.isInventoryLikeLayoutMode === "function" ? !!a.isInventoryLikeLayoutMode(mode) : String(mode || "") === "inventory"; }
    function getLayoutModeCatalog() { const a = window.FurLabLayoutModes; return a && typeof a.getLayoutModeCatalog === "function" ? a.getLayoutModeCatalog() : []; }
    function getLayoutModeThumbSvg(mode, large) { const a = window.FurLabLayoutModes; return a && typeof a.getLayoutModeThumbSvg === "function" ? a.getLayoutModeThumbSvg(mode, large) : ""; }
    const layoutTypePickerApi = window.FurLabLayoutTypePicker || {};
    const layoutTypePicker = (typeof layoutTypePickerApi.createLayoutTypePicker === "function")
      ? layoutTypePickerApi.createLayoutTypePicker({
        byId,
        getLibraryMode: () => String(state.libraryPickerMode || "layouts"),
        setLibraryMode: (mode) => {
          state.libraryPickerMode = String(mode || "layouts");
        },
        getCatalog: (libraryMode) => {
          const mode = String(libraryMode || "layouts");
          if (mode === "materials") return Array.isArray(state.furMaterialsCatalog) ? state.furMaterialsCatalog : [];
          if (mode === "processing") return [];
          return getLayoutModeCatalog();
        },
        getCardHtml: (libraryMode, item) => {
          const mode = String(libraryMode || "layouts");
          if (mode === "materials") {
            const swatchSvg = buildMaterialPreviewSvgMarkup(item);
            const debugText = describeMaterialPatternDebug(item);
            return `
                <div class="layout-type-thumb material-type-thumb"><div class="material-type-swatch material-type-swatch-inline">${swatchSvg}</div></div>
                <div class="layout-type-title">${escapeHtml(String(item && item.species || item && item.name || "-"))}</div>
                <div class="layout-type-debug">${escapeHtml(debugText)}</div>
              `;
          }
          const itemMode = String(item && item.mode || "");
          return `${getLayoutModeThumbSvg(itemMode, true)}<div class="layout-type-title">${String(item && item.title || itemMode)}</div>`;
        },
        getItemKey: (libraryMode, item) => String(String(libraryMode || "layouts") === "materials" ? (item && item.id || "") : (item && item.mode || "")),
        getPreferredKey: (libraryMode) => {
          const mode = String(libraryMode || "layouts");
          if (mode === "materials") {
            if (state.pendingZoneMaterialZoneId) {
              const zone = state.zones.find((item) => Number(item && item.id || 0) === Number(state.pendingZoneMaterialZoneId || 0)) || null;
              return String(zone && zone.materialId || state.selectedMaterialId || "");
            }
            return String(state.selectedMaterialId || "");
          }
          const selectedLayout = Array.isArray(state.layouts)
            ? (state.layouts.find((x) => Number(x.id || 0) === Number(state.selectedLayoutId || 0)) || null)
            : null;
          return String((selectedLayout && selectedLayout.mode) || state.layoutMode || "");
        },
        getAddButtonLabel: (libraryMode) => String(libraryMode || "layouts") === "materials" ? "Выбрать мех" : "Выбрать"
      })
      : null;
    function openLayoutTypePicker() {
      state.libraryPickerMode = "layouts";
      state.pendingZoneMaterialZoneId = null;
      if (layoutTypePicker && typeof layoutTypePicker.open === "function") {
        layoutTypePicker.open();
        return;
      }
      byId("layoutTypeBackdrop").style.display = "flex";
    }
    function closeLayoutTypePicker() {
      state.pendingZoneMaterialZoneId = null;
      if (layoutTypePicker && typeof layoutTypePicker.close === "function") {
        layoutTypePicker.close();
        return;
      }
      byId("layoutTypeBackdrop").style.display = "none";
    }
    function addLayoutByMode(mode) {
      saveCurrentLayoutRuntimeSnapshot();
      const catalog = getLayoutModeCatalog();
      const normalizedMode = String(mode || "").trim();
      const picked = catalog.find((x) => String(x && x.mode || "") === normalizedMode);
      if (!picked) {
        byId("workspaceInfo").textContent = t("mode_pick_error", { mode: normalizedMode || "-" }, `Mode selection error: ${normalizedMode || "-"}`);
        return;
      }
      if ((!Array.isArray(state.zones) || state.zones.length === 0) && Array.isArray(state.details) && state.details.length > 0) {
        initZonesFromDetails();
      }
      const id = state.nextLayoutId++;
      const selectedZone = (Array.isArray(state.zones) ? state.zones : []).find((z) => Number(z && z.id || 0) === Number(state.selectedZoneId || 0))
        || ((Array.isArray(state.zones) ? state.zones : [])[0] || null);
      const selectedZoneId = Number(selectedZone && selectedZone.id || 0) || null;
      const selectedDetailId = Number(selectedZone && selectedZone.detailId || state.selectedDetailId || 0) || null;
      if (selectedZoneId) {
        // Intarsia layouts coexist with regular layouts on the same zone вЂ" only block if a non-intarsia layout already occupies it
        const occupiedBy = (Array.isArray(state.layouts) ? state.layouts : []).find((x) =>
          x && Number(x.boundZoneId || 0) === selectedZoneId
          && String(x.mode || "") !== "intarsia"
          && normalizedMode !== "intarsia"
        );
        if (occupiedBy) {
          const zoneName = String(selectedZone && selectedZone.name || `Зона ${selectedZoneId}`);
          const msg = byId("zoneOccupiedMessage");
          if (msg) msg.textContent = `Зона "${zoneName}" уже занята выкладкой "${String(occupiedBy.name || "-")}". Удалите её или выберите другую зону.`;
          const bd = byId("zoneOccupiedBackdrop");
          if (bd) bd.style.display = "flex";
          closeLayoutTypePicker();
          state.nextLayoutId--;
          return null;
        }
      }
      const existingDraft = (Array.isArray(state.layouts) ? state.layouts : []).find((x) =>
        x
        && !x.persistedRunId
        && String(x.mode || "") === normalizedMode
        && Number(x.boundZoneId || 0) === Number(selectedZoneId || 0)
        && Number(x.boundDetailId || 0) === Number(selectedDetailId || 0)
      );
      if (existingDraft) {
        void openLayoutEntry(existingDraft);
        byId("workspaceInfo").textContent = "Используем существующий черновик выкладки для выбранной зоны.";
        return existingDraft;
      }
      const entry = {
        id,
        mode: picked.mode,
        name: `${picked.title} ${id}`,
        boundZoneId: selectedZoneId,
        boundDetailId: selectedDetailId,
        isDirty: true
      };
      state.layouts.push(entry);
      void openLayoutEntry(entry);
      return entry;
    }
    function getSelectedLayoutEntry() {
      return Array.isArray(state.layouts)
        ? (state.layouts.find((x) => Number(x && x.id || 0) === Number(state.selectedLayoutId || 0)) || null)
        : null;
    }
    function resolveZoneById(zoneId) {
      const zid = Number(zoneId || 0);
      if (!zid) return null;
      return (Array.isArray(state.zones) ? state.zones : []).find((z) => Number(z && z.id || 0) === zid) || null;
    }
    function resolvePreferredZoneByDetail(detailId) {
      const did = Number(detailId || 0);
      if (!did) return null;
      return (Array.isArray(state.zones) ? state.zones : []).find((z) => Number(z && z.detailId || 0) === did) || null;
    }
    function ensureManualLayoutBinding(entry) {
      const e = entry && typeof entry === "object" ? entry : null;
      if (!e || String(e.mode || "") !== "inventory_manual") return null;
      let zone = resolveZoneById(e.boundZoneId) || resolveZoneById(state.selectedZoneId) || null;
      if (!zone) zone = (Array.isArray(state.zones) ? state.zones : [])[0] || null;
      if (!zone) return null;
      e.boundZoneId = Number(zone.id || 0) || null;
      e.boundDetailId = Number(zone.detailId || state.selectedDetailId || 0) || null;
      return zone;
    }
    function isLocalRuntimeLayoutMode(mode) {
      const normalizedMode = String(mode || "").trim();
      return normalizedMode === "inventory_manual" || normalizedMode === "inventory_nfp_sa" || normalizedMode === "inventory_tiling" || normalizedMode === "inventory_voronoi_sa" || normalizedMode === "longitudinal" || normalizedMode === "shifted" || normalizedMode === "transverse" || normalizedMode === "radial" || normalizedMode === "voronoi_tiles" || normalizedMode === "intarsia";
    }
    function ensureLocalRuntimeLayoutBinding(entry) {
      const e = entry && typeof entry === "object" ? entry : null;
      if (!e || !isLocalRuntimeLayoutMode(e.mode)) return null;
      if (String(e.mode || "") === "inventory_manual") return ensureManualLayoutBinding(e);
      let zone = resolveZoneById(e.boundZoneId) || resolveZoneById(state.selectedZoneId) || null;
      if (!zone) zone = (Array.isArray(state.zones) ? state.zones : [])[0] || null;
      if (!zone) return null;
      e.boundZoneId = Number(zone.id || 0) || null;
      e.boundDetailId = Number(zone.detailId || state.selectedDetailId || 0) || null;
      return zone;
    }
    function buildManualLayoutSnapshot() {
      const lr = state.layoutRun && typeof state.layoutRun === "object" ? state.layoutRun : {};
      const selectedLayout = getSelectedLayoutEntry();
      const boundZoneId = Number(selectedLayout && String(selectedLayout.mode || "") === "inventory_manual" ? selectedLayout.boundZoneId : 0) || 0;
      const boundDetailId = Number(selectedLayout && String(selectedLayout.mode || "") === "inventory_manual" ? selectedLayout.boundDetailId : 0) || 0;
      const snapshot = {
        selectedZoneId: Number(boundZoneId || lr.selectedZoneId || state.selectedZoneId || 0) || null,
        selectedDetailId: Number(boundDetailId || state.selectedDetailId || 0) || null,
        layoutRun: {
          active: !!lr.active,
          status: String(lr.status || "preview"),
          fillType: String(lr.fillType || "voronoi"),
          strategy: String(lr.strategy || "inventory_manual"),
          inventoryScenario: String(lr.inventoryScenario || "A"),
          selectedZoneId: Number(boundZoneId || lr.selectedZoneId || state.selectedZoneId || 0) || null,
          allowanceMm: (() => { const v = parseLocaleNumber(lr.allowanceMm, 12); return Number.isFinite(Number(v)) ? Number(v) : 12; })(),
          placements: Array.isArray(lr.placements) ? lr.placements : [],
          fragments: Array.isArray(lr.fragments) ? lr.fragments : [],
          previewLayers: lr.previewLayers && typeof lr.previewLayers === "object" ? lr.previewLayers : { pieceIntersections: [], visibleArea: [], seams: [] },
          splitEvents: Array.isArray(lr.splitEvents) ? lr.splitEvents : [],
          stats: lr.stats && typeof lr.stats === "object" ? lr.stats : { violations: 0, intersections: 0, uncovered: 0 },
          candidatePool: Array.isArray(lr.candidatePool) ? lr.candidatePool : [],
          lastFilters: lr.lastFilters && typeof lr.lastFilters === "object" ? lr.lastFilters : {},
          lastConstraints: lr.lastConstraints && typeof lr.lastConstraints === "object" ? lr.lastConstraints : {},
          lastAxis: String(lr.lastAxis || "y"),
          lastNapDirectionDeg: Number(lr.lastNapDirectionDeg || DEFAULT_NAP_DIRECTION_DEG),
          lastSeed: Number(lr.lastSeed || 0) || null,
          paramsSnapshot: lr.paramsSnapshot && typeof lr.paramsSnapshot === "object" ? lr.paramsSnapshot : null,
          resultStatus: String(lr.resultStatus || "ok"),
          failedReason: lr.failedReason || null,
          manual: lr.manual && typeof lr.manual === "object" ? lr.manual : {}
        }
      };
      return JSON.parse(JSON.stringify(snapshot));
    }
    function buildEmptyManualLayoutSnapshot() {
      const selectedLayout = getSelectedLayoutEntry();
      const selectedZoneId = Number(selectedLayout && selectedLayout.boundZoneId || state.selectedZoneId || 0) || null;
      const selectedDetailId = Number(selectedLayout && selectedLayout.boundDetailId || state.selectedDetailId || 0) || null;
      return {
        selectedZoneId,
        selectedDetailId,
        layoutRun: {
          active: true,
          status: "preview",
          fillType: "voronoi",
          strategy: "inventory_manual",
          inventoryScenario: "A",
          selectedZoneId,
          allowanceMm: (() => { const v = parseLocaleNumber(getCurrentManualAllowanceMm(), 12); return Number.isFinite(Number(v)) ? Number(v) : 12; })(),
          placements: [],
          fragments: [],
          previewLayers: { pieceIntersections: [], visibleArea: [], coverageHoles: [], seams: [] },
          splitEvents: [],
          stats: { violations: 0, intersections: 0, uncovered: 1 },
          candidatePool: [],
          lastFilters: {},
          lastConstraints: {},
          lastAxis: "y",
          lastNapDirectionDeg: DEFAULT_NAP_DIRECTION_DEG,
          lastSeed: null,
          paramsSnapshot: null,
          resultStatus: "ok",
          failedReason: null,
          manual: {
            suggestions: [],
            lastMetrics: null,
            selectedCandidateTag: "",
            activePiece: null,
            lastEvalContours: null,
            statusNote: "нет активного",
            selectedPlacementIndex: -1
          }
        }
      };
    }
    function buildFragmentOnlyLayoutSnapshot(mode) {
      const normalizedMode = String(mode || "").trim();
      const lr = state.layoutRun && typeof state.layoutRun === "object" ? state.layoutRun : {};
      const selectedLayout = getSelectedLayoutEntry();
      const boundZoneId = Number(
        selectedLayout
        && String(selectedLayout.mode || "") === normalizedMode
        && selectedLayout.boundZoneId
        || lr.selectedZoneId
        || state.selectedZoneId
        || 0
      ) || 0;
      const boundDetailId = Number(
        selectedLayout
        && String(selectedLayout.mode || "") === normalizedMode
        && selectedLayout.boundDetailId
        || state.selectedDetailId
        || 0
      ) || 0;
      const snapshot = {
        selectedZoneId: boundZoneId || null,
        selectedDetailId: boundDetailId || null,
        intarsiaSvgFragments: Array.isArray(state.intarsiaSvgFragments) ? state.intarsiaSvgFragments : null,
        intarsiaSvgFileName: state.intarsiaSvgFileName || null,
        layoutRun: {
          active: !!lr.active,
          status: String(lr.status || "preview"),
          fillType: String(lr.fillType || "regular"),
          strategy: String(lr.strategy || normalizedMode),
          inventoryScenario: String(lr.inventoryScenario || ""),
          selectedZoneId: boundZoneId || null,
          allowanceMm: (() => { const v = parseLocaleNumber(lr.allowanceMm, 12); return Number.isFinite(Number(v)) ? Number(v) : 12; })(),
          placements: [],
          fragments: Array.isArray(lr.fragments) ? lr.fragments : [],
          previewLayers: lr.previewLayers && typeof lr.previewLayers === "object"
            ? lr.previewLayers
            : { pieceIntersections: [], visibleArea: [], coverageHoles: [], seams: [] },
          splitEvents: Array.isArray(lr.splitEvents) ? lr.splitEvents : [],
          stats: lr.stats && typeof lr.stats === "object"
            ? lr.stats
            : { fragmentsTotal: Array.isArray(lr.fragments) ? lr.fragments.length : 0 },
          candidatePool: [],
          lastFilters: {},
          lastConstraints: {},
          lastAxis: String(lr.lastAxis || "y"),
          lastNapDirectionDeg: Number(lr.lastNapDirectionDeg || DEFAULT_NAP_DIRECTION_DEG),
          lastSeed: Number(lr.lastSeed || 0) || null,
          paramsSnapshot: lr.paramsSnapshot && typeof lr.paramsSnapshot === "object" ? lr.paramsSnapshot : null,
          resultStatus: String(lr.resultStatus || "ok"),
          failedReason: lr.failedReason || null,
          manual: {},
          _contractDiag: (selectedLayout && selectedLayout._lcmDiag) || null,
          _contractDiagMeta: (selectedLayout && selectedLayout._lcmMeta) || null
        }
      };
      return JSON.parse(JSON.stringify(snapshot));
    }
    function buildEmptyFragmentOnlyLayoutSnapshot(mode, entry) {
      const normalizedMode = String(mode || "").trim();
      const e = entry && typeof entry === "object" ? entry : getSelectedLayoutEntry();
      const selectedZoneId = Number(e && e.boundZoneId || state.selectedZoneId || 0) || null;
      const selectedDetailId = Number(e && e.boundDetailId || state.selectedDetailId || 0) || null;
      return {
        selectedZoneId,
        selectedDetailId,
        layoutRun: {
          active: false,
          status: "idle",
          fillType: "regular",
          strategy: normalizedMode,
          inventoryScenario: "",
          selectedZoneId,
          allowanceMm: (() => { const v = parseLocaleNumber(state.layoutRun && state.layoutRun.allowanceMm, 12); return Number.isFinite(Number(v)) ? Number(v) : 12; })(),
          placements: [],
          fragments: [],
          previewLayers: { pieceIntersections: [], visibleArea: [], coverageHoles: [], seams: [] },
          splitEvents: [],
          stats: { fragmentsTotal: 0 },
          candidatePool: [],
          lastFilters: {},
          lastConstraints: {},
          lastAxis: "y",
          lastNapDirectionDeg: DEFAULT_NAP_DIRECTION_DEG,
          lastSeed: null,
          paramsSnapshot: { options: { rows: 5, cols: 5, axisCount: 1, angleDeg: 45, bandStepMm: 120, shiftPercent: 50, ringCount: 4, sectorCount: 8, rotationDeg: 0, innerRadiusMm: 0, centerMode: "auto", centerX: 0, centerY: 0, gapX: 0, gapY: 0, cornerRadius: 0 } },
          resultStatus: "ok",
          failedReason: null,
          manual: {}
        }
      };
    }
    function syncFragmentOnlyControlsFromSnapshot(snapshot) {
      const options = snapshot && snapshot.layoutRun && snapshot.layoutRun.paramsSnapshot && snapshot.layoutRun.paramsSnapshot.options
        ? snapshot.layoutRun.paramsSnapshot.options
        : (snapshot && snapshot.layoutRun && snapshot.layoutRun.options ? snapshot.layoutRun.options : null);
      if (!options || typeof options !== "object") return;
      if (byId("fillRows") && Number.isFinite(Number(options.rows))) byId("fillRows").value = String(Number(options.rows));
      if (byId("fillCols") && Number.isFinite(Number(options.cols))) byId("fillCols").value = String(Number(options.cols));
      if (byId("fillAxisCount") && Number.isFinite(Number(options.axisCount))) byId("fillAxisCount").value = String(Number(options.axisCount));
      if (byId("fillBandStep") && Number.isFinite(Number(options.bandStepMm))) byId("fillBandStep").value = String(Number(options.bandStepMm));
      if (byId("fillRingCount") && Number.isFinite(Number(options.ringCount))) byId("fillRingCount").value = String(Number(options.ringCount));
      if (byId("fillSectorCount") && Number.isFinite(Number(options.sectorCount))) byId("fillSectorCount").value = String(Number(options.sectorCount));
      if (byId("fillSectorRotationDeg") && Number.isFinite(Number(options.rotationDeg))) byId("fillSectorRotationDeg").value = String(Number(options.rotationDeg));
      if (byId("fillInnerRadiusMm") && Number.isFinite(Number(options.innerRadiusMm))) byId("fillInnerRadiusMm").value = String(Number(options.innerRadiusMm));
      if (byId("fillCenterMode") && typeof options.centerMode === "string") byId("fillCenterMode").value = String(options.centerMode);
      if (byId("fillCenterX") && Number.isFinite(Number(options.centerX))) byId("fillCenterX").value = String(Number(options.centerX));
      if (byId("fillCenterY") && Number.isFinite(Number(options.centerY))) byId("fillCenterY").value = String(Number(options.centerY));
      if (byId("fillGapX") && Number.isFinite(Number(options.gapX))) byId("fillGapX").value = String(Number(options.gapX));
      if (byId("fillGapY") && Number.isFinite(Number(options.gapY))) byId("fillGapY").value = String(Number(options.gapY));
      if (byId("fillCornerRadius") && Number.isFinite(Number(options.cornerRadius))) byId("fillCornerRadius").value = String(Number(options.cornerRadius));
      if (byId("fillAngleDeg") && Number.isFinite(Number(options.angleDeg))) byId("fillAngleDeg").value = String(Number(options.angleDeg));
      if (byId("fillShiftPercent") && Number.isFinite(Number(options.shiftPercent))) byId("fillShiftPercent").value = String(Number(options.shiftPercent));
      const nr = snapshot && snapshot.layoutRun && snapshot.layoutRun.paramsSnapshot && snapshot.layoutRun.paramsSnapshot.inputs && snapshot.layoutRun.paramsSnapshot.inputs.normalizeRules;
      if (nr && typeof nr === "object") {
        if (byId("fragmentMinAlongMm") && Number.isFinite(Number(nr.fragmentMinAlongMm))) byId("fragmentMinAlongMm").value = String(Number(nr.fragmentMinAlongMm));
        if (byId("fragmentMinAcrossMm") && Number.isFinite(Number(nr.fragmentMinAcrossMm))) byId("fragmentMinAcrossMm").value = String(Number(nr.fragmentMinAcrossMm));
      }
    }
    function hasFragmentOnlySnapshotData(snapshot) {
      const frags = Array.isArray(snapshot && snapshot.layoutRun && snapshot.layoutRun.fragments)
        ? snapshot.layoutRun.fragments
        : [];
      return frags.length > 0;
    }
    const MIN_ZONE_AREA_MM2 = 1.0;

    function validateZoneGeometryClient(zone) {
      const issues = [];
      const geom = window.FurLabGeom;
      const utils = window.FurLabUtils;
      const outer = Array.isArray(zone && zone.points) ? zone.points : [];

      // 1. outer ≥ 3 точек с finite-координатами
      if (outer.length < 3 || outer.some((p) => !Number.isFinite(Number(p && p.x)) || !Number.isFinite(Number(p && p.y)))) {
        issues.push({ code: "invalid_outer_contour", message: "Контур содержит менее 3 точек или некорректные координаты", severity: "error" });
        return issues;
      }

      // 2. Площадь > min
      if (geom && typeof geom.polygonArea === "function") {
        const area = Math.abs(geom.polygonArea(outer));
        if (area < MIN_ZONE_AREA_MM2) {
          issues.push({ code: "area_too_small", message: `Площадь зоны (${area.toFixed(2)} мм²) меньше минимальной`, severity: "error" });
        }
      }

      // 3. Самопересечение outer
      if (geom && typeof geom.polygonHasSelfIntersection === "function") {
        if (geom.polygonHasSelfIntersection(outer)) {
          issues.push({ code: "self_intersection", message: "Контур самопересекается", severity: "error" });
        }
      }

      // 4. Holes внутри outer
      const holes = Array.isArray(zone.holes) ? zone.holes : [];
      if (holes.length > 0 && utils && typeof utils.pointInPolygon === "function") {
        for (let hi = 0; hi < holes.length; hi++) {
          const hole = holeContour(holes[hi]);
          if (hole.length < 3) continue;
          const allInside = hole.every((p) => utils.pointInPolygon(p, outer));
          if (!allInside) {
            issues.push({ code: "hole_outside_outer", message: `Отверстие ${hi + 1} выходит за пределы внешнего контура`, severity: "error" });
          }
        }
      }

      // Helper: point lies on a polygon edge within eps distance
      const isOnBoundary = (p, poly, eps) => {
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          const dx = b.x - a.x, dy = b.y - a.y;
          const len2 = dx * dx + dy * dy;
          const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
          if (Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) < eps) return true;
        }
        return false;
      };

      // 5. Зона внутри контура детали
      const detailBoundary = getDetailBoundaryPointsForZone(zone);
      if (detailBoundary.length >= 3 && utils && typeof utils.pointInPolygon === "function") {
        const outsideDetail = outer.some((p) => !utils.pointInPolygon(p, detailBoundary) && !isOnBoundary(p, detailBoundary, 2));
        if (outsideDetail) {
          issues.push({ code: "zone_outside_part", message: "Зона выходит за контур детали", severity: "error" });
        }
      }

      // 6. Sibling intersection — убрано: зоны с holes (remainder после cut/split) дают ложные
      // срабатывания т.к. cut-зона попадает в outer sibling но не в его holes (holes не переносятся
      // при split). Реальные overlap ловит validatePartZonePartition через partition gate.

      return issues;
    }

    function formatValidationIssues(issues) {
      if (!issues || issues.length === 0) return "";
      const msgs = {
        self_intersection: "Самопересечение контура",
        area_too_small: "Слишком маленькая площадь",
        hole_outside_outer: "Дырка вышла за контур",
        zone_outside_part: "Зона выходит за деталь",
        zone_overlap: "Пересечение с соседней зоной",
        invalid_outer_contour: "Некорректный контур"
      };
      return issues.map((i) => msgs[i.code] || i.message).join("; ");
    }

    function invalidateZoneDerivedData(zone) {
      // Mark all layouts bound to this zone (or all layouts in the same detail) as dirty
      const zoneId = zone && Number(zone.id || 0) || null;
      const detailId = zone && Number(zone.detailId || 0) || null;
      const layouts = Array.isArray(state.layouts) ? state.layouts : [];
      for (const entry of layouts) {
        if (!entry) continue;
        const bound = Number(entry.boundZoneId || 0) || null;
        const entryDetail = Number(entry.detailId || 0) || null;
        if ((zoneId && bound === zoneId) || (detailId && entryDetail === detailId)) {
          entry.isDirty = true;
        }
      }
      // Clear preview fragments so stale layout preview is not shown
      if (state.layoutRun) {
        state.layoutRun.previewLayers = { pieceIntersections: [], visibleArea: [], coverageHoles: [], seams: [] };
        if (Array.isArray(state.layoutRun.fragments)) state.layoutRun.fragments = [];
        if (state.layoutRun.status === "preview") state.layoutRun.status = "idle";
      }
    }
    function markLayoutDirty(entry, dirty = true) {
      const e = entry && typeof entry === "object" ? entry : getSelectedLayoutEntry();
      if (!e) return;
      e.isDirty = !!dirty;
    }
    let radialCenterPreviewTimer = null;
    const getZoneBounds = (pts) => window.FurLabUtils.getZoneBounds(pts);
    const getZoneCenterPoint = (z) => window.FurLabUtils.getZoneCenterPoint(z);
    function isLayoutEditEnabledInScene(entry) {
      const layout = entry && typeof entry === "object" ? entry : getSelectedLayoutEntry();
      if (!layout) return true;
      const ui = state.propertyEditorUi && typeof state.propertyEditorUi === "object" ? state.propertyEditorUi : null;
      const map = ui && ui.layoutEdit && typeof ui.layoutEdit === "object" ? ui.layoutEdit : null;
      const key = String(layout.id || "");
      if (!map || !key || !Object.prototype.hasOwnProperty.call(map, key)) return false;
      return !!map[key];
    }
    function resolveCurrentRadialZone() {
      const selectedLayout = getSelectedLayoutEntry();
      const boundZoneId = Number(selectedLayout && String(selectedLayout.mode || "") === "radial" ? selectedLayout.boundZoneId : 0) || 0;
      const runZoneId = Number(state.layoutRun && state.layoutRun.selectedZoneId || 0) || 0;
      const selectedZoneId = Number(state.selectedZoneId || 0) || 0;
      return resolveZoneById(boundZoneId) || resolveZoneById(runZoneId) || resolveZoneById(selectedZoneId) || null;
    }
    function getRadialCenterModeValue() {
      const modeFromDom = byId("fillCenterMode");
      const mode = String(
        (modeFromDom && modeFromDom.value)
        || (state.layoutRun && state.layoutRun.paramsSnapshot && state.layoutRun.paramsSnapshot.options && state.layoutRun.paramsSnapshot.options.centerMode)
        || "auto"
      );
      return mode === "manual" ? "manual" : "auto";
    }
    function syncRadialCenterFieldValues(x, y) {
      const nx = Number.isFinite(Number(x)) ? Math.round(Number(x) * 10) / 10 : 0;
      const ny = Number.isFinite(Number(y)) ? Math.round(Number(y) * 10) / 10 : 0;
      const hiddenX = byId("fillCenterX");
      const hiddenY = byId("fillCenterY");
      const visibleX = byId("layoutCenterXInput");
      const visibleY = byId("layoutCenterYInput");
      if (hiddenX) hiddenX.value = String(nx);
      if (hiddenY) hiddenY.value = String(ny);
      if (visibleX) visibleX.value = String(nx);
      if (visibleY) visibleY.value = String(ny);
      const selectedLayout = getSelectedLayoutEntry();
      if (selectedLayout && String(selectedLayout.mode || "") === "radial") {
        markLayoutDirty(selectedLayout, true);
      }
    }
    function scheduleRadialCenterPreview() {
      if (radialCenterPreviewTimer) clearTimeout(radialCenterPreviewTimer);
      radialCenterPreviewTimer = setTimeout(() => {
        radialCenterPreviewTimer = null;
        void previewFragmentOnlyLayout("radial");
      }, 180);
    }
    function setRadialManualCenter(worldPoint, options = {}) {
      const p = worldPoint && typeof worldPoint === "object" ? worldPoint : null;
      if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) return;
      const fillCenterMode = byId("fillCenterMode");
      if (fillCenterMode && String(fillCenterMode.value || "auto") !== "manual") return;
      syncRadialCenterFieldValues(Number(p.x), Number(p.y));
      const info = byId("workspaceInfo");
      if (info) info.textContent = `Радиальная: центр (${Math.round(Number(p.x) * 10) / 10}; ${Math.round(Number(p.y) * 10) / 10}) мм`;
      renderPropertyEditor();
      renderScene();
      if (options && options.preview === false) return;
      scheduleRadialCenterPreview();
    }
    function getRenderableRadialCenterHandle() {
      const selectedLayout = getSelectedLayoutEntry();
      if (!selectedLayout || String(selectedLayout.mode || "") !== "radial") return null;
      if (getRadialCenterModeValue() !== "manual") return null;
      const zone = resolveCurrentRadialZone();
      if (!zone || !Array.isArray(zone.points) || zone.points.length < 3) return null;
      const autoCenter = getZoneCenterPoint(zone);
      let centerX = Number((byId("fillCenterX") && byId("fillCenterX").value) || NaN);
      let centerY = Number((byId("fillCenterY") && byId("fillCenterY").value) || NaN);
      if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
        centerX = Number(selectedLayout && selectedLayout.runtimeSnapshot && selectedLayout.runtimeSnapshot.layoutRun && selectedLayout.runtimeSnapshot.layoutRun.paramsSnapshot && selectedLayout.runtimeSnapshot.layoutRun.paramsSnapshot.options && selectedLayout.runtimeSnapshot.layoutRun.paramsSnapshot.options.centerX);
        centerY = Number(selectedLayout && selectedLayout.runtimeSnapshot && selectedLayout.runtimeSnapshot.layoutRun && selectedLayout.runtimeSnapshot.layoutRun.paramsSnapshot && selectedLayout.runtimeSnapshot.layoutRun.paramsSnapshot.options && selectedLayout.runtimeSnapshot.layoutRun.paramsSnapshot.options.centerY);
      }
      if ((!Number.isFinite(centerX) || !Number.isFinite(centerY)) && autoCenter) {
        centerX = autoCenter.x;
        centerY = autoCenter.y;
      }
      if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return null;
        return {
          zone,
          point: { x: centerX, y: centerY },
          editable: isLayoutEditEnabledInScene(selectedLayout)
      };
    }
    function saveCurrentManualRuntimeSnapshot() {
      const current = getSelectedLayoutEntry();
      if (!current || String(current.mode || "") !== "inventory_manual") return;
      ensureManualLayoutBinding(current);
      current.runtimeSnapshot = buildManualLayoutSnapshot();
    }
    function readFragmentOptionsFromDom() {
      const g = (id, fallback) => { const el = byId(id); return el ? Number(el.value) : fallback; };
      const s = (id, fallback) => { const el = byId(id); return el ? String(el.value) : fallback; };
      return {
        rows: g("fillRows", 5),
        cols: g("fillCols", 5),
        axisCount: g("fillAxisCount", 1),
        angleDeg: g("fillAngleDeg", 45),
        bandStepMm: g("fillBandStep", 120),
        shiftPercent: g("fillShiftPercent", 50),
        ringCount: g("fillRingCount", 4),
        sectorCount: g("fillSectorCount", 8),
        rotationDeg: g("fillSectorRotationDeg", 0),
        innerRadiusMm: g("fillInnerRadiusMm", 0),
        centerMode: s("fillCenterMode", "auto"),
        centerX: g("fillCenterX", 0),
        centerY: g("fillCenterY", 0),
        gapX: g("fillGapX", 0),
        gapY: g("fillGapY", 0),
        cornerRadius: g("fillCornerRadius", 0)
      };
    }
    function saveCurrentLayoutRuntimeSnapshot() {
      const current = getSelectedLayoutEntry();
      if (!current || !isLocalRuntimeLayoutMode(current.mode)) return;
      ensureLocalRuntimeLayoutBinding(current);
      if (String(current.mode || "") === "inventory_manual") {
        current.runtimeSnapshot = buildManualLayoutSnapshot();
        return;
      }
      if (String(current.mode || "") === "inventory_nfp_sa" || String(current.mode || "") === "inventory_tiling" || String(current.mode || "") === "inventory_voronoi_sa") {
        const snap = buildFragmentOnlyLayoutSnapshot(String(current.mode || ""));
        snap.layoutRun.placements = Array.isArray(state.layoutRun && state.layoutRun.placements) ? state.layoutRun.placements : [];
        current.runtimeSnapshot = snap;
        return;
      }
      if (isFragmentOnlyLayoutMode(current.mode)) {
        if (!state.layoutRun) state.layoutRun = {};
        if (!state.layoutRun.paramsSnapshot || typeof state.layoutRun.paramsSnapshot !== "object") {
          state.layoutRun.paramsSnapshot = {};
        }
        state.layoutRun.paramsSnapshot.options = readFragmentOptionsFromDom();
        current.runtimeSnapshot = buildFragmentOnlyLayoutSnapshot(String(current.mode || ""));
      }
      if (isIntarsiaLayoutMode(current.mode)) {
        current.runtimeSnapshot = buildFragmentOnlyLayoutSnapshot("intarsia");
      }
    }
    function clearActiveLayoutRuntime() {
      const currentMode = String(state.layoutMode || "").trim();
      const empty = currentMode === "inventory_manual"
        ? buildEmptyManualLayoutSnapshot()
        : buildEmptyFragmentOnlyLayoutSnapshot(currentMode, null);
      state.layoutRun = {
        ...state.layoutRun,
        ...(empty && empty.layoutRun && typeof empty.layoutRun === "object" ? empty.layoutRun : {})
      };
      state.layoutRun.active = false;
      state.layoutRun.status = "idle";
      state.layoutRun.fragments = [];
      state.layoutRun.placements = [];
      state.layoutRun.candidatePool = [];
      state.layoutRun.splitEvents = [];
      state.layoutRun.topChoicesByFragment = {};
      state.layoutRun.selectedPlacementFragmentId = null;
      state.layoutRun.previewLayers = { pieceIntersections: [], visibleArea: [], coverageHoles: [], seams: [] };
      state.layoutRun.manual = {
        suggestions: [],
        lastMetrics: null,
        selectedCandidateTag: "",
        activePiece: null,
        lastEvalContours: null,
        statusNote: "",
        selectedPlacementIndex: -1
      };
      state.selectedFragmentId = null;
      renderPlacementRows([]);
      renderSplitEvents([]);
    }
    function applyManualLayoutSnapshot(snapshot) {
      const snap = snapshot && typeof snapshot === "object" ? snapshot : buildEmptyManualLayoutSnapshot();
      const base = state.layoutRun && typeof state.layoutRun === "object" ? state.layoutRun : {};
      const nextLayoutRunRaw = snap.layoutRun && typeof snap.layoutRun === "object" ? snap.layoutRun : {};
      // Preserve existing placements if incoming snapshot has none (avoids wiping on re-open)
      const _incomingPlacements = Array.isArray(nextLayoutRunRaw.placements) ? nextLayoutRunRaw.placements : null;
      const _basePlacements = Array.isArray(base.placements) ? base.placements : [];
      state.layoutRun = {
        ...base,
        ...nextLayoutRunRaw,
        placements: (_incomingPlacements && _incomingPlacements.length > 0) ? _incomingPlacements : _basePlacements,
        manual: {
          ...(base.manual && typeof base.manual === "object" ? base.manual : {}),
          ...(nextLayoutRunRaw.manual && typeof nextLayoutRunRaw.manual === "object" ? nextLayoutRunRaw.manual : {})
        }
      };
      const zoneId = Number(snap.selectedZoneId || state.layoutRun.selectedZoneId || 0);
      if (zoneId > 0) state.selectedZoneId = zoneId;
      const detailId = Number(snap.selectedDetailId || 0);
      if (detailId > 0) state.selectedDetailId = detailId;
      const selectedLayout = getSelectedLayoutEntry();
      if (selectedLayout && String(selectedLayout.mode || "") === "inventory_manual") {
        if (zoneId > 0) selectedLayout.boundZoneId = zoneId;
        if (detailId > 0) selectedLayout.boundDetailId = detailId;
      }
      if (!Array.isArray(state.layoutRun.placements)) state.layoutRun.placements = [];
      if (!Array.isArray(state.layoutRun.fragments)) state.layoutRun.fragments = [];
      if (!state.layoutRun.previewLayers || typeof state.layoutRun.previewLayers !== "object") {
        state.layoutRun.previewLayers = { pieceIntersections: [], visibleArea: [], coverageHoles: [], seams: [] };
      }
      if (!Array.isArray(state.layoutRun.previewLayers.seams)) state.layoutRun.previewLayers.seams = [];
      if (!Array.isArray(state.layoutRun.candidatePool)) state.layoutRun.candidatePool = [];
      // Ensure contour layers are on вЂ" same as the layout worker does at line ~9018
      state.layers.pfullZ = true;
      state.layers.pcoreZ = true;
      const _pfullChk = byId("layerPfullZ"); if (_pfullChk) _pfullChk.checked = true;
      const _pcoreChk = byId("layerPcoreZ"); if (_pcoreChk) _pcoreChk.checked = true;
      // Recompute eroded core contours with current seamMm (snapshot may have been saved with seamMm=0)
      void (async () => {
        try { await ensureManualPlacementsCoreContours(); } catch (_) {}
        renderScene();
      })();
      renderPlacementRows(state.layoutRun.placements || []);
      renderSplitEvents(state.layoutRun.splitEvents || []);
      renderInventoryManualPanel();
      // Auto-fetch candidates when pool is empty on layout select
      const _poolEmpty = state.layoutRun.candidatePool.length === 0;
      const _layoutActive = state.layoutRun.active === true || Array.isArray(state.layoutRun.placements) && state.layoutRun.placements.length > 0;
      if (_poolEmpty && _layoutActive) {
        void (async () => {
          try {
            const zone = state.zones.find((z) => Number(z && z.id) === Number(state.layoutRun.selectedZoneId || state.selectedZoneId));
            if (!zone || !Array.isArray(zone.points) || zone.points.length < 3) return;
            const filters = state.layoutRun.lastFilters && typeof state.layoutRun.lastFilters === "object" ? state.layoutRun.lastFilters : {};
            const res = await api("/api/inventory/candidates", "POST", {
              zone: { id: zone.id, points: zone.points || [], holes: Array.isArray(zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [] },
              napDirectionDeg: state.layoutRun.lastNapDirectionDeg || null,
              napToleranceDeg: 45,
              onlyAvailable: true,
              includeScrapContour: true,
              materialId: filters.materialId || undefined,
              maxCandidates: 300
            });
            if (res && res.ok && Array.isArray(res.items)) {
              state.layoutRun.candidatePool = res.items;
              renderInventoryManualPanel();
            }
          } catch (_) {}
        })();
      }
    }
    function applyFragmentOnlyLayoutSnapshot(mode, snapshot, entry) {
      const normalizedMode = String(mode || "").trim();
      const snap = snapshot && typeof snapshot === "object"
        ? snapshot
        : buildEmptyFragmentOnlyLayoutSnapshot(normalizedMode, entry);
      const base = state.layoutRun && typeof state.layoutRun === "object" ? state.layoutRun : {};
      const nextLayoutRunRaw = snap.layoutRun && typeof snap.layoutRun === "object" ? snap.layoutRun : {};
      const _restoredPlacements = (normalizedMode === "inventory_nfp_sa" || normalizedMode === "inventory_tiling" || normalizedMode === "inventory_voronoi_sa") && Array.isArray(nextLayoutRunRaw.placements)
        ? nextLayoutRunRaw.placements
        : [];
      state.layoutRun = {
        ...base,
        ...nextLayoutRunRaw,
        strategy: normalizedMode,
        fillType: nextLayoutRunRaw.fillType || "regular",
        placements: _restoredPlacements,
        candidatePool: [],
        manual: {}
      };
      // Интарсия — отдельный режим: не переносим её active=true в другие раскладки
      if (normalizedMode !== "intarsia" && !nextLayoutRunRaw.active) {
        state.layoutRun.active = false;
      }
      // Restore contract diag into entry so selectLayoutEntry can show it in LCM monitor
      if (entry && nextLayoutRunRaw._contractDiag) {
        entry._lcmDiag = nextLayoutRunRaw._contractDiag;
        entry._lcmMeta = nextLayoutRunRaw._contractDiagMeta || null;
      }
      if (snap.intarsiaSvgFragments !== undefined) {
        state.intarsiaSvgFragments = Array.isArray(snap.intarsiaSvgFragments) ? snap.intarsiaSvgFragments : null;
        if (Array.isArray(state.intarsiaSvgFragments) && state.intarsiaSvgFragments.length > 0) {
          state.layoutRun.fillType = "import_svg";
        }
      }
      if (snap.intarsiaSvgFileName !== undefined) {
        state.intarsiaSvgFileName = snap.intarsiaSvgFileName || null;
      }
      const zoneId = Number(snap.selectedZoneId || state.layoutRun.selectedZoneId || 0);
      if (zoneId > 0) state.selectedZoneId = zoneId;
      const detailId = Number(snap.selectedDetailId || 0);
      if (detailId > 0) state.selectedDetailId = detailId;
      const selectedLayout = entry && typeof entry === "object" ? entry : getSelectedLayoutEntry();
      if (selectedLayout && String(selectedLayout.mode || "") === normalizedMode) {
        if (zoneId > 0) selectedLayout.boundZoneId = zoneId;
        if (detailId > 0) selectedLayout.boundDetailId = detailId;
      }
      syncFragmentOnlyControlsFromSnapshot(snap);
      // Sync fillGridMode for intarsia
      if (normalizedMode === "intarsia") {
        // Restore intarsiaSvgFragments from layoutRun.fragments if not in snapshot (legacy snapshots)
        if (!Array.isArray(state.intarsiaSvgFragments) || !state.intarsiaSvgFragments.length) {
          const frags = Array.isArray(state.layoutRun.fragments) ? state.layoutRun.fragments : [];
          if (frags.length > 0) {
            state.intarsiaSvgFragments = frags.map((f) => ({ id: f.id, points: Array.isArray(f.points) ? f.points.slice() : [] }));
            state.layoutRun.fillType = "import_svg";
            if (!state.intarsiaSvgFileName) state.intarsiaSvgFileName = "импортировано";
          }
        }
        // Force fillType if fragments exist
        if (Array.isArray(state.intarsiaSvgFragments) && state.intarsiaSvgFragments.length > 0) {
          state.layoutRun.fillType = "import_svg";
        }
        const modeEl = byId("fillGridMode");
        if (modeEl) {
          modeEl.value = state.layoutRun.fillType === "import_svg" ? "import_svg" : "grid";
          syncGridModeUi && syncGridModeUi();
        }
      }
      if (!Array.isArray(state.layoutRun.fragments)) state.layoutRun.fragments = [];
      if (!state.layoutRun.previewLayers || typeof state.layoutRun.previewLayers !== "object") {
        state.layoutRun.previewLayers = { pieceIntersections: [], visibleArea: [], coverageHoles: [], seams: [] };
      }
      if (!Array.isArray(state.layoutRun.previewLayers.seams)) state.layoutRun.previewLayers.seams = [];
      renderPlacementRows([]);
      renderSplitEvents(state.layoutRun.splitEvents || []);
    }
    async function saveLayoutEntry(entry) {
      const e = entry && typeof entry === "object" ? entry : null;
      if (!e) return { ok: false, error: "layout_entry_required" };
      saveCurrentLayoutRuntimeSnapshot();
      if (isIntarsiaLayoutMode(e.mode)) {
        const payload = {
          id: e.persistedRunId || null,
          name: String(e.name || "Интарсия"),
          mode: "intarsia",
          selectedZoneId: Number(e.boundZoneId || state.layoutRun && state.layoutRun.selectedZoneId || state.selectedZoneId || 0) || null,
          snapshot: buildFragmentOnlyLayoutSnapshot("intarsia")
        };
        const res = await api("/api/layout/manual/runs/save", "POST", payload);
        if (res && res.ok && res.item) {
          e.persistedRunId = String(res.item.id || "");
          e.persistedAt = Number(res.item.updatedAt || Date.now());
          e.runtimeSnapshot = JSON.parse(JSON.stringify(payload.snapshot));
          e.isDirty = false;
          byId("workspaceInfo").textContent = `Выкладка сохранена (${e.name || "-"})`;
          renderDetailZoneTree();
          renderPropertyEditor();
        } else {
          byId("workspaceInfo").textContent = `Ошибка сохранения: ${String(res && res.error || "unknown")}`;
        }
        return res;
      }
      if (isFragmentOnlyLayoutMode(e.mode)) {
        const normalizedMode = String(e.mode || "");
        const payload = {
          id: e.persistedRunId || null,
          name: String(e.name || getLayoutModeTitle(normalizedMode)),
          mode: normalizedMode,
          selectedZoneId: Number(e.boundZoneId || state.layoutRun && state.layoutRun.selectedZoneId || state.selectedZoneId || 0) || null,
          snapshot: buildFragmentOnlyLayoutSnapshot(normalizedMode)
        };
        const res = await api("/api/layout/manual/runs/save", "POST", payload);
        if (res && res.ok && res.item) {
          e.persistedRunId = String(res.item.id || "");
          e.persistedAt = Number(res.item.updatedAt || Date.now());
          e.runtimeSnapshot = JSON.parse(JSON.stringify(payload.snapshot));
          e.isDirty = false;
          byId("workspaceInfo").textContent = `Выкладка сохранена (${e.name || "-"})`;
          renderDetailZoneTree();
          renderPropertyEditor();
        } else {
          byId("workspaceInfo").textContent = `Ошибка сохранения: ${String(res && res.error || "unknown")}`;
        }
        return res;
      }
      if (String(e.mode || "") !== "inventory_manual") return { ok: false, error: "manual_mode_only" };
      const boundZone = ensureManualLayoutBinding(e);
      const payload = {
        id: e.persistedRunId || null,
        name: String(e.name || "Ручная выкладка"),
        mode: "inventory_manual",
        selectedZoneId: Number(boundZone && boundZone.id || state.layoutRun && state.layoutRun.selectedZoneId || state.selectedZoneId || 0) || null,
        snapshot: buildManualLayoutSnapshot()
      };
      const res = await api("/api/layout/manual/runs/save", "POST", payload);
      if (res && res.ok && res.item) {
        e.persistedRunId = String(res.item.id || "");
        e.persistedAt = Number(res.item.updatedAt || Date.now());
        e.isDirty = false;
        byId("workspaceInfo").textContent = `Выкладка сохранена (${e.name || "-"})`;
        renderDetailZoneTree();
        renderPropertyEditor();
      } else {
        byId("workspaceInfo").textContent = `Ошибка сохранения: ${String(res && res.error || "unknown")}`;
      }
      return res;
    }
    function selectLayoutEntry(entry) {
      const e = entry && typeof entry === "object" ? entry : null;
      if (!e) return;
      if (String(e.mode || "") === "inventory_mosaic") e.mode = "inventory_voronoi_sa";
      saveCurrentLayoutRuntimeSnapshot();
      state.selectedLayoutId = e.id;
      applyLayoutMode(e.mode);
      // Apply stored snapshot if available вЂ" but don't build/apply empty snapshot (avoids reset)
      const snap = e.runtimeSnapshot && typeof e.runtimeSnapshot === "object" ? e.runtimeSnapshot : null;
      if (snap) {
        if (isFragmentOnlyLayoutMode(e.mode) || isIntarsiaLayoutMode(e.mode)) {
          applyFragmentOnlyLayoutSnapshot(String(e.mode || ""), snap, e);
        } else if (String(e.mode || "") === "inventory_manual") {
          applyManualLayoutSnapshot(snap);
        } else if (String(e.mode || "") === "inventory_nfp_sa" || String(e.mode || "") === "inventory_tiling" || String(e.mode || "") === "inventory_voronoi_sa") {
          applyFragmentOnlyLayoutSnapshot(String(e.mode || ""), snap, e);
        }
      } else if (isLocalRuntimeLayoutMode(e.mode)) {
        const boundZone = ensureLocalRuntimeLayoutBinding(e);
        if (boundZone) {
          state.selectedZoneId = Number(boundZone.id || 0) || null;
          state.selectedDetailId = Number(boundZone.detailId || state.selectedDetailId || 0) || state.selectedDetailId;
          if (state.layoutRun && typeof state.layoutRun === "object") {
            state.layoutRun.selectedZoneId = Number(boundZone.id || 0) || null;
          }
        }
      }
      renderLayoutModeSwitch();
      renderDetailZoneTree();
      renderPropertyEditor();
      renderZoneToolPalette();
      renderScene();
      // Restore LCM monitor data for this entry if it was previously computed
      if (e._lcmDiag) updateLayoutContractMonitor(e._lcmDiag, e._lcmMeta || null);
    }

    async function openLayoutEntry(entry) {
      const e = entry && typeof entry === "object" ? entry : null;
      if (!e) return;
      saveCurrentLayoutRuntimeSnapshot();
      state.selectedLayoutId = e.id;
      // Enable edit mode for this layout when explicitly opening via pencil button
      if (!state.propertyEditorUi || typeof state.propertyEditorUi !== "object") state.propertyEditorUi = {};
      if (!state.propertyEditorUi.layoutEdit || typeof state.propertyEditorUi.layoutEdit !== "object") state.propertyEditorUi.layoutEdit = {};
      state.propertyEditorUi.layoutEdit[String(e.id || "")] = true;
      applyLayoutMode(e.mode);
      if (isLocalRuntimeLayoutMode(e.mode)) {
        const boundZone = ensureLocalRuntimeLayoutBinding(e);
        if (boundZone) {
          state.selectedZoneId = Number(boundZone.id || 0) || null;
          state.selectedDetailId = Number(boundZone.detailId || state.selectedDetailId || 0) || state.selectedDetailId;
          if (state.layoutRun && typeof state.layoutRun === "object") {
            state.layoutRun.selectedZoneId = Number(boundZone.id || 0) || null;
          }
        }
      }
      if ((String(e.mode || "") === "inventory_manual" || isFragmentOnlyLayoutMode(e.mode) || isIntarsiaLayoutMode(e.mode)) && e.persistedRunId) {
        const res = await api("/api/layout/manual/runs/load", "POST", { id: e.persistedRunId });
        if (res && res.ok && res.item && res.item.snapshot && typeof res.item.snapshot === "object") {
          e.runtimeSnapshot = JSON.parse(JSON.stringify(res.item.snapshot));
          e.persistedAt = Number(res.item.updatedAt || Date.now());
          e.isDirty = false;
          if (String(e.mode || "") === "inventory_manual") applyManualLayoutSnapshot(e.runtimeSnapshot);
          else applyFragmentOnlyLayoutSnapshot(String(e.mode || ""), e.runtimeSnapshot, e);
          byId("workspaceInfo").textContent = `Выкладка открыта (${e.name || "-"})`;
        } else {
          byId("workspaceInfo").textContent = `Ошибка открытия: ${String(res && res.error || "unknown")}`;
        }
      } else if (isIntarsiaLayoutMode(e.mode)) {
        const snapshot = (e.runtimeSnapshot && typeof e.runtimeSnapshot === "object")
          ? e.runtimeSnapshot
          : buildEmptyFragmentOnlyLayoutSnapshot("intarsia", e);
        if (!e.runtimeSnapshot) e.runtimeSnapshot = JSON.parse(JSON.stringify(snapshot));
        applyFragmentOnlyLayoutSnapshot("intarsia", snapshot, e);
      } else if (String(e.mode || "") === "inventory_manual") {
        const snapshot = (e.runtimeSnapshot && typeof e.runtimeSnapshot === "object")
          ? e.runtimeSnapshot
          : buildEmptyManualLayoutSnapshot();
        if (!e.runtimeSnapshot) e.runtimeSnapshot = JSON.parse(JSON.stringify(snapshot));
        applyManualLayoutSnapshot(snapshot);
      } else if (isFragmentOnlyLayoutMode(e.mode)) {
        const normalizedMode = String(e.mode || "");
        const snapshot = (e.runtimeSnapshot && typeof e.runtimeSnapshot === "object")
          ? e.runtimeSnapshot
          : buildEmptyFragmentOnlyLayoutSnapshot(normalizedMode, e);
        if (!e.runtimeSnapshot) e.runtimeSnapshot = JSON.parse(JSON.stringify(snapshot));
        applyFragmentOnlyLayoutSnapshot(normalizedMode, snapshot, e);
      }
      syncLayersFromCheckboxes();
      renderLayoutModeSwitch();
      renderDetailZoneTree();
      renderPropertyEditor();
      renderZoneToolPalette();
      renderScene();
      if (isFragmentOnlyLayoutMode(e.mode)) {
        const boundZone = resolveZoneById(e.boundZoneId || state.selectedZoneId || 0);
        if (boundZone && Array.isArray(boundZone.points) && boundZone.points.length >= 3) {
          fitPointsToView(boundZone.points);
          renderScene();
        }
      }
      if (isFragmentOnlyLayoutMode(e.mode)) {
        const normalizedMode = String(e.mode || "");
        const needsFreshPreview = !hasFragmentOnlySnapshotData(e.runtimeSnapshot)
          || isFragmentOnlySnapshotStale(normalizedMode, e.runtimeSnapshot);
        if (needsFreshPreview) {
          await previewFragmentOnlyLayout(normalizedMode);
          // Immediately persist snapshot so it's visible as background even if user
          // switches to another layout before saveCurrentLayoutRuntimeSnapshot fires.
          if (Number(state.selectedLayoutId) === Number(e.id)) {
            e.runtimeSnapshot = buildFragmentOnlyLayoutSnapshot(normalizedMode);
            renderScene();
          }
        }
      }
      if (String(e.mode || "") === "intarsia" && Array.isArray(state.intarsiaSvgFragments) && state.intarsiaSvgFragments.length > 0) {
        previewIntarsiaFragmentsDraft();
      }
    }
    async function deleteLayoutEntry(entry) {
      const e = entry && typeof entry === "object" ? entry : null;
      if (!e) return;
      const wasSelected = Number(state.selectedLayoutId || 0) === Number(e.id || 0);
      if (e.persistedRunId) {
        const res = await api("/api/layout/manual/runs/delete", "POST", { id: e.persistedRunId });
        const notFound = String(res && res.error || "") === "not_found";
        if ((!res || !res.ok) && !notFound) {
          byId("workspaceInfo").textContent = `Ошибка удаления: ${String(res && res.error || "unknown")}`;
          return;
        }
        if (notFound) {
          byId("workspaceInfo").textContent = "Сохранённая выкладка уже отсутствовала в хранилище. Удаляем локальную карточку.";
        }
      }
      state.layouts = state.layouts.filter((x) => Number(x.id) !== Number(e.id));
      if (wasSelected) {
        const next = state.layouts[0] || null;
        if (next) {
          await openLayoutEntry(next);
        } else {
          state.selectedLayoutId = null;
          clearActiveLayoutRuntime();
          renderLayoutModeSwitch();
          renderDetailZoneTree();
          renderPropertyEditor();
          renderScene();
        }
        return;
      }
      renderLayoutModeSwitch();
      renderDetailZoneTree();
      renderPropertyEditor();
      renderScene();
    }
    async function loadSavedManualRuns() {
      const res = await api("/api/layout/manual/runs", "GET");
      const items = res && res.ok && Array.isArray(res.items) ? res.items : [];
      for (const item of items) {
        let snapshot = item && item.snapshot && typeof item.snapshot === "object"
          ? JSON.parse(JSON.stringify(item.snapshot))
          : null;
        const hasSnapshotData = snapshot
          && snapshot.layoutRun
          && (Array.isArray(snapshot.layoutRun.fragments) || Array.isArray(snapshot.layoutRun.placements));
        if (!hasSnapshotData && item && item.id) {
          try {
            const loadRes = await api("/api/layout/manual/runs/load", "POST", { id: String(item.id) });
            if (loadRes && loadRes.ok && loadRes.item && loadRes.item.snapshot && typeof loadRes.item.snapshot === "object") {
              snapshot = JSON.parse(JSON.stringify(loadRes.item.snapshot));
            }
          } catch (_) {
            // Keep null snapshot; tree/reports will simply skip this run until backend is available.
          }
        }
        const snapZoneId = Number(snapshot && (snapshot.selectedZoneId || (snapshot.layoutRun && snapshot.layoutRun.selectedZoneId) || 0) || 0) || null;
        const snapDetailId = Number(snapshot && (snapshot.selectedDetailId || 0) || 0) || null;
        const id = state.nextLayoutId++;
        state.layouts.push({
          id,
          mode: String(item && item.mode || "inventory_manual"),
          name: String(item && item.name || `Ручная выкладка ${id}`),
          persistedRunId: String(item && item.id || ""),
          persistedAt: Number(item && item.updatedAt || 0) || null,
          boundZoneId: snapZoneId,
          boundDetailId: snapDetailId,
          runtimeSnapshot: snapshot,
          isDirty: false
        });
      }
      if (!state.selectedLayoutId && state.layouts.length > 0) {
        state.selectedLayoutId = state.layouts[0].id;
      }
      return items.length;
    }
    function applyLayoutMode(mode) {
      state.layoutMode = String(mode || "inventory") === "inventory_mosaic" ? "inventory_voronoi_sa" : String(mode || "inventory");
      state.layoutRun.fillType = (state.layoutMode === "longitudinal"
        || state.layoutMode === "shifted"
        || state.layoutMode === "transverse"
        || state.layoutMode === "radial"
        || state.layoutMode === "voronoi_tiles"
        || state.layoutMode === "intarsia")
        ? "regular"
        : "voronoi";
    }

    function renderLayoutModeSwitch() {
      const root = byId("layoutModeSwitch");
      if (!root) return;
      root.querySelectorAll("button[data-panel]").forEach((btn) => {
        const panel = String(btn.getAttribute("data-panel") || "zones");
        btn.classList.toggle("active", panel === state.uiPanel);
      });
      const title = byId("rightTabsTitle");
      if (title) {
        title.textContent = state.uiPanel === "layouts"
          ? ""
          : (state.uiPanel === "materials" ? "Меховые материалы" : "Детали / Зоны");
      }
    }

    function syncLayoutModeFromSelectedLayout() {
      const selectedLayout = Array.isArray(state.layouts)
        ? state.layouts.find((x) => Number(x && x.id || 0) === Number(state.selectedLayoutId || 0))
        : null;
      if (!selectedLayout) return;
      const selectedMode = String(selectedLayout.mode || "");
      if (!selectedMode) return;
      if (String(state.layoutMode || "") === selectedMode) return;
      state.layoutMode = selectedMode;
      if (state.layoutRun && typeof state.layoutRun === "object") {
        state.layoutRun.strategy = selectedMode;
      }
    }

    const FRAGMENT_ONLY_MODE_VERSIONS = {
      longitudinal: "v0.3",
      shifted: "v0.1",
      transverse: "v0.2",
      radial: "v0.1",
      voronoi_tiles: "v0.1"
    };

    function isFragmentOnlyLayoutMode(mode) {
      const normalized = String(mode || "").trim();
      return normalized === "longitudinal" || normalized === "shifted" || normalized === "transverse" || normalized === "radial" || normalized === "voronoi_tiles";
    }
    function isIntarsiaLayoutMode(mode) {
      return String(mode || "").trim() === "intarsia";
    }

    function getFragmentOnlyModeVersion(mode) {
      const normalized = String(mode || "").trim();
      return String(FRAGMENT_ONLY_MODE_VERSIONS[normalized] || "");
    }

    function isFragmentOnlySnapshotStale(mode, snapshot) {
      const expected = getFragmentOnlyModeVersion(mode);
      if (!expected) return false;
      const actual = String(
        snapshot
        && snapshot.layoutRun
        && snapshot.layoutRun.paramsSnapshot
        && snapshot.layoutRun.paramsSnapshot.layoutModeVersion
        || ""
      );
      if (actual !== expected) return true;
      // If fragments exist but none have cutPoints, the snapshot was saved before seam allowance expansion was implemented.
      const frags = Array.isArray(snapshot && snapshot.layoutRun && snapshot.layoutRun.fragments) ? snapshot.layoutRun.fragments : [];
      if (frags.length > 0 && !frags.some((f) => Array.isArray(f && f.cutPoints) && f.cutPoints.length >= 3)) return true;
      return false;
    }

    function getSelectedZoneForLayoutMode(mode) {
      const normalizedMode = String(mode || "").trim();
      if ((!Array.isArray(state.zones) || state.zones.length === 0) && Array.isArray(state.details) && state.details.length > 0) {
        initZonesFromDetails();
      }
      const selectedLayout = getSelectedLayoutEntry();
      const layoutBoundZoneId = Number(
        selectedLayout
        && String(selectedLayout.mode || "") === normalizedMode
        && selectedLayout.boundZoneId
        || 0
      ) || 0;
      const selectedZoneId = Number(state.selectedZoneId || 0) || 0;
      const selectedDetailId = Number(state.selectedDetailId || 0) || 0;
      let zone = resolveZoneById(layoutBoundZoneId);
      if (!zone && selectedZoneId > 0) {
        const candidate = resolveZoneById(selectedZoneId);
        if (candidate && (!selectedDetailId || Number(candidate.detailId || 0) === selectedDetailId)) {
          zone = candidate;
        }
      }
      if (!zone && selectedDetailId > 0) {
        zone = resolvePreferredZoneByDetail(selectedDetailId);
      }
      if (!zone && selectedZoneId > 0) {
        zone = resolveZoneById(selectedZoneId);
      }
      if (!zone) zone = (Array.isArray(state.zones) ? state.zones[0] : null) || null;
      if (!zone) return null;
      state.selectedZoneId = Number(zone.id || 0) || null;
      state.selectedDetailId = Number(zone.detailId || state.selectedDetailId || 0) || state.selectedDetailId;
      if (selectedLayout && String(selectedLayout.mode || "") === normalizedMode) {
        selectedLayout.boundZoneId = Number(zone.id || 0) || null;
        selectedLayout.boundDetailId = Number(zone.detailId || state.selectedDetailId || 0) || null;
      }
      return zone;
    }

    async function previewNfpSaLayout() {
      saveCurrentLayoutRuntimeSnapshot();
      const zone = getSelectedZoneForLayoutMode("inventory_nfp_sa");
      if (!zone || !Array.isArray(zone.points) || zone.points.length < 3) {
        byId("workspaceInfo").textContent = "Сначала выберите зону.";
        return;
      }
      showInventoryProgress();
      setInventoryProgress(5, "NFP Greedy: запрос кандидатов…");
      byId("workspaceInfo").textContent = "NFP Greedy: запрос кандидатов…";
      const candidatesRes = await api("/api/inventory/candidates", "POST", {
        zone: { id: zone.id, points: zone.points, holes: Array.isArray(zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [] },
        directInventory: true,
        onlyAvailable: true,
        includeScrapContour: true,
        napDirectionDeg: null,
        minAreaMm2: Number(byId("invMinArea") && byId("invMinArea").value || 0),
        maxCandidates: Number(byId("invLimit") && byId("invLimit").value || 300)
      });
      if (!candidatesRes || !candidatesRes.ok) {
        hideInventoryProgress();
        closeInventoryStep1();
        byId("workspaceInfo").textContent = `NFP Greedy: ошибка кандидатов: ${candidatesRes && candidatesRes.error || "unknown"}`;
        return;
      }
      const allCandidates = Array.isArray(candidatesRes.items) ? candidatesRes.items : [];
      const candidates = allCandidates.map((c) => ({
        scrapPieceId: String(c.inventoryTag || c.id || ""),
        scrapContour: c.scrapContour,
        napDirectionDeg: Number(c.napDirectionDeg || c.napDirection || 0),
        quantity: 1
      }));
      setInventoryProgress(30, `NFP Greedy: ${candidates.length} кандидатов, запуск солвера…`);
      byId("workspaceInfo").textContent = `NFP Greedy: ${candidates.length} кандидатов, решаем…`;
      const maxSolveMs = 90000;
      const progressToken = `nfp_sa_${Date.now()}`;
      openInventoryProgressStream(progressToken);
      const res = await api("/api/layout/modes/preview", "POST", {
        layoutType: "inventory_nfp_sa",
        zone: { id: zone.id, points: zone.points, holes: Array.isArray(zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [] },
        inputs: { candidates },
        progressToken,
        options: {
          maxSolveMs,
          seed: state.layoutRun.debugSeed != null ? state.layoutRun.debugSeed : Date.now(),
          allowanceMm: Number.isFinite(Number(state.layoutRun.allowanceMm)) ? Number(state.layoutRun.allowanceMm) : 12,
          napTarget: normalizeDeg(zone.napDirectionDeg, DEFAULT_NAP_DIRECTION_DEG),
          napTol: Number(byId("invNapTol") && byId("invNapTol").value || 15),
          minWidthMm: Number(byId("minFragmentWidthMm") && byId("minFragmentWidthMm").value || 0),
          minLengthMm: Number(byId("minFragmentLengthMm") && byId("minFragmentLengthMm").value || 0)
        }
      }, maxSolveMs + 30000);
      closeInventoryProgressStream();
      if (!res || res.ok !== true) {
        hideInventoryProgress();
        closeInventoryStep1();
        byId("workspaceInfo").textContent = `NFP Greedy ошибка: ${res && res.error || "unknown"}`;
        return;
      }
      updateLayoutContractMonitor(res._contractDiag, {
        endpoint: "modes/preview (NFP Greedy)",
        layoutType: "inventory_nfp_sa",
        payloadHasHoles: Array.isArray(zone.holes) && zone.holes.length > 0
      });
      setInventoryProgress(98, "NFP Greedy: формируем результат…");
      const placements = Array.isArray(res.render && res.render.items) ? res.render.items.map((item) => ({
        scrapPieceId: String(item.id || ""),
        inventoryTag: String(item.meta && item.meta.inventoryTag || item.id || ""),
        status: "matched",
        alignedContour: Array.isArray(item.contour) ? item.contour : [],
        inZoneContour: Array.isArray(item.inZoneContour) && item.inZoneContour.length >= 3 ? item.inZoneContour : (Array.isArray(item.contour) ? item.contour : []),
        rawTerritoryContour: Array.isArray(item.rawTerritoryContour) && item.rawTerritoryContour.length >= 3 ? item.rawTerritoryContour : [],
        alignedCoreContour: Array.isArray(item.alignedCoreContour) && item.alignedCoreContour.length >= 3 ? item.alignedCoreContour : [],
        inZoneCoreContour: Array.isArray(item.inZoneCoreContour) && item.inZoneCoreContour.length >= 3 ? item.inZoneCoreContour : [],
        phase: String(item.meta && item.meta.phase || "SA"),
        solveOrder: Number(item.renderIndex || 0) + 1,
        solveIndex: Number(item.renderIndex || 0),
        renderIndex: Number(item.renderIndex || 0)
      })) : [];
      const alignedContours = placements.map((p) => p.alignedContour).filter((c) => Array.isArray(c) && c.length >= 3);
      const coreContours = placements.map((p) => Array.isArray(p.inZoneCoreContour) && p.inZoneCoreContour.length >= 3 ? p.inZoneCoreContour : p.alignedContour).filter((c) => Array.isArray(c) && c.length >= 3);
      const coverageHoles = computeCoverageHolesForZone(zone, coreContours);
      const pieceIntersections = [];
      const fragments = placements.map((p, idx) => {
        const cutPts = Array.isArray(p.inZoneContour) && p.inZoneContour.length >= 3
          ? p.inZoneContour
          : (Array.isArray(p.alignedContour) && p.alignedContour.length >= 3 ? p.alignedContour : []);
        const corePts = Array.isArray(p.inZoneCoreContour) && p.inZoneCoreContour.length >= 3
          ? p.inZoneCoreContour
          : cutPts;
        return {
          id: idx + 1,
          ownerPlacementIndex: idx,
          ownerPlacementId: idx + 1,
          inventoryTag: p.inventoryTag || p.scrapPieceId || "",
          points: corePts,
          cutPoints: cutPts,
          areaMm2: 0,
          zoneId: Number(zone.id || 0) || null
        };
      }).filter((f) => f.points.length >= 3);
      state.layers.pfullZ = true;
      const _pfullChk = byId("layerPfullZ"); if (_pfullChk) _pfullChk.checked = true;
      state.layoutMode = "inventory_nfp_sa";
      state.layoutRun.active = true;
      state.layoutRun.status = "preview";
      state.layoutRun.fillType = "regular";
      state.layoutRun.strategy = "inventory_nfp_sa";
      state.layoutRun.inventoryScenario = "A";
      state.layoutRun.selectedZoneId = Number(zone.id || 0) || null;
      state.layoutRun.fragments = clipFragmentsByZoneDomain(fragments, zone);
      state.layoutRun.placements = placements;
      state.layoutRun.candidatePool = [];
      state.layoutRun.manual = { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
      state.selectedFragmentId = null;
      const _nfpSaSeams = (() => {
        if (!window.FurLabSeams || fragments.length < 2) return [];
        const segs = window.FurLabSeams.computeSeamSegmentsFromAppliedFragments(fragments, { minLenMm: 3, tolDistMm: 2.5, tolParallel: 0.35 });
        const holeContours = Array.isArray(zone && zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [];
        const ptInPoly = (px, py, poly) => {
          let inside = false;
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = Number(poly[i].x), yi = Number(poly[i].y);
            const xj = Number(poly[j].x), yj = Number(poly[j].y);
            if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
          }
          return inside;
        };
        const seamInHole = (s, hc) => {
          const pts = Array.isArray(s && s.points) ? s.points : [];
          if (pts.length < 2) return false;
          const p1 = pts[0], p2 = pts[pts.length - 1];
          const pm = { x: (Number(p1.x) + Number(p2.x)) * 0.5, y: (Number(p1.y) + Number(p2.y)) * 0.5 };
          return ptInPoly(pm.x, pm.y, hc) || ptInPoly(Number(p1.x), Number(p1.y), hc) || ptInPoly(Number(p2.x), Number(p2.y), hc);
        };
        return (Array.isArray(segs) ? segs : []).filter((s) => {
          if (window.FurLabSeams.seamOnZoneBoundary(s, zone && zone.points, 1.6)) return false;
          if (holeContours.some((hc) => seamInHole(s, hc) || window.FurLabSeams.seamOnZoneBoundary(s, hc, 4.0))) return false;
          return true;
        });
      })();
      state.layoutRun.previewLayers = { pieceIntersections, visibleArea: coreContours, coverageHoles, seams: _nfpSaSeams };
      state.layoutRun.splitEvents = [];
      state.layoutRun.stats = res.stats || { placementsTotal: placements.length };
      state.layoutRun.resultStatus = String(res.resultStatus || "ok");
      state.layoutRun.failedReason = res.failedReason || null;
      state.layoutRun.serverPreview = res;
      const covPct = ((res.stats && res.stats.coveredRatio != null) ? (Number(res.stats.coveredRatio) * 100) : (Number(res.coveragePercent) || 0)).toFixed(1);
      const nPlacements = placements.length;
      setInventoryProgress(100, `NFP Greedy: готово — ${nPlacements} кусков, покрытие ${covPct}%`);
      byId("invTotalFragments").textContent = String(fragments.length);
      byId("invViolations").textContent = "0";
      byId("invIntersections").textContent = "0";
      byId("invUncovered").textContent = coverageHoles.length > 0 ? String(coverageHoles.length) : "0";
      byId("invCoveragePercent").textContent = covPct;
      byId("invResidualArea").textContent = "0";
      byId("invOverlapArea").textContent = "0";
      byId("invDbCandidates").textContent = String(allCandidates.length);
      byId("invCompatibleCandidates").textContent = String(candidates.length);
      byId("invStrategyUsed").textContent = "NFP Greedy";
      const _step2ModalNfp = byId("inventoryStep2Modal"); if (_step2ModalNfp) _step2ModalNfp.classList.add("strategy-nfp-sa");
      byId("invMatchedPct").textContent = Number(nPlacements / Math.max(1, candidates.length) * 100).toFixed(2);
      byId("invKpiCoveragePct").textContent = covPct;
      byId("invDebugInfo").textContent = `NFP Greedy: iters=sa, pieces=${nPlacements}, cov=${covPct}%`;
      byId("invUsedTags").textContent = placements.map((p) => p.inventoryTag || p.scrapPieceId || "").filter(Boolean).join("\n") || "(Нет)";
      renderPlacementRows([]);
      renderSplitEvents([]);
      const applyBtn = byId("inventoryStep2ApplyBtn");
      if (applyBtn) { applyBtn.disabled = false; applyBtn.title = ""; }
      hideInventoryProgress();
      closeInventoryStep1();
      byId("workspaceInfo").textContent = `NFP Greedy: ${nPlacements} кусков, покрытие ${covPct}%`;
      openInventoryStep2();
      renderScene();
    }

    async function previewTilingLayout() {
      saveCurrentLayoutRuntimeSnapshot();
      const zone = getSelectedZoneForLayoutMode("inventory_tiling");
      if (!zone || !Array.isArray(zone.points) || zone.points.length < 3) {
        byId("workspaceInfo").textContent = "Сначала выберите зону.";
        return;
      }
      showInventoryProgress();
      setInventoryProgress(5, "Тайлинг: запрос кандидатов…");
      byId("workspaceInfo").textContent = "Тайлинг: запрос кандидатов…";
      const candidatesRes = await api("/api/inventory/candidates", "POST", {
        zone: { id: zone.id, points: zone.points, holes: Array.isArray(zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [] },
        directInventory: true,
        onlyAvailable: true,
        includeScrapContour: true,
        napDirectionDeg: null,
        minAreaMm2: Number(byId("invMinArea") && byId("invMinArea").value || 0),
        maxCandidates: Number(byId("invLimit") && byId("invLimit").value || 300)
      });
      if (!candidatesRes || !candidatesRes.ok) {
        hideInventoryProgress();
        closeInventoryStep1();
        byId("workspaceInfo").textContent = `Тайлинг: ошибка кандидатов: ${candidatesRes && candidatesRes.error || "unknown"}`;
        return;
      }
      const allCandidates = Array.isArray(candidatesRes.items) ? candidatesRes.items : [];
      const candidates = allCandidates.map((c) => ({
        scrapPieceId: String(c.inventoryTag || c.id || ""),
        scrapContour: c.scrapContour,
        napDirectionDeg: Number(c.napDirectionDeg || c.napDirection || 0),
        quantity: 1
      }));
      setInventoryProgress(30, `Тайлинг: ${candidates.length} кандидатов, запуск солвера…`);
      byId("workspaceInfo").textContent = `Тайлинг: ${candidates.length} кандидатов, решаем…`;
      const maxSolveMs = 30000;
      const res = await api("/api/layout/modes/preview", "POST", {
        layoutType: "inventory_tiling",
        zone: { id: zone.id, points: zone.points, holes: Array.isArray(zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [] },
        inputs: { candidates },
        options: {
          maxSolveMs,
          allowanceMm: Number.isFinite(Number(state.layoutRun.allowanceMm)) ? Number(state.layoutRun.allowanceMm) : 12,
          napTarget: normalizeDeg(zone.napDirectionDeg, DEFAULT_NAP_DIRECTION_DEG),
          napTol: Number(byId("invNapTol") && byId("invNapTol").value || 15),
          minWidthMm: Number(byId("minFragmentWidthMm") && byId("minFragmentWidthMm").value || 0),
          minLengthMm: Number(byId("minFragmentLengthMm") && byId("minFragmentLengthMm").value || 0)
        }
      }, maxSolveMs + 15000);
      if (!res || res.ok !== true) {
        hideInventoryProgress();
        closeInventoryStep1();
        byId("workspaceInfo").textContent = `Тайлинг ошибка: ${res && res.error || "unknown"}`;
        return;
      }
      setInventoryProgress(98, "Тайлинг: формируем результат…");
      const placements = Array.isArray(res.render && res.render.items) ? res.render.items.map((item) => ({
        scrapPieceId: String(item.id || ""),
        inventoryTag: String(item.meta && item.meta.inventoryTag || item.id || ""),
        status: "matched",
        alignedContour: Array.isArray(item.contour) ? item.contour : [],
        inZoneContour: Array.isArray(item.inZoneContour) && item.inZoneContour.length >= 3 ? item.inZoneContour : (Array.isArray(item.contour) ? item.contour : []),
        rawTerritoryContour: Array.isArray(item.rawTerritoryContour) && item.rawTerritoryContour.length >= 3 ? item.rawTerritoryContour : [],
        alignedCoreContour: Array.isArray(item.alignedCoreContour) && item.alignedCoreContour.length >= 3 ? item.alignedCoreContour : [],
        inZoneCoreContour: Array.isArray(item.inZoneCoreContour) && item.inZoneCoreContour.length >= 3 ? item.inZoneCoreContour : [],
        phase: "tiling",
        solveOrder: Number(item.renderIndex || 0) + 1,
        solveIndex: Number(item.renderIndex || 0),
        renderIndex: Number(item.renderIndex || 0)
      })) : [];
      const coreContours = placements.map((p) => Array.isArray(p.inZoneCoreContour) && p.inZoneCoreContour.length >= 3 ? p.inZoneCoreContour : p.alignedContour).filter((c) => Array.isArray(c) && c.length >= 3);
      const coverageHoles = computeCoverageHolesForZone(zone, coreContours);
      const pieceIntersections = [];
      const fragments = placements.map((p, idx) => {
        const cutPts = Array.isArray(p.inZoneContour) && p.inZoneContour.length >= 3
          ? p.inZoneContour
          : (Array.isArray(p.alignedContour) && p.alignedContour.length >= 3 ? p.alignedContour : []);
        const corePts = Array.isArray(p.inZoneCoreContour) && p.inZoneCoreContour.length >= 3
          ? p.inZoneCoreContour
          : cutPts;
        return {
          id: idx + 1,
          ownerPlacementIndex: idx,
          ownerPlacementId: idx + 1,
          inventoryTag: p.inventoryTag || p.scrapPieceId || "",
          points: corePts,
          cutPoints: cutPts,
          areaMm2: 0,
          zoneId: Number(zone.id || 0) || null
        };
      }).filter((f) => f.points.length >= 3);
      state.layers.pfullZ = true;
      const _pfullChk = byId("layerPfullZ"); if (_pfullChk) _pfullChk.checked = true;
      state.layoutMode = "inventory_tiling";
      state.layoutRun.active = true;
      state.layoutRun.status = "preview";
      state.layoutRun.fillType = "regular";
      state.layoutRun.strategy = "inventory_tiling";
      state.layoutRun.inventoryScenario = "A";
      state.layoutRun.selectedZoneId = Number(zone.id || 0) || null;
      state.layoutRun.fragments = clipFragmentsByZoneDomain(fragments, zone);
      state.layoutRun.placements = placements;
      state.layoutRun.candidatePool = [];
      state.layoutRun.manual = { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
      state.selectedFragmentId = null;
      state.layoutRun.previewLayers = { pieceIntersections, visibleArea: coreContours, coverageHoles, seams: [] };
      state.layoutRun.splitEvents = [];
      state.layoutRun.stats = res.stats || { placementsTotal: placements.length };
      state.layoutRun.resultStatus = String(res.resultStatus || "ok");
      state.layoutRun.failedReason = res.failedReason || null;
      state.layoutRun.serverPreview = res;
      const covPct = ((res.stats && res.stats.coveredRatio != null) ? (Number(res.stats.coveredRatio) * 100) : (Number(res.coveragePercent) || 0)).toFixed(1);
      const nPlacements = placements.length;
      setInventoryProgress(100, `Тайлинг: готово — ${nPlacements} кусков, покрытие ${covPct}%`);
      byId("invTotalFragments").textContent = String(fragments.length);
      byId("invViolations").textContent = "0";
      byId("invIntersections").textContent = "0";
      byId("invUncovered").textContent = coverageHoles.length > 0 ? String(coverageHoles.length) : "0";
      byId("invCoveragePercent").textContent = covPct;
      byId("invResidualArea").textContent = "0";
      byId("invOverlapArea").textContent = "0";
      byId("invDbCandidates").textContent = String(allCandidates.length);
      byId("invCompatibleCandidates").textContent = String(candidates.length);
      byId("invStrategyUsed").textContent = "Тайлинг";
      byId("invMatchedPct").textContent = Number(nPlacements / Math.max(1, candidates.length) * 100).toFixed(2);
      byId("invKpiCoveragePct").textContent = covPct;
      byId("invDebugInfo").textContent = `Тайлинг: pieces=${nPlacements}, cov=${covPct}%`;
      byId("invUsedTags").textContent = placements.map((p) => p.inventoryTag || p.scrapPieceId || "").filter(Boolean).join("\n") || "(Нет)";
      renderPlacementRows([]);
      renderSplitEvents([]);
      const applyBtn = byId("inventoryStep2ApplyBtn");
      if (applyBtn) { applyBtn.disabled = false; applyBtn.title = ""; }
      hideInventoryProgress();
      closeInventoryStep1();
      byId("workspaceInfo").textContent = `Тайлинг: ${nPlacements} кусков, покрытие ${covPct}%`;
      openInventoryStep2();
      renderScene();
    }

    async function previewVoronoiSaLayout() {
      saveCurrentLayoutRuntimeSnapshot();
      const zone = getSelectedZoneForLayoutMode("inventory_voronoi_sa");
      if (!zone || !Array.isArray(zone.points) || zone.points.length < 3) {
        byId("workspaceInfo").textContent = "Сначала выберите зону.";
        return;
      }
      showInventoryProgress();
      setInventoryProgress(5, "Voronoi+SA: запрос кандидатов…");
      byId("workspaceInfo").textContent = "Voronoi+SA: запрос кандидатов…";
      const candidatesRes = await api("/api/inventory/candidates", "POST", {
        zone: { id: zone.id, points: zone.points, holes: Array.isArray(zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [] },
        directInventory: true,
        onlyAvailable: true,
        includeScrapContour: true,
        napDirectionDeg: null,
        minAreaMm2: Number(byId("invMinArea") && byId("invMinArea").value || 0),
        maxCandidates: Number(byId("invLimit") && byId("invLimit").value || 300)
      }, 180000);
      if (!candidatesRes || !candidatesRes.ok) {
        hideInventoryProgress();
        closeInventoryStep1();
        byId("workspaceInfo").textContent = `Voronoi+SA: ошибка кандидатов: ${candidatesRes && candidatesRes.error || "unknown"}`;
        return;
      }
      const allCandidates = Array.isArray(candidatesRes.items) ? candidatesRes.items : [];
      const candidates = allCandidates.map((c) => ({
        scrapPieceId: String(c.inventoryTag || c.id || ""),
        scrapContour: c.scrapContour,
        napDirectionDeg: Number(c.napDirectionDeg || c.napDirection || 0),
        quantity: 1
      }));
      setInventoryProgress(30, `Voronoi+SA: ${candidates.length} кандидатов, запуск солвера…`);
      byId("workspaceInfo").textContent = `Voronoi+SA: ${candidates.length} кандидатов, решаем…`;
      const maxSolveMs = 90000;
      const progressToken = `voronoi_sa_${Date.now()}`;
      // Fix seed before the call so re-runs on same S are possible immediately.
      // To reset to random: delete state.layoutRun.debugSeed from console.
      const runSeed = state.layoutRun.debugSeed != null ? state.layoutRun.debugSeed : Date.now();
      state.layoutRun.debugSeed = runSeed;
      openInventoryProgressStream(progressToken);
      const res = await api("/api/layout/modes/preview", "POST", {
        layoutType: "inventory_voronoi_sa",
        zone: { id: zone.id, points: zone.points, holes: Array.isArray(zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [] },
        inputs: { candidates },
        progressToken,
        options: {
          maxSolveMs,
          seed: runSeed,
          absorptionCriterion: state.layoutRun.absorptionCriterion != null ? state.layoutRun.absorptionCriterion : 4,
          numRestarts: Math.max(1, Number(byId("invNumRestarts") && byId("invNumRestarts").value || state.layoutRun.numRestarts || 1)),
          allowanceMm: Number.isFinite(Number(state.layoutRun.allowanceMm)) ? Number(state.layoutRun.allowanceMm) : 12,
          napTarget: normalizeDeg(zone.napDirectionDeg, DEFAULT_NAP_DIRECTION_DEG),
          napTol: Number(byId("invNapTol") && byId("invNapTol").value || 15),
          minWidthMm: Number(byId("minFragmentWidthMm") && byId("minFragmentWidthMm").value || 0),
          minLengthMm: Number(byId("minFragmentLengthMm") && byId("minFragmentLengthMm").value || 0)
        }
      }, maxSolveMs + 60000);
      closeInventoryProgressStream();
      if (!res || res.ok !== true) {
        hideInventoryProgress();
        closeInventoryStep1();
        byId("workspaceInfo").textContent = `Voronoi+SA ошибка: ${res && res.error || "unknown"}`;
        return;
      }
      updateLayoutContractMonitor(res._contractDiag, {
        endpoint: "modes/preview (Voronoi+SA)",
        layoutType: "inventory_voronoi_sa",
        payloadHasHoles: Array.isArray(zone.holes) && zone.holes.length > 0
      });
      updateVoronoiSaMonitor(res);
      setInventoryProgress(98, "Voronoi+SA: формируем результат…");
      const vorModel = window.FurLabInventoryVoronoiSa.buildPreviewModel({
        res,
        zone,
        helpers: { computeCoverageHolesForZone, clipFragmentsByZoneDomain, holeContour },
        effectiveOptionsFallback: {
          maxSolveMs,
          seed: runSeed,
          absorptionCriterion: state.layoutRun.absorptionCriterion != null ? state.layoutRun.absorptionCriterion : 4,
          numRestarts: Math.max(1, Number(byId("invNumRestarts") && byId("invNumRestarts").value || state.layoutRun.numRestarts || 1)),
          allowanceMm: Number.isFinite(Number(state.layoutRun.allowanceMm)) ? Number(state.layoutRun.allowanceMm) : 12,
          napTarget: normalizeDeg(zone.napDirectionDeg, DEFAULT_NAP_DIRECTION_DEG),
          napTol: Number(byId("invNapTol") && byId("invNapTol").value || 15),
          minWidthMm: Number(byId("minFragmentWidthMm") && byId("minFragmentWidthMm").value || 0),
          minLengthMm: Number(byId("minFragmentLengthMm") && byId("minFragmentLengthMm").value || 0)
        }
      });
      const placements = vorModel.placements;
      const coverageHoles = vorModel.coverageHoles;
      const pieceIntersections = vorModel.pieceIntersections;
      const fragments = vorModel.fragments;
      state.layers.pfullZ = true;
      const _pfullChk = byId("layerPfullZ"); if (_pfullChk) _pfullChk.checked = true;
      state.layers.coverageHoles = true;
      const _chkCovHoles = byId("layerCoverageHoles"); if (_chkCovHoles) _chkCovHoles.checked = true;
      state.layoutMode = "inventory_voronoi_sa";
      state.layoutRun.active = true;
      state.layoutRun.status = "preview";
      state.layoutRun.fillType = "regular";
      state.layoutRun.strategy = "inventory_voronoi_sa";
      state.layoutRun.inventoryScenario = "A";
      state.layoutRun.selectedZoneId = Number(zone.id || 0) || null;
      state.layoutRun.fragments = clipFragmentsByZoneDomain(fragments, zone);
      state.layoutRun.placements = placements;
      state.layoutRun.candidatePool = allCandidates;
      state.layoutRun.lastRawResult = res;
      state.layoutRun.effectiveOptions = vorModel.effectiveOptions;
      state.layoutRun.manual = { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
      state.selectedFragmentId = null;
      state.layoutRun.previewLayers = { pieceIntersections, visibleArea: vorModel.coreContours, coverageHoles, seams: vorModel.seams };
      state.layoutRun.splitEvents = [];
      state.layoutRun.stats = res.stats || { placementsTotal: placements.length };
      state.layoutRun.resultStatus = String(res.resultStatus || "ok");
      state.layoutRun.failedReason = res.failedReason || null;
      state.layoutRun.serverPreview = res;
      const covRatio = Number(res.stats && res.stats.coveredRatio || 0);
      const covPct = (covRatio * 100).toFixed(1);
      const nPlacements = placements.length;
      setInventoryProgress(100, `Voronoi+SA: готово — ${nPlacements} кусков, покрытие ${covPct}%`);
      byId("invTotalFragments").textContent = String(fragments.length);
      byId("invViolations").textContent = "0";
      byId("invIntersections").textContent = "0";
      byId("invUncovered").textContent = String(Array.isArray(res.uncoveredComponents) ? res.uncoveredComponents.length : (res.stats && res.stats.uncoveredComponentCount != null ? res.stats.uncoveredComponentCount : coverageHoles.length));
      byId("invCoveragePercent").textContent = covPct;
      byId("invResidualArea").textContent = res.residualInteriorMm2 != null ? Math.round(res.residualInteriorMm2) : "0";
      byId("invUsefulArea").textContent = String(placements.reduce((s, p) => s + Number(p.gainAreaMm2 || 0), 0).toFixed(1));
      byId("invUsedScrapArea").textContent = "0";
      byId("invScrapUtilization").textContent = "0";
      byId("invScrapWaste").textContent = "0";
      byId("invOverlapArea").textContent = "0";
      byId("invCandidateAreaBudget").textContent = "0";
      byId("invDbCandidates").textContent = String(allCandidates.length);
      byId("invCompatibleCandidates").textContent = String(candidates.length);
      byId("invStrategyUsed").textContent = "Voronoi+SA";
      const _step2ModalVor = byId("inventoryStep2Modal"); if (_step2ModalVor) _step2ModalVor.classList.add("strategy-nfp-sa");
      byId("invMatchedPct").textContent = Number(nPlacements / Math.max(1, candidates.length) * 100).toFixed(2);
      byId("invKpiCoveragePct").textContent = covPct;
      byId("invTailCoverageStart").textContent = "-";
      byId("invTailOversizeAlpha").textContent = "-";
      byId("invRejectedOversize").textContent = "0";
      byId("invRejectedOverlap").textContent = "0";
      byId("invRejectedLowGain").textContent = "0";
      byId("invRejectedOutside").textContent = "0";
      byId("invDebugInfo").textContent = `Voronoi+SA: iters=sa, pieces=${nPlacements}, cov=${covPct}%`;
      byId("invUsedTags").textContent = placements.map((p) => p.inventoryTag || p.scrapPieceId || "").filter(Boolean).join("\n") || "(Нет)";
      renderPlacementRows([]);
      renderSplitEvents([]);
      const applyBtn = byId("inventoryStep2ApplyBtn");
      if (applyBtn) { applyBtn.disabled = false; applyBtn.title = ""; }
      hideInventoryProgress();
      closeInventoryStep1();
      byId("workspaceInfo").textContent = `Voronoi+SA: ${nPlacements} кусков, покрытие ${covPct}%`;
      openInventoryStep2();
      renderScene();
    }

    async function previewFragmentOnlyLayout(mode) {
      const normalizedMode = String(mode || "").trim();
      if (!isFragmentOnlyLayoutMode(normalizedMode)) {
        return { ok: false, error: "fragment_only_mode_unsupported" };
      }
      // Save snapshot of current entry before overwriting state.layoutRun
      saveCurrentLayoutRuntimeSnapshot();
      const zone = getSelectedZoneForLayoutMode(normalizedMode);
      if (!zone || !Array.isArray(zone.points) || zone.points.length < 3) {
        byId("workspaceInfo").textContent = "Сначала выберите зону.";
        return { ok: false, error: "zone_not_selected" };
      }
      const selectedLayout = getSelectedLayoutEntry();
      const rows = Math.max(1, Number(byId("fillRows").value || 5));
      const cols = Math.max(1, Number(byId("fillCols").value || 5));
      const axisCount = Math.max(0, Math.min(6, Number((byId("fillAxisCount") && byId("fillAxisCount").value) || 1)));
      const angleDeg = Math.max(-89, Math.min(89, Number((byId("fillAngleDeg") && byId("fillAngleDeg").value) || 45)));
      const bandStepMm = Math.max(10, Math.min(5000, Number((byId("fillBandStep") && byId("fillBandStep").value) || 120)));
      const shiftPercent = Math.max(-100, Math.min(100, Number((byId("fillShiftPercent") && byId("fillShiftPercent").value) || 50)));
      const ringCount = Math.max(1, Math.min(20, Number((byId("fillRingCount") && byId("fillRingCount").value) || 4)));
      const sectorCount = Math.max(1, Math.min(36, Number((byId("fillSectorCount") && byId("fillSectorCount").value) || 8)));
      const rotationDeg = Math.max(-360, Math.min(360, Number((byId("fillSectorRotationDeg") && byId("fillSectorRotationDeg").value) || 0)));
      const innerRadiusMm = Math.max(0, Number((byId("fillInnerRadiusMm") && byId("fillInnerRadiusMm").value) || 0));
      const centerMode = String((byId("fillCenterMode") && byId("fillCenterMode").value) || "auto");
      const centerX = Number((byId("fillCenterX") && byId("fillCenterX").value) || 0);
      const centerY = Number((byId("fillCenterY") && byId("fillCenterY").value) || 0);
      const gapX = Math.max(0, Number(byId("fillGapX").value || 0));
      const gapY = Math.max(0, Number(byId("fillGapY").value || 0));
      const cornerRadius = Math.max(0, Number(byId("fillCornerRadius").value || 0));
      const voronoiSubMode = String((byId("voronoiSubMode") && byId("voronoiSubMode").value) || "random");
      const voronoiDensity = Math.max(1, Math.min(120, Number((byId("voronoiDensity") && byId("voronoiDensity").value) || 14)));
      const voronoiVariability = Math.max(1, Math.min(10, Number((byId("voronoiVariability") && byId("voronoiVariability").value) || 5)));
      const voronoiAnisotropy = Math.max(1, Math.min(10, Number((byId("voronoiAnisotropy") && byId("voronoiAnisotropy").value) || 5)));
      const voronoiGapMm = Math.max(0, Number((byId("voronoiGapMm") && byId("voronoiGapMm").value) || 0));
      const allowanceMm = (() => { const v = parseLocaleNumber(state.layoutRun && state.layoutRun.allowanceMm, 12); return Number.isFinite(Number(v)) ? Number(v) : 12; })();
      const zoneMaterial = zone.materialId ? getFurMaterialById(zone.materialId) : null;
      const matMaxAlongMm = zoneMaterial && Number.isFinite(Number(zoneMaterial.maxLengthMm)) ? Number(zoneMaterial.maxLengthMm) : null;
      const matMaxAcrossMm = zoneMaterial && Number.isFinite(Number(zoneMaterial.maxWidthMm)) ? Number(zoneMaterial.maxWidthMm) : null;
      const constraintsRow = byId("fragmentSizeConstraintsRow");
      if (constraintsRow) constraintsRow.style.display = "";
      const maxAlongEl = byId("fragmentMaxAlongMm");
      const maxAcrossEl = byId("fragmentMaxAcrossMm");
      if (maxAlongEl) { if (matMaxAlongMm !== null) { maxAlongEl.value = String(matMaxAlongMm); } else { maxAlongEl.value = ""; } }
      if (maxAcrossEl) { if (matMaxAcrossMm !== null) { maxAcrossEl.value = String(matMaxAcrossMm); } else { maxAcrossEl.value = ""; } }
      const fragmentMinAlongMm = Math.max(0, Number((byId("fragmentMinAlongMm") && byId("fragmentMinAlongMm").value) || 60));
      const fragmentMinAcrossMm = Math.max(0, Number((byId("fragmentMinAcrossMm") && byId("fragmentMinAcrossMm").value) || 60));
      const fragmentMaxAlongMm = matMaxAlongMm !== null ? matMaxAlongMm : null;
      const fragmentMaxAcrossMm = matMaxAcrossMm !== null ? matMaxAcrossMm : null;
      const payload = {
        layoutType: normalizedMode,
        zone: {
          id: zone.id,
          points: Array.isArray(zone.points) ? zone.points : [],
          holes: Array.isArray(zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : []
        },
        inputs: {
          normalizeRules: {
            minFragmentWidthMm: 0,
            minFragmentLengthMm: 0,
            mergeSmallFragments: false,
            seamAllowanceReserveMm: allowanceMm,
            fragmentMinAlongMm,
            fragmentMinAcrossMm,
            fragmentMaxAlongMm,
            fragmentMaxAcrossMm
          }
        },
        options: {
          rows,
          cols,
          axisCount,
          angleDeg,
          bandStepMm,
          shiftPercent,
          ringCount,
          sectorCount,
          rotationDeg,
          innerRadiusMm,
          centerMode,
          centerX,
          centerY,
          gapX,
          gapY,
          cornerRadius,
          variability: normalizedMode === "longitudinal" ? 0 : normalizedMode === "voronoi_tiles" ? voronoiVariability : undefined,
          subMode: normalizedMode === "voronoi_tiles" ? voronoiSubMode : undefined,
          cellCount: normalizedMode === "voronoi_tiles" ? voronoiDensity : undefined,
          anisotropy: normalizedMode === "voronoi_tiles" ? voronoiAnisotropy : undefined,
          gapMm: normalizedMode === "voronoi_tiles" ? voronoiGapMm : undefined
        },
        seed: Date.now()
      };
      byId("workspaceInfo").textContent = 'Р"енерируем выкладку...';
      const res = await api("/api/layout/modes/preview", "POST", payload, 45000);
      if (!res || res.ok !== true) {
        byId("workspaceInfo").textContent = `Ошибка генерации: ${String(res && (res.message || res.error) || "unknown")}`;
        return res || { ok: false, error: "preview_failed" };
      }
      previewToken = "";
      state.layoutRun.active = true;
      state.layoutRun.status = "preview";
      state.layoutRun.fillType = "regular";
      state.layoutRun.strategy = normalizedMode;
      state.layoutRun.inventoryScenario = "";
      state.layoutRun.selectedZoneId = Number(zone.id || 0) || null;
      state.layoutRun.allowanceMm = allowanceMm;
      state.layoutRun.fragments = clipFragmentsByZoneDomain(Array.isArray(res.fragments) ? res.fragments : [], zone);
      state.layoutRun.placements = [];
      state.layoutRun.candidatePool = [];
      const _fragmentCoverContours = (Array.isArray(state.layoutRun.fragments) ? state.layoutRun.fragments : [])
        .map((f) => normalizeContourArray((f && (f.points || f.cleanPoints || f.seamPoints)) || []))
        .filter((poly) => Array.isArray(poly) && poly.length >= 3);
      const _coverageHoles = computeCoverageHolesForZone(zone, _fragmentCoverContours);
      state.layoutRun.previewLayers = { pieceIntersections: [], visibleArea: _fragmentCoverContours, coverageHoles: _coverageHoles, seams: [] };
      state.layoutRun.splitEvents = [];
      state.layoutRun.stats = res && res.stats && typeof res.stats === "object"
        ? res.stats
        : { fragmentsTotal: Array.isArray(res.fragments) ? res.fragments.length : 0 };
      state.layoutRun.paramsSnapshot = {
        layoutType: normalizedMode,
        layoutModeVersion: getFragmentOnlyModeVersion(normalizedMode),
        zoneId: Number(zone.id || 0) || null,
        options: payload.options,
        inputs: payload.inputs
      };
      state.layoutRun.resultStatus = String(res.resultStatus || "ok");
      state.layoutRun.failedReason = res.failedReason || null;
      state.layoutRun.serverPreview = res;
      state.selectedFragmentId = null;
      updateLayoutContractMonitor(res._contractDiag, {
        endpoint: `modes/preview (${normalizedMode})`,
        layoutType: normalizedMode,
        payloadHasHoles: Array.isArray(zone.holes) && zone.holes.length > 0
      });
      if (selectedLayout && String(selectedLayout.mode || "") === normalizedMode) {
        selectedLayout.boundZoneId = Number(zone.id || 0) || null;
        selectedLayout.boundDetailId = Number(zone.detailId || state.selectedDetailId || 0) || null;
        selectedLayout.runtimeSnapshot = buildFragmentOnlyLayoutSnapshot(normalizedMode);
        selectedLayout.isDirty = true;
      }
      renderPlacementRows([]);
      renderSplitEvents([]);
      renderDetailZoneTree();
      renderPropertyEditor();
      renderScene();
      byId("workspaceInfo").textContent = normalizedMode === "transverse"
        ? `${getLayoutModeTitle(normalizedMode)}: ${state.layoutRun.fragments.length} фрагментов (оси ${axisCount}, шаг ${bandStepMm} мм, угол ${angleDeg}°)`
        : (normalizedMode === "radial"
          ? `${getLayoutModeTitle(normalizedMode)}: ${state.layoutRun.fragments.length} фрагментов (кольца ${ringCount}, секторы ${sectorCount}, поворот ${rotationDeg}°)`
        : (normalizedMode === "voronoi_tiles"
          ? `${getLayoutModeTitle(normalizedMode)}: ${state.layoutRun.fragments.length} фрагментов (плотность ${voronoiDensity}, зазор ${voronoiGapMm} мм)`
        : (normalizedMode === "shifted"
          ? `${getLayoutModeTitle(normalizedMode)}: ${state.layoutRun.fragments.length} фрагментов (сетка ${rows}x${cols}, смещение ${shiftPercent}%)`
          : `${getLayoutModeTitle(normalizedMode)}: ${state.layoutRun.fragments.length} фрагментов (сетка ${rows}x${cols})`)));
      return res;
    }

    function openInventoryStep1(forcedMode) {
      const modeOverride = String(forcedMode || "").trim();
      if (modeOverride) {
        state.layoutMode = modeOverride;
        if (state.layoutRun && typeof state.layoutRun === "object") {
          state.layoutRun.strategy = modeOverride;
        }
      } else {
        syncLayoutModeFromSelectedLayout();
      }
      if (isFragmentOnlyLayoutMode(state.layoutMode)) {
        void previewFragmentOnlyLayout(state.layoutMode);
        return;
      }
      // inventory_nfp_sa falls through to show step 1 parameters, solver runs on "Подобрать" click
      if (!state.selectedZoneId) {
        const firstZone = Array.isArray(state.zones) ? state.zones[0] : null;
        if (firstZone && Number.isFinite(Number(firstZone.id))) {
          state.selectedZoneId = Number(firstZone.id);
        } else {
          byId("workspaceInfo").textContent = "Сначала выберите зону.";
          return;
        }
      }
          byId("invDebugInfo").textContent = t("manual_mode_active", null, "Manual mode is active");
          byId("invUsedTags").textContent = `(${t("no_data", null, "none")})`;
      renderSplitEvents([]);
      byId("fillType").value = isInventoryLikeLayoutMode(state.layoutMode)
        ? "voronoi"
        : (state.layoutRun.fillType || "voronoi");
      byId("inventoryScenario").value = "A";
      if (byId("invAllowanceMm")) {
        byId("invAllowanceMm").value = Number(parseLocaleNumber(state.layoutRun && state.layoutRun.allowanceMm, 12)).toFixed(1);
      }
      const savedNapTol = Number(
        state.layoutRun
        && state.layoutRun.lastConstraints
        && state.layoutRun.lastConstraints.napToleranceDeg
      );
      if (Number.isFinite(savedNapTol)) {
        setNapToleranceInputValue(savedNapTol, true);
      } else if (byId("invNapTol")) {
        byId("invNapTol").dataset.userTouched = "0";
        if (state.layoutRun && typeof state.layoutRun === "object") {
          state.layoutRun.__napTolTouchedByUser = false;
        }
      }
      intarsiaStepPhase = 1;
      syncFillTypeUi();
      const fillGridModeEl = byId("fillGridMode");
      if (fillGridModeEl) fillGridModeEl.onchange = () => { syncGridModeUi(); if (state.layoutMode === "intarsia") previewIntarsiaFragmentsDraft(); };
      const fillCenterModeEl = byId("fillCenterMode");
      if (fillCenterModeEl) fillCenterModeEl.onchange = () => syncGridModeUi();
      const svgPickBtn = byId("intarsiaSvgPickBtn");
      const svgFileInput = byId("intarsiaSvgFileInput");
      const svgClearBtn = byId("intarsiaSvgClearBtn");
      if (svgPickBtn && svgFileInput) {
        svgPickBtn.onclick = () => svgFileInput.click();
        svgFileInput.onchange = () => {
          const file = svgFileInput.files && svgFileInput.files[0];
          const statusEl = byId("intarsiaSvgStatus");
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            const scaleEl = byId("intarsiaSvgScale");
            const manualScale = scaleEl ? Number(scaleEl.value) : 1;
            const result = parseSvgContours(ev.target.result, manualScale);
            if (result.error) {
              if (statusEl) statusEl.textContent = `Ошибка: ${result.error}`;
              return;
            }
            if (!result.contours.length) {
              if (statusEl) statusEl.textContent = "Контуры не найдены в SVG";
              return;
            }
            const existingFrags = Array.isArray(state.intarsiaSvgFragments) ? state.intarsiaSvgFragments : [];
            const maxFragId = existingFrags.reduce((m, f) => Math.max(m, Number(f && f.id || 0)), 0);
            const addedFrags = result.contours.map((pts, i) => ({ id: maxFragId + i + 1, points: pts }));
            state.intarsiaSvgFragments = existingFrags.concat(addedFrags);
            if (statusEl) statusEl.textContent = `Р"обавлено ${result.contours.length} контуров, всего ${state.intarsiaSvgFragments.length} (масштаб ${result.autoScale.toFixed(4)} мм/ед.)`;
            if (svgClearBtn) svgClearBtn.style.display = "";
            if (state.layoutMode === "intarsia") previewIntarsiaFragmentsDraft();
          };
          reader.readAsText(file);
          svgFileInput.value = "";
        };
      }
      if (svgClearBtn) {
        svgClearBtn.onclick = () => {
          state.intarsiaSvgFragments = null;
          const statusEl = byId("intarsiaSvgStatus");
          if (statusEl) statusEl.textContent = "Файл не выбран";
          svgClearBtn.style.display = "none";
          if (state.layoutMode === "intarsia") previewIntarsiaFragmentsDraft();
        };
      }
      if (state.layoutMode === "inventory_nfp_sa" || state.layoutMode === "inventory_voronoi_sa") {
        const minWEl = byId("minFragmentWidthMm");
        const minLEl = byId("minFragmentLengthMm");
        if (minWEl && !minWEl.dataset.userTouched) minWEl.value = "70";
        if (minLEl && !minLEl.dataset.userTouched) minLEl.value = "70";
      }
      byId("inventoryStep1Backdrop").style.display = "flex";
      ensureInventoryStep1ModalPosition();
      if (state.layoutMode === "intarsia") {
        previewIntarsiaFragmentsDraft();
      }
    }
    function closeInventoryStep1() { byId("inventoryStep1Backdrop").style.display = "none"; }
    function showInventoryProgress() {
      byId("inventoryProgressBackdrop").style.display = "flex";
      resetInventoryProgressMonotonic();
      if (inventoryProgressView && typeof inventoryProgressView.resetSteps === "function") inventoryProgressView.resetSteps();
      if (inventoryProgressView && typeof inventoryProgressView.resetKpis === "function") inventoryProgressView.resetKpis();
      inventoryProgressLastTs = 0;
      inventoryProgressLastSig = "";
      inventoryLiveHistory = [];
      inventoryLiveLastPhase = "";
      inventoryLiveLastReason = "";
      inventoryLiveLastEvalBucket = -1;
      inventoryLiveLastRenderAt = 0;
      if (inventoryProgressController && typeof inventoryProgressController.setHadEvent === "function") {
        inventoryProgressController.setHadEvent(false);
      }
      updateInventoryProgressKpis({});
      setInventoryProgressStatus("Ожидание телеметрии...");
      inventoryProgressStartedAt = Date.now();
      updateInventoryProgressTimer();
      if (inventoryProgressTimerId) clearInterval(inventoryProgressTimerId);
      inventoryProgressTimerId = setInterval(updateInventoryProgressTimer, 250);
    }
    function hideInventoryProgress() {
      stopServerPreviewProgressTicker();
      byId("inventoryProgressBackdrop").style.display = "none";
      resetInventoryProgressMonotonic();
      if (inventoryProgressTimerId) {
        clearInterval(inventoryProgressTimerId);
        inventoryProgressTimerId = null;
      }
      if (inventoryProgressView && typeof inventoryProgressView.resetSteps === "function") inventoryProgressView.resetSteps();
      inventoryProgressStartedAt = 0;
      setInventoryProgressStatus("Ожидание телеметрии...");
    }
    function openInventoryStep2() {
      byId("inventoryStep2Backdrop").style.display = "flex";
      prepareInventoryStep2Modal();
      syncInventoryStep2ModeUi();
      renderInventoryManualPanel();
    }
    function closeInventoryStep2() { byId("inventoryStep2Backdrop").style.display = "none"; }
    function openReplaceCandidateModal() { byId("replaceCandidateBackdrop").style.display = "flex"; }
    function closeReplaceCandidateModal() { byId("replaceCandidateBackdrop").style.display = "none"; }

    function previewIntarsiaFragmentsDraft() {
      if (intarsiaPreview && typeof intarsiaPreview.previewIntarsiaFragmentsDraft === "function") {
        intarsiaPreview.previewIntarsiaFragmentsDraft();
      }
    }

    function finishIntarsiaContour() {
      const pts = Array.isArray(state.draftIntarsiaContour) ? state.draftIntarsiaContour : [];
      if (pts.length < 3) return;
      if (!Array.isArray(state.intarsiaSvgFragments)) state.intarsiaSvgFragments = [];
      const newId = Date.now();
      state.intarsiaSvgFragments.push({ id: newId, points: pts.slice() });
      state.draftIntarsiaContour = [];
      const modeEl = byId("fillGridMode");
      if (modeEl) modeEl.value = "import_svg";
      previewIntarsiaFragmentsDraft();
      setWorkspaceTool("select");
      byId("workspaceInfo").textContent = "";
      if (propertyEditorView && typeof propertyEditorView.renderPropertyEditor === "function") {
        propertyEditorView.renderPropertyEditor();
      }
    }

    async function runInventoryPickFlow(options = {}) {
      if (state.layoutMode === "inventory_nfp_sa" && !(options && options.intarsiaAssignOnly)) {
        closeInventoryStep1();
        void previewNfpSaLayout();
        return;
      }
      if (state.layoutMode === "inventory_tiling" && !(options && options.intarsiaAssignOnly)) {
        closeInventoryStep1();
        void previewTilingLayout();
        return;
      }
      if (state.layoutMode === "inventory_voronoi_sa" && !(options && options.intarsiaAssignOnly)) {
        closeInventoryStep1();
        void previewVoronoiSaLayout();
        return;
      }
      const intarsiaAssignOnly = !!(options && options.intarsiaAssignOnly);
      const runSeq = ++inventoryRunSeq;
      const isStaleRun = () => runSeq !== inventoryRunSeq;
      const intarsiaStart = state.layoutMode === "intarsia" && !intarsiaAssignOnly;
      if (!intarsiaStart) closeInventoryStep1();
      resetInventoryProgressMonotonic();
      setInventoryProgress(0, t("progress_prepare", null, "Подготовка расчета"), { allowDecrease: true });
      showInventoryProgress();
      try {
        const zone = state.zones.find((z) => Number(z && z.id) === Number(state.selectedZoneId));
        if (!zone) throw new Error("zone_not_selected");
        const axis = state.layoutMode === "transverse" ? "x" : "y";
        const zoneNapDirectionDeg = getZoneNapDirectionDeg(zone);
        const fillType = String(byId("fillType").value || "voronoi");
        const inventoryScenario = "A";
        const inventoryLikeMode = isInventoryLikeLayoutMode(state.layoutMode);
        const manualMode = state.layoutMode === "inventory_manual";
        const intarsiaMode = state.layoutMode === "intarsia";
        const useDirectInventoryScenarioA = inventoryLikeMode && inventoryScenario === "A";
        const optimizationPreset = INVENTORY_OPTIMIZATION_PROFILE;
        const opt = optimizationPreset.options || {};
        const seed = Date.now();
        const qualityMode = "strict";
        const rasterMm = 2;
        if (intarsiaMode && !intarsiaAssignOnly) {
          // \u0418\u043d\u0442\u0430\u0440\u0441\u0438\u044f: clip SVG-\u043a\u043e\u043d\u0442\u0443\u0440\u043e\u0432 \u043f\u043e \u0437\u043e\u043d\u0435 \u2192 \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0437\u043e\u043d\u044b \u0438\u0437 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u0430
          const svgFrags = Array.isArray(state.intarsiaSvgFragments) ? state.intarsiaSvgFragments : [];
          const hasSvg = svgFrags.length > 0;
          const hasGrid = Array.isArray(state.layoutRun && state.layoutRun.fragments) && state.layoutRun.fragments.length > 0 && state.layoutRun.fillType !== "import_svg";
          if (!hasSvg && !hasGrid) {
            setInventoryProgress(100, "\u0418\u043d\u0442\u0430\u0440\u0441\u0438\u044f: \u043d\u0435\u0442 \u0444\u0440\u0430\u0433\u043c\u0435\u043d\u0442\u043e\u0432");
            hideInventoryProgress();
            byId("workspaceInfo").textContent = "\u0418\u043d\u0442\u0430\u0440\u0441\u0438\u044f: \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 SVG \u0444\u0430\u0439\u043b \u0441 \u043a\u043e\u043d\u0442\u0443\u0440\u0430\u043c\u0438 \u0438\u043b\u0438 \u043d\u0430\u0440\u0438\u0441\u0443\u0439\u0442\u0435 \u043f\u043e\u043b\u0438\u0433\u043e\u043d\u044b.";
            closeInventoryStep1();
            return;
          }
          setInventoryProgress(30, "\u0418\u043d\u0442\u0430\u0440\u0441\u0438\u044f: \u043d\u0430\u0440\u0435\u0437\u043a\u0430 \u0444\u0440\u0430\u0433\u043c\u0435\u043d\u0442\u043e\u0432 \u043f\u043e \u0437\u043e\u043d\u0435...");
          await applyIntarsiaFragmentsToZone(zone.id);
          if (isStaleRun()) return;
          if (String(state.layoutRun && state.layoutRun.status || "") !== "applied") {
            setInventoryProgress(100, "\u0418\u043d\u0442\u0430\u0440\u0441\u0438\u044f: \u043e\u0448\u0438\u0431\u043a\u0430 \u043d\u0430\u0440\u0435\u0437\u043a\u0438");
            hideInventoryProgress();
            closeInventoryStep1();
            return;
          }
          setInventoryProgress(70, "\u0418\u043d\u0442\u0430\u0440\u0441\u0438\u044f: \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u0435 \u0437\u043e\u043d...");
          await promoteFragmentsToZones();
          if (isStaleRun()) return;
          setInventoryProgress(100, "\u0418\u043d\u0442\u0430\u0440\u0441\u0438\u044f: \u0433\u043e\u0442\u043e\u0432\u043e");
          hideInventoryProgress();
          closeInventoryStep1();
          return;
        }
        const fragmentMinAlongMm = Math.max(0, Number((byId("fragmentMinAlongMm") && byId("fragmentMinAlongMm").value) || 60));
        const fragmentMinAcrossMm = Math.max(0, Number((byId("fragmentMinAcrossMm") && byId("fragmentMinAcrossMm").value) || 60));
        const zoneMaterial = zone.materialId ? getFurMaterialById(zone.materialId) : null;
        const fragmentMaxAlongMm = (zoneMaterial && Number.isFinite(Number(zoneMaterial.maxLengthMm))) ? Number(zoneMaterial.maxLengthMm) : null;
        const fragmentMaxAcrossMm = (zoneMaterial && Number.isFinite(Number(zoneMaterial.maxWidthMm))) ? Number(zoneMaterial.maxWidthMm) : null;

        if (manualMode) {
          setInventoryProgress(3, t("progress_manual_init", null, "Manual mode / initialization"));
          addInventoryProgressNote(t("note_manual_start", null, "Manual pick started: preparing workspace."));
        }

        // Worker bootstrap (grid/bitset prepass) with real progress updates.
        try {
          if (manualMode) {
            setInventoryProgress(10, "Worker: bootstrap");
            addInventoryProgressNote(t("note_worker_raster_init", null, "Worker: raster initialization."));
          }
          const pre = await runCoverWorkerJob(
            "bootstrap",
            zone.points || [],
            { qualityMode, rasterMm, seed, stepBudgetMs: 12, padCells: 2 },
            [],
            (msg) => {
              const pct = Math.min(35, Number(msg.progressPercent || 0) * 0.35);
              const title = String(msg.phase || "Подготовка");
              setInventoryProgress(pct, `Worker: ${title}`);
            }
          );
          if (isStaleRun()) return;
          if (pre && pre.gridSpec) state.layoutRun.workerGridSpec = pre.gridSpec;
          if (manualMode) {
            setInventoryProgress(28, "Worker: bootstrap");
            addInventoryProgressNote(t("note_worker_ready", null, "Worker ready."));
          }
        } catch (_) {
          // Fallback silently to server flow when worker is unavailable.
          if (isStaleRun()) return;
          if (manualMode) addInventoryProgressNote(t("note_worker_unavailable", null, "Worker unavailable, continuing without it."));
        }

        setInventoryProgress(40, t("progress_request_candidates", null, "Requesting candidates from DB"));
        if (manualMode) addInventoryProgressNote(t("note_request_candidates", null, "Requesting candidates from DB."));
        const common = {
          zone: { id: zone.id, points: zone.points, holes: Array.isArray(zone.holes) ? zone.holes.map(holeContour).filter((h) => h.length >= 3) : [] },
          directInventory: useDirectInventoryScenarioA,
          regularCompatibility: !!(intarsiaMode && intarsiaAssignOnly),
          thresholdBasis: (intarsiaMode && intarsiaAssignOnly) ? buildCurrentFragmentThresholdBasis() : null,
          axis,
          // For scenario A (direct inventory layout) we must allow tiny scraps too,
          // otherwise last holes can never be closed.
          minAreaMm2: Number(byId("invMinArea").value || 0),
          // In scenario A we do not pre-filter candidates by nap at fetch stage.
          // Nap is enforced during placement with allowed rotation tolerance.
          napDirectionDeg: (useDirectInventoryScenarioA || (intarsiaMode && intarsiaAssignOnly)) ? null : zoneNapDirectionDeg,
          napToleranceDeg: getEffectiveNapToleranceDegForCurrentRun(),
          // Coverage-first mode: for scenario A fetch a much wider pool.
          maxCandidates: Number(byId("invLimit").value || 300)
        };
        const candidatesRes = await api("/api/inventory/candidates", "POST", {
          ...common,
          onlyAvailable: true,
          includeScrapContour: true,
          materialId: manualMode ? (String((byId("invFurMaterialFilter") && byId("invFurMaterialFilter").value) || state.manualFurMaterialFilterId || "").trim() || undefined) : undefined
        });
        if (isStaleRun()) return;
        if (!candidatesRes.ok) throw new Error(candidatesRes.error || "candidates_failed");
        if (manualMode) {
          const cnt = Array.isArray(candidatesRes.items) ? candidatesRes.items.length : 0;
          setInventoryProgress(56, t("progress_request_candidates", null, "Requesting candidates from DB"));
          addInventoryProgressNote(t("note_candidates_received", { count: cnt }, `Candidates received: ${cnt}.`));
        }
        const workerCandidates = Array.isArray(candidatesRes.items)
          ? candidatesRes.items.map((c) => ({
              id: c && c.id,
              inventoryTag: c && c.inventoryTag,
              scrapContour: c && c.scrapContour
            }))
          : [];
        let prerankedCandidates = Array.isArray(candidatesRes.items) ? candidatesRes.items.slice() : [];
        try {
          setInventoryProgress(54, t("progress_worker_raster_prerank", null, "Worker / raster + pre-rank"));
          if (manualMode) addInventoryProgressNote(t("note_worker_prerank", null, "Worker: candidate pre-rank."));
          const preRankRes = await runCoverWorkerJob(
            "prerank",
            getEffectiveZonePoints(zone),
            { qualityMode, rasterMm, seed, stepBudgetMs: 12, padCells: 2 },
            workerCandidates,
            (msg) => {
              const base = 40;
              const span = 25;
              const pct = Math.min(65, base + (Number(msg.progressPercent || 0) / 100) * span);
              setInventoryProgress(pct, `Worker: ${String(msg.phase || "prerank")}`);
            }
          );
          if (isStaleRun()) return;
          if (preRankRes && Array.isArray(preRankRes.prerank) && preRankRes.prerank.length) {
            const rankMap = new Map();
            preRankRes.prerank.forEach((r, idx) => {
              const key = String(r.inventoryTag || r.id || "");
              if (key) rankMap.set(key, { idx, score: Number(r.score || 0) });
            });
            prerankedCandidates.sort((a, b) => {
              const ka = String((a && (a.inventoryTag || a.id)) || "");
              const kb = String((b && (b.inventoryTag || b.id)) || "");
              const ra = rankMap.has(ka) ? rankMap.get(ka).idx : 1e9;
              const rb = rankMap.has(kb) ? rankMap.get(kb).idx : 1e9;
              if (ra !== rb) return ra - rb;
              const sa = rankMap.has(ka) ? rankMap.get(ka).score : -1e9;
              const sb = rankMap.has(kb) ? rankMap.get(kb).score : -1e9;
              return sb - sa;
            });
          }
          if (manualMode) {
            setInventoryProgress(66, "Worker: pre-rank");
            addInventoryProgressNote(t("progress_worker_prerank_done", null, "Pre-rank completed."));
          }
        } catch (_) {
          // Keep server candidate order if worker pre-rank fails.
          if (isStaleRun()) return;
          if (manualMode) addInventoryProgressNote(t("note_prerank_skipped", null, "Pre-rank skipped, using DB order."));
        }
        try {
          const usage = state.tagUsage && typeof state.tagUsage === "object" ? state.tagUsage : {};
          prerankedCandidates = prerankedCandidates
            .map((c, idx) => {
              const tag = String((c && (c.inventoryTag || c.id)) || "");
              const used = Number(usage[tag] || 0);
              return { c, idx, used };
            })
            .sort((a, b) => {
              if (a.used !== b.used) return a.used - b.used;
              return a.idx - b.idx;
            })
            .map((x) => x.c);
        } catch (_) {}

        if (manualMode) {
          stopServerPreviewProgressTicker();
          closeInventoryProgressStream();
          setInventoryProgress(82, t("progress_manual_tray_prepare", null, "Manual mode / tray preparation"));
          addInventoryProgressNote(t("note_prepare_manual_tray", null, "Preparing tray for manual layout."));
          state.layoutRun.fragments = [];
          state.layoutRun.active = true;
          state.layoutRun.status = "preview";
          state.layoutRun.fillType = fillType;
          state.layoutRun.strategy = state.layoutMode;
          state.layoutRun.inventoryScenario = inventoryScenario;
          state.layoutRun.selectedZoneId = zone.id;
          if (!Array.isArray(state.layoutRun.placements) || state.layoutRun.placements.length === 0) {
            state.layoutRun.placements = [];
          }
          state.layoutRun.topChoicesByFragment = {};
          state.layoutRun.selectedPlacementFragmentId = null;
          state.layoutRun.candidatePool = prerankedCandidates;
          state.layoutRun.lastFilters = { materialId: "", allowedStatuses: [] };
          state.layoutRun.lastConstraints = {
            napDirectionDeg: zoneNapDirectionDeg,
            napToleranceDeg: getEffectiveNapToleranceDegForCurrentRun(),
            napPolicy: "normal",
            napWeight: 1.0,
            allowFlip180: false,
            minAlongMm: fragmentMinAlongMm || null,
            maxAlongMm: fragmentMaxAlongMm || null,
            minAcrossMm: fragmentMinAcrossMm || null,
            maxAcrossMm: fragmentMaxAcrossMm || null,
            minAreaMm2: Number(byId("invMinArea").value || 0),
            maxAreaMm2: null,
            minCoverageRatio: 0.75
          };
          state.layoutRun.lastAxis = axis;
          state.layoutRun.lastNapDirectionDeg = zoneNapDirectionDeg;
          state.layoutRun.lastSeed = Number(seed);
          {
            const prevAllowance = parseLocaleNumber(state.layoutRun && state.layoutRun.allowanceMm, 12);
            const nextAllowance = getCurrentManualAllowanceMm();
            // v5.0: allowanceMm может быть 0 (ядро = тело). Используем isFinite, не > 0.
            state.layoutRun.allowanceMm = Number.isFinite(Number(nextAllowance))
              ? Number(nextAllowance)
              : (Number.isFinite(Number(prevAllowance)) ? Number(prevAllowance) : 12);
          }
          state.layoutRun.previewLayers = { pieceIntersections: [], visibleArea: [], coverageHoles: [] };
          state.layoutRun.splitEvents = [];
          state.layoutRun.stats = { violations: 0, intersections: 0, uncovered: 1 };
          state.layoutRun.manual = {
            suggestions: [],
            lastMetrics: null,
            selectedCandidateTag: "",
            activePiece: null,
            lastEvalContours: null,
            statusNote: "нет активного",
            selectedPlacementIndex: -1
          };
          byId("invTotalFragments").textContent = "0";
          byId("invViolations").textContent = "0";
          byId("invIntersections").textContent = "0";
          byId("invUncovered").textContent = "1";
          byId("invCoveragePercent").textContent = "0.00";
          byId("invResidualArea").textContent = Number(zoneEffectiveArea(zone) || 0).toFixed(1);
          byId("invUsefulArea").textContent = "0.0";
          byId("invUsedScrapArea").textContent = "0.0";
          byId("invScrapUtilization").textContent = "0.00";
          byId("invScrapWaste").textContent = "100.00";
          byId("invOverlapArea").textContent = "0.0";
          byId("invCandidateAreaBudget").textContent = "0.0";
          byId("invDbCandidates").textContent = String(Array.isArray(prerankedCandidates) ? prerankedCandidates.length : 0);
          byId("invCompatibleCandidates").textContent = String(Array.isArray(prerankedCandidates) ? prerankedCandidates.length : 0);
          byId("invStrategyUsed").textContent = "manual";
          const _step2ModalManual = byId("inventoryStep2Modal"); if (_step2ModalManual) _step2ModalManual.classList.remove("strategy-nfp-sa");
          byId("invMatchedPct").textContent = "0.00";
          byId("invKpiCoveragePct").textContent = "0.00";
          byId("invTailCoverageStart").textContent = "-";
          byId("invTailOversizeAlpha").textContent = "-";
          byId("invRejectedOversize").textContent = "0";
          byId("invRejectedOverlap").textContent = "0";
          byId("invRejectedLowGain").textContent = "0";
          byId("invRejectedOutside").textContent = "0";
          byId("invDebugInfo").textContent = t("manual_mode_active", null, "Manual mode is active");
          byId("invUsedTags").textContent = `(${t("no_data", null, "none")})`;
          renderPlacementRows(Array.isArray(state.layoutRun.placements) ? state.layoutRun.placements : []);
          renderSplitEvents([]);
          // Ensure contours + seam reserve layers are visible in manual mode
          state.layers.pfullZ = true;
          state.layers.pcoreZ = true;
          const _pfullChk = byId("layerPfullZ"); if (_pfullChk) _pfullChk.checked = true;
          const _pcoreChk = byId("layerPcoreZ"); if (_pcoreChk) _pcoreChk.checked = true;
          renderInventoryManualPanel();
          openInventoryStep2();
          if (isStaleRun()) return;
          setInventoryProgress(100, "Ручной режим / готово");
            addInventoryProgressNote(t("note_worker_raster_init", null, "Worker: raster initialization."));
          hideInventoryProgress();
          renderScene();
          return;
        }

        setInventoryProgress(68, t("progress_server_preview", null, "Server preview calculation"));
        startServerPreviewProgressTicker();
        const progressToken = createProgressToken();
        openInventoryProgressStream(progressToken);
        const placementStrategy = (inventoryLikeMode)
          ? "bestFit"
          : String(byId("placementStrategy").value || "bestFit");
        const filters = {
          materialId: "",
          allowedStatuses: []
        };
        const isRegularIntarsiaAssignOnly = !!(intarsiaMode && intarsiaAssignOnly);
        const constraints = {
          napDirectionDeg: zoneNapDirectionDeg,
          napToleranceDeg: getEffectiveNapToleranceDegForCurrentRun(),
          napPolicy: "normal",
          napWeight: 1.0,
          allowFlip180: false,
          minAlongMm: fragmentMinAlongMm || null,
          maxAlongMm: fragmentMaxAlongMm || null,
          minAcrossMm: fragmentMinAcrossMm || null,
          maxAcrossMm: fragmentMaxAcrossMm || null,
          minAreaMm2: Number(byId("invMinArea").value || 0),
          maxAreaMm2: null,
          minCoverageRatio: 0.75,
          minFitScore: isRegularIntarsiaAssignOnly ? 8 : 68,
          maxCandidatesPerFragment: 22,
          requireScrapContour: true
        };
        const seamAllowanceReserveMm = parseLocaleNumber(state.layoutRun && state.layoutRun.allowanceMm, null);
        const normalizeRules = {
          minFragmentWidthMm: Number(byId("minFragmentWidthMm").value || 0),
          minFragmentLengthMm: Number(byId("minFragmentLengthMm").value || 0),
          simplifyToleranceMm: null,
          mergeSmallFragments: false,
          seamAllowanceReserveMm: Number.isFinite(seamAllowanceReserveMm) ? seamAllowanceReserveMm : null
        };
        const isAssignOnlyScenario = inventoryLikeMode && inventoryScenario === "B";
        const previewTimeoutMs = useDirectInventoryScenarioA
          ? Math.max(45000, Math.min(180000, Number(opt.hardMaxSolveMs || 90000) + 15000))
          : ((intarsiaMode && intarsiaAssignOnly) ? 300000 : (isAssignOnlyScenario ? 120000 : 30000));
        byId("invDbCandidates").textContent = String(Array.isArray(prerankedCandidates) ? prerankedCandidates.length : 0);
        byId("invCompatibleCandidates").textContent = "вЂ¦";
        setInventoryProgressStatus(
          intarsiaMode && intarsiaAssignOnly
            ? "Серверный подбор по фрагментам запущен. На сложном кейсе расчёт может занять до 1 минуты."
            : "Серверный расчёт запущен. Ожидаем телеметрию."
        );
        const basePreviewPayload = {
          ...common,
          progressToken,
          fillType,
          directInventory: useDirectInventoryScenarioA,
          assignOnly: isAssignOnlyScenario,
          fragments: isAssignOnlyScenario
            ? ((state.layoutRun.active && Number(state.layoutRun.selectedZoneId || 0) === Number(zone.id))
              ? (state.layoutRun.fragments || [])
              : [])
            : [],
          placementStrategy,
          density: toScale10(byId("fillDensity").value, 5),
          variability: toScale10(byId("fillVariability").value, 5),
          anisotropy: toScale10(byId("fillAnisotropy").value, 5),
          rows: Number(byId("fillRows").value || 5),
          cols: Number(byId("fillCols").value || 5),
          gapX: Number(byId("fillGapX").value || 0),
          gapY: Number(byId("fillGapY").value || 0),
          cornerRadius: Number(byId("fillCornerRadius").value || 0),
          minFragmentWidthMm: Number(byId("minFragmentWidthMm").value || 0) || 0,
          minFragmentLengthMm: Number(byId("minFragmentLengthMm").value || 0) || 0,
          seamAllowanceReserveMm: Number.isFinite(seamAllowanceReserveMm) ? seamAllowanceReserveMm : 0,
          strictCoverage: useDirectInventoryScenarioA ? !!opt.strictCoverage : true,
          strictCoverageHard: useDirectInventoryScenarioA ? (opt.strictCoverageHard === true) : false,
          coverageTarget: useDirectInventoryScenarioA ? Number(opt.coverageTarget || 0.99999) : 0.99999,
          coverageEps: useDirectInventoryScenarioA ? Number(opt.coverageEps || 0.0005) : 0.0005,
          modeId: state.layoutMode === "inventory_split_return" ? "inventory_split_return" : undefined,
          splitReturnEnabled: state.layoutMode === "inventory_split_return",
          objectiveMode: useDirectInventoryScenarioA ? String(opt.objectiveMode || "default") : undefined,
          objectiveMinEfficiency: useDirectInventoryScenarioA ? Number(opt.objectiveMinEfficiency || 0.82) : undefined,
          objectivePiecePenalty: useDirectInventoryScenarioA ? Number(opt.objectivePiecePenalty || 0.18) : undefined,
          objectiveFragmentPenalty: useDirectInventoryScenarioA ? Number(opt.objectiveFragmentPenalty || 0.28) : undefined,
          minEfficiencyBase: useDirectInventoryScenarioA ? Number(opt.minEfficiencyBase || 0.20) : undefined,
          phaseAEndCoverage: useDirectInventoryScenarioA ? Number(opt.phaseAEndCoverage || 0.22) : undefined,
          phaseAInsideMin: useDirectInventoryScenarioA ? Number(opt.phaseAInsideMin || 0.90) : undefined,
          phaseAMaxOverlap: useDirectInventoryScenarioA ? Number(opt.phaseAMaxOverlap || 0.08) : undefined,
          phaseBEfficiencyMin: useDirectInventoryScenarioA ? Number(opt.phaseBEfficiencyMin || 0.42) : undefined,
          phaseAMinPieces: useDirectInventoryScenarioA ? Number(opt.phaseAMinPieces || 1) : undefined,
          phaseAMinGainMm2: useDirectInventoryScenarioA ? Number(opt.phaseAMinGainMm2 || 4000) : undefined,
          phaseAMinGainShare: useDirectInventoryScenarioA ? Number(opt.phaseAMinGainShare || 0.03) : undefined,
          minGainVisibleMm2: useDirectInventoryScenarioA ? (() => { const w = Number(byId("minFragmentWidthMm").value || 0); const l = Number(byId("minFragmentLengthMm").value || 0); return (w > 0 && l > 0) ? w * l : Number(opt.minGainVisibleMm2 || 10000); })() : undefined,
          minSpanMm: useDirectInventoryScenarioA ? (() => { const w = Number(byId("minFragmentWidthMm").value || 0); const l = Number(byId("minFragmentLengthMm").value || 0); return Math.max(w, l) > 0 ? Math.max(w, l) : Number(opt.minSpanMm || 100); })() : undefined,
          solverMode: useDirectInventoryScenarioA ? String(opt.solverMode || "phasedV1") : "legacyBoolean",
          maxSolveMs: useDirectInventoryScenarioA ? Number(opt.maxSolveMs || 60000) : 22000,
          hardMaxSolveMs: useDirectInventoryScenarioA ? Number(opt.hardMaxSolveMs || 180000) : 22000,
          maxPieces: useDirectInventoryScenarioA ? Number(opt.maxPieces || 240) : 48,
          maxPointsPerCandidate: useDirectInventoryScenarioA ? Number(opt.maxPointsPerCandidate || 120) : 90,
          minGainAreaMm2: useDirectInventoryScenarioA ? Number(opt.minGainAreaMm2 || 1) : undefined,
          enforceMinGainByArea: useDirectInventoryScenarioA ? (opt.enforceMinGainByArea !== false) : undefined,
          coverageFirst: useDirectInventoryScenarioA ? !!opt.coverageFirst : undefined,
          enforceTimeBudget: useDirectInventoryScenarioA ? !!opt.enforceTimeBudget : true,
          maxRepairAttempts: useDirectInventoryScenarioA ? Number(opt.maxRepairAttempts || 4) : undefined,
          repairWindow: useDirectInventoryScenarioA ? Number(opt.repairWindow || 28) : undefined,
          tailCoverageStart: useDirectInventoryScenarioA ? Number(opt.tailCoverageStart || 0.93) : undefined,
          tailResidualRatio: useDirectInventoryScenarioA ? Number(opt.tailResidualRatio || 0.03) : undefined,
          tailResidualLooseRatio: useDirectInventoryScenarioA ? Number(opt.tailResidualLooseRatio || 0.015) : undefined,
          tailMinEfficiency: useDirectInventoryScenarioA ? Number(opt.tailMinEfficiency || 0.30) : undefined,
          tailMinEfficiencyLoose: useDirectInventoryScenarioA ? Number(opt.tailMinEfficiencyLoose || 0.18) : undefined,
          pocketModeStartRatio: useDirectInventoryScenarioA ? Number(opt.pocketModeStartRatio || 0.08) : undefined,
          pocketAreaK: useDirectInventoryScenarioA ? Number(opt.pocketAreaK || 2.4) : undefined,
          tailOversizeAlpha: useDirectInventoryScenarioA ? Number(opt.tailOversizeAlpha || 2.4) : undefined,
          tailStallTrigger: useDirectInventoryScenarioA ? Number(opt.tailStallTrigger || 3) : undefined,
          tailPenaltyBoost: useDirectInventoryScenarioA ? Number(opt.tailPenaltyBoost || 2.2) : undefined,
          tailMaxPlacements: useDirectInventoryScenarioA ? Number(opt.tailMaxPlacements || 14) : undefined,
          tailCapResidualRatio: useDirectInventoryScenarioA ? Number(opt.tailCapResidualRatio || 0.03) : undefined,
          tailMinGainShare: useDirectInventoryScenarioA ? Number(opt.tailMinGainShare || 0.22) : undefined,
          tailMinGainCapMm2: useDirectInventoryScenarioA ? Number(opt.tailMinGainCapMm2 || 280) : undefined,
          layerPolicy: useDirectInventoryScenarioA ? String(opt.layerPolicy || "first_on_top") : undefined,
          maxPieceOverlap: useDirectInventoryScenarioA ? Number(opt.maxPieceOverlap || 0.95) : undefined,
          overlapPenalty: useDirectInventoryScenarioA ? Number(opt.overlapPenalty || 0.25) : undefined,
          outsidePenalty: useDirectInventoryScenarioA ? Number(opt.outsidePenalty || 0.05) : undefined,
          minInsideRatio: useDirectInventoryScenarioA ? Number(opt.minInsideRatio || 0.01) : undefined,
          qualityMode,
          rasterMm,
          seed,
          filters,
          constraints,
          normalizeRules,
          candidates: prerankedCandidates
        };
        let previewRes;
        let assignOnlyBaseFragments = null;
        if (intarsiaMode && intarsiaAssignOnly) {
        setInventoryProgress(68, t("progress_server_preview", null, "Server preview calculation"));
          let stageFragments = Array.isArray(state.layoutRun.fragments)
            ? state.layoutRun.fragments.map((f, idx) => ({
              id: Number(f && f.id) || (idx + 1),
              points: Array.isArray(f && f.points) ? f.points : []
            }))
            : [];
          if (!stageFragments.length) {
            const splitRes = generateFragmentsForZone(getEffectiveZonePoints(zone), {
              fillType: "regular",
              rows: Number(byId("fillRows").value || 5),
              cols: Number(byId("fillCols").value || 5),
              gapX: Number(byId("fillGapX").value || 0),
              gapY: Number(byId("fillGapY").value || 0),
              cornerRadius: Number(byId("fillCornerRadius").value || 0),
              variability: 0
            });
            stageFragments = Array.isArray(splitRes && splitRes.fragments) ? splitRes.fragments : [];
            stageFragments = clipFragmentsByZoneDomain(stageFragments, zone);
          }
          if (!stageFragments.length) throw new Error("intarsia_split_empty");
          byId("invTotalFragments").textContent = String(stageFragments.length);
          updateInventoryProgressKpis({ pieces: stageFragments.length });
          assignOnlyBaseFragments = stageFragments.map((f, idx) => ({
            id: Number(f && f.id) || (idx + 1),
            points: Array.isArray(f && f.points) ? f.points : []
          }));
          previewRes = await api(`/api/layout/fill/preview?progressToken=${encodeURIComponent(progressToken)}`, "POST", {
            ...basePreviewPayload,
            fillType: "regular",
            assignOnly: true,
            directInventory: false,
            fragments: stageFragments
          }, previewTimeoutMs);
        } else {
          previewRes = await api(`/api/layout/fill/preview?progressToken=${encodeURIComponent(progressToken)}`, "POST", basePreviewPayload, previewTimeoutMs);
        }
        if (isStaleRun()) return;
        if (!previewRes.ok) throw new Error(previewRes.error || "preview_failed");
        updateLayoutContractMonitor(previewRes._contractDiag, {
          endpoint: "fill/preview",
          layoutType: previewRes.layoutType || fillType || "—",
          payloadHasHoles: Array.isArray(zone.holes) && zone.holes.length > 0
        });
        stopServerPreviewProgressTicker();
        closeInventoryProgressStream();
        if (inventoryLikeMode && inventoryScenario === "B" && (!Array.isArray(previewRes.fragments) || previewRes.fragments.length === 0)) {
          throw new Error("fragments_required_for_mode_b");
        }

        setInventoryProgress(96, t("progress_result_build", null, "Building result"));
        const previewFragments = Array.isArray(previewRes.fragments)
          ? previewRes.fragments.map((f, idx) => ({
            ...f,
            id: Number(f && f.id) || (idx + 1),
            points: Array.isArray(f && f.points) ? f.points : [],
            ownerPlacementIndex: Number.isFinite(Number(f && f.ownerPlacementIndex))
              ? Number(f.ownerPlacementIndex)
              : null,
            ownerPlacementId: Number.isFinite(Number(f && f.ownerPlacementId))
              ? Number(f.ownerPlacementId)
              : null
          }))
          : [];
        if (intarsiaMode && intarsiaAssignOnly && Array.isArray(assignOnlyBaseFragments) && assignOnlyBaseFragments.length) {
          // In intarsia step-2 we keep UI fragment geometry from step-1 regular grid.
          // Preview fragments may contain transformed/matched contours and must not replace the grid view.
          state.layoutRun.fragments = assignOnlyBaseFragments;
          state.layoutRun.matchedFragmentGeometry = previewFragments;
          state.layers.pieceBorders = true;
          const _pbChk = byId("layerPieceBorders"); if (_pbChk) _pbChk.checked = true;
        } else {
          state.layoutRun.fragments = clipFragmentsByZoneDomain(previewFragments, zone);
          state.layoutRun.matchedFragmentGeometry = null;
        }
        state.layoutRun.active = true;
        state.layoutRun.status = "preview";
        state.layoutRun.fillType = fillType;
        state.layoutRun.strategy = state.layoutMode;
        state.layoutRun.inventoryScenario = inventoryScenario;
        state.layoutRun.selectedZoneId = zone.id;
        state.layoutRun.placements = Array.isArray(previewRes.placements) ? previewRes.placements : [];
        state.layoutRun.candidatePool = prerankedCandidates;
        state.layoutRun.resultStatus = String(previewRes.resultStatus || "ok");
        state.layoutRun.failedReason = previewRes.failedReason || null;
        state.layoutRun.algorithmTrace = previewRes.algorithmTrace || null;
        state.layoutRun.paramsSnapshot = previewRes.paramsSnapshot && typeof previewRes.paramsSnapshot === "object"
          ? previewRes.paramsSnapshot
          : null;
        state.layoutRun.lastFilters = filters;
        state.layoutRun.lastConstraints = constraints;
        state.layoutRun.lastAxis = axis;
        state.layoutRun.lastNapDirectionDeg = zoneNapDirectionDeg;
        state.layoutRun.lastSeed = Number(previewRes.seedUsed || seed);
        state.layoutRun.gridSpec = previewRes.gridSpec || null;
        state.layoutRun.previewLayers = previewRes.previewLayers && typeof previewRes.previewLayers === "object"
          ? previewRes.previewLayers
          : { pieceIntersections: [], visibleArea: [] };
        state.layoutRun.splitEvents = Array.isArray(previewRes.splitEvents) ? previewRes.splitEvents : [];
        state.selectedFragmentId = null;
        state.layoutRun.stats = previewRes.stats || { violations: 0, intersections: 0, uncovered: 0 };
        byId("invTotalFragments").textContent = String(state.layoutRun.fragments.length);
        byId("invViolations").textContent = String(state.layoutRun.stats.violations || 0);
        byId("invIntersections").textContent = String(state.layoutRun.stats.intersections || 0);
        byId("invUncovered").textContent = String(state.layoutRun.stats.uncovered || 0);
        byId("invCoveragePercent").textContent = Number(previewRes.coveragePercent || 0).toFixed(2);
        byId("invResidualArea").textContent = Number(previewRes.residualAreaMm2 || 0).toFixed(1);
        const scrapUsage = previewRes.scrapUsage && typeof previewRes.scrapUsage === "object" ? previewRes.scrapUsage : {};
        const visibleMetrics = previewRes.visibleMetrics && typeof previewRes.visibleMetrics === "object" ? previewRes.visibleMetrics : {};
        const diagnostics = previewRes.diagnostics && typeof previewRes.diagnostics === "object" ? previewRes.diagnostics : {};
        const usefulAreaMm2 = Number(
          Number.isFinite(Number(visibleMetrics.usefulAreaMm2))
            ? visibleMetrics.usefulAreaMm2
            : (previewRes.usedAreaMm2 || scrapUsage.usefulAreaMm2 || 0)
        );
        const selectedInZoneAreaMm2 = Number(
          Number.isFinite(Number(visibleMetrics.selectedInZoneAreaMm2))
            ? visibleMetrics.selectedInZoneAreaMm2
            : (previewRes.selectedInZoneAreaMm2 || previewRes.selectedPiecesAreaMm2 || scrapUsage.usedScrapAreaMm2 || 0)
        );
        const overlapAreaMm2 = Number(
          Number.isFinite(Number(visibleMetrics.overlapAreaMm2))
            ? visibleMetrics.overlapAreaMm2
            : (previewRes.overlapAreaMm2 || 0)
        );
        const utilizationPct = Number(
          Number.isFinite(Number(visibleMetrics.utilizationPct))
            ? visibleMetrics.utilizationPct
            : (previewRes.utilizationPct || scrapUsage.scrapUtilizationPercent || 0)
        );
        const wastePct = Number(Number.isFinite(Number(previewRes.wastePct)) ? previewRes.wastePct : (100 - utilizationPct));
        byId("invUsefulArea").textContent = usefulAreaMm2.toFixed(1);
        byId("invUsedScrapArea").textContent = selectedInZoneAreaMm2.toFixed(1);
        byId("invScrapUtilization").textContent = utilizationPct.toFixed(2);
        byId("invScrapWaste").textContent = Math.max(0, wastePct).toFixed(2);
        byId("invOverlapArea").textContent = overlapAreaMm2.toFixed(1);
        byId("invCandidateAreaBudget").textContent = Number(previewRes.candidateAreaBudgetMm2 || 0).toFixed(1);
        byId("invDbCandidates").textContent = String(Number(candidatesRes.sourceCandidatesTotal || candidatesRes.dbCandidates || 0));
        byId("invCompatibleCandidates").textContent = String(Number(previewRes.compatibleCandidates || 0));
        const kpi = previewRes.kpi && typeof previewRes.kpi === "object" ? previewRes.kpi : {};
        byId("invStrategyUsed").textContent = String(kpi.strategyUsed || previewRes.placementStrategy || "-");
        const _step2ModalDirect = byId("inventoryStep2Modal"); if (_step2ModalDirect) _step2ModalDirect.classList.remove("strategy-nfp-sa");
        byId("invMatchedPct").textContent = Number(kpi.matchedPct || 0).toFixed(2);
        byId("invKpiCoveragePct").textContent = Number(kpi.coveragePct || previewRes.coveragePercent || 0).toFixed(2);
        const opts = previewRes.paramsSnapshot && previewRes.paramsSnapshot.options
          ? previewRes.paramsSnapshot.options
          : {};
        const tailCoverageStartVal = Number.isFinite(Number(opts.tailCoverageStart))
          ? Number(opts.tailCoverageStart)
          : Number(opt.tailCoverageStart || 0.93);
        const tailOversizeAlphaVal = Number.isFinite(Number(opts.tailOversizeAlpha))
          ? Number(opts.tailOversizeAlpha)
          : Number(opt.tailOversizeAlpha || 2.4);
        byId("invTailCoverageStart").textContent = tailCoverageStartVal.toFixed(3);
        byId("invTailOversizeAlpha").textContent = tailOversizeAlphaVal.toFixed(2);
        const warningsText = Array.isArray(previewRes.warnings) && previewRes.warnings.length
          ? previewRes.warnings.join("\n")
          : "OK";
        const trace = previewRes.algorithmTrace && previewRes.algorithmTrace.steps
          ? previewRes.algorithmTrace.steps
          : null;
        const rej = trace && trace.placement_search && trace.placement_search.rejected
          ? trace.placement_search.rejected
          : {};
        byId("invRejectedOversize").textContent = String(Number(rej.oversize || 0));
        byId("invRejectedOverlap").textContent = String(Number(rej.overlap || 0));
        byId("invRejectedLowGain").textContent = String(Number(rej.lowGain || 0));
        byId("invRejectedOutside").textContent = String(Number(rej.outside || 0));
        appendServerTraceProgress(trace);
        const matchedCount = Array.isArray(state.layoutRun.placements)
          ? state.layoutRun.placements.filter((p) => String(p && p.status || "") === "matched").length
          : 0;
        const progressUtilizationPct = Number(
          Number.isFinite(Number(visibleMetrics && visibleMetrics.utilizationPct))
            ? visibleMetrics.utilizationPct
            : (previewRes.utilizationPct || scrapUsage.scrapUtilizationPercent || 0)
        );
        updateInventoryProgressKpis({
          pieces: matchedCount,
          coverage: Number(previewRes.coveragePercent || 0),
          utilization: Number(progressUtilizationPct),
          tail: Number(
            Number.isFinite(Number(diagnostics.outsideShareOfSelectedPct))
              ? diagnostics.outsideShareOfSelectedPct
              : (scrapUsage.scrapWastePercent || 0)
          )
        });
        const traceText = trace
          ? [
              `trace.candidate_pool.compatible=${Number(trace.candidate_pool && trace.candidate_pool.compatible || 0)}`,
              `trace.candidate_pool.templates=${Number(trace.candidate_pool && trace.candidate_pool.templates || 0)}`,
              `trace.placement_search.evaluated=${Number(trace.placement_search && trace.placement_search.evaluated || 0)}`,
              `trace.placement_search.placed=${Number(trace.placement_search && trace.placement_search.placed || 0)}`,
              `trace.strict_final_check.fullCoverageOk=${!!(trace.strict_final_check && trace.strict_final_check.fullCoverageOk)}`
            ].join("\n")
          : "";
        const funnel = candidatesRes && candidatesRes.poolFunnel && typeof candidatesRes.poolFunnel === "object"
          ? candidatesRes.poolFunnel
          : null;
        const funnelThresholds = funnel && funnel.thresholds && typeof funnel.thresholds === "object"
          ? funnel.thresholds
          : null;
        const funnelBasis = funnel && funnel.thresholdBasis && typeof funnel.thresholdBasis === "object"
          ? funnel.thresholdBasis
          : null;
        const funnelRejected = funnel && funnel.rejected && typeof funnel.rejected === "object"
          ? funnel.rejected
          : null;
        const funnelText = funnel
          ? [
              `pool.totalSource=${Number(funnel.totalSource || 0)}`,
              `pool.afterStatus=${Number(funnel.afterStatus || 0)}`,
              `pool.afterMaterial=${Number(funnel.afterMaterial || 0)}`,
              `pool.afterContour=${Number(funnel.afterContour || 0)}`,
              `pool.afterQuality=${Number(funnel.afterQuality || 0)}`,
              `pool.afterNap=${Number(funnel.afterNap || 0)}`,
              `pool.afterAreaBBoxSpan=${Number(funnel.afterAreaBBoxSpan || 0)}`,
              `pool.afterScoring=${Number(funnel.afterScoring || 0)}`,
              `pool.poolCandidates=${Number(funnel.poolCandidates || 0)}`,
              funnelBasis ? `pool.thresholdBasis=${String(funnelBasis.source || funnelBasis.kind || "-")}` : "",
              funnelThresholds ? `pool.threshold.minAreaMm2=${Number(funnelThresholds.minAreaMm2 || 0)}` : "",
              funnelThresholds ? `pool.threshold.minWidthMm=${Number(funnelThresholds.minWidthMm || 0)}` : "",
              funnelThresholds ? `pool.threshold.minHeightMm=${Number(funnelThresholds.minHeightMm || 0)}` : "",
              funnelThresholds ? `pool.threshold.minSpanMm=${Number(funnelThresholds.minSpanMm || 0)}` : "",
              funnelRejected
                ? Object.keys(funnelRejected).sort().map((k) => `pool.reject.${k}=${Number(funnelRejected[k] || 0)}`).join("\n")
                : ""
            ].filter(Boolean).join("\n")
          : "";
        const compat = diagnostics && diagnostics.compatibilityBreakdown && typeof diagnostics.compatibilityBreakdown === "object"
          ? diagnostics.compatibilityBreakdown
          : null;
        const compatRejected = compat && compat.rejected && typeof compat.rejected === "object"
          ? compat.rejected
          : null;
        const compatText = compat
          ? [
              `compat.input=${Number(compat.input || 0)}`,
              `compat.compatible=${Number(compat.compatible || 0)}`,
              compatRejected
                ? Object.keys(compatRejected).sort().map((k) => `compat.reject.${k}=${Number(compatRejected[k] || 0)}`).join("\n")
                : ""
            ].filter(Boolean).join("\n")
          : "";
        const placementBreakdown = diagnostics && diagnostics.placementBreakdown && typeof diagnostics.placementBreakdown === "object"
          ? diagnostics.placementBreakdown
          : null;
        state.layoutRun.topChoicesByFragment = placementBreakdown && placementBreakdown.topChoicesByFragment && typeof placementBreakdown.topChoicesByFragment === "object"
          ? placementBreakdown.topChoicesByFragment
          : {};
        state.layoutRun.selectedPlacementFragmentId = null;
        function pushPlacementMetric(lines, prefix, value) {
          if (!value || typeof value !== "object") return;
          for (const key of Object.keys(value).sort()) {
            const child = value[key];
            if (child && typeof child === "object" && !Array.isArray(child)) {
              pushPlacementMetric(lines, `${prefix}.${key}`, child);
              continue;
            }
            if (typeof child === "number" || (typeof child === "string" && child.trim() !== "" && Number.isFinite(Number(child)))) {
              lines.push(`${prefix}.${key}=${Number(child)}`);
            }
          }
        }
        const placementText = (() => {
          if (!placementBreakdown) return "";
          const lines = [];
          for (const k of Object.keys(placementBreakdown).sort()) {
            const v = placementBreakdown[k];
            if (k === "rejected" && v && typeof v === "object") {
              for (const rk of Object.keys(v).sort()) {
                lines.push(`place.reject.${rk}=${Number(v[rk] || 0)}`);
              }
              continue;
            }
            if (k === "rejectedSamples" && v && typeof v === "object") {
              const sampleKinds = Object.keys(v).sort();
              const sampleTotal = sampleKinds.reduce((acc, sk) => {
                const arr = Array.isArray(v[sk]) ? v[sk] : [];
                return acc + arr.length;
              }, 0);
              lines.push(`place.rejectedSamples.total=${sampleTotal}`);
              for (const sk of sampleKinds) {
                const arr = Array.isArray(v[sk]) ? v[sk] : [];
                lines.push(`place.rejectedSamples.${sk}=${arr.length}`);
              }
              continue;
            }
            if (k === "primaryRejected" && v && typeof v === "object") {
              for (const rk of Object.keys(v).sort()) {
                lines.push(`place.primaryReject.${rk}=${Number(v[rk] || 0)}`);
              }
              continue;
            }
            if ((k === "fragmentCoverageWorst" || k === "primaryFragmentCoverageWorst") && Array.isArray(v)) {
              v.slice(0, 5).forEach((row, idx) => {
                if (!row || typeof row !== "object") return;
                const fid = Number(row.fragmentId || 0);
                const cov = Number(row.coverageRatio || 0);
                const pieces = Number(row.piecesUsed || 0);
                lines.push(`place.${k}.${idx + 1}=frag:${fid};cov:${cov.toFixed(3)};pieces:${pieces}`);
              });
              continue;
            }
            if (v && typeof v === "object" && !Array.isArray(v)) {
              pushPlacementMetric(lines, `place.${k}`, v);
              continue;
            }
            if (typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))) {
              lines.push(`place.${k}=${Number(v)}`);
            }
          }
          return lines.join("\n");
        })();
        byId("invDebugInfo").textContent = [traceText, compatText, placementText].filter(Boolean).join("\n");
        byId("invUsedTags").textContent = Array.isArray(previewRes.usedInventoryTags) && previewRes.usedInventoryTags.length
          ? previewRes.usedInventoryTags.join("\n")
          : `(${t("no_data", null, "none")})`;
        if (Array.isArray(previewRes.usedInventoryTags) && previewRes.usedInventoryTags.length) {
          if (!state.tagUsage || typeof state.tagUsage !== "object") state.tagUsage = {};
          for (const tagRaw of previewRes.usedInventoryTags) {
            const tag = String(tagRaw || "").trim();
            if (!tag) continue;
            state.tagUsage[tag] = Number(state.tagUsage[tag] || 0) + 1;
          }
          const keys = Object.keys(state.tagUsage);
          if (keys.length > 800) {
            for (const k of keys) {
              state.tagUsage[k] = Math.max(0, Number(state.tagUsage[k] || 0) - 1);
              if (state.tagUsage[k] <= 0) delete state.tagUsage[k];
            }
          }
        }
        renderPlacementRows(state.layoutRun.placements);
        renderSplitEvents(state.layoutRun.splitEvents);
        byId("workspaceInfo").textContent = `Кандидаты: ${Number(candidatesRes.matchedCandidates || 0)}, фрагменты: ${state.layoutRun.fragments.length}, seed=${state.layoutRun.lastSeed}`;
        const canApply = !(
          (state.layoutMode === "inventory" || state.layoutMode === "inventory_split_return") &&
          inventoryScenario === "A" &&
          (
            Number(state.layoutRun.stats.violations || 0) > 0 ||
            String(state.layoutRun.resultStatus || "ok") !== "ok"
          )
        ) || isManualInventoryMode();
        const applyBtn = byId("inventoryStep2ApplyBtn");
        if (applyBtn) {
          applyBtn.disabled = !canApply;
          applyBtn.title = canApply
            ? ""
            : t(
              "apply_requires_coverage",
              { reason: state.layoutRun.failedReason ? ` (${state.layoutRun.failedReason})` : "" },
              `Cannot apply: 100% coverage is required${state.layoutRun.failedReason ? ` (${state.layoutRun.failedReason})` : ""}`
            );
        }
        setInventoryProgress(100, t("progress_done", null, "Done"));
        openInventoryStep2();
        renderScene();
      } catch (err) {
        if (isStaleRun()) return;
        stopServerPreviewProgressTicker();
        closeInventoryProgressStream();
        const msg = err && err.message ? err.message : String(err);
        byId("workspaceInfo").textContent = `Ошибка подбора: ${msg}`;
        byId("invTotalFragments").textContent = "0";
        byId("invViolations").textContent = "0";
        byId("invIntersections").textContent = "0";
        byId("invUncovered").textContent = "0";
        byId("invCoveragePercent").textContent = "0";
        byId("invResidualArea").textContent = "0";
        byId("invUsefulArea").textContent = "0";
        byId("invUsedScrapArea").textContent = "0";
        byId("invScrapUtilization").textContent = "0";
        byId("invScrapWaste").textContent = "0";
        byId("invOverlapArea").textContent = "0";
        byId("invCandidateAreaBudget").textContent = "0";
        byId("invDbCandidates").textContent = "0";
        byId("invCompatibleCandidates").textContent = "0";
        byId("invStrategyUsed").textContent = "-";
        byId("invMatchedPct").textContent = "0.00";
        byId("invKpiCoveragePct").textContent = "0.00";
        byId("invTailCoverageStart").textContent = "-";
        byId("invTailOversizeAlpha").textContent = "-";
        byId("invRejectedOversize").textContent = "0";
        byId("invRejectedOverlap").textContent = "0";
        byId("invRejectedLowGain").textContent = "0";
        byId("invRejectedOutside").textContent = "0";
        if (inventoryProgressView && typeof inventoryProgressView.resetKpis === "function") inventoryProgressView.resetKpis();
        updateInventoryProgressKpis({});
        setInventoryProgressStatus(`Ошибка: ${msg}`);
          byId("invUsedTags").textContent = `(${t("no_data", null, "none")})`;
        byId("invDebugInfo").textContent = `Ошибка: ${msg}`;
        const applyBtn = byId("inventoryStep2ApplyBtn");
        if (applyBtn) {
          applyBtn.disabled = true;
          applyBtn.title = "Нельзя применить из-за ошибки подбора";
        }
        state.layoutRun.placements = [];
        state.layoutRun.topChoicesByFragment = {};
        state.layoutRun.selectedPlacementFragmentId = null;
        state.layoutRun.previewLayers = { pieceIntersections: [], visibleArea: [], coverageHoles: [] };
        state.layoutRun.splitEvents = [];
        state.selectedFragmentId = null;
        renderPlacementRows([]);
        renderSplitEvents([]);
        openInventoryStep2();
      } finally {
        if (isStaleRun()) return;
        closeInventoryProgressStream();
        setTimeout(() => hideInventoryProgress(), 120);
      }
    }

    function renderPropertyEditor() {
      if (propertyEditorView && typeof propertyEditorView.renderPropertyEditor === "function") {
        propertyEditorView.renderPropertyEditor();
      }
    }

    function syncLayerLegendCounters() {
      if (layerLegend && typeof layerLegend.syncCounters === "function") {
        layerLegend.syncCounters();
        return;
      }
      const fragmentsCount = Array.isArray(state.layoutRun && state.layoutRun.fragments)
        ? state.layoutRun.fragments.length
        : 0;
      const matchedPiecesCount = Array.isArray(state.layoutRun && state.layoutRun.placements)
        ? state.layoutRun.placements.filter((p) => String(p && p.status || "") === "matched").length
        : 0;
      const fragLabel = byId("layerPieceBordersLabel");
      const pieceLabel = byId("layerAssignedPiecesLabel");
      const pieceToggle = byId("layerAssignedPieces");
      if (fragLabel) {
        const manualBeforeApply = isManualInventoryMode() && String(state.layoutRun && state.layoutRun.status || "") !== "applied";
        fragLabel.textContent = t("layer_fragments_label", null, "Фрагменты");
      }
      if (pieceLabel) pieceLabel.textContent = `${t("layer_pieces_label", null, "Подобранные куски")} (${matchedPiecesCount})`;
      if (pieceToggle) {
        pieceToggle.title = matchedPiecesCount > 0
          ? ""
          : t("layer_no_matched_pieces", null, "В текущем результате нет подобранных кусков");
      }
    }

    function renderScene() {
      try { _renderScene(); } catch (err) {
        console.error("[renderScene]", err);
        const info = byId("workspaceInfo");
        if (info) info.textContent = `[render error] ${err && err.message || err}`;
      }
      updateDebugOverlay();
    }
    function _renderScene() {
      invalidateDetailBoundaryCache();
      layerGuides.destroyChildren();
      layerContent.destroyChildren();
      layerOverlay.destroyChildren();
      layerSelection.destroyChildren();
      syncLayerLegendCounters();
      const compactZprj = previewSourceType === "zprj" && state.view.zprjCompactView === true;
      const showGuidesEffective = compactZprj ? false : state.layers.guides;
      const showLabelsEffective = compactZprj ? false : state.view.showDetailLabels;

      if (showGuidesEffective) {
        const niceSteps = [1, 2, 5];
        const targetMinorPx = 30;
        const minMinorPx = 14;
        const pxPerMm = Math.max(1e-6, Number(state.viewport && state.viewport.scale || 1));
        const targetMinorMm = targetMinorPx / pxPerMm;
        let minorStepMm = 1;
        let exp = Math.floor(Math.log10(Math.max(1e-6, targetMinorMm)));
        let best = Infinity;
        for (let e = exp - 1; e <= exp + 2; e++) {
          const pow10 = Math.pow(10, e);
          for (const b of niceSteps) {
            const s = b * pow10;
            if (!(s > 0)) continue;
            const err = Math.abs(s - targetMinorMm);
            if (err < best) {
              best = err;
              minorStepMm = s;
            }
          }
        }
        const majorStepMm = minorStepMm * 5;
        const showMinor = minorStepMm * pxPerMm >= minMinorPx;
        const wA = screenToWorld(0, 0);
        const wB = screenToWorld(W, H);
        const minX = Math.min(Number(wA && wA.x || 0), Number(wB && wB.x || 0));
        const maxX = Math.max(Number(wA && wA.x || 0), Number(wB && wB.x || 0));
        const minY = Math.min(Number(wA && wA.y || 0), Number(wB && wB.y || 0));
        const maxY = Math.max(Number(wA && wA.y || 0), Number(wB && wB.y || 0));
        const startXMinor = Math.floor(minX / minorStepMm) * minorStepMm;
        const endXMinor = Math.ceil(maxX / minorStepMm) * minorStepMm;
        const startYMinor = Math.floor(minY / minorStepMm) * minorStepMm;
        const endYMinor = Math.ceil(maxY / minorStepMm) * minorStepMm;
        const startXMajor = Math.floor(minX / majorStepMm) * majorStepMm;
        const endXMajor = Math.ceil(maxX / majorStepMm) * majorStepMm;
        const startYMajor = Math.floor(minY / majorStepMm) * majorStepMm;
        const endYMajor = Math.ceil(maxY / majorStepMm) * majorStepMm;
        if (showMinor) {
          for (let x = startXMinor; x <= endXMinor + 1e-9; x += minorStepMm) {
            layerGuides.add(new Konva.Line({
              points: linePoints([{ x, y: minY }, { x, y: maxY }]),
              stroke: ENGINEERING_STYLES.guides.minorStroke || ENGINEERING_STYLES.guides.stroke,
              strokeWidth: Number(ENGINEERING_STYLES.guides.minorWidth || ENGINEERING_STYLES.guides.strokeWidth || 0.75)
            }));
          }
          for (let y = startYMinor; y <= endYMinor + 1e-9; y += minorStepMm) {
            layerGuides.add(new Konva.Line({
              points: linePoints([{ x: minX, y }, { x: maxX, y }]),
              stroke: ENGINEERING_STYLES.guides.minorStroke || ENGINEERING_STYLES.guides.stroke,
              strokeWidth: Number(ENGINEERING_STYLES.guides.minorWidth || ENGINEERING_STYLES.guides.strokeWidth || 0.75)
            }));
          }
        }
        for (let x = startXMajor; x <= endXMajor + 1e-9; x += majorStepMm) {
          layerGuides.add(new Konva.Line({
            points: linePoints([{ x, y: minY }, { x, y: maxY }]),
            stroke: ENGINEERING_STYLES.guides.majorStroke || ENGINEERING_STYLES.guides.stroke,
            strokeWidth: Number(ENGINEERING_STYLES.guides.majorWidth || ENGINEERING_STYLES.guides.strokeWidth || 1)
          }));
        }
        for (let y = startYMajor; y <= endYMajor + 1e-9; y += majorStepMm) {
          layerGuides.add(new Konva.Line({
            points: linePoints([{ x: minX, y }, { x: maxX, y }]),
            stroke: ENGINEERING_STYLES.guides.majorStroke || ENGINEERING_STYLES.guides.stroke,
            strokeWidth: Number(ENGINEERING_STYLES.guides.majorWidth || ENGINEERING_STYLES.guides.strokeWidth || 1)
          }));
        }
      }

      const renderEntities = getRenderablePatternEntities();
      state.renderEntities = renderEntities;
      // Recompute detail list only when we truly have renderable geometry.
      // This prevents accidental tree reset to "Нет деталей" on transient renders.
      if (Array.isArray(renderEntities) && renderEntities.length > 0) {
        const candNames = state.patternGeometry && state.patternGeometry.meta && Array.isArray(state.patternGeometry.meta.patternNames)
          ? state.patternGeometry.meta.patternNames
          : [];
        const newDetails = computeDetailsFromEntities(renderEntities, candNames);
        const selectedStillExists = newDetails.some((d) => d.id === state.selectedDetailId);
        state.details = newDetails;
        if (!selectedStillExists) state.selectedDetailId = state.details.length ? state.details[0].id : null;
        // Persist canonical contours so they survive after base zones are split.
        if (window.FurLabZoneLookups && typeof window.FurLabZoneLookups.registerDetailContour === "function") {
          for (const d of newDetails) {
            const pts = Array.isArray(d && d.entity && d.entity.points) ? d.entity.points : [];
            if (pts.length >= 3) window.FurLabZoneLookups.registerDetailContour(d.id, pts);
          }
        }
      } else if ((!Array.isArray(state.details) || state.details.length === 0) && Array.isArray(state.zones) && state.zones.length > 0) {
        // Restore detail groups from existing zones if geometry is temporarily unavailable.
        const byId = new Map();
        for (const z of state.zones) {
          const did = Number(z && z.detailId || 0);
          if (!did) continue;
          if (!byId.has(did)) byId.set(did, { id: did, name: `Деталь ${did}`, bbox: null, area: 0, points: 0, entity: null, _xs: [], _ys: [] });
          if (Array.isArray(z.points)) {
            const entry = byId.get(did);
            for (const p of z.points) { entry._xs.push(p.x); entry._ys.push(p.y); }
          }
        }
        for (const d of byId.values()) {
          if (d._xs.length > 0) {
            const minX = Math.min(...d._xs), maxX = Math.max(...d._xs);
            const minY = Math.min(...d._ys), maxY = Math.max(...d._ys);
            d.bbox = { minX, minY, width: maxX - minX, height: maxY - minY };
          }
          delete d._xs; delete d._ys;
        }
        state.details = Array.from(byId.values()).sort((a, b) => a.id - b.id);
        if (!state.details.some((d) => d.id === state.selectedDetailId)) {
          state.selectedDetailId = state.details.length ? state.details[0].id : null;
        }
      }
      renderDetailZoneTree();
      renderPropertyEditor();
      updateProjectUi();
      const selectedDetail = state.details.find((d) => d.id === state.selectedDetailId) || null;
      // Fallback: когда DXF не импортирован — рисуем вычисленный контур детали из union зон
      if (state.layers.pattern && renderEntities.length === 0 && Array.isArray(state.details) && state.details.length > 0) {
        for (const d of state.details) {
          const boundary = getDetailBoundaryPointsForZone({ detailId: d.id });
          if (boundary.length >= 3) {
            layerPattern.add(new Konva.Line({
              points: linePoints(boundary),
              stroke: ENGINEERING_STYLES.pattern.stroke,
              strokeWidth: (ENGINEERING_STYLES.pattern.strokeWidth || 1) + 0.5,
              closed: true,
              listening: false
            }));
          }
        }
      }
      if (state.layers.pattern && renderEntities.length > 0) {
        for (const e of renderEntities) {
          const isSelected = !!(selectedDetail && e === selectedDetail.entity);
          if (isSelected && state.view.highlightSelectedDetail) continue;
          layerPattern.add(new Konva.Line({
            points: linePoints(e.points || []),
            stroke: ENGINEERING_STYLES.pattern.stroke,
            strokeWidth: ENGINEERING_STYLES.pattern.strokeWidth,
            closed: !!e.closed
          }));
        }
        if (selectedDetail && selectedDetail.entity && state.view.highlightSelectedDetail) {
          const e = selectedDetail.entity;
          layerPattern.add(new Konva.Line({
            points: linePoints(e.points || []),
            stroke: ENGINEERING_STYLES.pattern.selectedStroke || ENGINEERING_STYLES.selection.stroke,
            strokeWidth: ENGINEERING_STYLES.pattern.selectedStrokeWidth || ENGINEERING_STYLES.selection.strokeWidth,
            closed: !!e.closed
          }));
          if (e.smartCloseBridge && e.smartCloseBridge.from && e.smartCloseBridge.to) {
            const b1 = worldToScreen(e.smartCloseBridge.from);
            const b2 = worldToScreen(e.smartCloseBridge.to);
            layerPattern.add(new Konva.Line({
              points: [b1.x, b1.y, b2.x, b2.y],
              stroke: ENGINEERING_STYLES.smartCloseBridge.stroke,
              strokeWidth: ENGINEERING_STYLES.smartCloseBridge.strokeWidth,
              dash: ENGINEERING_STYLES.smartCloseBridge.dash
            }));
          }
        }
      }

      if (showLabelsEffective && state.details.length > 0) {
        for (const d of state.details) {
          if (!d.bbox) continue;
          const cx = d.bbox.minX + d.bbox.width / 2;
          const cy = d.bbox.minY + d.bbox.height / 2;
          const s = worldToScreen({ x: cx, y: cy });
          const lbl = new Konva.Text({
            x: s.x,
            y: s.y,
            text: d.name,
            fontSize: 12,
            fill: d.id === state.selectedDetailId ? "#0b63ce" : "#444",
            listening: false
          });
          lbl.offsetX(lbl.width() / 2);
          lbl.offsetY(lbl.height() / 2);
          layerPattern.add(lbl);
        }
      }

      const activeLayoutZoneId = Number(state.layoutRun && state.layoutRun.selectedZoneId || 0);
      const hasManualPlacements = isManualInventoryMode() && Array.isArray(state.layoutRun.placements) && state.layoutRun.placements.length > 0;
      const hasActiveLayoutOnZone = !!(state.layoutRun.active && activeLayoutZoneId > 0) || hasManualPlacements;
      let deferredManualSeamSegments = [];

      function drawSnapshotFragments(snapshot, options = {}) {
        const snap = snapshot && typeof snapshot === "object" ? snapshot : null;
        const lr = snap && snap.layoutRun && typeof snap.layoutRun === "object" ? snap.layoutRun : null;
        const fragments = Array.isArray(lr && lr.fragments) ? lr.fragments : [];
        if (!fragments.length) return;
        const stroke = String(options.stroke || (ENGINEERING_STYLES.fragments && ENGINEERING_STYLES.fragments.stroke) || "#0b63ce");
        const strokeWidth = Number.isFinite(Number(options.strokeWidth)) ? Number(options.strokeWidth) : 1;
        const fill = String(options.fill || "rgba(11,99,206,0.06)");
        for (const frag of fragments) {
          if (!Array.isArray(frag && frag.points) || frag.points.length < 3) continue;
          const _snapCr = Number(frag.cornerRadius || 0);
          let _snapPts = frag.points;
          if (_snapCr > 0) {
            const _sxs = _snapPts.map((q) => q.x), _sys = _snapPts.map((q) => q.y);
            _snapPts = buildRoundedRectPolygon(Math.min(..._sxs), Math.min(..._sys), Math.max(..._sxs), Math.max(..._sys), _snapCr);
          }
          layerFragments.add(new Konva.Line({
            points: linePoints(_snapPts),
            stroke,
            strokeWidth,
            fill,
            closed: true,
            listening: false
          }));
        }
      }

      const selectedLayoutIdNum = Number(state.selectedLayoutId || 0) || 0;
      const backgroundLayouts = (Array.isArray(state.layouts) ? state.layouts : [])
        .filter((entry) => {
          const isSelected = Number(entry && entry.id || 0) === selectedLayoutIdNum;
          return !isSelected || !hasActiveLayoutOnZone;
        })
        .map((entry) => ({ entry, snapshot: getLayoutSnapshotForReports(entry) }))
        .filter((item) => {
          if (!item || !item.snapshot || !item.snapshot.layoutRun) return false;
          const lr = item.snapshot.layoutRun;
          const hasFragments = Array.isArray(lr.fragments) && lr.fragments.length > 0;
          const hasPlacements = Array.isArray(lr.placements) && lr.placements.some((p) => Array.isArray(p && p.alignedContour) && p.alignedContour.length >= 3);
          return hasFragments || hasPlacements;
        });
      const _bgStroke = "rgba(11,99,206,0.55)";
      const _bgFill = "rgba(11,99,206,0.04)";
      for (const item of backgroundLayouts) {
        const isManualBg = String(item.entry && item.entry.mode || "") === "inventory_manual";
        if (state.layers.pieceBorders) drawSnapshotFragments(item.snapshot, { stroke: _bgStroke, strokeWidth: 1, fill: _bgFill });
        if (state.layers && state.layers.pfullZ && !isManualBg) {
          const lr = item.snapshot.layoutRun;
          if (Array.isArray(lr.placements)) {
            for (const p of lr.placements) {
              const pts = (Array.isArray(p && p.inZoneContour) && p.inZoneContour.length >= 3)
                ? p.inZoneContour
                : (Array.isArray(p && p.alignedContour) && p.alignedContour.length >= 3 ? p.alignedContour : null);
              if (!pts) continue;
              layerFragments.add(new Konva.Line({ points: linePoints(pts), stroke: _bgStroke, strokeWidth: 1, fill: "rgba(0,0,0,0)", closed: true, listening: false }));
            }
          }
        }
      }

      if (hasActiveLayoutOnZone) {
        let selectedFragObj = null;
        const manual = state.layoutRun && state.layoutRun.manual ? state.layoutRun.manual : null;
        const manualBeforeApply = isManualInventoryMode() && String(state.layoutRun && state.layoutRun.status || "") !== "applied";
        const selectedPlacementIndex = Number(manual && manual.selectedPlacementIndex);
        const isDraggingManualPlacement = !!(state.drag && state.drag.isDown && state.drag.mode === "manual-placement-move");
        const dragScrapPieceId = isDraggingManualPlacement ? String(state.drag.manualDragScrapPieceId || "") : "";
        const dragDx = isDraggingManualPlacement ? Number(state.drag.manualDragDx || 0) : 0;
        const dragDy = isDraggingManualPlacement ? Number(state.drag.manualDragDy || 0) : 0;
        const fragmentsList = manualBeforeApply ? [] : (Array.isArray(state.layoutRun.fragments) ? state.layoutRun.fragments : []);
        const matchedPlacements = Array.isArray(state.layoutRun.placements)
          ? state.layoutRun.placements
            .map((p, idx) => (p ? { ...p, __placementIndex: idx } : null))
            .filter((p) => {
              if (!p) return false;
              const status = String(p.status || "");
              if (status === "matched") return true;
              const hasGeom =
                (Array.isArray(p.inZoneContour) && p.inZoneContour.length >= 3) ||
                (Array.isArray(p.inZoneContours) && p.inZoneContours.length > 0) ||
                (Array.isArray(p.alignedCoreContour) && p.alignedCoreContour.length >= 3) ||
                (Array.isArray(p.alignedCoreContours) && p.alignedCoreContours.length > 0) ||
                (Array.isArray(p.inZoneCoreContour) && p.inZoneCoreContour.length >= 3) ||
                (Array.isArray(p.inZoneCoreContours) && p.inZoneCoreContours.length > 0) ||
                (Array.isArray(p.alignedContour) && p.alignedContour.length >= 3);
              return hasGeom;
            })
          : [];
        const showAssignedPieces = state.layers.assignedPieces !== false;
        function fragmentOwnedByPlacement(frag, pl) {
          if (!frag || !pl) return false;
          const ownerIdx = Number(frag.ownerPlacementIndex);
          const ownerId = Number(frag.ownerPlacementId);
          const plIdx = Number(pl && pl.__placementIndex);
          const plFragId = Number(pl && pl.fragmentId);
          if (Number.isFinite(ownerIdx) && Number.isFinite(plIdx) && ownerIdx === plIdx) return true;
          if (Number.isFinite(ownerId) && Number.isFinite(plFragId) && ownerId === plFragId) return true;
          return false;
        }
        function normalizeContourArray(raw) {
          const pts = (Array.isArray(raw) ? raw : [])
            .map((q) => ({ x: Number(q && q.x), y: Number(q && q.y) }))
            .filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
          return pts.length >= 3 ? pts : null;
        }
        function toContours(rawSingle, rawMulti) {
          const out = [];
          const single = normalizeContourArray(rawSingle);
          if (single) out.push(single);
          if (Array.isArray(rawMulti)) {
            for (const poly of rawMulti) {
              const pts = normalizeContourArray(poly);
              if (pts) out.push(pts);
            }
          }
          return out;
        }
        const manualWholePieceMode = isManualInventoryMode();
        for (const pl of matchedPlacements) {
          const placementIndex = Number(pl && pl.__placementIndex);
          let contours = manualWholePieceMode
            ? toContours(pl.alignedContour, null)
            : toContours(pl.alignedContour, null);
          let coreContours = toContours(pl.alignedCoreContour, pl.alignedCoreContours);
          if (!coreContours.length) {
            coreContours = toContours(pl.inZoneCoreContour, pl.inZoneCoreContours);
          }
          let usedVisibleContours = toContours(pl.usedVisibleContour, pl.usedVisibleContours);
          if (!contours.length && Array.isArray(pl.alignedContour) && pl.alignedContour.length >= 3) {
            const aligned = normalizeContourArray(pl.alignedContour);
            if (aligned) contours.push(aligned);
          }
          // Fallback for assign-only runs where piece contour is not materialized:
          // synthesize an irregular contour from source scrap + placement transform.
          if (!contours.length) {
            const scrap = parseScrapContourPoints(pl && pl.scrapContour);
            const fragId = Number(pl && pl.fragmentId || 0);
            const frag = fragmentsList.find((f) => Number(f && f.id || 0) === fragId) || null;
            if (scrap.length >= 3 && frag && Array.isArray(frag.points) && frag.points.length >= 3) {
              const src = normalizeContourArray(scrap);
              if (src) {
                let syn = src;
                const srcCenter = centroid(syn);
                const rotDeg = Number(pl && pl.alignRotationDeg);
                if (Number.isFinite(rotDeg) && Math.abs(rotDeg) > 1e-6) {
                  syn = rotatePoints(syn, (rotDeg * Math.PI) / 180, srcCenter);
                }
                const fragCenter = centroid(frag.points);
                const synCenter = centroid(syn);
                syn = translatePoints(syn, fragCenter.x - synCenter.x, fragCenter.y - synCenter.y);
                if (syn.length >= 3) contours = [syn];
              }
            }
          }
          if (!contours.length && !coreContours.length) continue;
          const isSelPlacement = isManualInventoryMode() && Number.isFinite(selectedPlacementIndex) && placementIndex === selectedPlacementIndex;
          if (showAssignedPieces && state.layers.pfullZ && contours.length) {
            const ic = ENGINEERING_STYLES.inventoryContours || {};
            const pieceStroke = isSelPlacement ? (ic.selectedStroke || "#914734") : (ic.stroke || "rgba(189,87,39,0.85)");
            const pieceStrokeWidth = isSelPlacement ? (ic.selectedStrokeWidth || 1.4) : (ic.strokeWidth || 1.0);
            for (const contour of contours) {
              layerPreview.add(new Konva.Line({
                points: linePoints(contour),
                stroke: pieceStroke,
                strokeWidth: pieceStrokeWidth,
                // In manual mode contours = alignedContour (full piece, extends outside zone, heavily overlapping).
                // Use very low opacity to stay visible without accumulating dark when many pieces overlap.
                fill: manualWholePieceMode
                  ? (isSelPlacement ? "rgba(189,87,39,0.15)" : "rgba(189,87,39,0.03)")
                  : (isSelPlacement ? (ic.selectedFill || "rgba(189,87,39,0.12)") : (ic.fill || "rgba(189,87,39,0.06)")),
                closed: true
              }));
            }
          }
          const isDirectInv = isInventoryLikeLayoutMode(state.layoutMode) && !isManualInventoryMode();
          if (showAssignedPieces && state.layers.usedGain && usedVisibleContours.length && !isDirectInv) {
            const _up = ENGINEERING_STYLES.usedPart || {};
            for (const usedVisibleContour of usedVisibleContours) {
              layerPreview.add(new Konva.Line({
                points: linePoints(usedVisibleContour),
                stroke: _up.stroke || "#914734",
                strokeWidth: isSelPlacement ? (_up.selectedStrokeWidth || 1.6) : (_up.strokeWidth || 1.25),
                fill: _up.fill || "rgba(145,71,52,0.10)",
                closed: true
              }));
            }
          }
          if (showAssignedPieces && state.layers.pcoreZ && coreContours.length) {
            const _al = ENGINEERING_STYLES.allowances || {};
            for (const coreContour of coreContours) {
              layerPreview.add(new Konva.Line({
                points: linePoints(coreContour),
                stroke: _al.stroke || "rgba(189,87,39,0.9)",
                strokeWidth: _al.strokeWidth || 1.2,
                fill: "rgba(0,0,0,0)",
                dash: Array.isArray(_al.dash) ? _al.dash : [6, 3],
                closed: true
              }));
            }
          }
          if (isSelPlacement) {
            const napCenterContour =
              (Array.isArray(pl && pl.inZoneContour) && pl.inZoneContour.length >= 3
                ? pl.inZoneContour
                : (Array.isArray(pl && pl.alignedContour) && pl.alignedContour.length >= 3 ? pl.alignedContour : null));
            if (Array.isArray(napCenterContour) && napCenterContour.length >= 3) {
              const napCenter = centroid(napCenterContour);
              const zoneForNap = getManualZone(napCenterContour);
              const zoneNap = zoneForNap ? getZoneNapDirectionDeg(zoneForNap) : DEFAULT_NAP_DIRECTION_DEG;
              const baseNap = Number.isFinite(Number(pl && pl.napDirectionDeg))
                ? Number(pl.napDirectionDeg)
                : Number(zoneNap);
              const alignRotDeg = Number.isFinite(Number(pl && pl.alignRotationDeg))
                ? Number(pl.alignRotationDeg)
                : 0;
              const effNap = Number.isFinite(Number(pl && pl.napEffectiveDeg))
                ? Number(pl.napEffectiveDeg)
                : (baseNap + alignRotDeg);
              drawNapArrow(layerSelection, napCenter, effNap, 26);
            }
          }
        }
        if (showAssignedPieces && state.layers.splitLeftovers && String(state.layoutMode || "") === "inventory_split_return") {
          const splitEvents = Array.isArray(state.layoutRun && state.layoutRun.splitEvents) ? state.layoutRun.splitEvents : [];
          for (const ev of splitEvents) {
            const leftovers = [];
            if (Array.isArray(ev && ev.leftoverWorldContours)) {
              for (const poly of ev.leftoverWorldContours) {
                if (!Array.isArray(poly)) continue;
                const pts = poly
                  .map((q) => ({ x: Number(q && q.x), y: Number(q && q.y) }))
                  .filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
                if (pts.length >= 3) leftovers.push(pts);
              }
            } else if (Array.isArray(ev && ev.leftoverWorldContour)) {
              const pts = ev.leftoverWorldContour
                .map((q) => ({ x: Number(q && q.x), y: Number(q && q.y) }))
                .filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
              if (pts.length >= 3) leftovers.push(pts);
            }
            for (const pts of leftovers) {
              layerPreview.add(new Konva.Line({
                points: linePoints(pts),
                stroke: ENGINEERING_STYLES.splitLeftovers.stroke,
                strokeWidth: ENGINEERING_STYLES.splitLeftovers.strokeWidth,
                dash: ENGINEERING_STYLES.splitLeftovers.dash,
                fill: ENGINEERING_STYLES.splitLeftovers.fill,
                closed: true
              }));
            }
          }
        }
        if (state.layers.visibleCore) {
          const seamSegments = state.layoutRun && state.layoutRun.previewLayers && Array.isArray(state.layoutRun.previewLayers.seams)
            ? state.layoutRun.previewLayers.seams
            : [];
          deferredManualSeamSegments = seamSegments;
        }
        if (isManualInventoryMode()) {
          const manual = state.layoutRun && state.layoutRun.manual ? state.layoutRun.manual : null;
          const ap = manual && manual.activePiece ? manual.activePiece : null;
          if (ap && Array.isArray(ap.points) && ap.points.length >= 3) {
            layerPreview.add(new Konva.Line({
              points: linePoints(ap.points),
              stroke: ENGINEERING_STYLES.manualActivePiece.stroke,
              strokeWidth: ENGINEERING_STYLES.manualActivePiece.strokeWidth,
              dash: ENGINEERING_STYLES.manualActivePiece.dash,
              fill: ENGINEERING_STYLES.manualActivePiece.fill,
              closed: true
            }));
            const mm = manual && manual.lastMetrics ? manual.lastMetrics : null;
            const isTiny = String(mm && mm.status || "") === "tiny_fragment";
            if (manual && manual.lastEvalContours && Array.isArray(manual.lastEvalContours.gainVisible)) {
              const gain = multiLargestOuterPoints(manual.lastEvalContours.gainVisible);
              if (gain.length >= 3) {
                layerPreview.add(new Konva.Line({
                  points: linePoints(gain),
                  stroke: isTiny ? ENGINEERING_STYLES.manualGainTiny.stroke : ENGINEERING_STYLES.manualGainOk.stroke,
                  strokeWidth: isTiny ? ENGINEERING_STYLES.manualGainTiny.strokeWidth : ENGINEERING_STYLES.manualGainOk.strokeWidth,
                  fill: isTiny ? ENGINEERING_STYLES.manualGainTiny.fill : ENGINEERING_STYLES.manualGainOk.fill,
                  closed: true
                }));
              }
            }
            if (state.layers.pcoreZ && manual && manual.lastEvalContours) {
              const coreMp = Array.isArray(manual.lastEvalContours.coreWorld) ? manual.lastEvalContours.coreWorld : [];
              const core = multiLargestOuterPoints(coreMp);
              if (core.length >= 3) {
                layerPreview.add(new Konva.Line({
                  points: linePoints(core),
                  stroke: ENGINEERING_STYLES.allowances.stroke,
                  strokeWidth: ENGINEERING_STYLES.allowances.strokeWidth,
                  fill: ENGINEERING_STYLES.allowances.fill,
                  closed: true
                }));
              }
            }
            const cc = centroid(ap.points);
            const zoneForNap = getManualZone(ap.points);
            const zoneNap = zoneForNap ? getZoneNapDirectionDeg(zoneForNap) : DEFAULT_NAP_DIRECTION_DEG;
            const activeNap = Number.isFinite(Number(ap && ap.napDirectionDeg))
              ? Number(ap.napDirectionDeg)
              : (Number.isFinite(Number(ap && ap.candidate && ap.candidate.napDirectionDeg))
                  ? Number(ap.candidate.napDirectionDeg)
                  : Number(zoneNap));
            drawNapArrow(layerSelection, cc, activeNap, 24);
            const cs = worldToScreen(cc);
            layerPreview.add(new Konva.Text({
              x: cs.x + 6,
              y: cs.y + 6,
              text: String(ap.inventoryTag || "ручной кусок"),
              fontSize: 12,
              fill: "#0b63ce",
              listening: false
            }));
          }
        }
        const selectedFragmentIdNum = state.selectedFragmentId !== null ? Number(state.selectedFragmentId) : null;
        if (selectedFragmentIdNum !== null && Number.isFinite(selectedFragmentIdNum)) {
          selectedFragObj = fragmentsList.find((f) => Number(f && f.id || 0) === selectedFragmentIdNum) || null;
        }
        const isIntarsiaSvgMode = state.layoutMode === "intarsia" && state.layoutRun.fillType === "import_svg";
        const _isNfpSaMode = state.layoutMode === "inventory_nfp_sa" || state.layoutMode === "inventory_tiling" || state.layoutMode === "inventory_voronoi_sa";
        if (state.layers.pieceBorders) {
          const _hasMaterialZones = state.layers.zoneMaterials && state.zones.some((z) => z && z.materialId);
          for (const frag of fragmentsList) {
            if (!Array.isArray(frag.points) || frag.points.length < 3) continue;
            const fragId = Number(frag.id || 0);
            const isSelectedFrag = selectedFragmentIdNum !== null && fragId === selectedFragmentIdNum;
            const _fst = ENGINEERING_STYLES.fragments || {};
            const fragIsDragged = isDraggingManualPlacement && dragScrapPieceId !== "" && String(frag.scrapPieceId || "") === dragScrapPieceId;
            const fragPoints = fragIsDragged
              ? frag.points.map((q) => ({ x: q.x + dragDx, y: q.y + dragDy }))
              : frag.points;
            const fragCornerRadius = Number(frag.cornerRadius || 0);
            let renderPoints = fragPoints;
            if (fragCornerRadius > 0) {
              const _xs = fragPoints.map((q) => q.x), _ys = fragPoints.map((q) => q.y);
              renderPoints = buildRoundedRectPolygon(Math.min(..._xs), Math.min(..._ys), Math.max(..._xs), Math.max(..._ys), fragCornerRadius);
            }
            const fragStroke = isSelectedFrag
              ? "#0050C8"
              : (_hasMaterialZones ? "rgba(0,60,180,0.80)" : (_fst.stroke || "#0076D6"));
            // NFP Greedy: opaque white fill so fragments show as distinct tiles (mosaic)
            const fragFill = isSelectedFrag
              ? "rgba(0,100,220,0.22)"
              : (_isNfpSaMode
                ? "rgba(245,247,252,0.92)"
                : (_hasMaterialZones ? "rgba(0,0,0,0)" : (_fst.fill || "rgba(0,118,214,0.08)")));
            const shape = new Konva.Line({
              points: linePoints(renderPoints),
              stroke: fragStroke,
              strokeWidth: isSelectedFrag ? 2.5 : (_hasMaterialZones ? 1.4 : (_fst.strokeWidth || 1.25)),
              fill: fragFill,
              closed: true,
              listening: false,
              name: `frag-${fragId}`
            });
            layerFragments.add(shape);
          }
        }
        // Seam lines — for manual draw cut boundary (frag.cutPoints); NFP Greedy uses shared-edge segments via deferredManualSeamSegments
        if (state.layers.visibleCore && isManualInventoryMode()) {
          for (const frag of fragmentsList) {
            const rawSeamPts = frag.cutPoints;
            if (!Array.isArray(rawSeamPts) || rawSeamPts.length < 3) continue;
            const fragIsDragged = isDraggingManualPlacement && dragScrapPieceId !== "" && String(frag.scrapPieceId || "") === dragScrapPieceId;
            const cutPoints = fragIsDragged
              ? rawSeamPts.map((q) => ({ x: q.x + dragDx, y: q.y + dragDy }))
              : rawSeamPts;
            layerFragments.add(new Konva.Line({
              points: linePoints(cutPoints),
              stroke: ENGINEERING_STYLES.seams.stroke,
              strokeWidth: ENGINEERING_STYLES.seams.strokeWidth,
              dash: ENGINEERING_STYLES.seams.dash,
              fill: "rgba(0,0,0,0)",
              closed: true,
              listening: false
            }));
          }
        }
        // Scale/rotate handles for selected intarsia SVG fragment
        if (!isIntarsiaSvgMode || !selectedFragObj) state.intarsiaHandles = null;
        if (isIntarsiaSvgMode && selectedFragObj && Array.isArray(selectedFragObj.points) && selectedFragObj.points.length >= 3) {
          const pts = selectedFragObj.points;
          const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
          const bMinX = Math.min(...xs), bMaxX = Math.max(...xs);
          const bMinY = Math.min(...ys), bMaxY = Math.max(...ys);
          const bCx = (bMinX + bMaxX) / 2, bCy = (bMinY + bMaxY) / 2;
          const bboxPts = [{x:bMinX,y:bMinY},{x:bMaxX,y:bMinY},{x:bMaxX,y:bMaxY},{x:bMinX,y:bMaxY}];
          layerSelection.add(new Konva.Line({ points: linePoints(bboxPts), stroke: "#0076D6", strokeWidth: 1, dash: [4,3], fill: "rgba(0,0,0,0)", closed: true, listening: false }));
          const handleR = 6;
          // Y-axis is flipped: bMinY=bottom on screen, bMaxY=top on screen
          // cursors must match visual screen corners
          const corners = [
            {x: bMinX, y: bMinY, cursor: "nesw-resize"}, // screen bottom-left = SW
            {x: bMaxX, y: bMinY, cursor: "nwse-resize"}, // screen bottom-right = SE
            {x: bMaxX, y: bMaxY, cursor: "nesw-resize"}, // screen top-right = NE
            {x: bMinX, y: bMaxY, cursor: "nwse-resize"}  // screen top-left = NW
          ];
          corners.forEach((corner) => {
            const sc = worldToScreen(corner);
            layerSelection.add(new Konva.Circle({ x: sc.x, y: sc.y, radius: handleR, fill: "#fff", stroke: "#0076D6", strokeWidth: 1.5, listening: false }));
          });

          // Rotation handle вЂ" circle above top-center, connected by a line
          const rotHandleWorld = { x: bCx, y: bMaxY + (bMaxY - bMinY) * 0.25 + 8 };
          const rotHandleScreen = worldToScreen(rotHandleWorld);
          const topCenterScreen = worldToScreen({ x: bCx, y: bMaxY });
          layerSelection.add(new Konva.Line({ points: [topCenterScreen.x, topCenterScreen.y, rotHandleScreen.x, rotHandleScreen.y], stroke: "#0076D6", strokeWidth: 1, listening: false }));
          layerSelection.add(new Konva.Circle({ x: rotHandleScreen.x, y: rotHandleScreen.y, radius: 6, fill: "#fff", stroke: "#0076D6", strokeWidth: 1.5, listening: false }));

          // Store handle positions for stage-interactions hit-testing
          state.intarsiaHandles = {
            fragObj: selectedFragObj,
            bCx, bCy, bMinX, bMaxX, bMinY, bMaxY,
            corners,
            rotHandleWorld
          };
        }
        if (selectedFragObj && Array.isArray(state.layoutRun.placements) && state.layers.selection) {
          const pl = findPlacementForFragment(selectedFragObj);
          const fc = centroid(selectedFragObj.points || []);
          let overlay = Array.isArray(pl && pl.alignedContour) && (pl.alignedContour || []).length >= 3
            ? (pl.alignedContour || []).map((p) => ({ x: Number(p && p.x), y: Number(p && p.y) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
            : parseScrapContourPoints(pl && pl.scrapContour);
          let rotateDeltaRad = 0;
          if (overlay.length >= 3 && !(Array.isArray(pl && pl.alignedContour) && (pl.alignedContour || []).length >= 3)) {
            const sc = centroid(overlay);
            const scrapAngle = dominantAxisAngle(overlay);
            const fragAngle = dominantAxisAngle(selectedFragObj.points || []);
            // Align major axis of scrap contour with fragment axis.
            rotateDeltaRad = fragAngle - scrapAngle;
            overlay = rotatePoints(overlay, rotateDeltaRad, sc);
            const rc = centroid(overlay);
            overlay = translatePoints(overlay, fc.x - rc.x, fc.y - rc.y);
          }
          if (overlay.length >= 3) {
            const _fo = ENGINEERING_STYLES.fragmentOverlay || {};
            layerFragments.add(new Konva.Line({
              points: linePoints(overlay),
              stroke: _fo.stroke || "#6a6a6a",
              strokeWidth: _fo.strokeWidth || 2,
              dash: _fo.dash || [5, 4],
              fill: _fo.fill || "rgba(120,120,120,0.15)",
              closed: true
            }));
          }
          if (pl) {
            const baseNap = Number.isFinite(Number(pl.napDirectionDeg))
              ? Number(pl.napDirectionDeg)
              : Number(state.layoutRun.lastNapDirectionDeg || DEFAULT_NAP_DIRECTION_DEG);
            const alignRotDeg = Number.isFinite(Number(pl.alignRotationDeg))
              ? Number(pl.alignRotationDeg)
              : 0;
            const effNap = Number.isFinite(Number(pl.napEffectiveDeg))
              ? Number(pl.napEffectiveDeg)
              : (baseNap + alignRotDeg);
            drawNapArrow(layerFragments, fc, effNap, 18);
          }

          // Show measurements for selected fragment (edge lengths), similar to desktop prototype.
          const fp = Array.isArray(selectedFragObj.points) ? selectedFragObj.points : [];
          if (fp.length >= 3) {
            for (let i = 0; i < fp.length; i++) {
              const a = fp[i];
              const b = fp[(i + 1) % fp.length];
              const mx = (a.x + b.x) * 0.5;
              const my = (a.y + b.y) * 0.5;
              const segLen = Math.hypot(b.x - a.x, b.y - a.y);
              const sm = worldToScreen({ x: mx, y: my });
              layerSelection.add(new Konva.Text({
                x: sm.x + 4,
                y: sm.y - 10,
                text: `${Math.round(segLen)}`,
                fontSize: 11,
                fill: "#444",
                listening: false
              }));
            }
          }
        }
      }

      // Render intarsia pen draft contour
      if (Array.isArray(state.draftIntarsiaContour) && state.draftIntarsiaContour.length > 0) {
        const dpts = state.draftIntarsiaContour;
        const screenPts = dpts.flatMap((p) => { const s = worldToScreen(p); return [s.x, s.y]; });
        if (screenPts.length >= 4) {
          layerFragments.add(new Konva.Line({
            points: screenPts,
            stroke: "#e65000",
            strokeWidth: 1.5,
            dash: [6, 4],
            closed: false,
            listening: false
          }));
        }
        // Dot markers for placed points
        for (const p of dpts) {
          const s = worldToScreen(p);
          layerFragments.add(new Konva.Circle({ x: s.x, y: s.y, radius: 4, fill: "#e65000", listening: false }));
        }
        // Closing line hint (first to last point)
        if (dpts.length >= 3) {
          const s0 = worldToScreen(dpts[0]);
          const sN = worldToScreen(dpts[dpts.length - 1]);
          layerFragments.add(new Konva.Line({
            points: [sN.x, sN.y, s0.x, s0.y],
            stroke: "#e65000",
            strokeWidth: 1,
            dash: [3, 5],
            closed: false,
            listening: false,
            opacity: 0.5
          }));
        }
      }

      if (state.layers.visibleArea && hasActiveLayoutOnZone) {
        const visiblePolys = state.layoutRun.previewLayers && Array.isArray(state.layoutRun.previewLayers.visibleArea)
          ? state.layoutRun.previewLayers.visibleArea
          : [];
        for (const poly of visiblePolys) {
          const pts = Array.isArray(poly && poly.points) ? poly.points : [];
          if (pts.length < 3) continue;
          layerVisibleArea.add(new Konva.Line({
            points: linePoints(pts),
            stroke: ENGINEERING_STYLES.visibleArea.stroke,
            strokeWidth: ENGINEERING_STYLES.visibleArea.strokeWidth,
            fill: ENGINEERING_STYLES.visibleArea.fill,
            closed: true
          }));
        }
      }

      if (state.layers.coverageHoles && hasActiveLayoutOnZone) {
        const holePolys = state.layoutRun.previewLayers && Array.isArray(state.layoutRun.previewLayers.coverageHoles)
          ? state.layoutRun.previewLayers.coverageHoles
          : [];
        for (const poly of holePolys) {
          const pts = Array.isArray(poly && poly.points) ? poly.points : (Array.isArray(poly) ? poly : []);
          if (pts.length < 3) continue;
          layerVisibleArea.add(new Konva.Line({
            points: linePoints(pts),
            stroke: ENGINEERING_STYLES.coverageHoles.stroke,
            strokeWidth: ENGINEERING_STYLES.coverageHoles.strokeWidth,
            fill: ENGINEERING_STYLES.coverageHoles.fill,
            closed: true
          }));
        }
      }

      if (state.layers.pieceIntersections && hasActiveLayoutOnZone) {
        const interPolys = state.layoutRun.previewLayers && Array.isArray(state.layoutRun.previewLayers.pieceIntersections)
          ? state.layoutRun.previewLayers.pieceIntersections
          : [];
        for (const poly of interPolys) {
          const pts = Array.isArray(poly && poly.points) ? poly.points : [];
          if (pts.length < 3) continue;
          layerPreview.add(new Konva.Line({
            points: linePoints(pts),
            stroke: ENGINEERING_STYLES.intersections.stroke,
            strokeWidth: ENGINEERING_STYLES.intersections.strokeWidth,
            fill: ENGINEERING_STYLES.intersections.fill,
            closed: true
          }));
        }
      }

      // §19.2 / Etap 2: layout-result layer — remainingArea (NOT a Zone)
      if (hasActiveLayoutOnZone && state.layoutRun.remainingArea && Array.isArray(state.layoutRun.remainingArea.outer) && state.layoutRun.remainingArea.outer.length >= 3) {
        const ra = state.layoutRun.remainingArea;
        const raHoles = Array.isArray(ra.holes) ? ra.holes.map(holeContour).filter((h) => h.length >= 3) : [];
        const hasRaHoles = raHoles.length > 0;
        layerFragments.add(new Konva.Shape({
          listening: false,
          sceneFunc(ctx, shape) {
            ctx.beginPath();
            ra.outer.forEach((p, i) => { const s = worldToScreen(p); if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y); });
            ctx.closePath();
            if (hasRaHoles) {
              for (const hole of raHoles) {
                hole.forEach((p, i) => { const s = worldToScreen(p); if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y); });
                ctx.closePath();
              }
              ctx.setAttr('fillStyle', 'rgba(200,180,120,0.18)');
              ctx.fill('evenodd');
            } else {
              ctx.setAttr('fillStyle', 'rgba(200,180,120,0.18)');
              ctx.fill();
            }
            ctx.setAttr('strokeStyle', 'rgba(160,130,60,0.55)');
            ctx.setAttr('lineWidth', 1.5);
            ctx.setAttr('lineDash', [6, 4]);
            ctx.stroke();
          }
        }));
      }

      if (state.layers.zones) {
        if (state.layers.zoneMaterials && (!Array.isArray(state.furMaterialsCatalog) || state.furMaterialsCatalog.length === 0) && state.zones.some((z) => z && z.materialId)) {
          loadFurMaterialsCatalog().then(() => { renderScene(); renderPropertyEditor(); }).catch(() => {});
        }
        for (const z of state.zones) {
          const zoneMaterial = state.layers.zoneMaterials ? getFurMaterialById(z && z.materialId) : null;
          if (zoneMaterial) {
            addZoneMaterialOverlay(layerContent, z, getZoneMaterialVisual(zoneMaterial));
          }
          const selected = Number(z && z.id) === Number(state.selectedZoneId);
          const editingZone = selected && ["edit-vertex", "add-vertex", "smooth-vertex", "curve-vertex", "split-zone"].includes(String(state.tool || ""));
          const zoneStroke = editingZone
            ? (ENGINEERING_STYLES.zones.activeEditStroke || ENGINEERING_STYLES.zones.selectedStroke || ENGINEERING_STYLES.zones.stroke)
            : selected
              ? (ENGINEERING_STYLES.zones.selectedStroke || ENGINEERING_STYLES.zones.stroke)
              : ENGINEERING_STYLES.zones.stroke;
          const zoneFill = editingZone
            ? (zoneMaterial ? "rgba(0,0,0,0)" : (ENGINEERING_STYLES.zones.activeEditFill || ENGINEERING_STYLES.zones.selectedFill || ENGINEERING_STYLES.zones.fill || "rgba(0,0,0,0)"))
            : selected
              ? (zoneMaterial ? "rgba(0,0,0,0)" : (ENGINEERING_STYLES.zones.selectedFill || ENGINEERING_STYLES.zones.fill || "rgba(0,0,0,0)"))
              : zoneMaterial
                ? "rgba(0,0,0,0)"
                : (ENGINEERING_STYLES.zones.fill || "rgba(0,0,0,0)");
          const zoneStrokeWidth = editingZone
            ? Number(ENGINEERING_STYLES.zones.activeEditStrokeWidth || ENGINEERING_STYLES.zones.selectedStrokeWidth || ENGINEERING_STYLES.zones.strokeWidth || 1.2)
            : selected
              ? Number(ENGINEERING_STYLES.zones.selectedStrokeWidth || ENGINEERING_STYLES.zones.strokeWidth || 1.2)
              : Number(ENGINEERING_STYLES.zones.strokeWidth || 1.2);
          const zHoles = Array.isArray(z.holes) ? z.holes.map(holeContour).filter((h) => h.length >= 3) : [];
          if (zHoles.length > 0) {
            layerZones.add(new Konva.Shape({
              sceneFunc(ctx, shape) {
                ctx.beginPath();
                z.points.forEach((p, i) => { const s = worldToScreen(p); if (i===0) ctx.moveTo(s.x,s.y); else ctx.lineTo(s.x,s.y); });
                ctx.closePath();
                zHoles.forEach((hole) => {
                  hole.forEach((p, i) => { const s = worldToScreen(p); if (i===0) ctx.moveTo(s.x,s.y); else ctx.lineTo(s.x,s.y); });
                  ctx.closePath();
                });
                ctx.setAttr('fillStyle', zoneFill);
                ctx.fill('evenodd');
                ctx.setAttr('strokeStyle', zoneStroke);
                ctx.setAttr('lineWidth', zoneStrokeWidth);
                ctx.stroke();
              },
              listening: false
            }));
          } else {
            layerZones.add(new Konva.Line({
              points: linePoints(z.points),
              stroke: zoneStroke,
              fill: zoneFill,
              strokeWidth: zoneStrokeWidth,
              closed: true
            }));
          }
          if (Array.isArray(z.points) && z.points.length >= 3) {
            const c = centroid(z.points);
            drawNapArrow(layerZones, c, getZoneNapDirectionDeg(z), selected ? 34 : 24);
          }
        }
      }

      const radialCenterHandle = getRenderableRadialCenterHandle();
      if (radialCenterHandle && radialCenterHandle.point) {
        const s = worldToScreen(radialCenterHandle.point);
        const marker = new Konva.Group({
          x: s.x,
          y: s.y,
          draggable: !!radialCenterHandle.editable,
          name: "radial-center-handle"
        });
        marker.add(new Konva.Circle({
          x: 0,
          y: 0,
          radius: 10,
          fill: "rgba(11,99,206,0.05)",
          stroke: "rgba(0,0,0,0)"
        }));
        marker.add(new Konva.Line({
          points: [-8, 0, 8, 0],
          stroke: "#0b63ce",
          strokeWidth: 1.25,
          listening: false
        }));
        marker.add(new Konva.Line({
          points: [0, -8, 0, 8],
          stroke: "#0b63ce",
          strokeWidth: 1.25,
          listening: false
        }));
        marker.add(new Konva.Circle({
          x: 0,
          y: 0,
          radius: 4,
          fill: "#ffffff",
          stroke: "#0b63ce",
          strokeWidth: 1.25,
          listening: false
        }));
        marker.on("mouseenter", () => setWorkspaceCursor(radialCenterHandle.editable ? "grab" : ""));
        marker.on("mouseleave", () => {
          if (!state.drag.isDown) setWorkspaceCursor("");
        });
        marker.on("dragstart", () => setWorkspaceCursor("grabbing"));
        marker.on("dragmove", () => {
          const world = screenToWorld(marker.x(), marker.y());
          syncRadialCenterFieldValues(world.x, world.y);
          const info = byId("workspaceInfo");
          if (info) info.textContent = `Радиальная: центр (${Math.round(world.x * 10) / 10}; ${Math.round(world.y * 10) / 10}) мм`;
        });
        marker.on("dragend", () => {
          const world = screenToWorld(marker.x(), marker.y());
          syncRadialCenterFieldValues(world.x, world.y);
          setWorkspaceCursor("grab");
          scheduleRadialCenterPreview();
        });
        layerSelection.add(marker);
      }

      let renderedManualSeams = 0;
      if (state.layers.visibleCore && Array.isArray(deferredManualSeamSegments) && deferredManualSeamSegments.length) {
        for (const seam of deferredManualSeamSegments) {
          const pts = Array.isArray(seam && seam.points) ? seam.points : [];
          if (pts.length < 2) continue;
          layerSelection.add(new Konva.Line({
            points: linePoints(pts),
            stroke: ENGINEERING_STYLES.seams.stroke,
            strokeWidth: Math.max(2, Number(ENGINEERING_STYLES.seams.strokeWidth || 1.5)),
            dash: ENGINEERING_STYLES.seams.dash,
            lineCap: "round",
            lineJoin: "round",
            fill: "rgba(0,0,0,0)",
            closed: false,
            listening: false
          }));
          renderedManualSeams += 1;
        }
      }
      if (isManualInventoryMode()) {
        const manualDbg = state.layoutRun && state.layoutRun.manual && state.layoutRun.manual.lastSeamDebug
          ? state.layoutRun.manual.lastSeamDebug
          : null;
        if (manualDbg) {
          manualDbg.layerEnabled = !!(state.layers && state.layers.visibleCore);
          manualDbg.renderedSeams = renderedManualSeams;
        }
      }

      if (state.draftZone.length > 0) {
        const draftClosed = state.tool === "draw-rect" || state.tool === "draw-ellipse" || state.drag.mode === "draw-rect" || state.drag.mode === "draw-ellipse";
        layerZones.add(new Konva.Line({ points: linePoints(state.draftZone), stroke: ENGINEERING_STYLES.zones.stroke, strokeWidth: ENGINEERING_STYLES.zones.strokeWidth, closed: draftClosed }));
      }
      if (Array.isArray(state.draftSplitLine) && state.draftSplitLine.length > 0) {
        if (state.draftSplitLine.length >= 2) {
          layerZones.add(new Konva.Line({
            points: linePoints(state.draftSplitLine),
            stroke: "#444",
            strokeWidth: 1,
            dash: [4, 4],
            closed: false
          }));
        }
        state.draftSplitLine.forEach((pt, idx) => {
          if (!pt || !Number.isFinite(Number(pt.x)) || !Number.isFinite(Number(pt.y))) return;
          const s = worldToScreen(pt);
          layerSelection.add(new Konva.Rect({
            x: Number(s.x) - (idx === 0 ? 8 : 7),
            y: Number(s.y) - (idx === 0 ? 8 : 7),
            width: idx === 0 ? 16 : 14,
            height: idx === 0 ? 16 : 14,
            cornerRadius: 2,
            fill: "rgba(255,255,255,0.94)",
            stroke: "#0b63ce",
            strokeWidth: 1.5,
            listening: false
          }));
          layerSelection.add(new Konva.Rect({
            x: Number(s.x) - (idx === 0 ? 3.5 : 3),
            y: Number(s.y) - (idx === 0 ? 3.5 : 3),
            width: idx === 0 ? 7 : 6,
            height: idx === 0 ? 7 : 6,
            cornerRadius: 1,
            fill: idx === 0 ? "#0b63ce" : "#ffd24a",
            stroke: idx === 0 ? "#084d9e" : "#7a5600",
            strokeWidth: 1,
            listening: false
          }));
        });
      }

      if (state.layers.selection) {
        const z = state.zones.find((x) => x.id === state.selectedZoneId);
        if (z && (state.tool === "edit-vertex" || state.tool === "add-vertex" || state.tool === "smooth-vertex" || state.tool === "curve-vertex")) {
          const hover = state.hover && typeof state.hover === "object" ? state.hover : null;
          const hoveredVertexIndex = hover && Number(hover.zoneId || 0) === Number(z.id || 0) ? Number(hover.vertexIndex) : null;
          const hoveredEdgePoint = hover && Number(hover.zoneId || 0) === Number(z.id || 0) && hover.edgePoint ? hover.edgePoint : null;
          const hc = getHandleConfig();
          for (let vertexIndex = 0; vertexIndex < z.points.length; vertexIndex++) {
            const p = z.points[vertexIndex];
            const s = worldToScreen(p);
            const boundaryVertex = isZoneVertexOnDetailBoundary(z, vertexIndex);
            const activeVertex = Number(vertexIndex) === Number(state.selectedVertexIndex);
            const hoveredVertex = Number(vertexIndex) === Number(hoveredVertexIndex);
            if (activeVertex) {
              layerSelection.add(new Konva.Circle({
                x: s.x,
                y: s.y,
                radius: hc.activeGlowR,
                fill: "rgba(255,210,74,0.18)",
                stroke: "rgba(0,0,0,0)",
                listening: false
              }));
            }
            layerSelection.add(new Konva.Circle({
              x: s.x,
              y: s.y,
              radius: activeVertex ? hc.activeR : (hoveredVertex ? hc.hoveredR : (boundaryVertex ? hc.boundaryR : hc.vertexR)),
              fill: activeVertex ? "#ffd24a" : (hoveredVertex ? "#ffe79a" : (boundaryVertex ? "#ffffff" : ENGINEERING_STYLES.selection.pointFill)),
              stroke: activeVertex ? "#7a5600" : (hoveredVertex ? "#8a6a12" : (boundaryVertex ? "#0b63ce" : "rgba(0,0,0,0)")),
              strokeWidth: activeVertex ? hc.strokeWActive : (hoveredVertex ? hc.strokeW : (boundaryVertex ? hc.strokeW : 0))
            }));
            if (!activeVertex) {
              layerSelection.add(new Konva.Circle({
                x: s.x,
                y: s.y,
                radius: hoveredVertex ? hc.dotHoveredR : hc.dotR,
                fill: hoveredVertex ? "#6f540b" : (boundaryVertex ? "#0b63ce" : "#ffffff"),
                stroke: "rgba(0,0,0,0)",
                listening: false
              }));
            } else {
              layerSelection.add(new Konva.Circle({
                x: s.x,
                y: s.y,
                radius: hc.dotActiveR,
                fill: "#5c3c00",
                stroke: "rgba(0,0,0,0)",
                listening: false
              }));
            }
          }
          if (state.tool === "add-vertex" && hoveredEdgePoint) {
            const hs = worldToScreen(hoveredEdgePoint);
            layerSelection.add(new Konva.Circle({
              x: hs.x,
              y: hs.y,
              radius: hc.addVertexGlowR,
              fill: "rgba(11,99,206,0.10)",
              stroke: "rgba(0,0,0,0)",
              listening: false
            }));
            layerSelection.add(new Konva.Circle({
              x: hs.x,
              y: hs.y,
              radius: hc.addVertexR,
              fill: "#ffffff",
              stroke: "#0b63ce",
              strokeWidth: 1.5,
              listening: false
            }));
            layerSelection.add(new Konva.Line({
              points: [hs.x - 4, hs.y, hs.x + 4, hs.y, hs.x, hs.y - 4, hs.x, hs.y + 4],
              stroke: "#0b63ce",
              strokeWidth: 1.15,
              lineCap: "round",
              listening: false
            }));
          }
          // §3.2 / §3.6-endpoint: render linked sibling vertices as secondary (light teal, no active style)
          if (state.drag && state.drag.mode === "move-vertex" && Array.isArray(state.drag.sharedLinkedVertices) && state.drag.sharedLinkedVertices.length > 0) {
            for (const linked of state.drag.sharedLinkedVertices) {
              const sib = (Array.isArray(state.zones) ? state.zones : []).find((sx) => Number(sx && sx.id || 0) === Number(linked.zoneId || 0));
              if (!sib || !Array.isArray(sib.points)) continue;
              const sibVi = Number(linked.vertexIndex);
              if (sibVi < 0 || sibVi >= sib.points.length) continue;
              const sp = worldToScreen(sib.points[sibVi]);
              layerSelection.add(new Konva.Circle({ x: sp.x, y: sp.y, radius: hc.activeGlowR, fill: "rgba(0,180,160,0.13)", stroke: "rgba(0,0,0,0)", listening: false }));
              layerSelection.add(new Konva.Circle({ x: sp.x, y: sp.y, radius: hc.activeR, fill: "#b2f0ea", stroke: "#0a8c80", strokeWidth: 1.5, listening: false }));
            }
          }
        }
        const curveCtx = getCurveEditContext();
        if (curveCtx) {
          const hcc = getHandleConfig();
          const center = worldToScreen(curveCtx.cur);
          const prevHandle = worldToScreen(curveCtx.handlePrev);
          const nextHandle = worldToScreen(curveCtx.handleNext);
          const guideStroke = "rgba(9,71,145,0.55)";
          const handleStroke = "#094791";
          const handleFill = "#ffffff";
          layerSelection.add(new Konva.Line({
            points: [center.x, center.y, prevHandle.x, prevHandle.y],
            stroke: guideStroke,
            strokeWidth: 1.25,
            dash: [4, 4],
            listening: false
          }));
          layerSelection.add(new Konva.Line({
            points: [center.x, center.y, nextHandle.x, nextHandle.y],
            stroke: guideStroke,
            strokeWidth: 1.25,
            dash: [4, 4],
            listening: false
          }));
          for (const handle of [
            { name: "curve-handle-prev", point: prevHandle, vector: curveCtx.uPrev },
            { name: "curve-handle-next", point: nextHandle, vector: curveCtx.uNext }
          ]) {
            const marker = new Konva.Group({
              x: handle.point.x,
              y: handle.point.y,
              name: handle.name
            });
            marker.add(new Konva.Circle({
              x: 0,
              y: 0,
              radius: hcc.curveGlowR,
              fill: "rgba(9,71,145,0.09)",
              stroke: "rgba(0,0,0,0)",
              listening: false
            }));
            marker.add(new Konva.Circle({
              x: 0,
              y: 0,
              radius: hcc.curveHandleR,
              fill: handleFill,
              stroke: handleStroke,
              strokeWidth: 1.5,
              listening: false
            }));
            layerSelection.add(marker);
          }
          layerSelection.add(new Konva.Circle({
            x: center.x,
            y: center.y,
            radius: hcc.curveCenterR,
            fill: "#094791",
            stroke: "#ffffff",
            strokeWidth: 1.4,
            listening: false
          }));
        }
        for (const p of state.draftZone) {
          const s = worldToScreen(p);
          const _hcd = getHandleConfig();
          layerSelection.add(new Konva.Circle({ x: s.x, y: s.y, radius: _hcd.draftDotR, fill: "#000000" }));
        }
      }

      try {
        if (state.debugVertex && state.debugVertex.enabled && state.debugVertex.last && ["edit-vertex", "add-vertex", "smooth-vertex", "curve-vertex"].includes(String(state.tool || ""))) {
          layerUi.add(new Konva.Label({
            x: 14,
            y: 14,
            listening: false
          }).add(new Konva.Tag({
            fill: "rgba(255,255,255,0.92)",
            stroke: "rgba(0,0,0,0.18)",
            strokeWidth: 1,
            cornerRadius: 4
          })).add(new Konva.Text({
            text: String(state.debugVertex.last || ""),
            fontSize: 11,
            fontFamily: "Iosevka, monospace",
            fill: "#222",
            padding: 6
          })));
        }
      } catch (_) {}

      layerGuides.draw();
      layerContent.draw();
      layerOverlay.draw();
      layerSelection.draw();
      updateReportsButtonState();

      const workspaceInfo = byId("workspaceInfo");
      if (workspaceInfo) workspaceInfo.textContent = "";
    }

    // Auto show/hide workspaceInfo based on content
    (function setupWorkspaceInfoVisibility() {
      const el = byId("workspaceInfo");
      if (!el) return;
      const update = () => { el.style.display = el.textContent.trim() ? "" : "none"; };
      update();
      new MutationObserver(update).observe(el, { childList: true, characterData: true, subtree: true });
    })();

function refreshSelectionInfo() {
      byId("selectionInfo").textContent = `selected: ${selectedIndexes.size}`;
    }
    function updateModeUi() {
      const zprj = previewSourceType === "zprj";
      byId("zprjSettingsPanel").style.display = zprj ? "block" : "none";
    }

    function arrayBufferToBase64(buf) {
      const bytes = new Uint8Array(buf);
      const chunk = 0x8000;
      let out = "";
      for (let i = 0; i < bytes.length; i += chunk) {
        const part = bytes.subarray(i, i + chunk);
        out += String.fromCharCode.apply(null, Array.from(part));
      }
      return btoa(out);
    }

    async function runPreviewDxfUpload(fileList) {
      const files = Array.from(fileList || []).filter((f) => /\\.dxf$/i.test(String(f && f.name || "")));
      if (!files.length) {
        show("discoverOut", { ok: false, error: "no_dxf_files_selected" });
        return;
      }
      const payloadFiles = [];
      for (const f of files) {
        const arr = await f.arrayBuffer();
        payloadFiles.push({
          name: String(f.name || "upload.dxf"),
          dataBase64: arrayBufferToBase64(arr)
        });
      }
      const json = await api("/api/import/dxf/preview-upload", "POST", { files: payloadFiles }, 10 * 60 * 1000);
      show("discoverOut", json);
      if (!json.ok) return;
      previewSourceType = "dxf";
      updateModeUi();
      previewToken = json.token || "";
      previewItems = Array.isArray(json.items) ? json.items : [];
      selectedIndexes = new Set(); activePreviewIndex = null;
      renderPreviewTable();
      const firstReady = previewItems.filter((x) => x && x.isReadyForCommit === true);
      if (firstReady.length) {
        await autoLoadFirstGeometry(firstReady);
      } else {
        state.patternGeometry = null; renderScene();
        byId("workspaceInfo").textContent = "DXF upload preview loaded (no ready geometry items)";
      }
      show("previewOut", json);
    }

    async function showZoneImportPreviewModal() {
      const details = Array.isArray(state.details) ? state.details : [];
      const geom = window.FurLabGeom;

      // Build per-detail validation info
      const rows = details.map((d, i) => {
        const pts = Array.isArray(d && d.entity && d.entity.points) ? d.entity.points : [];
        let area = 0;
        let issues = [];
        if (pts.length >= 3 && geom) {
          area = Math.abs(geom.polygonArea(pts));
          if (area < MIN_ZONE_AREA_MM2) issues.push("слишком маленькая площадь");
          if (geom.polygonHasSelfIntersection && geom.polygonHasSelfIntersection(pts)) issues.push("самопересечение");
        } else if (pts.length < 3) {
          issues.push("меньше 3 точек");
        }
        return { detailId: d.id, name: `Деталь ${i + 1} (id ${d.id})`, area, issues, valid: issues.length === 0 };
      });

      const validCount = rows.filter((r) => r.valid).length;

      return new Promise((resolve) => {
        // Remove any existing modal
        const existing = document.getElementById("zoneImportPreviewModal");
        if (existing) existing.remove();

        const overlay = document.createElement("div");
        overlay.id = "zoneImportPreviewModal";
        overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;display:flex;align-items:center;justify-content:center;";

        const box = document.createElement("div");
        box.style.cssText = "background:#fff;border-radius:8px;padding:24px;min-width:420px;max-width:600px;max-height:80vh;overflow-y:auto;box-shadow:0 4px 32px rgba(0,0,0,0.18);font-family:inherit;";

        const title = document.createElement("h3");
        title.style.cssText = "margin:0 0 12px;font-size:15px;font-weight:600;";
        title.textContent = `Импорт зон — найдено контуров: ${rows.length}`;
        box.appendChild(title);

        const table = document.createElement("table");
        table.style.cssText = "width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;";
        const thead = document.createElement("thead");
        thead.innerHTML = `<tr style="border-bottom:1px solid #ddd;"><th style="text-align:left;padding:4px 8px;color:#555;">Контур</th><th style="text-align:right;padding:4px 8px;color:#555;">Площадь</th><th style="text-align:left;padding:4px 8px;color:#555;">Статус</th></tr>`;
        table.appendChild(thead);
        const tbody = document.createElement("tbody");
        for (const r of rows) {
          const tr = document.createElement("tr");
          tr.style.cssText = `border-bottom:1px solid #f0f0f0;background:${r.valid ? "" : "#fff8f8"};`;
          tr.innerHTML = `<td style="padding:4px 8px;">${r.name}</td><td style="padding:4px 8px;text-align:right;">${r.area.toFixed(1)} мм²</td><td style="padding:4px 8px;color:${r.valid ? "#2a7a2a" : "#c0392b"};">${r.valid ? "✓ ок" : "✗ " + r.issues.join(", ")}</td>`;
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        box.appendChild(table);

        if (validCount === 0) {
          const warn = document.createElement("p");
          warn.style.cssText = "color:#c0392b;font-size:13px;margin:0 0 16px;";
          warn.textContent = "Нет валидных контуров для импорта.";
          box.appendChild(warn);
        }

        const btns = document.createElement("div");
        btns.style.cssText = "display:flex;gap:10px;justify-content:flex-end;";

        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Отмена";
        cancelBtn.style.cssText = "padding:7px 18px;border:1px solid #ccc;border-radius:5px;background:#fff;cursor:pointer;font-size:13px;";
        cancelBtn.onclick = () => {
          overlay.remove();
          // Rollback: clear geometry state
          state.patternGeometry = null;
          state.details = [];
          renderScene();
          resolve(false);
        };

        const confirmBtn = document.createElement("button");
        confirmBtn.textContent = `Создать зоны (${validCount})`;
        confirmBtn.disabled = validCount === 0;
        confirmBtn.style.cssText = `padding:7px 18px;border:none;border-radius:5px;background:${validCount > 0 ? "#1a56db" : "#aaa"};color:#fff;cursor:${validCount > 0 ? "pointer" : "not-allowed"};font-size:13px;font-weight:500;`;
        confirmBtn.onclick = () => {
          overlay.remove();
          // Create zones only from valid details
          const validIds = new Set(rows.filter((r) => r.valid).map((r) => r.detailId));
          initZonesFromDetails(validIds);
          state.nextZoneId = (Array.isArray(state.zones) ? state.zones : []).reduce((max, z) => Math.max(max, Number(z && z.id || 0)), 0) + 1;
          state.selectedZoneId = null;
          state.selectedDetailId = null;
          renderDetailZoneTree();
          renderPropertyEditor();
          renderScene();
          void persistZonesForCurrentWorkspace();
          resolve(true);
        };

        btns.appendChild(cancelBtn);
        btns.appendChild(confirmBtn);
        box.appendChild(btns);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
      });
    }

    async function loadGeometryForIndex(idx) {
      activePreviewIndex = idx;
      renderPreviewTable();
      try {
        const item = previewItems.find((x) => Number(x && x.previewIndex) === Number(idx)) || null;
        const json = await api("/api/import/dxf/geometry", "POST", {
          token: previewToken,
          previewIndex: idx,
          item: item ? {
            previewIndex: Number(item.previewIndex),
            sourcePath: String(item.sourcePath || ""),
            geometryPath: String(item.geometryPath || ""),
            geometryFormat: String(item.geometryFormat || ""),
            sizeBytes: Number(item.sizeBytes || 0),
            modifiedAt: String(item.modifiedAt || "")
          } : null
        });
        if (!json.ok) {
          state.patternGeometry = null;
          renderScene();
          byId("workspaceInfo").textContent = `geometry error: ${json.error || "unknown"} (idx=${idx})`;
          return false;
        }
        state.patternGeometry = json.geometry;
        state.loadedProjectWorkspaceKey = null;
        // Fresh DXF import вЂ" clean slate, no zones or layouts from previous sessions
        state.zones = [];
        state.layouts = [];
        state.selectedLayoutId = null;
        state.nextLayoutId = 1;
        state.activeProjectId = null;
        state.activeProjectName = null;
        state.selectedZoneId = null;
        state.selectedDetailId = null;
        clearActiveLayoutRuntime();
        fitPatternToView();
        updateProjectUi();
        renderLayoutModeSwitch();
        renderScene(); // populates state.details from geometry
        await showZoneImportPreviewModal();
        return true;
      } catch (e) {
        state.patternGeometry = null;
        renderScene();
        byId("workspaceInfo").textContent = `geometry request failed (idx=${idx}): ${e && e.message ? e.message : "unknown"}`;
        return false;
      }
    }

    async function autoLoadFirstGeometry(candidates) {
      const seen = new Set();
      const queue = [];
      for (const c of candidates || []) {
        const idx = Number(c && c.previewIndex);
        if (!Number.isFinite(idx) || seen.has(idx)) continue;
        seen.add(idx);
        queue.push(idx);
      }
      for (const idx of queue) {
        selectedIndexes = new Set([idx]);
        refreshSelectionInfo();
        const ok = await loadGeometryForIndex(idx);
        if (ok) return true;
      }
      state.patternGeometry = null;
      state.details = [];
      state.selectedDetailId = null;
      renderScene();
      return false;
    }

    function renderPreviewTable() {
      const body = byId("previewTableBody"); body.innerHTML = "";
      const hasItems = previewItems.length > 0;
      byId("previewTableWrap").style.display = hasItems ? "block" : "none";
      byId("importActionsRow").style.display = hasItems ? "flex" : "none";
      byId("previewEmptyHint").style.display = hasItems ? "none" : "flex";
      if (!previewItems.length) {
        refreshSelectionInfo();
        return;
      }
      for (const item of previewItems) {
        const idx = Number(item.previewIndex), checked = selectedIndexes.has(idx);
        const entities = Number(
          (item.dxfSummary && item.dxfSummary.entities) ||
          (item.pacSummary && item.pacSummary.entityCount) ||
          (item.posSummary && item.posSummary.entityCount) ||
          0
        );
        const errorText = safeText(item.error || "");
        const tr = document.createElement("tr"); if (activePreviewIndex === idx) tr.className = "active";
        tr.innerHTML = `
          <td><input type="checkbox" data-idx="${idx}" ${checked ? "checked" : ""}></td>
          <td class="col-idx">${idx}</td>
          <td><div>${safeText(item.partName || item.fileName)}</div><div class="muted">${safeText(item.sourcePath)}</div></td>
          <td class="${item.isReadyForCommit ? "ok" : "muted"}">${item.isReadyForCommit ? "yes" : "-"}</td>
          <td>${Number(item.sizeBytes || 0)}</td>
          <td>${entities}</td>
          <td class="${errorText ? "bad" : "muted"}">${errorText || "-"}</td>
        `;
        tr.addEventListener("click", (e) => {
          const tag = String(e.target && e.target.tagName || "").toLowerCase();
          if (tag === "input") return;
          selectedIndexes = new Set([idx]); refreshSelectionInfo();
          if (previewSourceType === "dxf" || item.geometryAvailable === true) {
            void loadGeometryForIndex(idx);
          } else {
            activePreviewIndex = idx;
            renderPreviewTable();
            state.patternGeometry = null;
            state.details = [];
            state.selectedDetailId = null;
            renderScene();
            byId("workspaceInfo").textContent = "ZPRJ preview selected (no geometry available for this item)";
          }
        });
        body.appendChild(tr);
      }
      body.querySelectorAll("input[type=checkbox]").forEach((el) => {
        el.addEventListener("change", (e) => {
          const idx = Number(e.target.getAttribute("data-idx"));
          if (e.target.checked) selectedIndexes.add(idx); else selectedIndexes.delete(idx);
          refreshSelectionInfo();
        });
      });
      refreshSelectionInfo();
    }

    function setupRightPanelResize() {
      const splitter = byId("rightPanelSplitter");
      if (!splitter) return;
      const panel = splitter.parentElement;
      const top = panel ? panel.querySelector(".right-top") : null;
      const bottom = panel ? panel.querySelector(".right-bottom") : null;
      if (!panel || !top || !bottom) return;

      let dragging = false;
      let startY = 0;
      let startTop = 0;

      splitter.addEventListener("mousedown", (e) => {
        dragging = true;
        startY = e.clientY;
        startTop = top.getBoundingClientRect().height;
        document.body.style.userSelect = "none";
        e.preventDefault();
      });

      window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const panelH = panel.getBoundingClientRect().height;
        const splitterH = splitter.getBoundingClientRect().height || 8;
        const minTop = 140;
        const minBottom = 120;
        const maxTop = Math.max(minTop, panelH - splitterH - minBottom);
        const nextTop = Math.max(minTop, Math.min(maxTop, startTop + (e.clientY - startY)));
        top.style.height = `${Math.round(nextTop)}px`;
      });

      window.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        document.body.style.userSelect = "";
      });
    }

    function ensureToolUiState() {
      state.toolUi = state.toolUi && typeof state.toolUi === "object" ? state.toolUi : {};
      state.toolUi.penSubtool = String(state.toolUi.penSubtool || "split-zone");
      state.toolUi.polygonSubtool = String(state.toolUi.polygonSubtool || "draw-zone");
      return state.toolUi;
    }

    function closeZoneToolMenus() {
      const penMenu = byId("zoneToolPenMenu");
      const polygonMenu = byId("zoneToolPolygonMenu");
      const penGroup = byId("zoneToolPenBtn") && byId("zoneToolPenBtn").closest(".zone-tool-group");
      const polygonGroup = byId("zoneToolPolygonBtn") && byId("zoneToolPolygonBtn").closest(".zone-tool-group");
      if (penMenu) penMenu.hidden = true;
      if (polygonMenu) polygonMenu.hidden = true;
      if (penGroup) penGroup.classList.remove("is-open");
      if (polygonGroup) polygonGroup.classList.remove("is-open");
    }

    function setWorkspaceTool(nextTool, options = {}) {
      const ui = ensureToolUiState();
      const prevTool = String(state.tool || "select");
      const normalized = String(nextTool || "select");
      if (prevTool === "curve-vertex" && normalized !== "curve-vertex") {
        clearCurveEdit({ restore: true });
      }
      if (!isVertexEditingTool(normalized)) state.selectedVertexIndex = null;
      state.tool = normalized;
      if (normalized !== "draw-zone") state.draftZone = [];
      if (normalized !== "split-zone") state.draftSplitLine = [];
      if (normalized === "split-zone" || normalized === "add-vertex" || normalized === "edit-vertex" || normalized === "curve-vertex" || normalized === "smooth-vertex") ui.penSubtool = normalized;
      if (normalized === "draw-zone" || normalized === "draw-rect" || normalized === "draw-ellipse") ui.polygonSubtool = normalized;
      const toolSelect = byId("toolSelect");
      if (toolSelect && String(toolSelect.value || "") !== normalized) toolSelect.value = normalized;
      renderZoneToolPalette();
      if (!state.drag.isDown || state.drag.mode !== "pan") setWorkspaceCursor("");
      if (!options.skipRender) renderScene();
    }

    function renderZoneToolPalette() {
      const ui = ensureToolUiState();
      const selectBtn = byId("zoneToolSelectBtn");
      const penBtn = byId("zoneToolPenBtn");
      const polygonBtn = byId("zoneToolPolygonBtn");
      const syncStandaloneButtonIcon = (button, active) => {
        if (!button) return;
        const btnImg = button.querySelector("img");
        if (!btnImg) return;
        const normalSrc = String(button.getAttribute("data-icon") || btnImg.getAttribute("src") || "").trim();
        const activeSrc = String(button.getAttribute("data-active-icon") || "").trim();
        const nextSrc = active && activeSrc ? activeSrc : normalSrc;
        if (nextSrc) btnImg.setAttribute("src", nextSrc);
      };
      const syncGroupButtonIcon = (groupName, currentTool, button) => {
        if (!button) return;
        const activeItem = document.querySelector(`.zone-tool-submenu-item[data-group='${groupName}'][data-tool='${currentTool}']`);
        if (!activeItem) return;
        const itemImg = activeItem.querySelector("img");
        const itemLabel = activeItem.querySelector("span:not(.zone-tool-shortcut)");
        const btnImg = button.querySelector("img");
        const largeIcon = String(activeItem.getAttribute("data-large-icon") || "").trim();
        const activeLargeIcon = String(activeItem.getAttribute("data-active-large-icon") || "").trim();
        const buttonActive = button.classList.contains("is-active");
        const nextSrc = (buttonActive ? activeLargeIcon : "") || largeIcon || (itemImg && itemImg.getAttribute("src")) || "";
        if (btnImg && nextSrc) {
          btnImg.setAttribute("src", nextSrc);
        }
        if (itemLabel) {
          const title = String(itemLabel.textContent || "").trim();
          if (title) button.setAttribute("title", title);
        }
      };
      const currentTool = String(state.tool || "");
      const selectActive = currentTool === "select";
      const penActive = ["split-zone", "add-vertex", "edit-vertex", "curve-vertex", "smooth-vertex"].includes(currentTool);
      const polygonActive = ["draw-zone", "draw-rect", "draw-ellipse"].includes(currentTool);
      const intarsiaPenActive = currentTool === "intarsia-pen";
      const intarsiaPenBtn = byId("zoneToolIntarsiaPenBtn");
      const isIntarsiaLayout = state.layoutMode === "intarsia";
      if (intarsiaPenBtn) intarsiaPenBtn.style.display = isIntarsiaLayout ? "" : "none";
      if (selectBtn) selectBtn.classList.remove("is-active");
      if (penBtn) penBtn.classList.remove("is-active");
      if (polygonBtn) polygonBtn.classList.remove("is-active");
      if (intarsiaPenBtn) intarsiaPenBtn.classList.remove("is-active");
      if (selectBtn && selectActive) selectBtn.classList.add("is-active");
      if (penBtn && penActive) penBtn.classList.add("is-active");
      if (polygonBtn && polygonActive) polygonBtn.classList.add("is-active");
      if (intarsiaPenBtn && intarsiaPenActive) intarsiaPenBtn.classList.add("is-active");
      if (intarsiaPenBtn) {
        const btnImg = intarsiaPenBtn.querySelector("img");
        if (btnImg) btnImg.src = intarsiaPenActive ? "/assets/tool-icons/intarsia-pen-active.svg" : "/assets/tool-icons/intarsia-pen.svg";
      }
      document.querySelectorAll(".zone-tool-submenu-item[data-group='pen']").forEach((node) => {
        node.classList.toggle("is-active", String(node.getAttribute("data-tool") || "") === String(ui.penSubtool || ""));
      });
      document.querySelectorAll(".zone-tool-submenu-item[data-group='polygon']").forEach((node) => {
        node.classList.toggle("is-active", String(node.getAttribute("data-tool") || "") === String(ui.polygonSubtool || ""));
      });
      syncStandaloneButtonIcon(selectBtn, selectActive);
      syncGroupButtonIcon("pen", String(ui.penSubtool || ""), penBtn);
      syncGroupButtonIcon("polygon", String(ui.polygonSubtool || ""), polygonBtn);
    }

    function bindZoneToolPalette() {
      ensureToolUiState();
      const palette = byId("zoneToolPalette");
      if (!palette) return;
      const selectBtn = byId("zoneToolSelectBtn");
      const penBtn = byId("zoneToolPenBtn");
      const polygonBtn = byId("zoneToolPolygonBtn");
      const penMenu = byId("zoneToolPenMenu");
      const polygonMenu = byId("zoneToolPolygonMenu");
      const penGroup = penBtn ? penBtn.closest(".zone-tool-group") : null;
      const polygonGroup = polygonBtn ? polygonBtn.closest(".zone-tool-group") : null;

      const openGroupMenu = (groupName) => {
        const isPen = groupName === "pen";
        if (penMenu) penMenu.hidden = !isPen;
        if (polygonMenu) polygonMenu.hidden = isPen;
        if (penGroup) penGroup.classList.toggle("is-open", isPen);
        if (polygonGroup) polygonGroup.classList.toggle("is-open", !isPen);
      };

      if (selectBtn) {
        selectBtn.addEventListener("click", () => {
          closeZoneToolMenus();
          setWorkspaceTool("select");
        });
      }
      if (penBtn) {
        penBtn.addEventListener("click", () => {
          if (penMenu && !penMenu.hidden) {
            closeZoneToolMenus();
          } else {
            openGroupMenu("pen");
          }
          renderZoneToolPalette();
        });
      }
      if (polygonBtn) {
        polygonBtn.addEventListener("click", () => {
          if (polygonMenu && !polygonMenu.hidden) {
            closeZoneToolMenus();
          } else {
            openGroupMenu("polygon");
          }
          renderZoneToolPalette();
        });
      }
      palette.querySelectorAll(".zone-tool-submenu-item").forEach((node) => {
        node.addEventListener("click", () => {
          if (node.disabled || node.classList.contains("is-disabled")) return;
          const tool = String(node.getAttribute("data-tool") || "");
          closeZoneToolMenus();
          setWorkspaceTool(tool);
        });
      });
      document.addEventListener("click", (e) => {
        if (!palette.contains(e.target)) closeZoneToolMenus();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeZoneToolMenus();
      });
      const intarsiaPenBtn = byId("zoneToolIntarsiaPenBtn");
      if (intarsiaPenBtn) {
        intarsiaPenBtn.addEventListener("click", () => {
          closeZoneToolMenus();
          setWorkspaceTool(state.tool === "intarsia-pen" ? "select" : "intarsia-pen");
        });
      }
      renderZoneToolPalette();
      setWorkspaceCursor("");
    }

    byId("toolSelect").onchange = (e) => setWorkspaceTool(String(e.target.value || "select"), { skipRender: false });
    bindZoneToolPalette();
    const uiBindingsApi = window.FurLabUiBindings || {};
    const uiBindings = (typeof uiBindingsApi.createUiBindings === "function")
      ? uiBindingsApi.createUiBindings({
        byId,
        api: (url, method, body, timeoutMs) => api(url, method, body, timeoutMs),
        state,
        renderScene: () => renderScene(),
        clampInputNumber: (id, min, max, fallback) => clampInputNumber(id, min, max, fallback),
        previewIntarsiaFragmentsDraft: () => previewIntarsiaFragmentsDraft(),
        setIntarsiaStepPhase: (phase) => setIntarsiaStepPhase(phase),
        runInventoryPickFlow: (options) => runInventoryPickFlow(options),
        closeInventoryStep1: () => closeInventoryStep1(),
        closeInventoryStep2: () => closeInventoryStep2(),
        openInventoryStep1: () => openInventoryStep1(),
        buildOracleCaseFromCurrentPreview: () => buildOracleCaseFromCurrentPreview(),
        downloadJsonFile: (fileName, obj) => downloadJsonFile(fileName, obj),
        requestInventoryManualSuggestions: () => requestInventoryManualSuggestions(),
        recomputeInventoryManualVisibility: () => requestManualRecomputeFromUi(),
        undoInventoryManualPlacement: () => undoInventoryManualPlacement(),
        closeReplaceCandidateModal: () => closeReplaceCandidateModal(),
        closeLayoutTypePicker: () => closeLayoutTypePicker(),
        layoutTypePicker,
        addLayoutByMode: (mode) => addLayoutByMode(mode),
        addMaterialById: (materialId) => addMaterialById(materialId),
        isManualInventoryMode: () => isManualInventoryMode(),
        renderLayoutModeSwitch: () => renderLayoutModeSwitch(),
        renderDetailZoneTree: () => renderDetailZoneTree(),
        renderPropertyEditor: () => renderPropertyEditor(),
        syncFillTypeUi: () => syncFillTypeUi(),
        getPreviewToken: () => previewToken
      })
      : null;
    if (uiBindings && typeof uiBindings.bindMainControls === "function") {
      uiBindings.bindMainControls();
    }
    // Sync layer state from DOM checkboxes (checked attr = default visible)
    const LAYER_MAP = [
      ["layerPattern", "pattern"], ["layerZones", "zones"], ["layerZoneMaterials", "zoneMaterials"],
      ["layerSelection", "selection"], ["layerGuides", "guides"], ["layerVisibleArea", "visibleArea"],
      ["layerPieceIntersections", "pieceIntersections"], ["layerPieceBorders", "pieceBorders"],
      ["layerAssignedPieces", "assignedPieces"], ["layerPfullZ", "pfullZ"],
      ["layerUsedGain", "usedGain"], ["layerPcoreZ", "pcoreZ"], ["layerVisibleCore", "visibleCore"],
      ["layerSplitLeftovers", "splitLeftovers"], ["layerCoverageHoles", "coverageHoles"],
    ];
    function syncLayersFromCheckboxes() {
      for (const [id, key] of LAYER_MAP) {
        const el = byId(id);
        if (el) state.layers[key] = !!el.checked;
      }
    }
    syncLayersFromCheckboxes();
    const reportsBtn = byId("reportsBtn");
    if (reportsBtn) reportsBtn.onclick = () => openReportsModal();
    const reportsCloseBtn = byId("reportsCloseBtn");
    if (reportsCloseBtn) reportsCloseBtn.onclick = () => closeReportsModal();
    const reportsCloseFooterBtn = byId("reportsCloseFooterBtn");
    if (reportsCloseFooterBtn) reportsCloseFooterBtn.onclick = () => closeReportsModal();
    const reportsBackdrop = byId("reportsBackdrop");
    if (reportsBackdrop) {
      reportsBackdrop.addEventListener("click", (e) => {
        if (e.target === reportsBackdrop) closeReportsModal();
      });
    }
    const zoneMaterialCloseBtn = byId("zoneMaterialCloseBtn");
    if (zoneMaterialCloseBtn) zoneMaterialCloseBtn.onclick = () => closeZoneMaterialModal();
    const zoneMaterialCancelBtn = byId("zoneMaterialCancelBtn");
    if (zoneMaterialCancelBtn) zoneMaterialCancelBtn.onclick = () => closeZoneMaterialModal();
    const zoneMaterialApplyBtn = byId("zoneMaterialApplyBtn");
    if (zoneMaterialApplyBtn) {
      zoneMaterialApplyBtn.onclick = async () => {
        const zoneId = Number(state.pendingZoneMaterialZoneId || 0) || 0;
        const zone = state.zones.find((item) => Number(item && item.id || 0) === zoneId) || null;
        const select = byId("zoneMaterialSelect");
        if (!zone || !select) {
          closeZoneMaterialModal();
          return;
        }
        const items = await loadMaterialsDict();
        const pickedId = String(select.value || "").trim();
        const material = pickedId
          ? (items.find((item) => String(item.id || "") === pickedId) || { id: pickedId, name: pickedId })
          : { id: null, name: null };
        const json = await assignMaterialToZone(zone, material);
        if (!json || !json.ok) {
          byId("workspaceInfo").textContent = `Ошибка назначения материала: ${String(json && json.error || "unknown")}`;
          return;
        }
        closeZoneMaterialModal();
      };
    }
    const zoneMaterialBackdrop = byId("zoneMaterialBackdrop");
    if (zoneMaterialBackdrop) {
      zoneMaterialBackdrop.addEventListener("click", (e) => {
        if (e.target === zoneMaterialBackdrop) closeZoneMaterialModal();
      });
    }

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const reportsBackdrop = byId("reportsBackdrop");
        if (reportsBackdrop && reportsBackdrop.style.display === "flex") {
          closeReportsModal();
          return;
        }
        if (Array.isArray(state.draftZone) && state.draftZone.length > 0) {
          state.draftZone = [];
          byId("workspaceInfo").textContent = "";
          renderScene();
          return;
        }
        if (Array.isArray(state.draftSplitLine) && state.draftSplitLine.length > 0) {
          state.draftSplitLine = [];
          byId("workspaceInfo").textContent = "";
          renderScene();
          return;
        }
        if (Array.isArray(state.draftIntarsiaContour) && state.draftIntarsiaContour.length > 0) {
          state.draftIntarsiaContour = [];
          byId("workspaceInfo").textContent = "";
          renderScene();
          return;
        }
      }
      const target = e.target;
      const tag = target && target.tagName ? String(target.tagName).toUpperCase() : "";
      const isTyping = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!(target && target.isContentEditable);
      if (!isTyping && e.key === "Enter" && state.tool === "intarsia-pen") {
        if (Array.isArray(state.draftIntarsiaContour) && state.draftIntarsiaContour.length >= 3) {
          finishIntarsiaContour();
        }
        return;
      }
      const ctrlOrMeta = !!(e.ctrlKey || e.metaKey);

      if (!isTyping && ctrlOrMeta && !e.altKey && !isManualInventoryMode()) {
        const key = String(e.key || "").toLowerCase();
        if (key === "z" && !e.shiftKey) {
          e.preventDefault();
          undo();
          return;
        }
        if ((key === "y") || (key === "z" && e.shiftKey)) {
          e.preventDefault();
          redo();
          return;
        }
        if (e.shiftKey && e.code === "KeyM") {
          const zone = state.zones.find((z) => Number(z && z.id || 0) === Number(state.selectedZoneId || 0)) || null;
          if (zone) {
            e.preventDefault();
            void loadMaterialsDict().then((items) => openZoneMaterialModal(zone, items)).catch(() => {});
            return;
          }
        }
      }

      if (!isTyping && !ctrlOrMeta && !e.altKey) {
        const code = String(e.code || "");
        if (code === "KeyL") {
          e.preventDefault();
          setWorkspaceTool("split-zone");
          return;
        }
        if (code === "KeyX") {
          e.preventDefault();
          setWorkspaceTool("add-vertex");
          return;
        }
        if (code === "KeyV") {
          e.preventDefault();
          setWorkspaceTool("edit-vertex");
          return;
        }
        if (code === "KeyC") {
          e.preventDefault();
          setWorkspaceTool("curve-vertex");
          return;
        }
        if (code === "KeyS") {
          e.preventDefault();
          setWorkspaceTool("smooth-vertex");
          return;
        }
        if (code === "KeyR") {
          e.preventDefault();
          setWorkspaceTool("draw-rect");
          return;
        }
        if (code === "KeyE") {
          e.preventDefault();
          setWorkspaceTool("draw-ellipse");
          return;
        }
        if ((e.key === "Delete" || e.key === "Backspace") && isVertexEditingTool(state.tool)) {
          if (removeSelectedZoneVertex()) {
            e.preventDefault();
            return;
          }
        }
        if ((e.key === "Delete" || e.key === "Backspace") && state.layoutMode === "intarsia" && state.selectedFragmentId != null) {
          const delId = Number(state.selectedFragmentId);
          let deleted = false;
          if (Array.isArray(state.intarsiaSvgFragments)) {
            const before = state.intarsiaSvgFragments.length;
            state.intarsiaSvgFragments = state.intarsiaSvgFragments.filter((f) => Number(f && f.id || 0) !== delId);
            if (state.intarsiaSvgFragments.length < before) deleted = true;
          }
          if (Array.isArray(state.layoutRun && state.layoutRun.fragments)) {
            const before = state.layoutRun.fragments.length;
            state.layoutRun.fragments = state.layoutRun.fragments.filter((f) => Number(f && f.id || 0) !== delId);
            if (state.layoutRun.fragments.length < before) deleted = true;
          }
          if (deleted) {
            state.selectedFragmentId = null;
            e.preventDefault();
            renderScene();
            return;
          }
        }
        if (e.key === "Enter" && String(state.tool || "") === "split-zone" && Array.isArray(state.draftSplitLine) && state.draftSplitLine.length >= 2) {
          e.preventDefault();
          void commitDraftSplitLine();
          return;
        }
        if (e.key === "Enter" && String(state.tool || "") === "draw-zone" && Array.isArray(state.draftZone) && state.draftZone.length >= 3) {
          e.preventDefault();
          const created = createZoneFromPoints(state.draftZone, { parentZoneId: Number(state.selectedZoneId) || null });
          if (created) setWorkspaceTool("select");
          return;
        }
      }

      if (isManualInventoryMode() && !isTyping) {
        if (ctrlOrMeta && String(e.key || "").toLowerCase() === "z" && !e.shiftKey) {
          e.preventDefault();
          void undoInventoryManualPlacement();
          return;
        }
        if (ctrlOrMeta && (String(e.key || "").toLowerCase() === "y" || (String(e.key || "").toLowerCase() === "z" && e.shiftKey))) {
          e.preventDefault();
          redoInventoryManualPlacement();
          return;
        }
        if (ctrlOrMeta && String(e.key || "").toLowerCase() === "e") {
          e.preventDefault();
          void requestManualRecomputeFromUi();
          return;
        }
        if (ctrlOrMeta && e.code === "BracketRight") {
          const manual = state.layoutRun && state.layoutRun.manual ? state.layoutRun.manual : null;
          const selIdx = Number(manual && manual.selectedPlacementIndex);
          if (Number.isFinite(selIdx) && selIdx >= 0) {
            e.preventDefault();
            moveInventoryManualPlacementZ(selIdx, +1);
            return;
          }
        }
        if (ctrlOrMeta && e.code === "BracketLeft") {
          const manual = state.layoutRun && state.layoutRun.manual ? state.layoutRun.manual : null;
          const selIdx = Number(manual && manual.selectedPlacementIndex);
          if (Number.isFinite(selIdx) && selIdx >= 0) {
            e.preventDefault();
            moveInventoryManualPlacementZ(selIdx, -1);
            return;
          }
        }
        if (!ctrlOrMeta && (e.key === "Delete" || e.key === "Backspace")) {
          const manual = state.layoutRun && state.layoutRun.manual ? state.layoutRun.manual : null;
          const selIdx = Number(manual && manual.selectedPlacementIndex);
          if (Number.isFinite(selIdx) && selIdx >= 0) {
            e.preventDefault();
            removeInventoryManualPlacementByIndex(selIdx, "кусок удален");
            return;
          }
        }
        if (!ctrlOrMeta && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy = e.key === "ArrowDown" ? -step : e.key === "ArrowUp" ? step : 0;
          const manual = state.layoutRun && state.layoutRun.manual ? state.layoutRun.manual : null;
          const ap = manual && manual.activePiece ? manual.activePiece : null;
          if (ap && Array.isArray(ap.points) && ap.points.length >= 3) {
            e.preventDefault();
            const moved = translatePoints(ap.points, dx, dy);
            updateManualActivePiecePoints(moved);
            renderScene();
            void evaluateManualActivePieceNow();
            return;
          }
          const selIdx = Number(manual && manual.selectedPlacementIndex);
          const placements = Array.isArray(state.layoutRun && state.layoutRun.placements) ? state.layoutRun.placements : [];
          const pl = Number.isFinite(selIdx) && selIdx >= 0 ? placements[selIdx] : null;
          if (pl && Array.isArray(pl.alignedContour) && pl.alignedContour.length >= 3) {
            e.preventDefault();
            const geomBefore = { alignedContour: pl.alignedContour.map((p) => ({ ...p })), inZoneContour: Array.isArray(pl.inZoneContour) ? pl.inZoneContour.map((p) => ({ ...p })) : null, inZoneCoreContour: Array.isArray(pl.inZoneCoreContour) ? pl.inZoneCoreContour.map((p) => ({ ...p })) : null };
            pl.alignedContour = translatePoints(pl.alignedContour, dx, dy);
            if (Array.isArray(pl.inZoneContour)) pl.inZoneContour = translatePoints(pl.inZoneContour, dx, dy);
            if (Array.isArray(pl.inZoneCoreContour)) pl.inZoneCoreContour = translatePoints(pl.inZoneCoreContour, dx, dy);
            const geomAfter = { alignedContour: pl.alignedContour.map((p) => ({ ...p })), inZoneContour: Array.isArray(pl.inZoneContour) ? pl.inZoneContour.map((p) => ({ ...p })) : null, inZoneCoreContour: Array.isArray(pl.inZoneCoreContour) ? pl.inZoneCoreContour.map((p) => ({ ...p })) : null };
            const undoStack = Array.isArray(state.layoutRun && state.layoutRun.manualUndoStack) ? state.layoutRun.manualUndoStack : [];
            const last = undoStack.length > 0 ? undoStack[undoStack.length - 1] : null;
            const now = Date.now();
            if (last && last.type === "move-placement" && last.idx === selIdx && (now - (last.ts || 0)) < 800) {
              last.after = geomAfter;
              last.ts = now;
            } else {
              pushManualUndoCommand({ type: "move-placement", idx: selIdx, before: geomBefore, after: geomAfter, ts: now });
            }
            markLayoutDirty();
            renderScene();
            return;
          }
        }
      }

      if (!isTyping && e.code === "Space") {
        state.keys.space = true;
        if (!state.drag.isDown || state.drag.mode !== "pan") setWorkspaceCursor("grab");
        e.preventDefault();
      }
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") state.keys.shift = true;
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        state.keys.space = false;
        if (!state.drag.isDown || state.drag.mode !== "pan") setWorkspaceCursor("");
      }
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") state.keys.shift = false;
    });
    window.addEventListener("blur", () => {
      state.keys.space = false;
      state.keys.shift = false;
      setWorkspaceCursor("");
    });

    const stageInteractionsApi = window.FurLabStageInteractions || {};
    const stageInteractions = (typeof stageInteractionsApi.createStageInteractions === "function")
      ? stageInteractionsApi.createStageInteractions({
        stage,
        state,
        screenToWorld: (x, y) => screenToWorld(x, y),
        renderScene: () => renderScene(),
        isManualInventoryMode: () => isManualInventoryMode(),
        centroid: (points) => centroid(points),
        rotatePoints: (points, angleRad, center) => rotatePoints(points, angleRad, center),
        updateManualActivePiecePoints: (nextPoints) => updateManualActivePiecePoints(nextPoints),
        renderInventoryManualPanel: () => renderInventoryManualPanel(),
        setWorkspaceCursor: (mode) => setWorkspaceCursor(mode),
        findManualPlacementAt: (worldPoint) => findManualPlacementAt(worldPoint),
        pointInPolygon: (point, polygon) => pointInPolygon(point, polygon),
        findLayoutFragmentAt: (worldPoint) => findLayoutFragmentAt(worldPoint),
        findZoneAt: (worldPoint) => findZoneAt(worldPoint),
        findDetailAt: (worldPoint, thresholdPx) => findDetailAt(worldPoint, thresholdPx),
        findVertexAt: (worldPoint) => {
          const _s = Math.max(0.5, Math.min(3, Number(state.ui && state.ui.handleScale) || 1));
          return findVertexAt(worldPoint, 14 * _s);
        },
        findNearestVertexInSelectedZone: (worldPoint) => findNearestVertexInSelectedZone(worldPoint),
        isZoneVertexOnSharedBoundary: (zone, vertexIndex, thresholdPx) => isZoneVertexOnSharedBoundary(zone, vertexIndex, thresholdPx),
        isLastZoneInDetail: (zone) => isLastZoneInDetail(zone),
        findSharedBoundaryVertexLinks: (zone, vertexIndex, thresholdPx) => findSharedBoundaryVertexLinks(zone, vertexIndex, thresholdPx),
        findSharedBoundaryEdgeLinks: (zone, insertedPointIndex) => findSharedBoundaryEdgeLinks(zone, insertedPointIndex),
        ensureSharedBoundaryVertex: (zone, vertexIndex) => ensureSharedBoundaryVertex(zone, vertexIndex),
        validatePartZonePartition: (zone) => {
          if (!zone) return [];
          const detailId = Number(zone.detailId || 0);
          const zonesForPart = (Array.isArray(state.zones) ? state.zones : []).filter(
            (z) => Number(z && z.detailId || 0) === detailId && Array.isArray(z.points) && z.points.length >= 3
          );
          // Validate for any number of zones — even a single base zone must match partContour.
          // Do NOT filter by originType (migration may have changed split/manual origins).
          if (zonesForPart.length < 1) return [];
          const lookups = window.FurLabZoneLookups;
          // Use getDetailBoundaryPointsForZone which has DXF + union fallback.
          // This avoids blocking valid edits when DXF is absent but union boundary is computable.
          const detailBoundary = lookups ? lookups.getDetailBoundaryPointsForZone(zone) : [];
          // If boundary is truly unavailable (both DXF and union fail), skip partition validation.
          if (detailBoundary.length < 3) return [];
          const geom = window.FurLabGeom;
          return (geom && typeof geom.validatePartZonePartition === "function")
            ? geom.validatePartZonePartition(detailBoundary, zonesForPart)
            : [];
        },
        buildRectZonePoints: (a, b) => buildRectZonePoints(a, b),
        buildEllipseZonePoints: (a, b, segments) => buildEllipseZonePoints(a, b, segments),
        createZoneFromPoints: (points, options) => createZoneFromPoints(points, options),
        setWorkspaceTool: (tool) => setWorkspaceTool(tool),
        smoothZoneVertexPoints: (points, vertexIndex, strength) => smoothZoneVertexPoints(points, vertexIndex, strength),
        beginCurveEdit: (zone, vertexIndex, strength) => beginCurveEdit(zone, vertexIndex, strength),
        clearCurveEdit: (options) => clearCurveEdit(options),
        applyCurveEditPreview: (strength) => applyCurveEditPreview(strength),
        commitCurveEdit: () => commitCurveEdit(),
        renderCurvePreview: () => {
          const zPrev = state.zones.find((x) => x.id === state.selectedZoneId);
          if (!zPrev || !Array.isArray(zPrev.points) || zPrev.points.length < 3) return;
          layerOverlay.destroyChildren();
          const holes = Array.isArray(zPrev.holes) ? zPrev.holes.map(holeContour).filter((h) => h.length >= 3) : [];
          if (holes.length > 0) {
            layerOverlay.add(new Konva.Shape({
              sceneFunc(ctx2) {
                ctx2.beginPath();
                zPrev.points.forEach((pt, i) => { const s = worldToScreen(pt); if (i === 0) ctx2.moveTo(s.x, s.y); else ctx2.lineTo(s.x, s.y); });
                ctx2.closePath();
                holes.forEach((hole) => { hole.forEach((pt, i) => { const s = worldToScreen(pt); if (i === 0) ctx2.moveTo(s.x, s.y); else ctx2.lineTo(s.x, s.y); }); ctx2.closePath(); });
                ctx2.setAttr('fillStyle', 'rgba(250,235,200,0.82)'); ctx2.fill('evenodd');
                ctx2.setAttr('strokeStyle', '#1565c0'); ctx2.setAttr('lineWidth', 1.8); ctx2.stroke();
              }, listening: false
            }));
          } else {
            layerOverlay.add(new Konva.Line({ points: linePoints(zPrev.points), stroke: '#1565c0', fill: 'rgba(250,235,200,0.82)', strokeWidth: 1.8, closed: true, listening: false }));
          }
          layerOverlay.batchDraw();
        },
        pushCommand: (cmd) => pushCommand(cmd),
        recomputeInventoryManualVisibility: () => requestManualRecomputeFromUi(),
        isRadialManualCenterMode: () => {
          const selectedLayout = getSelectedLayoutEntry();
          return !!(
            selectedLayout
            && String(selectedLayout.mode || "") === "radial"
            && getRadialCenterModeValue() === "manual"
            && isLayoutEditEnabledInScene(selectedLayout)
          );
        },
        setRadialManualCenter: (worldPoint, options) => setRadialManualCenter(worldPoint, options),
        onZoneGeometryChanged: (zone) => {
          if (zone && typeof zone === "object") {
            zone.revision = (Number.isFinite(Number(zone.revision)) && Number(zone.revision) > 0 ? Number(zone.revision) : 1) + 1;
          }
          invalidateZoneDerivedData(zone);
          void persistZonesForCurrentWorkspace();
        },
        validateZoneGeometry: (zone) => validateZoneGeometryClient(zone),
        requestZoneSplit: async (fromPoint, toPoint) => splitSelectedZoneByLine(fromPoint, toPoint),
        openZoneContextMenuAt: (payload) => openZoneContextMenu(payload),
        openIntarsiaFragmentContextMenuAt: (payload) => openIntarsiaFragmentContextMenu(payload),
        setWorkspaceInfo: (text) => {
          const info = byId("workspaceInfo");
          if (info) info.textContent = String(text || "");
        },
        setPrecisionAid: (data) => setPrecisionAid(data),
        onZoneSelected: (zone) => {
          const zoneId = Number(zone && zone.id || 0);
          if (!zoneId) return;
          if (detailZoneTreeView && typeof detailZoneTreeView.scrollSelectedZoneIntoView === "function") {
            detailZoneTreeView.scrollSelectedZoneIntoView();
          }
          // Don't auto-switch layout while in manual mode or active layout editing вЂ"
          // openLayoutEntry reloads snapshot and would discard unsaved placements.
          if (isManualInventoryMode()) return;
          const activeEntry = getSelectedLayoutEntry();
          // Only block auto-switch for manual mode вЂ" fragment-only modes have no unsaved placements
          if (activeEntry && String(activeEntry.mode || "") === "inventory_manual") return;
          const layoutForZone = (Array.isArray(state.layouts) ? state.layouts : [])
            .find((e) => Number(e && e.boundZoneId || 0) === zoneId);
          if (layoutForZone && Number(layoutForZone.id) !== Number(state.selectedLayoutId || 0)) {
            selectLayoutEntry(layoutForZone);
          }
        },
        onManualPlacementMoved: (idx, geomBefore, geomAfter) => {
          pushManualUndoCommand({ type: "move-placement", idx, before: geomBefore, after: geomAfter });
        },
        finishIntarsiaContour: () => finishIntarsiaContour(),
        byId,
        getCanvasHeight: () => H
      })
      : null;

    if (stageInteractions && typeof stageInteractions.attach === "function") {
      stageInteractions.attach();
    }


    const importPreviewControllerApi = window.FurLabImportPreviewController || {};
    const importPreviewController = (typeof importPreviewControllerApi.createImportPreviewController === "function")
      ? importPreviewControllerApi.createImportPreviewController({
        byId,
        api: (...args) => api(...args),
        show: (...args) => show(...args),
        updateModeUi: () => updateModeUi(),
        renderPreviewTable: () => renderPreviewTable(),
        autoLoadFirstGeometry: (candidates) => autoLoadFirstGeometry(candidates),
        refreshSelectionInfo: () => refreshSelectionInfo(),
        renderScene: () => renderScene(),
        runPreviewDxfUpload: (files) => runPreviewDxfUpload(files),
        getPatternState: () => state,
        getDiscoveredFiles: () => discoveredFiles,
        setDiscoveredFiles: (next) => { discoveredFiles = Array.isArray(next) ? next : []; },
        setDiscoveredZprjFile: (next) => { discoveredZprjFile = String(next || ""); },
        setPreviewSourceType: (next) => { previewSourceType = String(next || "dxf"); },
        setPreviewToken: (next) => { previewToken = String(next || ""); },
        setPreviewItems: (next) => { previewItems = Array.isArray(next) ? next : []; },
        setSelectedIndexes: (next) => { selectedIndexes = next instanceof Set ? next : new Set(); },
        setActivePreviewIndex: (next) => { activePreviewIndex = Number.isFinite(Number(next)) ? Number(next) : null; }
      })
      : null;
    const syncImportModeUi = () => {
      if (importPreviewController && typeof importPreviewController.syncImportModeUi === "function") {
        importPreviewController.syncImportModeUi();
      }
    };
    if (importPreviewController && typeof importPreviewController.bind === "function") {
      importPreviewController.bind();
    }

    byId("partsBtn").onclick = async () => {
      const res = await fetch("/api/project/parts");
      const json = await res.json();
      show("partsOut", json);
    };

    setupRightPanelResize();
    setupInventoryStep1Drag();
    prepareInventoryStep2Modal();
    renderLayoutModeSwitch();
    syncFillTypeUi();
    byId("importMode").onchange = syncImportModeUi;
    syncImportModeUi();
    refreshBuildTag();
    renderScene();
    updateModeUi();
    window.FurLabResetCurrentZones = () => resetZonesForCurrentWorkspace();

    // в"Ђв"Ђ Project management в"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђв"Ђ


    async function loadProject(id) {
      const res = await api("/api/projects/load", "POST", { id }, 30000);
      if (!res || !res.ok) throw new Error(res && res.error || "load_failed");
      const project = res.item;

      // Restore detail geometry from saved parts so validation and workspace key work
      // even when the pattern file has not been re-imported in this session
      const savedParts = Array.isArray(project.parts) ? project.parts : [];
      if (savedParts.some((p) => Array.isArray(p.points) && p.points.length >= 3)) {
        state.details = savedParts
          .filter((p) => Number(p.id) > 0 && Array.isArray(p.points) && p.points.length >= 3)
          .map((p) => ({
            id: Number(p.id),
            name: String(p.name || `Р"еталь ${p.id}`),
            entity: { points: p.points, closed: true },
            bbox: (() => {
              const pts = p.points;
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const pt of pts) { minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y); maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y); }
              return Number.isFinite(minX) ? { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY } : null;
            })(),
            area: 0, points: p.points.length
          }));
      }

      // Restore pattern geometry (лекала) if saved with the project
      if (project.patternGeometry && Array.isArray(project.patternGeometry.entities)) {
        state.patternGeometry = project.patternGeometry;
      }

      // Restore project materials
      if (Array.isArray(project.projectMaterials) && project.projectMaterials.length > 0) {
        state.projectMaterials = project.projectMaterials;
      }
      // Pre-load fur catalog if any zones have materials so rendering doesn't lag on first renderScene
      if ((Array.isArray(project.zones) ? project.zones : []).some((z) => z && z.materialId)) {
        void loadFurMaterialsCatalog();
      }
      // Migrate: resolve any materialIds on zones that are missing from projectMaterials
      void (async () => {
        const existing = new Set((Array.isArray(state.projectMaterials) ? state.projectMaterials : []).map(m => String(m.id || "")));
        const missing = [...new Set((Array.isArray(project.zones) ? project.zones : []).map(z => String(z.materialId || "")).filter(id => id && !existing.has(id)))];
        for (const mid of missing) {
          // Try zone's own materialName first (already stored on the zone)
          const zoneWithName = (Array.isArray(project.zones) ? project.zones : []).find(z => String(z.materialId || "") === mid && String(z.materialName || "").trim());
          if (zoneWithName) {
            ensureProjectMaterialEntry({ id: mid, name: String(zoneWithName.materialName) });
            continue;
          }
          // Fall back to loading from server
          const mat = typeof loadFurMaterialDetails === "function" ? await loadFurMaterialDetails(mid) : null;
          ensureProjectMaterialEntry(mat || { id: mid, name: mid });
        }
        renderDetailZoneTree();
      })();

      // Restore zones and lock workspace key so zone operations use the correct store key
      // even when pattern geometry is not loaded in this session
      state.loadedProjectWorkspaceKey = String(project.workspaceKey || "") || null;
      state.zones = Array.isArray(project.zones) ? project.zones.map((z) => ({ ...z })) : [];
      migrateLoadedZonesClient(state.zones);
      state.nextZoneId = state.zones.reduce((max, z) => Math.max(max, Number(z.id || 0)), 0) + 1;
      state.selectedZoneId = null;
      state.selectedFragmentId = null;
      // Sync loaded zones into zone_store so server-side operations (delete, validate) work correctly
      if (state.loadedProjectWorkspaceKey && state.zones.length > 0) {
        void api("/api/zones/save", "POST", { workspaceKey: state.loadedProjectWorkspaceKey, zones: state.zones }, 20000);
      }

      // Restore layouts
      state.layouts = [];
      state.nextLayoutId = 1;
      for (const lay of (Array.isArray(project.layouts) ? project.layouts : [])) {
        const lastRun = Array.isArray(lay.runs) && lay.runs.length ? lay.runs[lay.runs.length - 1] : null;
        const savedParams = (lastRun && lastRun.paramsSnapshot) || {};
        // Support both old format (patternParams nested) and new format (flat)
        const restoredParamsSnapshot = savedParams.patternParams && typeof savedParams.patternParams === "object"
          ? savedParams.patternParams
          : savedParams;
        // Ensure layoutModeVersion is present so isFragmentOnlySnapshotStale doesn't force regen
        if (restoredParamsSnapshot && !restoredParamsSnapshot.layoutModeVersion) {
          restoredParamsSnapshot.layoutModeVersion = getFragmentOnlyModeVersion(lay.mode);
        }
        const snapshot = lastRun ? {
          selectedZoneId: Number(lay.zoneId || 0) || null,
          layoutRun: {
            active: true,
            status: "applied",
            strategy: String(lay.mode || "longitudinal"),
            fillType: "voronoi",
            selectedZoneId: Number(lay.zoneId || 0) || null,
            allowanceMm: Number.isFinite(Number(savedParams.normalizeRules && savedParams.normalizeRules.seamAllowanceReserveMm)) ? Number(savedParams.normalizeRules.seamAllowanceReserveMm) : 12,
            paramsSnapshot: restoredParamsSnapshot,
            fragments: Array.isArray(lastRun.resultSnapshot && lastRun.resultSnapshot.fragments) ? lastRun.resultSnapshot.fragments : [],
            placements: (Array.isArray(lastRun.scrapPlacements) ? lastRun.scrapPlacements : []).map((sp, idx) => {
              const contour = Array.isArray(sp.resultContourSnapshot) ? sp.resultContourSnapshot : [];
              return {
                id: String(sp.scrapPieceId || ""),
                fragmentId: idx + 1,
                scrapPieceId: String(sp.scrapPieceId || ""),
                inventoryTag: String(sp.inventoryTag || ""),
                rotationDeg: Number(sp.rotationDeg || 0),
                status: "matched",
                alignedContour: contour,
                alignedContourPoints: contour,
                inZoneContour: contour,
                inZoneCoreContour: Array.isArray(sp.coreContourSnapshot) && sp.coreContourSnapshot.length >= 3
                  ? sp.coreContourSnapshot
                  : [],
                gainAreaMm2: 0,
                scrapAreaMm2: 0,
                overlapAreaMm2: 0,
                outsideAreaMm2: 0,
                fragmentAreaMm2: 0
              };
            }),
            stats: (lastRun.resultSnapshot && lastRun.resultSnapshot.stats) || {},
            lastConstraints: (lastRun.paramsSnapshot && lastRun.paramsSnapshot.constraints) || {},
            lastFilters: (lastRun.paramsSnapshot && lastRun.paramsSnapshot.filters) || {},
            candidatePool: [],
            previewLayers: { pieceIntersections: [], visibleArea: [], coverageHoles: [], seams: [] },
            manual: {}
          }
        } : null;
        const id = state.nextLayoutId++;
        state.layouts.push({
          id,
          mode: String(lay.mode || "longitudinal"),
          name: String(lay.name || `Выкладка ${id}`),
          persistedRunId: String(lay.persistedRunId || ""),
          boundZoneId: Number(lay.zoneId || 0) || null,
          boundDetailId: null,
          runtimeSnapshot: snapshot,
          isDirty: false
        });
      }
      if (state.layouts.length > 0) {
        const firstLayout = state.layouts[0];
        state.selectedLayoutId = firstLayout.id;
        applyLayoutMode(firstLayout.mode);
        if (firstLayout.runtimeSnapshot) {
          if (String(firstLayout.mode || "") === "inventory_manual") {
            applyManualLayoutSnapshot(firstLayout.runtimeSnapshot);
          } else {
            applyFragmentOnlyLayoutSnapshot(String(firstLayout.mode || ""), firstLayout.runtimeSnapshot, firstLayout);
          }
        }
        // Kick stale-check re-preview so cutPoints are populated on load
        if (isFragmentOnlyLayoutMode(String(firstLayout.mode || ""))) {
          const _mode = String(firstLayout.mode || "");
          if (isFragmentOnlySnapshotStale(_mode, firstLayout.runtimeSnapshot)) {
            void previewFragmentOnlyLayout(_mode).then(() => {
              if (Number(state.selectedLayoutId) === Number(firstLayout.id)) {
                firstLayout.runtimeSnapshot = buildFragmentOnlyLayoutSnapshot(_mode);
                renderScene();
              }
            });
          }
        }
      }

      state.activeProjectId = project.id;
      state.activeProjectName = project.name;
      updateProjectUi();
      renderLayoutModeSwitch();
      renderDetailZoneTree();
      renderPropertyEditor();
      renderScene();
      // Fit all zone/detail geometry into view after loading
      {
        const allPoints = (Array.isArray(state.zones) ? state.zones : [])
          .flatMap((z) => Array.isArray(z && z.points) ? z.points : []);
        const allDetailPoints = (Array.isArray(state.details) ? state.details : [])
          .flatMap((d) => Array.isArray(d && d.entity && d.entity.points) ? d.entity.points : []);
        const pts = allPoints.length >= 3 ? allPoints : allDetailPoints;
        if (pts.length >= 3) { fitPointsToView(pts); renderScene(); }
      }

      // Pre-load snapshots for all layouts so they are all visible on canvas simultaneously
      for (const entry of state.layouts) {
        if (!entry.persistedRunId || entry.runtimeSnapshot) continue;
        const _entry = entry;
        void api("/api/layout/manual/runs/load", "POST", { id: _entry.persistedRunId }).then((res) => {
          if (res && res.ok && res.item && res.item.snapshot && typeof res.item.snapshot === "object") {
            _entry.runtimeSnapshot = JSON.parse(JSON.stringify(res.item.snapshot));
            _entry.persistedAt = Number(res.item.updatedAt || Date.now());
            _entry.isDirty = false;
            renderScene();
          }
        });
      }
    }

    // ---------------------------------------------------------------------------
    // Project save/load/UI — delegated to window.FurLabProject (core/project.js)
    // ---------------------------------------------------------------------------
    if (window.FurLabProject) window.FurLabProject.init({
      state,
      api,
      saveCurrentLayoutRuntimeSnapshot,
      buildZonesWorkspaceKey,
      loadProject,
    });
    const modeToLayoutType = (m) => window.FurLabProject ? window.FurLabProject.modeToLayoutType(m) : "RegularLayout";
    const serializeLayoutForProject = (e) => window.FurLabProject ? window.FurLabProject.serializeLayoutForProject(e) : {};
    const buildProjectPayload = (n, id) => window.FurLabProject ? window.FurLabProject.buildProjectPayload(n, id) : {};
    const saveProject = (n, id) => window.FurLabProject ? window.FurLabProject.saveProject(n, id) : Promise.resolve();
    const openProjectPicker = () => window.FurLabProject && window.FurLabProject.openProjectPicker();

    byId("projectImportFileInput").onchange = async (e) => {
      const files = e.target.files;
      if (!files || !files.length) return;
      try {
        const formData = new FormData();
        for (let i = 0; i < files.length; i++) formData.append("files", files[i]);
        const uploadResp = await fetch("/api/import/upload", { method: "POST", body: formData });
        const pickRes = await uploadResp.json();
        if (!pickRes || !pickRes.ok || !Array.isArray(pickRes.files) || !pickRes.files.length) return;

        // ZPRJ вЂ" один файл, идёт через zprj preview
        const isZprj = pickRes.files.length === 1 && pickRes.files[0].toLowerCase().endsWith(".zprj");
        if (isZprj) {
          const previewRes = await api("/api/import/zprj/preview", "POST", { filePath: pickRes.files[0] });
          if (!previewRes || !previewRes.ok) {
            const wi = byId("workspaceInfo"); if (wi) wi.textContent = `Ошибка preview: ${previewRes && previewRes.error || "unknown"}`;
            return;
          }
          previewSourceType = "zprj";
          previewToken = previewRes.token || "";
          previewItems = Array.isArray(previewRes.items) ? previewRes.items : [];
          selectedIndexes = new Set(); activePreviewIndex = null;
          updateModeUi();
          renderPreviewTable();
          const geometryItems = previewItems.filter((x) => x && x.geometryAvailable === true);
          if (geometryItems.length) await autoLoadFirstGeometry(geometryItems);
          else { state.patternGeometry = null; renderScene(); }
          return;
        }

        // DXF / PAC / POS
        const previewRes = await api("/api/import/dxf/preview", "POST", { files: pickRes.files });
        if (!previewRes || !previewRes.ok) {
          const wi = byId("workspaceInfo"); if (wi) wi.textContent = `Ошибка preview: ${previewRes && previewRes.error || "unknown"}`;
          return;
        }
        previewToken = previewRes.token || "";
        previewItems = Array.isArray(previewRes.items) ? previewRes.items : [];
        discoveredFiles = pickRes.files;
        previewSourceType = "dxf";
        selectedIndexes = new Set(); activePreviewIndex = null;
        updateModeUi();
        renderPreviewTable();
        const firstReady = previewItems.filter((x) => x && x.isReadyForCommit === true);
        if (firstReady.length) await autoLoadFirstGeometry(firstReady);
        else { state.patternGeometry = null; renderScene(); }
      } catch (e) {
        const wi = byId("workspaceInfo"); if (wi) wi.textContent = `Ошибка импорта: ${e && e.message ? e.message : "unknown"}`;
      }
    };


    updateProjectUi();

    // -----------------------------------------------------------------------
    // Export to CLO: "Преобразовать в лекала"
    // -----------------------------------------------------------------------
    // ---------------------------------------------------------------------------
    // Export to CLO — delegated to window.FurLabCloExport (core/clo-export.js)
    // ---------------------------------------------------------------------------
    if (window.FurLabCloExport) window.FurLabCloExport.init({
      state,
      api,
      saveCurrentLayoutRuntimeSnapshot,
      serializeLayoutForProject,
    });
    const buildExportBody = (s, m) => window.FurLabCloExport ? window.FurLabCloExport.buildExportBody(s, m) : {};
    const openExportCloModal = () => window.FurLabCloExport && window.FurLabCloExport.openExportCloModal();
    const exportCloPreview = () => window.FurLabCloExport && window.FurLabCloExport.exportCloPreview();
    const exportCloRun = () => window.FurLabCloExport && window.FurLabCloExport.exportCloRun();

    // On startup: show project picker if projects exist, otherwise just load manual runs
    void (async () => {
      try {
        const res = await api("/api/projects", "GET", null, 10000);
        const items = res && res.ok && Array.isArray(res.items) ? res.items : [];
        if (items.length > 0) {
          openProjectPicker();
        } else {
          // No projects yet вЂ" fall back to loading saved manual runs
          const count = await loadSavedManualRuns();
          if (count > 0) {
            renderLayoutModeSwitch();
            renderDetailZoneTree();
            renderPropertyEditor();
            renderScene();
          }
        }
      } catch (_) {}
    })();

    // DEV overlay toggle
    (function () {
      const btn = typeof document !== "undefined" && document.getElementById("devOverlayToggle");
      if (!btn) return;
      btn.addEventListener("click", () => {
        window.__furlab_dev_overlay = !window.__furlab_dev_overlay;
        btn.style.opacity = window.__furlab_dev_overlay ? "1" : "0.5";
        updateDebugOverlay();
      });
      const lcmBtn = typeof document !== "undefined" && document.getElementById("lcmOverlayToggle");
      if (lcmBtn) {
        lcmBtn.addEventListener("click", () => {
          window.__furlab_lcm_overlay = !window.__furlab_lcm_overlay;
          lcmBtn.style.opacity = window.__furlab_lcm_overlay ? "1" : "0.5";
          updateLayoutContractMonitor(window.__lcm_lastDiag, window.__lcm_lastMeta);
        });
      }
      const vsaBtn = typeof document !== "undefined" && document.getElementById("vsaOverlayToggle");
      if (vsaBtn) {
        vsaBtn.addEventListener("click", () => {
          window.__furlab_vsa_overlay = !window.__furlab_vsa_overlay;
          vsaBtn.style.opacity = window.__furlab_vsa_overlay ? "1" : "0.5";
          updateVoronoiSaMonitor(null);
        });
      }
      // drag for vsaMonitor
      (function() {
        const panel = document.getElementById("vsaMonitor");
        const handle = panel && panel.querySelector(".dev-overlay-title");
        if (!panel || !handle) return;
        handle.style.cursor = "grab";
        let dragging = false, ox = 0, oy = 0;
        handle.addEventListener("mousedown", e => {
          if (e.target.tagName === "BUTTON") return;
          dragging = true;
          const r = panel.getBoundingClientRect();
          ox = e.clientX - r.left;
          oy = e.clientY - r.top;
          handle.style.cursor = "grabbing";
          e.preventDefault();
        });
        document.addEventListener("mousemove", e => {
          if (!dragging) return;
          panel.style.left = (e.clientX - ox) + "px";
          panel.style.top  = (e.clientY - oy) + "px";
        });
        document.addEventListener("mouseup", () => {
          dragging = false;
          handle.style.cursor = "grab";
        });
      })();
      // drag for devOverlay and layoutContractMonitor
      ["devOverlay", "layoutContractMonitor"].forEach(id => {
        const p = document.getElementById(id);
        const h = p && p.querySelector(".dev-overlay-title");
        if (!p || !h) return;
        h.style.cursor = "grab";
        let dr = false, ox = 0, oy = 0;
        h.addEventListener("mousedown", e => {
          if (e.target.tagName === "BUTTON") return;
          dr = true;
          const r = p.getBoundingClientRect();
          ox = e.clientX - r.left; oy = e.clientY - r.top;
          h.style.cursor = "grabbing"; e.preventDefault();
        });
        document.addEventListener("mousemove", e => {
          if (!dr) return;
          p.style.left = (e.clientX - ox) + "px";
          p.style.top  = (e.clientY - oy) + "px";
        });
        document.addEventListener("mouseup", () => { dr = false; h.style.cursor = "grab"; });
      });
    })();
