// Extracted from app.js (api helper)
(function (global) {
  global.furlabApi = async function api(path, method, body, timeoutMs) {
      const ctrl = new AbortController();
      const ms = Math.max(1000, Number(timeoutMs || 45000));
      const t = setTimeout(() => ctrl.abort(), ms);
      try {
        const res = await fetch(path, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
          signal: ctrl.signal
        });
        return await res.json();
      } finally {
        clearTimeout(t);
      }
    };
})(window);
