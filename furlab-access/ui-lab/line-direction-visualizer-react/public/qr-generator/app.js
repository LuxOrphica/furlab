"use strict";

const TAG_RE = /^FL-SCR-[0-9]{6}$/;

const modeSingleBtn = document.getElementById("modeSingleBtn");
const modeSheetBtn = document.getElementById("modeSheetBtn");
const singleSection = document.getElementById("singleSection");
const sheetSection = document.getElementById("sheetSection");

const tagInput = document.getElementById("inventoryTag");
const validationMessage = document.getElementById("validationMessage");
const payloadText = document.getElementById("payloadText");
const qrBox = document.getElementById("qrBox");
const generateBtn = document.getElementById("generateBtn");
const clearBtn = document.getElementById("clearBtn");
const downloadPngBtn = document.getElementById("downloadPngBtn");
const downloadSvgBtn = document.getElementById("downloadSvgBtn");
const photoInput = document.getElementById("photoInput");
const stickerPxHint = document.getElementById("stickerPxHint");
const scanZoomInput = document.getElementById("scanZoomInput");
const scanZoomValue = document.getElementById("scanZoomValue");
const toggleFurLineBtn = document.getElementById("toggleFurLineBtn");
const resetFurLineBtn = document.getElementById("resetFurLineBtn");
const resetStickerBtn = document.getElementById("resetStickerBtn");
const saveComposedBtn = document.getElementById("saveComposedBtn");
const photoComposeMessage = document.getElementById("photoComposeMessage");
const composeCanvas = document.getElementById("composeCanvas");
const composeCtx = composeCanvas.getContext("2d");

const sheetTagsInput = document.getElementById("sheetTagsInput");
const sheetRangeFromInput = document.getElementById("sheetRangeFromInput");
const sheetRangeToInput = document.getElementById("sheetRangeToInput");
const addRangeBtn = document.getElementById("addRangeBtn");
const sheetColsInput = document.getElementById("sheetColsInput");
const sheetRowsInput = document.getElementById("sheetRowsInput");
const sheetMessage = document.getElementById("sheetMessage");
const previewSheetBtn = document.getElementById("previewSheetBtn");
const printSheetBtn = document.getElementById("printSheetBtn");
const downloadSheetHtmlBtn = document.getElementById("downloadSheetHtmlBtn");
const showRegistryBtn = document.getElementById("showRegistryBtn");
const registryPanel = document.getElementById("registryPanel");
const registrySummary = document.getElementById("registrySummary");
const registryListOutput = document.getElementById("registryListOutput");

let lastPayload = "";
let lastSvg = "";
let lastSheetHtml = "";
let lastSheetTags = [];
let lastIssueCommitted = false;
let stickerSvgDataUrl = "";
let stickerImage = null;
let photoImage = null;
let imageRect = null;
let stickerRect = null;
let isDraggingSticker = false;
let dragDx = 0;
let dragDy = 0;
let markerMode = false;
let markerStrokes = [];
let activeMarkerStroke = null;
let showFurLine = false;
let furLine = null;
let draggingLinePoint = null;
const FIXED_STICKER_MM = 22;
const FIXED_WORK_DPI = 150;
const STICKER_W_PX = 170;
const STICKER_H_PX = 185;
const STICKER_ASPECT = STICKER_H_PX / STICKER_W_PX;
const DEFAULT_SHEET_COLS = 7;
const DEFAULT_SHEET_ROWS = 8;
const DEFAULT_SHEET_CAPACITY = DEFAULT_SHEET_COLS * DEFAULT_SHEET_ROWS;

function normalizeTag(raw) {
  const clean = String(raw || "").trim().toUpperCase();
  if (!clean) return "";
  const strict = clean.match(/^FL-SCR-([0-9]{6})$/);
  if (strict) return `FL-SCR-${strict[1]}`;
  const digits = clean.replace(/\D+/g, "");
  if (digits.length === 6) return `FL-SCR-${digits}`;
  return clean;
}

function maskTagInputValue(raw) {
  const clean = String(raw || "").toUpperCase();
  const digits = clean.replace(/\D+/g, "").slice(0, 6);
  if (!clean.trim()) return "";
  return `FL-SCR-${digits}`;
}

function isValidTag(tag) {
  return TAG_RE.test(String(tag || "").trim().toUpperCase());
}

function setMessage(node, text, type) {
  node.textContent = text || "";
  node.className = `msg ${type || ""}`.trim();
}

function renderQrSvg(tag, cellSize = 5, margin = 2) {
  const qr = qrcode(0, "M");
  qr.addData(tag);
  qr.make();
  return qr.createSvgTag({ cellSize, margin });
}

