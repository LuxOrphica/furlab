#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const BASE = process.env.CMP_BASE_URL || "http://127.0.0.1:5600";
const SPAWN_SERVER = String(process.env.CMP_SPAWN_SERVER || "") === "1";
const SPAWN_PORT = String(process.env.CMP_SPAWN_PORT || "5612");
const IN_FILE = path.join(process.cwd(), "tmp", "selftest", "intarsia_ui_selftest.json");
const OUT_FILE = path.join(process.cwd(), "tmp", "selftest", "worst_matched_top_choices_report.json");

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

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

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
    await sleep(300);
  }
  throw new Error(`health_timeout: ${lastErr}`);
}

function asNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function placementSummary(p) {
  return {
    fragmentId: asNum(p && p.fragmentId),
    inventoryTag: String(p && p.inventoryTag || ""),
    scrapPieceId: String(p && p.scrapPieceId || ""),
    fragmentClass: String(p && p.fragmentClass || ""),
    fitScore: asNum(p && p.fitScore),
    fitCoverageRatio: asNum(p && p.fitCoverageRatio),
    fitInsidePercent: asNum(p && p.fitInsidePercent),
    outsidePercent: Math.max(0, 100 - asNum(p && p.fitInsidePercent)),
    smartScore: asNum(p && p.smartScore),
    smartExplain: p && p.smartExplain ? p.smartExplain : null
  };
}

function topChoiceSummary(c) {
  return {
    inventoryTag: String(c && c.inventoryTag || ""),
    scrapPieceId: String(c && c.scrapPieceId || ""),
    score: asNum(c && c.score),
    fitScore: asNum(c && c.fitScore),
    fitCoverageRatio: asNum(c && c.fitCoverageRatio),
    fitInsidePercent: asNum(c && c.fitInsidePercent),
    outsidePercent: asNum(c && c.outsidePercent),
    alignRotationDeg: asNum(c && c.alignRotationDeg),
    alignOffsetX: asNum(c && c.alignOffsetX),
    alignOffsetY: asNum(c && c.alignOffsetY),
    scoreBreakdown: c && c.scoreBreakdown ? c.scoreBreakdown : null
  };
}

function classifyAlternative(top1, alts) {
  const bestAltInside = [...alts].sort((a, b) => asNum(b.fitInsidePercent) - asNum(a.fitInsidePercent))[0] || null;
  const bestAltOutside = [...alts].sort((a, b) => asNum(a.outsidePercent) - asNum(b.outsidePercent))[0] || null;
  const closeByScore = alts.filter((a) => asNum(top1.score) - asNum(a.score) <= 0.03);
  const closeInsideBetter = closeByScore.find((a) => asNum(a.fitInsidePercent) - asNum(top1.fitInsidePercent) >= 5);
  const closeOutsideBetter = closeByScore.find((a) => asNum(top1.outsidePercent) - asNum(a.outsidePercent) >= 5);
  return {
    closeByScoreCount: closeByScore.length,
    betterInsideCloseScore: closeInsideBetter ? topChoiceSummary(closeInsideBetter) : null,
    betterOutsideCloseScore: closeOutsideBetter ? topChoiceSummary(closeOutsideBetter) : null,
    bestInsideAlternative: bestAltInside ? topChoiceSummary(bestAltInside) : null,
    bestOutsideAlternative: bestAltOutside ? topChoiceSummary(bestAltOutside) : null
  };
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
  const inJson = JSON.parse(fs.readFileSync(IN_FILE, "utf8"));
  const req = inJson && inJson.assignRequest;
  if (!req) throw new Error("assignRequest missing in selftest json");

  const baselineReq = {
    ...req,
    progressToken: undefined,
    constraints: {
      ...(req.constraints || {}),
      __qualityTuneRegularV1: false
    }
  };

  const baselineRes = await postJson(`${baseUrl}/api/layout/fill/preview`, baselineReq);
  const placements = Array.isArray(baselineRes && baselineRes.placements) ? baselineRes.placements : [];
  const matched = placements
    .filter((p) => String(p && p.status || "") === "matched")
    .sort((a, b) => {
      const ai = asNum(a && a.fitInsidePercent);
      const bi = asNum(b && b.fitInsidePercent);
      if (Math.abs(ai - bi) > 1e-9) return ai - bi;
      return asNum(a && a.fitCoverageRatio) - asNum(b && b.fitCoverageRatio);
    });

  const worst = matched.slice(0, 5);
  const worstIds = worst.map((p) => asNum(p && p.fragmentId)).filter((v) => Number.isFinite(v));

  const debugReq = {
    ...baselineReq,
    constraints: {
      ...(baselineReq.constraints || {}),
      __debugTopK: 3,
      __debugFragments: worstIds
    }
  };
  const debugRes = await postJson(`${baseUrl}/api/layout/fill/preview`, debugReq);
  const pb = debugRes && debugRes.diagnostics && debugRes.diagnostics.placementBreakdown && typeof debugRes.diagnostics.placementBreakdown === "object"
    ? debugRes.diagnostics.placementBreakdown
    : {};
  const topChoicesByFragment = pb && pb.topChoicesByFragment && typeof pb.topChoicesByFragment === "object"
    ? pb.topChoicesByFragment
    : {};

  const cases = worst.map((p) => {
    const fid = asNum(p && p.fragmentId);
    const rec = topChoicesByFragment[String(fid)] || {};
    const topCandidates = Array.isArray(rec.topCandidates) ? rec.topCandidates : [];
    const top1 = rec.selected || topCandidates[0] || null;
    const alts = topCandidates.slice(0).filter((x) => String(x && x.scrapPieceId || "") !== String(top1 && top1.scrapPieceId || ""));

    return {
      fragmentId: fid,
      fragmentClass: String(p && p.fragmentClass || rec.fragmentClass || ""),
      selectedPlacement: placementSummary(p),
      top1: top1 ? topChoiceSummary(top1) : null,
      top2: topCandidates[1] ? topChoiceSummary(topCandidates[1]) : null,
      top3: topCandidates[2] ? topChoiceSummary(topCandidates[2]) : null,
      decision: String(rec.decision || "unknown"),
      alternativesAnalysis: top1 ? classifyAlternative(top1, alts) : null
    };
  });

  const summary = {
    scope: "regular+intarsia+assignOnly",
    baseUrl,
    matchedCount: matched.length,
    coveragePct: asNum(baselineRes && baselineRes.coveragePercent),
    avgInsidePct: matched.length
      ? Number((matched.reduce((a, p) => a + asNum(p && p.fitInsidePercent), 0) / matched.length).toFixed(2))
      : 0,
    avgOutsidePct: matched.length
      ? Number((matched.reduce((a, p) => a + Math.max(0, 100 - asNum(p && p.fitInsidePercent)), 0) / matched.length).toFixed(2))
      : 0,
    worstFragmentIds: worstIds,
    closeScoreBetterInsideCount: cases.filter((c) => c.alternativesAnalysis && c.alternativesAnalysis.betterInsideCloseScore).length,
    closeScoreBetterOutsideCount: cases.filter((c) => c.alternativesAnalysis && c.alternativesAnalysis.betterOutsideCloseScore).length
  };

  const out = { summary, cases };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`WORST_MATCHED_REPORT ${OUT_FILE}`);
  console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
