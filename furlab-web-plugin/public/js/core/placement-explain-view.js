// Extracted from app.js (placement rows / coverage / explain blocks)
(function (global) {
  function createPlacementExplainView(deps) {
    const d = deps && typeof deps === "object" ? deps : {};
    const byId = d.byId;
    const state = d.state;
    const polygonArea = d.polygonArea;
    const toBooleanMulti = d.toBooleanMulti;
    const toBooleanMultiFromMultiOuter = d.toBooleanMultiFromMultiOuter;
    const fromBooleanMultiOuter = d.fromBooleanMultiOuter;
    const centroid = d.centroid;
    const rotatePoints = d.rotatePoints;
    const translatePoints = d.translatePoints;
    const parseScrapContourPoints = d.parseScrapContourPoints;
    const findPlacementForFragment = d.findPlacementForFragment;
    const isManualInventoryMode = d.isManualInventoryMode;
    const DEFAULT_NAP_DIRECTION_DEG = d.DEFAULT_NAP_DIRECTION_DEG;

function renderPlacementRows(rows) {
      const body = byId("invPlacementRows");
      if (!body) return;
      const rawItems = Array.isArray(rows) ? rows : [];
      const fragmentList = Array.isArray(state.layoutRun && state.layoutRun.fragments) ? state.layoutRun.fragments : [];
      const pc = (typeof window !== "undefined" && window.polygonClipping) ? window.polygonClipping : null;
      function normalizeContourArray(raw) {
        const pts = (Array.isArray(raw) ? raw : [])
          .map((q) => ({ x: Number(q && q.x), y: Number(q && q.y) }))
          .filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
        return pts.length >= 3 ? pts : null;
      }
      function toContours(rawSingle, rawMulti) {
        const out = [];
        const single = normalizeContourArray(rawSingle);
        if (single) out.push(single);
        if (Array.isArray(rawMulti)) {
          for (const poly of rawMulti) {
            const pts = normalizeContourArray(poly);
            if (pts) out.push(pts);
          }
        }
        return out;
      }
      function areaOfMulti(mp) {
        const polys = fromBooleanMultiOuter(mp);
        let sum = 0;
        for (const p of polys) sum += Math.max(0, Math.abs(polygonArea(p)));
        return sum;
      }
      function pieceContoursForPlacement(pl, frag) {
        let contours = toContours(pl && pl.inZoneContour, pl && pl.inZoneContours);
        if (!contours.length && Array.isArray(pl && pl.alignedContour) && pl.alignedContour.length >= 3) {
          const aligned = normalizeContourArray(pl.alignedContour);
          if (aligned) contours.push(aligned);
        }
        if (!contours.length) {
          const scrap = parseScrapContourPoints(pl && pl.scrapContour);
          if (scrap.length >= 3 && frag && Array.isArray(frag.points) && frag.points.length >= 3) {
            let syn = normalizeContourArray(scrap) || [];
            if (syn.length >= 3) {
              const srcCenter = centroid(syn);
              const rotDeg = Number(pl && pl.alignRotationDeg);
              if (Number.isFinite(rotDeg) && Math.abs(rotDeg) > 1e-6) {
                syn = rotatePoints(syn, (rotDeg * Math.PI) / 180, srcCenter);
              }
              const fragCenter = centroid(frag.points);
              const synCenter = centroid(syn);
              syn = translatePoints(syn, fragCenter.x - synCenter.x, fragCenter.y - synCenter.y);
              if (syn.length >= 3) contours = [syn];
            }
          }
        }
        return contours;
      }
      const groupedByFragment = new Map();
      for (const row of rawItems) {
        const fid = Number(row && row.fragmentId || 0);
        if (!Number.isFinite(fid) || fid <= 0) continue;
        if (!groupedByFragment.has(fid)) groupedByFragment.set(fid, []);
        groupedByFragment.get(fid).push(row);
      }
      const items = Array.from(groupedByFragment.entries()).map(([fragmentId, list]) => {
        const rowsForFragment = Array.isArray(list) ? list.slice() : [];
        rowsForFragment.sort((a, b) => Number(a && a.fragmentPieceIndex || 0) - Number(b && b.fragmentPieceIndex || 0));
        const first = rowsForFragment[0] || {};
        const matchedRows = rowsForFragment.filter((r) => String(r && r.status || "") === "matched");
        const tags = matchedRows
          .map((r) => String(r && r.inventoryTag || "").trim())
          .filter(Boolean);
        const status = matchedRows.length > 0 ? "matched" : String(first && first.status || "");
        const fitScoreBest = matchedRows.reduce((best, r) => {
          const score = Number(r && r.fitScore);
          return Number.isFinite(score) ? Math.max(best, score) : best;
        }, Number.NEGATIVE_INFINITY);
        return {
          fragmentId,
          rows: rowsForFragment,
          fragmentAreaMm2: Number(first && first.fragmentAreaMm2 || 0),
          inventoryTag: tags.length ? tags.join(" + ") : "-",
          status,
          fitScore: Number.isFinite(fitScoreBest) ? fitScoreBest : Number(first && first.fitScore || 0),
          napDirectionDeg: matchedRows.length === 1
            ? matchedRows[0].napDirectionDeg
            : (matchedRows.length > 1 ? null : first.napDirectionDeg),
          napEffectiveDeg: matchedRows.length === 1
            ? matchedRows[0].napEffectiveDeg
            : (matchedRows.length > 1 ? null : first.napEffectiveDeg),
          alignRotationDeg: matchedRows.length === 1
            ? matchedRows[0].alignRotationDeg
            : (matchedRows.length > 1 ? null : first.alignRotationDeg),
          pieceCount: matchedRows.length,
          reason: String(first && first.reason || "")
        };
      });
      const qualityByFragment = new Map();
      function getQualityRow(r) {
        const fid = Number(r && r.fragmentId || 0);
        if (!Number.isFinite(fid) || fid <= 0) return null;
        if (qualityByFragment.has(fid)) return qualityByFragment.get(fid);
        const frag = fragmentList.find((f) => Number(f && f.id || 0) === fid) || null;
        const fragArea = frag ? Math.max(0, Math.abs(polygonArea(frag.points || []))) : 0;
        const fragmentRows = Array.isArray(r && r.rows) ? r.rows : [r];
        let coverageRatio = fragmentRows.reduce((best, item) => {
          const val = Number(item && item.fragmentCoverageRatio);
          return Number.isFinite(val) ? Math.max(best, val) : best;
        }, Number.NEGATIVE_INFINITY);
        if (!Number.isFinite(coverageRatio)) {
          coverageRatio = Number.isFinite(Number(r && r.fitCoverageRatio)) ? Number(r.fitCoverageRatio) : null;
        }
        if (!(Number.isFinite(coverageRatio) && coverageRatio >= 0) && pc && frag && fragArea > 1e-9) {
          const fragMp = toBooleanMulti(frag.points);
          const pieceContours = fragmentRows.flatMap((row) => pieceContoursForPlacement(row, frag));
          const pieceMp = toBooleanMultiFromMultiOuter(pieceContours);
          if (Array.isArray(fragMp) && fragMp.length && Array.isArray(pieceMp) && pieceMp.length) {
            try {
              const inter = pc.intersection(fragMp, pieceMp) || [];
              const coveredArea = areaOfMulti(inter);
              coverageRatio = coveredArea / fragArea;
            } catch (_) {}
          }
        }
        const insideValues = fragmentRows
          .map((row) => Number(row && row.fitInsidePercent))
          .filter((v) => Number.isFinite(v));
        const insideRatio = insideValues.length
          ? Math.max(0, Math.min(1, (insideValues.reduce((a, v) => a + v, 0) / insideValues.length) / 100))
          : null;
        const outsideRatio = Number.isFinite(insideRatio) ? Math.max(0, 1 - insideRatio) : null;
        const out = {
          fragmentId: fid,
          inventoryTag: String((r && r.inventoryTag) || "-"),
          fragmentCoverageRatio: Number.isFinite(coverageRatio) ? Math.max(0, coverageRatio) : null,
          insideRatio,
          outsideRatio
        };
        qualityByFragment.set(fid, out);
        return out;
      }

      if (!items.length) {
        body.innerHTML = '<tr><td colspan="5" style="font-size:12px; color:#666; text-align:center;">Нет данных</td></tr>';
        if (state.layoutRun) state.layoutRun.selectedPlacementFragmentId = null;
        renderFragmentCoverageQuality([]);
        renderPlacementExplain();
        return;
      }
      const targetNapRaw = state.layoutRun && state.layoutRun.lastConstraints && Number.isFinite(Number(state.layoutRun.lastConstraints.napDirectionDeg))
        ? Number(state.layoutRun.lastConstraints.napDirectionDeg)
        : Number(state.layoutRun.lastNapDirectionDeg || DEFAULT_NAP_DIRECTION_DEG);
      const targetNapDeg = ((targetNapRaw % 360) + 360) % 360;
      const napTolRaw = state.layoutRun && state.layoutRun.lastConstraints && Number.isFinite(Number(state.layoutRun.lastConstraints.napToleranceDeg))
        ? Number(state.layoutRun.lastConstraints.napToleranceDeg)
        : Number((byId("invNapTol") && byId("invNapTol").value) || 15);
      const napTolDeg = Math.max(0, Math.min(180, Number.isFinite(napTolRaw) ? napTolRaw : 3));
      const fragmentIds = items
        .map((r) => Number(r && r.fragmentId || 0))
        .filter((v) => Number.isFinite(v) && v > 0);
      const selectedRaw = Number(state.layoutRun && state.layoutRun.selectedPlacementFragmentId);
      const selectedFragmentId = fragmentIds.includes(selectedRaw) ? selectedRaw : fragmentIds[0];
      if (state.layoutRun) state.layoutRun.selectedPlacementFragmentId = selectedFragmentId;
      body.innerHTML = items.map((r) => {
        const fid = Number(r.fragmentId || 0);
        const isSelected = fid === selectedFragmentId;
        const area = Number(r.fragmentAreaMm2 || 0);
        const areaText = Number.isFinite(area) ? area.toFixed(1) : "-";
        const tag = r.inventoryTag ? String(r.inventoryTag) : "-";
        const score = Number(r.fitScore || 0);
        const statusBase = String(r.status || "");
        const status = score > 0 ? `${statusBase} (${score.toFixed(1)})` : statusBase;
        let napInfo = "-";
        let napOk = null;
        if (Number(r.pieceCount || 0) > 1) {
          napInfo = `${Number(r.pieceCount || 0)} куска`;
        } else {
          const baseNap = Number.isFinite(Number(r.napDirectionDeg)) ? Number(r.napDirectionDeg) : DEFAULT_NAP_DIRECTION_DEG;
          const rotNap = Number.isFinite(Number(r.alignRotationDeg)) ? Number(r.alignRotationDeg) : 0;
          const effNapRaw = Number.isFinite(Number(r.napEffectiveDeg)) ? Number(r.napEffectiveDeg) : (baseNap + rotNap);
          const effNap = ((effNapRaw % 360) + 360) % 360;
          const delta = Math.min(Math.abs(effNap - targetNapDeg), 360 - Math.abs(effNap - targetNapDeg));
          napOk = napTolDeg <= 1e-6 ? (delta <= 1e-6) : (delta <= napTolDeg + 1e-6);
          napInfo = `${effNap.toFixed(1)}° / ${targetNapDeg.toFixed(1)}°; Δ ${delta.toFixed(2)}°; ${napOk ? "OK" : "FAIL"}`;
        }
        const q = getQualityRow(r);
        const covText = q && Number.isFinite(q.fragmentCoverageRatio) ? `${(q.fragmentCoverageRatio * 100).toFixed(1)}%` : "-";
        const inText = q && Number.isFinite(q.insideRatio) ? `${(q.insideRatio * 100).toFixed(1)}%` : "-";
        const outText = q && Number.isFinite(q.outsideRatio) ? `${(q.outsideRatio * 100).toFixed(1)}%` : "-";
        const pieceSuffix = Number(r.pieceCount || 0) > 1 ? ` | pieces=${Number(r.pieceCount || 0)}` : "";
        const statusExt = `${status}${pieceSuffix}${status ? " | " : ""}cov=${covText} in=${inText} out=${outText}`;
        return `<tr data-fragment-id="${fid}" class="${isSelected ? "active" : ""}" style="cursor:pointer;">
          <td style="font-size:12px;">${fid}</td>
          <td style="font-size:12px;">${areaText}</td>
          <td style="font-size:12px;">${tag}</td>
          <td style="font-size:12px; white-space:nowrap; color:${napOk === null ? "#444" : (napOk ? "#0a7d2e" : "#b42318")};">${napInfo}</td>
          <td style="font-size:12px;">${statusExt}</td>
        </tr>`;
      }).join("");
      body.querySelectorAll("tr[data-fragment-id]").forEach((tr) => {
        tr.addEventListener("click", () => {
          const fid = Number(tr.getAttribute("data-fragment-id"));
          if (!Number.isFinite(fid) || fid <= 0) return;
          if (state.layoutRun) state.layoutRun.selectedPlacementFragmentId = fid;
          renderPlacementRows(state.layoutRun && state.layoutRun.placements ? state.layoutRun.placements : []);
        });
      });
      renderFragmentCoverageQuality(Array.from(qualityByFragment.values()));
      renderPlacementExplain();
    }

    function renderFragmentCoverageQuality(rows) {
      const summary = byId("invFragmentCoverageSummary");
      const body = byId("invFragmentCoverageRows");
      if (!summary || !body) return;
      const items = Array.isArray(rows) ? rows.filter(Boolean) : [];
      if (!items.length) {
        summary.textContent = "Нет данных";
        body.innerHTML = '<tr><td colspan="5" style="font-size:12px; color:#666; text-align:center;">Нет данных</td></tr>';
        return;
      }
      const withCoverage = items.filter((x) => Number.isFinite(Number(x.fragmentCoverageRatio)));
      const avgCoverage = withCoverage.length
        ? withCoverage.reduce((a, x) => a + Number(x.fragmentCoverageRatio || 0), 0) / withCoverage.length
        : NaN;
      const worst = items
        .slice()
        .sort((a, b) => {
          const av = Number.isFinite(Number(a.fragmentCoverageRatio)) ? Number(a.fragmentCoverageRatio) : -1;
          const bv = Number.isFinite(Number(b.fragmentCoverageRatio)) ? Number(b.fragmentCoverageRatio) : -1;
          return av - bv;
        })
        .slice(0, 8);
      const avgText = Number.isFinite(avgCoverage) ? `${(avgCoverage * 100).toFixed(1)}%` : "-";
      summary.textContent = `Фрагментов: ${items.length} | среднее coverage: ${avgText} | худшие показаны ниже`;
      body.innerHTML = worst.map((x) => {
        const cov = Number.isFinite(Number(x.fragmentCoverageRatio)) ? `${(Number(x.fragmentCoverageRatio) * 100).toFixed(1)}%` : "-";
        const inside = Number.isFinite(Number(x.insideRatio)) ? `${(Number(x.insideRatio) * 100).toFixed(1)}%` : "-";
        const outside = Number.isFinite(Number(x.outsideRatio)) ? `${(Number(x.outsideRatio) * 100).toFixed(1)}%` : "-";
        const tag = String(x.inventoryTag || "-");
        return `<tr>
          <td style="font-size:12px;">${Number(x.fragmentId || 0)}</td>
          <td style="font-size:12px;">${cov}</td>
          <td style="font-size:12px;">${inside}</td>
          <td style="font-size:12px;">${outside}</td>
          <td style="font-size:12px;">${tag}</td>
        </tr>`;
      }).join("");
    }

    function renderPlacementExplain() {
      const block = byId("invPlacementExplainBlock");
      const summary = byId("invPlacementExplainSummary");
      const rows = byId("invPlacementExplainRows");
      if (!block || !summary || !rows) return;
      const manual = isManualInventoryMode();
      block.style.display = manual ? "none" : "";
      if (manual) return;
      const map = state.layoutRun && state.layoutRun.topChoicesByFragment && typeof state.layoutRun.topChoicesByFragment === "object"
        ? state.layoutRun.topChoicesByFragment
        : {};
      const rowsByFragment = new Map();
      const placementRows = Array.isArray(state.layoutRun && state.layoutRun.placements) ? state.layoutRun.placements : [];
      for (const row of placementRows) {
        const fid = Number(row && row.fragmentId || 0);
        if (!Number.isFinite(fid) || fid <= 0) continue;
        if (!rowsByFragment.has(fid)) rowsByFragment.set(fid, []);
        rowsByFragment.get(fid).push(row);
      }
      const selectedFragmentId = Number(state.layoutRun && state.layoutRun.selectedPlacementFragmentId || 0);
      if (!Number.isFinite(selectedFragmentId) || selectedFragmentId <= 0) {
        summary.textContent = "Выберите строку фрагмента в таблице выше";
        rows.innerHTML = '<tr><td colspan="6" style="font-size:12px; color:#666; text-align:center;">Нет данных</td></tr>';
        return;
      }
      const explain = map[String(selectedFragmentId)];
      const selectedRows = Array.isArray(rowsByFragment.get(selectedFragmentId)) ? rowsByFragment.get(selectedFragmentId) : [];
      const matchedRows = selectedRows.filter((r) => String(r && r.status || "") === "matched");
      if (!explain || typeof explain !== "object") {
        const selectedTags = matchedRows.map((r) => String(r && r.inventoryTag || "").trim()).filter(Boolean);
        const selectedText = selectedTags.length ? selectedTags.join(" + ") : "-";
        summary.textContent = `Фрагмент ${selectedFragmentId}: topChoices не пришли из preview | выбранные куски: ${selectedText}`;
        rows.innerHTML = '<tr><td colspan="6" style="font-size:12px; color:#666; text-align:center;">Нет данных</td></tr>';
        return;
      }
      const selected = explain.selected && typeof explain.selected === "object" ? explain.selected : null;
      const selectedTag = matchedRows.length > 1
        ? matchedRows.map((r) => String(r && r.inventoryTag || r && r.scrapPieceId || "-")).join(" + ")
        : (selected ? String(selected.inventoryTag || selected.scrapPieceId || "-") : "-");
      const selectedScore = selected ? Number(selected.score || 0).toFixed(3) : "-";
      const decision = String(explain.decision || "unknown");
      const cls = String(explain.fragmentClass || "-");
      const breakdown = selected && selected.scoreBreakdown && typeof selected.scoreBreakdown === "object"
        ? selected.scoreBreakdown
        : null;
      const reason = breakdown
        ? `sample=${Number(breakdown.sampleCoverage || 0).toFixed(3)} in=${Number(breakdown.insideRatio || 0).toFixed(3)} out=${Number(breakdown.outsideRatio || 0).toFixed(3)} area=${Number(breakdown.areaRatioNorm || 0).toFixed(3)}`
        : "breakdown=none";
      const piecesInfo = matchedRows.length > 1 ? ` | pieces=${matchedRows.length}` : "";
      summary.textContent = `Фрагмент ${selectedFragmentId} (${cls}) | выбор=${selectedTag} | score=${selectedScore} | decision=${decision}${piecesInfo} | ${reason}`;
      const list = Array.isArray(explain.topCandidates) ? explain.topCandidates : [];
      if (!list.length) {
        rows.innerHTML = '<tr><td colspan="6" style="font-size:12px; color:#666; text-align:center;">Нет альтернатив</td></tr>';
        return;
      }
      const selectedId = selected ? String(selected.scrapPieceId || "") : "";
      rows.innerHTML = list.map((c, idx) => {
        const cid = String(c && c.scrapPieceId || "");
        const tag = String(c && c.inventoryTag || cid || "-");
        const isPicked = selectedId && cid === selectedId;
        return `<tr class="${isPicked ? "active" : ""}">
          <td style="font-size:12px;">${idx + 1}</td>
          <td style="font-size:12px;">${tag}${isPicked ? " \u2713" : ""}</td>
          <td style="font-size:12px;">${Number(c && c.score || 0).toFixed(3)}</td>
          <td style="font-size:12px;">${Number(c && c.fitInsidePercent || 0).toFixed(1)}%</td>
          <td style="font-size:12px;">${Number(c && c.outsidePercent || 0).toFixed(1)}%</td>
          <td style="font-size:12px;">${(Number(c && c.fitCoverageRatio || 0) * 100).toFixed(1)}%</td>
        </tr>`;
      }).join("");
    }

    return {
      renderPlacementRows,
      renderFragmentCoverageQuality,
      renderPlacementExplain
    };
  }

  global.FurLabPlacementExplainView = Object.assign({}, global.FurLabPlacementExplainView || {}, {
    createPlacementExplainView
  });
})(window);

