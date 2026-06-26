(function registerFurLabDetailZoneTreeView(globalObj) {
  const root = globalObj || (typeof window !== "undefined" ? window : globalThis);

  function createDetailZoneTreeView(deps) {
    const byId = deps && deps.byId;
    const state = deps && deps.state;
    const openLayoutTypePicker = deps && deps.openLayoutTypePicker;
    const applyLayoutMode = deps && deps.applyLayoutMode;
    const getLayoutModeTitle = deps && deps.getLayoutModeTitle;
    const getLayoutModeThumbSvg = deps && deps.getLayoutModeThumbSvg;
    const renderLayoutModeSwitch = deps && deps.renderLayoutModeSwitch;
    const renderPropertyEditor = deps && deps.renderPropertyEditor;
    const renderScene = deps && deps.renderScene;
    const fitBBoxToView = deps && deps.fitBBoxToView;
    const contourThumbSvg = deps && deps.contourThumbSvg;
    const fitPointsToView = deps && deps.fitPointsToView;
    const findPlacementForFragment = deps && deps.findPlacementForFragment;
    const saveLayoutEntry = deps && deps.saveLayoutEntry;
    const openLayoutEntry = deps && deps.openLayoutEntry;
    const selectLayoutEntry = deps && deps.selectLayoutEntry;
    const deleteLayoutEntry = deps && deps.deleteLayoutEntry;
    const openZoneContextMenu = deps && deps.openZoneContextMenu;
    const openMaterialLibrary = deps && deps.openMaterialLibrary;
    const buildMaterialPreviewSvgMarkup = deps && deps.buildMaterialPreviewSvgMarkup;
    const getFurMaterialById = deps && deps.getFurMaterialById;
    const removeProjectMaterialById = deps && deps.removeProjectMaterialById;
    const assignMaterialToZone = deps && deps.assignMaterialToZone;

    function iconSpan(name) {
      const map = {
        chevronRight: "chevron_right",
        chevronDown: "expand_more",
        delete: "delete",
        edit: "edit"
      };
      const glyph = map[name] || "";
      return glyph ? `<span class="material-symbols-outlined" aria-hidden="true">${glyph}</span>` : "";
    }

    function getLayoutSnapshotForTree(entry) {
      const e = entry && typeof entry === "object" ? entry : null;
      if (!e) return null;
      if (Number(state.selectedLayoutId || 0) === Number(e.id || 0) && state.layoutRun && typeof state.layoutRun === "object") {
        return {
          selectedZoneId: Number(e.boundZoneId || state.layoutRun.selectedZoneId || 0) || null,
          selectedDetailId: Number(e.boundDetailId || state.selectedDetailId || 0) || null,
          layoutRun: state.layoutRun
        };
      }
      if (e.runtimeSnapshot && typeof e.runtimeSnapshot === "object" && e.runtimeSnapshot.layoutRun) {
        return e.runtimeSnapshot;
      }
      return null;
    }

    function getSnapshotPlacementForFragment(snapshot, fragmentOrId) {
      const snap = snapshot && typeof snapshot === "object" ? snapshot : null;
      const frag = (fragmentOrId && typeof fragmentOrId === "object")
        ? fragmentOrId
        : (snap && snap.layoutRun && Array.isArray(snap.layoutRun.fragments)
          ? snap.layoutRun.fragments.find((f) => Number(f && f.id || 0) === Number(fragmentOrId || 0))
          : null);
      if (!frag || !snap || !snap.layoutRun || !Array.isArray(snap.layoutRun.placements)) return null;
      const placements = snap.layoutRun.placements;
      const fragId = Number(frag && frag.id || 0);
      const ownerPlacementId = Number(frag && frag.ownerPlacementId || 0);
      if (ownerPlacementId) {
        const byOwner = placements.find((p) => Number(p && p.fragmentId || 0) === ownerPlacementId);
        if (byOwner) return byOwner;
      }
      return placements.find((p) => Number(p && p.fragmentId || 0) === fragId) || null;
    }

    function normalizeContourForTree(raw) {
      if (!raw) return [];
      const out = [];
      const pushPoint = (x, y) => {
        const xn = Number(x);
        const yn = Number(y);
        if (!Number.isFinite(xn) || !Number.isFinite(yn)) return;
        out.push({ x: xn, y: yn });
      };
      const walk = (node) => {
        if (!node) return;
        if (Array.isArray(node)) {
          if (node.length >= 2 && Number.isFinite(Number(node[0])) && Number.isFinite(Number(node[1]))) {
            pushPoint(node[0], node[1]);
            return;
          }
          for (const child of node) walk(child);
          return;
        }
        if (typeof node === "object" && node.x !== undefined && node.y !== undefined) {
          pushPoint(node.x, node.y);
        }
      };
      walk(raw);
      return out.length >= 3 ? out : [];
    }

    function buildFragmentsFromPlacements(snapshot, boundZoneId) {
      const placements = Array.isArray(snapshot && snapshot.layoutRun && snapshot.layoutRun.placements)
        ? snapshot.layoutRun.placements
        : [];
      let nextId = 1;
      return placements
        .map((p, idx) => {
          const placementZoneId = Number(p && p.zoneId || boundZoneId || 0) || 0;
          const pts =
            normalizeContourForTree(p && p.inZoneCoreContour).length >= 3 ? normalizeContourForTree(p && p.inZoneCoreContour)
            : normalizeContourForTree(p && p.inZoneContour).length >= 3 ? normalizeContourForTree(p && p.inZoneContour)
            : normalizeContourForTree(p && p.alignedCoreContour).length >= 3 ? normalizeContourForTree(p && p.alignedCoreContour)
            : normalizeContourForTree(p && p.alignedContour);
          if (!Array.isArray(pts) || pts.length < 3) return null;
          return {
            id: Number(p && p.fragmentId || nextId++),
            points: pts,
            ownerPlacementIndex: idx,
            ownerPlacementId: Number(p && p.fragmentId || 0),
            zoneId: placementZoneId
          };
        })
        .filter(Boolean);
    }

    function collectZoneFragments(zoneId) {
      const zid = Number(zoneId || 0);
      const out = [];
      const layouts = Array.isArray(state.layouts) ? state.layouts : [];
      for (const entry of layouts) {
        const persistedRunId = String(entry && entry.persistedRunId || "").trim();
        const isCurrentlySelected = Number(state.selectedLayoutId || 0) === Number(entry && entry.id || 0);
        if (!persistedRunId && !isCurrentlySelected) continue;
        const snapshot = getLayoutSnapshotForTree(entry);
        if (!snapshot || !snapshot.layoutRun) continue;
        const boundZoneId = Number(
          entry && entry.boundZoneId
          || snapshot.selectedZoneId
          || snapshot.layoutRun.selectedZoneId
          || 0
        ) || 0;
        if (boundZoneId !== zid) continue;
        const frags = Array.isArray(snapshot.layoutRun.fragments) && snapshot.layoutRun.fragments.length > 0
          ? snapshot.layoutRun.fragments.slice()
          : buildFragmentsFromPlacements(snapshot, boundZoneId);
        for (const frag of frags) {
          const placement = getSnapshotPlacementForFragment(snapshot, frag);
          const fragZoneId = Number(frag && frag.zoneId || placement && placement.zoneId || boundZoneId || 0) || 0;
          if (fragZoneId !== zid) continue;
          out.push({
            entry,
            snapshot,
            fragment: frag,
            placement
          });
        }
      }
      out.sort((a, b) => {
        const la = String(a && a.entry && a.entry.name || "");
        const lb = String(b && b.entry && b.entry.name || "");
        if (la !== lb) return la.localeCompare(lb, "ru");
        const fa = Number(a && a.fragment && a.fragment.id || 0);
        const fb = Number(b && b.fragment && b.fragment.id || 0);
        return fa - fb;
      });
      return out;
    }

    function ensureTreeUiState() {
      if (!state.treeUi || typeof state.treeUi !== "object") {
        state.treeUi = {
          detailsCollapsed: {},
          zonesCollapsed: {}
        };
      }
      if (!state.treeUi.detailsCollapsed || typeof state.treeUi.detailsCollapsed !== "object") {
        state.treeUi.detailsCollapsed = {};
      }
      if (!state.treeUi.zonesCollapsed || typeof state.treeUi.zonesCollapsed !== "object") {
        state.treeUi.zonesCollapsed = {};
      }
      return state.treeUi;
    }

    function makeToggleButton(collapsed, expandTitle, collapseTitle, onToggle) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tree-toggle-btn";
      btn.title = collapsed ? expandTitle : collapseTitle;
      btn.innerHTML = collapsed ? iconSpan("chevronRight") : iconSpan("chevronDown");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onToggle();
      });
      return btn;
    }

    let _scrollToSelectedOnNextRender = false;
    function scrollSelectedZoneIntoView() { _scrollToSelectedOnNextRender = true; renderDetailZoneTree(); }

    function renderDetailZoneTree() {
      const treeRoot = byId("detailZoneTree");
      if (!treeRoot) return;
      const treeUi = ensureTreeUiState();
      const doScroll = _scrollToSelectedOnNextRender;
      _scrollToSelectedOnNextRender = false;
      treeRoot.innerHTML = "";

      function renderMaterialsTab() {
        const addWrap = document.createElement("div");
        addWrap.className = "row";
        addWrap.style.marginBottom = "8px";

        const addBtn = document.createElement("button");
        addBtn.className = "layout-add-btn";
        addBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">add</span><span>Добавить</span>';
        addBtn.addEventListener("click", () => {
          if (typeof openMaterialLibrary === "function") {
            openMaterialLibrary(null);
          }
        });
        addWrap.appendChild(addBtn);
        treeRoot.appendChild(addWrap);

        const resolveMaterialName = (materialId, fallbackName) => {
          if (fallbackName && fallbackName !== materialId) return fallbackName;
          const fromCatalog = typeof getFurMaterialById === "function" ? getFurMaterialById(materialId) : null;
          if (fromCatalog && fromCatalog.name && fromCatalog.name !== materialId) return fromCatalog.name;
          return fallbackName || materialId;
        };
        const zoneMaterials = new Map();
        const projectMaterials = Array.isArray(state.projectMaterials) ? state.projectMaterials : [];
        for (const item of projectMaterials) {
          const materialId = String(item && item.id || "").trim();
          if (!materialId) continue;
          zoneMaterials.set(materialId, {
            id: materialId,
            name: resolveMaterialName(materialId, String(item && item.name || "")),
            zoneCount: 0
          });
        }
        for (const zone of Array.isArray(state.zones) ? state.zones : []) {
          const materialId = String(zone && zone.materialId || "").trim();
          if (!materialId) continue;
          const existing = zoneMaterials.get(materialId);
          if (existing) {
            if (existing.name === materialId && zone.materialName && zone.materialName !== materialId) {
              existing.name = resolveMaterialName(materialId, String(zone.materialName));
            }
            existing.zoneCount += 1;
            continue;
          }
          zoneMaterials.set(materialId, {
            id: materialId,
            name: resolveMaterialName(materialId, String(zone && zone.materialName || "")),
            zoneCount: 1
          });
        }
        const items = Array.from(zoneMaterials.values()).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
        if (!items.length) {
          const empty = document.createElement("div");
          empty.className = "tree-empty";
          empty.textContent = "Пока нет материалов. Назначьте мех зоне.";
          treeRoot.appendChild(empty);
          return;
        }
        if (!items.some((item) => String(item.id || "") === String(state.selectedMaterialId || ""))) {
          state.selectedMaterialId = String(items[0].id || "");
        }
        const selectedZone = Array.isArray(state.zones)
          ? (state.zones.find((z) => Number(z && z.id || 0) === Number(state.selectedZoneId || 0)) || null)
          : null;
        const highlightedMaterialId = String(
          selectedZone && selectedZone.materialId
            ? selectedZone.materialId
            : (state.selectedMaterialId || "")
        );
        for (const item of items) {
          const card = document.createElement("div");
          card.className = "layout-list-card" + (highlightedMaterialId === String(item.id) ? " active" : "");
          const openBtn = document.createElement("button");
          openBtn.type = "button";
          openBtn.className = "layout-list-main";
          openBtn.addEventListener("click", async () => {
            state.selectedMaterialId = String(item.id || "");
            const selectedZone = (Array.isArray(state.zones) ? state.zones : []).find(
              (z) => Number(z && z.id || 0) === Number(state.selectedZoneId || 0)
            ) || null;
            if (selectedZone && typeof assignMaterialToZone === "function") {
              await assignMaterialToZone(selectedZone, { id: item.id, name: item.name });
            }
            renderDetailZoneTree();
            renderPropertyEditor();
            renderScene();
          });

          const thumb = document.createElement("div");
          thumb.className = "layout-list-thumb material-list-thumb";
          const materialForPreview = typeof getFurMaterialById === "function" ? getFurMaterialById(item.id) : null;
          if (materialForPreview && typeof buildMaterialPreviewSvgMarkup === "function") {
            thumb.classList.add("material-list-thumb-inline");
            thumb.innerHTML = buildMaterialPreviewSvgMarkup(materialForPreview);
          }
          openBtn.appendChild(thumb);

          const textWrap = document.createElement("div");
          textWrap.className = "layout-list-text";
          const title = document.createElement("div");
          title.className = "layout-list-title";
          title.textContent = item.name || item.id;
          textWrap.appendChild(title);
          const meta = document.createElement("div");
          meta.className = "layout-list-meta";
          meta.textContent = `Зон: ${Number(item.zoneCount || 0)}`;
          textWrap.appendChild(meta);
          openBtn.appendChild(textWrap);
          card.appendChild(openBtn);
          const actions = document.createElement("div");
          actions.className = "layout-list-actions";
          const deleteBtn = document.createElement("button");
          deleteBtn.type = "button";
          deleteBtn.className = "layout-list-action-btn danger icon-only";
          deleteBtn.title = "Удалить мех";
          deleteBtn.setAttribute("aria-label", "Удалить мех");
          deleteBtn.innerHTML = iconSpan("delete");
          deleteBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (typeof removeProjectMaterialById === "function") {
              await removeProjectMaterialById(item.id);
            }
          });
          actions.appendChild(deleteBtn);
          card.appendChild(actions);
          treeRoot.appendChild(card);
        }
      }

      function renderLayoutsTab() {
        const addWrap = document.createElement("div");
        addWrap.className = "row";
        addWrap.style.marginBottom = "8px";

        const addBtn = document.createElement("button");
        addBtn.className = "layout-add-btn";
        addBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">add</span><span>Добавить выкладку</span>';
        addBtn.addEventListener("click", () => {
          openLayoutTypePicker();
        });
        addWrap.appendChild(addBtn);
        treeRoot.appendChild(addWrap);

        if (!state.layouts.length) {
          const empty = document.createElement("div");
          empty.className = "tree-empty";
          empty.textContent = "Пока нет выкладок. Нажмите 'Добавить выкладку'.";
          treeRoot.appendChild(empty);
          return;
        }

        for (const entry of state.layouts) {
          const card = document.createElement("div");
          card.className = "layout-list-card" + (Number(state.selectedLayoutId || 0) === Number(entry.id) ? " active" : "") + (entry._hasSizeWarning ? " layout-list-card--warning" : "");

          const openBtn = document.createElement("button");
          openBtn.type = "button";
          openBtn.className = "layout-list-main";
          openBtn.addEventListener("click", () => {
            if (typeof selectLayoutEntry === "function") {
              selectLayoutEntry(entry);
            } else {
              state.selectedLayoutId = entry.id;
              if (typeof renderDetailZoneTree === "function") renderDetailZoneTree();
              if (typeof renderPropertyEditor === "function") renderPropertyEditor();
            }
          });

          const thumb = document.createElement("div");
          thumb.className = "layout-list-thumb";
          thumb.innerHTML = typeof getLayoutModeThumbSvg === "function"
            ? getLayoutModeThumbSvg(entry.mode)
            : "";
          openBtn.appendChild(thumb);

          const textWrap = document.createElement("div");
          textWrap.className = "layout-list-text";

          const title = document.createElement("div");
          title.className = "layout-list-title";
          title.textContent = entry.name || `(Layout ${entry.id})`;

          textWrap.appendChild(title);
          openBtn.appendChild(textWrap);

          const actions = document.createElement("div");
          actions.className = "layout-list-actions";

          const delBtn = document.createElement("button");
          delBtn.type = "button";
          delBtn.className = "layout-list-action-btn danger icon-only";
          delBtn.title = "Удалить выкладку";
          delBtn.setAttribute("aria-label", "Удалить выкладку");
          delBtn.innerHTML = iconSpan("delete");
          delBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (typeof deleteLayoutEntry === "function") {
              await deleteLayoutEntry(entry);
            } else {
              state.layouts = state.layouts.filter((x) => Number(x.id) !== Number(entry.id));
              if (Number(state.selectedLayoutId || 0) === Number(entry.id)) {
                const next = state.layouts[0] || null;
                state.selectedLayoutId = next ? next.id : null;
                if (next) applyLayoutMode(next.mode);
              }
              renderLayoutModeSwitch();
              renderDetailZoneTree();
              renderPropertyEditor();
            }
          });

          actions.appendChild(delBtn);
          card.appendChild(openBtn);
          card.appendChild(actions);
          treeRoot.appendChild(card);
        }
      }

      if (state.uiPanel === "materials") { renderMaterialsTab(); return; }
      if (state.uiPanel === "layouts") { renderLayoutsTab(); return; }

      if (!Array.isArray(state.details) || state.details.length === 0) {
        const empty = document.createElement("div");
        empty.className = "tree-empty";
        empty.textContent = "Нет деталей";
        treeRoot.appendChild(empty);
        return;
      }

      for (const d of state.details) {
        const detailId = Number(d && d.id || 0);
        const detailKey = String(detailId);
        const detailCollapsed = !!treeUi.detailsCollapsed[detailKey];

        const detailBox = document.createElement("div");
        detailBox.className = "tree-detail";

        const detailHead = document.createElement("div");
        detailHead.className = "tree-detail-head" + (state.selectedDetailId === detailId ? " active" : "");

        const detailToggle = makeToggleButton(
          detailCollapsed,
          "Развернуть деталь",
          "Свернуть деталь",
          () => {
            treeUi.detailsCollapsed[detailKey] = !detailCollapsed;
            renderDetailZoneTree();
          }
        );
        detailHead.appendChild(detailToggle);

        const detailName = document.createElement("span");
        detailName.className = "tree-detail-title";
        detailName.textContent = `Деталь ${detailId}`;
        detailHead.appendChild(detailName);

        detailHead.addEventListener("click", () => {
          state.selectedDetailId = detailId;
          fitBBoxToView(d.bbox);
          renderScene();
        });

        const zonesWrap = document.createElement("div");
        zonesWrap.className = "tree-zones";
        zonesWrap.style.display = detailCollapsed ? "none" : "";

        const zones = state.zones.filter((z) => Number(z.detailId || 0) === detailId);
        if (zones.length === 0) {
          const zEmpty = document.createElement("div");
          zEmpty.className = "tree-empty";
          zEmpty.textContent = "зон нет";
          zonesWrap.appendChild(zEmpty);
        } else {
          for (const z of zones) {
            const zoneId = Number(z && z.id || 0);
            const zoneKey = String(zoneId);
            const zoneCollapsed = zoneKey in treeUi.zonesCollapsed ? !!treeUi.zonesCollapsed[zoneKey] : true;

            const zi = document.createElement("div");
            zi.className = "tree-zone" + (state.selectedZoneId === zoneId ? " active" : "");

            const zrow = document.createElement("div");
            zrow.className = "zone-row";

            const zoneToggle = makeToggleButton(
              zoneCollapsed,
                "Развернуть зону",
                "Свернуть зону",
              () => {
                treeUi.zonesCollapsed[zoneKey] = !zoneCollapsed;
                renderDetailZoneTree();
              }
            );
            zoneToggle.classList.add("zone-toggle-btn");
            zrow.appendChild(zoneToggle);

            const zthumb = document.createElement("div");
            zthumb.className = "zone-thumb";
            zthumb.innerHTML = contourThumbSvg(z.points || [], true, z.holes);

            const zname = document.createElement("div");
            zname.textContent = z.name || `Зона ${zoneId}`;

            zrow.appendChild(zthumb);
            zrow.appendChild(zname);
            zi.appendChild(zrow);

            zi.addEventListener("click", (e) => {
              e.stopPropagation();
              state.selectedZoneId = zoneId;
              state.selectedFragmentId = null;
              state.selectedDetailId = Number(z.detailId || detailId);
              const zoneLayouts = (Array.isArray(state.layouts) ? state.layouts : []).filter((entry) => Number(entry && entry.boundZoneId || 0) === zoneId);
              const currentMatchesZone = zoneLayouts.some((entry) => Number(entry && entry.id || 0) === Number(state.selectedLayoutId || 0));
              const entryToOpen = currentMatchesZone
                ? zoneLayouts.find((entry) => Number(entry && entry.id || 0) === Number(state.selectedLayoutId || 0)) || null
                : (zoneLayouts[0] || null);
              if (entryToOpen && typeof openLayoutEntry === "function") {
                void openLayoutEntry(entryToOpen);
              }
              fitPointsToView(z.points);
              renderDetailZoneTree();
              renderScene();
            });

            zi.addEventListener("contextmenu", (e) => {
              e.preventDefault();
              e.stopPropagation();
              state.selectedZoneId = zoneId;
              state.selectedFragmentId = null;
              state.selectedDetailId = Number(z.detailId || detailId);
              renderDetailZoneTree();
              renderScene();
              if (typeof openZoneContextMenu === "function") {
                openZoneContextMenu({
                  x: Number(e.clientX || 0),
                  y: Number(e.clientY || 0),
                  zone: z
                });
              }
            });

            zonesWrap.appendChild(zi);

            const zoneFragments = collectZoneFragments(zoneId);
            if (zoneFragments.length > 0) {
              const frWrap = document.createElement("div");
              frWrap.className = "tree-fragments";
              frWrap.style.display = zoneCollapsed ? "none" : "";

              for (const rec of zoneFragments) {
                const frag = rec.fragment || {};
                const p = rec.placement || null;
                const entry = rec.entry || null;
                const fragId = Number(frag.id || 0);
                const item = document.createElement("div");
                const isActive = state.selectedFragmentId === fragId
                  && Number(state.selectedLayoutId || 0) === Number(entry && entry.id || 0);
                item.className = "tree-fragment" + (isActive ? " active" : "");

                const left = document.createElement("span");
                left.className = "tree-fragment-label";
                left.innerHTML = `<span class="tree-fragment-bullet"></span><span>${zoneId}-${fragId}</span>`;

                const right = document.createElement("span");
                right.className = "tree-frag-tag";
                if (p && p.status === "needs_attention") {
                  right.textContent = `needs_attention${Number.isFinite(Number(p.fitScore)) ? ` (${Number(p.fitScore).toFixed(1)})` : ""}`;
                  right.style.color = "#b42318";
                  item.style.background = "#fff3f2";
                } else if (p && p.inventoryTag) {
                  right.textContent = String(p.inventoryTag);
                  right.style.color = "#666";
                } else {
                  right.textContent = p && p.status ? String(p.status) : "";
                  right.style.color = "#666";
                }

                item.appendChild(left);
                item.appendChild(right);
                item.addEventListener("click", async (e) => {
                  e.stopPropagation();
                  if (entry && Number(state.selectedLayoutId || 0) !== Number(entry.id || 0) && typeof openLayoutEntry === "function") {
                    await openLayoutEntry(entry);
                  }
                  state.selectedDetailId = Number(z.detailId || detailId);
                  state.selectedZoneId = zoneId;
                  state.selectedFragmentId = fragId;
                  fitPointsToView(z.points);
                  renderScene();
                });
                frWrap.appendChild(item);
              }

              zonesWrap.appendChild(frWrap);
            }
          }
        }

        detailBox.appendChild(detailHead);
        detailBox.appendChild(zonesWrap);
        treeRoot.appendChild(detailBox);
      }
      // Scroll active zone into view only when triggered from canvas selection
      if (doScroll) {
        const activeEl = treeRoot.querySelector(".tree-zone.active");
        if (activeEl) activeEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }

    return { renderDetailZoneTree, scrollSelectedZoneIntoView };
  }

  root.FurLabDetailZoneTreeView = { createDetailZoneTreeView };
})(typeof window !== "undefined" ? window : globalThis);
