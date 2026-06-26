"use strict";

function createRegistryDataService(deps) {
  const {
    fs,
    path,
    os,
    DB_PATH,
    API_TMP_DIR,
    REGISTRY_DISK_CACHE,
    registryMirror,
    registryCache,
    REGISTRY_CACHE_TTL_SAFE_MS,
    REGISTRY_MIRROR_MAX_AGE_MS,
    REGISTRY_READER_TIMEOUT_MS,
    ROOT_DIR,
    runReaderWithFallback,
    parseScriptJson
  } = deps;

  function getDbMtimeMs(filePath) {
    try {
      const st = fs.statSync(filePath);
      return Number(st.mtimeMs || 0);
    } catch (_) {
      return 0;
    }
  }

  function ensureRegistryMirrorDb() {
    const now = Date.now();
    const sourceMtimeMs = getDbMtimeMs(DB_PATH);
    const mirrorExists = fs.existsSync(registryMirror.path);
    const mirrorAgeMs = mirrorExists ? (now - Number(registryMirror.copiedAt || 0)) : Number.POSITIVE_INFINITY;

    const needCopy =
      !mirrorExists ||
      !registryMirror.copiedAt ||
      mirrorAgeMs > REGISTRY_MIRROR_MAX_AGE_MS ||
      (sourceMtimeMs > 0 && sourceMtimeMs !== Number(registryMirror.sourceMtimeMs || 0));

    if (!needCopy) {
      return { ok: true, dbPath: registryMirror.path, copied: false, copyMs: 0 };
    }

    const t0 = Date.now();
    try {
      fs.mkdirSync(API_TMP_DIR, { recursive: true });
      fs.copyFileSync(DB_PATH, registryMirror.path);
      registryMirror.copiedAt = Date.now();
      registryMirror.sourceMtimeMs = sourceMtimeMs;
      return { ok: true, dbPath: registryMirror.path, copied: true, copyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: `registry_copy_failed: ${e.message}`, copied: false, copyMs: Date.now() - t0 };
    }
  }

  function invalidateRegistryCache() {
    registryCache.items = null;
    registryCache.loadedAt = 0;
  }

  function readRegistryDiskCache() {
    try {
      const st = fs.statSync(REGISTRY_DISK_CACHE);
      const ageMs = Date.now() - Number(st.mtimeMs || 0);
      if (ageMs > REGISTRY_CACHE_TTL_SAFE_MS) return null;
      const raw = fs.readFileSync(REGISTRY_DISK_CACHE, "utf8");
      const json = JSON.parse(raw);
      if (Number(json?.formatVersion || 0) !== 3) return null;
      if (!json || !Array.isArray(json.items)) return null;
      return {
        items: json.items,
        cache: {
          cached: true,
          stale: false,
          ageMs,
          ttlMs: REGISTRY_CACHE_TTL_SAFE_MS
        }
      };
    } catch (_) {
      return null;
    }
  }

  function writeRegistryDiskCache(items) {
    try {
      fs.mkdirSync(API_TMP_DIR, { recursive: true });
      fs.writeFileSync(REGISTRY_DISK_CACHE, JSON.stringify({ formatVersion: 3, items }), "utf8");
    } catch (_) {}
  }

  function runReaderViaTempDbCopy(scriptPath, args = [], options = {}) {
    const mirror = ensureRegistryMirrorDb();
    if (mirror.ok) {
      const exec = runReaderWithFallback(scriptPath, [mirror.dbPath, ...args], options);
      exec.__diag = {
        source: mirror.copied ? "mirror_refreshed" : "mirror_cached",
        copyMs: Number(mirror.copyMs || 0)
      };
      return exec;
    }

    const tmpCopyPath = path.join(
      os.tmpdir(),
      `furlab_read_${Date.now()}_${Math.random().toString(36).slice(2)}.accdb`
    );
    const runDirect = () => runReaderWithFallback(scriptPath, [DB_PATH, ...args], options);

    let exec = null;
    try {
      fs.copyFileSync(DB_PATH, tmpCopyPath);
      exec = runReaderWithFallback(scriptPath, [tmpCopyPath, ...args], options);
    } catch (_) {
      exec = runDirect();
    } finally {
      try { fs.unlinkSync(tmpCopyPath); } catch (_) {}
    }
    exec.__diag = { source: "temp_copy_fallback", copyMs: 0 };
    return exec;
  }

  function loadRegistryRowsCached(force = false) {
    const t0 = Date.now();
    const now = Date.now();
    if (
      !force &&
      Array.isArray(registryCache.items) &&
      registryCache.loadedAt > 0 &&
      (now - registryCache.loadedAt) < REGISTRY_CACHE_TTL_SAFE_MS
    ) {
      const ageMs = now - registryCache.loadedAt;
      return {
        ok: true,
        items: registryCache.items,
        cache: { cached: true, stale: false, ageMs, ttlMs: REGISTRY_CACHE_TTL_SAFE_MS },
        diag: {
          source: "registry_cache_memory",
          copyMs: 0,
          scriptMs: 0,
          parseMs: 0,
          totalMs: Date.now() - t0
        }
      };
    }
    const disk = force ? null : readRegistryDiskCache();
    if (disk && Array.isArray(disk.items) && disk.items.length > 0) {
      registryCache.items = disk.items;
      registryCache.loadedAt = Date.now() - Number(disk.cache?.ageMs || 0);
      return {
        ok: true,
        items: disk.items,
        cache: disk.cache,
        diag: {
          source: "registry_cache_disk",
          copyMs: 0,
          scriptMs: 0,
          parseMs: 0,
          totalMs: Date.now() - t0
        }
      };
    }

    const readerPath = path.join(ROOT_DIR, "scripts", "access_read_registry.js");
    function runReader(dbPath) {
      const tScript0 = Date.now();
      const exec = runReaderWithFallback(readerPath, [dbPath, "1"], {
        timeoutMs: REGISTRY_READER_TIMEOUT_MS,
        unicode: false,
        encoding: "utf8"
      });
      const scriptMs = Date.now() - tScript0;
      if (exec.run.error) {
        return { ok: false, error: `registry_run_failed: ${exec.run.error.message}`, diag: { scriptMs } };
      }
      if (exec.run.status !== 0) {
        let parsed = null;
        try {
          parsed = parseScriptJson(exec.stdout || "{}");
        } catch (_) {}
        return {
          ok: false,
          error: (parsed && parsed.error) ? String(parsed.error) : `registry_exit_${exec.run.status}`,
          stdout: exec.stdout,
          stderr: exec.stderr,
          diag: {
            scriptMs,
            script: (parsed && parsed.diag && typeof parsed.diag === "object") ? parsed.diag : null
          }
        };
      }
      let json = null;
      const tParse0 = Date.now();
      try {
        json = parseScriptJson(exec.stdout || "{}");
      } catch (e) {
        return { ok: false, error: `registry_parse_failed: ${e.message}`, stdout: exec.stdout, diag: { scriptMs, parseMs: Date.now() - tParse0 } };
      }
      if (!json || !json.ok || !Array.isArray(json.items)) {
        return { ok: false, error: json && json.error ? json.error : "registry_not_ok", stdout: exec.stdout, diag: { scriptMs, parseMs: Date.now() - tParse0 } };
      }
      return {
        ok: true,
        items: json.items,
        diag: {
          scriptMs,
          parseMs: Date.now() - tParse0,
          script: (json.diag && typeof json.diag === "object") ? json.diag : null
        }
      };
    }

    let result = null;
    let copyMs = 0;
    let source = "live";
    const mirror = ensureRegistryMirrorDb();
    if (mirror.ok) {
      source = mirror.copied ? "mirror_refreshed" : "mirror_cached";
      copyMs = Number(mirror.copyMs || 0);
      result = runReader(mirror.dbPath);
    } else {
      source = "live_fallback";
      copyMs = Number(mirror.copyMs || 0);
      result = runReader(DB_PATH);
      if (!result.ok) {
        result = { ok: false, error: mirror.error, primary: result, diag: result.diag || null };
      }
    }

    if (!result.ok) {
      console.warn(
        `[ui-lab] registry failed source=${source}; copyMs=${copyMs}; scriptMs=${result.diag?.scriptMs ?? "?"}; parseMs=${result.diag?.parseMs ?? "?"}; err=${result.error}`
      );
      if (Array.isArray(registryCache.items) && registryCache.items.length > 0) {
        return {
          ok: true,
          items: registryCache.items,
          cache: {
            cached: true,
            stale: true,
            ageMs: Date.now() - Number(registryCache.loadedAt || 0),
            ttlMs: REGISTRY_CACHE_TTL_SAFE_MS,
            error: result.error || "registry_read_failed"
          },
          diag: {
            source: "registry_cache_stale_memory",
            copyMs: 0,
            scriptMs: Number(result.diag?.scriptMs || 0),
            parseMs: Number(result.diag?.parseMs || 0),
            totalMs: Date.now() - t0
          }
        };
      }
      const diskFallback = readRegistryDiskCache();
      if (diskFallback && Array.isArray(diskFallback.items) && diskFallback.items.length > 0) {
        return {
          ok: true,
          items: diskFallback.items,
          cache: {
            cached: true,
            stale: true,
            ageMs: diskFallback.cache?.ageMs ?? 0,
            ttlMs: REGISTRY_CACHE_TTL_SAFE_MS,
            error: result.error || "registry_read_failed"
          },
          diag: {
            source: "registry_cache_stale_disk",
            copyMs: 0,
            scriptMs: Number(result.diag?.scriptMs || 0),
            parseMs: Number(result.diag?.parseMs || 0),
            totalMs: Date.now() - t0
          }
        };
      }
      return result;
    }
    registryCache.items = result.items;
    registryCache.loadedAt = Date.now();
    writeRegistryDiskCache(result.items);
    console.log(
      `[ui-lab] registry loaded source=${source}; copyMs=${copyMs}; scriptMs=${result.diag?.scriptMs ?? "?"}; parseMs=${result.diag?.parseMs ?? "?"}; rows=${result.items.length}`
    );
    return {
      ok: true,
      items: result.items,
      cache: { cached: false, stale: false, ttlMs: REGISTRY_CACHE_TTL_SAFE_MS },
      diag: {
        source,
        copyMs,
        scriptMs: Number(result.diag?.scriptMs || 0),
        parseMs: Number(result.diag?.parseMs || 0),
        script: result.diag?.script || null,
        totalMs: Date.now() - t0
      }
    };
  }

  return {
    getDbMtimeMs,
    ensureRegistryMirrorDb,
    invalidateRegistryCache,
    readRegistryDiskCache,
    writeRegistryDiskCache,
    runReaderViaTempDbCopy,
    loadRegistryRowsCached
  };
}

module.exports = {
  createRegistryDataService
};
