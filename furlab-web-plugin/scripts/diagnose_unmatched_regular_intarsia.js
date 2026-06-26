#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const BASE = process.env.DIAG_BASE_URL || "http://127.0.0.1:5600";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT_DIR = path.join(process.cwd(), "tmp", "selftest");
const OUT_FILE = path.join(OUT_DIR, "unmatched_diagnosis_regular_intarsia.json");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json || json.ok === false) {
    const msg = (json && (json.error || json.message)) || `${res.status}`;
    throw new Error(`POST ${url} failed: ${msg}`);
  }
  return json;
}

function classifyNearMiss(item) {
  if (!item) return "geometry_or_compat";
  const inside = Number(item.fitInsidePercent || 0);
  const cov = Number(item.fitCoverageRatio || 0);
  const outsideProxy = Math.max(0, 100 - inside);
  if (inside < 12) return "inside";
  if (cov < 0.08) return "coverage";
  if (outsideProxy > 88) return "outside";
  return "scoring";
}

async function captureAssignPayloadFromUI() {
  const browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  let assignReqBody = null;
  let assignResBody = null;

  page.on("request", (req) => {
    const url = req.url();
    if (!url.includes("/api/layout/fill/preview")) return;
    if (req.method() !== "POST") return;
    let body = null;
    try { body = JSON.parse(req.postData() || "{}"); } catch (_) { body = null; }
    if (body && body.assignOnly === true && String(body.fillType || "") === "regular") {
      assignReqBody = body;
    }
  });

  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes("/api/layout/fill/preview")) return;
    if (res.request().method() !== "POST") return;
    const req = res.request();
    let body = null;
    try { body = JSON.parse(req.postData() || "{}"); } catch (_) { body = null; }
    if (!(body && body.assignOnly === true && String(body.fillType || "") === "regular")) return;
    try { assignResBody = await res.json(); } catch (_) { assignResBody = null; }
  });

  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const rect = [
        { x: 200, y: 120 },
        { x: 980, y: 120 },
        { x: 980, y: 860 },
        { x: 200, y: 860 }
      ];
      state.zones = [{ id: 9001, name: "SELFTEST_ZONE", detailId: null, points: rect }];
      state.selectedZoneId = 9001;
      state.layoutMode = "intarsia";
      state.layoutRun = {
        active: false,
        status: "idle",
        selectedZoneId: 9001,
        fragments: [],
        placements: [],
        previewLayers: { pieceIntersections: [], visibleArea: [] },
        stats: { violations: 0, intersections: 0, uncovered: 0 }
      };
      openInventoryStep1();
      byId("fillType").value = "regular";
      byId("fillRows").value = "5";
      byId("fillCols").value = "5";
      byId("fillGapX").value = "4";
      byId("fillGapY").value = "4";
      byId("fillCornerRadius").value = "4";
      syncFillTypeUi();
      setIntarsiaStepPhase(1);
      previewIntarsiaFragmentsDraft();
      renderScene();
    });

    await page.click("#inventoryStep1RunBtn");
    await page.waitForTimeout(1000);
    await page.click("#inventoryStep1IntarsiaAssignBtn");
    await page.waitForTimeout(7000);
  } finally {
    await context.close();
    await browser.close();
  }

  if (!assignReqBody || !assignResBody) {
    throw new Error("failed_to_capture_assign_payload_or_response");
  }
  return { assignReqBody, assignResBody };
}

