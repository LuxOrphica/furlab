export function drawArrow(drawCtx, x1, y1, x2, y2, color, uiScale = 1) {
  const head = 12 * uiScale;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  drawCtx.strokeStyle = color;
  drawCtx.fillStyle = color;
  drawCtx.lineWidth = 3 * uiScale;
  drawCtx.beginPath();
  drawCtx.moveTo(x1, y1);
  drawCtx.lineTo(x2, y2);
  drawCtx.stroke();

  drawCtx.beginPath();
  drawCtx.moveTo(x2, y2);
  drawCtx.lineTo(x2 - head * Math.cos(ang - Math.PI / 7), y2 - head * Math.sin(ang - Math.PI / 7));
  drawCtx.lineTo(x2 - head * Math.cos(ang + Math.PI / 7), y2 - head * Math.sin(ang + Math.PI / 7));
  drawCtx.closePath();
  drawCtx.fill();
}

export function syncOverlayCanvas({ overlayCanvas, overlayCtx, stage }) {
  if (!overlayCanvas || !overlayCtx || !stage) return null;
  // Keep overlay in sync with CSS size and DPR for crisp labels/points.
  const viewW = Math.max(1, stage.clientWidth || 1);
  const viewH = Math.max(1, stage.clientHeight || 1);
  const dpr = Math.max(1, Number(window.devicePixelRatio || 1));
  const bw = Math.round(viewW * dpr);
  const bh = Math.round(viewH * dpr);
  if (overlayCanvas.width !== bw || overlayCanvas.height !== bh) {
    overlayCanvas.width = bw;
    overlayCanvas.height = bh;
  }
  overlayCanvas.style.width = `${viewW}px`;
  overlayCanvas.style.height = `${viewH}px`;
  overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { viewW, viewH };
}

