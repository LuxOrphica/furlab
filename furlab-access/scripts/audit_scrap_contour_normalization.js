const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function argValue(name, def = "") {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return def;
}

const root = process.cwd();
const dbPath = argValue("--db", "") || process.env.FURLAB_DB_PATH || path.join(root, "BD", "Furlab 1.accdb");
const outPath = argValue("--out", "");
const maxSamples = Math.max(1, Math.min(50, Number(argValue("--samples", "12")) || 12));
const apply = process.argv.includes("--apply");

const scriptsDir = path.join(root, "scripts");
const readRegistry = path.join(scriptsDir, "access_read_registry.js");
const readPiece = path.join(scriptsDir, "access_read_piece_lite.js");
const updatePieces = path.join(scriptsDir, "access_update_piece_contour_metrics.js");

function runCscript(jsPath, args) {
  return spawnSync("cscript", ["//nologo", jsPath, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
}

function parseJsonOut(text) {
  const s = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch (_) { return null; }
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeDeg360(v) {
  const n = toNum(v);
  if (n === null) return null;
  let out = n % 360;
  if (out < 0) out += 360;
  return out;
}

function parseObj(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try {
    const x = JSON.parse(String(v));
    return x && typeof x === "object" ? x : null;
  } catch (_) {
    return null;
  }
}

function normalizePathPoints(pathIn) {
  if (!Array.isArray(pathIn)) return [];
  const out = [];
  for (const p of pathIn) {
    const x = toNum(p && p.x);
    const y = toNum(p && p.y);
    if (x !== null && y !== null) out.push({ x, y });
  }
  if (out.length >= 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-8) out.pop();
  }
  return out;
}

function contourPoints(contour) {
  const obj = parseObj(contour);
  return normalizePathPoints(obj && obj.path);
}

function closePath(pathIn) {
  if (!Array.isArray(pathIn) || pathIn.length < 1) return [];
  const out = pathIn.slice();
  const a = out[0];
  const b = out[out.length - 1];
  if (Math.hypot(a.x - b.x, a.y - b.y) >= 1e-8) out.push({ x: a.x, y: a.y });
  return out;
}

function contourBBox(pathIn) {
  if (!Array.isArray(pathIn) || pathIn.length < 1) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of pathIn) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function signedArea(pathIn) {
  if (!Array.isArray(pathIn) || pathIn.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pathIn.length; i++) {
    const a = pathIn[i];
    const b = pathIn[(i + 1) % pathIn.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function rotatePathDeg(pathIn, deg) {
  const rad = Number(deg) * Math.PI / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return (pathIn || []).map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
}

function mirrorVerticalByBBoxCenter(pathIn) {
  const bb = contourBBox(pathIn);
  if (!bb) return [];
  return pathIn.map((p) => ({ x: 2 * bb.cx - p.x, y: p.y }));
}

function centerPath(pathIn) {
  const bb = contourBBox(pathIn);
  if (!bb) return [];
  return pathIn.map((p) => ({ x: p.x - bb.cx, y: p.y - bb.cy }));
}

function bestShapeDiff(aRaw, bRaw) {
  const a = centerPath(aRaw);
  const b0 = centerPath(bRaw);
  if (a.length !== b0.length) return { rms: Infinity, max: Infinity, note: `point_count ${a.length}/${b0.length}` };
  if (a.length < 3) return { rms: Infinity, max: Infinity, note: "too_few_points" };
  const variants = [b0, b0.slice().reverse()];
  let best = { rms: Infinity, max: Infinity, note: "" };
  for (let vi = 0; vi < variants.length; vi++) {
    const b = variants[vi];
    for (let shift = 0; shift < b.length; shift++) {
      let ss = 0;
      let mx = 0;
      for (let i = 0; i < a.length; i++) {
        const q = b[(i + shift) % b.length];
        const d = Math.hypot(a[i].x - q.x, a[i].y - q.y);
        ss += d * d;
        mx = Math.max(mx, d);
      }
      const rms = Math.sqrt(ss / a.length);
      if (rms < best.rms) best = { rms, max: mx, note: `${vi ? "rev" : "fwd"}:${shift}` };
    }
  }
  return best;
}

function buildCanonicalFromRaw(rawPts) {
  const mirrored = mirrorVerticalByBBoxCenter(rawPts);
  return signedArea(mirrored) >= 0 ? mirrored : mirrored.slice().reverse();
}

function buildLayoutNormFromRaw(rawPts, rawNapDeg) {
  const canonical = buildCanonicalFromRaw(rawPts);
  const napFurUp = normalizeDeg360(180 - rawNapDeg);
  if (napFurUp === null) return [];
  return rotatePathDeg(canonical, 90 - napFurUp);
}

function round1(v) {
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}

function bboxLabel(pts) {
  const bb = contourBBox(pts);
  return bb ? `${round1(bb.width)} x ${round1(bb.height)}` : "";
}

function maxPointSpan(pathIn) {
  if (!Array.isArray(pathIn) || pathIn.length < 2) return null;
  let max = 0;
  for (let i = 0; i < pathIn.length; i++) {
    for (let j = i + 1; j < pathIn.length; j++) {
      const d = Math.hypot(pathIn[i].x - pathIn[j].x, pathIn[i].y - pathIn[j].y);
      max = Math.max(max, d);
    }
  }
  return max;
}

function contourToJson(pathIn, source) {
  const pathClosed = closePath(pathIn);
  const bb = contourBBox(pathIn);
  return JSON.stringify({
    units: "mm",
    path: pathClosed,
    source: {
      frame: "layout_norm",
      scanSide: "leather_up",
      napTargetDeg: 90,
      method: "mirror_vertical_bbox_center_then_rotate",
      ...(source && typeof source === "object" ? source : {}),
    },
    metrics: {
      area: Math.abs(signedArea(pathIn)),
      bboxWidth: bb ? bb.width : null,
      bboxHeight: bb ? bb.height : null,
    },
  });
}

function addSample(samples, key, row) {
  if (!samples[key]) samples[key] = [];
  if (samples[key].length < maxSamples) samples[key].push(row);
}

if (!fs.existsSync(dbPath)) {
  console.error(JSON.stringify({ ok: false, error: "db_not_found", dbPath }, null, 2));
  process.exit(1);
}

const regRun = runCscript(readRegistry, [dbPath, "0"]);
if (regRun.status !== 0) {
  console.error(JSON.stringify({ ok: false, error: "read_registry_failed", status: regRun.status, stdout: regRun.stdout, stderr: regRun.stderr }, null, 2));
  process.exit(2);
}
const regJson = parseJsonOut(regRun.stdout);
if (!regJson || !regJson.ok || !Array.isArray(regJson.items)) {
  console.error(JSON.stringify({ ok: false, error: "read_registry_parse_failed", stdout: regRun.stdout }, null, 2));
  process.exit(3);
}

const stats = {
  total: 0,
  readable: 0,
  invalid: 0,
  missingRaw: 0,
  missingRawNap: 0,
  hasCanonical: 0,
  currentIsLayoutNorm: 0,
  currentIsCanonical: 0,
  currentOther: 0,
  wouldMigrate: 0,
};
const samples = {};
const updates = [];
const layoutToleranceMm = 0.05;
const canonicalToleranceMm = 0.05;

for (const r of regJson.items) {
  const id = String(r && r.id || "").trim();
  const tag = String(r && r.inventoryTag || "").trim();
  if (!id && !tag) continue;
  stats.total += 1;

  const pieceRun = runCscript(readPiece, [dbPath, tag || id]);
  const pieceJson = parseJsonOut(pieceRun.stdout);
  const item = pieceJson && pieceJson.ok ? pieceJson.item : null;
  if (pieceRun.status !== 0 || !item) {
    stats.invalid += 1;
    addSample(samples, "invalid", { id, inventoryTag: tag, reason: "read_failed" });
    continue;
  }
  stats.readable += 1;

  const metrics = parseObj(item.metricsJson) || {};
  const rawPts = contourPoints(metrics.contourRaw);
  const currentPts = contourPoints(item.scrapContour);
  const canonicalPts = contourPoints(metrics.contourCanonical);
  const rawNap = toNum(metrics.napDirectionDegRaw);
  if (canonicalPts.length >= 3) stats.hasCanonical += 1;

  if (rawPts.length < 3) {
    stats.missingRaw += 1;
    addSample(samples, "missingRaw", { id: item.id, inventoryTag: item.inventoryTag });
    continue;
  }
  if (rawNap === null) {
    stats.missingRawNap += 1;
    addSample(samples, "missingRawNap", { id: item.id, inventoryTag: item.inventoryTag });
    continue;
  }
  if (currentPts.length < 3) {
    stats.invalid += 1;
    addSample(samples, "invalid", { id: item.id, inventoryTag: item.inventoryTag, reason: "scrapContour_invalid" });
    continue;
  }

  const expectedLayout = buildLayoutNormFromRaw(rawPts, rawNap);
  const expectedCanonical = buildCanonicalFromRaw(rawPts);
  const dLayout = bestShapeDiff(expectedLayout, currentPts);
  const dCanonical = bestShapeDiff(expectedCanonical, currentPts);
  const isLayout = dLayout.rms <= layoutToleranceMm;
  const isCanonical = dCanonical.rms <= canonicalToleranceMm;

  if (isLayout) {
    stats.currentIsLayoutNorm += 1;
    addSample(samples, "currentIsLayoutNorm", {
      inventoryTag: item.inventoryTag,
      napDirectionDeg: round1(toNum(item.napDirectionDeg)),
      bbox: bboxLabel(currentPts),
    });
  } else if (isCanonical) {
    stats.currentIsCanonical += 1;
    stats.wouldMigrate += 1;
    const expectedBb = contourBBox(expectedLayout);
    updates.push({
      id: item.id,
      inventoryTag: item.inventoryTag,
      metricsJson: String(item.metricsJson || ""),
      scrapContour: contourToJson(expectedLayout),
      napDirectionDeg: 90,
      bboxWidthMm: expectedBb ? expectedBb.width : null,
      bboxHeightMm: expectedBb ? expectedBb.height : null,
      maxSpanMm: maxPointSpan(expectedLayout),
    });
    addSample(samples, "currentIsCanonical", {
      inventoryTag: item.inventoryTag,
      napDirectionDeg: round1(toNum(item.napDirectionDeg)),
      rawNap: round1(rawNap),
      expectedNapAfterMigration: 90,
      currentBbox: bboxLabel(currentPts),
      expectedLayoutBbox: bboxLabel(expectedLayout),
      layoutRmsMm: round1(dLayout.rms),
    });
  } else {
    stats.currentOther += 1;
    stats.wouldMigrate += 1;
    const expectedBb = contourBBox(expectedLayout);
    updates.push({
      id: item.id,
      inventoryTag: item.inventoryTag,
      metricsJson: String(item.metricsJson || ""),
      scrapContour: contourToJson(expectedLayout),
      napDirectionDeg: 90,
      bboxWidthMm: expectedBb ? expectedBb.width : null,
      bboxHeightMm: expectedBb ? expectedBb.height : null,
      maxSpanMm: maxPointSpan(expectedLayout),
    });
    addSample(samples, "currentOther", {
      inventoryTag: item.inventoryTag,
      napDirectionDeg: round1(toNum(item.napDirectionDeg)),
      rawNap: round1(rawNap),
      currentBbox: bboxLabel(currentPts),
      expectedLayoutBbox: bboxLabel(expectedLayout),
      layoutRmsMm: round1(dLayout.rms),
      canonicalRmsMm: round1(dCanonical.rms),
      layoutNote: dLayout.note,
      canonicalNote: dCanonical.note,
    });
  }
}

let applyResult = null;
if (apply) {
  const tmpDir = path.join(root, "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const updatesPath = path.join(tmpDir, `scrap_contour_layout_norm_updates_${stamp}.json`);
  const logPath = path.join(tmpDir, `scrap_contour_layout_norm_updates_${stamp}.log`);
  fs.writeFileSync(updatesPath, JSON.stringify(updates, null, 2), "utf8");
  const updateRun = runCscript(updatePieces, [dbPath, updatesPath, logPath]);
  applyResult = {
    updatesPath,
    logPath,
    status: updateRun.status,
    stdout: String(updateRun.stdout || "").trim(),
    stderr: String(updateRun.stderr || "").trim(),
  };
  if (updateRun.status !== 0) {
    applyResult.ok = false;
  } else {
    const parsed = parseJsonOut(updateRun.stdout);
    applyResult.ok = !!(parsed && parsed.ok);
    applyResult.result = parsed;
  }
}

const result = {
  ok: true,
  mode: apply ? "apply" : "audit",
  dbPath,
  toleranceMm: { layout: layoutToleranceMm, canonical: canonicalToleranceMm },
  stats,
  samples,
  applyResult,
  nextStep: "If stats look correct, back up the .accdb, then run a separate apply migration that sets scrapContour to normalized contour and napDirectionDeg to 90.",
};

const text = JSON.stringify(result, null, 2);
if (outPath) fs.writeFileSync(outPath, text, "utf8");
process.stdout.write(text);
