(function (global) {
  "use strict";

  function asContour(points) {
    return Array.isArray(points) && points.length >= 3 ? points : [];
  }

  function asContours(contours, single) {
    const out = [];
    for (const contour of Array.isArray(contours) ? contours : []) {
      const pts = asContour(contour);
      if (pts.length >= 3) out.push(pts);
    }
    if (out.length > 0) return out;
    const pts = asContour(single);
    return pts.length >= 3 ? [pts] : [];
  }

  function isTechnicalResidual(c) {
    const cls = String(c && c.classification || "");
    return !!(c && c.isPerimeterSliver) || cls === "raster-artifact" || cls === "edge-line-artifact";
  }

  function mapRenderItems(res) {
    const items = Array.isArray(res && res.render && res.render.items) ? res.render.items : [];
    return items.map((item) => ({
      scrapPieceId: String(item.id || ""),
      inventoryTag: String(item.meta && item.meta.inventoryTag || item.id || ""),
      status: String(item.meta && item.meta.status || "matched"),
      alignedContour: Array.isArray(item.contour) ? item.contour : [],
      rawTerritoryContours: asContours(item.rawTerritoryContours, item.rawTerritoryContour),
      rawTerritoryContour: asContour(item.rawTerritoryContour),
      inZoneContour: asContour(item.inZoneContour).length >= 3 ? item.inZoneContour : (Array.isArray(item.contour) ? item.contour : []),
      inZoneContours: asContours(item.inZoneContours, item.inZoneContour),
      alignedCoreContour: asContour(item.alignedCoreContour),
      inZoneCoreContour: asContour(item.inZoneCoreContour),
      inZoneCoreContours: asContours(item.inZoneCoreContours, item.inZoneCoreContour),
      phase: String(item.meta && item.meta.phase || "SA"),
      inZoneAreaMm2: Number(item.meta && item.meta.inZoneAreaMm2 || 0),
      bodyAreaMm2: Number(item.meta && item.meta.bodyAreaMm2 || 0),
      utilization: Number(item.meta && item.meta.utilization || 0),
      lowUtilization: !!(item.meta && item.meta.lowUtilization),
      physicalMissingMm2: item.meta && item.meta.physicalMissingMm2 != null ? Number(item.meta.physicalMissingMm2) : 0,
      isTerritoryPlaceholder: !!(item.meta && item.meta.isTerritoryPlaceholder),
      solveOrder: Number(item.renderIndex || 0) + 1,
      solveIndex: Number(item.renderIndex || 0),
      renderIndex: Number(item.renderIndex || 0)
    }));
  }

  function buildCoreContours(placements) {
    const out = [];
    for (const p of (Array.isArray(placements) ? placements : [])) {
      if (p.isTerritoryPlaceholder) continue;
      const contours = asContours(p.inZoneCoreContours, p.inZoneCoreContour);
      for (const c of contours) out.push(c);
    }
    return out;
  }

  function buildFragments(placements, zone) {
    const fragments = [];
    for (const [idx, p] of (Array.isArray(placements) ? placements : []).entries()) {
      // Канва рисует ФРАГМЕНТЫ (регуляризованную геометрию кроя): territory-контуры
      // грязны по природе (иглы, мультичасти) и в контракт кроя не входят — попытка
      // рисовать их дала «иглы и разделение ядер» на канве при чистых фрагментах.
      // Щели между соседями ≤ допуска реза — честные волоски.
      const contours = asContours(p.inZoneCoreContours, p.inZoneCoreContour);
      for (let ci = 0; ci < contours.length; ci++) {
        const fragPts = contours[ci];
        fragments.push({
          id: fragments.length + 1,
          ownerPlacementIndex: idx,
          ownerPlacementId: idx + 1,
          inventoryTag: p.inventoryTag || p.scrapPieceId || "",
          points: fragPts,
          cutPoints: fragPts,
          areaMm2: 0,
          zoneId: Number(zone && zone.id || 0) || null,
          componentIndex: ci
        });
      }
    }
    return fragments;
  }

  function pointInPoly(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = Number(poly[i].x), yi = Number(poly[i].y);
      const xj = Number(poly[j].x), yj = Number(poly[j].y);
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function buildSeams(fragments, zone, helpers) {
    const seamApi = global.FurLabSeams;
    if (!seamApi || !Array.isArray(fragments) || fragments.length < 2) return [];
    const segs = seamApi.computeSeamSegmentsFromAppliedFragments(fragments, { minLenMm: 3, tolDistMm: 2.5, tolParallel: 0.35 });
    const holeContour = helpers && helpers.holeContour;
    const holeContours = Array.isArray(zone && zone.holes) && typeof holeContour === "function"
      ? zone.holes.map(holeContour).filter((h) => h.length >= 3)
      : [];
    const seamInHole = (s, hc) => {
      const pts = Array.isArray(s && s.points) ? s.points : [];
      if (pts.length < 2) return false;
      const p1 = pts[0], p2 = pts[pts.length - 1];
      const pm = { x: (Number(p1.x) + Number(p2.x)) * 0.5, y: (Number(p1.y) + Number(p2.y)) * 0.5 };
      return pointInPoly(pm.x, pm.y, hc) || pointInPoly(Number(p1.x), Number(p1.y), hc) || pointInPoly(Number(p2.x), Number(p2.y), hc);
    };
    return (Array.isArray(segs) ? segs : []).filter((s) => {
      if (seamApi.seamOnZoneBoundary(s, zone && zone.points, 1.6)) return false;
      if (holeContours.some((hc) => seamInHole(s, hc) || seamApi.seamOnZoneBoundary(s, hc, 4.0))) return false;
      return true;
    });
  }

  function buildPreviewModel(args) {
    const res = args && args.res;
    const zone = args && args.zone;
    const helpers = args && args.helpers || {};
    const placements = mapRenderItems(res);
    const coreContours = buildCoreContours(placements);
    const serverUncovered = Array.isArray(res && res.uncoveredComponents) ? res.uncoveredComponents : [];
    const coverageHoles = serverUncovered.length > 0
      ? serverUncovered
          .filter((c) => !isTechnicalResidual(c) && (c.areaMm2 || 0) >= 9)
          .map((c) => c.pts || c.points || [])
          .filter((p) => Array.isArray(p) && p.length >= 3)
      : (typeof helpers.computeCoverageHolesForZone === "function"
          ? helpers.computeCoverageHolesForZone(zone, coreContours)
          : []);
    const fragments = buildFragments(placements, zone);
    const clippedFragments = typeof helpers.clipFragmentsByZoneDomain === "function"
      ? helpers.clipFragmentsByZoneDomain(fragments, zone)
      : fragments;
    const seams = buildSeams(fragments, zone, helpers);
    const trace = res && res.algorithmTrace && typeof res.algorithmTrace === "object" ? res.algorithmTrace : null;
    const covRatio = Number(res && res.stats && res.stats.coveredRatio || 0);
    return {
      placements,
      coreContours,
      coverageHoles,
      pieceIntersections: [],
      fragments,
      clippedFragments,
      seams,
      effectiveOptions: (trace && trace.effectiveOptions) || (args && args.effectiveOptionsFallback) || {},
      covPct: (covRatio * 100).toFixed(1),
      nPlacements: placements.length
    };
  }

  global.FurLabInventoryVoronoiSa = {
    buildPreviewModel
  };
})(window);
