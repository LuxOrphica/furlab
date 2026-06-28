"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync, spawn } = require("child_process");
const { handleImportRoutes } = require("./routes/import");
const { handleInventoryRoute } = require("./routes/inventory");
const { handleLayoutRoutes } = require("./routes/layout");
const { handleDictRoutes } = require("./routes/dicts");
const { handleFurMaterialRoutes } = require("./routes/fur_materials");
const { handleZoneRoutes } = require("./routes/zones");
const { handleProjectRoutes } = require("./routes/projects");
const { handleInventoryReservationRoutes } = require("./routes/inventory_reservation");
const { handleExportRoutes } = require("./routes/export");
const { createZoneStore } = require("./services/zone_store");
const {
  pointsToMultiPolygon,
  multiPolygonArea,
  unionMulti,
  intersectMulti,
  diffMulti,
  largestOuterRingPoints,
  residualAnchors
} = require("./services/polygon_ops");
const { createSeededRng, createGridSpec } = require("./services/solver_primitives");
const { solveCoverGrid } = require("./services/cover_grid_solver");
const { createAssignInventoryDirect } = require("./services/inventory_direct_solver");
const { assignCandidatesIntarsiaSmart } = require("./services/intarsia_smart_matcher");
const { buildPieceWorkingContour, outsetPath } = require("./services/piece_working_area");
const { createVoronoiSaSolver } = require("./services/solvers/voronoi_sa_solver");
const { createNfpSaSolver } = require("./services/solvers/nfp_sa_solver");
const { createTilingSolver } = require("./services/solvers/tiling_solver");

process.on("uncaughtException", (err) => {
  console.error("[server] uncaughtException:", err && err.stack ? err.stack : String(err));
  if (err && err.code === "EADDRINUSE") process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandledRejection:", reason && reason.stack ? reason.stack : String(reason));
});

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 5600);
const ROOT_DIR = path.resolve(__dirname, "..");
const TMP_DIR = path.join(ROOT_DIR, "tmp");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const EXAMPLES_DIR = process.env.FURLAB_EXAMPLES_DIR || "F:\\FURLAB\\Examples";
const DEFAULT_DB_PATH_CYR = "F:\\FURLAB\\dev\\furlab-access\\БД\\Furlab 1.accdb";
const DEFAULT_DB_PATH_LAT = "F:\\FURLAB\\dev\\furlab-access\\BD\\Furlab 1.accdb";
const DB_PATH = process.env.FURLAB_DB_PATH ||
  (fs.existsSync(DEFAULT_DB_PATH_CYR) ? DEFAULT_DB_PATH_CYR : DEFAULT_DB_PATH_LAT);
const CSCRIPT_PATH = process.env.FURLAB_CSCRIPT_PATH || "C:\\Windows\\System32\\cscript.exe";
const SERVER_BUILD_ID = "telemetry-v4-2026-05-06-export-reports-fix";

const previewStore = new Map();
const PREVIEW_TTL_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.FURLAB_PREVIEW_TTL_MS || 60 * 60 * 1000)
);
const PREVIEW_CLEANUP_INTERVAL_MS = Math.max(
  15 * 1000,
  Number(process.env.FURLAB_PREVIEW_CLEANUP_INTERVAL_MS || 60 * 1000)
);
let lastPreviewCleanupAt = 0;
const geometryCache = new Map();
const layoutProgressStreams = new Map();
const layoutProgressLatest = new Map();

fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
const zoneStore = createZoneStore({ filePath: path.join(TMP_DIR, "zones_store.json") });

function jsonReply(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body, "utf8"),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
}

function readBodyJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error(`invalid_json: ${e.message}`));
      }
    });
    req.on("error", reject);
  });
}

function emitLayoutProgress(token, payload) {
  const key = String(token || "").trim();
  if (!key) return;
  const evtObj = {
    ts: Date.now(),
    ...(payload && typeof payload === "object" ? payload : {})
  };
  layoutProgressLatest.set(key, evtObj);
  const listeners = layoutProgressStreams.get(key);
  if (!listeners || !listeners.size) return;
  const evt = JSON.stringify(evtObj);
  for (const res of listeners) {
    try {
      res.write(`data: ${evt}\n\n`);
    } catch (_) {}
  }
}

function openLayoutProgressStream(token, res) {
  const key = String(token || "").trim();
  if (!key) return false;
  let listeners = layoutProgressStreams.get(key);
  if (!listeners) {
    listeners = new Set();
    layoutProgressStreams.set(key, listeners);
  }
  listeners.add(res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });
  res.write("retry: 1500\n\n");
  emitLayoutProgress(key, { type: "stream_open" });
  const cleanup = () => {
    const ls = layoutProgressStreams.get(key);
    if (!ls) return;
    ls.delete(res);
    if (!ls.size) layoutProgressStreams.delete(key);
  };
  res.on("close", cleanup);
  res.on("error", cleanup);
  return true;
}

function listDxfInFolder(folderPath, recursive) {
  const out = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (recursive) walk(full);
        continue;
      }
      if (e.isFile() && path.extname(e.name).toLowerCase() === ".dxf") {
        out.push(full);
      }
    }
  }
  walk(folderPath);
  return out;
}

function parseDxfSummary(filePath) {
  const summary = {
    entities: 0,
    byType: {},
    bbox: null
  };
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  let pendingX = null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = String(lines[i] || "").trim();
    const val = String(lines[i + 1] || "").trim();
    if (code === "0" && val) {
      summary.entities += 1;
      summary.byType[val] = Number(summary.byType[val] || 0) + 1;
      continue;
    }
    if (code === "10" || code === "11" || code === "12" || code === "13") {
      const x = Number(val);
      pendingX = Number.isFinite(x) ? x : null;
      continue;
    }
    if (code === "20" || code === "21" || code === "22" || code === "23") {
      const y = Number(val);
      if (pendingX !== null && Number.isFinite(y)) {
        minX = Math.min(minX, pendingX);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, pendingX);
        maxY = Math.max(maxY, y);
      }
      pendingX = null;
      continue;
    }
  }

  if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
    summary.bbox = {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY
    };
  }
  return summary;
}

function parseDxfGeometry(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const entities = [];
  let inGeometrySection = false;
  let current = null;
  let pendingX = null;
  let vertexX = null;

  function finalizeEntity() {
    if (!current) return;
    if (current.type === "LINE") {
      if (
        Number.isFinite(current.x1) && Number.isFinite(current.y1) &&
        Number.isFinite(current.x2) && Number.isFinite(current.y2)
      ) {
        entities.push({
          type: "LINE",
          points: [{ x: current.x1, y: current.y1 }, { x: current.x2, y: current.y2 }]
        });
      }
    } else if (current.type === "LWPOLYLINE") {
      if (Array.isArray(current.points) && current.points.length >= 2) {
        entities.push({
          type: "POLYLINE",
          closed: !!current.closed,
          points: current.points.slice()
        });
      }
    } else if (current.type === "POLYLINE") {
      if (Array.isArray(current.points) && current.points.length >= 2) {
        entities.push({
          type: "POLYLINE",
          closed: !!current.closed,
          points: current.points.slice()
        });
      }
    }
    current = null;
    pendingX = null;
    vertexX = null;
  }

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = String(lines[i] || "").trim();
    const val = String(lines[i + 1] || "").trim();

    if (code === "0" && val === "SECTION") {
      const nCode = String(lines[i + 2] || "").trim();
      const nVal = String(lines[i + 3] || "").trim();
      if (nCode === "2" && (nVal === "ENTITIES" || nVal === "BLOCKS")) {
        inGeometrySection = true;
      }
      continue;
    }
    if (code === "0" && val === "ENDSEC") {
      if (inGeometrySection) finalizeEntity();
      inGeometrySection = false;
      continue;
    }
    if (!inGeometrySection) continue;

    if (code === "0") {
      if (current && current.type === "POLYLINE" && val === "VERTEX") {
        vertexX = null;
        continue;
      }
      if (current && current.type === "POLYLINE" && val === "SEQEND") {
        finalizeEntity();
        continue;
      }
      finalizeEntity();
      if (val === "LINE") {
        current = { type: "LINE", x1: null, y1: null, x2: null, y2: null };
      } else if (val === "LWPOLYLINE") {
        current = { type: "LWPOLYLINE", closed: false, points: [] };
      } else if (val === "POLYLINE") {
        current = { type: "POLYLINE", closed: false, points: [] };
      } else {
        current = null;
      }
      continue;
    }

    if (!current) continue;

    if (current.type === "LINE") {
      if (code === "10") current.x1 = Number(val);
      else if (code === "20") current.y1 = Number(val);
      else if (code === "11") current.x2 = Number(val);
      else if (code === "21") current.y2 = Number(val);
      continue;
    }

    if (current.type === "LWPOLYLINE") {
      if (code === "70") {
        const flags = Number(val);
        current.closed = Number.isFinite(flags) && (flags & 1) === 1;
      } else if (code === "10") {
        const x = Number(val);
        pendingX = Number.isFinite(x) ? x : null;
      } else if (code === "20") {
        const y = Number(val);
        if (pendingX !== null && Number.isFinite(y)) {
          current.points.push({ x: pendingX, y });
        }
        pendingX = null;
      }
      continue;
    }

    if (current.type === "POLYLINE") {
      if (code === "70") {
        const flags = Number(val);
        current.closed = Number.isFinite(flags) && (flags & 1) === 1;
      } else if (code === "10") {
        const x = Number(val);
        vertexX = Number.isFinite(x) ? x : null;
      } else if (code === "20") {
        const y = Number(val);
        if (vertexX !== null && Number.isFinite(y)) {
          current.points.push({ x: vertexX, y });
        }
        vertexX = null;
      }
      continue;
    }
  }
  finalizeEntity();

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let pointsCount = 0;
  for (const e of entities) {
    const pts = Array.isArray(e.points) ? e.points : [];
    for (const p of pts) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      pointsCount++;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const bbox = Number.isFinite(minX) ? {
    minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY
  } : null;

  return {
    entities,
    entityCount: entities.length,
    pointsCount,
    bbox
  };
}

