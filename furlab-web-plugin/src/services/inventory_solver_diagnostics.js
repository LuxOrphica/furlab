"use strict";

function buildScrapUsage(params) {
  const { placementsList, residualAreaValue, zoneArea, scrapAreaByKey } = params;
  const list = Array.isArray(placementsList) ? placementsList : [];
  let usedScrapAreaMm2 = 0;
  let usefulAreaMm2ByVisible = 0;
  for (const p of list) {
    if (!p || String(p.status || "") !== "matched") continue;
    usefulAreaMm2ByVisible += Math.max(0, Number(p.gainAreaMm2 || p.fragmentAreaMm2 || 0));
    const directArea = Number(p.scrapAreaMm2);
    if (Number.isFinite(directArea) && directArea > 0) {
      usedScrapAreaMm2 += directArea;
      continue;
    }
    const idKey = String(p.scrapPieceId || "").trim();
    const tagKey = String(p.inventoryTag || "").trim();
    const fromMap = (idKey && scrapAreaByKey.get(`id:${idKey}`)) || (tagKey && scrapAreaByKey.get(`tag:${tagKey}`)) || 0;
    let area = Math.max(0, Number(fromMap || 0));
    if (!(area > 0)) area = Math.max(0, Number(p.fragmentAreaMm2 || 0));
    usedScrapAreaMm2 += area;
  }
  const residualAreaMm2 = Math.max(0, Number(residualAreaValue || 0));
  const usefulAreaMm2 = usefulAreaMm2ByVisible > 1e-9
    ? usefulAreaMm2ByVisible
    : Math.max(0, zoneArea - residualAreaMm2);
  const effectiveUsefulMm2 = usefulAreaMm2;
  const scrapWasteAreaMm2 = Math.max(0, usedScrapAreaMm2 - usefulAreaMm2);
  const scrapUtilizationPercent = usedScrapAreaMm2 > 1e-9
    ? Math.max(0, Math.min(100, (usefulAreaMm2 / usedScrapAreaMm2) * 100))
    : 0;
  const scrapWastePercent = usedScrapAreaMm2 > 1e-9
    ? Math.max(0, Math.min(100, 100 - scrapUtilizationPercent))
    : 0;
  return {
    usedScrapAreaMm2,
    usefulAreaMm2: effectiveUsefulMm2,
    scrapWasteAreaMm2,
    scrapUtilizationPercent,
    scrapWastePercent
  };
}

function strictValidateCoverageByClipper(params) {
  const {
    placementsList,
    zoneMulti,
    zoneArea,
    coverageEpsRatio,
    useCoreCoverage,
    rasterStepMm,
    pointsToMultiPolygon,
    intersectMulti,
    diffMulti,
    multiPolygonArea
  } = params;
  let residual = zoneMulti;
  const items = Array.isArray(placementsList) ? placementsList : [];
  const preferCore = useCoreCoverage === true;
  for (const p of items) {
    const contour = preferCore
      ? (
          Array.isArray(p && p.alignedCoreContour) && p.alignedCoreContour.length >= 3
            ? p.alignedCoreContour
            : (Array.isArray(p && p.alignedContour) ? p.alignedContour : [])
        )
      : (
          Array.isArray(p && p.alignedContour) && p.alignedContour.length >= 3
            ? p.alignedContour
            : (Array.isArray(p && p.alignedCoreContour) ? p.alignedCoreContour : [])
        );
    if (contour.length < 3) continue;
    const pieceMp = pointsToMultiPolygon(contour);
    if (!pieceMp.length) continue;
    const clipped = intersectMulti(pieceMp, zoneMulti);
    if (!clipped.length) continue;
    residual = diffMulti(residual, clipped);
  }
  const residualAreaMm2 = Math.max(0, multiPolygonArea(residual));
  const coveredRatio = zoneArea > 0 ? Math.max(0, Math.min(1, (zoneArea - residualAreaMm2) / zoneArea)) : 0;
  const epsRatio = Math.max(0.0001, Math.min(0.05, Number(coverageEpsRatio) || 0.002));
  const epsMm2 = Math.max(zoneArea * epsRatio, Math.max(1, Number(rasterStepMm || 2) * Number(rasterStepMm || 2)));
  return {
    residualAreaMm2,
    coveredRatio,
    coveragePercent: coveredRatio * 100,
    fullCoverageOk: residualAreaMm2 <= epsMm2,
    epsMm2
  };
}

