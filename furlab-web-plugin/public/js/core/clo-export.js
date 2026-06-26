// FurLab CLO Export module
// Exposes window.FurLabCloExport
(function (global) {

  let _state = null;
  let _api = null;
  let _saveSnapshot = null;
  let _serializeLayout = null;

  let _step = 1;

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  function init(ctx) {
    _state = ctx.state;
    _api = ctx.api;
    _saveSnapshot = ctx.saveCurrentLayoutRuntimeSnapshot;
    _serializeLayout = ctx.serializeLayoutForProject;
    _bindEvents();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function byId(id) { return document.getElementById(id); }

  // ---------------------------------------------------------------------------
  // Core
  // ---------------------------------------------------------------------------

  function buildExportBody(scopeOverride, seamModeOverride) {
    const scopeSel = byId("exportCloScope");
    const seamSel = byId("exportCloSeamMode");
    const scope = scopeOverride || (scopeSel && scopeSel.value) || "all";
    const seamMode = seamModeOverride || (seamSel && seamSel.value) || "auto";

    _saveSnapshot();

    const layouts = (Array.isArray(_state.layouts) ? _state.layouts : []).map(_serializeLayout);

    const materialsIndex = {};
    const _matSrc = Array.isArray(_state.furMaterialsCatalog) ? _state.furMaterialsCatalog : [];
    for (const m of _matSrc) {
      if (m && m.id) materialsIndex[String(m.id)] = m;
    }

    return {
      zones: Array.isArray(_state.zones) ? _state.zones.map((z) => ({ ...z })) : [],
      details: Array.isArray(_state.details) ? _state.details.map((d) => ({ id: d.id, name: d.name })) : [],
      layouts,
      materials: materialsIndex,
      zoneScope: scope,
      seamMode,
      currentZoneId: Number(_state.selectedZoneId || 0) || null
    };
  }

  function openExportCloModal() {
    _step = 1;
    const backdrop = byId("exportCloBackdrop");
    if (!backdrop) return;
    byId("exportCloStep1").style.display = "";
    byId("exportCloStep2").style.display = "none";
    byId("exportCloProgress").style.display = "none";
    byId("exportCloNextBtn").style.display = "";
    byId("exportCloRunBtn").style.display = "none";
    byId("exportCloBackBtn").style.display = "none";
    byId("exportCloModalTitle").textContent = "Преобразовать в лекала — Шаг 1";
    backdrop.style.display = "flex";
  }

  async function exportCloPreview() {
    byId("exportCloNextBtn").disabled = true;
    byId("exportCloProgress").style.display = "";
    byId("exportCloProgressBar").style.width = "30%";
    byId("exportCloProgressLabel").textContent = "Анализ зон...";
    try {
      const body = buildExportBody();
      const res = await _api("/api/export/patterns/preview", "POST", body, 30000);
      if (!res || !res.ok) {
        alert("Ошибка предпросмотра: " + String(res && res.error || "unknown"));
        return;
      }
      byId("exportCloProgressBar").style.width = "100%";
      byId("exportCloProgress").style.display = "none";

      _step = 2;
      byId("exportCloStep1").style.display = "none";
      byId("exportCloStep2").style.display = "";
      byId("exportCloFragCount").textContent = String(res.fragmentsCount || 0);
      byId("exportCloSeamCount").textContent = String(res.seamsCount || 0);
      byId("exportCloMaterialCount").textContent = String(res.materialsCount || 0);
      byId("exportCloModalTitle").textContent = "Преобразовать в лекала — Шаг 2";
      byId("exportCloNextBtn").style.display = "none";
      byId("exportCloRunBtn").style.display = "";
      byId("exportCloBackBtn").style.display = "";

      const statusEl = byId("exportCloZoneStatuses");
      if (statusEl && Array.isArray(res.zoneStatuses)) {
        statusEl.innerHTML = res.zoneStatuses.map((z) => {
          const icon = z.status === "exported" ? "[✓]" : "[–]";
          const color = z.status === "exported" ? "#333" : "#999";
          return `<span style="color:${color}; margin-right:10px;">${icon} ${String(z.name || z.id).replace(/</g, "&lt;")}</span>`;
        }).join("");
      }

      const warnEl = byId("exportCloWarning");
      if (warnEl) {
        if (res.fragmentsCount === 0) {
          warnEl.textContent = "Нет фрагментов для экспорта. Выполните выкладку хотя бы одной зоны.";
          warnEl.style.display = "";
        } else {
          warnEl.style.display = "none";
        }
      }
    } catch (err) {
      alert("Ошибка: " + String(err && err.message || err));
    } finally {
      const btn = byId("exportCloNextBtn");
      if (btn) btn.disabled = false;
    }
  }

  async function exportCloRun() {
    const runBtn = byId("exportCloRunBtn");
    if (runBtn) runBtn.disabled = true;
    byId("exportCloProgress").style.display = "";
    byId("exportCloProgressBar").style.width = "20%";
    byId("exportCloProgressLabel").textContent = "Создание лекал...";
    try {
      const body = buildExportBody();
      body._saveDialog = true;
      byId("exportCloProgressBar").style.width = "60%";
      byId("exportCloProgressLabel").textContent = "Формирование ZIP...";
      const res = await fetch("/api/export/patterns/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        if (json.cancelled) return;
        alert("Ошибка экспорта: " + String(json && json.error || res.status));
        return;
      }
      byId("exportCloProgressBar").style.width = "100%";
      byId("exportCloProgressLabel").textContent = `Сохранено: ${json.savedTo}`;
      setTimeout(() => { byId("exportCloBackdrop").style.display = "none"; }, 1500);
    } catch (err) {
      alert("Ошибка: " + String(err && err.message || err));
    } finally {
      if (runBtn) runBtn.disabled = false;
    }
  }

  function _goBack() {
    _step = 1;
    byId("exportCloStep1").style.display = "";
    byId("exportCloStep2").style.display = "none";
    byId("exportCloProgress").style.display = "none";
    byId("exportCloNextBtn").style.display = "";
    byId("exportCloRunBtn").style.display = "none";
    byId("exportCloBackBtn").style.display = "none";
    byId("exportCloModalTitle").textContent = "Преобразовать в лекала — Шаг 1";
  }

  // ---------------------------------------------------------------------------
  // Event binding (called once from init)
  // ---------------------------------------------------------------------------

  function _bindEvents() {
    const exportCloBtn = byId("exportCloBtn");
    if (exportCloBtn) exportCloBtn.onclick = () => openExportCloModal();

    const exportCloCloseBtn = byId("exportCloCloseBtn");
    if (exportCloCloseBtn) exportCloCloseBtn.onclick = () => { byId("exportCloBackdrop").style.display = "none"; };

    const exportCloCancelBtn = byId("exportCloCancelBtn");
    if (exportCloCancelBtn) exportCloCancelBtn.onclick = () => { byId("exportCloBackdrop").style.display = "none"; };

    const exportCloNextBtn = byId("exportCloNextBtn");
    if (exportCloNextBtn) exportCloNextBtn.onclick = () => exportCloPreview();

    const exportCloRunBtn = byId("exportCloRunBtn");
    if (exportCloRunBtn) exportCloRunBtn.onclick = () => exportCloRun();

    const exportCloBackBtn = byId("exportCloBackBtn");
    if (exportCloBackBtn) exportCloBackBtn.onclick = () => _goBack();

    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "L" || e.key === "л" || e.key === "Л")) {
        e.preventDefault();
        openExportCloModal();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  global.FurLabCloExport = {
    init,
    buildExportBody,
    openExportCloModal,
    exportCloPreview,
    exportCloRun,
  };

})(window);
