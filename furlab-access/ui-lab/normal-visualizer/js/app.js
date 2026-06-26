const fileInput = document.getElementById("fileInput");
const normalLengthInput = document.getElementById("normalLength");
const zoomInput = document.getElementById("zoomInput");
const zoomValue = document.getElementById("zoomValue");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const themeSelect = document.getElementById("themeSelect");
const clearBtn = document.getElementById("clearBtn");
const saveBtn = document.getElementById("saveBtn");
const uploadImageChk = document.getElementById("uploadImageChk");
const saveStatus = document.getElementById("saveStatus");
const canvas = document.getElementById("canvas");
const output = document.getElementById("output");
const modeInputs = document.querySelectorAll("input[name='mode']");
const ctx = canvas.getContext("2d");

const sourceCanvas = document.createElement("canvas");
const sourceCtx = sourceCanvas.getContext("2d");

let img = null;
let sourceData = null;
let polygonMask = null;
let outerBgMask = null;
let edgeDistanceMap = null;
let markerPoint = null;
let edgePoint = null;
let normal = null;
let markerMask = null;
let markerBox = null;
let markerArea = 0;
let mode = "auto";
let pointSource = null;
let modelStats = null;
const APP_VERSION = "1.6.0-access";
let cvReady = false;
let cvLoadError = null;
let lastDetector = "none";
let zoomPercent = 100;
let qrText = "(не распознан)";
let dpiX = null;
let dpiY = null;
let dpiSource = "unknown";
let sourceFile = null;
let apiReady = false;
const THEME_KEY = "ui_lab_theme";

initOpenCv();
initTheme();
checkApiHealth();

fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  sourceFile = file;
  setSaveStatus("", "");
  const url = URL.createObjectURL(file);
  const dpiPromise = parseDpiFromFile(file).catch(() => null);
  const image = new Image();
  image.onload = async () => {
    img = image;
    canvas.width = image.width;
    canvas.height = image.height;
    sourceCanvas.width = image.width;
    sourceCanvas.height = image.height;
    sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    sourceCtx.drawImage(image, 0, 0);
    sourceData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;

    const dpiInfo = await dpiPromise;
    if (dpiInfo && dpiInfo.x > 1 && dpiInfo.y > 1) {
      dpiX = dpiInfo.x;
      dpiY = dpiInfo.y;
      dpiSource = dpiInfo.source;
    } else {
      dpiX = null;
      dpiY = null;
      dpiSource = "not-found";
    }

    qrText = "(поиск...)";
    decodeQrFromSource();

    const model = buildPolygonModel();
    polygonMask = model.polygonMask;
    outerBgMask = model.outerBgMask;
    edgeDistanceMap = model.edgeDistanceMap;
    modelStats = model.stats;
    updateControlsState();

    edgePoint = null;
    normal = null;
    pointSource = null;
    draw();
    applyZoom();

    if (mode === "auto") {
      runAutoDetect();
    } else {
      output.textContent = "Изображение загружено. Ручной режим: кликни по кромке полигона.";
    }
  };
  image.src = url;
});

modeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    mode = getMode();
    updateControlsState();
    if (!img) {
      output.textContent = "Выбери изображение.";
      return;
    }
    if (mode === "auto") {
      runAutoDetect();
      return;
    }
    output.textContent = "Ручной режим: кликни по кромке, чтобы задать/исправить направление.";
  });
});

clearBtn.addEventListener("click", () => {
  if (mode !== "manual") return;
  markerMask = null;
  markerBox = null;
  markerArea = 0;
  markerPoint = null;
  edgePoint = null;
  normal = null;
  pointSource = null;
  draw();
  output.textContent = mode === "manual"
    ? "Очистил метки. Ручной режим: кликни по кромке."
    : "Очистил метки. Переключись в ручной режим или загрузи изображение заново.";
});

saveBtn.addEventListener("click", async () => {
  if (!img || !polygonMask) {
    output.textContent = "Сначала загрузи изображение.";
    return;
  }
  if (!edgePoint) {
    output.textContent = "Нет точки кромки. В авто-режиме дождись детекции или кликни вручную.";
    return;
  }

  const payload = buildSavePayload();
  if (!payload) return;

  if (uploadImageChk?.checked && sourceFile) {
    try {
      const src = await encodeSourceImage(sourceFile);
      payload.sourceImage = src;
      payload.metrics = payload.metrics || {};
      payload.metrics.sourceImageUploadRequested = true;
    } catch (e) {
      output.textContent = `${output.textContent}\n\nНе удалось подготовить файл для загрузки: ${e?.message || e}`;
      return;
    }
  }

  const prevText = output.textContent;
  saveBtn.disabled = true;
  setSaveStatus("pending", "Сохранение в Access...");
  output.textContent = `${prevText}\n\nСохранение в Access...`;
  try {
    let saveResult = await postSavePayload(payload, false);
    if (saveResult.exists) {
      setSaveStatus("warn", "Запись с таким inventoryTag уже есть.");
      const confirmed = window.confirm(`Запись с тегом ${payload.inventoryTag} уже существует.\nПерезаписать?`);
      if (!confirmed) {
        setSaveStatus("warn", "Сохранение отменено.");
        output.textContent = `${prevText}\n\nСохранение отменено: запись уже существует.`;
        return;
      }
      setSaveStatus("pending", "Перезапись существующей записи...");
      saveResult = await postSavePayload(payload, true);
    }

    if (!saveResult.ok) {
      output.textContent = `${prevText}\n\nОшибка сохранения в Access: ${saveResult.error}`;
      setSaveStatus("error", `Ошибка: ${saveResult.error}`);
      return;
    }

    const json = saveResult.data;
    output.textContent = `${prevText}\n\nСохранено в Access.
Тег: ${payload.inventoryTag}
Режим записи: ${json.writeMode || "-"}
БД: ${json.dbPath}
Лог: ${json.logPath || "-"}
Файл: ${json.sourceAssetRef || "(не сохранялся)"}`;
    setSaveStatus("success", "Запись успешна.");
  } catch (err) {
    output.textContent = `${prevText}\n\nОшибка сохранения в Access: ${err?.message || err}`;
    setSaveStatus("error", `Ошибка: ${err?.message || err}`);
  } finally {
    saveBtn.disabled = false;
    updateControlsState();
  }
});

