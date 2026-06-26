"use strict";

function sanitizeScriptJsonText(text) {
  const src = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!src) return "{}";

  const start = src.indexOf("{");
  const end = src.lastIndexOf("}");
  const core = (start >= 0 && end > start) ? src.slice(start, end + 1) : src;
  return core.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
}

function parseScriptJson(text) {
  return JSON.parse(sanitizeScriptJsonText(text));
}

module.exports = {
  sanitizeScriptJsonText,
  parseScriptJson
};