function parsePosGeometry(filePath) {
  const buf = fs.readFileSync(filePath);
  const MIN_POINTS = 12;
  const MAX_JUMP = 20000;
  const MAX_ABS = 250000;
  const MAX_CONTOURS = 64;
  const MAX_POINTS_PER_CONTOUR = 4000;

  function isCoord(v) {
    return Number.isFinite(v) && Math.abs(v) <= MAX_ABS;
  }

  function polyStats(points) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const unique = new Set();
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
      const ux = Math.round(p.x * 100) / 100;
      const uy = Math.round(p.y * 100) / 100;
      unique.add(`${ux}:${uy}`);
    }
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
      uniquePoints: unique.size
    };
  }

  function makeEntity(points) {
    if (!Array.isArray(points) || points.length < MIN_POINTS) return null;
    const pts = points.length > MAX_POINTS_PER_CONTOUR ? points.slice(0, MAX_POINTS_PER_CONTOUR) : points;
    const st = polyStats(pts);
    if (!Number.isFinite(st.width) || !Number.isFinite(st.height)) return null;
    if (st.width < 1 || st.height < 1) return null;
    if (st.width > MAX_ABS || st.height > MAX_ABS) return null;
    if (st.uniquePoints < Math.max(6, Math.floor(pts.length * 0.2))) return null;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const dist = Math.hypot(dx, dy);
    const diag = Math.hypot(st.width, st.height);
    const closeTol = Math.max(2, diag * 0.02);
    return {
      type: "POLYLINE",
      closed: dist <= closeTol,
      points: pts
    };
  }

  const candidates = [];
  for (let align = 0; align <= 4; align += 4) {
    let run = [];
    let prev = null;
    for (let o = align; o + 8 <= buf.length; o += 8) {
      const x = buf.readFloatLE(o);
      const y = buf.readFloatLE(o + 4);
      if (!isCoord(x) || !isCoord(y)) {
        if (run.length >= MIN_POINTS) candidates.push(run);
        run = [];
        prev = null;
        continue;
      }
      const p = { x, y };
      if (prev) {
        const jump = Math.hypot(p.x - prev.x, p.y - prev.y);
        if (jump > MAX_JUMP) {
          if (run.length >= MIN_POINTS) candidates.push(run);
          run = [p];
          prev = p;
          continue;
        }
      }
      run.push(p);
      prev = p;
    }
    if (run.length >= MIN_POINTS) candidates.push(run);
  }

  const rawEntities = candidates
    .sort((a, b) => b.length - a.length)
    .map((pts) => makeEntity(pts))
    .filter(Boolean);

  const entities = [];
  const seen = new Set();
  for (const e of rawEntities) {
    const pts = e.points;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const key = [
      Math.round(minX),
      Math.round(minY),
      Math.round(maxX),
      Math.round(maxY),
      Math.round(pts.length / 5)
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    entities.push(e);
    if (entities.length >= MAX_CONTOURS) break;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let pointsCount = 0;
  for (const e of entities) {
    for (const p of e.points) {
      pointsCount++;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const bbox = Number.isFinite(minX)
    ? { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
    : null;

  return {
    entities,
    entityCount: entities.length,
    pointsCount,
    bbox,
    parser: {
      type: "pos_heuristic_f32",
      candidatesTotal: candidates.length
    }
  };
}

function parsePacGeometry(filePath) {
  const buf = fs.readFileSync(filePath);
  const MIN_POINTS = 24;
  const MAX_ABS = 50000;
  const MAX_JUMP = 250;
  const EPS = 0.01;
  const MAX_CONTOURS = 240;
  const MAX_POINTS_PER_CONTOUR = 3000;

  function extractPacPatternNames(binary) {
    const text = binary.toString("latin1").replace(/[^\x20-\x7E]+/g, "\n");
    const out = [];
    const seen = new Set();
    function cutTechnicalTail(s) {
      const markers = [];
      const rx = /(qs|ui|map|list|en|b|f|i|v|d)[A-Z][A-Za-z0-9_]{2,}/g;
      let m;
      while ((m = rx.exec(s)) !== null) {
        if (m.index > 2) markers.push(m.index);
      }
      if (markers.length) {
        const cut = Math.min(...markers);
        s = s.slice(0, cut);
      }
      return s;
    }
    function pushName(raw) {
      let n = String(raw || "").trim();
      if (!n) return;
      n = n.replace(/^["']+|["']+$/g, "");
      n = n.replace(/^(Pattern_)/i, "Pattern ");
      n = cutTechnicalTail(n);
      n = n.replace(/[_\-\s]+$/g, "");
      if (n.length < 2 || n.length > 80) return;
      if (/^((qs|ui|map|list|en|b|f|i|v|d)[A-Z])/.test(n)) return;
      if (/^(default|null|none|unknown)$/i.test(n)) return;
      if (/(colorway|texture|material|garment|simulation|property|manager|controller|version)/i.test(n)) return;
      if (!/[a-zA-Z]/.test(n)) return;
      if (seen.has(n.toLowerCase())) return;
      seen.add(n.toLowerCase());
      out.push(n);
    }

    const rxUtf = /qsNameUTF8([A-Za-z0-9 _\-\.\(\)\[\]]{2,80})/g;
    for (const m of text.matchAll(rxUtf)) pushName(m[1]);
    const rxAscii = /qsName([A-Za-z0-9 _\-\.\(\)\[\]]{2,80})/g;
    for (const m of text.matchAll(rxAscii)) pushName(m[1]);
    const rxPattern = /Pattern_([0-9]{3,12})/g;
    for (const m of text.matchAll(rxPattern)) pushName(`Pattern ${m[1]}`);
    return out.slice(0, 600);
  }

  function isCoord(v) {
    return Number.isFinite(v) && Math.abs(v) <= MAX_ABS;
  }

  function runStats(points) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const uniq = new Set();
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
      const ux = Math.round(p.x * 10) / 10;
      const uy = Math.round(p.y * 10) / 10;
      uniq.add(`${ux}:${uy}`);
    }
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
      uniquePoints: uniq.size
    };
  }

  const runs = [];
  for (let align = 0; align <= 4; align += 4) {
    let run = [];
    let prev = null;
    for (let o = align; o + 8 <= buf.length; o += 8) {
      const x = buf.readFloatLE(o);
      const y = buf.readFloatLE(o + 4);
      const ok = isCoord(x) && isCoord(y) && !(Math.abs(x) < EPS && Math.abs(y) < EPS);
      if (!ok) {
        if (run.length >= MIN_POINTS) runs.push(run);
        run = [];
        prev = null;
        continue;
      }
      const p = { x, y };
      if (prev) {
        const jump = Math.hypot(p.x - prev.x, p.y - prev.y);
        if (jump > MAX_JUMP) {
          if (run.length >= MIN_POINTS) runs.push(run);
          run = [p];
          prev = p;
          continue;
        }
      }
      run.push(p);
      prev = p;
    }
    if (run.length >= MIN_POINTS) runs.push(run);
  }

  const entities = [];
  const seen = new Set();
  const sorted = runs.sort((a, b) => b.length - a.length);
  for (const src of sorted) {
    const pts = src.length > MAX_POINTS_PER_CONTOUR ? src.slice(0, MAX_POINTS_PER_CONTOUR) : src;
    const st = runStats(pts);
    if (!Number.isFinite(st.width) || !Number.isFinite(st.height)) continue;
    if (st.width < 15 || st.height < 15) continue;
    if (st.uniquePoints < Math.max(16, Math.floor(pts.length * 0.6))) continue;
    const key = [
      Math.round(st.minX),
      Math.round(st.minY),
      Math.round(st.maxX),
      Math.round(st.maxY),
      Math.round(pts.length / 8)
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const first = pts[0];
    const last = pts[pts.length - 1];
    const closeDist = Math.hypot(last.x - first.x, last.y - first.y);
    const diag = Math.hypot(st.width, st.height);
    entities.push({
      type: "POLYLINE",
      closed: closeDist <= Math.max(3, diag * 0.03),
      points: pts
    });
    if (entities.length >= MAX_CONTOURS) break;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let pointsCount = 0;
  for (const e of entities) {
    for (const p of e.points) {
      pointsCount++;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const bbox = Number.isFinite(minX)
    ? { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
    : null;

  return {
    entities,
    entityCount: entities.length,
    pointsCount,
    bbox,
    meta: {
      patternNames: extractPacPatternNames(buf)
    },
    parser: {
      type: "pac_heuristic_f32",
      runsTotal: runs.length
    }
  };
}

function parseScriptJson(stdout) {
  const text = String(stdout || "").trim().replace(/^\uFEFF/, "");
  if (!text) return {};
  return JSON.parse(text);
}

function runCscript(scriptPath, args, timeoutMs = Number(process.env.FURLAB_CSCRIPT_TIMEOUT_MS || 120000)) {
  const safeTimeout = Math.max(5000, Math.min(30 * 60 * 1000, Number(timeoutMs) || 120000));
  const run = spawnSync(CSCRIPT_PATH, ["//nologo", scriptPath, ...args], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    timeout: safeTimeout
  });
  const stdout = String(run.stdout || "").trim();
  const stderr = String(run.stderr || "").trim();
  return { run, stdout, stderr };
}

function runCscriptAsync(scriptPath, args, timeoutMs = Number(process.env.FURLAB_CSCRIPT_TIMEOUT_MS || 120000)) {
  const safeTimeout = Math.max(5000, Math.min(30 * 60 * 1000, Number(timeoutMs) || 120000));
  return new Promise((resolve) => {
    const child = spawn(CSCRIPT_PATH, ["//nologo", scriptPath, ...args], { cwd: ROOT_DIR });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (run) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ run, stdout: stdout.trim(), stderr: stderr.trim() });
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => settle({ status: code, signal: null, error: null }));
    child.on("error", (err) => settle({ status: -1, signal: null, error: err }));
    const timer = setTimeout(() => {
      child.kill();
      settle({ status: -1, signal: "SIGTERM", error: new Error(`cscript timeout after ${safeTimeout}ms`) });
    }, safeTimeout);
    if (timer.unref) timer.unref();
  });
}

function runPowerShell(commandText, timeoutMs = 120000) {
  const run = spawnSync(
    "powershell",
    ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", commandText],
    {
      cwd: ROOT_DIR,
      encoding: "utf8",
      timeout: timeoutMs
    }
  );
  const stdout = String(run.stdout || "").trim();
  const stderr = String(run.stderr || "").trim();
  return { run, stdout, stderr };
}

function psPathLiteral(inputPath) {
  return String(inputPath || "").replace(/'/g, "''");
}

function runTar(args, timeoutMs = 120000) {
  const run = spawnSync("tar", args, {
    cwd: ROOT_DIR,
    encoding: "utf8",
    timeout: timeoutMs
  });
  const stdout = String(run.stdout || "").trim();
  const stderr = String(run.stderr || "").trim();
  return { run, stdout, stderr };
}

function safeSlug(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "project";
}

function uniqueStrings(items) {
  const seen = new Set();
  const out = [];
  for (const x of items) {
    const v = String(x || "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeDeg(v) {
  let x = Number(v);
  if (!Number.isFinite(x)) return null;
  x = x % 360;
  if (x < 0) x += 360;
  return x;
}

function transformScrapPointToWorld(p) {
  const x = safeNum(p && p.x);
  const y = safeNum(p && p.y);
  if (x === null || y === null) return null;
  // Mirror is forbidden in placement flow; keep source contour orientation as-is.
  return { x, y };
}

function transformScrapNapDegToWorld(v) {
  const d = normalizeDeg(v);
  // If nap is missing, use canonical "down" direction.
  return d === null ? 90 : d;
}

function deltaDeg(a, b) {
  const aa = normalizeDeg(a);
  const bb = normalizeDeg(b);
  if (aa === null || bb === null) return null;
  const d = Math.abs(aa - bb);
  return Math.min(d, 360 - d);
}

const NAP_EPS_DEG = 1e-6;

function isNapWithinTolerance(delta, toleranceDeg) {
  if (!Number.isFinite(delta)) return true;
  const tol = Number(toleranceDeg);
  if (!Number.isFinite(tol)) return true;
  if (tol <= 0) return delta <= NAP_EPS_DEG;
  return delta <= (tol + NAP_EPS_DEG);
}

function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) * 0.5;
}

function polygonBBox(points) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points || []) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function centroid(points) {
  if (!Array.isArray(points) || points.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function randomPointInPolygon(poly, bbox, maxAttempts = 400, randFn = Math.random) {
  for (let i = 0; i < maxAttempts; i++) {
    const x = bbox.minX + randFn() * bbox.width;
    const y = bbox.minY + randFn() * bbox.height;
    if (pointInPolygon({ x, y }, poly)) return { x, y };
  }
  return centroid(poly);
}

function clipPolygonByHalfPlane(poly, nx, ny, c) {
  const out = [];
  if (!Array.isArray(poly) || poly.length < 3) return out;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = nx * a.x + ny * a.y + c;
    const db = nx * b.x + ny * b.y + c;
    const ina = da >= 0;
    const inb = db >= 0;
    if (ina && inb) {
      out.push({ x: b.x, y: b.y });
    } else if (ina && !inb) {
      const t = da / (da - db || 1e-9);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    } else if (!ina && inb) {
      const t = da / (da - db || 1e-9);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      out.push({ x: b.x, y: b.y });
    }
  }
  return out;
}

function clipPolygonToRect(poly, x0, y0, x1, y1) {
  let out = poly;
  out = clipPolygonByHalfPlane(out, 1, 0, -x0);
  out = clipPolygonByHalfPlane(out, -1, 0, x1);
  out = clipPolygonByHalfPlane(out, 0, 1, -y0);
  out = clipPolygonByHalfPlane(out, 0, -1, y1);
  return out;
}

function clipPolygonByPolygon(subject, clipper) {
  if (!Array.isArray(subject) || subject.length < 3) return [];
  if (!Array.isArray(clipper) || clipper.length < 3) return [];
  const ccw = polygonArea(clipper) >= 0;
  let out = subject.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
  for (let i = 0; i < clipper.length; i++) {
    const a = clipper[i];
    const b = clipper[(i + 1) % clipper.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const nx = ccw ? ey : -ey;
    const ny = ccw ? -ex : ex;
    const c = -(nx * a.x + ny * a.y);
    out = clipPolygonByHalfPlane(out, nx, ny, c);
    if (!Array.isArray(out) || out.length < 3) return [];
  }
  return out;
}

function splitPolygonByLine(poly, px, py, dx, dy) {
  const nx = -Number(dy || 0);
  const ny = Number(dx || 0);
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || (Math.abs(nx) < 1e-9 && Math.abs(ny) < 1e-9)) return [];
  const c = -((nx * Number(px || 0)) + (ny * Number(py || 0)));
  const a = clipPolygonByHalfPlane(poly, nx, ny, c);
  const b = clipPolygonByHalfPlane(poly, -nx, -ny, -c);
  const out = [];
  if (Array.isArray(a) && a.length >= 3) out.push(a);
  if (Array.isArray(b) && b.length >= 3) out.push(b);
  return out;
}

function clipPolygonByBand(poly, nx, ny, lower, upper) {
  let out = clipPolygonByHalfPlane(poly, nx, ny, -lower);
  out = clipPolygonByHalfPlane(out, -nx, -ny, upper);
  return out;
}

function buildRoundedRectPolygon(x0, y0, x1, y1, radiusMm) {
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const rRaw = Math.max(0, safeNum(radiusMm) || 0);
  const r = Math.max(0, Math.min(rRaw, Math.max(0, Math.min(w, h) * 0.5 - 1e-6)));
  if (!(w > 0 && h > 0)) return [];
  if (!(r > 1e-9)) {
    return [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 }
    ];
  }
  const seg = 4;
  const pts = [];
  const addArc = (cx, cy, a0, a1) => {
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const a = a0 + (a1 - a0) * t;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  };
  addArc(x1 - r, y0 + r, -Math.PI / 2, 0);
  addArc(x1 - r, y1 - r, 0, Math.PI / 2);
  addArc(x0 + r, y1 - r, Math.PI / 2, Math.PI);
  addArc(x0 + r, y0 + r, Math.PI, Math.PI * 1.5);
  return pts;
}

function multiPolygonOuterRingsToPoints(mp) {
  const out = [];
  if (!Array.isArray(mp)) return out;
  for (const poly of mp) {
    if (!Array.isArray(poly) || !Array.isArray(poly[0]) || poly[0].length < 4) continue;
    const ring = poly[0];
    const pts = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const p = ring[i];
      const x = Number(p && p[0]);
      const y = Number(p && p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push({ x, y });
    }
    if (pts.length >= 3) out.push(pts);
  }
  return out;
}

function normalizePolygonInput(points) {
  if (!Array.isArray(points)) return [];
  const out = [];
  for (const p of points) {
    const x = safeNum(p && p.x);
    const y = safeNum(p && p.y);
    if (x === null || y === null) continue;
    out.push({ x, y });
  }
  return out;
}


const {
  generateVoronoiFragments,
  generateRegularFragments,
  generateShiftedFragments,
  generateDiagonalFragments,
  generateRadialFragments,
} = require("./services/fragment_generators");

function scoreCandidateForZone(cand, ctx) {
  const cArea = safeNum(cand.areaMm2);
  const cW = safeNum(cand.bboxWidthMm);
  const cH = safeNum(cand.bboxHeightMm);
  if (cArea === null || cW === null || cH === null) return null;
  const along = ctx.axis === "x" ? cW : cH;
  const across = ctx.axis === "x" ? cH : cW;
  if (ctx.minAlongMm !== null && along < ctx.minAlongMm) return null;
  if (ctx.maxAlongMm !== null && along > ctx.maxAlongMm) return null;
  if (ctx.minAcrossMm !== null && across < ctx.minAcrossMm) return null;
  if (ctx.maxAcrossMm !== null && across > ctx.maxAcrossMm) return null;
  if (ctx.minAreaMm2 !== null && cArea < ctx.minAreaMm2) return null;
  if (ctx.maxAreaMm2 !== null && cArea > ctx.maxAreaMm2) return null;

  let score = 0;
  if (ctx.zoneArea > 0) {
    const r = Math.min(1.3, cArea / ctx.zoneArea);
    score += 50 * (1 - Math.abs(1 - r));
  }
  const zoneAspect = ctx.zoneAspect > 0 ? ctx.zoneAspect : 1;
  const cAspect = Math.max(cW, cH) / Math.max(1e-9, Math.min(cW, cH));
  score += 30 * (1 - Math.min(1, Math.abs(cAspect - zoneAspect) / 2));

  if (ctx.napDirectionDeg !== null && ctx.napToleranceDeg !== null) {
    const d = deltaDeg(ctx.napDirectionDeg, cand.napDirectionDeg);
    if (d !== null) {
      if (d > ctx.napToleranceDeg) return null;
      score += 20 * (1 - d / Math.max(1, ctx.napToleranceDeg));
    }
  }
  return Math.round(score * 1000) / 1000;
}

function normalizeScale10(v, fallback = 5) {
  const n = safeNum(v);
  if (n === null) return fallback;
  if (n <= 10) return Math.max(1, Math.min(10, n));
  return Math.max(1, Math.min(10, n / 10));
}

function applyNormalizeRules(rawFragments, normalizeRules, axis) {
  const rules = normalizeRules && typeof normalizeRules === "object" ? normalizeRules : {};
  const minW = safeNum(rules.minFragmentWidthMm);
  const minL = safeNum(rules.minFragmentLengthMm);
  const simplifyTol = safeNum(rules.simplifyToleranceMm);
  const minAlongMm = safeNum(rules.fragmentMinAlongMm);
  const minAcrossMm = safeNum(rules.fragmentMinAcrossMm);
  const maxAlongMm = safeNum(rules.fragmentMaxAlongMm);
  const maxAcrossMm = safeNum(rules.fragmentMaxAcrossMm);

  const threshW = minW !== null ? minW : 0;
  const threshL = minL !== null ? minL : 0;
  const threshAlong = minAlongMm !== null ? minAlongMm : 0;
  const threshAcross = minAcrossMm !== null ? minAcrossMm : 0;
  const effectiveThreshAlong = Math.max(threshL, threshAlong);
  const effectiveThreshAcross = Math.max(threshW, threshAcross);
  const hasThreshold = effectiveThreshAlong > 0 || effectiveThreshAcross > 0;

  function fragAlong(bbox) { return axis === "x" ? bbox.width : bbox.height; }
  function fragAcross(bbox) { return axis === "x" ? bbox.height : bbox.width; }

  function isSmall(pts) {
    if (!hasThreshold) return false;
    const bbox = polygonBBox(pts);
    if (!bbox) return true;
    if (effectiveThreshAlong > 0 && fragAlong(bbox) < effectiveThreshAlong) return true;
    if (effectiveThreshAcross > 0 && fragAcross(bbox) < effectiveThreshAcross) return true;
    return false;
  }

  function splitToMaxSize(pts, depth) {
    if (depth > 6) return [pts];
    const bbox = polygonBBox(pts);
    if (!bbox) return [pts];
    const along = fragAlong(bbox);
    const across = fragAcross(bbox);
    const overAlong = maxAlongMm !== null && maxAlongMm > 0 && along > maxAlongMm;
    const overAcross = maxAcrossMm !== null && maxAcrossMm > 0 && across > maxAcrossMm;
    if (!overAlong && !overAcross) return [pts];
    let splitParts;
    if (overAlong) {
      const mid = axis === "x"
        ? (bbox.minX + bbox.maxX) / 2
        : (bbox.minY + bbox.maxY) / 2;
      if (axis === "x") {
        splitParts = splitPolygonByLine(pts, mid, 0, 0, 1);
      } else {
        splitParts = splitPolygonByLine(pts, 0, mid, 1, 0);
      }
    } else {
      const mid = axis === "x"
        ? (bbox.minY + bbox.maxY) / 2
        : (bbox.minX + bbox.maxX) / 2;
      if (axis === "x") {
        splitParts = splitPolygonByLine(pts, 0, mid, 1, 0);
      } else {
        splitParts = splitPolygonByLine(pts, mid, 0, 0, 1);
      }
    }
    if (!splitParts || splitParts.length < 2) return [pts];
    const result = [];
    for (const part of splitParts) {
      const sub = splitToMaxSize(part, depth + 1);
      for (const s of sub) result.push(s);
    }
    return result;
  }

  const expandedFragments = [];
  let nextId = rawFragments.reduce((mx, f) => Math.max(mx, Number(f.id || 0)), 0) + 1;
  for (const f of rawFragments) {
    if (!Array.isArray(f.points) || f.points.length < 3) continue;
    if (maxAlongMm !== null || maxAcrossMm !== null) {
      const parts = splitToMaxSize(f.points, 0);
      if (parts.length === 1) {
        expandedFragments.push(f);
      } else {
        for (const part of parts) {
          expandedFragments.push({ ...f, id: nextId++, points: part, areaMm2: polygonArea(part) });
        }
      }
    } else {
      expandedFragments.push(f);
    }
  }

  const large = [];
  for (const f of expandedFragments) {
    if (!Array.isArray(f.points) || f.points.length < 3) continue;
    large.push({ ...f, areaMm2: polygonArea(f.points) });
  }

  const mergedCount = 0;

  const seamReserve = safeNum(rules.seamAllowanceReserveMm);
  const out = [];
  for (const f of large) {
    let pts = f.points;
    if (simplifyTol !== null && simplifyTol > 0 && pts.length > 8) {
      const step = Math.max(1, Math.min(8, Math.round(simplifyTol / 2)));
      pts = pts.filter((_, i) => i % step === 0);
      if (pts.length < 3) pts = f.points;
    }
    const entry = { ...f, points: pts, areaMm2: polygonArea(pts) };
    if (seamReserve !== null && seamReserve > 0) {
      entry.cutPoints = outsetPath(pts, seamReserve);
    }
    out.push(entry);
  }

  return { fragments: out, droppedBySize: 0, mergedCount };
}

function buildFragmentCoverageSamples(fragmentPoints, targetCount) {
  const pts = Array.isArray(fragmentPoints) ? fragmentPoints : [];
  if (pts.length < 3) return [];
  const bb = polygonBBox(pts);
  if (!bb) return [];
  const target = Math.max(120, Math.min(900, Number(targetCount || 260)));
  const nx = Math.max(8, Math.min(40, Math.round(Math.sqrt(target * Math.max(0.35, bb.width / Math.max(1, bb.height))))));
  const ny = Math.max(8, Math.min(40, Math.round(target / Math.max(1, nx))));
  const dx = bb.width / nx;
  const dy = bb.height / ny;
  const out = [];
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const p = { x: bb.minX + (ix + 0.5) * dx, y: bb.minY + (iy + 0.5) * dy };
      if (pointInPolygon(p, pts)) out.push(p);
    }
  }
  if (out.length >= 36) return out;
  const fallback = samplePolyline(pts, Math.max(48, target));
  return fallback.filter((p) => pointInPolygon(p, pts));
}

function evaluateCoverageGainBySamples(samples, coveredFlags, contour) {
  if (!Array.isArray(samples) || !samples.length || !Array.isArray(contour) || contour.length < 3) {
    return { gainCount: 0, totalInsideCount: 0, coveredInsideCount: 0 };
  }
  let gainCount = 0;
  let totalInsideCount = 0;
  let coveredInsideCount = 0;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    if (!pointInPolygon(p, contour)) continue;
    totalInsideCount += 1;
    if (coveredFlags[i]) coveredInsideCount += 1;
    else gainCount += 1;
  }
  return { gainCount, totalInsideCount, coveredInsideCount };
}

function pushRejectedSample(map, reason, sample, limit = 12) {
  if (!map || typeof map !== "object") return;
  const key = String(reason || "unknown");
  const bucket = Array.isArray(map[key]) ? map[key] : [];
  if (bucket.length < limit) bucket.push(sample);
  map[key] = bucket;
}

function assignCandidatesRegularByFragmentCoverage({
  fragments,
  pool,
  used,
  minAcceptFit,
  constraints,
  safeNum,
  polygonArea,
  evaluateFragmentCandidateFit,
  normalizeDeg
}) {
  const placements = [];
  const breakdown = {
    mode: "regular_fragment_whole_piece_v3",
    checkedPairs: 0,
    rejected: {},
    rejectedSamples: {},
    fragmentCoverage: []
  };
  function markReject(reason, sample) {
    const k = String(reason || "unknown");
    breakdown.rejected[k] = Number(breakdown.rejected[k] || 0) + 1;
    if (sample) pushRejectedSample(breakdown.rejectedSamples, k, sample);
  }

  const maxPiecesPerFragmentRaw = safeNum(constraints && constraints.maxPiecesPerFragment);
  const maxPiecesPerFragment = maxPiecesPerFragmentRaw === null
    ? 1
    : Math.max(1, Math.min(2, Number(maxPiecesPerFragmentRaw)));
  const targetCoverageRaw = safeNum(constraints && constraints.fragmentCoverageTarget);
  const fragmentCoverageTarget = targetCoverageRaw === null
    ? 0.94
    : Math.max(0.9, Math.min(1, Number(targetCoverageRaw)));
  const enforceRegularQuality = true;
  const minCoverageAcceptRaw = safeNum(constraints && constraints.fragmentCoverageMinAccept);
  const fragmentCoverageMinAccept = minCoverageAcceptRaw === null
    ? fragmentCoverageTarget
    : Math.max(0.9, Math.min(1, Number(minCoverageAcceptRaw)));
  const reserveRaw = safeNum(constraints && constraints.pieceSeamReserveMm);
  const reserveAlias = safeNum(constraints && constraints.seamAllowanceReserveMm);
  const pieceSeamReserveMm = Math.max(0, Number(reserveRaw === null ? (reserveAlias === null ? 0 : reserveAlias) : reserveRaw));
  const debugTopKRaw = Number(constraints && constraints.__debugTopK);
  const debugTopK = Number.isFinite(debugTopKRaw) && debugTopKRaw > 0
    ? Math.max(1, Math.min(8, Math.floor(debugTopKRaw)))
    : 0;
  const topChoicesByFragment = debugTopK > 0 ? {} : null;
  function summarizeCandidate(candidate, fit, score, sampleCoverage, meta) {
    return {
      scrapPieceId: String(candidate && candidate.id || ""),
      inventoryTag: String(candidate && candidate.inventoryTag || ""),
      score: Math.round(Number(score || 0) * 1000) / 1000,
      fitScore: Math.round(Number(fit && fit.fitScore || 0) * 1000) / 1000,
      fitCoverageRatio: Math.round(Number(sampleCoverage || 0) * 1000) / 1000,
      fitInsidePercent: Math.round(Number(fit && fit.insidePercent || 0) * 10) / 10,
      outsidePercent: Math.round(Number((meta && meta.outsideRatio) || 0) * 1000 * 100) / 1000,
      scoreBreakdown: {
        fitScoreNorm: Math.round(Math.max(0, Math.min(1, Number(fit && fit.fitScore || 0) / 100)) * 1000) / 1000,
        overlapNorm: Math.round(Math.max(0, Math.min(1, Number(fit && fit.overlapApprox || 0))) * 1000) / 1000,
        areaRatioNorm: Math.round(Math.max(0, Math.min(1, Number(fit && fit.areaRatio || 0))) * 1000) / 1000,
        insideRatio: Math.round(Number((meta && meta.insideRatio) || 0) * 1000) / 1000,
        outsideRatio: Math.round(Number((meta && meta.outsideRatio) || 0) * 1000) / 1000,
        sampleCoverage: Math.round(Number(sampleCoverage || 0) * 1000) / 1000,
        coverageOverflow: Math.round(Math.max(0, Number(fit && fit.coverageRatio || 0) - 1) * 1000) / 1000
      }
    };
  }
  const workFragments = Array.isArray(fragments) ? fragments : [];
  const availablePool = (Array.isArray(pool) ? pool : []).filter((c) => {
    const key = String(c && (c.id || c.inventoryTag) || "");
    return !!key && !used.has(key);
  });
  const rows = workFragments.length;
  const realCols = availablePool.length;
  const dummyCols = rows;
  const cols = realCols + dummyCols;
  const BIG = 1e7;
  const fitGrid = Array.from({ length: rows }, () => new Array(realCols).fill(null));
  const scoreGrid = Array.from({ length: rows }, () => new Array(realCols).fill(null));
  const coverageGrid = Array.from({ length: rows }, () => new Array(realCols).fill(0));
  const metaGrid = Array.from({ length: rows }, () => new Array(realCols).fill(null));
  const pairFitGrid = Array.from({ length: rows }, () => new Array(realCols).fill(null));
  const pairCoverageGrid = Array.from({ length: rows }, () => new Array(realCols).fill(0));
  const pairMetaGrid = Array.from({ length: rows }, () => new Array(realCols).fill(null));
  const regularCompatibility = !!(constraints && constraints.regularCompatibility === true);
  const perFragmentCapRaw = safeNum(constraints && constraints.maxCandidatesPerFragment);
  const perFragmentCap = perFragmentCapRaw === null
    ? (regularCompatibility ? Math.min(Math.max(32, realCols), 64) : 18)
    : Math.max(8, Math.min(regularCompatibility ? 96 : 48, Number(perFragmentCapRaw)));
  const samplePointsByFragment = new Array(rows);
  const rankedChoicesByFragment = new Array(rows);

  function retargetPairPieceToResidual(fragment, candidate, fit, coveredMask, samplePoints) {
    const fragPoints = Array.isArray(fragment && fragment.points) ? fragment.points : [];
    const baseFullContour = Array.isArray(fit && fit.alignedContour) ? fit.alignedContour : [];
    if (fragPoints.length < 3 || baseFullContour.length < 3 || !Array.isArray(samplePoints) || !samplePoints.length) {
      return null;
    }
    const uncoveredPoints = samplePoints.filter((_, idx) => !coveredMask[idx]);
    if (!uncoveredPoints.length) return null;
    const residualCenter = centroid(uncoveredPoints);
    const baseCenter = centroid(baseFullContour);
    const shiftedBase = translatePoints(baseFullContour, residualCenter.x - baseCenter.x, residualCenter.y - baseCenter.y);
    const fb = polygonBBox(fragPoints) || { width: 0, height: 0 };
    const shiftX = [0, -0.10 * fb.width, 0.10 * fb.width, -0.18 * fb.width, 0.18 * fb.width];
    const shiftY = [0, -0.10 * fb.height, 0.10 * fb.height, -0.18 * fb.height, 0.18 * fb.height];
    let best = null;
    for (const dx of shiftX) {
      for (const dy of shiftY) {
        const fullContour = translatePoints(shiftedBase, dx, dy);
        let coreContour = fullContour;
        let seamStatus = "disabled";
        if (pieceSeamReserveMm > 0) {
          const core = buildPieceWorkingContour(fullContour, pieceSeamReserveMm);
          seamStatus = String(core && core.status || "failed");
          if (core && core.applied && Array.isArray(core.contour) && core.contour.length >= 3) {
            coreContour = core.contour;
          }
        }
        const cov = evaluateCoverageGainBySamples(samplePoints, coveredMask, coreContour);
        if (cov.totalInsideCount <= 0 || cov.gainCount <= 0) continue;
        const detailed = evaluateCandidateContourAgainstFragmentDetailed(
          fullContour,
          fragment,
          candidate,
          constraints,
          {
            rotationDeg: safeNum(fit && fit.rotationDeg) || 0,
            offsetX: (safeNum(fit && fit.offsetX) || 0) + (residualCenter.x - baseCenter.x) + dx,
            offsetY: (safeNum(fit && fit.offsetY) || 0) + (residualCenter.y - baseCenter.y) + dy
          }
        );
        const nextFit = detailed && detailed.fit ? detailed.fit : null;
        if (!nextFit) continue;
        const gainRatio = samplePoints.length > 0 ? (Number(cov.gainCount || 0) / samplePoints.length) : 0;
        const insideRatio = Math.max(0, Math.min(1, Number(nextFit.insidePercent || 0) / 100));
        const outsideRatio = Math.max(0, 1 - insideRatio);
        const score =
          gainRatio * 220 +
          Math.max(0, Math.min(1, Number(nextFit.fitScore || 0) / 100)) * 55 -
          outsideRatio * 18;
        if (!best || score > best.score) {
          best = { score, fit: nextFit, coreContour, seamStatus, insideRatio, outsideRatio, gainRatio };
        }
      }
    }
    return best;
  }

  function contourOverlapInFragmentRatio(fragment, contourA, contourB) {
    const fragPoints = Array.isArray(fragment && fragment.points) ? fragment.points : [];
    const aPoints = Array.isArray(contourA) ? contourA : [];
    const bPoints = Array.isArray(contourB) ? contourB : [];
    if (fragPoints.length < 3 || aPoints.length < 3 || bPoints.length < 3) return 0;
    try {
      const fragMp = pointsToMultiPolygon(fragPoints);
      const aMp = intersectMulti(pointsToMultiPolygon(aPoints), fragMp);
      const bMp = intersectMulti(pointsToMultiPolygon(bPoints), fragMp);
      const areaA = Math.max(0, multiPolygonArea(aMp));
      const areaB = Math.max(0, multiPolygonArea(bMp));
      if (areaA <= 1e-6 || areaB <= 1e-6) return 0;
      const overlap = Math.max(0, multiPolygonArea(intersectMulti(aMp, bMp)));
      return overlap / Math.max(1e-6, Math.min(areaA, areaB));
    } catch (_) {
      return 0;
    }
  }

  for (let i = 0; i < rows; i++) {
    const f = workFragments[i];
    const samplePoints = buildFragmentCoverageSamples((f && f.points) || [], 260);
    samplePointsByFragment[i] = samplePoints;
    const ranked = [];
    for (let j = 0; j < realCols; j++) {
      const q = quickFragmentCandidateScore(f, availablePool[j], constraints);
      if (q === null) continue;
      ranked.push({ j, q });
    }
    ranked.sort((a, b) => b.q - a.q);
    const top = new Set(ranked.slice(0, perFragmentCap).map((x) => x.j));
    rankedChoicesByFragment[i] = ranked.slice(0, perFragmentCap).map((x) => x.j);

    for (let j = 0; j < realCols; j++) {
      if (!top.has(j)) continue;
      const c = availablePool[j];
      breakdown.checkedPairs += 1;
      const fitDiag = evaluateFragmentCandidateFitDetailed(f, c, constraints);
      const fit = fitDiag && fitDiag.fit ? fitDiag.fit : null;
      if (!fit) {
        markReject(
          fitDiag && fitDiag.rejectReason ? fitDiag.rejectReason : "fit_null",
          {
            fragmentId: Number(f && f.id || 0),
            inventoryTag: String(c && c.inventoryTag || ""),
            scrapPieceId: String(c && c.id || "")
          }
        );
        continue;
      }
      if (Number(fit.fitScore || 0) + 1e-9 < minAcceptFit) {
        markReject("fit_score_low", {
          fragmentId: Number(f && f.id || 0),
          inventoryTag: String(c && c.inventoryTag || ""),
          scrapPieceId: String(c && c.id || "")
        });
        continue;
      }
      const fullContour = Array.isArray(fit.alignedContour) ? fit.alignedContour : [];
      if (fullContour.length < 3) {
        markReject("aligned_contour_missing", {
          fragmentId: Number(f && f.id || 0),
          inventoryTag: String(c && c.inventoryTag || ""),
          scrapPieceId: String(c && c.id || "")
        });
        continue;
      }
      let coreContour = fullContour;
      let seamStatus = "disabled";
      if (pieceSeamReserveMm > 0) {
        const core = buildPieceWorkingContour(fullContour, pieceSeamReserveMm);
        seamStatus = String(core && core.status || "failed");
        if (core && core.applied && Array.isArray(core.contour) && core.contour.length >= 3) {
          coreContour = core.contour;
        }
      }
      const gain = evaluateCoverageGainBySamples(samplePoints, new Array(samplePoints.length).fill(false), coreContour);
      if (gain.totalInsideCount <= 0 || gain.gainCount <= 0) {
        markReject("zero_gain", {
          fragmentId: Number(f && f.id || 0),
          inventoryTag: String(c && c.inventoryTag || ""),
          scrapPieceId: String(c && c.id || "")
        });
        continue;
      }
      const coverageBySamples = samplePoints.length > 0 ? gain.gainCount / samplePoints.length : 0;
      const insideRatio = Math.max(0, Math.min(1, Number(fit.insidePercent || 0) / 100));
      const outsideRatio = Math.max(0, 1 - insideRatio);
      const fitScoreNorm = Math.max(0, Math.min(1, Number(fit.fitScore || 0) / 100));
      const overlapNorm = Math.max(0, Math.min(1, Number(fit.overlapApprox || 0)));
      const areaRatioNorm = Math.max(0, Math.min(1, Number(fit.areaRatio || 0)));
      const coverageOverflow = Math.max(0, Number(fit.coverageRatio || 0) - 1);
      const score =
        coverageBySamples * 150 +
        fitScoreNorm * 95 +
        overlapNorm * 55 +
        areaRatioNorm * 45 -
        Math.min(1, coverageOverflow) * 25 -
        outsideRatio * 20 +
        insideRatio * 10;
      pairFitGrid[i][j] = fit;
      pairCoverageGrid[i][j] = coverageBySamples;
      pairMetaGrid[i][j] = { coreContour, seamStatus, insideRatio, outsideRatio };
      if (coverageBySamples + 1e-9 < fragmentCoverageTarget) {
        markReject("fragment_not_fully_covered", {
          fragmentId: Number(f && f.id || 0),
          inventoryTag: String(c && c.inventoryTag || ""),
          scrapPieceId: String(c && c.id || "")
        });
        continue;
      }
      fitGrid[i][j] = fit;
      scoreGrid[i][j] = score;
      coverageGrid[i][j] = coverageBySamples;
      metaGrid[i][j] = { coreContour, seamStatus, insideRatio, outsideRatio };
    }
    if (topChoicesByFragment) {
      const tops = [];
      for (let j = 0; j < realCols; j++) {
        if (!fitGrid[i][j] || !metaGrid[i][j] || !Number.isFinite(scoreGrid[i][j])) continue;
        tops.push({
          j,
          score: Number(scoreGrid[i][j] || 0)
        });
      }
      tops.sort((a, b) => b.score - a.score);
      topChoicesByFragment[String(f.id)] = {
        fragmentId: Number(f.id || 0),
        fragmentClass: "regular",
        selected: null,
        topCandidates: tops.slice(0, debugTopK).map((item) => summarizeCandidate(
          availablePool[item.j],
          fitGrid[i][item.j],
          scoreGrid[i][item.j],
          coverageGrid[i][item.j],
          metaGrid[i][item.j]
        )),
        decision: "pending_assignment"
      };
    }
  }

  let maxScore = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < realCols; j++) {
      const s = Number(scoreGrid[i][j]);
      if (Number.isFinite(s) && s > maxScore) maxScore = s;
    }
  }
  maxScore = Math.max(1, maxScore);
  const cost = [];
  for (let i = 0; i < rows; i++) {
    const row = [];
    for (let j = 0; j < realCols; j++) {
      const s = scoreGrid[i][j];
      row.push(Number.isFinite(s) ? (maxScore - s) : BIG);
    }
    for (let j = 0; j < dummyCols; j++) row.push(maxScore + 5);
    cost.push(row);
  }

  const assignment = rows > 0 && cols > 0 ? hungarianMinCost(cost) : [];
  const unmatchedRows = [];
  for (let i = 0; i < rows; i++) {
    const f = workFragments[i];
    const fArea = safeNum(f && f.areaMm2) || polygonArea((f && f.points) || []);
    const col = Array.isArray(assignment) ? assignment[i] : -1;
    if (col >= 0 && col < realCols && fitGrid[i][col] && metaGrid[i][col]) {
      const c = availablePool[col];
      const fit = fitGrid[i][col];
      const meta = metaGrid[i][col];
      const key = String(c && (c.id || c.inventoryTag) || "");
      if (key) used.add(key);
      const baseNap = safeNum(c && c.napDirectionDeg);
      const rotDeg = Number(Math.round((Number(fit && fit.rotationDeg || 0)) * 10) / 10);
      const napEffectiveDeg = (baseNap === null) ? null : normalizeDeg(baseNap + rotDeg);
      placements.push({
        fragmentId: f.id,
        fragmentAreaMm2: fArea,
        scrapPieceId: String(c && c.id || ""),
        inventoryTag: String(c && c.inventoryTag || ""),
        scrapContour: String(c && c.scrapContour || ""),
        napDirectionDeg: safeNum(c && c.napDirectionDeg),
        bboxWidthMm: safeNum(c && c.bboxWidthMm),
        bboxHeightMm: safeNum(c && c.bboxHeightMm),
        fitScore: Math.round(Number(fit && fit.fitScore || 0) * 1000) / 1000,
        fitAreaRatio: Math.round(Number(fit && fit.areaRatio || 0) * 1000) / 1000,
        fitCoverageRatio: Math.round(Number(fit && fit.coverageRatio || 0) * 1000) / 1000,
        fitOverlap: Math.round(Number(fit && fit.overlapApprox || 0) * 1000) / 1000,
        fitInsidePercent: Math.round(Number(fit && fit.insidePercent || 0) * 10) / 10,
        fitChamferMm: Math.round(Number(fit && fit.chamferMm || 0) * 100) / 100,
        napDeltaDeg: (fit && fit.napDeltaDeg !== null) ? Math.round(Number(fit.napDeltaDeg) * 10) / 10 : null,
        alignRotationDeg: rotDeg,
        napEffectiveDeg,
        alignOffsetX: Math.round(Number(fit && fit.offsetX || 0) * 100) / 100,
        alignOffsetY: Math.round(Number(fit && fit.offsetY || 0) * 100) / 100,
        alignedContour: Array.isArray(fit && fit.alignedContour) ? fit.alignedContour : null,
        alignedCoreContour: Array.isArray(meta.coreContour) ? meta.coreContour : null,
        seamReserveMm: pieceSeamReserveMm,
        seamStatus: meta.seamStatus,
        fragmentCoverageRatio: Math.round(Number(coverageGrid[i][col] || 0) * 1000) / 1000,
        fragmentGainCoverageRatio: Math.round(Number(coverageGrid[i][col] || 0) * 1000) / 1000,
        insideRatio: Math.round(Number(meta.insideRatio || 0) * 1000) / 1000,
        outsideRatio: Math.round(Number(meta.outsideRatio || 0) * 1000) / 1000,
        fragmentPieceIndex: 1,
        status: "matched"
      });
      if (topChoicesByFragment && topChoicesByFragment[String(f.id)]) {
        topChoicesByFragment[String(f.id)].selected = summarizeCandidate(
          c,
          fit,
          scoreGrid[i][col],
          coverageGrid[i][col],
          meta
        );
        topChoicesByFragment[String(f.id)].decision = "max_score_global_one_piece";
      }
      breakdown.fragmentCoverage.push({
        fragmentId: Number(f && f.id || 0),
        piecesUsed: 1,
        coverageRatio: Math.round(Number(coverageGrid[i][col] || 0) * 1000) / 1000,
        coveredByTarget: true,
        coveredByMinAccept: true
      });
    } else {
      unmatchedRows.push(i);
    }
  }

  if (regularCompatibility && maxPiecesPerFragment > 1 && unmatchedRows.length > 0) {
    const pairCoverageMinAccept = Math.max(0.82, fragmentCoverageMinAccept - 0.10);
    for (const i of unmatchedRows) {
      const f = workFragments[i];
      const fArea = safeNum(f && f.areaMm2) || polygonArea((f && f.points) || []);
      const samplePoints = Array.isArray(samplePointsByFragment[i]) ? samplePointsByFragment[i] : [];
      const rankedIndexes = Array.isArray(rankedChoicesByFragment[i]) ? rankedChoicesByFragment[i] : [];
      const availableIndexes = rankedIndexes.filter((j) => {
        const c = availablePool[j];
        const key = String(c && (c.id || c.inventoryTag) || "");
        return !!key && !used.has(key) && pairFitGrid[i][j] && pairMetaGrid[i][j];
      }).slice(0, 18);
      let bestPair = null;
      for (let a = 0; a < availableIndexes.length; a++) {
        const j1 = availableIndexes[a];
        const fit1 = pairFitGrid[i][j1];
        const meta1 = pairMetaGrid[i][j1];
        const cov1 = evaluateCoverageGainBySamples(samplePoints, new Array(samplePoints.length).fill(false), meta1.coreContour);
        const covered1 = Array.isArray(cov1.insideMask) ? cov1.insideMask.slice() : new Array(samplePoints.length).fill(false);
        const ratio1 = samplePoints.length > 0 ? (Number(cov1.gainCount || 0) / samplePoints.length) : 0;
        for (let b = a + 1; b < availableIndexes.length; b++) {
          const j2 = availableIndexes[b];
          let fit2 = pairFitGrid[i][j2];
          let meta2 = pairMetaGrid[i][j2];
          let cov2 = evaluateCoverageGainBySamples(samplePoints, covered1, meta2.coreContour);
          let ratio2 = samplePoints.length > 0 ? (Number(cov2.gainCount || 0) / samplePoints.length) : 0;
          const residualFit2 = retargetPairPieceToResidual(f, availablePool[j2], fit2, covered1, samplePoints);
          if (residualFit2 && residualFit2.gainRatio > ratio2 + 1e-6) {
            fit2 = residualFit2.fit;
            meta2 = {
              coreContour: residualFit2.coreContour,
              seamStatus: residualFit2.seamStatus,
              insideRatio: residualFit2.insideRatio,
              outsideRatio: residualFit2.outsideRatio
            };
            ratio2 = residualFit2.gainRatio;
            cov2 = evaluateCoverageGainBySamples(samplePoints, covered1, meta2.coreContour);
          }
          const cov2Raw = evaluateCoverageGainBySamples(samplePoints, new Array(samplePoints.length).fill(false), meta2.coreContour);
          const ratio2Raw = samplePoints.length > 0 ? (Number(cov2Raw.gainCount || 0) / samplePoints.length) : 0;
          const overlapSampleRatio = Math.max(0, ratio2Raw - ratio2);
          const overlapPieceRatio = overlapSampleRatio / Math.max(0.001, Math.min(Math.max(0.001, ratio1), Math.max(0.001, ratio2Raw)));
          const overlapGeometryRatio = contourOverlapInFragmentRatio(f, meta1.coreContour, meta2.coreContour);
          if (overlapPieceRatio > 0.28) continue;
          const totalRatio = Math.max(ratio1, Math.min(1, ratio1 + ratio2));
          if (totalRatio + 1e-9 < pairCoverageMinAccept) continue;
          const fit1Norm = Math.max(0, Math.min(1, Number(fit1 && fit1.fitScore || 0) / 100));
          const fit2Norm = Math.max(0, Math.min(1, Number(fit2 && fit2.fitScore || 0) / 100));
          const outsidePenalty = Number(meta1 && meta1.outsideRatio || 0) + Number(meta2 && meta2.outsideRatio || 0);
          const balancePenalty = Math.abs(ratio1 - ratio2);
          const pairScore =
            totalRatio * 220 +
            (fit1Norm + fit2Norm) * 40 -
            outsidePenalty * 18 -
            balancePenalty * 8 -
            overlapPieceRatio * 120 -
            overlapGeometryRatio * 180;
          if (!bestPair || pairScore > bestPair.score) {
            bestPair = {
              score: pairScore,
              j1,
              j2,
              fit1,
              fit2,
              meta1,
              meta2,
              ratio1,
              ratio2,
              totalRatio
            };
          }
        }
      }
      if (bestPair) {
        const c1 = availablePool[bestPair.j1];
        const c2 = availablePool[bestPair.j2];
        const key1 = String(c1 && (c1.id || c1.inventoryTag) || "");
        const key2 = String(c2 && (c2.id || c2.inventoryTag) || "");
        if (key1) used.add(key1);
        if (key2) used.add(key2);
        const pairItems = [
          {
            c: c1,
            fit: bestPair.fit1,
            meta: bestPair.meta1,
            gainRatio: bestPair.ratio1,
            idx: 1
          },
          {
            c: c2,
            fit: bestPair.fit2,
            meta: bestPair.meta2,
            gainRatio: bestPair.ratio2,
            idx: 2
          }
        ];
        for (const item of pairItems) {
          const baseNap = safeNum(item.c && item.c.napDirectionDeg);
          const rotDeg = Number(Math.round((Number(item.fit && item.fit.rotationDeg || 0)) * 10) / 10);
          const napEffectiveDeg = (baseNap === null) ? null : normalizeDeg(baseNap + rotDeg);
          placements.push({
            fragmentId: f.id,
            fragmentAreaMm2: fArea,
            scrapPieceId: String(item.c && item.c.id || ""),
            inventoryTag: String(item.c && item.c.inventoryTag || ""),
            scrapContour: String(item.c && item.c.scrapContour || ""),
            napDirectionDeg: safeNum(item.c && item.c.napDirectionDeg),
            bboxWidthMm: safeNum(item.c && item.c.bboxWidthMm),
            bboxHeightMm: safeNum(item.c && item.c.bboxHeightMm),
            fitScore: Math.round(Number(item.fit && item.fit.fitScore || 0) * 1000) / 1000,
            fitAreaRatio: Math.round(Number(item.fit && item.fit.areaRatio || 0) * 1000) / 1000,
            fitCoverageRatio: Math.round(Number(item.fit && item.fit.coverageRatio || 0) * 1000) / 1000,
            fitOverlap: Math.round(Number(item.fit && item.fit.overlapApprox || 0) * 1000) / 1000,
            fitInsidePercent: Math.round(Number(item.fit && item.fit.insidePercent || 0) * 10) / 10,
            fitChamferMm: Math.round(Number(item.fit && item.fit.chamferMm || 0) * 100) / 100,
            napDeltaDeg: (item.fit && item.fit.napDeltaDeg !== null) ? Math.round(Number(item.fit.napDeltaDeg) * 10) / 10 : null,
            alignRotationDeg: rotDeg,
            napEffectiveDeg,
            alignOffsetX: Math.round(Number(item.fit && item.fit.offsetX || 0) * 100) / 100,
            alignOffsetY: Math.round(Number(item.fit && item.fit.offsetY || 0) * 100) / 100,
            alignedContour: Array.isArray(item.fit && item.fit.alignedContour) ? item.fit.alignedContour : null,
            alignedCoreContour: Array.isArray(item.meta.coreContour) ? item.meta.coreContour : null,
            seamReserveMm: pieceSeamReserveMm,
            seamStatus: item.meta.seamStatus,
            fragmentCoverageRatio: Math.round(Number(bestPair.totalRatio || 0) * 1000) / 1000,
            fragmentGainCoverageRatio: Math.round(Number(item.gainRatio || 0) * 1000) / 1000,
            insideRatio: Math.round(Number(item.meta.insideRatio || 0) * 1000) / 1000,
            outsideRatio: Math.round(Number(item.meta.outsideRatio || 0) * 1000) / 1000,
            fragmentPieceIndex: item.idx,
            status: "matched"
          });
        }
        if (topChoicesByFragment && topChoicesByFragment[String(f.id)]) {
          topChoicesByFragment[String(f.id)].decision = "max_score_two_piece_fallback";
        }
        breakdown.fragmentCoverage.push({
          fragmentId: Number(f && f.id || 0),
          piecesUsed: 2,
          coverageRatio: Math.round(Number(bestPair.totalRatio || 0) * 1000) / 1000,
          coveredByTarget: bestPair.totalRatio + 1e-9 >= fragmentCoverageTarget,
          coveredByMinAccept: bestPair.totalRatio + 1e-9 >= pairCoverageMinAccept
        });
      } else {
        placements.push({
          fragmentId: f.id,
          fragmentAreaMm2: fArea,
          scrapPieceId: null,
          inventoryTag: null,
          scrapContour: "",
          napDirectionDeg: null,
          bboxWidthMm: null,
          bboxHeightMm: null,
          fitScore: null,
          fitAreaRatio: null,
          fitCoverageRatio: null,
          fitOverlap: null,
          fitInsidePercent: null,
          fitChamferMm: null,
          napDeltaDeg: null,
          alignRotationDeg: null,
          napEffectiveDeg: null,
          alignOffsetX: null,
          alignOffsetY: null,
          alignedContour: null,
          alignedCoreContour: null,
          fragmentCoverageRatio: 0,
          fragmentGainCoverageRatio: 0,
          insideRatio: null,
          outsideRatio: null,
          fragmentPieceIndex: 1,
          status: "needs_attention",
          reason: "smart_not_found"
        });
        if (topChoicesByFragment && topChoicesByFragment[String(f.id)]) {
          topChoicesByFragment[String(f.id)].decision = "smart_not_found";
        }
        breakdown.fragmentCoverage.push({
          fragmentId: Number(f && f.id || 0),
          piecesUsed: 0,
          coverageRatio: 0,
          coveredByTarget: false,
          coveredByMinAccept: false
        });
      }
    }
  } else {
    for (const i of unmatchedRows) {
      const f = workFragments[i];
      const fArea = safeNum(f && f.areaMm2) || polygonArea((f && f.points) || []);
      placements.push({
        fragmentId: f.id,
        fragmentAreaMm2: fArea,
        scrapPieceId: null,
        inventoryTag: null,
        scrapContour: "",
        napDirectionDeg: null,
        bboxWidthMm: null,
        bboxHeightMm: null,
        fitScore: null,
        fitAreaRatio: null,
        fitCoverageRatio: null,
        fitOverlap: null,
        fitInsidePercent: null,
        fitChamferMm: null,
        napDeltaDeg: null,
        alignRotationDeg: null,
        napEffectiveDeg: null,
        alignOffsetX: null,
        alignOffsetY: null,
        alignedContour: null,
        alignedCoreContour: null,
        fragmentCoverageRatio: 0,
        fragmentGainCoverageRatio: 0,
        insideRatio: null,
        outsideRatio: null,
        fragmentPieceIndex: 1,
        status: "needs_attention",
        reason: "smart_not_found"
      });
      if (topChoicesByFragment && topChoicesByFragment[String(f.id)]) {
        topChoicesByFragment[String(f.id)].decision = "smart_not_found";
      }
      breakdown.fragmentCoverage.push({
        fragmentId: Number(f && f.id || 0),
        piecesUsed: 0,
        coverageRatio: 0,
        coveredByTarget: false,
        coveredByMinAccept: false
      });
    }
  }

  const covRows = Array.isArray(breakdown.fragmentCoverage) ? breakdown.fragmentCoverage.slice() : [];
  const coveredByTargetCount = covRows.filter((r) => !!r.coveredByTarget).length;
  const coveredByMinAcceptCount = covRows.filter((r) => !!r.coveredByMinAccept).length;
  const coverageAvg = covRows.length
    ? covRows.reduce((acc, r) => acc + Number(r && r.coverageRatio || 0), 0) / covRows.length
    : 0;
  const coverageWorst = covRows
    .slice()
    .sort((a, b) => Number(a && a.coverageRatio || 0) - Number(b && b.coverageRatio || 0))
    .slice(0, 5)
    .map((r) => ({
      fragmentId: Number(r && r.fragmentId || 0),
      coverageRatio: Number(r && r.coverageRatio || 0),
      piecesUsed: Number(r && r.piecesUsed || 0)
    }));
  breakdown.coveredByTargetCount = coveredByTargetCount;
  breakdown.coveredByMinAcceptCount = coveredByMinAcceptCount;
  breakdown.fragmentCoverageAvg = Math.round(coverageAvg * 1000) / 1000;
  breakdown.fragmentCoverageWorst = coverageWorst;
  if (topChoicesByFragment) breakdown.topChoicesByFragment = topChoicesByFragment;

  return {
    placements,
    breakdown
  };
}

