// FurLab Materials catalog / cache layer
// Exposes window.FurLabMaterials
(function (global) {

  let _state = null;
  let _api = null;
  let _renderPropertyEditor = null;

  let _materialsDictCache = null;
  let _furMaterialsCatalogCache = null;
  let _furMaterialsCatalogLoadingPromise = null;

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  function init(ctx) {
    _state = ctx.state;
    _api = ctx.api;
    _renderPropertyEditor = ctx.renderPropertyEditor || (() => {});
  }

  // ---------------------------------------------------------------------------
  // Materials dict (for dropdowns)
  // ---------------------------------------------------------------------------

  async function loadMaterialsDict(force) {
    if (!force && Array.isArray(_materialsDictCache)) return _materialsDictCache;
    const json = await _api("/api/dicts/materials", "GET", null, 20000);
    const items = json && json.ok && Array.isArray(json.items) ? json.items : [];
    _materialsDictCache = items
      .map((item) => ({
        id: item && item.id !== undefined && item.id !== null ? String(item.id).trim() : "",
        name: item && item.name !== undefined && item.name !== null ? String(item.name).trim() : "",
        piecesCount: Number(item && item.piecesCount || 0) || 0
      }))
      .filter((item) => item.id);
    return _materialsDictCache;
  }

  // ---------------------------------------------------------------------------
  // Fur materials catalog
  // ---------------------------------------------------------------------------

  async function loadFurMaterialsCatalog(force) {
    if (!force && _furMaterialsCatalogLoadingPromise) return _furMaterialsCatalogLoadingPromise;
    if (!force && Array.isArray(_furMaterialsCatalogCache)) {
      _state.furMaterialsCatalog = _furMaterialsCatalogCache.slice();
      return _furMaterialsCatalogCache;
    }
    _furMaterialsCatalogLoadingPromise = (async () => {
      const json = await _api("/api/fur-materials", "GET", null, 20000);
      const items = json && json.ok && Array.isArray(json.items) ? json.items : [];
      _furMaterialsCatalogCache = items
        .map((item) => ({
          id: item && item.id !== undefined && item.id !== null ? String(item.id).trim() : "",
          name: item && item.name !== undefined && item.name !== null ? String(item.name).trim() : "",
          category: item && item.category !== undefined ? String(item.category).trim() : "",
          species: item && item.species !== undefined ? String(item.species).trim() : "",
          colorHex: item && item.colorHex !== undefined ? String(item.colorHex).trim() : "",
          thumbnail: item && item.thumbnail !== undefined ? String(item.thumbnail).trim() : "",
          melanin: Number(item && item.melanin || 0) || 0,
          pheomelanin: Number(item && item.pheomelanin || 0) || 0,
          maxLengthMm: Number(item && item.maxLengthMm || 0) || 0,
          maxWidthMm: Number(item && item.maxWidthMm || 0) || 0,
          thicknessMm: Number(item && item.thicknessMm || 0) || 0,
          gloss: Number(item && item.gloss || 0) || 0,
          softness: Number(item && item.softness || 0) || 0,
          fluffiness: Number(item && item.fluffiness || 0) || 0,
          pileLengthMm: Number(item && item.pileLengthMm || 0) || 0,
          hairThicknessMm: Number(item && item.hairThicknessMm || 0) || 0,
          pileDensityPerIn2: Number(item && item.pileDensityPerIn2 || 0) || 0,
          taper: Number(item && item.taper || 0) || 0,
          segmentationCount: Number(item && item.segmentationCount || 0) || 0,
          hairBend: Number(item && item.hairBend || 0) || 0,
          bendSpread: Number(item && item.bendSpread || 0) || 0,
          curlRadiusMm: Number(item && item.curlRadiusMm || 0) || 0,
          curlEffect: Number(item && item.curlEffect || 0) || 0,
          elasticity: Number(item && item.elasticity || 0) || 0,
          stretch: Number(item && item.stretch || 0) || 0,
          weightGm2: Number(item && item.weightGm2 || 0) || 0
        }))
        .filter((item) => item.id);
      _state.furMaterialsCatalog = _furMaterialsCatalogCache.slice();
      _renderPropertyEditor();
      return _furMaterialsCatalogCache;
    })();
    try {
      return await _furMaterialsCatalogLoadingPromise;
    } finally {
      _furMaterialsCatalogLoadingPromise = null;
    }
  }

  async function loadFurMaterialDetails(materialId, force) {
    const id = String(materialId || "").trim();
    if (!id) return null;
    if (!_state.furMaterialDetailsById || typeof _state.furMaterialDetailsById !== "object") {
      _state.furMaterialDetailsById = {};
    }
    if (!force && _state.furMaterialDetailsById[id]) return _state.furMaterialDetailsById[id];
    const json = await _api(`/api/fur-materials/${encodeURIComponent(id)}`, "GET", null, 20000);
    const item = json && json.ok && json.item && typeof json.item === "object" ? json.item : null;
    if (item) _state.furMaterialDetailsById[id] = item;
    return item;
  }

  function getFurMaterialById(materialId) {
    const id = String(materialId || "").trim();
    if (!id) return null;
    const detailed = _state.furMaterialDetailsById && _state.furMaterialDetailsById[id];
    if (detailed) return detailed;
    return (Array.isArray(_state.furMaterialsCatalog) ? _state.furMaterialsCatalog : [])
      .find((item) => String(item && item.id || "") === id) || null;
  }

  function ensureProjectMaterialEntry(material) {
    const m = material && typeof material === "object" ? material : null;
    const id = String(m && m.id || "").trim();
    if (!id) return null;
    if (!Array.isArray(_state.projectMaterials)) _state.projectMaterials = [];
    const normalized = {
      id,
      name: String(m && (m.name || m.materialName) || id),
      category: String(m && m.category || ""),
      species: String(m && m.species || ""),
      colorHex: String(m && m.colorHex || "")
    };
    const existing = _state.projectMaterials.find((item) => String(item && item.id || "") === id);
    if (existing) {
      Object.assign(existing, normalized);
      return existing;
    }
    _state.projectMaterials.push(normalized);
    _state.projectMaterials.sort((a, b) => String(a && a.name || "").localeCompare(String(b && b.name || ""), "ru"));
    return normalized;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  global.FurLabMaterials = {
    init,
    loadMaterialsDict,
    loadFurMaterialsCatalog,
    loadFurMaterialDetails,
    getFurMaterialById,
    ensureProjectMaterialEntry,
  };

})(window);
