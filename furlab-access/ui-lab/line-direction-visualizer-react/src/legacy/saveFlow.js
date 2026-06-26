function nowMs() {
  return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
}

export function buildRetryPayloadLight(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const next = { ...payload };
  if (Object.prototype.hasOwnProperty.call(next, "sourceImage")) {
    delete next.sourceImage;
  }
  if (next.metrics && typeof next.metrics === "object") {
    next.metrics = { ...next.metrics, sourceImageUploadRequested: false, retryLightPayload: true };
  }
  return next;
}

export function jsonBodySizeKb(bodyString) {
  const bytes = new TextEncoder().encode(String(bodyString || "")).length;
  return Math.max(0, Math.round((bytes / 1024) * 10) / 10);
}

export async function postSavePayload(apiFetch, payload, confirmOverwrite, opts = {}) {
  const body = { ...payload, confirmOverwrite: !!confirmOverwrite };
  if (opts && opts.skipExistsCheck === true && typeof opts.existsKnown === "boolean") {
    body.skipExistsCheck = true;
    body.existsKnown = !!opts.existsKnown;
  }
  const bodyRaw = JSON.stringify(body);
  const bodyKb = jsonBodySizeKb(bodyRaw);
  const t0 = nowMs();
  const { res } = await apiFetch("/api/save-scrap-piece", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bodyRaw,
    signal: opts.signal
  });
  const t1 = nowMs();
  const json = await res.json().catch(() => ({}));
  const t2 = nowMs();
  const timings = {
    requestMs: Math.max(0, Math.round(t1 - t0)),
    jsonMs: Math.max(0, Math.round(t2 - t1)),
    totalMs: Math.max(0, Math.round(t2 - t0))
  };

  if (res.status === 409 || json.error === "already_exists") {
    return { ok: false, exists: true, error: "already_exists", data: json, timings, bodyKb };
  }
  if (res.status === 404 || res.status === 405) {
    return {
      ok: false,
      exists: false,
      error: "api_not_found_or_method_not_allowed",
      data: json,
      timings,
      bodyKb
    };
  }
  if (!res.ok || !json.ok) {
    return { ok: false, exists: false, error: json.error || `HTTP ${res.status}`, data: json, timings, bodyKb };
  }
  return { ok: true, exists: false, data: json, timings, bodyKb };
}

export async function precheckInventoryTagExists(apiFetch, inventoryTag, opts = {}) {
  const tag = String(inventoryTag || "").trim();
  if (!tag) return { ok: false, exists: false, error: "inventoryTag_required", timings: { totalMs: 0 } };
  const t0 = nowMs();
  try {
    const safeTag = encodeURIComponent(tag);
    const { res } = await apiFetch(`/api/piece-exists?inventoryTag=${safeTag}`, { method: "GET", signal: opts.signal });
    const json = await res.json().catch(() => ({}));
    const t1 = nowMs();
    const totalMs = Math.max(0, Math.round(t1 - t0));
    if (res.ok && json && json.ok && typeof json.exists === "boolean") {
      return {
        ok: true,
        exists: !!json.exists,
        requestId: json.requestId || "",
        timings: {
          totalMs,
          existsMs: Number(json?.diag?.existsMs || 0)
        }
      };
    }
    return { ok: false, exists: false, error: json.error || `HTTP ${res.status}`, timings: { totalMs } };
  } catch (e) {
    const t1 = nowMs();
    const totalMs = Math.max(0, Math.round(t1 - t0));
    return { ok: false, exists: false, error: e?.message || String(e || "precheck_failed"), timings: { totalMs } };
  }
}

