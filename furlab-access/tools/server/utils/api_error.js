"use strict";

function toErrorMessage(code, fallback) {
  const explicit = String(fallback || "").trim();
  if (explicit) return explicit;
  const c = String(code || "").trim();
  if (!c) return "Request failed";
  return c
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeApiPayload(statusCode, payload, requestId) {
  const code = Number(statusCode || 500);
  const rid = String(requestId || "");
  const body = (payload && typeof payload === "object")
    ? { ...payload }
    : { ok: code < 400, data: payload };

  body.requestId = rid;

  if (code < 400 && body.ok !== false) {
    if (typeof body.ok !== "boolean") body.ok = true;
    return body;
  }

  body.ok = false;

  const rawErr = body.error;
  let errCode = "request_failed";
  let errMessage = "";

  if (typeof rawErr === "string" && rawErr.trim()) {
    errCode = rawErr.trim();
    errMessage = toErrorMessage(errCode, body.message);
  } else if (rawErr && typeof rawErr === "object") {
    const objCode = String(rawErr.code || rawErr.error || "").trim();
    const objMsg = String(rawErr.message || "").trim();
    errCode = objCode || errCode;
    errMessage = objMsg || toErrorMessage(errCode, body.message);
  } else {
    errMessage = toErrorMessage(errCode, body.message);
  }

  if (!body.error || typeof body.error !== "string") {
    body.error = errCode;
  }
  body.errorCode = errCode;
  body.errorDetail = {
    code: errCode,
    message: errMessage,
    statusCode: code,
    requestId: rid
  };

  return body;
}

module.exports = {
  normalizeApiPayload
};
