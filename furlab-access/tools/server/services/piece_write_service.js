"use strict";
const { normalizeStatus, canOverwriteStatus } = require("./status_rules");

const INVENTORY_TAG_RX = /^FL-SCR-[0-9]{6}$/i;

function createPieceWriteService(deps) {
  const {
    DB_PATH,
    ROOT_DIR,
    fs,
    path,
    crypto,
    accessText,
    accessNumber,
    accessDateNowLiteral,
    accessGuid,
    writeTempSql,
    writeTempJson,
    runCscript,
    runReaderWithFallback,
    parseScriptJson,
    saveUploadedSourceImage,
    invalidateRegistryCache,
    invalidatePieceCacheById,
    invalidateHistoryCacheByPieceId,
    loadPieceById
  } = deps;

  function parseSqlRunnerOut(text) {
    const out = String(text || "");
    const readNum = (name) => {
      const m = out.match(new RegExp(`${name}=(-?\\d+)`, "i"));
      return m ? Number(m[1]) : null;
    };
    const engineMatch = out.match(/ENGINE=([a-z_]+)/i);
    return {
      engine: engineMatch ? String(engineMatch[1] || "").toLowerCase() : "",
      ok: readNum("OK"),
      err: readNum("ERR"),
      openMs: readNum("openMs"),
      execMs: readNum("execMs"),
      closeMs: readNum("closeMs")
    };
  }

  function checkInventoryTagExists(inventoryTag) {
    const checkerPath = path.join(ROOT_DIR, "scripts", "access_inventory_exists.js");
    const exec = runReaderWithFallback(checkerPath, [DB_PATH, inventoryTag], { timeoutMs: 5000 });
    if (exec.run.error) {
      return { ok: false, error: `exists_check_failed: ${exec.run.error.message}` };
    }
    if (exec.run.status !== 0) {
      return { ok: false, error: `exists_check_exit_${exec.run.status}`, stdout: exec.stdout, stderr: exec.stderr };
    }
    const out = String(exec.stdout || "").replace(/^\uFEFF/, "").trim();

    if (out.startsWith("{")) {
      try {
        const json = parseScriptJson(out);
        if (typeof json.exists === "boolean") {
          return { ok: true, exists: json.exists };
        }
        if (json && typeof json.count === "number") {
          return { ok: true, exists: Number(json.count) > 0 };
        }
      } catch (_) {}
    }

    const m = out.match(/EXISTS\s*=\s*(\d+)/i);
    if (m) return { ok: true, exists: Number(m[1]) > 0 };

    return { ok: false, error: "exists_check_parse_failed", stdout: exec.stdout };
  }

  function inventoryTagExists(inventoryTag) {
    const tag = String(inventoryTag || "").trim();
    if (!tag) return { ok: false, error: "inventoryTag_required" };
    if (!INVENTORY_TAG_RX.test(tag)) return { ok: false, error: "inventoryTag_invalid_format" };
    const t0 = Date.now();
    const result = checkInventoryTagExists(tag);
    return {
      ...result,
      inventoryTag: tag,
      diag: {
        existsMs: Date.now() - t0
      }
    };
  }

  function buildPieceSql(payload, exists) {
    const now = accessDateNowLiteral();
    const id = `{${crypto.randomUUID().toUpperCase()}}`;
    const inventoryTag = String(payload.inventoryTag || "").trim();
    const scrapContourJson = JSON.stringify(payload.scrapContour || {});
    const metricsJson = JSON.stringify(payload.metrics || {});
    const userNote = String(payload.note ?? payload.metrics?.note ?? "").trim();
    const note = userNote;
    const materialIdSql = accessGuid(payload.materialId);
    const storageLocationIdSql = accessGuid(payload.storageLocationId);
    const scrapQuality = String(payload.scrapQuality || payload.metrics?.scrapQuality || "Good").trim() || "Good";
    const scrapStatus = String(payload.scrapStatus || payload.metrics?.scrapStatus || "Available").trim() || "Available";

    const tagSql = accessText(inventoryTag);
    const contourSql = accessText(scrapContourJson);
    const metricsSql = accessText(metricsJson);
    const noteSql = accessText(note.slice(0, 255));
    const qualitySql = accessText(scrapQuality);
    const statusSql = accessText(scrapStatus);
    const napSql = accessNumber(payload.napDirectionDeg);
    const areaSql = accessNumber(payload.areaMm2);
    const bwSql = accessNumber(payload.bboxWidthMm);
    const bhSql = accessNumber(payload.bboxHeightMm);
    const maxSpanSql = accessNumber(payload.maxSpanMm);

    if (exists) {
      return `
UPDATE ScrapPiece
SET
  materialId=${materialIdSql},
  storageLocationId=${storageLocationIdSql},
  scrapContour=${contourSql},
  napDirectionDeg=${napSql},
  areaMm2=${areaSql},
  bboxWidthMm=${bwSql},
  bboxHeightMm=${bhSql},
  maxSpanMm=${maxSpanSql},
  scrapQuality=${qualitySql},
  scrapStatus=${statusSql},
  [note]=${noteSql},
  metricsJson=${metricsSql},
  updatedAt=${now}
WHERE inventoryTag=${tagSql};
`.trim();
    }

    return `
INSERT INTO ScrapPiece (
  id,
  inventoryTag,
  materialId,
  storageLocationId,
  scrapContour,
  napDirectionDeg,
  areaMm2,
  bboxWidthMm,
  bboxHeightMm,
  maxSpanMm,
  scrapQuality,
  scrapStatus,
  [note],
  createdAt,
  updatedAt,
  metricsJson
)
VALUES (
  ${accessText(id)},
  ${tagSql},
  ${materialIdSql},
  ${storageLocationIdSql},
  ${contourSql},
  ${napSql},
  ${areaSql},
  ${bwSql},
  ${bhSql},
  ${maxSpanSql},
  ${qualitySql},
  ${statusSql},
  ${noteSql},
  ${now},
  ${now},
  ${metricsSql}
);
`.trim();
  }

  function saveScrapPiece(payload) {
    const t0 = Date.now();
    const phase = {
      existsMs: 0,
      statusCheckMs: 0,
      sourceSaveMs: 0,
      sqlBuildMs: 0,
      sqlRunMs: 0,
      totalMs: 0
    };
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "payload_required" };
    }
    const inventoryTag = String(payload.inventoryTag || "").trim();
    const confirmOverwrite = !!payload.confirmOverwrite;
    const skipExistsCheck = payload.skipExistsCheck === true;
    const existsKnown = typeof payload.existsKnown === "boolean" ? payload.existsKnown : null;
    const scrapQuality = String(payload.scrapQuality || payload.metrics?.scrapQuality || "Good").trim();
    const scrapStatus = String(payload.scrapStatus || payload.metrics?.scrapStatus || "Available").trim();
    const note = String(payload.note ?? payload.metrics?.note ?? "").trim();
    if (!inventoryTag) {
      return { ok: false, error: "inventoryTag_required" };
    }
    if (!INVENTORY_TAG_RX.test(inventoryTag)) {
      return { ok: false, error: "inventoryTag_invalid_format" };
    }
    if (!/^(Good|Limited)$/i.test(scrapQuality)) {
      return { ok: false, error: "scrapQuality_invalid" };
    }
    if (!/^(Available|Reserved|Used|Discarded)$/i.test(scrapStatus)) {
      return { ok: false, error: "scrapStatus_invalid" };
    }
    if (/^Limited$/i.test(scrapQuality) && !note) {
      return { ok: false, error: "note_required_for_limited" };
    }
    if (!fs.existsSync(DB_PATH)) {
      return { ok: false, error: `db_not_found: ${DB_PATH}` };
    }
    let exists = null;
    let existsSource = "db";
    if (skipExistsCheck && existsKnown !== null) {
      exists = { ok: true, exists: existsKnown };
      phase.existsMs = 0;
      existsSource = "hint";
    } else {
      const tExists0 = Date.now();
      exists = checkInventoryTagExists(inventoryTag);
      phase.existsMs = Date.now() - tExists0;
    }
    if (!exists.ok) return exists;
    if (exists.exists && !confirmOverwrite) {
      phase.totalMs = Date.now() - t0;
      return {
        ok: false,
        error: "already_exists",
        exists: true,
        diag: {
          ...phase,
          existsSource
        }
      };
    }

    if (exists.exists) {
      const tStatus0 = Date.now();
      const current = loadPieceById(inventoryTag, { lite: true });
      phase.statusCheckMs = Date.now() - tStatus0;
      if (current && current.ok && current.item) {
        const currentStatus = normalizeStatus(current.item.scrapStatus);
        const nextStatus = normalizeStatus(scrapStatus);
        const check = canOverwriteStatus(currentStatus, nextStatus);
        if (!check.ok) {
          return {
            ok: false,
            error: check.error,
            currentStatus: currentStatus || current.item.scrapStatus || "",
            nextStatus
          };
        }
      }
    }

    let sourceAssetRef = null;
    if (payload.sourceImage && typeof payload.sourceImage === "object") {
      const tSource0 = Date.now();
      const saved = saveUploadedSourceImage(payload.sourceImage, inventoryTag);
      phase.sourceSaveMs = Date.now() - tSource0;
      if (!saved.ok) {
        return saved;
      }
      sourceAssetRef = saved.sourceAssetRef;
      payload.metrics = payload.metrics && typeof payload.metrics === "object" ? payload.metrics : {};
      payload.metrics.sourceAssetRef = sourceAssetRef;
      if (payload.scrapContour && typeof payload.scrapContour === "object") {
        payload.scrapContour.sourceAssetRef = sourceAssetRef;
      }
    }

    const tBuild0 = Date.now();
    const sqlText = buildPieceSql(payload, exists.exists);
    phase.sqlBuildMs = Date.now() - tBuild0;
    const { sqlPath, logPath } = writeTempSql(sqlText);
    const runnerPath = path.join(ROOT_DIR, "scripts", "run_access_sql_via_access.js");

    const tRun0 = Date.now();
    const exec = runCscript(runnerPath, [DB_PATH, sqlPath, logPath], {
      timeoutMs: 30000,
      unicode: false,
      encoding: "utf8"
    });
    phase.sqlRunMs = Date.now() - tRun0;
    phase.totalMs = Date.now() - t0;
    if (exec.run.error) {
      return { ok: false, error: `run_failed: ${exec.run.error.message}`, sqlPath, logPath, diag: phase };
    }
    if (exec.run.status !== 0) {
      return {
        ok: false,
        error: `access_runner_exit_${exec.run.status}`,
        stdout: exec.stdout,
        stderr: exec.stderr,
        sqlPath,
        logPath,
        diag: phase
      };
    }
    if (/ERR=\d+/i.test(exec.stdout)) {
      const m = exec.stdout.match(/ERR=(\d+)/i);
      if (m && Number(m[1]) > 0) {
        return {
          ok: false,
          error: `access_sql_errors_${m[1]}`,
          stdout: exec.stdout,
          logPath,
          sqlPath,
          diag: phase
        };
      }
    }
    invalidateRegistryCache();
    if (exists.exists) {
      // For overwrite keep card/history cache coherent.
      invalidatePieceCacheById(inventoryTag);
      invalidateHistoryCacheByPieceId(inventoryTag);
    }
    const runnerDiag = parseSqlRunnerOut(exec.stdout || "");
    return {
      ok: true,
      dbPath: DB_PATH,
      logPath,
      sqlPath,
      runnerOut: exec.stdout,
      sourceAssetRef,
      writeMode: exists.exists ? "update" : "insert",
      diag: {
        ...phase,
        existsSource,
        runner: runnerDiag
      }
    };
  }

  function updatePieceFields(pieceId, payload) {
    const id = String(pieceId || "").trim();
    if (!id) return { ok: false, error: "piece_id_required" };
    if (!payload || typeof payload !== "object") return { ok: false, error: "payload_required" };

    const scrapQuality = String(payload.scrapQuality || "").trim();
    const note = String(payload.note ?? "").trim();

    if (!scrapQuality) return { ok: false, error: "scrapQuality_required" };
    if (!/^(Good|Limited)$/i.test(scrapQuality)) return { ok: false, error: "scrapQuality_invalid" };
    if (/^Limited$/i.test(scrapQuality) && !note) return { ok: false, error: "note_required_for_limited" };
    if (!fs.existsSync(DB_PATH)) return { ok: false, error: `db_not_found: ${DB_PATH}` };

    const { jsonPath, logPath } = writeTempJson({
      pieceId: id,
      materialId: String(payload.materialId || ""),
      storageLocationId: String(payload.storageLocationId || ""),
      scrapQuality,
      note: note.slice(0, 255)
    });
    const runnerPath = path.join(ROOT_DIR, "scripts", "access_update_piece_fields.js");
    const exec = runCscript(runnerPath, [DB_PATH, jsonPath, logPath], {
      timeoutMs: 30000,
      unicode: false,
      encoding: "utf8"
    });
    if (exec.run.error) {
      return { ok: false, error: `run_failed: ${exec.run.error.message}`, jsonPath, logPath };
    }
    if (exec.run.status !== 0) {
      return {
        ok: false,
        error: `access_runner_exit_${exec.run.status}`,
        stdout: exec.stdout,
        stderr: exec.stderr,
        jsonPath,
        logPath
      };
    }
    if (/ERR=\d+/i.test(exec.stdout)) {
      const m = exec.stdout.match(/ERR=(\d+)/i);
      if (m && Number(m[1]) > 0) {
        return {
          ok: false,
          error: `access_sql_errors_${m[1]}`,
          stdout: exec.stdout,
          logPath,
          jsonPath
        };
      }
    }
    invalidateRegistryCache();
    invalidatePieceCacheById(pieceId);
    invalidateHistoryCacheByPieceId(pieceId);
    return { ok: true, dbPath: DB_PATH, jsonPath, logPath, runnerOut: exec.stdout };
  }

  function transitionPieceStatus(pieceId, action, payload) {
    const id = String(pieceId || "").trim();
    if (!id) return { ok: false, error: "piece_id_required" };
    const act = String(action || "").trim().toLowerCase();
    if (!/^(reserve|release|use)$/.test(act)) return { ok: false, error: "action_invalid" };
    const userName = String(payload?.userName || payload?.user || "react-ui").trim();
    const note = String(payload?.note || "").trim();

    const runnerPath = path.join(ROOT_DIR, "scripts", "access_transition_piece_status.js");
    const exec = runReaderWithFallback(runnerPath, [DB_PATH, id, act, userName, note], { timeoutMs: 20000 });

    function pickTransitionFields(json) {
      if (!json || typeof json !== "object") return {};
      const out = {};
      if (json.currentStatus !== undefined && json.currentStatus !== null && String(json.currentStatus).trim()) {
        out.currentStatus = String(json.currentStatus);
      }
      if (json.beforeStatus !== undefined && json.beforeStatus !== null && String(json.beforeStatus).trim()) {
        out.beforeStatus = String(json.beforeStatus);
      }
      if (json.afterStatus !== undefined && json.afterStatus !== null && String(json.afterStatus).trim()) {
        out.afterStatus = String(json.afterStatus);
      }
      return out;
    }

    if (exec.run.error) {
      return { ok: false, error: `transition_run_failed: ${exec.run.error.message}` };
    }
    if (exec.run.status !== 0) {
      try {
        const json = parseScriptJson(exec.stdout || "{}");
        if (json && json.error) {
          return {
            ok: false,
            error: String(json.error),
            ...pickTransitionFields(json),
            stdout: exec.stdout,
            stderr: exec.stderr
          };
        }
      } catch (_) {}
      return { ok: false, error: `transition_exit_${exec.run.status}`, stdout: exec.stdout, stderr: exec.stderr };
    }
    let json = {};
    try {
      json = parseScriptJson(exec.stdout || "{}");
    } catch (e) {
      return { ok: false, error: `transition_parse_failed: ${e.message}`, stdout: exec.stdout };
    }
    if (!exec.stdout || !String(exec.stdout).trim()) {
      return {
        ok: false,
        error: "transition_empty_output",
        hint: "script_returned_empty_stdout",
        stdout: exec.stdout,
        stderr: exec.stderr
      };
    }
    if (!json || !json.ok) {
      const err =
        (json && (json.error || json.reason || json.message))
          ? String(json.error || json.reason || json.message)
          : "transition_not_ok";
      return {
        ok: false,
        error: err,
        ...pickTransitionFields(json),
        details: json && typeof json === "object" ? json : null,
        stdout: exec.stdout,
        stderr: exec.stderr
      };
    }

    const resolvedPieceId = String(json.pieceId || "").trim();
    const resolvedTag = String(json.inventoryTag || "").trim();

    invalidateRegistryCache();
    invalidatePieceCacheById(id);
    invalidateHistoryCacheByPieceId(id);
    if (resolvedPieceId) {
      invalidatePieceCacheById(resolvedPieceId);
      invalidateHistoryCacheByPieceId(resolvedPieceId);
    }
    if (resolvedTag) {
      invalidatePieceCacheById(resolvedTag);
      invalidateHistoryCacheByPieceId(resolvedTag);
    }

    const reloadKey = resolvedPieceId || resolvedTag || id;
    const piece = loadPieceById(reloadKey, { force: true });
    if (!piece.ok) return { ok: false, error: piece.error || "piece_reload_failed", stdout: exec.stdout, stderr: exec.stderr };
    return {
      ok: true,
      action: act,
      beforeStatus: json.beforeStatus || "",
      afterStatus: json.afterStatus || "",
      item: piece.item
    };
  }

  return {
    inventoryTagExists,
    saveScrapPiece,
    updatePieceFields,
    transitionPieceStatus
  };
}

module.exports = {
  createPieceWriteService
};