function checkCandidateCompatibility(c, filters, constraints, axis) {
  const regularCompatibility = !!(constraints && constraints.regularCompatibility === true);
  const prefilterNapTol = safeNum(constraints && constraints.prefilterNapToleranceDeg);
  if (!c) return { ok: false, reason: "unknown" };
  if (filters.materialId && String(c.materialId || "").toLowerCase() !== String(filters.materialId).toLowerCase()) {
    return { ok: false, reason: "material" };
  }
  if (Array.isArray(filters.allowedStatuses) && filters.allowedStatuses.length > 0) {
    const ok = filters.allowedStatuses.some((s) => String(s).toLowerCase() === String(c.scrapStatus || "").toLowerCase());
    if (!ok) return { ok: false, reason: "status" };
  }
  const cArea = safeNum(c.areaMm2);
  const cW = safeNum(c.bboxWidthMm);
  const cH = safeNum(c.bboxHeightMm);
  if (cArea === null || cW === null || cH === null) return { ok: false, reason: "metrics" };
  const along = axis === "x" ? cW : cH;
  const across = axis === "x" ? cH : cW;
  if (constraints.minAreaMm2 !== null && cArea < constraints.minAreaMm2) return { ok: false, reason: "min_area" };
  if (constraints.maxAreaMm2 !== null && cArea > constraints.maxAreaMm2) return { ok: false, reason: "max_area" };
  if (constraints.minAlongMm !== null && along < constraints.minAlongMm) return { ok: false, reason: "min_along" };
  if (constraints.maxAlongMm !== null && along > constraints.maxAlongMm) return { ok: false, reason: "max_along" };
  if (constraints.minAcrossMm !== null && across < constraints.minAcrossMm) return { ok: false, reason: "min_across" };
  if (constraints.maxAcrossMm !== null && across > constraints.maxAcrossMm) return { ok: false, reason: "max_across" };
  if (constraints.napDirectionDeg !== null && constraints.napToleranceDeg !== null) {
    const tol = prefilterNapTol === null
      ? Number(constraints.napToleranceDeg)
      : Math.max(0, Number(prefilterNapTol));
    if (regularCompatibility) {
      const baseNap = normalizeDeg(c && c.napDirectionDeg);
      const targetNap = normalizeDeg(constraints.napDirectionDeg);
      const rotations = [0, 90, 180, 270];
      let anyNapOk = false;
      for (const rot of rotations) {
        const effective = baseNap === null ? null : normalizeDeg(baseNap + rot);
        const d = deltaDeg(targetNap, effective);
        if (d !== null && d <= tol + 1e-6) {
          anyNapOk = true;
          break;
        }
      }
      if (!anyNapOk) return { ok: false, reason: "nap" };
    } else {
      const d = deltaDeg(constraints.napDirectionDeg, c.napDirectionDeg);
      if (d !== null && d > tol) return { ok: false, reason: "nap" };
    }
  }
  if (!regularCompatibility && constraints.requireScrapContour === true) {
    const hasContour = Array.isArray(c.__scrapContourPoints) && c.__scrapContourPoints.length >= 3;
    if (!hasContour) return { ok: false, reason: "no_contour" };
  }
  return { ok: true, reason: "ok" };
}

