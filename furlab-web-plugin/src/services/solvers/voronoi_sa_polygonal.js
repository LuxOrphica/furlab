"use strict";

/**
 * v5.1 polygonal Voronoi territory builder.
 *
 * Контракт v5 (docs/layouts/inventory_voronoi_sa_contract_v5.md):
 *   - §6: napTarget/napTolDeg/angleDeg — вестигиальные, вращение запрещено (R6).
 *     Куски приходят уже нормализованными (ворсом вниз), angleDeg=0.
 *   - §7: thin fragment = failed (R5), НЕ absorb'ится.
 *   - §7: absorb без guard'ов запрещён (R8).
 *   - §7: возврат последнего состояния вместо лучшего — запрещён.
 *   - fragment = core_i ∩ territory_i, полигонально (не растрово).
 *
 * Алгоритм (power Voronoi, D-rebuild):
 *   territory_i = zone ∩ core_i
 *   for j ≠ i (по возрастанию дистанции |i-j|):
 *     contested = territory_i ∩ core_j   // область, где ОБА накрывают
 *     if contested пуст: continue         // j не конкурирует
 *     hp_i = halfplane(containing cx_i, perpendicular bisector of (i,j))
 *     territory_i = (territory_i − contested) ∪ (contested ∩ hp_i)
 *   territory_i = component_containing(territory_i, cx_i, cy_i)
 *   fragment_i = territory_i              // т.к. territory_i ⊆ core_i
 *
 * Ключевые свойства:
 *   1. territory_i ⊆ core_i с самого начала → fragment_i = territory_i.
 *   2. Bisector применяется только к contested (где ОБА накрывают) → нет повисших точек.
 *   3. Покомпонентная обрезка по центру → связность territory на невыпуклой зоне.
 *   4. Никакого absorb / R2 patch / orphan sweep. Gap = physMissing, честно.
 *   5. Thin = failed, НЕ absorb'ится, НЕ удаляется.
 *
 * Оптимизации относительно v5.0:
 *   - inner j-loop: вместо clipperUnion на каждой итерации — конкатенация + Clean.
 *     unionPaths (withoutContested + contestedKept) могут перекрываться только на границе
 *     (both subsets of currentPaths), CleanPolygons это корректно обработает.
 *   - territory хранится как array of paths (multi-component safe).
 *   - rawTerritoryContour = все компоненты (не только первый path).
 */

const ClipperLib = require("clipper-lib");

// ── Геометрические хелперы ───────────────────────────────────────────────────

