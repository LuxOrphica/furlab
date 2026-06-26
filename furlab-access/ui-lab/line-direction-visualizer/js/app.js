const fileInput = document.getElementById("fileInput");
const pickScanBtn = document.getElementById("pickScanBtn");
const fileNameText = document.getElementById("fileNameText");
const zoomInput = document.getElementById("zoomInput");
const zoomValue = document.getElementById("zoomValue");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const themeSelect = document.getElementById("themeSelect");
const clearBtn = document.getElementById("clearBtn");
const saveBtn = document.getElementById("saveBtn");
const showLineMaskChk = document.getElementById("showLineMaskChk");
const showEdgeDistanceChk = document.getElementById("showEdgeDistanceChk");
const showBboxChk = document.getElementById("showBboxChk");
const showControlPointsChk = document.getElementById("showControlPointsChk");
const debugOptions = document.getElementById("debugOptions");
const uploadImageChk = document.getElementById("uploadImageChk");
const saveStatus = document.getElementById("saveStatus");
const dictStatus = document.getElementById("dictStatus");
const hintText = document.getElementById("hintText");
const materialSelect = document.getElementById("materialSelect");
const storageSelect = document.getElementById("storageSelect");
const qualitySelect = document.getElementById("qualitySelect");
const noteInput = document.getElementById("noteInput");
const appVersionEl = document.getElementById("appVersion");
const invTagView = document.getElementById("invTagView");
const areaMm2View = document.getElementById("areaMm2View");
const bboxWidthMmView = document.getElementById("bboxWidthMmView");
const bboxHeightMmView = document.getElementById("bboxHeightMmView");
const maxSpanMmView = document.getElementById("maxSpanMmView");
const napDegView = document.getElementById("napDegView");
const canvas = document.getElementById("canvas");
const stage = document.querySelector(".stage");
const stageWrap = document.querySelector(".stage-wrap");
const zoomRail = document.querySelector(".zoom-rail");
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
const APP_VERSION = "2.0.8-line";
let cvReady = false;
let cvLoadError = null;
let lastDetector = "none";
let zoomPercent = 100;
let qrText = "(не распознан)";
let dpiX = null;
let dpiY = null;
let dpiSource = "unknown";
let sourceFile = null;
let dictLoadInFlight = false;
let apiReady = false;
let dictStatusMeta = {
  phase: "idle",
  source: "none",
  message: "dicts: -",
  loadMs: null,
  ageMs: null,
  ttlMs: null,
  stale: false,
  error: ""
};
let lineP1 = null;
let lineP2 = null;
let napVector = null;
let lineDetector = "dark-line";
let lineSource = "-";
let lineMaskRaw = null;
let lineMaskClean = null;
let lineMaskBest = null;
let lineMaskInfo = null;
let lineRejectStats = null;
let stickerBox = null;
let contourPathMethod = "-";
let maxSpanPxCache = null;
let dictsLoaded = false;
const THEME_KEY = "ui_lab_theme";
let apiBase = "";
let scenePanX = 0;
let scenePanY = 0;
let isPanning = false;
let panPointerId = null;
let panStartClientX = 0;
let panStartClientY = 0;
let panStartX = 0;
let panStartY = 0;
let panMoved = false;
let suppressNextCanvasClick = false;
let spacePanActive = false;

function updateStageCursor() {
  if (!canvas || !stage) return;
  let cursor = "crosshair";
  if (isPanning) {
    cursor = "grabbing";
  } else if (spacePanActive) {
    cursor = "grab";
  }
  // Apply to full scene area, not only the image pixels.
  canvas.style.cursor = cursor;
  stage.style.cursor = cursor;
}

function isEditableTarget(target) {
  if (!target) return false;
  const el = target;
  const tag = String(el.tagName || "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = String(el.type || "").toLowerCase();
    // Only real text-entry inputs should keep Space for typing.
    const textLike = new Set([
      "text", "search", "email", "url", "tel", "password",
      "number", "date", "datetime-local", "month", "time", "week"
    ]);
    return textLike.has(type);
  }
  return !!el.isContentEditable;
}

window.addEventListener("keydown", (e) => {
  if (e.code !== "Space") return;
  if (isEditableTarget(e.target)) return;
  spacePanActive = true;
  updateStageCursor();
  e.preventDefault();
});

window.addEventListener("keyup", (e) => {
  if (e.code !== "Space") return;
  spacePanActive = false;
  updateStageCursor();
});

window.addEventListener("blur", () => {
  spacePanActive = false;
  updateStageCursor();
});

function centerSceneInStage() {
  if (!img || !stage) return;
  const scale = zoomPercent / 100;
  const baseW = Math.max(1, canvas.width || 1);
  const baseH = Math.max(1, canvas.height || 1);
  const scaledW = baseW * scale;
  const scaledH = baseH * scale;
  const viewW = Math.max(1, stage.clientWidth || 1);
  const viewH = Math.max(1, stage.clientHeight || 1);
  scenePanX = Math.round((viewW - scaledW) / 2);
  scenePanY = Math.round((viewH - scaledH) / 2);
}

let resizeRaf = 0;
window.addEventListener("resize", () => {
  if (!img) return;
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    centerSceneInStage();
    applyZoom();
    resizeRaf = 0;
  });
});

function buildApiBases() {
  const out = [];
  const push = (u) => {
    const s = String(u || "").replace(/\/+$/, "");
    if (!s) {
      if (!out.includes("")) out.push("");
      return;
    }
    if (!out.includes(s)) out.push(s);
  };
  push("");
  push(`http://${window.location.hostname}:5500`);
  push("http://127.0.0.1:5500");
  return out;
}

async function apiFetch(path, options) {
  if (apiBase) {
    const res = await fetch(`${apiBase}${path}`, options);
    return { res, base: apiBase };
  }

  let lastErr = null;
  const bases = buildApiBases();
  for (const base of bases) {
    try {
      const res = await fetch(`${base}${path}`, options);
      apiBase = base;
      return { res, base };
    } catch (e) {
      lastErr = e;
    }
  }
  throw (lastErr || new Error("api_unreachable"));
}

function updateHintText() {
  if (!hintText) return;
  if (mode === "manual") {
    hintText.textContent = "Направление ворса по точкам задается оператором";
    return;
  }
  hintText.textContent = "Направление ворса определяется по найденной метке";
}

initOpenCv();
initTheme();
checkApiHealth();
showLineMaskChk?.addEventListener("change", () => draw());
showEdgeDistanceChk?.addEventListener("change", () => draw());
showBboxChk?.addEventListener("change", () => draw());
showControlPointsChk?.addEventListener("change", () => draw());
qualitySelect?.addEventListener("change", () => updateControlsState());
noteInput?.addEventListener("input", () => updateControlsState());
materialSelect?.addEventListener("change", () => updateControlsState());
storageSelect?.addEventListener("change", () => updateControlsState());
if (debugOptions) debugOptions.hidden = false;

fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (fileNameText) fileNameText.textContent = file.name;
  sourceFile = file;
  if (!saveStatus?.classList.contains("warn") && !saveStatus?.classList.contains("error")) {
    setSaveStatus("", "");
  }
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
    centerSceneInStage();

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
    updateControlsState();
    decodeQrFromSource();
    if (!dictsLoaded) {
      await loadDictionaries();
    }

    const model = buildPolygonModel();
    polygonMask = model.polygonMask;
    outerBgMask = model.outerBgMask;
    edgeDistanceMap = model.edgeDistanceMap;
    modelStats = model.stats;
    maxSpanPxCache = null;
    stickerBox = detectStickerBox();
    updateControlsState();

    edgePoint = null;
    normal = null;
    pointSource = null;
    lineP1 = null;
    lineP2 = null;
    napVector = null;
    lineSource = "-";
    lineMaskRaw = null;
    lineMaskClean = null;
    lineMaskBest = null;
    lineMaskInfo = null;
    lineRejectStats = null;
    contourPathMethod = "-";
    autoDetectLineSegment();
    draw();
    applyZoom();
    refreshPieceCard();

    if (mode === "auto") {
      runAutoDetect();
    } else {
      output.textContent = "Изображение загружено. Ручной режим: поставь 2 точки на линии ворса (сначала P1, потом P2).";
    }
  };
  image.src = url;
});