function svgToDataUrl(svgText) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
}

function xmlEscape(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildStickerSvg(tag) {
  const qr = qrcode(0, "M");
  qr.addData(tag);
  qr.make();
  const moduleCount = qr.getModuleCount();
  const marginModules = 2;
  const stickerW = STICKER_W_PX;
  const stickerH = STICKER_H_PX;
  const qrSize = 154;
  const qrX = 8;
  const qrY = 6;
  const totalModules = moduleCount + marginModules * 2;
  const cell = qrSize / totalModules;

  let qrRects = "";
  for (let r = 0; r < moduleCount; r += 1) {
    for (let c = 0; c < moduleCount; c += 1) {
      if (!qr.isDark(r, c)) continue;
      const x = qrX + (c + marginModules) * cell;
      const y = qrY + (r + marginModules) * cell;
      qrRects += `<rect x="${x.toFixed(4)}" y="${y.toFixed(4)}" width="${cell.toFixed(4)}" height="${cell.toFixed(4)}" fill="#000"/>`;
    }
  }

  const safeTag = xmlEscape(tag);
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${stickerW}" height="${stickerH}" viewBox="0 0 ${stickerW} ${stickerH}">
  <rect x="0.5" y="0.5" width="${stickerW - 1}" height="${stickerH - 1}" rx="8" ry="8" fill="#ffffff" stroke="#cbd5e1"/>
  ${qrRects}
  <text x="${stickerW / 2}" y="171" text-anchor="middle" font-family="Consolas, Menlo, 'DejaVu Sans Mono', monospace" font-size="17" font-weight="700" fill="#111827">${safeTag}</text>
</svg>`.trim();
}

function setComposeMessage(text, type) {
  setMessage(photoComposeMessage, text, type);
}

function updateFurLineToggleUi() {
  if (!toggleFurLineBtn) return;
  toggleFurLineBtn.classList.toggle("active-toggle", !!markerMode);
}

function updateMarkerButtonsState() {
  if (!resetFurLineBtn) return;
  resetFurLineBtn.disabled = markerStrokes.length === 0 && !activeMarkerStroke;
}

function ensureDefaultFurLine() {
  if (furLine) return;
  furLine = {
    x1: 0.35,
    y1: 0.68,
    x2: 0.65,
    y2: 0.38
  };
}

function getCanvasPointFromClient(clientX, clientY) {
  const rect = composeCanvas.getBoundingClientRect();
  const sx = rect.width > 0 ? composeCanvas.width / rect.width : 1;
  const sy = rect.height > 0 ? composeCanvas.height / rect.height : 1;
  return {
    x: (clientX - rect.left) * sx,
    y: (clientY - rect.top) * sy
  };
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function isPointInImageRect(pt) {
  if (!imageRect) return false;
  return pt.x >= imageRect.x && pt.x <= imageRect.x + imageRect.w && pt.y >= imageRect.y && pt.y <= imageRect.y + imageRect.h;
}

function canvasPointToNormalized(pt) {
  if (!imageRect) return null;
  const nx = (pt.x - imageRect.x) / imageRect.w;
  const ny = (pt.y - imageRect.y) / imageRect.h;
  return {
    x: Math.max(0, Math.min(1, nx)),
    y: Math.max(0, Math.min(1, ny))
  };
}

function drawMarkerStrokesOnStage(ctx) {
  if (!imageRect) return;
  if (!markerStrokes.length && !activeMarkerStroke) return;
  const lineW = Math.max(2, imageRect.w * 0.004);
  ctx.save();
  ctx.strokeStyle = "#111111";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = lineW;
  const all = activeMarkerStroke ? markerStrokes.concat([activeMarkerStroke]) : markerStrokes;
  for (const stroke of all) {
    if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 2) continue;
    ctx.beginPath();
    for (let i = 0; i < stroke.points.length; i += 1) {
      const p = stroke.points[i];
      const x = imageRect.x + p.x * imageRect.w;
      const y = imageRect.y + p.y * imageRect.h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawMarkerStrokesOnOutput(ctx, outW, outH) {
  if (!markerStrokes.length) return;
  const lineW = Math.max(2.5, outW * 0.004);
  ctx.save();
  ctx.strokeStyle = "#111111";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = lineW;
  for (const stroke of markerStrokes) {
    if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 2) continue;
    ctx.beginPath();
    for (let i = 0; i < stroke.points.length; i += 1) {
      const p = stroke.points[i];
      const x = p.x * outW;
      const y = p.y * outH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function getFurLineCanvasPoints() {
  if (!furLine || !imageRect) return null;
  return {
    x1: imageRect.x + furLine.x1 * imageRect.w,
    y1: imageRect.y + furLine.y1 * imageRect.h,
    x2: imageRect.x + furLine.x2 * imageRect.w,
    y2: imageRect.y + furLine.y2 * imageRect.h
  };
}

function drawArrow(ctx, x1, y1, x2, y2) {
  ctx.save();
  ctx.strokeStyle = "#dc2626";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = 13;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 7), y2 - headLen * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 7), y2 - headLen * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fillStyle = "#dc2626";
  ctx.fill();
  ctx.restore();
}

function drawFurLineHandles(ctx, x, y, label) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#111827";
  ctx.font = "600 12px Segoe UI";
  ctx.fillText(label, x + 8, y - 8);
  ctx.restore();
}

function drawFurLine(ctx) {
  if (!showFurLine) return;
  const p = getFurLineCanvasPoints();
  if (!p) return;
  drawArrow(ctx, p.x1, p.y1, p.x2, p.y2);
  drawFurLineHandles(ctx, p.x1, p.y1, "P1");
  drawFurLineHandles(ctx, p.x2, p.y2, "P2");
}

function hitTestFurLineHandle(pt) {
  if (!showFurLine) return null;
  const p = getFurLineCanvasPoints();
  if (!p) return null;
  const r2 = 10 * 10;
  const d1 = (pt.x - p.x1) ** 2 + (pt.y - p.y1) ** 2;
  if (d1 <= r2) return "p1";
  const d2 = (pt.x - p.x2) ** 2 + (pt.y - p.y2) ** 2;
  if (d2 <= r2) return "p2";
  return null;
}

function setFurLinePointFromCanvas(which, pt) {
  if (!furLine || !imageRect) return;
  const nx = (pt.x - imageRect.x) / imageRect.w;
  const ny = (pt.y - imageRect.y) / imageRect.h;
  const cx = Math.max(0, Math.min(1, nx));
  const cy = Math.max(0, Math.min(1, ny));
  if (which === "p1") {
    furLine.x1 = cx;
    furLine.y1 = cy;
  } else if (which === "p2") {
    furLine.x2 = cx;
    furLine.y2 = cy;
  }
}

function hitTestSticker(pt) {
  if (!stickerRect) return false;
  return (
    pt.x >= stickerRect.x &&
    pt.x <= stickerRect.x + stickerRect.w &&
    pt.y >= stickerRect.y &&
    pt.y <= stickerRect.y + stickerRect.h
  );
}

function updateStickerSize() {
  if (!photoImage || !imageRect) return;
  const stickerOrigPx = (FIXED_STICKER_MM * FIXED_WORK_DPI) / 25.4;
  const previewScale = imageRect.w / photoImage.width;
  let stickerW = stickerOrigPx * previewScale;
  stickerW = Math.max(50, Math.min(imageRect.w * 0.95, stickerW));
  const stickerH = stickerW * STICKER_ASPECT;
  if (stickerPxHint) stickerPxHint.textContent = `~${Math.round(stickerOrigPx)} px`;
  if (!stickerRect) {
    stickerRect = {
      x: imageRect.x + (imageRect.w - stickerW) / 2,
      y: imageRect.y + (imageRect.h - stickerH) / 2,
      w: stickerW,
      h: stickerH
    };
  } else {
    const cx = stickerRect.x + stickerRect.w / 2;
    const cy = stickerRect.y + stickerRect.h / 2;
    stickerRect.w = stickerW;
    stickerRect.h = stickerH;
    stickerRect.x = cx - stickerW / 2;
    stickerRect.y = cy - stickerH / 2;
  }
}

function clampStickerToImage() {
  if (!stickerRect || !imageRect) return;
  const maxX = imageRect.x + imageRect.w - stickerRect.w;
  const maxY = imageRect.y + imageRect.h - stickerRect.h;
  stickerRect.x = Math.max(imageRect.x, Math.min(maxX, stickerRect.x));
  stickerRect.y = Math.max(imageRect.y, Math.min(maxY, stickerRect.y));
}

function fitImageRect(img) {
  const pad = 12;
  const availW = composeCanvas.width - pad * 2;
  const availH = composeCanvas.height - pad * 2;
  const zoom = Math.max(80, Math.min(220, Number(scanZoomInput?.value || 120))) / 100;
  if (scanZoomValue) scanZoomValue.textContent = `${Math.round(zoom * 100)}%`;
  const baseScale = Math.min(availW / img.width, availH / img.height);
  const scale = baseScale * zoom;
  const w = Math.max(1, img.width * scale);
  const h = Math.max(1, img.height * scale);
  const x = (composeCanvas.width - w) / 2;
  const y = (composeCanvas.height - h) / 2;
  return { x, y, w, h };
}

function drawStickerOnContext(ctx, x, y, w, h) {
  if (!stickerImage) return;
  ctx.drawImage(stickerImage, x, y, w, h);
}

function drawComposeStage() {
  composeCtx.clearRect(0, 0, composeCanvas.width, composeCanvas.height);
  composeCtx.fillStyle = "#e2e8f0";
  composeCtx.fillRect(0, 0, composeCanvas.width, composeCanvas.height);

  if (!photoImage) {
    composeCtx.fillStyle = "#64748b";
    composeCtx.font = "600 20px Segoe UI";
    composeCtx.textAlign = "center";
    composeCtx.textBaseline = "middle";
    composeCtx.fillText("Загрузите фото для примерки QR", composeCanvas.width / 2, composeCanvas.height / 2);
    return;
  }

  imageRect = fitImageRect(photoImage);
  composeCtx.drawImage(photoImage, imageRect.x, imageRect.y, imageRect.w, imageRect.h);
  ensureDefaultFurLine();
  if (!stickerRect) updateStickerSize();
  clampStickerToImage();
  if (!stickerRect) return;

  drawStickerOnContext(composeCtx, stickerRect.x, stickerRect.y, stickerRect.w, stickerRect.h);
  drawMarkerStrokesOnStage(composeCtx);
  drawFurLine(composeCtx);
}

function resetStickerPosition() {
  if (!photoImage || !imageRect) return;
  stickerRect = null;
  updateStickerSize();
  clampStickerToImage();
  drawComposeStage();
}

function loadPhotoFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      photoImage = img;
      stickerRect = null;
      markerStrokes = [];
      activeMarkerStroke = null;
      furLine = null;
      updateStickerSize();
      clampStickerToImage();
      drawComposeStage();
      resetStickerBtn.disabled = false;
      updateMarkerButtonsState();
      saveComposedBtn.disabled = false;
      setComposeMessage("Фото загружено. Перетащите стикер или включите Маркер для рисования.", "ok");
    };
    img.onerror = () => {
      setComposeMessage("Не удалось прочитать изображение.", "error");
    };
    img.src = String(reader.result || "");
  };
  reader.onerror = () => setComposeMessage("Ошибка чтения файла.", "error");
  reader.readAsDataURL(file);
}

function renderLabelPreview(tag) {
  if (!stickerSvgDataUrl) return "";
  return `<img class="label-preview-img" alt="QR sticker ${tag}" src="${stickerSvgDataUrl}" />`;
}

function clearSinglePreview() {
  qrBox.innerHTML = "";
  payloadText.textContent = "-";
  lastPayload = "";
  lastSvg = "";
  downloadPngBtn.disabled = true;
  downloadSvgBtn.disabled = true;
  stickerSvgDataUrl = "";
  stickerImage = null;
  drawComposeStage();
}

function setMode(mode) {
  const single = mode === "single";
  singleSection.classList.toggle("hidden", !single);
  sheetSection.classList.toggle("hidden", single);
  modeSingleBtn.classList.toggle("active", single);
  modeSheetBtn.classList.toggle("active", !single);
  modeSingleBtn.setAttribute("aria-selected", single ? "true" : "false");
  modeSheetBtn.setAttribute("aria-selected", single ? "false" : "true");
}

function getModeFromUrl() {
  const mode = new URLSearchParams(window.location.search).get("mode");
  return mode === "sheet" ? "sheet" : "single";
}

function navigateToMode(mode) {
  const url = new URL(window.location.href);
  url.searchParams.set("mode", mode === "sheet" ? "sheet" : "single");
  window.location.href = url.toString();
}

function downloadFile(href, fileName) {
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function svgToPngDataUrl(svgText) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("svg_to_png_failed"));
    };
    img.src = url;
  });
}

function parseTags(rawText) {
  const lines = String(rawText || "")
    .split(/\r?\n/g)
    .map((x) => normalizeTag(x))
    .filter(Boolean);

  const valid = [];
  const invalid = [];
  const counts = new Map();
  for (const t of lines) {
    if (isValidTag(t)) {
      valid.push(t);
      counts.set(t, (counts.get(t) || 0) + 1);
    } else {
      invalid.push(t);
    }
  }
  const duplicates = Array.from(counts.entries())
    .filter(([, c]) => c > 1)
    .map(([tag, count]) => ({ tag, count }));
  return { valid, invalid, duplicates };
}

function toTagFromNumber(n) {
  const x = Math.max(1, Math.min(999999, Number(n) || 0));
  const num = String(Math.trunc(x)).padStart(6, "0");
  return `FL-SCR-${num}`;
}

function addRangeToSheet() {
  const from = Number(sheetRangeFromInput.value || 0);
  const to = Number(sheetRangeToInput.value || 0);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < 1 || from > 999999 || to > 999999) {
    setMessage(sheetMessage, "Диапазон должен быть в пределах 1..999999.", "error");
    return;
  }
  if (from > to) {
    setMessage(sheetMessage, "Начало диапазона должно быть меньше или равно концу.", "error");
    return;
  }
  const maxAppend = 2000;
  const count = to - from + 1;
  if (count > maxAppend) {
    setMessage(sheetMessage, `Слишком большой диапазон (${count}). Максимум за раз: ${maxAppend}.`, "error");
    return;
  }
  const rows = [];
  for (let i = from; i <= to; i += 1) rows.push(toTagFromNumber(i));
  const current = String(sheetTagsInput.value || "").trim();
  sheetTagsInput.value = current ? `${current}\n${rows.join("\n")}` : rows.join("\n");
  const nextFrom = to + 1;
  const nextTo = Math.min(999999, nextFrom + DEFAULT_SHEET_CAPACITY - 1);
  sheetRangeFromInput.value = String(nextFrom);
  sheetRangeToInput.value = String(nextTo);
  setMessage(sheetMessage, `Добавлено меток: ${count}.`, "ok");
}

function buildSheetHtml(tags, cols, rows) {
  const maxPerPage = cols * rows;
  const pages = [];
  for (let i = 0; i < tags.length; i += maxPerPage) {
    pages.push(tags.slice(i, i + maxPerPage));
  }
  const pagesHtml = pages
    .map((pageTags, pageIdx) => {
      const cells = pageTags
        .map((tag) => {
          const svg = renderQrSvg(tag, 2, 1);
          return `
        <div class="label">
          <div class="qr">${svg}</div>
          <div class="txt">${tag}</div>
        </div>
      `;
        })
        .join("");
      return `<div class="sheet-page${pageIdx < pages.length - 1 ? " break-after" : ""}"><div class="sheet">${cells}</div></div>`;
    })
    .join("");

  return `
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>FurLab QR Sheet</title>
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; }
    .sheet-page { width: 100%; }
    .sheet-page.break-after { page-break-after: always; break-after: page; }
    .sheet {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(${cols}, 22mm);
      grid-auto-rows: 24mm;
      gap: 0;
      justify-content: start;
      align-content: start;
    }
    .label {
      width: 22mm;
      height: 24mm;
      box-sizing: border-box;
      border: 0.2mm dashed #d0d0d0;
      display: grid;
      grid-template-rows: 16.8mm 1fr;
      place-items: center;
      padding: 0.8mm;
    }
    .qr svg { width: 15.8mm; height: 15.8mm; display: block; }
    .txt {
      width: 21.2mm;
      text-align: center;
      font-size: 1.9mm;
      line-height: 1.05;
      font-family: Consolas, Menlo, 'DejaVu Sans Mono', monospace;
      font-weight: 600;
      letter-spacing: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    @media print {
      .label { border-color: transparent; }
    }
  </style>
</head>
<body>
  ${pagesHtml}
</body>
</html>`;
}

async function apiPost(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
  let json = null;
  try {
    json = await res.json();
  } catch (_) {}
  if (!res.ok || !json || json.ok !== true) {
    const msg = json?.error || `http_${res.status}`;
    throw new Error(msg);
  }
  return json;
}

async function apiGet(url) {
  const res = await fetch(url, { method: "GET" });
  let json = null;
  try {
    json = await res.json();
  } catch (_) {}
  if (!res.ok || !json || json.ok !== true) {
    const msg = json?.error || `http_${res.status}`;
    throw new Error(msg);
  }
  return json;
}

async function toggleRegistryPanel() {
  const isHidden = registryPanel.classList.contains("hidden");
  if (!isHidden) {
    registryPanel.classList.add("hidden");
    showRegistryBtn.textContent = "Показать занятые коды";
    return;
  }
  registryPanel.classList.remove("hidden");
  showRegistryBtn.textContent = "Скрыть занятые коды";
  registrySummary.textContent = "Загрузка реестра...";
  registryListOutput.value = "";
  try {
    const [stats, list] = await Promise.all([
      apiGet("/api/qr-registry/stats"),
      apiGet("/api/qr-registry/list?limit=200")
    ]);
    const items = Array.isArray(list.items) ? list.items : [];
    registrySummary.textContent = `Уникальных кодов: ${stats.uniqueTags}. Показано последних: ${items.length}.`;
    if (!items.length) {
      registryListOutput.value = "(пусто)";
      return;
    }
    registryListOutput.value = items
      .map((x) => {
        const tag = String(x?.tag || "");
        const issuedAt = String(x?.issuedAt || "");
        const source = String(x?.source || "");
        return `${tag} | ${issuedAt} | ${source}`;
      })
      .join("\n");
  } catch (err) {
    registrySummary.textContent = `Ошибка загрузки реестра: ${err?.message || err}`;
    registryListOutput.value = "";
  }
}

async function generateSingle() {
  const tag = normalizeTag(tagInput.value);
  tagInput.value = tag;
  if (!isValidTag(tag)) {
    clearSinglePreview();
    setMessage(validationMessage, "Неверный формат. Используйте FL-SCR-000123 (6 цифр).", "error");
    return;
  }
  lastSvg = buildStickerSvg(tag);
  stickerSvgDataUrl = svgToDataUrl(lastSvg);
  stickerImage = new Image();
  stickerImage.onload = () => {
    if (photoImage) drawComposeStage();
  };
  stickerImage.src = stickerSvgDataUrl;
  qrBox.innerHTML = renderLabelPreview(tag);
  payloadText.textContent = tag;
  lastPayload = tag;
  downloadPngBtn.disabled = false;
  downloadSvgBtn.disabled = false;
  setMessage(validationMessage, "QR успешно сгенерирован.", "ok");
  if (photoImage) {
    drawComposeStage();
  }
}

async function generateSheet() {
  const cols = Math.max(1, Math.min(8, Number(sheetColsInput.value || DEFAULT_SHEET_COLS)));
  const rows = Math.max(1, Math.min(12, Number(sheetRowsInput.value || DEFAULT_SHEET_ROWS)));
  const capacityPerPage = cols * rows;
  sheetColsInput.value = String(cols);
  sheetRowsInput.value = String(rows);

  const parsed = parseTags(sheetTagsInput.value);
  if (!parsed.valid.length) {
    lastSheetHtml = "";
    printSheetBtn.disabled = true;
    downloadSheetHtmlBtn.disabled = true;
    setMessage(sheetMessage, "Нет валидных меток для листа.", "error");
    return;
  }
  if (parsed.duplicates.length) {
    lastSheetHtml = "";
    printSheetBtn.disabled = true;
    downloadSheetHtmlBtn.disabled = true;
    const dupText = parsed.duplicates.map((d) => `${d.tag} x${d.count}`).join(", ");
    setMessage(
      sheetMessage,
      `Найдены дубли меток: ${dupText}. Удалите повторы и соберите лист снова.`,
      "error"
    );
    return;
  }
  try {
    const check = await apiPost("/api/qr-registry/check", { tags: parsed.valid });
    if (Array.isArray(check.invalid) && check.invalid.length) {
      lastSheetHtml = "";
      lastSheetTags = [];
      lastIssueCommitted = false;
      printSheetBtn.disabled = true;
      downloadSheetHtmlBtn.disabled = true;
      setMessage(sheetMessage, `Невалидные коды для реестра: ${check.invalid.join(", ")}.`, "error");
      return;
    }
    if (Array.isArray(check.existing) && check.existing.length) {
      lastSheetHtml = "";
      lastSheetTags = [];
      lastIssueCommitted = false;
      printSheetBtn.disabled = true;
      downloadSheetHtmlBtn.disabled = true;
      const list = check.existing.map((x) => x.tag).join(", ");
      setMessage(sheetMessage, `Эти коды уже использованы: ${list}. Уберите их из листа.`, "error");
      return;
    }
  } catch (err) {
    lastSheetHtml = "";
    lastSheetTags = [];
    lastIssueCommitted = false;
    printSheetBtn.disabled = true;
    downloadSheetHtmlBtn.disabled = true;
    setMessage(sheetMessage, `Не удалось проверить реестр кодов: ${err?.message || err}`, "error");
    return;
  }
  const pages = Math.max(1, Math.ceil(parsed.valid.length / Math.max(1, capacityPerPage)));
  if (parsed.invalid.length) {
    setMessage(
      sheetMessage,
      `Валидных: ${parsed.valid.length}. Невалидных: ${parsed.invalid.length}. Страниц A4: ${pages}.`,
      "error"
    );
  } else {
    setMessage(
      sheetMessage,
      `Подготовлено меток: ${parsed.valid.length}. Страниц A4: ${pages}. Реестр: свободны.`,
      "ok"
    );
  }

  lastSheetHtml = buildSheetHtml(parsed.valid, cols, rows);
  lastSheetTags = parsed.valid.slice();
  lastIssueCommitted = false;
  printSheetBtn.disabled = false;
  downloadSheetHtmlBtn.disabled = false;
}

async function ensureIssueCommitted() {
  if (lastIssueCommitted) return true;
  if (!Array.isArray(lastSheetTags) || !lastSheetTags.length) return false;
  try {
    await apiPost("/api/qr-registry/issue", {
      tags: lastSheetTags,
      source: "qr-generator-sheet"
    });
    lastIssueCommitted = true;
    return true;
  } catch (err) {
    setMessage(sheetMessage, `Не удалось зафиксировать коды в реестре: ${err?.message || err}`, "error");
    return false;
  }
}

modeSingleBtn.addEventListener("click", () => navigateToMode("single"));
modeSheetBtn.addEventListener("click", () => navigateToMode("sheet"));

generateBtn.addEventListener("click", () => {
  void generateSingle();
});

tagInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    void generateSingle();
  }
});

tagInput.addEventListener("input", () => {
  const masked = maskTagInputValue(tagInput.value);
  tagInput.value = masked;
});

tagInput.addEventListener("paste", (e) => {
  e.preventDefault();
  const text = e.clipboardData?.getData("text") || "";
  const masked = maskTagInputValue(text);
  tagInput.value = masked;
  tagInput.dispatchEvent(new Event("input", { bubbles: true }));
});

clearBtn.addEventListener("click", () => {
  tagInput.value = "";
  clearSinglePreview();
  setMessage(validationMessage, "", "");
});

photoInput.addEventListener("change", (e) => {
  const file = e.target?.files?.[0];
  loadPhotoFile(file);
});

scanZoomInput.addEventListener("input", () => {
  drawComposeStage();
});

if (toggleFurLineBtn) {
  toggleFurLineBtn.addEventListener("click", () => {
    markerMode = !markerMode;
    if (markerMode) showFurLine = false;
    updateFurLineToggleUi();
    drawComposeStage();
  });
}

if (resetFurLineBtn) {
  resetFurLineBtn.addEventListener("click", () => {
    markerStrokes = [];
    activeMarkerStroke = null;
    updateMarkerButtonsState();
    drawComposeStage();
  });
}

resetStickerBtn.addEventListener("click", () => {
  resetStickerPosition();
});

saveComposedBtn.addEventListener("click", () => {
  if (!photoImage || !stickerRect || !imageRect) return;
  const out = document.createElement("canvas");
  out.width = photoImage.width;
  out.height = photoImage.height;
  const outCtx = out.getContext("2d");
  outCtx.drawImage(photoImage, 0, 0, out.width, out.height);
  const scaleX = out.width / imageRect.w;
  const scaleY = out.height / imageRect.h;
  const sx = (stickerRect.x - imageRect.x) * scaleX;
  const sy = (stickerRect.y - imageRect.y) * scaleY;
  const sw = stickerRect.w * scaleX;
  const sh = stickerRect.h * scaleY;
  drawStickerOnContext(outCtx, sx, sy, sw, sh);
  drawMarkerStrokesOnOutput(outCtx, out.width, out.height);
  if (showFurLine && furLine) {
    drawArrow(outCtx, furLine.x1 * out.width, furLine.y1 * out.height, furLine.x2 * out.width, furLine.y2 * out.height);
  }
  const dataUrl = out.toDataURL("image/png");
  const fn = `${lastPayload || "sticker"}_placed.png`;
  downloadFile(dataUrl, fn);
});

composeCanvas.addEventListener("pointerdown", (e) => {
  if (!photoImage || !stickerRect) return;
  const pt = getCanvasPointFromClient(e.clientX, e.clientY);
  if (markerMode && isPointInImageRect(pt)) {
    const npt = canvasPointToNormalized(pt);
    if (npt) {
      activeMarkerStroke = { points: [npt] };
      composeCanvas.classList.add("dragging");
      composeCanvas.setPointerCapture(e.pointerId);
      updateMarkerButtonsState();
      drawComposeStage();
    }
    return;
  }
  const hitHandle = hitTestFurLineHandle(pt);
  if (hitHandle) {
    draggingLinePoint = hitHandle;
    composeCanvas.classList.add("dragging");
    composeCanvas.setPointerCapture(e.pointerId);
    return;
  }
  if (!hitTestSticker(pt)) return;
  isDraggingSticker = true;
  dragDx = pt.x - stickerRect.x;
  dragDy = pt.y - stickerRect.y;
  composeCanvas.classList.add("dragging");
  composeCanvas.setPointerCapture(e.pointerId);
});

composeCanvas.addEventListener("pointermove", (e) => {
  if (activeMarkerStroke) {
    const pt = getCanvasPointFromClient(e.clientX, e.clientY);
    if (isPointInImageRect(pt)) {
      const npt = canvasPointToNormalized(pt);
      if (npt) {
        const points = activeMarkerStroke.points;
        const last = points[points.length - 1];
        if (!last || Math.abs(last.x - npt.x) > 0.001 || Math.abs(last.y - npt.y) > 0.001) {
          points.push(npt);
        }
      }
      drawComposeStage();
    }
    return;
  }
  if (draggingLinePoint) {
    const pt = getCanvasPointFromClient(e.clientX, e.clientY);
    setFurLinePointFromCanvas(draggingLinePoint, pt);
    drawComposeStage();
    return;
  }
  if (!isDraggingSticker || !stickerRect) return;
  const pt = getCanvasPointFromClient(e.clientX, e.clientY);
  stickerRect.x = pt.x - dragDx;
  stickerRect.y = pt.y - dragDy;
  clampStickerToImage();
  drawComposeStage();
});

function endDrag(e) {
  if (activeMarkerStroke) {
    if (activeMarkerStroke.points.length >= 2) {
      markerStrokes.push(activeMarkerStroke);
    }
    activeMarkerStroke = null;
    updateMarkerButtonsState();
    composeCanvas.classList.remove("dragging");
    try {
      composeCanvas.releasePointerCapture(e.pointerId);
    } catch (_) {}
    drawComposeStage();
    return;
  }
  if (draggingLinePoint) {
    draggingLinePoint = null;
    composeCanvas.classList.remove("dragging");
    try {
      composeCanvas.releasePointerCapture(e.pointerId);
    } catch (_) {}
    return;
  }
  if (!isDraggingSticker) return;
  isDraggingSticker = false;
  composeCanvas.classList.remove("dragging");
  try {
    composeCanvas.releasePointerCapture(e.pointerId);
  } catch (_) {}
}

composeCanvas.addEventListener("pointerup", endDrag);
composeCanvas.addEventListener("pointercancel", endDrag);

downloadSvgBtn.addEventListener("click", () => {
  if (!lastSvg || !lastPayload) return;
  const blob = new Blob([lastSvg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  downloadFile(url, `${lastPayload}.svg`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

downloadPngBtn.addEventListener("click", async () => {
  if (!lastSvg || !lastPayload) return;
  try {
    const pngDataUrl = await svgToPngDataUrl(lastSvg);
    downloadFile(pngDataUrl, `${lastPayload}.png`);
  } catch {
    setMessage(validationMessage, "Не удалось экспортировать PNG.", "error");
  }
});

previewSheetBtn.addEventListener("click", () => {
  void generateSheet();
});

addRangeBtn.addEventListener("click", () => {
  addRangeToSheet();
});

showRegistryBtn.addEventListener("click", () => {
  void toggleRegistryPanel();
});

downloadSheetHtmlBtn.addEventListener("click", () => {
  if (!lastSheetHtml) return;
  void (async () => {
    const ok = await ensureIssueCommitted();
    if (!ok) return;
    const blob = new Blob([lastSheetHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    downloadFile(url, "furlab_qr_sheet.html");
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(sheetMessage, `Лист сохранен. Коды зафиксированы в реестре (${lastSheetTags.length}).`, "ok");
  })();
});

printSheetBtn.addEventListener("click", () => {
  if (!lastSheetHtml) return;
  void (async () => {
    const ok = await ensureIssueCommitted();
    if (!ok) return;
    const w = window.open("", "_blank");
    if (!w) {
      setMessage(sheetMessage, "Браузер заблокировал окно печати.", "error");
      return;
    }
    w.document.open();
    w.document.write(lastSheetHtml);
    w.document.close();
    w.focus();
    setTimeout(() => {
      w.print();
    }, 200);
    setMessage(sheetMessage, `Печать открыта. Коды зафиксированы в реестре (${lastSheetTags.length}).`, "ok");
  })();
});

const initialMode = getModeFromUrl();
setMode(initialMode);
updateFurLineToggleUi();
updateMarkerButtonsState();
if (initialMode === "single") {
  void generateSingle();
  drawComposeStage();
}
