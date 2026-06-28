"use strict";

/**
 * v5.0 Fix тип D-rebuild-minimal: полигональная Voronoi-нарезка territory.
 *
 * Принципы (с правками советника):
 *   1. Power/weighted Voronoi: territory_i — ближайший центр СРЕДИ ТЕХ, чьё ядро
 *      накрывает точку. Не «ближайший вообще». Лечит gap[2] (точку накрывают 3 ядра,
 *      Voronoi по расстоянию отдаёт ближайшему, но его ядро может не накрывать).
 *   2. Покомпонентная обрезка по невыпуклой зоне: territory_i = компонента zone
 *      ∩ halfplanes, содержащая центр placement_i. Halfplane-нарезка на невыпуклой
 *      зоне даёт несвязные территории → развал фрагмента → thin. Лечится взятием
 *      только компоненты с центром.
 *   3. Thin < 70 в финале = failed с diagnostic. НЕ absorb'ится. НЕ удаляется
 *      в цикле (петля/недетерминизм/add_loop). Чинить посадку в дизайне SA,
 *      не реактивно.
 *
 * Алгоритм:
 *   territory_i = zone
 *   for j ≠ i:
 *     contested = territory_i ∩ core_j  (регион, где j может конкурировать)
 *     if contested пуст: continue
 *     hp_i = halfplane(containing cx_i, perpendicular bisector of (i,j))
 *     territory_i = (territory_i − contested) ∪ (contested ∩ hp_i)
 *   // берём только компоненту, содержащую (cx_i, cy_i)
 *   territory_i = largest_component_containing(territory_i, cx_i, cy_i)
 *   fragment_i = core_i ∩ territory_i
 *
 * Замечания:
 *   - Если ядро_j не пересекает territory_i → j не конкурирует за этот регион,
 *     bisector не нужен. Это делает алгоритм O(N × average_intersect_count),
 *     не O(N²) всегда.
 *   - Если ядро_i не накрывает какую-то часть zone, эта часть НЕ в territory_i
 *     (потому что fragment_i = core_i ∩ territory_i, и empty territory там не поможет).
 *     Это physMissing — честно, не absorb.
 *   - Tie-break при равноудалённых центрах: детерминированный по inventoryTag asc
 *     → idx asc (через порядок halfplane clipping).
 *
 * Выкинутые pass'ы (всё в старом voronoi_sa_output.js):
 *   - CPT PH-0 covByCell (растровое покрытие)
 *   - buildAssignment (растровый assignment по mask)
 *   - rebuildFragPoly (cellMp из union cell-rects)
 *   - repairDisconnectedAssignment (покомпонентная обрезка по зоне + Voronoi cell связен)
 *   - PH3 thin-absorb (ЗАПРЕЩЁН по контракту, thin = failed)
 *   - CPT-B contested (power Voronoi решает contested в halfplane clipping)
 *   - Pass 4 orphan sweep (orphan = physMissing, честно)
 *   - Pass 5 R2 safety-net (partition-gap невозможен при правильном territory)
 */

const ClipperLib = require("clipper-lib");

// ── Геометрические хелперы ───────────────────────────────────────────────────

function convexHull(pts) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const sorted = pts.slice().sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
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

