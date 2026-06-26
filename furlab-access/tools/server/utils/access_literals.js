"use strict";

function accessText(value) {
  if (value === null || value === undefined || value === "") return "Null";
  return `'${String(value).replace(/'/g, "''").replace(/\u0000/g, "")}'`;
}

function accessNumber(value) {
  if (value === null || value === undefined || value === "") return "Null";
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : "Null";
}

function accessDateNowLiteral() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const txt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `#${txt}#`;
}

function accessGuid(value) {
  if (value === null || value === undefined || value === "") return "Null";
  const s = String(value).trim();
  if (!s) return "Null";
  const m = s.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (m) {
    return accessText(`{${m[0].toUpperCase()}}`);
  }
  const body = s.replace(/[{}]/g, "").replace(/^guid\s+/i, "").trim();
  if (!body) return "Null";
  return accessText(`{${body.toUpperCase()}}`);
}

module.exports = {
  accessText,
  accessNumber,
  accessDateNowLiteral,
  accessGuid
};
