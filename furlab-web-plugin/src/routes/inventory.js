"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const INVENTORY_CSCRIPT_TIMEOUT_MS = Math.max(
  15000,
  Number(process.env.FURLAB_INVENTORY_CSCRIPT_TIMEOUT_MS || 180000)
);

async function handleInventoryRoute(req, res, reqUrl, deps) {
  if (!(req.method === "POST" && reqUrl.pathname === "/api/inventory/candidates")) return false;

  const {
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
  } = deps;

  const body = await readBodyJson(req);
  const directInventory = body.directInventory === true;
  const regularCompatibility = body.regularCompatibility === true;
  const zone = body.zone || {};
  const zonePoints = normalizePolygonInput(zone.points);
  if (zonePoints.length < 3) {
    jsonReply(res, 400, { ok: false, error: "zone_points_required" });
    return true;
  }
  const zArea = polygonArea(zonePoints);
  const zBBox = polygonBBox(zonePoints);
  if (!zBBox || zArea <= 0) {
    jsonReply(res, 400, { ok: false, error: "invalid_zone_polygon" });
    return true;
  }

  const limit = Math.max(1, Math.min(2000, Number(body.limit || body.maxCandidates || 200)));
  if (!Number.isFinite(limit)) {
    jsonReply(res, 400, { ok: false, error: "invalid_limit" });
    return true;
  }

  const napPrefilterDisabled = directInventory || regularCompatibility;
  const payload = {
    limit,
    materialId: String(body.materialId || "").trim(),
    onlyAvailable: body.onlyAvailable !== false,
    includeScrapContour: body.includeScrapContour === true,
    requireValidContour: body.requireValidContour === true,
    allowedStatuses: Array.isArray(body.allowedStatuses)
      ? body.allowedStatuses.map((x) => String(x || "").trim()).filter(Boolean)
      : null,
    allowedQualities: Array.isArray(body.allowedQualities)
      ? body.allowedQualities.map((x) => String(x || "").trim()).filter(Boolean)
      : null,
    napDirectionDeg: napPrefilterDisabled ? null : safeNum(body.napDirectionDeg),
    napToleranceDeg: napPrefilterDisabled ? null : safeNum(body.napToleranceDeg),
    prefilterNapToleranceDeg: napPrefilterDisabled ? null : safeNum(body.prefilterNapToleranceDeg),
    // In regular intarsia assign-only we keep pool wide; hard area gate is applied later per-fragment.
    minAreaMm2: directInventory ? null : safeNum(body.minAreaMm2),
    maxAreaMm2: directInventory ? null : safeNum(body.maxAreaMm2),
    minWidthMm: safeNum(body.minWidthMm),
    maxWidthMm: safeNum(body.maxWidthMm),
    minHeightMm: safeNum(body.minHeightMm),
    maxHeightMm: safeNum(body.maxHeightMm),
    minSpanMm: safeNum(body.minSpanMm),
    maxSpanMm: safeNum(body.maxSpanMm),
    thresholdBasis: body && body.thresholdBasis && typeof body.thresholdBasis === "object"
      ? body.thresholdBasis
      : null
  };

  const payloadPath = path.join(TMP_DIR, `inventory_candidates_${Date.now()}_${crypto.randomUUID()}.json`);
  fs.writeFileSync(payloadPath, JSON.stringify(payload), "utf8");
  const scriptPath = path.join(ROOT_DIR, "scripts", "access_read_inventory_candidates.js");
  const _t0_cscript = Date.now();
  const _runCs = runCscriptAsync || runCscript;
  const exec = await _runCs(scriptPath, [DB_PATH, payloadPath], INVENTORY_CSCRIPT_TIMEOUT_MS);
  console.log(`[inventory/candidates] cscript: ${Date.now() - _t0_cscript}ms, status=${exec.run.status}, stdout_len=${(exec.stdout||'').length}`);
  try {
    fs.unlinkSync(payloadPath);
  } catch (_) {}
  if (exec.run.error) {
    jsonReply(res, 500, { ok: false, error: `inventory_candidates_run_failed: ${exec.run.error.message}` });
    return true;
  }
  if (exec.run.status !== 0) {
    jsonReply(res, 400, { ok: false, error: `inventory_candidates_exit_${exec.run.status}`, stderr: exec.stderr });
    return true;
  }
  const result = parseScriptJson(exec.stdout);
  if (!result.ok) {
    jsonReply(res, 400, result);
    return true;
  }
  const dbItems = Array.isArray(result.items) ? result.items : [];
  const sourceFunnel = result && result.funnel && typeof result.funnel === "object" ? result.funnel : null;

  const axis = String(body.axis || "y").toLowerCase() === "x" ? "x" : "y";
  const ctx = {
    axis,
    zoneArea: zArea,
    zoneAspect: Math.max(zBBox.width, zBBox.height) / Math.max(1e-9, Math.min(zBBox.width, zBBox.height)),
    // Scenario A ("direct inventory layout") must not pre-cut candidate pool by geometry/nap.
    napDirectionDeg: (directInventory || regularCompatibility) ? null : normalizeDeg(body.napDirectionDeg),
    napToleranceDeg: (directInventory || regularCompatibility) ? null : (safeNum(body.napToleranceDeg) === null ? 15 : Math.max(0, Math.min(180, Number(body.napToleranceDeg)))),
    minAlongMm: (directInventory || regularCompatibility) ? null : safeNum(body.minAlongMm),
    maxAlongMm: (directInventory || regularCompatibility) ? null : safeNum(body.maxAlongMm),
    minAcrossMm: (directInventory || regularCompatibility) ? null : safeNum(body.minAcrossMm),
    maxAcrossMm: (directInventory || regularCompatibility) ? null : safeNum(body.maxAcrossMm),
    minAreaMm2: (directInventory || regularCompatibility) ? null : safeNum(body.minAreaMm2),
    maxAreaMm2: (directInventory || regularCompatibility) ? null : safeNum(body.maxAreaMm2)
  };

  const scored = [];
  const scoredRejected = {
    scoring: 0,
    examples: []
  };
  for (const c of dbItems) {
    if (directInventory) {
      scored.push({ ...c, fitScore: safeNum(c && c.areaMm2) || 0 });
      continue;
    }
    const score = scoreCandidateForZone(c, ctx);
    if (score === null) {
      scoredRejected.scoring += 1;
      if (scoredRejected.examples.length < 5) {
        scoredRejected.examples.push({
          id: String(c && c.id || ""),
          inventoryTag: String(c && c.inventoryTag || ""),
          reason: "score_candidate_for_zone_null"
        });
      }
      continue;
    }
    scored.push({ ...c, fitScore: score });
  }
  scored.sort((a, b) => b.fitScore - a.fitScore);
  const items = scored.slice(0, limit);
  const poolFunnel = sourceFunnel
    ? {
        ...sourceFunnel,
        afterScoring: scored.length,
        poolCandidates: items.length,
        rejected: {
          ...(sourceFunnel.rejected && typeof sourceFunnel.rejected === "object" ? sourceFunnel.rejected : {}),
          scoring: scoredRejected.scoring
        },
        examples: {
          ...(sourceFunnel.examples && typeof sourceFunnel.examples === "object" ? sourceFunnel.examples : {}),
          scoring: scoredRejected.examples
        }
      }
    : {
        totalSource: dbItems.length,
        afterAreaBBoxSpan: dbItems.length,
        afterScoring: scored.length,
        poolCandidates: items.length,
        rejected: { scoring: scoredRejected.scoring },
        examples: { scoring: scoredRejected.examples }
      };
  jsonReply(res, 200, {
    ok: true,
    zone: {
      areaMm2: zArea,
      bboxWidthMm: zBBox.width,
      bboxHeightMm: zBBox.height
    },
    constraintsUsed: {
      axis,
      napDirectionDeg: ctx.napDirectionDeg,
      napToleranceDeg: ctx.napToleranceDeg,
      minAlongMm: ctx.minAlongMm,
      maxAlongMm: ctx.maxAlongMm,
      minAcrossMm: ctx.minAcrossMm,
      maxAcrossMm: ctx.maxAcrossMm,
      minAreaMm2: ctx.minAreaMm2,
      maxAreaMm2: ctx.maxAreaMm2
    },
    sourceCandidatesTotal: Number(poolFunnel.totalSource || 0),
    dbCandidates: dbItems.length,
    poolCandidates: items.length,
    matchedCandidates: items.length,
    poolFunnel,
    items
  });
  return true;
}

module.exports = {
  handleInventoryRoute
};