pickScanBtn?.addEventListener("click", () => {
  // Reset value so selecting the same file fires "change" reliably.
  if (fileInput) fileInput.value = "";
  fileInput?.click();
});

materialSelect?.addEventListener("focus", () => {
  const hasOnlyPlaceholder = (materialSelect.options?.length || 0) <= 1;
  if (hasOnlyPlaceholder && !dictLoadInFlight) {
    loadDictionaries();
  }
});

storageSelect?.addEventListener("focus", () => {
  const hasOnlyPlaceholder = (storageSelect.options?.length || 0) <= 1;
  if (hasOnlyPlaceholder && !dictLoadInFlight) {
    loadDictionaries();
  }
});

modeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    mode = getMode();
    updateHintText();
    updateControlsState();
    if (!img) {
      output.textContent = "Загрузи скан.";
      return;
    }
    if (mode === "auto") {
      // В авто-режиме убираем ручные точки и считаем заново только автоматикой.
      lineP1 = null;
      lineP2 = null;
      napVector = null;
      if (!lineP1 || !lineP2) autoDetectLineSegment();
      runAutoDetect();
      return;
    }
    output.textContent = "Ручной режим: поставь 2 точки на линии ворса, чтобы задать/исправить направление (P1→P2).";
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
  lineP1 = null;
  lineP2 = null;
  napVector = null;
  pointSource = null;
  draw();
  refreshPieceCard();
  output.textContent = mode === "manual"
    ? "Очистил метки и отрезок. Ручной режим: задай 2 точки на линии ворса (P1→P2)."
    : "Очистил метки. Переключись в ручной режим или загрузи изображение заново.";
});

saveBtn.addEventListener("click", async () => {
  if (!img || !polygonMask) {
    output.textContent = "Сначала загрузи изображение.";
    return;
  }
  if (!lineP1 || !lineP2) {
    output.textContent = "Задай отрезок ворса: кликни две точки P1 и P2.";
    return;
  }

  const payload = buildSavePayload();
  if (!payload) {
    updateControlsState();
    return;
  }

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
  if (suppressNextCanvasClick) {
    suppressNextCanvasClick = false;
    return;
  }
  if (spacePanActive) {
    return;
  }
  if (!img) return;
  if (isPanning) return;
  if (mode !== "manual") {
    output.textContent = "Сейчас авто-режим. Для ручной правки переключись в 'Ручной'.";
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  applyLinePoint(x, y, mode);
});

if (stage) {
  stage.addEventListener("pointerdown", (e) => {
    if (!img) return;
    if (zoomRail && zoomRail.contains(e.target)) return;
    const panByMiddle = e.button === 1;
    const panBySpaceLeft = e.button === 0 && spacePanActive;
    if (!panByMiddle && !panBySpaceLeft) return;
    // Pan gesture must never place a point with trailing click.
    suppressNextCanvasClick = true;
    isPanning = true;
    panMoved = false;
    panPointerId = e.pointerId;
    panStartClientX = e.clientX;
    panStartClientY = e.clientY;
    panStartX = scenePanX;
    panStartY = scenePanY;
    updateStageCursor();
    (e.target && typeof e.target.setPointerCapture === "function"
      ? e.target
      : stage
    ).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });

  stage.addEventListener("pointermove", (e) => {
    if (!isPanning || e.pointerId !== panPointerId) return;
    const dx = e.clientX - panStartClientX;
    const dy = e.clientY - panStartClientY;
    if (!panMoved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      panMoved = true;
    }
    scenePanX = panStartX + dx;
    scenePanY = panStartY + dy;
    applyZoom();
  });

  const stopPan = (e) => {
    if (!isPanning || e.pointerId !== panPointerId) return;
    suppressNextCanvasClick = true;
    isPanning = false;
    panPointerId = null;
    panMoved = false;
    updateStageCursor();
    stage.releasePointerCapture?.(e.pointerId);
  };
  stage.addEventListener("pointerup", stopPan);
  stage.addEventListener("pointercancel", stopPan);
}

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
  const found = autoDetectLineSegment();
  if (!found) {
    clearAutoLineVisualState();
    pointSource = "auto";
    draw();
    output.textContent =
`Авто: отрезок P1→P2 не найден.
Версия: ${APP_VERSION}
Детектор линии: ${lineDetector}
QR: ${qrText}
${polygonMetricsText()}
${lineMaskInfo ? `Порог линии: ${lineMaskInfo.threshold.toFixed(1)} (mean=${lineMaskInfo.mean.toFixed(1)}, std=${lineMaskInfo.std.toFixed(1)})` : ""}
${lineRejectStats ? `Отбраковка маски: total=${lineRejectStats.compsTotal}, area=${lineRejectStats.compsAreaReject}, feat=${lineRejectStats.compsFeatureReject}, tooBig=${lineRejectStats.compsTooBig}, sticker=${lineRejectStats.compsSticker}
Проходы: primary=${lineRejectStats.compsPrimaryPass}, relaxed=${lineRejectStats.compsRelaxedPass}, emergency=${lineRejectStats.compsEmergencyPass}, selected=${lineRejectStats.selectedBy || "none"}` : ""}
Если не найдено: кликни 2 точки P1→P2 вручную.`;
    refreshPieceCard();
    return;
  }
  pointSource = "auto";
  if (lineP1) {
    writeVectorInfo(lineP1.x, lineP1.y, "auto");
  }
}

function clearAutoLineVisualState() {
  // Keep manual workflow intact: clear only auto result/debug traces.
  lineP1 = null;
  lineP2 = null;
  napVector = null;
  lineSource = "-";
  markerMask = null;
  markerBox = null;
  markerArea = 0;
  lineMaskRaw = null;
  lineMaskClean = null;
  lineMaskBest = null;
  lineMaskInfo = null;
  lineRejectStats = null;
}

function applyPoint(x, y, source) {
  pointSource = source;
  draw();
}

function writeVectorInfo(x, y, source) {
  const srcLabel = source === "auto" ? "Режим: авто" : "Режим: ручной";
  const hasLine = !!(lineP1 && lineP2);
  const hasVector = !!napVector;
  const d1Mm = toMmDistance(napVector?.d1Px);
  const d2Mm = toMmDistance(napVector?.d2Px);

  output.textContent =
`${srcLabel}
Детектор: ${lineDetector || lastDetector}
Источник линии: ${lineSource}
${polygonMetricsText()}
P1: ${lineP1 ? `(${lineP1.x.toFixed(1)}, ${lineP1.y.toFixed(1)})` : "(не задана)"}
P2: ${lineP2 ? `(${lineP2.x.toFixed(1)}, ${lineP2.y.toFixed(1)})` : "(не задана)"}
${!hasLine ? "Отрезок P1→P2 не задан: кликни 2 точки на мездре." : ""}
${hasLine ? `d1=${formatDist(d1Mm, napVector?.d1Px)}, d2=${formatDist(d2Mm, napVector?.d2Px)}` : ""}
${hasVector ? `Вектор P1→P2: (${napVector.vx.toFixed(3)}, ${napVector.vy.toFixed(3)})` : "Направление не определено: задай P1→P2."}`;
  refreshPieceCard();
}

function applyLinePoint(x, y, source) {
  if (!lineP1 || (lineP1 && lineP2)) {
    lineP1 = { x, y };
    lineP2 = null;
    napVector = null;
    draw();
    if (edgePoint) writeVectorInfo(edgePoint.x, edgePoint.y, source);
    return;
  }
  lineP2 = { x, y };
  recomputeNapFromLine(source);
}

function autoDetectLineSegment() {
  const cvSeg = detectLineSegmentOpenCV();
  if (cvSeg && isAutoSegmentPlausible(cvSeg.p1, cvSeg.p2, "opencv-hough")) {
    lineDetector = "opencv-hough";
    lineSource = "opencv-hough";
    lineP1 = cvSeg.p1;
    lineP2 = cvSeg.p2;
    recomputeNapFromLine("auto");
    return true;
  }

  const seg = detectDarkLineSegment();
  if (!seg) return false;
  lineDetector = "dark-line";
  const segFromMask = segmentFromMaskGlobal(lineMaskClean || lineMaskBest, canvas.width, canvas.height);
  if (segFromMask && isAutoSegmentPlausible(segFromMask.p1, segFromMask.p2, "global-mask-pca")) {
    lineSource = "global-mask-pca";
    lineP1 = segFromMask.p1;
    lineP2 = segFromMask.p2;
  } else if (isAutoSegmentPlausible(seg.p1, seg.p2, "dark-line-fallback")) {
    lineSource = "dark-line-fallback";
    lineP1 = seg.p1;
    lineP2 = seg.p2;
  } else {
    return false;
  }
  recomputeNapFromLine("auto");
  return true;
}

