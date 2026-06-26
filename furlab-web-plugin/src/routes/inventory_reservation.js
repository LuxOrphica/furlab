"use strict";

/**
 * Inventory reservation routes.
 *
 * Mechanism:
 *   ScrapReservation table in Access (created automatically if absent):
 *     id, scrapPieceId, projectId, layoutId, reservedAt, releasedAt, note
 *
 *   When a project is saved and layouts contain inventory placements
 *   (status === "matched" && scrapPieceId), we upsert active reservations
 *   in ScrapReservation via CScript.
 *
 *   Fallback: if DB_PATH is unavailable or the CScript fails, reservations
 *   are stored in data/reservations/{projectId}.json with the same structure.
 *
 * Endpoints:
 *   GET  /api/inventory/reserved?projectId=xxx  — list active reservations
 *   POST /api/inventory/release                  — release (projectId required, layoutId optional)
 *
 * Internal helper (called from projects.js save handler):
 *   reserveScrapPieces(projectId, layoutId, scrapPieceIds, deps)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CSCRIPT_TIMEOUT_MS = Math.max(15000, Number(process.env.FURLAB_CSCRIPT_TIMEOUT_MS || 60000));

// ── JSON fallback helpers ─────────────────────────────────────────────────────

function reservationsDir(rootDir) {
  const dir = path.join(rootDir, "data", "reservations");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function reservationsFilePath(rootDir, projectId) {
  return path.join(reservationsDir(rootDir), `${projectId}.json`);
}

function readReservationsFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeReservationsFile(filePath, items) {
  fs.writeFileSync(filePath, JSON.stringify(items, null, 2), "utf8");
}

// ── JSON fallback operations ──────────────────────────────────────────────────

function jsonReserve(rootDir, projectId, layoutId, scrapPieceIds) {
  const filePath = reservationsFilePath(rootDir, projectId);
  const items = readReservationsFile(filePath);
  const now = new Date().toISOString();
  let inserted = 0;
  let skipped = 0;

  for (const pid of scrapPieceIds) {
    if (!pid) { skipped++; continue; }
    const exists = items.some(
      (r) => r.scrapPieceId === pid && r.projectId === projectId &&
             (!layoutId || r.layoutId === layoutId) && !r.releasedAt
    );
    if (exists) { skipped++; continue; }
    items.push({
      id: `res_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      scrapPieceId: pid,
      projectId,
      layoutId: layoutId || null,
      reservedAt: now,
      releasedAt: null,
      note: "project_save"
    });
    inserted++;
  }

  writeReservationsFile(filePath, items);
  return { ok: true, fallback: true, inserted, skipped };
}

function jsonRelease(rootDir, projectId, layoutId) {
  const filePath = reservationsFilePath(rootDir, projectId);
  const items = readReservationsFile(filePath);
  const now = new Date().toISOString();
  let released = 0;

  for (const r of items) {
    if (r.projectId === projectId && !r.releasedAt) {
      if (!layoutId || r.layoutId === layoutId) {
        r.releasedAt = now;
        released++;
      }
    }
  }

  writeReservationsFile(filePath, items);
  return { ok: true, fallback: true, released };
}

function jsonList(rootDir, projectId) {
  const filePath = reservationsFilePath(rootDir, projectId);
  const items = readReservationsFile(filePath);
  const active = items.filter((r) => r.projectId === projectId && !r.releasedAt);
  return { ok: true, fallback: true, items: active };
}

// ── CScript operations ────────────────────────────────────────────────────────

function runReservationScript(action, payload, deps) {
  const { ROOT_DIR, TMP_DIR, DB_PATH, runCscript, parseScriptJson } = deps;

  if (!DB_PATH || !fs.existsSync(DB_PATH)) {
    return { ok: false, error: "db_not_found" };
  }

  const fullPayload = { action, ...payload };
  const payloadPath = path.join(TMP_DIR, `scrap_reservation_${Date.now()}_${crypto.randomUUID()}.json`);
  fs.writeFileSync(payloadPath, JSON.stringify(fullPayload), "utf8");

  const scriptPath = path.join(ROOT_DIR, "scripts", "access_scrap_reservation.js");
  const exec = runCscript(scriptPath, [DB_PATH, payloadPath], CSCRIPT_TIMEOUT_MS);

  try { fs.unlinkSync(payloadPath); } catch (_) {}

  if (exec.run.error || exec.run.status !== 0) {
    console.log("[reservation-script] failed:", { status: exec.run.status, stderr: exec.stderr, stdout: exec.stdout, error: exec.run.error && exec.run.error.message });
    return { ok: false, error: "cscript_failed", stderr: exec.stderr };
  }

  if (exec.stderr) console.log("[reservation-script] stderr:", exec.stderr);
  const result = parseScriptJson(exec.stdout);

  // If reserve succeeded, transition ScrapPiece.scrapStatus via the authoritative script
  if (result && result.ok && action === "reserve" && Array.isArray(payload.scrapPieceIds)) {
    const transitionScript = path.join(
      ROOT_DIR, "..", "furlab-access", "scripts", "access_transition_piece_status.js"
    );
    if (fs.existsSync(transitionScript)) {
      for (const pid of payload.scrapPieceIds) {
        if (!pid) continue;
        const tr = runCscript(transitionScript, [DB_PATH, pid, "reserve", "furlab-plugin"], CSCRIPT_TIMEOUT_MS);
        if (tr.stderr) console.log("[transition] stderr:", tr.stderr);
        const trResult = parseScriptJson(tr.stdout);
        if (trResult && trResult.ok) {
          console.log("[transition] reserved:", trResult.inventoryTag, trResult.beforeStatus, "→", trResult.afterStatus);
        } else {
          console.log("[transition] skipped:", pid, trResult && trResult.error);
        }
      }
    }
  }

  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Reserve scrap pieces for a project/layout.
 * Called from projects.js save handler.
 * Returns { ok, fallback?, inserted, skipped }.
 */
