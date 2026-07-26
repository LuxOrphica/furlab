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
        const vX = (v) => Array.isArray(v) ? v[0] : (v && v.X != null ? v.X : 0);
        const vY = (v) => Array.isArray(v) ? v[1] : (v && v.Y != null ? v.Y : 0);

        for (const poly of (residualMp || [])) {
          if (!Array.isArray(poly) || poly.length === 0) continue;
          const ring = poly[0];
          if (!Array.isArray(ring) || ring.length < 4) continue;
          const n = ring.length;
          let a = 0;
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            a += vX(ring[i]) * vY(ring[j]) - vX(ring[j]) * vY(ring[i]);
          }
          a = Math.abs(a) * 0.5;
          if (a < 30) continue;
          let cx = 0, cy = 0;
          for (let i = 0; i < n; i++) { cx += vX(ring[i]); cy += vY(ring[i]); }
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

  // ── makeAssignResidualFn (v5.3) ──────────────────────────────────────────────
  // Assign+связность-осознанный residual. В отличие от union-подхода (zone − Union(всех
  // ядер)), ловит дыры, невидимые тому: клетку накрывает ядро НЕ её territory-владельца
  // (misassignment) ЛИБО клетка попадает в разорванный остров куска, который полигон-сборка
  // выбросит по связности. Это ровно те стыковые гэпы, что видит финальный computeResidualCoverage.
  // Растровый (spec.r), дёшев: O(sum activeCells) на assign + O(cellCount) на flood-fill.
  function makeAssignResidualFn(zonePointsArg, holder, specRef) {
    const { nx, ny, r, ox, oy } = specRef;
    let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
    for (const p of zonePointsArg) {
      if (p.x < mnX) mnX = p.x; if (p.x > mxX) mxX = p.x;
      if (p.y < mnY) mnY = p.y; if (p.y > mxY) mxY = p.y;
    }
    const cellA = r * r;
    return function computeAssignResidual(placements, zoneMask, cellCount) {
      const assign = new Int32Array(cellCount).fill(-1);
      const bestScore = new Float64Array(cellCount).fill(Infinity);
      // 1) каждую накрытую ядром клетку → ближайшему по (dx²+dy²) накрывающему куску
      for (let j = 0; j < placements.length; j++) {
        const cells = placements[j].activeCells;
        if (!cells) continue;
        const pcx = placements[j].cx, pcy = placements[j].cy;
        for (let k = 0; k < cells.length; k++) {
          const i = cells[k];
          const cx = ox + (i % nx + 0.5) * r;
          const cy = oy + ((i / nx | 0) + 0.5) * r;
          const dx = cx - pcx, dy = cy - pcy;
          const s = dx * dx + dy * dy;
          if (s < bestScore[i]) { bestScore[i] = s; assign[i] = j; }
        }
      }
      // 2) flood-fill от seed-клетки каждого куска по одинаково-назначенным клеткам → kept
      const kept = new Uint8Array(cellCount);
      const stack = [];
      for (let j = 0; j < placements.length; j++) {
        const pl = placements[j];
        let col = Math.max(0, Math.min(nx - 1, Math.floor((pl.cx - ox) / r)));
        let row = Math.max(0, Math.min(ny - 1, Math.floor((pl.cy - oy) / r)));
        let start = row * nx + col;
        if (assign[start] !== j) {
          // seed-клетка не за j — берём ближайшую j-клетку (главный компонент у seed)
          const cells = pl.activeCells;
          let best = -1, bestD = Infinity;
          if (cells) for (let k = 0; k < cells.length; k++) {
            const i = cells[k];
            if (assign[i] !== j) continue;
            const cx = ox + (i % nx + 0.5) * r, cy = oy + ((i / nx | 0) + 0.5) * r;
            const d = (cx - pl.cx) * (cx - pl.cx) + (cy - pl.cy) * (cy - pl.cy);
            if (d < bestD) { bestD = d; best = i; }
          }
          start = best;
        }
        if (start < 0 || kept[start] || assign[start] !== j) continue;
        stack.length = 0; stack.push(start); kept[start] = 1;
        while (stack.length) {
          const i = stack.pop();
          const c = i % nx, rw = (i / nx) | 0;
          if (c > 0)     { const ni = i - 1;  if (!kept[ni] && assign[ni] === j) { kept[ni] = 1; stack.push(ni); } }
          if (c < nx - 1){ const ni = i + 1;  if (!kept[ni] && assign[ni] === j) { kept[ni] = 1; stack.push(ni); } }
          if (rw > 0)    { const ni = i - nx; if (!kept[ni] && assign[ni] === j) { kept[ni] = 1; stack.push(ni); } }
          if (rw < ny-1) { const ni = i + nx; if (!kept[ni] && assign[ni] === j) { kept[ni] = 1; stack.push(ni); } }
        }
      }
      // 3) residual = зонные клетки, не удержанные владельцем (assign=-1 или разорванный остров)
      const resid = new Uint8Array(cellCount);
      let residCells = 0;
      for (let i = 0; i < cellCount; i++) {
        if (zoneMask[i] && !kept[i]) { resid[i] = 1; residCells++; }
      }
      // 4) компоненты residual → blobs (тот же формат, что union-подход)
      const holes = [];
      const seen = new Uint8Array(cellCount);
      for (let i0 = 0; i0 < cellCount; i0++) {
        if (!resid[i0] || seen[i0]) continue;
        let sx = 0, sy = 0, cnt = 0, edge = false;
        stack.length = 0; stack.push(i0); seen[i0] = 1;
        while (stack.length) {
          const q = stack.pop();
          const c = q % nx, rw = (q / nx) | 0;
          const cx = ox + (c + 0.5) * r, cy = oy + (rw + 0.5) * r;
          sx += cx; sy += cy; cnt++;
          if (cx <= mnX + 5 || cx >= mxX - 5 || cy <= mnY + 5 || cy >= mxY - 5) edge = true;
          if (c > 0)     { const n = q - 1;  if (resid[n] && !seen[n]) { seen[n] = 1; stack.push(n); } }
          if (c < nx - 1){ const n = q + 1;  if (resid[n] && !seen[n]) { seen[n] = 1; stack.push(n); } }
          if (rw > 0)    { const n = q - nx; if (resid[n] && !seen[n]) { seen[n] = 1; stack.push(n); } }
          if (rw < ny-1) { const n = q + nx; if (resid[n] && !seen[n]) { seen[n] = 1; stack.push(n); } }
        }
        const areaMm2 = cnt * cellA;
        if (areaMm2 < 30) continue;
        holes.push({ x: sx / cnt, y: sy / cnt, areaMm2, edge });
      }
      holes.sort((a, b) => { if (a.edge !== b.edge) return a.edge ? -1 : 1; return b.areaMm2 - a.areaMm2; });
      holder.blobs = holes;
      return { area: residCells * cellA, holes };
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
    let rng = args.rng;
    // Диагностика детерминизма (env-gated): счётчик потреблённых случайных чисел.
    let _rngDraws = 0;
    if (process.env.VSA_TRACE_FILE) {
      const _rawRng = rng;
      rng = {
        next: () => { _rngDraws++; return _rawRng.next(); },
        nextInt: (n) => { _rngDraws++; return _rawRng.nextInt(n); }
      };
    }
    const onProgress = args.onProgress;
    const cellCount = args.cellCount;
    const maxSolveMs = args.maxSolveMs;
    const maxIterations = args.maxIterations;
    const phaseADeadline = args.phaseADeadline;
    const phaseBDeadline = args.phaseBDeadline;
    const startTime = args.startTime;
    // v5.3-эксперимент: вес штрафа за перекрытие ядер (undefined → дефолт 8 в energy()).
    const _overlapW = args.overlapWeight;
    // v5.3 «уплотнение стыков» (за флагом): когда крупных дыр не осталось (только мелкие
    // внутренние стыковые), штраф перекрытия ядер снижается до 1 — перекрытие ядер на шве
    // гарантирует материал с обеих сторон (фрагменты разрежет биссектриса), а экономию
    // инвентаря блюсти уже поздно и не нужно. Плюс прицельный TRANSLATE к дыре.
    const _junction = !!args.junctionConsolidation;
    // v5.6 «мёртвая зона»: экономический штраф применяется только к нахлёсту ГЛУБЖЕ
    // запаса шва (пересечение deep-областей = ядро ⊖ припуск). Вес — прежние 8.
    // v5.6 РЕШЕНИЕ (свип 2026-07-19): дефолт 0. Мёртвая зона проиграла по стыкам
    // (4327 vs 780 мм²) — ЛЮБОЙ штраф за глубину нахлёста держит ядра у касания и рвёт
    // стыки. Победитель — нахлёст полностью бесплатен + кромка-обязательство. Флаг оставлен.
    const _deepW = (args.deepOverlapWeight == null) ? 0 : Number(args.deepOverlapWeight);
    const _JUNCTION_MAX_BLOB_MM2 = 2000;
    let _wEff = _overlapW;

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
    const minLengthMm = args.minLengthMm || 0;

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

    // ── v5.2 (R5 в дизайне SA): растровые территории ─────────────────────────
    // territory клетки = nearest-center среди кусков, чья маска её накрывает —
    // дешёвое зеркало полигонального power-Voronoi (voronoi_sa_polygonal.js).
    // «Паразит» = кусок, чья территория заведомо даст sub-min фрагмент:
    //   small: площадь территории < 0.9 × minW×minL (R5-провал по площади)
    //   thin:  bbox территории короче (minW − cell) — bbox ≥ MBR, значит MBR < minW точно
    // Такие куски SA должна убирать/двигать: их территория не считается покрытием.
    function computeTerritoryStats(pls) {
      const nx = spec.nx;
      const r = spec.r;
      const cellArea = r * r;
      const assign = new Int16Array(cellCount).fill(-1);
      const bestD = new Float64Array(cellCount).fill(Infinity);
      for (let j = 0; j < pls.length; j++) {
        const pl = pls[j];
        const cells = pl.activeCells;
        if (!cells) continue;
        for (let k = 0; k < cells.length; k++) {
          const i = cells[k];
          const cx = spec.ox + (i % nx + 0.5) * r;
          const cy = spec.oy + ((i / nx | 0) + 0.5) * r;
          const dx = cx - pl.cx;
          const dy = cy - pl.cy;
          const d = dx * dx + dy * dy;
          if (d < bestD[i]) { bestD[i] = d; assign[i] = j; }
        }
      }
      const per = pls.map(() => ({ cells: 0, minCol: Infinity, maxCol: -Infinity, minRow: Infinity, maxRow: -Infinity, pts: [] }));
      for (let i = 0; i < cellCount; i++) {
        const j = assign[i];
        if (j < 0) continue;
        const s = per[j];
        s.cells++;
        const col = i % nx, row = (i / nx) | 0;
        if (col < s.minCol) s.minCol = col;
        if (col > s.maxCol) s.maxCol = col;
        if (row < s.minRow) s.minRow = row;
        if (row > s.maxRow) s.maxRow = row;
        s.pts.push({ x: spec.ox + (col + 0.5) * r, y: spec.oy + (row + 0.5) * r });
      }
      const parasites = [];
      if (minWidthMm > 0) {
        for (let j = 0; j < pls.length; j++) {
          const s = per[j];
          const terrMm2 = s.cells * cellArea;
          const bboxShortMm = s.cells > 0
            ? Math.min(s.maxCol - s.minCol + 1, s.maxRow - s.minRow + 1) * r
            : 0;
          const bboxLongMm = s.cells > 0
            ? Math.max(s.maxCol - s.minCol + 1, s.maxRow - s.minRow + 1) * r
            : 0;
          // Критерии строго зеркалят R5: только габариты (MBR ≥ minW×minL), НЕ площадь.
          // Площадной критерий давал false positive: фрагмент 72×80 с fill 0.7
          // (4100мм² < 0.9×4900) валиден по R5, а cull его удалял → дыры.
          // Пустая территория (0 клеток) — тоже паразит: кусок ничего не даёт.
          // Ширина — по MBR (rotating calipers), НЕ по осевому bbox: диагональная
          // полоса 30мм под 45° имеет bbox 230×230 — осевой тест её не видит.
          const empty = s.cells === 0;
          let thin = false;
          if (s.cells > 0 && bboxShortMm < (minWidthMm - 0.5) - r) {
            thin = true; // осевой bbox уже мал — MBR только меньше
          } else if (s.cells > 0) {
            // Истинная ширина ≈ MBR по центрам клеток + размер клетки (полклетки с каждой стороны).
            // Порог тот же, что у полигонального thin-теста (minW − 0.5).
            const mbrTrueMm = minBoundingRectShorter(convexHull(s.pts)) + r;
            if (mbrTrueMm < minWidthMm - 0.5) thin = true;
          }
          const short = s.cells > 0 && minLengthMm > 0 && bboxLongMm < (minLengthMm - 0.5) - r;
          if (empty || thin || short) {
            parasites.push({
              idx: j,
              id: pls[j].id,
              territoryMm2: Math.round(terrMm2),
              bboxShortMm: Math.round(bboxShortMm * 10) / 10,
              reason: empty ? "territory_empty" : (thin ? "territory_thin" : "territory_short")
            });
          }
        }
      }
      return { per, parasites };
    }

    // Незасчитываемое покрытие: unique-клетки (count==1) кусков-паразитов.
    // При REMOVE паразита покрытие в energy не падает → SA его убирает свободно.
    function countUnusable(pls, coreCounts, parasiteIdSet) {
      if (!parasiteIdSet || parasiteIdSet.size === 0) return 0;
      let n = 0;
      for (const pl of pls) {
        if (!parasiteIdSet.has(pl.id)) continue;
        const cells = pl.activeCells;
        if (!cells) continue;
        for (let k = 0; k < cells.length; k++) {
          if (coreCounts[cells[k]] === 1) n++;
        }
      }
      return n;
    }

    // v5.6 ОБЯЗАТЕЛЬСТВО КРОМКИ: края зоны сшиваются → ядро обязано доходить до контура.
    // Непокрытая кромочная клетка — невыполненное обязательство: доп. штраф поверх
    // стандартной цены непокрытия. Без него свободный нахлёст уплотняет внутренность,
    // а кромка проседает (старый штраф перекрытия случайно выталкивал куски к краю).
    const PERIM_OBLIGATION_W = 2000;
    const perimIdx = (() => {
      const { nx: _pnx, ny: _pny } = spec;
      const out = [];
      for (let i = 0; i < cellCount; i++) {
        if (!zoneMask[i]) continue;
        const c = i % _pnx, rw = (i / _pnx) | 0;
        if (c === 0 || c === _pnx - 1 || rw === 0 || rw === _pny - 1
          || !zoneMask[i - 1] || !zoneMask[i + 1] || !zoneMask[i - _pnx] || !zoneMask[i + _pnx]) out.push(i);
      }
      return Int32Array.from(out);
    })();
    const perimUncovered = (coveredArr) => {
      let cnt = 0;
      for (let k = 0; k < perimIdx.length; k++) if (!coveredArr[perimIdx[k]]) cnt++;
      return cnt;
    };
    let { covered, coveredCells, overlapCells, deepOverlapCells, coreCounts } = computeCoverage(placements, cellCount);
    let sliverCount = countSlivers(placements);
    // v5.2: паразиты (sub-min территории) — их unique-клетки не считаются покрытием.
    let parasiteIds = new Set(computeTerritoryStats(placements).parasites.map((p) => p.id));
    let unusableCells = countUnusable(placements, coreCounts, parasiteIds);
    let E = energy(coveredCells - unusableCells, overlapCells, placements.length, zoneCells, sliverCount, _wEff) + PERIM_OBLIGATION_W * perimUncovered(covered) + _deepW * deepOverlapCells;

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
    // v5.3: за флагом — assign+связность-осознанная проверка (ловит стыковые гэпы,
    // невидимые union-подходу). Call-site `computePolyResidual(placements)` не меняется.
    const computePolyResidual = args.assignAwareResidual
      ? (() => {
          const fn = makeAssignResidualFn(zonePoints, polyResidualHolder, spec);
          return (pls) => fn(pls, zoneMask, cellCount);
        })()
      : makePolyResidualFn(zonePoints, polyResidualHolder, spec);
    let currentPolyHoles = [];
    let currentPolyResidualArea = Infinity;
    // v5.0 Fix тип 3B: bestPolyResidual инициализируется здесь.
    let bestPolyResidual = computePolyResidual(placements).area;

    // v5.0 Fix тип 3: порог вклада ADD.
    const ADD_GAIN_THRESHOLD_MM2 = 50;

    // v5.0 Fix тип 2: anti-infinite-loop.
    let consecutiveAddFails = 0;
    const ADD_FAIL_LIMIT = 200;

    // v5.1 Fix: maxIterations is the primary budget.
    // Result quality should not depend on machine speed. phaseBDeadline remains
    // relevant to phaseB/Lloyd, but no longer stops the SA loop.
    const hardDeadlineMs = phaseBDeadline + Math.max(600000, maxSolveMs * 10);
    // v5.5: интерактивный потолок. Итерационный приоритет давал прогоны 10-15 минут на
    // нагруженной машине — для пользователя неотличимо от зависания («выключил процесс»).
    // По потолку возвращаем ЛУЧШЕЕ найденное (bestPlacements) — дальше его добивают
    // регуляризация, ремонт и «Пересчитать». 3×maxSolveMs, но не меньше 3 минут.
    const wallBudgetMs = startTime + Math.max(3 * maxSolveMs, 180000);

    const warmDoneMs = Date.now();
    const warmDurationMs = warmDoneMs - startTime;
    let _saExitReason = "running";

    // ── v5.2: отбраковка паразитов ВНУТРИ цикла ──────────────────────────────
    // Cull после выхода вскрывал дыры, которые SA уже не могла закрыть
    // (зона 2: −2 куска → дыра 5726мм², coverage 98.4%). Здесь паразиты
    // удаляются на живом поиске: освободившееся место становится блобами,
    // ADD целится в них, best перезапускается от очищенного состояния
    // (паразитное покрытие не считается лучшим). Максимум 3 раунда за прогон.
    let cullRoundsLeft = 3;
    function cullParasitesInLoop() {
      if (cullRoundsLeft <= 0) return false;
      const ts = computeTerritoryStats(placements);
      if (ts.parasites.length === 0 || ts.parasites.length >= placements.length) return false;
      cullRoundsLeft--;
      const rmIdx = new Set(ts.parasites.map((p) => p.idx));
      console.log(`[VSA-SA] in-loop cull round: removing ${ts.parasites.length} parasites: ${ts.parasites.map((p) => `${p.id}(${p.territoryMm2}mm2,${p.reason})`).join(", ")}`);
      placements = placements.filter((_, i) => !rmIdx.has(i));
      const cov = computeCoverage(placements, cellCount);
      covered = cov.covered;
      coveredCells = cov.coveredCells;
      deepOverlapCells = cov.deepOverlapCells || 0;
      overlapCells = cov.overlapCells;
      coreCounts = cov.coreCounts;
      sliverCount = countSlivers(placements);
      parasiteIds = new Set();
      unusableCells = 0;
      E = energy(coveredCells, overlapCells, placements.length, zoneCells, sliverCount, _wEff) + PERIM_OBLIGATION_W * perimUncovered(covered) + _deepW * deepOverlapCells;
      bestPlacements = placements.map((p) => ({ ...p, mask: p.mask.slice() }));
      bestE = E;
      bestCoveredCells = coveredCells;
      const pr = computePolyResidual(placements);
      currentPolyResidualArea = pr.area;
      currentPolyHoles = pr.holes;
      lastPolyCheckIter = iters;
      bestPolyResidual = pr.area;
      cachedBlobs = findUncoveredBlobs(placements, spec, zoneMask, cellCount, { minBlobCells: 3 });
      lastBlobsCacheIter = iters;
      consecutiveAddFails = 0;
      return true;
    }

    // Диагностика детерминизма: слепок начального состояния (env-gated).
    if (process.env.VSA_TRACE_FILE) {
      try {
        require("fs").appendFileSync(process.env.VSA_TRACE_FILE,
          "INIT\tpieces=" + selectedPieces.length + "\tzoneCells=" + zoneCells
          + "\tifp=" + (ifpCache && ifpCache.size) + "\tE0=" + E + "\tcov0=" + coveredCells
          + "\tT0=" + T0 + "\talpha=" + alpha
          + "\tp3=" + selectedPieces.slice(0, 3).map((p) => String(p.id).slice(-8) + ":" + Math.round(p.areaMm2)).join(",") + "\n");
      } catch (_) {}
    }

    // ── Главный цикл ──────────────────────────────────────────────────────────
    // Не завершается по Tmin. Cooling на TminFloor (greedy), но цикл продолжается
    // пока есть закрываемые дыры (правка 2 советника).
    while (true) {
      if (maxIterations && iters >= maxIterations) {
        _saExitReason = "maxIterations"; break;
      }
      if (Date.now() >= hardDeadlineMs) {
        _saExitReason = "hard_deadline_safety_net"; break;
      }
      if (Date.now() >= wallBudgetMs) {
        _saExitReason = "wall_budget"; break;
      }
      iters++;

      // Диагностика детерминизма (env-gated, в проде выключено): трасса траектории в файл.
      if (process.env.VSA_TRACE_FILE && (iters <= 400 || iters % 250 === 0)) {
        try {
          require("fs").appendFileSync(process.env.VSA_TRACE_FILE,
            iters + "\t" + E + "\t" + coveredCells + "\t" + overlapCells + "\t" + placements.length + "\t" + accepted + "\tdraws=" + _rngDraws + "\n");
        } catch (_) {}
      }

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
            title: `Оптимизация: ${bestPlacements.length} кусков, покрытие ${covPct}%`,
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
        // v5.3 уплотнение: фаза «доводки стыков» — остались только мелкие внутренние
        // дыры (< _JUNCTION_MAX_BLOB_MM2). Снижаем штраф перекрытия; при смене веса
        // перебазируем E, иначе dE сравнивается с E в другой шкале.
        if (_junction) {
          const _interiorBlobs = cachedBlobs.filter((b) => !b.edge);
          const _maxBlobMm2 = cachedBlobs.length ? cachedBlobs[0].areaMm2 : 0;
          const _consolidating = _interiorBlobs.length > 0 && _maxBlobMm2 < _JUNCTION_MAX_BLOB_MM2;
          const _newW = _consolidating ? 1 : _overlapW;
          if (_newW !== _wEff) {
            _wEff = _newW;
            E = energy(coveredCells - unusableCells, overlapCells, placements.length, zoneCells, sliverCount, _wEff) + PERIM_OBLIGATION_W * perimUncovered(covered) + _deepW * deepOverlapCells;
          }
        }
      }
      if (iters - lastPolyCheckIter >= 50) {
        const pr = computePolyResidual(placements);
        currentPolyResidualArea = pr.area;
        currentPolyHoles = pr.holes;
        lastPolyCheckIter = iters;
        // v5.2: обновляем флаги паразитов и перебазируем E на свежих флагах
        // (флаги слабо меняются — 50 итераций достаточная частота).
        parasiteIds = new Set(computeTerritoryStats(placements).parasites.map((p) => p.id));
        unusableCells = countUnusable(placements, coreCounts, parasiteIds);
        E = energy(coveredCells - unusableCells, overlapCells, placements.length, zoneCells, sliverCount, _wEff) + PERIM_OBLIGATION_W * perimUncovered(covered) + _deepW * deepOverlapCells;
      }

      const usedSet = new Set(placements.map((p) => p.id));
      const unusedPieces = selectedPieces.filter((p) => !usedSet.has(p.id));

      // ── Условие выхода: полное покрытие или недостаток инвентаря ──────────
      if (cachedBlobs.length === 0) {
        if (currentPolyHoles.length === 0) {
          // v5.2: «полное покрытие» не считается достигнутым, пока есть паразиты
          // (sub-min территории): отбраковываем их прямо в цикле и продолжаем —
          // SA заполняет освободившееся место. Выход — только чистым.
          if (!cullParasitesInLoop()) {
            _saExitReason = "full_coverage_polygon";
            break;
          }
          continue;
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
        let ki, dx, dy;
        // v5.3 уплотнение: половина TRANSLATE целится в крупнейшую внутреннюю дыру —
        // ближайший к ней кусок двигается К её центроиду (+джиттер 2мм). Случайный
        // выбор куска и направления почти никогда не закрывает стыковые щели.
        const _intBlobs = _junction ? cachedBlobs.filter((b) => !b.edge) : [];
        if (_intBlobs.length > 0 && rng.next() < 0.5) {
          const blob = _intBlobs[0];
          let bestI = 0, bestD2 = Infinity;
          for (let i = 0; i < placements.length; i++) {
            const ddx = placements[i].cx - blob.x, ddy = placements[i].cy - blob.y;
            const d2 = ddx * ddx + ddy * ddy;
            if (d2 < bestD2) { bestD2 = d2; bestI = i; }
          }
          ki = bestI;
          const oldP = placements[ki];
          const dist = Math.max(1, Math.sqrt(bestD2));
          const step = Math.min(stepMm, Math.max(2, dist * 0.3));
          dx = (blob.x - oldP.cx) / dist * step + (rng.next() * 2 - 1) * 2;
          dy = (blob.y - oldP.cy) / dist * step + (rng.next() * 2 - 1) * 2;
        } else {
          ki = rng.nextInt(placements.length);
          dx = (rng.next() * 2 - 1) * stepMm;
          dy = (rng.next() * 2 - 1) * stepMm;
        }
        const old = placements[ki];
        const piece = findPiece(selectedPieces, old.id);
        const np = makePlacement(piece, old.cx + dx, old.cy + dy, old.angleDeg, spec, zoneMask);
        newPlacements = placements.map((p, i) => (i === ki ? np : p));
      } else if (move === MOVES.ROTATE && placements.length > 0) {
        const ki = rng.nextInt(placements.length);
        // R6: pieces are already normalized by nap in Access DB; solver must not rotate them.
        void ki;
      } else if (move === MOVES.SWAP && placements.length > 0 && unusedPieces.length > 0) {
        const ki = rng.nextInt(placements.length);
        const old = placements[ki];
        const newPiece = unusedPieces[rng.nextInt(unusedPieces.length)];
        const angle = 0;
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

        const angle = 0;
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
                if (cullParasitesInLoop()) continue;
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
              if (cullParasitesInLoop()) continue;
              _saExitReason = "add_loop_no_progress"; break;
            }
            T = Math.max(T * alpha, TminFloor);
            continue;
          }
        } else {
          consecutiveAddFails++;
          if (consecutiveAddFails > ADD_FAIL_LIMIT) {
            if (cullParasitesInLoop()) continue;
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
      // v5.2: unique-клетки паразитов не считаются покрытием — REMOVE паразита
      // для SA бесплатен по coverage, а −1 кусок делает его выгодным.
      const newUnusable = countUnusable(newPlacements, newCov.coreCounts, parasiteIds);
      const newE = energy(newCov.coveredCells - newUnusable, newCov.overlapCells, newPlacements.length, zoneCells, newSliverCount, _wEff) + PERIM_OBLIGATION_W * perimUncovered(newCov.covered) + _deepW * (newCov.deepOverlapCells || 0);
      const dE = newE - E;

      // Accept logic. При T = TminFloor — greedy.
      const effectiveT = Math.max(T, TminFloor);
      if (dE < 0 || rng.next() < Math.exp(-dE / Math.max(effectiveT, 1e-9))) {
        placements = newPlacements;
        covered = newCov.covered;
        coveredCells = newCov.coveredCells;
        deepOverlapCells = newCov.deepOverlapCells || 0;
        overlapCells = newCov.overlapCells;
        coreCounts = newCov.coreCounts;
        sliverCount = newSliverCount;
        unusableCells = newUnusable;
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

    // ── v5.2 финальная отбраковка (R5 на уровне SA) ──────────────────────────
    // Куски с sub-min территорией удаляются из best ДО формирования фрагментов.
    // Один проход достаточен: удаление только РАСТИТ территории оставшихся.
    // Потеря покрытия = только unique-клетки паразита (contested заберут соседи).
    let culled = [];
    if (minWidthMm > 0 && bestPlacements.length > 1) {
      const ts = computeTerritoryStats(bestPlacements);
      if (ts.parasites.length > 0 && ts.parasites.length < bestPlacements.length) {
        culled = ts.parasites.map((p) => ({
          id: p.id,
          territoryMm2: p.territoryMm2,
          bboxShortMm: p.bboxShortMm,
          reason: p.reason
        }));
        const rmIdx = new Set(ts.parasites.map((p) => p.idx));
        bestPlacements = bestPlacements.filter((_, i) => !rmIdx.has(i));
        bestCoveredCells = computeCoverage(bestPlacements, cellCount).coveredCells;
        console.log(`[VSA-SA] culled ${culled.length} sub-min territory placements: ${culled.map((c) => `${c.id}(${c.territoryMm2}mm2,${c.reason})`).join(", ")}`);
      }
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
      warmDurationMs,
      culled
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
