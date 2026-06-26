// Extracted from app.js: import mode switching and preview run handlers.
(function (global) {
  function createImportPreviewController(options) {
    const opts = options && typeof options === "object" ? options : {};
    const byId = typeof opts.byId === "function" ? opts.byId : () => null;
    const api = typeof opts.api === "function" ? opts.api : async () => ({ ok: false, error: "api_unavailable" });
    const show = typeof opts.show === "function" ? opts.show : () => {};
    const updateModeUi = typeof opts.updateModeUi === "function" ? opts.updateModeUi : () => {};
    const renderPreviewTable = typeof opts.renderPreviewTable === "function" ? opts.renderPreviewTable : () => {};
    const autoLoadFirstGeometry = typeof opts.autoLoadFirstGeometry === "function" ? opts.autoLoadFirstGeometry : async () => false;
    const refreshSelectionInfo = typeof opts.refreshSelectionInfo === "function" ? opts.refreshSelectionInfo : () => {};
    const renderScene = typeof opts.renderScene === "function" ? opts.renderScene : () => {};
    const runPreviewDxfUpload = typeof opts.runPreviewDxfUpload === "function" ? opts.runPreviewDxfUpload : async () => {};
    const getPatternState = typeof opts.getPatternState === "function" ? opts.getPatternState : () => null;

    const getDiscoveredFiles = typeof opts.getDiscoveredFiles === "function" ? opts.getDiscoveredFiles : () => [];
    const setDiscoveredFiles = typeof opts.setDiscoveredFiles === "function" ? opts.setDiscoveredFiles : () => {};
    const setDiscoveredZprjFile = typeof opts.setDiscoveredZprjFile === "function" ? opts.setDiscoveredZprjFile : () => {};
    const setPreviewSourceType = typeof opts.setPreviewSourceType === "function" ? opts.setPreviewSourceType : () => {};
    const setPreviewToken = typeof opts.setPreviewToken === "function" ? opts.setPreviewToken : () => {};
    const setPreviewItems = typeof opts.setPreviewItems === "function" ? opts.setPreviewItems : () => {};
    const setSelectedIndexes = typeof opts.setSelectedIndexes === "function" ? opts.setSelectedIndexes : () => {};
    const setActivePreviewIndex = typeof opts.setActivePreviewIndex === "function" ? opts.setActivePreviewIndex : () => {};

    function getImportMode() {
      return String((byId("importMode") && byId("importMode").value) || "dxf");
    }

    function syncImportModeUi() {
      const mode = getImportMode();
      const isDxf = mode === "dxf";
      const pathEl = byId("importPath");
      const recursiveWrap = byId("recursiveWrap");
      const previewRunBtn = byId("previewRunBtn");
      if (recursiveWrap) recursiveWrap.style.display = isDxf ? "" : "none";
      if (previewRunBtn) previewRunBtn.textContent = isDxf ? "Preview DXF" : "Preview ZPRJ";
      if (pathEl) {
        pathEl.placeholder = isDxf
          ? "F:\\FURLAB\\Examples"
          : "F:\\FURLAB\\Examples\\project.zprj";
        if (!String(pathEl.value || "").trim()) {
          pathEl.value = isDxf ? "F:\\FURLAB\\Examples" : "";
        }
      }
    }

    async function runPreviewDxf() {
      const json = await api("/api/import/dxf/preview", "POST", { files: getDiscoveredFiles() });
      if (json.ok) {
        setPreviewSourceType("dxf");
        updateModeUi();
        setPreviewToken(json.token || "");
        setPreviewItems(Array.isArray(json.items) ? json.items : []);
        setSelectedIndexes(new Set());
        setActivePreviewIndex(null);
        renderPreviewTable();
        const firstReady = (Array.isArray(json.items) ? json.items : []).filter((x) => x && x.isReadyForCommit === true);
        if (firstReady.length) {
          await autoLoadFirstGeometry(firstReady);
        } else {
          const patternState = getPatternState();
          if (patternState) patternState.patternGeometry = null;
          renderScene();
          const workspaceInfo = byId("workspaceInfo");
          if (workspaceInfo) workspaceInfo.textContent = "DXF preview loaded (no ready geometry items)";
        }
      }
      show("previewOut", json);
    }

    async function runPreviewZprj(filePath) {
      const json = await api("/api/import/zprj/preview", "POST", { filePath });
      if (json.ok) {
        setPreviewSourceType("zprj");
        updateModeUi();
        setPreviewToken(json.token || "");
        const items = Array.isArray(json.items) ? json.items : [];
        setPreviewItems(items);
        setSelectedIndexes(new Set());
        setActivePreviewIndex(null);
        renderPreviewTable();
        const geometryItems = items.filter((x) => x && x.geometryAvailable === true);
        if (geometryItems.length) {
          await autoLoadFirstGeometry(geometryItems);
        } else {
          const first = items[0];
          if (first) {
            const idx = Number(first.previewIndex);
            setSelectedIndexes(new Set([idx]));
            setActivePreviewIndex(idx);
            refreshSelectionInfo();
            renderPreviewTable();
          }
          const patternState = getPatternState();
          if (patternState) {
            patternState.patternGeometry = null;
            if (!items.length) {
              patternState.details = [];
              patternState.selectedDetailId = null;
            }
          }
          renderScene();
          const workspaceInfo = byId("workspaceInfo");
          if (workspaceInfo) {
            workspaceInfo.textContent = items.length
              ? "ZPRJ preview loaded (no extracted geometry items)"
              : "ZPRJ preview loaded (empty)";
          }
        }
      }
      show("previewOut", json);
    }

    async function discoverDxfFromInput() {
      const pathEl = byId("importPath");
      const recursiveEl = byId("recursive");
      const folder = pathEl ? String(pathEl.value || "").trim() : "";
      const recursive = !!(recursiveEl && recursiveEl.checked);
      const json = await api("/api/import/dxf/discover", "POST", { folder, recursive });
      if (json.ok) setDiscoveredFiles(json.files || []);
      show("discoverOut", json);
      return !!json.ok;
    }

    function bind() {
      const browseBtn = byId("browseBtn");
      if (browseBtn) {
        browseBtn.onclick = async () => {
          try {
            if (getImportMode() === "dxf") {
              const input = byId("importFileInput");
              if (!input) return;
              input.value = "";
              input.click();
              return;
            }
            const json = await api("/api/import/zprj/pick-file", "POST", {}, 10 * 60 * 1000);
            if (json.ok) {
              const discovered = String(json.file || "");
              setDiscoveredZprjFile(discovered);
              const pathEl = byId("importPath");
              if (pathEl) pathEl.value = discovered;
            }
            show("discoverOut", json);
          } catch (e) {
            show("discoverOut", { ok: false, error: `pick_failed: ${e && e.message ? e.message : "unknown"}` });
          }
        };
      }

      const previewRunBtn = byId("previewRunBtn");
      if (previewRunBtn) {
        previewRunBtn.onclick = async () => {
          if (getImportMode() === "dxf") {
            const ok = await discoverDxfFromInput();
            if (!ok) return;
            await runPreviewDxf();
            return;
          }
          const pathEl = byId("importPath");
          const filePath = String((pathEl && pathEl.value) || "").trim();
          setDiscoveredZprjFile(filePath);
          await runPreviewZprj(filePath);
        };
      }

      const importTopBtn = byId("importTopBtn");
      if (importTopBtn) {
        importTopBtn.onclick = async () => {
          try {
            const modeEl = byId("importMode");
            if (modeEl) modeEl.value = "dxf";
            syncImportModeUi();
            const input = byId("importFileInput");
            if (!input) return;
            input.value = "";
            input.click();
          } catch (e) {
            show("discoverOut", { ok: false, error: `import_pick_failed: ${e && e.message ? e.message : "unknown"}` });
          }
        };
      }

      const fileInput = byId("importFileInput");
      if (fileInput) {
        fileInput.onchange = async (ev) => {
          try {
            const files = ev && ev.target && ev.target.files ? ev.target.files : null;
            if (!files || !files.length) return;
            await runPreviewDxfUpload(files);
          } catch (e) {
            show("discoverOut", { ok: false, error: `import_upload_failed: ${e && e.message ? e.message : "unknown"}` });
          }
        };
      }
    }

    return {
      bind,
      getImportMode,
      syncImportModeUi
    };
  }

  global.FurLabImportPreviewController = Object.assign({}, global.FurLabImportPreviewController || {}, {
    createImportPreviewController
  });
})(window);