function computeScenarioADiagnostics(params) {
  const {
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
  } = params;
  const list = Array.isArray(placementsList) ? placementsList : [];
  const matched = list.filter((p) => p && String(p.status || "") === "matched");
  const enriched = matched.map((p) => {
    const pieceArea = Math.max(0, Number(p.scrapAreaMm2 || 0));
    let inZoneArea = Math.max(0, Number(p.inZoneAreaMm2 || 0));
    if (!(inZoneArea > 0)) {
      const inZoneMp = Array.isArray(p.inZoneContours) && p.inZoneContours.length
        ? p.inZoneContours
        : (() => {
          const contour = Array.isArray(p.alignedContour) ? p.alignedContour : [];
          const mp = contour.length >= 3 ? pointsToMultiPolygon(contour) : [];
          return mp.length ? intersectMulti(mp, zoneMulti) : [];
        })();
      inZoneArea = Math.max(0, multiPolygonArea(inZoneMp));
    }
    let gainArea = Math.max(0, Number(p.gainAreaMm2 || p.fragmentAreaMm2 || 0));
    if (!(gainArea > 0)) {
      const visMp = Array.isArray(p.fragmentContours) && p.fragmentContours.length
        ? p.fragmentContours
        : [];
      if (visMp.length) gainArea = Math.max(0, multiPolygonArea(visMp));
    }
    let overlapArea = Math.max(0, Number(p.overlapAreaMm2 || 0));
    if (!(overlapArea > 0)) overlapArea = Math.max(0, inZoneArea - gainArea);
    const outsideArea = Math.max(0, pieceArea - inZoneArea);
    return { p, pieceArea, inZoneArea, gainArea, overlapArea, outsideArea };
  });
  const selectedPiecesAreaMm2 = enriched.reduce((acc, x) => acc + x.pieceArea, 0);
  const usefulAreaMm2 = enriched.reduce((acc, x) => acc + x.gainArea, 0);
  const selectedInZoneAreaMm2 = enriched.reduce((acc, x) => acc + x.inZoneArea, 0);
  const overlapAreaMm2 = enriched.reduce((acc, x) => acc + x.overlapArea, 0);
  const outsideAreaMm2 = enriched.reduce((acc, x) => acc + x.outsideArea, 0);
  const localUtilValues = enriched
    .map((x) => {
      const p = x.p;
      const u = Number(p.utilizationLocal);
      if (Number.isFinite(u) && u >= 0) return u;
      return x.pieceArea > 1e-9 ? x.gainArea / x.pieceArea : 0;
    })
    .filter((x) => Number.isFinite(x) && x >= 0)
    .sort((a, b) => a - b);
  const meanLocalUtil = localUtilValues.length
    ? localUtilValues.reduce((a, b) => a + b, 0) / localUtilValues.length
    : 0;
  const medianLocalUtil = localUtilValues.length
    ? (localUtilValues.length % 2
      ? localUtilValues[(localUtilValues.length - 1) >> 1]
      : (localUtilValues[(localUtilValues.length >> 1) - 1] + localUtilValues[localUtilValues.length >> 1]) * 0.5)
    : 0;
  const coverableUnionAreaMm2 = Math.min(zoneArea, candidateAreaBudgetMm2);
  const coverableUnionRatio = zoneArea > 1e-9 ? coverableUnionAreaMm2 / zoneArea : 0;
  const residualAreaMm2 = Math.max(0, Number(residualAreaValue || 0));
  const epsMm2 = Math.max(
    zoneArea * Math.max(0.0001, Math.min(0.05, Number(coverageEps) || 0.002)),
    Math.max(1, Number(rasterMm || 2) * Number(rasterMm || 2))
  );
  const unsatByAreaBudget = coverableUnionAreaMm2 + epsMm2 < zoneArea;
  const strictFullCoverageOk = !!(strictInfo && strictInfo.fullCoverageOk === true);
  const satButSolverFailed = !!strictCoverageEffective && !strictFullCoverageOk && !unsatByAreaBudget;
  return {
    zoneAreaMm2: Math.round(zoneArea * 1000) / 1000,
    candidateAreaBudgetMm2: Math.round(candidateAreaBudgetMm2 * 1000) / 1000,
    coverableUnionAreaMm2: Math.round(coverableUnionAreaMm2 * 1000) / 1000,
    coverableUnionRatio: Math.round(coverableUnionRatio * 1e6) / 1e6,
    selectedPiecesAreaMm2: Math.round(selectedPiecesAreaMm2 * 1000) / 1000,
    usefulAreaMm2: Math.round(usefulAreaMm2 * 1000) / 1000,
    selectedInZoneAreaMm2: Math.round(selectedInZoneAreaMm2 * 1000) / 1000,
    overlapAreaMm2: Math.round(overlapAreaMm2 * 1000) / 1000,
    outsideAreaMm2: Math.round(outsideAreaMm2 * 1000) / 1000,
    outsideShareOfSelectedPct: selectedPiecesAreaMm2 > 1e-9
      ? Math.round((outsideAreaMm2 / selectedPiecesAreaMm2) * 100000) / 1000
      : 0,
    meanLocalUtilizationPct: Math.round(meanLocalUtil * 100000) / 1000,
    medianLocalUtilizationPct: Math.round(medianLocalUtil * 100000) / 1000,
    residualAreaMm2: Math.round(residualAreaMm2 * 1000) / 1000,
    unsatByAreaBudget,
    satButSolverFailed
  };
}

module.exports = {
  buildScrapUsage,
  strictValidateCoverageByClipper,
  computeScenarioADiagnostics
};