canvas.addEventListener("click", (e) => {
  if (!img) return;
  if (mode !== "manual") {
    output.textContent = "Сейчас авто-режим. Для правки переключись в 'Ручной'.";
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  applyPoint(x, y, "manual");
});

normalLengthInput.addEventListener("input", () => {
  draw();
  if (edgePoint && normal) {
    writeVectorInfo(edgePoint.x, edgePoint.y, pointSource || "manual");
  }
});

zoomInput.addEventListener("input", () => {
  zoomPercent = Number(zoomInput.value) || 100;
  applyZoom();
});

zoomOutBtn.addEventListener("click", () => {
  const next = Math.max(50, (Number(zoomInput.value) || 100) - 10);
  zoomInput.value = String(next);
  zoomPercent = next;
  applyZoom();
});

zoomInBtn.addEventListener("click", () => {
  const next = Math.min(300, (Number(zoomInput.value) || 100) + 10);
  zoomInput.value = String(next);
  zoomPercent = next;
  applyZoom();
});

function runAutoDetect() {
  const point = detectMarkedPoint();
  if (!point) {
    markerMask = null;
    markerBox = null;
    markerArea = 0;
    markerPoint = null;
    edgePoint = null;
    normal = null;
    pointSource = null;
    draw();
    output.textContent =
`Авто: маркер на кромке не найден.
Версия: ${APP_VERSION}
Детектор: ${lastDetector}
QR: ${qrText}
${polygonMetricsText()}
Переключись в 'Ручной' и кликни по кромке.`;
    return;
  }
  applyPoint(point.x, point.y, "auto");
}

function applyPoint(x, y, source) {
  markerPoint = { x, y };
  edgePoint = snapToNearestEdge(x, y, 30) || { x, y };
  normal = estimateContourNormal(Math.round(edgePoint.x), Math.round(edgePoint.y))
    || estimateNormalFromMasks(Math.round(edgePoint.x), Math.round(edgePoint.y));
  pointSource = source;
  draw();
  writeVectorInfo(edgePoint.x, edgePoint.y, source);
}

function writeVectorInfo(x, y, source) {
  const srcLabel = source === "auto" ? "Режим: авто" : "Режим: ручной";
  const hasNormal = !!normal;
  const toEdgeX = hasNormal ? -normal.nx : 0;
  const toEdgeY = hasNormal ? -normal.ny : 0;
  const angleDeg = hasNormal ? Math.atan2(toEdgeY, toEdgeX) * 180 / Math.PI : 0;

  output.textContent =
`${srcLabel}
Версия: ${APP_VERSION}
Детектор: ${lastDetector}
QR: ${qrText}
${polygonMetricsText()}
Маркер: (${(markerPoint?.x ?? x).toFixed(1)}, ${(markerPoint?.y ?? y).toFixed(1)})
Точка кромки: (${x.toFixed(1)}, ${y.toFixed(1)})
${hasNormal ? `Нормаль к кромке (X вправо, Y вниз): (${normal.nx.toFixed(3)}, ${normal.ny.toFixed(3)})
Вектор ворса -> к кромке: (${toEdgeX.toFixed(3)}, ${toEdgeY.toFixed(3)})
Угол от +X (Y вниз): ${angleDeg.toFixed(1)}°` : "Нормаль: не удалось оценить."}`;
}

function polygonMetricsText() {
  const area = modelStats?.polygonAreaPx ?? modelStats?.polygonCount ?? 0;
  const bw = modelStats?.bboxW ?? 0;
  const bh = modelStats?.bboxH ?? 0;
  let text = `Площадь полигона: ${area} px^2\nГабариты полигона (bbox): ${bw} x ${bh} px`;
  if (dpiX && dpiY) {
    const mmW = bw * 25.4 / dpiX;
    const mmH = bh * 25.4 / dpiY;
    const mm2 = area * (25.4 / dpiX) * (25.4 / dpiY);
    text += `\nDPI: ${dpiX.toFixed(2)} x ${dpiY.toFixed(2)} (${dpiSource})`;
    text += `\nГабариты полигона: ${mmW.toFixed(2)} x ${mmH.toFixed(2)} мм`;
    text += `\nПлощадь полигона: ${mm2.toFixed(2)} мм^2`;
  } else {
    text += `\nDPI: не найден в метаданных`;
  }
  return text;
}

function buildSavePayload() {
  const inventoryTag = normalizeInventoryTag(qrText);
  if (!inventoryTag) {
    setSaveStatus("error", "Нет inventoryTag: QR не распознан.");
    output.textContent =
`QR не распознан, поэтому inventoryTag пустой.
Запись в Access отменена.
Сначала добейся чтения QR, затем нажми "Записать в Access".`;
    return null;
  }

  const areaPx = modelStats?.polygonAreaPx ?? modelStats?.polygonCount ?? 0;
  const bboxWidthPx = modelStats?.bboxW ?? 0;
  const bboxHeightPx = modelStats?.bboxH ?? 0;

  let napDirectionDeg = null;
  if (normal) {
    const toEdgeX = -normal.nx;
    const toEdgeY = -normal.ny;
    let deg = Math.atan2(toEdgeY, toEdgeX) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    napDirectionDeg = deg;
  }

  const contour = buildScrapContourJson();
  const areaMm2 = dpiX && dpiY ? areaPx * (25.4 / dpiX) * (25.4 / dpiY) : null;
  const bboxWidthMm = dpiX ? bboxWidthPx * 25.4 / dpiX : null;
  const bboxHeightMm = dpiY ? bboxHeightPx * 25.4 / dpiY : null;

  return {
    inventoryTag,
    napDirectionDeg,
    areaMm2,
    bboxWidthMm,
    bboxHeightMm,
    scrapContour: contour,
    metrics: {
      appVersion: APP_VERSION,
      mode,
      detector: lastDetector,
      markerPoint: markerPoint ? { x: markerPoint.x, y: markerPoint.y } : null,
      edgePoint: edgePoint ? { x: edgePoint.x, y: edgePoint.y } : null,
      normal,
      areaPx,
      bboxWidthPx,
      bboxHeightPx,
      dpiX,
      dpiY,
      dpiSource,
      qrText
    }
  };
}

function encodeSourceImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.onload = () => {
      const s = String(reader.result || "");
      const comma = s.indexOf(",");
      if (comma < 0) {
        reject(new Error("invalid_data_url"));
        return;
      }
      resolve({
        fileName: file.name || "scan",
        mimeType: file.type || "application/octet-stream",
        dataBase64: s.slice(comma + 1)
      });
    };
    reader.readAsDataURL(file);
  });
}

function normalizeInventoryTag(text) {
  if (!text) return "";
  const clean = text.trim();
  if (!clean) return "";
  if (clean.startsWith("(") && clean.endsWith(")")) return "";
  if (/не найден|не распознан|поиск/i.test(clean)) return "";
  return clean;
}

function buildScrapContourJson() {
  const pathPx = buildBoundaryPathPx(4);
  if (dpiX && dpiY) {
    const pathMm = pathPx.map((p) => ({
      x: Number((p.x * 25.4 / dpiX).toFixed(3)),
      y: Number((p.y * 25.4 / dpiY).toFixed(3))
    }));
    return {
      units: "mm",
      path: pathMm,
      source: {
        unitsRaw: "px",
        dpiX,
        dpiY
      }
    };
  }
  return {
    units: "px",
    path: pathPx,
    source: { unitsRaw: "px" }
  };
}

function buildBoundaryPathPx(step) {
  if (!polygonMask) return [];
  const w = canvas.width;
  const h = canvas.height;
  const pts = [];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!polygonMask[i]) continue;
      if (
        !polygonMask[i - 1] || !polygonMask[i + 1] ||
        !polygonMask[i - w] || !polygonMask[i + w]
      ) {
        pts.push({ x, y });
      }
    }
  }

  if (!pts.length) return [];
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    cx += pts[i].x;
    cy += pts[i].y;
  }
  cx /= pts.length;
  cy /= pts.length;

  pts.sort((a, b) => {
    const aa = Math.atan2(a.y - cy, a.x - cx);
    const bb = Math.atan2(b.y - cy, b.x - cx);
    return aa - bb;
  });

  const sampled = [];
  const stride = Math.max(1, Number(step) || 1);
  for (let i = 0; i < pts.length; i += stride) {
    sampled.push({ x: pts[i].x, y: pts[i].y });
  }
  return sampled;
}

async function parseDpiFromFile(file) {
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);

  const tiff = parseDpiFromTiff(u8);
  if (tiff) return { ...tiff, source: "tiff-meta" };

  const png = parseDpiFromPng(u8);
  if (png) return { ...png, source: "png-pHYs" };

  const jpg = parseDpiFromJpeg(u8);
  if (jpg) return { ...jpg, source: "jpeg-jfif" };

  return null;
}

function parseDpiFromPng(u8) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < sig.length; i++) if (u8[i] !== sig[i]) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let p = 8;
  while (p + 12 <= u8.length) {
    const len = dv.getUint32(p, false);
    const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
    const dataStart = p + 8;
    if (type === "pHYs" && len >= 9 && dataStart + 9 <= u8.length) {
      const ppmX = dv.getUint32(dataStart, false);
      const ppmY = dv.getUint32(dataStart + 4, false);
      const unit = u8[dataStart + 8];
      if (unit === 1 && ppmX > 0 && ppmY > 0) {
        return { x: ppmX * 0.0254, y: ppmY * 0.0254 };
      }
      return null;
    }
    p += 12 + len;
  }
  return null;
}

