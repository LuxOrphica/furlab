#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const BASE = process.env.CMP_BASE_URL || "http://127.0.0.1:5660";
const IN_FILE = path.join(process.cwd(), "tmp", "selftest", "intarsia_ui_selftest.json");
const OUT_FILE = path.join(process.cwd(), "tmp", "selftest", "corner_edge_patch_compare.json");

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

function metricsFrom(res) {
  const pb = res && res.diagnostics && res.diagnostics.placementBreakdown && typeof res.diagnostics.placementBreakdown === "object"
    ? res.diagnostics.placementBreakdown
    : {};
  const rej = pb && pb.rejected && typeof pb.rejected === "object" ? pb.rejected : {};
  const matched = Number(pb["matched:matched"] || 0);
  const searchFailed = Number(pb["needs_attention:smart_not_found"] || 0);
  const insideLow = Number(rej.inside_low || 0) + Number(rej.tail_inside_low || 0);
  return {
    matched,
    coveragePct: Number(res && res.coveragePercent || 0),
    insideLow,
    smartNotFound: searchFailed,
    runtimeMs: Number(res && res.timingMs && res.timingMs.matching || 0)
  };
}

async function main() {
  const inJson = JSON.parse(fs.readFileSync(IN_FILE, "utf8"));
  const req = inJson.assignRequest;
  if (!req) throw new Error("assignRequest missing in selftest json");

  const common = {
    ...req,
    progressToken: undefined,
    constraints: { ...(req.constraints || {}) }
  };

  const beforeReq = {
    ...common,
    constraints: {
      ...(common.constraints || {})
    }
  };
  const afterReq = {
    ...common,
    constraints: {
      ...(common.constraints || {}),
      __enableCornerEdgeEnhance: true
    }
  };

  const beforeRes = await postJson(`${BASE}/api/layout/fill/preview`, beforeReq);
  const afterRes = await postJson(`${BASE}/api/layout/fill/preview`, afterReq);

  const report = {
    scope: "regular+intarsia+assignOnly",
    baseUrl: BASE,
    before: metricsFrom(beforeRes),
    after: metricsFrom(afterRes)
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), "utf8");
  console.log(`COMPARE_REPORT ${OUT_FILE}`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
