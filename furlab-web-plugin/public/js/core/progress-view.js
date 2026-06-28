// Extracted from app.js (inventory progress UI view model/rendering)
(function (global) {
  function createProgressView(options) {
    const opts = options && typeof options === "object" ? options : {};
    const byId = typeof opts.byId === "function"
      ? opts.byId
      : (id) => global.document && global.document.getElementById(id);

    let stepsState = [];
    let kpiState = { pieces: null, coverage: null, utilization: null, tail: null };
    const stepRu = {
      "Worker / bootstrap": "Воркер / инициализация",
      "Worker / pre-rank": "Воркер / предварительный ранжир",
      "Worker / prerank": "Воркер / предварительный ранжир",
      "Worker / оконный raster + pre-rank": "Воркер / оконный растр + предранжир",
      "Server / placement search": "Сервер / поиск размещения",
      "Server / placement stalled": "Сервер / застой размещения",
      "Server / coverage check": "Сервер / проверка покрытия",
      "Server / legacy fallback": "Сервер / fallback на legacy",
      "Server / legacy fallback skipped": "Сервер / legacy fallback пропущен",
      "Server / placement search (legacy)": "Сервер / поиск размещения (legacy)",
      "Server / placement pass start": "Сервер / старт прохода размещения",
      "Server / placement pass end": "Сервер / конец прохода размещения",
      "Server / hard timeout": "Сервер / жесткий таймаут",
      "Server / time budget exceeded": "Сервер / исчерпан лимит времени",
      "Server / target reached": "Сервер / цель покрытия достигнута",
      "Server / residual empty": "Сервер / остаток закрыт",
      "Server / no ranked templates": "Сервер / нет ранжированных шаблонов",
      "Server / stalled hard": "Сервер / жесткий застой",
      "Сервер / подготовка данных": "Сервер / подготовка данных",
      "Сервер / геометрия зоны": "Сервер / геометрия зоны",
      "Сервер / фильтрация кандидатов": "Сервер / фильтрация кандидатов",
      "Сервер / размещение кусков": "Сервер / размещение кусков",
      "Сервер / проверка покрытия": "Сервер / проверка покрытия",
      "Сервер / сбор диагностики": "Сервер / сбор диагностики"
    };

    function normalizeStepLabel(raw) {
      const t = String(raw || "").trim();
      if (!t) return "";
      if (t.indexOf("Worker: ") === 0) return t.replace(/^Worker:\s*/, "Worker / ");
      const ru = stepRu[t];
      if (!ru || ru === t) return t;
      return `${t} (${ru})`;
    }

    function renderSteps() {
      const root = byId("inventoryProgressSteps");
      if (!root) return;
      if (!Array.isArray(stepsState) || !stepsState.length) {
        root.innerHTML = "";
        return;
      }
      root.innerHTML = stepsState.map((s) => {
        const cls = s.status === "done"
          ? "progress-step progress-step-done"
          : (s.status === "active" ? "progress-step progress-step-active" : "progress-step progress-step-pending");
        const mark = s.status === "done" ? "\u2713" : (s.status === "active" ? "\u2022" : "-");
        return `<li class="${cls}"><span>${mark}</span><span>${s.label}</span></li>`;
      }).join("");
      root.scrollTop = root.scrollHeight;
    }

    function updateSteps(titleText, percent) {
      const label = normalizeStepLabel(titleText);
      if (!label) return;
      let idx = -1;
      for (let i = 0; i < stepsState.length; i++) {
        if (stepsState[i].label === label) {
          idx = i;
          break;
        }
      }
      if (idx < 0) {
        stepsState.push({ label, status: "active" });
        idx = stepsState.length - 1;
      }
      for (let i = 0; i < stepsState.length; i++) {
        if (i < idx) stepsState[i].status = "done";
        else if (i === idx) stepsState[i].status = "active";
      }
      if (Number(percent || 0) >= 100) {
        for (const s of stepsState) s.status = "done";
      }
      renderSteps();
    }

    function resetSteps() {
      stepsState = [];
      renderSteps();
    }

    function updateKpis(input) {
      const data = input && typeof input === "object" ? input : {};
      const piecesEl = byId("inventoryProgressKpiPieces");
      const covEl = byId("inventoryProgressKpiCoverage");
      const itersEl = byId("inventoryProgressKpiIters");
      const tempEl = byId("inventoryProgressKpiTemperature");
      if (data.pieces !== undefined && Number.isFinite(Number(data.pieces))) kpiState.pieces = Number(data.pieces);
      if (data.coverage !== undefined && Number.isFinite(Number(data.coverage))) kpiState.coverage = Number(data.coverage);
      if (data.iters !== undefined && Number.isFinite(Number(data.iters))) kpiState.iters = Number(data.iters);
      if (data.temperature !== undefined && Number.isFinite(Number(data.temperature))) kpiState.temperature = Number(data.temperature);
      if (data.phase !== undefined && typeof data.phase === "string") kpiState.phase = data.phase;
      const hasPieces = Number.isFinite(Number(kpiState.pieces));
      const hasCoverage = Number.isFinite(Number(kpiState.coverage));
      const hasIters = Number.isFinite(Number(kpiState.iters));
      const hasPhase = kpiState.phase != null;
      if (piecesEl) piecesEl.textContent = hasPieces ? String(Math.max(0, Math.round(Number(kpiState.pieces)))) : "-";
      if (covEl) covEl.textContent = hasCoverage ? Number(kpiState.coverage).toFixed(1) + "%" : "-";
      if (itersEl) itersEl.textContent = hasIters ? String(Math.round(Number(kpiState.iters))) : "-";
      if (tempEl) tempEl.textContent = hasPhase ? String(kpiState.phase) : "-";
    }

    function resetKpis() {
      kpiState = { pieces: null, coverage: null, iters: null, temperature: null, phase: null };
      updateKpis(kpiState);
    }

    function getKpiState() {
      return Object.assign({}, kpiState);
    }

    return {
      updateSteps,
      resetSteps,
      updateKpis,
      resetKpis,
      getKpiState
    };
  }

  global.FurLabProgressView = Object.assign({}, global.FurLabProgressView || {}, {
    createProgressView
  });
})(window);
