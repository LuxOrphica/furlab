"use strict";

const baseUrl = String(process.env.BACKEND_TEST_BASE_URL || process.env.SMOKE_BASE_URL || "http://127.0.0.1:5500").replace(/\/+$/, "");
const apiKey = String(process.env.FURLAB_API_KEY || "").trim();
const requestTimeoutMs = Number(process.env.BACKEND_TEST_TIMEOUT_MS || 20000);
const requestRetries = Math.max(0, Number(process.env.BACKEND_TEST_RETRIES || 2));

function withAuthHeaders(headers = {}) {
  const out = { ...headers };
  if (apiKey) out["X-API-Key"] = apiKey;
  return out;
}

async function requestJson(path, init = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= requestRetries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), requestTimeoutMs);
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: withAuthHeaders(init.headers || {}),
        signal: ctrl.signal
      });
      clearTimeout(timer);
      let json = null;
      try { json = await res.json(); } catch (_) {}
      return { res, json };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt >= requestRetries) throw e;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw lastErr || new Error("request_failed");
}

async function postJson(path, payload) {
  return requestJson(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
}

module.exports = {
  baseUrl,
  apiKey,
  requestJson,
  postJson
};
