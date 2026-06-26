"use strict";

const ClipperLib = require("clipper-lib");

const SCALE = 1000;

function toClipper(pts) {
  return pts.map((p) => ({
    X: Math.round(Number(p.x) * SCALE),
    Y: Math.round(Number(p.y) * SCALE)
  }));
}

function areaOfPaths(paths) {
  // Use signed sum: outer rings positive, holes negative → correct net area.
  const signed = (Array.isArray(paths) ? paths : [])
    .reduce((sum, path) => sum + ClipperLib.Clipper.Area(path) / (SCALE * SCALE), 0);
  return Math.abs(signed);
}

function computeAbsorptionDiagnostic(args) {
  const uncoveredComponents = Array.isArray(args && args.uncoveredComponents) ? args.uncoveredComponents : [];
  const placements = Array.isArray(args && args.placements) ? args.placements : [];
  const spec = args && args.spec ? args.spec : {};
  const { nx, ny, r, ox, oy } = spec;
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(r)) return [];

  return uncoveredComponents
    .filter((c) => c.areaMm2 >= 1)
    .map((c) => {
      const ccx = c.centroid.x;
      const ccy = c.centroid.y;
      const diagCol = Math.floor((ccx - ox) / r);
      const diagRow = Math.floor((ccy - oy) / r);
      const cIdx = (diagRow >= 0 && diagCol >= 0 && diagRow < ny && diagCol < nx)
        ? diagRow * nx + diagCol
        : -1;
      const coveringPieces = cIdx >= 0
        ? placements
          .filter((pl) => pl.denseMask && pl.denseMask[cIdx])
          .map((pl) => ({ id: pl.id, tag: pl.inventoryTag }))
        : [];
      return {
        centroid: { x: Math.round(ccx), y: Math.round(ccy) },
        areaMm2: Math.round(c.areaMm2),
        cCellIdx: cIdx,
        areaFractionHits: coveringPieces.length,
        coveringPieces
      };
    });
}

function computeResultInvariants(args) {
  const resultPlacements = Array.isArray(args && args.resultPlacements) ? args.resultPlacements : [];
  const zonePoints = Array.isArray(args && args.zonePoints) ? args.zonePoints : [];
  const zoneArea = Number(args && args.zoneArea) || 0;
  const realCoveredRatio = Number(args && args.realCoveredRatio) || 0;
  const pointsToMultiPolygon = args && args.pointsToMultiPolygon;
  const multiPolygonArea = args && args.multiPolygonArea;
  const warnings = [];
  let summary = null;

  const nonPhysical = resultPlacements.filter((rp) =>
    rp.inZoneContour && rp.inZoneContour.length >= 3);
  const sumArea = nonPhysical.reduce((s, rp) => s + (rp.inZoneAreaMm2 || 0), 0);
  const unionArea = unionContourArea(nonPhysical);
  const overlapMm2 = sumArea - unionArea;
  const thresh = 0.01 * zoneArea;
  const strictThresh = Math.min(1, thresh); // 1mm² strict threshold for cell-partition invariants

  if (Math.abs(sumArea - unionArea) > strictThresh) {
    warnings.push(`INV1_FAIL: sum=${Math.round(sumArea)} union=${Math.round(unionArea)} diff=${Math.round(sumArea - unionArea)} thresh=${Math.round(strictThresh)}`);
  }
  if (overlapMm2 > strictThresh) {
    warnings.push(`INV5_FAIL: overlap=${Math.round(overlapMm2)} thresh=${Math.round(strictThresh)}`);
  }
  summary = {
    sumInZoneAreaMm2: Math.round(sumArea),
    unionInZoneAreaMm2: Math.round(unionArea),
    overlapMm2: Math.round(overlapMm2)
  };

  if (typeof pointsToMultiPolygon === "function" && typeof multiPolygonArea === "function") {
    for (const rp of resultPlacements) {
      const pieceArea = (rp.alignedContour && rp.alignedContour.length >= 3)
        ? multiPolygonArea(pointsToMultiPolygon(rp.alignedContour))
        : 0;
      if (pieceArea < 10) continue;
      const coreArea = (rp.alignedCoreContour && rp.alignedCoreContour.length >= 3)
        ? multiPolygonArea(pointsToMultiPolygon(rp.alignedCoreContour))
        : 0;
      if (coreArea >= pieceArea * 0.99) {
        warnings.push(`INV4_FAIL: piece=${rp.scrapPieceId} coreArea=${Math.round(coreArea)} >= pieceArea=${Math.round(pieceArea)} (inset not applied)`);
      }
    }
  }

  if (zoneArea > 0 && zonePoints.length >= 3) {
    const coveragePct = independentCoveragePercent(nonPhysical, zonePoints, zoneArea);
    summary.coveragePercent = Math.round(coveragePct * 1000) / 1000;
  }

  return { warnings, summary };
}

function unionContourArea(placements) {
  if (!placements.length) return 0;
  const cpr = new ClipperLib.Clipper();
  let anyAdded = false;
  for (const rp of placements) {
    const cp = toClipper(rp.inZoneContour);
    if (Math.abs(ClipperLib.Clipper.Area(cp)) >= 1) {
      cpr.AddPath(cp, ClipperLib.PolyType.ptSubject, true);
      anyAdded = true;
    }
  }
  if (!anyAdded) return 0;
  const uSol = new ClipperLib.Paths();
  cpr.Execute(
    ClipperLib.ClipType.ctUnion,
    uSol,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  );
  return areaOfPaths(uSol);
}

function independentCoveragePercent(placements, zonePoints, zoneArea) {
  if (!placements.length) return 0;
  const cprU = new ClipperLib.Clipper();
  let anyAdded = false;
  for (const rp of placements) {
    const cp = toClipper(rp.inZoneContour);
    if (Math.abs(ClipperLib.Clipper.Area(cp)) >= 1) {
      cprU.AddPath(cp, ClipperLib.PolyType.ptSubject, true);
      anyAdded = true;
    }
  }
  if (!anyAdded) return 0;

  const uPaths = new ClipperLib.Paths();
  cprU.Execute(
    ClipperLib.ClipType.ctUnion,
    uPaths,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  );

  const cprI = new ClipperLib.Clipper();
  for (const p of uPaths) cprI.AddPath(p, ClipperLib.PolyType.ptSubject, true);
  cprI.AddPath(toClipper(zonePoints), ClipperLib.PolyType.ptClip, true);
  const iPaths = new ClipperLib.Paths();
  cprI.Execute(
    ClipperLib.ClipType.ctIntersection,
    iPaths,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  );
  return (areaOfPaths(iPaths) / zoneArea) * 100;
}

module.exports = {
  computeAbsorptionDiagnostic,
  computeResultInvariants
};
