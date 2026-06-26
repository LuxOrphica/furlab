// Extracted from app.js (inventory modal positioning and drag behavior)
(function (global) {
  function createInventoryModalDrag(options) {
    const opts = options && typeof options === "object" ? options : {};
    const byId = typeof opts.byId === "function"
      ? opts.byId
      : (id) => global.document && global.document.getElementById(id);

    function ensureModalPosition(modalId, minHeight, fallbackHeight, options2) {
      const modal = byId(modalId);
      if (!modal) return;
      const cfg = options2 && typeof options2 === "object" ? options2 : {};
      const anchor = String(cfg.anchor || "center");
      const forceAnchor = !!cfg.forceAnchor;
      const topOffset = Math.max(0, Number(cfg.topOffset || 10));
      const rightOffset = Math.max(0, Number(cfg.rightOffset || 14));
      modal.style.position = "absolute";
      modal.style.margin = "0";
      const vw = global.innerWidth || 1200;
      const vh = global.innerHeight || 800;
      const rect = modal.getBoundingClientRect();
      const w = Math.max(320, Math.min(vw - 20, rect.width || 360));
      const h = Math.max(Number(minHeight || 220), Math.min(vh - 20, rect.height || Number(fallbackHeight || 420)));
      let left = Number(String(modal.style.left || "").replace("px", ""));
      let top = Number(String(modal.style.top || "").replace("px", ""));
      const invalidPos = !Number.isFinite(left) || !Number.isFinite(top);
      if (forceAnchor || invalidPos) {
        if (anchor === "top-right") {
          left = Math.round(vw - w - rightOffset);
          top = Math.round(topOffset);
        } else {
          left = Math.round((vw - w) * 0.5);
          top = Math.round((vh - h) * 0.5);
        }
      }
      left = Math.max(10, Math.min(vw - w - 10, left));
      top = Math.max(10, Math.min(vh - h - 10, top));
      modal.style.left = `${Math.round(left)}px`;
      modal.style.top = `${Math.round(top)}px`;
    }

    function setupModalDrag(config) {
      const cfg = config && typeof config === "object" ? config : {};
      const modal = byId(String(cfg.modalId || ""));
      const head = byId(String(cfg.headId || ""));
      if (!modal || !head) return;
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let startLeft = 0;
      let startTop = 0;

      const ensure = () => ensureModalPosition(cfg.modalId, cfg.minHeight, cfg.fallbackHeight);

      head.addEventListener("mousedown", (e) => {
        const t = e.target;
        if (t && t.tagName === "BUTTON") return;
        ensure();
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = Number(String(modal.style.left || "0").replace("px", "")) || 0;
        startTop = Number(String(modal.style.top || "0").replace("px", "")) || 0;
        global.document.body.style.userSelect = "none";
        e.preventDefault();
      });

      global.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const vw = global.innerWidth || 1200;
        const vh = global.innerHeight || 800;
        const rect = modal.getBoundingClientRect();
        const w = rect.width || 360;
        const h = rect.height || Number(cfg.fallbackHeight || 420);
        const nextLeft = Math.max(10, Math.min(vw - w - 10, startLeft + (e.clientX - startX)));
        const nextTop = Math.max(10, Math.min(vh - h - 10, startTop + (e.clientY - startY)));
        modal.style.left = `${Math.round(nextLeft)}px`;
        modal.style.top = `${Math.round(nextTop)}px`;
      });

      global.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        global.document.body.style.userSelect = "";
      });

      global.addEventListener("resize", ensure);
    }

    function ensureStep1() {
      ensureModalPosition("inventoryStep1Modal", 220, 420, {
        anchor: "top-right",
        forceAnchor: true,
        topOffset: 10,
        rightOffset: 14
      });
    }

    function ensureStep2() {
      ensureModalPosition("inventoryStep2Modal", 260, 500, {
        anchor: "top-right",
        forceAnchor: true,
        topOffset: 10,
        rightOffset: 14
      });
    }

    function setupStep1Drag() {
      setupModalDrag({
        modalId: "inventoryStep1Modal",
        headId: "inventoryStep1Head",
        minHeight: 220,
        fallbackHeight: 420
      });
    }

    function setupStep2Drag() {
      setupModalDrag({
        modalId: "inventoryStep2Modal",
        headId: "inventoryStep2Head",
        minHeight: 260,
        fallbackHeight: 500
      });
    }

    return {
      ensureStep1,
      ensureStep2,
      setupStep1Drag,
      setupStep2Drag
    };
  }

  global.FurLabInventoryModalDrag = Object.assign({}, global.FurLabInventoryModalDrag || {}, {
    createInventoryModalDrag
  });
})(window);
