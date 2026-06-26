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
      if (rp.phase === "dissolved") continue;
      const corePts = Array.isArray(rp.inZoneCoreContour) && rp.inZoneCoreContour.length >= 3
        ? rp.inZoneCoreContour
        : [];
      if (corePts.length < 3) continue;
      const corePath = toClipper(corePts);
      if (Math.abs(ClipperLib.Clipper.Area(corePath)) < 1) continue;
      cprUnion.AddPath(corePath, ClipperLib.PolyType.ptSubject, true);
      anyAdded = true;
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

    const erodeDelta = -Math.round(1.5 * gStep * CLIPPER_SCALE);
    const co = new ClipperLib.ClipperOffset();
    co.AddPath(toClipper(zonePoints), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const erodedPaths = new ClipperLib.Paths();
    co.Execute(erodedPaths, erodeDelta);
    const hasEroded = erodedPaths && erodedPaths.length > 0;

    let residualAreaMm2 = 0;
    let residualPerimeterMm2 = 0;
    let residualInteriorMm2 = 0;
    const uncoveredComponents = [];

    for (const path of (residualSol || [])) {
      const areaMm2 = clipperArea(path);
      residualAreaMm2 += areaMm2;
      let isPerimeterSliver = false;

      if (hasEroded) {
        try {
          const cprIn = new ClipperLib.Clipper();
          cprIn.AddPath(path, ClipperLib.PolyType.ptSubject, true);
          for (const ep of erodedPaths) cprIn.AddPath(ep, ClipperLib.PolyType.ptClip, true);
          const interSol = new ClipperLib.Paths();
          cprIn.Execute(
            ClipperLib.ClipType.ctIntersection,
            interSol,
            ClipperLib.PolyFillType.pftNonZero,
            ClipperLib.PolyFillType.pftNonZero
          );
          const insideAreaMm2 = interSol.reduce((s, p) => s + clipperArea(p), 0);
          isPerimeterSliver = insideAreaMm2 / areaMm2 < 0.5;
        } catch (_) {
          isPerimeterSliver = false;
        }
      }

      if (isPerimeterSliver) residualPerimeterMm2 += areaMm2;
      else residualInteriorMm2 += areaMm2;
      if (areaMm2 < 1) continue;

      const pts = fromClipper(path);
      const bb = polygonBBox(pts);
      let sx = 0, sy = 0;
      for (const p of pts) {
        sx += p.x;
        sy += p.y;
      }
      uncoveredComponents.push({
        areaMm2: Math.round(areaMm2),
        bbox: { minX: bb.minX, minY: bb.minY, maxX: bb.maxX, maxY: bb.maxY },
        centroid: { x: sx / pts.length, y: sy / pts.length },
        pts,
        isPerimeterSliver
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