function isAutoSegmentPlausible(p1, p2, source) {
  if (!p1 || !p2 || !edgeDistanceMap || !sourceData) return false;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 14) return false;

  const d1 = getEdgeDistance(p1.x, p1.y);
  const d2 = getEdgeDistance(p2.x, p2.y);
  const dm = getEdgeDistance((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);

  // Отсекаем ложные отрезки, лежащие на кромке полигона.
  if (!Number.isFinite(d1) || !Number.isFinite(d2) || !Number.isFinite(dm)) return false;
  if (Math.min(d1, d2) < 2.5) return false;
  if ((d1 + d2 + dm) / 3 < 4.0) return false;

  // Для OpenCV-Hough дополнительно требуем "черный штрих" по всей длине,
  // чтобы не брать куски контура.
  if (source === "opencv-hough") {
    let dark = 0;
    let valid = 0;
    for (let t = 0; t <= 16; t++) {
      const a = t / 16;
      const x = Math.round(p1.x + dx * a);
      const y = Math.round(p1.y + dy * a);
      if (x < 1 || y < 1 || x >= canvas.width - 1 || y >= canvas.height - 1) continue;
      const d = getEdgeDistance(x, y);
      if (d < 2.0) continue;
      valid++;
      if (sampleGray(x, y) < 150) dark++;
    }
    if (valid < 8) return false;
    if (dark / valid < 0.62) return false;
  }
  return true;
}

function segmentFromMaskGlobal(mask, w, h) {
  if (!mask || !w || !h) return null;
  const pts = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (isInStickerExclusion(x, y, 8)) continue;
      pts.push({ x, y });
    }
  }
  if (pts.length < 8) return null;
  return endpointsByPca(pts);
}

function segmentFromMaskLongestComponent(mask, w, h) {
  if (!mask || !w || !h) return null;
  const visited = new Uint8Array(w * h);
  let bestComp = null;
  let bestLen = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i] || visited[i]) continue;
      const comp = bfsMaskComponent(mask, visited, x, y, w, h);
      if (!comp || comp.length < 4) continue;
      const feat = segmentFeaturesFromComponent(comp, w);
      if (!feat || feat.lengthPx < 6) continue;
      const mx = (feat.p1.x + feat.p2.x) / 2;
      const my = (feat.p1.y + feat.p2.y) / 2;
      if (isInStickerExclusion(mx, my, 8)) continue;
      if (feat.lengthPx > bestLen) {
        bestLen = feat.lengthPx;
        bestComp = comp;
      }
    }
  }
  if (!bestComp) return null;
  const pts = new Array(bestComp.length);
  for (let i = 0; i < bestComp.length; i++) {
    const idx = bestComp[i];
    const x = idx % w;
    const y = (idx - x) / w;
    pts[i] = { x, y };
  }
  return endpointsByPca(pts) || farthestPairOnComponent(bestComp, w);
}

function farthestPairOnComponent(comp, w) {
  if (!comp || comp.length < 2) return null;
  const pts = new Array(comp.length);
  for (let i = 0; i < comp.length; i++) {
    const idx = comp[i];
    const x = idx % w;
    const y = (idx - x) / w;
    pts[i] = { x, y };
  }
  let bestA = pts[0];
  let bestB = pts[1];
  let bestD2 = -1;
  const stride = pts.length > 1200 ? 2 : 1;
  for (let i = 0; i < pts.length; i += stride) {
    const a = pts[i];
    for (let j = i + stride; j < pts.length; j += stride) {
      const b = pts[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > bestD2) {
        bestD2 = d2;
        bestA = a;
        bestB = b;
      }
    }
  }
  if (bestD2 < 36) return null;
  return { p1: { x: bestA.x, y: bestA.y }, p2: { x: bestB.x, y: bestB.y } };
}

function endpointsByPca(points) {
  if (!points || points.length < 2) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < points.length; i++) {
    mx += points[i].x;
    my += points[i].y;
  }
  mx /= points.length;
  my /= points.length;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - mx;
    const dy = points[i].y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.max(0, tr * tr - 4 * det);
  const l1 = (tr + Math.sqrt(disc)) / 2;

  let vx = 1;
  let vy = 0;
  if (Math.abs(sxy) > 1e-6 || Math.abs(sxx - l1) > 1e-6) {
    vx = sxy;
    vy = l1 - sxx;
    const nm = Math.hypot(vx, vy);
    if (nm > 1e-6) {
      vx /= nm;
      vy /= nm;
    }
  }

  let minT = Infinity;
  let maxT = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const t = (p.x - mx) * vx + (p.y - my) * vy;
    if (t < minT) {
      minT = t;
    }
    if (t > maxT) {
      maxT = t;
    }
  }
  if (!Number.isFinite(minT) || !Number.isFinite(maxT)) return null;

  // Важно: концы берем на главной оси, а не на случайных крайних пикселях толщины штриха.
  const p1 = { x: mx + vx * minT, y: my + vy * minT };
  const p2 = { x: mx + vx * maxT, y: my + vy * maxT };
  if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 6) return null;
  return { p1, p2 };
}

function refineSegmentToStroke(p1, p2) {
  if (!p1 || !p2 || !sourceData || !polygonMask) return { p1, p2 };
  const w = canvas.width;
  const h = canvas.height;
  let vx = p2.x - p1.x;
  let vy = p2.y - p1.y;
  const len = Math.hypot(vx, vy);
  if (len < 1e-6) return { p1, p2 };
  vx /= len;
  vy /= len;

  const cx = (p1.x + p2.x) / 2;
  const cy = (p1.y + p2.y) / 2;
  const darkThr = Math.min(210, (lineMaskInfo?.threshold ?? 170) + 30);
  const maxT = Math.max(w, h);
  const step = 0.5;
  const missLimit = 10;

  const nx = -vy;
  const ny = vx;

  function hasDarkStrokeAt(x, y) {
    // Проверяем не один пиксель, а короткий поперечный профиль штриха.
    let darkHits = 0;
    let samples = 0;
    for (let s = -2; s <= 2; s++) {
      const sx = Math.round(x + nx * s);
      const sy = Math.round(y + ny * s);
      if (sx < 1 || sy < 1 || sx >= w - 1 || sy >= h - 1) continue;
      const idx = sy * w + sx;
      if (!polygonMask[idx] || isInStickerExclusion(sx, sy, 6)) continue;
      samples++;
      const g = sampleGray(sx, sy);
      const d = getEdgeDistance(sx, sy);
      if (g <= darkThr && d > 1.2) darkHits++;
    }
    return samples >= 3 && darkHits >= 2;
  }

  function probe(sign) {
    let lastX = cx;
    let lastY = cy;
    let miss = 0;
    for (let t = 0; t <= maxT; t += step) {
      const x = cx + vx * t * sign;
      const y = cy + vy * t * sign;
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix < 1 || iy < 1 || ix >= w - 1 || iy >= h - 1) break;
      if (hasDarkStrokeAt(x, y)) {
        lastX = x;
        lastY = y;
        miss = 0;
      } else {
        miss++;
        if (miss > missLimit) break;
      }
    }
    return { x: lastX, y: lastY };
  }

  const a = probe(-1);
  const b = probe(1);
  let newLen = Math.hypot(b.x - a.x, b.y - a.y);

  // Fallback: глобальный поиск темных точек в узкой полосе вокруг оси штриха.
  if (newLen < 8) {
    const pts = [];
    const tHalf = Math.max(20, len * 6);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        if (!polygonMask[idx] || isInStickerExclusion(x, y, 6)) continue;
        const dx = x - cx;
        const dy = y - cy;
        const t = dx * vx + dy * vy;
        if (Math.abs(t) > tHalf) continue;
        const off = Math.abs(dx * nx + dy * ny);
        if (off > 3.5) continue;
        const g = sampleGray(x, y);
        if (g > darkThr) continue;
        if (getEdgeDistance(x, y) <= 1.2) continue;
        pts.push({ x, y, t });
      }
    }
    if (pts.length >= 8) {
      let minT = pts[0];
      let maxT = pts[0];
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].t < minT.t) minT = pts[i];
        if (pts[i].t > maxT.t) maxT = pts[i];
      }
      a.x = minT.x; a.y = minT.y;
      b.x = maxT.x; b.y = maxT.y;
      newLen = Math.hypot(b.x - a.x, b.y - a.y);
    }
  }

  if (newLen < 4) return { p1, p2 };
  return { p1: a, p2: b };
}

