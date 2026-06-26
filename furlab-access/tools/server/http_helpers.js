"use strict";

function buildCorsAllowedOrigins(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveCorsOrigin(req, allowedOrigins) {
  const list = Array.isArray(allowedOrigins) ? allowedOrigins : [];
  const fallback = list[0] || "http://127.0.0.1:5173";
  const origin = String(req.headers?.origin || "").trim();
  if (!origin) return fallback;
  if (list.includes(origin)) return origin;
  return fallback;
}

function sendJson(req, res, code, payload, options = {}) {
  const requestId = String(options.requestId || "");
  const allowedOrigins = Array.isArray(options.allowedOrigins) ? options.allowedOrigins : [];
  const contentType = options.contentType || "application/json; charset=utf-8";
  res.writeHead(code, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": resolveCorsOrigin(req, allowedOrigins),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Request-Id",
    "X-Request-Id": requestId
  });
  res.end(JSON.stringify(payload));
}

function getRequestId(req, cryptoLib) {
  const hdr = String(req.headers?.["x-request-id"] || "").trim();
  if (hdr) return hdr.slice(0, 80);
  return cryptoLib.randomUUID();
}

function checkWriteAuth(req, writeApiKey) {
  const expected = String(writeApiKey || "").trim();
  if (!expected) return { ok: true, mode: "disabled" };
  const keyHeader = String(req.headers?.["x-api-key"] || "").trim();
  const authHeader = String(req.headers?.authorization || "").trim();
  const bearer = /^bearer\s+/i.test(authHeader) ? authHeader.replace(/^bearer\s+/i, "").trim() : "";
  const provided = keyHeader || bearer;
  if (!provided) return { ok: false, error: "api_key_required" };
  if (provided !== expected) return { ok: false, error: "api_key_invalid" };
  return { ok: true, mode: "api_key" };
}

module.exports = {
  buildCorsAllowedOrigins,
  resolveCorsOrigin,
  sendJson,
  getRequestId,
  checkWriteAuth
};
