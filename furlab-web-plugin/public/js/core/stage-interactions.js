// Extracted from app.js: stage pointer/wheel interactions and drag lifecycle.
(function (global) {
  function createStageInteractions(options) {
    const opts = options && typeof options === "object" ? options : {};
    const stage = opts.stage;
    const state = opts.state;
    if (!stage || !state) {
      return { attach: () => {} };
    }

    const screenToWorld = typeof opts.screenToWorld === "function" ? opts.screenToWorld : () => null;
    const renderScene = typeof opts.renderScene === "function" ? opts.renderScene : () => {};
    const isManualInventoryMode = typeof opts.isManualInventoryMode === "function" ? opts.isManualInventoryMode : () => false;
    const centroid = typeof opts.centroid === "function" ? opts.centroid : () => ({ x: 0, y: 0 });
    const rotatePoints = typeof opts.rotatePoints === "function" ? opts.rotatePoints : (points) => points;
    const updateManualActivePiecePoints = typeof opts.updateManualActivePiecePoints === "function" ? opts.updateManualActivePiecePoints : () => {};
    const renderInventoryManualPanel = typeof opts.renderInventoryManualPanel === "function" ? opts.renderInventoryManualPanel : () => {};
    const setWorkspaceCursor = typeof opts.setWorkspaceCursor === "function" ? opts.setWorkspaceCursor : () => {};
    const findManualPlacementAt = typeof opts.findManualPlacementAt === "function" ? opts.findManualPlacementAt : () => null;
    const pointInPolygon = typeof opts.pointInPolygon === "function" ? opts.pointInPolygon : () => false;
    const findLayoutFragmentAt = typeof opts.findLayoutFragmentAt === "function" ? opts.findLayoutFragmentAt : () => null;
    const findZoneAt = typeof opts.findZoneAt === "function" ? opts.findZoneAt : () => null;
    const findDetailAt = typeof opts.findDetailAt === "function" ? opts.findDetailAt : () => null;
    const findVertexAt = typeof opts.findVertexAt === "function" ? opts.findVertexAt : () => null;
    const findNearestVertexInSelectedZone = typeof opts.findNearestVertexInSelectedZone === "function" ? opts.findNearestVertexInSelectedZone : () => null;
    const buildRectZonePoints = typeof opts.buildRectZonePoints === "function" ? opts.buildRectZonePoints : () => [];
    const buildEllipseZonePoints = typeof opts.buildEllipseZonePoints === "function" ? opts.buildEllipseZonePoints : () => [];
    const createZoneFromPoints = typeof opts.createZoneFromPoints === "function" ? opts.createZoneFromPoints : () => false;
    const setWorkspaceTool = typeof opts.setWorkspaceTool === "function" ? opts.setWorkspaceTool : () => {};
    const pushCommand = typeof opts.pushCommand === "function" ? opts.pushCommand : () => {};
    const byId = typeof opts.byId === "function" ? opts.byId : () => null;
    const getCanvasHeight = typeof opts.getCanvasHeight === "function" ? opts.getCanvasHeight : () => 0;
    const recomputeInventoryManualVisibility = typeof opts.recomputeInventoryManualVisibility === "function"
      ? opts.recomputeInventoryManualVisibility
      : null;
    const isRadialManualCenterMode = typeof opts.isRadialManualCenterMode === "function"
      ? opts.isRadialManualCenterMode
      : () => false;
    const setRadialManualCenter = typeof opts.setRadialManualCenter === "function"
      ? opts.setRadialManualCenter
      : () => {};
    const onZoneGeometryChanged = typeof opts.onZoneGeometryChanged === "function"
      ? opts.onZoneGeometryChanged
      : () => {};
    const validateZoneGeometry = typeof opts.validateZoneGeometry === "function"
      ? opts.validateZoneGeometry
      : () => [];
    const requestZoneSplit = typeof opts.requestZoneSplit === "function"
      ? opts.requestZoneSplit
      : async () => false;
    const smoothZoneVertexPoints = typeof opts.smoothZoneVertexPoints === "function"
      ? opts.smoothZoneVertexPoints
      : () => null;
    const beginCurveEdit = typeof opts.beginCurveEdit === "function"
      ? opts.beginCurveEdit
      : () => false;
    const clearCurveEdit = typeof opts.clearCurveEdit === "function"
      ? opts.clearCurveEdit
      : () => {};
    const applyCurveEditPreview = typeof opts.applyCurveEditPreview === "function"
      ? opts.applyCurveEditPreview
      : () => false;
    const commitCurveEdit = typeof opts.commitCurveEdit === "function"
      ? opts.commitCurveEdit
      : () => false;
    const renderCurvePreview = typeof opts.renderCurvePreview === "function"
      ? opts.renderCurvePreview
      : renderScene;
    const openZoneContextMenuAt = typeof opts.openZoneContextMenuAt === "function"
      ? opts.openZoneContextMenuAt
      : () => {};
    const openIntarsiaFragmentContextMenuAt = typeof opts.openIntarsiaFragmentContextMenuAt === "function"
      ? opts.openIntarsiaFragmentContextMenuAt
      : () => {};
    const setWorkspaceInfo = typeof opts.setWorkspaceInfo === "function"
      ? opts.setWorkspaceInfo
      : () => {};
    const isZoneVertexOnSharedBoundary = typeof opts.isZoneVertexOnSharedBoundary === "function"
      ? opts.isZoneVertexOnSharedBoundary
      : () => false;
    const isLastZoneInDetail = typeof opts.isLastZoneInDetail === "function"
      ? opts.isLastZoneInDetail
      : () => false;
    const findSharedBoundaryVertexLinks = typeof opts.findSharedBoundaryVertexLinks === "function"
      ? opts.findSharedBoundaryVertexLinks
      : () => [];
    const findSharedBoundaryEdgeLinks = typeof opts.findSharedBoundaryEdgeLinks === "function"
      ? opts.findSharedBoundaryEdgeLinks
      : () => [];
    const ensureSharedBoundaryVertex = typeof opts.ensureSharedBoundaryVertex === "function"
      ? opts.ensureSharedBoundaryVertex
      : () => [];
    const validatePartZonePartition = typeof opts.validatePartZonePartition === "function"
      ? opts.validatePartZonePartition
      : () => [];
    const setPrecisionAid = typeof opts.setPrecisionAid === "function"
      ? opts.setPrecisionAid
      : () => {};

    // §9.2: hole-aware point access for linkedMoves (isHoleLink: true → sibling.holes[holeIndex].contour[vertexIndex])
    function holeContour(h) { return Array.isArray(h) ? h : (Array.isArray(h && h.contour) ? h.contour : []); }
    function getLinkedPoint(sibling, link) {
      if (link.isHoleLink) {
        const holeObj = Array.isArray(sibling.holes) ? sibling.holes[link.holeIndex] : null;
        const hole = holeContour(holeObj);
        return hole[link.vertexIndex] || null;
      }
      return (Array.isArray(sibling.points) && sibling.points[link.vertexIndex]) ? sibling.points[link.vertexIndex] : null;
    }
    function setLinkedPoint(sibling, link, pt) {
      if (link.isHoleLink) {
        const holeObj = Array.isArray(sibling.holes) ? sibling.holes[link.holeIndex] : null;
        const hole = holeContour(holeObj);
        if (!hole.length) return;
        const vi = link.vertexIndex;
        const n = hole.length;
        // Closed ring: first and last point are duplicates — keep them in sync
        const firstEqualsLast = n > 1 && hole[0] && hole[n - 1] &&
          Math.abs(hole[0].x - hole[n - 1].x) < 0.01 && Math.abs(hole[0].y - hole[n - 1].y) < 0.01;
        hole[vi] = { x: pt.x, y: pt.y };
        if (firstEqualsLast) {
          if (vi === 0) hole[n - 1] = { x: pt.x, y: pt.y };
          else if (vi === n - 1) hole[0] = { x: pt.x, y: pt.y };
        }
      } else {
        if (!Array.isArray(sibling.points)) return;
        sibling.points[link.vertexIndex] = { x: pt.x, y: pt.y };
      }
    }

    const onZoneSelected = typeof opts.onZoneSelected === "function"
      ? opts.onZoneSelected
      : () => {};
    const onManualPlacementMoved = typeof opts.onManualPlacementMoved === "function"
      ? opts.onManualPlacementMoved
      : () => {};
    const finishIntarsiaContour = typeof opts.finishIntarsiaContour === "function"
      ? opts.finishIntarsiaContour
      : () => {};

    function getHoveredVertexHit(worldPoint, thresholdPx = 10) {
      const hover = state.hover && typeof state.hover === "object" ? state.hover : null;
      const zoneId = Number(hover && hover.zoneId || 0) || 0;
      const vertexIndex = Number(hover && hover.vertexIndex);
      if (!zoneId || !Number.isFinite(vertexIndex)) return null;
      const zone = (Array.isArray(state.zones) ? state.zones : []).find((z) => Number(z && z.id || 0) === zoneId) || null;
      if (!zone || !Array.isArray(zone.points) || vertexIndex < 0 || vertexIndex >= zone.points.length) return null;
      if (worldPoint && typeof worldPoint === "object") {
        const p = zone.points[vertexIndex];
        const scale = Number(state.viewport && state.viewport.scale) || 1;
        const thr = thresholdPx / scale;
        const dx = Number(worldPoint.x) - Number(p.x);
        const dy = Number(worldPoint.y) - Number(p.y);
        if ((dx * dx + dy * dy) > (thr * thr)) return null;
      }
      return { zone, vertexIndex };
    }

    function setVertexDebug(message, extra = null) {
      if (!(state.debugVertex && state.debugVertex.enabled)) return;
      try {
        const base = String(message || "").trim();
        const suffix = extra && typeof extra === "object" ? ` ${JSON.stringify(extra)}` : "";
        const line = `[vertex-debug] ${base}${suffix}`;
        if (state.debugVertex && typeof state.debugVertex === "object") state.debugVertex.last = line;
        try { console.info(line); } catch (_) {}
      } catch (_) {}
    }

    function getNearestSelectedZoneVertexStats(worldPoint) {
      const zone = (Array.isArray(state.zones) ? state.zones : []).find((z) => Number(z && z.id || 0) === Number(state.selectedZoneId || 0)) || null;
      if (!zone || !Array.isArray(zone.points) || !worldPoint) return null;
      let bestIndex = -1;
      let bestD2 = Number.POSITIVE_INFINITY;
      for (let i = 0; i < zone.points.length; i++) {
        const p = zone.points[i];
        const dx = Number(worldPoint.x) - Number(p.x);
        const dy = Number(worldPoint.y) - Number(p.y);
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestIndex = i;
        }
      }
      const scale = Number(state.viewport && state.viewport.scale) || 1;
      return {
        zoneId: Number(zone.id || 0) || null,
        nearestVertexIndex: bestIndex,
        nearestDistancePx: bestIndex >= 0 ? Math.round(Math.sqrt(bestD2) * scale * 100) / 100 : null,
        scale: Math.round(scale * 1000) / 1000
      };
    }

    function getPointerFromEvent(e) {
      const evt = e && e.evt ? e.evt : null;
      const container = stage && typeof stage.container === "function" ? stage.container() : null;
      const rect = container && typeof container.getBoundingClientRect === "function"
        ? container.getBoundingClientRect()
        : null;
      if (evt && rect) {
        return {
          x: Number(evt.clientX) - Number(rect.left),
          y: Number(evt.clientY) - Number(rect.top)
        };
      }
      return stage && typeof stage.getPointerPosition === "function" ? stage.getPointerPosition() : null;
    }

    function toPointObj(q) {
      if (Array.isArray(q) && q.length >= 2) {
        const x = Number(q[0]);
        const y = Number(q[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
      }
      const x = Number(q && q.x);
      const y = Number(q && q.y);
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
      return null;
    }
    function isPointLike(v) {
      return !!toPointObj(v);
    }
    function mapContour(points, fn) {
      if (!Array.isArray(points) || points.length < 3) return points;
      const out = points
        .map((q) => toPointObj(q))
        .filter((q) => q && Number.isFinite(q.x) && Number.isFinite(q.y))
        .map(fn);
      return out.length >= 3 ? out : points;
    }
    function mapPolygonOrContour(poly, fn) {
      if (!Array.isArray(poly) || !poly.length) return poly;
      if (Array.isArray(poly[0]) && (poly[0].length === 0 || isPointLike(poly[0][0]))) {
        return poly.map((ring) => mapContour(ring, fn));
      }
      return mapContour(poly, fn);
    }
    function mapContours(list, fn) {
      if (!Array.isArray(list)) return list;
      return list.map((poly) => mapPolygonOrContour(poly, fn));
    }
    function cloneContour(points) {
      if (!Array.isArray(points)) return points;
      return points.map((q) => toPointObj(q)).filter(Boolean);
    }
    function clonePolygonOrContour(poly) {
      if (!Array.isArray(poly) || !poly.length) return poly;
      if (Array.isArray(poly[0]) && (poly[0].length === 0 || isPointLike(poly[0][0]))) {
        return poly.map((ring) => cloneContour(ring));
      }
      return cloneContour(poly);
    }
    function cloneContours(list) {
      if (!Array.isArray(list)) return list;
      return list.map((poly) => clonePolygonOrContour(poly));
    }
    function projectPointToSegment(point, a, b) {
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const wx = point.x - a.x;
      const wy = point.y - a.y;
      const c2 = vx * vx + vy * vy;
      if (c2 <= 1e-9) return { x: a.x, y: a.y, t: 0 };
      const t = Math.max(0, Math.min(1, (vx * wx + vy * wy) / c2));
      return { x: a.x + t * vx, y: a.y + t * vy, t };
    }
    function dist2(a, b) {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      return dx * dx + dy * dy;
    }
    function findClosestZoneEdgePoint(zone, worldPoint, thresholdPx = 10) {
      const pts = Array.isArray(zone && zone.points) ? zone.points : [];
      if (pts.length < 2) return null;
      const thresholdMm = thresholdPx / Math.max(0.0001, Number(state.viewport && state.viewport.scale || 1));
      const threshold2 = thresholdMm * thresholdMm;
      let best = null;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const projected = projectPointToSegment(worldPoint, a, b);
        const d2 = dist2(worldPoint, projected);
        if (d2 > threshold2) continue;
        if (!best || d2 < best.distance2) {
          best = {
            zone,
            insertIndex: i + 1,
            point: { x: projected.x, y: projected.y },
            distance2: d2
          };
        }
      }
      return best;
    }
    function getDetailBoundaryPointsForZone(zone) {
      // Delegate to FurLabZoneLookups which has DXF + union-based fallback.
      // Without this delegation the function returns [] in no-DXF sessions,
      // making isZoneVertexOnDetailBoundary always false for split zones.
      const lookups = typeof window !== "undefined" && window.FurLabZoneLookups;
      if (lookups && typeof lookups.getDetailBoundaryPointsForZone === "function") {
        return lookups.getDetailBoundaryPointsForZone(zone);
      }
      // Hard fallback: DXF-only
      const detailId = Number(zone && zone.detailId || 0) || 0;
      if (!detailId || !Array.isArray(state.details)) return [];
      const detail = state.details.find((item) => Number(item && item.id || 0) === detailId) || null;
      const pts = Array.isArray(detail && detail.entity && detail.entity.points) ? detail.entity.points : [];
      return pts.length >= 2 ? pts : [];
    }
    function clampPointsToDetailBoundary(pts, detailBoundary) {
      if (!Array.isArray(detailBoundary) || detailBoundary.length < 3) return pts;
      return pts.map((p) => {
        if (pointInPolygon(p, detailBoundary)) return p;
        const proj = projectPointToBoundary(detailBoundary, p);
        return proj ? { x: proj.x, y: proj.y } : p;
      });
    }
    function projectPointToBoundary(points, worldPoint) {
      const pts = Array.isArray(points) ? points : [];
      if (pts.length < 2 || !worldPoint) return null;
      let best = null;
      let bestD2 = Number.POSITIVE_INFINITY;
      const closed = pts.length >= 3;
      const last = closed ? pts.length : (pts.length - 1);
      for (let i = 0; i < last; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const projected = projectPointToSegment(worldPoint, a, b);
        const d2 = dist2(worldPoint, projected);
        if (d2 < bestD2) {
          bestD2 = d2;
          best = { x: projected.x, y: projected.y, distance2: d2 };
        }
      }
      return best;
    }
    function isZoneVertexOnDetailBoundary(zone, vertexIndex, thresholdPx = 8) {
      const pts = Array.isArray(zone && zone.points) ? zone.points : [];
      const idx = Number(vertexIndex);
      if (!Number.isFinite(idx) || idx < 0 || idx >= pts.length) return false;
      const detailBoundary = getDetailBoundaryPointsForZone(zone);
      if (detailBoundary.length < 2) return false;
      const projected = projectPointToBoundary(detailBoundary, pts[idx]);
      if (!projected) return false;
      const thresholdMm = thresholdPx / Math.max(0.0001, Number(state.viewport && state.viewport.scale || 1));
      return Number(projected.distance2 || 0) <= thresholdMm * thresholdMm;
    }
    function snapshotPlacementGeometry(pl) {
      if (!pl || typeof pl !== "object") return null;
      return {
        alignedContour: cloneContour(pl.alignedContour),
        inZoneContour: cloneContour(pl.inZoneContour),
        alignedCoreContour: cloneContour(pl.alignedCoreContour),
        inZoneCoreContour: cloneContour(pl.inZoneCoreContour),
        usedVisibleContour: cloneContour(pl.usedVisibleContour),
        alignedCoreContours: cloneContours(pl.alignedCoreContours),
        inZoneContours: cloneContours(pl.inZoneContours),
        inZoneCoreContours: cloneContours(pl.inZoneCoreContours),
        usedVisibleContours: cloneContours(pl.usedVisibleContours)
      };
    }
    function restorePlacementGeometry(pl, snap) {
      if (!pl || !snap) return;
      pl.alignedContour = cloneContour(snap.alignedContour);
      pl.inZoneContour = cloneContour(snap.inZoneContour);
      pl.alignedCoreContour = cloneContour(snap.alignedCoreContour);
      pl.inZoneCoreContour = cloneContour(snap.inZoneCoreContour);
      pl.usedVisibleContour = cloneContour(snap.usedVisibleContour);
      pl.alignedCoreContours = cloneContours(snap.alignedCoreContours);
      pl.inZoneContours = cloneContours(snap.inZoneContours);
      pl.inZoneCoreContours = cloneContours(snap.inZoneCoreContours);
      pl.usedVisibleContours = cloneContours(snap.usedVisibleContours);
    }
    function translatePlacementGeometry(pl, dx, dy) {
      const shift = (q) => ({ x: q.x + dx, y: q.y + dy });
      pl.alignedContour = mapContour(pl.alignedContour, shift);
      pl.inZoneContour = mapContour(pl.inZoneContour, shift);
      pl.alignedCoreContour = mapContour(pl.alignedCoreContour, shift);
      pl.inZoneCoreContour = mapContour(pl.inZoneCoreContour, shift);
      pl.usedVisibleContour = mapContour(pl.usedVisibleContour, shift);
      pl.alignedCoreContours = mapContours(pl.alignedCoreContours, shift);
      pl.inZoneContours = mapContours(pl.inZoneContours, shift);
      pl.inZoneCoreContours = mapContours(pl.inZoneCoreContours, shift);
      pl.usedVisibleContours = mapContours(pl.usedVisibleContours, shift);
    }
    function rotatePlacementGeometry(pl, angleRad, center) {
      const rotOne = (q) => {
        const r = rotatePoints([{ x: q.x, y: q.y }], angleRad, center);
        return (Array.isArray(r) && r[0]) ? r[0] : q;
      };
      pl.alignedContour = mapContour(pl.alignedContour, rotOne);
      pl.inZoneContour = mapContour(pl.inZoneContour, rotOne);
      pl.alignedCoreContour = mapContour(pl.alignedCoreContour, rotOne);
      pl.inZoneCoreContour = mapContour(pl.inZoneCoreContour, rotOne);
      pl.usedVisibleContour = mapContour(pl.usedVisibleContour, rotOne);
      pl.alignedCoreContours = mapContours(pl.alignedCoreContours, rotOne);
      pl.inZoneContours = mapContours(pl.inZoneContours, rotOne);
      pl.inZoneCoreContours = mapContours(pl.inZoneCoreContours, rotOne);
      pl.usedVisibleContours = mapContours(pl.usedVisibleContours, rotOne);
    }

    function attach() {
      stage.on("contextmenu", (e) => {
        e.evt.preventDefault();
        const p = getPointerFromEvent(e);
        if (!p) return;
        const world = screenToWorld(p.x, p.y);

        // In intarsia mode — check fragment hit first
        const isIntarsiaSvgInteractive = state.layoutMode === "intarsia" && state.layoutRun && state.layoutRun.fillType === "import_svg";
        if (isIntarsiaSvgInteractive) {
          const fragHit = findLayoutFragmentAt(world);
          if (fragHit && Number(fragHit.fragmentId || 0) > 0) {
            state.selectedFragmentId = fragHit.fragmentId;
            state.selectedZoneId = fragHit.zoneId;
            renderScene();
            openIntarsiaFragmentContextMenuAt({
              x: Number(e.evt.clientX || 0),
              y: Number(e.evt.clientY || 0),
              fragmentId: fragHit.fragmentId,
              zoneId: fragHit.zoneId
            });
            return;
          }
        }

        const hitZone = findZoneAt(world);
        if (hitZone && Number(hitZone.id || 0) > 0) {
          state.selectedZoneId = Number(hitZone.id || 0) || null;
          state.selectedFragmentId = null;
          if (Number(hitZone.detailId || 0) > 0) state.selectedDetailId = Number(hitZone.detailId || 0);
          renderScene();
          openZoneContextMenuAt({
            x: Number(e.evt.clientX || 0),
            y: Number(e.evt.clientY || 0),
            zone: hitZone
          });
        }
      });

      stage.on("wheel", (e) => {
        e.evt.preventDefault();
        if (isManualInventoryMode()) {
          const manual = state.layoutRun && state.layoutRun.manual ? state.layoutRun.manual : null;
          const selIdx = Number(manual && manual.selectedPlacementIndex);
          const placements = Array.isArray(state.layoutRun && state.layoutRun.placements) ? state.layoutRun.placements : [];
          const selPlacement = Number.isFinite(selIdx) && selIdx >= 0 && selIdx < placements.length ? placements[selIdx] : null;
          if (selPlacement && Array.isArray(selPlacement.alignedContour) && selPlacement.alignedContour.length >= 3 && (e.evt.shiftKey || e.evt.altKey)) {
            const stepDeg = e.evt.deltaY < 0 ? 5 : -5;
            const center = centroid(selPlacement.alignedContour);
            rotatePlacementGeometry(selPlacement, (stepDeg * Math.PI) / 180, center);
            if (manual) manual.statusNote = "кусок повернут";
            renderInventoryManualPanel();
            renderScene();
            return;
          }
          const ap = manual && manual.activePiece ? manual.activePiece : null;
          if (ap && Array.isArray(ap.points) && ap.points.length >= 3 && (e.evt.shiftKey || e.evt.altKey)) {
            const stepDeg = e.evt.deltaY < 0 ? 5 : -5;
            const center = centroid(ap.points);
            const rotated = rotatePoints(ap.points, (stepDeg * Math.PI) / 180, center);
            updateManualActivePiecePoints(rotated);
            renderScene();
            return;
          }
        }
        const pointer = getPointerFromEvent(e);
        if (!pointer) return;
        const factor = e.evt.deltaY < 0 ? 1.1 : 0.9;
        const wb = screenToWorld(pointer.x, pointer.y);
        state.viewport.scale = Math.max(0.02, Math.min(500, state.viewport.scale * factor));
        state.viewport.offsetX = pointer.x - wb.x * state.viewport.scale;
        state.viewport.offsetY = (getCanvasHeight() - pointer.y) - wb.y * state.viewport.scale;
        renderScene();
      });

      stage.on("mousedown", (e) => {
        const p = getPointerFromEvent(e);
        if (!p) return;
        const world = screenToWorld(p.x, p.y);
        state.drag.isDown = true;
        state.drag.startX = p.x;
        state.drag.startY = p.y;
        state.drag.startOffsetX = state.viewport.offsetX;
        state.drag.startOffsetY = state.viewport.offsetY;
        const targetName = String(e && e.target && typeof e.target.name === "function" ? e.target.name() : "");

        if (isManualInventoryMode() && e.evt.button === 0 && state.tool !== "pan" && !state.keys.space) {
          const hitPl = findManualPlacementAt(world);
          if (hitPl && Number.isFinite(Number(hitPl.placementIndex))) {
            state.layoutRun.manual = state.layoutRun.manual || { suggestions: [], lastMetrics: null, selectedCandidateTag: "", activePiece: null, lastEvalContours: null, statusNote: "", selectedPlacementIndex: -1 };
            state.layoutRun.manual.selectedPlacementIndex = Number(hitPl.placementIndex);
            state.layoutRun.manual.statusNote = "кусок выбран";
            state.drag.mode = "manual-placement-move";
            state.drag.manualMoved = false;
            state.drag.manualPointerStart = world;
            state.drag.manualPlacementIndex = Number(hitPl.placementIndex);
            state.drag.manualDragScrapPieceId = String(hitPl.placement.scrapPieceId || "");
            state.drag.manualPlacementStart = Array.isArray(hitPl.placement.alignedContour) ? hitPl.placement.alignedContour.map((q) => ({ x: q.x, y: q.y })) : null;
            state.drag.manualPlacementGeomStart = snapshotPlacementGeometry(hitPl.placement);
            renderInventoryManualPanel();
            renderScene();
            return;
          }
          const manual = state.layoutRun && state.layoutRun.manual ? state.layoutRun.manual : null;
          const ap = manual && manual.activePiece ? manual.activePiece : null;
          if (ap && Array.isArray(ap.points) && ap.points.length >= 3 && pointInPolygon(world, ap.points)) {
            state.drag.mode = "manual-piece-move";
            state.drag.manualPointerStart = world;
            state.drag.manualPieceStart = ap.points.map((q) => ({ x: q.x, y: q.y }));
            return;
          }
        }

        if (state.tool === "pan" || state.keys.space || e.evt.button === 1 || e.evt.button === 2) {
          state.drag.mode = "pan";
          setWorkspaceCursor("grabbing");
          return;
        }
        if (e.evt.button !== 0) return;
        if (isRadialManualCenterMode() && targetName !== "radial-center-handle") {
          setRadialManualCenter(world, { preview: true });
          return;
        }
        if (state.tool === "intarsia-pen") {
          if (!Array.isArray(state.draftIntarsiaContour)) state.draftIntarsiaContour = [];
          state.draftIntarsiaContour.push(world);
          setWorkspaceInfo(`Перо: ${state.draftIntarsiaContour.length} точек. Двойной клик или Enter — закрыть. Esc — отмена.`);
          renderScene();
          return;
        }
        if (state.tool === "draw-zone") {
          state.draftZone.push(world);
          renderScene();
          return;
        }
        if (state.tool === "draw-rect" || state.tool === "draw-ellipse") {
          state.drag.mode = state.tool;
          state.drag.drawShapeStart = { x: Number(world.x), y: Number(world.y) };
          state.draftZone = [];
          renderScene();
          return;
        }
        if (state.tool === "split-zone") {
          const hitZone = findZoneAt(world);
          if (hitZone && Number(hitZone.id || 0) > 0) {
            state.selectedZoneId = Number(hitZone.id || 0);
            if (Number(hitZone.detailId || 0) > 0) state.selectedDetailId = Number(hitZone.detailId);
          }
          if (!Array.isArray(state.draftSplitLine) || state.draftSplitLine.length === 0) {
            state.draftSplitLine = [world];
            setWorkspaceInfo("Линия зонирования: поставьте вторую точку.");
            renderScene();
            return;
          }
          if (state.draftSplitLine.length === 1) {
            state.draftSplitLine = [state.draftSplitLine[0], world];
            setWorkspaceInfo("Линия зонирования: вторая точка поставлена. Нажмите Enter для разделения.");
            renderScene();
            return;
          }
          state.draftSplitLine = [state.draftSplitLine[0], world];
          setWorkspaceInfo("Линия зонирования: скорректируйте вторую точку или нажмите Enter для разделения.");
          renderScene();
          return;
        }
        if (state.tool === "select") {
          const isIntarsiaSvgInteractive = state.layoutMode === "intarsia" && state.layoutRun && state.layoutRun.fillType === "import_svg";

          // Hit-test intarsia handles before anything else
          if (isIntarsiaSvgInteractive && state.intarsiaHandles) {
            const ih = state.intarsiaHandles;
            const vscale = state.viewport.scale || 1;
            const hitR = 9 / vscale;
            // Rotation handle
            const rh = ih.rotHandleWorld;
            if (rh && Math.hypot(world.x - rh.x, world.y - rh.y) <= hitR) {
              state.drag.mode = "intarsia-rotate";
              state.drag.intarsiaFragObj = ih.fragObj;
              state.drag.intarsiaBCx = ih.bCx;
              state.drag.intarsiaBCy = ih.bCy;
              state.drag.intarsiaOrigPts = ih.fragObj.points.map((p) => ({ x: p.x, y: p.y }));
              state.drag.intarsiaStartAngle = Math.atan2(world.y - ih.bCy, world.x - ih.bCx);
              setWorkspaceCursor("grabbing");
              return;
            }
            // Corner scale handles
            for (let ci = 0; ci < ih.corners.length; ci++) {
              const c = ih.corners[ci];
              if (Math.hypot(world.x - c.x, world.y - c.y) <= hitR) {
                state.drag.mode = "intarsia-scale";
                state.drag.intarsiaFragObj = ih.fragObj;
                state.drag.intarsiaCornerWorld = { x: c.x, y: c.y };
                state.drag.intarsiaOppCorner = ih.corners[(ci + 2) % 4];
                state.drag.intarsiaBCx = ih.bCx;
                state.drag.intarsiaBCy = ih.bCy;
                state.drag.intarsiaOrigPts = ih.fragObj.points.map((p) => ({ x: p.x, y: p.y }));
                setWorkspaceCursor(c.cursor);
                return;
              }
            }
          }

          const fragHit = findLayoutFragmentAt(world);
          if (fragHit) {
            state.selectedZoneId = fragHit.zoneId;
            state.selectedFragmentId = fragHit.fragmentId;
            state.selectedVertexIndex = null;
            const z = state.zones.find((x) => Number(x.id) === Number(fragHit.zoneId));
            if (z && Number(z.detailId || 0) > 0) state.selectedDetailId = Number(z.detailId);
            if (isIntarsiaSvgInteractive) {
              // Start move drag
              const frag = Array.isArray(state.layoutRun && state.layoutRun.fragments)
                ? state.layoutRun.fragments.find((f) => Number(f.id || 0) === Number(fragHit.fragmentId)) : null;
              if (frag) {
                state.drag.mode = "intarsia-move";
                state.drag.intarsiaFragObj = frag;
                state.drag.intarsiaPointerStart = { x: world.x, y: world.y };
                state.drag.intarsiaOrigPts = frag.points.map((p) => ({ x: p.x, y: p.y }));
              }
            }
            if (z) onZoneSelected(z);
            renderScene();
            return;
          }
          const hit = findZoneAt(world);
          state.selectedZoneId = hit ? hit.id : null;
          state.selectedFragmentId = null;
          state.selectedVertexIndex = null;
          if (hit && Number(hit.detailId || 0) > 0) state.selectedDetailId = Number(hit.detailId);
          const detailHit = findDetailAt(world, 10);
          state.selectedDetailId = detailHit ? detailHit.id : state.selectedDetailId;
          if (hit && Number(hit.id || 0) > 0) onZoneSelected(hit);
          renderScene();
          return;
        }
        if (state.tool === "edit-vertex") {
          const hv = findVertexAt(world) || getHoveredVertexHit(world) || findNearestVertexInSelectedZone(world);
          if (hv && (String(hv.zone && hv.zone.originType || "") === "base" || isLastZoneInDetail(hv.zone))) {
            setWorkspaceInfo("[part_boundary_locked] Исходная зона детали не редактируется. Разделите зону для создания новых.");
            return;
          }
          if (hv) {
            // CONTRACT §3.1 / §3.6-endpoint: partBoundary + sharedBoundary = slide; pure partBoundary = block
            state.drag.slideAlongPartContour = false;
            if (isZoneVertexOnDetailBoundary(hv.zone, hv.vertexIndex)) {
              if (!isZoneVertexOnSharedBoundary(hv.zone, hv.vertexIndex)) {
                setWorkspaceInfo("part_boundary_locked: вершина на контуре детали не редактируется.");
                renderScene();
                return;
              }
              // sharedBoundaryEndpoint: разрешён drag вдоль partContour
              state.drag.slideAlongPartContour = true;
            }
            // Fix union-fallback trap: register canonical partContour BEFORE drag
            // mutates state.zones. Once registered in _partContoursById, subsequent
            // calls return the pre-drag boundary, not the union of modified zones.
            const _lookups = typeof window !== "undefined" && window.FurLabZoneLookups;
            if (_lookups && typeof _lookups.registerDetailContour === "function") {
              const _detailId = Number(hv.zone && hv.zone.detailId || 0);
              if (_detailId && !_lookups.isDetailBoundaryKnown(_detailId)) {
                const _canon = getDetailBoundaryPointsForZone(hv.zone);
                if (_canon.length >= 3) _lookups.registerDetailContour(_detailId, _canon);
              }
            }
            state.selectedVertexIndex = hv.vertexIndex;
            state.drag.mode = "move-vertex";
            state.drag.movingZoneId = hv.zone.id;
            state.drag.movingVertexIndex = hv.vertexIndex;
            state.drag.movingOldPoint = { ...hv.zone.points[hv.vertexIndex] };
            state.drag.sharedBoundaryLock = isZoneVertexOnSharedBoundary(hv.zone, hv.vertexIndex);
            state.drag.sharedLinkedVertices = state.drag.sharedBoundaryLock
              ? findSharedBoundaryVertexLinks(hv.zone, hv.vertexIndex, 10)
              : [];
            // If sharedBoundaryLock but no linked vertex found — vertex may be on a sibling's
            // segment without a matching vertex (add-vertex sync failed earlier). Insert now.
            if (state.drag.sharedBoundaryLock && state.drag.sharedLinkedVertices.length === 0) {
              const inserted = ensureSharedBoundaryVertex(hv.zone, hv.vertexIndex);
              if (inserted.length > 0) state.drag.sharedLinkedVertices = inserted;
            }
            console.log('[DRAG] zone', hv.zone.id, 'vi', hv.vertexIndex,
              'pt', JSON.stringify(hv.zone.points[hv.vertexIndex]),
              'sharedBoundaryLock', state.drag.sharedBoundaryLock,
              'linkedMoves', JSON.stringify(state.drag.sharedLinkedVertices));
setVertexDebug("mousedown edit-vertex hit", {
              zoneId: Number(hv.zone && hv.zone.id || 0) || null,
              vertexIndex: Number(hv.vertexIndex),
              selectedZoneId: Number(state.selectedZoneId || 0) || null
            });
            renderScene();
            return;
          }
          setVertexDebug("mousedown edit-vertex miss", {
            selectedZoneId: Number(state.selectedZoneId || 0) || null,
            hoverZoneId: Number(state.hover && state.hover.zoneId || 0) || null,
            hoverVertexIndex: Number(state.hover && state.hover.vertexIndex),
            nearest: getNearestSelectedZoneVertexStats(world)
          });
          const hz = findZoneAt(world);
          state.selectedZoneId = hz ? hz.id : state.selectedZoneId;
          state.selectedFragmentId = null;
          state.selectedVertexIndex = null;
          if (hz && Number(hz.detailId || 0) > 0) state.selectedDetailId = Number(hz.detailId);
          renderScene();
          return;
        }
        if (state.tool === "curve-vertex") {
          // If curveEdit is active and the click lands on a curve handle, let Konva's draggable
          // handle it — calling renderScene() here would destroy the marker mid-drag.
          const _ce = state.curveEdit && typeof state.curveEdit === "object" ? state.curveEdit : null;
          if (_ce) {
            const _bp = Array.isArray(_ce.basePoints) ? _ce.basePoints : [];
            const _n = _bp.length;
            if (_n >= 3) {
              const _idx = ((Number(_ce.vertexIndex || 0) % _n) + _n) % _n;
              const _cur = _bp[_idx];
              const _prev = _bp[(_idx - 1 + _n) % _n];
              const _next = _bp[(_idx + 1) % _n];
              const _vp = { x: _prev.x - _cur.x, y: _prev.y - _cur.y };
              const _vn = { x: _next.x - _cur.x, y: _next.y - _cur.y };
              const _lp = Math.hypot(_vp.x, _vp.y), _ln = Math.hypot(_vn.x, _vn.y);
              if (_lp > 1e-6 && _ln > 1e-6) {
                const _up = { x: _vp.x / _lp, y: _vp.y / _lp };
                const _un = { x: _vn.x / _ln, y: _vn.y / _ln };
                const _str = Math.max(0.08, Math.min(0.48, Number(_ce.strength) || 0.28));
                const _ml = Math.min(_lp, _ln);
                const _sc = Math.max(0.001, Number(state.viewport && state.viewport.scale || 1));
                const _hl = Math.max(12 / _sc, _ml * _str);
                const _hp = { x: _cur.x + _up.x * _hl, y: _cur.y + _up.y * _hl };
                const _hn = { x: _cur.x + _un.x * _hl, y: _cur.y + _un.y * _hl };
                const _hitR = 18 / _sc;
                const _d1 = (world.x - _hp.x) ** 2 + (world.y - _hp.y) ** 2;
                const _d2 = (world.x - _hn.x) ** 2 + (world.y - _hn.y) ** 2;
                if (_d1 < _hitR * _hitR || _d2 < _hitR * _hitR) {
                  // Click landed on a curve handle — enter curve-handle drag mode
                  const whichHandle = _d1 <= _d2 ? "prev" : "next";
                  state.drag.mode = "curve-handle";
                  state.drag.curveHandleWhich = whichHandle;
                  state.drag.curveHandleVec = whichHandle === "prev" ? _up : _un;
                  state.drag.curveHandleCenter = { x: _cur.x, y: _cur.y };
                  state.drag.curveHandleMinLen = _ml;
                  state.drag.curveHandleScale = _sc;
                  return;
                }
              }
            }
          }
          const hv = findVertexAt(world) || getHoveredVertexHit(world) || findNearestVertexInSelectedZone(world);
          if (!hv || !hv.zone || !Array.isArray(hv.zone.points) || hv.zone.points.length < 3) {
            clearCurveEdit({ restore: true });
            const hz = findZoneAt(world);
            state.selectedZoneId = hz ? hz.id : state.selectedZoneId;
            state.selectedFragmentId = null;
            state.selectedVertexIndex = null;
            if (hz && Number(hz.detailId || 0) > 0) state.selectedDetailId = Number(hz.detailId);
            renderScene();
            return;
          }
          if (String(hv.zone && hv.zone.originType || "") === "base" || isLastZoneInDetail(hv.zone)) {
            setWorkspaceInfo("[part_boundary_locked] Кривизна исходной зоны детали не редактируется.");
            renderScene();
            return;
          }
          // partBoundary: BLOCK — CONTRACT §3.1
          if (isZoneVertexOnDetailBoundary(hv.zone, hv.vertexIndex)) {
            setWorkspaceInfo("part_boundary_locked: кривизна вершины на контуре детали запрещена.");
            renderScene();
            return;
          }

          state.selectedVertexIndex = hv.vertexIndex;
          if (!beginCurveEdit(hv.zone, hv.vertexIndex, e.evt.shiftKey ? 0.16 : 0.28)) {
            renderScene();
            return;
          }
          // sharedBoundary: atomic curve sync — CONTRACT §3.6
          // Find sibling vertex links and store base points for rollback and sibling preview.
          if (isZoneVertexOnSharedBoundary(hv.zone, hv.vertexIndex)) {
            const links = findSharedBoundaryVertexLinks(hv.zone, hv.vertexIndex, 10);
            if (links.length === 0) {
              // Sibling not found — cannot guarantee atomic edit
              clearCurveEdit({ restore: true });
              setWorkspaceInfo("shared_boundary_mismatch: общая граница зон должна редактироваться синхронно.");
              renderScene();
              return;
            }
            state.curveEdit.siblingLinks = links.map((link) => {
              const sibling = (Array.isArray(state.zones) ? state.zones : []).find((z) => Number(z && z.id || 0) === Number(link.zoneId || 0));
              return {
                zoneId: link.zoneId,
                vertexIndex: link.vertexIndex,
                basePoints: sibling && Array.isArray(sibling.points) ? sibling.points.map((p) => ({ x: p.x, y: p.y })) : []
              };
            });
          }
          renderScene();
          return;
        }
        if (state.tool === "smooth-vertex") {
          // Следующая редакция инструмента: smooth-vertex отключён для committed zones.
          // Причина: non-atomic sibling sync, separate undo commands per zone, no partition gate.
          // Используйте curve-vertex (C). smooth-vertex вернётся как Quick Smooth
          // после реализации BoundaryRef + atomic sharedBoundary sync.
          setWorkspaceInfo("boundary_not_editable [smooth_requires_atomic_boundary_sync]: используйте «Изменить кривизну» (C).");
          return;
        }
        if (state.tool === "add-vertex") {
          // If clicking on an existing vertex — drag it, don't insert
          const hvExisting = findVertexAt(world) || getHoveredVertexHit(world);
          if (hvExisting && hvExisting.zone && hvExisting.zone.points) {
            if (!(String(hvExisting.zone.originType || "") === "base" || isLastZoneInDetail(hvExisting.zone))) {
              // CONTRACT §3.1: partBoundary+sharedBoundary = slide; pure partBoundary = block
              state.drag.slideAlongPartContour = false;
              if (isZoneVertexOnDetailBoundary(hvExisting.zone, hvExisting.vertexIndex)) {
                if (!isZoneVertexOnSharedBoundary(hvExisting.zone, hvExisting.vertexIndex)) {
                  setWorkspaceInfo("part_boundary_locked: вершина на контуре детали не редактируется.");
                  renderScene();
                  return;
                }
                state.drag.slideAlongPartContour = true;
              }
              state.selectedVertexIndex = hvExisting.vertexIndex;
              state.drag.mode = "move-vertex";
              state.drag.movingZoneId = hvExisting.zone.id;
              state.drag.movingVertexIndex = hvExisting.vertexIndex;
              state.drag.movingOldPoint = { ...hvExisting.zone.points[hvExisting.vertexIndex] };
              state.drag.sharedBoundaryLock = isZoneVertexOnSharedBoundary(hvExisting.zone, hvExisting.vertexIndex);
              state.drag.sharedLinkedVertices = state.drag.sharedBoundaryLock
                ? findSharedBoundaryVertexLinks(hvExisting.zone, hvExisting.vertexIndex, 10)
                : [];
              if (state.drag.sharedBoundaryLock && state.drag.sharedLinkedVertices.length === 0) {
                const inserted = ensureSharedBoundaryVertex(hvExisting.zone, hvExisting.vertexIndex);
                if (inserted.length > 0) state.drag.sharedLinkedVertices = inserted;
              }
              renderScene();
              return;
            }
          }
          // Try to add vertex to the currently selected zone first — don't switch selection
          // just because the click landed inside a neighbouring zone's polygon area.
          const hz = findZoneAt(world);
          const currentZone = state.zones.find((z) => Number(z && z.id || 0) === Number(state.selectedZoneId || 0)) || null;
          let targetZone = null;
          let edgeHit = null;
          if (currentZone) {
            const hit = findClosestZoneEdgePoint(currentZone, world);
            if (hit) { targetZone = currentZone; edgeHit = hit; }
          }
          if (!targetZone && hz && Number(hz.id || 0) > 0) {
            const hit = findClosestZoneEdgePoint(hz, world);
            if (hit) { targetZone = hz; edgeHit = hit; }
          }
          if (!targetZone || !edgeHit) {
            if (hz && Number(hz.id || 0) > 0) {
              state.selectedZoneId = Number(hz.id || 0) || null;
              if (Number(hz.detailId || 0) > 0) state.selectedDetailId = Number(hz.detailId || 0) || state.selectedDetailId;
            }
            renderScene();
            return;
          }
          if (Number(targetZone.id || 0) !== Number(state.selectedZoneId || 0)) {
            state.selectedZoneId = Number(targetZone.id || 0) || null;
            if (Number(targetZone.detailId || 0) > 0) state.selectedDetailId = Number(targetZone.detailId || 0) || state.selectedDetailId;
          }
          targetZone.points.splice(edgeHit.insertIndex, 0, { ...edgeHit.point });
          state.selectedVertexIndex = edgeHit.insertIndex;
          const edgeLinks = findSharedBoundaryEdgeLinks(targetZone, edgeHit.insertIndex);
          // Collect all moves for a single atomic undo command
          const addVertexMoves = [
            { zoneId: Number(targetZone.id || 0) || null, insertIndex: edgeHit.insertIndex, point: { ...edgeHit.point } }
          ];
          const processedSiblingIds = new Set();
          // Helper: apply a single edge-link (outer or hole ring)
          const applyEdgeLink = (el, sibling, pt) => {
            if (el.isHoleLink) {
              const holes = Array.isArray(sibling.holes) ? sibling.holes : [];
              const hole = holeContour(holes[Number(el.holeIndex)]);
              if (!hole.length) return;
              hole.splice(el.insertIndex, 0, { ...pt });
            } else {
              sibling.points.splice(el.insertIndex, 0, { ...pt });
            }
            addVertexMoves.push({
              zoneId: Number(sibling.id || 0) || null,
              insertIndex: el.insertIndex,
              point: { ...pt },
              isHoleLink: el.isHoleLink || false,
              holeIndex: el.holeIndex != null ? Number(el.holeIndex) : undefined
            });
            onZoneGeometryChanged(sibling);
            processedSiblingIds.add(Number(sibling.id || 0));
          };
          for (const el of edgeLinks) {
            const sibling = (Array.isArray(state.zones) ? state.zones : []).find((z) => Number(z && z.id || 0) === Number(el.zoneId || 0));
            if (!sibling) continue;
            applyEdgeLink(el, sibling, edgeHit.point);
          }
          // Fallback: if FSBE missed any sibling, ensure vertex is inserted via segment search
          if (edgeLinks.length === 0) {
            const fallbackLinks = ensureSharedBoundaryVertex(targetZone, edgeHit.insertIndex);
            for (const fl of fallbackLinks) {
              if (processedSiblingIds.has(Number(fl.zoneId || 0))) continue;
              const sibling = (Array.isArray(state.zones) ? state.zones : []).find((z) => Number(z && z.id || 0) === Number(fl.zoneId || 0));
              if (!sibling) continue;
              // ensureSharedBoundaryVertex already spliced; just record for undo
              addVertexMoves.push({
                zoneId: Number(sibling.id || 0) || null,
                insertIndex: fl.vertexIndex,
                point: { ...edgeHit.point },
                isHoleLink: fl.isHoleLink || false,
                holeIndex: fl.holeIndex != null ? Number(fl.holeIndex) : undefined
              });
              onZoneGeometryChanged(sibling);
            }

          }
          if (addVertexMoves.length === 1) {
            pushCommand({ type: "add-vertex", zoneId: addVertexMoves[0].zoneId, insertIndex: addVertexMoves[0].insertIndex, point: addVertexMoves[0].point });
          } else {
            pushCommand({ type: "add-shared-boundary-vertex", moves: addVertexMoves });
          }
          onZoneGeometryChanged(targetZone);
          renderScene();
        }
      });

      stage.on("mousemove", (e) => {
        const p = getPointerFromEvent(e);
        if (!p) return;
        if (state.drag.mode === "konva-drag") return;
        const world = screenToWorld(p.x, p.y);

        if (state.drag.mode === "intarsia-move") {
          const frag = state.drag.intarsiaFragObj;
          const origPts = state.drag.intarsiaOrigPts;
          const start = state.drag.intarsiaPointerStart;
          if (frag && origPts && start) {
            const dx = world.x - start.x;
            const dy = world.y - start.y;
            frag.points = origPts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
            renderScene();
          }
          return;
        }
        if (state.drag.mode === "intarsia-scale") {
          const frag = state.drag.intarsiaFragObj;
          const origPts = state.drag.intarsiaOrigPts;
          const corner = state.drag.intarsiaCornerWorld;
          const opp = state.drag.intarsiaOppCorner;
          const bCx = state.drag.intarsiaBCx, bCy = state.drag.intarsiaBCy;
          if (frag && origPts && corner) {
            const anchor = state.keys && state.keys.shift ? opp : { x: bCx, y: bCy };
            const origDist = Math.max(1e-6, Math.hypot(corner.x - anchor.x, corner.y - anchor.y));
            const newDist = Math.hypot(world.x - anchor.x, world.y - anchor.y);
            const sf = newDist / origDist;
            frag.points = origPts.map((p) => ({ x: anchor.x + (p.x - anchor.x) * sf, y: anchor.y + (p.y - anchor.y) * sf }));
            renderScene();
          }
          return;
        }
        if (state.drag.mode === "intarsia-rotate") {
          const frag = state.drag.intarsiaFragObj;
          const origPts = state.drag.intarsiaOrigPts;
          const bCx = state.drag.intarsiaBCx, bCy = state.drag.intarsiaBCy;
          const startAngle = state.drag.intarsiaStartAngle;
          if (frag && origPts && startAngle !== undefined) {
            const currentAngle = Math.atan2(world.y - bCy, world.x - bCx);
            let delta = currentAngle - startAngle;
            if (state.keys && state.keys.shift) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12);
            const cos = Math.cos(delta), sin = Math.sin(delta);
            frag.points = origPts.map((p) => ({
              x: bCx + (p.x - bCx) * cos - (p.y - bCy) * sin,
              y: bCy + (p.x - bCx) * sin + (p.y - bCy) * cos
            }));
            renderScene();
          }
          return;
        }

        if (!state.drag.isDown) {
          // Intarsia handle hover cursors
          if (state.tool === "select" && state.intarsiaHandles) {
            const ih = state.intarsiaHandles;
            const vscale = state.viewport.scale || 1;
            const hitR = 9 / vscale;
            const rh = ih.rotHandleWorld;
            if (rh && Math.hypot(world.x - rh.x, world.y - rh.y) <= hitR) {
              setWorkspaceCursor("grab");
            } else {
              let cornerHit = null;
              for (let ci = 0; ci < ih.corners.length; ci++) {
                const c = ih.corners[ci];
                if (Math.hypot(world.x - c.x, world.y - c.y) <= hitR) { cornerHit = c; break; }
              }
              if (cornerHit) setWorkspaceCursor(cornerHit.cursor);
              else if (!state.keys.space) setWorkspaceCursor("");
            }
          }
          const tool = String(state.tool || "");
          const hover = state.hover && typeof state.hover === "object" ? state.hover : (state.hover = {});
          let changed = false;
          let nextZoneId = null;
          let nextVertexIndex = null;
          let nextEdgeInsertIndex = null;
          let nextEdgePoint = null;
          if (tool === "edit-vertex" || tool === "smooth-vertex" || tool === "curve-vertex") {
            const hv = findVertexAt(world);
            if (hv) {
              nextZoneId = Number(hv.zone && hv.zone.id || 0) || null;
              nextVertexIndex = Number(hv.vertexIndex);
            }
          } else if (tool === "add-vertex") {
            const hz = findZoneAt(world);
            const targetZone = state.zones.find((z) => Number(z && z.id || 0) === Number(state.selectedZoneId || 0)) || hz || null;
            const edgeHit = targetZone ? findClosestZoneEdgePoint(targetZone, world) : null;
            if (edgeHit) {
              nextZoneId = Number(edgeHit.zone && edgeHit.zone.id || 0) || null;
              nextEdgeInsertIndex = Number(edgeHit.insertIndex);
              nextEdgePoint = { x: Number(edgeHit.point.x), y: Number(edgeHit.point.y) };
            }
          }
          if (Number(hover.zoneId || 0) !== Number(nextZoneId || 0)) changed = true;
          if (Number(hover.vertexIndex) !== Number(nextVertexIndex)) changed = true;
          if (Number(hover.edgeInsertIndex) !== Number(nextEdgeInsertIndex)) changed = true;
          const prevEdgePoint = hover.edgePoint && typeof hover.edgePoint === "object" ? hover.edgePoint : null;
          if (!!prevEdgePoint !== !!nextEdgePoint) changed = true;
          else if (prevEdgePoint && nextEdgePoint && (Math.abs(Number(prevEdgePoint.x) - Number(nextEdgePoint.x)) > 1e-6 || Math.abs(Number(prevEdgePoint.y) - Number(nextEdgePoint.y)) > 1e-6)) changed = true;
          if (changed) {
            hover.zoneId = nextZoneId;
            hover.vertexIndex = nextVertexIndex;
            hover.edgeInsertIndex = nextEdgeInsertIndex;
            hover.edgePoint = nextEdgePoint;
            renderScene();
          }
          // §3.9.1 Precision Aids — hover coords + BoundaryRef status
          if (tool === "edit-vertex" || tool === "curve-vertex" || tool === "add-vertex") {
            const hZone = nextZoneId ? (state.zones || []).find((z) => Number(z && z.id || 0) === nextZoneId) : null;
            const hPt = (hZone && Number.isFinite(nextVertexIndex) && nextVertexIndex >= 0) ? hZone.points[nextVertexIndex] : (nextEdgePoint || world);
            let boundaryType = null;
            if (hZone && Number.isFinite(nextVertexIndex) && nextVertexIndex >= 0) {
              if (isZoneVertexOnDetailBoundary(hZone, nextVertexIndex)) boundaryType = "partBoundary";
              else if (isZoneVertexOnSharedBoundary(hZone, nextVertexIndex)) boundaryType = "sharedBoundary";
              else boundaryType = "interior";
            }
            const links = (boundaryType === "sharedBoundary" && hZone && Number.isFinite(nextVertexIndex))
              ? findSharedBoundaryVertexLinks(hZone, nextVertexIndex, 10)
              : [];
            setPrecisionAid({
              tool,
              zoneId: nextZoneId,
              ring: "outer",
              vertexIndex: Number.isFinite(nextVertexIndex) && nextVertexIndex >= 0 ? nextVertexIndex : undefined,
              x: hPt ? hPt.x : world.x,
              y: hPt ? hPt.y : world.y,
              boundaryType,
              affectedCount: boundaryType === "sharedBoundary" ? links.length + 1 : undefined
            });
          } else {
            setPrecisionAid({ x: world.x, y: world.y });
          }
          return;
        }
        if (state.drag.mode === "pan") {
          const dx = p.x - state.drag.startX;
          const dy = p.y - state.drag.startY;
          state.viewport.offsetX = state.drag.startOffsetX + dx;
          state.viewport.offsetY = state.drag.startOffsetY - dy;
          renderScene();
          return;
        }
        if (state.drag.mode === "curve-handle") {
          const vec = state.drag.curveHandleVec;
          const center = state.drag.curveHandleCenter;
          const minLen = state.drag.curveHandleMinLen;
          if (!vec || !center || !(minLen > 0)) return;
          const dx = world.x - center.x;
          const dy = world.y - center.y;
          const projection = Math.max(0, dx * vec.x + dy * vec.y);
          const nextStrength = Math.max(0.08, Math.min(0.48, projection / Math.max(1e-6, minLen)));
          if (applyCurveEditPreview(nextStrength)) {
            setWorkspaceInfo(`Кривизна: ${nextStrength.toFixed(2)}`);
            renderCurvePreview();
          }
          return;
        }
        if (state.drag.mode === "move-vertex") {
          const z = state.zones.find((x) => x.id === state.drag.movingZoneId);
          if (!z) return;
          const linkedMoves = Array.isArray(state.drag.sharedLinkedVertices) ? state.drag.sharedLinkedVertices : [];
          // CONTRACT §3.2: shared boundary must move synchronously.
          // If sharedBoundaryLock but no linked sibling found → block (shared_boundary_mismatch).
          if (state.drag.sharedBoundaryLock && linkedMoves.length === 0) {
            setWorkspaceInfo("shared_boundary_mismatch: общая граница зон должна редактироваться синхронно.");
            return;
          }
          let nextPoint = world;
          const detailBoundary = getDetailBoundaryPointsForZone(z);
          if (state.drag.slideAlongPartContour && detailBoundary.length >= 3) {
            // sharedBoundaryEndpoint: всегда проецируем на контур детали
            const projected = projectPointToBoundary(detailBoundary, world);
            if (projected) nextPoint = { x: projected.x, y: projected.y };
          } else if (detailBoundary.length >= 3 && !pointInPolygon(nextPoint, detailBoundary)) {
            // Interior point dragged outside detail — clamp to boundary
            const projected = projectPointToBoundary(detailBoundary, nextPoint);
            if (projected) {
              nextPoint = { x: projected.x, y: projected.y };
            }
          }
          const origPt = z.points[state.drag.movingVertexIndex];
          z.points[state.drag.movingVertexIndex] = nextPoint;
          const geomLib = window.FurLabGeom;
          if (geomLib && typeof geomLib.polygonHasSelfIntersection === "function" && geomLib.polygonHasSelfIntersection(z.points)) {
            z.points[state.drag.movingVertexIndex] = origPt;
            setWorkspaceInfo("Нельзя: зона самопересекается.");
            return;
          }
          const linkedOrigPts = [];
          for (const linked of linkedMoves) {
            const sibling = state.zones.find((item) => Number(item && item.id || 0) === Number(linked.zoneId || 0)) || null;
            if (!sibling) continue;
            const lp = getLinkedPoint(sibling, linked);
            linkedOrigPts.push({ sibling, linked, origPt: lp ? { x: lp.x, y: lp.y } : null });
            setLinkedPoint(sibling, linked, nextPoint);
          }
          // Partition gate: если перемещение создаёт зазор/перекрытие — откат
          if (state.drag.sharedBoundaryLock && linkedMoves.length > 0) {
            const partIssues = validatePartZonePartition(z);
            const partErrors = partIssues.filter((i) => String(i.severity || "") === "error");
            if (partErrors.length > 0) {
              z.points[state.drag.movingVertexIndex] = origPt;
              for (const { sibling, linked, origPt: lOrig } of linkedOrigPts) {
                if (lOrig) setLinkedPoint(sibling, linked, lOrig);
              }
              setWorkspaceInfo("Нельзя: нарушается разбиение зон (" + (partErrors[0].code || "gap/overlap") + ").");
              return;
            }
          }
          renderScene();
          if (state.drag.sharedBoundaryLock && linkedMoves.length > 0) setWorkspaceInfo("Общая вершина зон двигается связно.");
          else if (detailBoundary.length >= 3 && !pointInPolygon(world, detailBoundary)) setWorkspaceInfo("[part_boundary_locked] Точка ограничена контуром детали.");
          else setWorkspaceInfo("");
          // §3.9.1 Precision Aids — drag delta
          {
            const orig = state.drag.movingOldPoint;
            setPrecisionAid({
              tool: "edit-vertex",
              zoneId: state.drag.movingZoneId,
              vertexIndex: state.drag.movingVertexIndex,
              x: nextPoint.x,
              y: nextPoint.y,
              dx: orig ? nextPoint.x - orig.x : undefined,
              dy: orig ? nextPoint.y - orig.y : undefined,
              boundaryType: state.drag.sharedBoundaryLock ? "sharedBoundary" : undefined,
              affectedCount: state.drag.sharedBoundaryLock ? linkedMoves.length + 1 : undefined
            });
          }
          return;
        }
        if (state.drag.mode === "draw-rect" || state.drag.mode === "draw-ellipse") {
          const start = state.drag.drawShapeStart;
          if (!start) return;
          state.draftZone = state.drag.mode === "draw-rect"
            ? buildRectZonePoints(start, world)
            : buildEllipseZonePoints(start, world, 36);
          renderScene();
          return;
        }
        if (state.drag.mode === "manual-piece-move") {
          const cur = screenToWorld(p.x, p.y);
          const from = state.drag.manualPointerStart;
          const startPts = Array.isArray(state.drag.manualPieceStart) ? state.drag.manualPieceStart : null;
          if (!from || !startPts || startPts.length < 3) return;
          const dx = cur.x - from.x;
          const dy = cur.y - from.y;
          const moved = startPts.map((q) => ({ x: q.x + dx, y: q.y + dy }));
          updateManualActivePiecePoints(moved);
          renderScene();
          return;
        }
        if (state.drag.mode === "manual-placement-move") {
          state.drag.manualMoved = true;
          const cur = screenToWorld(p.x, p.y);
          const from = state.drag.manualPointerStart;
          const startPts = Array.isArray(state.drag.manualPlacementStart) ? state.drag.manualPlacementStart : null;
          const idx = Number(state.drag.manualPlacementIndex);
          const placements = Array.isArray(state.layoutRun && state.layoutRun.placements) ? state.layoutRun.placements : [];
          const pl = Number.isFinite(idx) && idx >= 0 && idx < placements.length ? placements[idx] : null;
          if (!from || !startPts || startPts.length < 3 || !pl) return;
          const dx = cur.x - from.x;
          const dy = cur.y - from.y;
          state.drag.manualDragDx = dx;
          state.drag.manualDragDy = dy;
          const snap = state.drag.manualPlacementGeomStart || null;
          if (snap) restorePlacementGeometry(pl, snap);
          translatePlacementGeometry(pl, dx, dy);
          renderScene();
        }
      });

      stage.on("mouseup", () => {
        if (state.drag.mode === "manual-placement-move") {
          const idx = Number(state.drag.manualPlacementIndex);
          if (state.layoutRun && state.layoutRun.manual) state.layoutRun.manual.selectedPlacementIndex = Number.isFinite(idx) ? idx : -1;
          if (state.layoutRun && state.layoutRun.manual) state.layoutRun.manual.statusNote = "кусок перемещён";
          // Commit drag offset to fragments immediately so there's no jitter frame
          // before recomputeInventoryManualVisibility() returns with fresh geometry.
          const finalDx = Number(state.drag.manualDragDx || 0);
          const finalDy = Number(state.drag.manualDragDy || 0);
          const finalScrapPieceId = String(state.drag.manualDragScrapPieceId || "");
          if ((finalDx !== 0 || finalDy !== 0) && finalScrapPieceId && Array.isArray(state.layoutRun && state.layoutRun.fragments)) {
            for (const frag of state.layoutRun.fragments) {
              if (String(frag.scrapPieceId || "") !== finalScrapPieceId) continue;
              if (Array.isArray(frag.points)) frag.points = frag.points.map((q) => ({ x: q.x + finalDx, y: q.y + finalDy }));
              if (Array.isArray(frag.cutPoints)) frag.cutPoints = frag.cutPoints.map((q) => ({ x: q.x + finalDx, y: q.y + finalDy }));
            }
          }
          state.drag.manualDragDx = 0;
          state.drag.manualDragDy = 0;
          state.drag.manualDragScrapPieceId = "";
          try {
            if (state.drag.manualMoved && state.drag.manualPlacementGeomStart) {
              const placements = Array.isArray(state.layoutRun && state.layoutRun.placements) ? state.layoutRun.placements : [];
              const pl = Number.isFinite(idx) && idx >= 0 ? placements[idx] : null;
              if (pl) {
                const geomAfter = snapshotPlacementGeometry(pl);
                onManualPlacementMoved(idx, state.drag.manualPlacementGeomStart, geomAfter);
              }
            }
          } catch (_) {}
          if (typeof recomputeInventoryManualVisibility === "function") {
            void recomputeInventoryManualVisibility();
          }
          renderInventoryManualPanel();
        }
        if (state.drag.mode === "curve-handle") {
          commitCurveEdit();
          renderScene();
        }
        if (state.drag.mode === "move-vertex") {
          const z = state.zones.find((x) => x.id === state.drag.movingZoneId);
          if (z) {
            const idx = state.drag.movingVertexIndex;
            const to = { ...z.points[idx] };
            const from = state.drag.movingOldPoint;
            const linkedMoves = Array.isArray(state.drag.sharedLinkedVertices) ? state.drag.sharedLinkedVertices : [];
            const primaryMoved = !!(from && (from.x !== to.x || from.y !== to.y));

            // Geometry validation: reject if candidate geometry is invalid
            const validationIssues = primaryMoved ? validateZoneGeometry(z) : [];
            const hasErrors = validationIssues.some((i) => i.severity === "error");
            if (hasErrors && primaryMoved && from) {
              // Revert to pre-drag position
              z.points[idx] = { ...from };
              for (const linked of linkedMoves) {
                const sibling = state.zones.find((item) => Number(item && item.id || 0) === Number(linked.zoneId || 0)) || null;
                if (!sibling || !linked.from) continue;
                setLinkedPoint(sibling, linked, linked.from);
              }
              const msg = validationIssues.map((i) => i.message).join("; ");
              setWorkspaceInfo(`Перемещение отменено: ${msg}`);
              renderScene();
            } else {
              // Partition gate: validate that the drag did not break partContour coverage.
              // Uses canonical boundary registered at mousedown — immune to union-fallback trap.
              if (primaryMoved) {
                const partIssues = validatePartZonePartition(z);
                if (partIssues.length > 0) {
                  // Revert vertex to pre-drag position
                  z.points[idx] = { ...from };
                  for (const linked of linkedMoves) {
                    const sibling = state.zones.find((item) => Number(item && item.id || 0) === Number(linked.zoneId || 0)) || null;
                    if (!sibling || !linked.from) continue;
                    setLinkedPoint(sibling, linked, linked.from);
                  }
                  const errCode = (partIssues[0] && (partIssues[0].code || partIssues[0].message)) || "zone_partition_gap";
                  setWorkspaceInfo(`[${errCode}] Нарушение разбиения детали — перемещение отменено`);
                  renderScene();
                  return;
                }
              }
              if (linkedMoves.length > 0) {
                const moves = [
                  { zoneId: Number(z.id || 0) || null, vertexIndex: idx, from, to }
                ];
                for (const linked of linkedMoves) {
                  const sibling = state.zones.find((item) => Number(item && item.id || 0) === Number(linked.zoneId || 0)) || null;
                  if (!sibling) continue;
                  const currentPt = getLinkedPoint(sibling, linked);
                  if (!currentPt) continue;
                  const linkedTo = { x: currentPt.x, y: currentPt.y };
                  const linkedFrom = linked.from && typeof linked.from === "object" ? { ...linked.from } : null;
                  if (linkedFrom && (linkedFrom.x !== linkedTo.x || linkedFrom.y !== linkedTo.y)) {
                    moves.push({
                      zoneId: Number(sibling.id || 0) || null,
                      vertexIndex: linked.vertexIndex,
                      isHoleLink: linked.isHoleLink || false,
                      holeIndex: linked.holeIndex,
                      from: linkedFrom,
                      to: linkedTo
                    });
                  }
                }
                if (moves.some((move) => move.from && (move.from.x !== move.to.x || move.from.y !== move.to.y))) {
                  pushCommand({ type: "move-shared-vertices", moves });
                }
              } else if (primaryMoved) {
                pushCommand({ type: "move-vertex", zoneId: z.id, vertexIndex: idx, from, to });
              }
              if (primaryMoved) {
                onZoneGeometryChanged(z);
                // Invalidate sibling zones whose shared vertices were moved
                for (const linked of linkedMoves) {
                  const sibling = state.zones.find((item) => Number(item && item.id || 0) === Number(linked.zoneId || 0)) || null;
                  if (sibling) onZoneGeometryChanged(sibling);
                }
              }
            }
            state.selectedZoneId = Number(z.id || 0) || state.selectedZoneId;
            state.selectedVertexIndex = Number.isFinite(Number(idx)) ? Number(idx) : state.selectedVertexIndex;
            setVertexDebug("mouseup move-vertex", {
              zoneId: Number(z.id || 0) || null,
              vertexIndex: Number(idx),
              moved: !!(from && (from.x !== to.x || from.y !== to.y)),
              selectedVertexIndex: Number(state.selectedVertexIndex)
            });
          }
        }
        if (state.drag.mode === "intarsia-move" || state.drag.mode === "intarsia-scale" || state.drag.mode === "intarsia-rotate") {
          const frag = state.drag.intarsiaFragObj;
          if (frag) {
            const svgFrag = Array.isArray(state.intarsiaSvgFragments)
              ? state.intarsiaSvgFragments.find((f) => Number(f.id || 0) === Number(frag.id || 0)) : null;
            if (svgFrag) svgFrag.points = frag.points.map((p) => ({ x: p.x, y: p.y }));
          }
          setWorkspaceCursor("");
          renderScene();
        }
        if (state.drag.mode === "draw-rect" || state.drag.mode === "draw-ellipse") {
          if (Array.isArray(state.draftZone) && state.draftZone.length >= 3) {
            void createZoneFromPoints(state.draftZone, { parentZoneId: Number(state.selectedZoneId) || null });
          } else {
            state.draftZone = [];
            renderScene();
          }
        }
        state.drag.isDown = false;
        state.drag.mode = "";
        state.drag.movingZoneId = null;
        state.drag.movingVertexIndex = null;
        state.drag.movingOldPoint = null;
        setPrecisionAid(null);
        state.drag.boundaryLock = false;
        state.drag.sharedBoundaryLock = false;
        state.drag.sharedLinkedVertices = null;
        state.drag.drawShapeStart = null;
        state.drag.manualPointerStart = null;
        state.drag.manualPieceStart = null;
        state.drag.manualPlacementIndex = null;
        state.drag.manualPlacementStart = null;
        state.drag.manualPlacementGeomStart = null;
        if (state.keys.space) setWorkspaceCursor("grab");
        else setWorkspaceCursor("");
        setWorkspaceInfo("");
        if (state.debugVertex && state.debugVertex.enabled && state.debugVertex.last) {
          setWorkspaceInfo(state.debugVertex.last);
        }
        renderScene();
      });

      stage.on("dblclick", () => {
        if (state.tool === "intarsia-pen") {
          if (Array.isArray(state.draftIntarsiaContour) && state.draftIntarsiaContour.length >= 3) {
            if (typeof finishIntarsiaContour === "function") finishIntarsiaContour();
          }
          return;
        }
        if (state.tool !== "draw-zone") return;
        if (state.draftZone.length < 3) return;
        const created = typeof createZoneFromPoints === "function" && createZoneFromPoints(state.draftZone, { parentZoneId: Number(state.selectedZoneId) || null });
        if (created && typeof setWorkspaceTool === "function") setWorkspaceTool("select");
      });
    }

    return { attach };
  }

  global.FurLabStageInteractions = Object.assign({}, global.FurLabStageInteractions || {}, {
    createStageInteractions
  });
})(window);