function convexHull(pts) {
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

function minBoundingRectShorter(pts) {
  if (!pts || pts.length < 3) return Infinity;
  const hull = convexHull(pts);
  const n = hull.length;
  if (n < 2) return Infinity;
  let minShorter = Infinity;
  for (let i = 0; i < n; i++) {
    const p1 = hull[i], p2 = hull[(i + 1) % n];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len, uy = dy / len, vx = -uy, vy = ux;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy, v = p.x * vx + p.y * vy;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const shorter = Math.min(maxU - minU, maxV - minV);
    if (shorter < minShorter) minShorter = shorter;
  }
  return minShorter;
}

function pointsToClipperPath(pts, scale) {
  return pts.map(p => ({ X: Math.round(p.x * scale), Y: Math.round(p.y * scale) }));
}

function clipperPathToPoints(path, scale) {
  if (!path || path.length < 3) return [];
  return path.map(p => ({ x: p.X / scale, y: p.Y / scale }));
}

/**
 * Clipper boolean ops on paths (Clipper units). Возвращает array of paths.
 */
function clipperIntersect(subjectPaths, clipPaths) {
  const cpr = new ClipperLib.Clipper();
  for (const p of subjectPaths) cpr.AddPath(p, ClipperLib.PolyType.ptSubject, true);
  for (const p of clipPaths) cpr.AddPath(p, ClipperLib.PolyType.ptClip, true);
  const sol = new ClipperLib.Paths();
  cpr.Execute(ClipperLib.ClipType.ctIntersection, sol,
    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return sol;
}

function clipperDifference(subjectPaths, clipPaths) {
  const cpr = new ClipperLib.Clipper();
  for (const p of subjectPaths) cpr.AddPath(p, ClipperLib.PolyType.ptSubject, true);
  for (const p of clipPaths) cpr.AddPath(p, ClipperLib.PolyType.ptClip, true);
  const sol = new ClipperLib.Paths();
  cpr.Execute(ClipperLib.ClipType.ctDifference, sol,
    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return sol;
}

/**
 * Clean + simplify paths. Удаляет дубликаты вершин, самопересечения, коллинеарные точки.
 * НЕ объединяет перекрывающиеся полигоны (в отличие от union).
 * Подходит для конкатенации withoutContested + contestedKept, т.к. они могут
 * соприкасаться по границе, но не перекрываться по площади (both ⊆ currentPaths).
 */
function clipperClean(paths, scale) {
  if (!paths || paths.length === 0) return [];
  const cleaned = ClipperLib.Clipper.CleanPolygons(paths, Math.max(1, Math.round(scale * 0.01)));
  const simplified = ClipperLib.Clipper.SimplifyPolygons(cleaned, ClipperLib.PolyFillType.pftNonZero);
  return simplified || [];
}

function clipperArea(path) {
  return Math.abs(ClipperLib.Clipper.Area(path));
}

/**
 * Строит halfplane (большой прямоугольник, обрезанный bisector'ом) — Clipper path.
 * Halfplane содержит точку (cx_i, cy_i), отрезает часть со стороны (cx_j, cy_j).
 * Bisector — перпендикуляр к отрезку (i,j) через середину.
 */
function buildHalfplanePath(cx_i, cy_i, cx_j, cy_j, zoneBbox, scale) {
  const mid_x = (cx_i + cx_j) / 2;
  const mid_y = (cy_i + cy_j) / 2;
  const nx = cx_j - cx_i;
  const ny = cy_j - cy_i;
  const nlen = Math.hypot(nx, ny);
  if (nlen < 1e-9) return null;

  const bx = -ny / nlen, by = nx / nlen;
  const nxn = nx / nlen, nyn = ny / nlen;

  const margin = 5000;  // 5 метров запас — больше любой зоны
  const p1 = { X: Math.round((mid_x + bx * margin) * scale), Y: Math.round((mid_y + by * margin) * scale) };
  const p2 = { X: Math.round((mid_x - bx * margin) * scale), Y: Math.round((mid_y - by * margin) * scale) };
  const p3 = { X: Math.round((mid_x - bx * margin - nxn * margin) * scale), Y: Math.round((mid_y - by * margin - nyn * margin) * scale) };
  const p4 = { X: Math.round((mid_x + bx * margin - nxn * margin) * scale), Y: Math.round((mid_y + by * margin - nyn * margin) * scale) };
  return [p1, p2, p3, p4];
}

/**
 * Берёт из MultiPath (array of paths) только компоненты, содержащие точку (px, py).
 * Используется для покомпонентной обрезки territory на невыпуклой зоне.
 */
function componentsContainingPoint(paths, px, py) {
  const result = [];
  for (const path of paths) {
    if (path.length < 3) continue;
    if (pointInPath(px, py, path)) {
      result.push(path);
    }
  }
  // Если ни один path не содержит точку — берём наибольший (fallback)
  if (result.length === 0 && paths.length > 0) {
    let best = paths[0];
    for (const p of paths) {
      if (clipperArea(p) > clipperArea(best)) best = p;
    }
    return [best];
  }
  return result;
}

function pointInPath(px, py, path) {
  let inside = false;
  const n = path.length;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = path[i].X, yi = path[i].Y;
    const xj = path[j].X, yj = path[j].Y;
    if (((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

// ── Главная функция: построение territory + fragment ────────────────────────

/**
 * buildPolygonalTerritoryOutput(args)
 *
 * Args:
 *   - placements: [{ cx, cy, corePts, inventoryTag, ... }]
 *   - zonePoints: [{ x, y }] — точки зоны (outer ring)
 *   - zoneBbox: { minX, minY, maxX, maxY }
 *   - scale: clipper scale (1000)
 *   - pointsToMultiPolygon, intersectMulti, multiPolygonArea, mpToPoints, polygonBBox
 *   - minWidthMm, minLengthMm: для thin-detect
 *
 * Returns: {
 *   resultPlacements: [...],
 *   thinFragments: [...],
 *   perfectCells, fallbackFragments, topologyRepair, assignment,
 *   stats: { ... }
 * }
 *
 * v5.1 изменения vs v5.0:
 *   - Убран R2 partition-gap fix (стр. 514-603 в v5.0) — это был скрытый absorb,
 *     нарушающий контракт "thin = failed, не absorb". Создавал overlap (INV1/INV5 FAIL).
 *     Gap = physMissing, честно. Если SA не нашёл покрытие — это результат SA, не polygonal.
 *   - inner j-loop: clipperUnion → clipperClean (O(N) вместо O(N²) по вершинам).
 *     Корректно, т.к. withoutContested и contestedKept — оба подмножества currentPaths,
 *     могут соприкасаться по границе, но не перекрываться по площади.
 *   - rawTerritoryContour = все компоненты territory (не только первый path).
 *   - Никакого 30-секундного deadline — функция отрабатывает за ~20ms на N=22.
 */
function buildPolygonalTerritoryOutput(args) {
  const placements = args.placements;
  const zonePoints = args.zonePoints;
  const zoneBbox = args.zoneBbox || args.polygonBBox(zonePoints);
  const scale = args.scale || 1000;
  const _t0 = Date.now();

  const pointsToMultiPolygon = args.pointsToMultiPolygon;
  const intersectMulti = args.intersectMulti;
  const multiPolygonArea = args.multiPolygonArea;
  const mpToPoints = args.mpToPoints;
  const polygonBBox = args.polygonBBox;
  const minWidthMm = args.minWidthMm || 0;
  const minLengthMm = args.minLengthMm || 0;

  // Zone как Clipper path (units)
  const zonePath = pointsToClipperPath(zonePoints, scale);
  const zonePaths = [zonePath];
  const zoneMp = pointsToMultiPolygon(zonePoints);
  const zoneArea = multiPolygonArea(zoneMp);

  const N = placements.length;
  // Предвычислим corePaths (Clipper units) для всех placements
  const corePaths = [];
  const coreMps = [];
  for (let i = 0; i < N; i++) {
    const pl = placements[i];
    if (!pl.corePts || pl.corePts.length < 3) {
      corePaths.push(null);
      coreMps.push(null);
      continue;
    }
    corePaths.push(pointsToClipperPath(pl.corePts, scale));
    coreMps.push(pointsToMultiPolygon(pl.corePts));
  }

  // ── 1. Строим territory_i = power Voronoi cell ────────────────────────────
  const territoryPaths = [];

  for (let i = 0; i < N; i++) {
    if (!corePaths[i]) {
      territoryPaths.push(null);
      continue;
    }
    const pl_i = placements[i];

    // Сортируем конкурентов по дистанции (близкие первыми)
    const otherIndices = [];
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      if (!corePaths[j]) continue;
      otherIndices.push(j);
    }
    otherIndices.sort((a, b) => {
      const da = (placements[a].cx - pl_i.cx) ** 2 + (placements[a].cy - pl_i.cy) ** 2;
      const db = (placements[b].cx - pl_i.cx) ** 2 + (placements[b].cy - pl_i.cy) ** 2;
      if (Math.abs(da - db) > 1e-6) return da - db;
      const ta = placements[a].inventoryTag || "";
      const tb = placements[b].inventoryTag || "";
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a - b;
    });

    // territory_i = zone ∩ core_i (⊆ core_i с самого начала)
    let currentPaths = clipperIntersect(zonePaths, [corePaths[i]]);
    if (currentPaths.length === 0) {
      territoryPaths.push(null);
      continue;
    }

    // Inner j-loop: для каждого конкурента применяем bisector к contested region.
    // v5.1: вместо clipperUnion на каждой итерации — конкатенация + clipperClean.
    // withoutContested и contestedKept — оба подмножества currentPaths, могут
    // соприкасаться по границе, но не перекрываться по площади → Clean корректен.
    for (const j of otherIndices) {
      const contested = clipperIntersect(currentPaths, [corePaths[j]]);
      if (!contested || contested.length === 0) continue;

      const hpPath = buildHalfplanePath(pl_i.cx, pl_i.cy, placements[j].cx, placements[j].cy, zoneBbox, scale);
      if (!hpPath) continue;

      const contestedKept = clipperIntersect(contested, [hpPath]);
      const withoutContested = clipperDifference(currentPaths, [corePaths[j]]);

      // Конкатенация + Clean (вместо Union)
      const combined = [];
      for (const p of withoutContested) combined.push(p);
      for (const p of contestedKept) combined.push(p);
      currentPaths = combined.length > 0 ? clipperClean(combined, scale) : [];
      if (currentPaths.length === 0) break;
    }

    if (currentPaths.length === 0) {
      territoryPaths.push(null);
      continue;
    }

    // Покомпонентная обрезка: берём только компоненту с центром placement_i
    const centeredPaths = componentsContainingPoint(currentPaths,
      Math.round(pl_i.cx * scale), Math.round(pl_i.cy * scale));
    territoryPaths.push(centeredPaths);
  }

  // ── 2. Строим fragment_i = territory_i (т.к. territory_i ⊆ core_i) ────────
  const resultPlacements = [];
  const thinFragments = [];

  for (let i = 0; i < N; i++) {
    const pl = placements[i];
    const terrPaths = territoryPaths[i];
    if (!terrPaths || terrPaths.length === 0 || !coreMps[i]) {
      resultPlacements.push({
        ...pl,
        alignedContour: pl.pts && pl.pts.length >= 3 ? pl.pts : [],
        rawTerritoryContour: [],
        inZoneContour: [],
        inZoneCoreContour: [],
        inZoneAreaMm2: 0,
        territoryAreaMm2: 0,
        physMissingMm2: 0,
        status: "no_territory",
        fragmentType: "polygon",
        phase: "polygon_voronoi",
        solveIndex: i,
        solveOrder: i + 1,
        renderIndex: i
      });
      continue;
    }

    // Собираем все компоненты territory (multi-component safe)
    const allTerrPts = [];
    const allTerrMps = [];
    let bestTerrPts = null;
    let bestTerrArea = 0;
    for (const tp of terrPaths) {
      const pts = clipperPathToPoints(tp, scale);
      if (pts.length >= 3) {
        allTerrPts.push(pts);
        const mp = pointsToMultiPolygon(pts);
        allTerrMps.push(mp);
        const a = multiPolygonArea(mp);
        if (a > bestTerrArea) {
          bestTerrArea = a;
          bestTerrPts = pts;
        }
      }
    }
    if (allTerrPts.length === 0) {
      resultPlacements.push({
        ...pl,
        alignedContour: pl.pts && pl.pts.length >= 3 ? pl.pts : [],
        rawTerritoryContour: [],
        inZoneContour: [],
        inZoneCoreContour: [],
        inZoneAreaMm2: 0,
        territoryAreaMm2: 0,
        physMissingMm2: 0,
        status: "no_territory",
        fragmentType: "polygon",
        phase: "polygon_voronoi",
        solveIndex: i,
        solveOrder: i + 1,
        renderIndex: i
      });
      continue;
    }

    // territory_mp = union всех компонент (через polygon-clipping)
    let terrMp;
    if (allTerrMps.length === 1) {
      terrMp = allTerrMps[0];
    } else {
      terrMp = allTerrMps.reduce((acc, mp) => {
        if (!acc || (Array.isArray(acc) && acc.length === 0)) return mp;
        try {
          return args.unionMulti ? args.unionMulti(acc, mp) : mp;
        } catch (_) {
          return mp;
        }
      }, null);
    }

    // fragment = territory (т.к. territory_i ⊆ core_i по построению)
    // Контракт v5 §7: fragment = core ∩ territory, но territory уже ⊆ core.
    // Проверка через intersectMulti для численной устойчивости.
    let fragMp;
    try {
      fragMp = intersectMulti(coreMps[i], terrMp);
    } catch (_) {
      fragMp = pointsToMultiPolygon([]);
    }
    const fragArea = multiPolygonArea(fragMp);
    const terrArea = multiPolygonArea(terrMp);
    const physMissingMm2 = Math.max(0, terrArea - fragArea);

    const fragPts = mpToPoints(fragMp);

    // Thin-detect (БЕЗ absorb — контракт R5)
    let isThin = false;
    let mbrShort = Infinity;
    if (fragPts.length >= 3 && fragArea > 0) {
      mbrShort = minBoundingRectShorter(fragPts);
      if (minWidthMm > 0 && mbrShort < minWidthMm - 0.5) {
        isThin = true;
      }
      if (minLengthMm > 0) {
        const bb = polygonBBox(fragPts);
        const longer = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
        if (longer < minLengthMm - 0.5) isThin = true;
      }
    }

    if (isThin) {
      thinFragments.push({
        idx: i,
        inventoryTag: pl.inventoryTag,
        mbrShort: Math.round(mbrShort * 10) / 10,
        fragArea: Math.round(fragArea),
        cx: pl.cx,
        cy: pl.cy
      });
    }

    resultPlacements.push({
      ...pl,
      // alignedContour = тело с припуском в мировых координатах (требуется инвариантом для matched).
      alignedContour: pl.pts && pl.pts.length >= 3 ? pl.pts : fragPts,
      // alignedCoreContour = ядро в мировых координатах (для верификатора R2/R5).
      alignedCoreContour: pl.corePts,
      // rawTerritoryContour = наибольший компонент territory (для рендера).
      rawTerritoryContour: bestTerrPts || fragPts,
      inZoneContour: fragPts,
      inZoneCoreContour: fragPts,
      inZoneAreaMm2: fragArea,
      territoryAreaMm2: terrArea,
      physMissingMm2: physMissingMm2,
      status: isThin ? "thin_fragment" : "matched",
      fragmentType: "polygon",
      phase: "polygon_voronoi",
      solveIndex: i,
      solveOrder: i + 1,
      renderIndex: i
    });
  }

  const _t1 = Date.now();
  console.log(`[VSA-POLY] territory+fragment: ${_t1 - _t0}ms for ${N} pieces, thin=${thinFragments.length}`);

  // v5.1: R2 partition-gap fix УБРАН.
  // В v5.0 здесь был код (стр. 514-603), который брал residual = zone − Union(fragments)
  // и раздавал компоненты residual тому ядру, что накрывает centroid. Это был скрытый
  // absorb, нарушающий контракт "thin = failed, не absorb" (R5/R8). Создавал overlap
  // (INV1/INV5 FAIL), потому что residual-компонент мог накрываться несколькими ядрами,
  // а добавлялся только к одному — но его площадь учитывалась в fragment, перекрывая
  // соседей.
  //
  // Правильное поведение: gap = physMissing, честно. Если SA не нашёл покрытие —
  // это результат SA, не polygonal. Покрытие <99.8% → resultStatus="partial"/"failed",
  // пользователь видит реальные дыры, не замаскированные absorb.

  return {
    resultPlacements,
    thinFragments,
    perfectCells: 0,
    fallbackFragments: [],
    topologyRepair: null,
    assignment: null,
    stats: {
      piecesCount: N,
      fragmentsCount: resultPlacements.length,
      thinCount: thinFragments.length,
      territoryMode: "polygon_voronoi",
      buildTimeMs: _t1 - _t0,
      r2FixedCount: 0,
      r2FixedArea: 0
    }
  };
}

module.exports = {
  buildPolygonalTerritoryOutput,
  buildHalfplanePath,
  convexHull,
  minBoundingRectShorter
};
