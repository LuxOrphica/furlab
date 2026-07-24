"use strict";

/**
 * Voronoi SA solver for inventory layout.
 *
 * Same SA engine as nfp_sa_solver, but territory assignment uses Weighted Voronoi
 * instead of incremental diffMulti. Each zone cell is assigned to the nearest piece
 * center — guarantees no holes and no tiny leftover fragments from diffMulti cuts.
 *
 * API contract: same output shape as inventory-direct-cover-contract v1.3.
 */

const { createVoronoiSaCoverage } = require("./voronoi_sa_coverage");
const {
  computeAbsorptionDiagnostic,
  computeResultInvariants
} = require("./voronoi_sa_diagnostics");
const {
  createVoronoiSaFragmentPostprocess,
  runInitialPostprocess,
  runPolygonResidualAbsorption,
  collectDuplicatePieceWarnings
} = require("./voronoi_sa_postprocess");
const { buildTerritoryOutput } = require("./voronoi_sa_output");
const { buildPolygonalTerritoryOutput, regularizePartition } = require("./voronoi_sa_polygonal");
const { createVoronoiSaGeometry } = require("./voronoi_sa_geometry");
const { runPhaseBLloyd } = require("./voronoi_sa_lloyd");
const { createVoronoiSaRaster } = require("./voronoi_sa_raster");
const { createVoronoiSaResultBuilder } = require("./voronoi_sa_result");
const { createVoronoiSaSearch } = require("./voronoi_sa_search");
const { applyTargetedCycle: runTargetedCycle } = require("./voronoi_sa_targeted");
const {
  MOVES,
  energy,
  buildUncovered,
  pickMove
} = require("./voronoi_sa_annealing");

const CLIPPER_SCALE = 1000; // mm → clipper integer units

