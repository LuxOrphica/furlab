export function attachStagePanHandlers({
  stage,
  zoomRail,
  getHasImage,
  getSpacePanActive,
  getPanState,
  setPanState,
  updateStageCursor,
  applyZoom,
  setSuppressNextCanvasClick
}) {
  if (!stage) return () => {};

  const onPointerDown = (e) => {
    if (!getHasImage()) return;
    if (zoomRail && zoomRail.contains(e.target)) return;
    const panByMiddle = e.button === 1;
    const panBySpaceLeft = e.button === 0 && getSpacePanActive();
    if (!panByMiddle && !panBySpaceLeft) return;
    // Prevent trailing click from placing points after a pan gesture.
    setSuppressNextCanvasClick(true);
    const pan = getPanState();
    setPanState({
      isPanning: true,
      panMoved: false,
      panPointerId: e.pointerId,
      panStartClientX: e.clientX,
      panStartClientY: e.clientY,
      panStartX: pan.scenePanX,
      panStartY: pan.scenePanY
    });
    updateStageCursor();
    (e.target && typeof e.target.setPointerCapture === "function" ? e.target : stage).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    const pan = getPanState();
    if (!pan.isPanning || e.pointerId !== pan.panPointerId) return;
    const dx = e.clientX - pan.panStartClientX;
    const dy = e.clientY - pan.panStartClientY;
    // Convert pointer delta into viewport translation.
    setPanState({
      panMoved: pan.panMoved || Math.abs(dx) > 3 || Math.abs(dy) > 3,
      scenePanX: pan.panStartX + dx,
      scenePanY: pan.panStartY + dy
    });
    applyZoom();
  };

  const stopPan = (e) => {
    const pan = getPanState();
    if (!pan.isPanning || e.pointerId !== pan.panPointerId) return;
    // Keep click suppression for mouseup event after drag.
    setSuppressNextCanvasClick(true);
    setPanState({
      isPanning: false,
      panPointerId: null,
      panMoved: false
    });
    updateStageCursor();
    stage.releasePointerCapture?.(e.pointerId);
  };

  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", stopPan);
  stage.addEventListener("pointercancel", stopPan);

  return () => {
    stage.removeEventListener("pointerdown", onPointerDown);
    stage.removeEventListener("pointermove", onPointerMove);
    stage.removeEventListener("pointerup", stopPan);
    stage.removeEventListener("pointercancel", stopPan);
  };
}
