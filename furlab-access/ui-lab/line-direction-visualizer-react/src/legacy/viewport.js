export function resolveStageCursor({ isPanning, spacePanActive }) {
  // Cursor reflects current pan interaction mode.
  if (isPanning) return "grabbing";
  if (spacePanActive) return "grab";
  return "default";
}

export function clampZoomPercent(next, min = 50, max = 300, fallback = 100) {
  // Clamp and sanitize user-entered zoom value.
  const raw = Math.round(Number(next));
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

export function getZoomRenderState({ hasImage, zoomPercent, canvasWidth, canvasHeight, scenePanX, scenePanY }) {
  if (!hasImage) {
    // Hide drawing-related layers when there is no image.
    return {
      hidden: true,
      scale: 1,
      baseW: Math.max(1, Number(canvasWidth || 1)),
      baseH: Math.max(1, Number(canvasHeight || 1)),
      zoomText: `${zoomPercent}%`,
      canvasStyle: { display: "none" },
      stageWrapStyle: { display: "none" },
      // Keep overlay visible so mm grid can be shown on empty stage.
      overlayStyle: { display: "block" },
      // Keep zoom controls visible before file load for consistent UI.
      zoomRailStyle: { display: "flex" }
    };
  }

  const scale = Number(zoomPercent || 100) / 100;
  const baseW = Math.max(1, Number(canvasWidth || 1));
  const baseH = Math.max(1, Number(canvasHeight || 1));

  // Keep canvas in native pixels; pan/zoom are applied via stage wrapper transform.
  return {
    hidden: false,
    scale,
    baseW,
    baseH,
    zoomText: `${zoomPercent}%`,
    canvasStyle: {
      display: "block",
      transform: "none",
      width: `${baseW}px`,
      height: `${baseH}px`
    },
    stageWrapStyle: {
      display: "block",
      width: `${baseW}px`,
      height: `${baseH}px`,
      transform: `translate(${scenePanX}px, ${scenePanY}px) scale(${scale})`
    },
    overlayStyle: { display: "block" },
    zoomRailStyle: { display: "flex" }
  };
}

export function calcCenteredPan({ zoomPercent, canvasWidth, canvasHeight, stageWidth, stageHeight }) {
  // Center scaled content within stage viewport.
  const scale = Number(zoomPercent || 100) / 100;
  const baseW = Math.max(1, Number(canvasWidth || 1));
  const baseH = Math.max(1, Number(canvasHeight || 1));
  const viewW = Math.max(1, Number(stageWidth || 1));
  const viewH = Math.max(1, Number(stageHeight || 1));
  const scaledW = baseW * scale;
  const scaledH = baseH * scale;
  return {
    scenePanX: Math.round((viewW - scaledW) / 2),
    scenePanY: Math.round((viewH - scaledH) / 2),
  };
}

export function attachResizeRecenterHandler({ getHasImage, recenterAndApplyZoom }) {
  let resizeRaf = 0;
  // Debounce resize with rAF to avoid over-rendering during window drag.
  const onResize = () => {
    if (!getHasImage()) return;
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      recenterAndApplyZoom();
      resizeRaf = 0;
    });
  };
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
}
