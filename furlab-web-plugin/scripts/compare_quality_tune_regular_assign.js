#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const BASE = process.env.CMP_BASE_URL || "http://127.0.0.1:5660";
const IN_FILE = path.join(process.cwd(), "tmp", "selftest", "intarsia_ui_selftest.json");
const OUT_FILE = path.join(process.cwd(), "tmp", "selftest", "quality_tune_compare.json");

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

function summarize(res) {
  const placements = Array.isArray(res && res.placements) ? res.placements : [];
  const matched = placements.filter((p) => String(p && p.status || "") === "matched");
  const avgInside = matched.length
    ? matched.reduce((a, p) => a + Number(p && p.fitInsidePercent || 0), 0) / matched.length
    : 0;
  const avgOutside = Math.max(0, 100 - avgInside);
  const pb = res && res.diagnostics && res.diagnostics.placementBreakdown && typeof res.diagnostics.placementBreakdown === "object"
    ? res.diagnostics.placementBreakdown
    : {};
  const rej = pb && pb.rejected && typeof pb.rejected === "object" ? pb.rejected : {};
  return {
    matched: Number(pb["matched:matched"] || matched.length || 0),
    smartNotFound: Number(pb["needs_attention:smart_not_found"] || 0),
    insideLow: Number(rej.inside_low || 0) + Number(rej.tail_inside_low || 0),
    coveragePct: Number(res && res.coveragePercent || 0),
    avgInsideRatioPct: Number(avgInside.toFixed(2)),
    avgOutsidePct: Number(avgOutside.toFixed(2)),
    runtimeMs: Number(res && res.timingMs && res.timingMs.matching || 0)
  };
}

async function main() {
  const input = JSON.parse(fs.readFileSync(IN_FILE, "utf8"));
  const req = input && input.assignRequest;
  if (!req) throw new Error("assignRequest missing in selftest json");

  const baselineReq = {
    ...req,
    progressToken: undefined,
    constraints: {
      ...(req.constraints || {}),
      __qualityTuneRegularV1: false
    }
  };
  const tunedReq = {
    ...req,
    progressToken: undefined,
    constraints: {
      ...(req.constraints || {}),
      __qualityTuneRegularV1: true
    }
  };

  const baselineRes = await postJson(`${BASE}/api/layout/fill/preview`, baselineReq);
  const tunedRes = await postJson(`${BASE}/api/layout/fill/preview`, tunedReq);

  const report = {
    scope: "regular+intarsia+assignOnly",
    baseUrl: BASE,
    baseline: summarize(baselineRes),
    tuned: summarize(tunedRes)
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), "utf8");
  console.log(`QUALITY_COMPARE_REPORT ${OUT_FILE}`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

