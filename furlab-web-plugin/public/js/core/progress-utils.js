// Extracted from app.js (inventory progress constants/helpers)
(function (global) {
  const SERVER_PREVIEW_PROGRESS_PHASES = [
    "\u0421\u0435\u0440\u0432\u0435\u0440 / \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430 \u0434\u0430\u043d\u043d\u044b\u0445",
    "\u0421\u0435\u0440\u0432\u0435\u0440 / \u0433\u0435\u043e\u043c\u0435\u0442\u0440\u0438\u044f \u0437\u043e\u043d\u044b",
    "\u0421\u0435\u0440\u0432\u0435\u0440 / \u0444\u0438\u043b\u044c\u0442\u0440\u0430\u0446\u0438\u044f \u043a\u0430\u043d\u0434\u0438\u0434\u0430\u0442\u043e\u0432",
    "\u0421\u0435\u0440\u0432\u0435\u0440 / \u0440\u0430\u0437\u043c\u0435\u0449\u0435\u043d\u0438\u0435 \u043a\u0443\u0441\u043a\u043e\u0432",
    "\u0421\u0435\u0440\u0432\u0435\u0440 / \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u043f\u043e\u043a\u0440\u044b\u0442\u0438\u044f",
    "\u0421\u0435\u0440\u0432\u0435\u0440 / \u0441\u0431\u043e\u0440 \u0434\u0438\u0430\u0433\u043d\u043e\u0441\u0442\u0438\u043a\u0438"
  ];

  const PHASE_RU = {
    placement_search_start: "\u0441\u0442\u0430\u0440\u0442 \u043f\u043e\u0438\u0441\u043a\u0430 \u0440\u0430\u0437\u043c\u0435\u0449\u0435\u043d\u0438\u044f",
    placement_search: "\u043f\u043e\u0438\u0441\u043a \u0440\u0430\u0437\u043c\u0435\u0449\u0435\u043d\u0438\u044f",
    placement_search_stall: "\u0437\u0430\u0441\u0442\u043e\u0439 \u0440\u0430\u0437\u043c\u0435\u0449\u0435\u043d\u0438\u044f",
    placement_search_done: "\u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u043f\u043e\u043a\u0440\u044b\u0442\u0438\u044f",
    legacy_fallback_start: "\u043f\u0435\u0440\u0435\u0445\u043e\u0434 \u043d\u0430 legacy fallback",
    legacy_fallback_skipped: "legacy fallback \u043f\u0440\u043e\u043f\u0443\u0449\u0435\u043d",
    placement_pass_start: "\u0441\u0442\u0430\u0440\u0442 \u043f\u0440\u043e\u0445\u043e\u0434\u0430 \u0440\u0430\u0437\u043c\u0435\u0449\u0435\u043d\u0438\u044f",
    placement_pass_exit: "\u0432\u044b\u0445\u043e\u0434 \u0438\u0437 \u043f\u0440\u043e\u0445\u043e\u0434\u0430 \u0440\u0430\u0437\u043c\u0435\u0449\u0435\u043d\u0438\u044f",
    placement_pass_end: "\u043a\u043e\u043d\u0435\u0446 \u043f\u0440\u043e\u0445\u043e\u0434\u0430 \u0440\u0430\u0437\u043c\u0435\u0449\u0435\u043d\u0438\u044f",
    piece_accepted: "\u043f\u0440\u0438\u043d\u044f\u0442 \u043a\u0443\u0441\u043e\u043a",
    local_improve_remove: "\u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e\u0435 \u0443\u043b\u0443\u0447\u0448\u0435\u043d\u0438\u0435: remove-one",
    local_improve_replace: "\u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e\u0435 \u0443\u043b\u0443\u0447\u0448\u0435\u043d\u0438\u0435: replace-one",
    local_improve_swap: "\u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e\u0435 \u0443\u043b\u0443\u0447\u0448\u0435\u043d\u0438\u0435: swap-two",
    local_improve_done: "\u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e\u0435 \u0443\u043b\u0443\u0447\u0448\u0435\u043d\u0438\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u043e",
    server_prepare: "\u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430 \u0434\u0430\u043d\u043d\u044b\u0445",
    server_zone_geometry: "\u0433\u0435\u043e\u043c\u0435\u0442\u0440\u0438\u044f \u0437\u043e\u043d\u044b",
    server_candidate_filter: "\u0444\u0438\u043b\u044c\u0442\u0440\u0430\u0446\u0438\u044f \u043a\u0430\u043d\u0434\u0438\u0434\u0430\u0442\u043e\u0432",
    server_place: "\u0440\u0430\u0437\u043c\u0435\u0449\u0435\u043d\u0438\u0435 \u043a\u0443\u0441\u043a\u043e\u0432",
    server_coverage: "\u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u043f\u043e\u043a\u0440\u044b\u0442\u0438\u044f",
    server_diag: "\u0441\u0431\u043e\u0440 \u0434\u0438\u0430\u0433\u043d\u043e\u0441\u0442\u0438\u043a\u0438",
    done: "\u043e\u0442\u0432\u0435\u0442 \u0433\u043e\u0442\u043e\u0432"
  };

  const REASON_RU = {
    hard_timeout: "\u0436\u0435\u0441\u0442\u043a\u0438\u0439 \u0442\u0430\u0439\u043c\u0430\u0443\u0442",
    time_budget: "\u0438\u0441\u0447\u0435\u0440\u043f\u0430\u043d \u043b\u0438\u043c\u0438\u0442 \u0432\u0440\u0435\u043c\u0435\u043d\u0438",
    target_reached: "\u0446\u0435\u043b\u044c \u0434\u043e\u0441\u0442\u0438\u0433\u043d\u0443\u0442\u0430",
    residual_empty: "\u043e\u0441\u0442\u0430\u0442\u043e\u043a \u0437\u0430\u043a\u0440\u044b\u0442",
    no_ranked_templates: "\u043d\u0435\u0442 \u0440\u0430\u043d\u0436\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0445 \u0448\u0430\u0431\u043b\u043e\u043d\u043e\u0432",
    stall_hard: "\u0436\u0435\u0441\u0442\u043a\u0438\u0439 \u0437\u0430\u0441\u0442\u043e\u0439"
  };

  function formatDurationClock(ms) {
    const totalSec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  function createProgressToken() {
    return `p_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function buildProgressSignature(payload) {
    const p = payload && typeof payload === "object" ? payload : {};
    const ts = Number(p.ts);
    const sig = [
      Number.isFinite(ts) ? ts : "-",
      String(p.type || ""),
      String(p.phase || ""),
      String(p.title || ""),
      Number.isFinite(Number(p.iterations)) ? Number(p.iterations) : "-",
      Number.isFinite(Number(p.evaluated)) ? Number(p.evaluated) : "-",
      Number.isFinite(Number(p.pieces)) ? Number(p.pieces) : "-",
      Number.isFinite(Number(p.coverage)) ? Number(p.coverage).toFixed(4) : "-"
    ].join("|");
    return { ts, sig };
  }

  function isTelemetryEvent(payload) {
    const p = payload && typeof payload === "object" ? payload : {};
    return (
      Number.isFinite(Number(p.percent)) ||
      Number.isFinite(Number(p.iterations)) ||
      Number.isFinite(Number(p.evaluated)) ||
      p.phase !== undefined ||
      (p.type && String(p.type).toLowerCase() === "solver")
    );
  }

  function mergeMonotonicKpi(prevKpi, payload) {
    const p = payload && typeof payload === "object" ? payload : {};
    const prev = prevKpi && typeof prevKpi === "object" ? prevKpi : {};
    const nextPiecesRaw = Number(p.pieces);
    const nextCoverageRaw = Number(p.coverage);
    const nextUtilRaw = Number(p.utilization);
    const nextTailRaw = Number(p.tail);
    const nextItersRaw = Number(p.iters);
    const nextTempRaw = Number(p.temperature);
    return {
      pieces: Number.isFinite(nextPiecesRaw)
        ? Math.max(0, Math.max(Number(prev.pieces || 0), nextPiecesRaw))
        : prev.pieces,
      coverage: Number.isFinite(nextCoverageRaw)
        ? Math.max(0, Math.max(Number(prev.coverage || 0), nextCoverageRaw))
        : prev.coverage,
      utilization: Number.isFinite(nextUtilRaw)
        ? Math.max(0, Math.max(Number(prev.utilization || 0), nextUtilRaw))
        : prev.utilization,
      tail: Number.isFinite(nextTailRaw)
        ? Math.max(0, Math.max(Number(prev.tail || 0), nextTailRaw))
        : prev.tail,
      iters: Number.isFinite(nextItersRaw) ? Math.max(0, nextItersRaw) : prev.iters,
      temperature: Number.isFinite(nextTempRaw) ? nextTempRaw : prev.temperature
    };
  }

  function describeProgressEvent(payload, phaseRu, reasonRu) {
    const p = payload && typeof payload === "object" ? payload : {};
    const rej = p.rejected && typeof p.rejected === "object" ? p.rejected : {};
    const thr = p.thresholds && typeof p.thresholds === "object" ? p.thresholds : {};
    const phaseDict = phaseRu && typeof phaseRu === "object" ? phaseRu : PHASE_RU;
    const reasonDict = reasonRu && typeof reasonRu === "object" ? reasonRu : REASON_RU;
    const phaseRaw = String(p.phase || "-");
    const phaseLabel = phaseDict[phaseRaw] ? `${phaseRaw} (${phaseDict[phaseRaw]})` : phaseRaw;
    const reasonRaw = String(p.reason || "");
    const reasonLabel = reasonRaw
      ? (reasonDict[reasonRaw] ? `${reasonRaw} (${reasonDict[reasonRaw]})` : reasonRaw)
      : "";
    const lines = [
      `phase=${phaseLabel}`,
      reasonLabel ? `reason=${reasonLabel}` : "",
      Number.isFinite(Number(p.iterations)) ? `iter=${Number(p.iterations)}` : "",
      Number.isFinite(Number(p.evaluated)) ? `evaluated=${Number(p.evaluated)}` : "",
      Number.isFinite(Number(p.residualAreaMm2)) ? `residualMm2=${Number(p.residualAreaMm2).toFixed(1)}` : "",
      Number.isFinite(Number(p.pieceAreaMm2)) ? `pieceAreaMm2=${Number(p.pieceAreaMm2).toFixed(1)}` : "",
      Number.isFinite(Number(p.gainAreaMm2)) ? `gainMm2=${Number(p.gainAreaMm2).toFixed(1)}` : "",
      Number.isFinite(Number(p.overlapInsideMm2)) ? `overlapInsideMm2=${Number(p.overlapInsideMm2).toFixed(1)}` : "",
      Number.isFinite(Number(p.outsideMm2)) ? `outsideMm2=${Number(p.outsideMm2).toFixed(1)}` : "",
      Number.isFinite(Number(p.score)) ? `score=${Number(p.score).toFixed(3)}` : "",
      `rej.overlap/перекрытие=${Number(rej.overlap || 0)} rej.lowGain/малый_выигрыш=${Number(rej.lowGain || 0)} rej.oversize/крупный_кусок=${Number(rej.oversize || 0)} rej.outside/вне_зоны=${Number(rej.outside || 0)} rej.noFit/нет_подхода=${Number(rej.noFit || 0)}`,
      Number.isFinite(Number(thr.overlapHardLimit)) ? `thr.overlapHardLimit=${Number(thr.overlapHardLimit).toFixed(3)}` : "",
      Number.isFinite(Number(thr.dynamicMinGainCells)) ? `thr.minGainCells/мин_выигрыш_ячейки=${Number(thr.dynamicMinGainCells)}` : "",
      thr.phaseMode !== undefined ? `mode.phase=${String(thr.phaseMode)}` : "",
      thr.inTailPhase !== undefined ? `mode.tail=${!!thr.inTailPhase}` : "",
      thr.coverageFirst !== undefined ? `mode.coverageFirst=${!!thr.coverageFirst}` : ""
    ].filter(Boolean);
    const evaluated = Number.isFinite(Number(p.evaluated)) ? Number(p.evaluated) : 0;
    const evalBucket = Math.floor(evaluated / 5000);
    const shortLine = [
      phaseLabel,
      Number.isFinite(Number(p.iterations)) ? `iter=${Number(p.iterations)}` : "",
      Number.isFinite(Number(p.evaluated)) ? `eval=${Number(p.evaluated)}` : "",
      Number.isFinite(Number(p.coverage)) ? `cov=${Number(p.coverage).toFixed(2)}%` : "",
      Number.isFinite(Number(p.residualAreaMm2)) ? `res=${Number(p.residualAreaMm2).toFixed(0)}` : "",
      reasonLabel ? `reason=${reasonLabel}` : ""
    ].filter(Boolean).join(" | ");
    return { phaseRaw, reasonRaw, phaseLabel, reasonLabel, lines, evalBucket, shortLine };
  }

  function buildTraceProgressSnapshot(trace) {
    const t = trace && typeof trace === "object" ? trace : {};
    const cp = t.candidate_pool || {};
    const ps = t.placement_search || {};
    const rr = t.repair_repack || {};
    const sf = t.strict_final_check || {};
    const strictOk = !!sf.fullCoverageOk;
    const progressLines = [
      `Trace / пул: совместимых ${Number(cp.compatible || 0)}, шаблонов ${Number(cp.templates || 0)}`,
      `Trace / поиск: итераций ${Number(ps.iterations || 0)}, проверено ${Number(ps.evaluated || 0)}, размещено ${Number(ps.placed || 0)}`,
      rr.enabled
        ? `Trace / доводка: попыток ${Number(rr.attempts || 0)}, оставлено ${Number(rr.placementsReused || 0)}`
        : "",
      `Trace / финальная проверка: покрытие ${strictOk ? "OK" : "неполное"}, ratio=${Number(sf.coveredRatio || 0).toFixed(4)}`
    ].filter(Boolean);
    const kpi = {
      pieces: Number(ps.placed || 0),
      coverage: `${(Number(sf.coveredRatio || 0) * 100).toFixed(2)}`,
      utilization: "-",
      tail: "-"
    };
    return { progressLines, kpi };
  }

  global.FurLabProgress = Object.assign({}, global.FurLabProgress || {}, {
    SERVER_PREVIEW_PROGRESS_PHASES,
    PHASE_RU,
    REASON_RU,
    formatDurationClock,
    createProgressToken,
    buildProgressSignature,
    isTelemetryEvent,
    mergeMonotonicKpi,
    describeProgressEvent,
    buildTraceProgressSnapshot
  });
})(window);
