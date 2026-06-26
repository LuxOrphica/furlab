// Extracted from app.js (inventory progress stream/ticker controller)
(function (global) {
  function createProgressController(options) {
    const opts = options && typeof options === "object" ? options : {};
    let serverProgressTickerId = null;
    let serverProgressTickIndex = 0;
    let serverProgressPercent = 68;
    let progressEventSource = null;
    let progressPollId = null;
    let progressActiveToken = "";
    let progressOpenedAtTs = 0;
    let progressHadEvent = false;

    function stopTicker() {
      if (serverProgressTickerId) {
        clearInterval(serverProgressTickerId);
        serverProgressTickerId = null;
      }
    }

    function startTicker(phases) {
      stopTicker();
      serverProgressTickIndex = 0;
      serverProgressPercent = 68;
      const p = Array.isArray(phases) && phases.length ? phases : ["Server / phases"];
      serverProgressTickerId = setInterval(() => {
        const label = p[serverProgressTickIndex % p.length];
        serverProgressTickIndex += 1;
        serverProgressPercent = Math.min(94, serverProgressPercent + 1.3);
        if (typeof opts.setProgress === "function") {
          opts.setProgress(serverProgressPercent, label);
        }
      }, 1300);
    }

    function closeStream() {
      if (progressEventSource) {
        try { progressEventSource.close(); } catch (_) {}
        progressEventSource = null;
      }
      if (progressPollId) {
        clearInterval(progressPollId);
        progressPollId = null;
      }
      progressActiveToken = "";
      progressOpenedAtTs = 0;
    }

    function openStream(progressToken) {
      closeStream();
      if (!progressToken) return;
      progressActiveToken = String(progressToken);
      progressOpenedAtTs = Date.now();
      progressHadEvent = false;

      (async () => {
        try {
          const fetchImpl = typeof opts.fetch === "function" ? opts.fetch : global.fetch;
          const r = await fetchImpl("/api/health");
          const j = await r.json();
          if (typeof opts.setLiveText === "function") {
            opts.setLiveText(`live: token=${progressToken}\nserver.buildId=${String(j && j.buildId || "-")}`);
          }
        } catch (_) {}
      })();

      if (typeof global.EventSource !== "undefined") {
        const es = new global.EventSource(`/api/layout/fill/progress/stream?token=${encodeURIComponent(progressToken)}`);
        progressEventSource = es;
        es.onmessage = (ev) => {
          try {
            const payload = JSON.parse(String(ev && ev.data || "{}"));
            if (typeof opts.onEvent === "function") opts.onEvent(payload);
          } catch (_) {}
        };
        es.onerror = () => {};
      }

      progressPollId = setInterval(async () => {
        try {
          if (progressActiveToken !== String(progressToken)) return;
          const fetchImpl = typeof opts.fetch === "function" ? opts.fetch : global.fetch;
          const url = `/api/layout/fill/progress/latest?token=${encodeURIComponent(progressToken)}`;
          const res = await fetchImpl(url);
          if (!res.ok) {
            if (!progressHadEvent && typeof opts.setLiveText === "function") {
              opts.setLiveText(`live: no telemetry (HTTP ${res.status})\ncheck backend restart + Ctrl+F5`);
            }
            return;
          }
          const json = await res.json();
          if (json && json.ok && json.latest && typeof json.latest === "object") {
            if (typeof opts.onEvent === "function") opts.onEvent(json.latest);
          }
        } catch (_) {}
      }, 700);

      setTimeout(() => {
        if (progressHadEvent) return;
        (async () => {
          if (progressActiveToken !== String(progressToken)) return;
          const fetchImpl = typeof opts.fetch === "function" ? opts.fetch : global.fetch;
          let latest = null;
          try {
            const lr = await fetchImpl(`/api/layout/fill/progress/latest?token=${encodeURIComponent(progressToken)}`);
            if (lr.ok) {
              const lj = await lr.json();
              latest = lj && lj.ok ? (lj.latest || null) : null;
            }
          } catch (_) {}
          if (latest && typeof latest === "object") {
            if (typeof opts.onEvent === "function") opts.onEvent(latest);
            if (progressHadEvent) return;
          }
          let dbg = null;
          try {
            const r = await fetchImpl(`/api/layout/fill/progress/debug?token=${encodeURIComponent(progressToken)}`);
            if (r.ok) dbg = await r.json();
          } catch (_) {}
          if (typeof opts.setLiveText === "function") {
            const newestServerToken = dbg && Array.isArray(dbg.recentTokens) && dbg.recentTokens.length
              ? String(dbg.recentTokens[0].token || "")
              : "";
            const lines = [
              "live: no events for 3s",
              dbg && dbg.ok
                ? `debug: hasLatest=${!!dbg.hasLatest} phase=${String(dbg.latestPhase || "-")} hasListeners=${!!dbg.hasListeners} count=${Number(dbg.listenerCount || 0)}`
                : "debug: unavailable",
              `token.current=${String(progressToken)}`,
              newestServerToken ? `token.serverLatest=${newestServerToken}` : "token.serverLatest=-",
              "possible reasons: pending long search step, stale browser tab, or token mismatch"
            ];
            opts.setLiveText(lines.join("\n"));
          }
        })();
      }, 3000);
    }

    function setHadEvent(next) {
      progressHadEvent = !!next;
    }

    function getHadEvent() {
      return !!progressHadEvent;
    }

    function getServerPercent() {
      return Number(serverProgressPercent || 0);
    }

    return {
      startTicker,
      stopTicker,
      openStream,
      closeStream,
      setHadEvent,
      getHadEvent,
      getServerPercent
    };
  }

  global.FurLabProgressController = Object.assign({}, global.FurLabProgressController || {}, {
    createProgressController
  });
})(window);
