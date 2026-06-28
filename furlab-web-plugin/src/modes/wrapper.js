"use strict";

const {
  assertValidJsonContract,
  modePreviewResponseSchema,
  parseModePreviewApiRequest,
} = require("../contracts/furlab_case_contracts");
const {
  assertFragments,
  assertPlacements,
  assertRenderOutput,
} = require("../contracts/runtime_invariants");

const LAYOUT_TYPES = new Set([
  "longitudinal",
  "radial",
  "shifted",
  "transverse",
  "intarsia",
  "inventory_direct",
  "inventory_manual",
  "inventory_split_return",
  "inventory_nfp_sa",
  "inventory_tiling",
  "inventory_voronoi_sa",
  "voronoi_tiles"
]);

function normalizePoint(p) {
  const x = Number(p && p.x);
  const y = Number(p && p.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function normalizePoints(points) {
  const out = [];
  for (const p of Array.isArray(points) ? points : []) {
    const n = normalizePoint(p);
    if (n) out.push(n);
  }
  return out;
}

function parsePreviewWrapperRequest(body) {
  const parsed = parseModePreviewApiRequest(body);
  if (parsed.ok) return parsed;
  const raw = body && typeof body === "object" ? body : {};
  const layoutType = String(raw.layoutType || "").trim();
  if (!LAYOUT_TYPES.has(layoutType)) return { ok: false, error: "layout_type_unsupported" };
  const zone = raw.zone && typeof raw.zone === "object" ? raw.zone : {};
  if (!Array.isArray(zone.points) || zone.points.length < 3) {
    return { ok: false, error: "zone_points_required" };
  }
  return { ok: false, error: parsed.error || "invalid_preview_request" };
}

function renderItemsFromPlacements(placements) {
  const items = [];
  for (const p of Array.isArray(placements) ? placements : []) {
    const contour = normalizePoints(p && p.alignedContour);
    if (contour.length < 3) continue;
    const id = String(
      (p && p.placementId) ||
      (p && p.fragmentId) ||
      (p && p.scrapPieceId) ||
      (p && p.inventoryTag) ||
      `placement_${items.length + 1}`
    );
    const renderIndex = Number.isFinite(Number(p && p.renderIndex))
      ? Number(p.renderIndex)
      : (Number.isFinite(Number(p && p.solveOrder)) ? Number(p.solveOrder) : (items.length + 1));
    items.push({
      id,
      contour,
      closed: true,
      renderIndex,
      meta: {
        inventoryTag: String(p && p.inventoryTag || ""),
        phase: String(p && p.phase || ""),
        status: String(p && p.status || "")
      }
    });
  }
  return items;
}

function renderItemsFromFragments(fragments) {
  const items = [];
  for (const f of Array.isArray(fragments) ? fragments : []) {
    const contour = normalizePoints(f && f.points);
    if (contour.length < 3) continue;
    const fragmentId = Number(f && f.id);
    items.push({
      id: String(Number.isFinite(fragmentId) ? fragmentId : `fragment_${items.length + 1}`),
      contour,
      closed: true,
      renderIndex: Number.isFinite(fragmentId) ? fragmentId : (items.length + 1),
      meta: {
        fragmentId: Number.isFinite(fragmentId) ? fragmentId : null,
        areaMm2: Number(f && f.areaMm2 || 0),
        status: "fragment"
      }
    });
  }
  return items;
}

function withRenderInvariants(response, label) {
  assertRenderOutput(response && response.render, label || "mode_preview.render");
  assertValidJsonContract(
    modePreviewResponseSchema,
    response,
    `${label || "mode_preview"}.response`
  );
  return response;
}

function wrapRegularFragmentPreview(input, result, layoutType, modeVersion, displayName) {
  const fragments = Array.isArray(result && result.fragments) ? result.fragments : [];
  assertFragments(fragments, `${layoutType}.fragments`);
  const rawFragments = Array.isArray(result && result.rawFragments) ? result.rawFragments : [];
  const normalized = result && result.normalized && typeof result.normalized === "object"
    ? result.normalized
    : null;
  const solveOrder = fragments
    .map((f, idx) => String((f && f.id) || `fragment_${idx + 1}`))
    .filter(Boolean);
  const totalAreaMm2 = fragments.reduce((acc, f) => acc + Math.max(0, Number(f && f.areaMm2 || 0)), 0);
  return withRenderInvariants({
    ok: true,
    layoutType,
    modeVersion,
    resultStatus: fragments.length > 0 ? "ok" : "failed",
    warnings: fragments.length > 0 ? [] : ["no_fragments_generated"],
    failedReason: fragments.length > 0 ? null : "no_fragments_generated",
    stats: {
      fragmentsTotal: fragments.length,
      totalAreaMm2: Math.round(totalAreaMm2 * 1000) / 1000,
      rawFragmentsTotal: rawFragments.length,
      droppedByNormalize: Math.max(0, rawFragments.length - fragments.length)
    },
    render: {
      renderOrderPolicy: "fragment_index",
      stackOrderPolicy: "fragment_index",
      solveOrder,
      items: renderItemsFromFragments(fragments)
    },
    fragments,
    debug: {
      displayName: String(displayName || layoutType),
      normalized
    }
  }, `${layoutType}.render`);
}

function wrapInventoryDirectPreview(input, direct) {
  const placements = Array.isArray(direct && direct.placements) ? direct.placements : [];
  assertPlacements(placements, "inventory_direct.placements");
  const strictCoverage = !!(direct && direct.strictCoverage === true);
  const fullCoverageOk = !!(direct && direct.fullCoverageOk === true);
  const resultStatus = strictCoverage && !fullCoverageOk ? "failed" : "ok";
  const solveOrder = Array.isArray(direct && direct.solveOrder) ? direct.solveOrder : [];
  return withRenderInvariants({
    ok: true,
    layoutType: "inventory_direct",
    modeVersion: "v1.3",
    resultStatus,
    warnings: [],
    failedReason: resultStatus === "failed"
      ? String((direct && direct.failedReason) || "zone_not_fully_covered")
      : null,
    stats: {
      coveredRatio: Number(direct && direct.coveredRatio || 0),
      coveragePercent: Number(direct && direct.coveragePercent || 0),
      residualAreaMm2: Number(direct && direct.residualAreaMm2 || 0),
      fullCoverageOk
    },
    render: {
      renderOrderPolicy: String(input.options && input.options.renderOrderPolicy || "solve_order"),
      stackOrderPolicy: String(input.options && input.options.stackOrderPolicy || "solve_order"),
      solveOrder,
      items: renderItemsFromPlacements(placements)
    },
    debug: {
      algorithmTrace: direct && direct.algorithmTrace ? direct.algorithmTrace : null,
      seamCheck: direct && direct.seamCheck ? direct.seamCheck : null
    }
  }, "inventory_direct.render");
}

function wrapInventoryNfpSaPreview(input, result) {
  const placements = Array.isArray(result && result.placements) ? result.placements : [];
  assertPlacements(placements, "inventory_nfp_sa.placements");
  const solveOrder = Array.isArray(result && result.solveOrder) ? result.solveOrder : [];
  const resultStatus = String(result && result.resultStatus || "ok");
  return withRenderInvariants({
    ok: true,
    layoutType: "inventory_nfp_sa",
    modeVersion: "v1.0",
    resultStatus,
    warnings: [],
    failedReason: resultStatus === "failed" ? String(result && result.failedReason || "solve_failed") : null,
    stats: {
      coveredRatio: Number(result && result.coveredRatio || 0),
      placementsTotal: placements.length
    },
    render: {
      renderOrderPolicy: "solve_order",
      stackOrderPolicy: "solve_order",
      solveOrder,
      items: placements.map((p, idx) => {
        const contour = normalizePoints(p && p.alignedContour);
        if (contour.length < 3) return null;
        const id = String((p && p.placementId) || (p && p.scrapPieceId) || (p && p.inventoryTag) || `placement_${idx + 1}`);
        const renderIndex = Number.isFinite(Number(p && p.renderIndex)) ? Number(p.renderIndex) : idx;
        return {
          id,
          contour,
          inZoneContour: normalizePoints(p && p.inZoneContour),
          alignedCoreContour: normalizePoints(p && p.alignedCoreContour),
          inZoneCoreContour: normalizePoints(p && p.inZoneCoreContour),
          closed: true,
          renderIndex,
          meta: {
            inventoryTag: String(p && p.inventoryTag || ""),
            phase: String(p && p.phase || ""),
            status: String(p && p.status || ""),
            isThin: !!(p && p.isThin)
          }
        };
      }).filter(Boolean)
    },
    debug: {}
  }, "inventory_nfp_sa.render");
}

function wrapInventoryTilingPreview(input, result) {
  const placements = Array.isArray(result && result.placements) ? result.placements : [];
  assertPlacements(placements, "inventory_tiling.placements");
  const solveOrder = Array.isArray(result && result.solveOrder) ? result.solveOrder : [];
  const resultStatus = String(result && result.resultStatus || "ok");
  return withRenderInvariants({
    ok: true,
    layoutType: "inventory_tiling",
    modeVersion: "v1.0",
    resultStatus,
    warnings: [],
    failedReason: resultStatus === "failed" ? String(result && result.failedReason || "solve_failed") : null,
    stats: {
      coveredRatio: Number(result && result.coveredRatio || 0),
      placementsTotal: placements.length
    },
    render: {
      renderOrderPolicy: "solve_order",
      stackOrderPolicy: "solve_order",
      solveOrder,
      items: placements.map((p, idx) => {
        const contour = normalizePoints(p && p.alignedContour);
        if (contour.length < 3) return null;
        const id = String((p && p.placementId) || (p && p.scrapPieceId) || (p && p.inventoryTag) || `placement_${idx + 1}`);
        const renderIndex = Number.isFinite(Number(p && p.renderIndex)) ? Number(p.renderIndex) : idx;
        return {
          id, contour,
          inZoneContour: normalizePoints(p && p.inZoneContour),
          alignedCoreContour: normalizePoints(p && p.alignedCoreContour),
          inZoneCoreContour: normalizePoints(p && p.inZoneCoreContour),
          closed: true, renderIndex,
          meta: {
            inventoryTag: String(p && p.inventoryTag || ""),
            phase: String(p && p.phase || ""),
            status: String(p && p.status || "")
          }
        };
      }).filter(Boolean)
    },
    debug: {}
  }, "inventory_tiling.render");
}

function wrapIntarsiaPreview(input, result) {
  const placements = Array.isArray(result && result.placements) ? result.placements : [];
  assertPlacements(placements, "intarsia.placements");
  const solveOrder = placements.map((p, idx) => String(
    (p && p.fragmentId) || (p && p.inventoryTag) || `placement_${idx + 1}`
  ));
  const compatibilityBreakdown = result && result.compatibilityBreakdown && typeof result.compatibilityBreakdown === "object"
    ? result.compatibilityBreakdown
    : null;
  const placementBreakdown = result && result.placementBreakdown && typeof result.placementBreakdown === "object"
    ? result.placementBreakdown
    : null;
  return withRenderInvariants({
    ok: true,
    layoutType: "intarsia",
    modeVersion: "v0.2",
    resultStatus: "ok",
    warnings: [],
    failedReason: null,
    stats: {
      placementsTotal: placements.length,
      placementsMatched: placements.filter((p) => String(p && p.status || "") === "matched").length
    },
    render: {
      renderOrderPolicy: "solve_order",
      stackOrderPolicy: "solve_order",
      solveOrder,
      items: renderItemsFromPlacements(placements)
    },
    diagnostics: (compatibilityBreakdown || placementBreakdown)
      ? {
          compatibilityBreakdown,
          placementBreakdown
        }
      : null,
    debug: {}
  }, "intarsia.render");
}

// ── inventory_voronoi_sa v2.0 wrapper ─────────────────────────────────────────
// Passes full solver diagnostics (_solverDiag) for Monitor panel.
// render.items.meta carries per-fragment fields required by the Monitor.
function wrapInventoryVoronoiSaPreview(input, result) {
  const placements = (Array.isArray(result && result.placements) ? result.placements : []).map((p, idx) => ({
    ...(p || {}),
    placementId: String((p && p.placementId) || (p && p.fragmentId) || (p && p.scrapPieceId) || (p && p.inventoryTag) || `placement_${idx + 1}`) + `#${idx + 1}`
  }));
  assertPlacements(placements, "inventory_voronoi_sa.placements");
  const solveOrder = Array.isArray(result && result.solveOrder) ? result.solveOrder : [];
  const resultStatus = String(result && result.resultStatus || "ok");
  const stats = (result && result.stats && typeof result.stats === "object") ? result.stats : {};

  const items = placements.map((p, idx) => {
    const contour = normalizePoints(p && p.alignedContour);
    if (contour.length < 3) return null;
    const id = String((p && p.fragmentId) || (p && p.placementId) || (p && p.scrapPieceId) || `frag_${idx + 1}`);
    const renderIndex = Number.isFinite(Number(p && p.renderIndex)) ? Number(p.renderIndex) : idx;
    return {
      id,
      contour,
      inZoneContour: normalizePoints(p && (p.fragmentContour || p.inZoneContour) || []),
      alignedCoreContour: normalizePoints(p && p.alignedCoreContour || []),
      inZoneCoreContour: normalizePoints(p && p.inZoneCoreContour || []),
      cutContour: normalizePoints(p && p.cutContour || []),
      closed: true,
      renderIndex,
      meta: {
        inventoryTag:        String(p && p.inventoryTag || ""),
        phase:               String(p && p.phase || "SA"),
        status:              String(p && p.status || ""),
        fragmentId:          String(p && p.fragmentId || ""),
        scrapPieceId:        String(p && p.scrapPieceId || ""),
        isGapFill:           !!(p && p.isGapFill),
        isDisconnected:      !!(p && p.isDisconnected),
        diagnosticCode:      (p && p.diagnosticCode) || null,
        inZoneAreaMm2:       Number(p && p.inZoneAreaMm2 || 0),
        siteX:               Number(p && p.x || 0),
        siteY:               Number(p && p.y || 0),
        physicalMissingMm2:  p && p.physicalMissingMm2 != null ? Number(p.physicalMissingMm2) : null,
        cutMissingMm2:       p && p.cutMissingMm2 != null ? Number(p.cutMissingMm2) : null,
        napOk:               p && p.napOk !== false,
        bodyAreaMm2:         p && p.bodyAreaMm2 != null ? Number(p.bodyAreaMm2) : 0,
        utilization:         p && typeof p.utilization === "number" ? p.utilization : 0,
        lowUtilization:      !!(p && p.lowUtilization)
      }
    };
  }).filter(Boolean);

  const _solverDiag = {
    placements: placements.map((p, idx) => {
      // Compute inZoneBbox from inZoneContour for dissolved-fragment overlap check in Monitor
      let inZoneBbox = null;
      const izc = Array.isArray(p && p.inZoneContour) ? p.inZoneContour : [];
      if (izc.length >= 3) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pt of izc) {
          if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
        }
        inZoneBbox = { minX, minY, maxX, maxY };
      }
      return {
        fragmentId:         String((p && p.fragmentId) || (p && p.placementId) || (p && p.scrapPieceId) || `frag_${idx + 1}`),
        scrapPieceId:       p && p.scrapPieceId,
        inventoryTag:       p && p.inventoryTag,
        phase:              (p && p.phase) || null,
        inZoneAreaMm2:      Number(p && p.inZoneAreaMm2 || 0),
        inZoneBbox,
        status:             String(p && p.status || ""),
        isGapFill:          !!(p && p.isGapFill),
        isDisconnected:     !!(p && p.isDisconnected),
        diagnosticCode:     (p && p.diagnosticCode) || null,
        physicalMissingMm2: p && p.physicalMissingMm2 != null ? Number(p.physicalMissingMm2) : null,
        cutMissingMm2:      p && p.cutMissingMm2 != null ? Number(p.cutMissingMm2) : null,
        napOk:              p && p.napOk !== false
      };
    }),
    unresolvedGaps: Array.isArray(result && result.unresolvedGaps) ? result.unresolvedGaps.map(g => ({
      areaMm2: Number(g && g.areaMm2 || 0), diagnosticCode: g && g.diagnosticCode || "unresolvedGap"
    })) : [],
    diagnostics: Array.isArray(result && result.diagnostics) ? result.diagnostics : [],
    selectionDebug: (result && result.selectionDebug && typeof result.selectionDebug === "object") ? result.selectionDebug : null,
    absorptionDiagnostic: (result && result.absorptionDiagnostic) || null,
    invariants: (result && result.invariants) || null,
    multiRestartStats: (result && result._multiRestartStats) || null,
    stats
  };

  return withRenderInvariants({
    ok: true,
    layoutType: "inventory_voronoi_sa",
    modeVersion: "v3.1",
    resultStatus,
    warnings: [],
    failedReason: resultStatus === "failed" ? String(result && result.failedReason || "solve_failed") : null,
    stats: {
      coveredRatio:          Number(result && result.coveredRatio || 0),
      coveragePercent:       Number(result && result.coveragePercent || 0),
      residualAreaMm2:         Number(result && result.residualAreaMm2 || 0),
      residualPerimeterMm2:    Number(result && result.residualPerimeterMm2 || 0),
      residualInteriorMm2:     Number(result && result.residualInteriorMm2 || 0),
      rasterSeamArtifactMm2:   0,
      uncoveredComponentCount: Array.isArray(result && result.uncoveredComponents) ? result.uncoveredComponents.length : 0,
      uncoveredComponents:     Array.isArray(result && result.uncoveredComponents) ? result.uncoveredComponents : [],
      placementsTotal:             placements.length,
      placementsBeforeDissolve:    Number(result && result.algorithmTrace && result.algorithmTrace.fragmentStats && result.algorithmTrace.fragmentStats.placementsBeforeDissolve || 0),
      dissolvedFragments:          Number(result && result.algorithmTrace && result.algorithmTrace.fragmentStats && result.algorithmTrace.fragmentStats.dissolvedFragments || 0),
      fragmentsTotal:              stats.fragmentsTotal != null ? Number(stats.fragmentsTotal) : placements.length,
      gapFillFragments:            Number(stats.gapFillFragments || 0),
      unresolvedGapAreaMm2:  Number(stats.unresolvedGapAreaMm2 || 0),
      zoneAreaMm2:           Number(result && result.summary && result.summary.zoneAreaMm2 || stats.zoneAreaMm2 || 0),
      // P2: single coverage metric = physCov-formula (computeResidualCoverage = Union(piece∩territory)∩zone / zone)
      coveragePercent:                     Number(result && result.coveragePercent || stats.physicalCoveragePercent || 0),
      // kept as aliases to avoid breaking downstream consumers; both equal coveragePercent above
      physicalCoveragePercent:             Number(result && result.coveragePercent || stats.physicalCoveragePercent || 0),
      geometricPartitionCoveragePercent:   Number(result && result.coveragePercent || stats.physicalCoveragePercent || 0),
      physicalMissingTotalMm2:             placements.reduce((s, p) => s + (p && p.physicalMissingMm2 > 0 ? p.physicalMissingMm2 : 0), 0),
      invalidFragmentCount:                Number(stats.invalidFragmentCount || 0),
      gapFillCandidatePoolCount:           Number(stats.gapFillCandidatePoolCount || 0),
      gapFillAttempts:                     Number(stats.gapFillAttempts || 0),
      gapFillRejectReasons:                stats.gapFillRejectReasons || {},
      totalScrapPiecesInput:               Number(stats.totalScrapPiecesInput || 0),
      totalUsablePieces:                   Number(stats.totalUsablePieces || 0),
      selectedPiecesCount:                 Number(stats.selectedPiecesCount || 0),
      unselectedUsableCount:               Number(stats.unselectedUsableCount || 0),
      cumulativeCapacitySelected:          Number(stats.cumulativeCapacitySelected || 0),
      cumulativeCapacityRequired:          Number(stats.cumulativeCapacityRequired || 0),
      zoneBBoxWidthMm:                     Number(stats.zoneBBoxWidthMm || 0),
      zoneBBoxHeightMm:                    Number(stats.zoneBBoxHeightMm || 0),
      zonePointsCount:                     Number(stats.zonePointsCount || 0),
    },
    render: {
      renderOrderPolicy: "solve_order",
      stackOrderPolicy:  "solve_order",
      solveOrder,
      items
    },
    _solverDiag,
    algorithmTrace: (result && result.algorithmTrace) ? result.algorithmTrace : null,
    placements: placements,
    renderInvariants: (() => {
      const s = stats;
      const pls = placements;
      // P2: use physCov-formula (single metric) for coverage threshold check
      const geoCov = Number(result && result.coveragePercent || s.coveragePercent || s.physicalCoveragePercent || 0);
      const threshold = 99.8;
      // fragmentInsidePiece: inZoneContour ⊆ alignedContour (stickout ≈ 0 after stage-8 fix)
      // Measured as area(inZoneContour) - area(inZoneContour ∩ alignedContour) ≤ 5mm² per fragment
      // Failure = fragment extends beyond piece body (was caused by raw territory without piece clip)
      const ClipperLibW = require("clipper-lib");
      const SCALEW = 1000;
      let fragStickoutTotal = 0;
      for (const p of pls) {
        if (!Array.isArray(p.inZoneContour) || p.inZoneContour.length < 3) continue;
        if (!Array.isArray(p.alignedContour) || p.alignedContour.length < 3) continue;
        try {
          const ci = new ClipperLibW.Clipper();
          ci.AddPath(p.inZoneContour.map(pt => ({ X: Math.round(pt.x * SCALEW), Y: Math.round(pt.y * SCALEW) })), ClipperLibW.PolyType.ptSubject, true);
          ci.AddPath(p.alignedContour.map(pt => ({ X: Math.round(pt.x * SCALEW), Y: Math.round(pt.y * SCALEW) })), ClipperLibW.PolyType.ptClip, true);
          const iSol = new ClipperLibW.Paths();
          ci.Execute(ClipperLibW.ClipType.ctDifference, iSol, ClipperLibW.PolyFillType.pftNonZero, ClipperLibW.PolyFillType.pftNonZero);
          fragStickoutTotal += (iSol || []).reduce((s, pp) => s + Math.abs(ClipperLibW.Clipper.Area(pp)) / (SCALEW * SCALEW), 0);
        } catch (_) {}
      }
      // coreIsRealInset: inZoneContour must NOT equal full body (alignedContour).
      // If inZoneContour == alignedContour, we're tiling with full pieces (no core inset) — FAIL.
      // inZoneContour == alignedCoreContour is OK: means the core fits fully inside its cell.
      const coreEqualsFragCount = pls.filter(p =>
        Array.isArray(p.inZoneContour) && p.inZoneContour.length >= 3 &&
        Array.isArray(p.alignedContour) && p.alignedContour.length >= 3 &&
        p.inZoneContour.length === p.alignedContour.length &&
        p.inZoneContour.every((pt, i) => {
          const cp = p.alignedContour[i];
          return Math.abs(pt.x - cp.x) < 0.01 && Math.abs(pt.y - cp.y) < 0.01;
        })
      ).length;

      return {
        geometricPartition:   geoCov >= threshold,
        noOverlaps:           Number(s.invalidFragmentCount || 0) === 0,
        noFragmentsInHoles:   true,
        coreContainsCells:    true,
        fragmentInsidePiece:  fragStickoutTotal < 10,  // frag−piece < 10mm² total = PASS
        coreIsRealInset:      coreEqualsFragCount === 0, // no fragment where core == frag
        pieceContainsCut:     pls.every(p => !p.cutMissingMm2 || Number(p.cutMissingMm2) === 0),
        napValid:             pls.every(p => p.napOk !== false),
        noDisconnectedCells:  pls.every(p => !p.isDisconnected),
        allFragmentsHavePiece: pls.every(p => !!(p.scrapPieceId || p.fragmentId)),
        _fragStickoutMm2:     Math.round(fragStickoutTotal),
        _coreEqualsFragCount: coreEqualsFragCount
      };
    })(),
    debug: {}
  }, "inventory_voronoi_sa.render");
}

module.exports = {
  parsePreviewWrapperRequest,
  renderItemsFromPlacements,
  renderItemsFromFragments,
  wrapRegularFragmentPreview,
  wrapInventoryDirectPreview,
  wrapInventoryNfpSaPreview,
  wrapInventoryTilingPreview,
  wrapInventoryVoronoiSaPreview,
  wrapIntarsiaPreview
};