function detectDarkLineSegment() {
  if (!sourceData || !polygonMask || !edgeDistanceMap) return null;
  const w = canvas.width;
  const h = canvas.height;
  const size = w * h;
  const minCompPx = 4;
  const maxCompPx = 3500;
  const rawMask = new Uint8Array(size);
  const visited = new Uint8Array(size);
  lineMaskRaw = null;
  lineMaskClean = null;
  lineMaskBest = null;
  lineMaskInfo = null;
  lineRejectStats = {
    compsTotal: 0,
    compsAreaReject: 0,
    compsTooBig: 0,
    compsSticker: 0,
    compsFeatureReject: 0,
    compsPrimaryPass: 0,
    compsPrimaryFail: 0,
    compsRelaxedPass: 0,
    compsRelaxedFail: 0,
    compsEmergencyPass: 0,
    compsEmergencyFail: 0
  };

  // Адаптивный порог по внутренней области полигона.
  let sum = 0;
  let sum2 = 0;
  let cnt = 0;
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (!polygonMask[i]) continue;
      if (isInStickerExclusion(x, y, 8)) continue;
      const d = getEdgeDistance(x, y);
      if (d < 4) continue;
      const g = sampleGray(x, y);
      sum += g;
      sum2 += g * g;
      cnt++;
    }
  }
  const mean = cnt ? sum / cnt : 180;
  const variance = cnt ? Math.max(0, sum2 / cnt - mean * mean) : 0;
  const std = Math.sqrt(variance);
  // Для тонкого штриха даем чуть более "широкий" порог, чтобы не распадался на островки.
  const thr = Math.max(70, Math.min(185, mean - 1.0 * std));
  lineMaskInfo = { threshold: thr, mean, std };

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!polygonMask[i]) continue;
      if (isInStickerExclusion(x, y, 8)) continue;
      const g = sampleGray(x, y);
      const d = getEdgeDistance(x, y);
      // Ищем темный штрих внутри полигона, но не на самом контуре.
      if (g < thr && d > 2.5) rawMask[i] = 1;
    }
  }

  // Закрытие + легкая дополнительная дилатация: стандартно для тонких наклонных штрихов.
  const maskClosed = morphErode(morphDilate(rawMask, w, h, 1), w, h, 1);
  const mask = morphDilate(maskClosed, w, h, 1);
  lineMaskRaw = rawMask;
  lineMaskClean = mask;

  let best = null;
  let relaxed = null;
  let emergency = null;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i] || visited[i]) continue;
      const comp = bfsMaskComponent(mask, visited, x, y, w, h);
      if (!comp) continue;
      lineRejectStats.compsTotal++;
      if (comp.length < minCompPx || comp.length > maxCompPx) {
        lineRejectStats.compsAreaReject++;
        continue;
      }

      const feat = segmentFeaturesFromComponent(comp, w);
      if (!feat) {
        lineRejectStats.compsFeatureReject++;
        continue;
      }

      // Сохраняем только очень грубое ограничение на размер компонента.
      if (Math.max(feat.bboxW, feat.bboxH) > 220) {
        lineRejectStats.compsTooBig++;
        continue;
      }
      if (isInStickerExclusion((feat.p1.x + feat.p2.x) / 2, (feat.p1.y + feat.p2.y) / 2, 16)) {
        lineRejectStats.compsSticker++;
        continue;
      }

      let nearEdge = 0;
      let edgeSum = 0;
      for (let k = 0; k < comp.length; k++) {
        const idx = comp[k];
        const px = idx % w;
        const py = (idx - px) / w;
        const d = getEdgeDistance(px, py);
        edgeSum += d;
        if (d < 7) nearEdge++;
      }
      const nearEdgeRatio = nearEdge / comp.length;
      const meanEdgeDist = edgeSum / comp.length;

      const primaryPass =
        feat.ratio >= 1.35 &&
        feat.linearity >= 2.2 &&
        feat.lengthPx >= 12;
      const relaxedPass =
        feat.lengthPx >= 9 &&
        feat.linearity >= 1.6 &&
        feat.ratio >= 1.15;
      const emergencyPass = feat.lengthPx >= 6;

      if (primaryPass) lineRejectStats.compsPrimaryPass++;
      else lineRejectStats.compsPrimaryFail++;
      if (relaxedPass) lineRejectStats.compsRelaxedPass++;
      else lineRejectStats.compsRelaxedFail++;
      if (emergencyPass) lineRejectStats.compsEmergencyPass++;
      else lineRejectStats.compsEmergencyFail++;

      const score =
        feat.lengthPx * 2.8 +
        feat.linearity * 5.5 +
        feat.ratio * 7.0 +
        meanEdgeDist * 1.3 -
        feat.fillRatio * 14.0;

      if (primaryPass && (!best || score > best.score)) {
        best = { score, p1: feat.p1, p2: feat.p2, feat, comp };
      }
      if (!relaxed || score > relaxed.score) {
        relaxed = { score, p1: feat.p1, p2: feat.p2, feat, comp };
      }

      // Аварийный кандидат: самый длинный компонент, если все строгие фильтры провалились.
      const emergencyScore = feat.lengthPx * 3 + meanEdgeDist;
      if (
        (!emergency || emergencyScore > emergency.score) &&
        feat.lengthPx >= 6 &&
        Math.max(feat.bboxW, feat.bboxH) <= 220
      ) {
        emergency = { score: emergencyScore, p1: feat.p1, p2: feat.p2, feat, comp };
      }
    }
  }
  if (best) {
    lineMaskBest = toBinaryMask(best.comp, size);
    lineRejectStats.selectedBy = "primary";
    return { p1: best.p1, p2: best.p2 };
  }
  if (relaxed && relaxed.feat.lengthPx >= 9 && relaxed.feat.linearity >= 1.6 && relaxed.feat.ratio >= 1.15) {
    lineMaskBest = toBinaryMask(relaxed.comp, size);
    lineRejectStats.selectedBy = "relaxed";
    return { p1: relaxed.p1, p2: relaxed.p2 };
  }
  if (emergency) {
    lineMaskBest = toBinaryMask(emergency.comp, size);
    lineRejectStats.selectedBy = "emergency";
    return { p1: emergency.p1, p2: emergency.p2 };
  }
  // Ультимативный fallback: берем самый длинный компонент из очищенной маски.
  const ultimate = pickLongestComponentSegment(mask, w, h);
  if (ultimate) {
    lineMaskBest = toBinaryMask(ultimate.comp, size);
    lineRejectStats.selectedBy = "ultimate";
    return { p1: ultimate.p1, p2: ultimate.p2 };
  }
  lineRejectStats.selectedBy = "none";
  return null;
}

function pickLongestComponentSegment(mask, w, h) {
  const visited = new Uint8Array(w * h);
  let best = null;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i] || visited[i]) continue;
      const comp = bfsMaskComponent(mask, visited, x, y, w, h);
      if (!comp || comp.length < 4) continue;
      const feat = segmentFeaturesFromComponent(comp, w);
      if (!feat) continue;
      const mx = (feat.p1.x + feat.p2.x) / 2;
      const my = (feat.p1.y + feat.p2.y) / 2;
      if (isInStickerExclusion(mx, my, 16)) continue;
      const d = getEdgeDistance(mx, my);
      if (!Number.isFinite(d) || d < 0.8) continue;
      if (!best || feat.lengthPx > best.lengthPx) {
        best = { p1: feat.p1, p2: feat.p2, lengthPx: feat.lengthPx, comp };
      }
    }
  }
  return best;
}

function toBinaryMask(indexes, size) {
  const out = new Uint8Array(size);
  if (!indexes) return out;
  for (let i = 0; i < indexes.length; i++) {
    out[indexes[i]] = 1;
  }
  return out;
}

