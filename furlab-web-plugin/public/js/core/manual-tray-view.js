// Extracted from app.js: manual tray HTML rendering.
(function (global) {
  function createManualTrayView(options) {
    const opts = options && typeof options === "object" ? options : {};
    const t = typeof opts.t === "function" ? opts.t : (_k, _v, fb) => String(fb || "");

    function iconSpan(name) {
      const map = {
        rotateLeft: "rotate_left",
        rotateRight: "rotate_right",
        minus: "remove",
        plus: "add",
        chevronRight: "chevron_right",
        chevronDown: "expand_more",
        zUp: "vertical_align_top",
        zDown: "vertical_align_bottom",
        zFront: "flip_to_front",
        zBack: "flip_to_back"
      };
      const glyph = map[name] || "";
      return glyph ? `<span class="material-symbols-outlined" aria-hidden="true">${glyph}</span>` : "";
    }

    function renderHtml(input) {
      const cfg = input && typeof input === "object" ? input : {};
      const sections = cfg.sections && typeof cfg.sections === "object"
        ? cfg.sections
        : { large: [], medium: [], small: [] };
      const trayOpen = cfg.trayOpen && typeof cfg.trayOpen === "object"
        ? cfg.trayOpen
        : { large: false, medium: false, small: false, all: false };
      const selectedTag = String(cfg.selectedTag || "");
      const getThumbSvg = typeof cfg.getThumbSvg === "function" ? cfg.getThumbSvg : () => "";
      const formatSectionRangeCm = typeof cfg.formatSectionRangeCm === "function" ? cfg.formatSectionRangeCm : () => "";
      const metricsLine = String(cfg.metricsLine || "");
      const selectedInfoLine = String(cfg.selectedInfoLine || "");
      const seamDebugLine = String(cfg.seamDebugLine || "");
      const seamFlowSummary = String(cfg.seamFlowSummary || "");
      const seamExcludedSummary = String(cfg.seamExcludedSummary || "");
      const rotateStepDeg = Math.max(1, Number(cfg.rotateStepDeg || 5));
      const noDataHtml = String(cfg.noDataHtml || '<div class="tree-empty">-</div>');
      const hasDebug = !!(selectedInfoLine || metricsLine || seamDebugLine || seamFlowSummary || seamExcludedSummary);
      const debugOpen = !!cfg.debugOpen;

      const makeCards = (list, sectionKey) => {
        const top = Array.isArray(list) ? list : [];
        if (!top.length) return noDataHtml;
        return top.map((c) => {
          const tag = String(c && (c.inventoryTag || c.id) || "-");
          const isSel = tag === selectedTag;
          const thumb = getThumbSvg(c, sectionKey);
          return `<button data-manual-piece="${tag}" title="${tag}" draggable="true" style="background:${isSel ? "#e9f3ff" : "#fff"};">${thumb}</button>`;
        }).join("");
      };

      const sectionHtml = (key, title, list) => {
        const open = !!trayOpen[key];
        return `
          <div class="manual-tray-section">
            <div class="manual-tray-cards-wrap ${open ? "open" : ""}">
              <div class="manual-tray-cards-grid">${makeCards(list, key)}</div>
            </div>
            <button type="button" class="manual-tray-toggle" data-manual-toggle="${key}">
              <span>${title}</span>
              <span class="manual-tray-toggle-icon">${open ? iconSpan("chevronDown") : iconSpan("chevronRight")}</span>
            </button>
          </div>
        `;
      };

      const allOpen = !!trayOpen.all;
      const allPieces = [
        ...(Array.isArray(sections.large) ? sections.large : []),
        ...(Array.isArray(sections.medium) ? sections.medium : []),
        ...(Array.isArray(sections.small) ? sections.small : [])
      ];
      const totalCount = allPieces.length;

      return `
        <div class="manual-tray-toolbar manual-tray-toolbar-main">
          <div class="manual-tray-toolbar-group manual-tray-toolbar-group-actions">
            <button type="button" data-manual-toolbar="apply">${t("btn_apply", null, "Применить")}</button>
          </div>
          <div class="manual-tray-toolbar-group">
            <button type="button" class="manual-tray-toggle manual-tray-debug-toggle" data-manual-debug-toggle="1">
              <span>${t("manual_debug_summary", null, "Диагностика")}</span>
              <span class="manual-tray-toggle-icon">${debugOpen ? iconSpan("chevronDown") : iconSpan("chevronRight")}</span>
            </button>
          </div>
          <div class="manual-tray-toolbar-group manual-tray-toolbar-group-rotate">
            <button type="button" class="manual-tray-icon-btn" data-manual-toolbar="rotate-left" aria-label="${t("manual_rotate_left", null, "Повернуть влево")}" title="${t("manual_rotate_left", null, "Повернуть влево")}">${iconSpan("rotateLeft")}</button>
            <button type="button" class="manual-tray-icon-btn" data-manual-toolbar="rotate-right" aria-label="${t("manual_rotate_right", null, "Повернуть вправо")}" title="${t("manual_rotate_right", null, "Повернуть вправо")}">${iconSpan("rotateRight")}</button>
            <button type="button" class="manual-tray-icon-btn" data-manual-toolbar="rotate-step-minus" aria-label="${t("manual_rotate_step_minus", null, "Уменьшить шаг")}" title="${t("manual_rotate_step_minus", null, "Уменьшить шаг")}">${iconSpan("minus")}</button>
            <button type="button" class="manual-tray-icon-btn" data-manual-toolbar="rotate-step-plus" aria-label="${t("manual_rotate_step_plus", null, "Увеличить шаг")}" title="${t("manual_rotate_step_plus", null, "Увеличить шаг")}">${iconSpan("plus")}</button>
            <span class="manual-tray-rotate-step">${t("manual_rotate_step", null, "шаг")} ${rotateStepDeg}°</span>
          </div>
          <div class="manual-tray-toolbar-group manual-tray-toolbar-group-center">
            <button type="button" class="manual-tray-icon-btn" data-manual-toolbar="z-up" aria-label="${t("manual_z_up", null, "Выше")}" title="${t("manual_z_up", null, "Выше")}">${iconSpan("zUp")}</button>
            <button type="button" class="manual-tray-icon-btn" data-manual-toolbar="z-down" aria-label="${t("manual_z_down", null, "Ниже")}" title="${t("manual_z_down", null, "Ниже")}">${iconSpan("zDown")}</button>
            <button type="button" class="manual-tray-icon-btn" data-manual-toolbar="z-front" aria-label="${t("manual_z_front", null, "Вперёд")}" title="${t("manual_z_front", null, "Вперёд")}">${iconSpan("zFront")}</button>
            <button type="button" class="manual-tray-icon-btn" data-manual-toolbar="z-back" aria-label="${t("manual_z_back", null, "Назад")}" title="${t("manual_z_back", null, "Назад")}">${iconSpan("zBack")}</button>
          </div>
          <div class="manual-tray-toolbar-group manual-tray-toolbar-group-right">
            <button type="button" class="manual-tray-toggle manual-tray-all-toggle" data-manual-toggle="all">
              <span>${t("tray_section_all", null, "Лоток")}${totalCount ? ` (${totalCount})` : ""}</span>
              <span class="manual-tray-toggle-icon">${allOpen ? iconSpan("chevronDown") : iconSpan("chevronRight")}</span>
            </button>
          </div>
        </div>
        ${hasDebug ? `
        <div class="manual-tray-debug ${debugOpen ? "open" : ""}">
          <div class="manual-tray-debug-body ${debugOpen ? "open" : ""}">
            ${selectedInfoLine ? `<div class="manual-tray-metrics" title="${selectedInfoLine.replace(/"/g, "&quot;")}">${selectedInfoLine}</div>` : ""}
            ${metricsLine ? `<div class="manual-tray-metrics" title="${metricsLine.replace(/"/g, "&quot;")}">${metricsLine}</div>` : ""}
            ${seamDebugLine ? `<div class="manual-tray-metrics" title="${seamDebugLine.replace(/"/g, "&quot;")}">${seamDebugLine}</div>` : ""}
            ${seamFlowSummary ? `<div class="manual-tray-metrics" title="${seamFlowSummary.replace(/"/g, "&quot;")}">${seamFlowSummary}</div>` : ""}
            ${seamExcludedSummary ? `<div class="manual-tray-metrics" title="${seamExcludedSummary.replace(/"/g, "&quot;")}">${seamExcludedSummary}</div>` : ""}
          </div>
        </div>
        ` : ""}
        <div class="manual-tray-sections ${allOpen ? "open" : ""}">
          <div class="manual-tray-section">
            <div class="manual-tray-size-label">${t("tray_section_large", null, "Большие")} ${formatSectionRangeCm("large", sections)}</div>
            <div class="manual-tray-cards-wrap open"><div class="manual-tray-cards-grid">${makeCards(sections.large, "large")}</div></div>
          </div>
          <div class="manual-tray-section">
            <div class="manual-tray-size-label">${t("tray_section_medium", null, "Средние")} ${formatSectionRangeCm("medium", sections)}</div>
            <div class="manual-tray-cards-wrap open"><div class="manual-tray-cards-grid">${makeCards(sections.medium, "medium")}</div></div>
          </div>
          <div class="manual-tray-section">
            <div class="manual-tray-size-label">${t("tray_section_small", null, "Малые")} ${formatSectionRangeCm("small", sections)}</div>
            <div class="manual-tray-cards-wrap open"><div class="manual-tray-cards-grid">${makeCards(sections.small, "small")}</div></div>
          </div>
        </div>
      `;
    }

    return { renderHtml };
  }

  global.FurLabManualTrayView = Object.assign({}, global.FurLabManualTrayView || {}, {
    createManualTrayView
  });
})(window);
