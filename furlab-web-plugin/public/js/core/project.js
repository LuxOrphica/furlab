// FurLab Project save/load/UI module
// Exposes window.FurLabProject
(function (global) {

  let _state = null;
  let _api = null;
  let _saveSnapshot = null;
  let _buildWorkspaceKey = null;
  let _loadProject = null; // stays in app.js — injected so renderProjectList can call it

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  function init(ctx) {
    _state = ctx.state;
    _api = ctx.api;
    _saveSnapshot = ctx.saveCurrentLayoutRuntimeSnapshot;
    _buildWorkspaceKey = ctx.buildZonesWorkspaceKey;
    _loadProject = ctx.loadProject;
    _bindEvents();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function byId(id) { return document.getElementById(id); }

  // ---------------------------------------------------------------------------
  // Layout type helpers
  // ---------------------------------------------------------------------------

  function modeToLayoutType(mode) {
    const m = String(mode || "");
    if (m === "inventory" || m === "inventory_manual" || m === "inventory_split_return" || m === "inventory_nfp_sa") return "InventoryLayout";
    if (m === "intarsia") return "IrregularLayout";
    return "RegularLayout";
  }

  function serializeLayoutForProject(entry) {
    const snap = entry.runtimeSnapshot && typeof entry.runtimeSnapshot === "object" ? entry.runtimeSnapshot : null;
    const lr = snap && snap.layoutRun && typeof snap.layoutRun === "object" ? snap.layoutRun : null;
    const placements = Array.isArray(lr && lr.placements) ? lr.placements : [];
    const fragments = Array.isArray(lr && lr.fragments) ? lr.fragments : [];
    const scrapPlacements = placements
      .filter((p) => {
        if (!p) return false;
        const status = String(p.status || "");
        if (status === "matched") return true;
        const hasGeom = Array.isArray(p.alignedContour) && p.alignedContour.length >= 3;
        return hasGeom && status !== "removed";
      })
      .map((p) => ({
        fragmentId: String(p.fragmentId || p.id || ""),
        scrapPieceId: String(p.scrapPieceId || p.id || ""),
        inventoryTag: String(p.inventoryTag || ""),
        rotationDeg: Number(p.rotationDeg || 0),
        offsetXmm: Number(p.offsetXmm || p.x || 0),
        offsetYmm: Number(p.offsetYmm || p.y || 0),
        resultContourSnapshot: Array.isArray(p.alignedContour) && p.alignedContour.length >= 3
          ? p.alignedContour
          : (Array.isArray(p.alignedContourPoints) ? p.alignedContourPoints : []),
        coreContourSnapshot: Array.isArray(p.inZoneCoreContour) && p.inZoneCoreContour.length >= 3
          ? p.inZoneCoreContour
          : []
      }));
    const normalizeRules = {
      seamAllowanceReserveMm: Number(lr && lr.allowanceMm || 12)
    };
    const params = String(entry.mode || "").startsWith("inventory") ? {
      normalizeRules,
      placementStrategy: String(entry.mode || "") === "inventory_nfp_sa" ? "nfp_sa" : "manualAssist",
      maxCandidates: Number(lr && lr.lastConstraints && lr.lastConstraints.maxCandidates || 300),
      filters: (lr && lr.lastFilters) || {},
      constraints: (lr && lr.lastConstraints) || {}
    } : {
      normalizeRules,
      ...(lr && lr.paramsSnapshot && typeof lr.paramsSnapshot === "object" ? lr.paramsSnapshot : {})
    };
    const runs = (snap || lr) ? [{
      id: String(entry.persistedRunId || `run_${entry.id}`),
      startedAt: Number(entry.persistedAt || Date.now()),
      paramsSnapshot: params,
      resultSnapshot: {
        fragments: fragments.map((f) => ({
          id: String(f && (f.id || f.fragmentId) || ""),
          points: Array.isArray(f && f.points) ? f.points : [],
          cutPoints: Array.isArray(f && f.cutPoints) ? f.cutPoints : [],
          areaMm2: Number(f && f.areaMm2 || 0)
        })),
        stats: (lr && lr.stats) || {}
      },
      scrapPlacements
    }] : [];
    return {
      id: `layout_${entry.id}`,
      name: String(entry.name || ""),
      zoneId: Number(entry.boundZoneId || 0) || null,
      layoutType: modeToLayoutType(entry.mode),
      mode: String(entry.mode || ""),
      persistedRunId: String(entry.persistedRunId || ""),
      params,
      runs
    };
  }

  // ---------------------------------------------------------------------------
  // Build / save / UI
  // ---------------------------------------------------------------------------

  function buildProjectPayload(name, existingId) {
    _saveSnapshot();
    const workspaceKey = _buildWorkspaceKey();
    const parts = (Array.isArray(_state.details) ? _state.details : []).map((d) => ({
      id: Number(d && d.id || 0),
      name: String(d && d.name || `Деталь ${d && d.id}`),
      points: Array.isArray(d && d.entity && d.entity.points) ? d.entity.points.map((p) => ({ x: Number(p.x), y: Number(p.y) })) : []
    }));
    const zones = (Array.isArray(_state.zones) ? _state.zones : []).map((z) => ({ ...z }));
    const layouts = (Array.isArray(_state.layouts) ? _state.layouts : []).map(serializeLayoutForProject);
    const patternGeometry = _state.patternGeometry && Array.isArray(_state.patternGeometry.entities)
      ? _state.patternGeometry
      : null;
    const projectMaterials = Array.isArray(_state.projectMaterials) ? _state.projectMaterials : [];
    return {
      id: existingId || undefined,
      name,
      workspaceKey,
      parts,
      zones,
      layouts,
      patternGeometry,
      projectMaterials
    };
  }

  let _toastTimer = null;
  function _showToast(msg) {
    let el = document.getElementById("projectSaveToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "projectSaveToast";
      el.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);" +
        "background:#323232;color:#fff;padding:10px 20px;border-radius:6px;" +
        "font-size:14px;z-index:99999;opacity:0;transition:opacity 0.2s;pointer-events:none;";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = "1";
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.style.opacity = "0"; }, 2500);
  }

  async function saveProject(name, existingId) {
    const payload = buildProjectPayload(name, existingId);
    const res = await _api("/api/projects/save", "POST", payload, 30000);
    if (!res || !res.ok) throw new Error(res && res.error || "save_failed");
    _state.activeProjectId = res.id;
    _state.activeProjectName = name;
    updateProjectUi();
    return res.id;
  }

  function updateProjectUi() {
    if (!_state) return;
    const nameEl = byId("activeProjectName");
    const saveBtn = byId("saveProjectBtn");
    const exportBtn = byId("exportCloBtn");
    if (nameEl) nameEl.textContent = _state.activeProjectName ? `— ${_state.activeProjectName}` : "";
    const hasData = (_state.zones && _state.zones.length > 0) || (_state.details && _state.details.length > 0);
    const hasZones = _state.zones && _state.zones.length > 0;
    if (saveBtn) saveBtn.style.display = hasData ? "inline-block" : "none";
    if (exportBtn) exportBtn.style.display = hasZones ? "inline-block" : "none";
  }

  function renderProjectList(items) {
    const listEl = byId("projectPickerList");
    const emptyEl = byId("projectPickerEmpty");
    if (!listEl) return;
    if (!items.length) {
      listEl.innerHTML = "";
      if (emptyEl) emptyEl.style.display = "block";
      return;
    }
    if (emptyEl) emptyEl.style.display = "none";
    listEl.innerHTML = items.map((p) => {
      const date = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString("ru-RU") : "";
      const meta = [
        p.zonesCount ? `${p.zonesCount} зон` : "",
        p.layoutsCount ? `${p.layoutsCount} выкладок` : "",
        date
      ].filter(Boolean).join(" · ");
      return `<div class="project-list-item" data-id="${p.id}">
        <div class="project-list-item-name">${String(p.name || "Без названия").replace(/</g, "&lt;")}</div>
        <div class="project-list-item-meta">${meta}</div>
        <div class="project-list-item-actions">
          <button class="project-list-item-open" data-id="${p.id}">Открыть</button>
          <button class="project-list-item-delete" data-id="${p.id}">✕</button>
        </div>
      </div>`;
    }).join("");
    listEl.querySelectorAll(".project-list-item-open").forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        byId("projectPickerBackdrop").style.display = "none";
        try {
          await _loadProject(id);
        } catch (err) {
          alert("Ошибка загрузки проекта: " + String(err && err.message || err));
        }
      };
    });
    listEl.querySelectorAll(".project-list-item-delete").forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm("Удалить проект?")) return;
        const id = btn.dataset.id;
        await _api("/api/projects/delete", "POST", { id }, 10000);
        const res = await _api("/api/projects", "GET", null, 10000);
        renderProjectList(res && res.ok && Array.isArray(res.items) ? res.items : []);
      };
    });
  }

  async function openProjectPicker() {
    byId("projectPickerBackdrop").style.display = "flex";
    byId("projectPickerList").innerHTML = "<div style='padding:16px;color:#888;'>Загрузка...</div>";
    if (byId("projectPickerEmpty")) byId("projectPickerEmpty").style.display = "none";
    try {
      const res = await _api("/api/projects", "GET", null, 10000);
      renderProjectList(res && res.ok && Array.isArray(res.items) ? res.items : []);
    } catch (_) {
      renderProjectList([]);
    }
  }

  // ---------------------------------------------------------------------------
  // Event binding
  // ---------------------------------------------------------------------------

  function _bindEvents() {
    byId("openProjectBtn").onclick = () => openProjectPicker();
    byId("projectPickerCloseBtn").onclick = () => { byId("projectPickerBackdrop").style.display = "none"; };
    byId("projectPickerCancelBtn").onclick = () => { byId("projectPickerBackdrop").style.display = "none"; };
    byId("projectPickerNewBtn").onclick = () => {
      byId("projectPickerBackdrop").style.display = "none";
      const fileInput = byId("projectImportFileInput");
      if (fileInput) { fileInput.value = ""; fileInput.click(); }
    };

    byId("saveProjectBtn").onclick = () => {
      const nameInput = byId("saveProjectNameInput");
      if (nameInput) nameInput.value = _state.activeProjectName || "";
      const _backdrop = byId("saveProjectBackdrop");
      const _modal = _backdrop && _backdrop.querySelector(".modal");
      if (_modal) { _modal.style.left = ""; _modal.style.top = ""; _modal.style.transform = ""; _modal.style.position = ""; }
      _backdrop.style.display = "flex";
      if (nameInput) setTimeout(() => nameInput.focus(), 50);
    };
    byId("saveProjectCloseBtn").onclick = () => { byId("saveProjectBackdrop").style.display = "none"; };
    byId("saveProjectCancelBtn").onclick = () => { byId("saveProjectBackdrop").style.display = "none"; };
    byId("saveProjectConfirmBtn").onclick = async () => {
      const nameInput = byId("saveProjectNameInput");
      const name = String(nameInput && nameInput.value || "").trim() || "Без названия";
      const confirmBtn = byId("saveProjectConfirmBtn");
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Сохранение…";
      try {
        const isSameName = name === (_state.activeProjectName || "").trim();
        await saveProject(name, isSameName ? _state.activeProjectId : null);
        byId("saveProjectBackdrop").style.display = "none";
        _showToast("Проект сохранён");
      } catch (err) {
        alert("Ошибка сохранения: " + String(err && err.message || err));
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Сохранить";
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  global.FurLabProject = {
    init,
    modeToLayoutType,
    serializeLayoutForProject,
    buildProjectPayload,
    saveProject,
    updateProjectUi,
    renderProjectList,
    openProjectPicker,
  };

})(window);
