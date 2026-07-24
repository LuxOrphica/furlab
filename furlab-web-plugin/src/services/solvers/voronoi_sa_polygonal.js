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

function contourArea(pts) {
  if (!Array.isArray(pts) || pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += Number(a.x) * Number(b.y) - Number(b.x) * Number(a.y);
  }
  return Math.abs(s) * 0.5;
}

function largestContour(contours) {
  let best = [];
  let bestArea = 0;
  for (const pts of (Array.isArray(contours) ? contours : [])) {
    const area = contourArea(pts);
    if (area > bestArea) {
      bestArea = area;
      best = pts;
    }
  }
  return best;
}

// ── Регуляризация партиции (v5.5) ────────────────────────────────────────────
// ЕДИНСТВЕННАЯ санкционированная чистка геометрии фрагментов (взамен всех
// точечных «деспайков»). Производственный инвариант: элементы уже ДОПУСКА РЕЗА
// физически не вырезать — иглы, прорези и волосяные клинья не существуют для
// раскроя. (Припуск тут НИ ПРИ ЧЁМ: припуски лежат в телах, вне фрагмента —
// узкий язык фрагмента шву не мешает; ширину ограничивает только R5 70×70.)
//   1) каждый фрагмент морфологически регуляризуется радиусом r = cutTolerance/2:
//      открытие (сжать→раздуть) срезает наружные иглы/волоски,
//      закрытие (раздуть→сжать) убирает внутренние прорези;
//   2) fragment ⊆ core восстанавливается пересечением с ядром;
//   3) наложения (закрытие могло налезть на соседа) разрешаются последовательным
//      вычитанием в порядке размещения — партиция без overlap по построению.
// Высвобожденные волоски (тоньше допуска реза) — прощаемый резидуал по
// построению: эрозия классификатора их схлопывает. Перераспределения нет —
// волосяные склейки с соседями сами рождали бы иглы.
// Единственный параметр — cutToleranceMm (точность раскроя), дефолт 2.5мм.
function regularizePartition(args) {
  const placements = Array.isArray(args && args.placements) ? args.placements : [];
  const cutTol = Math.max(0, Number(args && args.cutToleranceMm) || 0);
  const r = cutTol / 2;
  if (!(r > 0) || placements.length === 0) return { applied: false };
  const S = 1000;
  const t0 = Date.now();
  const CT = ClipperLib.ClipType;

  const ptsToPath = (pts) => {
    const path = [];
    for (const p of (Array.isArray(pts) ? pts : [])) {
      const x = Number(p && p.x), y = Number(p && p.y);
      if (Number.isFinite(x) && Number.isFinite(y)) path.push({ X: Math.round(x * S), Y: Math.round(y * S) });
    }
    return path.length >= 3 ? path : null;
  };
  const contoursToPaths = (contours) => {
    const out = [];
    for (const c of (Array.isArray(contours) ? contours : [])) {
      const p = ptsToPath(c);
      if (p) out.push(p);
    }
    return out;
  };
  const pathToPts = (path) => path.map((pt) => ({ x: pt.X / S, y: pt.Y / S }));
  const pathAreaMm2 = (path) => ClipperLib.Clipper.Area(path) / (S * S);
  const offset = (paths, delta) => {
    const co = new ClipperLib.ClipperOffset(2, 0.25 * S);
    co.AddPaths(paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const dst = new ClipperLib.Paths();
    co.Execute(dst, delta);
    return dst;
  };
  const boolOp = (type, subj, clip) => {
    const cpr = new ClipperLib.Clipper();
    cpr.AddPaths(subj, ClipperLib.PolyType.ptSubject, true);
    if (clip && clip.length) cpr.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
    const sol = new ClipperLib.Paths();
    cpr.Execute(type, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    return sol;
  };
  const sumAbsAreaMm2 = (paths) => paths.reduce((s, p) => s + Math.abs(pathAreaMm2(p)), 0);

  const items = placements.map((p) => {
    const fragContours = (Array.isArray(p.inZoneContours) && p.inZoneContours.length)
      ? p.inZoneContours
      : (Array.isArray(p.inZoneContour) && p.inZoneContour.length >= 3 ? [p.inZoneContour] : []);
    return {
      p,
      frag: contoursToPaths(fragContours),
      core: contoursToPaths([p.alignedCoreContour])
    };
  });

  // 1) морфология (открытие + закрытие) и возврат под ядро
  for (const it of items) {
    if (!it.frag.length) { it.reg = it.frag; continue; }
    let reg = it.frag;
    try {
      const er = offset(it.frag, -r * S);
      if (er.length) {
        // открытие — наружные волоски долой
        let opened = offset(er, r * S);
        if (!opened.length) opened = it.frag;
        // закрытие — внутренние прорези долой
        const di = offset(opened, r * S);
        if (di.length) {
          const cl = offset(di, -r * S);
          if (cl.length) opened = cl;
        }
        // fragment ⊆ core: закрытие могло вылезти за ядро — возвращаем
        reg = it.core.length ? boolOp(CT.ctIntersection, opened, it.core) : opened;
        if (!reg.length) reg = it.frag;
      }
      // er пуст: весь фрагмент уже 2r — не трогаем, его судьбу решает R5, не чистка
    } catch (_) { reg = it.frag; }
    it.reg = reg;
  }

  // 2) партиция без overlap: последовательное вычитание уже занятого
  let occupied = [];
  for (const it of items) {
    if (!it.reg || !it.reg.length) continue;
    try {
      if (occupied.length) it.reg = boolOp(CT.ctDifference, it.reg, occupied);
      if (it.reg.length) occupied = occupied.length ? boolOp(CT.ctUnion, occupied, it.reg) : it.reg.slice();
    } catch (_) {}
  }

  // 4) запись обратно: контуры/площади фрагментов из единой очищенной геометрии
  let changed = 0;
  for (const it of items) {
    if (!it.reg || !it.reg.length) continue;
    const outContours = [];
    for (const path of it.reg) {
      if (pathAreaMm2(path) <= 0) continue; // только внешние кольца
      const pts = pathToPts(path);
      if (pts.length >= 3 && contourArea(pts) > 1e-6) outContours.push(pts);
    }
    if (!outContours.length) continue;
    let areaMm2 = 0;
    let largest = outContours[0];
    let largestArea = -1;
    for (const c of outContours) {
      const a = contourArea(c);
      areaMm2 += a;
      if (a > largestArea) { largestArea = a; largest = c; }
    }
    const before = Number(it.p.inZoneAreaMm2 || 0);
    it.p.inZoneContours = outContours;
    it.p.inZoneContour = largest;
    it.p.inZoneCoreContours = outContours;
    it.p.inZoneCoreContour = largest;
    it.p.inZoneAreaMm2 = areaMm2;
    if (Math.abs(areaMm2 - before) > 0.5) changed++;
  }

  return {
    applied: true,
    changed,
    cutToleranceMm: cutTol,
    elapsedMs: Date.now() - t0
  };
}

function multiPolygonOuterContours(mp) {
  const contours = [];
  for (const poly of (Array.isArray(mp) ? mp : [])) {
    const ring = Array.isArray(poly) ? poly[0] : null;
    if (!Array.isArray(ring) || ring.length < 4) continue;
    const pts = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const p = ring[i];
      const x = Number(p && p[0]);
      const y = Number(p && p[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
    }
    if (pts.length >= 3 && contourArea(pts) > 1e-6) contours.push(pts);
  }
  return contours;
}

/**
 * Строит halfplane (большой прямоугольник, обрезанный bisector'ом) — Clipper path.
 * Halfplane содержит точку (cx_i, cy_i), отрезает часть со стороны (cx_j, cy_j).
 * Bisector — перпендикуляр к отрезку (i,j) через середину.
 */
function buildHalfplanePath(cx_i, cy_i, cx_j, cy_j, zoneBbox, scale, shiftMm) {
  const nx = cx_j - cx_i;
  const ny = cy_j - cy_i;
  const nlen = Math.hypot(nx, ny);
  if (nlen < 1e-9) return null;

  const bx = -ny / nlen, by = nx / nlen;
  const nxn = nx / nlen, nyn = ny / nlen;
  // v5.7: shiftMm сдвигает линию шва вдоль оси i→j (взвешенная power-диаграмма).
  // 0 = классическая биссектриса посередине; >0 — шов ближе к j (i получает больше).
  const sh = Number(shiftMm) || 0;
  const mid_x = (cx_i + cx_j) / 2 + nxn * sh;
  const mid_y = (cy_i + cy_j) / 2 + nyn * sh;

  const margin = 5000;  // 5 метров запас — больше любой зоны
  const p1 = { X: Math.round((mid_x + bx * margin) * scale), Y: Math.round((mid_y + by * margin) * scale) };
  const p2 = { X: Math.round((mid_x - bx * margin) * scale), Y: Math.round((mid_y - by * margin) * scale) };
  const p3 = { X: Math.round((mid_x - bx * margin - nxn * margin) * scale), Y: Math.round((mid_y - by * margin - nyn * margin) * scale) };
  const p4 = { X: Math.round((mid_x + bx * margin - nxn * margin) * scale), Y: Math.round((mid_y + by * margin - nyn * margin) * scale) };
  return [p1, p2, p3, p4];
}

/**
 * v5.7 Взвешенные швы: подбирает вес каждого куска так, чтобы швы садились ВНУТРЬ
 * полосы перекрытия ядер, а не посередине между центрами.
 *
 * Зачем: классическая биссектриса идёт посередине и часто промахивается мимо перекрытия
 * (замер 2026-07-19: 11 из 50 пар — шов вообще вне перекрытия, ещё половина — сильно
 * не по центру). Где шов вне перекрытия, до него дотягивается только один кусок →
 * граница вынужденно идёт по неровному контуру ядра → заломы. Сдвинув шов в перекрытие,
 * получаем прямую линию с материалом с обеих сторон.
 *
 * Как: для пары (i,j) желаемый сдвиг δ = центр проекции перекрытия на ось i→j минус
 * середина. В power-диаграмме δ = (w_i − w_j)/(2·D), отсюда уравнение w_i − w_j = 2·D·δ.
 * Весов N, пар ~N² — система переопределена, решаем наименьшими квадратами (релаксация
 * Гаусса-Зейделя: вес = среднее по соседям от w_j + b_ij). Часть швов сядет точно,
 * часть останется компромиссом — это ожидаемо и честно.
 *
 * Ограничение: вес двигает шов ВДОЛЬ оси, но не поворачивает его.
 */
function computeSeamWeights(placements, corePaths, N, scale) {
  const eqs = [];
  for (let i = 0; i < N; i++) {
    if (!corePaths[i]) continue;
    for (let j = i + 1; j < N; j++) {
      if (!corePaths[j]) continue;
      let ov;
      try { ov = clipperIntersect([corePaths[i]], [corePaths[j]]); } catch (_) { continue; }
      if (!ov || !ov.length) continue;
      let ovArea = 0;
      for (const p of ov) ovArea += clipperArea(p) / (scale * scale);
      if (ovArea < 100) continue; // не соседи по существу
      const dx = placements[j].cx - placements[i].cx;
      const dy = placements[j].cy - placements[i].cy;
      const D = Math.hypot(dx, dy);
      if (D < 1) continue;
      const ux = dx / D, uy = dy / D;
      let tmin = Infinity, tmax = -Infinity;
      for (const path of ov) {
        for (const pt of path) {
          const x = pt.X / scale - placements[i].cx;
          const y = pt.Y / scale - placements[i].cy;
          const t = x * ux + y * uy;
          if (t < tmin) tmin = t;
          if (t > tmax) tmax = t;
        }
      }
      if (!Number.isFinite(tmin) || !Number.isFinite(tmax)) continue;
      const delta = (tmin + tmax) / 2 - D / 2;
      // Ограничение: шов не должен уезжать за пределы отрезка между центрами —
      // иначе кусок теряет территорию вокруг собственного центра.
      const clamped = Math.max(-D * 0.45, Math.min(D * 0.45, delta));
      eqs.push({ i, j, b: 2 * D * clamped });
    }
  }
  const w = new Float64Array(N);
  if (!eqs.length) return w;
  const nbr = [];
  for (let i = 0; i < N; i++) nbr.push([]);
  for (const e of eqs) {
    nbr[e.i].push({ o: e.j, b: e.b });
    nbr[e.j].push({ o: e.i, b: -e.b });
  }
  for (let it = 0; it < 60; it++) {
    for (let i = 0; i < N; i++) {
      const lst = nbr[i];
      if (!lst.length) continue;
      let s = 0;
      for (const e of lst) s += w[e.o] + e.b;
      w[i] = s / lst.length;
    }
  }
  return w;
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
  const unionMulti = args.unionMulti;
  const partitionV2 = !!args.partitionV2; // v2: прямые общие швы (power-диаграмма)
  const seamWeights = !!args.seamWeights;  // v5.7: сдвиг швов в полосу перекрытия

  // R5 per-component: компонент проходит, если MBR-ширина и bbox-длина не ниже
  // порогов (допуск 0.5мм — тот же, что в thin-detect).
  function contourPassesMinSize(contour) {
    if (!Array.isArray(contour) || contour.length < 3) return false;
    if (minWidthMm > 0 && minBoundingRectShorter(contour) < minWidthMm - 0.5) return false;
    if (minLengthMm > 0) {
      const bb = polygonBBox(contour);
      const longSide = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
      if (longSide < minLengthMm - 0.5) return false;
    }
    return true;
  }

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

  // v5.7: веса для сдвига швов внутрь полос перекрытия (только с partitionV2)
  const seamW = (partitionV2 && seamWeights) ? computeSeamWeights(placements, corePaths, N, scale) : null;

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

    if (partitionV2) {
      // ── v2: core-aware power-диаграмма ────────────────────────────────────
      // cell_i = (zone ∩ core_i) − ⋃_j (core_j ∩ halfplane_j), где halfplane_j —
      // сторона биссектрисы, содержащая seed_j. Убираем только там, где ЯДРО соседа
      // реально есть И сосед ближе → покрытие сохраняется (точку берёт ближайший
      // НАКРЫВАЮЩИЙ кусок, как в растровом computePowerAssign). Вычитаемые области
      // фиксированы (не зависят от порядка) → шов i–j = core_i∩core_j∩биссектриса —
      // одна прямая линия, одинаковая для обоих соседей → швы прямые и совпадающие.
      for (const j of otherIndices) {
        const contested = clipperIntersect(currentPaths, [corePaths[j]]);
        if (!contested || contested.length === 0) continue;
        // halfplane_j (сторона seed_j) = buildHalfplanePath с j на «своей» стороне
        // сдвиг шва: δ_ji = (w_j − w_i)/(2·D) — та же линия, что и δ_ij с другой стороны
        let shJI = 0;
        if (seamW) {
          const _dx = pl_i.cx - placements[j].cx, _dy = pl_i.cy - placements[j].cy;
          const _D = Math.hypot(_dx, _dy);
          if (_D > 1) shJI = (seamW[j] - seamW[i]) / (2 * _D);
        }
        const hpJ = buildHalfplanePath(placements[j].cx, placements[j].cy, pl_i.cx, pl_i.cy, zoneBbox, scale, shJI);
        if (!hpJ) continue;
        const removeRegion = clipperIntersect(contested, [hpJ]); // core_j ∩ halfplane_j ∩ current
        if (!removeRegion || removeRegion.length === 0) continue;
        currentPaths = clipperDifference(currentPaths, removeRegion);
        if (currentPaths.length === 0) break;
      }
    } else {
      // ── v1: условный разрез только «спорной» области (где оба ядра) ───────
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
    }

    if (currentPaths.length === 0) {
      territoryPaths.push(null);
      continue;
    }

    // Keep every component of territory_i. Dropping islands that do not contain
    // the placement center creates R2 partition gaps: the core covers them, but
    // no fragment owns them.
    territoryPaths.push(currentPaths);
  }

  // ── 2. Строим fragment_i = territory_i (т.к. territory_i ⊆ core_i) ────────
  const resultPlacements = [];
  const thinFragments = [];
  const fragMps = [];            // текущий multipolygon фрагмента по индексу записи (для фазы 2.5)
  const satelliteFixups = [];    // записи с валидным главным компонентом + sub-min сателлитами

  for (let i = 0; i < N; i++) {
    const pl = placements[i];
    const terrPaths = territoryPaths[i];
    if (!terrPaths || terrPaths.length === 0 || !coreMps[i]) {
      resultPlacements.push({
        ...pl,
        scrapPieceId: pl.scrapPieceId || pl.id || pl.inventoryTag,
        alignedContour: pl.pts && pl.pts.length >= 3 ? pl.pts : [],
        rawTerritoryContour: [],
        rawTerritoryContours: [],
        inZoneContour: [],
        inZoneContours: [],
        inZoneCoreContour: [],
        inZoneCoreContours: [],
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
      fragMps.push(null);
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
        scrapPieceId: pl.scrapPieceId || pl.id || pl.inventoryTag,
        alignedContour: pl.pts && pl.pts.length >= 3 ? pl.pts : [],
        rawTerritoryContour: [],
        rawTerritoryContours: [],
        inZoneContour: [],
        inZoneContours: [],
        inZoneCoreContour: [],
        inZoneCoreContours: [],
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
      fragMps.push(null);
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

    const fragContours = multiPolygonOuterContours(fragMp);
    const fragPts = largestContour(fragContours);
    const terrContours = allTerrPts;

    fragMps.push(Array.isArray(fragMp) ? fragMp : []);

    // R5 per-component (v5.2): каждый компонент фрагмента проверяется на min-size
    // ОТДЕЛЬНО. Раньше бралась min(MBR) по всем компонентам — сателлит 10×16мм
    // делал thin весь placement с валидным главным компонентом 170×240мм.
    const validContours = [];
    const subMinContours = [];
    if (fragArea > 0) {
      for (const contour of fragContours) {
        if (contourPassesMinSize(contour)) validContours.push(contour);
        else subMinContours.push(contour);
      }
    }
    // Thin = НИ ОДИН компонент не прошёл (истинно тонкая посадка). БЕЗ absorb — контракт R5.
    const isThin = fragContours.length > 0 && fragArea > 0 && validContours.length === 0;

    if (isThin) {
      let mbrShort = Infinity;
      for (const contour of fragContours) {
        const curShort = minBoundingRectShorter(contour);
        if (curShort < mbrShort) mbrShort = curShort;
      }
      thinFragments.push({
        idx: i,
        inventoryTag: pl.inventoryTag,
        mbrShort: Math.round(mbrShort * 10) / 10,
        fragArea: Math.round(fragArea),
        cx: pl.cx,
        cy: pl.cy
      });
    } else if (validContours.length > 0 && subMinContours.length > 0) {
      // Сателлиты при живом главном компоненте — в фазу 2.5
      satelliteFixups.push({ idx: resultPlacements.length, validContours, subMinContours });
    }

    resultPlacements.push({
      ...pl,
      scrapPieceId: pl.scrapPieceId || pl.id || pl.inventoryTag,
      // alignedContour = тело с припуском в мировых координатах (требуется инвариантом для matched).
      alignedContour: pl.pts && pl.pts.length >= 3 ? pl.pts : fragPts,
      // alignedCoreContour = ядро в мировых координатах (для верификатора R2/R5).
      alignedCoreContour: pl.corePts,
      // rawTerritoryContour = наибольший компонент territory (для рендера).
      rawTerritoryContour: bestTerrPts || fragPts,
      rawTerritoryContours: terrContours,
      inZoneContour: fragPts,
      inZoneContours: fragContours,
      inZoneCoreContour: fragPts,
      inZoneCoreContours: fragContours,
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

  // ── 2.5 Sub-min сателлиты (v5.2) ────────────────────────────────────────────
  // Multi-component fragment с валидным главным компонентом: sub-min сателлит
  //   1) передаётся соседу, чьё core накрывает ~всю его площадь И чей fragment
  //      остаётся связным после union (выбор детерминирован: покрытие desc → tag asc);
  //   2) иначе — выбрасывается в residual (честная дыра, диагностика droppedComponents).
  // Это НЕ PH3-absorb: целиком thin placement не трогается (R5 = failed честно),
  // переносятся только осколки territory, отрезанные bisector'ом.
  const transferredComponents = [];
  const droppedComponents = [];
  if (satelliteFixups.length > 0 && typeof unionMulti === "function") {
    // Step A: снять сателлиты с доноров, собрать очередь на пристройство
    const satWork = [];
    for (const fx of satelliteFixups) {
      const rec = resultPlacements[fx.idx];
      const validMps = [];
      for (const c of fx.validContours) {
        const mp = pointsToMultiPolygon(c);
        for (const poly of (Array.isArray(mp) ? mp : [])) validMps.push(poly);
      }
      fragMps[fx.idx] = validMps;
      for (const c of fx.subMinContours) {
        const satMp = pointsToMultiPolygon(c);
        const satArea = multiPolygonArea(satMp);
        if (satArea < 1) {
          droppedComponents.push({ fromTag: rec.inventoryTag, areaMm2: Math.round(satArea * 10) / 10, reason: "micro" });
          continue;
        }
        satWork.push({ fromIdx: fx.idx, fromTag: rec.inventoryTag, satMp, satArea });
      }
    }
    // Step B: передать соседям / выбросить
    const touched = new Set(satelliteFixups.map((fx) => fx.idx));
    for (const w of satWork) {
      const candidates = [];
      for (let m = 0; m < resultPlacements.length; m++) {
        if (m === w.fromIdx) continue;
        const recM = resultPlacements[m];
        if (recM.status !== "matched") continue;
        if (!coreMps[m] || !fragMps[m] || fragMps[m].length === 0) continue;
        let covered = 0;
        try { covered = multiPolygonArea(intersectMulti(coreMps[m], w.satMp)); } catch (_) { covered = 0; }
        // Порог 50%: передаётся только часть, накрытая core соседа (клиппинг ниже
        // гарантирует R2: fragment ⊆ core). Остаток < 50% — не стоит фрагментации.
        if (covered >= w.satArea * 0.5) candidates.push({ m, covered, tag: String(recM.inventoryTag || "") });
      }
      candidates.sort((a, b) => {
        if (Math.abs(b.covered - a.covered) > 1e-6) return b.covered - a.covered;
        if (a.tag !== b.tag) return a.tag < b.tag ? -1 : 1;
        return a.m - b.m;
      });
      let accepted = false;
      let unionRejects = 0;
      for (const cand of candidates) {
        // Клиппинг по core соседа: transferMp ⊆ core_m по построению → R2 держится.
        let transferMp = w.satMp;
        if (cand.covered < w.satArea * 0.999) {
          try { transferMp = intersectMulti(w.satMp, coreMps[cand.m]); } catch (_) { continue; }
          if (multiPolygonArea(transferMp) < 1) continue;
        }
        let merged = null;
        try { merged = unionMulti(fragMps[cand.m], transferMp); } catch (_) { merged = null; }
        if (!merged) continue;
        const before = multiPolygonOuterContours(fragMps[cand.m]).length;
        const after = multiPolygonOuterContours(merged).length;
        if (after > before) { unionRejects++; continue; } // не примыкает — union дал новый остров
        fragMps[cand.m] = merged;
        touched.add(cand.m);
        const transferredMm2 = Math.min(w.satArea, cand.covered);
        transferredComponents.push({
          fromTag: w.fromTag,
          toTag: resultPlacements[cand.m].inventoryTag,
          areaMm2: Math.round(transferredMm2)
        });
        const remainder = w.satArea - transferredMm2;
        if (remainder > 1) {
          droppedComponents.push({ fromTag: w.fromTag, areaMm2: Math.round(remainder), reason: "partial_remainder" });
        }
        accepted = true;
        break;
      }
      if (!accepted) {
        droppedComponents.push({
          fromTag: w.fromTag,
          areaMm2: Math.round(w.satArea),
          reason: candidates.length === 0 ? "no_covering_core" : "union_not_adjacent",
          candidateCount: candidates.length,
          unionRejects,
          bestCoveredPct: candidates.length ? Math.round(candidates[0].covered / w.satArea * 100) : 0
        });
      }
    }
    // Step C: пересобрать поля затронутых записей из fragMps
    for (const idx of touched) {
      const rec = resultPlacements[idx];
      const mp = fragMps[idx] || [];
      const contours = multiPolygonOuterContours(mp);
      const main = largestContour(contours);
      const area = multiPolygonArea(mp);
      rec.inZoneContours = contours;
      rec.inZoneContour = main;
      rec.inZoneCoreContours = contours;
      rec.inZoneCoreContour = main;
      rec.inZoneAreaMm2 = area;
      rec.physMissingMm2 = Math.max(0, (rec.territoryAreaMm2 || 0) - area);
    }
    if (transferredComponents.length || droppedComponents.length) {
      const trMm2 = transferredComponents.reduce((s, t) => s + t.areaMm2, 0);
      const drMm2 = droppedComponents.reduce((s, t) => s + t.areaMm2, 0);
      console.log(`[VSA-POLY] satellites: transferred=${transferredComponents.length} (${Math.round(trMm2)}mm2), dropped=${droppedComponents.length} (${Math.round(drMm2)}mm2)`);
    }
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
    transferredComponents,
    droppedComponents,
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
      r2FixedArea: 0,
      satelliteTransferredCount: transferredComponents.length,
      satelliteTransferredMm2: Math.round(transferredComponents.reduce((s, t) => s + t.areaMm2, 0)),
      satelliteDroppedCount: droppedComponents.length,
      satelliteDroppedMm2: Math.round(droppedComponents.reduce((s, t) => s + t.areaMm2, 0))
    }
  };
}

module.exports = {
  buildPolygonalTerritoryOutput,
  buildHalfplanePath,
  convexHull,
  minBoundingRectShorter,
  regularizePartition
};
