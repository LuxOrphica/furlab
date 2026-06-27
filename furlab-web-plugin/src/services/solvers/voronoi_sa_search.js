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

  function sampleAtBlob(piece, blob, ifpCache, zoneBbox, rng) {
    const bb = polygonBBox(piece.centeredCorePts);
    const pieceR = Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY) * 0.5;
    const ifp = ifpCache.get(piece.id);
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

    const T0 = Math.max(E * 0.05, zoneCells * 0.5);
    const Tmin = T0 * 0.0005;
    // Compute alpha so cooling reaches Tmin after exactly maxIterations steps.
    // Tmin/T0 = 0.0005, so alpha = 0.0005^(1/N).
    // Without maxIterations, fall back to time-based cooling at N=5000 equivalent.
    const coolingN = maxIterations || 5000;
    const alpha = Math.pow(0.0005, 1 / Math.max(1, coolingN));
    const stepMm = Math.min(zoneBbox.maxX - zoneBbox.minX, zoneBbox.maxY - zoneBbox.minY) * 0.08;

    let T = T0;
    let iters = 0;
    let accepted = 0;
    let lastProgressMs = 0;
    const progressIntervalMs = 300;
    let cachedUncoveredTarget = null;
    let lastUncoveredCacheIter = -999;

    const warmDoneMs = Date.now();
    const warmDurationMs = warmDoneMs - startTime;
    let _saExitReason = "running";

    while (T > Tmin && (maxIterations ? iters < maxIterations : Date.now() < phaseBDeadline)) {
      if (!maxIterations && Date.now() >= phaseADeadline) { _saExitReason = "phaseA_deadline"; break; }
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

      if (iters - lastUncoveredCacheIter >= 200) {
        cachedUncoveredTarget = findLargestUncoveredBlobCentroid(placements, spec, zoneMask, cellCount);
        lastUncoveredCacheIter = iters;
      }

      const usedSet = new Set(placements.map((p) => p.id));
      const unusedPieces = selectedPieces.filter((p) => !usedSet.has(p.id));
      const move = pickMove(rng, unusedPieces.length > 0, placements.length > 1);

      let newPlacements = null;

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
        // v5.0 Fix тип 1: Fitness-based ADD
        let newPiece;
        if (cachedUncoveredTarget && unusedPieces.length > 1) {
          const blobAreaMm2 = cachedUncoveredTarget.size * spec.r * spec.r;
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
        if (cachedUncoveredTarget && rng.next() < 0.8) {
          pos = sampleAtBlob(newPiece, cachedUncoveredTarget, ifpCache, zoneBbox, rng);
        }
        if (!pos) pos = sampleAnchor(newPiece, ifpCache, zonePoints, zoneBbox, rng);
        if (pos) {
          const np = makePlacement(newPiece, pos.x, pos.y, angle, spec, zoneMask);
          newPlacements = [...placements, np];
        }
      }

      if (!newPlacements) {
        T *= alpha;
        continue;
      }

      const newCov = computeCoverage(newPlacements, cellCount);
      const newSliverCount = countSlivers(newPlacements);
      const newE = energy(newCov.coveredCells, newCov.overlapCells, newPlacements.length, zoneCells, newSliverCount);
      const dE = newE - E;

      if (dE < 0 || rng.next() < Math.exp(-dE / T)) {
        placements = newPlacements;
        coveredCells = newCov.coveredCells;
        overlapCells = newCov.overlapCells;
        sliverCount = newSliverCount;
        E = newE;
        accepted++;
        if (coveredCells > bestCoveredCells || (coveredCells === bestCoveredCells && E < bestE)) {
          bestPlacements = placements.map((p) => ({ ...p, mask: p.mask.slice() }));
          bestE = E;
          bestCoveredCells = coveredCells;
        }
      }

      T *= alpha;
    }

    if (_saExitReason === "running") {
      if (maxIterations && iters >= maxIterations) _saExitReason = "maxIterations";
      else if (T <= Tmin) _saExitReason = "Tmin";
      else _saExitReason = "phaseBudget_timeout";
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
    sampleAtBlob,
    greedyWarmStart,
    findPiece,
    runSaSearch
  };
}

module.exports = { createVoronoiSaSearch };