function parseDpiFromJpeg(u8) {
  if (!(u8.length > 4 && u8[0] === 0xff && u8[1] === 0xd8)) return null;
  let p = 2;
  while (p + 4 <= u8.length) {
    if (u8[p] !== 0xff) {
      p++;
      continue;
    }
    const marker = u8[p + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const len = (u8[p + 2] << 8) | u8[p + 3];
    if (len < 2 || p + 2 + len > u8.length) break;
    if (marker === 0xe0) {
      const s = p + 4;
      if (
        s + 13 <= u8.length &&
        u8[s] === 0x4a && u8[s + 1] === 0x46 && u8[s + 2] === 0x49 &&
        u8[s + 3] === 0x46 && u8[s + 4] === 0x00
      ) {
        const units = u8[s + 7];
        const dx = (u8[s + 8] << 8) | u8[s + 9];
        const dy = (u8[s + 10] << 8) | u8[s + 11];
        if (dx > 0 && dy > 0) {
          if (units === 1) return { x: dx, y: dy };
          if (units === 2) return { x: dx * 2.54, y: dy * 2.54 };
        }
      }
    }
    p += 2 + len;
  }
  return null;
}

function parseDpiFromTiff(u8) {
  if (u8.length < 16) return null;
  const le = u8[0] === 0x49 && u8[1] === 0x49;
  const be = u8[0] === 0x4d && u8[1] === 0x4d;
  if (!le && !be) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const rd16 = (o) => dv.getUint16(o, le);
  const rd32 = (o) => dv.getUint32(o, le);
  if (rd16(2) !== 42) return null;
  const ifd = rd32(4);
  if (ifd <= 0 || ifd + 2 > u8.length) return null;

  const count = rd16(ifd);
  let xRes = null;
  let yRes = null;
  let unit = 2;
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > u8.length) break;
    const tag = rd16(e);
    const type = rd16(e + 2);
    const num = rd32(e + 4);
    const val = rd32(e + 8);

    if ((tag === 282 || tag === 283) && type === 5 && num >= 1) {
      if (val + 8 > u8.length) continue;
      const n = rd32(val);
      const d = rd32(val + 4);
      if (d === 0) continue;
      const r = n / d;
      if (tag === 282) xRes = r;
      if (tag === 283) yRes = r;
    } else if (tag === 296) {
      if (type === 3) unit = val & 0xffff;
    }
  }
  if (!(xRes && yRes)) return null;
  if (unit === 3) return { x: xRes * 2.54, y: yRes * 2.54 };
  return { x: xRes, y: yRes };
}

function drawArrow(x1, y1, x2, y2, color) {
  const head = 12;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 7), y2 - head * Math.sin(ang - Math.PI / 7));
  ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 7), y2 - head * Math.sin(ang + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (img) ctx.drawImage(img, 0, 0);

  if (markerMask) {
    ctx.fillStyle = "rgba(0, 150, 255, 0.45)";
    ctx.strokeStyle = "#00c2ff";
    ctx.lineWidth = 1;
    const w = canvas.width;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < w; x++) {
        if (!markerMask[y * w + x]) continue;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Явный контур маски, чтобы отделение было видно на любом фоне.
    for (let y = 1; y < canvas.height - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!markerMask[i]) continue;
        if (
          !markerMask[i - 1] || !markerMask[i + 1] ||
          !markerMask[i - w] || !markerMask[i + w]
        ) {
          ctx.strokeRect(x - 0.5, y - 0.5, 1, 1);
        }
      }
    }
    if (markerBox) {
      ctx.strokeStyle = "#00c2ff";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        markerBox.minX - 1.5,
        markerBox.minY - 1.5,
        markerBox.maxX - markerBox.minX + 3,
        markerBox.maxY - markerBox.minY + 3
      );
    }
  }

  if (markerPoint) {
    ctx.fillStyle = "#1d4ed8";
    ctx.beginPath();
    ctx.arc(markerPoint.x, markerPoint.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  if (!edgePoint) return;
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(edgePoint.x, edgePoint.y, 4, 0, Math.PI * 2);
  ctx.fill();

  if (!normal) return;
  const len = Number(normalLengthInput.value) || 120;
  const sx = edgePoint.x + normal.nx * len;
  const sy = edgePoint.y + normal.ny * len;
  drawArrow(sx, sy, edgePoint.x, edgePoint.y, "#dc2626");
}

function applyZoom() {
  const scale = zoomPercent / 100;
  canvas.style.width = `${Math.round(canvas.width * scale)}px`;
  canvas.style.height = `${Math.round(canvas.height * scale)}px`;
  zoomValue.textContent = `${zoomPercent}%`;
}

function detectMarkedPoint() {
  if (!img || !sourceData || !polygonMask || !outerBgMask || !edgeDistanceMap) return null;

  const separated = detectMarkerSeparatedFromContour();
  if (separated) {
    lastDetector = "marker-separation";
    markerMask = separated.mask;
    markerBox = separated.box;
    markerArea = separated.area;
    return { x: separated.cx, y: separated.cy };
  }

  const cvPoint = detectMarkedPointOpenCV();
  if (cvPoint) {
    lastDetector = "opencv";
    markerMask = null;
    markerBox = null;
    markerArea = 0;
    return cvPoint;
  }
  // Строгий авто-режим: без слабых fallback, чтобы исключить ложные метки.
  lastDetector = cvLoadError ? `no-detect(${cvLoadError})` : "no-detect(strict)";
  return null;
}

function detectMarkerSeparatedFromContour() {
  const w = canvas.width;
  const h = canvas.height;
  const size = w * h;
  const candidate = new Uint8Array(size);
  const visited = new Uint8Array(size);
  const contourCoreDist = 1.6;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const g = sampleGray(x, y);
      const d = getEdgeDistance(x, y);
      if (g < 132 && d > contourCoreDist && d < 22) {
        candidate[i] = 1;
      }
    }
  }

  const opened = morphDilate(morphErode(candidate, w, h, 1), w, h, 1);
  let best = null;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!opened[i] || visited[i]) continue;
      const comp = bfsMaskComponent(opened, visited, x, y, w, h);
      if (!comp || comp.length < 18 || comp.length > 900) continue;

      let sx = 0;
      let sy = 0;
      let sw = 0;
      let minEdge = Infinity;
      let darkSum = 0;
      let minX = w;
      let minY = h;
      let maxX = 0;
      let maxY = 0;
      const compMask = new Uint8Array(size);

      for (let k = 0; k < comp.length; k++) {
        const idx = comp[k];
        const px = idx % w;
        const py = (idx - px) / w;
        compMask[idx] = 1;
        const g = sampleGray(px, py);
        const wd = 255 - g;
        sx += px * wd;
        sy += py * wd;
        sw += wd;
        darkSum += (160 - Math.min(160, g));
        minEdge = Math.min(minEdge, getEdgeDistance(px, py));
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      }
      if (sw <= 0) continue;

      const cx = sx / sw;
      const cy = sy / sw;
      const mix = countRingClassMix(cx, cy, 8, 24);
      if (mix.outer < 12 || mix.poly < 14) continue;

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const ratio = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
      if (ratio > 3.5) continue;

      // Отсекаем изломы/углы контура: рядом с меткой кромка должна быть локально "линейной".
      const proj = snapToNearestEdge(cx, cy, 20);
      if (!proj) continue;
      const lineScore = edgeLinearityScore(Math.round(proj.x), Math.round(proj.y), 12);
      if (lineScore < 2.8) continue;

      const score =
        comp.length * 1.6 +
        darkSum * 0.05 +
        Math.max(0, 18 - minEdge) * 2.2 +
        Math.min(mix.outer, mix.poly) * 0.3 +
        lineScore * 6.0;
      if (!best || score > best.score) {
        best = {
          cx,
          cy,
          score,
          mask: compMask,
          area: comp.length,
          box: { minX, minY, maxX, maxY }
        };
      }
    }
  }

  if (best && best.score < 140) return null;
  return best;
}

function edgeLinearityScore(cx, cy, r) {
  const pts = [];
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 1 || y < 1 || x >= canvas.width - 1 || y >= canvas.height - 1) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue;
      const idx = y * canvas.width + x;
      if (!polygonMask[idx]) continue;
      if (getEdgeDistance(x, y) > 1.6) continue;
      pts.push({ x, y });
    }
  }
  if (pts.length < 8) return 0;

  let mx = 0;
  let my = 0;
  for (let i = 0; i < pts.length; i++) {
    mx += pts[i].x;
    my += pts[i].y;
  }
  mx /= pts.length;
  my /= pts.length;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].x - mx;
    const dy = pts[i].y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.max(0, tr * tr - 4 * det);
  const l1 = (tr + Math.sqrt(disc)) / 2;
  const l2 = (tr - Math.sqrt(disc)) / 2;
  return l1 / Math.max(1e-6, l2);
}

