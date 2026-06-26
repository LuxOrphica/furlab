const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function argValue(name, def = '') {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return def;
}
const apply = process.argv.includes('--apply');
const defaultScanSide = argValue('--default-scan-side', 'leather_up').trim().toLowerCase() || 'leather_up';
const dbPathArg = argValue('--db', '');
const root = process.cwd();
const dbPath = dbPathArg || process.env.FURLAB_DB_PATH || path.join(root, 'BD', 'Furlab 1.accdb');

const scriptsDir = path.join(root, 'scripts');
const readRegistry = path.join(scriptsDir, 'access_read_registry.js');
const readPiece = path.join(scriptsDir, 'access_read_piece.js');
const contourUpdater = path.join(scriptsDir, 'access_update_piece_contour_metrics.js');

function runCscript(jsPath, args) {
  const run = spawnSync('cscript', ['//nologo', jsPath, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return run;
}

function parseJsonOut(text) {
  const s = String(text || '').replace(/^\uFEFF/, '').trim();
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

function normalizePathPoints(pathIn) {
  if (!Array.isArray(pathIn)) return [];
  const out = [];
  for (const p of pathIn) {
    const x = toNum(p && p.x);
    const y = toNum(p && p.y);
    if (x === null || y === null) continue;
    out.push({ x, y });
  }
  if (out.length >= 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (a.x === b.x && a.y === b.y) out.pop();
  }
  return out;
}

function closePath(pathIn) {
  if (!Array.isArray(pathIn) || pathIn.length < 1) return [];
  const out = pathIn.slice();
  const a = out[0];
  const b = out[out.length - 1];
  if (a.x !== b.x || a.y !== b.y) out.push({ x: a.x, y: a.y });
  return out;
}

function signedArea2D(pathIn) {
  if (!Array.isArray(pathIn) || pathIn.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pathIn.length; i++) {
    const a = pathIn[i];
    const b = pathIn[(i + 1) % pathIn.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function ensureClockwiseScreen(pathIn) {
  if (!Array.isArray(pathIn) || pathIn.length < 3) return pathIn;
  return signedArea2D(pathIn) >= 0 ? pathIn : pathIn.slice().reverse();
}

function contourBBox(pathIn) {
  if (!Array.isArray(pathIn) || pathIn.length < 1) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of pathIn) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
  return { minX, minY, maxX, maxY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

function buildCanonicalContourForLayout(contour, scanSide) {
  if (!contour || typeof contour !== 'object') return null;
  const raw = normalizePathPoints(contour.path);
  if (raw.length < 3) return null;
  const units = String(contour.units || 'mm');
  let canonicalPath = raw;
  let canonicalized = false;
  if (String(scanSide || '').toLowerCase() === 'leather_up') {
    const bb = contourBBox(raw);
    if (!bb) return null;
    const cx = (bb.minX + bb.maxX) / 2;
    canonicalPath = raw.map((p) => ({ x: 2 * cx - p.x, y: p.y }));
    canonicalized = true;
  }
  canonicalPath = ensureClockwiseScreen(canonicalPath);
  const bb2 = contourBBox(canonicalPath);
  if (!bb2) return null;
  return {
    ...contour,
    units,
    path: closePath(canonicalPath),
    source: {
      ...(contour.source && typeof contour.source === 'object' ? contour.source : {}),
      canonicalized,
      canonicalizationMethod: canonicalized ? 'mirror_vertical_bbox_center' : null,
      scanSide: scanSide || null,
    },
    metrics: {
      area: Math.abs(signedArea2D(canonicalPath)),
      bboxWidth: bb2.width,
      bboxHeight: bb2.height,
    },
  };
}

function parseObj(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try {
    const x = JSON.parse(String(v));
    return x && typeof x === 'object' ? x : null;
  } catch (_) {
    return null;
  }
}

function escSql(s) {
  return String(s).replace(/'/g, "''");
}

if (!fs.existsSync(dbPath)) {
  console.error(JSON.stringify({ ok: false, error: 'db_not_found', dbPath }));
  process.exit(1);
}

const regRun = runCscript(readRegistry, [dbPath, '0']);
if (regRun.status !== 0) {
  console.error(JSON.stringify({ ok: false, error: 'read_registry_failed', status: regRun.status, stdout: regRun.stdout, stderr: regRun.stderr }));
  process.exit(2);
}
const regJson = parseJsonOut(regRun.stdout);
if (!regJson || !regJson.ok || !Array.isArray(regJson.items)) {
  console.error(JSON.stringify({ ok: false, error: 'read_registry_parse_failed', stdout: regRun.stdout }));
  process.exit(3);
}

const stats = {
  total: 0,
  withContour: 0,
  withRaw: 0,
  withCanonical: 0,
  withScanSide: 0,
  fullyNormalized: 0,
  needsBackfill: 0,
  updatedCandidates: 0,
  skippedInvalid: 0,
};

const updates = [];
const sampleNeeds = [];

for (const r of regJson.items) {
  const id = String(r && r.id || '').trim();
  if (!id) continue;
  stats.total += 1;

  const pr = runCscript(readPiece, [dbPath, id]);
  if (pr.status !== 0) {
    stats.skippedInvalid += 1;
    continue;
  }
  const pj = parseJsonOut(pr.stdout);
  const item = pj && pj.ok ? pj.item : null;
  if (!item || typeof item !== 'object') {
    stats.skippedInvalid += 1;
    continue;
  }

  const metrics = parseObj(item.metricsJson) || {};
  const contourStored = parseObj(item.scrapContour);
  const scanSide = String(metrics.scanSide || defaultScanSide).trim().toLowerCase();
  const contourRaw = (metrics.contourRaw && typeof metrics.contourRaw === 'object') ? metrics.contourRaw : contourStored;
  const contourCanonical = (metrics.contourCanonical && typeof metrics.contourCanonical === 'object')
    ? metrics.contourCanonical
    : buildCanonicalContourForLayout(contourRaw, scanSide);

  const hasContour = !!(contourStored && typeof contourStored === 'object');
  const hasRaw = !!(metrics.contourRaw && typeof metrics.contourRaw === 'object');
  const hasCanonical = !!(metrics.contourCanonical && typeof metrics.contourCanonical === 'object');
  const hasScanSide = !!String(metrics.scanSide || '').trim();

  if (hasContour) stats.withContour += 1;
  if (hasRaw) stats.withRaw += 1;
  if (hasCanonical) stats.withCanonical += 1;
  if (hasScanSide) stats.withScanSide += 1;

  const isFully = hasScanSide && hasRaw && hasCanonical;
  if (isFully) {
    stats.fullyNormalized += 1;
  } else {
    stats.needsBackfill += 1;
  }

  if (!contourRaw || !contourCanonical) {
    stats.skippedInvalid += 1;
    continue;
  }

  const rawNap = toNum(metrics.napDirectionDegRaw);
  const fromFieldNap = toNum(item.napDirectionDeg);
  // Important: item.napDirectionDeg is already canonical in current pipeline.
  // Re-applying 180-raw when raw is absent causes direction inversion.
  const napCanonical = rawNap !== null
    ? (scanSide === 'leather_up' ? normalizeDeg360(180 - rawNap) : normalizeDeg360(rawNap))
    : normalizeDeg360(fromFieldNap);
  const napRaw = rawNap !== null ? rawNap : null;

  const nextMetrics = {
    ...metrics,
    scanSide,
    contourNormalization: {
      applied: true,
      method: 'mirror_vertical_bbox_center',
      axis: 'bbox_center_x',
      canonicalFrame: 'layout_face_side',
    },
    contourRaw,
    contourCanonical,
    napDirectionDegRaw: napRaw,
    napDirectionDegCanonical: napCanonical,
  };

  const oldMetricsStr = String(item.metricsJson || '');
  const newMetricsStr = JSON.stringify(nextMetrics);
  const newContourStr = JSON.stringify(contourCanonical);
  const oldContourStr = String(item.scrapContour || '');

  const needsUpdate = oldMetricsStr !== newMetricsStr || oldContourStr !== newContourStr || (napCanonical !== null && Number(item.napDirectionDeg) !== napCanonical);

  if (needsUpdate) {
    stats.updatedCandidates += 1;
    if (sampleNeeds.length < 12) {
      sampleNeeds.push({
        id,
        inventoryTag: String(item.inventoryTag || ''),
        hadScanSide: hasScanSide,
        hadRaw: hasRaw,
        hadCanonical: hasCanonical,
      });
    }

    updates.push({
      id,
      inventoryTag: String(item.inventoryTag || ''),
      metricsJson: newMetricsStr,
      scrapContour: newContourStr,
      napDirectionDeg: napCanonical,
    });
  }
}

if (!apply) {
  process.stdout.write(JSON.stringify({ ok: true, mode: 'audit', dbPath, stats, sampleNeeds }, null, 2));
  process.exit(0);
}

if (!updates.length) {
  process.stdout.write(JSON.stringify({ ok: true, mode: 'apply', dbPath, stats, applied: 0, message: 'nothing_to_update' }, null, 2));
  process.exit(0);
}

const tmpDir = path.join(root, 'tmp', 'access-api');
fs.mkdirSync(tmpDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const jsonPath = path.join(tmpDir, `normalize_contours_${stamp}.json`);
const logPath = path.join(tmpDir, `normalize_contours_${stamp}.log`);

fs.writeFileSync(jsonPath, JSON.stringify(updates, null, 2), 'utf8');

const up = runCscript(contourUpdater, [dbPath, jsonPath, logPath]);
if (up.status !== 0) {
  console.error(JSON.stringify({ ok: false, error: 'apply_failed', status: up.status, stdout: up.stdout, stderr: up.stderr, jsonPath, logPath }, null, 2));
  process.exit(4);
}

process.stdout.write(JSON.stringify({
  ok: true,
  mode: 'apply',
  dbPath,
  stats,
  applied: updates.length,
  jsonPath,
  logPath,
  runnerOut: String(up.stdout || '').trim(),
}, null, 2));