function isCandidateCompatible(c, filters, constraints, axis) {
  const res = checkCandidateCompatibility(c, filters, constraints, axis);
  return !!(res && res.ok === true);
}

function parseScrapContourPoints(scrapContourText) {
  if (!scrapContourText) return [];
  try {
    const parsed = JSON.parse(String(scrapContourText));
    const path = Array.isArray(parsed && parsed.path) ? parsed.path : [];
    const raw = [];
    for (const p of path) {
      const tp = transformScrapPointToWorld(p);
      if (tp) raw.push(tp);
    }
    return normalizeCandidateContourPoints(raw);
  } catch (_) {
    return [];
  }
}

function signedArea(points) {
  const pts = Array.isArray(points) ? points : [];
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += Number(a.x || 0) * Number(b.y || 0) - Number(b.x || 0) * Number(a.y || 0);
  }
  return sum * 0.5;
}

function normalizeCandidateContourPoints(points) {
  const src = Array.isArray(points) ? points : [];
  const cleaned = [];
  const EPS = 1e-6;
  for (const p of src) {
    const x = safeNum(p && p.x);
    const y = safeNum(p && p.y);
    if (x === null || y === null) continue;
    if (cleaned.length) {
      const q = cleaned[cleaned.length - 1];
      if (Math.hypot(x - q.x, y - q.y) <= EPS) continue;
    }
    cleaned.push({ x, y });
  }
  if (cleaned.length >= 2) {
    const a = cleaned[0];
    const b = cleaned[cleaned.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= EPS) cleaned.pop();
  }
  if (cleaned.length < 3) return [];

  // Canonical start point for stable downstream scoring/caching.
  let start = 0;
  for (let i = 1; i < cleaned.length; i++) {
    const p = cleaned[i];
    const s = cleaned[start];
    if (p.y < s.y - EPS || (Math.abs(p.y - s.y) <= EPS && p.x < s.x - EPS)) start = i;
  }
  const out = [];
  for (let i = 0; i < cleaned.length; i++) out.push(cleaned[(start + i) % cleaned.length]);

  // Keep winding deterministic (math CCW) to avoid accidental orientation drift.
  if (signedArea(out) < 0) out.reverse();
  return out;
}