function estimateNormal(x, y) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  const geom = estimateContourNormal(ix, iy);
  if (geom) return geom;

  const r = 9;

  const gx = sampleGray(ix + 1, iy) - sampleGray(ix - 1, iy);
  const gy = sampleGray(ix, iy + 1) - sampleGray(ix, iy - 1);
  const gradMag = Math.hypot(gx, gy);
  if (gradMag < 1e-3) {
    return estimateNormalFromMasks(ix, iy);
  }

  let nx = gx / gradMag;
  let ny = gy / gradMag;

  const outScore = sideDarkness(ix, iy, nx, ny, r);
  const inScore = sideDarkness(ix, iy, -nx, -ny, r);

  if (outScore < inScore) {
    nx = -nx;
    ny = -ny;
  }
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    return estimateNormalFromMasks(ix, iy);
  }
  return { nx, ny };
}

function snapToNearestEdge(x, y, maxR) {
  if (!edgeDistanceMap) return null;
  const cx = Math.round(x);
  const cy = Math.round(y);
  let best = null;

  for (let yy = Math.max(1, cy - maxR); yy <= Math.min(canvas.height - 2, cy + maxR); yy++) {
    for (let xx = Math.max(1, cx - maxR); xx <= Math.min(canvas.width - 2, cx + maxR); xx++) {
      const d = getEdgeDistance(xx, yy);
      if (d > 1.4) continue;
      const dx = xx - cx;
      const dy = yy - cy;
      const r2 = dx * dx + dy * dy;
      if (!best || r2 < best.r2) best = { x: xx, y: yy, r2 };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

function sideDarkness(x, y, nx, ny, r) {
  let acc = 0;
  let cnt = 0;
  for (let i = 2; i <= r; i++) {
    const px = Math.round(x + nx * i);
    const py = Math.round(y + ny * i);
    acc += sampleGray(px, py);
    cnt++;
  }
  return cnt ? acc / cnt : 255;
}

function sampleGray(x, y) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return 255;
  const ix = Math.round(x);
  const iy = Math.round(y);
  const i = (iy * canvas.width + ix) * 4;
  const d = sourceData;
  if (!d || i < 0 || i + 2 >= d.length) return 255;
  const r = d[i];
  const g = d[i + 1];
  const b = d[i + 2];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function decodeQrFromSource() {
  if (!sourceData || !canvas.width || !canvas.height) {
    qrText = "(нет изображения)";
    return;
  }

  let decoded = null;

  if ("BarcodeDetector" in window) {
    try {
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      const list = await detector.detect(sourceCanvas);
      if (list && list.length > 0) {
        decoded = list[0].rawValue || null;
      }
    } catch (_) {
      // fallback to jsQR below
    }
  }

  if (!decoded && window.jsQR) {
    decoded = tryDecodeWithJsQrVariants();
  }

  if (!decoded && cvReady && window.cv && window.cv.QRCodeDetector) {
    decoded = tryDecodeWithOpenCvQr();
  }

  qrText = decoded || "(не найден)";

  if (edgePoint) {
    writeVectorInfo(edgePoint.x, edgePoint.y, pointSource || "auto");
  }
}

function tryDecodeWithJsQrVariants() {
  if (!window.jsQR || !sourceData) return null;
  const w = canvas.width;
  const h = canvas.height;

  const direct = window.jsQR(sourceData, w, h);
  if (direct && direct.data) return direct.data;

  const roi = detectLabelRoi();
  if (!roi) return null;
  const roiData = getRoiImageData(roi.x, roi.y, roi.w, roi.h);
  if (!roiData) return null;

  const attempts = [];
  attempts.push({ data: roiData.data, w: roi.w, h: roi.h });
  attempts.push(scaleImageDataNearest(roiData.data, roi.w, roi.h, 2));
  attempts.push(scaleImageDataNearest(roiData.data, roi.w, roi.h, 3));
  attempts.push(binarizeImageData(roiData.data, roi.w, roi.h, 155));
  attempts.push(binarizeImageData(roiData.data, roi.w, roi.h, 175));

  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    if (!a) continue;
    const res = window.jsQR(a.data, a.w, a.h);
    if (res && res.data) return res.data;
  }
  return null;
}

function tryDecodeWithOpenCvQr() {
  let src = null;
  let detector = null;
  try {
    src = cv.imread(sourceCanvas);
    detector = new cv.QRCodeDetector();
    let txt = detector.detectAndDecode(src);
    if (txt && txt.trim()) return txt.trim();

    const roi = detectLabelRoi();
    if (!roi) return null;
    const rect = new cv.Rect(roi.x, roi.y, roi.w, roi.h);
    const cropped = src.roi(rect);
    const gray = new cv.Mat();
    cv.cvtColor(cropped, gray, cv.COLOR_RGBA2GRAY);
    const up = new cv.Mat();
    cv.resize(gray, up, new cv.Size(roi.w * 3, roi.h * 3), 0, 0, cv.INTER_CUBIC);
    const th = new cv.Mat();
    cv.threshold(up, th, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    txt = detector.detectAndDecode(th);
    cropped.delete();
    gray.delete();
    up.delete();
    th.delete();
    if (txt && txt.trim()) return txt.trim();
  } catch (_) {
    return null;
  } finally {
    if (detector) detector.delete();
    if (src) src.delete();
  }
  return null;
}

function detectLabelRoi() {
  const w = canvas.width;
  const h = canvas.height;
  // Этикетка в этих кадрах стабильно слева-сверху.
  const x = Math.max(0, Math.round(w * 0.05));
  const y = Math.max(0, Math.round(h * 0.18));
  const rw = Math.max(40, Math.round(w * 0.33));
  const rh = Math.max(30, Math.round(h * 0.22));
  if (x + rw > w || y + rh > h) return null;
  return { x, y, w: rw, h: rh };
}

function getRoiImageData(x, y, w, h) {
  if (!sourceCtx || w < 1 || h < 1) return null;
  return sourceCtx.getImageData(x, y, w, h);
}

function scaleImageDataNearest(rgba, w, h, factor) {
  if (factor <= 1) return { data: rgba, w, h };
  const nw = w * factor;
  const nh = h * factor;
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const sy = Math.floor(y / factor);
    for (let x = 0; x < nw; x++) {
      const sx = Math.floor(x / factor);
      const si = (sy * w + sx) * 4;
      const di = (y * nw + x) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = 255;
    }
  }
  return { data: out, w: nw, h: nh };
}

function binarizeImageData(rgba, w, h, thr) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const v = gray < thr ? 0 : 255;
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return { data: out, w, h };
}

function isDarkPixel(x, y) {
  return sampleGray(x, y) < 85;
}

function collectDarkComponent(startX, startY, visited) {
  const w = canvas.width;
  const h = canvas.height;
  const qx = [startX];
  const qy = [startY];
  visited[startY * w + startX] = 1;

  let head = 0;
  let area = 0;
  let sumX = 0;
  let sumY = 0;
  let sumW = 0;
  let minX = startX;
  let minY = startY;
  let maxX = startX;
  let maxY = startY;
  let minEdgeDist = Infinity;

  while (head < qx.length) {
    const x = qx[head];
    const y = qy[head];
    head++;

    const gray = sampleGray(x, y);
    const wDark = 255 - gray;
    area++;
    sumX += x * wDark;
    sumY += y * wDark;
    sumW += wDark;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    minEdgeDist = Math.min(minEdgeDist, getEdgeDistance(x, y));

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
        const ni = ny * w + nx;
        if (visited[ni]) continue;
        if (!isDarkPixel(nx, ny)) continue;
        visited[ni] = 1;
        qx.push(nx);
        qy.push(ny);
      }
    }
  }

  if (sumW <= 0) return null;
  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  const bboxDiag = Math.hypot(bboxW, bboxH);
  return { area, sumX, sumY, sumW, minEdgeDist, bboxDiag };
}

function edgeBlobScore(cx, cy, r) {
  let darkPx = 0;
  let energy = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue;
      if (getEdgeDistance(x, y) > 11) continue;

      const g = sampleGray(x, y);
      if (g < 120) {
        darkPx++;
        energy += (120 - g) / 120;
      }
    }
  }
  return { darkPx, energy };
}