export async function runSaveFlow(apiFetch, payload, opts = {}) {
  const signal = opts.signal;
  const askOverwrite = typeof opts.askOverwrite === "function"
    ? opts.askOverwrite
    : async () => true;

  let precheckMs = 0;
  let precheckExistsMs = 0;
  let precheckExists = null;

  const precheck = await precheckInventoryTagExists(apiFetch, payload.inventoryTag, { signal });
  precheckMs = precheck?.timings?.totalMs || 0;
  precheckExistsMs = precheck?.timings?.existsMs || 0;
  if (precheck.ok) {
    precheckExists = !!precheck.exists;
  }

  let forceOverwrite = false;
  if (precheckExists === true) {
    const confirmed = await askOverwrite(payload.inventoryTag);
    if (!confirmed) {
      return {
        ok: false,
        cancelled: true,
        reason: "user_cancelled_overwrite",
        precheckMs,
        precheckExistsMs,
        precheckExists,
        firstBodyKb: 0,
        retryBodyKb: 0,
        firstAttemptRequestMs: 0,
        firstAttemptJsonMs: 0,
        firstAttemptMs: 0,
        retryAttemptRequestMs: 0,
        retryAttemptJsonMs: 0,
        retryAttemptMs: 0,
        retryUsed: false,
        saveResult: null,
      };
    }
    forceOverwrite = true;
  }

  const hasExistsHint = precheckExists === true || precheckExists === false;
  let saveResult = await postSavePayload(apiFetch, payload, forceOverwrite, {
    signal,
    skipExistsCheck: hasExistsHint,
    existsKnown: hasExistsHint ? !!precheckExists : undefined,
  });

  const firstAttemptRequestMs = saveResult?.timings?.requestMs || 0;
  const firstAttemptJsonMs = saveResult?.timings?.jsonMs || 0;
  const firstAttemptMs = saveResult?.timings?.totalMs || 0;
  const firstBodyKb = saveResult?.bodyKb || 0;

  let retryAttemptRequestMs = 0;
  let retryAttemptJsonMs = 0;
  let retryAttemptMs = 0;
  let retryBodyKb = 0;
  let retryUsed = false;

  if (saveResult.exists) {
    const confirmed = await askOverwrite(payload.inventoryTag);
    if (!confirmed) {
      return {
        ok: false,
        cancelled: true,
        reason: "user_cancelled_overwrite",
        precheckMs,
        precheckExistsMs,
        precheckExists,
        firstBodyKb,
        retryBodyKb,
        firstAttemptRequestMs,
        firstAttemptJsonMs,
        firstAttemptMs,
        retryAttemptRequestMs,
        retryAttemptJsonMs,
        retryAttemptMs,
        retryUsed,
        saveResult,
      };
    }
    const retryPayload = buildRetryPayloadLight(payload);
    saveResult = await postSavePayload(apiFetch, retryPayload, true, {
      signal,
      skipExistsCheck: true,
      existsKnown: true,
    });
    retryAttemptRequestMs = saveResult?.timings?.requestMs || 0;
    retryAttemptJsonMs = saveResult?.timings?.jsonMs || 0;
    retryAttemptMs = saveResult?.timings?.totalMs || 0;
    retryBodyKb = saveResult?.bodyKb || 0;
    retryUsed = true;
  }

  return {
    ok: !!saveResult?.ok,
    cancelled: false,
    reason: "",
    precheckMs,
    precheckExistsMs,
    precheckExists,
    firstBodyKb,
    retryBodyKb,
    firstAttemptRequestMs,
    firstAttemptJsonMs,
    firstAttemptMs,
    retryAttemptRequestMs,
    retryAttemptJsonMs,
    retryAttemptMs,
    retryUsed,
    saveResult,
  };
}

