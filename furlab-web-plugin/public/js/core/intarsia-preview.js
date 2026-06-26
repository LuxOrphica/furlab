(function registerFurLabIntarsiaPreview(globalObj) {
  const root = globalObj || (typeof window !== "undefined" ? window : globalThis);

  function createIntarsiaPreview(deps) {
    const state = deps && deps.state;
    const byId = deps && deps.byId;
    const generateFragmentsForZone = deps && deps.generateFragmentsForZone;
    const refreshIntarsiaDerivedFragmentLimits = deps && deps.refreshIntarsiaDerivedFragmentLimits;
    const renderScene = deps && deps.renderScene;

    function previewIntarsiaFragmentsDraft() {
      if (!state || state.layoutMode !== "intarsia") return;
      const zone = state.zones.find((z) => Number(z && z.id) === Number(state.selectedZoneId))
        || (Array.isArray(state.zones) ? state.zones.find((z) => Array.isArray(z && z.points) && z.points.length >= 3) : null);
      if (!zone || !Array.isArray(zone.points) || zone.points.length < 3) return;
      if (!state.selectedZoneId) state.selectedZoneId = zone.id;

      const gridModeEl = byId("fillGridMode");
      const gridMode = gridModeEl ? String(gridModeEl.value || "grid") : "grid";

      let frags = [];
      let infoText = "";

      if (gridMode === "import_svg") {
        const imported = Array.isArray(state.intarsiaSvgFragments) ? state.intarsiaSvgFragments : [];
        if (!imported.length) {
          state.layoutRun.fragments = [];
          state.layoutRun.fillType = "import_svg";
          state.layoutRun.active = false;
          renderScene && renderScene();
          byId("workspaceInfo").textContent = "Интарсия / Импорт SVG: загрузите SVG файл с контурами";
          return;
        }
        frags = imported.map((f, i) => ({
          id: Number(f && f.id) || (i + 1),
          points: Array.isArray(f && f.points) ? f.points : []
        }));
        infoText = `Интарсия / Импорт SVG: ${frags.length} контуров`;
        state.layoutRun.active = true;
        state.layoutRun.status = "preview";
        state.layoutRun.fillType = "import_svg";
        state.layoutRun.strategy = "intarsia";
        state.layoutRun.selectedZoneId = zone.id;
        state.layoutRun.fragments = frags;
        state.layoutRun.placements = [];
        state.layoutRun.previewLayers = { pieceIntersections: [], visibleArea: [], coverageHoles: [] };
        state.layoutRun.stats = { violations: 0, intersections: 0, uncovered: 0 };
        byId("workspaceInfo").textContent = infoText;
        refreshIntarsiaDerivedFragmentLimits();
        renderScene();
        return;
      }

      const rows = Math.max(2, Number(byId("fillRows").value || 5));
      const cols = Math.max(2, Number(byId("fillCols").value || 5));
      const gapX = Math.max(0, Number(byId("fillGapX").value || 0));
      const gapY = Math.max(0, Number(byId("fillGapY").value || 0));
      const cornerRadius = Math.max(0, Number(byId("fillCornerRadius").value || 0));
      const splitRes = generateFragmentsForZone(zone.points || [], {
        fillType: "regular",
        rows,
        cols,
        gapX,
        gapY,
        cornerRadius,
        variability: 0
      });
      frags = Array.isArray(splitRes && splitRes.fragments) ? splitRes.fragments : [];
      state.layoutRun.active = true;
      state.layoutRun.status = "preview";
      state.layoutRun.fillType = "regular";
      state.layoutRun.strategy = "intarsia";
      state.layoutRun.selectedZoneId = zone.id;
      state.layoutRun.fragments = frags.map((f, i) => ({
        id: Number(f && f.id) || (i + 1),
        points: Array.isArray(f && f.points) ? f.points : []
      }));
      state.layoutRun.placements = [];
      state.layoutRun.previewLayers = { pieceIntersections: [], visibleArea: [], coverageHoles: [] };
      state.layoutRun.stats = splitRes && splitRes.stats ? splitRes.stats : { violations: 0, intersections: 0, uncovered: 0 };
      byId("workspaceInfo").textContent = `Интарсия: фрагментов ${state.layoutRun.fragments.length} (сетка ${rows}x${cols}, зазоры ${gapX}/${gapY} мм, скругл. ${cornerRadius} мм)`;
      refreshIntarsiaDerivedFragmentLimits();
      renderScene();
    }

    return { previewIntarsiaFragmentsDraft };
  }

  root.FurLabIntarsiaPreview = { createIntarsiaPreview };
})(typeof window !== "undefined" ? window : globalThis);