function refineEdgeDarkCentroid(cx, cy, r) {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue;
      if (getEdgeDistance(x, y) > 12) continue;
      const g = sampleGray(x, y);
      if (g > 130) continue;
      const w = 130 - g;
      sx += x * w;
      sy += y * w;
      sw += w;
    }
  }
  if (sw <= 0) return { x: cx, y: cy };
  return { x: sx / sw, y: sy / sw };
}

function isMarkerCandidate(x, y) {
  const d = getEdgeDistance(x, y);
  if (d < 0.8 || d > 28) return false;
  return sampleGray(x, y) < 150;
}

function collectBandComponent(startX, startY, visited) {
  const w = canvas.width;
  const h = canvas.height;
  const qx = [startX];
  const qy = [startY];
  visited[startY * w + startX] = 1;

  let head = 0;
  let area = 0;
  let sumX = 0;
  let sumY = 0;
  let sumW = 0;
  let minX = startX;
  let minY = startY;
  let maxX = startX;
  let maxY = startY;
  let darkEnergy = 0;

  while (head < qx.length) {
    const x = qx[head];
    const y = qy[head];
    head++;

    const g = sampleGray(x, y);
    const wDark = 255 - g;
    area++;
    sumX += x * wDark;
    sumY += y * wDark;
    sumW += wDark;
    darkEnergy += Math.max(0, 150 - g);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
        const ni = ny * w + nx;
        if (visited[ni]) continue;
        if (!isMarkerCandidate(nx, ny)) continue;
        visited[ni] = 1;
        qx.push(nx);
        qy.push(ny);
      }
    }
  }

  if (sumW <= 0) return null;
  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  const bboxDiag = Math.hypot(bboxW, bboxH);
  const cx = sumX / sumW;
  const cy = sumY / sumW;
  return { area, cx, cy, bboxDiag, darkEnergy };
}

function detectByDarkMassFallback() {
  const w = canvas.width;
  const h = canvas.height;
  let best = null;

  for (let y = 8; y < h - 8; y++) {
    for (let x = 8; x < w - 8; x++) {
      const idx = y * w + x;
      const d = getEdgeDistance(x, y);
      if (d < 0.6 || d > 28) continue;

      const mass = localDarkMass(x, y, 7);
      if (mass.darkPx < 14) continue;

      const mix = countRingClassMix(x, y, 8, 20);
      if (mix.outer < 6 || mix.poly < 10) continue;

      const score = mass.energy * 1.8 + mass.darkPx * 1.2 + Math.min(mix.outer, mix.poly) * 0.25;
      if (!best || score > best.score) {
        best = { x, y, score };
      }
    }
  }

  if (!best) return null;
  return refineEdgeDarkCentroid(best.x, best.y, 12);
}

function detectUltimateFallback() {
  const w = canvas.width;
  const h = canvas.height;
  let best = null;

  for (let y = 4; y < h - 4; y += 2) {
    for (let x = 4; x < w - 4; x += 2) {
      const g = sampleGray(x, y);
      if (g > 175) continue;
      const d = getEdgeDistance(x, y);
      if (!Number.isFinite(d) || d > 40) continue;

      const darkness = 255 - g;
      const edgeBoost = Math.max(0, 40 - d);
      const local = localDarkMass(x, y, 5);
      const score = darkness * 1.2 + edgeBoost * 2.8 + local.energy * 0.4;

      if (!best || score > best.score) {
        best = { x, y, score };
      }
    }
  }

  if (!best) return null;
  return refineEdgeDarkCentroid(best.x, best.y, 14);
}

function detectByVeryDarkComponents() {
  const w = canvas.width;
  const h = canvas.height;
  const visited = new Uint8Array(w * h);
  let best = null;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (visited[i]) continue;
      if (sampleGray(x, y) >= 70) continue;

      const comp = collectVeryDarkComponent(x, y, visited);
      if (!comp) continue;
      if (comp.area < 6 || comp.area > 700) continue;
      if (comp.minEdgeDist > 22) continue;

      const mix = countRingClassMix(comp.cx, comp.cy, 8, 22);
      if (mix.outer < 10) continue;

      const score = comp.darkEnergy * 2.1 + comp.area * 1.2 + Math.min(mix.outer, mix.poly) * 0.4;
      if (!best || score > best.score) {
        best = { x: comp.cx, y: comp.cy, score };
      }
    }
  }

  if (!best) return null;
  return { x: best.x, y: best.y };
}

function detectByMorphBlob() {
  const w = canvas.width;
  const h = canvas.height;
  const size = w * h;
  const raw = new Uint8Array(size);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (sampleGray(x, y) < 120) raw[i] = 1;
    }
  }

  // Сильнее убираем тонкий контур; оставляем только толстые кляксы.
  const opened = morphDilate(morphErode(raw, w, h, 2), w, h, 2);
  const visited = new Uint8Array(size);
  let best = null;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!opened[i] || visited[i]) continue;
      const comp = bfsMaskComponent(opened, visited, x, y, w, h);
      if (!comp || comp.length < 10 || comp.length > 900) continue;

      let sx = 0;
      let sy = 0;
      let sw = 0;
      let minEdgeDist = Infinity;
      let minX = w, minY = h, maxX = 0, maxY = 0;
      for (let k = 0; k < comp.length; k++) {
        const idx = comp[k];
        const px = idx % w;
        const py = (idx - px) / w;
        const g = sampleGray(px, py);
        const wd = 255 - g;
        sx += px * wd;
        sy += py * wd;
        sw += wd;
        minEdgeDist = Math.min(minEdgeDist, getEdgeDistance(px, py));
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      }
      if (sw <= 0 || minEdgeDist > 18) continue;
      if (minEdgeDist < 1.0) continue;
      const cx = sx / sw;
      const cy = sy / sw;
      const mix = countRingClassMix(cx, cy, 8, 22);
      if (mix.outer < 14 || mix.poly < 20) continue;

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const ratio = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
      if (ratio > 3.2) continue;

      const score = comp.length * 2.0 + Math.max(0, 18 - minEdgeDist) * 2.0 + Math.min(mix.outer, mix.poly) * 0.4;
      if (!best || score > best.score) best = { x: cx, y: cy, score };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

function detectByEdgeThickness() {
  const w = canvas.width;
  const h = canvas.height;
  let best = null;

  for (let y = 6; y < h - 6; y += 2) {
    for (let x = 6; x < w - 6; x += 2) {
      const d0 = getEdgeDistance(x, y);
      if (d0 > 1.4) continue;

      const ring = countRingClassMix(x, y, 8, 22);
      if (ring.outer < 10 || ring.poly < 16) continue;

      const s = edgeThicknessScore(x, y, 8);
      if (s.offEdgeDark < 8) continue;
      if (s.veryDark < 6) continue;

      const score = s.offEdgeDark * 3.2 + s.veryDark * 2.1 + s.coreDark * 0.9 + Math.min(ring.outer, ring.poly) * 0.2;
      if (!best || score > best.score) {
        best = { x, y, score };
      }
    }
  }

  if (!best) return null;
  return refineMarkerCentroidOffEdge(best.x, best.y, 14) || refineEdgeDarkCentroid(best.x, best.y, 14);
}

function edgeThicknessScore(cx, cy, r) {
  let coreDark = 0;
  let offEdgeDark = 0;
  let veryDark = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue;

      const g = sampleGray(x, y);
      if (g > 120) continue;
      const d = getEdgeDistance(x, y);
      if (d <= 2.0) {
        coreDark++;
      } else if (d <= 12) {
        offEdgeDark++;
      }
      if (g < 70 && d <= 12) veryDark++;
    }
  }
  return { coreDark, offEdgeDark, veryDark };
}

function refineMarkerCentroidOffEdge(cx, cy, r) {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue;

      const d = getEdgeDistance(x, y);
      if (d < 1.8 || d > 14) continue; // убираем саму линию кромки
      const g = sampleGray(x, y);
      if (g > 130) continue;
      const w = 130 - g;
      sx += x * w;
      sy += y * w;
      sw += w;
    }
  }
  if (sw <= 0) return null;
  return { x: sx / sw, y: sy / sw };
}

function morphErode(mask, w, h, radius) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ok = 1;
      for (let dy = -radius; dy <= radius && ok; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny * w + nx]) {
            ok = 0;
            break;
          }
        }
      }
      out[y * w + x] = ok;
    }
  }
  return out;
}

