"use strict";

function createDictsService(deps) {
  const {
    fs,
    os,
    path,
    DB_PATH,
    DICTS_CACHE_TTL_SAFE_MS,
    runReaderWithFallback,
    parseScriptJson,
    ROOT_DIR
  } = deps;

  const dictsCache = {
    data: null,
    loadedAt: 0,
    lastError: "",
    loading: false
  };

  function loadDicts() {
    const readerPath = path.join(ROOT_DIR, "scripts", "access_read_dicts.js");
    function runReader(dbPath) {
      const exec = runReaderWithFallback(readerPath, [dbPath], { timeoutMs: 7000 });
      if (exec.run.error) {
        return { ok: false, error: `dicts_run_failed: ${exec.run.error.message}` };
      }
      if (exec.run.status !== 0) {
        return { ok: false, error: `dicts_exit_${exec.run.status}`, stdout: exec.stdout, stderr: exec.stderr };
      }
      try {
        const json = parseScriptJson(exec.stdout || "{}");
        if (!json.ok) return { ok: false, error: json.error || "dicts_not_ok", stdout: exec.stdout };
        return { ok: true, data: json };
      } catch (e) {
        return { ok: false, error: `dicts_parse_failed: ${e.message}`, stdout: exec.stdout };
      }
    }

    const primary = runReader(DB_PATH);
    if (primary.ok) return primary;

    const primaryDetails = [primary.error, primary.stdout, primary.stderr]
      .filter(Boolean)
      .join(" | ")
      .toLowerCase();
    const shouldRetryWithCopy =
      primary.error === "dicts_exit_2" ||
      primaryDetails.includes("current_db_unavailable") ||
      primaryDetails.includes("materials_query_failed") ||
      primaryDetails.includes("locations_query_failed");

    if (!shouldRetryWithCopy) return primary;

    const tmpCopyPath = path.join(
      os.tmpdir(),
      `furlab_dicts_${Date.now()}_${Math.random().toString(36).slice(2)}.accdb`
    );
    try {
      fs.copyFileSync(DB_PATH, tmpCopyPath);
    } catch (e) {
      return { ok: false, error: `dicts_copy_failed: ${e.message}`, primary };
    }

    const retry = runReader(tmpCopyPath);
    try {
      fs.unlinkSync(tmpCopyPath);
    } catch (_) {}

    if (retry.ok) return retry;

    return {
      ok: false,
      error: "dicts_read_failed_after_copy_retry",
      primary,
      retry
    };
  }

  function loadDictsCached(force = false) {
    const now = Date.now();
    const fresh = !!(
      dictsCache.data &&
      dictsCache.loadedAt > 0 &&
      (now - dictsCache.loadedAt) < DICTS_CACHE_TTL_SAFE_MS
    );

    if (!force && fresh) {
      return {
        ok: true,
        data: {
          ...dictsCache.data,
          cache: { cached: true, ageMs: now - dictsCache.loadedAt, ttlMs: DICTS_CACHE_TTL_SAFE_MS }
        }
      };
    }

    if (!force && dictsCache.data && dictsCache.loadedAt > 0 && !dictsCache.loading) {
      setImmediate(() => {
        try {
          loadDictsCached(true);
        } catch (_) {}
      });
      return {
        ok: true,
        data: {
          ...dictsCache.data,
          cache: {
            cached: true,
            stale: true,
            refreshing: true,
            ageMs: now - dictsCache.loadedAt,
            ttlMs: DICTS_CACHE_TTL_SAFE_MS
          }
        }
      };
    }

    if (dictsCache.loading && dictsCache.data && !force) {
      return {
        ok: true,
        data: {
          ...dictsCache.data,
          cache: { cached: true, ageMs: now - dictsCache.loadedAt, ttlMs: DICTS_CACHE_TTL_SAFE_MS, busy: true }
        }
      };
    }

    dictsCache.loading = true;
    const t0 = Date.now();
    const result = loadDicts();
    dictsCache.loading = false;

    if (result.ok) {
      dictsCache.data = result.data;
      dictsCache.loadedAt = Date.now();
      dictsCache.lastError = "";
      return {
        ok: true,
        data: {
          ...result.data,
          cache: { cached: false, loadMs: Date.now() - t0, ttlMs: DICTS_CACHE_TTL_SAFE_MS }
        }
      };
    }

    dictsCache.lastError = String(result.error || "dicts_load_failed");
    if (dictsCache.data) {
      return {
        ok: true,
        data: {
          ...dictsCache.data,
          cache: {
            cached: true,
            stale: true,
            ageMs: now - dictsCache.loadedAt,
            ttlMs: DICTS_CACHE_TTL_SAFE_MS,
            error: dictsCache.lastError
          }
        }
      };
    }

    return result;
  }

  return {
    loadDictsCached
  };
}

module.exports = {
  createDictsService
};