function rotatePoints(points, angleRad, center) {
  const c = center || { x: 0, y: 0 };
  const ca = Math.cos(angleRad);
  const sa = Math.sin(angleRad);
  return (points || []).map((p) => {
    const x = p.x - c.x;
    const y = p.y - c.y;
    return { x: c.x + x * ca - y * sa, y: c.y + x * sa + y * ca };
  });
}

function translatePoints(points, dx, dy) {
  return (points || []).map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

function dominantAxisAngle(points) {
  const pts = Array.isArray(points) ? points : [];
  if (pts.length < 2) return 0;
  const c = centroid(pts);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    const x = p.x - c.x;
    const y = p.y - c.y;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
  }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

function rectPointsCentered(cx, cy, w, h) {
  const hw = Math.max(1, Number(w || 0)) * 0.5;
  const hh = Math.max(1, Number(h || 0)) * 0.5;
  return [
    { x: cx - hw, y: cy - hh },
    { x: cx + hw, y: cy - hh },
    { x: cx + hw, y: cy + hh },
    { x: cx - hw, y: cy + hh }
  ];
}

function closedPoints(points) {
  const pts = Array.isArray(points) ? points.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
  if (pts.length < 2) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6) return pts.slice();
  return pts.concat([{ x: a.x, y: a.y }]);
}

function samplePolyline(points, count) {
  const pts = closedPoints(points);
  if (pts.length < 2) return [];
  const seg = [];
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len <= 1e-9) continue;
    seg.push({ a, b, len });
    total += len;
  }
  if (total <= 1e-9 || seg.length === 0) return [];
  const out = [];
  const n = Math.max(8, count | 0);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * total;
    let acc = 0;
    let s = seg[seg.length - 1];
    for (const cur of seg) {
      if (acc + cur.len >= t) {
        s = cur;
        break;
      }
      acc += cur.len;
    }
    const lt = (t - acc) / (s.len || 1);
    out.push({
      x: s.a.x + (s.b.x - s.a.x) * lt,
      y: s.a.y + (s.b.y - s.a.y) * lt
    });
  }
  return out;
}

function avgNearestDistance(fromPts, toPts) {
  if (!Array.isArray(fromPts) || fromPts.length === 0 || !Array.isArray(toPts) || toPts.length === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (const p of fromPts) {
    let best = Number.POSITIVE_INFINITY;
    for (const q of toPts) {
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum / fromPts.length;
}

function buildAlignedCandidateContourForFragment(candidate, fragmentPoints) {
  const fc = centroid(fragmentPoints);
  const sourceContour = (() => {
    const fromPrepared = Array.isArray(candidate && candidate.__scrapContourPoints)
      ? candidate.__scrapContourPoints
          .map((p) => ({ x: Number(p && p.x), y: Number(p && p.y) }))
          .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      : [];
    if (fromPrepared.length >= 3) return fromPrepared;
    const parsed = parseScrapContourPoints(candidate && candidate.scrapContour);
    if (parsed.length >= 3) return parsed;
    const bboxWidthMm = safeNum(candidate && candidate.bboxWidthMm);
    const bboxHeightMm = safeNum(candidate && candidate.bboxHeightMm);
    if (bboxWidthMm !== null && bboxHeightMm !== null) {
      const w = Math.max(1, Number(bboxWidthMm));
      const h = Math.max(1, Number(bboxHeightMm));
      return [
        { x: -w * 0.5, y: -h * 0.5 },
        { x:  w * 0.5, y: -h * 0.5 },
        { x:  w * 0.5, y:  h * 0.5 },
        { x: -w * 0.5, y:  h * 0.5 }
      ];
    }
    const areaMm2Raw = safeNum(candidate && candidate.areaMm2);
    if (areaMm2Raw !== null && Number(areaMm2Raw) > 0) {
      const side = Math.max(1, Math.sqrt(Number(areaMm2Raw)));
      return [
        { x: -side * 0.5, y: -side * 0.5 },
        { x:  side * 0.5, y: -side * 0.5 },
        { x:  side * 0.5, y:  side * 0.5 },
        { x: -side * 0.5, y:  side * 0.5 }
      ];
    }
    return [];
  })();
  let contour = sourceContour.slice();
  let rotationDeg = 0;
  let offsetX = 0;
  let offsetY = 0;
  if (contour.length >= 3) {
    const sc = centroid(contour);
    const candAxis = dominantAxisAngle(contour);
    const fragAxis = dominantAxisAngle(fragmentPoints);
    const rot = fragAxis - candAxis;
    contour = rotatePoints(contour, rot, sc);
    const rc = centroid(contour);
    contour = translatePoints(contour, fc.x - rc.x, fc.y - rc.y);
    rotationDeg = (rot * 180) / Math.PI;
  } else {
    contour = [];
  }
  return {
    contour,
    sourceContour: contour.length >= 3 && sourceContour.length >= 3 ? sourceContour : null,
    center: fc,
    rotationDeg,
    offsetX,
    offsetY
  };
}

function evaluateCandidateContourAgainstFragment(candContour, fragment, candidate, constraints, transformMeta) {
  const detailed = evaluateCandidateContourAgainstFragmentDetailed(candContour, fragment, candidate, constraints, transformMeta);
  return detailed && detailed.fit ? detailed.fit : null;
}

function evaluateCandidateContourAgainstFragmentDetailed(candContour, fragment, candidate, constraints, transformMeta) {
  const fragPoints = Array.isArray(fragment && fragment.points) ? fragment.points : [];
  if (fragPoints.length < 3 || !Array.isArray(candContour) || candContour.length < 3) {
    return { fit: null, reason: "fit_null" };
  }
  const fArea = safeNum(fragment.areaMm2) || polygonArea(fragPoints);
  const cArea = safeNum(candidate && candidate.areaMm2) || polygonArea(candContour);
  if (!Number.isFinite(fArea) || fArea <= 0 || !Number.isFinite(cArea) || cArea <= 0) {
    return { fit: null, reason: "fit_null" };
  }

  const fragSample = samplePolyline(fragPoints, 36);
  const candSample = samplePolyline(candContour, 36);
  const insideCand = candSample.length ? candSample.filter((p) => pointInPolygon(p, fragPoints)).length / candSample.length : 0;
  const insideFrag = fragSample.length ? fragSample.filter((p) => pointInPolygon(p, candContour)).length / fragSample.length : 0;
  const overlapApprox = (insideCand + insideFrag) * 0.5;

  const d1 = avgNearestDistance(candSample, fragSample);
  const d2 = avgNearestDistance(fragSample, candSample);
  const chamferMm = (d1 + d2) * 0.5;
  const fb = polygonBBox(fragPoints) || { width: 1, height: 1 };
  const diag = Math.max(1, Math.hypot(fb.width, fb.height));
  const chamferNorm = Math.min(1, chamferMm / (diag * 0.22));

  const areaRatio = Math.min(fArea, cArea) / Math.max(fArea, cArea);
  const coverageRatio = cArea / Math.max(1e-9, fArea);
  const regularCompatibility = !!(constraints && constraints.regularCompatibility === true);
  const minCoverageFloor = regularCompatibility ? 0.05 : 0.2;
  const minCoverageRatio = safeNum(constraints && constraints.minCoverageRatio) === null
    ? (regularCompatibility ? 0.18 : 0.75)
    : Math.max(minCoverageFloor, Math.min(1.2, Number(constraints.minCoverageRatio)));
  const coverageGateFactor = regularCompatibility ? 0.6 : 0.85;
  if (coverageRatio < minCoverageRatio * coverageGateFactor) {
    return { fit: null, reason: "coverage_gate_low" };
  }

  const rotationDeg = safeNum(transformMeta && transformMeta.rotationDeg) || 0;
  const baseNapDeg = normalizeDeg(candidate && candidate.napDirectionDeg);
  const napEffectiveDeg = baseNapDeg === null ? null : normalizeDeg(baseNapDeg + rotationDeg);
  const napDelta = deltaDeg(constraints && constraints.napDirectionDeg, napEffectiveDeg);
  let napScore = 1;
  if (constraints && constraints.napDirectionDeg !== null && constraints.napToleranceDeg !== null && napDelta !== null) {
    const tol = Number(constraints.napToleranceDeg);
    if (!isNapWithinTolerance(napDelta, tol)) return { fit: null, reason: "nap" };
    napScore = tol > NAP_EPS_DEG ? Math.max(0, 1 - napDelta / tol) : 1;
  }

  const fitScore =
    44 * overlapApprox +
    26 * (1 - chamferNorm) +
    22 * areaRatio +
    8 * napScore;

  return {
    fit: {
      fitScore,
      areaRatio,
      coverageRatio,
      overlapApprox,
      insidePercent: insideCand * 100,
      chamferMm,
      napDeltaDeg: napDelta,
      napEffectiveDeg,
      rotationDeg,
      offsetX: safeNum(transformMeta && transformMeta.offsetX) || 0,
      offsetY: safeNum(transformMeta && transformMeta.offsetY) || 0,
      alignedContour: candContour
    },
    reason: null
  };
}

function quickFragmentCandidateScore(fragment, candidate, constraints) {
  const fArea = safeNum(fragment && fragment.areaMm2) || polygonArea((fragment && fragment.points) || []);
  const cArea = safeNum(candidate && candidate.areaMm2);
  if (!Number.isFinite(fArea) || fArea <= 0 || cArea === null || cArea <= 0) return null;
  const fb = polygonBBox((fragment && fragment.points) || []);
  const cw = safeNum(candidate && candidate.bboxWidthMm);
  const ch = safeNum(candidate && candidate.bboxHeightMm);
  if (!fb || cw === null || ch === null) return null;
  const fr = Math.max(1e-9, Math.min(fArea, cArea) / Math.max(fArea, cArea));
  const fAspect = Math.max(fb.width, fb.height) / Math.max(1e-9, Math.min(fb.width, fb.height));
  const cAspect = Math.max(cw, ch) / Math.max(1e-9, Math.min(cw, ch));
  const aspectScore = Math.max(0, 1 - Math.min(1, Math.abs(fAspect - cAspect) / 2));
  const regularCompatibility = !!(constraints && constraints.regularCompatibility === true);
  const fBbArea = Math.max(1e-9, fb.width * fb.height);
  const fRect = Math.max(0, Math.min(1, fArea / fBbArea));
  const candContour = Array.isArray(candidate && candidate.__scrapContourPoints) ? candidate.__scrapContourPoints : [];
  const cb = candContour.length >= 3 ? polygonBBox(candContour) : null;
  const cBbArea = cb ? Math.max(1e-9, cb.width * cb.height) : Math.max(1e-9, cw * ch);
  const cRect = Math.max(0, Math.min(1, cArea / cBbArea));
  const rectScore = Math.max(0, 1 - Math.min(1, Math.abs(fRect - cRect) / 0.6));
  const coverageRatio = cArea / Math.max(1e-9, fArea);
  const areaOverflowPenalty = Math.max(0, coverageRatio - 1);
  // Nap is checked at detailed fit stage with actual rotation.
  const napScore = 1;
  if (regularCompatibility) {
    return 0.46 * fr + 0.16 * aspectScore + 0.28 * rectScore + 0.10 * napScore - 0.34 * Math.min(1, areaOverflowPenalty);
  }
  return 0.56 * fr + 0.24 * aspectScore + 0.1 * rectScore + 0.1 * napScore;
}

function evaluateFragmentCandidateFit(fragment, candidate, constraints) {
  const detailed = evaluateFragmentCandidateFitDetailed(fragment, candidate, constraints);
  return detailed && detailed.fit ? detailed.fit : null;
}

function evaluateFragmentCandidateFitDetailed(fragment, candidate, constraints) {
  const fragPoints = Array.isArray(fragment && fragment.points) ? fragment.points : [];
  if (fragPoints.length < 3) return { fit: null, rejectReason: "fit_null" };
  const regularCompatibility = !!(constraints && constraints.regularCompatibility === true);
  const aligned = buildAlignedCandidateContourForFragment(candidate, fragPoints);
  const candContour = aligned.contour;
  if (!Array.isArray(candContour) || candContour.length < 3) return { fit: null, rejectReason: "fit_null" };

  const fb = polygonBBox(fragPoints) || { width: 0, height: 0 };
  const rejectCounts = {};
  function markReject(reason) {
    const key = String(reason || "fit_null");
    rejectCounts[key] = Number(rejectCounts[key] || 0) + 1;
  }
  const baseResult = evaluateCandidateContourAgainstFragmentDetailed(
    candContour,
    fragment,
    candidate,
    constraints,
    { rotationDeg: aligned.rotationDeg, offsetX: 0, offsetY: 0 }
  );
  let best = baseResult && baseResult.fit ? baseResult.fit : null;
  if (!best) markReject(baseResult && baseResult.reason ? baseResult.reason : "fit_null");

  const fc = centroid(fragPoints);
  const searchClass = String((constraints && constraints.__searchClass) || "").toLowerCase();
  const enableCornerEdgeEnhance = !!(constraints && constraints.__enableCornerEdgeEnhance === true);
  const enhanceCornerEdge = regularCompatibility && enableCornerEdgeEnhance && (searchClass === "corner" || searchClass === "edge");
  const angleDeltas = enhanceCornerEdge
    ? [0, -18, -14, -10, -6, 6, 10, 14, 18]
    : (regularCompatibility ? [0, -16, -12, -8, -4, 4, 8, 12, 16] : [0, -8, 8]);
  const shiftFactor = enhanceCornerEdge ? 0.18 : (regularCompatibility ? 0.16 : 0.07);
  const shiftX = enhanceCornerEdge
    ? [0, -shiftFactor * fb.width, shiftFactor * fb.width, -0.09 * fb.width, 0.09 * fb.width]
    : (regularCompatibility
      ? [0, -shiftFactor * fb.width, shiftFactor * fb.width, -0.08 * fb.width, 0.08 * fb.width]
      : [0, -0.07 * fb.width, 0.07 * fb.width]);
  const shiftY = enhanceCornerEdge
    ? [0, -shiftFactor * fb.height, shiftFactor * fb.height, -0.09 * fb.height, 0.09 * fb.height]
    : (regularCompatibility
      ? [0, -shiftFactor * fb.height, shiftFactor * fb.height, -0.08 * fb.height, 0.08 * fb.height]
      : [0, -0.07 * fb.height, 0.07 * fb.height]);
  const source = Array.isArray(aligned.sourceContour) && aligned.sourceContour.length >= 3 ? aligned.sourceContour : candContour;
  const sourceCenter = centroid(source);

  const rotationAnchors = regularCompatibility
    ? [aligned.rotationDeg, aligned.rotationDeg + 90, aligned.rotationDeg + 180, aligned.rotationDeg + 270]
    : [aligned.rotationDeg];
  const seenRot = new Set();
  for (const anchorDeg of rotationAnchors) {
    for (const aDeg of angleDeltas) {
      const rotAbsDeg = anchorDeg + aDeg;
      const rotKey = Math.round(normalizeDeg(rotAbsDeg) * 10) / 10;
      if (seenRot.has(rotKey)) continue;
      seenRot.add(rotKey);
      const rot = (rotAbsDeg * Math.PI) / 180;
      let rotated = rotatePoints(source, rot, sourceCenter);
      const rc = centroid(rotated);
      rotated = translatePoints(rotated, fc.x - rc.x, fc.y - rc.y);

      for (const dx of shiftX) {
        for (const dy of shiftY) {
          const moved = translatePoints(rotated, dx, dy);
          const fitResult = evaluateCandidateContourAgainstFragmentDetailed(
            moved,
            fragment,
            candidate,
            constraints,
            { rotationDeg: rotAbsDeg, offsetX: dx, offsetY: dy }
          );
          const fit = fitResult && fitResult.fit ? fitResult.fit : null;
          if (!fit) {
            markReject(fitResult && fitResult.reason ? fitResult.reason : "fit_null");
            continue;
          }
          if (!best || fit.fitScore > best.fitScore) best = fit;
        }
      }
    }
  }

  if (best) return { fit: best, rejectReason: null, rejectCounts };
  const sortedRejects = Object.entries(rejectCounts).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
  return {
    fit: null,
    rejectReason: sortedRejects.length ? String(sortedRejects[0][0]) : "fit_null",
    rejectCounts
  };
}

function hungarianMinCost(costMatrix) {
  const n = Array.isArray(costMatrix) ? costMatrix.length : 0;
  if (!n) return [];
  const m = Array.isArray(costMatrix[0]) ? costMatrix[0].length : 0;
  if (!m) return new Array(n).fill(-1);
  if (n > m) throw new Error("hungarian_requires_rows_leq_cols");

  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = Number(costMatrix[i0 - 1][j - 1]) - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] > 0) assignment[p[j] - 1] = j - 1;
  }
  return assignment;
}

