"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { reserveScrapPieces, releaseScrapReservations } = require("./inventory_reservation");

const PROJECTS_DIR = "projects";

/**
 * Collect all scrapPieceIds from layouts that have inventory placements.
 * Returns Map<layoutId, string[]>.
 */
function collectLayoutReservations(layouts) {
  const result = new Map();
  if (!Array.isArray(layouts)) return result;
  for (const layout of layouts) {
    const layoutId = String(layout && layout.id || "");
    const ids = new Set();
    // runs[].scrapPlacements[] — serialized project format
    const runs = Array.isArray(layout && layout.runs) ? layout.runs : [];
    for (const run of runs) {
      const sp = Array.isArray(run && run.scrapPlacements) ? run.scrapPlacements : [];
      for (const p of sp) {
        const pid = String(p && p.scrapPieceId || "").trim();
        if (pid) ids.add(pid);
      }
    }
    if (ids.size > 0) result.set(layoutId, Array.from(ids));
  }
  return result;
}

function getProjectsDir(rootDir) {
  const dir = path.join(rootDir, "data", PROJECTS_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readProjectFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    // Strip UTF-8 BOM if present
    return JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
  } catch (_) {
    return null;
  }
}

function listProjects(rootDir) {
  const dir = getProjectsDir(rootDir);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const projects = [];
  for (const f of files) {
    const p = readProjectFile(path.join(dir, f));
    if (!p || !p.id) continue;
    projects.push({
      id: p.id,
      name: p.name || "Без названия",
      createdAt: p.createdAt || 0,
      updatedAt: p.updatedAt || 0,
      workspaceKey: p.workspaceKey || "",
      zonesCount: Array.isArray(p.zones) ? p.zones.length : 0,
      layoutsCount: Array.isArray(p.layouts) ? p.layouts.length : 0
    });
  }
  return projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function syncLayoutsToDb(project, deps) {
  const { ROOT_DIR, TMP_DIR, DB_PATH, runCscript, parseScriptJson } = deps || {};
  if (!DB_PATH || !fs.existsSync(DB_PATH)) {
    console.log("[projects] syncLayoutsToDb skip: DB_PATH=", DB_PATH);
    return;
  }
  const layouts = Array.isArray(project && project.layouts) ? project.layouts : [];
  const parts   = Array.isArray(project && project.parts)   ? project.parts   : [];
  const zones   = Array.isArray(project && project.zones)   ? project.zones   : [];
  console.log(`[projects] syncLayoutsToDb: parts=${parts.length} zones=${zones.length} layouts=${layouts.length}`);
  if (!parts.length && !zones.length && !layouts.length) return;

  // Pre-serialize nested objects so CScript (WSH JScript) doesn't need JSON.stringify
  const normalizedLayouts = layouts.map((lay) => ({
    id: lay.id,
    zoneId: lay.zoneId,
    layoutType: lay.layoutType,
    paramsJson: lay.params != null ? JSON.stringify(lay.params) : null,
    runs: (Array.isArray(lay.runs) ? lay.runs : []).map((run) => ({
      id: run.id,
      startedAt: run.startedAt,
      paramsSnapshot: run.paramsSnapshot != null ? JSON.stringify(run.paramsSnapshot) : null,
      resultSnapshot: run.resultSnapshot != null ? JSON.stringify(run.resultSnapshot) : null,
      scrapPlacements: Array.isArray(run.scrapPlacements) ? run.scrapPlacements : []
    }))
  }));

  const payloadPath = path.join(TMP_DIR || ROOT_DIR, `layout_sync_${Date.now()}.json`);
  fs.writeFileSync(payloadPath, JSON.stringify({ parts, zones, layouts: normalizedLayouts }), "utf8");
  const scriptPath = path.join(ROOT_DIR, "scripts", "access_upsert_layout_run.js");
  const exec = runCscript(scriptPath, [DB_PATH, payloadPath], 60000);
  try { fs.unlinkSync(payloadPath); } catch (_) {}
  try {
    const result = parseScriptJson && parseScriptJson(exec.stdout);
    if (result && result.ok) {
      console.log(`[projects] DB layout sync: parts=${result.parts} zones=${result.zones} layouts=${result.layouts} runs=${result.runs} placements=${result.placements}`);
      if (exec.stderr) console.log("[projects] DB layout sync stderr:", exec.stderr);
    } else {
      console.warn("[projects] DB layout sync failed:", exec.stderr || exec.stdout || (result && result.error));
    }
  } catch (e) {
    console.warn("[projects] DB layout sync parse error:", e && e.message, "stdout:", exec.stdout);
  }
}

async function handleProjectRoutes(req, res, reqUrl, deps) {
  const { jsonReply, readBodyJson, ROOT_DIR } = deps;
  // deps may optionally carry DB_PATH, TMP_DIR, runCscript, parseScriptJson for reservation calls

  if (req.method === "GET" && reqUrl.pathname === "/api/projects") {
    jsonReply(res, 200, { ok: true, items: listProjects(ROOT_DIR) });
    return true;
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/projects/save") {
    const body = await readBodyJson(req);
    const dir = getProjectsDir(ROOT_DIR);
    const now = Date.now();
    const id = String(body.id || `proj_${now}_${crypto.randomBytes(4).toString("hex")}`).replace(/[^a-zA-Z0-9_\-]/g, "_");
    const project = {
      id,
      name: String(body.name || "Без названия").trim().slice(0, 200),
      createdAt: Number(body.createdAt) || now,
      updatedAt: now,
      workspaceKey: String(body.workspaceKey || ""),
      parts: Array.isArray(body.parts) ? body.parts : [],
      zones: Array.isArray(body.zones) ? body.zones : [],
      layouts: Array.isArray(body.layouts) ? body.layouts : [],
      patternGeometry: (body.patternGeometry && Array.isArray(body.patternGeometry.entities)) ? body.patternGeometry : null,
      projectMaterials: Array.isArray(body.projectMaterials) ? body.projectMaterials : []
    };
    const filePath = path.join(dir, `${id}.json`);
    const backup = filePath + ".backup";
    if (fs.existsSync(filePath)) {
      try { fs.copyFileSync(filePath, backup); } catch (_) {}
    }
    fs.writeFileSync(filePath, JSON.stringify(project, null, 2), "utf8");

    // Sync reservations: release all old, then re-reserve what's currently in layouts.
    // This handles the case where layouts were deleted or pieces removed since last save.
    try {
      releaseScrapReservations(id, null, deps);
      const layoutReservations = collectLayoutReservations(project.layouts);
      for (const [layoutId, pieceIds] of layoutReservations) {
        reserveScrapPieces(id, layoutId, pieceIds, deps);
      }
    } catch (e) { console.log("[reserve] error:", e && e.message); }

    // Sync parts, zones, layouts to Access DB — non-fatal.
    try { syncLayoutsToDb(project, deps); } catch (_) {}

    jsonReply(res, 200, { ok: true, id, updatedAt: now });
    return true;
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/projects/load") {
    const body = await readBodyJson(req);
    const id = String(body.id || "").replace(/[^a-zA-Z0-9_\-]/g, "_");
    if (!id) { jsonReply(res, 400, { ok: false, error: "id_required" }); return true; }
    const dir = getProjectsDir(ROOT_DIR);
    const filePath = path.join(dir, `${id}.json`);
    if (!fs.existsSync(filePath)) { jsonReply(res, 404, { ok: false, error: "not_found" }); return true; }
    const project = readProjectFile(filePath);
    if (!project) { jsonReply(res, 500, { ok: false, error: "read_failed" }); return true; }
    jsonReply(res, 200, { ok: true, item: project });
    return true;
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/projects/delete") {
    const body = await readBodyJson(req);
    const id = String(body.id || "").replace(/[^a-zA-Z0-9_\-]/g, "_");
    if (!id) { jsonReply(res, 400, { ok: false, error: "id_required" }); return true; }
    const dir = getProjectsDir(ROOT_DIR);
    const filePath = path.join(dir, `${id}.json`);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error(`[projects] Failed to delete project file ${filePath}:`, e && e.message || e);
      }
    }

    // Release all active reservations for the deleted project (non-fatal).
    try { releaseScrapReservations(id, null, deps); } catch (_) {}

    jsonReply(res, 200, { ok: true });
    return true;
  }

  return false;
}

module.exports = { handleProjectRoutes };
