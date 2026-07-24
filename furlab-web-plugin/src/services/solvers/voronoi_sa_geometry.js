"use strict";

const ClipperLib = require("clipper-lib");

function createVoronoiSaGeometry(deps) {
  const clipperScale = deps.clipperScale || 1000;
  const pointsToMultiPolygon = deps.pointsToMultiPolygon;
  const intersectMulti = deps.intersectMulti;
  const multiPolygonArea = deps.multiPolygonArea;

  function transformPiece(centeredPts, angleDeg, tx, ty) {
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return centeredPts.map((p) => ({
      x: p.x * cos - p.y * sin + tx,
      y: p.x * sin + p.y * cos + ty
    }));
  }

  function pointInPolygon(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x;
      const yi = pts[i].y;
      const xj = pts[j].x;
      const yj = pts[j].y;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function toClipper(pts) {
    return pts.map((p) => ({
      X: Math.round(p.x * clipperScale),
      Y: Math.round(p.y * clipperScale)
    }));
  }

  function fromClipper(path) {
    return path.map((p) => ({ x: p.X / clipperScale, y: p.Y / clipperScale }));
  }

  function inflateZonePts(zonePts, offsetMm) {
    if (!offsetMm || offsetMm <= 0) return zonePts;
    try {
      const co = new ClipperLib.ClipperOffset();
      co.AddPath(toClipper(zonePts), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
      const sol = new ClipperLib.Paths();
      co.Execute(sol, Math.round(offsetMm * clipperScale));
      if (!sol || !sol.length) return zonePts;
      let best = null;
      let bestArea = 0;
      for (const p of sol) {
        const a = Math.abs(ClipperLib.Clipper.Area(p));
        if (a > bestArea) {
          bestArea = a;
          best = p;
        }
      }
      return best ? fromClipper(best) : zonePts;
    } catch (_) {
      return zonePts;
    }
  }

  function computeIFP(zonePts, centeredPts) {
    try {
      const paths = ClipperLib.Clipper.MinkowskiDiff(toClipper(zonePts), toClipper(centeredPts));
      if (!paths || paths.length === 0) return null;
      let best = null;
      let bestArea = 0;
      for (const path of paths) {
        const a = Math.abs(ClipperLib.Clipper.Area(path));
        if (a > bestArea) {
          bestArea = a;
          best = path;
        }
      }
      if (!best || best.length < 3) return null;
      return fromClipper(best);
    } catch (_) {
      return null;
    }
  }

  function sampleInPoly(poly, bbox, rng) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const x = bbox.minX + rng.next() * (bbox.maxX - bbox.minX);
      const y = bbox.minY + rng.next() * (bbox.maxY - bbox.minY);
      if (pointInPolygon(x, y, poly)) return { x, y };
    }
    return null;
  }

  function mpToPoints(mp) {
    if (!Array.isArray(mp) || !mp.length) return [];
    const poly = mp[0];
    if (!Array.isArray(poly) || !poly.length) return [];
    const ring = poly[0];
    if (!Array.isArray(ring) || ring.length < 4) return [];
    const pts = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const x = Number(ring[i][0]);
      const y = Number(ring[i][1]);
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
    }
    return pts.length >= 3 ? pts : [];
  }

  function ringAreaSigned(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      s += Number(a.x) * Number(b.y) - Number(b.x) * Number(a.y);
    }
    return s * 0.5;
  }

  function offsetContourInward(pts, offsetMm) {
    if (!pts || pts.length < 3 || offsetMm <= 0) return pts;
    const path = toClipper(pts);
    if (ringAreaSigned(pts) < 0) path.reverse();
    const co = new ClipperLib.ClipperOffset(2, 0.25 * clipperScale);
    co.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const out = new ClipperLib.Paths();
    co.Execute(out, -offsetMm * clipperScale);
    if (!out || !out.length) return [];
    const best = out.reduce((a, b) => (b.length > a.length ? b : a), out[0]);
    const result = fromClipper(best);
    return result.length >= 3 ? result : [];
  }

  // ── Чистка контура кандидата (до расчёта припуска) ─────────────────────────
  // Отсканированные обрезки зубчатые, и партиция честно обводит эти зубцы: замер
  // 2026-07-24 показал, что 16 из 16 заломов шва лежат ТОЧНО на контуре ядра
  // (медиана расстояния 0.00мм). То есть кривизна швов родом из скана, а не из
  // способа деления зоны — до этого её безуспешно лечили тремя способами со
  // стороны партиции.
  //
  // ЖЁСТКИЙ ИНВАРИАНТ: результат ⊆ исходного контура. Мех можно только терять
  // (срезать), но не выдумывать. Поэтому:
  //   1) упрощение Дугласа-Пекера + пересечение с исходником — срезает мелкие
  //      зубцы и заусенцы; там, где упрощённая линия выходит наружу, пересечение
  //      возвращает её обратно на исходный контур;
  //   2) морфологическое открытие радиусом tol/2 — срезает узкие выступы;
  //   3) финальное пересечение с исходником — страховка инварианта.
  // Вырезы (вогнутые выемки) НЕ заполняются: там материала нет. Их сглаживает
  // только п.1, и только срезанием наружного края, а не достройкой.
  function _dpSimplify(pts, tolMm) {
    if (!pts || pts.length < 4 || !(tolMm > 0)) return pts;
    const n = pts.length;
    const keep = new Uint8Array(n);
    keep[0] = 1;
    const distSeg = (p, a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      let t = L2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    };
    // замкнутый контур: рекурсия по двум половинам между самой дальней парой
    const stack = [[0, n - 1]];
    keep[n - 1] = 1;
    while (stack.length) {
      const [i0, i1] = stack.pop();
      let far = -1, maxD = tolMm;
      for (let i = i0 + 1; i < i1; i++) {
        const d = distSeg(pts[i], pts[i0], pts[i1]);
        if (d > maxD) { maxD = d; far = i; }
      }
      if (far >= 0) { keep[far] = 1; stack.push([i0, far], [far, i1]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
    return out.length >= 3 ? out : pts;
  }

  function _offsetPaths(paths, deltaMm) {
    const co = new ClipperLib.ClipperOffset(2, 0.25 * clipperScale);
    // jtMiter, не jtRound: скругление разбивает угол на дугу из мелких звеньев,
    // то есть меняет один излом на десяток — ровно против цели прямых швов.
    for (const p of paths) co.AddPath(p, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const out = new ClipperLib.Paths();
    co.Execute(out, deltaMm * clipperScale);
    return out || [];
  }

  function _intersectWithOriginal(paths, originalPath) {
    const cpr = new ClipperLib.Clipper();
    for (const p of paths) cpr.AddPath(p, ClipperLib.PolyType.ptSubject, true);
    cpr.AddPath(originalPath, ClipperLib.PolyType.ptClip, true);
    const sol = new ClipperLib.Paths();
    cpr.Execute(ClipperLib.ClipType.ctIntersection, sol,
      ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    return sol || [];
  }

  function cleanCandidateContour(pts, tolMm) {
    if (!pts || pts.length < 3 || !(tolMm > 0)) return pts;
    const orig = toClipper(pts);
    if (ringAreaSigned(pts) < 0) orig.reverse();
    try {
      const simplified = _dpSimplify(pts, tolMm);
      let paths = _intersectWithOriginal([toClipper(simplified)], orig);
      if (!paths.length) return pts;
      const r = tolMm / 2;
      let opened = _offsetPaths(paths, -r);
      if (opened && opened.length) {
        opened = _offsetPaths(opened, r);
        if (opened && opened.length) paths = _intersectWithOriginal(opened, orig);
      }
      if (!paths.length) return pts;
      const best = paths.reduce((a, b) => (Math.abs(ClipperLib.Clipper.Area(b)) > Math.abs(ClipperLib.Clipper.Area(a)) ? b : a), paths[0]);
      const result = fromClipper(best);
      return result.length >= 3 ? result : pts;
    } catch (_) {
      return pts;
    }
  }

  function sealFragment(fragPts, placementIdx, placements) {
    if (!fragPts || fragPts.length < 3) return fragPts;
    const pl = placements[placementIdx];
    // Lloyd-tiling territories must not be clipped to piece body
    if (pl && pl._lloydTile) return fragPts;
    if (!pl || !pl.corePts || pl.corePts.length < 3) return fragPts;
    try {
      const ci = new ClipperLib.Clipper();
      ci.AddPath(toClipper(fragPts), ClipperLib.PolyType.ptSubject, true);
      ci.AddPath(toClipper(pl.corePts), ClipperLib.PolyType.ptClip, true);
      const iSol = new ClipperLib.Paths();
      ci.Execute(
        ClipperLib.ClipType.ctIntersection,
        iSol,
        ClipperLib.PolyFillType.pftNonZero,
        ClipperLib.PolyFillType.pftNonZero
      );
      const best = (iSol || []).reduce((b, p) =>
        Math.abs(ClipperLib.Clipper.Area(p)) > Math.abs(ClipperLib.Clipper.Area(b)) ? p : b, iSol[0]);
      if (!best) return fragPts;
      const clipped = fromClipper(best);
      return clipped.length >= 3 ? clipped : fragPts;
    } catch (_) {
      return fragPts;
    }
  }

  function coreFragmentForTerritory(territoryPts, placementIdx, placements) {
    if (!territoryPts || territoryPts.length < 3) return [];
    const pl = placementIdx != null ? placements[placementIdx] : null;
    // Lloyd-tiling: territory IS the fragment — no core clipping
    if (pl && pl._lloydTile) return territoryPts;
    if (!pl || !pl.corePts || pl.corePts.length < 3) return [];
    try {
      const coreMp = intersectMulti(pointsToMultiPolygon(pl.corePts), pointsToMultiPolygon(territoryPts));
      return coreMp && multiPolygonArea(coreMp) >= 1 ? mpToPoints(coreMp) : [];
    } catch (_) {
      return [];
    }
  }

  return {
    transformPiece,
    pointInPolygon,
    inflateZonePts,
    computeIFP,
    sampleInPoly,
    mpToPoints,
    ringAreaSigned,
    offsetContourInward,
    cleanCandidateContour,
    sealFragment,
    coreFragmentForTerritory
  };
}

module.exports = { createVoronoiSaGeometry };