function assignCandidatesGlobalBest(fragments, pool, constraints) {
  const rows = fragments.length;
  const realCols = pool.length;
  const dummyCols = rows;
  const cols = realCols + dummyCols;
  const BIG = 1e7;
  const minFit = safeNum(constraints && constraints.minFitScore);
  const minAcceptFit = minFit === null ? 30 : Math.max(0, minFit);

  const fitGrid = Array.from({ length: rows }, () => new Array(realCols).fill(null));
  const preselectByRow = Array.from({ length: rows }, () => new Set());
  const perFragmentCapRaw = safeNum(constraints && constraints.maxCandidatesPerFragment);
  const perFragmentCap = perFragmentCapRaw === null
    ? 22
    : Math.max(8, Math.min(60, Number(perFragmentCapRaw)));
  for (let i = 0; i < rows; i++) {
    const ranked = [];
    for (let j = 0; j < realCols; j++) {
      const q = quickFragmentCandidateScore(fragments[i], pool[j], constraints);
      if (q === null) continue;
      ranked.push({ j, q });
    }
    ranked.sort((a, b) => b.q - a.q);
    const top = ranked.slice(0, perFragmentCap);
    for (const x of top) preselectByRow[i].add(x.j);
  }

  let maxScore = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < realCols; j++) {
      if (!preselectByRow[i].has(j)) continue;
      const fit = evaluateFragmentCandidateFit(fragments[i], pool[j], constraints);
      if (fit && Number.isFinite(fit.fitScore) && fit.fitScore >= minAcceptFit) {
        fitGrid[i][j] = fit;
        if (fit.fitScore > maxScore) maxScore = fit.fitScore;
      }
    }
  }
  maxScore = Math.max(0, maxScore);

  const cost = [];
  for (let i = 0; i < rows; i++) {
    const row = [];
    for (let j = 0; j < realCols; j++) {
      const fit = fitGrid[i][j];
      if (!fit) row.push(BIG);
      else row.push(maxScore - fit.fitScore);
    }
    for (let j = 0; j < dummyCols; j++) row.push(maxScore);
    cost.push(row);
  }

  const assignment = hungarianMinCost(cost);
  const out = [];
  for (let i = 0; i < rows; i++) {
    const col = assignment[i];
    if (col >= 0 && col < realCols && fitGrid[i][col]) {
      out.push({ candidate: pool[col], fit: fitGrid[i][col] });
    } else {
      out.push({ candidate: null, fit: null });
    }
  }
  return out;
}

function assignCandidatesToFragments(fragments, candidates, placementStrategy, axis, filters, constraints) {
  const regularCompatibility = !!(constraints && constraints.regularCompatibility === true);
  const prepared = (Array.isArray(candidates) ? candidates : []).map((c) => {
    let contour = parseScrapContourPoints(c && c.scrapContour);
    const bboxWidthMm = safeNum(c && c.bboxWidthMm);
    const bboxHeightMm = safeNum(c && c.bboxHeightMm);
    const areaMm2Raw = safeNum(c && c.areaMm2);
    if (regularCompatibility && contour.length < 3 && bboxWidthMm !== null && bboxHeightMm !== null) {
      const w = Math.max(1, Number(bboxWidthMm));
      const h = Math.max(1, Number(bboxHeightMm));
      contour = [
        { x: -w * 0.5, y: -h * 0.5 },
        { x:  w * 0.5, y: -h * 0.5 },
        { x:  w * 0.5, y:  h * 0.5 },
        { x: -w * 0.5, y:  h * 0.5 }
      ];
    } else if (regularCompatibility && contour.length < 3 && areaMm2Raw !== null && Number(areaMm2Raw) > 0) {
      const side = Math.max(1, Math.sqrt(Number(areaMm2Raw)));
      contour = [
        { x: -side * 0.5, y: -side * 0.5 },
        { x:  side * 0.5, y: -side * 0.5 },
        { x:  side * 0.5, y:  side * 0.5 },
        { x: -side * 0.5, y:  side * 0.5 }
      ];
    }
    const bbFromContour = contour.length >= 3 ? polygonBBox(contour) : null;
    const areaFromContour = contour.length >= 3 ? polygonArea(contour) : 0;
    const areaMm2 = areaMm2Raw;
    const fallbackAreaMm2 = (bboxWidthMm !== null && bboxHeightMm !== null)
      ? Math.max(0, Number(bboxWidthMm) * Number(bboxHeightMm))
      : null;
    return {
      ...c,
      napDirectionDeg: transformScrapNapDegToWorld(c && c.napDirectionDeg),
      // Use normalized contour as primary geometry source before fitting.
      areaMm2: areaFromContour > 0 ? areaFromContour : (areaMm2 !== null ? areaMm2 : fallbackAreaMm2),
      bboxWidthMm: bbFromContour ? bbFromContour.width : bboxWidthMm,
      bboxHeightMm: bbFromContour ? bbFromContour.height : bboxHeightMm,
      __scrapContourPoints: contour
    };
  });
  const compatibilityBreakdown = {
    input: prepared.length,
    compatible: 0,
    rejected: {}
  };
  const compatible = [];
  for (const c of prepared) {
    const check = checkCandidateCompatibility(c, filters, constraints, axis);
    if (check && check.ok) {
      compatible.push(c);
      compatibilityBreakdown.compatible += 1;
      continue;
    }
    const reason = String((check && check.reason) || "unknown");
    compatibilityBreakdown.rejected[reason] = Number(compatibilityBreakdown.rejected[reason] || 0) + 1;
  }
  const pool = compatible;
  const used = new Set();
  const placements = [];
  const minCoverageRatio = safeNum(constraints.minCoverageRatio) === null ? 0.75 : Math.max(0.2, Math.min(1, Number(constraints.minCoverageRatio)));
  const minAcceptFit = safeNum(constraints && constraints.minFitScore) === null
    ? (regularCompatibility ? 0 : 68)
    : Math.max(0, Number(constraints.minFitScore));

  if (placementStrategy === "intarsiaSmart") {
    if (regularCompatibility) {
      const regularResult = assignCandidatesRegularByFragmentCoverage({
        fragments,
        pool,
        used,
        minAcceptFit,
        constraints,
        safeNum,
        polygonArea,
        evaluateFragmentCandidateFit,
        normalizeDeg
      });
      const regularPlacements = Array.isArray(regularResult && regularResult.placements)
        ? regularResult.placements
        : [];
      const regularBreakdown = regularResult && regularResult.breakdown ? regularResult.breakdown : null;
      placements.push(...regularPlacements);
      return {
        placements,
        compatibleCandidates: pool.length,
        compatibilityBreakdown,
        placementBreakdown: regularBreakdown,
        usedInventoryTags: placements
          .filter((p) => p.status === "matched")
          .map((p) => p.inventoryTag)
          .filter(Boolean)
      };
    }

    const smartResult = assignCandidatesIntarsiaSmart({
      fragments,
      pool,
      used,
      minAcceptFit,
      constraints,
      safeNum,
      polygonArea,
      polygonBBox,
      evaluateFragmentCandidateFit,
      normalizeDeg
    });
    const smartPlacements = Array.isArray(smartResult)
      ? smartResult
      : (Array.isArray(smartResult && smartResult.placements) ? smartResult.placements : []);
    const smartBreakdown = (!Array.isArray(smartResult) && smartResult && typeof smartResult === "object")
      ? (smartResult.breakdown || null)
      : null;
    placements.push(...smartPlacements);
    return {
      placements,
      compatibleCandidates: pool.length,
      compatibilityBreakdown,
      placementBreakdown: smartBreakdown,
      usedInventoryTags: placements.filter((p) => p.status === "matched").map((p) => p.inventoryTag)
    };
  }

  if (placementStrategy === "bestFit") {
    const globalAssign = assignCandidatesGlobalBest(fragments, pool, constraints);
    for (let i = 0; i < fragments.length; i++) {
      const f = fragments[i];
      const fArea = safeNum(f.areaMm2) || polygonArea(f.points);
      const slot = globalAssign[i] || { candidate: null, fit: null };
      const picked = slot.candidate;
      const fit = slot.fit;
      if (picked && fit && Number(fit.fitScore || 0) >= minAcceptFit) {
        const baseNap = safeNum(picked.napDirectionDeg);
        const rotDeg = Number(Math.round((Number(fit.rotationDeg || 0)) * 10) / 10);
        const napEffectiveDeg = (baseNap === null) ? null : normalizeDeg(baseNap + rotDeg);
        placements.push({
          fragmentId: f.id,
          fragmentAreaMm2: fArea,
          scrapPieceId: String(picked.id || ""),
          inventoryTag: String(picked.inventoryTag || ""),
          scrapContour: String(picked.scrapContour || ""),
          napDirectionDeg: safeNum(picked.napDirectionDeg),
          bboxWidthMm: safeNum(picked.bboxWidthMm),
          bboxHeightMm: safeNum(picked.bboxHeightMm),
          fitScore: Math.round(fit.fitScore * 1000) / 1000,
          fitAreaRatio: Math.round(fit.areaRatio * 1000) / 1000,
          fitCoverageRatio: Math.round(fit.coverageRatio * 1000) / 1000,
          fitOverlap: Math.round(fit.overlapApprox * 1000) / 1000,
          fitInsidePercent: Math.round(fit.insidePercent * 10) / 10,
          fitChamferMm: Math.round(fit.chamferMm * 100) / 100,
          napDeltaDeg: fit.napDeltaDeg !== null ? Math.round(fit.napDeltaDeg * 10) / 10 : null,
          alignRotationDeg: rotDeg,
          napEffectiveDeg,
          alignOffsetX: Math.round(fit.offsetX * 100) / 100,
          alignOffsetY: Math.round(fit.offsetY * 100) / 100,
          alignedContour: Array.isArray(fit.alignedContour) ? fit.alignedContour : null,
          status: "matched"
        });
      } else {
        placements.push({
          fragmentId: f.id,
          fragmentAreaMm2: fArea,
          scrapPieceId: null,
          inventoryTag: null,
          scrapContour: "",
          napDirectionDeg: null,
          bboxWidthMm: null,
          bboxHeightMm: null,
          fitScore: null,
          fitAreaRatio: null,
          fitCoverageRatio: null,
          fitOverlap: null,
          fitInsidePercent: null,
          fitChamferMm: null,
          napDeltaDeg: null,
          alignRotationDeg: null,
          napEffectiveDeg: null,
          alignOffsetX: null,
          alignOffsetY: null,
          alignedContour: null,
          status: "needs_attention",
          reason: "not_found"
        });
      }
    }
    return {
      placements,
      compatibleCandidates: pool.length,
      compatibilityBreakdown,
      usedInventoryTags: placements.filter((p) => p.status === "matched").map((p) => p.inventoryTag)
    };
  }

  for (const f of fragments) {
    const fArea = safeNum(f.areaMm2) || polygonArea(f.points);
    let picked = null;
    let reason = "not_found";
    if (placementStrategy === "manualAssist") {
      // In manual assist we pre-pick only easy matches (close area ratio), leave rest for operator.
      let best = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestFit = null;
      for (const c of pool) {
        const key = String(c.id || c.inventoryTag || "");
        if (!key || used.has(key)) continue;
        const fit = evaluateFragmentCandidateFit(f, c, constraints);
        if (!fit) continue;
        if (fit.fitScore > bestScore) {
          bestScore = fit.fitScore;
          best = c;
          bestFit = fit;
        }
      }
      if (best && bestFit && bestFit.fitScore >= 65) {
        picked = best;
        picked.__fit = bestFit;
      } else {
        reason = "manual_required";
      }
    } else {
      // greedy
      const scored = [];
      for (const c of pool) {
        const fit = evaluateFragmentCandidateFit(f, c, constraints);
        if (!fit) continue;
        scored.push({ c, fit });
      }
      scored.sort((a, b) => b.fit.fitScore - a.fit.fitScore);
      for (const x of scored) {
        const c = x.c;
        const key = String(c.id || c.inventoryTag || "");
        if (!key || used.has(key)) continue;
        if (c.areaMm2 < fArea * minCoverageRatio) continue;
        picked = c;
        picked.__fit = x.fit;
        break;
      }
    }

    if (picked) {
      const key = String(picked.id || picked.inventoryTag || "");
      used.add(key);
      const fit = picked.__fit || null;
      const fitScoreNum = fit ? Number(fit.fitScore || 0) : 0;
      if (!fit || fitScoreNum < minAcceptFit) {
        const baseNap = safeNum(picked.napDirectionDeg);
        const rotDeg = fit ? Number(Math.round((Number(fit.rotationDeg || 0)) * 10) / 10) : 0;
        const napEffectiveDeg = (baseNap === null) ? null : normalizeDeg(baseNap + rotDeg);
        placements.push({
          fragmentId: f.id,
          fragmentAreaMm2: fArea,
          scrapPieceId: null,
          inventoryTag: null,
          scrapContour: "",
          napDirectionDeg: null,
          bboxWidthMm: null,
          bboxHeightMm: null,
          fitScore: fit ? Math.round(fit.fitScore * 1000) / 1000 : null,
          fitAreaRatio: fit ? Math.round(fit.areaRatio * 1000) / 1000 : null,
          fitCoverageRatio: fit ? Math.round(fit.coverageRatio * 1000) / 1000 : null,
          fitOverlap: fit ? Math.round(fit.overlapApprox * 1000) / 1000 : null,
          fitInsidePercent: fit ? Math.round(fit.insidePercent * 10) / 10 : null,
          fitChamferMm: fit ? Math.round(fit.chamferMm * 100) / 100 : null,
          napDeltaDeg: fit && fit.napDeltaDeg !== null ? Math.round(fit.napDeltaDeg * 10) / 10 : null,
          alignRotationDeg: fit ? rotDeg : null,
          napEffectiveDeg: fit ? napEffectiveDeg : null,
          alignOffsetX: fit ? Math.round(fit.offsetX * 100) / 100 : null,
          alignOffsetY: fit ? Math.round(fit.offsetY * 100) / 100 : null,
          alignedContour: null,
          status: "needs_attention",
          reason: "fit_below_threshold"
        });
        delete picked.__fit;
        continue;
      }
      const baseNap = safeNum(picked.napDirectionDeg);
      const rotDeg = fit ? Number(Math.round((Number(fit.rotationDeg || 0)) * 10) / 10) : 0;
      const napEffectiveDeg = (baseNap === null) ? null : normalizeDeg(baseNap + rotDeg);
      placements.push({
        fragmentId: f.id,
        fragmentAreaMm2: fArea,
        scrapPieceId: String(picked.id || ""),
        inventoryTag: String(picked.inventoryTag || ""),
        scrapContour: String(picked.scrapContour || ""),
        napDirectionDeg: safeNum(picked.napDirectionDeg),
        bboxWidthMm: safeNum(picked.bboxWidthMm),
        bboxHeightMm: safeNum(picked.bboxHeightMm),
        fitScore: fit ? Math.round(fit.fitScore * 1000) / 1000 : null,
        fitAreaRatio: fit ? Math.round(fit.areaRatio * 1000) / 1000 : null,
        fitCoverageRatio: fit ? Math.round(fit.coverageRatio * 1000) / 1000 : null,
        fitOverlap: fit ? Math.round(fit.overlapApprox * 1000) / 1000 : null,
        fitInsidePercent: fit ? Math.round(fit.insidePercent * 10) / 10 : null,
        fitChamferMm: fit ? Math.round(fit.chamferMm * 100) / 100 : null,
        napDeltaDeg: fit && fit.napDeltaDeg !== null ? Math.round(fit.napDeltaDeg * 10) / 10 : null,
        alignRotationDeg: fit ? rotDeg : null,
        napEffectiveDeg: fit ? napEffectiveDeg : null,
        alignOffsetX: fit ? Math.round(fit.offsetX * 100) / 100 : null,
        alignOffsetY: fit ? Math.round(fit.offsetY * 100) / 100 : null,
        alignedContour: fit && Array.isArray(fit.alignedContour) ? fit.alignedContour : null,
        status: "matched"
      });
      delete picked.__fit;
    } else {
      placements.push({
        fragmentId: f.id,
        fragmentAreaMm2: fArea,
        scrapPieceId: null,
        inventoryTag: null,
        scrapContour: "",
        napDirectionDeg: null,
        bboxWidthMm: null,
        bboxHeightMm: null,
        fitScore: null,
        fitAreaRatio: null,
        fitCoverageRatio: null,
        fitOverlap: null,
        fitInsidePercent: null,
        fitChamferMm: null,
        napDeltaDeg: null,
        alignRotationDeg: null,
        napEffectiveDeg: null,
        alignOffsetX: null,
        alignOffsetY: null,
        alignedContour: null,
        status: "needs_attention",
        reason
      });
    }
  }

  return {
    placements,
    compatibleCandidates: pool.length,
    compatibilityBreakdown,
    usedInventoryTags: placements.filter((p) => p.status === "matched").map((p) => p.inventoryTag)
  };
}

