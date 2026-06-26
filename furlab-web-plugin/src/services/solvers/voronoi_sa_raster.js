"use strict";

const ClipperLib = require("clipper-lib");

function createVoronoiSaRaster(deps) {
  const pointInPolygon = deps.pointInPolygon;
  const clipperScale = deps.clipperScale || 1000;

  // Three-bit mask:
  //   bit0 (& 1) = cell center inside contour -> SA energy
  //   bit1 (& 2) = any of 5 sample points inside contour -> loose eligibility
  //   bit2 (& 4) = >=3 of 5 sample points inside contour -> majority coverage
  function rasterize(pts, spec) {
    const { nx, ny, r, ox, oy } = spec;
    const mask = new Uint8Array(nx * ny);
    if (!pts || pts.length < 3) return mask;
    const bbMinX = Math.max(0, Math.floor((Math.min(...pts.map((p) => p.x)) - ox) / r));
    const bbMaxX = Math.min(nx - 1, Math.ceil((Math.max(...pts.map((p) => p.x)) - ox) / r));
    const bbMinY = Math.max(0, Math.floor((Math.min(...pts.map((p) => p.y)) - oy) / r));
    const bbMaxY = Math.min(ny - 1, Math.ceil((Math.max(...pts.map((p) => p.y)) - oy) / r));
    const q = r * 0.25;
    for (let row = bbMinY; row <= bbMaxY; row++) {
      for (let col = bbMinX; col <= bbMaxX; col++) {
        const cx = ox + (col + 0.5) * r;
        const cy = oy + (row + 0.5) * r;
        const cIn = pointInPolygon(cx, cy, pts);
        const q1 = pointInPolygon(cx - q, cy - q, pts);
        const q2 = pointInPolygon(cx + q, cy - q, pts);
        const q3 = pointInPolygon(cx - q, cy + q, pts);
        const q4 = pointInPolygon(cx + q, cy + q, pts);
        const cnt = (cIn ? 1 : 0) + (q1 ? 1 : 0) + (q2 ? 1 : 0) + (q3 ? 1 : 0) + (q4 ? 1 : 0);
        let v = 0;
        if (cIn) v |= 1;
        if (cnt >= 1) v |= 2;
        if (cnt >= 3) v |= 4;
        mask[row * nx + col] = v;
      }
    }
    return mask;
  }

  function cellAreaFraction(col, row, pts, spec, gridN) {
    if (!pts || pts.length < 3) return 0;
    gridN = gridN || 7;
    const { r, ox, oy } = spec;
    const x0 = ox + col * r;
    const y0 = oy + row * r;
    let inside = 0;
    for (let i = 0; i < gridN; i++) {
      const py = y0 + (i + 0.5) * r / gridN;
      for (let j = 0; j < gridN; j++) {
        if (pointInPolygon(x0 + (j + 0.5) * r / gridN, py, pts)) inside++;
      }
    }
    return inside / (gridN * gridN);
  }

  function rasterizeDense(pts, spec, zoneMask) {
    const { nx, ny, r, ox, oy } = spec;
    const cellCount = nx * ny;
    const mask = new Uint8Array(cellCount);
    if (!pts || pts.length < 3) return mask;
    const bbMinX = Math.max(0, Math.floor((Math.min(...pts.map((p) => p.x)) - ox) / r));
    const bbMaxX = Math.min(nx - 1, Math.ceil((Math.max(...pts.map((p) => p.x)) - ox) / r));
    const bbMinY = Math.max(0, Math.floor((Math.min(...pts.map((p) => p.y)) - oy) / r));
    const bbMaxY = Math.min(ny - 1, Math.ceil((Math.max(...pts.map((p) => p.y)) - oy) / r));
    const gridN = 7;
    const threshold = Math.ceil(gridN * gridN * 0.5);
    for (let row = bbMinY; row <= bbMaxY; row++) {
      for (let col = bbMinX; col <= bbMaxX; col++) {
        const idx = row * nx + col;
        if (zoneMask && !zoneMask[idx]) continue;
        let inside = 0;
        const x0 = ox + col * r;
        const y0 = oy + row * r;
        for (let gi = 0; gi < gridN && inside < threshold; gi++) {
          const py = y0 + (gi + 0.5) * r / gridN;
          for (let gj = 0; gj < gridN; gj++) {
            if (pointInPolygon(x0 + (gj + 0.5) * r / gridN, py, pts)) inside++;
          }
        }
        if (inside >= threshold) mask[idx] = 1;
      }
    }
    return mask;
  }

  function countBits(mask) {
    let n = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
    return n;
  }

  function countAnd(a, b) {
    let n = 0;
    for (let i = 0; i < a.length; i++) if ((a[i] & 1) && b[i]) n++;
    return n;
  }

  function countZoneCellsInMask(mask, zoneMask, cellCount) {
    if (!mask) return 0;
    let n = 0;
    for (let i = 0; i < cellCount; i++) if (zoneMask[i] && mask[i]) n++;
    return n;
  }

  function computePowerAssign(placements, weights, spec, zoneMask) {
    const { nx, ny, r, ox, oy } = spec;
    const cellCount = nx * ny;
    const assign = new Int16Array(cellCount).fill(-1);
    for (let idx = 0; idx < cellCount; idx++) {
      if (!zoneMask[idx]) continue;
      const cx = ox + (idx % nx + 0.5) * r;
      const cy = oy + ((idx / nx | 0) + 0.5) * r;
      let bestScore = Infinity;
      let bestJ = -1;
      for (let j = 0; j < placements.length; j++) {
        const dx = cx - placements[j].cx;
        const dy = cy - placements[j].cy;
        const score = dx * dx + dy * dy - weights[j];
        if (score < bestScore) {
          bestScore = score;
          bestJ = j;
        }
      }
      assign[idx] = bestJ;
    }
    return assign;
  }

  function computeCoverage(placements, cellCount) {
    const covered = new Uint8Array(cellCount);
    const coreCounts = new Uint8Array(cellCount);
    let overlapCells = 0;
    for (const pl of placements) {
      // Use activeCells (precomputed non-zero indices) when available — O(active) not O(cellCount).
      const cells = pl.activeCells;
      if (cells) {
        for (let j = 0; j < cells.length; j++) {
          const i = cells[j];
          covered[i] = 1;
          coreCounts[i]++;
        }
      } else {
        for (let i = 0; i < cellCount; i++) {
          if (pl.mask[i] & 1) { covered[i] = 1; coreCounts[i]++; }
        }
      }
    }
    for (let i = 0; i < cellCount; i++) {
      if (coreCounts[i] > 1) overlapCells += coreCounts[i] - 1;
    }
    const coveredCells = countBits(covered);
    return { covered, coveredCells, overlapCells };
  }

  function buildCellToFrag(resultPlacements, spec, finalZoneMask) {
    const { nx, ny } = spec;
    const cellCount = nx * ny;
    const cellToFrag = new Int16Array(cellCount).fill(-1);
    for (let fi = 0; fi < resultPlacements.length; fi++) {
      const rp = resultPlacements[fi];
      if (!rp.inZoneContour || rp.inZoneContour.length < 3) continue;
      const m = rasterize(rp.inZoneContour, spec);
      for (let i = 0; i < cellCount; i++) {
        if (finalZoneMask[i] && (m[i] & 1) && cellToFrag[i] < 0) cellToFrag[i] = fi;
      }
    }
    return cellToFrag;
  }

  function rebuildFragPoly(cells, spec) {
    const { nx, r, ox, oy } = spec;
    const cpr = new ClipperLib.Clipper();
    let any = false;
    for (const idx of cells) {
      const col = idx % nx;
      const row = idx / nx | 0;
      const x0 = Math.round((ox + col * r) * clipperScale);
      const y0 = Math.round((oy + row * r) * clipperScale);
      const x1 = Math.round((ox + (col + 1) * r) * clipperScale);
      const y1 = Math.round((oy + (row + 1) * r) * clipperScale);
      cpr.AddPath([{ X: x0, Y: y0 }, { X: x1, Y: y0 }, { X: x1, Y: y1 }, { X: x0, Y: y1 }],
        ClipperLib.PolyType.ptSubject, true);
      any = true;
    }
    if (!any) return null;
    const sol = new ClipperLib.Paths();
    cpr.Execute(
      ClipperLib.ClipType.ctUnion,
      sol,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero
    );
    if (!sol || !sol.length) return null;
    const outer = sol.reduce((b, p) =>
      Math.abs(ClipperLib.Clipper.Area(p)) > Math.abs(ClipperLib.Clipper.Area(b)) ? p : b, sol[0]);
    const pts = outer.map((p) => ({ x: p.X / clipperScale, y: p.Y / clipperScale }));
    return pts.length >= 3 ? pts : null;
  }

  return {
    rasterize,
    cellAreaFraction,
    rasterizeDense,
    countBits,
    countAnd,
    countZoneCellsInMask,
    computePowerAssign,
    computeCoverage,
    buildCellToFrag,
    rebuildFragPoly
  };
}

module.exports = { createVoronoiSaRaster };