export function drawOverlayLayer(state) {
  const {
    overlayCtx,
    overlayCanvas,
    stage,
    stageWrap,
    canvas,
    img,
    getDebugFlag,
    markerPoint,
    edgePoint,
    lineP1,
    lineP2,
    napVector,
    modelStats,
    polygonMask,
    formatDist,
    toMmDistance,
    getEdgeDistance,
    dpiX,
    dpiY
  } = state;

  if (!overlayCtx || !overlayCanvas || !stage) return;
  const sync = syncOverlayCanvas({ overlayCanvas, overlayCtx, stage });
  if (!sync) return;
  const { viewW, viewH } = sync;
  overlayCtx.clearRect(0, 0, viewW, viewH);

  const hasImage = !!img;
  const showControlPoints = getDebugFlag("controlPoints");
  const showNapArrow = getDebugFlag("napArrow");
  const showBbox = getDebugFlag("bbox");
  const showEdgeDistances = getDebugFlag("edgeDistance");

  const stageRect = stage.getBoundingClientRect();
  const wrapRect = hasImage && stageWrap ? stageWrap.getBoundingClientRect() : stageRect;
  const drawScaleX = hasImage ? Math.max(1e-6, wrapRect.width / Math.max(1, canvas.width)) : 1;
  const drawScaleY = hasImage ? Math.max(1e-6, wrapRect.height / Math.max(1, canvas.height)) : 1;
  const offsetX = hasImage ? (wrapRect.left - stageRect.left) : 0;
  const offsetY = hasImage ? (wrapRect.top - stageRect.top) : 0;
  const toViewX = (x) => offsetX + x * drawScaleX;
  const toViewY = (y) => offsetY + y * drawScaleY;

  const showMmGrid = getDebugFlag("mmGrid");
  const gridDpiX = Number.isFinite(dpiX) && dpiX > 0 ? dpiX : 96;
  const gridDpiY = Number.isFinite(dpiY) && dpiY > 0 ? dpiY : 96;
  if (showMmGrid) {
    const mmMinor = 10;
    const mmMajor = 50;
    const pxMinorX = (mmMinor * gridDpiX) / 25.4;
    const pxMinorY = (mmMinor * gridDpiY) / 25.4;
    const pxMajorX = (mmMajor * gridDpiX) / 25.4;
    const pxMajorY = (mmMajor * gridDpiY) / 25.4;
    const stepMinorX = Math.max(2, pxMinorX * drawScaleX);
    const stepMinorY = Math.max(2, pxMinorY * drawScaleY);
    const stepMajorX = Math.max(2, pxMajorX * drawScaleX);
    const stepMajorY = Math.max(2, pxMajorY * drawScaleY);
    const originViewX = toViewX(0);
    const originViewY = toViewY(0);

    const forEachGridLine = (origin, step, limit, fn) => {
      let start = origin;
      if (step <= 0 || !Number.isFinite(step)) return;
      while (start > 0) start -= step;
      while (start + step < 0) start += step;
      for (let p = start; p <= limit + step; p += step) fn(p);
    };

    overlayCtx.save();
    overlayCtx.beginPath();
    overlayCtx.lineWidth = 1;
    overlayCtx.strokeStyle = "rgba(31, 41, 55, 0.12)";
    forEachGridLine(originViewX, stepMinorX, viewW, (vx) => {
      overlayCtx.moveTo(vx, 0);
      overlayCtx.lineTo(vx, viewH);
    });
    forEachGridLine(originViewY, stepMinorY, viewH, (vy) => {
      overlayCtx.moveTo(0, vy);
      overlayCtx.lineTo(viewW, vy);
    });
    overlayCtx.stroke();
    overlayCtx.restore();

    overlayCtx.save();
    overlayCtx.beginPath();
    overlayCtx.lineWidth = 1;
    overlayCtx.strokeStyle = "rgba(31, 41, 55, 0.2)";
    forEachGridLine(originViewX, stepMajorX, viewW, (vx) => {
      overlayCtx.moveTo(vx, 0);
      overlayCtx.lineTo(vx, viewH);
    });
    forEachGridLine(originViewY, stepMajorY, viewH, (vy) => {
      overlayCtx.moveTo(0, vy);
      overlayCtx.lineTo(viewW, vy);
    });
    overlayCtx.stroke();

    overlayCtx.fillStyle = "rgba(17, 24, 39, 0.6)";
    overlayCtx.font = "11px Segoe UI";
    overlayCtx.textBaseline = "top";
    const minLabelGapPx = 44;
    const labelEvery = Math.max(1, Math.ceil(minLabelGapPx / Math.max(1, stepMajorX)));
    const kStart = Math.floor((0 - originViewX) / Math.max(1e-6, stepMajorX));
    const kEnd = Math.ceil((viewW - originViewX) / Math.max(1e-6, stepMajorX));
    for (let k = kStart; k <= kEnd; k++) {
      if (k % labelEvery !== 0) continue;
      const vx = originViewX + k * stepMajorX;
      const imgPxX = (vx - originViewX) / Math.max(1e-6, drawScaleX);
      const mm = (imgPxX * 25.4) / gridDpiX;
      if (!Number.isFinite(mm) || mm < 0 || (hasImage && mm > (canvas.width * 25.4) / gridDpiX)) continue;
      overlayCtx.fillText(`${Math.round(mm)}`, vx + 2, 2);
    }
    overlayCtx.restore();
  }

  if (!hasImage) return;

  const drawPoint = (x, y, fill, r = 4) => {
    overlayCtx.save();
    overlayCtx.beginPath();
    overlayCtx.arc(x, y, r, 0, Math.PI * 2);
    overlayCtx.fillStyle = fill;
    overlayCtx.fill();
    overlayCtx.lineWidth = 1.5;
    overlayCtx.strokeStyle = "rgba(255,255,255,0.9)";
    overlayCtx.stroke();
    overlayCtx.restore();
  };

  const drawTag = (text, x, y) => {
    // Small callout labels are clamped to viewport bounds.
    const padX = 4;
    const h = 16;
    const margin = 2;
    overlayCtx.save();
    overlayCtx.font = "12px Segoe UI";
    const w = Math.ceil(overlayCtx.measureText(text).width) + padX * 2;
    const tx = Math.max(margin, Math.min(viewW - w - margin, Math.round(x)));
    const ty = Math.max(h + margin, Math.min(viewH - margin, Math.round(y)));
    overlayCtx.fillStyle = "rgba(255,255,255,0.85)";
    overlayCtx.strokeStyle = "rgba(17,24,39,0.18)";
    overlayCtx.lineWidth = 1;
    overlayCtx.fillRect(tx, ty - h + 1, w, h);
    overlayCtx.strokeRect(tx, ty - h + 1, w, h);
    overlayCtx.fillStyle = "#111827";
    overlayCtx.textBaseline = "alphabetic";
    overlayCtx.fillText(text, tx + padX, ty - 3);
    overlayCtx.restore();
  };

  if (showControlPoints && markerPoint) {
    drawPoint(toViewX(markerPoint.x), toViewY(markerPoint.y), "#1d4ed8", 3.5);
  }
  if (showControlPoints && edgePoint) {
    drawPoint(toViewX(edgePoint.x), toViewY(edgePoint.y), "#111", 4);
  }
  if (showControlPoints && lineP1) {
    const p1x = toViewX(lineP1.x);
    const p1y = toViewY(lineP1.y);
    drawPoint(p1x, p1y, "#2563eb", 4);
    drawTag("P1", p1x + 8, p1y - 8);
  }
  if (showControlPoints && lineP2) {
    const p2x = toViewX(lineP2.x);
    const p2y = toViewY(lineP2.y);
    drawPoint(p2x, p2y, "#2563eb", 4);
    drawTag("P2", p2x + 8, p2y - 8);
  }
  if (showNapArrow && lineP1 && lineP2) {
    overlayCtx.strokeStyle = "rgba(37,99,235,0.8)";
    overlayCtx.lineWidth = 2;
    overlayCtx.beginPath();
    overlayCtx.moveTo(toViewX(lineP1.x), toViewY(lineP1.y));
    overlayCtx.lineTo(toViewX(lineP2.x), toViewY(lineP2.y));
    overlayCtx.stroke();
  }
  if (showNapArrow && napVector) {
    drawArrow(
      overlayCtx,
      toViewX(napVector.from.x),
      toViewY(napVector.from.y),
      toViewX(napVector.to.x),
      toViewY(napVector.to.y),
      "#dc2626",
      1
    );
  }
  if (showBbox && modelStats?.bboxW && modelStats?.bboxH) {
    const bw = modelStats.bboxW;
    const bh = modelStats.bboxH;
    const bboxMmW = Number.isFinite(dpiX) && dpiX > 0 ? (bw * 25.4) / dpiX : null;
    const bboxMmH = Number.isFinite(dpiY) && dpiY > 0 ? (bh * 25.4) / dpiY : null;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (!polygonMask?.[y * canvas.width + x]) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (minX <= maxX && minY <= maxY) {
      const sx = toViewX(minX);
      const sy = toViewY(minY);
      const sw = Math.max(1, (maxX - minX + 1) * drawScaleX);
      const sh = Math.max(1, (maxY - minY + 1) * drawScaleY);
      overlayCtx.strokeStyle = "#4b5563";
      overlayCtx.setLineDash([6, 4]);
      overlayCtx.lineWidth = 1.5;
      overlayCtx.strokeRect(sx, sy, sw, sh);
      overlayCtx.setLineDash([]);
      if (Number.isFinite(bboxMmW) && Number.isFinite(bboxMmH)) {
        drawTag(`bbox ${Math.round(bboxMmW)}x${Math.round(bboxMmH)} мм`, sx + 6, Math.max(16, sy - 6));
      } else {
        drawTag(`bbox ${bw}x${bh} px`, sx + 6, Math.max(16, sy - 6));
      }
    }
  }
  if (showEdgeDistances && lineP1 && lineP2) {
    const d1 = formatDist(toMmDistance(getEdgeDistance(lineP1.x, lineP1.y)), getEdgeDistance(lineP1.x, lineP1.y));
    const d2 = formatDist(toMmDistance(getEdgeDistance(lineP2.x, lineP2.y)), getEdgeDistance(lineP2.x, lineP2.y));
    drawTag(`d1=${d1}`, toViewX(lineP1.x) + 12, toViewY(lineP1.y) + 16);
    drawTag(`d2=${d2}`, toViewX(lineP2.x) + 12, toViewY(lineP2.y) + 16);
  }
}