function rankCandidatesForFragment(fragment, candidates, axis, filters, constraints, limit, excludeInventoryTags) {
  const prepared = (Array.isArray(candidates) ? candidates : []).map((c) => {
    const contour = parseScrapContourPoints(c && c.scrapContour);
    const bb = contour.length >= 3 ? polygonBBox(contour) : null;
    return {
      ...c,
      napDirectionDeg: transformScrapNapDegToWorld(c && c.napDirectionDeg),
      areaMm2: contour.length >= 3 ? polygonArea(contour) : (safeNum(c && c.areaMm2) || 0),
      bboxWidthMm: bb ? bb.width : safeNum(c && c.bboxWidthMm),
      bboxHeightMm: bb ? bb.height : safeNum(c && c.bboxHeightMm),
      __scrapContourPoints: contour
    };
  });
  const excluded = new Set((Array.isArray(excludeInventoryTags) ? excludeInventoryTags : []).map((x) => String(x || "")));
  const compatible = prepared.filter((c) => {
    if (!isCandidateCompatible(c, filters || {}, constraints || {}, axis)) return false;
    const tag = String(c.inventoryTag || "");
    if (tag && excluded.has(tag)) return false;
    return true;
  });
  const minAcceptFit = safeNum(constraints && constraints.minFitScore) === null ? 68 : Math.max(0, Number(constraints.minFitScore));
  const ranked = [];
  for (const c of compatible) {
    const fit = evaluateFragmentCandidateFit(fragment, c, constraints || {});
    if (!fit) continue;
    if (Number(fit.fitScore || 0) < minAcceptFit) continue;
    ranked.push({
      scrapPieceId: String(c.id || ""),
      inventoryTag: String(c.inventoryTag || ""),
      fitScore: Math.round(fit.fitScore * 1000) / 1000,
      fitAreaRatio: Math.round(fit.areaRatio * 1000) / 1000,
      fitCoverageRatio: Math.round(fit.coverageRatio * 1000) / 1000,
      fitOverlap: Math.round(fit.overlapApprox * 1000) / 1000,
      fitInsidePercent: Math.round(fit.insidePercent * 10) / 10,
      fitChamferMm: Math.round(fit.chamferMm * 100) / 100,
      napDeltaDeg: fit.napDeltaDeg !== null ? Math.round(fit.napDeltaDeg * 10) / 10 : null,
      alignRotationDeg: Math.round(fit.rotationDeg * 10) / 10,
      napEffectiveDeg: Number.isFinite(Number(fit.napEffectiveDeg)) ? Math.round(Number(fit.napEffectiveDeg) * 10) / 10 : null,
      alignOffsetX: Math.round(fit.offsetX * 100) / 100,
      alignOffsetY: Math.round(fit.offsetY * 100) / 100,
      alignedContour: Array.isArray(fit.alignedContour) ? fit.alignedContour : null,
      scrapContour: String(c.scrapContour || ""),
      napDirectionDeg: safeNum(c.napDirectionDeg),
      bboxWidthMm: safeNum(c.bboxWidthMm),
      bboxHeightMm: safeNum(c.bboxHeightMm)
    });
  }
  ranked.sort((a, b) => Number(b.fitScore || 0) - Number(a.fitScore || 0));
  return ranked.slice(0, Math.max(1, Math.min(50, Number(limit || 5))));
}

function contourOverlapApprox(aContour, bContour) {
  if (!Array.isArray(aContour) || aContour.length < 3 || !Array.isArray(bContour) || bContour.length < 3) return 0;
  const aSample = samplePolyline(aContour, 28);
  const bSample = samplePolyline(bContour, 28);
  const ainb = aSample.length ? aSample.filter((p) => pointInPolygon(p, bContour)).length / aSample.length : 0;
  const bina = bSample.length ? bSample.filter((p) => pointInPolygon(p, aContour)).length / bSample.length : 0;
  return (ainb + bina) * 0.5;
}

function translateToAnchor(points, anchor) {
  const c = centroid(points);
  return translatePoints(points, anchor.x - c.x, anchor.y - c.y);
}

function shrinkPolygonByMargin(points, marginMm) {
  const m = safeNum(marginMm);
  if (m === null || m <= 0) return (points || []).slice();
  const pts = Array.isArray(points) ? points : [];
  if (pts.length < 3) return pts.slice();
  const bb = polygonBBox(pts);
  if (!bb) return pts.slice();
  const base = Math.max(1, Math.min(bb.width, bb.height));
  const k = Math.max(0.15, 1 - m / base);
  const c = centroid(pts);
  return pts.map((p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k }));
}

function buildZoneCoverageSamples(zonePoints, targetCount) {
  const bb = polygonBBox(zonePoints);
  if (!bb) return [];
  const area = polygonArea(zonePoints);
  const n = Math.max(120, Math.min(900, Number(targetCount || Math.round(area / 1200) || 260)));
  const out = [];
  let guard = 0;
  while (out.length < n && guard < n * 40) {
    guard += 1;
    const p = randomPointInPolygon(zonePoints, bb, 8);
    if (pointInPolygon(p, zonePoints)) out.push(p);
  }
  return out;
}

function evaluatePlacementBySamples(contour, zonePoints, samples, coveredFlags) {
  if (!Array.isArray(contour) || contour.length < 3) return null;
  let insideZoneAndPiece = 0;
  let newlyCovered = 0;
  let alreadyCovered = 0;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    if (!pointInPolygon(p, contour)) continue;
    if (!pointInPolygon(p, zonePoints)) continue;
    insideZoneAndPiece += 1;
    if (coveredFlags[i]) alreadyCovered += 1;
    else newlyCovered += 1;
  }
  return { insideZoneAndPiece, newlyCovered, alreadyCovered };
}

const assignInventoryDirect = createAssignInventoryDirect({
  safeNum,
  shrinkPolygonByMargin,
  polygonArea,
  pointsToMultiPolygon,
  parseScrapContourPoints,
  polygonBBox,
  transformScrapNapDegToWorld,
  isCandidateCompatible,
  normalizeDeg,
  deltaDeg,
  NAP_EPS_DEG,
  solveCoverGrid,
  intersectMulti,
  multiPolygonArea,
  diffMulti,
  largestOuterRingPoints,
  evaluateCandidateContourAgainstFragment,
  residualAnchors,
  centroid,
  rotatePoints,
  translateToAnchor,
  samplePolyline
});

const _solverDeps = {
  parseScrapContourPoints,
  centroid,
  rotatePoints,
  polygonBBox,
  normalizeDeg,
  deltaDeg,
  pointsToMultiPolygon,
  intersectMulti,
  diffMulti,
  unionMulti,
  multiPolygonArea,
  createGridSpec,
  createSeededRng
};
const voronoiSaSolver = createVoronoiSaSolver(_solverDeps);
const nfpSaSolver = createNfpSaSolver(_solverDeps);
const tilingSolver = createTilingSolver(_solverDeps);

function listFilesRecursive(rootDir, extLower) {
  const out = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        if (!extLower || path.extname(e.name).toLowerCase() === extLower) out.push(full);
      }
    }
  }
  walk(rootDir);
  return out;
}

function cleanupPreviewRecord(rec) {
  if (!rec || !Array.isArray(rec.cleanupPaths)) return;
  for (const p of rec.cleanupPaths) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch (_) {}
  }
}

