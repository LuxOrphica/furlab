"use strict";

function createManualPlacementLogService(deps) {
  const { fs, path, rootDir, crypto } = deps;

  const logPath = path.join(rootDir, "data", "placements", "manual_placements.ndjson");

  function ensureReady() {
    const dir = path.dirname(logPath);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, "", "utf8");
  }

  function readAll() {
    ensureReady();
    const text = String(fs.readFileSync(logPath, "utf8") || "");
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

  function appendRows(rows) {
    ensureReady();
    const lines = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    fs.appendFileSync(logPath, lines, "utf8");
  }

  function commitPlacements(payload) {
    const runRef = String(payload && payload.runRef || "").trim();
    const zoneName = String(payload && payload.zoneName || "").trim();
    const rawPlacements = Array.isArray(payload && payload.placements) ? payload.placements : [];
    if (!rawPlacements.length) return { ok: false, error: "placements_required" };

    const ts = new Date().toISOString();
    const rows = rawPlacements.map((p) => ({
      id: crypto.randomUUID(),
      runRef,
      scrapPieceId: String(p && p.scrapPieceId || "").trim(),
      inventoryTag: String(p && p.inventoryTag || "").trim(),
      zoneRef: zoneName || String(p && p.zoneRef || "").trim(),
      rotationDeg: Number.isFinite(Number(p && p.rotationDeg)) ? Number(p.rotationDeg) : null,
      offsetXmm: Number.isFinite(Number(p && p.offsetXmm)) ? Number(p.offsetXmm) : null,
      offsetYmm: Number.isFinite(Number(p && p.offsetYmm)) ? Number(p.offsetYmm) : null,
      resultContourSnapshot: String(p && p.resultContourSnapshot || "").trim() || null,
      ts,
      source: "manual_web"
    }));

    appendRows(rows);
    return { ok: true, committed: rows.length, ts };
  }

  function loadAll() {
    try {
      return { ok: true, items: readAll() };
    } catch (e) {
      return { ok: false, error: `read_failed: ${e.message}`, items: [] };
    }
  }

  return { commitPlacements, loadAll };
}

module.exports = { createManualPlacementLogService };