export function buildSaveUiReport(flow, payload, opts = {}) {
  const prepMs = Number(opts.prepMs || 0);
  const totalMs = Number(opts.totalMs || 0);
  const prevText = String(opts.prevText || "");

  if (flow?.cancelled) {
    return {
      ok: false,
      cancelled: true,
      statusKind: "warn",
      statusMessage: "Сохранение отменено.",
      outputText: `${prevText}\n\nСохранение отменено: запись уже существует.`,
      logLevel: "info",
      logData: { cancelled: true, reason: flow.reason || "user_cancelled_overwrite" }
    };
  }

  const saveResult = flow?.saveResult || { ok: false, error: flow?.reason || "save_failed", data: {} };
  const precheckMs = Number(flow?.precheckMs || 0);
  const precheckExistsMs = Number(flow?.precheckExistsMs || 0);
  const precheckExists = flow?.precheckExists;
  const firstAttemptRequestMs = Number(flow?.firstAttemptRequestMs || 0);
  const firstAttemptJsonMs = Number(flow?.firstAttemptJsonMs || 0);
  const firstAttemptMs = Number(flow?.firstAttemptMs || 0);
  const firstBodyKb = Number(flow?.firstBodyKb || 0);
  const retryAttemptRequestMs = Number(flow?.retryAttemptRequestMs || 0);
  const retryAttemptJsonMs = Number(flow?.retryAttemptJsonMs || 0);
  const retryAttemptMs = Number(flow?.retryAttemptMs || 0);
  const retryBodyKb = Number(flow?.retryBodyKb || 0);
  const retryUsed = !!flow?.retryUsed;
  const saveNetMs = firstAttemptMs + retryAttemptMs;
  const retryPart = retryAttemptMs > 0 ? ` | retry ${retryAttemptMs} мс` : "";
  const precheckPart = precheckMs > 0 ? `precheck ${precheckMs} мс${precheckExistsMs > 0 ? ` (exists ${precheckExistsMs})` : ""} | ` : "";
  const bodyLine = `\nBody: ${firstBodyKb} KB${retryUsed ? ` | retryBody: ${retryBodyKb} KB` : ""} | retry: ${retryUsed ? "yes" : "no"}`;
  const timingsLine = `\nВремя: prepare ${prepMs} мс | ${precheckPart}save ${saveNetMs} мс${retryPart} | total ${totalMs} мс`;
  const saveDiagLine = formatSaveDebugDetails(saveResult.data || {});

  if (!saveResult.ok) {
    const uiError = toSaveUiErrorMessage(saveResult.error);
    const errMeta = saveResult.data && typeof saveResult.data === "object" ? saveResult.data : {};
    return {
      ok: false,
      cancelled: false,
      statusKind: "error",
      statusMessage: `Ошибка: ${uiError}`,
      outputText: `${prevText}\n\nОшибка сохранения в Access: ${uiError}${timingsLine}${bodyLine}${saveDiagLine}`,
      logLevel: "warn",
      logData: {
        error: saveResult.error,
        uiError,
        prepMs,
        precheckMs,
        precheckExistsMs,
        precheckExists,
        bodyKb: firstBodyKb,
        retryBodyKb,
        retryUsed,
        attempt1RequestMs: firstAttemptRequestMs,
        attempt1JsonMs: firstAttemptJsonMs,
        attempt1Ms: firstAttemptMs,
        retryRequestMs: retryAttemptRequestMs,
        retryJsonMs: retryAttemptJsonMs,
        retryMs: retryAttemptMs,
        totalMs,
        requestId: errMeta.requestId || "-",
        runnerOut: errMeta.runnerOut || "-",
        logPath: errMeta.logPath || "-",
        stdout: errMeta.stdout || "",
        stderr: errMeta.stderr || ""
      }
    };
  }

  const json = saveResult.data || {};
  return {
    ok: true,
    cancelled: false,
    statusKind: "success",
    statusMessage: "Запись успешна.",
    outputText: `${prevText}\n\nСохранено в Access.
Тег: ${payload?.inventoryTag || "-"}
Режим записи: ${json.writeMode || "-"}
БД: ${json.dbPath || "-"}
Лог: ${json.logPath || "-"}
Файл: ${json.sourceAssetRef || "(не сохранялся)"}${timingsLine}${bodyLine}${saveDiagLine}`,
    logLevel: "info",
    logData: {
      prepMs,
      precheckMs,
      precheckExistsMs,
      precheckExists,
      bodyKb: firstBodyKb,
      retryBodyKb,
      retryUsed,
      attempt1RequestMs: firstAttemptRequestMs,
      attempt1JsonMs: firstAttemptJsonMs,
      attempt1Ms: firstAttemptMs,
      retryRequestMs: retryAttemptRequestMs,
      retryJsonMs: retryAttemptJsonMs,
      retryMs: retryAttemptMs,
      totalMs,
      requestId: json.requestId || "-",
      runnerOut: json.runnerOut || "-",
      logPath: json.logPath || "-"
    }
  };
}

export function formatSaveDebugDetails(json) {
  if (!json || typeof json !== "object") return "";
  const requestId = json.requestId || "-";
  const runnerOut = json.runnerOut || "-";
  const logPath = json.logPath || "-";
  const diag = json.diag && typeof json.diag === "object" ? json.diag : {};
  const runner = diag.runner && typeof diag.runner === "object" ? diag.runner : {};
  return `\nrequestId: ${requestId}\nrunnerOut: ${runnerOut}\nlogPath: ${logPath}\ndiag: exists ${Number(diag.existsMs || 0)} (${diag.existsSource || "-"}) | status ${Number(diag.statusCheckMs || 0)} | sourceSave ${Number(diag.sourceSaveMs || 0)} | sqlBuild ${Number(diag.sqlBuildMs || 0)} | sqlRun ${Number(diag.sqlRunMs || 0)} | total ${Number(diag.totalMs || 0)}\ndiag.runner: ${runner.engine || "-"} | open ${Number(runner.openMs || 0)} | exec ${Number(runner.execMs || 0)} | close ${Number(runner.closeMs || 0)}`;
}

export function toSaveUiErrorMessage(errorCode) {
  const code = String(errorCode || "").trim();
  if (!code) return "unknown_error";
  if (/^exists_check_exit_\d+$/i.test(code)) {
    return `${code} (backend: inventoryTag exists check failed)`;
  }
  if (/^exists_check_failed:/i.test(code)) {
    return `${code} (backend: exists-check runner unavailable)`;
  }
  if (code === "api_not_found_or_method_not_allowed") {
    return "API save endpoint is unavailable (use backend server, not static host)";
  }
  return code;
}
