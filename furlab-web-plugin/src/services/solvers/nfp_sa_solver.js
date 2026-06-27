"use strict";

/**
 * NFP Greedy Coverage solver v2.0
 * Contract: docs/contracts/inventory_nfp_greedy_contract_v2.md
 *
 * Model:
 *   centeredCorePts = inset(scrapContour, allowanceMm)  — one time, on piece prep
 *   corePts         = transform(centeredCorePts, angle, cx, cy)
 *   mask            = rasterize(corePts)                — coverage unit
 *   pts             = transform(centeredPts, ...)       — display only (alignedContour)
 *
 * Any use of pts/fullMask in computation is a bug (R1, R2).
 */

const ClipperLib = require("clipper-lib");

const CLIPPER_SCALE = 1000;

function createNfpSaSolver(deps) {
  const {
    parseScrapContourPoints,
    centroid,
    polygonBBox,
    normalizeDeg,
    deltaDeg,
    pointsToMultiPolygon,
    intersectMulti,
    diffMulti,
    unionMulti,
    multiPolygonArea,
    createGridSpec,
    createSeededRng
  } = deps;

  // ── Geometry ─────────────────────────────────────────────────────────────────

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

  function pointInPolygon(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  }

  // ── IFP (Inner Fit Polygon) ──────────────────────────────────────────────────

  function computeIFP(zonePts, centeredCorePts) {
    try {
      const paths = ClipperLib.Clipper.MinkowskiDiff(toClipper(zonePts), toClipper(centeredCorePts));
      if (!paths || !paths.length) return null;
      let best = null, bestArea = 0;
      for (const path of paths) {
        const a = Math.abs(ClipperLib.Clipper.Area(path));
        if (a > bestArea) { bestArea = a; best = path; }
      }
      if (!best || best.length < 3) return null;
      return best.map(p => ({ x: p.X / CLIPPER_SCALE, y: p.Y / CLIPPER_SCALE }));
    } catch (_) { return null; }
  }

  // ── Raster ───────────────────────────────────────────────────────────────────

  function rasterize(pts, spec) {
    const { nx, ny, r, ox, oy } = spec;
    const mask = new Uint8Array(nx * ny);
    if (!pts || pts.length < 3) return mask;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const bbMinX = Math.max(0, Math.floor((Math.min(...xs) - ox) / r));
    const bbMaxX = Math.min(nx - 1, Math.ceil((Math.max(...xs) - ox) / r));
    const bbMinY = Math.max(0, Math.floor((Math.min(...ys) - oy) / r));
    const bbMaxY = Math.min(ny - 1, Math.ceil((Math.max(...ys) - oy) / r));
    for (let j = bbMinY; j <= bbMaxY; j++) {
      const cy = oy + (j + 0.5) * r;
      for (let i = bbMinX; i <= bbMaxX; i++) {
        if (pointInPolygon(ox + (i + 0.5) * r, cy, pts)) mask[j * nx + i] = 1;
      }
    }
    return mask;
  }

  function countBits(mask) {
    let n = 0; for (let i = 0; i < mask.length; i++) n += mask[i]; return n;
  }

  // ── Placement ────────────────────────────────────────────────────────────────
  // R1: mask by corePts. pts stored for display (alignedContour) only — never used in computation.

  function makePlacement(piece, cx, cy, angleDeg, spec, zoneMask) {
    const pts = transformPiece(piece.centeredPts, angleDeg, cx, cy);         // display only
    const corePts = transformPiece(piece.centeredCorePts, angleDeg, cx, cy); // all computation
    const mask = rasterize(corePts, spec);
    for (let i = 0; i < mask.length; i++) mask[i] &= zoneMask[i];
    // activeCells: sparse list for fast gain counting
    const activeCells = [];
    for (let i = 0; i < mask.length; i++) { if (mask[i]) activeCells.push(i); }
    return { id: piece.id, inventoryTag: piece.inventoryTag, cx, cy, angleDeg, pts, corePts, mask, activeCells };
  }

  function countGain(activeCells, uncoveredMask) {
    let n = 0;
    for (let i = 0; i < activeCells.length; i++) { if (uncoveredMask[activeCells[i]]) n++; }
    return n;
  }

  // ── Anchor sampling ──────────────────────────────────────────────────────────

  function sampleInPoly(poly, bbox, rng) {
    for (let t = 0; t < 60; t++) {
      const x = bbox.minX + rng.next() * (bbox.maxX - bbox.minX);
      const y = bbox.minY + rng.next() * (bbox.maxY - bbox.minY);
      if (pointInPolygon(x, y, poly)) return { x, y };
    }
    return null;
  }

  function sampleAnchor(piece, ifpCache, zonePts, zoneBbox, rng) {
    const ifp = ifpCache.get(piece.id);
    if (ifp && rng.next() < 0.7) {
      const pos = sampleInPoly(ifp, polygonBBox(ifp), rng);
      if (pos) return pos;
    }
    return sampleInPoly(zonePts, zoneBbox, rng);
  }

  // ── Greedy Coverage (§4 Этап 1) ──────────────────────────────────────────────
  // Each iteration: K attempts per free piece → pick best (piece, position) globally.
  // Tiebreak: inventoryTag asc (R5 determinism).

  async function greedyCoverage(pieces, spec, zoneMask, zoneCells, zonePts, zoneBbox, ifpCache, rng, K, napTarget, napTol, onProgress) {
    const placements = [];
    const usedIds = new Set();
    const uncoveredMask = zoneMask.slice();
    let uncoveredCells = zoneCells;
    let iteration = 0;

    while (uncoveredCells > 0) {
      const freePieces = pieces.filter(p => !usedIds.has(p.id));
      if (!freePieces.length) break;

      let bestPl = null, bestGain = 0, bestTag = null;

      for (const piece of freePieces) {
        const angleBase = normalizeDeg(napTarget - piece.napDeg);
        let pieceBestPl = null, pieceBestGain = 0;

        for (let k = 0; k < K; k++) {
          const dAngle = k === 0 ? 0 : (rng.next() * 2 - 1) * Math.min(napTol, 12);
          const angle = normalizeDeg(angleBase + dAngle);
          if (Math.abs(deltaDeg(normalizeDeg(napTarget - piece.napDeg), angle)) > napTol) continue;

          const pos = sampleAnchor(piece, ifpCache, zonePts, zoneBbox, rng);
          if (!pos) continue;

          const pl = makePlacement(piece, pos.x, pos.y, angle, spec, zoneMask);
          const gain = countGain(pl.activeCells, uncoveredMask);
          if (gain > pieceBestGain) { pieceBestGain = gain; pieceBestPl = pl; }
        }

        if (!pieceBestPl) continue;
        // Tiebreak: inventoryTag asc
        if (pieceBestGain > bestGain ||
            (pieceBestGain === bestGain && bestTag !== null && piece.inventoryTag < bestTag)) {
          bestGain = pieceBestGain;
          bestPl = pieceBestPl;
          bestTag = piece.inventoryTag;
        }
      }

      if (!bestPl || bestGain === 0) break;

      placements.push(bestPl);
      usedIds.add(bestPl.id);
      for (const idx of bestPl.activeCells) uncoveredMask[idx] = 0;
      uncoveredCells -= bestGain;
      iteration++;

      if (onProgress && iteration % 4 === 0) {
        const covPct = Math.round((1 - uncoveredCells / zoneCells) * 1000) / 10;
        onProgress({
          type: "phase", phase: "greedy",
          percent: Math.min(95, Math.round(covPct)),
          title: `NFP Greedy: ${placements.length} кусков, покрытие ${covPct}%`,
          pieces: placements.length, coverage: covPct
        });
        await new Promise(r => setImmediate(r));
      }
    }

    return placements;
  }

  // ── Output helpers ───────────────────────────────────────────────────────────

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

  // ── Finalize fragments (§4 Этап 2) ───────────────────────────────────────────
  // R1: all intersection/diff by corePts. pts → alignedContour only.

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
      const pl = placements[i];

      // R1: corePts ∩ zone
      let coreMp;
      try { coreMp = intersectMulti(pointsToMultiPolygon(pl.corePts), zoneMp); } catch (_) { continue; }
      if (multiPolygonArea(coreMp) <= 0) continue;

      // R4: min-size on original core (before diff with occupied)
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

      // fragment = coreMp \ occupiedUnion
      let fragmentMp = coreMp;
      if (occupiedMp) {
        try { fragmentMp = diffMulti(coreMp, occupiedMp); } catch (_) {}
      }

      // inZoneContour: pts ∩ zone — display only
      let inZoneContour = [];
      try { inZoneContour = mpToPoints(intersectMulti(pointsToMultiPolygon(pl.pts), zoneMp)); } catch (_) {}

      const coreArea = multiPolygonArea(coreMp);
      const fragArea = multiPolygonArea(fragmentMp);
      const fallbackCorePts = mpToPoints(coreMp);

      if (fragArea <= 0) {
        // Fully covered by earlier pieces — include for coverage accounting
        resultPlacements.push(makePlacementRecord(pl, i, fallbackCorePts, inZoneContour, coreArea, resultPlacements.length));
      } else {
        const parts = Array.isArray(fragmentMp) ? fragmentMp : [];
        if (parts.length === 0) {
          resultPlacements.push(makePlacementRecord(pl, i, fallbackCorePts, inZoneContour, fragArea, resultPlacements.length));
        } else {
          for (let pi = 0; pi < parts.length; pi++) {
            const partMp = [parts[pi]];
            const partPts = mpToPoints(partMp);
            if (partPts.length < 3) continue;
            const partArea = multiPolygonArea(partMp);
            if (partArea <= 0) continue;
            resultPlacements.push({
              placementId: parts.length > 1 ? `${pl.id}_part${pi}` : pl.id,
              scrapPieceId: pl.id,
              inventoryTag: pl.inventoryTag,
              alignedContour: pl.pts,           // display: body with allowance
              alignedCoreContour: pl.corePts,   // display: core without allowance
              inZoneContour: pi === 0 ? inZoneContour : [],
              inZoneCoreContour: partPts,        // coverage unit (R1)
              inZoneAreaMm2: partArea,
              status: "matched",
              phase: "greedy",
              solveIndex: i,
              solveOrder: i + 1,
              renderIndex: resultPlacements.length
            });
          }
        }
      }

      // occupiedUnion += full coreMp (not fragment) — prevents gaps at seam boundaries
      if (coreArea > 0) {
        try { occupiedMp = occupiedMp ? unionMulti(occupiedMp, coreMp) : coreMp; } catch (_) {}
      }
    }

    // ── Coverage metric ──────────────────────────────────────────────────────
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

    // ── 4 statuses (§5) ──────────────────────────────────────────────────────
    let resultStatus;
    if (coveredRatio >= 0.995) resultStatus = "ok";
    else if (coveredRatio >= 0.95) resultStatus = "partial";
    else resultStatus = "failed";

    return {
      ok: true,
      coveredRatio,
      coveragePercent: Math.round(coveredRatio * 10000) / 100,
      residualAreaMm2: Math.max(0, zoneArea - coveredArea),
      resultStatus,
      placements: resultPlacements,
      summary: {
        piecesCount: resultPlacements.length,
        selectedPiecesInZoneAreaMm2: Math.round(coveredArea)
      },
      algorithmTrace: { version: "nfp-greedy-v2" }
    };
  }

  function makePlacementRecord(pl, i, inZoneCorePts, inZoneContour, areaMm2, renderIndex) {
    return {
      placementId: pl.id,
      scrapPieceId: pl.id,
      inventoryTag: pl.inventoryTag,
      alignedContour: pl.pts,         // display only
      alignedCoreContour: pl.corePts, // display only
      inZoneContour,
      inZoneCoreContour: inZoneCorePts,
      inZoneAreaMm2: areaMm2,
      status: "matched",
      phase: "greedy",
      solveIndex: i,
      solveOrder: i + 1,
      renderIndex
    };
  }

  // ── Main entry point ─────────────────────────────────────────────────────────

  async function solve(zonePoints, candidates, _constraints, options) {
    const {
      napTarget = 0,
      napTol = 15,
      seed = 1,
      onProgress = null,
      K = 32
    } = options || {};
    const allowanceMm = Math.max(0, Number((options && options.allowanceMm) || (options && options.seamAllowanceReserveMm) || 0));
    const minWidthMm = Math.max(0, Number((options && options.minWidthMm) || 0));
    const minLengthMm = Math.max(0, Number((options && options.minLengthMm) || 0));

    const rng = createSeededRng(seed);
    const zoneBbox = polygonBBox(zonePoints);
    const spec = createGridSpec(zoneBbox, 3, 1);

    // Zone mask with holes subtracted
    let zoneMask = rasterize(zonePoints, spec);
    const zoneHoles = Array.isArray(options && options.zoneHoles) ? options.zoneHoles : [];
    for (const hole of zoneHoles) {
      if (!Array.isArray(hole) || hole.length < 3) continue;
      const holeMask = rasterize(hole, spec);
      for (let i = 0; i < zoneMask.length; i++) zoneMask[i] &= ~holeMask[i];
    }
    const zoneCells = countBits(zoneMask);
    const zoneArea = zoneCells * spec.r * spec.r;

    if (zoneCells === 0) return emptyResult(zoneArea, "no_zone");

    // ── Prepare pieces ────────────────────────────────────────────────────────
    // R2: allowanceMm applied once here — centeredCorePts is the computation unit forever after.
    const pieces = [];
    for (const c of candidates) {
      const rawPts = Array.isArray(c.scrapContour) && c.scrapContour.length >= 3
        ? c.scrapContour.map(p => ({ x: Number(p.x), y: Number(p.y) })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
        : parseScrapContourPoints(c.scrapContour);
      if (!rawPts || rawPts.length < 3) continue;

      const cen = centroid(rawPts);
      const centeredPts = rawPts.map(p => ({ x: p.x - cen.x, y: p.y - cen.y }));

      const centeredCorePts = allowanceMm > 0 ? offsetContourInward(centeredPts, allowanceMm) : centeredPts;
      // R7: discard if inset collapsed — no fallback to pts
      if (allowanceMm > 0 && centeredCorePts.length < 3) continue;

      // min-size filter on core
      if (minWidthMm > 0 || minLengthMm > 0) {
        const cb = polygonBBox(centeredCorePts);
        const shorter = Math.min(cb.maxX - cb.minX, cb.maxY - cb.minY);
        const longer = Math.max(cb.maxX - cb.minX, cb.maxY - cb.minY);
        if (minWidthMm > 0 && shorter < minWidthMm) continue;
        if (minLengthMm > 0 && longer < minLengthMm) continue;
      }

      pieces.push({
        id: String(c.id ?? c.inventoryTag),
        inventoryTag: String(c.inventoryTag ?? c.id),
        napDeg: Number(c.napDirectionDeg ?? c.napDirection ?? 0),
        centeredPts,
        centeredCorePts
      });
    }

    if (!pieces.length) return emptyResult(zoneArea, "no_candidates");

    // ── IFP by centeredCorePts (R1) ──────────────────────────────────────────
    const ifpCache = new Map();
    for (const piece of pieces) {
      const ifp = computeIFP(zonePoints, piece.centeredCorePts);
      if (ifp && ifp.length >= 3) ifpCache.set(piece.id, ifp);
    }

    // ── Greedy Coverage ──────────────────────────────────────────────────────
    const placements = await greedyCoverage(
      pieces, spec, zoneMask, zoneCells, zonePoints, zoneBbox,
      ifpCache, rng, K, napTarget, napTol, onProgress
    );

    return formatResult(placements, zonePoints, zoneArea, options);
  }

  function emptyResult(zoneArea, reason) {
    return {
      ok: false,
      coveredRatio: 0,
      coveragePercent: 0,
      residualAreaMm2: zoneArea,
      resultStatus: "failed",
      failedReason: reason,
      placements: [],
      summary: { piecesCount: 0, selectedPiecesInZoneAreaMm2: 0 },
      algorithmTrace: { version: "nfp-greedy-v2" }
    };
  }

  return { solve };
}

module.exports = { createNfpSaSolver };
