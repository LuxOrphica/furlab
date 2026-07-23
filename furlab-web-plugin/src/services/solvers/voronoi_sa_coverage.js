"use strict";

const ClipperLib = require("clipper-lib");

const CLIPPER_SCALE = 1000;

function createVoronoiSaCoverage(deps) {
  const pointsToMultiPolygon = deps && deps.pointsToMultiPolygon;
  const intersectMulti = deps && deps.intersectMulti;
  const diffMulti = deps && deps.diffMulti;
  const unionMulti = deps && deps.unionMulti;
  const multiPolygonArea = deps && deps.multiPolygonArea;
  const polygonBBox = deps && typeof deps.polygonBBox === "function"
    ? deps.polygonBBox
    : (pts) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of (Array.isArray(pts) ? pts : [])) {
        minX = Math.min(minX, Number(p.x));
        minY = Math.min(minY, Number(p.y));
        maxX = Math.max(maxX, Number(p.x));
        maxY = Math.max(maxY, Number(p.y));
      }
      return { minX, minY, maxX, maxY };
    };

  function toClipper(pts) {
    return pts.map((p) => ({
      X: Math.round(Number(p.x) * CLIPPER_SCALE),
      Y: Math.round(Number(p.y) * CLIPPER_SCALE)
    }));
  }

  function fromClipper(path) {
    return path.map((p) => ({ x: p.X / CLIPPER_SCALE, y: p.Y / CLIPPER_SCALE }));
  }

  function clipperArea(path) {
    return Math.abs(ClipperLib.Clipper.Area(path)) / (CLIPPER_SCALE * CLIPPER_SCALE);
  }

  function validContour(pts) {
    return Array.isArray(pts) && pts.length >= 3;
  }

  function placementCoverageContours(rp) {
    if (!rp || rp.phase === "dissolved") return [];
    if (Array.isArray(rp.inZoneContours) && rp.inZoneContours.length > 0) {
      return rp.inZoneContours.filter(validContour);
    }
    if (validContour(rp.inZoneContour)) return [rp.inZoneContour];
    if (Array.isArray(rp.inZoneCoreContours) && rp.inZoneCoreContours.length > 0) {
      return rp.inZoneCoreContours.filter(validContour);
    }
    if (validContour(rp.inZoneCoreContour)) return [rp.inZoneCoreContour];
    return [];
  }

  function emptyCoverage(zoneArea) {
    return {
      coveredRatio: 0,
      residualAreaMm2: zoneArea,
      residualPerimeterMm2: 0,
      residualInteriorMm2: zoneArea,
      uncoveredComponents: []
    };
  }

  function computeGeomResidual(placements, zoneMp) {
    let coveredMp = [];
    for (const pl of (Array.isArray(placements) ? placements : [])) {
      if (!pl.corePts || pl.corePts.length < 3) continue;
      if (!pl.mask || !pl.mask.some((v) => v > 0)) continue;
      try {
        const inter = intersectMulti(pointsToMultiPolygon(pl.corePts), zoneMp);
        if (inter && inter.length > 0) coveredMp = unionMulti(coveredMp, inter);
      } catch (_) {}
    }
    const zoneArea = multiPolygonArea(zoneMp);
    if (coveredMp.length === 0) return zoneArea;
    try {
      return multiPolygonArea(diffMulti(zoneMp, coveredMp));
    } catch (_) {
      return zoneArea;
    }
  }

  function computeResidualCoverage(resultPlacements, zonePoints, zoneArea, gridStepMm, dissolvedPlacements) {
    const gStep = Math.max(1, Number(gridStepMm) || 3);
    const cprUnion = new ClipperLib.Clipper();
    let anyAdded = false;

    for (const rp of (Array.isArray(resultPlacements) ? resultPlacements : [])) {
      // v5.1.2: polygonal SA can produce a multi-component fragment for one
      // physical scrap. All components are coverage geometry; the single
      // inZoneContour field is only the legacy largest component.
      const contours = placementCoverageContours(rp);
      for (const fragPts of contours) {
        const fragPath = toClipper(fragPts);
        if (Math.abs(ClipperLib.Clipper.Area(fragPath)) < 1) continue;
        cprUnion.AddPath(fragPath, ClipperLib.PolyType.ptSubject, true);
        anyAdded = true;
      }
    }

    if (!anyAdded) return emptyCoverage(zoneArea);

    const unionSol = new ClipperLib.Paths();
    cprUnion.Execute(
      ClipperLib.ClipType.ctUnion,
      unionSol,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero
    );
    if (!unionSol || !unionSol.length) return emptyCoverage(zoneArea);

    const cprDiff = new ClipperLib.Clipper();
    cprDiff.AddPath(toClipper(zonePoints), ClipperLib.PolyType.ptSubject, true);
    for (const path of unionSol) cprDiff.AddPath(path, ClipperLib.PolyType.ptClip, true);
    const residualSol = new ClipperLib.Paths();
    cprDiff.Execute(
      ClipperLib.ClipType.ctDifference,
      residualSol,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero
    );

    // v5.0 §4: эрозия САМОЙ ДЫРЫ (а не зоны) определяет sliver.
    // Зона больше не эродируется — это было источником ошибки классификации.
    let residualAreaMm2 = 0;
    let residualPerimeterMm2 = 0;
    let residualInteriorMm2 = 0;
    const uncoveredComponents = [];

    // v5.0 §4: классификация interior/edge по расстоянию до границы зоны (как в verify_voronoi_sa.py).
    // Дыра — interior если её центр (или любая точка) находится дальше INTERIOR_DIST от границы зоны.
    // Это устраняет завышение residualInteriorMm2 краевыми дырами.
    const INTERIOR_DIST_MM = 2.0;
    // zonePathClipper нужен для расчёта расстояния до границы (через Clipper).
    const zonePathClipper = toClipper(zonePoints);

    // v5.6 СТРОГИЙ РЕЖИМ (решение пользователя 2026-07-19: «фрагменты примыкают
    // вплотную, щели недопустимы, никаких допусков»). Прощается ТОЛЬКО вычислительный
    // мусор булевой геометрии — компоненты, схлопывающиеся эрозией 0.15мм (ширина
    // < ~0.3мм). Прежние классы прощения (sliver-по-эрозии, raster-artifact,
    // edge-line-artifact, потолки площади) удалены как самооправдание слабостей
    // генератора: любой реальный остаток — честный дефект interior/edge.
    const NUMERIC_NOISE_EROSION_MM = 0.15;
    const isNumericNoise = (path) => {
      try {
        const co = new ClipperLib.ClipperOffset(2, 0.25 * CLIPPER_SCALE);
        co.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
        const er = new ClipperLib.Paths();
        co.Execute(er, -Math.round(NUMERIC_NOISE_EROSION_MM * CLIPPER_SCALE));
        if (!er || !er.length) return true;
        return er.reduce((sum, p) => sum + clipperArea(p), 0) < 0.5;
      } catch (_) {
        return false;
      }
    };

    for (const path of (residualSol || [])) {
      const areaMm2 = clipperArea(path);
      residualAreaMm2 += areaMm2;
      // Вычислительный мусор — не дефект и не компонента.
      if (isNumericNoise(path)) continue;

      const holePts = fromClipper(path);
      const holeBbox = polygonBBox(holePts);

      // interior vs edge по расстоянию до границы зоны: дыра целиком внутри зоны,
      // эродированной на INTERIOR_DIST → interior; иначе — edge.
      let isInterior = false;
      try {
        const co2 = new ClipperLib.ClipperOffset();
        co2.AddPath(zonePathClipper, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
        const interiorZone = new ClipperLib.Paths();
        co2.Execute(interiorZone, -Math.round(INTERIOR_DIST_MM * CLIPPER_SCALE));
        const cprTest = new ClipperLib.Clipper();
        cprTest.AddPath(path, ClipperLib.PolyType.ptSubject, true);
        for (const ep of interiorZone) cprTest.AddPath(ep, ClipperLib.PolyType.ptClip, true);
        const testSol = new ClipperLib.Paths();
        cprTest.Execute(
          ClipperLib.ClipType.ctIntersection,
          testSol,
          ClipperLib.PolyFillType.pftNonZero,
          ClipperLib.PolyFillType.pftNonZero
        );
        const testArea = testSol.reduce((sum, p) => sum + clipperArea(p), 0);
        isInterior = testArea >= areaMm2 * 0.99;
      } catch (_) {
        isInterior = false;
      }

      if (isInterior) residualInteriorMm2 += areaMm2;
      else residualPerimeterMm2 += areaMm2;

      if (areaMm2 < 1) continue;
      let sx = 0, sy = 0;
      for (const p of holePts) {
        sx += p.x;
        sy += p.y;
      }
      uncoveredComponents.push({
        areaMm2: Math.round(areaMm2),
        bbox: { minX: holeBbox.minX, minY: holeBbox.minY, maxX: holeBbox.maxX, maxY: holeBbox.maxY },
        centroid: { x: sx / holePts.length, y: sy / holePts.length },
        pts: holePts,
        isPerimeterSliver: false,
        classification: isInterior ? "interior" : "edge"
      });
    }

    uncoveredComponents.sort((a, b) => b.areaMm2 - a.areaMm2);
    attachDissolvedOverlaps(uncoveredComponents, dissolvedPlacements);

    return {
      coveredRatio: zoneArea > 0 ? Math.max(0, Math.min(1, 1 - residualAreaMm2 / zoneArea)) : 0,
      residualAreaMm2,
      residualPerimeterMm2: Math.round(residualPerimeterMm2),
      residualInteriorMm2: Math.round(residualInteriorMm2),
      uncoveredComponents,
      dissolvedTotal: Array.isArray(dissolvedPlacements)
        ? dissolvedPlacements.filter((rp) => Array.isArray(rp.inZoneContour) && rp.inZoneContour.length >= 3).length
        : 0
    };
  }

  function attachDissolvedOverlaps(uncoveredComponents, dissolvedPlacements) {
    const dissolvedWithContour = Array.isArray(dissolvedPlacements)
      ? dissolvedPlacements.filter((rp) => Array.isArray(rp.inZoneContour) && rp.inZoneContour.length >= 3)
      : [];
    if (!dissolvedWithContour.length) {
      for (const comp of uncoveredComponents) comp.dissolvedOverlap = [];
      return;
    }

    for (const comp of uncoveredComponents) {
      const overlaps = [];
      for (const rp of dissolvedWithContour) {
        const rpPath = toClipper(rp.inZoneContour);
        const rpArea = clipperArea(rpPath);
        if (rpArea < 1) continue;
        let rpMinX = Infinity, rpMinY = Infinity, rpMaxX = -Infinity, rpMaxY = -Infinity;
        for (const pt of rp.inZoneContour) {
          if (pt.x < rpMinX) rpMinX = pt.x;
          if (pt.x > rpMaxX) rpMaxX = pt.x;
          if (pt.y < rpMinY) rpMinY = pt.y;
          if (pt.y > rpMaxY) rpMaxY = pt.y;
        }
        if (
          rpMaxX < comp.bbox.minX || rpMinX > comp.bbox.maxX ||
          rpMaxY < comp.bbox.minY || rpMinY > comp.bbox.maxY
        ) continue;

        const holeBboxPath = [
          { X: Math.round(comp.bbox.minX * CLIPPER_SCALE), Y: Math.round(comp.bbox.minY * CLIPPER_SCALE) },
          { X: Math.round(comp.bbox.maxX * CLIPPER_SCALE), Y: Math.round(comp.bbox.minY * CLIPPER_SCALE) },
          { X: Math.round(comp.bbox.maxX * CLIPPER_SCALE), Y: Math.round(comp.bbox.maxY * CLIPPER_SCALE) },
          { X: Math.round(comp.bbox.minX * CLIPPER_SCALE), Y: Math.round(comp.bbox.maxY * CLIPPER_SCALE) }
        ];
        try {
          const ci = new ClipperLib.Clipper();
          ci.AddPath(holeBboxPath, ClipperLib.PolyType.ptSubject, true);
          ci.AddPath(rpPath, ClipperLib.PolyType.ptClip, true);
          const iSol = new ClipperLib.Paths();
          ci.Execute(
            ClipperLib.ClipType.ctIntersection,
            iSol,
            ClipperLib.PolyFillType.pftNonZero,
            ClipperLib.PolyFillType.pftNonZero
          );
          const iArea = iSol.reduce((s, p) => s + clipperArea(p), 0);
          if (iArea >= 1) overlaps.push({ id: rp.scrapPieceId || rp.inventoryTag || "?", areaMm2: Math.round(iArea) });
        } catch (_) {}
      }
      overlaps.sort((a, b) => b.areaMm2 - a.areaMm2);
      comp.dissolvedOverlap = overlaps;
    }
  }

  return { computeResidualCoverage, computeGeomResidual };
}

module.exports = { createVoronoiSaCoverage };