function detectLineSegmentOpenCV() {
  if (!cvReady || !window.cv || !window.cv.Mat || !sourceCanvas.width || !polygonMask) return null;

  let src = null;
  let gray = null;
  let dark = null;
  let poly = null;
  let masked = null;
  let kernel = null;
  let lines = null;
  try {
    const w = canvas.width;
    const h = canvas.height;
    src = cv.imread(sourceCanvas);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    dark = new cv.Mat();
    cv.threshold(gray, dark, 150, 255, cv.THRESH_BINARY_INV);

    poly = new cv.Mat(h, w, cv.CV_8U);
    const pd = poly.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        pd[i] = polygonMask[i] && !isInStickerExclusion(x, y, 10) ? 255 : 0;
      }
    }

    masked = new cv.Mat();
    cv.bitwise_and(dark, poly, masked);

    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.morphologyEx(masked, masked, cv.MORPH_OPEN, kernel);
    cv.morphologyEx(masked, masked, cv.MORPH_CLOSE, kernel);

    lines = new cv.Mat();
    cv.HoughLinesP(masked, lines, 1, Math.PI / 180, 18, 14, 8);
    if (!lines || lines.rows < 1) return null;

    let best = null;
    for (let i = 0; i < lines.rows; i++) {
      const v = lines.data32S;
      const x1 = v[i * 4];
      const y1 = v[i * 4 + 1];
      const x2 = v[i * 4 + 2];
      const y2 = v[i * 4 + 3];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len < 10) continue;

      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      if (isInStickerExclusion(mx, my, 16)) continue;
      const edgeD = getEdgeDistance(mx, my);
      if (edgeD < 1) continue;

      let darkSamples = 0;
      let samples = 0;
      for (let t = 0; t <= 8; t++) {
        const a = t / 8;
        const sx = Math.round(x1 + dx * a);
        const sy = Math.round(y1 + dy * a);
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        samples++;
        if (sampleGray(sx, sy) < 145) darkSamples++;
      }
      if (samples < 4) continue;
      const darkRatio = darkSamples / samples;
      if (darkRatio < 0.5) continue;

      const score = len * 2.3 + edgeD * 1.1 + darkRatio * 20;
      if (!best || score > best.score) {
        best = {
          score,
          p1: { x: x1, y: y1 },
          p2: { x: x2, y: y2 }
        };
      }
    }
    return best ? { p1: best.p1, p2: best.p2 } : null;
  } catch (err) {
    return null;
  } finally {
    if (src) src.delete();
    if (gray) gray.delete();
    if (dark) dark.delete();
    if (poly) poly.delete();
    if (masked) masked.delete();
    if (kernel) kernel.delete();
    if (lines) lines.delete();
  }
}

function segmentFeaturesFromComponent(comp, w) {
  const n = comp.length;
  if (!n) return null;
  let mx = 0;
  let my = 0;
  let minX = 1e9;
  let minY = 1e9;
  let maxX = -1;
  let maxY = -1;
  const pts = new Array(n);
  for (let i = 0; i < n; i++) {
    const idx = comp[i];
    const x = idx % w;
    const y = (idx - x) / w;
    pts[i] = { x, y };
    mx += x;
    my += y;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  mx /= n;
  my /= n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
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
  if (l1 <= 1e-6) return null;
  const linearity = l1 / Math.max(1e-6, l2);

  // Главная ось.
  let vx = 1;
  let vy = 0;
  if (Math.abs(sxy) > 1e-6 || Math.abs(sxx - l1) > 1e-6) {
    vx = sxy;
    vy = l1 - sxx;
    const nm = Math.hypot(vx, vy);
    if (nm > 1e-6) {
      vx /= nm;
      vy /= nm;
    }
  }

  let minProj = Infinity;
  let maxProj = -Infinity;
  let minPt = null;
  let maxPt = null;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const t = (p.x - mx) * vx + (p.y - my) * vy;
    if (t < minProj) {
      minProj = t;
      minPt = p;
    }
    if (t > maxProj) {
      maxProj = t;
      maxPt = p;
    }
  }
  const lengthPx = maxProj - minProj;
  const widthPx = Math.sqrt(Math.max(1e-6, l2 / Math.max(1, n))) * 4;
  const ratio = lengthPx / Math.max(1.0, widthPx);
  if (!minPt || !maxPt) return null;

  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  const bboxArea = Math.max(1, bboxW * bboxH);
  const fillRatio = n / bboxArea;

  return {
    p1: { x: minPt.x, y: minPt.y },
    p2: { x: maxPt.x, y: maxPt.y },
    lengthPx,
    ratio,
    linearity,
    bboxW,
    bboxH,
    fillRatio
  };
}

function recomputeNapFromLine(source) {
  napVector = computeNapVectorFromLine();
  draw();
  if (edgePoint) {
    writeVectorInfo(edgePoint.x, edgePoint.y, source);
  } else if (markerPoint) {
    writeVectorInfo(markerPoint.x, markerPoint.y, source);
  } else if (lineP1) {
    writeVectorInfo(lineP1.x, lineP1.y, source);
  }
  updateControlsState();
}

function computeNapVectorFromLine() {
  if (!lineP1 || !lineP2 || !edgeDistanceMap) return null;
  const d1Px = getEdgeDistance(lineP1.x, lineP1.y);
  const d2Px = getEdgeDistance(lineP2.x, lineP2.y);
  const from = lineP1;
  const to = lineP2;
  const choiceText = "фиксированно: P1→P2";

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const vx = dx / len;
  const vy = dy / len;
  let angleDeg = Math.atan2(vy, vx) * 180 / Math.PI;
  if (angleDeg < 0) angleDeg += 360;
  return {
    from,
    to,
    vx,
    vy,
    d1Px,
    d2Px,
    angleDeg,
    choiceText
  };
}

function toMmDistance(px) {
  if (!Number.isFinite(px)) return null;
  if (dpiX && dpiY) {
    const mmPerPx = (25.4 / dpiX + 25.4 / dpiY) / 2;
    return px * mmPerPx;
  }
  return null;
}

