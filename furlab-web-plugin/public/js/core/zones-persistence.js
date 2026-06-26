// FurLab Zones persistence layer
// Exposes window.FurLabZonesPersistence
(function (global) {

  let _state = null;
  let _api = null;
  let _normalizeZone = null;
  let _reconcileZones = null;
  let _migrateOriginTypes = null;
  let _ensureProjectMaterial = null;
  let _loadFurMaterialDetails = null;
  let _initZonesFromDetails = null;
  let _clearActiveLayoutRuntime = null;
  let _render = {};

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  function init(ctx) {
    _state = ctx.state;
    _api = ctx.api;
    _normalizeZone = ctx.normalizeZoneForPersistence;
    _reconcileZones = ctx.reconcileZonesWithDetails;
    _migrateOriginTypes = ctx.migrateLoadedZoneOriginTypes;
    _ensureProjectMaterial = ctx.ensureProjectMaterialEntry;
    _loadFurMaterialDetails = ctx.loadFurMaterialDetails;
    _initZonesFromDetails = ctx.initZonesFromDetails;
    _clearActiveLayoutRuntime = ctx.clearActiveLayoutRuntime;
    _render = ctx.render || {};
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function byId(id) { return document.getElementById(id); }

  // ---------------------------------------------------------------------------
  // Core
  // ---------------------------------------------------------------------------

  function buildZonesWorkspaceKey() {
    if (_state.loadedProjectWorkspaceKey) return _state.loadedProjectWorkspaceKey;
    const details = Array.isArray(_state.details) ? _state.details : [];
    if (!details.length) return "";
    let hash = 2166136261;
    const feed = (text) => {
      const s = String(text || "");
      for (let i = 0; i < s.length; i++) {
        hash ^= s.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
    };
    const sorted = details.slice().sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
    for (const detail of sorted) {
      const pts = Array.isArray(detail && detail.entity && detail.entity.points) ? detail.entity.points : [];
      feed(detail && detail.id);
      feed(pts.length);
      for (const p of pts) {
        feed(Number(p && p.x || 0).toFixed(3));
        feed(Number(p && p.y || 0).toFixed(3));
      }
    }
    return `details:${sorted.length}:${(hash >>> 0).toString(16)}`;
  }

  function buildZoneValidationPayload() {
    const details = (Array.isArray(_state.details) ? _state.details : [])
      .map((detail) => {
        const points = Array.isArray(detail && detail.entity && detail.entity.points) ? detail.entity.points : [];
        return {
          id: Number(detail && detail.id || 0) || null,
          name: String(detail && detail.name || ""),
          points: points.map((p) => ({ x: Number(p && p.x), y: Number(p && p.y) }))
        };
      })
      .filter((detail) => Number(detail.id) > 0 && detail.points.length >= 3);
    const zones = (Array.isArray(_state.zones) ? _state.zones : [])
      .map(_normalizeZone)
      .filter(Boolean);
    return { details, zones };
  }

  async function validateZonesForCurrentWorkspace() {
    const payload = buildZoneValidationPayload();
    const json = await _api("/api/zones/validate", "POST", payload, 20000);
    if (json && json.ok) {
      _state.zoneValidation = json;
    } else {
      _state.zoneValidation = null;
    }
    return json;
  }

  async function persistZonesForCurrentWorkspace() {
    const workspaceKey = buildZonesWorkspaceKey();
    if (!workspaceKey) return { ok: false, error: "zones_workspace_missing" };
    const zones = (Array.isArray(_state.zones) ? _state.zones : []).map(_normalizeZone).filter(Boolean);
    const json = await _api("/api/zones/save", "POST", {
      workspaceKey,
      selectedZoneId: Number(_state.selectedZoneId || 0) || null,
      zones
    }, 20000);
    if (json && json.ok) {
      const savedZones = Array.isArray(json.zones) ? json.zones : [];
      _state.zones = savedZones;
      _state.nextZoneId = savedZones.reduce((maxId, zone) => Math.max(maxId, Number(zone && zone.id || 0)), 0) + 1;
      await validateZonesForCurrentWorkspace();
    }
    return json;
  }

  async function loadZonesForCurrentWorkspace(options) {
    const cfg = options && typeof options === "object" ? options : {};
    const workspaceKey = buildZonesWorkspaceKey();
    if (!workspaceKey) return { ok: false, error: "zones_workspace_missing" };
    const json = await _api(`/api/zones?workspaceKey=${encodeURIComponent(workspaceKey)}`, "GET", null, 20000);
    const savedZones = json && json.ok && Array.isArray(json.zones) ? json.zones : [];
    if (savedZones.length) {
      const migrated = _migrateOriginTypes(savedZones);
      const reconciledZones = _reconcileZones(savedZones);
      const needsReconcilePersist = reconciledZones.length !== savedZones.length;
      _state.zones = reconciledZones;
      _state.history.undo = [];
      _state.history.redo = [];
      for (const zone of reconciledZones) {
        const mid = String(zone && zone.materialId || "").trim();
        if (!mid) continue;
        const already = (Array.isArray(_state.projectMaterials) ? _state.projectMaterials : []).find((m) => String(m && m.id || "") === mid);
        if (!already) {
          const name = String(zone.materialName || "").trim();
          _ensureProjectMaterial({ id: mid, name: name || mid });
          if (!name) {
            void _loadFurMaterialDetails(mid).then((mat) => { if (mat && mat.name) _ensureProjectMaterial(mat); });
          }
        }
      }
      _state.nextZoneId = reconciledZones.reduce((maxId, zone) => Math.max(maxId, Number(zone && zone.id || 0)), 0) + 1;
      if (!reconciledZones.some((zone) => Number(zone && zone.id || 0) === Number(_state.selectedZoneId || 0))) {
        _state.selectedZoneId = Number(reconciledZones[0] && reconciledZones[0].id || 0) || null;
      }
      _state.selectedFragmentId = null;
      if (!_state.details.some((detail) => Number(detail && detail.id || 0) === Number(_state.selectedDetailId || 0))) {
        _state.selectedDetailId = Number(reconciledZones[0] && reconciledZones[0].detailId || 0) || null;
      }
      if (migrated || needsReconcilePersist) {
        await persistZonesForCurrentWorkspace();
      }
      await validateZonesForCurrentWorkspace();
      return json;
    }
    if (cfg.bootstrapIfEmpty !== false) {
      _initZonesFromDetails();
      if (Array.isArray(_state.zones) && _state.zones.length) {
        await persistZonesForCurrentWorkspace();
        await validateZonesForCurrentWorkspace();
      }
    }
    return json;
  }

  async function resetZonesForCurrentWorkspace() {
    const workspaceKey = buildZonesWorkspaceKey();
    if (!workspaceKey) return { ok: false, error: "zones_workspace_missing" };
    const json = await _api("/api/zones/reset", "POST", { workspaceKey }, 20000);
    if (!json || !json.ok) return json || { ok: false, error: "zone_reset_failed" };
    _state.zoneValidation = null;
    _state.selectedFragmentId = null;
    _state.selectedZoneId = null;
    _state.zones = [];
    _clearActiveLayoutRuntime();
    await loadZonesForCurrentWorkspace({ bootstrapIfEmpty: true });
    if (_render.renderLayoutModeSwitch) _render.renderLayoutModeSwitch();
    if (_render.renderDetailZoneTree) _render.renderDetailZoneTree();
    if (_render.renderPropertyEditor) _render.renderPropertyEditor();
    if (_render.renderScene) _render.renderScene();
    byId("workspaceInfo").textContent = "Зоны сброшены к исходному состоянию: 1 деталь = 1 зона.";
    return { ok: true, workspaceKey };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  global.FurLabZonesPersistence = {
    init,
    buildZonesWorkspaceKey,
    buildZoneValidationPayload,
    validateZonesForCurrentWorkspace,
    persistZonesForCurrentWorkspace,
    loadZonesForCurrentWorkspace,
    resetZonesForCurrentWorkspace,
  };

})(window);
