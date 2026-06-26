#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const BASE = process.env.CMP_BASE_URL || "http://127.0.0.1:5600";
const SPAWN_SERVER = String(process.env.CMP_SPAWN_SERVER || "") === "1";
const SPAWN_PORT = String(process.env.CMP_SPAWN_PORT || "5613");
const IN_FILE = path.join(process.cwd(), "tmp", "selftest", "intarsia_ui_selftest.json");
const OUT_FILE = path.join(process.cwd(), "tmp", "selftest", "tiebreak_compare.json");

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForHealth(baseUrl, timeoutMs) {
  const started = Date.now();
  let lastErr = "";
  while ((Date.now() - started) < timeoutMs) {
    try {
      const r = await fetch(`${baseUrl}/api/health`);
      if (r.ok) return true;
      lastErr = `status=${r.status}`;
    } catch (e) {
      lastErr = String(e && e.message || e);
    }
    await sleep(250);
  }
  throw new Error(`health_timeout: ${lastErr}`);
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json || json.ok === false) {
    throw new Error(`${url} => ${(json && (json.error || json.message)) || res.status}`);
  }
  return json;
}

function asNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function summarize(res) {
  const placements = Array.isArray(res && res.placements) ? res.placements : [];
  const matched = placements.filter((p) => String(p && p.status || "") === "matched");
  const pb = res && res.diagnostics && res.diagnostics.placementBreakdown && typeof res.diagnostics.placementBreakdown === "object"
    ? res.diagnostics.placementBreakdown
    : {};
  const rej = pb && pb.rejected && typeof pb.rejected === "object" ? pb.rejected : {};
  return {
    matched: Number(pb["matched:matched"] || matched.length || 0),
    smartNotFound: Number(pb["needs_attention:smart_not_found"] || 0),
    insideLow: Number(rej.inside_low || 0) + Number(rej.tail_inside_low || 0),
    coveragePct: asNum(res && res.coveragePercent),
    avgInsidePct: matched.length
      ? Number((matched.reduce((a, p) => a + asNum(p && p.fitInsidePercent), 0) / matched.length).toFixed(2))
      : 0,
    avgOutsidePct: matched.length
      ? Number((matched.reduce((a, p) => a + Math.max(0, 100 - asNum(p && p.fitInsidePercent)), 0) / matched.length).toFixed(2))
      : 0,
    runtimeMs: asNum(res && res.timingMs && res.timingMs.matching)
  };
}

function mapMatchedByFragment(res) {
  const out = new Map();
  const placements = Array.isArray(res && res.placements) ? res.placements : [];
  for (const p of placements) {
    if (String(p && p.status || "") !== "matched") continue;
    out.set(Number(p && p.fragmentId || 0), p);
  }
  return out;
}

async function main() {
  let child = null;
  const baseUrl = SPAWN_SERVER ? `http://127.0.0.1:${SPAWN_PORT}` : BASE;
  if (SPAWN_SERVER) {
    child = spawn(process.execPath, ["src/server.js"], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: SPAWN_PORT },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    await waitForHealth(baseUrl, 20000);
  }

  try {
    const input = JSON.parse(fs.readFileSync(IN_FILE, "utf8"));
    const req = input && input.assignRequest;
    if (!req) throw new Error("assignRequest missing in selftest json");

    const baselineReq = {
      ...req,
      progressToken: undefined,
      constraints: {
        ...(req.constraints || {}),
        __enableRegularTieBreak: false,
        __debugTopK: 3
      }
    };
    const tunedReq = {
      ...req,
      progressToken: undefined,
      constraints: {
        ...(req.constraints || {}),
        __enableRegularTieBreak: true,
        __debugTopK: 3
      }
    };

    const baselineRes = await postJson(`${baseUrl}/api/layout/fill/preview`, baselineReq);
    const tunedRes = await postJson(`${baseUrl}/api/layout/fill/preview`, tunedReq);

    const baseMap = mapMatchedByFragment(baselineRes);
    const tunedMap = mapMatchedByFragment(tunedRes);
    const changed = [];
    for (const [fid, bp] of baseMap.entries()) {
      const tp = tunedMap.get(fid);
      if (!tp) continue;
      const bTag = String(bp && bp.inventoryTag || "");
      const tTag = String(tp && tp.inventoryTag || "");
      const changedTag = bTag !== tTag;
      const bInside = asNum(bp && bp.fitInsidePercent);
      const tInside = asNum(tp && tp.fitInsidePercent);
      const bOut = Math.max(0, 100 - bInside);
      const tOut = Math.max(0, 100 - tInside);
      if (changedTag || Math.abs(tInside - bInside) >= 0.1 || Math.abs(tOut - bOut) >= 0.1) {
        changed.push({
          fragmentId: fid,
          fragmentClass: String(tp && tp.fragmentClass || bp && bp.fragmentClass || ""),
          baseline: {
            inventoryTag: bTag,
            fitCoverageRatio: asNum(bp && bp.fitCoverageRatio),
            fitInsidePercent: bInside,
            outsidePercent: bOut,
            smartScore: asNum(bp && bp.smartScore),
            tieBreakUsed: !!(bp && bp.tieBreakUsed)
          },
          tuned: {
            inventoryTag: tTag,
            fitCoverageRatio: asNum(tp && tp.fitCoverageRatio),
            fitInsidePercent: tInside,
            outsidePercent: tOut,
            smartScore: asNum(tp && tp.smartScore),
            tieBreakUsed: !!(tp && tp.tieBreakUsed)
          },
          changedTop1: changedTag
        });
      }
    }

    const out = {
      scope: "regular+intarsia+assignOnly",
      baseUrl,
      rule: {
        enabledFlag: "constraints.__enableRegularTieBreak",
        scoreDeltaThreshold: 0.03,
        coverageRetention: 0.65,
        minInsideGain: 0.05,
        minOutsideGain: 0.05,
        hardGuards: [
          "candidate passes existing fit/minCoverage/minInside gates",
          "score delta <= threshold",
          "coverage(candidate) >= max(minCoverageNeed, coverage(best)*coverageRetention)",
          "prefer higher inside and/or lower outside without opposite strong regression"
        ]
      },
      baseline: summarize(baselineRes),
      tuned: summarize(tunedRes),
      changedFragments: changed.sort((a, b) => a.fragmentId - b.fragmentId)
    };

    fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
    console.log(`TIEBREAK_COMPARE_REPORT ${OUT_FILE}`);
    console.log(JSON.stringify({
      baseline: out.baseline,
      tuned: out.tuned,
      changedFragments: out.changedFragments.length
    }, null, 2));
  } finally {
    if (child && !child.killed) child.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
