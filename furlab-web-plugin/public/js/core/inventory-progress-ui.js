// Extracted from app.js (inventory progress bar/timer monotonic UI behavior)
(function (global) {
  function createInventoryProgressUi(options) {
    const opts = options && typeof options === "object" ? options : {};
    const byId = typeof opts.byId === "function"
      ? opts.byId
      : (id) => global.document && global.document.getElementById(id);
    const onStepUpdate = typeof opts.onStepUpdate === "function"
      ? opts.onStepUpdate
      : null;

    let monotonicPercent = 0;

    function resetMonotonic() {
      monotonicPercent = 0;
    }

    function setProgress(percent, titleText, options2) {
      const opts2 = options2 && typeof options2 === "object" ? options2 : null;
      const allowDecrease = !!(opts2 && opts2.allowDecrease);
      const incoming = Math.max(0, Math.min(100, Number(percent) || 0));
      const p = allowDecrease ? incoming : Math.max(monotonicPercent, incoming);
      monotonicPercent = p;
      const bar = byId("inventoryProgressBar");
      const text = byId("inventoryProgressText");
      const title = byId("inventoryProgressTitle");
      if (bar) bar.style.width = `${p}%`;
      if (text) text.textContent = `${Math.round(p)}%`;
      if (title && titleText) title.textContent = titleText;
      if (titleText && onStepUpdate) onStepUpdate(titleText, p);
      return p;
    }

    function updateTimer(startedAt, formatDurationClock) {
      const el = byId("inventoryProgressTimer");
      if (!el || !startedAt || typeof formatDurationClock !== "function") return;
      el.textContent = formatDurationClock(Date.now() - Number(startedAt || 0));
    }

    return {
      resetMonotonic,
      setProgress,
      updateTimer
    };
  }

  global.FurLabInventoryProgressUi = Object.assign({}, global.FurLabInventoryProgressUi || {}, {
    createInventoryProgressUi
  });
})(window);