async function main() {
  ensureDir(OUT_DIR);
  const startedAt = new Date().toISOString();

  const { assignReqBody, assignResBody } = await captureAssignPayloadFromUI();
  const placements = Array.isArray(assignResBody.placements) ? assignResBody.placements : [];
  const fragments = Array.isArray(assignReqBody.fragments) ? assignReqBody.fragments : [];
  const candidates = Array.isArray(assignReqBody.candidates) ? assignReqBody.candidates : [];
  const unmatched = placements.filter((p) => String(p && p.status || "") !== "matched");
  const matched = placements.filter((p) => String(p && p.status || "") === "matched");
  const usedTags = new Set(matched.map((p) => String(p && p.inventoryTag || "")).filter(Boolean));
  const frById = new Map(fragments.map((f, i) => [Number(f && f.id) || (i + 1), f]));

  const sampled = unmatched.slice(0, 5);
  const perFragment = [];
  for (const u of sampled) {
    const fid = Number(u && u.fragmentId || 0);
    const frag = frById.get(fid);
    if (!frag || !Array.isArray(frag.points) || frag.points.length < 3) {
      perFragment.push({
        fragmentId: fid,
        reasonClass: "geometry_or_compat",
        note: "fragment_not_found"
      });
      continue;
    }

    const basePayload = {
      fragment: { id: fid, points: frag.points },
      axis: String(assignReqBody.axis || "y"),
      filters: assignReqBody.filters || {},
      candidates,
      limit: 3
    };

    const strictUnused = await postJson(`${BASE}/api/layout/fragment/candidates`, {
      ...basePayload,
      constraints: assignReqBody.constraints || {},
      excludeInventoryTags: Array.from(usedTags)
    });

    let className = null;
    let nearMiss = null;
    let cause = null;

    if (Array.isArray(strictUnused.items) && strictUnused.items.length > 0) {
      nearMiss = strictUnused.items[0];
      className = "scoring";
      cause = "solver_priority_or_competition_with_unused_pool";
    } else {
      const strictAll = await postJson(`${BASE}/api/layout/fragment/candidates`, {
        ...basePayload,
        constraints: assignReqBody.constraints || {},
        excludeInventoryTags: []
      });
      if (Array.isArray(strictAll.items) && strictAll.items.length > 0) {
        nearMiss = strictAll.items[0];
        className = "scoring";
        cause = "best_candidate_already_used_by_other_fragment";
      } else {
        const relaxedUnused = await postJson(`${BASE}/api/layout/fragment/candidates`, {
          ...basePayload,
          constraints: {
            ...(assignReqBody.constraints || {}),
            minFitScore: 0,
            minCoverageRatio: 0.05,
            regularCompatibility: true,
            napDirectionDeg: null,
            napToleranceDeg: 180
          },
          excludeInventoryTags: Array.from(usedTags)
        });
        if (Array.isArray(relaxedUnused.items) && relaxedUnused.items.length > 0) {
          nearMiss = relaxedUnused.items[0];
          className = classifyNearMiss(nearMiss);
          cause = "strict_gate_reject";
        } else {
          className = "geometry_or_compat";
          cause = "no_viable_candidate_after_relaxed_fit";
        }
      }
    }

    perFragment.push({
      fragmentId: fid,
      status: String(u && u.status || ""),
      reason: String(u && u.reason || ""),
      reasonClass: className,
      cause,
      nearMiss: nearMiss
        ? {
            inventoryTag: String(nearMiss.inventoryTag || ""),
            fitScore: Number(nearMiss.fitScore || 0),
            fitCoverageRatio: Number(nearMiss.fitCoverageRatio || 0),
            fitInsidePercent: Number(nearMiss.fitInsidePercent || 0),
            fitOverlap: Number(nearMiss.fitOverlap || 0),
            fitChamferMm: Number(nearMiss.fitChamferMm || 0)
          }
        : null
    });
  }

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: BASE,
    scope: "regular+intarsia+assignOnly",
    totals: {
      dbCandidates: Number(assignResBody && assignResBody.compatibleCandidates || 0),
      poolCandidates: candidates.length,
      matched: matched.length,
      unmatched: unmatched.length,
      coveragePct: Number(assignResBody && assignResBody.coveragePercent || 0)
    },
    diagnostics: assignResBody.diagnostics || null,
    sampledUnmatched: perFragment
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(summary, null, 2), "utf8");
  console.log(`DIAG_REPORT ${OUT_FILE}`);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
});