function morphDilate(mask, w, h, radius) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let dy = -radius; dy <= radius && !hit; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (mask[ny * w + nx]) {
            hit = 1;
            break;
          }
        }
      }
      out[y * w + x] = hit;
    }
  }
  return out;
}

function collectVeryDarkComponent(startX, startY, visited) {
  const w = canvas.width;
  const h = canvas.height;
  const qx = [startX];
  const qy = [startY];
  visited[startY * w + startX] = 1;

  let head = 0;
  let area = 0;
  let sumX = 0;
  let sumY = 0;
  let sumW = 0;
  let darkEnergy = 0;
  let minEdgeDist = Infinity;

  while (head < qx.length) {
    const x = qx[head];
    const y = qy[head];
    head++;

    const g = sampleGray(x, y);
    if (g >= 95) continue;

    const wDark = 255 - g;
    area++;
    sumX += x * wDark;
    sumY += y * wDark;
    sumW += wDark;
    darkEnergy += (120 - Math.min(120, g));
    minEdgeDist = Math.min(minEdgeDist, getEdgeDistance(x, y));

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
        const ni = ny * w + nx;
        if (visited[ni]) continue;
        if (sampleGray(nx, ny) >= 95) continue;
        visited[ni] = 1;
        qx.push(nx);
        qy.push(ny);
      }
    }
  }

  if (sumW <= 0) return null;
  return { area, cx: sumX / sumW, cy: sumY / sumW, darkEnergy, minEdgeDist };
}

function estimateNormalFromMasks(x, y) {
  if (!polygonMask || !outerBgMask) return null;
  const r = 8;
  let inX = 0;
  let inY = 0;
  let inCnt = 0;
  let outX = 0;
  let outY = 0;
  let outCnt = 0;

  for (let yy = y - r; yy <= y + r; yy++) {
    for (let xx = x - r; xx <= x + r; xx++) {
      if (xx < 0 || yy < 0 || xx >= canvas.width || yy >= canvas.height) continue;
      const idx = yy * canvas.width + xx;
      const dx = xx - x;
      const dy = yy - y;
      if (dx * dx + dy * dy > r * r) continue;

      if (polygonMask[idx]) {
        inX += xx;
        inY += yy;
        inCnt++;
      } else if (outerBgMask[idx]) {
        outX += xx;
        outY += yy;
        outCnt++;
      }
    }
  }

  if (inCnt < 3 || outCnt < 3) return null;
  const icx = inX / inCnt;
  const icy = inY / inCnt;
  const ocx = outX / outCnt;
  const ocy = outY / outCnt;
  const vx = icx - ocx;
  const vy = icy - ocy;
  const vm = Math.hypot(vx, vy);
  if (vm < 1e-6) return null;
  return { nx: vx / vm, ny: vy / vm };
}

function estimateContourNormal(x, y) {
  if (!polygonMask || !edgeDistanceMap) return null;
  const r = 10;
  const pts = [];
  for (let yy = y - r; yy <= y + r; yy++) {
    for (let xx = x - r; xx <= x + r; xx++) {
      if (xx < 1 || yy < 1 || xx >= canvas.width - 1 || yy >= canvas.height - 1) continue;
      const dx = xx - x;
      const dy = yy - y;
      if (dx * dx + dy * dy > r * r) continue;
      const idx = yy * canvas.width + xx;
      if (!polygonMask[idx]) continue;
      if (getEdgeDistance(xx, yy) > 1.6) continue;
      pts.push({ x: xx, y: yy });
    }
  }
  if (pts.length < 6) return null;

  let mx = 0;
  let my = 0;
  for (let i = 0; i < pts.length; i++) {
    mx += pts[i].x;
    my += pts[i].y;
  }
  mx /= pts.length;
  my /= pts.length;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].x - mx;
    const dy = pts[i].y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.max(0, trace * trace - 4 * det);
  const lambda = (trace + Math.sqrt(disc)) / 2;

  let tx = sxy;
  let ty = lambda - sxx;
  if (Math.abs(tx) + Math.abs(ty) < 1e-6) {
    tx = lambda - syy;
    ty = sxy;
  }
  const tm = Math.hypot(tx, ty);
  if (tm < 1e-6) return null;
  tx /= tm;
  ty /= tm;

  // Перпендикуляр к касательной = геометрическая нормаль.
  let nx1 = -ty;
  let ny1 = tx;
  let nx2 = ty;
  let ny2 = -tx;

  const in1 = inwardScore(x, y, nx1, ny1, 10);
  const in2 = inwardScore(x, y, nx2, ny2, 10);
  if (in2 > in1) {
    nx1 = nx2;
    ny1 = ny2;
  }

  const nm = Math.hypot(nx1, ny1);
  if (nm < 1e-6) return null;
  return { nx: nx1 / nm, ny: ny1 / nm };
}

function inwardScore(x, y, nx, ny, r) {
  let score = 0;
  let cnt = 0;
  for (let i = 2; i <= r; i++) {
    const xx = Math.round(x + nx * i);
    const yy = Math.round(y + ny * i);
    if (xx < 0 || yy < 0 || xx >= canvas.width || yy >= canvas.height) continue;
    const idx = yy * canvas.width + xx;
    if (polygonMask && polygonMask[idx]) score++;
    cnt++;
  }
  return cnt ? score / cnt : 0;
}

function localDarkMass(cx, cy, r) {
  let darkPx = 0;
  let energy = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue;

      const d = getEdgeDistance(x, y);
      if (d > 22) continue;
      const g = sampleGray(x, y);
      if (g < 140) {
        darkPx++;
        energy += 140 - g;
      }
    }
  }
  return { darkPx, energy };
}

function detectOnLargestDarkContour() {
  const w = canvas.width;
  const h = canvas.height;
  const size = w * h;
  const darkMask = new Uint8Array(size);
  const visited = new Uint8Array(size);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (sampleGray(x, y) < 95) darkMask[i] = 1;
    }
  }

  let bestComp = null;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!darkMask[i] || visited[i]) continue;
      const comp = bfsMaskComponent(darkMask, visited, x, y, w, h);
      if (!bestComp || comp.length > bestComp.length) bestComp = comp;
    }
  }

  if (!bestComp || bestComp.length < 200) return null;

  const contourMask = new Uint8Array(size);
  for (let i = 0; i < bestComp.length; i++) contourMask[bestComp[i]] = 1;

  let best = null;
  for (let i = 0; i < bestComp.length; i++) {
    const idx = bestComp[i];
    const x = idx % w;
    const y = (idx - x) / w;

    // Маркер обычно не на самой границе картинки.
    if (x < 8 || y < 8 || x >= w - 8 || y >= h - 8) continue;
    // Предпочитаем пиксели рядом с кромкой полигона.
    const d = getEdgeDistance(x, y);
    if (d > 14) continue;

    const thick = localMaskDensity(contourMask, x, y, 6, w, h);
    const score = thick + Math.max(0, 14 - d) * 1.5;
    if (!best || score > best.score) {
      best = { x, y, score };
    }
  }

  if (!best) return null;
  return refineMaskCentroid(contourMask, best.x, best.y, 9, w, h);
}

function bfsMaskComponent(mask, visited, sx, sy, w, h) {
  const qx = [sx];
  const qy = [sy];
  const out = [];
  visited[sy * w + sx] = 1;
  let head = 0;

  while (head < qx.length) {
    const x = qx[head];
    const y = qy[head];
    head++;
    const i = y * w + x;
    out.push(i);

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
        const ni = ny * w + nx;
        if (visited[ni] || !mask[ni]) continue;
        visited[ni] = 1;
        qx.push(nx);
        qy.push(ny);
      }
    }
  }

  return out;
}

function localMaskDensity(mask, cx, cy, r, w, h) {
  let cnt = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue;
      if (mask[y * w + x]) cnt++;
    }
  }
  return cnt;
}

function refineMaskCentroid(mask, cx, cy, r, w, h) {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue;
      const i = y * w + x;
      if (!mask[i]) continue;
      const g = sampleGray(x, y);
      const wDark = Math.max(1, 255 - g);
      sx += x * wDark;
      sy += y * wDark;
      sw += wDark;
    }
  }
  if (sw <= 0) return { x: cx, y: cy };
  return { x: sx / sw, y: sy / sw };
}

