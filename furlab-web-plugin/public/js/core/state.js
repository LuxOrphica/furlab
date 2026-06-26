// Extracted from app.js (state bootstrap)
(function (global) {
  function createInitialState(DEFAULT_NAP_DIRECTION_DEG) {
    return {
      tool: "select",
      layers: {
        pattern: true,
        zones: true,
        zoneMaterials: true,
        selection: true,
        guides: true,
        coverageHoles: false,
        visibleArea: false,
        pieceIntersections: false,
        pieceBorders: true,
        assignedPieces: true,
        pfullZ: false,
        usedGain: true,
        pcoreZ: false,
        visibleCore: false,
        splitLeftovers: true
      },
      viewport: { scale: 1, offsetX: 0, offsetY: 0 },
      patternGeometry: null,
      renderEntities: [],
      details: [],
      selectedDetailId: null,
      zones: [],
      nextZoneId: 1,
      selectedZoneId: null,
      selectedVertexIndex: null,
      debugVertex: {
        enabled: false,
        last: ""
      },
      selectedFragmentId: null,
      hover: { zoneId: null, vertexIndex: null, edgeInsertIndex: null, edgePoint: null },
      curveEdit: null,
      draftZone: [],
      draftSplitLine: [],
      toolUi: {
        penSubtool: "split-zone",
        polygonSubtool: "draw-zone"
      },
      drag: { isDown: false, mode: "", startX: 0, startY: 0, startOffsetX: 0, startOffsetY: 0, movingZoneId: null, movingVertexIndex: null, movingOldPoint: null, boundaryLock: false, sharedBoundaryLock: false, sharedLinkedVertices: null, drawShapeStart: null },
      history: { undo: [], redo: [] }
      ,
      view: {
        majorContoursOnly: true,
        zprjCompactView: true,
        partsMode: "main",
        closedContoursOnly: true,
        autoCloseContours: true,
        smartCloseGaps: false,
        gapTolerance: 40,
        rejectNoisyContours: true,
        highlightSelectedDetail: true,
        patternNamesOnly: true,
        minContourPoints: 40,
        maxContours: 120,
        showDetailLabels: false
      },
      filterStats: { total: 0, noisy: 0, open: 0, minPoints: 0, tooSmall: 0, dedup: 0, capped: 0, shown: 0, smartClosed: 0 },
      uiPanel: "zones",
      libraryPickerMode: "layouts",
      layouts: [],
      nextLayoutId: 1,
      selectedLayoutId: null,
      selectedMaterialId: null,
      projectMaterials: [],
      furMaterialsCatalog: [],
      furMaterialDetailsById: {},
      layoutMode: "inventory",
      layoutRun: {
        active: false,
        status: "idle",
        allowanceMm: 12,
        strategy: "large_first",
        fillType: "voronoi",
        inventoryScenario: "A",
        fragments: [],
        placements: [],
        candidatePool: [],
        lastFilters: {},
        lastConstraints: {},
        lastAxis: "y",
        lastNapDirectionDeg: DEFAULT_NAP_DIRECTION_DEG,
        selectedZoneId: null,
        stats: { violations: 0, intersections: 0, uncovered: 0 },
        previewLayers: {
          pieceIntersections: [],
          visibleArea: [],
          coverageHoles: []
        },
        topChoicesByFragment: {},
        selectedPlacementFragmentId: null,
        splitEvents: [],
        manual: {
          suggestions: [],
          lastMetrics: null,
          selectedCandidateTag: "",
          activePiece: null,
          lastEvalContours: null,
          statusNote: "",
          selectedPlacementIndex: -1
        }
      },
      tagUsage: {},
      keys: { space: false }
    };
  }
  global.FurLabState = Object.assign({}, global.FurLabState || {}, { createInitialState });
})(window);
