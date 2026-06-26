// FurLab Reports module
// Exposes window.FurLabReports — call init(ctx) once after state is ready.
(function (global) {
  const REPORT_MIN_FRAGMENT_AREA_MM2 = 50;
  const DEFAULT_NAP_DEG = 90;

  let _state = null;
  let _getSelectedLayoutEntry = null;
  let _reportsState = { model: null, selectedDetailId: null };

  // ---------------------------------------------------------------------------
  // Pure helpers
  // ---------------------------------------------------------------------------

  function byId(id) { return document.getElementById(id); }

  function escapeHtml(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function escapeCsv(value) {
    const s = String(value == null ? "" : value);
    if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function napSymbolByDeg(deg) {
    const d = (((Number(deg) || 0) % 360) + 360) % 360;
    if (d >= 337.5 || d < 22.5) return "→";
    if (d < 67.5)  return "↘";
    if (d < 112.5) return "↓";
    if (d < 157.5) return "↙";
    if (d < 202.5) return "←";
    if (d < 247.5) return "↖";
    if (d < 292.5) return "↑";
    return "↗";
  }

  function finiteNumOrNaN(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }

  function polygonArea(pts) {
    if (!Array.isArray(pts) || pts.length < 3) return 0;
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      s += (a.x * b.y - b.x * a.y);
    }
    return Math.abs(s) * 0.5;
  }

  function centroid(pts) {
    if (!Array.isArray(pts) || pts.length === 0) return { x: 0, y: 0 };
    let x = 0, y = 0;
    for (const p of pts) { x += p.x; y += p.y; }
    return { x: x / pts.length, y: y / pts.length };
  }

  function normalizeContourArray(raw) {
    if (!raw) return null;
    const pts = [];
    const push = (x, y) => {
      const xn = Number(x), yn = Number(y);
      if (Number.isFinite(xn) && Number.isFinite(yn)) pts.push({ x: xn, y: yn });
    };
    const walk = (node) => {
      if (!node) return;
      if (Array.isArray(node)) {
        if (node.length >= 2 && Number.isFinite(Number(node[0])) && Number.isFinite(Number(node[1]))) { push(node[0], node[1]); return; }
        for (const child of node) walk(child);
        return;
      }
      if (typeof node === "object" && node.x !== undefined) push(node.x, node.y);
    };
    walk(raw);
    return pts.length >= 3 ? pts : null;
  }

  // ---------------------------------------------------------------------------
  // Domain helpers
  // ---------------------------------------------------------------------------

  function deriveReportNapDeg(pl) {
    if (!pl || typeof pl !== "object") return DEFAULT_NAP_DEG;
    const base = Number.isFinite(finiteNumOrNaN(pl.napDirectionDeg))
      ? Number(pl.napDirectionDeg)
      : Number.isFinite(finiteNumOrNaN(pl.candidate?.napDirectionDeg))
        ? Number(pl.candidate.napDirectionDeg)
        : DEFAULT_NAP_DEG;
    const rot = Number.isFinite(finiteNumOrNaN(pl.alignRotationDeg))
      ? Number(pl.alignRotationDeg)
      : Number.isFinite(finiteNumOrNaN(pl.rotationDeg))
        ? Number(pl.rotationDeg)
        : Number.isFinite(finiteNumOrNaN(pl.rotation)) ? Number(pl.rotation) : 0;
    const eff = Number.isFinite(finiteNumOrNaN(pl.napEffectiveDeg))
      ? Number(pl.napEffectiveDeg)
      : (base + rot);
    return ((eff % 360) + 360) % 360;
  }

  function isInventoryMode(mode) {
    const m = String(mode || "").trim().toLowerCase();
    return m === "inventory_manual" || m === "inventory_direct" || m === "inventory_split_return" || m === "inventory_voronoi_sa" || m === "inventory_nfp_sa";
  }

  function getLayoutSnapshotForEntry(entry) {
    const state = _state;
    const e = entry && typeof entry === "object" ? entry : null;
    if (!e) return null;
    if (Number(state.selectedLayoutId || 0) === Number(e.id || 0) && state.layoutRun) {
      return {
        selectedZoneId: Number(e.boundZoneId || state.layoutRun.selectedZoneId || state.selectedZoneId || 0) || null,
        selectedDetailId: Number(e.boundDetailId || state.selectedDetailId || 0) || null,
        layoutRun: state.layoutRun
      };
    }
    if (e.runtimeSnapshot?.layoutRun) return e.runtimeSnapshot;
    return null;
  }

  function findPlacementInSnapshot(snapshot, frag) {
    const placements = Array.isArray(snapshot?.layoutRun?.placements) ? snapshot.layoutRun.placements : [];
    const fragments = Array.isArray(snapshot?.layoutRun?.fragments) ? snapshot.layoutRun.fragments : [];
    const f = (frag && typeof frag === "object") ? frag : fragments.find((x) => Number(x?.id || 0) === Number(frag || 0));
    if (!f) return null;
    const opi = Number(f.ownerPlacementIndex);
    if (Number.isFinite(opi) && opi >= 0 && opi < placements.length) return placements[opi] || null;
    const opid = Number(f.ownerPlacementId || 0);
    if (opid) return placements.find((p) => Number(p?.fragmentId || 0) === opid) || null;
    return placements.find((p) => Number(p?.fragmentId || 0) === Number(f.id || 0)) || null;
  }

  // ---------------------------------------------------------------------------
  // Model
  // ---------------------------------------------------------------------------

  function canOpenReports() {
    const state = _state;
    const layouts = Array.isArray(state?.layouts) ? state.layouts : [];
    for (const entry of layouts) {
      const snap = getLayoutSnapshotForEntry(entry);
      const frags = Array.isArray(snap?.layoutRun?.fragments) ? snap.layoutRun.fragments : [];
      const pls = Array.isArray(snap?.layoutRun?.placements) ? snap.layoutRun.placements : [];
      if (frags.length > 0 || pls.some((p) => String(p?.status || "") === "matched")) return true;
    }
    const frags = Array.isArray(state?.layoutRun?.fragments) ? state.layoutRun.fragments : [];
    const pls = Array.isArray(state?.layoutRun?.placements) ? state.layoutRun.placements : [];
    return frags.length > 0 || pls.some((p) => String(p?.status || "") === "matched");
  }

  function buildReportsModel() {
    const state = _state;
    const zones = Array.isArray(state?.zones) ? state.zones : [];
    const zoneById = new Map(zones.map((z) => [Number(z?.id || 0), z]));
    const materialNamesMap = new Map(
      (Array.isArray(state.projectMaterials) ? state.projectMaterials : [])
        .filter((m) => m?.id)
        .map((m) => [String(m.id), String(m.name || m.id)])
    );
    const rows = [];
    let hiddenSmallCount = 0;
    let hiddenSmallAreaMm2 = 0;
    const layouts = Array.isArray(state?.layouts) ? state.layouts : [];
    const selectedLayoutId = Number(state?.selectedLayoutId || 0);

    const rankEntry = (entry, snap, zoneId) => [
      Number(Number(entry?.id || 0) === selectedLayoutId),
      Number(!!(entry?.persistedRunId)),
      Number(entry?.persistedAt || snap?.updatedAt || snap?.layoutRun?.updatedAt || 0),
      Number(entry?.id || 0),
      Number(zoneId || 0)
    ];
    const isRankGreater = (a, b) => {
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const av = Number(a[i] || 0), bv = Number(b[i] || 0);
        if (av > bv) return true;
        if (av < bv) return false;
      }
      return false;
    };

    const latestByZone = new Map();
    for (const entry of layouts) {
      const snap = getLayoutSnapshotForEntry(entry);
      if (!snap?.layoutRun) continue;
      const zoneId = Number(entry?.boundZoneId || snap.selectedZoneId || snap.layoutRun.selectedZoneId || 0) || 0;
      if (!zoneId) continue;
      const rank = rankEntry(entry, snap, zoneId);
      const prev = latestByZone.get(zoneId);
      if (!prev || isRankGreater(rank, prev.rank)) latestByZone.set(zoneId, { entry, snap, rank });
    }

    for (const { entry, snap } of latestByZone.values()) {
      const placements = Array.isArray(snap.layoutRun.placements) ? snap.layoutRun.placements : [];
      const fragments = Array.isArray(snap.layoutRun.fragments) ? snap.layoutRun.fragments : [];
      const boundZoneId = Number(entry?.boundZoneId || snap.selectedZoneId || snap.layoutRun.selectedZoneId || 0) || 0;
      const zone = zoneById.get(boundZoneId) || null;
      const detailId = Number(entry?.boundDetailId || zone?.detailId || snap.selectedDetailId || 0) || 0;
      const layoutMode = String(entry?.mode || snap?.layoutRun?.mode || "").trim();
      const inventoryMode = isInventoryMode(layoutMode);
      const fragmentsSrc = fragments.length
        ? fragments
        : placements.map((p, i) => {
            const pts = normalizeContourArray(p?.inZoneCoreContour) || normalizeContourArray(p?.inZoneContour) || [];
            return pts.length < 3 ? null : { id: i + 1, points: pts, ownerPlacementIndex: i, ownerPlacementId: Number(p?.fragmentId || 0) };
          }).filter(Boolean);

      for (let i = 0; i < fragmentsSrc.length; i++) {
        const frag = fragmentsSrc[i] || {};
        const pl = findPlacementInSnapshot(snap, frag);
        const zoneId = Number(pl?.zoneId || boundZoneId || 0);
        const zoneForRow = zoneById.get(zoneId) || zone || null;
        const detailForRow = Number(zoneForRow?.detailId || detailId || 0) || 0;
        const hasFragCutPoints = Array.isArray(frag.cutPoints) && frag.cutPoints.length >= 3;
        const fragPts = normalizeContourArray(frag.points);
        const pts = (fragPts && fragPts.length >= 3)
          ? fragPts
          : (normalizeContourArray(pl?.inZoneCoreContour) || normalizeContourArray(pl?.inZoneContour) || []);
        if (pts.length < 3) continue;
        const cutPts = inventoryMode
          ? (hasFragCutPoints ? (normalizeContourArray(frag.cutPoints) || pts) : (normalizeContourArray(pl?.inZoneContour) || pts))
          : pts;
        const napDegNorm = deriveReportNapDeg(pl);
        const territoryAreaMm2 = Math.max(0, Number(frag.areaMm2 || polygonArea(pts) || 0));
        if (territoryAreaMm2 > 0 && territoryAreaMm2 < REPORT_MIN_FRAGMENT_AREA_MM2) { hiddenSmallCount++; hiddenSmallAreaMm2 += territoryAreaMm2; continue; }
        let areaMm2, cutAreaMm2;
        if (inventoryMode) {
          const pieceAligned = normalizeContourArray(pl?.alignedContour);
          areaMm2 = (pieceAligned && pieceAligned.length >= 3)
            ? Math.max(0, Math.abs(polygonArea(pieceAligned)))
            : territoryAreaMm2;
          cutAreaMm2 = territoryAreaMm2;
        } else {
          areaMm2 = territoryAreaMm2;
          cutAreaMm2 = Math.max(areaMm2, Math.abs(polygonArea(cutPts) || areaMm2));
          if (cutPts === pts) {
            const allowMm = Number(snap.layoutRun?.allowanceMm || 0);
            if (allowMm > 0) {
              let perim = 0;
              for (let pi = 0; pi < pts.length; pi++) {
                const a = pts[pi], b = pts[(pi + 1) % pts.length];
                perim += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
              }
              cutAreaMm2 = areaMm2 + perim * allowMm + Math.PI * allowMm * allowMm;
            }
          }
        }
        const fragNo = i + 1;
        const pieceMid = inventoryMode ? String(pl?.materialId || "") : "";
        const zoneMid = String(zoneForRow?.materialId || "");
        const mid = pieceMid || zoneMid;
        rows.push({
          index: rows.length + 1,
          detailId: detailForRow, zoneId, zoneName: String(zoneForRow?.name || zoneId), layoutMode,
          fragmentNo: fragNo,
          fragmentCode: `${detailForRow}-${zoneId}-${fragNo}`,
          materialName: mid ? (materialNamesMap.get(mid) || mid) : "-",
          napSymbol: napSymbolByDeg(napDegNorm),
          napLabel: `${napSymbolByDeg(napDegNorm)} ${Math.round(napDegNorm)}°`,
          napDeg: Math.round(napDegNorm),
          qty: 1, areaMm2, cutAreaMm2,
          inventoryTag: inventoryMode ? String(pl?.inventoryTag || pl?.scrapPieceId || pl?.id || "-") : "",
          points: pts, cutPoints: cutPts,
          pieceContour: normalizeContourArray(pl?.alignedContour) || null,
          zonePoints: Array.isArray(zoneForRow?.points) ? zoneForRow.points : []
        });
      }
    }

    const detailIds = [...new Set(rows.map((r) => Number(r.detailId || 0)).filter((n) => n > 0))].sort((a, b) => a - b);
    const selEntry = _getSelectedLayoutEntry ? _getSelectedLayoutEntry() : null;
    const selZoneId = Number(selEntry && String(selEntry.mode || "") === "inventory_manual" && selEntry.boundZoneId
      || state?.layoutRun?.selectedZoneId || state?.selectedZoneId || 0);
    const selZone = zones.find((z) => Number(z?.id || 0) === selZoneId) || zones[0] || null;
    const selDetailId = Number(selZone?.detailId || detailIds[0] || 1);
    return {
      rows, detailIds,
      selectedDetailId: detailIds.includes(selDetailId) ? selDetailId : (detailIds[0] || null),
      hasAnyInventory: rows.some((r) => String(r?.inventoryTag || "").trim().length > 0),
      hiddenSmallCount, hiddenSmallAreaMm2
    };
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function renderReportsThumb(points, cutPoints, pieceContour) {
    const corePts = Array.isArray(points) ? points : [];
    const cutPts = Array.isArray(cutPoints) && cutPoints.length >= 3 ? cutPoints : corePts;
    const piecePts = Array.isArray(pieceContour) && pieceContour.length >= 3 ? pieceContour : [];
    const allPts = [].concat(piecePts.length >= 3 ? piecePts : cutPts, corePts);
    if (allPts.length < 3) return "-";
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of allPts) {
      const x = Number(p?.x), y = Number(p?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    if (!Number.isFinite(minX)) return "-";
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY), pad = 2, vw = 44, vh = 34;
    const s = Math.min((vw - pad * 2) / w, (vh - pad * 2) / h);
    const pathOf = (pts) => pts.map((p, i) => {
      const x = ((Number(p.x) - minX) * s + pad).toFixed(2);
      const y = ((maxY - Number(p.y)) * s + pad).toFixed(2);
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    }).join(" ") + " Z";
    const piecePath = piecePts.length >= 3 ? `<path d="${pathOf(piecePts)}" fill="none" stroke="#aaa" stroke-width="0.7"/>` : "";
    const cutPath = `<path d="${pathOf(cutPts)}" fill="none" stroke="#555" stroke-width="0.8"/>`;
    const corePath = corePts.length >= 3 ? `<path d="${pathOf(corePts)}" fill="none" stroke="#111" stroke-width="0.9" stroke-dasharray="2,1.5"/>` : "";
    return `<svg class="reports-thumb" viewBox="0 0 44 34" aria-hidden="true">${piecePath}${cutPath}${corePath}</svg>`;
  }

  function buildReportsSchemeSvg(rows, vw, vh) {
    const list = Array.isArray(rows) ? rows : [];
    const first = list[0] || null;
    if (!first || !Array.isArray(first.zonePoints) || first.zonePoints.length < 3) return "";
    const zonePts = normalizeContourArray(first.zonePoints) || [];
    const allPts = zonePts.concat(...list.map((r) => Array.isArray(r.points) ? r.points : []));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of allPts) {
      const x = Number(p?.x), y = Number(p?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    if (!Number.isFinite(minX)) return "";
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY), pad = 12;
    const s = Math.min((vw - pad * 2) / w, (vh - pad * 2) / h);
    const mapPt = (p) => ({ x: (Number(p.x) - minX) * s + pad, y: (maxY - Number(p.y)) * s + pad });
    const pathOf = (pts) => pts.map((p, i) => { const q = mapPt(p); return `${i === 0 ? "M" : "L"}${q.x.toFixed(2)},${q.y.toFixed(2)}`; }).join(" ") + " Z";
    const zonePath = pathOf(zonePts);
    const clipId = `zclip_p_${Math.random().toString(36).slice(2)}`;
    const fragPaths = list.map((r) => {
      const d = pathOf(r.points);
      const cc = mapPt(centroid(r.points));
      return `<path d="${d}" fill="#ececec" stroke="#555" stroke-width="0.7"/><text x="${cc.x.toFixed(2)}" y="${cc.y.toFixed(2)}" font-size="10" text-anchor="middle" dominant-baseline="middle" fill="#111">${r.fragmentNo}</text>`;
    }).join("");
    return `<svg class="reports-scheme-svg" viewBox="0 0 ${vw} ${vh}" style="width:${vw}px;height:${vh}px"><defs><clipPath id="${clipId}"><path d="${zonePath}"/></clipPath></defs><path d="${zonePath}" fill="#f8f8f8" stroke="#111" stroke-width="1.5"/><g clip-path="url(#${clipId})">${fragPaths}</g><path d="${zonePath}" fill="none" stroke="#111" stroke-width="1.5"/></svg>`;
  }

  function renderReportsScheme(rows, detailId) {
    const box = byId("reportsSchemeBox"), title = byId("reportsSchemeTitle"), zone = byId("reportsSchemeZone");
    if (!box || !title || !zone) return;
    const list = Array.isArray(rows) ? rows : [];
    const first = list[0] || null;
    title.textContent = `Деталь: ${detailId || "-"}`;
    zone.textContent = `Зона: ${list.length ? [...new Map(list.map((r) => [r.zoneId, r.zoneName])).values()].join(", ") : "-"}`;
    if (!first || !Array.isArray(first.zonePoints) || first.zonePoints.length < 3) { box.innerHTML = ""; return; }
    box.scrollTop = 0; box.scrollLeft = 0;
    const zonePts = normalizeContourArray(first.zonePoints) || [];
    const allPts = zonePts.concat(...list.map((r) => Array.isArray(r.points) ? r.points : []));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of allPts) {
      const x = Number(p?.x), y = Number(p?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    const boxW = Math.max(260, Number(box.clientWidth || 300)), boxH = Math.max(360, Number(box.clientHeight || 430));
    const vw = Math.max(260, Math.floor(boxW - 2)), vh = Math.max(360, Math.floor(boxH - 2)), pad = 12;
    const s = Math.min((vw - pad * 2) / w, (vh - pad * 2) / h);
    const mapPt = (p) => ({ x: (Number(p.x) - minX) * s + pad, y: (maxY - Number(p.y)) * s + pad });
    const pathOf = (pts) => pts.map((p, i) => { const q = mapPt(p); return `${i === 0 ? "M" : "L"}${q.x.toFixed(2)},${q.y.toFixed(2)}`; }).join(" ") + " Z";
    const zonePath = pathOf(zonePts);
    const clipId = `zclip_${Date.now()}`;
    const fragPaths = list.map((r) => {
      const d = pathOf(r.points);
      const cc = mapPt(centroid(r.points));
      return `<path d="${d}" fill="#ececec" stroke="#555" stroke-width="0.7"/><text x="${cc.x.toFixed(2)}" y="${cc.y.toFixed(2)}" font-size="10" text-anchor="middle" dominant-baseline="middle" fill="#111">${r.fragmentNo}</text>`;
    }).join("");
    box.innerHTML = `<svg class="reports-scheme-svg" viewBox="0 0 ${vw} ${vh}" aria-label="Схема детали"><defs><clipPath id="${clipId}"><path d="${zonePath}"/></clipPath></defs><path d="${zonePath}" fill="#f8f8f8" stroke="#111" stroke-width="1.5"/><g clip-path="url(#${clipId})">${fragPaths}</g><path d="${zonePath}" fill="none" stroke="#111" stroke-width="1.5"/></svg>`;
  }

  // ---------------------------------------------------------------------------
  // View
  // ---------------------------------------------------------------------------

  function renderReportsView(detailId) {
    const model = _reportsState.model;
    if (!model) return;
    const tabsWrap = byId("reportsDetailTabs"), select = byId("reportsDetailSelect");
    const summary = byId("reportsSummary"), detailHeading = byId("reportsDetailHeading");
    const modelTitle = byId("reportsModelTitle"), body = byId("reportsTableBody");
    const inventoryCol = byId("reportsColInventory");
    const currentDetailId = Number(detailId || model.selectedDetailId || model.detailIds[0] || 0);
    _reportsState.selectedDetailId = currentDetailId;
    if (modelTitle) modelTitle.textContent = model.detailIds.length ? `(${model.detailIds.length} деталей)` : "";
    if (tabsWrap) {
      tabsWrap.innerHTML = "";
      for (const id of model.detailIds) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `reports-tab${Number(id) === currentDetailId ? " active" : ""}`;
        btn.textContent = `Деталь ${id}`;
        btn.onclick = () => renderReportsView(id);
        tabsWrap.appendChild(btn);
        if (Number(id) === currentDetailId) requestAnimationFrame(() => btn.scrollIntoView({ block: "nearest", inline: "nearest" }));
      }
    }
    if (select) {
      select.innerHTML = model.detailIds.map((id) => `<option value="${id}" ${Number(id) === currentDetailId ? "selected" : ""}>${id}</option>`).join("");
      select.onchange = () => renderReportsView(Number(select.value || 0));
    }
    const rows = model.rows.filter((r) => Number(r.detailId) === currentDetailId);
    const showInventoryCol = rows.some((r) => String(r?.inventoryTag || "").trim().length > 0);
    const totalArea = rows.reduce((acc, r) => acc + Number(r.areaMm2 || 0), 0);
    const totalCutArea = rows.reduce((acc, r) => acc + Number(r.cutAreaMm2 || r.areaMm2 || 0), 0);
    const zoneNames = [...new Map(rows.map((r) => [r.zoneId, r.zoneName])).values()].join(", ") || "-";
    if (detailHeading) detailHeading.textContent = `Деталь ${currentDetailId || "-"}`;
    if (summary) {
      const hc = Number(model.hiddenSmallCount || 0), ha = Number(model.hiddenSmallAreaMm2 || 0);
      const hiddenPart = hc > 0 ? ` | скрыто мелких: ${hc} (${ha.toFixed(1)} мм²)` : "";
      summary.textContent = `Зон${zoneNames.includes(",") ? "ы" : "а"}: ${zoneNames} | Фрагментов: ${rows.length} | Пл. ядра: ${totalArea.toFixed(1)} мм² | Пл. раскроя: ${totalCutArea.toFixed(1)} мм²${hiddenPart}`;
    }
    if (inventoryCol) inventoryCol.style.display = showInventoryCol ? "" : "none";
    if (body) {
      const grouped = [], seen = new Map();
      for (const r of rows) {
        const k = `${r.materialName}|${r.napDeg}|${Math.round(r.areaMm2 * 10)}`;
        if (seen.has(k)) { const g = seen.get(k); g.qty++; g.allCodes.push(r.fragmentCode); }
        else { const g = { ...r, qty: 1, allCodes: [r.fragmentCode] }; seen.set(k, g); grouped.push(g); }
      }
      body.innerHTML = grouped.map((r) => {
        const codesHtml = r.qty === 1 ? escapeHtml(r.fragmentCode) : r.allCodes.map((c) => escapeHtml(c)).join("<br>");
        return `<tr>
          <td>${renderReportsThumb(r.points, r.cutPoints, r.pieceContour)}</td>
          <td>${escapeHtml(r.napLabel || r.napSymbol || "↓")}</td>
          <td style="line-height:1.5">${codesHtml}</td>
          <td>${escapeHtml(r.materialName || "-")}</td>
          <td>${r.qty}</td>
          <td>${Number(r.areaMm2 || 0).toFixed(1)}</td>
          <td>${Number(r.cutAreaMm2 || r.areaMm2 || 0).toFixed(1)}</td>
          ${showInventoryCol ? `<td>${escapeHtml(r.inventoryTag)}</td>` : ""}
        </tr>`;
      }).join("");
    }
    renderReportsScheme(rows, currentDetailId);
  }

  function renderReportsPrintAll(model) {
    const container = byId("reportsPrintAll");
    if (!container || !model) return;
    const showInventoryCol = model.rows.some((r) => String(r?.inventoryTag || "").trim().length > 0);
    container.innerHTML = model.detailIds.map((detailId) => {
      const rows = model.rows.filter((r) => Number(r.detailId) === detailId);
      if (!rows.length) return "";
      const totalArea = rows.reduce((acc, r) => acc + Number(r.areaMm2 || 0), 0);
      const totalCutArea = rows.reduce((acc, r) => acc + Number(r.cutAreaMm2 || r.areaMm2 || 0), 0);
      const zoneId = [...new Map(rows.map((r) => [r.zoneId, r.zoneName])).values()].join(", ") || "-";
      const grouped = [], seen = new Map();
      for (const r of rows) {
        const k = `${r.materialName}|${r.napDeg}|${Math.round(r.areaMm2 * 10)}`;
        if (seen.has(k)) { const g = seen.get(k); g.qty++; g.allCodes.push(r.fragmentCode); }
        else { const g = { ...r, qty: 1, allCodes: [r.fragmentCode] }; seen.set(k, g); grouped.push(g); }
      }
      const rowsHtml = grouped.map((r) => {
        const codesHtml = r.qty === 1 ? escapeHtml(r.fragmentCode) : r.allCodes.map((c) => escapeHtml(c)).join("<br>");
        return `<tr>
          <td>${renderReportsThumb(r.points, r.cutPoints, r.pieceContour)}</td>
          <td>${escapeHtml(r.napLabel || "↓")}</td>
          <td style="line-height:1.5">${codesHtml}</td>
          <td>${escapeHtml(r.materialName || "-")}</td>
          <td>${r.qty}</td>
          <td>${Number(r.areaMm2 || 0).toFixed(1)}</td>
          <td>${Number(r.cutAreaMm2 || r.areaMm2 || 0).toFixed(1)}</td>
          ${showInventoryCol ? `<td>${escapeHtml(r.inventoryTag)}</td>` : ""}
        </tr>`;
      }).join("");
      const schemeSvg = buildReportsSchemeSvg(rows, 220, 300);
      return `<div class="reports-print-section">
        <div class="reports-print-header">
          <div class="reports-print-header-text">
            <div class="reports-detail-heading">Деталь ${detailId}</div>
            <div class="reports-summary">Зона: ${zoneId} | Фрагментов: ${rows.length} | Пл. ядра: ${totalArea.toFixed(1)} мм² | Пл. раскроя: ${totalCutArea.toFixed(1)} мм²</div>
          </div>
          ${schemeSvg ? `<div class="reports-print-scheme">${schemeSvg}</div>` : ""}
        </div>
        <table class="reports-table">
          <thead><tr>
            <th>Рис.</th><th>Направление ворса</th><th>Фрагмент</th><th>Материал меха</th>
            <th>Кол-во, шт</th><th>Пл. ядра, мм²</th><th>Пл. раскроя, мм²</th>
            ${showInventoryCol ? "<th>Инвентарный кусок</th>" : ""}
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
    }).join("");
  }

  function updateReportsButtonState() {
    const btn = byId("reportsBtn");
    if (!btn) return;
    const enabled = canOpenReports();
    btn.disabled = !enabled;
    btn.title = enabled ? "" : "Отчёты доступны после построения выкладки";
  }

  function closeReportsModal() {
    const backdrop = byId("reportsBackdrop");
    if (backdrop) backdrop.style.display = "none";
  }

  function openReportsModal() {
    if (!canOpenReports()) {
      const info = byId("workspaceInfo");
      if (info) info.textContent = "Отчёты доступны только после Применить.";
      return;
    }
    const backdrop = byId("reportsBackdrop");
    try {
      _reportsState.model = buildReportsModel() || { rows: [], detailIds: [], selectedDetailId: null, hasAnyInventory: false, hiddenSmallCount: 0, hiddenSmallAreaMm2: 0 };
      renderReportsView(_reportsState.model.selectedDetailId || _reportsState.model.detailIds[0] || null);
      renderReportsPrintAll(_reportsState.model);
      if (backdrop) backdrop.style.display = "flex";
    } catch (err) {
      console.error("[reports/open] failed:", err);
      const info = byId("workspaceInfo");
      if (info) info.textContent = `Не удалось открыть отчёт: ${String(err?.message || err || "неизвестная ошибка")}`;
      if (backdrop) backdrop.style.display = "none";
      return;
    }
    const exportBtn = byId("reportsExportCsvBtn");
    if (exportBtn) {
      exportBtn.onclick = () => {
        const model = _reportsState.model;
        const selected = Number(_reportsState.selectedDetailId || 0);
        const rows = model && Array.isArray(model.rows)
          ? model.rows.filter((r) => !selected || Number(r.detailId) === selected)
          : [];
        const showInventoryCol = rows.some((r) => String(r?.inventoryTag || "").trim().length > 0);
        const csvGrouped = [], csvSeen = new Map();
        for (const r of rows) {
          const k = `${r.materialName}|${r.napDeg}|${Math.round(r.areaMm2 * 10)}`;
          if (csvSeen.has(k)) { const g = csvSeen.get(k); g.qty++; g.allCodes.push(r.fragmentCode); }
          else { const g = { ...r, qty: 1, allCodes: [r.fragmentCode] }; csvSeen.set(k, g); csvGrouped.push(g); }
        }
        const lines = [
          showInventoryCol
            ? "Деталь;Зона;Фрагмент;Материал;Кол-во;Пл.ядра мм²;Пл.раскроя мм²;Инвентарный кусок;Направление ворса °"
            : "Деталь;Зона;Фрагмент;Материал;Кол-во;Пл.ядра мм²;Пл.раскроя мм²;Направление ворса °",
          ...csvGrouped.map((r) => [
            escapeCsv(r.detailId), escapeCsv(r.zoneId),
            escapeCsv(Array.isArray(r.allCodes) ? r.allCodes.join(", ") : r.fragmentCode),
            escapeCsv(r.materialName || "-"), escapeCsv(r.qty),
            escapeCsv(Number(r.areaMm2 || 0).toFixed(1)),
            escapeCsv(Number(r.cutAreaMm2 || r.areaMm2 || 0).toFixed(1)),
            ...(showInventoryCol ? [escapeCsv(r.inventoryTag)] : []),
            escapeCsv(r.napDeg),
          ].join(";"))
        ];
        const blob = new Blob([`﻿${lines.join("\n")}`], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `furlab_report_${Date.now()}.csv`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
      };
    }
    const printBtn = byId("reportsPrintBtn");
    if (printBtn) printBtn.onclick = () => window.print();
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  function init(ctx) {
    _state = ctx.state;
    _getSelectedLayoutEntry = ctx.getSelectedLayoutEntry || null;
    if (ctx.reportsState) _reportsState = ctx.reportsState;
  }

  global.FurLabReports = {
    init,
    canOpenReports,
    buildReportsModel,
    openReportsModal,
    closeReportsModal,
    updateReportsButtonState,
    renderReportsPrintAll,
    renderReportsView,
    getReportsState: () => _reportsState,
  };
})(window);
