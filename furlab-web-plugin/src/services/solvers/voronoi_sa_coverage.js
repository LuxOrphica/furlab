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

    for (const path of (residualSol || [])) {
      const areaMm2 = clipperArea(path);
      residualAreaMm2 += areaMm2;
      let isPerimeterSliver = false;

      // Шаг 1: эрозия САМОЙ ДЫРЫ на -1.5мм — определяет sliver (под-сеточный артефакт).
      // Критерий совпадает с verify_voronoi_sa.py: sliver если эрозия съедает >60% площади дыры
      // (т.е. erodedHoleArea / areaMm2 < SLIVER_ERO_FRAC = 0.40).
      let erodedHoleArea = 0;
      let isSliverByErosion = false;
      const SLIVER_ERO_FRAC = 0.40;
      try {
        const coHole = new ClipperLib.ClipperOffset();
        coHole.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
        const erodedHolePaths = new ClipperLib.Paths();
        coHole.Execute(erodedHolePaths, -Math.round(1.5 * gStep * CLIPPER_SCALE));
        if (erodedHolePaths && erodedHolePaths.length > 0) {
          erodedHoleArea = erodedHolePaths.reduce((s, p) => s + clipperArea(p), 0);
        }
        isSliverByErosion = areaMm2 > 1e-6 ? (erodedHoleArea / areaMm2 < SLIVER_ERO_FRAC) : true;
      } catch (_) {
        isSliverByErosion = false;
      }
      isPerimeterSliver = isSliverByErosion;
      const erosionSurvives = !isSliverByErosion;

      // v5.0 §8 (расширение): растровый шовный артефакт.
      // Дыра может иметь большую площадь, но извилистую форму (fill_ratio < 0.3) —
      // это «змейка» из растровых клеток по швам между кусками. Реальной дыры нет,
      // есть только лесенка дискретизации. Классифицируем как raster-artifact, прощаем.
      let isRasterArtifact = false;
      if (!isPerimeterSliver && areaMm2 > 50) {
        try {
          const holePtsTemp = fromClipper(path);
          const bbTemp = polygonBBox(holePtsTemp);
          const bboxArea = (bbTemp.maxX - bbTemp.minX) * (bbTemp.maxY - bbTemp.minY);
          const fillRatio = bboxArea > 1 ? areaMm2 / bboxArea : 1;
          isRasterArtifact = fillRatio < 0.3;
        } catch (_) {
          isRasterArtifact = false;
        }
      }
      // Если это raster-artifact — относим к sliver (прощается, не считается в residual),
      // но в classification помечаем отдельно для диагностики.
      if (isRasterArtifact) {
        isPerimeterSliver = true;
      }

      // Шаг 2: для не-sliver дыры — классификация interior vs edge по расстоянию до границы зоны.
      // Используем bbox-проверку: если bbox дыры целиком внутри зоны с отступом INTERIOR_DIST → interior.
      // Иначе (касается или близко к границе) → edge.
      const holePts = fromClipper(path);
      const holeBbox = polygonBBox(holePts);
      let isInterior = false;
      if (!isPerimeterSliver) {
        // Быстрая bbox-проверка: если bbox дыры дальше INTERIOR_DIST от bbox зоны — interior.
        // Это приближение, но для большинства случаев работает.
        const zoneBb = polygonBBox(zonePoints);
        if (zoneBb && holeBbox) {
          const distMinX = holeBbox.minX - zoneBb.minX;
          const distMaxX = zoneBb.maxX - holeBbox.maxX;
          const distMinY = holeBbox.minY - zoneBb.minY;
          const distMaxY = zoneBb.maxY - holeBbox.maxY;
          // Если хотя бы одна сторона bbox дыры ближе INTERIOR_DIST к bbox зоны — edge.
          // Но bbox зоны >= bbox дыры, поэтому dist'ы должны быть > INTERIOR_DIST.
          // Это верхняя оценка: может пропустить edge-дыру как interior, но не наоборот.
          // Для надёжности используем более строгий тест: хотя бы одна вершина дыры ближе INTERIOR_DIST к zone boundary.
          // Полигон-тест дороже; используем Clipper: расширяем зону внутрь на INTERIOR_DIST, проверяем включение дыры.
          try {
            const co2 = new ClipperLib.ClipperOffset();
            co2.AddPath(zonePathClipper, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
            const interiorZone = new ClipperLib.Paths();
            co2.Execute(interiorZone, -Math.round(INTERIOR_DIST_MM * CLIPPER_SCALE));
            // Если дыра (path) целиком внутри interiorZone → interior.
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
            const testArea = testSol.reduce((s, p) => s + clipperArea(p), 0);
            isInterior = testArea >= areaMm2 * 0.99; // 99% площади дыры внутри interiorZone
          } catch (_) {
            isInterior = false;
          }
        }
      }

      if (isPerimeterSliver) {
        // Sliver = эрозия схлопывает (sub-сеточный артефакт). В residualInteriorMm2 и residualPerimeterMm2
        // НЕ включаем — это прощаемый под-сеточный мусор (v5.0 §8).
        // Считаем только в residualAreaMm2 (raw total).
      } else if (isInterior) {
        residualInteriorMm2 += areaMm2;
      } else {
        // edge-дыра (не sliver, но касается/близко к границе зоны)
        residualPerimeterMm2 += areaMm2;
      }
      if (areaMm2 < 1) continue;

      const pts = holePts;
      const bb = holeBbox;
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
        isPerimeterSliver,
        // v5.0 §4 + §8: классификация дыры — sliver / raster-artifact / interior / edge.
        classification: isRasterArtifact ? "raster-artifact"
          : (isPerimeterSliver ? "sliver" : (isInterior ? "interior" : "edge"))
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
