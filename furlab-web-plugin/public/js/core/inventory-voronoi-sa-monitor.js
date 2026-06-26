(function (global) {
  "use strict";

  function createRunOutputExport(args) {
    const state = args && args.state;
    if (!state || !Array.isArray(state.zones) || !state.layoutRun) return null;
    const zone = state.zones.find((z) => Number(z.id) === Number(state.layoutRun.selectedZoneId || 0));
    if (!zone) return null;
    const res = state.layoutRun.lastRawResult;
    const placements = Array.isArray(state.layoutRun.placements) ? state.layoutRun.placements : [];
    if (!res && !placements.length) return null;
    const candidatePool = Array.isArray(state.layoutRun.candidatePool) ? state.layoutRun.candidatePool : [];
    const trace = res && res.algorithmTrace && typeof res.algorithmTrace === "object" ? res.algorithmTrace : null;
    const stats = res && res.stats && typeof res.stats === "object" ? res.stats : (res || {});
    const solverDiag = res && res._solverDiag && typeof res._solverDiag === "object" ? res._solverDiag : {};
    return {
      exportType: "voronoi_sa_run_output",
      name: `voronoi_sa_zone_${zone.id}_run`,
      zone: { id: Number(zone.id), points: zone.points, holes: Array.isArray(zone.holes) ? zone.holes : [] },
      candidates: candidatePool,
      effectiveOptions: (trace && trace.effectiveOptions) || state.layoutRun.effectiveOptions || {},
      placements: placements.map((p) => ({
        inventoryTag: p.inventoryTag || p.scrapPieceId || "",
        phase: p.phase || "",
        isTerritoryPlaceholder: p.isTerritoryPlaceholder || false,
        fragmentType: p.fragmentType || "",
        physicalMissingMm2: p.physicalMissingMm2 || 0,
        inZoneAreaMm2: p.inZoneAreaMm2 || 0,
        bodyAreaMm2: p.bodyAreaMm2 || 0,
        utilization: typeof p.utilization === "number" ? p.utilization : 0,
        lowUtilization: !!p.lowUtilization,
        alignedContour: p.alignedContour || [],
        rawTerritoryContour: p.rawTerritoryContour || [],
        inZoneContour: p.inZoneContour || [],
        alignedCoreContour: p.alignedCoreContour || [],
        inZoneCoreContour: p.inZoneCoreContour || []
      })),
      metrics: res ? {
        ok: res.ok,
        fullCoverageOk: res.fullCoverageOk,
        resultStatus: res.resultStatus,
        failedReason: res.failedReason,
        coveragePercent: stats && stats.coveragePercent,
        coveredRatio: stats && stats.coveredRatio,
        residualInteriorMm2: stats && stats.residualInteriorMm2,
        residualPerimeterMm2: stats && stats.residualPerimeterMm2,
        residualAreaMm2: stats && stats.residualAreaMm2,
        rasterSeamArtifactMm2: stats && stats.rasterSeamArtifactMm2,
        physMissingTotalMm2: stats && stats.physicalMissingTotalMm2,
        uncoveredComponentCount: stats && stats.uncoveredComponentCount
      } : {},
      uncoveredComponents: Array.isArray(stats && stats.uncoveredComponents) ? stats.uncoveredComponents : [],
      absorptionDiagnostic: solverDiag.absorptionDiagnostic || (res && res.absorptionDiagnostic) || null,
      invariants: solverDiag.invariants || (res && res.invariants) || null,
      multiRestartStats: solverDiag.multiRestartStats || (res && res.multiRestartStats) || null,
      algorithmTrace: trace
    };
  }

  function bindExportButton(deps) {
    const exportBtn = document.getElementById("vsaExportRunBtn");
    if (!exportBtn || exportBtn._bound) return;
    const buildRunOutputExport = deps && deps.buildRunOutputExport;
    const downloadJsonFile = deps && deps.downloadJsonFile;
    exportBtn._bound = true;
    exportBtn.onclick = () => {
      const runOut = typeof buildRunOutputExport === "function" ? buildRunOutputExport() : null;
      if (!runOut) {
        alert("Нет данных рана для экспорта");
        return;
      }
      const zoneId = Number(runOut.zone && runOut.zone.id || 0);
      if (typeof downloadJsonFile === "function") {
        downloadJsonFile(`voronoi_sa_run_zone_${zoneId}_${Date.now()}.json`, runOut);
      }
    };
  }

  function updateMonitor(args) {
    const res = args && args.res;
    if (res && typeof res === "object") global.__vsa_lastRes = res;
    const panel = typeof document !== "undefined" && document.getElementById("vsaMonitor");
    if (!panel) return;
    if (!global.__furlab_vsa_overlay) {
      panel.style.display = "none";
      return;
    }
    panel.style.display = "";
    bindExportButton(args);
    const r = global.__vsa_lastRes;
    if (!r || typeof r !== "object") return;

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val != null ? val : "-";
    };
    const s = (r.stats && typeof r.stats === "object") ? r.stats : {};
    const sd = (r._solverDiag && typeof r._solverDiag === "object") ? r._solverDiag : {};
    const sel = (sd.selectionDebug && typeof sd.selectionDebug === "object") ? sd.selectionDebug : {};
    const inv = (r.renderInvariants && typeof r.renderInvariants === "object") ? r.renderInvariants : {};
    const lc = (r.lastConstraints && typeof r.lastConstraints === "object") ? r.lastConstraints : {};
    const at = (r.algorithmTrace && typeof r.algorithmTrace === "object") ? r.algorithmTrace : {};
    const eo = (at.effectiveOptions && typeof at.effectiveOptions === "object") ? at.effectiveOptions : {};

    const badge = document.getElementById("vsa_badge");
    const ok = r.resultStatus === "ok" || r.ok;
    if (badge) {
      badge.textContent = ok ? "OK" : (r.resultStatus || "?");
      badge.style.background = ok ? "#2d7a2d" : "#a00";
      badge.style.color = "#fff";
    }

    // Sliver detection (post-clip, client-side)
    const minW = Number(eo.minWidthMm || lc.minWidthMm || 0);
    const minL = Number(eo.minLengthMm || lc.minLengthMm || 0);
    const diagPls = Array.isArray(sd.placements) ? sd.placements : [];
    const sliverPls = (minW > 0 || minL > 0) ? diagPls.filter(p => {
      const bb = p.inZoneBbox;
      if (!bb) return false;
      const shorter = Math.min(bb.maxX - bb.minX, bb.maxY - bb.minY);
      const longer  = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
      return (minW > 0 && shorter < minW) || (minL > 0 && longer < minL);
    }) : [];
    const sliverMm2 = sliverPls.reduce((acc, p) => acc + (p.inZoneAreaMm2 || 0), 0);
    const totalInZoneMm2 = diagPls.reduce((acc, p) => acc + (p.inZoneAreaMm2 || 0), 0);
    const zoneArea = s.zoneAreaMm2 || 0;
    const effectiveCovPct = zoneArea > 0 ? (totalInZoneMm2 - sliverMm2) / zoneArea * 100 : null;

    set("vsa_resultStatus", r.resultStatus || "-");
    set("vsa_coveragePct", s.coveragePercent != null ? Number(s.coveragePercent).toFixed(3) + "%" : "-");
    set("vsa_effectiveCovPct", effectiveCovPct != null ? effectiveCovPct.toFixed(3) + "%" : (minW > 0 || minL > 0 ? "-" : "n/a (нет min-size)"));
    set("vsa_zoneArea", zoneArea ? Math.round(zoneArea) + " мм2" : "-");
    set("vsa_finalFragments2", s.fragmentsTotal != null ? String(s.fragmentsTotal) : "-");
    set("vsa_slivers", (minW > 0 || minL > 0) ? sliverPls.length + " шт, " + Math.round(sliverMm2) + " мм²" : "n/a");
    set("vsa_gapFill", s.gapFillFragments != null ? String(s.gapFillFragments) : "-");
    set("vsa_physMissing", s.physicalMissingTotalMm2 != null ? Math.round(s.physicalMissingTotalMm2) + " мм2" : "-");
    const ar = lc.allowanceMm != null ? lc.allowanceMm : (r.allowanceMm != null ? r.allowanceMm : null);
    set("vsa_seamReserve", ar != null ? ar + " мм" : "-");
    const nt = lc.napToleranceDeg != null ? lc.napToleranceDeg : (sel.napToleranceDeg != null ? sel.napToleranceDeg : null);
    set("vsa_napTol", nt != null ? nt + " deg" : "-");

    set("vsa_residualInterior", s.residualInteriorMm2 != null ? Math.round(s.residualInteriorMm2) + " мм2" : "-");
    set("vsa_uncoveredCount", s.uncoveredComponentCount != null ? String(s.uncoveredComponentCount) : "-");

    renderResidualTable(s);
    set("vsa_Az", sel.zoneArea != null ? Math.round(sel.zoneArea) + " мм2" : "-");
    set("vsa_Cmed", sel.Cmed != null ? Math.round(sel.Cmed) + " мм2" : "-");
    set("vsa_Nbase", sel.Nbase != null ? String(sel.Nbase) : "-");
    set("vsa_Nstart", sel.Nstart != null ? String(sel.Nstart) : "-");
    set("vsa_overhang", sel.overhangMm != null ? sel.overhangMm + " мм" : "-");
    set("vsa_unselected", s.unselectedUsableCount != null ? String(s.unselectedUsableCount) : "-");
    renderInvariants(inv);
    renderFragmentsTable(sd);
  }

  function renderResidualTable(stats) {
    const residTbl = document.getElementById("vsa_residualTable");
    if (!residTbl) return;
    const comps = Array.isArray(stats.uncoveredComponents) ? stats.uncoveredComponents : [];
    if (!comps.length) {
      residTbl.innerHTML = "";
      return;
    }
    let html = '<table style="width:100%;border-collapse:collapse;"><tr style="opacity:0.6;"><th>#</th><th>мм2</th><th>тип</th><th>bbox WxH мм</th><th>centroid</th></tr>';
    comps.forEach((c, i) => {
      const bb = c.bbox;
      const bboxStr = bb ? Math.round(bb.maxX - bb.minX) + "x" + Math.round(bb.maxY - bb.minY) : "-";
      const cent = c.centroid ? "(" + Math.round(c.centroid.x) + ", " + Math.round(c.centroid.y) + ")" : "-";
      html += `<tr><td>${i + 1}</td><td>${Math.round(c.areaMm2 || 0)}</td><td>растр</td><td>${bboxStr}</td><td>${cent}</td></tr>`;
    });
    residTbl.innerHTML = html + "</table>";
  }

  function renderInvariants(inv) {
    const invEl = document.getElementById("vsa_invariants");
    if (!invEl) return;
    const checks = ["geometricPartition", "noOverlaps", "coreIsRealInset", "napValid"];
    invEl.innerHTML = checks.map((k) => {
      const v = inv[k];
      const pass = v === true || v === "PASS";
      const missing = v == null;
      const txt = missing ? "-" : (pass ? "PASS" : "FAIL");
      const color = missing ? "#555" : (pass ? "#4c4" : "#c44");
      return `<span class="dev-label">${k}</span><span style="color:${color}">${txt}</span>`;
    }).join("");
    const stickout = inv._fragStickoutMm2 != null ? inv._fragStickoutMm2 : null;
    const coreEq = inv._coreEqualsFragCount != null ? inv._coreEqualsFragCount : null;
    if (stickout != null || coreEq != null) {
      invEl.innerHTML += `<span class="dev-label">_stickoutMm2</span><span style="color:${stickout === 0 ? "#4c4" : "#fa4"}">${stickout != null ? stickout : "-"}</span>`;
      invEl.innerHTML += `<span class="dev-label">_coreEqFrag</span><span style="color:${coreEq === 0 ? "#4c4" : "#fa4"}">${coreEq != null ? coreEq : "-"}</span>`;
    }
  }

  function renderFragmentsTable(solverDiag) {
    const fragTbl = document.getElementById("vsa_fragmentsTable");
    if (!fragTbl) return;
    const pls = Array.isArray(solverDiag.placements) ? solverDiag.placements : [];
    if (!pls.length) {
      fragTbl.innerHTML = "";
      return;
    }
    let html = '<table style="width:100%;border-collapse:collapse;font-size:10px;"><tr style="opacity:0.6;"><th>#</th><th>piece</th><th>мм2</th><th>status</th><th>gap</th><th>physMiss</th><th>cutMiss</th><th>nap</th><th>disc</th></tr>';
    pls.forEach((p, i) => {
      const napOk = p.napOk !== false;
      const disc = p.isDisconnected ? "FAIL" : "OK";
      const gap = p.isGapFill ? "yes" : "-";
      const phys = p.physicalMissingMm2 != null && p.physicalMissingMm2 > 0 ? Math.round(p.physicalMissingMm2) : "-";
      const cut = p.cutMissingMm2 != null && p.cutMissingMm2 > 0 ? Math.round(p.cutMissingMm2) : "-";
      html += `<tr><td>${i + 1}</td><td>${p.scrapPieceId || p.fragmentId || "-"}</td><td>${Math.round(p.inZoneAreaMm2 || 0)}</td><td>${p.status || "-"}</td><td>${gap}</td><td>${phys}</td><td>${cut}</td><td style="color:${napOk ? "#4c4" : "#c44"}">${napOk ? "OK" : "FAIL"}</td><td style="color:${p.isDisconnected ? "#c44" : "#4c4"}">${disc}</td></tr>`;
    });
    fragTbl.innerHTML = html + "</table>";
  }

  global.FurLabInventoryVoronoiSaMonitor = {
    createRunOutputExport,
    updateMonitor
  };
})(window);