function countRingClassMix(cx, cy, rMin, rMax) {
  let poly = 0;
  let outer = 0;
  let innerHole = 0;
  const rMin2 = rMin * rMin;
  const rMax2 = rMax * rMax;
  const ix = Math.round(cx);
  const iy = Math.round(cy);

  for (let y = iy - rMax; y <= iy + rMax; y++) {
    for (let x = ix - rMax; x <= ix + rMax; x++) {
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < rMin2 || d2 > rMax2) continue;

      const idx = y * canvas.width + x;
      if (polygonMask[idx]) {
        poly++;
      } else if (outerBgMask[idx]) {
        outer++;
      } else {
        innerHole++;
      }
    }
  }
  return { poly, outer, innerHole };
}

function getEdgeDistance(x, y) {
  if (!edgeDistanceMap) return Infinity;
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= canvas.width || iy >= canvas.height) return Infinity;
  return edgeDistanceMap[iy * canvas.width + ix];
}

function buildPolygonModel() {
  const w = canvas.width;
  const h = canvas.height;
  const size = w * h;
  const contourSeed = new Uint8Array(size);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const g = sampleGray(x, y);
      if (g < 120) contourSeed[i] = 1;
    }
  }

  const contourMask = dilateMask(contourSeed, w, h, 1);
  const outerBgMask = new Uint8Array(size);
  floodFillOuterOnTraversable(contourMask, outerBgMask, w, h);

  // Все, что не достижимо извне через "проходимое", считаем внутренней областью.
  const insideCandidate = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (!outerBgMask[i]) insideCandidate[i] = 1;
  }

  // Берем самую большую внутреннюю компоненту как полигон.
  const visited = new Uint8Array(size);
  const main = extractLargestComponent(insideCandidate, visited, w, h);
  const mainMask = new Uint8Array(size);
  for (let i = 0; i < main.length; i++) mainMask[main[i]] = 1;

  // Кромка: внутренняя область рядом с внешним фоном.
  const edgeMask = new Uint8Array(size);
  let edgeCount = 0;
  let polyCount = 0;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mainMask[i]) continue;
      polyCount++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (
        outerBgMask[i - 1] || outerBgMask[i + 1] ||
        outerBgMask[i - w] || outerBgMask[i + w]
      ) {
        edgeMask[i] = 1;
        edgeCount++;
      }
    }
  }

  // Защита от пустой модели: fallback к старой тоновой маске.
  if (edgeCount < 20 || polyCount < 200) {
    const tonalMask = new Uint8Array(size);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const g = sampleGray(x, y);
        if (g >= 120 && g <= 230) tonalMask[idx] = 1;
      }
    }
    const visited2 = new Uint8Array(size);
    const tonalMain = extractLargestComponent(tonalMask, visited2, w, h);
    const tonalMainMask = new Uint8Array(size);
    for (let i = 0; i < tonalMain.length; i++) tonalMainMask[tonalMain[i]] = 1;
    const tonalOuter = new Uint8Array(size);
    floodFillOuterBackground(tonalMainMask, tonalOuter, w, h);
    const tonalEdge = new Uint8Array(size);
    let tonalEdgeCount = 0;
    let tonalPolyCount = 0;
    let tMinX = w;
    let tMinY = h;
    let tMaxX = 0;
    let tMaxY = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!tonalMainMask[i]) continue;
        tonalPolyCount++;
        tMinX = Math.min(tMinX, x);
        tMinY = Math.min(tMinY, y);
        tMaxX = Math.max(tMaxX, x);
        tMaxY = Math.max(tMaxY, y);
        if (
          tonalOuter[i - 1] || tonalOuter[i + 1] ||
          tonalOuter[i - w] || tonalOuter[i + w]
        ) {
          tonalEdge[i] = 1;
          tonalEdgeCount++;
        }
      }
    }
    return {
      polygonMask: tonalMainMask,
      outerBgMask: tonalOuter,
      edgeDistanceMap: buildDistanceTransform(tonalEdge, w, h),
      stats: {
        polygonCount: tonalPolyCount,
        polygonAreaPx: tonalPolyCount,
        edgeCount: tonalEdgeCount,
        bboxW: tonalPolyCount ? (tMaxX - tMinX + 1) : 0,
        bboxH: tonalPolyCount ? (tMaxY - tMinY + 1) : 0,
        mode: "tonal-fallback"
      }
    };
  }

  return {
    polygonMask: mainMask,
    outerBgMask,
    edgeDistanceMap: buildDistanceTransform(edgeMask, w, h),
    stats: {
      polygonCount: polyCount,
      polygonAreaPx: polyCount,
      edgeCount,
      bboxW: polyCount ? (maxX - minX + 1) : 0,
      bboxH: polyCount ? (maxY - minY + 1) : 0,
      mode: "contour"
    }
  };
}

function dilateMask(mask, w, h, radius) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let dy = -radius; dy <= radius && !hit; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (mask[ny * w + nx]) {
            hit = 1;
            break;
          }
        }
      }
      out[y * w + x] = hit;
    }
  }
  return out;
}

function floodFillOuterOnTraversable(blockMask, outerBgMask, w, h) {
  const qx = [];
  const qy = [];
  const push = (x, y) => {
    const i = y * w + x;
    if (blockMask[i] || outerBgMask[i]) return;
    outerBgMask[i] = 1;
    qx.push(x);
    qy.push(y);
  };

  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }

  let head = 0;
  while (head < qx.length) {
    const x = qx[head];
    const y = qy[head];
    head++;
    const nbs = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (let k = 0; k < nbs.length; k++) {
      const nx = nbs[k][0];
      const ny = nbs[k][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (blockMask[ni] || outerBgMask[ni]) continue;
      outerBgMask[ni] = 1;
      qx.push(nx);
      qy.push(ny);
    }
  }
}

function extractLargestComponent(mask, visited, w, h) {
  let best = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i] || visited[i]) continue;
      const comp = bfsComponent(mask, visited, x, y, w, h);
      if (comp.length > best.length) best = comp;
    }
  }
  return best;
}

function bfsComponent(mask, visited, sx, sy, w, h) {
  const qx = [sx];
  const qy = [sy];
  visited[sy * w + sx] = 1;
  let head = 0;
  const out = [];

  while (head < qx.length) {
    const x = qx[head];
    const y = qy[head];
    head++;
    const i = y * w + x;
    out.push(i);

    const nbs = [
      [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]
    ];
    for (let k = 0; k < nbs.length; k++) {
      const nx = nbs[k][0];
      const ny = nbs[k][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (!mask[ni] || visited[ni]) continue;
      visited[ni] = 1;
      qx.push(nx);
      qy.push(ny);
    }
  }
  return out;
}

function floodFillOuterBackground(mainMask, outerBgMask, w, h) {
  const qx = [];
  const qy = [];

  const pushIfBg = (x, y) => {
    const i = y * w + x;
    if (mainMask[i] || outerBgMask[i]) return;
    outerBgMask[i] = 1;
    qx.push(x);
    qy.push(y);
  };

  for (let x = 0; x < w; x++) {
    pushIfBg(x, 0);
    pushIfBg(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    pushIfBg(0, y);
    pushIfBg(w - 1, y);
  }

  let head = 0;
  while (head < qx.length) {
    const x = qx[head];
    const y = qy[head];
    head++;

    const nbs = [
      [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]
    ];
    for (let k = 0; k < nbs.length; k++) {
      const nx = nbs[k][0];
      const ny = nbs[k][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (mainMask[ni] || outerBgMask[ni]) continue;
      outerBgMask[ni] = 1;
      qx.push(nx);
      qy.push(ny);
    }
  }
}

function buildDistanceTransform(seedMask, w, h) {
  const size = w * h;
  const inf = 1e9;
  const dist = new Float32Array(size);
  for (let i = 0; i < size; i++) dist[i] = seedMask[i] ? 0 : inf;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = dist[i];
      if (x > 0) v = Math.min(v, dist[i - 1] + 1);
      if (y > 0) v = Math.min(v, dist[i - w] + 1);
      if (x > 0 && y > 0) v = Math.min(v, dist[i - w - 1] + 1.4142);
      if (x < w - 1 && y > 0) v = Math.min(v, dist[i - w + 1] + 1.4142);
      dist[i] = v;
    }
  }

  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = dist[i];
      if (x < w - 1) v = Math.min(v, dist[i + 1] + 1);
      if (y < h - 1) v = Math.min(v, dist[i + w] + 1);
      if (x < w - 1 && y < h - 1) v = Math.min(v, dist[i + w + 1] + 1.4142);
      if (x > 0 && y < h - 1) v = Math.min(v, dist[i + w - 1] + 1.4142);
      dist[i] = v;
    }
  }
  return dist;
}