function formatDist(mm, px) {
  if (Number.isFinite(mm)) return `${mm.toFixed(2)} мм`;
  if (Number.isFinite(px)) return `${px.toFixed(2)} px (DPI нет)`;
  return "-";
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

function buildDictStatusLine() {
  const m = dictStatusMeta || {};
  const base = m.message || "dicts: -";
  if (m.source === "fresh" && Number.isFinite(m.loadMs)) {
    return `${base} (${formatDuration(m.loadMs)})`;
  }
  if ((m.source === "cache" || m.source === "stale") && Number.isFinite(m.ageMs)) {
    const ttlPart = Number.isFinite(m.ttlMs) ? ` / ttl ${formatDuration(m.ttlMs)}` : "";
    return `${base} (age ${formatDuration(m.ageMs)}${ttlPart})`;
  }
  return base;
}

function renderDictStatus() {
  if (!dictStatus) return;
  const m = dictStatusMeta || {};
  dictStatus.textContent = buildDictStatusLine();
  dictStatus.className = "dict-status";
  if (m.phase === "loading") dictStatus.classList.add("pending");
  else if (m.phase === "ok") dictStatus.classList.add("success");
  else if (m.phase === "warn") dictStatus.classList.add("warn");
  else if (m.phase === "error") dictStatus.classList.add("error");
}

function updateDictStatusMeta(next) {
  dictStatusMeta = {
    ...dictStatusMeta,
    ...next
  };
  renderDictStatus();
}

function polygonMetricsText() {
  const area = modelStats?.polygonAreaPx ?? modelStats?.polygonCount ?? 0;
  const bw = modelStats?.bboxW ?? 0;
  const bh = modelStats?.bboxH ?? 0;
  const maxSpanPx = getMaxSpanPx();
  if (contourPathMethod === "-" && polygonMask) {
    // Лениво определяем метод/валидность внешнего контура для отображения в UI.
    buildBoundaryPathPx(12);
  }
  let text = `Площадь полигона: ${area} px^2\nГабариты полигона (bbox): ${bw} x ${bh} px`;
  if (Number.isFinite(maxSpanPx) && maxSpanPx > 0) {
    text += `\nМаксимальный габарит: ${maxSpanPx.toFixed(1)} px`;
  }
  if (dpiX && dpiY) {
    text += `\nDPI: ${dpiX.toFixed(2)} x ${dpiY.toFixed(2)} (${dpiSource})`;
  } else {
    text += `\nDPI: не найден в метаданных`;
  }
  text += `\nКонтур для БД: ${contourPathMethod}`;
  text += `\nСправочники: ${buildDictStatusLine()}`;
  return text;
}

function setViewValue(el, value) {
  if (!el) return;
  el.value = value ?? "-";
}

function getMaxSpanPx() {
  if (maxSpanPxCache == null) {
    maxSpanPxCache = computeMaxSpanPx();
  }
  return maxSpanPxCache;
}

function refreshPieceCard() {
  const inventoryTag = normalizeInventoryTag(qrText) || "-";
  const invMissing = !!img && !normalizeInventoryTag(qrText);
  const areaPx = modelStats?.polygonAreaPx ?? modelStats?.polygonCount ?? 0;
  const bboxWidthPx = modelStats?.bboxW ?? 0;
  const bboxHeightPx = modelStats?.bboxH ?? 0;
  const areaMm2 = dpiX && dpiY ? areaPx * (25.4 / dpiX) * (25.4 / dpiY) : null;
  const bboxWidthMm = dpiX ? bboxWidthPx * 25.4 / dpiX : null;
  const bboxHeightMm = dpiY ? bboxHeightPx * 25.4 / dpiY : null;
  const maxSpanMm = toMmDistance(getMaxSpanPx());
  const napDeg = napVector ? napVector.angleDeg : null;

  setViewValue(invTagView, inventoryTag);
  if (invTagView) invTagView.classList.toggle("field-invalid", invMissing);
  setViewValue(areaMm2View, Number.isFinite(areaMm2) ? areaMm2.toFixed(2) : "-");
  setViewValue(bboxWidthMmView, Number.isFinite(bboxWidthMm) ? bboxWidthMm.toFixed(2) : "-");
  setViewValue(bboxHeightMmView, Number.isFinite(bboxHeightMm) ? bboxHeightMm.toFixed(2) : "-");
  setViewValue(maxSpanMmView, Number.isFinite(maxSpanMm) ? maxSpanMm.toFixed(2) : "-");
  setViewValue(napDegView, Number.isFinite(napDeg) ? napDeg.toFixed(1) : "-");
}

function computeMaxSpanPx() {
  if (!polygonMask || !canvas?.width || !canvas?.height) return null;
  const pathPx = buildBoundaryPathPx(2);
  if (!pathPx || pathPx.length < 2) return null;
  let maxD2 = 0;
  for (let i = 0; i < pathPx.length; i++) {
    const a = pathPx[i];
    for (let j = i + 1; j < pathPx.length; j++) {
      const b = pathPx[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > maxD2) maxD2 = d2;
    }
  }
  return maxD2 > 0 ? Math.sqrt(maxD2) : null;
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

  if (!napVector) {
    setSaveStatus("error", "Нет направления. Задай P1→P2.");
    return null;
  }
  const napDirectionDeg = napVector.angleDeg;
  const materialId = String(materialSelect?.value || "").trim();
  const storageLocationId = String(storageSelect?.value || "").trim();
  const scrapQuality = String(qualitySelect?.value || "Good").trim() || "Good";
  const scrapStatus = "Available";
  const note = String(noteInput?.value || "").trim();

  if (!materialId) {
    setSaveStatus("error", "Выбери материал.");
    output.textContent = "Сохранение отменено: поле 'Материал' обязательно.";
    return null;
  }
  if (!/^(Good|Limited)$/.test(scrapQuality)) {
    setSaveStatus("error", "Некорректное качество.");
    output.textContent = "Сохранение отменено: качество должно быть Good или Limited.";
    return null;
  }
  if (scrapQuality === "Limited" && !note) {
    setSaveStatus("error", "Для качества 'Ограниченное' нужен комментарий/дефект.");
    output.textContent = "Сохранение отменено: для качества 'Ограниченное' поле 'Комментарий/дефект' обязательно.";
    return null;
  }

  const contour = buildScrapContourJson();
  const areaMm2 = dpiX && dpiY ? areaPx * (25.4 / dpiX) * (25.4 / dpiY) : null;
  const bboxWidthMm = dpiX ? bboxWidthPx * 25.4 / dpiX : null;
  const bboxHeightMm = dpiY ? bboxHeightPx * 25.4 / dpiY : null;
  const maxSpanPx = getMaxSpanPx();
  const maxSpanMm = toMmDistance(maxSpanPx);

  return {
    inventoryTag,
    materialId,
    storageLocationId: storageLocationId || null,
    scrapQuality,
    scrapStatus,
    note,
    napDirectionDeg,
    areaMm2,
    bboxWidthMm,
    bboxHeightMm,
    maxSpanMm,
    scrapContour: contour,
    metrics: {
      appVersion: APP_VERSION,
      mode,
      detector: lastDetector,
      markerPoint: markerPoint ? { x: markerPoint.x, y: markerPoint.y } : null,
      edgePoint: edgePoint ? { x: edgePoint.x, y: edgePoint.y } : null,
      lineP1,
      lineP2,
      d1Px: napVector?.d1Px ?? null,
      d2Px: napVector?.d2Px ?? null,
      d1Mm: toMmDistance(napVector?.d1Px),
      d2Mm: toMmDistance(napVector?.d2Px),
      directionChoice: napVector?.choiceText || null,
      vector: napVector ? { vx: napVector.vx, vy: napVector.vy } : null,
      areaPx,
      bboxWidthPx,
      bboxHeightPx,
      maxSpanPx,
      maxSpanMm,
      dpiX,
      dpiY,
      dpiSource,
      qrText
      ,
      materialId,
      storageLocationId: storageLocationId || null,
      scrapQuality,
      scrapStatus,
      note
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
        method: contourPathMethod,
        dpiX,
        dpiY
      }
    };
  }
  return {
    units: "px",
    path: pathPx,
    source: { unitsRaw: "px", method: contourPathMethod }
  };
}

function buildBoundaryPathPx(step) {
  if (!polygonMask) {
    contourPathMethod = "none";
    return [];
  }
  const w = canvas.width;
  const h = canvas.height;
  const contourMask = buildCleanContourMask(w, h) || polygonMask;

  // В БД нужен строго внешний упорядоченный контур (без внутренних "дыр" от QR/штриха).
  let pts = buildOuterContourOpenCv(contourMask, w, h);
  if (pts && pts.length) {
    contourPathMethod = contourMask === polygonMask ? "opencv-external" : "opencv-external-clean";
  } else {
    pts = traceOuterContourMask(contourMask, w, h);
    contourPathMethod = pts && pts.length
      ? (contourMask === polygonMask ? "mask-trace" : "mask-trace-clean")
      : "none";
  }
  if (!pts || !pts.length) return [];

  const sampled = [];
  const stride = Math.max(1, Number(step) || 1);
  for (let i = 0; i < pts.length; i += stride) {
    sampled.push({ x: pts[i].x, y: pts[i].y });
  }
  if (sampled.length > 2) {
    const a = sampled[0];
    const b = sampled[sampled.length - 1];
    if (a.x !== b.x || a.y !== b.y) sampled.push({ x: a.x, y: a.y });
  }
  return sampled;
}

function buildOuterContourOpenCv(mask, w, h) {
  if (!cvReady || !window.cv || !window.cv.Mat) return null;
  let bin = null;
  let contours = null;
  let hierarchy = null;
  let best = null;
  try {
    bin = cv.Mat.zeros(h, w, cv.CV_8U);
    const d = bin.data;
    for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 255 : 0;
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(bin, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
    if (contours.size() < 1) return null;

    let bestArea = -1;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = Math.abs(cv.contourArea(c, false));
      if (area > bestArea) {
        bestArea = area;
        if (best) best.delete();
        best = c.clone();
      }
      c.delete();
    }
    if (!best || best.rows < 3) return null;

    const pts = [];
    const arr = best.data32S;
    for (let i = 0; i < arr.length; i += 2) {
      pts.push({ x: arr[i], y: arr[i + 1] });
    }
    return pts.length >= 3 ? pts : null;
  } catch (_e) {
    return null;
  } finally {
    if (bin) bin.delete();
    if (contours) contours.delete();
    if (hierarchy) hierarchy.delete();
    if (best) best.delete();
  }
}