function reserveScrapPieces(projectId, layoutId, scrapPieceIds, deps) {
  if (!Array.isArray(scrapPieceIds) || scrapPieceIds.length === 0) {
    return { ok: true, inserted: 0, skipped: 0 };
  }

  // Try Access first
  const result = runReservationScript("reserve", { projectId, layoutId, scrapPieceIds }, deps);
  if (result && result.ok) return result;

  // Fallback to JSON
  return jsonReserve(deps.ROOT_DIR, projectId, layoutId, scrapPieceIds);
}

/**
 * Release all reservations for a project (or a specific layout within it).
 * Called from projects.js delete handler.
 */
function releaseScrapReservations(projectId, layoutId, deps) {
  if (!projectId) return { ok: false, error: "projectId_required" };

  const result = runReservationScript("release", {
    releaseProjectId: projectId,
    releaseLayoutId: layoutId || ""
  }, deps);
  if (result && result.ok) return result;

  return jsonRelease(deps.ROOT_DIR, projectId, layoutId);
}

// ── Route handler ─────────────────────────────────────────────────────────────

async function handleInventoryReservationRoutes(req, res, reqUrl, deps) {
  const { jsonReply, readBodyJson, ROOT_DIR } = deps;

  // GET /api/inventory/reserved?projectId=xxx
  if (req.method === "GET" && reqUrl.pathname === "/api/inventory/reserved") {
    const projectId = String(reqUrl.searchParams ? reqUrl.searchParams.get("projectId") || "" : "").trim();
    if (!projectId) {
      jsonReply(res, 400, { ok: false, error: "projectId_required" });
      return true;
    }

    // Try Access
    const result = runReservationScript("list", { projectId }, deps);
    if (result && result.ok) {
      jsonReply(res, 200, result);
      return true;
    }

    // Fallback JSON
    jsonReply(res, 200, jsonList(ROOT_DIR, projectId));
    return true;
  }

  // POST /api/inventory/release
  if (req.method === "POST" && reqUrl.pathname === "/api/inventory/release") {
    const body = await readBodyJson(req);
    const projectId = String(body.projectId || "").trim();
    const layoutId = String(body.layoutId || "").trim();
    if (!projectId) {
      jsonReply(res, 400, { ok: false, error: "projectId_required" });
      return true;
    }

    const result = releaseScrapReservations(projectId, layoutId || null, deps);
    jsonReply(res, result.ok ? 200 : 500, result);
    return true;
  }

  return false;
}

module.exports = {
  handleInventoryReservationRoutes,
  reserveScrapPieces,
  releaseScrapReservations
};
