"use strict";

function createCacheService(deps) {
  const {
    fs,
    path,
    crypto,
    DISK_CACHE_DIR,
    pieceCache,
    pieceLiteCache,
    contourCache,
    historyCache,
    PIECE_CACHE_TTL_SAFE_MS,
    CONTOUR_CACHE_TTL_SAFE_MS,
    HISTORY_CACHE_TTL_SAFE_MS,
    looksLikeGuid,
    normalizeGuidLike
  } = deps;

  function pieceKey(pieceId) {
    const raw = String(pieceId || "").trim();
    if (!raw) return "";
    if (typeof looksLikeGuid === "function" && looksLikeGuid(raw)) {
      return typeof normalizeGuidLike === "function" ? normalizeGuidLike(raw) : raw.toLowerCase();
    }
    return raw;
  }

  function readPieceCache(pieceId, options = {}) {
    const key = pieceKey(pieceId);
    if (!key) return null;
    const cached = pieceCache.get(key);
    if (!cached) return null;
    const ageMs = Date.now() - Number(cached.loadedAt || 0);
    if (ageMs > PIECE_CACHE_TTL_SAFE_MS) {
      if (options && options.allowStale) {
        return {
          item: cached.item || null,
          cache: {
            cached: true,
            stale: true,
            ageMs,
            ttlMs: PIECE_CACHE_TTL_SAFE_MS
          }
        };
      }
      pieceCache.delete(key);
      return null;
    }
    return {
      item: cached.item || null,
      cache: {
        cached: true,
        stale: false,
        ageMs,
        ttlMs: PIECE_CACHE_TTL_SAFE_MS
      }
    };
  }

  function readPieceLiteCache(pieceId, options = {}) {
    const key = pieceKey(pieceId);
    if (!key) return null;
    const cached = pieceLiteCache.get(key);
    if (!cached) return null;
    const ageMs = Date.now() - Number(cached.loadedAt || 0);
    if (ageMs > PIECE_CACHE_TTL_SAFE_MS) {
      if (options && options.allowStale) {
        return {
          item: cached.item || null,
          cache: {
            cached: true,
            stale: true,
            ageMs,
            ttlMs: PIECE_CACHE_TTL_SAFE_MS
          }
        };
      }
      pieceLiteCache.delete(key);
      return null;
    }
    return {
      item: cached.item || null,
      cache: {
        cached: true,
        stale: false,
        ageMs,
        ttlMs: PIECE_CACHE_TTL_SAFE_MS
      }
    };
  }

  function writePieceLiteCache(pieceId, item) {
    const key = pieceKey(pieceId);
    if (!key || !item || typeof item !== "object") return;
    pieceLiteCache.set(key, { loadedAt: Date.now(), item });
  }

  function writePieceCache(pieceId, item) {
    const key = pieceKey(pieceId);
    if (!key || !item || typeof item !== "object") return;
    pieceCache.set(key, { loadedAt: Date.now(), item });
    if (Object.prototype.hasOwnProperty.call(item, "metricsJson") || Object.prototype.hasOwnProperty.call(item, "scrapContour")) {
      writeContourCache(key, {
        id: item.id || key,
        metricsJson: item.metricsJson ?? null,
        scrapContour: item.scrapContour ?? null
      });
    }
  }

  function invalidatePieceCacheById(pieceId) {
    const key = pieceKey(pieceId);
    if (!key) return;
    pieceCache.delete(key);
    pieceLiteCache.delete(key);
    contourCache.delete(key);
    removeDiskCache("lite", key);
    removeDiskCache("contour", key);
  }

  function ensureDiskCacheDir() {
    try {
      fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
    } catch (_) {}
  }

  function diskCacheKey(kind, pieceId) {
    const key = pieceKey(pieceId);
    const hash = crypto.createHash("md5").update(key).digest("hex");
    return path.join(DISK_CACHE_DIR, `${kind}_${hash}.json`);
  }

  function readDiskCache(kind, pieceId, ttlMs) {
    try {
      const filePath = diskCacheKey(kind, pieceId);
      const st = fs.statSync(filePath);
      const ageMs = Date.now() - Number(st.mtimeMs || 0);
      if (ageMs > ttlMs) return null;
      const raw = fs.readFileSync(filePath, "utf8");
      const json = JSON.parse(raw);
      if (!json || typeof json !== "object") return null;
      return {
        item: json.item || null,
        cache: { cached: true, stale: false, ageMs, ttlMs }
      };
    } catch (_) {
      return null;
    }
  }

  function writeDiskCache(kind, pieceId, item) {
    try {
      ensureDiskCacheDir();
      const filePath = diskCacheKey(kind, pieceId);
      fs.writeFileSync(filePath, JSON.stringify({ item }), "utf8");
    } catch (_) {}
  }

  function removeDiskCache(kind, pieceId) {
    try {
      const filePath = diskCacheKey(kind, pieceId);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (_) {}
  }

  function readContourCache(pieceId, options = {}) {
    const key = pieceKey(pieceId);
    if (!key) return null;
    const cached = contourCache.get(key);
    if (!cached) return null;
    const ageMs = Date.now() - Number(cached.loadedAt || 0);
    if (ageMs > CONTOUR_CACHE_TTL_SAFE_MS) {
      if (options && options.allowStale) {
        return {
          item: cached.item || null,
          cache: { cached: true, stale: true, ageMs, ttlMs: CONTOUR_CACHE_TTL_SAFE_MS }
        };
      }
      contourCache.delete(key);
      return null;
    }
    return {
      item: cached.item || null,
      cache: { cached: true, stale: false, ageMs, ttlMs: CONTOUR_CACHE_TTL_SAFE_MS }
    };
  }

  function writeContourCache(pieceId, item) {
    const key = pieceKey(pieceId);
    if (!key || !item || typeof item !== "object") return;
    contourCache.set(key, { loadedAt: Date.now(), item });
  }

  function getHistoryCacheKey(pieceId, inventoryTag) {
    return `${pieceKey(pieceId)}|${String(inventoryTag || "").trim()}`;
  }

  function readHistoryCache(pieceId, inventoryTag) {
    const key = getHistoryCacheKey(pieceId, inventoryTag);
    const cached = historyCache.get(key);
    if (!cached) return null;
    if ((Date.now() - Number(cached.loadedAt || 0)) > HISTORY_CACHE_TTL_SAFE_MS) {
      historyCache.delete(key);
      return null;
    }
    return cached.items;
  }

  function writeHistoryCache(pieceId, inventoryTag, items) {
    const key = getHistoryCacheKey(pieceId, inventoryTag);
    historyCache.set(key, { loadedAt: Date.now(), items: Array.isArray(items) ? items : [] });
  }

  function invalidateHistoryCacheByPieceId(pieceId) {
    const p = pieceKey(pieceId);
    if (!p) return;
    for (const key of historyCache.keys()) {
      if (key.startsWith(`${p}|`)) historyCache.delete(key);
    }
  }

  return {
    readPieceCache,
    readPieceLiteCache,
    writePieceLiteCache,
    writePieceCache,
    invalidatePieceCacheById,
    readDiskCache,
    writeDiskCache,
    removeDiskCache,
    readContourCache,
    writeContourCache,
    readHistoryCache,
    writeHistoryCache,
    invalidateHistoryCacheByPieceId
  };
}

module.exports = {
  createCacheService
};