function createVoronoiSaSolver(deps) {
  const {
    parseScrapContourPoints,
    centroid,
    rotatePoints,
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
  const coverageTools = createVoronoiSaCoverage({
    polygonBBox,
    pointsToMultiPolygon,
    intersectMulti,
    diffMulti,
    unionMulti,
    multiPolygonArea
  });
  const { computeGeomResidual } = coverageTools;

  const {
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
  } = createVoronoiSaGeometry({
    clipperScale: CLIPPER_SCALE,
    pointsToMultiPolygon,
    intersectMulti,
    multiPolygonArea
  });

  const {
    rasterize,
    rasterizeDense,
    countBits,
    countAnd,
    computePowerAssign,
    computeCoverage,
    buildCellToFrag,
    rebuildFragPoly
  } = createVoronoiSaRaster({
    pointInPolygon,
    clipperScale: CLIPPER_SCALE
  });

  const {
    fillGapsVoronoi,
    absorbResidualCells,
    dissolveSmallFragments
  } = createVoronoiSaFragmentPostprocess({
    CLIPPER_SCALE,
    rasterize,
    buildCellToFrag,
    rebuildFragPoly,
    polygonBBox,
    pointsToMultiPolygon,
    intersectMulti,
    multiPolygonArea,
    sealFragment,
    coreFragmentForTerritory
  });

  // ── State helpers ───────────────────────────────────────────────────────────

  function _convexHull(pts) {
    const sorted = pts.slice().sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lo = [], up = [];
    for (const p of sorted) {
      while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
      lo.push(p);
    }
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
      up.push(p);
    }
    up.pop(); lo.pop();
    return lo.concat(up);
  }
  function _minMaxOrientedRect(hull) {
    const n = hull.length;
    if (n < 2) return { shorter: Infinity, longer: Infinity };
    let minShorter = Infinity, maxLonger = 0;
    for (let i = 0; i < n; i++) {
      const p1 = hull[i], p2 = hull[(i + 1) % n];
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const L = Math.hypot(dx, dy);
      if (L < 1e-9) continue;
      const ux = dx / L, uy = dy / L, vx = -uy, vy = ux;
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      for (const p of hull) {
        const u = p.x * ux + p.y * uy, v = p.x * vx + p.y * vy;
        if (u < minU) minU = u; if (u > maxU) maxU = u;
        if (v < minV) minV = v; if (v > maxV) maxV = v;
      }
      const w = maxU - minU, h = maxV - minV;
      if (Math.min(w, h) < minShorter) minShorter = Math.min(w, h);
      if (Math.max(w, h) > maxLonger) maxLonger = Math.max(w, h);
    }
    return { shorter: minShorter, longer: maxLonger };
  }

  function makePlacement(piece, cx, cy, angleDeg, spec, zoneMask) {
    const pts = transformPiece(piece.centeredPts, angleDeg, cx, cy); // v5.1: тело — для отображения
    const corePts = transformPiece(piece.centeredCorePts, angleDeg, cx, cy);
    const mask = rasterize(corePts, spec);
    for (let i = 0; i < mask.length; i++) { if (!zoneMask[i]) mask[i] = 0; }
    // activeCells: indices where mask bit0 is set — avoids iterating all cellCount in computeCoverage.
    const activeCells = [];
    for (let i = 0; i < mask.length; i++) { if (mask[i] & 1) activeCells.push(i); }
    // v5.6 «мёртвая зона» штрафа нахлёста: deepCells = клетки ядра, эродированного на
    // припуск (тело ⊖ 2×припуск). Нахлёст В ПРЕДЕЛАХ запаса шва (2×припуск) не создаёт
    // пересечения deep-областей — бесплатен по построению; глубже — экономический штраф.
    let deepCells = null;
    if (piece.centeredDeepPts && piece.centeredDeepPts.length >= 3) {
      const deepPts = transformPiece(piece.centeredDeepPts, angleDeg, cx, cy);
      const dmask = rasterize(deepPts, spec);
      deepCells = [];
      for (let i = 0; i < dmask.length; i++) { if ((dmask[i] & 1) && zoneMask[i]) deepCells.push(i); }
    }
    return { id: piece.id, inventoryTag: piece.inventoryTag, cx, cy, angleDeg, pts, corePts, mask, activeCells, deepCells };
  }

  const {
    runSaSearch
  } = createVoronoiSaSearch({
    polygonBBox,
    normalizeDeg,
    deltaDeg,
    pointInPolygon,
    sampleInPoly,
    makePlacement,
    countAnd,
    buildUncovered,
    computeCoverage,
    energy,
    pickMove,
    MOVES,
    transformPiece,
    // v5.0 Fix тип 2 + Fix тип 3: полигональные операции для ADD-guard
    // и exit-decision (полигональный residual вместо растровых клеток).
    pointsToMultiPolygon,
    unionMulti,
    intersectMulti,
    diffMulti,
    multiPolygonArea
  });

  // ── Anchor sampling ─────────────────────────────────────────────────────────

  // Centroid of the largest connected uncovered zone-cell blob (BFS).
  // Returns { x, y, size } or null. Much more useful than average-of-all-uncovered
  // which lands in the middle of the zone when holes are scattered.
  // Sample a placement position so the piece covers the blob centroid.
  // Tries up to 48 times: random offset within piece bbox radius, clamped to IFP.
  // ── Greedy warm start ───────────────────────────────────────────────────────

  // ── Move types ──────────────────────────────────────────────────────────────

  // ── Lloyd-tiling helpers ─────────────────────────────────────────────────────
  // Merge tiles whose axis-aligned bbox shorter side < minWidthMm into the neighbour
  // with the most shared boundary cells. Iterates until stable (max 50 passes).
  function mergeTilesByWidth(rawAssign, cellCount, N, spec, minWidthMm) {
    const assign = rawAssign.slice(); // mutable copy
    for (let pass = 0; pass < 50; pass++) {
      // Build cell list per tile
      const tileCells = [];
      for (let j = 0; j < N; j++) tileCells.push([]);
      for (let i = 0; i < cellCount; i++) {
        const j = assign[i];
        if (j >= 0 && j < N) tileCells[j].push(i);
      }
      let merged = false;
      for (let j = 0; j < N; j++) {
        const cells = tileCells[j];
        if (cells.length === 0) continue;
        // Axis-aligned bbox of tile j cells
        let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
        for (const i of cells) {
          const row = Math.floor(i / spec.nx);
          const col = i % spec.nx;
          if (row < minRow) minRow = row;
          if (row > maxRow) maxRow = row;
          if (col < minCol) minCol = col;
          if (col > maxCol) maxCol = col;
        }
        const bboxW = (maxCol - minCol + 1) * spec.r;
        const bboxH = (maxRow - minRow + 1) * spec.r;
        const shorter = Math.min(bboxW, bboxH);
        if (shorter >= minWidthMm) continue;
        // Find neighbour with most shared boundary
        const neighborCount = new Map();
        for (const i of cells) {
          const row = Math.floor(i / spec.nx);
          const col = i % spec.nx;
          for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nr = row + dr, nc = col + dc;
            if (nr < 0 || nr >= spec.ny || nc < 0 || nc >= spec.nx) continue;
            const ni = nr * spec.nx + nc;
            const nj = assign[ni];
            if (nj === j || nj < 0 || nj >= N) continue;
            neighborCount.set(nj, (neighborCount.get(nj) || 0) + 1);
          }
        }
        if (neighborCount.size === 0) continue;
        // Pick neighbour with max shared boundary
        let bestNeighbor = -1, bestCount = -1;
        for (const [nj, cnt] of neighborCount) {
          if (cnt > bestCount) { bestCount = cnt; bestNeighbor = nj; }
        }
        if (bestNeighbor < 0) continue;
        for (const i of cells) assign[i] = bestNeighbor;
        merged = true;
      }
      if (!merged) break;
    }
    return assign;
  }

  // ── Main SA loop ────────────────────────────────────────────────────────────

  async function solve(zonePoints, candidates, _constraints, options) {
    const {
      napTarget = 0,
      napTol = 15,
      maxSolveMs = 60000,
      seed = 1,
      onProgress = null
    } = options || {};
    const allowanceMm = Math.max(0, Number((options && options.allowanceMm) || (options && options.seamAllowanceReserveMm) || 0));
    // Чистка зубцов скана ДО расчёта припуска (см. cleanCandidateContour). 0 = выключено.
    const cleanContoursMm = Math.max(0, Number((options && options.cleanContoursMm) || 0));
    const minWidthMm = Math.max(0, Number((options && options.minWidthMm) || 0));
    const minLengthMm = Math.max(0, Number((options && options.minLengthMm) || 0));
    // overhangMm: IFP uses inflated zone so pieces may overhang boundary.
    // Gain/fragment/coverage remain clipped to exact zone. Default 75mm.
    const overhangMm = Math.max(0, Number((options && options.overhangMm != null ? options.overhangMm : 75)));
    // maxIterations: primary exit criterion — deterministic, seed-reproducible, wall-clock-independent.
    // Default 3000 (~20-30s on typical zones). computeCoverage is O(N×C) per iter — full recompute.
    // v5.0 §6: default 20000 итераций (детерминированный выход SA).
    // Раньше было 3000 — слишком мало, SA не успевал сходиться на сложных зонах.
    // TODO v5.1: incremental coverage для 50000+ iters at reasonable cost.
    // When null/0, falls back to time-based exit (not recommended — results vary by machine load).
    const maxIterations = (options && options.maxIterations != null)
      ? (Number(options.maxIterations) > 0 ? Math.max(1, Number(options.maxIterations)) : null)
      : 20000;
    // absorptionCriterion: bit mask for absorption eligibility check on fullMask.
    // 1 = center only (conservative, may miss thin seam joints)
    // 4 = majority ≥3/5 sample points (default, balanced)
    // 2 = any of 5 points (too loose — caused territory bloat regression)
    const absorptionCriterion = (options && options.absorptionCriterion != null)
      ? Number(options.absorptionCriterion) : 4;
    const postprocessMode = String((options && options.postprocessMode) || "full");
    const layoutMode = String((options && options.layoutMode) || "inventory_voronoi_sa");
    const territoryMode = String((options && (options.territoryMode || options.mode)) || "restricted_voronoi");
    const isMosaic = territoryMode === "mosaic";

    // ── Single source of truth: all resolved options collected here ──────────
    // algorithmTrace.effectiveOptions is the authoritative record of what the solver
    // actually used — oracle export reads from here, never from the call-site snapshot.
    const effectiveOptions = {
      solver: "inventory_voronoi_sa",
      layoutMode,
      territoryMode,
      gridStepMm: 3,
      seed,
      maxSolveMs,
      maxIterations: maxIterations || null,
      numRestarts: Math.max(1, Number((options && options.numRestarts) || 1)),
      allowanceMm,
      napTarget,
      napTolDeg: napTol,
      minWidthMm,
      minLengthMm,
      overhangMm,
      absorptionCriterion,
      postprocessMode
    };

    const warnings = [];
    if (options && options.mosaicMode) warnings.push("mosaicMode_ignored");
    if (options && options.mode && !options.territoryMode) warnings.push("legacy_mode_option_used_as_territoryMode");

    // Geometric zone mp — computed before startTime so polygon ops don't eat phaseA budget
    const zoneHoles = Array.isArray(options && options.zoneHoles) ? options.zoneHoles : [];
    let zoneMp = pointsToMultiPolygon(zonePoints);
    for (const hole of zoneHoles) {
      if (!Array.isArray(hole) || hole.length < 3) continue;
      try { zoneMp = diffMulti(zoneMp, pointsToMultiPolygon(hole)); } catch (_) {}
    }

    // Guarantee SA gets at least half the budget — Lloyd reserve cannot starve phaseA.
    const phaseBReserve = isMosaic ? Math.min(Math.floor(maxSolveMs * 0.25), Math.floor(maxSolveMs * 0.5)) : 0;
    const startTime = Date.now();
    const phaseADeadline = startTime + Math.max(Math.floor(maxSolveMs * 0.5), maxSolveMs - phaseBReserve);
    const phaseBDeadline = startTime + maxSolveMs;

    const rng = createSeededRng(seed);
    const zoneBbox = polygonBBox(zonePoints);
    const spec = createGridSpec(zoneBbox, 3, 1);
    const cellCount = spec.nx * spec.ny;
    let zoneMask = rasterize(zonePoints, spec);
    // Normalize to 0/1: rasterize() returns 2-bit values (0/2/3), zone mask must be 0/1
    for (let i = 0; i < zoneMask.length; i++) zoneMask[i] = zoneMask[i] ? 1 : 0;
    // Subtract holes from zone mask (CONTRACT_layouts.md §4, §10.6)
    for (const hole of zoneHoles) {
      if (!Array.isArray(hole) || hole.length < 3) continue;
      const holeMask = rasterize(hole, spec);
      for (let i = 0; i < zoneMask.length; i++) if (holeMask[i]) zoneMask[i] = 0;
    }
    const zoneCells = countBits(zoneMask);
    const cellAreaMm2 = spec.r * spec.r;
    // Raster area: used for SA energy (coverage tracking during optimisation).
    // Polygon area: deterministic, used for final coverage ratio and display.
    const zoneAreaRaster = zoneCells * cellAreaMm2;
    const zoneAreaPolygon = Math.abs(ringAreaSigned(zonePoints));
    const zoneArea = zoneAreaPolygon;

    // ── Prepare pieces ──────────────────────────────────────────────────────
    const pieces = [];
    for (let _ci = 0; _ci < candidates.length; _ci++) {
      const c = candidates[_ci];
      const rawPts = Array.isArray(c.scrapContour) && c.scrapContour.length >= 3
        ? c.scrapContour.map(p => ({ x: Number(p.x), y: Number(p.y) })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
        : parseScrapContourPoints(c.scrapContour);
      if (!rawPts || rawPts.length < 3) continue;
      const cen = centroid(rawPts);
      let centeredPts = rawPts.map(p => ({ x: p.x - cen.x, y: p.y - cen.y }));
      if (cleanContoursMm > 0) {
        const cleaned = cleanCandidateContour(centeredPts, cleanContoursMm);
        if (cleaned && cleaned.length >= 3) centeredPts = cleaned;
      }
      const areaMm2 = Math.abs(ringAreaSigned(centeredPts));
      const coreInset = allowanceMm > 0 ? offsetContourInward(centeredPts, allowanceMm) : [];
      // v5.0 §1, §7: при allowanceMm > 0 инсет обязателен. Если он схлопнулся (< 3 точек) —
      // кусок физически непригоден (после вычета припуска не остаётся материала), отбрасываем.
      // Запрет fallback'а к centeredPts: он маскировал P0 (ядро == тело → фейк-покрытие).
      if (allowanceMm > 0 && coreInset.length < 3) continue;
      const centeredCorePts = (allowanceMm > 0) ? coreInset : centeredPts;
      if (minWidthMm > 0 || minLengthMm > 0) {
        // v5.0 Fix тип 2 (правка 1 советника): rotating calipers MBR — тот же метод,
        // что в верификаторе (shapely minimum_rotated_rectangle). axis-aligned bbox
        // пропускал щепки вида «83 по горизонтали / 15 по диагонали» (FL-SCR-000090).
        const hull = _convexHull(centeredCorePts);
        const mbr = _minMaxOrientedRect(hull);
        if (minWidthMm > 0 && mbr.shorter < minWidthMm) continue;
        if (minLengthMm > 0 && mbr.longer  < minLengthMm) continue;
      }
      // deep-контур для «мёртвой зоны» штрафа нахлёста: ядро ⊖ припуск. Считаем ТОЛЬКО
      // когда штраф активен (_deepOverlapWeight>0) — иначе лишняя растеризация каждый ход.
      const _deepOn = Number(options && options._deepOverlapWeight || 0) > 0;
      const deepInset = (_deepOn && allowanceMm > 0) ? offsetContourInward(centeredCorePts, allowanceMm) : null;
      pieces.push({
        id: String(c.id ?? c.inventoryTag),
        inventoryTag: c.inventoryTag,
        napDeg: Number(c.napDirectionDeg ?? c.napDirection ?? 0),
        centeredPts,
        centeredCorePts,
        centeredDeepPts: (deepInset && deepInset.length >= 3) ? deepInset : null,
        areaMm2
      });
      if (_ci % 8 === 7) await new Promise((r) => setImmediate(r));
    }

    if (pieces.length === 0 || zoneCells === 0) {
      return emptyResult(zoneArea);
    }

    // ── Preflight: статистика для Monitor, без ограничения числа кусков ────────
    // SA сам регулирует количество через ходы ADD/REMOVE — ограничение Nstart
    // нужно только в Power Diagram (v2). Здесь передаём все доступные куски.
    const sortedByCap = pieces.slice().sort((a, b) => a.areaMm2 - b.areaMm2);
    const Cmed = sortedByCap[Math.floor(sortedByCap.length / 2)].areaMm2;
    const Nbase = Math.max(1, Math.ceil(zoneArea / Cmed));
    const selectedPieces = pieces; // SA использует все куски

    const selectionDebug = {
      zoneArea: Math.round(zoneAreaPolygon),
      zoneAreaRaster: Math.round(zoneAreaRaster),
      Cmed: Math.round(Cmed),
      Nbase,
      reserveFactor: "N/A",
      Nstart: pieces.length,
      targetCellArea: Math.round(zoneArea / Math.max(1, Nbase)),
      fragmentCountMode: "sa_auto",
      totalCandidates: pieces.length,
      overhangMm
    };

    // ─── LLOYD-TILING BRANCH ──────────────────────────────────────────────────
    // Activated by options._lloydTiling === true.
    // Builds coverage by construction: Lloyd-regularized Voronoi tiles → assign scraps.
    // No SA, no patching, no post-hoc absorb — coverage is a property of the build.
    if (options && options._lloydTiling === true) {
      const _ltStart = Date.now();

      // A: N cells — target territory << core so each core fully covers its territory.
      // territory_target = medCore * 0.45 → N ≈ zone / (0.45 * medCore) ≈ 2.2x the naive ratio.
      // This ensures union(cores) ≈ zone (no inter-core gaps by construction).
      const sortedCores = selectedPieces.slice().sort((a, b) => a.areaMm2 - b.areaMm2);
      const medCoreArea = sortedCores[Math.floor(sortedCores.length / 2)].areaMm2;
      // TERRITORY_FILL = 0.55: territory ≈ 55% of piece area.
      // Pieces overlap neighbouring territories → union(pieces) covers zone boundary.
      const TERRITORY_FILL = 0.55;
      const targetTerritoryArea = medCoreArea * TERRITORY_FILL;
      const N = Math.max(2, Math.min(selectedPieces.length, Math.round(zoneArea / targetTerritoryArea)));
      console.log(`[LloydTiling] N=${N} zoneArea=${Math.round(zoneArea)} medCore=${Math.round(medCoreArea)} targetTerritory=${Math.round(targetTerritoryArea)} pieces=${selectedPieces.length}`);

      // B: N seed points inside zone (deterministic via seeded rng)
      // sampleInPoly returns null if 60 attempts fail (concave zone) — fall back to bbox centroid
      const zoneCentroidX = (zoneBbox.minX + zoneBbox.maxX) / 2;
      const zoneCentroidY = (zoneBbox.minY + zoneBbox.maxY) / 2;
      const seeds = [];
      for (let i = 0; i < N; i++) {
        const s = sampleInPoly(zonePoints, zoneBbox, rng);
        seeds.push(s || { x: zoneCentroidX, y: zoneCentroidY });
      }
      const nullSeeds = seeds.filter(s => s.x === zoneCentroidX && s.y === zoneCentroidY).length;
      if (nullSeeds > 0) console.log(`[LloydTiling] WARN: ${nullSeeds}/${N} seeds fell back to bbox centroid`);

      // B: N largest pieces by areaMm2
      const tilePool = selectedPieces.slice().sort((a, b) => b.areaMm2 - a.areaMm2).slice(0, N);

      // B: initial placements — piece[i] at seed[i] (inside zone by construction).
      // Do NOT apply IFP-centroid fallback here: IFP centroid can be far outside the zone
      // for concave zones, which zeroes out the raster mask and breaks Lloyd initialization.
      // Lloyd iterations will converge to valid positions; wide-overhang is handled by phaseBLloyd.
      const lloydPls = tilePool.map((piece, i) => {
        const cx = seeds[i].x, cy = seeds[i].y;
        const pl = makePlacement(piece, cx, cy, 0, spec, zoneMask);
        pl._lloydTile = true; // sealFragment skips clipping for Lloyd territories
        return pl;
      });

      // Diagnostics: count initial coverage before Lloyd
      {
        let _initCov = 0;
        const _c = new Uint8Array(cellCount);
        for (const pl of lloydPls) { if (!pl.mask) continue; for (let i = 0; i < cellCount; i++) if (pl.mask[i] & 1) _c[i] = 1; }
        for (let i = 0; i < cellCount; i++) if (_c[i]) _initCov++;
        const _pl0 = lloydPls[0];
        const _cp0 = _pl0 && _pl0.corePts;
        const _cx0bbox = _cp0 ? { minX: Math.min(..._cp0.map(p=>p.x)), maxX: Math.max(..._cp0.map(p=>p.x)), minY: Math.min(..._cp0.map(p=>p.y)), maxY: Math.max(..._cp0.map(p=>p.y)) } : null;
        console.log(`[LloydTiling] lloydPls=${lloydPls.length} initCoveredCells=${_initCov}/${zoneCells} pl0.activeCells=${_pl0 ? _pl0.activeCells.length : '?'} pl0.cx=${_pl0 ? Math.round(_pl0.cx) : '?'} pl0.cy=${_pl0 ? Math.round(_pl0.cy) : '?'} coreBbox=${JSON.stringify(_cx0bbox ? {minX:Math.round(_cx0bbox.minX),maxX:Math.round(_cx0bbox.maxX),minY:Math.round(_cx0bbox.minY),maxY:Math.round(_cx0bbox.maxY)} : null)} zoneBbox=${JSON.stringify({minX:Math.round(zoneBbox.minX),maxX:Math.round(zoneBbox.maxX),minY:Math.round(zoneBbox.minY),maxY:Math.round(zoneBbox.maxY)})}`);
      }

      // B: Lloyd iterations — reserve 3s for postprocess; deadline from NOW to avoid IFP-cache eating budget
      const lloydDeadline = Math.min(startTime + maxSolveMs - 3000, Date.now() + Math.max(5000, maxSolveMs - 5000));
      const lloydStats = runPhaseBLloyd({
        placements: lloydPls,
        spec, zoneMask,
        selectedPieces: tilePool,
        napTarget: 0, napTol: 180,
        deadline: lloydDeadline,
        makePlacement, computePowerAssign
      });
      console.log(`[LloydTiling] lloydIters=${lloydStats.lloydIterations} exit=${lloydStats.exitReason} timeMs=${lloydStats.timeMs}`);

      // C: Power assignment after Lloyd convergence
      const lloydWeights = tilePool.map(p => p.areaMm2 / Math.PI);
      const rawAssign = computePowerAssign(lloydPls, lloydStats.finalWeights || lloydWeights, spec, zoneMask);

      // C: Diagnostics: check assignment coverage
      {
        let _assigned = 0, _unassigned = 0;
        for (let i = 0; i < cellCount; i++) {
          if (!zoneMask[i]) continue;
          if (rawAssign[i] < 0) _unassigned++; else _assigned++;
        }
        const _tileHist = new Array(N).fill(0);
        for (let i = 0; i < cellCount; i++) { if (rawAssign[i] >= 0 && rawAssign[i] < N) _tileHist[rawAssign[i]]++; }
        const _minTile = Math.min(..._tileHist.filter(c => c > 0));
        const _maxTile = Math.max(..._tileHist);
        console.log(`[LloydTiling] rawAssign: zoneCells=${zoneCells} assigned=${_assigned} unassigned=${_unassigned} minTileCells=${_minTile} maxTileCells=${_maxTile}`);
      }

      // C: Merge tiles with axis-aligned bbox shorter-side < minWidthMm into best neighbour
      const lloydAssign = (minWidthMm > 0)
        ? mergeTilesByWidth(rawAssign, cellCount, N, spec, minWidthMm)
        : rawAssign.slice();

      // D: Keep only placements with at least one assigned zone-cell
      const activeTileSet = new Set(lloydAssign);
      const activeTiles = lloydPls.filter((_, j) => activeTileSet.has(j));

      // Remap assignment: old j → new index in activeTiles
      const oldToNew = new Map();
      for (let j = 0; j < N; j++) {
        if (activeTileSet.has(j)) oldToNew.set(j, oldToNew.size);
      }
      const remappedAssign = lloydAssign.map(j => (oldToNew.has(j) ? oldToNew.get(j) : -1));

      // Count raster-covered cells for algorithmTrace
      let ltCoveredCells = 0;
      {
        const _cov = new Uint8Array(cellCount);
        for (const pl of activeTiles) {
          if (!pl.mask) continue;
          for (let i = 0; i < cellCount; i++) if (pl.mask[i] & 1) _cov[i] = 1;
        }
        for (let i = 0; i < cellCount; i++) if (_cov[i]) ltCoveredCells++;
      }
      console.log(`[LloydTiling] activeTiles=${activeTiles.length} ltCoveredCells=${ltCoveredCells}/${zoneCells}`);
      // Диагностика: ожидаемая суммарная площадь территорий
      {
        const _cellR2 = spec.r * spec.r;
        let _expArea = 0;
        const _tileCount = activeTiles.length;
        for (let j = 0; j < _tileCount; j++) {
          let cnt = 0;
          for (let i = 0; i < cellCount; i++) if (remappedAssign[i] === j) cnt++;
          _expArea += cnt * _cellR2;
        }
        console.log(`[LloydTiling] expectedTerritoryArea=${Math.round(_expArea)} zoneArea=${Math.round(zoneArea)} zoneCellsArea=${Math.round(zoneCells * _cellR2)}`);
      }

      if (onProgress) {
        const _ltCovPct = zoneCells > 0 ? Math.round(ltCoveredCells / zoneCells * 1000) / 10 : 0;
        try { onProgress({ type: "phase", phase: "postprocess", percent: 97, title: "Voronoi+SA: построение территорий…", pieces: activeTiles.length, coverage: _ltCovPct, iters: lloydStats ? (lloydStats.lloydIterations || 0) : 0, temperature: 0 }); } catch (_) {}
        await new Promise((r) => setImmediate(r));
      }

      const ltTimeMs = Date.now() - _ltStart;
      return formatResult(
        activeTiles, zonePoints, zoneArea, ltCoveredCells, zoneCells,
        0, 0, options, spec, zoneMask, selectionDebug, true,
        ltTimeMs, lloydStats, warnings, effectiveOptions,
        'lloyd_tiling',
        {
          warmDurationMs: 0,
          saBestCoveragePct: ltCoveredCells / zoneCells * 100,
          saAlpha: null,
          lloydAssignment: remappedAssign
        }
      );
    }
    // ─── END LLOYD-TILING BRANCH ──────────────────────────────────────────────

    // ── Precompute IFPs (SA-only — skipped in Lloyd mode above) ─────────────
    const ifpCacheTight = new Map();
    for (let _i = 0; _i < selectedPieces.length; _i++) {
      const piece = selectedPieces[_i];
      const ifp = computeIFP(zonePoints, piece.centeredCorePts);
      if (ifp && ifp.length >= 3) ifpCacheTight.set(piece.id, ifp);
      if (_i % 4 === 3) {
        if (onProgress) onProgress({ type: "phase", phase: "ifp_cache", percent: Math.round(20 + (_i + 1) / selectedPieces.length * 8), title: `Voronoi+SA: поиск допустимых позиций ${_i + 1}/${selectedPieces.length}...`, pieces: 0, coverage: 0, iters: 0, temperature: 0 });
        await new Promise((r) => setImmediate(r));
      }
    }
    const ifpCacheWide = new Map();
    if (overhangMm > 0) {
      const zonePointsForIFP = inflateZonePts(zonePoints, overhangMm);
      for (let _i = 0; _i < selectedPieces.length; _i++) {
        const piece = selectedPieces[_i];
        const ifp = computeIFP(zonePointsForIFP, piece.centeredCorePts);
        if (ifp && ifp.length >= 3) ifpCacheWide.set(piece.id, ifp);
        if (_i % 4 === 3) {
          if (onProgress) onProgress({ type: "phase", phase: "ifp_wide", percent: Math.round(28 + (_i + 1) / selectedPieces.length * 2), title: `Voronoi+SA: поиск позиций у кромки ${_i + 1}/${selectedPieces.length}…`, pieces: 0, coverage: 0, iters: 0, temperature: 0 });
          await new Promise((r) => setImmediate(r));
        }
      }
    }
    // v5.0: wide IFP (с overhang) — ядро дотягивается до края зоны.
    // Tight IFP требовал ядро целиком внутри → краевое кольцо при allowanceMm>0.
    // Wide IFP (зона+overhangMm) разрешает ядру выходить за границу.
    const ifpCache = (overhangMm > 0 && ifpCacheWide.size > 0) ? ifpCacheWide : ifpCacheTight;

    const saSearch = await runSaSearch({
      selectedPieces,
      napTarget,
      napTol,
      spec,
      zoneMask,
      zoneCells,
      zonePoints,
      zoneBbox,
      ifpCache,
      rng,
      onProgress,
      cellCount,
      maxSolveMs,
      maxIterations,
      phaseADeadline,
      phaseBDeadline,
      startTime,
      minWidthMm,
      minLengthMm,
      // v5.3: assign+связность-осознанная in-loop проверка дыр (ловит стыковые гэпы,
      // невидимые union-подходу). За флагом — сравниваем resInt до/после по зонам.
      assignAwareResidual: !!(options && options._assignAwareResidual),
      // v5.3-эксперимент: вес штрафа за перекрытие ядер (undefined → дефолт 0, v5.6).
      overlapWeight: (options && options._overlapWeight != null) ? Number(options._overlapWeight) : undefined,
      // v5.6 «мёртвая зона»: вес штрафа за нахлёст ГЛУБЖЕ запаса шва (deep-перекрытие).
      deepOverlapWeight: (options && options._deepOverlapWeight != null) ? Number(options._deepOverlapWeight) : undefined,
      // v5.3-эксперимент: адаптивное уплотнение стыков (низкий штраф перекрытия +
      // прицельный TRANSLATE, только когда остались мелкие внутренние дыры).
      junctionConsolidation: !!(options && options._junctionConsolidation)
    });

    let bestPlacements = saSearch.bestPlacements;
    let bestCoveredCells = saSearch.bestCoveredCells;
    const iters = saSearch.iters;
    const accepted = saSearch.accepted;
    const T = saSearch.T;
    const Tmin = saSearch.Tmin;
    const phaseATimeMs = saSearch.phaseATimeMs;
    const warmDurationMs = saSearch.warmDurationMs || 0;
    const saBestCoveragePct = saSearch.bestCoveragePct || 0;
    const saAlpha = saSearch.alpha || null;
    // computeGeomResidual disabled — O(N²) Clipper ops for N=50+ pieces (hangs). Polygon coverage in formatResult.
    const phaseAGeomResidualMm2 = 0;
    const phaseAGeomCoveragePct = 0;

    let phaseBStats = {
      timeMs: 0,
      lloydIterations: 0,
      exitReason: "no_time",
      notContainedTotal_start: 0,
      notContainedTotal_end: 0,
      weightAdaptationCycles: 0,
      finalWeights: null,
      skipped: true,
      skipReason: "no_time"
    };

    const skipLloyd = options._skipLloyd !== false; // default true = skip Lloyd unless explicitly enabled
    // v5.4: фаза B БОЛЬШЕ НЕ зависит от wall-clock. Раньше гейт `Date.now() < phaseBDeadline`
    // молча пропускал полировку, когда итерационно-первичный SA (v5.1) выходил позже 90с:
    // на быстрой машине Lloyd успевал (кромка упакована), на занятом сервере — нет
    // (полосы у края). Теперь Lloyd работает всегда, бюджет итерационный, deadline —
    // только страховка от зависания.
    if (isMosaic && !skipLloyd && bestPlacements.length > 0) {
      // Snapshot phaseA-best before Lloyd mutates placements in-place
      const phaseASnapshot = bestPlacements.map(pl => ({ ...pl, mask: pl.mask ? pl.mask.slice() : null }));
      const phaseACoveredCells = bestCoveredCells;

      phaseBStats = runPhaseBLloyd({
        placements: bestPlacements,
        spec,
        zoneMask,
        selectedPieces,
        napTarget,
        napTol,
        maxIterations: 60,
        deadline: Date.now() + 45000,
        makePlacement,
        computePowerAssign
      });

      // Raster guard: count raw covered zone-cells after Lloyd, before any postprocess.
      // The old guard used formatResult (which runs polygonResidualAbsorption internally),
      // masking Lloyd's coverage drop — Lloyd never reverted. Simple O(N·C) raster count is honest.
      let lloydCoveredCells = 0;
      {
        const _cov = new Uint8Array(cellCount);
        for (const pl of bestPlacements) {
          if (!pl.mask) continue;
          if (pl.activeCells) {
            for (let _j = 0; _j < pl.activeCells.length; _j++) _cov[pl.activeCells[_j]] = 1;
          } else {
            for (let _i = 0; _i < cellCount; _i++) { if (pl.mask[_i] & 1) _cov[_i] = 1; }
          }
        }
        for (let _i = 0; _i < cellCount; _i++) if (_cov[_i]) lloydCoveredCells++;
      }
      const lloydRasterDelta = lloydCoveredCells - phaseACoveredCells;
      console.log(`[VSA-Lloyd-guard] phaseA=${phaseACoveredCells} lloyd=${lloydCoveredCells} delta=${lloydRasterDelta}`);
      if (lloydCoveredCells < phaseACoveredCells) {
        bestPlacements.length = 0;
        for (const pl of phaseASnapshot) bestPlacements.push(pl);
        bestCoveredCells = phaseACoveredCells;
        phaseBStats.reverted = true;
        phaseBStats.revertReason = `raster_coverage_drop: lloyd=${lloydCoveredCells} phaseA=${phaseACoveredCells} delta=${lloydRasterDelta}`;
        console.log(`[VSA-Lloyd-guard] REVERTED — raster coverage dropped by ${-lloydRasterDelta} cells`);
      }
    }

    const finalPlacements = bestPlacements.filter(p => p.mask && p.mask.some(v => v > 0));
    // Use the real exit reason tracked inside the SA loop, not a post-hoc guess from final state.
    const _saExitReason = saSearch.saExitReason || "unknown";
    if (onProgress) {
      try { onProgress({ type: "phase", phase: "postprocess", percent: 97, title: "Voronoi+SA: построение территорий…" }); } catch (_) {}
      await new Promise((r) => setImmediate(r)); // flush SSE to client before blocking sync work
    }
    const t0fmt = Date.now();
    const saResult = formatResult(finalPlacements, zonePoints, zoneArea, bestCoveredCells, zoneCells, iters, accepted, options, spec, zoneMask, selectionDebug, isMosaic, phaseATimeMs, phaseBStats, warnings, effectiveOptions, _saExitReason, { geomCoveragePct: phaseAGeomCoveragePct, geomResidualMm2: Math.round(phaseAGeomResidualMm2), warmDurationMs, saBestCoveragePct, saAlpha, saCulled: saSearch.culled || [] });
    console.log(`[VSA] formatResult: ${Date.now() - t0fmt}ms for ${finalPlacements.length} pieces`);

    // Targeted cycle disabled — calls fmtResult per gap-component (O(N_comps × formatResult)) → hangs.
    // Anchor: return SA result directly. Targeted cycle to be reintroduced incrementally.

    // ── v5.4 SWAP-ремонт стыков (за флагом) ─────────────────────────────────
    // Дыра на стыке = «кусок чуть мал для своего места». Одиночные SA-ходы её не
    // закрывают (сдвиг куска открывает дыру за ним), а ЗАМЕНА куска на больший —
    // одиночный ход без каскада: большее ядро накрывает и старую территорию, и дыру,
    // биссектрисы перережут перекрытия, R5 не нарушается (территория растёт).
    // Бюджет жёсткий: растровый префильтр кандидатов, ≤3 полных пересборок, ≤25с.
    if (isMosaic && options && options._swapRepair && saResult && saResult.ok !== false
        && (Number(saResult.residualInteriorMm2 || 0) > 2
          || Number(saResult.residualPerimeterMm2 || 0) > 2)) {
      if (onProgress) {
        try { onProgress({ type: "phase", phase: "postprocess", percent: 98, title: "Voronoi+SA: ремонт стыков (замена кусков)…" }); } catch (_) {}
        await new Promise((r) => setImmediate(r));
      }
      const _fmtForRepair = (pls) => {
        let cov = 0;
        const covered = new Uint8Array(cellCount);
        for (const p of pls) { const cs = p.activeCells; if (cs) for (let k = 0; k < cs.length; k++) covered[cs[k]] = 1; }
        for (let i = 0; i < cellCount; i++) cov += covered[i];
        return formatResult(pls, zonePoints, zoneArea, cov, zoneCells, iters, accepted, options, spec, zoneMask, selectionDebug, isMosaic, phaseATimeMs, phaseBStats, warnings.slice(), effectiveOptions, _saExitReason, { geomCoveragePct: phaseAGeomCoveragePct, geomResidualMm2: Math.round(phaseAGeomResidualMm2), warmDurationMs, saBestCoveragePct, saAlpha, saCulled: saSearch.culled || [] });
      };
      const repaired = trySwapRepairMosaic({
        baseResult: saResult,
        basePlacements: finalPlacements,
        piecesAll: pieces,
        spec,
        zoneMask,
        cellCount,
        fmt: _fmtForRepair
      });
      if (repaired) return repaired;
    }
    return saResult;
  }

  // ── v5.4: SWAP-ремонт стыковых дыр (мозаика) ────────────────────────────────
  // Для каждой внутренней дыры: граничащие куски → кандидаты покрупнее из остатка →
  // растровый префильтр (новое ядро покрывает и уникальные клетки старого, и дыру) →
  // полная пересборка только для прошедших. Принимаем строго по рангу
  // (ok > partial > failed → дыры → покрытие) и снижению дыр минимум на 10мм².
  function trySwapRepairMosaic(args) {
    const { baseResult, basePlacements, piecesAll, spec, zoneMask, cellCount, fmt } = args;
    const t0 = Date.now();
    const WALL_MS = 30000;
    const MAX_REBUILDS = 6;
    const MAX_INTERIOR_REBUILDS = 4;
    const interior = (baseResult.uncoveredComponents || [])
      .filter((c) => c && c.classification === "interior" && c.areaMm2 >= 30 && Array.isArray(c.pts) && c.pts.length >= 3)
      .sort((a, b) => b.areaMm2 - a.areaMm2);
    // Крупные краевые полосы (недоупаковка кромки): лечатся ДОБАВЛЕНИЕМ куска —
    // место пустое, замена не нужна, свес за край покрывает overhang.
    const edgeComps = (baseResult.uncoveredComponents || [])
      .filter((c) => c && c.classification === "edge" && c.areaMm2 >= 30 && Array.isArray(c.pts) && c.pts.length >= 3)
      .sort((a, b) => b.areaMm2 - a.areaMm2);
    if (!interior.length && !edgeComps.length) return null;

    const { nx, ny, r, ox, oy } = spec;
    const rank = (res) => (res.resultStatus === "ok" ? 0 : res.resultStatus === "partial" ? 1 : 2) * 1e9
      + Math.min(Number(res.residualInteriorMm2 || 0), 1e6) * 100
      + Math.max(0, 100 - Number(res.coveragePercent || 0));
    // Ремонт не имеет права вводить НОВЫЙ класс брака: оба «failed» ранжируются одинаково,
    // и без этого guard'а обмен edge_deficit → sub_min_fragment_R5 проходил как «улучшение».
    const _hasR5 = (res) => {
      const ws = res && res.invariants && Array.isArray(res.invariants.warnings) ? res.invariants.warnings : [];
      return ws.some((w) => /^R5_/.test(String(w)) || /sub.?min/i.test(String(w)))
        || /sub_min_fragment/.test(String(res && res.failedReason || ""));
    };
    const _noNewViolation = (cand, cur) => !(_hasR5(cand) && !_hasR5(cur));

    let curResult = baseResult;
    let curPlacements = basePlacements;
    let rebuilds = 0;
    const diag = [];

    for (const comp of interior.slice(0, 2)) {
      if (Date.now() - t0 > WALL_MS || rebuilds >= MAX_INTERIOR_REBUILDS) break;
      // Растровая маска дыры
      const cb = comp.bbox;
      const colMin = Math.max(0, Math.floor((cb.minX - ox) / r));
      const colMax = Math.min(nx - 1, Math.ceil((cb.maxX - ox) / r));
      const rowMin = Math.max(0, Math.floor((cb.minY - oy) / r));
      const rowMax = Math.min(ny - 1, Math.ceil((cb.maxY - oy) / r));
      const compCells = [];
      for (let row = rowMin; row <= rowMax; row++) {
        for (let col = colMin; col <= colMax; col++) {
          const cx = ox + (col + 0.5) * r;
          const cy = oy + (row + 0.5) * r;
          if (pointInPolygon(cx, cy, comp.pts)) compCells.push(row * nx + col);
        }
      }
      if (!compCells.length) continue;

      // Сколько ядер накрывает каждую клетку (для «уникальных» клеток старого куска)
      const counts = new Uint8Array(cellCount);
      for (const p of curPlacements) { const cs = p.activeCells; if (cs) for (let k = 0; k < cs.length; k++) counts[cs[k]]++; }

      const usedIds = new Set(curPlacements.map((p) => p.id));
      const unused = piecesAll.filter((p) => !usedIds.has(p.id)).sort((a, b) => a.areaMm2 - b.areaMm2);
      if (!unused.length) break;

      // Граничащие куски: bbox ядра пересекает bbox дыры + 8мм, ближние первыми
      const borders = curPlacements.map((pl) => {
        const pb = polygonBBox(pl.corePts);
        if (!pb) return null;
        if (pb.maxX < cb.minX - 8 || pb.minX > cb.maxX + 8 || pb.maxY < cb.minY - 8 || pb.minY > cb.maxY + 8) return null;
        const ddx = pl.cx - comp.centroid.x, ddy = pl.cy - comp.centroid.y;
        return { pl, d2: ddx * ddx + ddy * ddy };
      }).filter(Boolean).sort((a, b) => a.d2 - b.d2).slice(0, 3);

      let patched = false;
      for (const { pl } of borders) {
        if (patched || Date.now() - t0 > WALL_MS || rebuilds >= MAX_REBUILDS) break;
        const oldPiece = piecesAll.find((p) => p.id === pl.id);
        const oldArea = oldPiece ? oldPiece.areaMm2 : 0;
        const oldOnly = [];
        const cs = pl.activeCells || [];
        for (let k = 0; k < cs.length; k++) { const i = cs[k]; if (counts[i] === 1 && zoneMask[i]) oldOnly.push(i); }

        const cands = unused.filter((p) => p.areaMm2 >= Math.max(oldArea * 0.9, 1)).slice(0, 8);
        diag.push({ probe: true, holeMm2: Math.round(comp.areaMm2), border: pl.id, oldOnlyCells: oldOnly.length, candsTried: cands.length });
        for (const cand of cands) {
          if (patched || Date.now() - t0 > WALL_MS || rebuilds >= MAX_REBUILDS) break;
          const toX = comp.centroid.x - pl.cx, toY = comp.centroid.y - pl.cy;
          const dl = Math.max(1, Math.hypot(toX, toY));
          // Позиции примерки: на месте старого; чуть к дыре; центр bbox «старое ядро + дыра»
          // (для кандидата иной формы центр объединённой цели даёт лучший охват обоих).
          const _plb = polygonBBox(pl.corePts);
          const _ux = _plb ? (Math.min(_plb.minX, cb.minX) + Math.max(_plb.maxX, cb.maxX)) / 2 : pl.cx;
          const _uy = _plb ? (Math.min(_plb.minY, cb.minY) + Math.max(_plb.maxY, cb.maxY)) / 2 : pl.cy;
          const tries = [
            [pl.cx, pl.cy],
            [pl.cx + toX / dl * Math.min(15, dl * 0.3), pl.cy + toY / dl * Math.min(15, dl * 0.3)],
            [_ux, _uy]
          ];
          const probe = diag[diag.length - 1];
          for (const [tx, ty] of tries) {
            const np = makePlacement(cand, tx, ty, 0, spec, zoneMask);
            if (!np.activeCells || np.activeCells.length === 0) { probe.emptyMask = (probe.emptyMask || 0) + 1; continue; }
            // Префильтр 1: новое ядро держит уникальные клетки старого (иначе откроем дыру
            // за спиной). Порог 0.90: жёсткие 0.97 не проходил ни один кусок иной формы,
            // а финальную годность всё равно решает пересборка с ранговой защитой.
            let oldCov = 0;
            for (let k = 0; k < oldOnly.length; k++) if (np.mask[oldOnly[k]] & 1) oldCov++;
            if (oldOnly.length > 0 && oldCov / oldOnly.length < 0.90) { probe.f1 = (probe.f1 || 0) + 1; continue; }
            // Префильтр 2: новое ядро накрывает саму дыру
            let compCov = 0;
            for (let k = 0; k < compCells.length; k++) if (np.mask[compCells[k]] & 1) compCov++;
            if (compCov / compCells.length < 0.8) { probe.f2 = (probe.f2 || 0) + 1; continue; }

            rebuilds++;
            const candPls = curPlacements.map((p) => (p === pl ? np : p));
            const candResult = fmt(candPls);
            const accepted = _noNewViolation(candResult, curResult) && rank(candResult) < rank(curResult)
              && Number(candResult.residualInteriorMm2 || 0) <= Number(curResult.residualInteriorMm2 || 0) - 10;
            diag.push({
              holeMm2: Math.round(comp.areaMm2),
              swapOut: pl.id, swapIn: cand.id,
              resIntAfter: Math.round(Number(candResult.residualInteriorMm2 || 0)),
              accepted
            });
            if (accepted) {
              curResult = candResult;
              curPlacements = candPls;
              patched = true;
            }
            break; // одна пересборка на кандидата
          }
        }
      }
    }

    // ── Ремонт крупных краевых полос (многопроходный) ───────────────────────
    // Компоненты берём из ТЕКУЩЕГО результата и пересчитываем после каждой удачной
    // заплатки: успешный патч меняет картину остатка (900мм² → 199мм² — добиваем).
    for (let _edgePass = 0; _edgePass < 3; _edgePass++) {
    let _edgeAnyPatched = false;
    const edgeNow = ((curResult.uncoveredComponents || [])
      .filter((c) => c && c.classification === "edge" && c.areaMm2 >= 30 && Array.isArray(c.pts) && c.pts.length >= 3)
      .sort((a, b) => b.areaMm2 - a.areaMm2)).slice(0, 2);
    if (!edgeNow.length) break;
    for (const comp of edgeNow) {
      if (Date.now() - t0 > WALL_MS || rebuilds >= MAX_REBUILDS) break;
      const cb = comp.bbox;
      const colMin = Math.max(0, Math.floor((cb.minX - ox) / r));
      const colMax = Math.min(nx - 1, Math.ceil((cb.maxX - ox) / r));
      const rowMin = Math.max(0, Math.floor((cb.minY - oy) / r));
      const rowMax = Math.min(ny - 1, Math.ceil((cb.maxY - oy) / r));
      const compCells = [];
      for (let row = rowMin; row <= rowMax; row++) {
        for (let col = colMin; col <= colMax; col++) {
          const cx = ox + (col + 0.5) * r;
          const cy = oy + (row + 0.5) * r;
          if (pointInPolygon(cx, cy, comp.pts)) compCells.push(row * nx + col);
        }
      }
      if (!compCells.length) continue;

      // ── Сначала SWAP-увеличение граничащего куска ─────────────────────────
      // ADD-заплатка на узкой полосе рождает фрагмент уже minWidth → R5 (доказано
      // диагностикой e303: все кандидаты failed:sub_min_fragment_R5). Увеличение
      // соседа свободно от этого: его фрагмент прирастает полосой, оставаясь большим.
      let patched = false;
      {
        const counts2 = new Uint8Array(cellCount);
        for (const p of curPlacements) { const cs2 = p.activeCells; if (cs2) for (let k = 0; k < cs2.length; k++) counts2[cs2[k]]++; }
        const usedIds2 = new Set(curPlacements.map((p) => p.id));
        const unused2 = piecesAll.filter((p) => !usedIds2.has(p.id)).sort((a, b) => a.areaMm2 - b.areaMm2);
        const borders2 = curPlacements.map((pl) => {
          const pb = polygonBBox(pl.corePts);
          if (!pb) return null;
          if (pb.maxX < cb.minX - 8 || pb.minX > cb.maxX + 8 || pb.maxY < cb.minY - 8 || pb.minY > cb.maxY + 8) return null;
          const ddx = pl.cx - comp.centroid.x, ddy = pl.cy - comp.centroid.y;
          return { pl, d2: ddx * ddx + ddy * ddy };
        }).filter(Boolean).sort((a, b) => a.d2 - b.d2).slice(0, 3);
        for (const { pl } of borders2) {
          if (patched || Date.now() - t0 > WALL_MS || rebuilds >= MAX_REBUILDS) break;
          const oldPiece2 = piecesAll.find((p) => p.id === pl.id);
          const oldArea2 = oldPiece2 ? oldPiece2.areaMm2 : 0;
          const oldOnly2 = [];
          const cs2 = pl.activeCells || [];
          for (let k = 0; k < cs2.length; k++) { const i = cs2[k]; if (counts2[i] === 1 && zoneMask[i]) oldOnly2.push(i); }
          const cands2 = unused2.filter((p) => p.areaMm2 >= oldArea2 + comp.areaMm2 * 0.5).slice(0, 8);
          diag.push({ probe: true, edgeSwap: true, holeMm2: Math.round(comp.areaMm2), border: pl.id, candsTried: cands2.length });
          const probe2 = diag[diag.length - 1];
          for (const cand of cands2) {
            if (patched || Date.now() - t0 > WALL_MS || rebuilds >= MAX_REBUILDS) break;
            const _plb2 = polygonBBox(pl.corePts);
            const _ux2 = _plb2 ? (Math.min(_plb2.minX, cb.minX) + Math.max(_plb2.maxX, cb.maxX)) / 2 : pl.cx;
            const _uy2 = _plb2 ? (Math.min(_plb2.minY, cb.minY) + Math.max(_plb2.maxY, cb.maxY)) / 2 : pl.cy;
            const toX2 = comp.centroid.x - pl.cx, toY2 = comp.centroid.y - pl.cy;
            const dl2 = Math.max(1, Math.hypot(toX2, toY2));
            const tries2 = [
              [pl.cx, pl.cy],
              [pl.cx + toX2 / dl2 * Math.min(25, dl2 * 0.4), pl.cy + toY2 / dl2 * Math.min(25, dl2 * 0.4)],
              [_ux2, _uy2]
            ];
            for (const [tx2, ty2] of tries2) {
              const np2 = makePlacement(cand, tx2, ty2, 0, spec, zoneMask);
              if (!np2.activeCells || np2.activeCells.length === 0) { probe2.emptyMask = (probe2.emptyMask || 0) + 1; continue; }
              let oldCov2 = 0;
              for (let k = 0; k < oldOnly2.length; k++) if (np2.mask[oldOnly2[k]] & 1) oldCov2++;
              if (oldOnly2.length > 0 && oldCov2 / oldOnly2.length < 0.90) { probe2.f1 = (probe2.f1 || 0) + 1; continue; }
              let compCov2 = 0;
              for (let k = 0; k < compCells.length; k++) if (np2.mask[compCells[k]] & 1) compCov2++;
              if (compCov2 / compCells.length < 0.6) { probe2.f2 = (probe2.f2 || 0) + 1; continue; }
              rebuilds++;
              const candPls2 = curPlacements.map((p) => (p === pl ? np2 : p));
              const candResult2 = fmt(candPls2);
              const accepted2 = _noNewViolation(candResult2, curResult) && rank(candResult2) < rank(curResult)
                && Number(candResult2.residualInteriorMm2 || 0) <= Number(curResult.residualInteriorMm2 || 0);
              diag.push({
                edgeSwap: true,
                holeMm2: Math.round(comp.areaMm2),
                swapOut: pl.id, swapIn: cand.id,
                covAfter: Math.round(Number(candResult2.coveragePercent || 0) * 100) / 100,
                resIntAfter: Math.round(Number(candResult2.residualInteriorMm2 || 0)),
                statusAfter: String(candResult2.resultStatus || "?") + (candResult2.failedReason ? ":" + candResult2.failedReason : ""),
                accepted: accepted2
              });
              if (accepted2) {
                curResult = candResult2;
                curPlacements = candPls2;
                patched = true;
              }
              break;
            }
          }
        }
      }
      if (patched) { _edgeAnyPatched = true; continue; }

      const usedIds = new Set(curPlacements.map((p) => p.id));
      const cands = piecesAll
        .filter((p) => !usedIds.has(p.id) && p.areaMm2 >= comp.areaMm2)
        .sort((a, b) => a.areaMm2 - b.areaMm2)
        .slice(0, 10);
      const bw = cb.maxX - cb.minX, bh = cb.maxY - cb.minY;
      diag.push({ probe: true, edgeAdd: true, holeMm2: Math.round(comp.areaMm2), candsTried: cands.length });
      const probe = diag[diag.length - 1];
      for (const cand of cands) {
        if (patched || Date.now() - t0 > WALL_MS || rebuilds >= MAX_REBUILDS) break;
        // Позиции: центроид полосы и сдвиги на четверть габарита вдоль/поперёк —
        // свес за край (overhang) уже учтён в zoneMask-клиппинге makePlacement.
        const tries = [
          [comp.centroid.x, comp.centroid.y],
          [comp.centroid.x + bw / 4, comp.centroid.y], [comp.centroid.x - bw / 4, comp.centroid.y],
          [comp.centroid.x, comp.centroid.y + bh / 4], [comp.centroid.x, comp.centroid.y - bh / 4]
        ];
        for (const [tx, ty] of tries) {
          const np = makePlacement(cand, tx, ty, 0, spec, zoneMask);
          if (!np.activeCells || np.activeCells.length === 0) { probe.emptyMask = (probe.emptyMask || 0) + 1; continue; }
          // Префильтр: ядро кандидата накрывает ≥70% полосы
          let compCov = 0;
          for (let k = 0; k < compCells.length; k++) if (np.mask[compCells[k]] & 1) compCov++;
          if (compCov / compCells.length < 0.7) { probe.f2 = (probe.f2 || 0) + 1; continue; }

          rebuilds++;
          const candPls = curPlacements.concat([np]);
          const candResult = fmt(candPls);
          // Принятие: ранг строго лучше И внутренние дыры не выросли (ADD у края
          // не должен покупать покрытие ценой нового внутреннего брака или R5).
          const accepted = _noNewViolation(candResult, curResult) && rank(candResult) < rank(curResult)
            && Number(candResult.residualInteriorMm2 || 0) <= Number(curResult.residualInteriorMm2 || 0);
          diag.push({
            edgeAdd: true,
            holeMm2: Math.round(comp.areaMm2),
            addIn: cand.id,
            covAfter: Math.round(Number(candResult.coveragePercent || 0) * 100) / 100,
            resPerimAfter: Math.round(Number(candResult.residualPerimeterMm2 || 0)),
            resIntAfter: Math.round(Number(candResult.residualInteriorMm2 || 0)),
            statusAfter: String(candResult.resultStatus || "?") + (candResult.failedReason ? ":" + candResult.failedReason : ""),
            accepted
          });
          if (accepted) {
            curResult = candResult;
            curPlacements = candPls;
            patched = true;
          }
          break; // одна пересборка на кандидата
        }
      }
      if (patched) _edgeAnyPatched = true;
    }
    // Пасс без единой заплатки — дальше без шансов, выходим.
    if (!_edgeAnyPatched || Date.now() - t0 > WALL_MS || rebuilds >= MAX_REBUILDS) break;
    }

    const summary = { applied: diag.filter((d) => d.accepted).length, rebuilds, elapsedMs: Date.now() - t0, diag };
    if (curResult !== baseResult) {
      if (curResult.algorithmTrace) curResult.algorithmTrace.swapRepair = summary;
      console.log(`[VSA-SwapRepair] applied=${summary.applied} rebuilds=${rebuilds} in ${summary.elapsedMs}ms`);
      return curResult;
    }
    if (baseResult.algorithmTrace) baseResult.algorithmTrace.swapRepair = summary;
    console.log(`[VSA-SwapRepair] no improvement (rebuilds=${rebuilds}, ${summary.elapsedMs}ms)`);
    return null;
  }


  // ── Polygon-accurate coverage (one geometry for numerator & denominator) ────
  // Clips fragment union to zone, computes residual as Difference(zone, union).
  // Returns { coveredRatio, residualAreaMm2, uncoveredComponents }.
  // uncoveredComponents: array of { areaMm2, bbox, centroid } sorted by area desc —
  // ready input for targeted ADD.
  function computeResidualCoverage(resultPlacements, zonePoints, zoneArea, gridStepMm, dissolvedPlacements) {
    return coverageTools.computeResidualCoverage(resultPlacements, zonePoints, zoneArea, gridStepMm, dissolvedPlacements);
  }

  const { formatResult, emptyResult } = createVoronoiSaResultBuilder({
    buildTerritoryOutput,
    buildPolygonalTerritoryOutput,
    regularizePartition,
    runInitialPostprocess,
    runPolygonResidualAbsorption,
    collectDuplicatePieceWarnings,
    computeAbsorptionDiagnostic,
    computeResultInvariants,
    computeResidualCoverage,
    CLIPPER_SCALE,
    computePowerAssign,
    polygonBBox,
    pointsToMultiPolygon,
    multiPolygonArea,
    intersectMulti,
    diffMulti,
    unionMulti,
    mpToPoints,
    fillGapsVoronoi,
    absorbResidualCells,
    dissolveSmallFragments,
    sealFragment,
    coreFragmentForTerritory
  });

  // ── Multi-restart wrapper ────────────────────────────────────────────────────
  // Budget split: ~0.7 for SA restarts, ~0.3 for targeted cycle on the winner.
  // Restarts use _skipTargeted:true so each restart gets full SA budget share without
  // paying for targeted. Targeted runs once on the best SA result.
  // numRestarts=1 falls through to plain solve() (targeted inline).
  async function solveMultiRestart(zonePoints, candidates, constraints, options) {
    const numRestarts = Math.max(1, Number((options && options.numRestarts) || 1));
    if (numRestarts <= 1) return solve(zonePoints, candidates, constraints, options);

    const baseSeed     = Number((options && options.seed) || 1);
    const totalMs      = Math.max(1, Number((options && options.maxSolveMs) || 60000));
    const targetedMs   = Math.floor(totalMs * 0.3);
    // v5.3: numRestarts = МАКСИМУМ попыток, есть ранний выход по чистому результату.
    // Каждому рестарту — ПОЛНЫЙ totalMs: урезание на targeted-долю ужимало phaseB и
    // постобработку и дало регрессию качества (zone 2, 63с вместо 90с). Targeted-цикл
    // после этого получает свой добавочный бюджет отдельно.
    const saMs         = totalMs;
    const onProgress   = (options && options.onProgress) || null;

    let bestResult = null;
    let bestScore  = Infinity;
    const perSeedStats = [];

    // Временной конверт рестартов: solve итерационно-первичен (v5.1) и на тяжёлой зоне
    // занимает кратно больше maxSolveMs — без конверта numRestarts=3 давал 30-40 минут.
    // Следующий рестарт стартует только пока израсходовано < 1.5×maxSolveMs; на тяжёлых
    // зонах это честно вырождается в одиночный прогон.
    const _restartT0 = Date.now();
    const RESTART_ENVELOPE_MS = Math.floor(totalMs * 1.5);

    // Phase 1: SA restarts (skip targeted so budget stays in SA)
    for (let i = 0; i < numRestarts; i++) {
      if (i > 0 && (Date.now() - _restartT0) > RESTART_ENVELOPE_MS) {
        perSeedStats.push({ restart: i + 1, skipped: "time_envelope", elapsedMs: Date.now() - _restartT0 });
        break;
      }
      const runOptions = Object.assign({}, options, {
        seed: baseSeed + i,
        maxSolveMs: saMs,
        _skipTargeted: true,
        onProgress: onProgress ? (evt) => {
          onProgress(Object.assign({}, evt, {
            title: `Рестарт ${i + 1}/${numRestarts}: ${evt.title || ""}`
          }));
        } : null
      });
      const result = await solve(zonePoints, candidates, constraints, runOptions);
      const resInt = (result && result.residualInteriorMm2 != null)
        ? result.residualInteriorMm2
        : (result && result.stats && result.stats.residualInteriorMm2 != null ? result.stats.residualInteriorMm2 : null);
      const covPct = (result && result.coveragePercent != null)
        ? result.coveragePercent
        : (result && result.stats && result.stats.coveragePercent != null ? result.stats.coveragePercent : null);
      perSeedStats.push({
        restart: i + 1,
        seed: baseSeed + i,
        residualInteriorMm2: resInt != null ? Math.round(resInt) : null,
        coveragePercent: covPct != null ? Math.round(covPct * 100) / 100 : null,
        pieces: Array.isArray(result && result.placements) ? result.placements.length : null
      });
      // Ранжирование: статус (ok > partial > failed) → внутренние дыры → покрытие.
      // Ловит и случай «resInt=0, но R5-брак» — такой прогон не должен побеждать ok.
      const statusRank = result && result.resultStatus === "ok" ? 0
        : (result && result.resultStatus === "partial" ? 1 : 2);
      const score = statusRank * 1e9
        + (resInt != null ? Math.min(resInt, 1e6) : 1e6) * 100
        + Math.max(0, 100 - (covPct || 0));
      if (bestResult === null || score < bestScore) {
        bestScore  = score;
        bestResult = result;
      }
      // Ранний выход: честный «ok» уже означает ноль внутренних дыр (гейт в result.js) —
      // оставшиеся рестарты не нужны, время пользователя дороже.
      if (result && result.resultStatus === "ok") break;
    }

    if (bestResult) {
      bestResult._multiRestartStats = { numRestarts, totalMs, saMs, targetedMs, baseSeed, perSeed: perSeedStats, bestScore: Math.round(bestScore) };
    }

    if (!bestResult) return bestResult;

    // Phase 2: targeted cycle once on best SA result
    const tc = bestResult._internalForTC;
    delete bestResult._internalForTC;
    if (!tc) return bestResult;

    const targetedOptions = Object.assign({}, options, { maxSolveMs: targetedMs, _skipTargeted: false });
    return runTargetedCycle({
      baseResult: bestResult,
      saFinalPlacements: tc.saFinalPlacements,
      zonePoints,
      zoneArea: tc.zoneArea,
      zoneCells: tc.zoneCells,
      pieces: tc.pieces,
      ifpCacheTight: tc.ifpCacheTight,
      ifpCacheWide: tc.ifpCacheWide,
      spec: tc.spec,
      zoneMask: tc.zoneMask,
      cellCount: tc.cellCount,
      napTarget: tc.napTarget,
      napTol: tc.napTol,
      overhangMm: tc.overhangMm,
      isMosaic: tc.isMosaic,
      selectionDebug: tc.selectionDebug,
      phaseATimeMs: tc.phaseATimeMs,
      phaseBStats: tc.phaseBStats,
      warnings: [],
      effectiveOptions: tc.effectiveOptions,
      options: targetedOptions,
      computeCoverage,
      formatResult,
      pointInPolygon,
      polygonBBox,
      normalizeDeg,
      deltaDeg,
      makePlacement
    });
  }

  return { solve: solveMultiRestart };
}

module.exports = { createVoronoiSaSolver };
