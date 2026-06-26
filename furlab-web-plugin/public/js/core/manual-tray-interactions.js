// Extracted from app.js (manual tray drag/drop interactions)
(function (global) {
  function createManualTrayInteractions(options) {
    const opts = options && typeof options === "object" ? options : {};
    const byId = typeof opts.byId === "function"
      ? opts.byId
      : (id) => global.document && global.document.getElementById(id);
    const isManualInventoryMode = typeof opts.isManualInventoryMode === "function"
      ? opts.isManualInventoryMode
      : (() => false);
    const screenToWorld = typeof opts.screenToWorld === "function"
      ? opts.screenToWorld
      : ((x, y) => ({ x, y }));
    const onPickByTag = typeof opts.onPickByTag === "function"
      ? opts.onPickByTag
      : (() => null);
    const onRenderTray = typeof opts.onRenderTray === "function"
      ? opts.onRenderTray
      : (() => {});

    const dragState = {
      dragging: false,
      startMouseX: 0,
      startMouseY: 0,
      startLeft: 0,
      startTop: 0
    };
    let dndBound = false;

    function ensureDragBehavior() {
      const host = byId("manualTrayDock");
      if (!host || host.__dragBound) return;
      const workspace = byId("workspace");
      const container = workspace ? workspace.parentElement : null;
      if (!container) return;
      const onMouseMove = (e) => {
        if (!dragState.dragging) return;
        const rect = container.getBoundingClientRect();
        const width = host.offsetWidth || 300;
        const height = host.offsetHeight || 100;
        let nextLeft = dragState.startLeft + (e.clientX - dragState.startMouseX);
        let nextTop = dragState.startTop + (e.clientY - dragState.startMouseY);
        nextLeft = Math.max(6, Math.min(nextLeft, Math.max(6, rect.width - width - 6)));
        nextTop = Math.max(6, Math.min(nextTop, Math.max(6, rect.height - height - 6)));
        host.style.left = `${Math.round(nextLeft)}px`;
        host.style.top = `${Math.round(nextTop)}px`;
        host.style.right = "auto";
        host.style.bottom = "auto";
      };
      const onMouseUp = () => {
        dragState.dragging = false;
      };
      host.addEventListener("mousedown", (e) => {
        const dragHandle = e.target && e.target.closest ? e.target.closest("[data-manual-tray-drag]") : null;
        if (!dragHandle) return;
        const hostRect = host.getBoundingClientRect();
        const parentRect = container.getBoundingClientRect();
        host.style.width = `${Math.round(hostRect.width)}px`;
        host.style.left = `${Math.round(hostRect.left - parentRect.left)}px`;
        host.style.top = `${Math.round(hostRect.top - parentRect.top)}px`;
        host.style.right = "auto";
        host.style.bottom = "auto";
        dragState.dragging = true;
        dragState.startMouseX = e.clientX;
        dragState.startMouseY = e.clientY;
        dragState.startLeft = Number.parseFloat(host.style.left) || 10;
        dragState.startTop = Number.parseFloat(host.style.top) || 10;
        e.preventDefault();
      });
      global.addEventListener("mousemove", onMouseMove);
      global.addEventListener("mouseup", onMouseUp);
      host.__dragBound = true;
    }

    function ensureDnD() {
      if (dndBound) return;
      const workspace = byId("workspace");
      if (!workspace) return;
      workspace.addEventListener("dragover", (e) => {
        if (!isManualInventoryMode()) return;
        const types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
        if (types.includes("text/manual-piece-tag")) {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        }
      });
      workspace.addEventListener("drop", (e) => {
        if (!isManualInventoryMode()) return;
        const dt = e.dataTransfer;
        if (!dt) return;
        const tag = String(dt.getData("text/manual-piece-tag") || "").trim();
        if (!tag) return;
        e.preventDefault();
        const rect = workspace.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const world = screenToWorld(sx, sy);
        const picked = onPickByTag(tag, world);
        if (!picked) return;
        onRenderTray();
      });
      dndBound = true;
    }

    return {
      ensureDragBehavior,
      ensureDnD
    };
  }

  global.FurLabManualTrayInteractions = Object.assign({}, global.FurLabManualTrayInteractions || {}, {
    createManualTrayInteractions
  });
})(window);
