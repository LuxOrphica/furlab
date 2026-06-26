"use strict";

function nowIso() {
  return new Date().toISOString();
}

function safeValue(v) {
  if (v === undefined) return null;
  return v;
}

function logStructured(level, event, fields = {}) {
  const rec = {
    ts: nowIso(),
    level: String(level || "info"),
    event: String(event || "log")
  };
  for (const [k, v] of Object.entries(fields || {})) {
    rec[k] = safeValue(v);
  }
  try {
    process.stdout.write(`${JSON.stringify(rec)}\n`);
  } catch (_) {
    // ignore logging failures
  }
}

module.exports = {
  logStructured
};
