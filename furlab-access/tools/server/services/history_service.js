"use strict";

function createHistoryService(deps) {
  const {
    DB_PATH,
    ROOT_DIR,
    path,
    fs,
    runReaderWithFallback,
    runReaderViaTempDbCopy,
    parseScriptJson,
    asText,
    readHistoryCache,
    writeHistoryCache,
    HISTORY_CACHE_TTL_SAFE_MS,
    PIECE_READER_TIMEOUT_MS
  } = deps;

  const manualPlacementsPath = path.join(ROOT_DIR, "data", "placements", "manual_placements.ndjson");

  function readManualPlacementRows() {
    try {
      if (!fs || !fs.existsSync(manualPlacementsPath)) return [];
      const text = String(fs.readFileSync(manualPlacementsPath, "utf8") || "");
      if (!text.trim()) return [];
      const rows = [];
      for (const line of text.split(/\r?\n/)) {
        const s = String(line || "").trim();
        if (!s) continue;
        try {
          const row = JSON.parse(s);
          if (row && typeof row === "object") rows.push(row);
        } catch (_) {}
      }
      return rows;
    } catch (_) {
      return [];
    }
  }
  const usageCache = {
    items: null,
    loadedAt: 0,
    lastError: "",
    loading: false
  };

  function isPlacementLikeRow(rec) {
    if (!rec || typeof rec !== "object") return false;
    return !!(
      asText(rec.layoutRunId) ||
      asText(rec.fragmentId) ||
      asText(rec.rotationDeg) ||
      asText(rec.offsetXmm) ||
      asText(rec.offsetYmm) ||
      asText(rec.resultContourSnapshot)
    );
  }

  function usageRowToPieceHistoryRow(rec) {
    return {
      sourceTable: "LayoutRunScrapPlacement",
      transType: "Place",
      transAt: asText(rec.ts),
      ts: asText(rec.ts),
      action: "Place",
      statusBefore: "",
      statusAfter: "",
      sourceRef: "LayoutRunScrapPlacement",
      userName: "",
      layoutRunId: asText(rec.layoutRunId),
      fragmentId: asText(rec.fragmentId),
      zoneId: asText(rec.zoneId || rec.zone),
      rotationDeg: asText(rec.rotationDeg),
      offsetXmm: asText(rec.offsetXmm),
      offsetYmm: asText(rec.offsetYmm),
      resultContourSnapshot: asText(rec.resultContourSnapshot),
      note: ""
    };
  }

  function buildUsageDiag(source, durationMs, extra = {}) {
    return {
      source,
      durationMs: Number(durationMs || 0),
      ...extra
    };
  }

  function loadPieceHistoryById(pieceId, inventoryTag) {
    const id = String(pieceId || "").trim();
    if (!id) return { ok: false, error: "piece_id_required" };
    const cachedItems = readHistoryCache(id, inventoryTag);
    if (cachedItems) {
      return {
        ok: true,
        items: cachedItems,
        cache: { cached: true, ttlMs: HISTORY_CACHE_TTL_SAFE_MS },
        diag: { source: "history_cache", copyMs: 0, scriptMs: 0, parseMs: 0 }
      };
    }
    const readerPath = path.join(ROOT_DIR, "scripts", "access_read_piece_history.js");
    const tScript0 = Date.now();
    const exec = runReaderViaTempDbCopy(readerPath, [id, String(inventoryTag || "")], { timeoutMs: PIECE_READER_TIMEOUT_MS });
    const scriptMs = Date.now() - tScript0;
    const source = String(exec?.__diag?.source || "unknown");
    const copyMs = Number(exec?.__diag?.copyMs || 0);
    if (exec.run.error) {
      return { ok: false, error: `history_run_failed: ${exec.run.error.message}`, diag: { source, copyMs, scriptMs, parseMs: 0 } };
    }
    if (exec.run.status !== 0) {
      return { ok: false, error: `history_exit_${exec.run.status}`, stdout: exec.stdout, stderr: exec.stderr, diag: { source, copyMs, scriptMs, parseMs: 0 } };
    }
    const tParse0 = Date.now();
    try {
      const json = parseScriptJson(exec.stdout || "{}");
      if (!json.ok) return { ok: false, error: json.error || "history_not_ok", stdout: exec.stdout, diag: { source, copyMs, scriptMs, parseMs: Date.now() - tParse0 } };
      const rawItems = Array.isArray(json.items) ? json.items : [];
      const mappedItems = rawItems.map((it) => {
        const rec = (it && typeof it === "object") ? it : {};
        const sourceRefRaw = asText(rec.sourceRef || rec.sourceTable);
        const sourceRef = sourceRefRaw.toLowerCase() === "react-ui" ? "React_ScrapPieceCard" : sourceRefRaw;
        return {
          sourceTable: asText(rec.sourceTable),
          transType: asText(rec.transType || rec.action),
          transAt: asText(rec.transAt || rec.ts),
          ts: asText(rec.ts || rec.transAt),
          action: asText(rec.action || rec.transType),
          statusBefore: asText(rec.statusBefore),
          statusAfter: asText(rec.statusAfter),
          sourceRef,
          userName: asText(rec.userName),
          layoutRunId: asText(rec.layoutRunId || rec.layoutId || rec.runId),
          fragmentId: asText(rec.fragmentId || rec.fragment),
          zoneId: asText(rec.zoneId || rec.zone),
          rotationDeg: asText(rec.rotationDeg || rec.rotation || rec.rotateDeg),
          offsetXmm: asText(rec.offsetXmm || rec.offsetX || rec.shiftXmm),
          offsetYmm: asText(rec.offsetYmm || rec.offsetY || rec.shiftYmm),
          resultContourSnapshot: asText(rec.resultContourSnapshot || rec.resultContour || rec.contourSnapshot),
          note: asText(rec.note)
        };
      });

      let items = mappedItems;
      const tag = asText(inventoryTag);
      if (tag) {
        const usage = loadUsageHistoryAll(false);
        if (usage.ok && Array.isArray(usage.items)) {
          const usageRows = usage.items
            .filter((u) => asText(u.inventoryTag) === tag)
            .map(usageRowToPieceHistoryRow);
          if (usageRows.length > 0) {
            const nonPlacement = mappedItems.filter((row) => !isPlacementLikeRow(row));
            items = nonPlacement.concat(usageRows);
            items.sort((a, b) => asText(b.ts || b.transAt).localeCompare(asText(a.ts || a.transAt)));
          }
        }
      }

      writeHistoryCache(id, inventoryTag, items);
      return { ok: true, items, diag: { source, copyMs, scriptMs, parseMs: Date.now() - tParse0 } };
    } catch (e) {
      return { ok: false, error: `history_parse_failed: ${e.message}`, stdout: exec.stdout, diag: { source, copyMs, scriptMs, parseMs: Date.now() - tParse0 } };
    }
  }

  function loadUsageHistoryAll(force = false) {
    const now = Date.now();
    const t0 = Date.now();
    const fresh = !!(
      Array.isArray(usageCache.items) &&
      usageCache.loadedAt > 0 &&
      (now - usageCache.loadedAt) < HISTORY_CACHE_TTL_SAFE_MS
    );
    if (!force && fresh) {
      const ageMs = now - usageCache.loadedAt;
      console.log(`[ui-lab] usage_history branch=cache_fresh ageMs=${ageMs} ttlMs=${HISTORY_CACHE_TTL_SAFE_MS}`);
      return {
        ok: true,
        items: usageCache.items,
        cache: { cached: true, ageMs, ttlMs: HISTORY_CACHE_TTL_SAFE_MS },
        diag: buildUsageDiag("history_cache", Date.now() - t0, { ageMs, ttlMs: HISTORY_CACHE_TTL_SAFE_MS })
      };
    }
    if (!force && Array.isArray(usageCache.items) && usageCache.loadedAt > 0 && !usageCache.loading) {
      const ageMs = now - usageCache.loadedAt;
      console.log(`[ui-lab] usage_history branch=cache_stale_refreshing ageMs=${ageMs} ttlMs=${HISTORY_CACHE_TTL_SAFE_MS}`);
      setImmediate(() => {
        try {
          loadUsageHistoryAll(true);
        } catch (_) {}
      });
      return {
        ok: true,
        items: usageCache.items,
        cache: {
          cached: true,
          stale: true,
          refreshing: true,
          ageMs,
          ttlMs: HISTORY_CACHE_TTL_SAFE_MS
        },
        diag: buildUsageDiag("history_stale_refreshing", Date.now() - t0, { ageMs, ttlMs: HISTORY_CACHE_TTL_SAFE_MS })
      };
    }
    if (usageCache.loading && Array.isArray(usageCache.items) && !force) {
      const ageMs = now - usageCache.loadedAt;
      console.log(`[ui-lab] usage_history branch=cache_busy ageMs=${ageMs} ttlMs=${HISTORY_CACHE_TTL_SAFE_MS}`);
      return {
        ok: true,
        items: usageCache.items,
        cache: {
          cached: true,
          busy: true,
          ageMs,
          ttlMs: HISTORY_CACHE_TTL_SAFE_MS
        },
        diag: buildUsageDiag("history_cache_busy", Date.now() - t0, { ageMs, ttlMs: HISTORY_CACHE_TTL_SAFE_MS })
      };
    }

    usageCache.loading = true;
    console.log(`[ui-lab] usage_history branch=live force=${force ? 1 : 0} ttlMs=${HISTORY_CACHE_TTL_SAFE_MS}`);
    const readerPath = path.join(ROOT_DIR, "scripts", "access_read_usage_history.js");
    const tScript0 = Date.now();
    const exec = runReaderWithFallback(readerPath, [DB_PATH], { timeoutMs: 12000 });
    const scriptMs = Date.now() - tScript0;
    usageCache.loading = false;
    if (exec.run.error) {
      usageCache.lastError = `usage_history_run_failed: ${exec.run.error.message}`;
      if (Array.isArray(usageCache.items) && usageCache.items.length > 0) {
        const ageMs = now - usageCache.loadedAt;
        console.warn(`[ui-lab] usage_history branch=stale_fallback err=${usageCache.lastError}`);
        return {
          ok: true,
          items: usageCache.items,
          cache: {
            cached: true,
            stale: true,
            ageMs,
            ttlMs: HISTORY_CACHE_TTL_SAFE_MS,
            error: usageCache.lastError
          },
          diag: buildUsageDiag("history_stale", Date.now() - t0, { ageMs, ttlMs: HISTORY_CACHE_TTL_SAFE_MS, scriptMs })
        };
      }
      return { ok: false, error: `usage_history_run_failed: ${exec.run.error.message}` };
    }
    if (exec.run.status !== 0) {
      usageCache.lastError = `usage_history_exit_${exec.run.status}`;
      if (Array.isArray(usageCache.items) && usageCache.items.length > 0) {
        const ageMs = now - usageCache.loadedAt;
        console.warn(`[ui-lab] usage_history branch=stale_fallback err=${usageCache.lastError}`);
        return {
          ok: true,
          items: usageCache.items,
          cache: {
            cached: true,
            stale: true,
            ageMs,
            ttlMs: HISTORY_CACHE_TTL_SAFE_MS,
            error: usageCache.lastError
          },
          diag: buildUsageDiag("history_stale", Date.now() - t0, { ageMs, ttlMs: HISTORY_CACHE_TTL_SAFE_MS, scriptMs })
        };
      }
      return { ok: false, error: `usage_history_exit_${exec.run.status}`, stdout: exec.stdout, stderr: exec.stderr };
    }
    const tParse0 = Date.now();
    try {
      const json = parseScriptJson(exec.stdout || "{}");
      if (!json.ok) {
        usageCache.lastError = json.error || "usage_history_not_ok";
        if (Array.isArray(usageCache.items) && usageCache.items.length > 0) {
          const ageMs = now - usageCache.loadedAt;
          console.warn(`[ui-lab] usage_history branch=stale_fallback err=${usageCache.lastError}`);
          return {
            ok: true,
            items: usageCache.items,
            cache: {
              cached: true,
              stale: true,
              ageMs,
              ttlMs: HISTORY_CACHE_TTL_SAFE_MS,
              error: usageCache.lastError
            },
            diag: buildUsageDiag("history_stale", Date.now() - t0, { ageMs, ttlMs: HISTORY_CACHE_TTL_SAFE_MS, scriptMs })
          };
        }
        return { ok: false, error: json.error || "usage_history_not_ok", stdout: exec.stdout };
      }
      const rawItems = Array.isArray(json.items) ? json.items : [];
      const accessItems = rawItems.map((it) => {
        const rec = (it && typeof it === "object") ? it : {};
        return {
          inventoryTag: asText(rec.inventoryTag),
          layoutRunId: asText(rec.layoutRunId || rec.runId),
          fragmentId: asText(rec.fragmentId || rec.fragment),
          zoneId: asText(rec.zoneId || rec.zone),
          rotationDeg: asText(rec.rotationDeg || rec.rotation),
          offsetXmm: asText(rec.offsetXmm || rec.offsetX),
          offsetYmm: asText(rec.offsetYmm || rec.offsetY),
          resultContourSnapshot: asText(rec.resultContourSnapshot),
          ts: asText(rec.ts || rec.startedAt),
          source: "access_db"
        };
      });
      const manualRows = readManualPlacementRows();
      const manualItems = manualRows.map((rec) => ({
        inventoryTag: asText(rec.inventoryTag),
        layoutRunId: asText(rec.runRef || rec.layoutRunId),
        fragmentId: asText(rec.id),
        zoneId: asText(rec.zoneRef || rec.zoneId),
        rotationDeg: asText(rec.rotationDeg),
        offsetXmm: asText(rec.offsetXmm),
        offsetYmm: asText(rec.offsetYmm),
        resultContourSnapshot: asText(rec.resultContourSnapshot),
        ts: asText(rec.ts),
        source: "manual_web"
      }));
      const items = accessItems.concat(manualItems)
        .sort((a, b) => asText(b.ts).localeCompare(asText(a.ts)));
      usageCache.items = items;
      usageCache.loadedAt = Date.now();
      usageCache.lastError = "";
      const parseMs = Date.now() - tParse0;
      console.log(`[ui-lab] usage_history branch=live_ok rows=${items.length} scriptMs=${scriptMs} parseMs=${parseMs}`);
      return {
        ok: true,
        items,
        cache: { cached: false, scriptMs, parseMs, ttlMs: HISTORY_CACHE_TTL_SAFE_MS },
        diag: buildUsageDiag("history_live", Date.now() - t0, { scriptMs, parseMs, ttlMs: HISTORY_CACHE_TTL_SAFE_MS })
      };
    } catch (e) {
      usageCache.lastError = `usage_history_parse_failed: ${e.message}`;
      if (Array.isArray(usageCache.items) && usageCache.items.length > 0) {
        const ageMs = now - usageCache.loadedAt;
        console.warn(`[ui-lab] usage_history branch=stale_fallback err=${usageCache.lastError}`);
        return {
          ok: true,
          items: usageCache.items,
          cache: {
            cached: true,
            stale: true,
            ageMs,
            ttlMs: HISTORY_CACHE_TTL_SAFE_MS,
            error: usageCache.lastError
          },
          diag: buildUsageDiag("history_stale", Date.now() - t0, { ageMs, ttlMs: HISTORY_CACHE_TTL_SAFE_MS, scriptMs })
        };
      }
      return { ok: false, error: `usage_history_parse_failed: ${e.message}`, stdout: exec.stdout };
    }
  }

  return {
    loadPieceHistoryById,
    loadUsageHistoryAll
  };
}

module.exports = {
  createHistoryService
};