function clipperUnion(paths) {
  const cpr = new ClipperLib.Clipper();
  for (const p of paths) cpr.AddPath(p, ClipperLib.PolyType.ptSubject, true);
  const sol = new ClipperLib.Paths();
  cpr.Execute(ClipperLib.ClipType.ctUnion, sol,
    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return sol;
}

function clipperArea(path) {
  return Math.abs(ClipperLib.Clipper.Area(path));
}

/**
 * Строит halfplane (большой прямоугольник, обрезанный bisector'ом) —Clipper path.
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

  // halfplane_i: точки P такие что (P - mid) · (nx, ny) <= 0 (со стороны i)
  // Эквивалентно: P ближе к i, чем к j.
  // Строим как большой прямоугольник, обрезанный bisector'ом.

  // Bisector direction (parallel to bisector line): (-ny, nx) normalized
  const bx = -ny / nlen, by = nx / nlen;
  // Normal to bisector (pointing from i to j): (nx, ny) / nlen
  const nxn = nx / nlen, nyn = ny / nlen;

  const margin = 5000;  // 5 метров запас — больше любой зоны
  // 4 угла halfplane_i:
  //   2 на bisector (mid ± bx*margin)
  //   2 со стороны i (mid + (-nxn, -nyn)*margin ± bx*margin)
  const p1 = { X: Math.round((mid_x + bx * margin) * scale), Y: Math.round((mid_y + by * margin) * scale) };
  const p2 = { X: Math.round((mid_x - bx * margin) * scale), Y: Math.round((mid_y - by * margin) * scale) };
  const p3 = { X: Math.round((mid_x - bx * margin - nxn * margin) * scale), Y: Math.round((mid_y - by * margin - nyn * margin) * scale) };
  const p4 = { X: Math.round((mid_x + bx * margin - nxn * margin) * scale), Y: Math.round((mid_y + by * margin - nyn * margin) * scale) };
  return [p1, p2, p3, p4];
}

/**
 * Берёт из MultiPath (array of paths) только компоненты, содержащие точку (px, py).
 * Используется для покомпонентной обрезки territory на невыпуклой зоне.
 *
 * Алгоритм: для каждого path проверяем pointInPolygon (ray casting).
 * Возвращаем array of paths (только те, что содержат точку).
 * NB: holes (внутренние контуры) не считаем отдельными компонентами.
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
  // Ray casting на Clipper path (X, Y — integer units)
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
 *   resultPlacements: [{ ...pl, rawTerritoryContour, inZoneContour, inZoneCoreContour, inZoneAreaMm2, ... }],
 *   thinFragments: [{ idx, inventoryTag, mbrShort, fragArea, cx, cy }],
 *   stats: { ... }
 * }
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
  const diffMulti = args.diffMulti;
  const minWidthMm = args.minWidthMm || 0;
  const minLengthMm = args.minLengthMm || 0;

  // Zone как Clipper path (units)
  const zonePath = pointsToClipperPath(zonePoints, scale);
  const zonePaths = [zonePath];  // subject для boolean ops
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
  // territory_i = zone, then for j ≠ i: если core_j пересекает territory_i,
  // применяем bisector(i,j) к contested region.
  const territoryPaths = [];  // array of array-of-Clipper-paths (может быть несколько компонент)

  for (let i = 0; i < N; i++) {
    if (!corePaths[i]) {
      territoryPaths.push(null);
      continue;
    }
    const pl_i = placements[i];
    // territory_i = zone ∩ core_i (ограничена core_i с самого начала — см. D-tune ниже)

    // Идём по j ≠ i. Tie-break: сортируем по inventoryTag asc → idx asc
    // для детерминизма при равноудалённых центрах.
    const otherIndices = [];
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      if (!corePaths[j]) continue;
      otherIndices.push(j);
    }
    // Сортировка: по дистанции от i до j (близкие конкуренты первыми — раньше заберут contested)
    otherIndices.sort((a, b) => {
      const da = (placements[a].cx - pl_i.cx) ** 2 + (placements[a].cy - pl_i.cy) ** 2;
      const db = (placements[b].cx - pl_i.cx) ** 2 + (placements[b].cy - pl_i.cy) ** 2;
      if (Math.abs(da - db) > 1e-6) return da - db;
      const ta = placements[a].inventoryTag || "";
      const tb = placements[b].inventoryTag || "";
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a - b;
    });

    // v5.0 Fix D-tune (правка 1 советника, финальная): territory_i ограничена core_i
    // С САМОГО НАЧАЛА. Точка зоны, не накрытая core_i — НЕ в territory_i, независимо
    // от bisector. Это устраняет partition-gap по построению:
    //   - Точка P накрыта только core_i → P в territory_i (никто не конкурирует) → fragment_i ✓
    //   - Точка P накрыта core_i и core_j → bisector(i,j) делит, P ближайшему → fragment ✓
    //   - Точка P накрыта только core_j (не core_i) → P не в territory_i → не конкурирует с i
    //
    // Bisector(i,j) применяется к contested = territory_i ∩ core_j (область, где ОБА накрывают,
    // т.к. territory_i уже ⊆ core_i). Вне contested — точка принадлежит только i (если накрыта
    // только core_i) или только j (если накрыта только core_j, и тогда она в territory_j, не i).
    //
    // Раньше: territory_i начиналась как zone (без ∩ core_i), и bisector мог отдать точку
    // к j даже если core_j не накрывает её → точка повисала (ни в чьём фрагменте) → gap.
    let currentPaths = clipperIntersect(zonePaths, [corePaths[i]]);  // ⊆ core_i с самого начала
    if (currentPaths.length === 0) {
      territoryPaths.push(null);
      continue;
    }

    for (const j of otherIndices) {
      const pl_j = placements[j];
      // contested = currentPaths ∩ core_j (область, где ОБА накрывают — т.к. currentPaths ⊆ core_i)
      const contested = clipperIntersect(currentPaths, [corePaths[j]]);
      if (!contested || contested.length === 0) continue;  // j не конкурирует (core_j не пересекает)

      // halfplane_i (ближе к i, чем к j) — Clipper path
      const hpPath = buildHalfplanePath(pl_i.cx, pl_i.cy, pl_j.cx, pl_j.cy, zoneBbox, scale);
      if (!hpPath) continue;

      // contested_kept_i = contested ∩ halfplane_i (точки contested, ближе к i)
      const contestedKept = clipperIntersect(contested, [hpPath]);

      // territory_i = (currentPaths − contested) ∪ contestedKept
      //   − contested: убираем область, где j конкурирует (она уйдёт к j или к i по bisector)
      //   + contestedKept: возвращаем часть contested, что ближе к i
      // Точки вне contested (накрыты только core_i) — остаются в currentPaths, не трогаются.
      const withoutContested = clipperDifference(currentPaths, [corePaths[j]]);
      const unionPaths = [];
      for (const p of withoutContested) unionPaths.push(p);
      for (const p of contestedKept) unionPaths.push(p);
      currentPaths = unionPaths.length > 0 ? clipperUnion(unionPaths) : [];
      if (currentPaths.length === 0) break;
    }

    if (currentPaths.length === 0) {
      territoryPaths.push(null);
      continue;
    }

    // v5.0 Fix D-tune: ∩ core_i уже применено в начале цикла (currentPaths ⊆ core_i).
    // Дополнительного ограничения не нужно — territory_i по построению ⊆ core_i.
    // fragment_i = core_i ∩ territory_i = territory_i (т.к. territory_i ⊆ core_i).

    // ── Покомпонентная обрезка: берём только компоненту с центром placement_i ──
    // Это лечит невыпуклые зоны (halfplane clipping может дать несвязные территории).
    const centeredPaths = componentsContainingPoint(currentPaths,
      Math.round(pl_i.cx * scale), Math.round(pl_i.cy * scale));
    territoryPaths.push(centeredPaths);
  }

  // ── 2. Строим fragment_i = core_i ∩ territory_i ───────────────────────────
  const resultPlacements = [];
  const thinFragments = [];

  for (let i = 0; i < N; i++) {
    const pl = placements[i];
    const terrPaths = territoryPaths[i];
    if (!terrPaths || terrPaths.length === 0 || !coreMps[i]) {
      resultPlacements.push({
        ...pl,
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

    // territory → MultiPolygon (polygon-clipping format)
    const terrPts = clipperPathToPoints(terrPaths[0], scale);  // упрощённо — первый path
    // NB: если несколько компонент (centredPaths может вернуть несколько holes), объединяем
    const allTerrPts = [];
    for (const tp of terrPaths) {
      const pts = clipperPathToPoints(tp, scale);
      if (pts.length >= 3) allTerrPts.push(pts);
    }
    if (allTerrPts.length === 0) {
      resultPlacements.push({
        ...pl,
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
    // rawTerritoryContour: используем наибольший контур (outer)
    let bestTerrPts = allTerrPts[0];
    let bestTerrArea = 0;
    const allTerrMps = [];
    for (const pts of allTerrPts) {
      const mp = pointsToMultiPolygon(pts);
      allTerrMps.push(mp);
      const a = multiPolygonArea(mp);
      if (a > bestTerrArea) {
        bestTerrArea = a;
        bestTerrPts = pts;
      }
    }

    // territory_mp = union всех компонент
    let terrMp;
    if (allTerrMps.length === 1) {
      terrMp = allTerrMps[0];
    } else {
      // union через polygon-clipping (передаём массив)
      terrMp = allTerrMps.reduce((acc, mp) => {
        if (!acc || (Array.isArray(acc) && acc.length === 0)) return mp;
        try {
          // polygon-clipping unionMulti принимает (a, b)
          return args.unionMulti ? args.unionMulti(acc, mp) : mp;
        } catch (_) {
          return mp;
        }
      }, null);
    }

    // Fragment = core ∩ territory
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

    // Thin-detect (БЕЗ absorb)
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
      // alignedCoreContour = ядро в мировых координатах (для верификатора R2/R5).
      // В poly mode это pl.corePts (уже трансформированы в makePlacement).
      alignedCoreContour: pl.corePts,
      rawTerritoryContour: bestTerrPts,
      inZoneContour: fragPts,
      inZoneCoreContour: fragPts,  // v5.0: core == fragment (припуск — внешний)
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

  // ── 3. Финальная коррекция R2: partition-gap fix ──────────────────────────
  // После power Voronoi могут остаться «мёртвые зоны» — точки зоны, накрытые
  // хотя бы одним ядром, но не попавшие ни в один fragment (из-за численных
  // ошибок bisector или схождения трёх ячеек).
  //
  // Для каждой такой точки — отдать её fragment того ядра, что её накрывает
  // (если несколько — ближайшему). Это НЕ absorb (мы не двигаем ядра, не
  // перераспределяем territory — просто добавляем накрытую область в fragment
  // того, чьё ядро её накрывает).
  //
  // Реализация через diffMulti: residual = zone − Union(fragments).
  // Для каждого компонента residual — найти накрывающее ядро, добавить к fragment.
  const _t2 = Date.now();
  let r2FixedCount = 0;
  let r2FixedArea = 0;
  try {
    // Union всех фрагментов
    const fragMps = [];
    for (const rp of resultPlacements) {
      if (rp.inZoneCoreContour && rp.inZoneCoreContour.length >= 3) {
        fragMps.push(pointsToMultiPolygon(rp.inZoneCoreContour));
      }
    }
    if (fragMps.length > 0) {
      let fragUnion = fragMps[0];
      for (let k = 1; k < fragMps.length; k++) {
        try { fragUnion = args.unionMulti ? args.unionMulti(fragUnion, fragMps[k]) : fragMps[k]; } catch (_) {}
      }
      // residual = zone − fragUnion
      let residualMp;
      try { residualMp = diffMulti(zoneMp, fragUnion); } catch (_) { residualMp = null; }
      const residualArea = residualMp ? multiPolygonArea(residualMp) : 0;
      if (residualMp && residualArea > 50) {
          // Для каждого компонента residual — найти накрывающее ядро, добавить к fragment
          // residualMp в polygon-clipping format: [[outerRing, hole1, ...], ...]
          for (const poly of (residualMp || [])) {
            if (!Array.isArray(poly) || poly.length === 0) continue;
            const ring = poly[0];  // outer ring
            if (!Array.isArray(ring) || ring.length < 4) continue;
            // area via shoelace
            let a = 0;
            for (let k = 0; k < ring.length - 1; k++) {
              a += ring[k][0] * ring[k+1][1] - ring[k+1][0] * ring[k][1];
            }
            a = Math.abs(a) * 0.5;
            if (a < 50) continue;  // мелкие — шум
            // centroid
            let cx = 0, cy = 0, n = ring.length - 1;
            for (let k = 0; k < n; k++) { cx += ring[k][0]; cy += ring[k][1]; }
            cx /= n; cy /= n;
            // Найти накрывающее ядро (ближайший центр среди накрывающих)
            let bestK = -1;
            let bestDist = Infinity;
            for (let k = 0; k < N; k++) {
              if (!coreMps[k]) continue;
              // Проверяем накрытие centroid'а ядром k
              const corePts = placements[k].corePts;
              if (!corePts || corePts.length < 3) continue;
              // pointInPolygon centroid
              if (!_pointInPolygon(cx, cy, corePts)) continue;
              const dx = cx - placements[k].cx;
              const dy = cy - placements[k].cy;
              const d = dx * dx + dy * dy;
              if (d < bestDist) { bestDist = d; bestK = k; }
            }
            if (bestK >= 0) {
              // Добавить этот residual-компонент к fragment[bestK]
              const compPts = ring.map(p => ({ x: p[0], y: p[1] }));
              const compMp = pointsToMultiPolygon(compPts);
              const curFrag = resultPlacements[bestK].inZoneCoreContour || [];
              const curMp = pointsToMultiPolygon(curFrag);
              let newFrag;
              try {
                newFrag = args.unionMulti ? args.unionMulti(curMp, compMp) : compMp;
              } catch (_) { newFrag = curMp; }
              const newPts = mpToPoints(newFrag);
              resultPlacements[bestK].inZoneCoreContour = newPts;
              resultPlacements[bestK].inZoneContour = newPts;
              resultPlacements[bestK].inZoneAreaMm2 = multiPolygonArea(newFrag);
              r2FixedCount++;
              r2FixedArea += a;
            }
          }
      }
    }
  } catch (_) {}
  const _t3 = Date.now();
  if (r2FixedCount > 0) {
    console.log(`[VSA-POLY] R2 partition-gap fix: ${r2FixedCount} components, ${Math.round(r2FixedArea)} мм², ${_t3 - _t2}ms`);
  }

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
      r2FixedCount,
      r2FixedArea: Math.round(r2FixedArea)
    }
  };
}

// Точечная проверка pointInPolygon (ray casting)
function _pointInPolygon(x, y, pts) {
  const n = pts.length;
  if (n < 3) return false;
  let inside = false;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

module.exports = {
  buildPolygonalTerritoryOutput,
  buildHalfplanePath,
  convexHull,
  minBoundingRectShorter
};