function traceOuterContourMask(mask, w, h) {
  // Fallback без OpenCV: трассируем внешний контур по бинарной маске (Moore-neighbor).
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? !!mask[y * w + x] : false);

  let sx = -1;
  let sy = -1;
  for (let y = 1; y < h - 1 && sy < 0; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (at(x, y) && !at(x - 1, y)) {
        sx = x;
        sy = y;
        break;
      }
    }
  }
  if (sx < 0) return null;

  const n8 = [
    [-1, -1], [0, -1], [1, -1], [1, 0],
    [1, 1], [0, 1], [-1, 1], [-1, 0]
  ];
  const idxOf = (dx, dy) => {
    for (let i = 0; i < 8; i++) if (n8[i][0] === dx && n8[i][1] === dy) return i;
    return 0;
  };

  let px = sx;
  let py = sy;
  let bx = sx - 1;
  let by = sy;
  const startBx = bx;
  const startBy = by;
  const out = [];
  const maxIter = w * h * 2;

  for (let iter = 0; iter < maxIter; iter++) {
    out.push({ x: px, y: py });
    const bdx = bx - px;
    const bdy = by - py;
    let k = idxOf(bdx, bdy);
    let found = false;
    for (let s = 1; s <= 8; s++) {
      const j = (k + s) & 7;
      const qx = px + n8[j][0];
      const qy = py + n8[j][1];
      if (at(qx, qy)) {
        const bj = (j + 7) & 7;
        bx = px + n8[bj][0];
        by = py + n8[bj][1];
        px = qx;
        py = qy;
        found = true;
        break;
      }
    }
    if (!found) break;
    if (px === sx && py === sy && bx === startBx && by === startBy) break;
  }
  return out.length >= 3 ? out : null;
}

