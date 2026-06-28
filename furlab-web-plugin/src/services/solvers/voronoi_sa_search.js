"use strict";

function createVoronoiSaSearch(deps) {
  const polygonBBox = deps.polygonBBox;
  const normalizeDeg = deps.normalizeDeg;
  const pointInPolygon = deps.pointInPolygon;
  const sampleInPoly = deps.sampleInPoly;
  const makePlacement = deps.makePlacement;
  const countAnd = deps.countAnd;
  const buildUncovered = deps.buildUncovered;
  const computeCoverage = deps.computeCoverage;
  const energy = deps.energy;
  const pickMove = deps.pickMove;
  const MOVES = deps.MOVES;
  const deltaDeg = deps.deltaDeg;
  const transformPiece = deps.transformPiece;
  // Полигональная проверка покрытия (для exit-decision и ADD-guard).
  const pointsToMultiPolygon = deps.pointsToMultiPolygon;
  const unionMulti = deps.unionMulti;
  const intersectMulti = deps.intersectMulti;
  const diffMulti = deps.diffMulti;
  const multiPolygonArea = deps.multiPolygonArea;

  // ── rotating-calipers MBR shorter side ───────────────────────────────────────
  // Тот же метод, что в верификаторе (shapely minimum_rotated_rectangle).
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
  // minW-guard: rotating calipers на ядре в мировой СК после transformPiece.
  function coreMinWAfterPlacement(piece, angleDeg, cx, cy) {
    if (!piece || !piece.centeredCorePts || piece.centeredCorePts.length < 3) return Infinity;
    const worldPts = transformPiece(piece.centeredCorePts, angleDeg, cx, cy);
    return minBoundingRectShorter(worldPts);
  }

  function sampleAnchor(piece, ifpCache, zonePoints, zoneBbox, rng) {
    const ifp = ifpCache.get(piece.id);
    if (ifp && rng.next() < 0.7) {
      const pos = sampleInPoly(ifp, polygonBBox(ifp), rng);
      if (pos) return pos;
    }
    return sampleInPoly(zonePoints, zoneBbox, rng);
  }

  function findLargestUncoveredBlobCentroid(placements, spec, zoneMask, cellCount) {
    // v5.0 §4: находим крупнейший непокрытый блок (по числу клеток).
    // Примечание: длинные тонкие «дыры» с низким fill_ratio — это растровые артефакты
    // (извилистые змейки по швам между кусками), они прощаются эрозией, не приоритет для ADD.
    const { nx, ny, r, ox, oy } = spec;
    const covered = new Uint8Array(cellCount);
    for (const pl of placements) {
      if (pl.mask) for (let i = 0; i < cellCount; i++) if (pl.mask[i] & 1) covered[i] = 1;
    }
    const visited = new Uint8Array(cellCount);
    let bestSize = 0;
    let bestCx = 0;
    let bestCy = 0;
    const queue = new Int32Array(cellCount);
    for (let start = 0; start < cellCount; start++) {
      if (!zoneMask[start] || covered[start] || visited[start]) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      visited[start] = 1;
      let sx = 0;
      let sy = 0;
      let n = 0;
      while (head < tail) {
        const idx = queue[head++];
        const col = idx % nx;
        const row = (idx / nx) | 0;
        sx += ox + (col + 0.5) * r;
        sy += oy + (row + 0.5) * r;
        n++;
        const neighbors = [
          col > 0 ? idx - 1 : -1,
          col < nx - 1 ? idx + 1 : -1,
          row > 0 ? idx - nx : -1,
          row < ny - 1 ? idx + nx : -1
        ];
        for (const ni of neighbors) {
          if (ni < 0 || ni >= cellCount) continue;
          if (!zoneMask[ni] || covered[ni] || visited[ni]) continue;
          visited[ni] = 1;
          queue[tail++] = ni;
        }
      }
      if (n > bestSize) {
        bestSize = n;
        bestCx = sx / n;
        bestCy = sy / n;
      }
    }
    return bestSize > 0 ? { x: bestCx, y: bestCy, size: bestSize } : null;
  }

  // ── findUncoveredBlobs (v5.0 Fix тип 2) ─────────────────────────────────────
  // Возвращает СПИСОК всех непокрытых растровых блобов, edge-first, по убыванию size.
  // Блобы < minBlobCells (3 клетки = 27 мм²) игнорируются — растровый шум.
  // Edge-детектор: ≥1 клетка блоба граничит с клеткой вне зоны.
  function findUncoveredBlobs(placements, spec, zoneMask, cellCount, opts) {
    const minBlobCells = (opts && opts.minBlobCells != null) ? opts.minBlobCells : 3;
    const { nx, ny, r, ox, oy } = spec;
    const covered = new Uint8Array(cellCount);
    for (const pl of placements) {
      if (pl.mask) for (let i = 0; i < cellCount; i++) if (pl.mask[i] & 1) covered[i] = 1;
    }
    const visited = new Uint8Array(cellCount);
    const queue = new Int32Array(cellCount);
    const blobs = [];
    for (let start = 0; start < cellCount; start++) {
      if (!zoneMask[start] || covered[start] || visited[start]) continue;
      let head = 0, tail = 0;
      queue[tail++] = start;
      visited[start] = 1;
      let sx = 0, sy = 0, n = 0, isEdge = false;
      while (head < tail) {
        const idx = queue[head++];
        const col = idx % nx;
        const row = (idx / nx) | 0;
        sx += ox + (col + 0.5) * r;
        sy += oy + (row + 0.5) * r;
        n++;
        const neighbors = [
          col > 0 ? idx - 1 : -1,
          col < nx - 1 ? idx + 1 : -1,
          row > 0 ? idx - nx : -1,
          row < ny - 1 ? idx + nx : -1
        ];
        for (const ni of neighbors) {
          if (ni < 0 || ni >= cellCount) continue;
          if (!zoneMask[ni]) { isEdge = true; continue; }
          if (covered[ni] || visited[ni]) continue;
          visited[ni] = 1;
          queue[tail++] = ni;
        }
      }
      if (n >= minBlobCells) {
        blobs.push({
          x: sx / n, y: sy / n, size: n, edge: isEdge,
          areaMm2: n * r * r
        });
      }
    }
    blobs.sort((a, b) => {
      if (a.edge !== b.edge) return a.edge ? -1 : 1;
      return b.size - a.size;
    });
    return blobs;
  }

  function sampleAtBlob(piece, blob, ifpCache, zoneBbox, rng) {
    const bb = polygonBBox(piece.centeredCorePts);
    const pieceR = Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY) * 0.5;
    const ifp = ifpCache.get(piece.id);

    // ── Edge-ветка (v5.0 Fix тип 2): ядро за границей (overhang), blob накрыт ──
    if (blob.edge) {
      const zoneCx = (zoneBbox.minX + zoneBbox.maxX) * 0.5;
      const zoneCy = (zoneBbox.minY + zoneBbox.maxY) * 0.5;
      const dx = blob.x - zoneCx;
      const dy = blob.y - zoneCy;
      const dlen = Math.hypot(dx, dy);
      if (dlen > 1e-6) {
        const ux = dx / dlen, uy = dy / dlen;
        for (const scale of [0.5, 0.3, 0.7, 0.1, 0.9]) {
          const candidateX = blob.x + ux * pieceR * scale;
          const candidateY = blob.y + uy * pieceR * scale;
          if (candidateX < zoneBbox.minX - pieceR || candidateX > zoneBbox.maxX + pieceR) continue;
          if (candidateY < zoneBbox.minY - pieceR || candidateY > zoneBbox.maxY + pieceR) continue;
          if (ifp && ifp.length >= 3 && !pointInPolygon(candidateX, candidateY, ifp)) continue;
          return { x: candidateX, y: candidateY };
        }
      }
    }

    for (let attempt = 0; attempt < 48; attempt++) {
      const angle = rng.next() * Math.PI * 2;
      const dist = rng.next() * pieceR;
      const x = blob.x + Math.cos(angle) * dist;
      const y = blob.y + Math.sin(angle) * dist;
      if (x < zoneBbox.minX || x > zoneBbox.maxX || y < zoneBbox.minY || y > zoneBbox.maxY) continue;
      if (ifp && ifp.length >= 3 && !pointInPolygon(x, y, ifp)) continue;
      return { x, y };
    }
    if (!ifp || ifp.length < 3 || pointInPolygon(blob.x, blob.y, ifp)) return { x: blob.x, y: blob.y };
    return null;
  }

  async function greedyWarmStart(pieces, napTarget, napTol, spec, zoneMask, zoneCells, zonePts, zoneBbox, ifpCache, rng, onProgress) {
    // v5.0 §4 Этап 3: warm start по соответствию формы (AR + IoU) — ОТКАЗ.
    // Попытка реализовать warm start (Lloyd-ячейки + подбор кусков по AR) дала regression:
    // coverage упала с 98.68% (cold start) до 95.58% (warm start). Причина:
    //   - warm start размещает ВСЕ N кусков в центры ячеек, но эти позиции не оптимизированы
    //   - SA не успевает их подвинуть за 20000 итераций
    //   - greedyWarmStart не проверяет, накрывает ли ядро ячейку (только AR-соответствие)
    // Возвращаемся к cold start. Подбор по форме требует более тщательной реализации:
    //   - проверка IoU(ядро, ячейка) при размещении
    //   - SA-ход REMOVE для очистки лишних кусков
    //   - возможно, совсем другой подход (не warm start, а fitness-приоритет в ADD-ходе)
    // TODO v5.1: реализовать fitness-based ADD в SA (ход ADD выбирает кусок с лучшим AR-fit к дыре).
    return [];
  }

  function findPiece(pieces, id) {
    return pieces.find((p) => p.id === id);
  }

  // ── makePolyResidualFn (v5.0 Fix тип 2 + Fix тип 3) ──────────────────────────
  // Считает полигональный residual = zone − Union(corePts каждого placement).
  // Возвращает { area, holes } где holes — список компонент residual.
  function makePolyResidualFn(zonePointsArg, holder, specRef) {
    if (!pointsToMultiPolygon || !unionMulti || !diffMulti || !multiPolygonArea || !zonePointsArg) {
      return () => ({ area: 0, holes: [] });
    }
    const zoneMp = pointsToMultiPolygon(zonePointsArg);
    let mnX=Infinity,mxX=-Infinity,mnY=Infinity,mxY=-Infinity;
    for (const p of zonePointsArg) {
      if (p.x < mnX) mnX = p.x; if (p.x > mxX) mxX = p.x;
      if (p.y < mnY) mnY = p.y; if (p.y > mxY) mxY = p.y;
    }
    const zoneBboxForEdge = { mnX, mxX, mnY, mxY };

    return function computePolyResidual(placements) {
      if (!placements || placements.length === 0) {
        const zoneArea = multiPolygonArea(zoneMp);
        let cx = 0, cy = 0, n = 0;
        for (const p of zonePointsArg) { cx += p.x; cy += p.y; n++; }
        cx /= n; cy /= n;
        holder.blobs = [{ x: cx, y: cy, areaMm2: zoneArea, edge: true }];
        return { area: zoneArea, holes: holder.blobs };
      }
      const coreMps = [];
      for (const pl of placements) {
        if (!pl.corePts || pl.corePts.length < 3) continue;
        try { coreMps.push(pointsToMultiPolygon(pl.corePts)); } catch (_) {}
      }
      if (coreMps.length === 0) {
        const zoneArea = multiPolygonArea(zoneMp);
        let cx = 0, cy = 0, n = 0;
        for (const p of zonePointsArg) { cx += p.x; cy += p.y; n++; }
        cx /= n; cy /= n;
        holder.blobs = [{ x: cx, y: cy, areaMm2: zoneArea, edge: true }];
        return { area: zoneArea, holes: holder.blobs };
      }
      let unionMp;
      try {
        if (coreMps.length === 1) {
          unionMp = coreMps[0];
        } else {
          unionMp = coreMps[0];
          for (let i = 1; i < coreMps.length; i++) {
            unionMp = unionMulti(unionMp, coreMps[i]);
          }
        }
      } catch (_) {
        const zoneArea = multiPolygonArea(zoneMp);
        let cx = 0, cy = 0, n = 0;
        for (const p of zonePointsArg) { cx += p.x; cy += p.y; n++; }
        cx /= n; cy /= n;
        holder.blobs = [{ x: cx, y: cy, areaMm2: zoneArea, edge: true }];
        return { area: zoneArea, holes: holder.blobs };
      }
      let residualMp;
      try { residualMp = diffMulti(zoneMp, unionMp); } catch (_) {
        holder.blobs = null;
        return { area: 0, holes: [] };
      }
      const residual = multiPolygonArea(residualMp);
      const holes = [];
      try {
        for (const poly of (residualMp || [])) {
          if (!Array.isArray(poly) || poly.length === 0) continue;
          const ring = poly[0];
          if (!Array.isArray(ring) || ring.length < 4) continue;
          let a = 0;
          for (let i = 0; i < ring.length - 1; i++) {
            a += ring[i][0] * ring[i+1][1] - ring[i+1][0] * ring[i][1];
          }
          a = Math.abs(a) * 0.5;
          if (a < 30) continue;
          let cx = 0, cy = 0, n = ring.length - 1;
          for (let i = 0; i < n; i++) { cx += ring[i][0]; cy += ring[i][1]; }
          cx /= n; cy /= n;
          const isEdge = (cx <= zoneBboxForEdge.mnX + 5 || cx >= zoneBboxForEdge.mxX - 5 ||
                          cy <= zoneBboxForEdge.mnY + 5 || cy >= zoneBboxForEdge.mxY - 5);
          holes.push({ x: cx, y: cy, areaMm2: a, edge: isEdge });
        }
      } catch (_) {}
      holes.sort((a, b) => {
        if (a.edge !== b.edge) return a.edge ? -1 : 1;
        return b.areaMm2 - a.areaMm2;
      });
      holder.blobs = holes;
      return { area: residual, holes };
    };
  }

  async function runSaSearch(args) {
    const selectedPieces = args.selectedPieces;
    const napTarget = args.napTarget;
    const napTol = args.napTol;
    const spec = args.spec;
    const zoneMask = args.zoneMask;
    const zoneCells = args.zoneCells;
    const zonePoints = args.zonePoints;
    const zoneBbox = args.zoneBbox;
    const ifpCache = args.ifpCache;
    const rng = args.rng;
    const onProgress = args.onProgress;
    const cellCount = args.cellCount;
    const maxSolveMs = args.maxSolveMs;
    const maxIterations = args.maxIterations;
    const phaseADeadline = args.phaseADeadline;
    const phaseBDeadline = args.phaseBDeadline;
    const startTime = args.startTime;

    let placements = args.warmStartPlacements
      ? args.warmStartPlacements.slice()
      : await greedyWarmStart(
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
          onProgress
        );

    const minWidthMm = args.minWidthMm || 0;

    // Cheap sliver proxy: core bbox shorter dimension < minWidthMm.
    // corePts are already transformed to zone coords, so bbox is directly comparable.
    function coreShortDim(pl) {
      const pts = pl.corePts;
      if (!pts || pts.length < 3) return Infinity;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      return Math.min(maxX - minX, maxY - minY);
    }
    function countSlivers(pls) {
      if (!minWidthMm) return 0;
      let n = 0;
      for (const pl of pls) if (coreShortDim(pl) < minWidthMm) n++;
      return n;
    }

    let { coveredCells, overlapCells } = computeCoverage(placements, cellCount);
    let sliverCount = countSlivers(placements);
    let E = energy(coveredCells, overlapCells, placements.length, zoneCells, sliverCount);

    let bestPlacements = placements.map((p) => ({ ...p, mask: p.mask.slice() }));
    let bestE = E;
    let bestCoveredCells = coveredCells;

    // v5.0 Fix тип 3B: best сохраняется по полигональному residual, не по coveredCells.
    // bestPolyResidual инициализируется ПОСЛЕ объявления computePolyResidual (ниже).

    const T0 = Math.max(E * 0.05, zoneCells * 0.5);
    const Tmin = T0 * 0.0005;
    // v5.0 Fix тип 2: TminFloor — после Tmin SA не завершается, переходит в greedy.
    const TminFloor = Tmin;
    const coolingN = maxIterations || 5000;
    const alpha = Math.pow(0.0005, 1 / Math.max(1, coolingN));
    const stepMm = Math.min(zoneBbox.maxX - zoneBbox.minX, zoneBbox.maxY - zoneBbox.minY) * 0.08;

    let T = T0;
    let iters = 0;
    let accepted = 0;
    let lastProgressMs = 0;
    const progressIntervalMs = 300;

    // v5.0 Fix тип 2: кеш блобов (растровых и полигональных).
    let cachedBlobs = null;
    let lastBlobsCacheIter = -999;
    let lastPolyCheckIter = -999;
    const polyResidualHolder = { blobs: null };
    const computePolyResidual = makePolyResidualFn(zonePoints, polyResidualHolder, spec);
    let currentPolyHoles = [];
    let currentPolyResidualArea = Infinity;
    // v5.0 Fix тип 3B: bestPolyResidual инициализируется здесь.
    let bestPolyResidual = computePolyResidual(placements).area;

    // v5.0 Fix тип 3: порог вклада ADD.
    const ADD_GAIN_THRESHOLD_MM2 = 50;

    // v5.0 Fix тип 2: anti-infinite-loop.
    let consecutiveAddFails = 0;
    const ADD_FAIL_LIMIT = 200;

    const warmDoneMs = Date.now();
    const warmDurationMs = warmDoneMs - startTime;
    let _saExitReason = "running";

    // ── Главный цикл ──────────────────────────────────────────────────────────
    // Не завершается по Tmin. Cooling на TminFloor (greedy), но цикл продолжается
    // пока есть закрываемые дыры (правка 2 советника).
    while (true) {
      if (maxIterations && iters >= maxIterations) {
        _saExitReason = "maxIterations"; break;
      }
      if (Date.now() >= phaseBDeadline) {
        _saExitReason = "phaseBudget_timeout"; break;
      }
      iters++;

      const nowMs = Date.now();
      if (onProgress && (nowMs - lastProgressMs) >= progressIntervalMs) {
        lastProgressMs = nowMs;
        const elapsed = nowMs - startTime;
        const timeRatio = Math.min(1, elapsed / maxSolveMs);
        const tempRatio = T0 > Tmin ? Math.max(0, 1 - (T - Tmin) / (T0 - Tmin)) : 1;
        const percent = Math.round(40 + Math.max(timeRatio, tempRatio) * 55);
        const covRatio = zoneCells > 0 ? bestCoveredCells / zoneCells : 0;
        try {
          const covPct = Math.round(covRatio * 1000) / 10;
          onProgress({
            type: "phase",
            phase: "sa_loop",
            percent,
            title: `NFP+SA: ${bestPlacements.length} pieces`,
            pieces: bestPlacements.length,
            coverage: covPct,
            iters,
            temperature: Math.round(T * 100) / 100
          });
          await new Promise((r) => setImmediate(r)); // yield so SSE events flush to client
        } catch (_) {}
      }

      // Обновление кешей
      if (iters - lastBlobsCacheIter >= 50) {
        cachedBlobs = findUncoveredBlobs(placements, spec, zoneMask, cellCount, { minBlobCells: 3 });
        lastBlobsCacheIter = iters;
      }
      if (iters - lastPolyCheckIter >= 50) {
        const pr = computePolyResidual(placements);
        currentPolyResidualArea = pr.area;
        currentPolyHoles = pr.holes;
        lastPolyCheckIter = iters;
      }

      const usedSet = new Set(placements.map((p) => p.id));
      const unusedPieces = selectedPieces.filter((p) => !usedSet.has(p.id));

      // ── Условие выхода: полное покрытие или недостаток инвентаря ──────────
      if (cachedBlobs.length === 0) {
        if (currentPolyHoles.length === 0) {
          _saExitReason = "full_coverage_polygon";
          break;
        }
        if (polyResidualHolder.blobs && polyResidualHolder.blobs.length > 0) {
          cachedBlobs = polyResidualHolder.blobs;
          lastBlobsCacheIter = iters;
        }
      }
      if (unusedPieces.length === 0 && cachedBlobs.length > 0) {
        _saExitReason = "insufficient_inventory_violation";
        break;
      }

      // ── Обычный SA-step ────────────────────────────────────────────────────
      const move = pickMove(rng, unusedPieces.length > 0, placements.length > 1);

      let newPlacements = null;
      let addAttempted = false;
      let addPrAfter = null;

      if (move === MOVES.TRANSLATE && placements.length > 0) {
        const ki = rng.nextInt(placements.length);
        const old = placements[ki];
        const dx = (rng.next() * 2 - 1) * stepMm;
        const dy = (rng.next() * 2 - 1) * stepMm;
        const piece = findPiece(selectedPieces, old.id);
        const np = makePlacement(piece, old.cx + dx, old.cy + dy, old.angleDeg, spec, zoneMask);
        newPlacements = placements.map((p, i) => (i === ki ? np : p));
      } else if (move === MOVES.ROTATE && placements.length > 0) {
        const ki = rng.nextInt(placements.length);
        const old = placements[ki];
        const piece = findPiece(selectedPieces, old.id);
        const dAngle = (rng.next() * 2 - 1) * Math.min(napTol, 10);
        const newAngle = normalizeDeg(old.angleDeg + dAngle);
        const dev = Math.abs(deltaDeg(normalizeDeg(napTarget - piece.napDeg), newAngle));
        if (dev <= napTol) {
          const np = makePlacement(piece, old.cx, old.cy, newAngle, spec, zoneMask);
          newPlacements = placements.map((p, i) => (i === ki ? np : p));
        }
      } else if (move === MOVES.SWAP && placements.length > 0 && unusedPieces.length > 0) {
        const ki = rng.nextInt(placements.length);
        const old = placements[ki];
        const newPiece = unusedPieces[rng.nextInt(unusedPieces.length)];
        const angle = normalizeDeg(napTarget - newPiece.napDeg);
        const np = makePlacement(newPiece, old.cx, old.cy, angle, spec, zoneMask);
        newPlacements = placements.map((p, i) => (i === ki ? np : p));
      } else if (move === MOVES.REMOVE && placements.length > 1) {
        const ki = rng.nextInt(placements.length);
        newPlacements = placements.filter((_, i) => i !== ki);
      } else if (move === MOVES.ADD && unusedPieces.length > 0) {
        addAttempted = true;
        // v5.0 Fix тип 2: ADD целит во ВСЕ блобы, edge-приоритет.
        let blob = null;
        if (cachedBlobs.length > 0) {
          if (rng.next() < 0.8) {
            blob = cachedBlobs[0];
          } else {
            const topN = Math.min(5, cachedBlobs.length);
            blob = cachedBlobs[rng.nextInt(topN)];
          }
        }

        // Fitness-based выбор куска
        let newPiece;
        if (blob && unusedPieces.length > 1) {
          const blobAreaMm2 = blob.areaMm2;
          const sortedUnused = unusedPieces.slice().sort((a, b) => {
            const aCovers = a.areaMm2 >= blobAreaMm2;
            const bCovers = b.areaMm2 >= blobAreaMm2;
            if (aCovers && !bCovers) return -1;
            if (!aCovers && bCovers) return 1;
            if (aCovers && bCovers) {
              return Math.abs(a.areaMm2 - blobAreaMm2 * 1.5) - Math.abs(b.areaMm2 - blobAreaMm2 * 1.5);
            }
            return b.areaMm2 - a.areaMm2;
          });
          const topN = Math.min(5, sortedUnused.length);
          newPiece = sortedUnused[rng.nextInt(topN)];
        } else {
          newPiece = unusedPieces[rng.nextInt(unusedPieces.length)];
        }

        const angle = normalizeDeg(napTarget - newPiece.napDeg);
        let pos = null;
        if (blob && rng.next() < 0.85) {
          pos = sampleAtBlob(newPiece, blob, ifpCache, zoneBbox, rng);
        }
        if (!pos) pos = sampleAnchor(newPiece, ifpCache, zonePoints, zoneBbox, rng);

        if (pos) {
          // GUARD 1: minW через rotating calipers.
          if (minWidthMm > 0) {
            const coreShort = coreMinWAfterPlacement(newPiece, angle, pos.x, pos.y);
            if (coreShort < minWidthMm - 0.5) {
              consecutiveAddFails++;
              if (consecutiveAddFails > ADD_FAIL_LIMIT) {
                _saExitReason = "add_loop_no_progress"; break;
              }
              T = Math.max(T * alpha, TminFloor);
              continue;
            }
          }

          const np = makePlacement(newPiece, pos.x, pos.y, angle, spec, zoneMask);

          // GUARD 2 (v5.0 Fix тип 3): полигональный residual-критерий.
          let polyBefore = currentPolyResidualArea;
          if (!Number.isFinite(polyBefore) || polyBefore === Infinity) {
            const pr0 = computePolyResidual(placements);
            polyBefore = pr0.area;
            currentPolyHoles = pr0.holes;
            currentPolyResidualArea = pr0.area;
            lastPolyCheckIter = iters;
          }
          addPrAfter = computePolyResidual([...placements, np]);
          const polyAfter = addPrAfter.area;
          const polyGain = polyBefore - polyAfter;

          if (polyGain >= ADD_GAIN_THRESHOLD_MM2) {
            newPlacements = [...placements, np];
          } else {
            consecutiveAddFails++;
            if (consecutiveAddFails > ADD_FAIL_LIMIT) {
              _saExitReason = "add_loop_no_progress"; break;
            }
            T = Math.max(T * alpha, TminFloor);
            continue;
          }
        } else {
          consecutiveAddFails++;
          if (consecutiveAddFails > ADD_FAIL_LIMIT) {
            _saExitReason = "add_loop_no_progress"; break;
          }
          T = Math.max(T * alpha, TminFloor);
          continue;
        }
      }

      if (!newPlacements) {
        T = Math.max(T * alpha, TminFloor);
        continue;
      }

      const newCov = computeCoverage(newPlacements, cellCount);
      const newSliverCount = countSlivers(newPlacements);
      const newE = energy(newCov.coveredCells, newCov.overlapCells, newPlacements.length, zoneCells, newSliverCount);
      const dE = newE - E;

      // Accept logic. При T = TminFloor — greedy.
      const effectiveT = Math.max(T, TminFloor);
      if (dE < 0 || rng.next() < Math.exp(-dE / Math.max(effectiveT, 1e-9))) {
        placements = newPlacements;
        coveredCells = newCov.coveredCells;
        overlapCells = newCov.overlapCells;
        sliverCount = newSliverCount;
        E = newE;
        accepted++;
        if (addAttempted) consecutiveAddFails = 0;

        // Обновляем polyResidual после принятия хода.
        let acceptedPolyResidual;
        if (addAttempted && addPrAfter !== null) {
          acceptedPolyResidual = addPrAfter.area;
          currentPolyResidualArea = addPrAfter.area;
          currentPolyHoles = addPrAfter.holes;
        } else {
          const pr = computePolyResidual(placements);
          acceptedPolyResidual = pr.area;
          currentPolyResidualArea = pr.area;
          currentPolyHoles = pr.holes;
        }
        lastPolyCheckIter = iters;

        // v5.0 Fix тип 3B: best сохраняется по полигональному residual.
        if (acceptedPolyResidual < bestPolyResidual - 0.5 ||
            (Math.abs(acceptedPolyResidual - bestPolyResidual) <= 0.5 && E < bestE)) {
          bestPlacements = placements.map((p) => ({ ...p, mask: p.mask.slice() }));
          bestE = E;
          bestCoveredCells = coveredCells;
          bestPolyResidual = acceptedPolyResidual;
        }
      }

      T = Math.max(T * alpha, TminFloor);
    }

    if (_saExitReason === "running") {
      _saExitReason = "unknown_exit";
    }

    return {
      bestPlacements,
      bestCoveredCells,
      bestCoveragePct: zoneCells > 0 ? Math.round(bestCoveredCells / zoneCells * 1000) / 10 : 0,
      iters,
      accepted,
      T,
      Tmin,
      alpha,
      phaseATimeMs: Date.now() - startTime,
      saExitReason: _saExitReason,
      warmDurationMs
    };
  }

  return {
    sampleAnchor,
    findLargestUncoveredBlobCentroid,
    findUncoveredBlobs,
    sampleAtBlob,
    greedyWarmStart,
    findPiece,
    runSaSearch
  };
}

module.exports = { createVoronoiSaSearch };
