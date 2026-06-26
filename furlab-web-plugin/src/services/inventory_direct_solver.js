"use strict";
const ClipperLib = require("clipper-lib");
const { resolveInventoryDirectConfig } = require("./inventory_solver_config");
const { scorePlacementObjective } = require("./inventory_solver_scoring");
const { buildCandidatePool } = require("./inventory_solver_candidates");
const {
  buildScrapUsage: buildScrapUsageImpl,
  strictValidateCoverageByClipper: strictValidateCoverageByClipperImpl,
  computeScenarioADiagnostics: computeScenarioADiagnosticsImpl
} = require("./inventory_solver_diagnostics");
const {
  wrapSignedDeg: wrapSignedDegImpl,
  computeNapDeviation: computeNapDeviationImpl
} = require("./inventory_solver_nap");

function createAssignInventoryDirect(deps) {
  const {
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
  } = deps;

  async function assignInventoryDirect(zonePoints, candidates, axis, filters, constraints, options) {
    function pickLargestResidualTarget(residualMp, fallbackPt) {
      const ring = largestOuterRingPoints(residualMp);
      if (!Array.isArray(ring) || ring.length < 3) return fallbackPt;
      return centroid(ring);
    }
    function dist2(a, b) {
      const dx = Number(a.x || 0) - Number(b.x || 0);
      const dy = Number(a.y || 0) - Number(b.y || 0);
      return dx * dx + dy * dy;
    }
    function deepClone(value) {
      if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
      return JSON.parse(JSON.stringify(value));
    }
    function ringAreaSigned(points) {
      if (!Array.isArray(points) || points.length < 3) return 0;
      let s = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        s += Number(a.x || 0) * Number(b.y || 0) - Number(b.x || 0) * Number(a.y || 0);
      }
      return s * 0.5;
    }
    function pointsToClipperPath(points, scale) {
      const out = [];
      for (const p of points || []) {
        const x = Number(p && p.x);
        const y = Number(p && p.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        out.push({ X: Math.round(x * scale), Y: Math.round(y * scale) });
      }
      if (out.length < 3) return [];
      const dedup = [];
      for (let i = 0; i < out.length; i++) {
        const cur = out[i];
        const prev = dedup[dedup.length - 1];
        if (!prev || prev.X !== cur.X || prev.Y !== cur.Y) dedup.push(cur);
      }
      if (dedup.length < 3) return [];
      return dedup;
    }
    function clipperPathToPoints(path, scale) {
      if (!Array.isArray(path) || path.length < 3) return [];
      return path.map((p) => ({ x: Number(p.X) / scale, y: Number(p.Y) / scale }));
    }

    const pieceSeamReserveMm = Math.max(
      0,
      Number(
        safeNum(options && options.pieceSeamReserveMm) !== null
          ? safeNum(options && options.pieceSeamReserveMm)
          : (safeNum(options && options.seamAllowanceReserveMm) || 0)
      ) || 0
    );
    const seamEpsRatio = Math.max(0.0001, Math.min(0.05, Number(safeNum(options && options.seamEpsRatio) ?? 0.005)));
    const seamEpsMm2Option = Math.max(0, Number(safeNum(options && options.seamEpsMm2) ?? 0));
    const onProgress = options && typeof options.onProgress === "function" ? options.onProgress : null;
    function emitProgress(payload) {
      if (!onProgress || !payload || typeof payload !== "object") return;
      try { onProgress(payload); } catch (_) {}
    }
    const workingZone = Array.isArray(zonePoints) ? zonePoints.slice() : [];
    const zoneArea = polygonArea(workingZone);
    const zoneFragment = { id: 0, points: workingZone, areaMm2: zoneArea };
    const zoneMulti = pointsToMultiPolygon(workingZone);
    let residualMulti = zoneMulti;
    const {
      sourceConstraints,
      directConstraints,
      pool,
      candidateAreaBudgetMm2,
      scrapAreaByKey,
      candidateTemplates
    } = buildCandidatePool({
      candidates,
      filters,
      constraints,
      axis,
      maxPointsPerCandidate: Math.max(24, Math.min(220, Number(options && options.maxPointsPerCandidate || 90))),
      parseScrapContourPoints,
      polygonBBox,
      transformScrapNapDegToWorld,
      safeNum,
      polygonArea,
      isCandidateCompatible,
      translateToAnchor,
      samplePolyline,
      normalizeDeg
    });
    function median(values) {
      const arr = Array.isArray(values)
        ? values
            .map((v) => Number(v))
            .filter((v) => Number.isFinite(v) && v > 0)
            .sort((a, b) => a - b)
        : [];
      if (!arr.length) return 0;
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    }
    const candidateMedianMinSpanMm = median(
      candidateTemplates.map((tpl) => {
        const w = Number(tpl && tpl.c && tpl.c.bboxWidthMm || 0);
        const h = Number(tpl && tpl.c && tpl.c.bboxHeightMm || 0);
        return Math.min(Math.max(0, w), Math.max(0, h));
      })
    );
    const coreCoverageMode = pieceSeamReserveMm > 1e-9;
    const coreMinGainScale = 1;
    const coreSpanScale = 1;
    const coreEffScale = 1;
    const coreHardMinAreaScale = 1;
    const splitReturnEnabled = !!(
      (options && options.splitReturnEnabled === true) ||
      String(options && options.modeId || "").trim() === "inventory_split_return"
    );
    const minLeftoverAreaRaw = safeNum(options && options.minLeftoverAreaMm2);
    const minLeftoverSpanRaw = safeNum(options && options.minLeftoverSpanMm);
    const minLeftoverAreaMm2 = Math.max(0, Number(
      minLeftoverAreaRaw !== null
        ? minLeftoverAreaRaw
        : (splitReturnEnabled ? 800 : 0)
    ));
    const minLeftoverSpanMm = Math.max(0, Number(
      minLeftoverSpanRaw !== null
        ? minLeftoverSpanRaw
        : (splitReturnEnabled ? 40 : 0)
    ));
    const maxDerivedPerPlacement = Math.max(1, Math.min(8, Number(safeNum(options && options.maxDerivedPerPlacement) ?? 3)));
    const splitEvents = [];

    function buildScrapUsage(placementsList, residualAreaValue) {
      return buildScrapUsageImpl({
        placementsList,
        residualAreaValue,
        zoneArea,
        scrapAreaByKey
      });
    }

    function strictValidateCoverageByClipper(placementsList, coverageEpsRatio, rasterStepMm) {
      return strictValidateCoverageByClipperImpl({
        placementsList,
        zoneMulti,
        zoneArea,
        coverageEpsRatio,
        useCoreCoverage: false,
        rasterStepMm,
        pointsToMultiPolygon,
        intersectMulti,
        diffMulti,
        multiPolygonArea
      });
    }
    function computeSeamCheck(placementsList) {
      const seamEpsMm2Default = Math.max(
        zoneArea * seamEpsRatio,
        Math.max(1, Number(rasterMm || 2) * Number(rasterMm || 2))
      );
      const seamEpsMm2 = seamEpsMm2Option > 0 ? seamEpsMm2Option : seamEpsMm2Default;
      if (!pieceSeamReserveMm || pieceSeamReserveMm <= 1e-9) {
        return {
          skipped: true,
          pieceSeamReserveMm: 0,
          seamEpsRatio,
          seamEpsMm2,
          seamResidualAreaMm2: 0,
          seamCoveredRatio: 1,
          seamFullOk: true,
          failedReason: null
        };
      }
      const listWithCore = (Array.isArray(placementsList) ? placementsList : []).map((p) => {
        const hasCore = Array.isArray(p && p.alignedCoreContour) && p.alignedCoreContour.length >= 3;
        if (hasCore) return p;
        const aligned = Array.isArray(p && p.alignedContour) ? p.alignedContour : [];
        const coreGeom = buildCoreGeometry(aligned);
        return {
          ...(p || {}),
          alignedCoreContour: Array.isArray(coreGeom && coreGeom.coreContour) ? coreGeom.coreContour : []
        };
      });
      const strictCore = strictValidateCoverageByClipperImpl({
        placementsList: listWithCore,
        zoneMulti,
        zoneArea,
        coverageEpsRatio: seamEpsRatio,
        useCoreCoverage: true,
        rasterStepMm: rasterMm,
        pointsToMultiPolygon,
        intersectMulti,
        diffMulti,
        multiPolygonArea
      });
      const seamResidualAreaMm2 = Math.max(0, Number(strictCore && strictCore.residualAreaMm2 || 0));
      const seamCoveredRatio = Math.max(0, Math.min(1, Number(strictCore && strictCore.coveredRatio || 0)));
      const seamFullOk = seamResidualAreaMm2 <= seamEpsMm2 + 1e-9;
      return {
        skipped: false,
        pieceSeamReserveMm,
        seamEpsRatio,
        seamEpsMm2,
        seamResidualAreaMm2,
        seamCoveredRatio,
        seamFullOk,
        failedReason: seamFullOk ? null : "seam_core_not_covered"
      };
    }
    function ensurePlacementsCoreContours(placementsList) {
      return (Array.isArray(placementsList) ? placementsList : []).map((p) => {
        const hasCore = Array.isArray(p && p.alignedCoreContour) && p.alignedCoreContour.length >= 3;
        if (hasCore) return p;
        const aligned = Array.isArray(p && p.alignedContour) ? p.alignedContour : [];
        const coreGeom = buildCoreGeometry(aligned);
        return {
          ...(p || {}),
          alignedCoreContour: Array.isArray(coreGeom && coreGeom.coreContour) ? coreGeom.coreContour : []
        };
      });
    }

    function ensurePlacementsGainCoreContours(placementsList) {
      const list = Array.isArray(placementsList) ? placementsList : [];
      if (list.length === 0) return list;
      // Build gainCoreContours for placements that lack it.
      // Sort by solveOrder so residual accumulation is correct.
      const sorted = list.slice().sort((a, b) =>
        Number(a && a.solveOrder || 0) - Number(b && b.solveOrder || 0)
      );
      let coreResidual = zoneMulti;
      const gainMap = new Map();
      for (const p of sorted) {
        if (Array.isArray(p.gainCoreContours)) {
          // Already has it — still update residual by subtracting its inZoneCore.
          const coreMp = Array.isArray(p.inZoneCoreContours) && p.inZoneCoreContours.length > 0
            ? p.inZoneCoreContours : [];
          if (coreMp.length > 0) coreResidual = diffMulti(coreResidual, coreMp);
          continue;
        }
        const coreMp = Array.isArray(p.inZoneCoreContours) && p.inZoneCoreContours.length > 0
          ? p.inZoneCoreContours
          : (Array.isArray(p.inZoneCoreContour) && p.inZoneCoreContour.length >= 3
            ? pointsToMultiPolygon(p.inZoneCoreContour.map(pt => ({ x: Number(pt.x || pt[0] || 0), y: Number(pt.y || pt[1] || 0) })))
            : []);
        if (coreMp.length > 0) {
          const gcc = intersectMulti(coreMp, coreResidual);
          gainMap.set(p, gcc);
          coreResidual = diffMulti(coreResidual, coreMp);
        } else {
          gainMap.set(p, []);
        }
      }
      return list.map((p) => {
        if (Array.isArray(p.gainCoreContours)) return p;
        return { ...p, gainCoreContours: gainMap.get(p) || [] };
      });
    }

    function computeScenarioADiagnostics(placementsList, residualAreaValue, strictInfo) {
      return computeScenarioADiagnosticsImpl({
        placementsList,
        residualAreaValue,
        strictInfo,
        zoneArea,
        zoneMulti,
        candidateAreaBudgetMm2,
        coverageEps,
        rasterMm,
        strictCoverageEffective,
        pointsToMultiPolygon,
        intersectMulti,
        multiPolygonArea
      });
    }
    function runLocalImprovementIfCovered(inputPlacements, label) {
      const src = Array.isArray(inputPlacements) ? inputPlacements : [];
      let working = src
        .filter((p) => p && String(p.status || "") === "matched")
        .slice();
      function sumScrapArea(list) {
        return (Array.isArray(list) ? list : []).reduce((acc, p) => acc + Math.max(0, Number(p && p.scrapAreaMm2 || 0)), 0);
      }
      function usedPieceKeySet(list) {
        const out = new Set();
        for (const p of Array.isArray(list) ? list : []) {
          const id = String(p && p.scrapPieceId || "").trim();
          const tag = String(p && p.inventoryTag || "").trim();
          out.add(`${id}|${tag}`);
        }
        return out;
      }
      function buildResidualFromPlacements(list) {
        let residual = zoneMulti;
        for (const p of Array.isArray(list) ? list : []) {
          const contour = Array.isArray(p && p.alignedContour) ? p.alignedContour : [];
          if (contour.length < 3) continue;
          const mp = pointsToMultiPolygon(contour);
          if (!Array.isArray(mp) || !mp.length) continue;
          const clipped = intersectMulti(mp, zoneMulti);
          if (!Array.isArray(clipped) || !clipped.length) continue;
          residual = diffMulti(residual, clipped);
        }
        return residual;
      }
      function makePlacementFromEval(evalObj, fragmentId) {
        const tpl = evalObj.tpl;
        const inZonePoints = largestOuterRingPoints(evalObj.inZoneMulti);
        const fragPoints = largestOuterRingPoints(evalObj.gainMulti).length >= 3
          ? largestOuterRingPoints(evalObj.gainMulti)
          : inZonePoints;
        return {
          _inZoneMulti: evalObj.inZoneMulti,
          _pieceKey: `${String(tpl.c.id || "").trim()}|${String(tpl.c.inventoryTag || "").trim()}`,
          fragmentId,
          fragmentAreaMm2: Math.max(0, Number(evalObj.gainArea || 0)),
          gainAreaMm2: Math.max(0, Number(evalObj.gainArea || 0)),
          inZoneAreaMm2: Math.max(0, Number(evalObj.inZoneArea || 0)),
          overlapAreaMm2: Math.max(0, Number(evalObj.overlapArea || 0)),
          outsideAreaMm2: Math.max(0, Number(evalObj.outsideArea || 0)),
          scrapAreaMm2: Math.max(0, Number(tpl.area || 0)),
          utilizationLocal: Math.max(0, Math.min(1, Number(evalObj.gainArea || 0) / Math.max(1e-9, Number(tpl.area || 0)))),
          scrapPieceId: String(tpl.c.id || ""),
          inventoryTag: String(tpl.c.inventoryTag || ""),
          scrapContour: String(tpl.c.scrapContour || ""),
          napDirectionDeg: safeNum(tpl.c.napDirectionDeg),
          alignRotationDeg: Math.round(Number(evalObj.angleDeg || 0) * 10) / 10,
          alignOffsetX: 0,
          alignOffsetY: 0,
          alignedContour: evalObj.contour,
          inZoneContour: inZonePoints.length >= 3 ? inZonePoints : [],
          inZoneCoreContour: largestOuterRingPoints(evalObj.inZoneCoreMulti || []),
          inZoneContours: evalObj.inZoneMulti,
          inZoneCoreContours: evalObj.inZoneCoreMulti || [],
          gainCoreContours: evalObj.gainCoreMulti || [],
          fragmentContour: fragPoints.length >= 3 ? fragPoints : [],
          fragmentContours: evalObj.gainMulti,
          status: "matched"
        };
      }
      function findBestPatchPlacement(residualMp, usedSet, nextFragId, maxPiecesForPatch) {
        const residualArea = Math.max(0, multiPolygonArea(residualMp));
        if (residualArea <= 1e-6) return null;
        const residualRatio = zoneArea > 1e-9 ? (residualArea / zoneArea) : 1;
        const inTail = residualRatio <= Math.max(tailCoverageStart, 0.7) || residualRatio <= tailResidualRatio;
        const tailEffMin = residualRatio <= tailResidualLooseRatio ? tailMinEfficiencyLoose : tailMinEfficiency;
        const effGate = inTail ? Math.max(minEfficiencyBase, tailEffMin) : minEfficiencyBase;
        const pocketActive = residualRatio <= pocketModeStartRatio;
        const pocketMaxPieceArea = Math.max(1, residualArea * pocketAreaK);
        const anchorsRaw = residualAnchors(residualMp);
        const anchors = [];
        const seenA = new Set();
        for (const a of anchorsRaw) {
          const k = `${Math.round(a.x)}:${Math.round(a.y)}`;
          if (seenA.has(k)) continue;
          seenA.add(k);
          anchors.push(a);
          if (anchors.length >= 48) break;
        }
        if (!anchors.length) anchors.push(centroid(workingZone));
        const candidates = candidateTemplates
          .filter((t) => {
            if (!templateAvailable(t, usedSet)) return false;
            if (pocketActive && Number(t.area || 0) > pocketMaxPieceArea + 1e-6) return false;
            return true;
          })
          .sort((a, b) => {
            const da = Math.abs(Number(a.area || 0) - residualArea);
            const db = Math.abs(Number(b.area || 0) - residualArea);
            return da - db;
          })
          .slice(0, Math.max(40, Math.min(140, Number(maxPiecesForPatch || 80))));
        if (!candidates.length) return null;
        let best = null;
        for (const tpl of candidates) {
          const candidateNapDeg = tpl.napDirectionDeg;
          const preferredRotDeg = (targetNapDeg !== null && candidateNapDeg !== null)
            ? wrapSignedDeg(targetNapDeg - candidateNapDeg)
            : 0;
          const minRot = preferredRotDeg - napTolDeg;
          const maxRot = preferredRotDeg + napTolDeg;
          const step = napTolDeg <= 12 ? 4 : (napTolDeg <= 30 ? 8 : 12);
          const angleCandidates = [];
          for (let a = minRot; a <= maxRot + 1e-9; a += step) angleCandidates.push(Math.round(a * 10) / 10);
          if (!angleCandidates.length) angleCandidates.push(Math.round(preferredRotDeg * 10) / 10);
          for (const anchor of anchors) {
            for (const aDeg of angleCandidates) {
              if (targetNapDeg !== null && candidateNapDeg !== null) {
                const rotatedNap = normalizeDeg(candidateNapDeg + aDeg);
                const dNap = computeNapDeviation(targetNapDeg, rotatedNap, false);
                if (napPolicy !== "free" && dNap !== null && dNap > napTolDeg + 1e-6) continue;
              }
              const rot = (aDeg * Math.PI) / 180;
              const rotated = rotatePoints(tpl.centered, rot, { x: 0, y: 0 });
              const contour = translateToAnchor(rotated, anchor);
              const contourMulti = pointsToMultiPolygon(contour);
              if (!Array.isArray(contourMulti) || !contourMulti.length) continue;
              const inZoneMulti = intersectMulti(contourMulti, zoneMulti);
              const inZoneArea = Math.max(0, multiPolygonArea(inZoneMulti));
              if (inZoneArea <= 1e-6) continue;
              const gainMulti = intersectMulti(inZoneMulti, residualMp);
              const gainArea = Math.max(0, multiPolygonArea(gainMulti));
              if (gainArea <= 1e-6) continue;
              const costArea = Math.max(1e-9, Number(tpl.area || 0));
              const overlapArea = Math.max(0, inZoneArea - gainArea);
              const outsideArea = Math.max(0, costArea - inZoneArea);
              const overlapRatio = inZoneArea > 0 ? (overlapArea / inZoneArea) : 0;
              if (overlapRatio > 0.995) continue;
              const efficiency = gainArea / costArea;
              if (efficiency + 1e-9 < effGate) continue;
              const score =
                1.25 * (gainArea / Math.max(1e-9, zoneArea)) -
                0.95 * (costArea / Math.max(1e-9, zoneArea)) -
                1.45 * (overlapArea / Math.max(1e-9, zoneArea)) -
                1.20 * (outsideArea / Math.max(1e-9, zoneArea));
              if (!best || score > Number(best.score || -1e18)) {
                const patchCoreGeom = buildCoreGeometry(contour);
                const patchInZoneCoreMulti = patchCoreGeom.coreMulti.length ? intersectMulti(patchCoreGeom.coreMulti, zoneMulti) : [];
                const patchGainCoreMulti = patchInZoneCoreMulti.length ? intersectMulti(patchInZoneCoreMulti, residualMp) : [];
                best = {
                  tpl,
                  contour,
                  inZoneMulti,
                  inZoneCoreMulti: patchInZoneCoreMulti,
                  gainMulti,
                  gainCoreMulti: patchGainCoreMulti,
                  gainArea,
                  inZoneArea,
                  overlapArea,
                  outsideArea,
                  score,
                  angleDeg: aDeg
                };
              }
            }
          }
        }
        if (!best) return null;
        return makePlacementFromEval(best, nextFragId);
      }

      if (!working.length) {
        return { placements: working, strict: strictValidateCoverageByClipper(working, coverageEps, rasterMm), removed: 0, replaced: 0, swapped: 0 };
      }
      let strict = strictValidateCoverageByClipper(working, coverageEps, rasterMm);
      if (!strict.fullCoverageOk) return { placements: working, strict, removed: 0, replaced: 0, swapped: 0 };
      let removed = 0;
      let replaced = 0;
      let swapped = 0;

      // Pass 1: remove-one
      let improved = true;
      while (improved) {
        improved = false;
        const order = working
          .map((p, idx) => ({ idx, area: Math.max(0, Number(p && p.scrapAreaMm2 || 0)) }))
          .sort((a, b) => b.area - a.area);
        for (const item of order) {
          const candidate = working.filter((_, idx) => idx !== item.idx);
          const st = strictValidateCoverageByClipper(candidate, coverageEps, rasterMm);
          if (!st.fullCoverageOk) continue;
          working = candidate;
          strict = st;
          removed += 1;
          improved = true;
          emitProgress({
            phase: "local_improve_remove",
            percent: 93,
            title: "Server / local improvement",
            reason: "remove_one",
            pieces: working.length,
            coverage: strict.coveragePercent,
            residualAreaMm2: strict.residualAreaMm2,
            removed
          });
          break;
        }
      }

      // Pass 2: replace-one
      const replaceBudget = Math.min(10, Math.max(3, Math.floor(working.length * 0.2)));
      for (let attempt = 0; attempt < replaceBudget; attempt++) {
        const ranked = working
          .map((p, idx) => {
            const scrap = Math.max(0, Number(p && p.scrapAreaMm2 || 0));
            const gain = Math.max(0, Number(p && p.gainAreaMm2 || p && p.fragmentAreaMm2 || 0));
            const waste = Math.max(0, scrap - gain);
            return { idx, waste, scrap };
          })
          .sort((a, b) => b.waste - a.waste);
        let done = false;
        for (const r of ranked.slice(0, 8)) {
          const base = working.filter((_, idx) => idx !== r.idx);
          const residual = buildResidualFromPlacements(base);
          const used = usedPieceKeySet(base);
          const nextFragId = base.reduce((m, p) => Math.max(m, Number(p && p.fragmentId || 0)), 0) + 1;
          const patch = findBestPatchPlacement(residual, used, nextFragId, 90);
          if (!patch) continue;
          const candidate = base.concat([patch]);
          const st = strictValidateCoverageByClipper(candidate, coverageEps, rasterMm);
          if (!st.fullCoverageOk) continue;
          if (sumScrapArea(candidate) + 1e-6 >= sumScrapArea(working)) continue;
          working = candidate;
          strict = st;
          replaced += 1;
          done = true;
          emitProgress({
            phase: "local_improve_replace",
            percent: 93,
            title: "Server / local improvement",
            reason: "replace_one",
            pieces: working.length,
            coverage: strict.coveragePercent,
            residualAreaMm2: strict.residualAreaMm2,
            replaced
          });
          break;
        }
        if (!done) break;
      }

      // Pass 3: swap-two (remove one, add up to two better)
      const swapBudget = Math.min(8, Math.max(2, Math.floor(working.length * 0.15)));
      for (let attempt = 0; attempt < swapBudget; attempt++) {
        const ranked = working
          .map((p, idx) => {
            const scrap = Math.max(0, Number(p && p.scrapAreaMm2 || 0));
            const gain = Math.max(0, Number(p && p.gainAreaMm2 || p && p.fragmentAreaMm2 || 0));
            const waste = Math.max(0, scrap - gain);
            return { idx, waste, scrap };
          })
          .sort((a, b) => b.waste - a.waste);
        let done = false;
        for (const r of ranked.slice(0, 6)) {
          const base = working.filter((_, idx) => idx !== r.idx);
          const used = usedPieceKeySet(base);
          let residual = buildResidualFromPlacements(base);
          const nextFragBase = base.reduce((m, p) => Math.max(m, Number(p && p.fragmentId || 0)), 0) + 1;
          const p1 = findBestPatchPlacement(residual, used, nextFragBase, 100);
          if (!p1) continue;
          used.add(String(p1._pieceKey || ""));
          residual = diffMulti(residual, p1._inZoneMulti);
          let candidate = base.concat([p1]);
          let st = strictValidateCoverageByClipper(candidate, coverageEps, rasterMm);
          if (!st.fullCoverageOk) {
            const p2 = findBestPatchPlacement(residual, used, nextFragBase + 1, 100);
            if (!p2) continue;
            candidate = candidate.concat([p2]);
            st = strictValidateCoverageByClipper(candidate, coverageEps, rasterMm);
          }
          if (!st.fullCoverageOk) continue;
          if (sumScrapArea(candidate) + 1e-6 >= sumScrapArea(working)) continue;
          working = candidate;
          strict = st;
          swapped += 1;
          done = true;
          emitProgress({
            phase: "local_improve_swap",
            percent: 93,
            title: "Server / local improvement",
            reason: "swap_two",
            pieces: working.length,
            coverage: strict.coveragePercent,
            residualAreaMm2: strict.residualAreaMm2,
            swapped
          });
          break;
        }
        if (!done) break;
      }

      const cleaned = working.map((p) => {
        const out = { ...p };
        delete out._inZoneMulti;
        delete out._pieceKey;
        return out;
      });
      emitProgress({
        phase: "local_improve_done",
        percent: 93,
        title: "Server / local improvement done",
        reason: String(label || "remove_one_replace_swap"),
        pieces: cleaned.length,
        coverage: strict.coveragePercent,
        residualAreaMm2: strict.residualAreaMm2,
        removed,
        replaced,
        swapped
      });
      return { placements: cleaned, strict, removed, replaced, swapped };
    }

    const {
      maxPieces,
      minPieces,
      minFragmentAreaMm2Hard,
      minFragmentWidthMmHard,
      minFragmentLengthMmHard,
      coverageFirst,
      enforceTimeBudget,
      maxPieceOverlap,
      overlapPenalty,
      outsidePenalty,
      costWeight,
      minGainAreaMm2,
      coverageTarget,
      strictCoverage,
      strictCoverageHard,
      coverageEps,
      theoreticalMaxCoverageRatio,
      coverageTargetReachable,
      strictCoverageEffective,
      overlapAversionMode,
      objectiveMode,
      objectiveMinEfficiency,
      minEfficiencyBase,
      phaseAEndCoverage,
      phaseAInsideMin,
      phaseAMaxOverlap,
      phaseBEfficiencyMin,
      phaseAMinPieces,
      phaseAMinGainMm2,
      phaseAMinGainShare,
      minGainVisibleMm2,
      minSpanMm,
      objectivePiecePenalty,
      objectiveFragmentPenalty,
      napTolDeg,
      targetNapDeg,
      napPolicy,
      allowFlip180,
      hardNapLock,
      napWeight,
      minInsideRatio,
      maxSolveMs,
      hardMaxSolveMs,
      maxPointsPerCandidate,
      solverMode,
      rasterMm,
      tailCoverageStart,
      tailResidualRatio,
      tailResidualMm2,
      tailResidualLooseRatio,
      tailMinEfficiency,
      tailMinEfficiencyLoose,
      pocketModeStartRatio,
      pocketAreaK,
      tailOversizeAlpha,
      tailStallTrigger,
      tailPenaltyBoost,
      tailMaxPlacements,
      tailCapResidualRatio,
      tailMinGainShare,
      tailMinGainCapMm2,
      layerPolicy,
      pocketCoverageThresholdA,
      pocketCoverageBonusA,
      gridAnchorEnable,
      gridAnchorStepFactor,
      gridAnchorMax,
      cleanLayoutMode,
      cleanOverlapRatioMaxAB,
      cleanOverlapRatioMaxC,
      gridAcceptCoverageRatio,
      cleanPiecePenalty,
      maxRepairAttempts,
      repairWindow
    } = resolveInventoryDirectConfig({
      options,
      sourceConstraints,
      zoneArea,
      candidateAreaBudgetMm2,
      normalizeDeg,
      NAP_EPS_DEG
    });
    function quantile(values, q) {
      const arr = Array.isArray(values) ? values.filter((v) => Number.isFinite(Number(v))).map(Number) : [];
      if (!arr.length) return 0;
      arr.sort((a, b) => a - b);
      const qq = Math.max(0, Math.min(1, Number(q || 0)));
      const pos = (arr.length - 1) * qq;
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      if (lo === hi) return arr[lo];
      const t = pos - lo;
      return arr[lo] * (1 - t) + arr[hi] * t;
    }
    function splitTemplatesByArea(templates) {
      const src = Array.isArray(templates) ? templates.filter(Boolean) : [];
      if (!src.length) return { large: [], medium: [], small: [] };
      const tplAreas = src.map((t) => Math.max(0, Number(t && t.area || 0)));
      const q33 = quantile(tplAreas, 0.33);
      const q66 = quantile(tplAreas, 0.66);
      const large = src.filter((t) => Number(t && t.area || 0) >= q66 - 1e-9);
      const medium = src.filter((t) => {
        const a = Number(t && t.area || 0);
        return a >= q33 - 1e-9 && a <= q66 + 1e-9;
      });
      const small = src.filter((t) => Number(t && t.area || 0) <= q33 + 1e-9);
      return { large, medium, small };
    }
    const initialPools = splitTemplatesByArea(candidateTemplates);
    const largeTemplatesPool = initialPools.large;
    function getTemplatesForPhase(phaseMode, coveredRatioNow, remainingAreaEst) {
      // Recompute pools from current template list so split-derived candidates
      // immediately participate in A/B/C phase ranking.
      const dynamicPools = splitTemplatesByArea(candidateTemplates);
      const dynamicLarge = dynamicPools.large;
      const dynamicMedium = dynamicPools.medium;
      const dynamicSmall = dynamicPools.small;
      const derivedPool = splitReturnEnabled
        ? candidateTemplates.filter((t) => !!(t && t.derived))
        : [];
      if (phaseMode === "A") {
        // Pass A: explicitly prefer large pool first, medium as backup.
        return derivedPool.concat(dynamicLarge).concat(dynamicMedium);
      }
      if (phaseMode === "B") {
        // Pass B: medium-first, then large.
        return derivedPool.concat(dynamicMedium).concat(dynamicLarge).concat(dynamicSmall);
      }
      // Pass C: tail pockets -> small/medium, large only if necessary.
      if (coveredRatioNow >= 0.98 || remainingAreaEst <= Math.max(1200, zoneArea * 0.008)) {
        return derivedPool.concat(dynamicSmall).concat(dynamicMedium);
      }
      return derivedPool.concat(dynamicSmall).concat(dynamicMedium).concat(dynamicLarge);
    }
    function buildGlobalGridAnchors() {
      if (!gridAnchorEnable) return [];
      const bb = polygonBBox(workingZone);
      if (!bb || bb.width <= 0 || bb.height <= 0) return [];
      const extentSrc = (largeTemplatesPool.length ? largeTemplatesPool : candidateTemplates)
        .map((t) => {
          const w = Number(t && t.c && t.c.bboxWidthMm || 0);
          const h = Number(t && t.c && t.c.bboxHeightMm || 0);
          return Math.max(0, Math.max(w, h));
        })
        .filter((x) => x > 1e-6);
      const medianExtent = extentSrc.length ? quantile(extentSrc, 0.5) : Math.sqrt(Math.max(1, zoneArea)) * 0.12;
      const stepRaw = medianExtent * Math.max(0.5, Number(gridAnchorStepFactor || 1));
      const step = Math.max(35, Math.min(320, stepRaw));
      const nx = Math.max(1, Math.ceil(bb.width / step));
      const ny = Math.max(1, Math.ceil(bb.height / step));
      const anchors = [];
      for (let iy = 0; iy < ny; iy++) {
        const y = bb.minY + ((iy + 0.5) / ny) * bb.height;
        for (let ix = 0; ix < nx; ix++) {
          const x = bb.minX + ((ix + 0.5) / nx) * bb.width;
          const p = { x, y };
          if (pointInRing(p, workingZone)) anchors.push(p);
        }
      }
      if (anchors.length <= gridAnchorMax) return anchors;
      const picked = [];
      const stride = anchors.length / Math.max(1, Number(gridAnchorMax || 1));
      for (let i = 0; i < Number(gridAnchorMax || 0); i++) {
        picked.push(anchors[Math.min(anchors.length - 1, Math.floor(i * stride))]);
      }
      return picked;
    }
    const globalGridAnchors = buildGlobalGridAnchors();
    const enableLegacyFallback = !!(options && options.enableLegacyFallback === true);
    const runGridPrepass = solverMode === "gridcoverv1";
    let gridFallbackOut = null;
    function summarizeSolution(sol) {
      const placementsList = Array.isArray(sol && sol.placements) ? sol.placements : [];
      const pieces = placementsList.filter((p) => String(p && p.status || "") === "matched").length;
      const coveredRatio = Math.max(0, Math.min(1, Number(sol && sol.coveredRatio || 0)));
      const fullCoverageOk = !!(sol && sol.fullCoverageOk === true);
      const coverageSatisfied = strictCoverageEffective
        ? fullCoverageOk
        : coveredRatio + coverageEps >= coverageTarget;
      const usedAreaMm2 = Math.max(0, Number(sol && sol.scrapUsage && sol.scrapUsage.usedScrapAreaMm2 || 0));
      const overlapAreaMm2 = Math.max(0, Number(sol && sol.overlapAreaMm2 || 0));
      const outsideAreaMm2 = Math.max(0, Number(sol && sol.diagnostics && sol.diagnostics.outsideAreaMm2 || 0));
      const residualAreaMm2 = Math.max(0, Number(sol && sol.residualAreaMm2 || (zoneArea * (1 - coveredRatio))));
      const timeBudgetExceeded = !!(sol && sol.timeBudgetExceeded);
      return {
        coverageSatisfied,
        coveredRatio,
        pieces,
        usedAreaMm2,
        overlapAreaMm2,
        outsideAreaMm2,
        residualAreaMm2,
        timeBudgetExceeded
      };
    }
    function isBetterSolution(candidate, current) {
      if (!candidate) return false;
      if (!current) return true;
      const a = summarizeSolution(candidate);
      const b = summarizeSolution(current);
      if (cleanLayoutMode) {
        const aGood = a.coveredRatio >= gridAcceptCoverageRatio - 1e-9;
        const bGood = b.coveredRatio >= gridAcceptCoverageRatio - 1e-9;
        if (aGood !== bGood) return aGood;
        if (aGood && bGood) {
          if (a.pieces !== b.pieces) return a.pieces < b.pieces;
          if (Math.abs(a.overlapAreaMm2 - b.overlapAreaMm2) > 1e-6) return a.overlapAreaMm2 < b.overlapAreaMm2;
          if (Math.abs(a.outsideAreaMm2 - b.outsideAreaMm2) > 1e-6) return a.outsideAreaMm2 < b.outsideAreaMm2;
          if (Math.abs(a.coveredRatio - b.coveredRatio) > 1e-6) return a.coveredRatio > b.coveredRatio;
          if (Math.abs(a.usedAreaMm2 - b.usedAreaMm2) > 1e-6) return a.usedAreaMm2 < b.usedAreaMm2;
          if (Math.abs(a.residualAreaMm2 - b.residualAreaMm2) > 1e-6) return a.residualAreaMm2 < b.residualAreaMm2;
          if (a.timeBudgetExceeded !== b.timeBudgetExceeded) return !a.timeBudgetExceeded;
          return false;
        }
      }
      if (a.coverageSatisfied !== b.coverageSatisfied) return a.coverageSatisfied;
      if (Math.abs(a.coveredRatio - b.coveredRatio) > 1e-6) return a.coveredRatio > b.coveredRatio;
      if (a.pieces !== b.pieces) return a.pieces < b.pieces;
      if (Math.abs(a.usedAreaMm2 - b.usedAreaMm2) > 1e-6) return a.usedAreaMm2 < b.usedAreaMm2;
      if (Math.abs(a.overlapAreaMm2 - b.overlapAreaMm2) > 1e-6) return a.overlapAreaMm2 < b.overlapAreaMm2;
      if (Math.abs(a.outsideAreaMm2 - b.outsideAreaMm2) > 1e-6) return a.outsideAreaMm2 < b.outsideAreaMm2;
      if (Math.abs(a.residualAreaMm2 - b.residualAreaMm2) > 1e-6) return a.residualAreaMm2 < b.residualAreaMm2;
      if (a.timeBudgetExceeded !== b.timeBudgetExceeded) return !a.timeBudgetExceeded;
      return false;
    }

    if (runGridPrepass) {
      const poolForGrid = pieceSeamReserveMm > 1e-9
        ? pool.reduce((acc, c) => {
            const contour = Array.isArray(c.__scrapContourPoints) ? c.__scrapContourPoints : [];
            if (contour.length < 3) { acc.push(c); return acc; }
            const coreGeom = buildCoreGeometry(contour);
            if (coreGeom.coreContour.length < 3) return acc; // ядро схлопнулось — кусок не кандидат
            acc.push({ ...c, __coreContourPoints: coreGeom.coreContour });
            return acc;
          }, [])
        : pool;
      const gridRes = await solveCoverGrid({
        zonePoints: workingZone,
        candidates: poolForGrid,
        constraints: sourceConstraints,
        options: {
          ...(options || {}),
          rasterMm,
          coverageTarget,
          coverageEps
        }
      });
      if (gridRes && gridRes.ok) {
        const gridPlacementsForStrict = Array.isArray(gridRes.placements) ? gridRes.placements : [];
        const strict = strictValidateCoverageByClipper(gridPlacementsForStrict, coverageEps, rasterMm);
        const strictResult = {
          strictCoverage: !!strictCoverageEffective,
          coverageTarget,
          coverageEps,
          coveredRatio: strict.coveredRatio,
          fullCoverageOk: strict.fullCoverageOk,
          failedReason: strictCoverageEffective && !strict.fullCoverageOk ? "zone_not_fully_covered" : null,
          residualAreaMm2: strict.residualAreaMm2,
          epsMm2: strict.epsMm2,
          coverageTargetReachable,
          theoreticalMaxCoverageRatio
        };
        const out = {
          ...gridRes,
          placements: ensurePlacementsCoreContours(gridPlacementsForStrict),
          coveragePercent: strict.coveragePercent,
          coveredRatio: strict.coveredRatio,
          residualAreaMm2: strict.residualAreaMm2,
          strictCoverage: !!strictCoverageEffective,
          fullCoverageOk: strict.fullCoverageOk,
          failedReason: strictCoverageEffective && !strict.fullCoverageOk ? "zone_not_fully_covered" : null,
          candidateAreaBudgetMm2: Math.round(candidateAreaBudgetMm2 * 1000) / 1000,
          coverageTargetReachable,
          theoreticalMaxCoverageRatio,
          timeBudgetExceeded: !!gridRes.timeBudgetExceeded && !strict.fullCoverageOk
        };
        const seamCheck = computeSeamCheck(out.placements);
        out.seamCheck = seamCheck;
        if (!out.algorithmTrace || typeof out.algorithmTrace !== "object") out.algorithmTrace = {};
        if (!out.algorithmTrace.steps || typeof out.algorithmTrace.steps !== "object") out.algorithmTrace.steps = {};
        out.algorithmTrace.version = String(out.algorithmTrace.version || "gridCoverV1");
        out.algorithmTrace.steps.strict_final_check = strictResult;
        out.algorithmTrace.steps.seam_check = seamCheck;
        out.scrapUsage = buildScrapUsage(out.placements, out.residualAreaMm2);
        out.diagnostics = computeScenarioADiagnostics(out.placements, out.residualAreaMm2, strict);
        if (cleanLayoutMode && strict.coveredRatio >= gridAcceptCoverageRatio) {
          if (!out.algorithmTrace.steps || typeof out.algorithmTrace.steps !== "object") out.algorithmTrace.steps = {};
          out.algorithmTrace.steps.fallback_note = {
            mode: "legacyboolean",
            attempted: false,
            reason: "grid_accepted_clean_layout",
            coveredRatio: Number(strict.coveredRatio || 0),
            threshold: Number(gridAcceptCoverageRatio || 0)
          };
          gridFallbackOut = out;
        } else if (strict.fullCoverageOk) {
          const improved = runLocalImprovementIfCovered(out.placements, "grid_remove_one");
          if (improved.removed > 0 || improved.replaced > 0 || improved.swapped > 0) {
            const keepFrag = new Set(improved.placements.map((p) => Number(p && p.fragmentId || 0)));
            out.placements = improved.placements;
            out.fragments = Array.isArray(out.fragments)
              ? out.fragments.filter((f) => keepFrag.has(Number(f && f.id || 0)))
              : [];
            out.coveragePercent = Number(improved.strict.coveragePercent || out.coveragePercent || 0);
            out.coveredRatio = Number(improved.strict.coveredRatio || out.coveredRatio || 0);
            out.residualAreaMm2 = Number(improved.strict.residualAreaMm2 || out.residualAreaMm2 || 0);
            out.fullCoverageOk = !!improved.strict.fullCoverageOk;
            out.scrapUsage = buildScrapUsage(out.placements, out.residualAreaMm2);
            out.diagnostics = computeScenarioADiagnostics(out.placements, out.residualAreaMm2, improved.strict);
            if (!out.algorithmTrace.steps.local_improvement) out.algorithmTrace.steps.local_improvement = {};
            out.algorithmTrace.steps.local_improvement = {
              mode: "remove_one",
              removed: Number(improved.removed || 0),
              replaced: Number(improved.replaced || 0),
              swapped: Number(improved.swapped || 0)
            };
          }
          gridFallbackOut = out;
        } else if (!enableLegacyFallback) {
          if (!out.algorithmTrace.steps || typeof out.algorithmTrace.steps !== "object") out.algorithmTrace.steps = {};
          out.algorithmTrace.steps.fallback_note = {
            mode: "legacyboolean",
            attempted: false,
            reason: "legacy_fallback_disabled_compare_only"
          };
          gridFallbackOut = out;
        } else {
          emitProgress({
            phase: "legacy_fallback_start",
            percent: 88,
            title: "Server / legacy fallback",
            pieces: Array.isArray(out.placements) ? out.placements.length : 0,
            coverage: Number(out.coveragePercent || 0),
            residualAreaMm2: Number(out.residualAreaMm2 || 0)
          });
          gridFallbackOut = out;
        }
        if (strict.fullCoverageOk && !enableLegacyFallback) {
          if (!out.algorithmTrace.steps || typeof out.algorithmTrace.steps !== "object") out.algorithmTrace.steps = {};
          out.algorithmTrace.steps.fallback_note = {
            mode: "strategy_compare",
            chosen: "gridcoverv1",
            reason: "strict_full_coverage_reached"
          };
          return out;
        }
      }
    }

    const solveStartedAt = Date.now();
    function isHardTimeout() {
      return (Date.now() - solveStartedAt) > hardMaxSolveMs;
    }
    let placements = [];
    let fragments = [];
    let placementRecords = [];
    const usedCandidateKeys = new Set();
    let derivedTemplateSeq = 1;
    let rejectedByOverlap = 0;
    let rejectedByCoverage = 0;
    let rejectedByOutside = 0;
    let rejectedByOversize = 0;
    let rejectedNoFit = 0;
    let totalOverlapAreaMm2 = 0;
    let nextId = 1;
    let nextPlacementId = 1;
    let lastLegacyProgressEmitAt = 0;
    // Adaptive relaxation for local-improve passes when residual area is hard to fill.
    let dynamicOverlapBoost = 0;
    let dynamicInsideDrop = 0;
    let dynamicGainFactor = 1;
    let dynamicNapTolDeg = napTolDeg;
    let dynamicAllowFlip180 = false;
    let emergencyRelaxUsed = 0;
    let timeBudgetExceeded = false;
    let tailAcceptedPiecesTotal = 0;
    let tailLastChanceUsed = false;
    let tailPieceCapHit = false;
    let phaseAAcceptedPieces = 0;
    let phaseAForceDisabled = false;
    let derivedCreatedTotal = 0;
    let derivedEligibleTotal = 0;
    let derivedEvaluatedTotal = 0;
    let derivedUsedTotal = 0;
    let derivedUsedAreaMm2 = 0;
    let stopReason = "";
    let stopProof = {};
    let tailDerivedPassUsed = false;
    let tailDerivedEvaluated = 0;
    let tailDerivedAccepted = 0;
    let tailDerivedCoverageGainMm2 = 0;
    function templateAvailable(template, usedSet) {
      const t = template && typeof template === "object" ? template : null;
      if (!t || !t.key) return false;
      const setRef = usedSet instanceof Set ? usedSet : usedCandidateKeys;
      const pieceKey = `${String(t && t.c && t.c.id || "").trim()}|${String(t && t.c && t.c.inventoryTag || "").trim()}`;
      if (setRef.has(t.key) || (pieceKey !== "|" && setRef.has(pieceKey))) return false;
      const parentKey = String(t.requiresParentKey || "").trim();
      if (!parentKey) return true;
      return setRef.has(parentKey);
    }
    function preferCandidatePlacement(candidatePlacement, bestPlacement, candidateScore, candidateCostArea) {
      if (!bestPlacement) return true;
      const bestScore = Number(bestPlacement.gainScore || -1e18);
      const scoreDelta = Number(candidateScore || -1e18) - bestScore;
      const candidateDominant = !!(candidatePlacement && candidatePlacement.dominantPocketA);
      const bestDominant = !!(bestPlacement && bestPlacement.dominantPocketA);
      if (candidateDominant && !bestDominant) return true;
      if (candidateDominant !== bestDominant) return false;
      if (scoreDelta > 1e-9) return true;
      if (Math.abs(scoreDelta) <= 1e-9) {
        const bestCostArea = Number(bestPlacement && bestPlacement.tpl && bestPlacement.tpl.area || 0);
        const candDerived = !!(candidatePlacement && candidatePlacement.tpl && candidatePlacement.tpl.derived);
        const bestDerived = !!(bestPlacement && bestPlacement.tpl && bestPlacement.tpl.derived);
        if (splitReturnEnabled && candDerived !== bestDerived) return candDerived;
        return Number(candidateCostArea || 0) < bestCostArea;
      }
      if (splitReturnEnabled) {
        const candDerived = !!(candidatePlacement && candidatePlacement.tpl && candidatePlacement.tpl.derived);
        const bestDerived = !!(bestPlacement && bestPlacement.tpl && bestPlacement.tpl.derived);
        // In split mode slightly prefer derived leftovers when score is near-equal.
        if (candDerived && !bestDerived && scoreDelta >= -0.015) return true;
      }
      return false;
    }
    const algorithmTrace = {
      version: "inventory-direct-v1",
      steps: {
        candidate_pool: { input: Array.isArray(candidates) ? candidates.length : 0, compatible: 0, templates: 0 },
        placement_search: { iterations: 0, evaluated: 0, placed: 0, rejected: { overlap: 0, outside: 0, lowGain: 0, oversize: 0, noFit: 0 } },
        repair_repack: { enabled: false, attempts: 0, placementsReused: 0 },
        strict_final_check: { strictCoverage: false, coverageTarget: 0, coverageEps: 0, coveredRatio: 0, fullCoverageOk: false, failedReason: null }
      }
    };
    function calcPlanMetrics() {
      const coveredRatio = currentCoveredRatio();
      let selectedArea = 0;
      let usefulArea = 0;
      let overlapArea = 0;
      const keys = [];
      for (const p of placements) {
        selectedArea += Math.max(0, Number(p && p.scrapAreaMm2 || 0));
        usefulArea += Math.max(0, Number(p && (p.gainAreaMm2 || p.fragmentAreaMm2) || 0));
        overlapArea += Math.max(0, Number(p && p.overlapAreaMm2 || 0));
        keys.push(String((p && p.candidateKey) || (p && p.scrapPieceId) || (p && p.inventoryTag) || ""));
      }
      const utilization = selectedArea > 1e-9 ? (usefulArea / selectedArea) : 0;
      return {
        coveredRatio,
        pieces: placements.length,
        utilization,
        overlapArea,
        selectedArea,
        keySeq: keys.join("|")
      };
    }
    function isMetricsBetter(a, b) {
      if (!b) return true;
      if (a.coveredRatio > b.coveredRatio + 1e-9) return true;
      if (a.coveredRatio + 1e-9 < b.coveredRatio) return false;
      if (a.pieces < b.pieces) return true;
      if (a.pieces > b.pieces) return false;
      if (a.utilization > b.utilization + 1e-9) return true;
      if (a.utilization + 1e-9 < b.utilization) return false;
      if (a.overlapArea + 1e-9 < b.overlapArea) return true;
      if (a.overlapArea > b.overlapArea + 1e-9) return false;
      if (a.selectedArea + 1e-9 < b.selectedArea) return true;
      if (a.selectedArea > b.selectedArea + 1e-9) return false;
      return String(a.keySeq || "") < String(b.keySeq || "");
    }
    let bestState = null;
    function captureBestState(reason) {
      const metrics = calcPlanMetrics();
      if (!isMetricsBetter(metrics, bestState && bestState.metrics)) return;
      bestState = {
        reason: String(reason || ""),
        metrics,
        placements: deepClone(placements),
        fragments: deepClone(fragments),
        placementRecords: deepClone(placementRecords),
        residualMulti: deepClone(residualMulti),
        nextId: Number(nextId || 1)
      };
    }
    function restoreBestStateIfBetter() {
      if (!bestState || !bestState.metrics) return false;
      const currentMetrics = calcPlanMetrics();
      if (!isMetricsBetter(bestState.metrics, currentMetrics)) return false;
      placements = deepClone(bestState.placements || []);
      fragments = deepClone(bestState.fragments || []);
      placementRecords = deepClone(bestState.placementRecords || []);
      residualMulti = deepClone(bestState.residualMulti || zoneMulti);
      nextId = Math.max(1, Number(bestState.nextId || 1));
      return true;
    }
    function appendDerivedFromAccepted(bestPlacement) {
      if (!splitReturnEnabled) return 0;
      const bp = bestPlacement && typeof bestPlacement === "object" ? bestPlacement : null;
      if (!bp || !Array.isArray(bp.contour) || bp.contour.length < 3) return 0;
      const angleDeg = Number(bp && bp.angleDeg || 0);
      const rot = (angleDeg * Math.PI) / 180;
      const invRot = -rot;
      const rotatedCentered = rotatePoints(bp.tpl.centered || [], rot, { x: 0, y: 0 });
      const cRot = centroid(Array.isArray(rotatedCentered) && rotatedCentered.length >= 3 ? rotatedCentered : (bp.tpl.centered || []));
      const cWorld = centroid(bp.contour);
      const tx = Number(cWorld && cWorld.x || 0) - Number(cRot && cRot.x || 0);
      const ty = Number(cWorld && cWorld.y || 0) - Number(cRot && cRot.y || 0);
      function worldToLocal(points) {
        const out = [];
        for (const p of Array.isArray(points) ? points : []) {
          const xw = Number(p && p.x);
          const yw = Number(p && p.y);
          if (!Number.isFinite(xw) || !Number.isFinite(yw)) continue;
          const x = xw - tx;
          const y = yw - ty;
          const xr = x * Math.cos(invRot) - y * Math.sin(invRot);
          const yr = x * Math.sin(invRot) + y * Math.cos(invRot);
          out.push({ x: xr, y: yr });
        }
        return out;
      }
      const fullMulti = pointsToMultiPolygon(bp.contour);
      if (!Array.isArray(fullMulti) || !fullMulti.length) return 0;
      const usedMulti = Array.isArray(bp.gainMulti) ? bp.gainMulti : [];
      const leftoverMulti = Array.isArray(usedMulti) && usedMulti.length
        ? diffMulti(fullMulti, usedMulti)
        : fullMulti;
      const leftoverContours = ringsFromMultiOuter(leftoverMulti);
      const contourCentroid = (pts) => {
        const ring = Array.isArray(pts) ? pts : [];
        if (ring.length < 3) return { x: 0, y: 0 };
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (const p of ring) {
          const x = Number(p && p.x);
          const y = Number(p && p.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          sx += x;
          sy += y;
          n += 1;
        }
        if (n <= 0) return { x: 0, y: 0 };
        return { x: sx / n, y: sy / n };
      };
      leftoverContours.sort((a, b) => {
        const aa = Math.max(0, polygonArea(a));
        const bb = Math.max(0, polygonArea(b));
        if (Math.abs(bb - aa) > 1e-6) return bb - aa;
        const ca = contourCentroid(a);
        const cb = contourCentroid(b);
        if (Math.abs(ca.x - cb.x) > 1e-6) return ca.x - cb.x;
        if (Math.abs(ca.y - cb.y) > 1e-6) return ca.y - cb.y;
        return 0;
      });
      const usedContoursWorld = ringsFromMultiOuter(usedMulti);
      const usedContoursLocal = usedContoursWorld.map((r) => worldToLocal(r)).filter((r) => r.length >= 3);
      if (!leftoverContours.length) return 0;
      const parentTpl = bp && bp.tpl ? bp.tpl : {};
      const parentKey = String(parentTpl.key || "").trim();
      const parentPieceKeyRaw = `${String(bp && bp.tpl && bp.tpl && bp.tpl.c && bp.tpl.c.id || "").trim()}|${String(bp && bp.tpl && bp.tpl && bp.tpl.c && bp.tpl.c.inventoryTag || "").trim()}`;
      const parentPieceKey = parentPieceKeyRaw.trim() || parentKey;
      const baseParentKey = String(parentTpl.rootParentKey || parentKey || parentPieceKey).trim() || parentPieceKey;
      const generation = Math.max(1, Number(parentTpl.generation || 0) + 1);
      const usedAreaMm2 = areaRound(Number(bp.gainVisibleArea || bp.gainArea || 0));
      let added = 0;
      for (let i = 0; i < leftoverContours.length; i++) {
        if (added >= maxDerivedPerPlacement) break;
        const contour = leftoverContours[i];
        const contourLocal = worldToLocal(contour);
        const area = Math.max(0, polygonArea(contour));
        if (area <= 1e-9) continue;
        if (area + 1e-9 < minLeftoverAreaMm2) continue;
        const span = contourSpanMm(contour);
        if (span + 1e-9 < minLeftoverSpanMm) continue;
        const bb = polygonBBox(contour);
        if (!bb) continue;
        const derivedKey = `${baseParentKey}#g${generation}#s${i + 1}`;
        const derivedTagBase = String(bp && bp.tpl && bp.tpl && bp.tpl.c && bp.tpl.c.inventoryTag || "DERIVED");
        const derivedTag = `${derivedTagBase}#R${derivedTemplateSeq}`;
        const derivedId = `derived:${derivedTemplateSeq}`;
        const centered = translateToAnchor(contour, { x: 0, y: 0 });
        const sampleContour = samplePolyline(contour, 20);
        const derivedCandidate = {
          id: derivedId,
          inventoryTag: derivedTag,
          scrapContour: JSON.stringify({ units: "mm", path: contour }),
          areaMm2: area,
          bboxWidthMm: Number(bb.width || 0),
          bboxHeightMm: Number(bb.height || 0),
          napDirectionDeg: safeNum(bp && bp.tpl && bp.tpl && bp.tpl.c && bp.tpl.c.napDirectionDeg)
        };
        candidateTemplates.push({
          c: derivedCandidate,
          idx: candidateTemplates.length,
          key: derivedKey,
          centered,
          area,
          sampleContour,
          napDirectionDeg: normalizeDeg(derivedCandidate.napDirectionDeg),
          requiresParentKey: parentKey || "",
          derived: true,
          parentPieceKey,
          rootParentKey: baseParentKey,
          generation
        });
        splitEvents.push({
          parentCandidateKey: parentKey || parentPieceKey,
          usedAreaMm2,
          leftoverAreaMm2: areaRound(area),
          usedWorldMulti: usedMulti,
          leftoverWorldMulti: leftoverMulti,
          usedLocalContours: usedContoursLocal,
          usedWorldContours: usedContoursWorld,
          usedWorldContour: usedContoursWorld[0] || null,
          leftoverLocalContour: contourLocal,
          leftoverLocalContours: [contourLocal],
          leftoverContoursLocal: [contourLocal],
          leftoverWorldContour: contour,
          leftoverWorldContours: [contour],
          splitIndex: i + 1,
          generation,
          derivedCandidateKey: derivedKey
        });
        derivedTemplateSeq += 1;
        added += 1;
      }
      derivedCreatedTotal += added;
      return added;
    }

    algorithmTrace.steps.candidate_pool.compatible = pool.length;
    algorithmTrace.steps.candidate_pool.templates = candidateTemplates.length;
    emitProgress({
      phase: "legacy_search_start",
      percent: 83,
      title: "Server / placement search (legacy)",
      iterations: 0,
      evaluated: 0,
      pieces: 0,
      coverage: 0,
      rejected: { overlap: 0, lowGain: 0, outside: 0, oversize: 0, noFit: 0 }
    });
    captureBestState("init");

    function wrapSignedDeg(v) {
      return wrapSignedDegImpl(v);
    }
    function computeNapDeviation(targetDeg, rotatedDeg, allowFlip) {
      return computeNapDeviationImpl(targetDeg, rotatedDeg, allowFlip, { deltaDeg, normalizeDeg });
    }

    function rebuildStateFromRecords() {
      usedCandidateKeys.clear();
      placements = [];
      fragments = [];
      let replayResidual = zoneMulti;
      let maxFragId = 0;
      for (const rec of placementRecords) {
        if (!rec || !rec.inZoneMulti) continue;
        replayResidual = diffMulti(replayResidual, rec.inZoneMulti);
        if (rec.candidateKey) usedCandidateKeys.add(rec.candidateKey);
        if (rec.fragment) {
          fragments.push(rec.fragment);
          maxFragId = Math.max(maxFragId, Number(rec.fragment.id || 0));
        }
        if (rec.placement) placements.push(rec.placement);
      }
      residualMulti = replayResidual;
      nextId = Math.max(1, maxFragId + 1);
      nextPlacementId = Math.max(1, placements.length + 1);
    }

    function currentCoveredRatio() {
      return zoneArea > 0
        ? Math.max(0, Math.min(1, (zoneArea - multiPolygonArea(residualMulti)) / zoneArea))
        : 0;
    }
    function fullCoverageByCoverageRatio(coveredRatioValue) {
      const v = Math.max(0, Math.min(1, Number(coveredRatioValue || 0)));
      return v >= (1 - coverageEps);
    }
    function buildCoreGeometry(fullContour) {
      const full = Array.isArray(fullContour) ? fullContour : [];
      if (!pieceSeamReserveMm || pieceSeamReserveMm <= 1e-9) {
        const coreMulti = pointsToMultiPolygon(full);
        return { coreContour: full, coreMulti };
      }
      const scale = 1000;
      const srcPath = pointsToClipperPath(full, scale);
      if (srcPath.length < 3) return { coreContour: [], coreMulti: [] };
      const cleaned = ClipperLib.Clipper.CleanPolygon(srcPath, 1);
      if (!Array.isArray(cleaned) || cleaned.length < 3) return { coreContour: [], coreMulti: [] };
      if (ringAreaSigned(clipperPathToPoints(cleaned, scale)) < 0) cleaned.reverse();
      const co = new ClipperLib.ClipperOffset(2, 2);
      co.AddPath(cleaned, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
      const out = new ClipperLib.Paths();
      co.Execute(out, -pieceSeamReserveMm * scale);
      const polys = [];
      for (const path of out || []) {
        const pts = clipperPathToPoints(path, scale);
        if (pts.length < 3) continue;
        const a = Math.abs(ringAreaSigned(pts));
        if (a <= 1e-6) continue;
        if (ringAreaSigned(pts) < 0) pts.reverse();
        polys.push([pts.map((p) => [Number(p.x.toFixed(6)), Number(p.y.toFixed(6))]).concat([[Number(pts[0].x.toFixed(6)), Number(pts[0].y.toFixed(6))]])]);
      }
      const coreMulti = Array.isArray(polys) ? polys : [];
      const coreContour = largestOuterRingPoints(coreMulti);
      return { coreContour, coreMulti };
    }
    function ringsFromMultiOuter(mp) {
      const out = [];
      for (const poly of Array.isArray(mp) ? mp : []) {
        const outer = Array.isArray(poly) && Array.isArray(poly[0]) ? poly[0] : null;
        if (!Array.isArray(outer) || outer.length < 4) continue;
        const pts = [];
        for (let i = 0; i < outer.length - 1; i++) {
          const x = Number(outer[i] && outer[i][0]);
          const y = Number(outer[i] && outer[i][1]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          pts.push({ x, y });
        }
        if (pts.length >= 3) out.push(pts);
      }
      return out;
    }
    function contourSpanMm(points) {
      const bb = polygonBBox(Array.isArray(points) ? points : []);
      if (!bb) return 0;
      return Math.max(0, Number(bb.width || 0), Number(bb.height || 0));
    }
    function areaRound(v) {
      return Math.round(Math.max(0, Number(v || 0)) * 1000) / 1000;
    }
    function pointInRing(pt, ring) {
      const x = Number(pt && pt.x);
      const y = Number(pt && pt.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Array.isArray(ring) || ring.length < 3) return false;
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = Number(ring[i] && ring[i].x);
        const yi = Number(ring[i] && ring[i].y);
        const xj = Number(ring[j] && ring[j].x);
        const yj = Number(ring[j] && ring[j].y);
        if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) continue;
        const cross = (yi > y) !== (yj > y);
        if (!cross) continue;
        const atX = ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi;
        if (x < atX) inside = !inside;
      }
      return inside;
    }
    function pointToSegDist(pt, a, b) {
      const px = Number(pt && pt.x);
      const py = Number(pt && pt.y);
      const ax = Number(a && a.x);
      const ay = Number(a && a.y);
      const bx = Number(b && b.x);
      const by = Number(b && b.y);
      if (![px, py, ax, ay, bx, by].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
      const vx = bx - ax;
      const vy = by - ay;
      const wx = px - ax;
      const wy = py - ay;
      const len2 = vx * vx + vy * vy;
      if (len2 <= 1e-12) return Math.hypot(wx, wy);
      const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
      const qx = ax + t * vx;
      const qy = ay + t * vy;
      return Math.hypot(px - qx, py - qy);
    }
    function distanceToRingBoundary(pt, ring) {
      if (!Array.isArray(ring) || ring.length < 3) return 0;
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const d = pointToSegDist(pt, a, b);
        if (d < best) best = d;
      }
      return Number.isFinite(best) ? best : 0;
    }
    function buildPolylabelCell(pt, h, ring) {
      const inside = pointInRing(pt, ring);
      const dist = distanceToRingBoundary(pt, ring);
      const d = inside ? dist : -dist;
      const max = d + h * Math.SQRT2;
      return { x: Number(pt.x || 0), y: Number(pt.y || 0), h, d, max };
    }
    function popBestCell(queue) {
      if (!Array.isArray(queue) || !queue.length) return null;
      let bestIdx = 0;
      let bestMax = Number(queue[0] && queue[0].max || -1e18);
      for (let i = 1; i < queue.length; i++) {
        const cur = Number(queue[i] && queue[i].max || -1e18);
        if (cur > bestMax) {
          bestMax = cur;
          bestIdx = i;
        }
      }
      const out = queue[bestIdx];
      queue.splice(bestIdx, 1);
      return out;
    }
    function pointInMultiOuter(pt, mp) {
      for (const poly of Array.isArray(mp) ? mp : []) {
        const ringRaw = Array.isArray(poly) ? poly[0] : null;
        if (!Array.isArray(ringRaw) || ringRaw.length < 4) continue;
        const ring = [];
        for (let i = 0; i < ringRaw.length - 1; i++) {
          const x = Number(ringRaw[i] && ringRaw[i][0]);
          const y = Number(ringRaw[i] && ringRaw[i][1]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          ring.push({ x, y });
        }
        if (pointInRing(pt, ring)) return true;
      }
      return false;
    }
    function selectResidualTargetForPhase(residualMp, phaseMode) {
      const polys = Array.isArray(residualMp) ? residualMp : [];
      if (!polys.length) return { mp: residualMp, areaMm2: 0, parts: 0 };
      const parts = polys
        .map((poly) => {
          const areaMm2 = Math.max(0, multiPolygonArea([poly]));
          return { poly, areaMm2 };
        })
        .filter((x) => x.areaMm2 > 1e-9)
        .sort((a, b) => b.areaMm2 - a.areaMm2);
      if (!parts.length) return { mp: residualMp, areaMm2: 0, parts: 0 };
      let takeCount = 1;
      if (phaseMode === "B") takeCount = Math.min(2, parts.length);
      const take = parts.slice(0, takeCount).map((x) => x.poly);
      const areaMm2 = parts.slice(0, takeCount).reduce((acc, x) => acc + x.areaMm2, 0);
      return { mp: take, areaMm2, parts: parts.length, largestAreaMm2: Number(parts[0].areaMm2 || 0) };
    }
    function computeDeepPointForResidualTarget(targetMp, fallbackPt) {
      const ring = largestOuterRingPoints(targetMp);
      if (!Array.isArray(ring) || ring.length < 3) return fallbackPt;
      const bb = polygonBBox(ring);
      if (!bb) return fallbackPt;
      const candidates = [];
      const c = centroid(ring);
      if (pointInRing(c, ring)) candidates.push(c);
      for (const a of residualAnchors(targetMp)) {
        if (pointInRing(a, ring)) candidates.push(a);
      }
      const nx = 7;
      const ny = 7;
      for (let iy = 1; iy <= ny; iy++) {
        for (let ix = 1; ix <= nx; ix++) {
          const x = bb.minX + (ix / (nx + 1)) * Math.max(1e-9, bb.width);
          const y = bb.minY + (iy / (ny + 1)) * Math.max(1e-9, bb.height);
          const p = { x, y };
          if (pointInRing(p, ring)) candidates.push(p);
        }
      }
      if (!candidates.length) return fallbackPt;
      let best = candidates[0];
      let bestD = distanceToRingBoundary(best, ring);
      for (let i = 1; i < candidates.length; i++) {
        const p = candidates[i];
        const d = distanceToRingBoundary(p, ring);
        if (d > bestD) {
          best = p;
          bestD = d;
        }
      }
      // Polylabel-style refinement: maximize distance to boundary inside polygon.
      const minDim = Math.max(1e-6, Math.min(Math.abs(Number(bb.width || 0)), Math.abs(Number(bb.height || 0))));
      const initCellSize = Math.max(2, minDim / 5);
      const precision = Math.max(0.8, minDim / 80);
      const queue = [];
      for (let y = Number(bb.minY || 0); y < Number(bb.maxY || 0) + initCellSize; y += initCellSize) {
        for (let x = Number(bb.minX || 0); x < Number(bb.maxX || 0) + initCellSize; x += initCellSize) {
          const h = initCellSize / 2;
          queue.push(buildPolylabelCell({ x: x + h, y: y + h }, h, ring));
        }
      }
      let bestCell = buildPolylabelCell(best, 0, ring);
      let guard = 0;
      while (queue.length && guard < 160) {
        guard += 1;
        const cell = popBestCell(queue);
        if (!cell) break;
        if (cell.d > bestCell.d) bestCell = cell;
        if ((cell.max - bestCell.d) <= precision) continue;
        const h2 = cell.h / 2;
        if (h2 <= precision * 0.5) continue;
        queue.push(buildPolylabelCell({ x: cell.x - h2, y: cell.y - h2 }, h2, ring));
        queue.push(buildPolylabelCell({ x: cell.x + h2, y: cell.y - h2 }, h2, ring));
        queue.push(buildPolylabelCell({ x: cell.x - h2, y: cell.y + h2 }, h2, ring));
        queue.push(buildPolylabelCell({ x: cell.x + h2, y: cell.y + h2 }, h2, ring));
      }
      if (Number.isFinite(bestCell.x) && Number.isFinite(bestCell.y) && pointInRing(bestCell, ring)) {
        return { x: bestCell.x, y: bestCell.y };
      }
      return best;
    }
    function ringPerimeter(ring) {
      if (!Array.isArray(ring) || ring.length < 2) return 0;
      let p = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const ax = Number(a && a.x);
        const ay = Number(a && a.y);
        const bx = Number(b && b.x);
        const by = Number(b && b.y);
        if (![ax, ay, bx, by].every(Number.isFinite)) continue;
        p += Math.hypot(bx - ax, by - ay);
      }
      return p;
    }
    function multiOuterPerimeter(mp) {
      let total = 0;
      for (const poly of Array.isArray(mp) ? mp : []) {
        const ringRaw = Array.isArray(poly) ? poly[0] : null;
        if (!Array.isArray(ringRaw) || ringRaw.length < 4) continue;
        const ring = [];
        for (let i = 0; i < ringRaw.length - 1; i++) {
          const x = Number(ringRaw[i] && ringRaw[i][0]);
          const y = Number(ringRaw[i] && ringRaw[i][1]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          ring.push({ x, y });
        }
        if (ring.length >= 3) total += ringPerimeter(ring);
      }
      return total;
    }
    function residualFragmentationPenalty(beforeMp, afterMp) {
      const polys = Array.isArray(afterMp) ? afterMp : [];
      if (!polys.length) return 0;
      const areas = polys
        .map((poly) => Math.max(0, multiPolygonArea([poly])))
        .filter((a) => a > 1e-9);
      if (!areas.length) return 0;
      const smallAreaThr = Math.max(1, minGainVisibleMm2);
      let smallCount = 0;
      for (const a of areas) {
        if (a < smallAreaThr) smallCount += 1;
      }
      const beforePer = Math.max(0, multiOuterPerimeter(beforeMp));
      const afterPer = Math.max(0, multiOuterPerimeter(afterMp));
      const zoneScale = Math.max(1, Math.sqrt(Math.max(1e-9, zoneArea)));
      const perimeterGrowthPenalty = Math.max(0, (afterPer - beforePer) / zoneScale) * 0.22;
      const perimeterAbsPenalty = (afterPer / zoneScale) * 0.03;
      const partsPenalty = Math.max(0, areas.length - 1) * 0.22;
      const smallPenalty = smallCount * 0.45;
      return objectiveFragmentPenalty * (partsPenalty + smallPenalty + perimeterGrowthPenalty + perimeterAbsPenalty);
    }
    function buildLayerTopIndex() {
      const recs = Array.isArray(placementRecords) ? placementRecords : [];
      if (!recs.length) return null;
      if (layerPolicy === "first_on_top") {
        let unionAll = [];
        for (const rec of recs) {
          if (!rec || !Array.isArray(rec.inZoneMulti) || !rec.inZoneMulti.length) continue;
          unionAll = unionAll.length ? unionMulti(unionAll, rec.inZoneMulti) : rec.inZoneMulti;
        }
        return {
          policy: "first_on_top",
          unionAll
        };
      }
      const sorted = recs
        .map((rec) => {
          const pieceArea = Math.max(0, Number(
            rec && rec.placement && rec.placement.scrapAreaMm2
          ) || 0);
          return {
            area: pieceArea,
            inZoneMulti: rec && rec.inZoneMulti,
            fragmentId: Number(rec && rec.placement && rec.placement.fragmentId || 0)
          };
        })
        .filter((x) => Array.isArray(x.inZoneMulti) && x.inZoneMulti.length)
        .sort((a, b) => {
          if (Math.abs(b.area - a.area) > 1e-9) return b.area - a.area;
          return a.fragmentId - b.fragmentId;
        });
      if (!sorted.length) return null;
      const prefixUnions = [];
      const sortedAreas = [];
      let acc = [];
      for (const item of sorted) {
        acc = acc.length ? unionMulti(acc, item.inZoneMulti) : item.inZoneMulti;
        prefixUnions.push(acc);
        sortedAreas.push(Number(item.area || 0));
      }
      return {
        policy: "priority_on_top",
        prefixUnions,
        sortedAreas
      };
    }
    function coveredTopForCandidate(index, candidateCostArea) {
      if (!index) return [];
      if (index.policy === "first_on_top") return Array.isArray(index.unionAll) ? index.unionAll : [];
      const arr = Array.isArray(index.sortedAreas) ? index.sortedAreas : [];
      if (!arr.length) return [];
      let lo = 0;
      let hi = arr.length - 1;
      let pos = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (Number(arr[mid] || 0) >= Number(candidateCostArea || 0) - 1e-9) {
          pos = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (pos < 0) return [];
      return Array.isArray(index.prefixUnions) && Array.isArray(index.prefixUnions[pos])
        ? index.prefixUnions[pos]
        : [];
    }

    async function runPlacementPass(maxIter) {
      emitProgress({
        phase: "placement_pass_start",
        percent: 84,
        title: "Server / placement pass start",
        iterations: algorithmTrace.steps.placement_search.iterations,
        evaluated: algorithmTrace.steps.placement_search.evaluated,
        pieces: placements.length,
        coverage: currentCoveredRatio() * 100,
        maxIter: Number(maxIter || 0)
      });
      let stallCount = 0;
      let noProgressStreak = 0;
      for (let iter = 0; iter < maxIter; iter++) {
        if ((iter % 2) === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        algorithmTrace.steps.placement_search.iterations += 1;
        if (isHardTimeout()) {
          timeBudgetExceeded = true;
          stopReason = "time_budget";
          emitProgress({
            phase: "placement_pass_exit",
            percent: 90,
            title: "Server / hard timeout",
            reason: "hard_timeout",
            iterations: algorithmTrace.steps.placement_search.iterations,
            evaluated: algorithmTrace.steps.placement_search.evaluated,
            pieces: placements.length,
            coverage: currentCoveredRatio() * 100
          });
          return;
        }
        if (enforceTimeBudget && Date.now() - solveStartedAt > maxSolveMs) {
          timeBudgetExceeded = true;
          stopReason = "time_budget";
          emitProgress({
            phase: "placement_pass_exit",
            percent: 90,
            title: "Server / time budget exceeded",
            reason: "time_budget",
            iterations: algorithmTrace.steps.placement_search.iterations,
            evaluated: algorithmTrace.steps.placement_search.evaluated,
            pieces: placements.length,
            coverage: currentCoveredRatio() * 100
          });
          return;
        }
        const residualAreaNow = multiPolygonArea(residualMulti);
        const coveredRatioNow = currentCoveredRatio();
        const residualRatioNow = zoneArea > 1e-9 ? (residualAreaNow / zoneArea) : 1;
        const strictTailRescueActive = !!(
          strictCoverageEffective &&
          (coveredRatioNow >= 0.9 || residualRatioNow <= 0.12 || noProgressStreak >= 1)
        );
        const strictTailRescueHard = !!(
          strictTailRescueActive &&
          (residualRatioNow <= 0.05 || noProgressStreak >= 2)
        );
        const phaseAActive = (!phaseAForceDisabled) && (
          coveredRatioNow < phaseAEndCoverage ||
          phaseAAcceptedPieces < phaseAMinPieces
        );
        const inTailPhase =
          !phaseAActive && (
            coveredRatioNow >= tailCoverageStart ||
            residualAreaNow <= tailResidualMm2 ||
            stallCount >= tailStallTrigger ||
            noProgressStreak >= 2
          );
        if (
          inTailPhase &&
          tailMaxPlacements > 0 &&
          tailAcceptedPiecesTotal >= tailMaxPlacements &&
          residualRatioNow <= tailCapResidualRatio
        ) {
          tailPieceCapHit = true;
          stopReason = "max_pieces";
          emitProgress({
            phase: "placement_pass_exit",
            percent: 90,
            title: "Server / tail piece cap",
            reason: "tail_piece_cap",
            iterations: algorithmTrace.steps.placement_search.iterations,
            evaluated: algorithmTrace.steps.placement_search.evaluated,
            pieces: placements.length,
            coverage: coveredRatioNow * 100,
            residualAreaMm2: residualAreaNow,
            tailAcceptedPiecesTotal
          });
          return;
        }
        const phaseMode = phaseAActive ? "A" : (inTailPhase ? "C" : "B");
        const passTarget = selectResidualTargetForPhase(residualMulti, phaseMode);
        const residualEvalMp = (passTarget && Array.isArray(passTarget.mp) && passTarget.mp.length)
          ? passTarget.mp
          : residualMulti;
        const residualEvalAreaNow = Math.max(0, Number(passTarget && passTarget.areaMm2 || residualAreaNow));
        let pocketModeActive = false;
        let pocketMaxPieceArea = 0;
        const nowMs = Date.now();
        if ((nowMs - lastLegacyProgressEmitAt) > 450 || (iter % 5) === 0) {
          emitProgress({
            phase: "placement_search",
            percent: 83 + Math.min(8, coveredRatioNow * 8),
            title: "Server / placement search",
            iterations: algorithmTrace.steps.placement_search.iterations,
            evaluated: algorithmTrace.steps.placement_search.evaluated,
            pieces: placements.length,
            coverage: coveredRatioNow * 100,
            residualAreaMm2: residualAreaNow,
            rejected: {
              overlap: rejectedByOverlap,
              lowGain: rejectedByCoverage,
              outside: rejectedByOutside,
              oversize: rejectedByOversize,
              noFit: rejectedNoFit
            },
            thresholds: {
              dynamicNapTolDeg,
              dynamicGainFactor,
              minEfficiencyBase,
              strictTailRescueActive,
              strictTailRescueHard,
              phaseMode,
              phaseAAcceptedPieces,
              phaseAMinPieces,
              phaseAInsideMin,
              phaseAMaxOverlap,
              phaseAMinGainMm2,
              phaseAMinGainShare,
              minGainVisibleMm2,
              minSpanMm,
              layerPolicy,
              targetResidualAreaMm2: residualEvalAreaNow,
              targetResidualParts: Number(passTarget && passTarget.parts || 0),
              phaseBEfficiencyMin,
              tailMinEfficiency,
              tailMinEfficiencyLoose,
              pocketModeActive,
              pocketMaxPieceArea,
              inTailPhase,
              coverageFirst
            }
          });
          lastLegacyProgressEmitAt = nowMs;
        }
        if (coveredRatioNow >= coverageTarget && placements.length >= minPieces) {
          stopReason = "target_reached";
          emitProgress({
            phase: "placement_pass_exit",
            percent: 91,
            title: "Server / target reached",
            reason: "target_reached",
            iterations: algorithmTrace.steps.placement_search.iterations,
            evaluated: algorithmTrace.steps.placement_search.evaluated,
            pieces: placements.length,
            coverage: coveredRatioNow * 100,
            residualAreaMm2: residualAreaNow
          });
          return;
        }
        if (residualAreaNow <= 1e-6) {
          stopReason = "target_reached";
          emitProgress({
            phase: "placement_pass_exit",
            percent: 91,
            title: "Server / residual empty",
            reason: "residual_empty",
            iterations: algorithmTrace.steps.placement_search.iterations,
            evaluated: algorithmTrace.steps.placement_search.evaluated,
            pieces: placements.length,
            coverage: coveredRatioNow * 100,
            residualAreaMm2: residualAreaNow
          });
          return;
        }

        // Candidate anchors are extracted from current residual polygons.
        const anchorsRaw = residualAnchors(residualEvalMp);
        // Limit anchor count to keep runtime stable while still exploring hole boundaries.
        const anchors = [];
        const seenAnchor = new Set();
        const anchorLimit = coveredRatioNow >= 0.9 ? 180 : (coveredRatioNow >= 0.75 ? 120 : 64);
        for (const a of anchorsRaw) {
          const k = `${Math.round(a.x)}:${Math.round(a.y)}`;
          if (seenAnchor.has(k)) continue;
          seenAnchor.add(k);
          anchors.push(a);
          if (anchors.length >= anchorLimit) break;
        }
        if ((phaseMode === "A" || phaseMode === "B") && globalGridAnchors.length) {
          const extraLimit = phaseMode === "A" ? 64 : 40;
          for (const a of globalGridAnchors) {
            const k = `${Math.round(a.x)}:${Math.round(a.y)}`;
            if (seenAnchor.has(k)) continue;
            seenAnchor.add(k);
            anchors.push(a);
            if (anchors.length >= anchorLimit + extraLimit) break;
          }
        }
        if (!anchors.length) anchors.push(centroid(workingZone));
        const fallbackTargetPoint = pickLargestResidualTarget(residualEvalMp, anchors[0]);
        const targetPoint = computeDeepPointForResidualTarget(residualEvalMp, fallbackTargetPoint);
        anchors.sort((a, b) => dist2(a, targetPoint) - dist2(b, targetPoint));

        const remainingAreaEst = Math.max(1, zoneArea * (1 - coveredRatioNow));
        const workingResidualForTail = Math.max(1, inTailPhase ? residualEvalAreaNow : residualAreaNow);
        const remainingCandidates = Math.max(1, candidateTemplates.length - usedCandidateKeys.size);
        const leftPieces = Math.max(1, Math.min(maxPieces - placements.length, remainingCandidates));
        const desiredArea = workingResidualForTail / leftPieces;
        const tailGainFactor = coveredRatioNow >= 0.9 ? 0.2 : (coveredRatioNow >= 0.8 ? 0.35 : 1);
        const strictTailMinGain = (strictCoverageEffective && coveredRatioNow >= 0.9) ? 0.5 : 5;
        const adaptiveMinGainArea = Math.max(
          strictTailMinGain,
          Math.min(minGainAreaMm2 * dynamicGainFactor * tailGainFactor, remainingAreaEst * 0.12)
        ) * coreMinGainScale;
        const effectiveMinGainArea = noProgressStreak >= 2
          ? Math.max(strictTailMinGain, adaptiveMinGainArea * 0.45)
          : adaptiveMinGainArea;
        const phaseAMinGainDynamic = Math.max(phaseAMinGainMm2, residualAreaNow * phaseAMinGainShare) * coreMinGainScale;
        const phaseBCMinGainDynamic = Math.min(minGainVisibleMm2 * coreMinGainScale, Math.max(12, workingResidualForTail * (0.85 * coreMinGainScale)));
        const tailDynamicMinGainArea = inTailPhase
          ? Math.min(tailMinGainCapMm2 * coreMinGainScale, Math.max(0, workingResidualForTail * (tailMinGainShare * coreMinGainScale)))
          : 0;
        const rescueMinGainArea = strictTailRescueActive
          ? (strictTailRescueHard ? 0.25 : 1.0)
          : 0;
        const phaseAMinGainArea = Math.max(effectiveMinGainArea, Math.max(phaseAMinGainDynamic, remainingAreaEst * 0.015));
        const baseMaxOverlap = maxPieceOverlap;
        const adaptiveMaxOverlap = coverageFirst
          ? 1.0
          : Math.max(
              baseMaxOverlap,
              Math.min(
                0.9,
                overlapAversionMode
                  ? (baseMaxOverlap + (1 - coveredRatioNow) * 0.16 + dynamicOverlapBoost * 0.6)
                  : (baseMaxOverlap + (1 - coveredRatioNow) * 0.22 + dynamicOverlapBoost)
              )
            );
        const adaptiveMinInsideRatio = coverageFirst
          ? 0.01
          : Math.max(
              overlapAversionMode ? 0.2 : 0.08,
              Math.min(minInsideRatio, minInsideRatio - (1 - coveredRatioNow) * 0.12 - dynamicInsideDrop)
            );

        const adaptiveOverlapPenalty = overlapPenalty * (coveredRatioNow >= 0.9 ? 1.45 : (coveredRatioNow >= 0.8 ? 1.2 : 1)) * (inTailPhase ? tailPenaltyBoost : 1);
        const adaptiveOutsidePenalty = outsidePenalty * (coveredRatioNow >= 0.9 ? 1.1 : 1) * (inTailPhase ? tailPenaltyBoost : 1);
        const overlapSoftLimit = inTailPhase
          ? Math.max(0.8, Math.min(0.95, adaptiveMaxOverlap + 0.18))
          : Math.max(0.58, Math.min(0.9, adaptiveMaxOverlap + 0.08));
        // In clean layout mode overlap is capped to avoid mosaic-like stacking.
        const overlapHardLimit = cleanLayoutMode
          ? (
              strictTailRescueActive
                ? (inTailPhase ? Math.max(cleanOverlapRatioMaxC, 0.98) : Math.max(cleanOverlapRatioMaxAB, 0.92))
                : (inTailPhase ? cleanOverlapRatioMaxC : cleanOverlapRatioMaxAB)
            )
          : (inTailPhase ? 0.9998 : 0.999);
        pocketModeActive = residualRatioNow <= pocketModeStartRatio;
        pocketMaxPieceArea = Math.max(1, workingResidualForTail * pocketAreaK);

        const templateLimit = coveredRatioNow >= 0.9 ? 220 : (coveredRatioNow >= 0.7 ? 160 : 120);
        const phaseTemplateCandidates = getTemplatesForPhase(phaseMode, coveredRatioNow, remainingAreaEst);
        const rankedTemplates = phaseTemplateCandidates
          .filter((t) => templateAvailable(t))
          .filter((t) => {
            if (!pocketModeActive) return true;
            return Number(t.area || 0) <= pocketMaxPieceArea + 1e-6;
          })
          .map((t) => {
            if (phaseMode === "A" && !t.derived && Number(t.area || 0) < Math.max(2500, remainingAreaEst * 0.06)) return null;
            const rel = Math.min(t.area, desiredArea) / Math.max(t.area, desiredArea);
            const smallPieceBias = coveredRatioNow >= 0.85
              ? Math.max(0, 1 - Math.min(1, t.area / Math.max(1, remainingAreaEst * 0.35)))
              : 0;
            const phaseABias = phaseMode === "A"
              ? Math.min(1, Math.max(0, Number(t.area || 0) / Math.max(1, remainingAreaEst)))
              : 0;
            const derivedBoost = splitReturnEnabled && t.derived
              ? (phaseMode === "C" ? 0.95 : 0.72)
              : 0;
            const bias = Math.max(0.2, rel * 0.6 + smallPieceBias * 0.25 + phaseABias * 0.35 + derivedBoost);
            return { t, s: bias };
          })
          .filter(Boolean)
          .sort((a, b) => Number(b.s || 0) - Number(a.s || 0))
          .slice(0, templateLimit)
          .map((x) => x.t);
        if (!rankedTemplates.length) {
          // Safety fallback: if strict pass pool is empty after gates, try full list.
          const relaxed = candidateTemplates
            .filter((t) => templateAvailable(t))
            .filter((t) => !pocketModeActive || Number(t.area || 0) <= pocketMaxPieceArea + 1e-6)
            .sort((a, b) => Number(b.area || 0) - Number(a.area || 0))
            .slice(0, templateLimit);
          if (relaxed.length) {
            rankedTemplates.push(...relaxed);
          }
        }
        if (splitReturnEnabled) {
          derivedEligibleTotal += rankedTemplates.filter((t) => !!(t && t.derived)).length;
        }
        if (placements.length === 0 && rankedTemplates.length > 1) {
          // Force first pick policy: try biggest pieces first on initial placement.
          rankedTemplates.sort((a, b) => Number(b.area || 0) - Number(a.area || 0));
        }

        if (!rankedTemplates.length) {
          stopReason = "exhaustive_no_gain";
          stopProof = {
            rankedTemplates: 0,
            anchors: anchors.length,
            evaluated: algorithmTrace.steps.placement_search.evaluated
          };
          emitProgress({
            phase: "placement_pass_exit",
            percent: 90,
            title: "Server / no ranked templates",
            reason: "no_ranked_templates",
            iterations: algorithmTrace.steps.placement_search.iterations,
            evaluated: algorithmTrace.steps.placement_search.evaluated,
            pieces: placements.length,
            coverage: coveredRatioNow * 100,
            residualAreaMm2: residualAreaNow
          });
          return;
        }

        let bestPlacement = null;
        let bestNonOverlapPlacement = null;
        let iterEvalCount = 0;
        const layerTopIndex = null;
        const iterEvalBudget = splitReturnEnabled
          ? (coveredRatioNow >= 0.9 ? 3500 : (coveredRatioNow >= 0.75 ? 5500 : 8000))
          : (coveredRatioNow >= 0.9 ? 26000 : (coveredRatioNow >= 0.75 ? 42000 : 60000));
        searchLoop:
        for (const tpl of rankedTemplates) {
        if (inTailPhase && splitReturnEnabled && tpl && tpl.derived) {
          tailDerivedPassUsed = true;
        }
        const candidateNapDeg = tpl.napDirectionDeg;
        const preferredRotDeg = (targetNapDeg !== null && candidateNapDeg !== null)
          ? wrapSignedDeg(targetNapDeg - candidateNapDeg)
          : 0;
        const minRot = preferredRotDeg - dynamicNapTolDeg;
        const maxRot = preferredRotDeg + dynamicNapTolDeg;
        const coarseStep = dynamicNapTolDeg <= 12 ? 3 : (dynamicNapTolDeg <= 30 ? 6 : 10);
        const angleCandidates = [];
        for (let a = minRot; a <= maxRot + 1e-9; a += coarseStep) angleCandidates.push(Math.round(a * 10) / 10);
        if (!angleCandidates.length) angleCandidates.push(Math.round(preferredRotDeg * 10) / 10);
        // Local translation neighborhood helps fit pieces into narrow residual pockets.
        const shift = coveredRatioNow >= 0.9 ? 4 : (coveredRatioNow >= 0.8 ? 6 : 10);
        const offsetCandidates = coveredRatioNow >= 0.9
          ? [
              { dx: 0, dy: 0 },
              { dx: -shift, dy: 0 }, { dx: shift, dy: 0 }, { dx: 0, dy: -shift }, { dx: 0, dy: shift },
              { dx: -shift, dy: -shift }, { dx: shift, dy: -shift }, { dx: -shift, dy: shift }, { dx: shift, dy: shift },
              { dx: -2 * shift, dy: 0 }, { dx: 2 * shift, dy: 0 }, { dx: 0, dy: -2 * shift }, { dx: 0, dy: 2 * shift }
            ]
          : [
              { dx: 0, dy: 0 },
              { dx: -shift, dy: 0 }, { dx: shift, dy: 0 }, { dx: 0, dy: -shift }, { dx: 0, dy: shift },
              { dx: -shift, dy: -shift }, { dx: shift, dy: -shift }, { dx: -shift, dy: shift }, { dx: shift, dy: shift }
            ];
        if (overlapAversionMode) {
          offsetCandidates.push(
            { dx: -2 * shift, dy: 0 }, { dx: 2 * shift, dy: 0 }, { dx: 0, dy: -2 * shift }, { dx: 0, dy: 2 * shift },
            { dx: -3 * shift, dy: 0 }, { dx: 3 * shift, dy: 0 }, { dx: 0, dy: -3 * shift }, { dx: 0, dy: 3 * shift }
          );
        }
        for (const anchor of anchors) {
          for (const aDeg of angleCandidates) {
              if (targetNapDeg !== null && candidateNapDeg !== null) {
                const rotatedNap = normalizeDeg(candidateNapDeg + aDeg);
                const dNap = computeNapDeviation(targetNapDeg, rotatedNap, dynamicAllowFlip180);
                if (napPolicy !== "free" && dNap !== null && dNap > dynamicNapTolDeg + 1e-6) continue;
              }
            const rot = (aDeg * Math.PI) / 180;
            const rotated = rotatePoints(tpl.centered, rot, { x: 0, y: 0 });
            for (const off of offsetCandidates) {
              iterEvalCount += 1;
              algorithmTrace.steps.placement_search.evaluated += 1;
              if (splitReturnEnabled && tpl.derived) derivedEvaluatedTotal += 1;
              if (inTailPhase && splitReturnEnabled && tpl.derived) tailDerivedEvaluated += 1;
              if ((iterEvalCount % 1200) === 0) {
                await new Promise((resolve) => setImmediate(resolve));
                emitProgress({
                  phase: "placement_search",
                  percent: 84 + Math.min(7, coveredRatioNow * 7),
                  title: "Server / placement search",
                  iterations: algorithmTrace.steps.placement_search.iterations,
                  evaluated: algorithmTrace.steps.placement_search.evaluated,
                  pieces: placements.length,
                  coverage: coveredRatioNow * 100,
                  residualAreaMm2: residualAreaNow,
                  rejected: {
                    overlap: rejectedByOverlap,
                    lowGain: rejectedByCoverage,
                    outside: rejectedByOutside,
                    oversize: rejectedByOversize,
                    noFit: rejectedNoFit
                  }
                });
                lastLegacyProgressEmitAt = Date.now();
              }
              if (isHardTimeout()) {
                timeBudgetExceeded = true;
                break searchLoop;
              }
              if (iterEvalCount > iterEvalBudget) break searchLoop;
              const anchorShifted = { x: anchor.x + off.dx, y: anchor.y + off.dy };
              const contour = translateToAnchor(rotated, anchorShifted);
              const contourMulti = pointsToMultiPolygon(contour);
              if (!contourMulti.length) continue;
              const costArea = Math.max(1e-9, Number(tpl.area || 0));
              const inZoneMulti = intersectMulti(contourMulti, zoneMulti);
              const inZoneArea = multiPolygonArea(inZoneMulti);
              if (inZoneArea <= 1e-6) continue;
              const coreGeom = buildCoreGeometry(contour);
              const inZoneCoreMulti = coreGeom.coreMulti.length ? intersectMulti(coreGeom.coreMulti, zoneMulti) : [];
              const inZoneCoreArea = multiPolygonArea(inZoneCoreMulti);
              const gainCoreMulti = inZoneCoreMulti.length ? intersectMulti(inZoneCoreMulti, residualEvalMp) : [];
              const gainCoreArea = multiPolygonArea(gainCoreMulti);
              const gainMulti = intersectMulti(inZoneMulti, residualEvalMp);
              const gainArea = multiPolygonArea(gainMulti);
              const gainVisibleMpRaw = gainMulti;
              const gainVisibleArea = Math.max(0, multiPolygonArea(gainVisibleMpRaw));
              const overlapTopArea = Math.max(0, inZoneArea - gainVisibleArea);
              const residualAfterMp = diffMulti(residualEvalMp, gainMulti);
              const fragPenalty = residualFragmentationPenalty(residualEvalMp, residualAfterMp);
              const coversTargetPoint = pointInMultiOuter(targetPoint, gainVisibleMpRaw);
              const targetPointBonus = coversTargetPoint ? 0.16 : (phaseMode === "A" ? -0.32 : -0.18);
              const gainOuterPts = largestOuterRingPoints(gainMulti);
              const gainBb = polygonBBox(gainOuterPts);
              const overlapArea = overlapTopArea;
              const overlapToGain = overlapArea / Math.max(1e-9, gainVisibleArea);
              let oversizeSoftPenalty = 0;
              if (inTailPhase) {
                const oversizeAlphaEff = strictTailRescueActive
                  ? Math.max(tailOversizeAlpha, strictTailRescueHard ? 14 : 8)
                  : tailOversizeAlpha;
                const maxInZoneForGain = oversizeAlphaEff * Math.max(1e-9, gainArea);
                if (inZoneArea > maxInZoneForGain + 1e-6) {
                  const nearTimeout = (Date.now() - solveStartedAt) >= Math.max(1000, Math.floor(maxSolveMs * 0.9));
                  const residualSmall = residualRatioNow <= Math.max(0.01, 4 * coverageEps);
                  const canTailLastChance = !!(
                    strictCoverageEffective &&
                    strictTailRescueHard &&
                    !fullCoverageByCoverageRatio(currentCoveredRatio()) &&
                    (noProgressStreak >= 2 || nearTimeout || residualSmall)
                  );
                  if (!canTailLastChance) {
                    rejectedByOversize += 1;
                    algorithmTrace.steps.placement_search.rejected.oversize += 1;
                    continue;
                  }
                  tailLastChanceUsed = true;
                  oversizeSoftPenalty = ((inZoneArea - maxInZoneForGain) / Math.max(1e-9, maxInZoneForGain)) * 4.5;
                }
              }
              if (cleanLayoutMode && !strictTailRescueActive && overlapToGain > (inTailPhase ? 0.9 : 0.6)) {
                rejectedByOverlap += 1;
                algorithmTrace.steps.placement_search.rejected.overlap += 1;
                continue;
              }
              if (minFragmentAreaMm2Hard > 0 && gainArea + 1e-9 < (minFragmentAreaMm2Hard * coreHardMinAreaScale)) {
                rejectedByCoverage += 1;
                algorithmTrace.steps.placement_search.rejected.lowGain += 1;
                continue;
              }
              if (minFragmentWidthMmHard > 0 || minFragmentLengthMmHard > 0) {
                if (!gainBb) {
                  rejectedByCoverage += 1;
                  algorithmTrace.steps.placement_search.rejected.lowGain += 1;
                  continue;
                }
                const alongHard = axis === "x" ? gainBb.width : gainBb.height;
                const acrossHard = axis === "x" ? gainBb.height : gainBb.width;
                if (minFragmentLengthMmHard > 0 && alongHard + 1e-9 < minFragmentLengthMmHard) {
                  rejectedByCoverage += 1;
                  algorithmTrace.steps.placement_search.rejected.lowGain += 1;
                  continue;
                }
                if (minFragmentWidthMmHard > 0 && acrossHard + 1e-9 < minFragmentWidthMmHard) {
                  rejectedByCoverage += 1;
                  algorithmTrace.steps.placement_search.rejected.lowGain += 1;
                  continue;
                }
              }
              const insideRatio = Math.max(0, Math.min(1, inZoneArea / Math.max(1e-9, tpl.area)));
              const overlapRatio = inZoneArea > 0 ? overlapArea / inZoneArea : 0;
              const overlapMax = overlapRatio;
              if (!coverageFirst && overlapMax > overlapHardLimit) {
                rejectedByOverlap += 1;
                algorithmTrace.steps.placement_search.rejected.overlap += 1;
                continue;
              }
              if (phaseMode === "A") {
                const phaseAInsideGate = Math.max(0.6, phaseAInsideMin - (dynamicInsideDrop * 0.75));
                // In phase A keep only catastrophic reject; overlap/outside are scored as costs.
                if (insideRatio + 1e-9 < Math.max(0.2, phaseAInsideGate - 0.55)) {
                  rejectedByOutside += 1;
                  algorithmTrace.steps.placement_search.rejected.outside += 1;
                  continue;
                }
              }
              if (minSpanMm > 0 && !strictTailRescueActive) {
                const derivedGateScale = splitReturnEnabled && tpl.derived
                  ? (inTailPhase ? 0.2 : 0.35)
                  : 1;
                // Phase A applies a relaxed span gate (50%) to avoid rejecting large pieces clipped by zone edge
                const phaseARelax = phaseMode === "A" ? 0.5 : 1;
                if (!gainBb) {
                  rejectedByCoverage += 1;
                  algorithmTrace.steps.placement_search.rejected.lowGain += 1;
                  continue;
                }
                const span = Math.max(Number(gainBb.width || 0), Number(gainBb.height || 0));
                if (span + 1e-9 < (minSpanMm * coreSpanScale * derivedGateScale * phaseARelax)) {
                  rejectedByCoverage += 1;
                  algorithmTrace.steps.placement_search.rejected.lowGain += 1;
                  continue;
                }
              }
              const derivedGateScale = splitReturnEnabled && tpl.derived
                ? (inTailPhase ? 0.2 : 0.35)
                : 1;
              if (gainVisibleArea < (Math.max(
                phaseMode === "A" ? phaseAMinGainArea : Math.max(effectiveMinGainArea, phaseBCMinGainDynamic),
                tailDynamicMinGainArea
              ) * derivedGateScale) && gainVisibleArea + 1e-9 < rescueMinGainArea) {
                rejectedByCoverage += 1;
                algorithmTrace.steps.placement_search.rejected.lowGain += 1;
                continue;
              }

              let napPenaltyScore = 0;
              if (targetNapDeg !== null && candidateNapDeg !== null) {
                const rotatedNap = normalizeDeg(candidateNapDeg + aDeg);
                const dNap = computeNapDeviation(targetNapDeg, rotatedNap, allowFlip180);
                if (dNap !== null) {
                  const tolRef = napPolicy === "free" ? 45 : Math.max(1, napTolDeg);
                  const scaled = dNap / tolRef;
                  napPenaltyScore = napWeight * scaled * scaled;
                }
              }
              const outsideArea = Math.max(0, costArea - inZoneArea);
              const softOverlapPenalty = (!coverageFirst && overlapMax > overlapSoftLimit)
                ? (overlapMax - overlapSoftLimit) * (inTailPhase ? 40 : 28)
                : 0;
              const outsideSoftPenalty = (!coverageFirst && insideRatio < adaptiveMinInsideRatio)
                ? (adaptiveMinInsideRatio - insideRatio) * (inTailPhase ? 14 : 9)
                : 0;
              const phaseAOutsidePenalty = (phaseMode === "A" && insideRatio < phaseAInsideMin)
                ? (phaseAInsideMin - insideRatio) * 18
                : 0;
              const efficiencyRatio = gainVisibleArea / costArea;
              const tailEffMin = residualRatioNow <= tailResidualLooseRatio ? tailMinEfficiencyLoose : tailMinEfficiency;
              const effMinGate = phaseMode === "A"
                ? Math.max(minEfficiencyBase, 0.8)
                : (phaseMode === "B"
                  ? Math.max(minEfficiencyBase, phaseBEfficiencyMin)
                  : Math.max(minEfficiencyBase, tailEffMin));
              const effGateEffective = strictTailRescueActive
                ? Math.min(effMinGate * coreEffScale, strictTailRescueHard ? 0.01 : 0.04)
                : (effMinGate * coreEffScale * derivedGateScale);
              if (efficiencyRatio + 1e-9 < effGateEffective) {
                rejectedByCoverage += 1;
                algorithmTrace.steps.placement_search.rejected.lowGain += 1;
                continue;
              }
              const pocketCoverage = residualEvalAreaNow > 1e-9
                ? Math.max(0, Math.min(1, gainVisibleArea / residualEvalAreaNow))
                : 0;
              const dominantPocketA = phaseMode === "A"
                && pocketCoverage >= pocketCoverageThresholdA
                && insideRatio >= Math.max(0.74, phaseAInsideMin - 0.08);
              const pocketCoverageBonus = phaseMode === "A"
                ? pocketCoverageBonusA * pocketCoverage
                : 0;
              const gainScore = scorePlacementObjective({
                costArea,
                gainArea: gainVisibleArea,
                inZoneArea,
                overlapArea,
                outsideArea,
                coveredRatioNow,
                inTailPhase,
                overlapPenaltyK: adaptiveOverlapPenalty,
                outsidePenaltyK: adaptiveOutsidePenalty,
                napPenaltyScore,
                costWeight: phaseMode === "A" ? Math.max(0.7, costWeight * 0.85) : (inTailPhase ? Math.max(1.6, costWeight * 1.35) : costWeight),
                objectiveMode,
                objectiveMinEfficiency,
                objectivePiecePenalty,
                objectiveFragmentPenalty,
                piecesPlaced: placements.length,
                phaseMode,
                zoneArea
              }) - softOverlapPenalty - outsideSoftPenalty - phaseAOutsidePenalty - fragPenalty + targetPointBonus + pocketCoverageBonus - cleanPiecePenalty - oversizeSoftPenalty;

              const candidatePlacement = {
                tpl,
                contour,
                contourMulti,
                inZoneMulti,
                coreContour: coreGeom.coreContour,
                coreMulti: coreGeom.coreMulti,
                inZoneCoreMulti,
                inZoneCoreArea,
                gainMulti,
                gainCoreMulti,
                gainArea,
                gainCoreArea,
                gainVisibleArea,
                inZoneArea,
                overlapArea,
                gainScore,
                fragPenalty,
                targetPointBonus,
                pocketCoverageBonus,
                pocketCoverage,
                dominantPocketA,
                coversTargetPoint,
                angleDeg: aDeg,
                insideRatio,
                overlapMax,
                napPenaltyScore,
                outsideArea,
                oversizeSoftPenalty
              };
              if (preferCandidatePlacement(candidatePlacement, bestPlacement, gainScore, costArea)) {
                bestPlacement = candidatePlacement;
              }
              const nonOverlapEpsMm2 = Math.max(1, rasterMm * rasterMm * 0.2);
              if (overlapArea <= nonOverlapEpsMm2) {
                if (
                  !bestNonOverlapPlacement ||
                  gainScore > bestNonOverlapPlacement.gainScore + 1e-9 ||
                  (Math.abs(gainScore - bestNonOverlapPlacement.gainScore) <= 1e-9 && gainVisibleArea > Number(bestNonOverlapPlacement.gainVisibleArea || bestNonOverlapPlacement.gainArea || 0))
                ) {
                  bestNonOverlapPlacement = candidatePlacement;
                }
              }
            }
          }
        }
        }

        if ((overlapAversionMode || cleanLayoutMode) && bestNonOverlapPlacement && bestPlacement) {
          const gainKeepRatio = Number(bestNonOverlapPlacement.gainVisibleArea || bestNonOverlapPlacement.gainArea || 0) / Math.max(1e-9, Number(bestPlacement.gainVisibleArea || bestPlacement.gainArea || 0));
          const currentOverlap = Math.max(0, Number(bestPlacement.overlapArea || 0));
          const nonOverlap = Math.max(0, Number(bestNonOverlapPlacement.overlapArea || 0));
          const minKeep = cleanLayoutMode ? 0.9 : 0.98;
          if (currentOverlap > 20 && nonOverlap <= currentOverlap * 0.35 && gainKeepRatio >= minKeep) {
            bestPlacement = bestNonOverlapPlacement;
          }
        }

        if (!bestPlacement) {
          // Fallback full-pool pass: when narrowed ranking misses viable scraps.
          const fallbackTemplates = candidateTemplates.filter((t) => templateAvailable(t));
          const fallbackAnchors = anchorsRaw.length
            ? anchorsRaw.slice(0, Math.min(260, anchorsRaw.length))
            : anchors;
          const fallbackEvalBudget = 90000;
          let fallbackEvalCount = 0;
          if (fallbackTemplates.length && fallbackAnchors.length) {
            fallbackLoop:
            for (const tpl of fallbackTemplates) {
              const candidateNapDeg = tpl.napDirectionDeg;
              const preferredRotDeg = (targetNapDeg !== null && candidateNapDeg !== null)
                ? wrapSignedDeg(targetNapDeg - candidateNapDeg)
                : 0;
              const minRot = preferredRotDeg - napTolDeg;
              const maxRot = preferredRotDeg + napTolDeg;
              const coarseStep = napTolDeg <= 12 ? 4 : (napTolDeg <= 30 ? 8 : 12);
              const angleCandidates = [];
              for (let a = minRot; a <= maxRot + 1e-9; a += coarseStep) angleCandidates.push(Math.round(a * 10) / 10);
              if (!angleCandidates.length) angleCandidates.push(Math.round(preferredRotDeg * 10) / 10);
              const baseShift = coveredRatioNow >= 0.9 ? 4 : (coveredRatioNow >= 0.8 ? 6 : 10);
              const fallbackShift = overlapAversionMode ? Math.max(6, baseShift) : Math.max(4, Math.floor(baseShift * 0.8));
              const fallbackOffsets = overlapAversionMode
                ? [
                    { dx: 0, dy: 0 },
                    { dx: -fallbackShift, dy: 0 }, { dx: fallbackShift, dy: 0 }, { dx: 0, dy: -fallbackShift }, { dx: 0, dy: fallbackShift },
                    { dx: -2 * fallbackShift, dy: 0 }, { dx: 2 * fallbackShift, dy: 0 }, { dx: 0, dy: -2 * fallbackShift }, { dx: 0, dy: 2 * fallbackShift }
                  ]
                : [{ dx: 0, dy: 0 }, { dx: -fallbackShift, dy: 0 }, { dx: fallbackShift, dy: 0 }, { dx: 0, dy: -fallbackShift }, { dx: 0, dy: fallbackShift }];
              for (const anchor of fallbackAnchors) {
                for (const aDeg of angleCandidates) {
                  if (targetNapDeg !== null && candidateNapDeg !== null) {
                    const rotatedNap = normalizeDeg(candidateNapDeg + aDeg);
                    const dNap = computeNapDeviation(targetNapDeg, rotatedNap, dynamicAllowFlip180);
                    if (napPolicy !== "free" && dNap !== null && dNap > dynamicNapTolDeg + 1e-6) continue;
                  }
                  fallbackEvalCount += 1;
                  if ((fallbackEvalCount % 1200) === 0) {
                    await new Promise((resolve) => setImmediate(resolve));
                    emitProgress({
                      phase: "placement_search",
                      percent: 84 + Math.min(7, coveredRatioNow * 7),
                      title: "Server / placement search",
                      iterations: algorithmTrace.steps.placement_search.iterations,
                      evaluated: algorithmTrace.steps.placement_search.evaluated,
                      pieces: placements.length,
                      coverage: coveredRatioNow * 100,
                      residualAreaMm2: residualAreaNow,
                      rejected: {
                        overlap: rejectedByOverlap,
                        lowGain: rejectedByCoverage,
                        outside: rejectedByOutside,
                        oversize: rejectedByOversize,
                        noFit: rejectedNoFit
                      }
                    });
                    lastLegacyProgressEmitAt = Date.now();
                  }
                  if (fallbackEvalCount > fallbackEvalBudget) break fallbackLoop;
                  if (isHardTimeout()) {
                    timeBudgetExceeded = true;
                    break fallbackLoop;
                  }
                  const rot = (aDeg * Math.PI) / 180;
                  const rotated = rotatePoints(tpl.centered, rot, { x: 0, y: 0 });
                  for (const off of fallbackOffsets) {
                    const shiftedAnchor = { x: anchor.x + off.dx, y: anchor.y + off.dy };
                    const contour = translateToAnchor(rotated, shiftedAnchor);
                    const contourMulti = pointsToMultiPolygon(contour);
                    if (!contourMulti.length) continue;
                    const costArea = Math.max(1e-9, Number(tpl.area || 0));
                    const inZoneMulti = intersectMulti(contourMulti, zoneMulti);
                    const inZoneArea = multiPolygonArea(inZoneMulti);
                    if (inZoneArea <= 1e-6) continue;
                    const coreGeom = buildCoreGeometry(contour);
                    const inZoneCoreMulti = coreGeom.coreMulti.length ? intersectMulti(coreGeom.coreMulti, zoneMulti) : [];
                    const inZoneCoreArea = multiPolygonArea(inZoneCoreMulti);
                    const gainCoreMulti = inZoneCoreMulti.length ? intersectMulti(inZoneCoreMulti, residualEvalMp) : [];
                    const gainCoreArea = multiPolygonArea(gainCoreMulti);
                    const gainMulti = intersectMulti(inZoneMulti, residualEvalMp);
                    const gainArea = multiPolygonArea(gainMulti);
                    const gainVisibleMpRaw = gainMulti;
                    const gainVisibleArea = Math.max(0, multiPolygonArea(gainVisibleMpRaw));
                    const overlapTopArea = Math.max(0, inZoneArea - gainVisibleArea);
                    const residualAfterMp = diffMulti(residualEvalMp, gainMulti);
                    const fragPenalty = residualFragmentationPenalty(residualEvalMp, residualAfterMp);
                    const coversTargetPoint = pointInMultiOuter(targetPoint, gainVisibleMpRaw);
                    const targetPointBonus = coversTargetPoint ? 0.16 : (phaseMode === "A" ? -0.32 : -0.18);
                    const gainOuterPts = largestOuterRingPoints(gainMulti);
                    const gainBb = polygonBBox(gainOuterPts);
                    if (gainArea <= 1e-6) continue;
                    if (minFragmentAreaMm2Hard > 0 && gainArea + 1e-9 < (minFragmentAreaMm2Hard * coreHardMinAreaScale)) continue;
                    if (minFragmentWidthMmHard > 0 || minFragmentLengthMmHard > 0) {
                      if (!gainBb) continue;
                      const alongHard = axis === "x" ? gainBb.width : gainBb.height;
                      const acrossHard = axis === "x" ? gainBb.height : gainBb.width;
                      if (minFragmentLengthMmHard > 0 && alongHard + 1e-9 < minFragmentLengthMmHard) continue;
                      if (minFragmentWidthMmHard > 0 && acrossHard + 1e-9 < minFragmentWidthMmHard) continue;
                    }
                    const overlapArea = overlapTopArea;
                    const overlapToGain = overlapArea / Math.max(1e-9, gainVisibleArea);
                    let oversizeSoftPenalty = 0;
                    if (inTailPhase) {
                      const oversizeAlphaEff = strictTailRescueActive
                        ? Math.max(tailOversizeAlpha, strictTailRescueHard ? 14 : 8)
                        : tailOversizeAlpha;
                      const maxInZoneForGain = oversizeAlphaEff * Math.max(1e-9, gainArea);
                      if (inZoneArea > maxInZoneForGain + 1e-6) {
                        const nearTimeout = (Date.now() - solveStartedAt) >= Math.max(1000, Math.floor(maxSolveMs * 0.9));
                        const residualSmall = residualRatioNow <= Math.max(0.01, 4 * coverageEps);
                        const canTailLastChance = !!(
                          strictCoverageEffective &&
                          strictTailRescueHard &&
                          !fullCoverageByCoverageRatio(currentCoveredRatio()) &&
                          (noProgressStreak >= 2 || nearTimeout || residualSmall)
                        );
                        if (!canTailLastChance) {
                          rejectedByOversize += 1;
                          algorithmTrace.steps.placement_search.rejected.oversize += 1;
                          continue;
                        }
                        tailLastChanceUsed = true;
                        oversizeSoftPenalty = ((inZoneArea - maxInZoneForGain) / Math.max(1e-9, maxInZoneForGain)) * 4.5;
                      }
                    }
                    if (cleanLayoutMode && !strictTailRescueActive && overlapToGain > (inTailPhase ? 0.9 : 0.6)) {
                      rejectedByOverlap += 1;
                      algorithmTrace.steps.placement_search.rejected.overlap += 1;
                      continue;
                    }
                    const insideRatio = Math.max(0, Math.min(1, inZoneArea / Math.max(1e-9, tpl.area)));
                    const overlapMax = inZoneArea > 0 ? (overlapArea / inZoneArea) : 0;
                    if (!coverageFirst && overlapMax > overlapHardLimit) {
                      rejectedByOverlap += 1;
                      algorithmTrace.steps.placement_search.rejected.overlap += 1;
                      continue;
                    }
                    if (phaseMode === "A") {
                      const phaseAInsideGate = Math.max(0.6, phaseAInsideMin - (dynamicInsideDrop * 0.75));
                      if (insideRatio + 1e-9 < Math.max(0.2, phaseAInsideGate - 0.55)) {
                        rejectedByOutside += 1;
                        algorithmTrace.steps.placement_search.rejected.outside += 1;
                        continue;
                      }
                    }
                    if (minSpanMm > 0 && !strictTailRescueActive) {
                      const derivedGateScale = splitReturnEnabled && tpl.derived
                        ? (inTailPhase ? 0.2 : 0.35)
                        : 1;
                      const phaseARelax = phaseMode === "A" ? 0.5 : 1;
                      if (!gainBb) {
                        rejectedByCoverage += 1;
                        algorithmTrace.steps.placement_search.rejected.lowGain += 1;
                        continue;
                      }
                      const span = Math.max(Number(gainBb.width || 0), Number(gainBb.height || 0));
                      if (span + 1e-9 < (minSpanMm * coreSpanScale * derivedGateScale * phaseARelax)) {
                        rejectedByCoverage += 1;
                        algorithmTrace.steps.placement_search.rejected.lowGain += 1;
                        continue;
                      }
                    }
                    const derivedGateScale = splitReturnEnabled && tpl.derived
                      ? (inTailPhase ? 0.2 : 0.35)
                      : 1;
                    if (gainVisibleArea < (Math.max(
                      phaseMode === "A" ? phaseAMinGainArea : Math.max(effectiveMinGainArea, phaseBCMinGainDynamic),
                      tailDynamicMinGainArea
                    ) * derivedGateScale) && gainVisibleArea + 1e-9 < rescueMinGainArea) {
                      rejectedByCoverage += 1;
                      algorithmTrace.steps.placement_search.rejected.lowGain += 1;
                      continue;
                    }
                    let napPenaltyScore = 0;
                    if (targetNapDeg !== null && candidateNapDeg !== null) {
                      const rotatedNap = normalizeDeg(candidateNapDeg + aDeg);
                      const dNap = computeNapDeviation(targetNapDeg, rotatedNap, dynamicAllowFlip180);
                      if (dNap !== null) {
                        const tolRef = napPolicy === "free" ? 45 : Math.max(1, dynamicNapTolDeg);
                        const scaled = dNap / tolRef;
                        napPenaltyScore = napWeight * scaled * scaled;
                      }
                    }
              const outsideArea = Math.max(0, costArea - inZoneArea);
                    const softOverlapPenalty = (!coverageFirst && overlapMax > overlapSoftLimit)
                      ? (overlapMax - overlapSoftLimit) * (inTailPhase ? 40 : 28)
                      : 0;
                    const outsideSoftPenalty = (!coverageFirst && insideRatio < adaptiveMinInsideRatio)
                      ? (adaptiveMinInsideRatio - insideRatio) * (inTailPhase ? 14 : 9)
                      : 0;
                    const phaseAOutsidePenalty = (phaseMode === "A" && insideRatio < phaseAInsideMin)
                      ? (phaseAInsideMin - insideRatio) * 18
                      : 0;
                    const efficiencyRatio = gainVisibleArea / costArea;
                    const tailEffMin = residualRatioNow <= tailResidualLooseRatio ? tailMinEfficiencyLoose : tailMinEfficiency;
                    const effMinGate = phaseMode === "A"
                      ? Math.max(minEfficiencyBase, 0.8)
                      : (phaseMode === "B"
                        ? Math.max(minEfficiencyBase, phaseBEfficiencyMin)
                        : Math.max(minEfficiencyBase, tailEffMin));
                    const effGateEffective = strictTailRescueActive
                      ? Math.min(effMinGate * coreEffScale, strictTailRescueHard ? 0.01 : 0.04)
                      : (effMinGate * coreEffScale * derivedGateScale);
                    if (efficiencyRatio + 1e-9 < effGateEffective) {
                      rejectedByCoverage += 1;
                      algorithmTrace.steps.placement_search.rejected.lowGain += 1;
                      continue;
                    }
                  const pocketCoverage = residualEvalAreaNow > 1e-9
                    ? Math.max(0, Math.min(1, gainVisibleArea / residualEvalAreaNow))
                    : 0;
                  const dominantPocketA = phaseMode === "A"
                    && pocketCoverage >= pocketCoverageThresholdA
                    && insideRatio >= Math.max(0.74, phaseAInsideMin - 0.08);
                  const pocketCoverageBonus = phaseMode === "A"
                    ? pocketCoverageBonusA * pocketCoverage
                    : 0;
                  const gainScore = scorePlacementObjective({
                    costArea,
                    gainArea: gainVisibleArea,
                    inZoneArea: inZoneCoreArea,
                    overlapArea,
                    outsideArea,
                    coveredRatioNow,
                    inTailPhase,
                    overlapPenaltyK: adaptiveOverlapPenalty,
                    outsidePenaltyK: adaptiveOutsidePenalty,
                    napPenaltyScore,
                    costWeight: phaseMode === "A" ? Math.max(0.7, costWeight * 0.85) : (inTailPhase ? Math.max(1.6, costWeight * 1.35) : costWeight),
                    objectiveMode,
                    objectiveMinEfficiency,
                    objectivePiecePenalty,
                    objectiveFragmentPenalty,
                    piecesPlaced: placements.length,
                    phaseMode,
                    zoneArea
                  }) - softOverlapPenalty - outsideSoftPenalty - phaseAOutsidePenalty - fragPenalty + targetPointBonus + pocketCoverageBonus - cleanPiecePenalty - oversizeSoftPenalty;
              const candidatePlacement = {
                tpl,
                contour,
                contourMulti,
                inZoneMulti,
                coreContour: coreGeom.coreContour,
                coreMulti: coreGeom.coreMulti,
                inZoneCoreMulti,
                inZoneCoreArea,
                gainMulti,
                gainCoreMulti,
                gainArea,
                gainCoreArea,
                gainVisibleArea,
                inZoneArea,
                      overlapArea,
                      gainScore,
                      fragPenalty,
                      targetPointBonus,
                      pocketCoverageBonus,
                      pocketCoverage,
                      dominantPocketA,
                      coversTargetPoint,
                      angleDeg: aDeg,
                      insideRatio,
                      overlapMax,
                      napPenaltyScore,
                      outsideArea,
                      oversizeSoftPenalty
                    };
                    if (preferCandidatePlacement(candidatePlacement, bestPlacement, gainScore, costArea)) {
                      bestPlacement = candidatePlacement;
                    }
                    const nonOverlapEpsMm2 = Math.max(1, rasterMm * rasterMm * 0.2);
                    if (overlapArea <= nonOverlapEpsMm2) {
                      if (
                        !bestNonOverlapPlacement ||
                        gainScore > bestNonOverlapPlacement.gainScore + 1e-9 ||
                        (Math.abs(gainScore - bestNonOverlapPlacement.gainScore) <= 1e-9 && gainVisibleArea > Number(bestNonOverlapPlacement.gainVisibleArea || bestNonOverlapPlacement.gainArea || 0))
                      ) {
                        bestNonOverlapPlacement = candidatePlacement;
                      }
                    }
                  }
                }
              }
            }
          }
          if ((overlapAversionMode || cleanLayoutMode) && bestNonOverlapPlacement && bestPlacement) {
            const gainKeepRatio = Number(bestNonOverlapPlacement.gainVisibleArea || bestNonOverlapPlacement.gainArea || 0) / Math.max(1e-9, Number(bestPlacement.gainVisibleArea || bestPlacement.gainArea || 0));
            const currentOverlap = Math.max(0, Number(bestPlacement.overlapArea || 0));
            const nonOverlap = Math.max(0, Number(bestNonOverlapPlacement.overlapArea || 0));
            const minKeep = cleanLayoutMode ? 0.9 : 0.98;
            if (currentOverlap > 20 && nonOverlap <= currentOverlap * 0.35 && gainKeepRatio >= minKeep) {
              bestPlacement = bestNonOverlapPlacement;
            }
          }
        }

        if (!bestPlacement) {
          noProgressStreak += 1;
          rejectedNoFit += 1;
          algorithmTrace.steps.placement_search.rejected.noFit += 1;
          if (phaseMode === "A" && !phaseAForceDisabled && noProgressStreak >= 1) {
            // Do not burn full time budget in strict phase A when geometry clearly blocks progress.
            phaseAForceDisabled = true;
          }
          emitProgress({
            phase: "placement_search_stall",
            percent: 90,
            title: "Server / placement stalled",
            iterations: algorithmTrace.steps.placement_search.iterations,
            evaluated: algorithmTrace.steps.placement_search.evaluated,
            pieces: placements.length,
            coverage: coveredRatioNow * 100,
            residualAreaMm2: residualAreaNow,
            rejected: {
              overlap: rejectedByOverlap,
              lowGain: rejectedByCoverage,
              outside: rejectedByOutside,
              oversize: rejectedByOversize,
              noFit: rejectedNoFit
            }
          });
          if (dynamicOverlapBoost < 0.22) {
            dynamicOverlapBoost += 0.08;
            dynamicInsideDrop += 0.05;
            dynamicGainFactor = Math.max(0.25, dynamicGainFactor * 0.65);
            if (!hardNapLock && targetNapDeg !== null && napPolicy !== "free") {
              dynamicNapTolDeg = Math.min(180, dynamicNapTolDeg + 12);
              if (dynamicNapTolDeg >= 90) dynamicAllowFlip180 = true;
            }
            continue;
          }
          if (!phaseAForceDisabled && phaseAAcceptedPieces < phaseAMinPieces) {
            phaseAForceDisabled = true;
            continue;
          }
          // One emergency local-relax attempt near the end to close stubborn tiny holes.
          if (coveredRatioNow >= 0.8 && emergencyRelaxUsed < 1) {
            emergencyRelaxUsed += 1;
            dynamicOverlapBoost = Math.max(dynamicOverlapBoost, 0.4);
            dynamicInsideDrop = Math.max(dynamicInsideDrop, 0.18);
            dynamicGainFactor = Math.min(dynamicGainFactor, 0.2);
            if (!hardNapLock && targetNapDeg !== null && napPolicy !== "free") {
              dynamicNapTolDeg = Math.min(180, dynamicNapTolDeg + 25);
              if (dynamicNapTolDeg >= 90) dynamicAllowFlip180 = true;
            }
            continue;
          }
          // Strict tail mode: try harder before giving up when only small holes remain.
          if (strictCoverageEffective && coveredRatioNow >= 0.9 && stallCount < 8) {
            stallCount += 1;
            dynamicOverlapBoost = Math.max(dynamicOverlapBoost, 0.65);
            dynamicInsideDrop = Math.max(dynamicInsideDrop, 0.25);
            dynamicGainFactor = Math.max(0.02, dynamicGainFactor * 0.45);
            if (!hardNapLock && targetNapDeg !== null && napPolicy !== "free") {
              dynamicNapTolDeg = Math.min(180, dynamicNapTolDeg + 18);
              if (dynamicNapTolDeg >= 90) dynamicAllowFlip180 = true;
            }
            continue;
          }
          emitProgress({
            phase: "placement_pass_exit",
            percent: 90,
            title: "Server / stalled hard",
            reason: "stall_hard",
            iterations: algorithmTrace.steps.placement_search.iterations,
            evaluated: algorithmTrace.steps.placement_search.evaluated,
            pieces: placements.length,
            coverage: coveredRatioNow * 100,
            residualAreaMm2: residualAreaNow
          });
          stopReason = "exhaustive_no_gain";
          stopProof = {
            rankedTemplates: rankedTemplates.length,
            anchors: anchors.length,
            evaluated: algorithmTrace.steps.placement_search.evaluated
          };
          return;
        }
        stallCount = 0;
        noProgressStreak = 0;
        // We found a useful move: tighten dynamic relaxers back towards baseline.
        dynamicOverlapBoost = Math.max(0, dynamicOverlapBoost - 0.03);
        dynamicInsideDrop = Math.max(0, dynamicInsideDrop - 0.02);
        dynamicGainFactor = Math.min(1, dynamicGainFactor + 0.08);

        usedCandidateKeys.add(bestPlacement.tpl.key);
        // Residual updated by core — seam allowance doesn't block neighbouring placements.
        const coverageSliceMulti = splitReturnEnabled
          ? (Array.isArray(bestPlacement.gainMulti) ? bestPlacement.gainMulti : [])
          : (Array.isArray(bestPlacement.inZoneCoreMulti) && bestPlacement.inZoneCoreMulti.length > 0
              ? bestPlacement.inZoneCoreMulti
              : bestPlacement.inZoneMulti);
        residualMulti = diffMulti(residualMulti, coverageSliceMulti);
        const fragPoints = largestOuterRingPoints(bestPlacement.gainMulti).length >= 3
          ? largestOuterRingPoints(bestPlacement.gainMulti)
          : largestOuterRingPoints(bestPlacement.inZoneMulti);
        const fragArea = bestPlacement.gainArea;
        const fragId = nextId++;
        let fragmentObj = null;
        if (fragPoints.length >= 3) {
          fragmentObj = { id: fragId, points: fragPoints, areaMm2: fragArea };
          fragments.push(fragmentObj);
        }

        const alignedForFit = fragPoints.length >= 3 ? fragPoints : bestPlacement.contour;
        const placementFit = evaluateCandidateContourAgainstFragment(
          alignedForFit,
          zoneFragment,
          bestPlacement.tpl.c,
          directConstraints,
          { rotationDeg: bestPlacement.angleDeg, offsetX: 0, offsetY: 0 }
        );
        const fitScore = placementFit ? Number(placementFit.fitScore || 0) : 0;

        const inZonePoints = largestOuterRingPoints(bestPlacement.inZoneMulti);
        const inZoneCorePoints = largestOuterRingPoints(bestPlacement.inZoneCoreMulti || []);
        const inZoneAreaMm2 = Math.max(0, Number(bestPlacement.inZoneArea || 0));
        const inZoneCoreAreaMm2 = Math.max(0, Number(bestPlacement.inZoneCoreArea || 0));
        const overlapCoreAreaMm2 = Math.max(0, Number(bestPlacement.overlapArea || 0));
        const pieceAreaMm2 = Math.max(1e-9, Number(bestPlacement.tpl.area || 0));
        const outsideAreaMm2 = Math.max(0, Number(bestPlacement.outsideArea || (pieceAreaMm2 - inZoneAreaMm2)));
        const gainCoverageAreaMm2 = Math.max(0, Number(bestPlacement.gainArea || 0));
        const gainCoreAreaMm2 = Math.max(0, Number(bestPlacement.gainCoreArea || 0));
        const gainVisibleAreaMm2 = Math.max(0, Number(bestPlacement.gainVisibleArea || gainCoverageAreaMm2));
        const usedVisibleContour = largestOuterRingPoints(bestPlacement.gainMulti);
        const utilizationLocal = gainVisibleAreaMm2 / pieceAreaMm2;
        const solveOrder = placements.length + 1;
        const placementObj = {
          placementId: nextPlacementId++,
          candidateKey: String(bestPlacement.tpl.key || ""),
          candidateType: bestPlacement && bestPlacement.tpl && bestPlacement.tpl.derived ? "derived" : "original",
          solveOrder,
          solveIndex: solveOrder - 1,
          renderIndex: splitReturnEnabled ? (-solveOrder) : solveOrder,
          napEffectiveDeg: placementFit && Number.isFinite(Number(placementFit.napEffectiveDeg))
            ? Math.round(Number(placementFit.napEffectiveDeg) * 10) / 10
            : (safeNum(bestPlacement.tpl.c.napDirectionDeg) === null ? null : normalizeDeg(Number(bestPlacement.tpl.c.napDirectionDeg) + Number(bestPlacement.angleDeg || 0))),
          fragmentId: fragId,
          fragmentAreaMm2: gainCoverageAreaMm2,
          gainAreaMm2: gainVisibleAreaMm2,
          gainCoreAreaMm2,
          inZoneAreaMm2,
          inZoneCoreAreaMm2,
          overlapAreaMm2: overlapCoreAreaMm2,
          overlapCoreAreaMm2,
          outsideAreaMm2,
          scrapAreaMm2: pieceAreaMm2,
          utilizationLocal: Math.round(utilizationLocal * 1000000) / 1000000,
          scrapPieceId: String(bestPlacement.tpl.c.id || ""),
          inventoryTag: String(bestPlacement.tpl.c.inventoryTag || ""),
          scrapContour: String(bestPlacement.tpl.c.scrapContour || ""),
          napDirectionDeg: safeNum(bestPlacement.tpl.c.napDirectionDeg),
          bboxWidthMm: safeNum(bestPlacement.tpl.c.bboxWidthMm),
          bboxHeightMm: safeNum(bestPlacement.tpl.c.bboxHeightMm),
          fitScore: Math.round((fitScore + Math.max(0, Math.min(100, bestPlacement.gainScore * 100))) * 1000) / 1000,
          selectionScore: Math.round(Number(bestPlacement.gainScore || 0) * 1000000) / 1000000,
          fitAreaRatio: placementFit ? Math.round(placementFit.areaRatio * 1000) / 1000 : null,
          fitCoverageRatio: placementFit ? Math.round(placementFit.coverageRatio * 1000) / 1000 : null,
          fitOverlap: Math.round(bestPlacement.overlapMax * 1000) / 1000,
          fitInsidePercent: Math.round(bestPlacement.insideRatio * 1000) / 10,
          fitNapPenalty: Math.round(Number(bestPlacement.napPenaltyScore || 0) * 1000) / 1000,
          fitChamferMm: placementFit ? Math.round(placementFit.chamferMm * 100) / 100 : null,
          napDeltaDeg: placementFit && placementFit.napDeltaDeg !== null ? Math.round(placementFit.napDeltaDeg * 10) / 10 : null,
          alignRotationDeg: Math.round(bestPlacement.angleDeg * 10) / 10,
          alignOffsetX: 0,
          alignOffsetY: 0,
          alignedContour: bestPlacement.contour,
          inZoneContour: inZonePoints.length >= 3 ? inZonePoints : [],
          inZoneCoreContour: inZoneCorePoints.length >= 3 ? inZoneCorePoints : [],
          inZoneContours: bestPlacement.inZoneMulti,
          inZoneCoreContours: bestPlacement.inZoneCoreMulti || [],
          gainCoreContours: bestPlacement.gainCoreMulti || [],
          fragmentContour: fragPoints.length >= 3 ? fragPoints : [],
          fragmentContours: bestPlacement.gainMulti,
          usedVisibleContour: usedVisibleContour.length >= 3 ? usedVisibleContour : [],
          usedVisibleContours: bestPlacement.gainMulti,
          usedVisibleAreaMm2: gainVisibleAreaMm2,
          alignedCoreContour: bestPlacement.coreContour || [],
          status: "matched"
        };
        placements.push(placementObj);
        if (bestPlacement && bestPlacement.tpl && bestPlacement.tpl.derived) {
          derivedUsedTotal += 1;
          derivedUsedAreaMm2 += gainVisibleAreaMm2;
          if (inTailPhase) {
            tailDerivedAccepted += 1;
            tailDerivedCoverageGainMm2 += gainVisibleAreaMm2;
          }
        }
        const derivedAdded = appendDerivedFromAccepted(bestPlacement);
        if (derivedAdded > 0) {
          algorithmTrace.steps.candidate_pool.templates = candidateTemplates.length;
        }
        placementRecords.push({
          candidateKey: bestPlacement.tpl.key,
          inZoneMulti: coverageSliceMulti,
          fragment: fragmentObj,
          placement: placementObj
        });
        algorithmTrace.steps.placement_search.placed += 1;
        captureBestState("piece_accepted");
        if (phaseMode === "A") phaseAAcceptedPieces += 1;
        if (inTailPhase) tailAcceptedPiecesTotal += 1;
        totalOverlapAreaMm2 += Math.max(0, Number(bestPlacement.overlapArea || 0));
        emitProgress({
          phase: "piece_accepted",
          percent: 89,
          title: "Server / accepted piece",
          pieceAreaMm2: pieceAreaMm2,
          gainAreaMm2: gainCoverageAreaMm2,
          gainVisibleMm2: gainVisibleAreaMm2,
          overlapInsideMm2: overlapCoreAreaMm2,
          outsideMm2: outsideAreaMm2,
          score: Number(bestPlacement.gainScore || 0),
          pieces: placements.length,
          coverage: currentCoveredRatio() * 100,
          tailAcceptedPiecesTotal,
          derivedUsedTotal,
          derivedAdded
        });
        const nowPlacedMs = Date.now();
        if ((nowPlacedMs - lastLegacyProgressEmitAt) > 250) {
          const coveredRatioAfter = currentCoveredRatio();
          emitProgress({
            phase: "placement_search",
            percent: 84 + Math.min(8, coveredRatioAfter * 8),
            title: "Server / placement search",
            iterations: algorithmTrace.steps.placement_search.iterations,
            evaluated: algorithmTrace.steps.placement_search.evaluated,
            pieces: placements.length,
            coverage: coveredRatioAfter * 100,
            residualAreaMm2: multiPolygonArea(residualMulti),
            rejected: {
              overlap: rejectedByOverlap,
              lowGain: rejectedByCoverage,
              outside: rejectedByOutside,
              oversize: rejectedByOversize,
              noFit: rejectedNoFit
            }
          });
          lastLegacyProgressEmitAt = nowPlacedMs;
        }
      }
      emitProgress({
        phase: "placement_pass_end",
        percent: 91,
        title: "Server / placement pass end",
        iterations: algorithmTrace.steps.placement_search.iterations,
        evaluated: algorithmTrace.steps.placement_search.evaluated,
        pieces: placements.length,
        coverage: currentCoveredRatio() * 100,
        residualAreaMm2: multiPolygonArea(residualMulti)
      });
      if (!stopReason) {
        stopReason = "exhaustive_no_gain";
        stopProof = {
          rankedTemplates: 0,
          anchors: 0,
          evaluated: algorithmTrace.steps.placement_search.evaluated
        };
      }
    }
    await runPlacementPass(maxPieces);
    captureBestState("initial_pass");

    // Local repair/repack: remove tail placements and refill to close remaining holes.
    if (strictCoverageEffective) {
      algorithmTrace.steps.repair_repack.enabled = true;
      let prevCoveredRatio = currentCoveredRatio();
      let prevPlacementCount = placements.length;
      for (let attempt = 1; attempt <= maxRepairAttempts; attempt++) {
        if (enforceTimeBudget && Date.now() - solveStartedAt > maxSolveMs) {
          timeBudgetExceeded = true;
          break;
        }
        if (isHardTimeout()) {
          timeBudgetExceeded = true;
          break;
        }
        if (prevCoveredRatio >= coverageTarget) break;
        if (placementRecords.length <= 1) break;
        const removeCount = Math.min(repairWindow, placementRecords.length - 1);
        if (removeCount <= 0) break;
        placementRecords.splice(placementRecords.length - removeCount, removeCount);
        algorithmTrace.steps.repair_repack.attempts += 1;
        rebuildStateFromRecords();
        captureBestState("repair_rebuild");
        // In repair mode, allow longer search to close hard residual pockets.
        await runPlacementPass(Math.max(80, Math.max(1, maxPieces - placements.length) * 2));
        captureBestState("repair_pass");
        const coveredAfter = currentCoveredRatio();
        const countAfter = placements.length;
        const coverageImproved = coveredAfter > prevCoveredRatio + 1e-5;
        const sameCoverage = Math.abs(coveredAfter - prevCoveredRatio) <= 1e-5;
        const piecesReduced = countAfter < prevPlacementCount;
        if (!coverageImproved && !(sameCoverage && piecesReduced)) break;
        prevCoveredRatio = coveredAfter;
        prevPlacementCount = countAfter;
      }
      // Final strict escalation: aggressive tail pass + larger repack window.
      if (currentCoveredRatio() < coverageTarget && placementRecords.length > 1) {
        for (let phase = 0; phase < 2; phase++) {
          if (enforceTimeBudget && Date.now() - solveStartedAt > maxSolveMs) {
            timeBudgetExceeded = true;
            break;
          }
          if (isHardTimeout()) {
            timeBudgetExceeded = true;
            break;
          }
          dynamicOverlapBoost = Math.max(dynamicOverlapBoost, 0.75 + phase * 0.08);
          dynamicInsideDrop = Math.max(dynamicInsideDrop, 0.3);
          dynamicGainFactor = Math.max(0.01, Math.min(dynamicGainFactor, 0.05));
          await runPlacementPass(Math.max(120, maxPieces));
          captureBestState("strict_escalation_pass");
          if (currentCoveredRatio() >= coverageTarget) break;
          const removeCount = Math.min(repairWindow + (phase + 1) * 10, placementRecords.length - 1);
          if (removeCount <= 0) break;
          placementRecords.splice(placementRecords.length - removeCount, removeCount);
          algorithmTrace.steps.repair_repack.attempts += 1;
          rebuildStateFromRecords();
          captureBestState("strict_escalation_rebuild");
        }
      }
      algorithmTrace.steps.repair_repack.placementsReused = placements.length;
    }
    captureBestState("pre_final");
    if (restoreBestStateIfBetter()) {
      algorithmTrace.steps.best_plan_restore = {
        restored: true,
        reason: bestState && bestState.reason ? bestState.reason : "best_so_far"
      };
    }

    let strictFinal = strictValidateCoverageByClipper(placements, coverageEps, rasterMm);
    if (strictFinal.fullCoverageOk) {
      const improved = runLocalImprovementIfCovered(placements, "legacy_remove_one");
      if (improved.removed > 0 || improved.replaced > 0 || improved.swapped > 0) {
        placements = improved.placements;
        const keepFrag = new Set(placements.map((p) => Number(p && p.fragmentId || 0)));
        fragments = Array.isArray(fragments)
          ? fragments.filter((f) => keepFrag.has(Number(f && f.id || 0)))
          : [];
        strictFinal = improved.strict;
        if (!algorithmTrace.steps.local_improvement) algorithmTrace.steps.local_improvement = {};
        algorithmTrace.steps.local_improvement = {
          mode: "remove_one",
          removed: Number(improved.removed || 0),
          replaced: Number(improved.replaced || 0),
          swapped: Number(improved.swapped || 0)
        };
      }
    }
    const coveredRatio = strictFinal.coveredRatio;
    const residualAreaMm2 = strictFinal.residualAreaMm2;
    const fullCoverageOk = strictFinal.fullCoverageOk;
    const seamCheck = computeSeamCheck(placements);
    const scrapUsage = buildScrapUsage(placements, residualAreaMm2);
    const diagnostics = computeScenarioADiagnostics(placements, residualAreaMm2, strictFinal);
    algorithmTrace.steps.strict_final_check = {
      strictCoverage: !!strictCoverageEffective,
      coverageTarget,
      coverageEps,
      coveredRatio,
      fullCoverageOk,
      residualAreaMm2,
      epsMm2: strictFinal.epsMm2,
      failedReason: strictCoverageEffective && !fullCoverageOk ? "zone_not_fully_covered" : null,
      tailLastChanceUsed: !!tailLastChanceUsed,
      coverageTargetReachable,
      theoreticalMaxCoverageRatio
    };
    algorithmTrace.steps.seam_check = seamCheck;
    if (splitReturnEnabled) {
      algorithmTrace.steps.split_return = {
        enabled: true,
        events: splitEvents.length,
        templatesTotal: candidateTemplates.length,
        derivedCreated: derivedCreatedTotal,
        derivedEligible: derivedEligibleTotal,
        derivedEvaluated: derivedEvaluatedTotal,
        derivedUsed: derivedUsedTotal,
        derivedUsedAreaMm2: areaRound(derivedUsedAreaMm2),
        derivedReusePct: derivedCreatedTotal > 0
          ? Math.round((100 * derivedUsedTotal / derivedCreatedTotal) * 100) / 100
          : 0,
        tailDerivedPassUsed,
        tailDerivedEvaluated,
        tailDerivedAccepted,
        tailDerivedCoverageGainMm2: areaRound(tailDerivedCoverageGainMm2)
      };
    }
    algorithmTrace.steps.placement_search.stopReason = stopReason || "exhaustive_no_gain";
    algorithmTrace.steps.placement_search.stopProof = stopProof;
    emitProgress({
      phase: "placement_search_done",
      percent: 92,
      title: "Server / coverage check",
      iterations: algorithmTrace.steps.placement_search.iterations,
      evaluated: algorithmTrace.steps.placement_search.evaluated,
      pieces: placements.length,
      coverage: coveredRatio * 100,
      residualAreaMm2,
      rejected: {
        overlap: rejectedByOverlap,
        lowGain: rejectedByCoverage,
        outside: rejectedByOutside,
        oversize: rejectedByOversize,
        noFit: rejectedNoFit
      }
    });

    const legacyOut = {
      fragments,
      placements,
      compatibleCandidates: pool.length,
      usedInventoryTags: placements
        .filter((p) => String(p && p.status || "") === "matched")
        .map((p) => p.inventoryTag),
      rejectedByOverlap,
      rejectedByCoverage,
      rejectedByOutside,
      rejectedByOversize,
      rejectedNoFit,
      tailPieceCapHit,
      tailLastChanceUsed,
      tailAcceptedPiecesTotal,
      seamCheck,
      splitEvents,
      splitReturnEnabled,
      coveredRatio,
      coveragePercent: coveredRatio * 100,
      residualAreaMm2,
      scrapUsage,
      overlapAreaMm2: totalOverlapAreaMm2,
      candidateAreaBudgetMm2,
      diagnostics,
      timeBudgetExceeded,
      strictCoverage: !!strictCoverageEffective,
      coverageEps,
      fullCoverageOk,
      failedReason: strictCoverageEffective && !fullCoverageOk ? "zone_not_fully_covered" : null,
      coverageTargetReachable,
      theoreticalMaxCoverageRatio,
      algorithmTrace
    };

    if (gridFallbackOut && isBetterSolution(gridFallbackOut, legacyOut)) {
      if (!gridFallbackOut.algorithmTrace || typeof gridFallbackOut.algorithmTrace !== "object") {
        gridFallbackOut.algorithmTrace = {};
      }
      if (!gridFallbackOut.algorithmTrace.steps || typeof gridFallbackOut.algorithmTrace.steps !== "object") {
        gridFallbackOut.algorithmTrace.steps = {};
      }
      gridFallbackOut.algorithmTrace.steps.fallback_note = {
        mode: "strategy_compare",
        chosen: "gridCoverV1",
        reason: "better_objective"
      };
      return gridFallbackOut;
    }
    if (legacyOut.algorithmTrace && legacyOut.algorithmTrace.steps) {
      legacyOut.algorithmTrace.steps.fallback_note = {
        mode: "strategy_compare",
        chosen: "phasedV1",
        reason: gridFallbackOut ? "better_objective" : "only_candidate"
      };
    }
    return legacyOut;
  }

  return assignInventoryDirect;
}

module.exports = {
  createAssignInventoryDirect
};
