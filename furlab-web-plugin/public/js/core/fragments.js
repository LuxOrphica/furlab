// FurLab Fragment generation (Voronoi, Regular, Shifted, Diagonal, Radial)
// Exposes window.FurLabFragments
// Depends on: window.FurLabGeom, window.polygonClipping
(function (global) {

  // Local aliases to FurLabGeom — resolved at call time so load order doesn't matter
  function polygonArea(p) { return window.FurLabGeom.polygonArea(p); }
  function polygonBBox(p) { return window.FurLabGeom.polygonBBox(p); }
  function randomPointInPolygon(poly, bbox, n) { return window.FurLabGeom.randomPointInPolygon(poly, bbox, n); }
  function clipPolygonByHalfPlane(poly, nx, ny, c) { return window.FurLabGeom.clipPolygonByHalfPlane(poly, nx, ny, c); }
  function clipPolygonByBand(poly, nx, ny, lo, hi) { return window.FurLabGeom.clipPolygonByBand(poly, nx, ny, lo, hi); }
  function clipPolygonToRect(poly, x0, y0, x1, y1) { return window.FurLabGeom.clipPolygonToRect(poly, x0, y0, x1, y1); }
  function toBooleanMulti(pts) { return window.FurLabGeom.toBooleanMulti(pts); }
  function fromBooleanMultiOuter(mp) { return window.FurLabGeom.fromBooleanMultiOuter(mp); }

  // ---------------------------------------------------------------------------

  function generateVoronoiFragments(zonePoints, options) {
    const area = polygonArea(zonePoints);
    const minArea = Math.max(50, Number(options.minArea || 500));
    const density = Math.max(1, Math.min(10, Number(options.density || 5)));
    const variability = Math.max(1, Math.min(10, Number(options.variability || 5)));
    const anisotropy = Math.max(1, Math.min(10, Number(options.anisotropy || 5)));
    const limit = Math.max(8, Math.min(240, Number(options.limit || 500)));
    const targetCount = Math.max(6, Math.min(120, Math.min(limit, Math.round((area / 12000) * (0.65 + density * 0.18)))));
    const bbox = polygonBBox(zonePoints);
    const seeds = [];
    const spread = 0.15 + (variability / 10) * 0.45;
    const axis = String(options.axis || "y");
    const k = 1 + ((anisotropy - 5) / 5) * 0.8;
    for (let i = 0; i < targetCount; i++) {
      const p = randomPointInPolygon(zonePoints, bbox);
      const jx = (Math.random() - 0.5) * bbox.width * spread * 0.06;
      const jy = (Math.random() - 0.5) * bbox.height * spread * 0.06;
      seeds.push({ x: p.x + jx, y: p.y + jy });
    }
    const fragments = [];
    for (let i = 0; i < seeds.length; i++) {
      const pi = seeds[i];
      let cell = zonePoints.map((p) => ({ x: p.x, y: p.y }));
      for (let j = 0; j < seeds.length; j++) {
        if (i === j) continue;
        const pj = seeds[j];
        const dx = pj.x - pi.x;
        const dy = pj.y - pi.y;
        const midx = (pi.x + pj.x) * 0.5;
        const midy = (pi.y + pj.y) * 0.5;
        const kx = axis === "x" ? k : 1;
        const ky = axis === "y" ? k : 1;
        const nx = -(kx * kx) * dx;
        const ny = -(ky * ky) * dy;
        const c = midx * (dx * kx * kx) + midy * (dy * ky * ky);
        cell = clipPolygonByHalfPlane(cell, nx, ny, c);
        if (cell.length < 3) break;
      }
      if (cell.length < 3) continue;
      if (polygonArea(cell) < minArea) continue;
      fragments.push(cell);
    }
    return fragments;
  }

  function generateRegularFragments(zonePoints, options) {
    const bbox = polygonBBox(zonePoints);
    const axis = String(options.axis || "y");
    let rows = Math.max(2, Math.min(20, Number(options.rows || 5)));
    let cols = Math.max(2, Math.min(20, Number(options.cols || 5)));
    const gapX = Math.max(0, Number(options.gapX || options.gapXmm || 0));
    const gapY = Math.max(0, Number(options.gapY || options.gapYmm || 0));
    const cornerRadius = Math.max(0, Number(options.cornerRadius || options.cornerRadiusMm || 0));
    const variability = Math.max(0, Math.min(10, Number(options.variability || 0)));
    const minArea = Math.max(50, Number(options.minArea || 500));
    const regularStrategy = String(options && options.regularStrategy || "").trim().toLowerCase();
    const xCuts = [bbox.minX];
    const yCuts = [bbox.minY];
    function scanlineWidestInterval(points, y) {
      const pts = Array.isArray(points) ? points : [];
      if (pts.length < 3) return null;
      const xs = [];
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const ax = Number(a && a.x);
        const ay = Number(a && a.y);
        const bx = Number(b && b.x);
        const by = Number(b && b.y);
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
        if (Math.abs(ay - by) < 1e-9) continue;
        const crosses = (ay <= y && y < by) || (by <= y && y < ay);
        if (!crosses) continue;
        const t = (y - ay) / (by - ay);
        xs.push(ax + (bx - ax) * t);
      }
      xs.sort((a, b) => a - b);
      let widest = null;
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const left = xs[i];
        const right = xs[i + 1];
        if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) continue;
        if (!widest || (right - left) > (widest.right - widest.left)) widest = { left, right, width: right - left };
      }
      return widest;
    }
    function quantileSorted(list, q) {
      const arr = (Array.isArray(list) ? list : [])
        .filter((v) => Number.isFinite(Number(v)))
        .map(Number)
        .sort((a, b) => a - b);
      if (!arr.length) return null;
      if (arr.length === 1) return arr[0];
      const pos = Math.max(0, Math.min(arr.length - 1, (arr.length - 1) * q));
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      if (lo === hi) return arr[lo];
      const t = pos - lo;
      return arr[lo] * (1 - t) + arr[hi] * t;
    }
    function pushUniqueCut(list, value, minGap) {
      const v = Number(value);
      if (!Number.isFinite(v)) return;
      const gap = Math.max(1e-6, Number(minGap) || 0);
      for (const existing of list) {
        if (Math.abs(Number(existing) - v) < gap) return;
      }
      list.push(v);
    }
    if ((regularStrategy === "core_overlap" || regularStrategy === "core_grid") && axis === "y" && cols >= 2) {
      const spans = [];
      const sampleCount = 13;
      for (let i = 0; i < sampleCount; i += 1) {
        const t = 0.2 + (0.6 * i) / (sampleCount - 1);
        const y = bbox.minY + t * bbox.height;
        const span = scanlineWidestInterval(zonePoints, y);
        if (span && span.width > bbox.width * 0.2) spans.push(span);
      }
      const leftRef = quantileSorted(spans.map((s) => s.left), 0.75);
      const rightRef = quantileSorted(spans.map((s) => s.right), 0.25);
      if (Number.isFinite(leftRef) && Number.isFinite(rightRef) && rightRef > leftRef && cols >= 2) {
        const safeLeft = Math.max(bbox.minX, leftRef);
        const safeRight = Math.min(bbox.maxX, rightRef);
        const coreWidth = safeRight - safeLeft;
        const minUsefulCore = bbox.width * 0.2;
        if (coreWidth > minUsefulCore) {
          const minGap = bbox.width / Math.max(200, cols * 20);
          const step = coreWidth / cols;
          for (let c = 1; c < cols; c++) {
            const base = safeLeft + c * step;
            const jitter = (Math.random() - 0.5) * step * (variability / 10) * 0.03;
            pushUniqueCut(xCuts, base + jitter, minGap);
          }
        } else {
          for (let c = 1; c < cols; c++) {
            const t = c / cols;
            const base = bbox.minX + t * bbox.width;
            const jitter = (Math.random() - 0.5) * bbox.width * (variability / 10) * 0.05;
            xCuts.push(base + jitter);
          }
        }
      } else {
        for (let c = 1; c < cols; c++) {
          const t = c / cols;
          const base = bbox.minX + t * bbox.width;
          const jitter = regularStrategy === "core_grid" ? 0 : (Math.random() - 0.5) * bbox.width * (variability / 10) * 0.05;
          xCuts.push(base + jitter);
        }
      }
    } else {
      for (let c = 1; c < cols; c++) {
        const t = c / cols;
        const base = bbox.minX + t * bbox.width;
        const jitter = (Math.random() - 0.5) * bbox.width * (variability / 10) * 0.05;
        xCuts.push(base + jitter);
      }
    }
    for (let r = 1; r < rows; r++) {
      const t = r / rows;
      const base = bbox.minY + t * bbox.height;
      const jitter = regularStrategy === "core_grid" ? 0 : (Math.random() - 0.5) * bbox.height * (variability / 10) * 0.05;
      yCuts.push(base + jitter);
    }
    xCuts.push(bbox.maxX);
    yCuts.push(bbox.maxY);
    xCuts.sort((a, b) => a - b);
    yCuts.sort((a, b) => a - b);
    const pc = (typeof window !== "undefined" && window.polygonClipping) ? window.polygonClipping : null;
    const canBooleanClip = !!(pc && typeof pc.intersection === "function");
    const zoneMulti = canBooleanClip ? toBooleanMulti(zonePoints) : [];
    const frags = [];
    for (let ry = 0; ry < yCuts.length - 1; ry++) {
      for (let cx = 0; cx < xCuts.length - 1; cx++) {
        let x0 = xCuts[cx];
        let y0 = yCuts[ry];
        let x1 = xCuts[cx + 1];
        let y1 = yCuts[ry + 1];
        if (gapX > 0) {
          const dx = gapX * 0.5;
          if (cx > 0) x0 += dx;
          if (cx < xCuts.length - 2) x1 -= dx;
        }
        if (gapY > 0) {
          const dy = gapY * 0.5;
          if (ry > 0) y0 += dy;
          if (ry < yCuts.length - 2) y1 -= dy;
        }
        if (!(x1 > x0 && y1 > y0)) continue;
        if (canBooleanClip && Array.isArray(zoneMulti) && zoneMulti.length) {
          const base = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
          const baseMulti = toBooleanMulti(base);
          if (Array.isArray(baseMulti) && baseMulti.length) {
            let mp = [];
            try { mp = pc.intersection(baseMulti, zoneMulti) || []; } catch (_) { mp = []; }
            const pieces = fromBooleanMultiOuter(mp);
            for (const piece of pieces) {
              if (polygonArea(piece) >= minArea) frags.push(piece);
            }
            continue;
          }
        }
        const clipped = clipPolygonToRect(zonePoints, x0, y0, x1, y1);
        if (!Array.isArray(clipped) || clipped.length < 3) continue;
        if (polygonArea(clipped) < minArea) continue;
        frags.push(clipped);
      }
    }
    return frags;
  }

  function generateShiftedFragments(zonePoints, options) {
    const bbox = polygonBBox(zonePoints);
    if (!bbox || bbox.width <= 0 || bbox.height <= 0) return [];
    const rows = Math.max(1, Math.min(20, Math.round(Number(options.rows || 5))));
    const cols = Math.max(1, Math.min(20, Math.round(Number(options.cols || 5))));
    const gapX = Math.max(0, Number(options.gapX || options.gapXmm || 0));
    const gapY = Math.max(0, Number(options.gapY || options.gapYmm || 0));
    const cornerRadius = Math.max(0, Number(options.cornerRadius || 0));
    const minArea = Math.max(50, Number(options.minArea || 500));
    const shiftPercent = Math.max(-100, Math.min(100, Number(options.shiftPercent || 50)));
    const cellWidth = bbox.width / cols;
    const cellHeight = bbox.height / rows;
    const rowShift = cellWidth * (shiftPercent / 100);
    const pc = (typeof window !== "undefined" && window.polygonClipping) ? window.polygonClipping : null;
    const canBooleanClip = !!(pc && typeof pc.intersection === "function");
    const zoneMulti = canBooleanClip ? toBooleanMulti(zonePoints) : [];
    const frags = [];
    for (let ry = 0; ry < rows; ry++) {
      let y0 = bbox.minY + ry * cellHeight;
      let y1 = y0 + cellHeight;
      if (gapY > 0) {
        const dy = gapY * 0.5;
        if (ry > 0) y0 += dy;
        if (ry < rows - 1) y1 -= dy;
      }
      if (!(y1 > y0)) continue;
      const offset = (ry % 2 === 1) ? rowShift : 0;
      const startX = bbox.minX + (offset > 0 ? offset - cellWidth : offset);
      const cellCount = cols + (Math.abs(offset) > 1e-6 ? 1 : 0);
      for (let cx = 0; cx < cellCount; cx++) {
        let x0 = startX + cx * cellWidth;
        let x1 = x0 + cellWidth;
        if (gapX > 0) {
          const dx = gapX * 0.5;
          if (cx > 0) x0 += dx;
          if (cx < cellCount - 1) x1 -= dx;
        }
        if (!(x1 > x0)) continue;
        const base = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
        if (!Array.isArray(base) || base.length < 3) continue;
        if (canBooleanClip && Array.isArray(zoneMulti) && zoneMulti.length) {
          const baseMulti = toBooleanMulti(base);
          if (Array.isArray(baseMulti) && baseMulti.length) {
            let mp = [];
            try { mp = pc.intersection(baseMulti, zoneMulti) || []; } catch (_) { mp = []; }
            const pieces = fromBooleanMultiOuter(mp);
            for (const piece of pieces) {
              if (polygonArea(piece) >= minArea) frags.push(piece);
            }
            continue;
          }
        }
        const clipped = clipPolygonToRect(zonePoints, x0, y0, x1, y1);
        if (!Array.isArray(clipped) || clipped.length < 3) continue;
        if (polygonArea(clipped) < minArea) continue;
        frags.push(clipped);
      }
    }
    return frags;
  }

  function generateDiagonalFragments(zonePoints, options) {
    const bbox = polygonBBox(zonePoints);
    if (!bbox || bbox.width <= 0 || bbox.height <= 0) return [];
    const bandStepMm = Math.max(10, Math.min(5000, Number(options.bandStepMm || Math.max(40, bbox.height / 5))));
    const gapX = Math.max(0, Number(options.gapX || options.gapXmm || 0));
    const gapY = Math.max(0, Number(options.gapY || options.gapYmm || 0));
    const minArea = Math.max(50, Number(options.minArea || 500));
    const axisRaw = Number(options.axisCount);
    const angleRaw = Number(options.angleDeg);
    const axisCount = Math.max(0, Math.min(6, Math.round(Number.isFinite(axisRaw) ? axisRaw : 1)));
    const angleDeg = Math.max(-89, Math.min(89, Number.isFinite(angleRaw) ? angleRaw : 45));
    const slopeAbs = Math.tan((Math.abs(angleDeg) * Math.PI) / 180);
    const orientation = angleDeg >= 0 ? 1 : -1;
    const bandGapMm = Math.max(0, Math.max(gapX, gapY));
    const pc = (typeof window !== "undefined" && window.polygonClipping) ? window.polygonClipping : null;
    const canBooleanClip = !!(pc && typeof pc.intersection === "function");
    const zoneMulti = canBooleanClip ? toBooleanMulti(zonePoints) : [];
    const frags = [];
    if (axisCount === 0) {
      const rect = [
        { x: bbox.minX, y: bbox.minY },
        { x: bbox.maxX, y: bbox.minY },
        { x: bbox.maxX, y: bbox.maxY },
        { x: bbox.minX, y: bbox.maxY }
      ];
      const linearSlope = orientation * slopeAbs;
      let minU = Number.POSITIVE_INFINITY;
      let maxU = Number.NEGATIVE_INFINITY;
      for (const p of rect) {
        const u = Number(p.y) - linearSlope * Number(p.x);
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
      }
      const bandStart = Math.floor(minU / bandStepMm) - 1;
      const bandEnd = Math.ceil(maxU / bandStepMm) + 1;
      for (let band = bandStart; band <= bandEnd; band++) {
        const u0 = band * bandStepMm + bandGapMm * 0.5;
        const u1 = (band + 1) * bandStepMm - bandGapMm * 0.5;
        if (!(u1 > u0)) continue;
        const part = clipPolygonByBand(rect.slice(), -linearSlope, 1, u0, u1);
        if (!Array.isArray(part) || part.length < 3) continue;
        if (canBooleanClip && Array.isArray(zoneMulti) && zoneMulti.length) {
          const partMulti = toBooleanMulti(part);
          let mp = [];
          try { mp = pc.intersection(partMulti, zoneMulti) || []; } catch (_) { mp = []; }
          const pieces = fromBooleanMultiOuter(mp);
          for (const piece of pieces) {
            if (polygonArea(piece) >= minArea) frags.push(piece);
          }
          continue;
        }
        const clipped = clipPolygonByPolygon(zonePoints, part); // eslint-disable-line no-undef
        if (!Array.isArray(clipped) || clipped.length < 3) continue;
        if (polygonArea(clipped) < minArea) continue;
        frags.push(clipped);
      }
      return frags;
    }
    const axisXs = [];
    for (let i = 0; i < axisCount; i++) axisXs.push(bbox.minX + ((i + 0.5) / axisCount) * bbox.width);
    for (let axisIndex = 0; axisIndex < axisXs.length; axisIndex++) {
      const axisX = axisXs[axisIndex];
      const leftBound = axisIndex === 0 ? bbox.minX : (axisXs[axisIndex - 1] + axisX) * 0.5;
      const rightBound = axisIndex === axisXs.length - 1 ? bbox.maxX : (axisX + axisXs[axisIndex + 1]) * 0.5;
      const segments = [
        { side: "left", rect: [{ x: leftBound, y: bbox.minY }, { x: axisX, y: bbox.minY }, { x: axisX, y: bbox.maxY }, { x: leftBound, y: bbox.maxY }] },
        { side: "right", rect: [{ x: axisX, y: bbox.minY }, { x: rightBound, y: bbox.minY }, { x: rightBound, y: bbox.maxY }, { x: axisX, y: bbox.maxY }] }
      ];
      for (const segment of segments) {
        const rectBBox = polygonBBox(segment.rect);
        if (!rectBBox || rectBBox.width <= 1e-6 || rectBBox.height <= 1e-6) continue;
        let minU = Number.POSITIVE_INFINITY;
        let maxU = Number.NEGATIVE_INFINITY;
        for (const p of segment.rect) {
          const u = Number(p.y) - orientation * slopeAbs * Math.abs(Number(p.x) - axisX);
          minU = Math.min(minU, u);
          maxU = Math.max(maxU, u);
        }
        const bandStart = Math.floor(minU / bandStepMm) - 1;
        const bandEnd = Math.ceil(maxU / bandStepMm) + 1;
        for (let band = bandStart; band <= bandEnd; band++) {
          const u0 = band * bandStepMm + bandGapMm * 0.5;
          const u1 = (band + 1) * bandStepMm - bandGapMm * 0.5;
          if (!(u1 > u0)) continue;
          let tri = segment.rect.slice();
          if (segment.side === "left") {
            if (orientation >= 0) {
              tri = clipPolygonByBand(tri, slopeAbs, 1, u0 + slopeAbs * axisX, u1 + slopeAbs * axisX);
            } else {
              tri = clipPolygonByBand(tri, -slopeAbs, 1, u0 - slopeAbs * axisX, u1 - slopeAbs * axisX);
            }
          } else {
            if (orientation >= 0) {
              tri = clipPolygonByBand(tri, -slopeAbs, 1, u0 - slopeAbs * axisX, u1 - slopeAbs * axisX);
            } else {
              tri = clipPolygonByBand(tri, slopeAbs, 1, u0 + slopeAbs * axisX, u1 + slopeAbs * axisX);
            }
          }
          if (!Array.isArray(tri) || tri.length < 3) continue;
          if (canBooleanClip && Array.isArray(zoneMulti) && zoneMulti.length) {
            const triMulti = toBooleanMulti(tri);
            let mp = [];
            try { mp = pc.intersection(triMulti, zoneMulti) || []; } catch (_) { mp = []; }
            const pieces = fromBooleanMultiOuter(mp);
            for (const piece of pieces) {
              if (polygonArea(piece) >= minArea) frags.push(piece);
            }
            continue;
          }
          const clipped = clipPolygonByPolygon(zonePoints, tri); // eslint-disable-line no-undef
          if (!Array.isArray(clipped) || clipped.length < 3) continue;
          if (polygonArea(clipped) < minArea) continue;
          frags.push(clipped);
        }
      }
    }
    return frags;
  }

  function generateRadialFragments(zonePoints, options) {
    const bbox = polygonBBox(zonePoints);
    if (!bbox || bbox.width <= 0 || bbox.height <= 0) return [];
    const zoneMp = pointsToMultiPolygon(zonePoints); // eslint-disable-line no-undef
    if (!Array.isArray(zoneMp) || zoneMp.length === 0) return [];
    const ringCount = Math.max(1, Math.min(20, Number(options.ringCount) || 4));
    const sectorCount = Math.max(1, Math.min(36, Number(options.sectorCount) || 8));
    const rotationDeg = Number(options.rotationDeg) || 0;
    const innerRadiusMm = Math.max(0, Number(options.innerRadiusMm) || 0);
    const centerMode = String(options.centerMode || "auto").trim();
    const centerX = centerMode === "manual" && Number.isFinite(Number(options.centerX))
      ? Number(options.centerX)
      : (bbox.minX + bbox.maxX) * 0.5;
    const centerY = centerMode === "manual" && Number.isFinite(Number(options.centerY))
      ? Number(options.centerY)
      : (bbox.minY + bbox.maxY) * 0.5;
    const gapX = Math.max(0, Number(options.gapX) || 0);
    const gapY = Math.max(0, Number(options.gapY) || 0);
    const gap = Math.max(gapX, gapY);
    const minArea = Math.max(50, Number(options.minAreaMm2) || 500);
    const rotationRad = (rotationDeg * Math.PI) / 180;
    let maxRadius = 0;
    for (const p of zonePoints || []) {
      const x = Number(p && p.x);
      const y = Number(p && p.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      maxRadius = Math.max(maxRadius, Math.hypot(x - centerX, y - centerY));
    }
    if (!(maxRadius > 0)) return [];
    const radialSpan = Math.max(1, maxRadius - innerRadiusMm);
    const ringStep = radialSpan / ringCount;
    const sectorStep = (Math.PI * 2) / sectorCount;
    const frags = [];
    function buildSectorPolygon(r0, r1, a0, a1) {
      const angleSpan = Math.abs(a1 - a0);
      const arcSegments = Math.max(6, Math.ceil(angleSpan / (Math.PI / 18)));
      const out = [];
      for (let i = 0; i <= arcSegments; i += 1) {
        const t = i / arcSegments;
        const a = a0 + (a1 - a0) * t;
        out.push({ x: centerX + Math.cos(a) * r1, y: centerY + Math.sin(a) * r1 });
      }
      for (let i = arcSegments; i >= 0; i -= 1) {
        const t = i / arcSegments;
        const a = a0 + (a1 - a0) * t;
        out.push({ x: centerX + Math.cos(a) * r0, y: centerY + Math.sin(a) * r0 });
      }
      return out;
    }
    for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
      let r0 = innerRadiusMm + ringIndex * ringStep;
      let r1 = innerRadiusMm + (ringIndex + 1) * ringStep;
      if (gap > 0) {
        const dr = gap * 0.5;
        if (ringIndex > 0) r0 += dr;
        if (ringIndex < ringCount - 1) r1 -= dr;
      }
      if (!(r1 > r0)) continue;
      for (let sectorIndex = 0; sectorIndex < sectorCount; sectorIndex += 1) {
        let a0 = rotationRad + sectorIndex * sectorStep;
        let a1 = rotationRad + (sectorIndex + 1) * sectorStep;
        if (gap > 0 && r1 > 0) {
          const da = Math.min(sectorStep * 0.45, (gap * 0.5) / Math.max(r1, 1));
          a0 += da;
          a1 -= da;
        }
        if (!(a1 > a0)) continue;
        const base = buildSectorPolygon(r0, r1, a0, a1);
        if (!Array.isArray(base) || base.length < 3) continue;
        const baseMp = pointsToMultiPolygon(base); // eslint-disable-line no-undef
        const mp = intersectMulti(baseMp, zoneMp); // eslint-disable-line no-undef
        const pieces = multiPolygonOuterRingsToPoints(mp); // eslint-disable-line no-undef
        for (const piece of pieces) {
          if (polygonArea(piece) < minArea) continue;
          frags.push(piece);
        }
      }
    }
    return frags;
  }

  function generateFragmentsForZone(zonePoints, options) {
    const fillType = String(options.fillType || "voronoi");
    let polys = [];
    if (fillType === "regular") {
      polys = String(options && options.layoutType || "") === "transverse"
        ? generateDiagonalFragments(zonePoints, options)
        : (String(options && options.layoutType || "") === "radial"
          ? generateRadialFragments(zonePoints, options)
          : (String(options && options.layoutType || "") === "shifted"
          ? generateShiftedFragments(zonePoints, options)
          : generateRegularFragments(zonePoints, options)));
    } else {
      polys = generateVoronoiFragments(zonePoints, options);
    }
    const zoneArea = polygonArea(zonePoints);
    const totalFragmentsArea = polys.reduce((acc, p) => acc + polygonArea(p), 0);
    const uncovered = Math.max(0, zoneArea - totalFragmentsArea);
    const uncoveredRatio = zoneArea > 0 ? uncovered / zoneArea : 0;
    const violations = uncoveredRatio > 0.015 ? 1 : 0;
    const _cornerRadius = Math.max(0, Number(options.cornerRadius || options.cornerRadiusMm || 0));
    return {
      fragments: polys.map((p, i) => ({ id: i + 1, points: p, ...(_cornerRadius > 0 ? { cornerRadius: _cornerRadius } : {}) })),
      stats: { violations, intersections: 0, uncovered: uncoveredRatio > 0.0001 ? 1 : 0 }
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  global.FurLabFragments = {
    generateVoronoiFragments,
    generateRegularFragments,
    generateShiftedFragments,
    generateDiagonalFragments,
    generateRadialFragments,
    generateFragmentsForZone,
  };

})(window);