function initOpenCv() {
  if (window.cv && window.cv.Mat) {
    cvReady = true;
    return;
  }

  if (window.cv && typeof window.cv === "object") {
    window.cv.onRuntimeInitialized = () => {
      cvReady = true;
      cvLoadError = null;
    };
  }

  const existing = document.querySelector("script[data-opencv='1']");
  if (existing) return;

  const script = document.createElement("script");
  script.src = "https://docs.opencv.org/4.x/opencv.js";
  script.async = true;
  script.defer = true;
  script.dataset.opencv = "1";
  script.onload = () => {
    if (window.cv && window.cv.Mat) {
      cvReady = true;
      cvLoadError = null;
      return;
    }
    if (window.cv && typeof window.cv === "object") {
      window.cv.onRuntimeInitialized = () => {
        cvReady = true;
        cvLoadError = null;
      };
    }
  };
  script.onerror = () => {
    cvLoadError = "opencv_load_failed";
  };
  document.head.appendChild(script);
}

function detectMarkedPointOpenCV() {
  if (!cvReady || !window.cv || !window.cv.Mat || !sourceCanvas.width) return null;

  let src = null;
  let gray = null;
  let nonWhite = null;
  let labels = null;
  let stats = null;
  let centroids = null;
  let polygonCvMask = null;
  let contours = null;
  let hierarchy = null;
  let dark = null;
  let darkOpened = null;
  let kernel = null;
  let dLabels = null;
  let dStats = null;
  let dCentroids = null;
  let bestContour = null;

  try {
    src = cv.imread(sourceCanvas);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    nonWhite = new cv.Mat();
    cv.threshold(gray, nonWhite, 242, 255, cv.THRESH_BINARY_INV);

    labels = new cv.Mat();
    stats = new cv.Mat();
    centroids = new cv.Mat();
    const n = cv.connectedComponentsWithStats(nonWhite, labels, stats, centroids, 8, cv.CV_32S);
    if (n <= 1) return null;

    let largestLabel = -1;
    let largestArea = 0;
    for (let i = 1; i < n; i++) {
      const area = stats.intPtr(i, cv.CC_STAT_AREA)[0];
      if (area > largestArea) {
        largestArea = area;
        largestLabel = i;
      }
    }
    if (largestLabel < 0 || largestArea < 1000) return null;

    polygonCvMask = cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8U);
    const labelsData = labels.data32S;
    const polyData = polygonCvMask.data;
    for (let i = 0; i < labelsData.length; i++) {
      if (labelsData[i] === largestLabel) polyData[i] = 255;
    }

    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(polygonCvMask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    if (contours.size() < 1) return null;

    let bestArea = 0;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const a = Math.abs(cv.contourArea(c, false));
      if (a > bestArea) {
        if (bestContour) bestContour.delete();
        bestContour = c.clone();
        bestArea = a;
      }
      c.delete();
    }
    if (!bestContour || bestArea < 500) return null;

    dark = new cv.Mat();
    cv.threshold(gray, dark, 95, 255, cv.THRESH_BINARY_INV);
    kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
    darkOpened = new cv.Mat();
    cv.morphologyEx(dark, darkOpened, cv.MORPH_OPEN, kernel);

    dLabels = new cv.Mat();
    dStats = new cv.Mat();
    dCentroids = new cv.Mat();
    const dn = cv.connectedComponentsWithStats(darkOpened, dLabels, dStats, dCentroids, 8, cv.CV_32S);
    if (dn <= 1) return null;

    let best = null;
    for (let i = 1; i < dn; i++) {
      const area = dStats.intPtr(i, cv.CC_STAT_AREA)[0];
      if (area < 8 || area > 2000) continue;
      const cx = dCentroids.data64F[i * 2];
      const cy = dCentroids.data64F[i * 2 + 1];
      const dist = Math.abs(cv.pointPolygonTest(bestContour, new cv.Point(cx, cy), true));
      if (dist > 24) continue;

      const mix = countRingClassMix(cx, cy, 8, 24);
      if (mix.outer < 10 || mix.poly < 15) continue;

      const score = area * 2.2 + (24 - dist) * 5 + Math.min(mix.outer, mix.poly) * 0.35;
      if (!best || score > best.score) {
        best = { x: cx, y: cy, score };
      }
    }

    if (!best) return null;
    return { x: best.x, y: best.y };
  } catch (err) {
    cvLoadError = "opencv_runtime_error";
    return null;
  } finally {
    if (src) src.delete();
    if (gray) gray.delete();
    if (nonWhite) nonWhite.delete();
    if (labels) labels.delete();
    if (stats) stats.delete();
    if (centroids) centroids.delete();
    if (polygonCvMask) polygonCvMask.delete();
    if (contours) contours.delete();
    if (hierarchy) hierarchy.delete();
    if (dark) dark.delete();
    if (darkOpened) darkOpened.delete();
    if (kernel) kernel.delete();
    if (dLabels) dLabels.delete();
    if (dStats) dStats.delete();
    if (dCentroids) dCentroids.delete();
    if (bestContour) bestContour.delete();
  }
}

function getMode() {
  const active = Array.from(modeInputs).find((el) => el.checked);
  return active ? active.value : "auto";
}

function initTheme() {
  const allowed = new Set(["lab-neutral", "blueprint", "warm-paper", "high-contrast"]);
  const saved = localStorage.getItem(THEME_KEY);
  const theme = allowed.has(saved) ? saved : "lab-neutral";
  document.documentElement.dataset.theme = theme;
  if (themeSelect) {
    themeSelect.value = theme;
    themeSelect.addEventListener("change", () => {
      const next = allowed.has(themeSelect.value) ? themeSelect.value : "lab-neutral";
      document.documentElement.dataset.theme = next;
      localStorage.setItem(THEME_KEY, next);
    });
  }
}

function updateControlsState() {
  clearBtn.disabled = mode !== "manual";
  saveBtn.disabled = !img || !polygonMask || !apiReady;
}

async function postSavePayload(payload, confirmOverwrite) {
  const body = { ...payload, confirmOverwrite: !!confirmOverwrite };
  const res = await fetch("/api/save-scrap-piece", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 409 || json.error === "already_exists") {
    return { ok: false, exists: true, error: "already_exists", data: json };
  }
  if (res.status === 404 || res.status === 405) {
    return {
      ok: false,
      exists: false,
      error: "API не найден (нужен node tools/ui_lab_server.js, а не статический сервер)",
      data: json
    };
  }
  if (!res.ok || !json.ok) {
    return { ok: false, exists: false, error: json.error || `HTTP ${res.status}`, data: json };
  }
  return { ok: true, exists: false, data: json };
}

function setSaveStatus(kind, message) {
  if (!saveStatus) return;
  saveStatus.className = `save-status ${kind || ""}`.trim();
  saveStatus.textContent = message || "";
}

async function checkApiHealth() {
  try {
    const res = await fetch("/api/health", { method: "GET" });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.ok) {
      apiReady = true;
      setSaveStatus("", "");
    } else {
      apiReady = false;
      setSaveStatus("warn", "API недоступен: запусти node tools/ui_lab_server.js");
    }
  } catch (err) {
    apiReady = false;
    setSaveStatus("warn", "API недоступен: запусти node tools/ui_lab_server.js");
  } finally {
    updateControlsState();
  }
}

mode = getMode();
updateControlsState();
if (!img) {
  output.textContent =
`Шаги:
1) Загрузи скан.
2) Режим "Авто": точка ищется сразу после загрузки.
3) Если авто промахнулся, переключись в "Ручной" и кликни точно в черную метку у кромки.
4) Внизу проверь QR, площадь/габариты и координаты точки кромки.`;
}
applyZoom();
