"use strict";

function asText(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function asNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseUpdatedAtToTs(v) {
  const s = asText(v).trim();
  if (!s) return null;
  // Supports "dd.mm.yyyy hh:mm[:ss]" and close variants with "/" or "-".
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    let yyyy = Number(m[3]);
    const hh = Number(m[4] || 0);
    const mi = Number(m[5] || 0);
    const ss = Number(m[6] || 0);
    if (yyyy < 100) yyyy += 2000;
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      const ts = new Date(yyyy, mm - 1, dd, hh, mi, ss).getTime();
      return Number.isFinite(ts) ? ts : null;
    }
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

function loadRegistryPage(query, loadRegistryRowsCached) {
  const t0 = Date.now();
  const cached = loadRegistryRowsCached();
  if (!cached.ok) return cached;

  const q = asText(query.get("q")).trim().toLowerCase();
  const quality = asText(query.get("quality")).trim().toLowerCase();
  const status = asText(query.get("status")).trim().toLowerCase();
  const materialId = asText(query.get("materialId")).trim().toLowerCase();
  const storageLocationId = asText(query.get("storageLocationId")).trim().toLowerCase();
  const sortBy = asText(query.get("sortBy")).trim();
  const sortDirRaw = asText(query.get("sortDir")).trim().toLowerCase();
  const sortDir = sortDirRaw === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number(query.get("page")) || 1);
  const pageSize = Math.max(1, Math.min(200, Number(query.get("pageSize")) || 20));

  let rows = cached.items.map((it) => ({
    id: asText(it.id),
    inventoryTag: asText(it.inventoryTag),
    materialId: asText(it.materialId),
    storageLocationId: asText(it.storageLocationId),
    scrapQuality: asText(it.scrapQuality),
    scrapStatus: asText(it.scrapStatus),
    areaMm2: asNumber(it.areaMm2),
    maxSpanMm: asNumber(it.maxSpanMm),
    napDirectionDeg: asNumber(it.napDirectionDeg),
    updatedAt: asText(it.updatedAt),
    note: asText(it.note)
  }));

  const tFilter0 = Date.now();
  if (quality) {
    rows = rows.filter((r) => asText(r.scrapQuality).toLowerCase() === quality);
  }
  if (status) {
    rows = rows.filter((r) => asText(r.scrapStatus).toLowerCase() === status);
  }
  if (materialId) {
    rows = rows.filter((r) => asText(r.materialId).toLowerCase() === materialId);
  }
  if (storageLocationId) {
    rows = rows.filter((r) => asText(r.storageLocationId).toLowerCase() === storageLocationId);
  }
  if (q) {
    rows = rows.filter((r) => {
      const blob = [
        r.inventoryTag,
        r.materialId,
        r.storageLocationId,
        r.scrapQuality,
        r.scrapStatus,
        r.note
      ].join(" ").toLowerCase();
      return blob.includes(q);
    });
  }
  const filterMs = Date.now() - tFilter0;

  const allowedSortFields = new Set([
    "inventoryTag",
    "scrapQuality",
    "scrapStatus",
    "materialId",
    "storageLocationId",
    "areaMm2",
    "maxSpanMm",
    "napDirectionDeg",
    "updatedAt"
  ]);
  const tSort0 = Date.now();
  if (sortBy && allowedSortFields.has(sortBy)) {
    const dir = sortDir === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      if (sortBy === "updatedAt") {
        const at = parseUpdatedAtToTs(a.updatedAt);
        const bt = parseUpdatedAtToTs(b.updatedAt);
        if (at === null && bt === null) return 0;
        if (at === null) return 1;
        if (bt === null) return -1;
        return (at - bt) * dir;
      }
      const av = a[sortBy];
      const bv = b[sortBy];
      if (av === null || av === undefined || av === "") return 1;
      if (bv === null || bv === undefined || bv === "") return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      const as = String(av);
      const bs = String(bv);
      return as.localeCompare(bs, "ru", { sensitivity: "base", numeric: true }) * dir;
    });
  } else {
    // Keep legacy default order (latest updated first) without pushing ORDER BY into Access query.
    rows.sort((a, b) => {
      const at = parseUpdatedAtToTs(a.updatedAt);
      const bt = parseUpdatedAtToTs(b.updatedAt);
      if (at === null && bt === null) return 0;
      if (at === null) return 1;
      if (bt === null) return -1;
      return bt - at;
    });
  }
  const sortMs = Date.now() - tSort0;

  const total = rows.length;
  const tPage0 = Date.now();
  const start = (page - 1) * pageSize;
  const items = rows.slice(start, start + pageSize);
  const pageMs = Date.now() - tPage0;
  const totalMs = Date.now() - t0;
  return {
    ok: true,
    total,
    page,
    pageSize,
    items,
    cache: cached.cache || null,
    diag: {
      source: cached.diag?.source || "registry_unknown",
      copyMs: Number(cached.diag?.copyMs || 0),
      scriptMs: Number(cached.diag?.scriptMs || 0),
      parseMs: Number(cached.diag?.parseMs || 0),
      script: cached.diag?.script || null,
      filterMs,
      sortMs,
      pageMs,
      totalMs
    }
  };
}

module.exports = {
  loadRegistryPage
};
