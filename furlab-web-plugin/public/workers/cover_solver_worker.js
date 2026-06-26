/* eslint-disable no-restricted-globals */
"use strict";

/**
 * cover_solver_worker.js
 * Lightweight worker for:
 *  - bootstrap: build gridSpec + (optional) zone bbox cache
 *  - prerank: deterministic, time-sliced Monte Carlo pre-ranking of candidate scraps vs zone
 *
 * Protocol (main thread):
 *  postMessage({ type:"start", jobId, payload:{ mode, zonePoints, config, candidates } })
 *  postMessage({ type:"cancel", jobId })
 *
 * Worker emits:
 *  { type:"progress", jobId, phase, progressPercent }
 *  { type:"done", jobId, ok:true, ...result }
 *  { type:"error", jobId, error }
 */

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function polygonBBox(points) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const pts = Array.isArray(points) ? points : [];
  for (const p of pts) {
    const x = safeNum(p && p.x);
    const y = safeNum(p && p.y);
    if (x === null || y === null) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function pointInPolygon(point, polygon) {
  let inside = false;
  const poly = Array.isArray(polygon) ? polygon : [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      (yi > point.y) !== (yj > point.y) &&
      point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function parseScrapContourPoints(scrapContourText) {
  if (!scrapContourText) return [];
  try {
    const parsed = JSON.parse(String(scrapContourText));
    const arr = Array.isArray(parsed && parsed.path) ? parsed.path : [];
    const out = [];
    for (const p of arr) {
      const x = safeNum(p && p.x);
      const y = safeNum(p && p.y);
      if (x !== null && y !== null) out.push({ x, y });
    }
    return out;
  } catch (_) {
    return [];
  }
}

function hash32FromString(s) {
  // FNV-1a 32-bit
  let h = 2166136261 >>> 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function createSeededRng(seed) {
  // Mulberry32
  let a = (Number(seed) >>> 0) || 0x9e3779b9;
  return {
    next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  };
}

function createGridSpec(zoneBBox, rasterMm, padCells) {
  const r = Math.max(1, Math.min(10, Number(rasterMm || 2)));
  const pad = Math.max(0, Math.min(8, Number(padCells || 2)));

  const minX = Number(zoneBBox && zoneBBox.minX);
  const minY = Number(zoneBBox && zoneBBox.minY);
  const maxX = Number(zoneBBox && zoneBBox.maxX);
  const maxY = Number(zoneBBox && zoneBBox.maxY);
  const eps = Math.max(1e-6, r * 1e-8);

  function snapFloor(v) {
    if (!Number.isFinite(v)) return 0;
    const kRound = Math.round(v / r);
    const vRound = kRound * r;
    if (Math.abs(v - vRound) <= eps) return vRound;
    return Math.floor(v / r) * r;
  }

  let ox = snapFloor(minX);
  let oy = snapFloor(minY);
  ox -= pad * r;
  oy -= pad * r;

  const width = Math.ceil((maxX - ox) / r) + 1 + pad;
  const height = Math.ceil((maxY - oy) / r) + 1 + pad;

  return {
    r,
    padCells: pad,
    ox,
    oy,
    width: Math.max(1, width),
    height: Math.max(1, height),
    nx: Math.max(1, width),
    ny: Math.max(1, height)
  };
}

function nowMs() {
  return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
}

const jobs = new Map();

function postProgress(jobId, phase, progressPercent) {
  postMessage({
    type: "progress",
    jobId,
    phase,
    progressPercent: Math.max(0, Math.min(100, Number(progressPercent) || 0))
  });
}

function postDone(jobId, payload) {
  postMessage({ type: "done", jobId, ...payload });
}

function postErr(jobId, error) {
  postMessage({ type: "error", jobId, error: String(error && error.message ? error.message : error) });
}

function doBootstrap(job) {
  const zonePoints = job.zonePoints;
  const bbox = polygonBBox(zonePoints);
  if (!bbox) throw new Error("zone_bbox_failed");
  const cfg = job.config || {};
  const rasterMm = Math.max(1, Math.min(10, Number(cfg.rasterMm || 2)));
  const padCells = Math.max(0, Math.min(8, Number(cfg.padCells || 2)));
  const gridSpec = createGridSpec(bbox, rasterMm, padCells);

  postProgress(job.jobId, "bootstrap", 100);
  postDone(job.jobId, { ok: true, mode: "bootstrap", gridSpec });
  jobs.delete(job.jobId);
}

function doPrerank(job) {
  const zonePoints = job.zonePoints;
  const zoneBbox = polygonBBox(zonePoints);
  if (!zoneBbox) throw new Error("zone_bbox_failed");

  const cfg = job.config || {};
  const seed = (safeNum(cfg.seed) !== null) ? Number(cfg.seed) : Date.now();
  const stepBudgetMs = Math.max(4, Math.min(40, Number(cfg.stepBudgetMs || 12)));
  const samplesBase = Math.max(80, Math.min(420, Number(cfg.prerankSamples || 220)));
  const candidates = Array.isArray(job.candidates) ? job.candidates : [];
  const total = candidates.length;

  const out = new Array(total);
  let i = 0;

  function step() {
    if (!jobs.has(job.jobId)) return;
    const t0 = nowMs();
    while (i < total) {
      const c = candidates[i] || {};
      const key = String((c && (c.inventoryTag || c.id)) || `cand_${i}`);
      const contour = parseScrapContourPoints(c && c.scrapContour);
      let score = -1e9;

      if (contour.length >= 3) {
        const bb = polygonBBox(contour);
        if (bb && bb.width > 1e-6 && bb.height > 1e-6) {
          // Deterministic sampling inside candidate bbox.
          const keyHash = hash32FromString(key);
          const rng = createSeededRng((seed ^ keyHash) >>> 0);
          // Scale samples mildly with bbox area, but keep bounded.
          const area = Math.max(1, bb.width * bb.height);
          const n = Math.max(80, Math.min(420, Math.round(samplesBase * Math.min(2.0, area / 60000))));
          let hits = 0;
          let insideZone = 0;
          let outsideZone = 0;

          for (let k = 0; k < n; k++) {
            const px = bb.minX + rng.next() * bb.width;
            const py = bb.minY + rng.next() * bb.height;
            const p = { x: px, y: py };
            if (!pointInPolygon(p, contour)) continue;
            hits++;
            if (pointInPolygon(p, zonePoints)) insideZone++;
            else outsideZone++;
          }

          if (hits >= 12) {
            const inRatio = insideZone / hits;
            // Reward pieces that sit inside zone; penalize outside.
            score = insideZone - 0.65 * outsideZone + 40 * inRatio;
          } else {
            score = -1e6; // too thin/degenerate
          }
        }
      }

      out[i] = {
        id: c && c.id,
        inventoryTag: c && c.inventoryTag,
        score
      };

      i++;
      const elapsed = nowMs() - t0;
      if (elapsed >= stepBudgetMs) break;
    }

    const pct = total > 0 ? (i / total) * 100 : 100;
    postProgress(job.jobId, "prerank", pct);

    if (i >= total) {
      // Sort descending score and return compact list (already stable enough).
      out.sort((a, b) => Number(b.score || -1e9) - Number(a.score || -1e9));
      postDone(job.jobId, { ok: true, mode: "prerank", prerank: out });
      jobs.delete(job.jobId);
      return;
    }

    setTimeout(step, 0);
  }

  step();
}

self.addEventListener("message", (e) => {
  const msg = e && e.data ? e.data : null;
  if (!msg) return;

  if (msg.type === "cancel") {
    const jobId = Number(msg.jobId);
    if (jobs.has(jobId)) jobs.delete(jobId);
    return;
  }

  if (msg.type !== "start") return;

  const jobId = Number(msg.jobId);
  const payload = msg.payload || {};
  const mode = String(payload.mode || "bootstrap");
  const zonePoints = Array.isArray(payload.zonePoints) ? payload.zonePoints : [];
  const config = payload.config || {};
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];

  jobs.set(jobId, { jobId, mode, zonePoints, config, candidates });

  try {
    postProgress(jobId, mode, 0);
    if (mode === "bootstrap") doBootstrap(jobs.get(jobId));
    else if (mode === "prerank") doPrerank(jobs.get(jobId));
    else throw new Error(`unknown_mode:${mode}`);
  } catch (err) {
    postErr(jobId, err);
    jobs.delete(jobId);
  }
});
