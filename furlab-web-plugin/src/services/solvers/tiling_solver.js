"use strict";

/**
 * Tiling solver v1.0 — strip packing by core bbox.
 * Sorts pieces by core area desc, places in horizontal strips left-to-right.
 * Bodies (with allowance) may overlap at seams — only cores are packed without overlap.
 */

const ClipperLib = require("clipper-lib");
const CLIPPER_SCALE = 1000;

function createTilingSolver(deps) {
  const {
    parseScrapContourPoints,
    centroid,
    polygonBBox,
    pointsToMultiPolygon,
    intersectMulti,
    diffMulti,
    unionMulti,
    multiPolygonArea
  } = deps;

  function toClipper(pts) {
    return pts.map(p => ({ X: Math.round(p.x * CLIPPER_SCALE), Y: Math.round(p.y * CLIPPER_SCALE) }));
  }

  function ringAreaSigned(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      s += a.x * b.y - b.x * a.y;
    }
    return s * 0.5;
  }

  function offsetContourInward(pts, offsetMm) {
    if (!pts || pts.length < 3 || offsetMm <= 0) return [];
    const path = toClipper(pts);
    if (ringAreaSigned(pts) < 0) path.reverse();
    const co = new ClipperLib.ClipperOffset(2, 0.25 * CLIPPER_SCALE);
    co.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const out = new ClipperLib.Paths();
    co.Execute(out, -offsetMm * CLIPPER_SCALE);
    if (!out || !out.length) return [];
    const best = out.reduce((a, b) => b.length > a.length ? b : a, out[0]);
    const result = best.map(p => ({ x: p.X / CLIPPER_SCALE, y: p.Y / CLIPPER_SCALE }));
    return result.length >= 3 ? result : [];
  }

  function transformPiece(centeredPts, angleDeg, tx, ty) {
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    return centeredPts.map(p => ({
      x: p.x * cos - p.y * sin + tx,
      y: p.x * sin + p.y * cos + ty
    }));
  }

  function mpToPoints(mp) {
    if (!Array.isArray(mp) || !mp.length) return [];
    const poly = mp[0];
    if (!Array.isArray(poly) || !poly.length) return [];
    const ring = poly[0];
    if (!Array.isArray(ring) || ring.length < 4) return [];
    const pts = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const x = Number(ring[i][0]), y = Number(ring[i][1]);
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
    }
    return pts.length >= 3 ? pts : [];
  }

  // Choose best angle for a piece: prefer angle closest to (napTarget - napDeg)
  // Try 0° and 90° rotations if within napTol.
  function chooseBestAngle(piece, napTarget, napTol) {
    const base = ((napTarget - piece.napDeg) % 360 + 360) % 360;
    const candidates = [base];
    // Also try 90° rotated if within tolerance or always (tiling benefits from rotation)
    const rotated = (base + 90) % 360;
    if (napTol >= 90) candidates.push(rotated);
    return candidates;
  }

  // Returns x intersections of the zone contour at a given y (sorted asc).
  function zoneXAtY(zonePoints, y) {
    const xs = [];
    for (let i = 0, j = zonePoints.length - 1; i < zonePoints.length; j = i++) {
      const xi = zonePoints[i].x, yi = zonePoints[i].y;
      const xj = zonePoints[j].x, yj = zonePoints[j].y;
      if ((yi <= y && y < yj) || (yj <= y && y < yi)) {
        xs.push(xi + (y - yi) * (xj - xi) / (yj - yi));
      }
    }
    xs.sort((a, b) => a - b);
    return xs;
  }

  // Returns x-start and x-end of the zone interior at a given y, or null if outside.
  function zoneXRange(zonePoints, y) {
    const xs = zoneXAtY(zonePoints, y);
    if (xs.length < 2) return null;
    return { x0: xs[0], x1: xs[xs.length - 1] };
  }

  // Strip packing: place pieces in horizontal strips following zone contour.
  // Returns array of { piece, cx, cy, angleDeg }.
  function stripPack(pieces, zoneBbox, zonePoints, napTarget, napTol) {
    const zoneH = zoneBbox.maxY - zoneBbox.minY;

    // Sort by core area descending
    const sorted = pieces.slice().sort((a, b) => b.coreArea - a.coreArea);

    const placed = [];
    let rowY = zoneBbox.minY;
    let rowH = 0;
    let remaining = sorted.slice();

    const MAX_ROWS = 200;
    let rowCount = 0;

    while (remaining.length > 0 && rowY < zoneBbox.maxY && rowCount < MAX_ROWS) {
      rowCount++;
      // Find a representative piece height for this row (use first remaining piece)
      const samplePiece = remaining[0];
      const sampleAngles = chooseBestAngle(samplePiece, napTarget, napTol);
      const sampleRad = (sampleAngles[0] * Math.PI) / 180;
      const sampleCos = Math.abs(Math.cos(sampleRad)), sampleSin = Math.abs(Math.sin(sampleRad));
      const sampleH = samplePiece.coreHW * sampleCos + samplePiece.coreWH * sampleSin;
      const rowMidY = rowY + sampleH / 2;

      // Get x range of zone at row mid-y
      const xRange = zoneXRange(zonePoints, rowMidY);
      if (!xRange) {
        rowY += Math.max(sampleH, 5);
        continue;
      }

      let rowX = xRange.x0;
      rowH = 0;
      const nextRemaining = [];
      let placedInRow = false;

      for (const piece of remaining) {
        const angles = chooseBestAngle(piece, napTarget, napTol);

        let bestAngle = angles[0];
        let bestW = null, bestH = null;
        for (const angle of angles) {
          const rad = (angle * Math.PI) / 180;
          const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
          const w = piece.coreHW * sin + piece.coreWH * cos;
          const h = piece.coreHW * cos + piece.coreWH * sin;
          if (bestW === null || w < bestW) { bestW = w; bestH = h; bestAngle = angle; }
        }

        // Get zone x range at piece center y
        const pieceMidY = rowY + bestH / 2;
        const pr = zoneXRange(zonePoints, pieceMidY);
        if (!pr) { nextRemaining.push(piece); continue; }

        // Check piece fits in remaining row width
        if (rowX + bestW > pr.x1 + 0.5) {
          nextRemaining.push(piece);
          continue;
        }

        // Start rowX at zone left if we're past zone left
        if (rowX < pr.x0) rowX = pr.x0;

        const cx = rowX + bestW / 2;
        const cy = rowY + bestH / 2;
        placed.push({ piece, cx, cy, angleDeg: bestAngle, w: bestW, h: bestH });
        rowX += bestW;
        if (bestH > rowH) rowH = bestH;
        placedInRow = true;
      }

      remaining = nextRemaining;
      rowY += rowH > 0 ? rowH : Math.max(sampleH, 5);

      // Safety: if nothing placed and rowH=0, advance by a minimum step
      if (!placedInRow) rowY += 5;
    }

    return placed;
  }

  function formatResult(placements, zonePoints, zoneArea, options) {
    const minWidthMm = Math.max(0, Number((options && options.minWidthMm) || 0));
    const minLengthMm = Math.max(0, Number((options && options.minLengthMm) || 0));
    let zoneMp = pointsToMultiPolygon(zonePoints);
    const zoneHoles = Array.isArray(options && options.zoneHoles) ? options.zoneHoles : [];
    for (const hole of zoneHoles) {
      if (!Array.isArray(hole) || hole.length < 3) continue;
      try { zoneMp = diffMulti(zoneMp, pointsToMultiPolygon(hole)); } catch (_) {}
    }

    const resultPlacements = [];
    let occupiedMp = null;

    for (let i = 0; i < placements.length; i++) {
      const { piece, cx, cy, angleDeg } = placements[i];
      const corePts = transformPiece(piece.centeredCorePts, angleDeg, cx, cy);
      const pts = transformPiece(piece.centeredPts, angleDeg, cx, cy);

      let coreMp;
      try { coreMp = intersectMulti(pointsToMultiPolygon(corePts), zoneMp); } catch (_) { continue; }
      if (multiPolygonArea(coreMp) <= 0) continue;

      if (minWidthMm > 0 || minLengthMm > 0) {
        const origPts = mpToPoints(coreMp);
        if (origPts.length >= 3) {
          const pb = polygonBBox(origPts);
          const shorter = Math.min(pb.maxX - pb.minX, pb.maxY - pb.minY);
          const longer = Math.max(pb.maxX - pb.minX, pb.maxY - pb.minY);
          if (minWidthMm > 0 && shorter < minWidthMm) continue;
          if (minLengthMm > 0 && longer < minLengthMm) continue;
        }
      }

      let fragmentMp = coreMp;
      if (occupiedMp) {
        try { fragmentMp = diffMulti(coreMp, occupiedMp); } catch (_) {}
      }

      let inZoneContour = [];
      try { inZoneContour = mpToPoints(intersectMulti(pointsToMultiPolygon(pts), zoneMp)); } catch (_) {}

      const coreArea = multiPolygonArea(coreMp);
      const fragArea = multiPolygonArea(fragmentMp);
      const corePtsResult = mpToPoints(coreMp);

      if (fragArea <= 0) {
        resultPlacements.push({
          placementId: piece.id,
          scrapPieceId: piece.id,
          inventoryTag: piece.inventoryTag,
          alignedContour: pts,
          alignedCoreContour: corePts,
          inZoneContour,
          inZoneCoreContour: corePtsResult,
          inZoneAreaMm2: coreArea,
          status: "matched",
          phase: "tiling",
          solveIndex: i, solveOrder: i + 1, renderIndex: resultPlacements.length
        });
      } else {
        const parts = Array.isArray(fragmentMp) ? fragmentMp : [];
        for (let pi = 0; pi < parts.length; pi++) {
          const partPts = mpToPoints([parts[pi]]);
          if (partPts.length < 3) continue;
          const partArea = multiPolygonArea([parts[pi]]);
          if (partArea <= 0) continue;
          resultPlacements.push({
            placementId: parts.length > 1 ? `${piece.id}_p${pi}` : piece.id,
            scrapPieceId: piece.id,
            inventoryTag: piece.inventoryTag,
            alignedContour: pts,
            alignedCoreContour: corePts,
            inZoneContour: pi === 0 ? inZoneContour : [],
            inZoneCoreContour: partPts,
            inZoneAreaMm2: partArea,
            status: "matched",
            phase: "tiling",
            solveIndex: i, solveOrder: i + 1, renderIndex: resultPlacements.length
          });
        }
      }

      if (coreArea > 0) {
        try { occupiedMp = occupiedMp ? unionMulti(occupiedMp, coreMp) : coreMp; } catch (_) {}
      }
    }

    let unionMp = null;
    for (const rp of resultPlacements) {
      if (!rp.inZoneCoreContour || rp.inZoneCoreContour.length < 3) continue;
      try {
        const mp = pointsToMultiPolygon(rp.inZoneCoreContour);
        unionMp = unionMp ? unionMulti(unionMp, mp) : mp;
      } catch (_) {}
    }
    const coveredArea = unionMp ? multiPolygonArea(unionMp) : 0;
    const coveredRatio = zoneArea > 0 ? Math.min(1, coveredArea / zoneArea) : 0;

    let resultStatus;
    if (coveredRatio >= 0.995) resultStatus = "ok";
    else if (coveredRatio >= 0.80) resultStatus = "partial";
    else resultStatus = "failed";

    return {
      ok: true,
      coveredRatio,
      coveragePercent: Math.round(coveredRatio * 10000) / 100,
      residualAreaMm2: Math.max(0, zoneArea - coveredArea),
      resultStatus,
      placements: resultPlacements,
      summary: { piecesCount: resultPlacements.length, selectedPiecesInZoneAreaMm2: Math.round(coveredArea) },
      algorithmTrace: { version: "tiling-v1" }
    };
  }

  async function solve(zonePoints, candidates, _constraints, options) {
    const {
      napTarget = 90,
      napTol = 15,
      onProgress = null
    } = options || {};
    const allowanceMm = Math.max(0, Number((options && options.allowanceMm) || 0));
    const minWidthMm = Math.max(0, Number((options && options.minWidthMm) || 0));
    const minLengthMm = Math.max(0, Number((options && options.minLengthMm) || 0));
    const zoneBbox = polygonBBox(zonePoints);
    const zoneArea = Math.abs(ringAreaSigned(zonePoints));

    if (onProgress) onProgress({ type: "phase", phase: "prep", percent: 10, title: "Тайлинг: подготовка кусков…", pieces: 0, coverage: 0 });

    const pieces = [];
    for (const c of candidates) {
      const rawPts = Array.isArray(c.scrapContour) && c.scrapContour.length >= 3
        ? c.scrapContour.map(p => ({ x: Number(p.x), y: Number(p.y) })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
        : parseScrapContourPoints(c.scrapContour);
      if (!rawPts || rawPts.length < 3) continue;

      const cen = centroid(rawPts);
      const centeredPts = rawPts.map(p => ({ x: p.x - cen.x, y: p.y - cen.y }));
      const centeredCorePts = allowanceMm > 0 ? offsetContourInward(centeredPts, allowanceMm) : centeredPts;
      if (allowanceMm > 0 && centeredCorePts.length < 3) continue;

      const cb = polygonBBox(centeredCorePts);
      const coreW = cb.maxX - cb.minX;
      const coreH = cb.maxY - cb.minY;
      const shorter = Math.min(coreW, coreH);
      const longer = Math.max(coreW, coreH);
      if (minWidthMm > 0 && shorter < minWidthMm) continue;
      if (minLengthMm > 0 && longer < minLengthMm) continue;

      pieces.push({
        id: String(c.id ?? c.inventoryTag),
        inventoryTag: String(c.inventoryTag ?? c.id),
        napDeg: Number(c.napDirectionDeg ?? c.napDirection ?? 0),
        centeredPts,
        centeredCorePts,
        coreW, coreH,
        coreWH: coreW, coreHW: coreH,
        coreArea: coreW * coreH
      });
    }

    if (!pieces.length) {
      return { ok: false, coveredRatio: 0, coveragePercent: 0, residualAreaMm2: zoneArea, resultStatus: "failed", failedReason: "no_candidates", placements: [], summary: { piecesCount: 0, selectedPiecesInZoneAreaMm2: 0 }, algorithmTrace: { version: "tiling-v1" } };
    }

    if (onProgress) onProgress({ type: "phase", phase: "packing", percent: 40, title: `Тайлинг: ${pieces.length} кусков, раскладываем…`, pieces: 0, coverage: 0 });

    const packed = stripPack(pieces, zoneBbox, zonePoints, napTarget, napTol);

    if (onProgress) onProgress({ type: "phase", phase: "format", percent: 80, title: `Тайлинг: ${packed.length} размещений, обрезаем…`, pieces: packed.length, coverage: 0 });

    const result = formatResult(packed, zonePoints, zoneArea, options);

    if (onProgress) onProgress({ type: "phase", phase: "done", percent: 100, title: `Тайлинг: ${result.placements.length} кусков, покрытие ${result.coveragePercent}%`, pieces: result.placements.length, coverage: result.coveragePercent });

    return result;
  }

  return { solve };
}

module.exports = { createTilingSolver };