function buildCleanContourMask(w, h) {
  if (!sourceData) return null;
  const size = w * h;
  const tonal = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (!polygonMask[i]) continue;
    const g = sourceData[i * 4]; // grayscale source (R=G=B)
    // Мездра светло-серая; черные линии/QR в этот диапазон не попадают.
    if (g >= 130 && g <= 235) tonal[i] = 1;
  }
  const visited = new Uint8Array(size);
  const main = extractLargestComponent(tonal, visited, w, h);
  if (!main || main.length < 200) return null;
  const out = new Uint8Array(size);
  for (let i = 0; i < main.length; i++) out[main[i]] = 1;
  return out;
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
  const showControlPoints = !!showControlPointsChk?.checked;
  const showBbox = !!showBboxChk?.checked;
  const showEdgeDistances = !!showEdgeDistanceChk?.checked;

  if (showLineMaskChk?.checked) {
    drawLineMaskOverlay();
    if (stickerBox) {
      ctx.strokeStyle = "#ff00aa";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        stickerBox.minX - 8,
        stickerBox.minY - 8,
        stickerBox.maxX - stickerBox.minX + 16,
        stickerBox.maxY - stickerBox.minY + 16
      );
    }
  }

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

  if (showControlPoints && markerPoint) {
    ctx.fillStyle = "#1d4ed8";
    ctx.beginPath();
    ctx.arc(markerPoint.x, markerPoint.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  if (showControlPoints && edgePoint) {
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(edgePoint.x, edgePoint.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  if (showControlPoints && lineP1) {
    ctx.fillStyle = "#2563eb";
    ctx.beginPath();
    ctx.arc(lineP1.x, lineP1.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1e3a8a";
    ctx.font = "12px Segoe UI";
    ctx.fillText("P1", lineP1.x + 6, lineP1.y - 6);
  }
  if (showControlPoints && lineP2) {
    ctx.fillStyle = "#2563eb";
    ctx.beginPath();
    ctx.arc(lineP2.x, lineP2.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1e3a8a";
    ctx.font = "12px Segoe UI";
    ctx.fillText("P2", lineP2.x + 6, lineP2.y - 6);
  }
  if (lineP1 && lineP2) {
    ctx.strokeStyle = "rgba(37,99,235,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lineP1.x, lineP1.y);
    ctx.lineTo(lineP2.x, lineP2.y);
    ctx.stroke();
  }
  if (napVector) {
    drawArrow(napVector.from.x, napVector.from.y, napVector.to.x, napVector.to.y, "#dc2626");
  }

  if (showBbox && modelStats?.bboxW && modelStats?.bboxH) {
    const bw = modelStats.bboxW;
    const bh = modelStats.bboxH;
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
      ctx.strokeStyle = "#4b5563";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(minX, minY, maxX - minX + 1, maxY - minY + 1);
      ctx.setLineDash([]);
      ctx.fillStyle = "#374151";
      ctx.font = "12px Segoe UI";
      ctx.fillText(`bbox ${bw}x${bh}`, minX + 6, Math.max(14, minY - 6));
    }
  }

  if (showEdgeDistances && lineP1 && lineP2) {
    const d1 = formatDist(toMmDistance(getEdgeDistance(lineP1.x, lineP1.y)), getEdgeDistance(lineP1.x, lineP1.y));
    const d2 = formatDist(toMmDistance(getEdgeDistance(lineP2.x, lineP2.y)), getEdgeDistance(lineP2.x, lineP2.y));
    ctx.fillStyle = "#111827";
    ctx.font = "12px Segoe UI";
    ctx.fillText(`d1=${d1}`, lineP1.x + 10, lineP1.y + 14);
    ctx.fillText(`d2=${d2}`, lineP2.x + 10, lineP2.y + 14);
  }
}

function drawLineMaskOverlay() {
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return;

  let any = false;
  if (lineMaskRaw) {
    ctx.fillStyle = "rgba(255, 200, 0, 0.85)";
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (lineMaskRaw[y * w + x]) {
          any = true;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  if (lineMaskClean) {
    ctx.fillStyle = "rgba(0, 200, 255, 0.9)";
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (lineMaskClean[y * w + x]) {
          any = true;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  if (lineMaskBest) {
    ctx.fillStyle = "rgba(0, 255, 64, 0.95)";
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (lineMaskBest[y * w + x]) {
          any = true;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

}

function applyZoom() {
  if (!img) {
    canvas.style.display = "none";
    if (stageWrap) stageWrap.style.display = "none";
    if (zoomRail) zoomRail.style.display = "none";
    zoomValue.textContent = `${zoomPercent}%`;
    return;
  }
  canvas.style.display = "block";
  if (stageWrap) stageWrap.style.display = "block";
  if (zoomRail) zoomRail.style.display = "flex";

  const scale = zoomPercent / 100;
  const baseW = Math.max(1, canvas.width);
  const baseH = Math.max(1, canvas.height);
  // 100% = нативный размер изображения (1:1).
  const scaledW = Math.max(1, Math.round(baseW * scale));
  const scaledH = Math.max(1, Math.round(baseH * scale));

  canvas.style.transform = "none";
  canvas.style.width = `${baseW}px`;
  canvas.style.height = `${baseH}px`;
  if (stageWrap) {
    stageWrap.style.width = `${baseW}px`;
    stageWrap.style.height = `${baseH}px`;
    stageWrap.style.transform = `translate(${scenePanX}px, ${scenePanY}px) scale(${scale})`;
  }

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
  refreshPieceCard();
  updateControlsState();

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

function detectStickerBox() {
  if (!polygonMask || !edgeDistanceMap || !sourceData) return null;
  const w = canvas.width;
  const h = canvas.height;
  const size = w * h;
  const bright = new Uint8Array(size);
  const visited = new Uint8Array(size);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!polygonMask[i]) continue;
      if (getEdgeDistance(x, y) < 5) continue;
      const g = sampleGray(x, y);
      if (g > 230) bright[i] = 1;
    }
  }

  let best = null;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!bright[i] || visited[i]) continue;
      const comp = bfsMaskComponent(bright, visited, x, y, w, h);
      if (!comp || comp.length < 150 || comp.length > 40000) continue;

      let minX = w;
      let minY = h;
      let maxX = 0;
      let maxY = 0;
      for (let k = 0; k < comp.length; k++) {
        const idx = comp[k];
        const px = idx % w;
        const py = (idx - px) / w;
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (bw < 20 || bh < 12) continue;
      const ratio = bw / Math.max(1, bh);
      if (ratio < 1.2 || ratio > 8.0) continue;

      const fill = comp.length / Math.max(1, bw * bh);
      if (fill < 0.35) continue;

      const score = comp.length + bw * bh * 0.2;
      if (!best || score > best.score) {
        best = { minX, minY, maxX, maxY, score };
      }
    }
  }
  return best;
}

function isInStickerExclusion(x, y, pad) {
  if (!stickerBox) return false;
  const p = Number.isFinite(pad) ? pad : 0;
  return (
    x >= stickerBox.minX - p &&
    x <= stickerBox.maxX + p &&
    y >= stickerBox.minY - p &&
    y <= stickerBox.maxY + p
  );
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
  const allowed = new Set([
    "lab-neutral",
    "blueprint",
    "warm-paper",
    "high-contrast",
    "slate-pro",
    "nord-light",
    "sand-ui",
    "windows-classic",
    "modern-pico"
  ]);
  const saved = localStorage.getItem(THEME_KEY);
  const theme = allowed.has(saved) ? saved : "lab-neutral";
  applyTheme(theme);
  if (themeSelect) {
    themeSelect.value = theme;
    themeSelect.addEventListener("change", () => {
      const next = allowed.has(themeSelect.value) ? themeSelect.value : "lab-neutral";
      applyTheme(next);
      localStorage.setItem(THEME_KEY, next);
    });
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  syncWindowsStyles(theme === "windows-classic");
  syncModernStyles(theme === "modern-pico");
}

function syncWindowsStyles(enabled) {
  syncCssLink("win98-css", "https://unpkg.com/98.css", enabled);
  syncCssLink("winxp-css", "https://unpkg.com/xp.css", false);
}

function syncModernStyles(enabled) {
  syncCssLink("pico-css", "https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css", enabled);
}

function syncCssLink(id, href, enabled) {
  const existing = document.getElementById(id);
  if (!enabled) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function updateControlsState() {
  clearBtn.disabled = mode !== "manual";
  const q = String(qualitySelect?.value || "Good");
  const invOk = !!normalizeInventoryTag(qrText);
  const materialId = String(materialSelect?.value || "").trim();
  const materialOk = !!materialId;
  const noteRequired = q === "Limited";
  const noteOk = !noteRequired || !!String(noteInput?.value || "").trim();
  if (noteInput) noteInput.classList.toggle("field-invalid", noteRequired && !noteOk);
  if (materialSelect) materialSelect.classList.toggle("field-invalid", !materialOk);
  const materialLabel = materialSelect?.closest("label");
  if (materialLabel) materialLabel.classList.toggle("field-label-invalid", !materialOk);
  const noteLabel = noteInput?.closest("label");
  if (noteLabel) noteLabel.classList.toggle("field-label-invalid", noteRequired && !noteOk);

  saveBtn.disabled = !img || !polygonMask || !apiReady || !dictsLoaded || !napVector || !invOk || !materialOk || !noteOk;
}


async function postSavePayload(payload, confirmOverwrite) {
  const body = { ...payload, confirmOverwrite: !!confirmOverwrite };
  const { res } = await apiFetch("/api/save-scrap-piece", {
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
    const { res } = await apiFetch("/api/health", { method: "GET" });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.ok) {
      apiReady = true;
      await loadDictionaries();
      if (dictsLoaded) setSaveStatus("", "");
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

function fillSelect(select, items, valueField, labelField, keepEmptyOption) {
  if (!select) return;
  const current = select.value;
  const opts = [];
  if (keepEmptyOption) {
    const emptyLabel = keepEmptyOption === true ? "(не размещен)" : String(keepEmptyOption);
    opts.push(`<option value="">${emptyLabel}</option>`);
  }
  for (const it of (items || [])) {
    const v = String(it?.[valueField] ?? "");
    const l = String(it?.[labelField] ?? v);
    opts.push(`<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`);
  }
  select.innerHTML = opts.join("");
  if (current && Array.from(select.options).some((o) => o.value === current)) select.value = current;
}

function pickFirst(obj, keys, fallback = "") {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== "") {
      return String(obj[k]);
    }
  }
  return fallback;
}

function normalizeDictRows(rows, valueKeys, labelKeys) {
  const out = [];
  for (const r of (rows || [])) {
    const value = pickFirst(r, valueKeys, "");
    const label = pickFirst(r, labelKeys, value);
    if (!value) continue;
    out.push({ value, label });
  }
  return out;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadDictionaries() {
  if (dictLoadInFlight) return;
  dictLoadInFlight = true;
  updateDictStatusMeta({
    phase: "loading",
    source: "none",
    message: "dicts: loading",
    loadMs: null,
    ageMs: null,
    stale: false,
    error: ""
  });
  try {
    const { res } = await apiFetch("/api/dicts", { method: "GET" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      updateDictStatusMeta({
        phase: "warn",
        source: "fallback",
        message: "dicts: fallback",
        error: String(json.error || `HTTP ${res.status}`)
      });
      applyFallbackDicts();
      setSaveStatus("warn", `Dictionaries API unavailable (${json.error || `HTTP ${res.status}`}). Fallback mode.`);
      updateControlsState();
      return;
    }

    const materialRows = normalizeDictRows(
      json.materials,
      ["idVal", "id", "materialId", "ID"],
      ["materialName", "name", "label", "descr", "code"]
    ).map((x) => ({ idVal: x.value, materialName: x.label }));

    const locationRows = normalizeDictRows(
      json.locations,
      ["idVal", "id", "locationId", "ID"],
      ["locCode", "code", "locationCode", "name", "label"]
    ).map((x) => ({ idVal: x.value, locCode: x.label }));

    const qualityRows = normalizeDictRows(
      json.qualities,
      ["code", "id", "value"],
      ["descr", "name", "label", "code"]
    ).map((x) => ({ code: x.value, descr: x.label }));

    fillSelect(materialSelect, materialRows, "idVal", "materialName", "(не выбрано)");
    fillSelect(storageSelect, locationRows, "idVal", "locCode", "(не выбрано)");
    fillSelect(qualitySelect, qualityRows, "code", "descr", false);
    if (!qualitySelect.value) qualitySelect.value = "Good";

    if (qualityRows.length === 0) {
      applyFallbackDicts();
      setSaveStatus("warn", "Quality dictionary is empty. Fallback mode.");
      updateDictStatusMeta({
        phase: "warn",
        source: "fallback",
        message: "dicts: quality-fallback",
        error: "quality_empty"
      });
    } else {
      const cache = json.cache || {};
      const stale = !!cache.stale;
      const source = cache.cached ? (stale ? "stale" : "cache") : "fresh";
      updateDictStatusMeta({
        phase: stale ? "warn" : "ok",
        source,
        message: `dicts: ${source}`,
        loadMs: Number.isFinite(cache.loadMs) ? cache.loadMs : null,
        ageMs: Number.isFinite(cache.ageMs) ? cache.ageMs : null,
        ttlMs: Number.isFinite(cache.ttlMs) ? cache.ttlMs : null,
        stale,
        error: String(cache.error || "")
      });
    }

    dictsLoaded = true;
    updateControlsState();
  } catch (e) {
    updateDictStatusMeta({
      phase: "error",
      source: "fallback",
      message: "dicts: error/fallback",
      error: String(e?.message || e || "")
    });
    applyFallbackDicts();
    setSaveStatus("warn", "Cannot load dictionaries from API. Fallback mode.");
    updateControlsState();
  } finally {
    dictLoadInFlight = false;
  }
}

function applyFallbackDicts() {
  const qualityRows = [
    { code: "Good", descr: "Хорошее" },
    { code: "Limited", descr: "Ограниченное" }
  ];
  fillSelect(materialSelect, [], "idVal", "materialName", "(не выбрано)");
  fillSelect(storageSelect, [], "idVal", "locCode", "(не выбрано)");
  fillSelect(qualitySelect, qualityRows, "code", "descr", false);
  if (!qualitySelect.value) qualitySelect.value = "Good";
  dictsLoaded = true;
}

mode = getMode();
updateHintText();
renderDictStatus();
if (appVersionEl) appVersionEl.textContent = `Версия проекта: ${APP_VERSION}`;
updateControlsState();
if (!img) {
  output.textContent =
`Шаги:
1) Загрузи скан.
2) В режиме "Авто" система пытается сама найти отрезок P1→P2 на мездре.
3) Если авто не сработал, переключись в "Ручной" и поставь 2 точки на линии ворса: сначала P1, потом P2.
4) Направление ворса всегда считается от P1→P2.
5) После этого запись в Access станет доступна.`;
}
applyZoom();
updateStageCursor();
