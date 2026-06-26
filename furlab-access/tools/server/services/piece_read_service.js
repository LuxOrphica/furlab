"use strict";

function createPieceReadService(deps) {
  const {
    ROOT_DIR,
    path,
    PIECE_READER_TIMEOUT_MS,
    PIECE_CACHE_TTL_SAFE_MS,
    CONTOUR_CACHE_TTL_SAFE_MS,
    registryCache,
    runReaderViaTempDbCopy,
    parseScriptJson,
    readPieceCache,
    readPieceLiteCache,
    writePieceLiteCache,
    writePieceCache,
    readContourCache,
    writeContourCache,
    readDiskCache,
    writeDiskCache,
    readHistoryCache,
    writeHistoryCache,
    isSamePieceId,
    looksLikeGuid,
    normalizeGuidLike
  } = deps;

  function parseJsonObjectOrNull(raw) {
    if (!raw) return null;
    if (typeof raw === "object") return raw;
    if (typeof raw !== "string") return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function toNumOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeDeg360(v) {
    const n = toNumOrNull(v);
    if (n === null) return null;
    let out = n % 360;
    if (out < 0) out += 360;
    return out;
  }

  function normalizeContourPathPoints(path) {
    if (!Array.isArray(path)) return [];
    const out = [];
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      const x = toNumOrNull(p?.x);
      const y = toNumOrNull(p?.y);
      if (x === null || y === null) continue;
      out.push({ x, y });
    }
    if (out.length >= 2) {
      const a = out[0];
      const b = out[out.length - 1];
      if (a.x === b.x && a.y === b.y) out.pop();
    }
    return out;
  }

  function signedArea2D(path) {
    if (!Array.isArray(path) || path.length < 3) return 0;
    let s = 0;
    for (let i = 0; i < path.length; i++) {
      const a = path[i];
      const b = path[(i + 1) % path.length];
      s += a.x * b.y - b.x * a.y;
    }
    return s / 2;
  }

  function contourBBox(path) {
    if (!Array.isArray(path) || path.length < 1) return null;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
    return { minX, minY, maxX, maxY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
  }

  function closePath(path) {
    if (!Array.isArray(path) || path.length < 1) return [];
    const out = path.slice();
    const a = out[0];
    const b = out[out.length - 1];
    if (a.x !== b.x || a.y !== b.y) out.push({ x: a.x, y: a.y });
    return out;
  }

  function ensureClockwiseScreen(path) {
    if (!Array.isArray(path) || path.length < 3) return path;
    // For y-down coordinates positive signed area means clockwise.
    return signedArea2D(path) >= 0 ? path : path.slice().reverse();
  }

  function buildCanonicalContourForLayout(contour, scanSide) {
    if (!contour || typeof contour !== "object") return null;
    const pathRaw = normalizeContourPathPoints(contour.path);
    if (pathRaw.length < 3) return null;
    const units = String(contour.units || "mm");
    const normalizedScanSide = String(scanSide || "").trim().toLowerCase();

    let canonicalPath = pathRaw;
    let canonicalized = false;
    if (normalizedScanSide === "leather_up") {
      const bb = contourBBox(pathRaw);
      if (!bb) return null;
      const cx = (bb.minX + bb.maxX) / 2;
      canonicalPath = pathRaw.map((p) => ({ x: 2 * cx - p.x, y: p.y }));
      canonicalized = true;
    }
    canonicalPath = ensureClockwiseScreen(canonicalPath);
    const bb2 = contourBBox(canonicalPath);
    if (!bb2) return null;
    return {
      ...contour,
      units,
      path: closePath(canonicalPath),
      source: {
        ...(contour.source && typeof contour.source === "object" ? contour.source : {}),
        canonicalized,
        canonicalizationMethod: canonicalized ? "mirror_vertical_bbox_center" : null,
        scanSide: normalizedScanSide || null
      },
      metrics: {
        area: Math.abs(signedArea2D(canonicalPath)),
        bboxWidth: bb2.width,
        bboxHeight: bb2.height
      }
    };
  }

  function normalizePieceItemForLayout(item) {
    if (!item || typeof item !== "object") return item;
    const out = { ...item };
    const metricsObj = parseJsonObjectOrNull(out.metricsJson);
    const contourObj = parseJsonObjectOrNull(out.scrapContour);
    const scanSide = String(metricsObj?.scanSide || "").trim().toLowerCase();
    let metricsChanged = false;

    let canonicalContour = null;
    if (metricsObj && metricsObj.contourCanonical && typeof metricsObj.contourCanonical === "object") {
      canonicalContour = metricsObj.contourCanonical;
    } else if (scanSide === "leather_up") {
      const rawContour = (metricsObj && metricsObj.contourRaw && typeof metricsObj.contourRaw === "object")
        ? metricsObj.contourRaw
        : contourObj;
      canonicalContour = buildCanonicalContourForLayout(rawContour, scanSide);
      if (canonicalContour && metricsObj) {
        metricsObj.contourCanonical = canonicalContour;
        metricsObj.contourNormalization = {
          applied: true,
          method: "mirror_vertical_bbox_center",
          axis: "bbox_center_x",
          canonicalFrame: "layout_face_side"
        };
        metricsChanged = true;
      }
    } else if (contourObj && typeof contourObj === "object") {
      canonicalContour = contourObj;
    }

    if (canonicalContour && typeof canonicalContour === "object") {
      out.scrapContour = JSON.stringify(canonicalContour);
    }

    let napCanonical = metricsObj ? toNumOrNull(metricsObj.napDirectionDegCanonical) : null;
    if (napCanonical === null) {
      // Avoid double inversion: DB field napDirectionDeg is treated as canonical by default.
      // Only derive canonical from explicit raw nap if raw is present in metrics.
      const rawNapFromMetrics = metricsObj ? toNumOrNull(metricsObj.napDirectionDegRaw) : null;
      if (rawNapFromMetrics !== null) {
        napCanonical = (scanSide === "leather_up")
          ? normalizeDeg360(180 - rawNapFromMetrics)
          : normalizeDeg360(rawNapFromMetrics);
      } else {
        napCanonical = normalizeDeg360(out.napDirectionDeg);
      }
      if (metricsObj && napCanonical !== null) {
        metricsObj.napDirectionDegCanonical = napCanonical;
        metricsChanged = true;
      }
    }
    // Keep DB napDirectionDeg as physical/raw piece orientation.
    // Canonical orientation is stored in metrics only.

    if (metricsObj && (metricsChanged || canonicalContour)) {
      out.metricsJson = JSON.stringify(metricsObj);
    }
    return out;
  }

  function loadPieceById(pieceId, options = {}) {
    const id = String(pieceId || "").trim();
    if (!id) return { ok: false, error: "piece_id_required" };
    const includeReservation = options && options.includeReservation === true;
    const lite = options && options.lite === true;
    const force = options && options.force === true;
    if (lite) {
      return loadPieceLiteById(id, { includeReservation, force });
    }
    const cached = force ? null : readPieceCache(id);
    const cachedItem = cached && cached.item;
    if (cachedItem && isSamePieceId(id, cachedItem)) {
      return {
        ok: true,
        item: normalizePieceItemForLayout(cachedItem),
        cache: cached.cache || { cached: true, ttlMs: PIECE_CACHE_TTL_SAFE_MS },
        diag: { source: "piece_cache", copyMs: 0, scriptMs: 0, parseMs: 0 }
      };
    }
    const readerPath = path.join(ROOT_DIR, "scripts", "access_read_piece.js");
    function parseReader(exec) {
      const scriptMs = Number(exec?.__timing?.scriptMs || 0);
      const copyMs = Number(exec?.__diag?.copyMs || 0);
      const source = String(exec?.__diag?.source || "unknown");
      if (exec.run.error) {
        return { ok: false, error: `piece_run_failed: ${exec.run.error.message}`, diag: { source, copyMs, scriptMs, parseMs: 0 } };
      }
      if (exec.run.status !== 0) {
        return { ok: false, error: `piece_exit_${exec.run.status}`, stdout: exec.stdout, stderr: exec.stderr, diag: { source, copyMs, scriptMs, parseMs: 0 } };
      }
      const tParse0 = Date.now();
      try {
        const json = parseScriptJson(exec.stdout || "{}");
        const parseMs = Date.now() - tParse0;
        if (!json.ok) return { ok: false, error: json.error || "piece_not_ok", stdout: exec.stdout, diag: { source, copyMs, scriptMs, parseMs } };
        return { ok: true, item: json.item, diag: { source, copyMs, scriptMs, parseMs } };
      } catch (e) {
        return { ok: false, error: `piece_parse_failed: ${e.message}`, stdout: exec.stdout, diag: { source, copyMs, scriptMs, parseMs: Date.now() - tParse0 } };
      }
    }

    function runPieceReader(readId) {
      const tScript0 = Date.now();
      const exec = runReaderViaTempDbCopy(readerPath, [readId], { timeoutMs: PIECE_READER_TIMEOUT_MS });
      exec.__timing = { scriptMs: Date.now() - tScript0 };
      return parseReader(exec);
    }

    let readId = id;
    if (!looksLikeGuid(id) && Array.isArray(registryCache.items) && registryCache.items.length > 0) {
      const reg = registryCache.items.find((it) => String(it?.inventoryTag || "").trim() === id);
      const regId = String(reg?.id || "").trim();
      if (regId) readId = regId;
    }

    let result = runPieceReader(readId);
    if (!result.ok) {
      // Fallback for unstable tag lookup: resolve tag->id and retry by GUID.
      const looksNotFound = /piece_exit_2|piece_not_found/i.test(String(result.error || ""));
      if (looksNotFound) {
        const liteResolved = loadPieceLiteById(id, { includeReservation: false, force: false });
        const resolvedId = String(liteResolved?.item?.id || "").trim();
        const shouldRetryByGuid =
          liteResolved.ok &&
          resolvedId &&
          (!looksLikeGuid(id) || normalizeGuidLike(resolvedId) !== normalizeGuidLike(id));
        if (shouldRetryByGuid) {
          const byGuid = runPieceReader(resolvedId);
          if (byGuid.ok) {
            result = byGuid;
          }
        }
      }
    }
    if (!result.ok) {
      if (force) {
        return result;
      }
      const stale = readPieceCache(id, { allowStale: true });
      if (stale && stale.item && isSamePieceId(id, stale.item)) {
        return {
          ok: true,
          item: normalizePieceItemForLayout(stale.item),
          cache: stale.cache,
          diag: { source: "piece_cache_stale", copyMs: 0, scriptMs: 0, parseMs: 0 },
          warning: result.error || "piece_reader_failed"
        };
      }
      return result;
    }

    const json = { ok: true, item: normalizePieceItemForLayout(result.item) };
    if (!isSamePieceId(id, json.item)) {
      return { ok: false, error: `piece_mismatch: requested=${id}; got=${json.item?.id || json.item?.inventoryTag || "-"}` };
    }
    if (includeReservation) {
      const reservation = loadPieceReservationById(id);
      if (reservation.ok) {
        json.item = json.item && typeof json.item === "object"
          ? { ...json.item, reservation: reservation.reservation || null }
          : json.item;
      }
    }
    writePieceCache(id, json.item);
    return { ok: true, item: json.item, diag: result.diag };
  }

  function loadPieceLiteById(pieceId, options = {}) {
    const id = String(pieceId || "").trim();
    if (!id) return { ok: false, error: "piece_id_required" };
    const includeReservation = options && options.includeReservation === true;
    const force = options && options.force === true;
    const cached = force ? null : readPieceLiteCache(id);
    const cachedItem = cached && cached.item;
    if (cachedItem && isSamePieceId(id, cachedItem)) {
      return {
        ok: true,
        item: normalizePieceItemForLayout(cachedItem),
        cache: cached.cache || { cached: true, ttlMs: PIECE_CACHE_TTL_SAFE_MS },
        diag: { source: "piece_lite_cache", copyMs: 0, scriptMs: 0, parseMs: 0 }
      };
    }
    const diskCached = force ? null : readDiskCache("lite", id, PIECE_CACHE_TTL_SAFE_MS);
    if (diskCached && diskCached.item && isSamePieceId(id, diskCached.item)) {
      return {
        ok: true,
        item: normalizePieceItemForLayout(diskCached.item),
        cache: diskCached.cache,
        diag: { source: "piece_lite_disk_cache", copyMs: 0, scriptMs: 0, parseMs: 0 }
      };
    }

    if (!force && Array.isArray(registryCache.items) && registryCache.items.length > 0) {
      const wantGuid = looksLikeGuid(id);
      const targetGuid = wantGuid ? normalizeGuidLike(id) : "";
      const regItem = registryCache.items.find((it) => {
        const regId = String(it?.id || "").trim();
        const regTag = String(it?.inventoryTag || "").trim();
        if (wantGuid) {
          return regId && normalizeGuidLike(regId) === targetGuid;
        }
        return regTag && regTag === id;
      });
      if (regItem && typeof regItem === "object") {
        const item = {
          id: regItem.id || id,
          inventoryTag: regItem.inventoryTag || null,
          materialId: regItem.materialId || null,
          storageLocationId: regItem.storageLocationId || null,
          scrapQuality: regItem.scrapQuality || null,
          scrapStatus: regItem.scrapStatus || null,
          areaMm2: regItem.areaMm2 ?? null,
          bboxWidthMm: null,
          bboxHeightMm: null,
          maxSpanMm: regItem.maxSpanMm ?? null,
          napDirectionDeg: regItem.napDirectionDeg ?? null,
          note: regItem.note ?? null,
          createdAt: null,
          updatedAt: regItem.updatedAt || null,
          metricsJson: null,
          scrapContour: null
        };
        if (isSamePieceId(id, item)) {
          writePieceLiteCache(id, item);
          writeDiskCache("lite", id, item);
          return {
            ok: true,
            item,
            cache: { cached: true, ttlMs: PIECE_CACHE_TTL_SAFE_MS },
            diag: { source: "registry_cache", copyMs: 0, scriptMs: 0, parseMs: 0 }
          };
        }
      }
    }

    const readerPath = path.join(ROOT_DIR, "scripts", "access_read_piece_lite.js");
    function parseReader(exec) {
      const scriptMs = Number(exec?.__timing?.scriptMs || 0);
      const copyMs = Number(exec?.__diag?.copyMs || 0);
      const source = String(exec?.__diag?.source || "unknown");
      if (exec.run.error) {
        return { ok: false, error: `piece_lite_run_failed: ${exec.run.error.message}`, diag: { source, copyMs, scriptMs, parseMs: 0 } };
      }
      if (exec.run.status !== 0) {
        return { ok: false, error: `piece_lite_exit_${exec.run.status}`, stdout: exec.stdout, stderr: exec.stderr, diag: { source, copyMs, scriptMs, parseMs: 0 } };
      }
      const tParse0 = Date.now();
      try {
        const json = parseScriptJson(exec.stdout || "{}");
        const parseMs = Date.now() - tParse0;
        if (!json.ok) return { ok: false, error: json.error || "piece_lite_not_ok", stdout: exec.stdout, diag: { source, copyMs, scriptMs, parseMs } };
        return { ok: true, item: json.item, diag: { source, copyMs, scriptMs, parseMs } };
      } catch (e) {
        return { ok: false, error: `piece_lite_parse_failed: ${e.message}`, stdout: exec.stdout, diag: { source, copyMs, scriptMs, parseMs: Date.now() - tParse0 } };
      }
    }

    const tScript0 = Date.now();
    const exec = runReaderViaTempDbCopy(readerPath, [id], { timeoutMs: PIECE_READER_TIMEOUT_MS });
    exec.__timing = { scriptMs: Date.now() - tScript0 };
    const result = parseReader(exec);
    if (!result.ok) {
      if (force) {
        return result;
      }
      const stale = readPieceLiteCache(id, { allowStale: true });
      if (stale && stale.item) {
        return {
          ok: true,
          item: normalizePieceItemForLayout(stale.item),
          cache: stale.cache,
          diag: { source: "piece_lite_cache_stale", copyMs: 0, scriptMs: 0, parseMs: 0 },
          warning: result.error || "piece_lite_reader_failed"
        };
      }
      return result;
    }

    const json = { ok: true, item: normalizePieceItemForLayout(result.item) };
    if (!isSamePieceId(id, json.item)) {
      return { ok: false, error: `piece_mismatch: requested=${id}; got=${json.item?.id || json.item?.inventoryTag || "-"}` };
    }
    if (includeReservation) {
      const reservation = loadPieceReservationById(id);
      if (reservation.ok) {
        json.item = json.item && typeof json.item === "object"
          ? { ...json.item, reservation: reservation.reservation || null }
          : json.item;
      }
    }
    writePieceLiteCache(id, json.item);
    writeDiskCache("lite", id, json.item);
    return { ok: true, item: json.item, diag: result.diag };
  }

  function loadPieceContourById(pieceId) {
    const id = String(pieceId || "").trim();
    if (!id) return { ok: false, error: "piece_id_required" };
    const cached = readContourCache(id);
    if (cached && cached.item) {
      return {
        ok: true,
        item: normalizePieceItemForLayout(cached.item),
        cache: cached.cache || { cached: true, ttlMs: CONTOUR_CACHE_TTL_SAFE_MS },
        diag: { source: "contour_cache", copyMs: 0, scriptMs: 0, parseMs: 0 }
      };
    }
    const diskCached = readDiskCache("contour", id, CONTOUR_CACHE_TTL_SAFE_MS);
    if (diskCached && diskCached.item) {
      return {
        ok: true,
        item: normalizePieceItemForLayout(diskCached.item),
        cache: diskCached.cache,
        diag: { source: "contour_disk_cache", copyMs: 0, scriptMs: 0, parseMs: 0 }
      };
    }
    const readerPath = path.join(ROOT_DIR, "scripts", "access_read_piece_contour.js");
    const tScript0 = Date.now();
    const exec = runReaderViaTempDbCopy(readerPath, [id], { timeoutMs: PIECE_READER_TIMEOUT_MS });
    const scriptMs = Date.now() - tScript0;
    const source = String(exec?.__diag?.source || "unknown");
    const copyMs = Number(exec?.__diag?.copyMs || 0);
    if (exec.run.error) {
      const stale = readContourCache(id, { allowStale: true });
      if (stale && stale.item) {
        return {
          ok: true,
          item: normalizePieceItemForLayout(stale.item),
          cache: stale.cache,
          diag: { source: "contour_cache_stale", copyMs: 0, scriptMs: 0, parseMs: 0 },
          warning: `piece_contour_run_failed: ${exec.run.error.message}`
        };
      }
      return { ok: false, error: `piece_contour_run_failed: ${exec.run.error.message}`, diag: { source, copyMs, scriptMs, parseMs: 0 } };
    }
    if (exec.run.status !== 0) {
      const stale = readContourCache(id, { allowStale: true });
      if (stale && stale.item) {
        return {
          ok: true,
          item: normalizePieceItemForLayout(stale.item),
          cache: stale.cache,
          diag: { source: "contour_cache_stale", copyMs: 0, scriptMs: 0, parseMs: 0 },
          warning: `piece_contour_exit_${exec.run.status}`
        };
      }
      return { ok: false, error: `piece_contour_exit_${exec.run.status}`, stdout: exec.stdout, stderr: exec.stderr, diag: { source, copyMs, scriptMs, parseMs: 0 } };
    }
    const tParse0 = Date.now();
    try {
      const json = parseScriptJson(exec.stdout || "{}");
      const parseMs = Date.now() - tParse0;
      if (!json || !json.ok || !json.item) {
        const stale = readContourCache(id, { allowStale: true });
        if (stale && stale.item) {
          return {
            ok: true,
            item: normalizePieceItemForLayout(stale.item),
            cache: stale.cache,
            diag: { source: "contour_cache_stale", copyMs: 0, scriptMs: 0, parseMs: 0 },
            warning: (json && json.error) || "piece_contour_not_ok"
          };
        }
        return { ok: false, error: (json && json.error) || "piece_contour_not_ok", stdout: exec.stdout, diag: { source, copyMs, scriptMs, parseMs } };
      }
      const item = normalizePieceItemForLayout(json.item && typeof json.item === "object" ? json.item : null);
      if (item && typeof item === "object") {
        writeContourCache(id, item);
        writeDiskCache("contour", id, item);
        const cachedPiece = readPieceCache(id);
        if (cachedPiece && cachedPiece.item && typeof cachedPiece.item === "object") {
          cachedPiece.item.metricsJson = item.metricsJson;
          cachedPiece.item.scrapContour = item.scrapContour;
          writePieceCache(id, cachedPiece.item);
        }
      }
      return { ok: true, item, diag: { source, copyMs, scriptMs, parseMs } };
    } catch (e) {
      const stale = readContourCache(id, { allowStale: true });
      if (stale && stale.item) {
        return {
          ok: true,
          item: normalizePieceItemForLayout(stale.item),
          cache: stale.cache,
          diag: { source: "contour_cache_stale", copyMs: 0, scriptMs: 0, parseMs: 0 },
          warning: `piece_contour_parse_failed: ${e.message}`
        };
      }
      return { ok: false, error: `piece_contour_parse_failed: ${e.message}`, stdout: exec.stdout, diag: { source, copyMs, scriptMs, parseMs: Date.now() - tParse0 } };
    }
  }

  function loadPieceReservationById(pieceId) {
    const id = String(pieceId || "").trim();
    if (!id) return { ok: false, error: "piece_id_required" };
    const readerPath = path.join(ROOT_DIR, "scripts", "access_read_piece_reservation.js");
    const tScript0 = Date.now();
    const exec = runReaderViaTempDbCopy(readerPath, [id], { timeoutMs: PIECE_READER_TIMEOUT_MS });
    const scriptMs = Date.now() - tScript0;
    const source = String(exec?.__diag?.source || "unknown");
    const copyMs = Number(exec?.__diag?.copyMs || 0);
    if (exec.run.error) {
      return { ok: false, error: `reservation_run_failed: ${exec.run.error.message}`, diag: { source, copyMs, scriptMs, parseMs: 0 } };
    }
    if (exec.run.status !== 0) {
      return { ok: false, error: `reservation_exit_${exec.run.status}`, stdout: exec.stdout, stderr: exec.stderr, diag: { source, copyMs, scriptMs, parseMs: 0 } };
    }
    const tParse0 = Date.now();
    try {
      const json = parseScriptJson(exec.stdout || "{}");
      const parseMs = Date.now() - tParse0;
      if (!json.ok) return { ok: false, error: json.error || "reservation_not_ok", stdout: exec.stdout, diag: { source, copyMs, scriptMs, parseMs } };
      return {
        ok: true,
        reservation: {
          active: json.active || null,
          last: json.last || null
        },
        diag: { source, copyMs, scriptMs, parseMs }
      };
    } catch (e) {
      return { ok: false, error: `reservation_parse_failed: ${e.message}`, stdout: exec.stdout, diag: { source, copyMs, scriptMs, parseMs: Date.now() - tParse0 } };
    }
  }

  function loadPieceBundleById(pieceId, options = {}) {
    const id = String(pieceId || "").trim();
    if (!id) return { ok: false, error: "piece_id_required" };
    const includeReservation = options && options.includeReservation === true;
    const includeHistory = options && options.includeHistory === true;

    const cached = readPieceCache(id);
    const cachedItem = cached && cached.item;
    if (cachedItem) {
      const payload = {
        ok: true,
        item: normalizePieceItemForLayout(cachedItem),
        reservation: includeReservation ? (cachedItem.reservation || null) : null,
        diag: { source: "piece_bundle_cache", copyMs: 0, scriptMs: 0, parseMs: 0 },
        cache: cached.cache || { cached: true, ttlMs: PIECE_CACHE_TTL_SAFE_MS }
      };
      if (includeHistory) {
        payload.history = Array.isArray(cachedItem.history) ? cachedItem.history : (readHistoryCache(id, "") || []);
      }
      return payload;
    }

    const readerPath = path.join(ROOT_DIR, "scripts", "access_read_piece_bundle.js");

    const tScript0 = Date.now();
    const exec = runReaderViaTempDbCopy(
      readerPath,
      [id, includeReservation ? "1" : "0", includeHistory ? "1" : "0"],
      { timeoutMs: PIECE_READER_TIMEOUT_MS }
    );
    const scriptMs = Date.now() - tScript0;
    const source = String(exec?.__diag?.source || "unknown");
    const copyMs = Number(exec?.__diag?.copyMs || 0);

    if (exec.run.error) {
      const stale = readPieceCache(id, { allowStale: true });
      if (stale && stale.item) {
        return {
          ok: true,
          item: normalizePieceItemForLayout(stale.item),
          reservation: includeReservation ? (stale.item.reservation || null) : null,
          ...(includeHistory ? { history: Array.isArray(stale.item.history) ? stale.item.history : [] } : {}),
          cache: stale.cache,
          diag: { source: "piece_bundle_cache_stale", copyMs: 0, scriptMs: 0, parseMs: 0 },
          warning: `piece_bundle_run_failed: ${exec.run.error.message}`
        };
      }
      return { ok: false, error: `piece_bundle_run_failed: ${exec.run.error.message}`, diag: { source, copyMs, scriptMs, parseMs: 0 } };
    }
    if (exec.run.status !== 0) {
      const stale = readPieceCache(id, { allowStale: true });
      if (stale && stale.item) {
        return {
          ok: true,
          item: normalizePieceItemForLayout(stale.item),
          reservation: includeReservation ? (stale.item.reservation || null) : null,
          ...(includeHistory ? { history: Array.isArray(stale.item.history) ? stale.item.history : [] } : {}),
          cache: stale.cache,
          diag: { source: "piece_bundle_cache_stale", copyMs: 0, scriptMs: 0, parseMs: 0 },
          warning: `piece_bundle_exit_${exec.run.status}`
        };
      }
      return { ok: false, error: `piece_bundle_exit_${exec.run.status}`, stdout: exec.stdout, stderr: exec.stderr, diag: { source, copyMs, scriptMs, parseMs: 0 } };
    }
    const tParse0 = Date.now();
    try {
      const json = parseScriptJson(exec.stdout || "{}");
      const parseMs = Date.now() - tParse0;
      if (!json || !json.ok || !json.item) {
        const stale = readPieceCache(id, { allowStale: true });
        if (stale && stale.item) {
          return {
            ok: true,
            item: normalizePieceItemForLayout(stale.item),
            reservation: includeReservation ? (stale.item.reservation || null) : null,
            ...(includeHistory ? { history: Array.isArray(stale.item.history) ? stale.item.history : [] } : {}),
            cache: stale.cache,
            diag: { source: "piece_bundle_cache_stale", copyMs: 0, scriptMs: 0, parseMs: 0 },
            warning: (json && json.error) || "piece_bundle_not_ok"
          };
        }
        return { ok: false, error: (json && json.error) || "piece_bundle_not_ok", stdout: exec.stdout, diag: { source, copyMs, scriptMs, parseMs } };
      }
      const item = normalizePieceItemForLayout(json.item && typeof json.item === "object" ? json.item : null);
      const reservation = (includeReservation && json.reservation && typeof json.reservation === "object") ? json.reservation : null;
      const history = (includeHistory && Array.isArray(json.history)) ? json.history : [];
      if (item) {
        if (includeReservation) item.reservation = reservation;
        if (includeHistory) item.history = history;
      }
      writePieceCache(id, item);
      writeContourCache(id, {
        id: item?.id || id,
        metricsJson: item?.metricsJson ?? null,
        scrapContour: item?.scrapContour ?? null
      });
      if (includeHistory) writeHistoryCache(id, "", history);
      return {
        ok: true,
        item,
        reservation,
        ...(includeHistory ? { history } : {}),
        diag: { source, copyMs, scriptMs, parseMs }
      };
    } catch (e) {
      const stale = readPieceCache(id, { allowStale: true });
      if (stale && stale.item) {
        return {
          ok: true,
          item: normalizePieceItemForLayout(stale.item),
          reservation: includeReservation ? (stale.item.reservation || null) : null,
          ...(includeHistory ? { history: Array.isArray(stale.item.history) ? stale.item.history : [] } : {}),
          cache: stale.cache,
          diag: { source: "piece_bundle_cache_stale", copyMs: 0, scriptMs: 0, parseMs: 0 },
          warning: `piece_bundle_parse_failed: ${e.message}`
        };
      }
      return { ok: false, error: `piece_bundle_parse_failed: ${e.message}`, stdout: exec.stdout, diag: { source, copyMs, scriptMs, parseMs: Date.now() - tParse0 } };
    }
  }

  return {
    loadPieceById,
    loadPieceLiteById,
    loadPieceContourById,
    loadPieceReservationById,
    loadPieceBundleById
  };
}

module.exports = {
  createPieceReadService
};
