"use strict";

function createQrRegistryService(deps) {
  const { fs, path, rootDir, dbPathOverride } = deps;

  const defaultDbPath = path.join(rootDir, "data", "qr-registry", "issued_codes.ndjson");
  const dbPath = String(dbPathOverride || "").trim() || defaultDbPath;
  const TAG_RE = /^FL-SCR-(\d{6})$/i;

  function ensureDbReady() {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, "", "utf8");
  }

  function normalizeTag(raw) {
    return String(raw || "").trim().toUpperCase();
  }

  function isValidTag(tag) {
    return TAG_RE.test(tag);
  }

  function normalizeTags(inputTags) {
    const arr = Array.isArray(inputTags) ? inputTags : [];
    const valid = [];
    const invalid = [];
    for (const raw of arr) {
      const tag = normalizeTag(raw);
      if (!tag) continue;
      if (isValidTag(tag)) valid.push(tag);
      else invalid.push(tag);
    }
    return { valid, invalid };
  }

  function readAll() {
    ensureDbReady();
    const text = String(fs.readFileSync(dbPath, "utf8") || "");
    if (!text.trim()) return [];
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      const s = String(line || "").trim();
      if (!s) continue;
      try {
        const row = JSON.parse(s);
        if (row && typeof row === "object") rows.push(row);
      } catch (_) {}
    }
    return rows;
  }

  function buildIndex(rows) {
    const map = new Map();
    for (const r of rows) {
      const tag = normalizeTag(r?.tag);
      if (!tag || !isValidTag(tag)) continue;
      if (!map.has(tag)) map.set(tag, r);
    }
    return map;
  }

  function listStats() {
    const rows = readAll();
    const index = buildIndex(rows);
    return {
      ok: true,
      totalRecords: rows.length,
      uniqueTags: index.size,
      dbPath
    };
  }

  function listRecords(query) {
    const limitRaw = Number(query?.get?.("limit") || 200);
    const offsetRaw = Number(query?.get?.("offset") || 0);
    const limit = Math.max(1, Math.min(2000, Number.isFinite(limitRaw) ? limitRaw : 200));
    const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);
    const rows = readAll().slice().reverse();
    const total = rows.length;
    const items = rows.slice(offset, offset + limit);
    return {
      ok: true,
      total,
      limit,
      offset,
      items,
      dbPath
    };
  }

  function checkTags(payload) {
    if (!payload || typeof payload !== "object") return { ok: false, error: "payload_required" };
    const { valid, invalid } = normalizeTags(payload.tags);
    if (!valid.length && !invalid.length) return { ok: false, error: "tags_required" };
    const uniqueInput = Array.from(new Set(valid));
    const rows = readAll();
    const index = buildIndex(rows);
    const existing = [];
    const available = [];
    for (const tag of uniqueInput) {
      if (index.has(tag)) existing.push({ tag, record: index.get(tag) });
      else available.push(tag);
    }
    return {
      ok: true,
      requested: uniqueInput.length,
      invalid,
      existing,
      available,
      dbPath
    };
  }

  function issueTags(payload) {
    if (!payload || typeof payload !== "object") return { ok: false, error: "payload_required" };
    const { valid, invalid } = normalizeTags(payload.tags);
    if (!valid.length && !invalid.length) return { ok: false, error: "tags_required" };
    const uniqueInput = Array.from(new Set(valid));
    const source = String(payload.source || "qr-generator").trim();
    const note = String(payload.note || "").trim();
    const now = new Date().toISOString();

    const rows = readAll();
    const index = buildIndex(rows);
    const existing = [];
    const inserted = [];

    for (const tag of uniqueInput) {
      const prev = index.get(tag);
      if (prev) {
        existing.push({ tag, record: prev });
        continue;
      }
      const rec = {
        tag,
        issuedAt: now,
        source,
        note
      };
      rows.push(rec);
      index.set(tag, rec);
      inserted.push(rec);
    }

    if (inserted.length) {
      const lines = rows.map((r) => JSON.stringify(r)).join("\n");
      fs.writeFileSync(dbPath, lines ? `${lines}\n` : "", "utf8");
    }

    return {
      ok: true,
      inserted,
      existing,
      invalid,
      dbPath
    };
  }

  return {
    listStats,
    listRecords,
    checkTags,
    issueTags
  };
}

module.exports = {
  createQrRegistryService
};
