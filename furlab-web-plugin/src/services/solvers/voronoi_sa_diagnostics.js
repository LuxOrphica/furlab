"use strict";

const ClipperLib = require("clipper-lib");

// ── Absorption diagnostic (для совместимости со старыми вызовами) ──────────────
function computeAbsorptionDiagnostic(args) {
  const uncoveredComponents = Array.isArray(args && args.uncoveredComponents) ? args.uncoveredComponents : [];
  const placements = Array.isArray(args && args.placements) ? args.placements : [];
  const spec = args && args.spec;
  if (!spec) return [];
  const r = spec.r || 3;
  const cellArea = r * r;
  const result = [];
  for (const comp of uncoveredComponents) {
    const areaMm2 = Number(comp && comp.areaMm2 || 0);
    if (areaMm2 <= 0) continue;
    const cells = Math.max(1, Math.round(areaMm2 / cellArea));
    const covCount = (placements || []).reduce((s, p) => {
      const m = p && p.mask;
      if (!m) return s;
      let c = 0;
      for (let i = 0; i < m.length; i++) if (m[i] & 1) c++;
      return s + c;
    }, 0);
    result.push({
      areaMm2: Math.round(areaMm2),
      cells,
      covCells: covCount,
      ratio: covCount > 0 ? cells / covCount : null
    });
  }
  return result;
}

// ── Result invariants (INV1, INV5, R5) ────────────────────────────────────────

function computeResultInvariants(args) {
  const resultPlacements = Array.isArray(args && args.resultPlacements) ? args.resultPlacements : [];
  const zonePoints = Array.isArray(args && args.zonePoints) ? args.zonePoints : [];
  const zoneArea = Number(args && args.zoneArea) || 0;
  const realCoveredRatio = Number(args && args.realCoveredRatio) || 0;
  const pointsToMultiPolygon = args && args.pointsToMultiPolygon;
  const multiPolygonArea = args && args.multiPolygonArea;
  const allowanceMm = Number(args && args.allowanceMm) || 0;
  // v5.1: R5 thin fragment check — minWidthMm/minLengthMm
  const minWidthMm = Number(args && args.minWidthMm) || 0;
  const minLengthMm = Number(args && args.minLengthMm) || 0;
  const warnings = [];
  let summary = null;

  const nonPhysical = resultPlacements.filter((rp) =>
    rp.inZoneContour && rp.inZoneContour.length >= 3);
  const sumArea = nonPhysical.reduce((s, rp) => s + (rp.inZoneAreaMm2 || 0), 0);
  const unionArea = unionContourArea(nonPhysical);
  const overlapMm2 = sumArea - unionArea;
  const thresh = 0.01 * zoneArea;
  const strictThresh = Math.min(1, thresh); // 1mm² strict threshold

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
      // v5.1: INV4 убран. Ядро = тело по определению, coreArea == pieceArea — норма.
    }
  }

  if (zoneArea > 0 && zonePoints.length >= 3) {
    const coveragePct = independentCoveragePercent(nonPhysical, zonePoints, zoneArea);
    summary.coveragePercent = Math.round(coveragePct * 1000) / 1000;
  }

  // v5.1 R5: thin fragment check — MBR shorter side < minWidthMm
  // Фрагмент с MBR shorter < minWidthMm физически не сошьётся (узкий шов).
  // under_threshold куски (dissolved в postprocess) тоже считаются — они thin.
  if (minWidthMm > 0 || minLengthMm > 0) {
    const thinFrags = [];
    for (const rp of resultPlacements) {
      const pts = rp.inZoneCoreContour || rp.inZoneContour || [];
      if (!Array.isArray(pts) || pts.length < 3) continue;
      const status = String(rp.status || "");
      if (status === "thin_fragment") {
        thinFrags.push({ id: rp.scrapPieceId || rp.inventoryTag, reason: "thin_fragment_status", mbrShort: 0 });
        continue;
      }
      if (status === "under_threshold" || rp.phase === "under_threshold") {
        thinFrags.push({ id: rp.scrapPieceId || rp.inventoryTag, reason: "under_threshold", mbrShort: 0 });
        continue;
      }
      const mbrShort = mbrShorterSide(pts);
      if (minWidthMm > 0 && mbrShort < minWidthMm - 0.5) {
        thinFrags.push({ id: rp.scrapPieceId || rp.inventoryTag, reason: `mbr_short_${mbrShort.toFixed(1)}mm<${minWidthMm}mm`, mbrShort });
      }
      if (minLengthMm > 0) {
        const mbrLong = mbrLongerSide(pts);
        if (mbrLong < minLengthMm - 0.5) {
          thinFrags.push({ id: rp.scrapPieceId || rp.inventoryTag, reason: `mbr_long_${mbrLong.toFixed(1)}mm<${minLengthMm}mm`, mbrShort });
        }
      }
    }
    if (thinFrags.length > 0) {
      warnings.push(`R5_FAIL: ${thinFrags.length} sub-min fragments (minWidth=${minWidthMm}mm minLength=${minLengthMm}mm): ${thinFrags.slice(0, 3).map(t => `${t.id}(${t.reason})`).join(", ")}${thinFrags.length > 3 ? "..." : ""}`);
    }
  }

  return { warnings, summary };
}

// v5.1: MBR shorter/longer side via rotating calipers on convex hull.
function mbrShorterSide(pts) {
  if (!Array.isArray(pts) || pts.length < 3) return Infinity;
  const hull = _convexHull(pts);
  if (hull.length < 3) return Infinity;
  let minShorter = Infinity;
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const p1 = hull[i];
    const p2 = hull[(i + 1) % n];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len, uy = dy / len;
    const vx = -uy, vy = ux;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy;
      const v = p.x * vx + p.y * vy;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const shorter = Math.min(maxU - minU, maxV - minV);
    if (shorter < minShorter) minShorter = shorter;
  }
  return minShorter;
}

function mbrLongerSide(pts) {
  if (!Array.isArray(pts) || pts.length < 3) return Infinity;
  const hull = _convexHull(pts);
  if (hull.length < 3) return Infinity;
  let maxLonger = 0;
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const p1 = hull[i];
    const p2 = hull[(i + 1) % n];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len, uy = dy / len;
    const vx = -uy, vy = ux;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy;
      const v = p.x * vx + p.y * vy;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const longer = Math.max(maxU - minU, maxV - minV);
    if (longer > maxLonger) maxLonger = longer;
  }
  return maxLonger;
}

function _convexHull(pts) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const sorted = pts.slice().sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
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

function toClipper(points) {
  const SCALE = 1000;
  return (points || []).map(p => ({ X: Math.round(Number(p.x) * SCALE), Y: Math.round(Number(p.y) * SCALE) }));
}

function areaOfPaths(paths) {
  const SCALE = 1000;
  let total = 0;
  for (const p of paths) total += Math.abs(ClipperLib.Clipper.Area(p));
  return total / (SCALE * SCALE);
}

module.exports = {
  computeAbsorptionDiagnostic,
  computeResultInvariants
};