function buildZprjPreviewResult(zprjPath) {
  const base = path.basename(String(zprjPath || ""));
  const ext = path.extname(base).toLowerCase();
  const projectName = base.slice(0, base.length - ext.length).trim() || "project";

  const list = runTar(["-tf", zprjPath], 180000);
  if (list.run.error) return { ok: false, error: `zprj_list_run_failed: ${list.run.error.message}` };
  if (list.run.status !== 0) return { ok: false, error: `zprj_list_exit_${list.run.status}`, stderr: list.stderr };
  const entries = String(list.stdout || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  const extractRoot = fs.mkdtempSync(path.join(TMP_DIR, "zprj_extract_"));
  const cleanupPaths = [extractRoot];

  const unpackTop = runTar(["-xf", zprjPath, "-C", extractRoot], 180000);
  if (unpackTop.run.error) return { ok: false, error: `zprj_extract_run_failed: ${unpackTop.run.error.message}` };
  if (unpackTop.run.status !== 0) return { ok: false, error: `zprj_extract_exit_${unpackTop.run.status}`, stderr: unpackTop.stderr };

  const topDxf = listFilesRecursive(extractRoot, ".dxf");
  const topPos = listFilesRecursive(extractRoot, ".pos");
  const topPac = listFilesRecursive(extractRoot, ".pac");
  const zpacFiles = listFilesRecursive(extractRoot, ".zpac");
  const nestedDxf = [];
  const nestedPos = [];
  const nestedPac = [];
  for (let i = 0; i < zpacFiles.length; i++) {
    const zp = zpacFiles[i];
    const sub = path.join(extractRoot, `zpac_${i}_${safeSlug(path.basename(zp, ".zpac"))}`);
    fs.mkdirSync(sub, { recursive: true });
    const unpack = runTar(["-xf", zp, "-C", sub], 180000);
    if (unpack.run.status === 0) {
      const found = listFilesRecursive(sub, ".dxf");
      for (const f of found) nestedDxf.push(f);
      const foundPos = listFilesRecursive(sub, ".pos");
      for (const f of foundPos) nestedPos.push(f);
      const foundPac = listFilesRecursive(sub, ".pac");
      for (const f of foundPac) nestedPac.push(f);
    }
  }

  const allDxf = uniqueStrings(topDxf.concat(nestedDxf));
  const allPac = uniqueStrings(topPac.concat(nestedPac));
  const allPos = uniqueStrings(topPos.concat(nestedPos));
  const items = [];
  for (let i = 0; i < allDxf.length; i++) {
    const dxfPath = allDxf[i];
    const partName = path.basename(dxfPath, path.extname(dxfPath)).trim() || `part_${i + 1}`;
    const st = fs.statSync(dxfPath);
    const item = {
      previewIndex: i,
      sourcePath: String(zprjPath || ""),
      fileName: base,
      ext,
      partName,
      exists: true,
      isReadyForCommit: false,
      sourceType: "zprj",
      geometryPath: dxfPath,
      geometryFormat: "dxf",
      geometryAvailable: true,
      sizeBytes: Number(st.size || 0),
      modifiedAt: new Date(st.mtimeMs || Date.now()).toISOString()
    };
    try {
      item.dxfSummary = parseDxfSummary(dxfPath);
      item.isReadyForCommit = true;
    } catch (e) {
      item.error = `dxf_parse_failed: ${e.message}`;
      item.isReadyForCommit = false;
    }
    items.push(item);
  }

  if (items.length === 0) {
    for (let i = 0; i < allPac.length; i++) {
      const pacPath = allPac[i];
      const st = fs.statSync(pacPath);
      const partName = path.basename(pacPath, path.extname(pacPath)).trim() || `part_pac_${i + 1}`;
      const item = {
        previewIndex: i,
        sourcePath: String(zprjPath || ""),
        fileName: base,
        ext,
        partName,
        exists: true,
        isReadyForCommit: false,
        sourceType: "zprj",
        geometryPath: pacPath,
        geometryFormat: "pac",
        geometryAvailable: false,
        sizeBytes: Number(st.size || 0),
        modifiedAt: new Date(st.mtimeMs || Date.now()).toISOString()
      };
      try {
        const geometry = parsePacGeometry(pacPath);
        item.pacSummary = {
          entityCount: Number(geometry.entityCount || 0),
          pointsCount: Number(geometry.pointsCount || 0),
          bbox: geometry.bbox || null
        };
        if ((geometry.entityCount || 0) > 0) {
          const cacheKey = `pac__${pacPath}__${item.modifiedAt}__${item.sizeBytes}`;
          geometryCache.set(cacheKey, geometry);
          item.geometryAvailable = true;
          item.isReadyForCommit = true;
        } else {
          item.error = "pac_geometry_not_detected";
        }
      } catch (e) {
        item.error = `pac_parse_failed: ${e.message}`;
      }
      items.push(item);
    }
  }

  if (items.length === 0) {
    for (let i = 0; i < allPos.length; i++) {
      const posPath = allPos[i];
      const st = fs.statSync(posPath);
      const partName = path.basename(posPath, path.extname(posPath)).trim() || `part_pos_${i + 1}`;
      const item = {
        previewIndex: i,
        sourcePath: String(zprjPath || ""),
        fileName: base,
        ext,
        partName,
        exists: true,
        isReadyForCommit: false,
        sourceType: "zprj",
        geometryPath: posPath,
        geometryFormat: "pos",
        geometryAvailable: false,
        sizeBytes: Number(st.size || 0),
        modifiedAt: new Date(st.mtimeMs || Date.now()).toISOString()
      };
      try {
        const geometry = parsePosGeometry(posPath);
        item.posSummary = {
          entityCount: Number(geometry.entityCount || 0),
          pointsCount: Number(geometry.pointsCount || 0),
          bbox: geometry.bbox || null
        };
        if ((geometry.entityCount || 0) > 0) {
          const cacheKey = `pos__${posPath}__${item.modifiedAt}__${item.sizeBytes}`;
          geometryCache.set(cacheKey, geometry);
          item.geometryAvailable = true;
          item.isReadyForCommit = true;
        } else {
          item.error = "pos_geometry_not_detected";
        }
      } catch (e) {
        item.error = `pos_parse_failed: ${e.message}`;
      }
      items.push(item);
    }
  }

  if (items.length === 0) {
    items.push({
      previewIndex: 0,
      sourcePath: String(zprjPath || ""),
      fileName: base,
      ext,
      partName: projectName,
      exists: true,
      isReadyForCommit: true,
      sourceType: "zprj",
      geometryAvailable: false
    });
  }

  return {
    ok: true,
    entries,
    hasZpac: entries.some((x) => /\.zpac$/i.test(x)),
    hasXml: entries.some((x) => /\.xml$/i.test(x)),
    hasPac: allPac.length > 0,
    hasPos: allPos.length > 0,
    items,
    cleanupPaths
  };
}

function makePreviewItem(sourcePath, idx) {
  const base = path.basename(String(sourcePath || ""));
  const ext = path.extname(base).toLowerCase();
  const partName = base.slice(0, base.length - ext.length).trim();
  const fullPath = String(sourcePath || "");
  const out = {
    previewIndex: idx,
    sourcePath: fullPath,
    fileName: base,
    ext,
    partName,
    exists: false,
    isReadyForCommit: false
  };
  if (ext !== ".dxf" || !partName) {
    out.error = "not_dxf_or_empty_name";
    return out;
  }
  if (!fs.existsSync(fullPath)) {
    out.error = "file_not_found";
    return out;
  }
  const st = fs.statSync(fullPath);
  out.exists = true;
  out.sizeBytes = Number(st.size || 0);
  out.modifiedAt = new Date(st.mtimeMs || Date.now()).toISOString();
  out.geometryPath = fullPath;
  out.geometryFormat = "dxf";
  out.sourceType = "dxf";
  out.geometryAvailable = false;
  try {
    out.dxfSummary = parseDxfSummary(fullPath);
    out.isReadyForCommit = true;
    out.geometryAvailable = true;
  } catch (e) {
    out.error = `dxf_parse_failed: ${e.message}`;
    out.isReadyForCommit = false;
  }
  return out;
}

function cleanupPreviews(now = Date.now()) {
  for (const [token, rec] of previewStore.entries()) {
    const touchedAt = rec && Number.isFinite(rec.lastAccessAt) ? rec.lastAccessAt : (rec && rec.createdAt);
    if (!rec || !Number.isFinite(touchedAt) || now - touchedAt > PREVIEW_TTL_MS) {
      cleanupPreviewRecord(rec);
      previewStore.delete(token);
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const now = Date.now();
    if (now - lastPreviewCleanupAt >= PREVIEW_CLEANUP_INTERVAL_MS) {
      cleanupPreviews(now);
      lastPreviewCleanupAt = now;
    }

    if (req.method === "OPTIONS") return jsonReply(res, 204, { ok: true });

    const reqUrl = new URL(req.url, `http://${HOST}:${PORT}`);

    if (req.method === "GET" && reqUrl.pathname === "/api/health") {
      return jsonReply(res, 200, { ok: true, service: "furlab-web-plugin", dbPath: DB_PATH, buildId: SERVER_BUILD_ID });
    }

    if (req.method === "POST" && reqUrl.pathname === "/api/ac-proxy/layout-runs/commit") {
      const AC_URL = process.env.FURLAB_AC_URL || "http://127.0.0.1:5500";
      const body = await readBodyJson(req);
      const postData = JSON.stringify(body);
      const target = new URL("/api/layout-runs/commit", AC_URL);
      const proxyRes = await new Promise((resolve, reject) => {
        const opts = {
          hostname: target.hostname,
          port: Number(target.port) || 5500,
          path: target.pathname,
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(postData) }
        };
        const proxyReq = http.request(opts, (r) => {
          const chunks = [];
          r.on("data", (c) => chunks.push(c));
          r.on("end", () => {
            try { resolve({ status: r.statusCode, json: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
            catch (_) { resolve({ status: r.statusCode, json: { ok: false, error: "proxy_parse_failed" } }); }
          });
        });
        proxyReq.on("error", reject);
        proxyReq.write(postData);
        proxyReq.end();
      });
      return jsonReply(res, proxyRes.status || 200, proxyRes.json);
    }
    if (req.method === "GET" && reqUrl.pathname === "/api/layout/fill/progress/stream") {
      const token = String(reqUrl.searchParams.get("token") || "").trim();
      if (!token) return jsonReply(res, 400, { ok: false, error: "progress_token_required" });
      if (!openLayoutProgressStream(token, res)) {
        return jsonReply(res, 400, { ok: false, error: "progress_stream_open_failed" });
      }
      return;
    }
    if (req.method === "GET" && reqUrl.pathname === "/api/layout/fill/progress/latest") {
      const token = String(reqUrl.searchParams.get("token") || "").trim();
      if (!token) return jsonReply(res, 400, { ok: false, error: "progress_token_required" });
      const latest = layoutProgressLatest.get(token) || null;
      return jsonReply(res, 200, { ok: true, latest });
    }
    if (req.method === "GET" && reqUrl.pathname === "/api/layout/fill/progress/debug") {
      const token = String(reqUrl.searchParams.get("token") || "").trim();
      if (!token) return jsonReply(res, 400, { ok: false, error: "progress_token_required" });
      const listeners = layoutProgressStreams.get(token);
      const latest = layoutProgressLatest.get(token) || null;
      const recentTokens = [];
      for (const [tk, ev] of layoutProgressLatest.entries()) {
        recentTokens.push({
          token: tk,
          ts: ev && Number.isFinite(Number(ev.ts)) ? Number(ev.ts) : null,
          phase: ev && ev.phase ? String(ev.phase) : null,
          type: ev && ev.type ? String(ev.type) : null
        });
      }
      recentTokens.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
      return jsonReply(res, 200, {
        ok: true,
        token,
        hasListeners: !!(listeners && listeners.size),
        listenerCount: listeners ? listeners.size : 0,
        hasLatest: !!latest,
        latestTs: latest && Number.isFinite(Number(latest.ts)) ? Number(latest.ts) : null,
        latestPhase: latest && latest.phase ? String(latest.phase) : null,
        recentTokens: recentTokens.slice(0, 8)
      });
    }

    {
      // Import/preview/commit routes are isolated in a dedicated module.
      await handleImportRoutes(req, res, reqUrl, {
        EXAMPLES_DIR,
        ROOT_DIR,
        TMP_DIR,
        DB_PATH,
        previewStore,
        geometryCache,
        jsonReply,
        readBodyJson,
        listDxfInFolder,
        psPathLiteral,
        runPowerShell,
        parseScriptJson,
        runCscript,
        makePreviewItem,
        buildZprjPreviewResult,
        cleanupPreviewRecord,
        parseDxfGeometry,
        parsePacGeometry,
        parsePosGeometry
      });
      if (res.writableEnded) return;
    }

    {
      await handleInventoryRoute(req, res, reqUrl, {
        ROOT_DIR,
        TMP_DIR,
        DB_PATH,
        jsonReply,
        readBodyJson,
        normalizePolygonInput,
        polygonArea,
        polygonBBox,
        safeNum,
        normalizeDeg,
        runCscript,
        runCscriptAsync,
        parseScriptJson,
        scoreCandidateForZone
      });
      if (res.writableEnded) return;
    }

    {
      await handleDictRoutes(req, res, reqUrl, {
        ROOT_DIR,
        DB_PATH,
        jsonReply,
        runCscript,
        parseScriptJson
      });
      if (res.writableEnded) return;
    }

    {
      await handleFurMaterialRoutes(req, res, reqUrl, {
        ROOT_DIR,
        jsonReply
      });
      if (res.writableEnded) return;
    }

    {
      await handleZoneRoutes(req, res, reqUrl, {
        jsonReply,
        readBodyJson,
        zoneStore
      });
      if (res.writableEnded) return;
    }

    {
      await handleProjectRoutes(req, res, reqUrl, {
        jsonReply,
        readBodyJson,
        ROOT_DIR,
        TMP_DIR,
        DB_PATH,
        runCscript,
        parseScriptJson
      });
      if (res.writableEnded) return;
    }

    {
      await handleInventoryReservationRoutes(req, res, reqUrl, {
        jsonReply,
        readBodyJson,
        ROOT_DIR,
        TMP_DIR,
        DB_PATH,
        runCscript,
        parseScriptJson
      });
      if (res.writableEnded) return;
    }

    {
      await handleExportRoutes(req, res, reqUrl, {
        jsonReply,
        readBodyJson
      });
      if (res.writableEnded) return;
    }

    {
      await handleLayoutRoutes(req, res, reqUrl, {
        jsonReply,
        readBodyJson,
        normalizePolygonInput,
        polygonArea,
        safeNum,
        generateRegularFragments,
        generateShiftedFragments,
        generateDiagonalFragments,
        generateRadialFragments,
        generateVoronoiFragments,
        applyNormalizeRules,
        assignCandidatesToFragments,
        assignInventoryDirect,
        voronoiSaSolver,
        nfpSaSolver,
        tilingSolver,
        rankCandidatesForFragment,
        createGridSpec,
        emitLayoutProgress,
        tmpDir: TMP_DIR
      });
      if (res.writableEnded) return;
    }

    if (req.method === "GET" && (reqUrl.pathname === "/" || reqUrl.pathname === "/index.html")) {
      const htmlPath = path.join(PUBLIC_DIR, "index.html");
      const html = fs.readFileSync(htmlPath);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
        Expires: "0"
      });
      res.end(html);
      return;
    }

    if (req.method === "GET" && (reqUrl.pathname === "/favicon.svg" || reqUrl.pathname === "/favicon.ico")) {
      const candidates = reqUrl.pathname === "/favicon.ico"
        ? [path.join(PUBLIC_DIR, "favicon.ico"), path.join(PUBLIC_DIR, "favicon.svg")]
        : [path.join(PUBLIC_DIR, "favicon.svg")];
      const full = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
      if (!full) {
        return jsonReply(res, 404, { ok: false, error: "file_not_found" });
      }
      const ext = path.extname(full).toLowerCase();
      const ctype = ext === ".svg" ? "image/svg+xml; charset=utf-8" : "image/x-icon";
      res.writeHead(200, {
        "Content-Type": ctype,
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
        Expires: "0"
      });
      fs.createReadStream(full).pipe(res);
      return;
    }

    if (req.method === "GET" && reqUrl.pathname.startsWith("/workers/")) {
      const rel = reqUrl.pathname.replace(/^\/+/, "");
      const full = path.resolve(PUBLIC_DIR, rel);
      if (!full.startsWith(path.resolve(PUBLIC_DIR) + path.sep)) {
        return jsonReply(res, 403, { ok: false, error: "forbidden" });
      }
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        return jsonReply(res, 404, { ok: false, error: "not_found" });
      }
      const ext = path.extname(full).toLowerCase();
      const ctype = ext === ".js" ? "application/javascript; charset=utf-8" : "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": ctype,
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
        Expires: "0"
      });
      fs.createReadStream(full).pipe(res);
      return;
    }

    if (
      req.method === "GET" &&
      (
        reqUrl.pathname.startsWith("/js/") ||
        reqUrl.pathname.startsWith("/css/") ||
        reqUrl.pathname.startsWith("/assets/")
      )
    ) {
      const rel = reqUrl.pathname.replace(/^\/+/, "");
      const full = path.resolve(PUBLIC_DIR, rel);
      if (!full.startsWith(path.resolve(PUBLIC_DIR) + path.sep)) {
        return jsonReply(res, 400, { ok: false, error: "invalid_static_path" });
      }
      if (!fs.existsSync(full)) {
        return jsonReply(res, 404, { ok: false, error: "file_not_found" });
      }
      const ext = path.extname(full).toLowerCase();
      let ctype = "application/octet-stream";
      if (ext === ".js") ctype = "application/javascript; charset=utf-8";
      else if (ext === ".css") ctype = "text/css; charset=utf-8";
      else if (ext === ".map") ctype = "application/json; charset=utf-8";
      else if (ext === ".svg") ctype = "image/svg+xml";
      else if (ext === ".png") ctype = "image/png";
      else if (ext === ".jpg" || ext === ".jpeg") ctype = "image/jpeg";
      else if (ext === ".gif") ctype = "image/gif";
      else if (ext === ".webp") ctype = "image/webp";
      res.writeHead(200, { "Content-Type": ctype, "Cache-Control": "no-cache, no-store, must-revalidate" });
      fs.createReadStream(full).pipe(res);
      return;
    }

    return jsonReply(res, 404, { ok: false, error: "not_found" });
  } catch (e) {
    return jsonReply(res, 500, { ok: false, error: e.message || String(e) });
  }
});

server.timeout = 300000; // 5 min — prevents Node from dropping long-running requests
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.listen(PORT, HOST, () => {
  console.log(`[furlab-web-plugin] http://${HOST}:${PORT}`);
  console.log(`[furlab-web-plugin] db=${DB_PATH}`);
});
