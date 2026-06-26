import {
  runSaveFlow,
  buildSaveUiReport
} from './saveFlow.js';
import { drawOverlayLayer as renderOverlayLayer } from './overlayRenderer.js';
import { attachResizeRecenterHandler, calcCenteredPan, clampZoomPercent, getZoomRenderState, resolveStageCursor } from './viewport.js';
import { attachStagePanHandlers } from './panHandlers.js';
import { attachKeyboardPanHandlers } from './keyboardPan.js';
import { createLegacyApiFetch } from './apiRuntime.js';
import { createLegacyDictsRuntime } from './dictsRuntime.js';
import { runSegmentationPipeline } from './segmentationPipelines.js';

const fileInput = document.getElementById("fileInput");
const pickScanBtn = document.getElementById("pickScanBtn");
const fileNameText = document.getElementById("fileNameText");
const zoomInput = document.getElementById("zoomInput");
const zoomValue = document.getElementById("zoomValue");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const clearBtn = document.getElementById("clearBtn");
const saveBtn = document.getElementById("saveBtn");
const showContourChk = document.getElementById("showContourChk");
const showLineMaskChk = document.getElementById("showLineMaskChk");
const showEdgeDistanceChk = document.getElementById("showEdgeDistanceChk");
const showBboxChk = document.getElementById("showBboxChk");
const showControlPointsChk = document.getElementById("showControlPointsChk");
const showNapArrowChk = document.getElementById("showNapArrowChk");
const showMmGridChk = document.getElementById("showMmGridChk");
const debugOptions = document.getElementById("debugOptions");
const uploadImageChk = document.getElementById("uploadImageChk");
const saveStatus = document.getElementById("saveStatus");
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
const overlayCanvas = document.getElementById("overlayCanvas");
const stage = document.querySelector(".stage");
const stageWrap = document.querySelector(".stage-wrap");
const zoomRail = document.querySelector(".zoom-rail");
const output = document.getElementById("output");
const modeInputs = document.querySelectorAll("input[name='mode']");
const ctx = canvas.getContext("2d");
const overlayCtx = overlayCanvas ? overlayCanvas.getContext("2d") : null;

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
let contourPipeline = "v1";
let segmentationRunId = 0;
const SEGMENTATION_SOFT_TIMEOUT_MS = 180;
const SEGMENTATION_HARD_TIMEOUT_MS = 600;
const DEFAULT_SCAN_DPI = 150;
let mode = "auto";
let pointSource = null;
let modelStats = null;
const APP_VERSION = "2.0.42";
let cvReady = false;
let cvLoadError = null;
let lastDetector = "none";
let zoomPercent = 100;
let qrText = "(не распознан)";
let uiManualInventoryTag = "";
let dpiX = null;
let dpiY = null;
let dpiSource = "unknown";
let sourceFile = null;
let dictLoadInFlight = false;
let apiReady = false;
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
let contourDraftMode = false;
let contourDraftPoints = null;
let contourAppliedPoints = null;
let contourDragActive = false;
let contourDragIndex = -1;
let contourHoverIndex = -1;
let contourSelectedIndex = -1;
let contourSelectedSet = new Set();
let contourBoxSelectActive = false;
let contourBoxSelectStart = null;
let contourBoxSelectEnd = null;
let contourUndoStack = [];
const CONTOUR_UNDO_LIMIT = 40;
const CONTOUR_DRAFT_TARGET_POINTS = 120;
const CONTOUR_DRAFT_FETCH_STRIDE = 8;
const INVENTORY_TAG_MASK_RX = /^FL-SCR-[0-9]{6}$/;
let maxSpanPxCache = null;
let lastLoadTelemetry = null;
let dictsLoaded = false;
let clearDisabledState = true;
let saveDisabledState = true;
let uiUploadChecked = true;
let uiDebugState = {
  contour: true,
  lineMask: false,
  edgeDistance: false,
  bbox: false,
  controlPoints: true,
  napArrow: true,
  mmGrid: true
};
let uiSelectState = {
  materialValue: "",
  storageValue: "",
  qualityValue: ""
};
let uiNoteValue = "";
let uiFileName = "(файл не выбран)";
let uiOutputText = "";
let saveStatusKind = "";
let saveStatusMessage = "";
const LDV_FLAGS = window.__ldvFlags || {};
const LEGACY_DOM_SYNC = !LDV_FLAGS.disableLegacyDomSync;
const LDV_STATE_EVENT = "ldv:state";
const LDV_SAVE_STATUS_EVENT = "ldv:save-status";
const LDV_SCAN_STATUS_EVENT = "ldv:scan-status";
let lastLdvStateSig = "";
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
let saveInFlight = false;
let saveAbortController = null;
let saveRunSeq = 0;
let trainingSaveInFlight = false;
// Legacy API transport with runtime base discovery/pinning.
const apiFetch = createLegacyApiFetch({
  getHostname: () => window.location.hostname,
  fetchImpl: (url, options) => fetch(url, options)
});
const dictRuntime = createLegacyDictsRuntime({
  LDV_FLAGS,
  LEGACY_DOM_SYNC,
  apiFetch,
  materialSelect,
  storageSelect,
  qualitySelect,
  setSelectValueState,
  getUiSelectState: () => uiSelectState,
  setSaveStatus,
  updateControlsState,
  setApiReady: (next) => { apiReady = !!next; },
  getDictLoadInFlight: () => !!dictLoadInFlight,
  setDictLoadInFlight: (next) => { dictLoadInFlight = !!next; },
  setDictsLoaded: (next) => { dictsLoaded = !!next; },
  getDictsLoaded: () => !!dictsLoaded
});

// Visual insets for controls that occupy stage space (zoom rail / display toggles).
const STAGE_VIEW_INSET = {
  left: 86,
  top: 44,
  right: 86,
  bottom: 12
};
const STAGE_FIT_RATIO = 0.97;

function nowMs() {
  return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
}

function getLiveById(cached, id) {
  if (cached && cached.isConnected) return cached;
  return document.getElementById(id);
}

if (LDV_FLAGS.disableLegacyApi) {
  apiReady = true;
  dictsLoaded = true;
}

window.__ldvSetApiState = (apiOk, dictsOk) => {
  apiReady = !!apiOk;
  dictsLoaded = !!dictsOk;
  updateControlsState();
};

function getUploadChecked() {
  return !!uiUploadChecked;
}

function getModeFromReactDom() {
  if (LEGACY_DOM_SYNC) return null;
  const manual = document.querySelector(".mode-row input[type='radio'][value='manual']");
  const auto = document.querySelector(".mode-row input[type='radio'][value='auto']");
  if (manual && manual.checked) return "manual";
  if (auto && auto.checked) return "auto";
  return null;
}

function getEffectiveMode() {
  return getModeFromReactDom() || mode || "auto";
}

function setUploadCheckedState(next) {
  uiUploadChecked = !!next;
  if (!LEGACY_DOM_SYNC) return;
  const el = getLiveById(uploadImageChk, "uploadImageChk");
  if (el) el.checked = uiUploadChecked;
}

function getDebugFlag(flag) {
  const key = String(flag);
  if (!LEGACY_DOM_SYNC) {
    const map = {
      contour: "showContourChk",
      lineMask: "showLineMaskChk",
      edgeDistance: "showEdgeDistanceChk",
      bbox: "showBboxChk",
      controlPoints: "showControlPointsChk",
      napArrow: "showNapArrowChk",
      mmGrid: "showMmGridChk"
    };
    const id = map[key];
    if (id) {
      const live = document.getElementById(id);
      if (live && typeof live.checked === "boolean") return !!live.checked;
    }
  }
  return !!uiDebugState[key];
}

function setDebugFlagState(flag, next) {
  const key = String(flag);
  const checked = !!next;
  if (Object.prototype.hasOwnProperty.call(uiDebugState, key)) {
    uiDebugState[key] = checked;
  }
  if (!LEGACY_DOM_SYNC) return;
  const map = {
    contour: getLiveById(showContourChk, "showContourChk"),
    lineMask: getLiveById(showLineMaskChk, "showLineMaskChk"),
    edgeDistance: getLiveById(showEdgeDistanceChk, "showEdgeDistanceChk"),
    bbox: getLiveById(showBboxChk, "showBboxChk"),
    controlPoints: getLiveById(showControlPointsChk, "showControlPointsChk"),
    napArrow: getLiveById(showNapArrowChk, "showNapArrowChk"),
    mmGrid: getLiveById(showMmGridChk, "showMmGridChk")
  };
  const el = map[key];
  if (el) el.checked = checked;
}

function getSelectValue(kind) {
  const key = `${String(kind)}Value`;
  return String(uiSelectState[key] || "");
}

function setSelectValueState(kind, value) {
  const key = `${String(kind)}Value`;
  const next = String(value || "");
  if (Object.prototype.hasOwnProperty.call(uiSelectState, key)) {
    uiSelectState[key] = next;
  }
  if (!LEGACY_DOM_SYNC) return;
  const map = {
    material: getLiveById(materialSelect, "materialSelect"),
    storage: getLiveById(storageSelect, "storageSelect"),
    quality: getLiveById(qualitySelect, "qualitySelect")
  };
  const el = map[String(kind)];
  if (el) el.value = next;
}

function getNoteValue() {
  return String(uiNoteValue || "");
}

function setNoteValueState(value) {
  const next = String(value || "");
  uiNoteValue = next;
  if (!LEGACY_DOM_SYNC) return;
  const el = getLiveById(noteInput, "noteInput");
  if (el) el.value = next;
}

function getManualInventoryTag() {
  return String(uiManualInventoryTag || "");
}

function setManualInventoryTagState(value) {
  uiManualInventoryTag = normalizeManualInventoryTagInput(value);
}

function normalizeManualInventoryTagInput(text) {
  const raw = String(text || "").toUpperCase();
  if (!raw.trim()) return "";
  const digits = raw.replace(/\D+/g, "").slice(0, 6);
  return digits ? `FL-SCR-${digits}` : "";
}

function isInventoryTagValid(tag) {
  const t = String(tag || "").trim().toUpperCase();
  if (!t) return false;
  return INVENTORY_TAG_MASK_RX.test(t);
}

function getInventoryTagCandidate() {
  const manualRaw = getManualInventoryTag();
  const manual = normalizeInventoryTag(manualRaw);
  if (manualRaw) {
    // If user started manual input, use only manual value as source of truth.
    return manual;
  }
  return normalizeInventoryTag(qrText);
}

function getEffectiveInventoryTag() {
  const tag = getInventoryTagCandidate();
  return isInventoryTagValid(tag) ? tag : "";
}

function setOutputTextState(value) {
  uiOutputText = String(value || "");
  if (!LEGACY_DOM_SYNC) return;
  const el = getLiveById(output, "output");
  if (el) el.textContent = uiOutputText;
}

function appendOutputTextState(value) {
  const suffix = String(value || "");
  if (!suffix) return;
  setOutputTextState(uiOutputText ? `${uiOutputText}${suffix}` : suffix);
}

function getValidationState() {
  const q = String(getSelectValue("quality") || "").trim();
  const qualityFilled = !!q;
  const noteRequired = q === "Limited";
  const noteFilled = !!String(getNoteValue()).trim();
  const materialFilled = !!String(getSelectValue("material") || "").trim();
  const invCandidate = getInventoryTagCandidate();
  const invReady = !!getEffectiveInventoryTag();
  const invFormatInvalid = !!invCandidate && !isInventoryTagValid(invCandidate);
  const hasImage = !!img;
  const hasMask = !!polygonMask;
  const hasNap = !!napVector;
  const noteMissing = noteRequired && !noteFilled;
  const invMissing = hasImage && (!invReady || invFormatInvalid);
  const materialMissing = !materialFilled;
  const qualityMissing = !qualityFilled;
  const napMissing = hasImage && !hasNap;
  const canSave =
    hasImage &&
    hasMask &&
    !!apiReady &&
    !!dictsLoaded &&
    hasNap &&
    invReady &&
    materialFilled &&
    qualityFilled &&
    !noteMissing;
  return {
    invMissing,
    materialMissing,
    qualityMissing,
    napMissing,
    noteRequired,
    noteMissing,
    canSave
  };
}

function emitLdvState(validationState) {
  mode = getEffectiveMode();
  const validation = validationState || getValidationState();
  const detail = {
    mode,
    contourPipeline,
    zoomPercent,
    fileName: uiFileName,
    outputText: uiOutputText,
    uploadChecked: getUploadChecked(),
    debug: {
      contour: getDebugFlag("contour"),
      lineMask: getDebugFlag("lineMask"),
      edgeDistance: getDebugFlag("edgeDistance"),
      bbox: getDebugFlag("bbox"),
      controlPoints: getDebugFlag("controlPoints"),
      napArrow: getDebugFlag("napArrow"),
      mmGrid: getDebugFlag("mmGrid")
    },
    selects: {
      materialValue: getSelectValue("material"),
      storageValue: getSelectValue("storage"),
      qualityValue: getSelectValue("quality")
    },
    noteValue: getNoteValue(),
    manualInventoryTag: getManualInventoryTag(),
    buttons: {
      saveDisabled: !!saveDisabledState,
      clearDisabled: !!clearDisabledState
    },
    segmentation: {
      runId: modelStats?.runId ?? null,
      mode: modelStats?.mode || null,
      areaPx: modelStats?.polygonAreaPx ?? modelStats?.polygonCount ?? null,
      bboxW: modelStats?.bboxW ?? null,
      bboxH: modelStats?.bboxH ?? null,
      processingTimeMs: modelStats?.processingTimeMs ?? null,
      refineApplied: modelStats?.refineApplied ?? null,
      fallbackUsed: modelStats?.fallbackUsed ?? null,
      timeoutHit: modelStats?.timeoutHit ?? null,
      componentCount: modelStats?.componentCount ?? null,
      maskHash: modelStats?.maskHash ?? null
    },
    pieceView: getPieceViewSnapshot(),
    validation
  };
  window.__ldvLastState = detail;
  const sig = JSON.stringify(detail);
  if (sig === lastLdvStateSig) return;
  lastLdvStateSig = sig;
  window.dispatchEvent(new CustomEvent(LDV_STATE_EVENT, { detail }));
}

function setContourPipeline(next) {
  const p = String(next || "").toLowerCase();
  contourPipeline = (p === "v2" || p === "v3") ? p : "v1";
}

window.__ldvBridge = {
  setContourPipeline(next) {
    setContourPipeline(next);
    emitLdvState();
  },
  setMode(nextMode) {
    applyMode(nextMode === "manual" ? "manual" : "auto");
  },
  setUploadChecked(checked) {
    setUploadCheckedState(checked);
    updateControlsState();
  },
  setDebugFlag(flag, checked) {
    setDebugFlagState(flag, checked);
    draw();
    emitLdvState();
  },
  setZoom(next) {
    applyZoomValue(next);
  },
  zoomBy(delta) {
    const current = Number(zoomPercent || 100) || 100;
    applyZoomValue(current + (Number(delta) || 0));
  },
  setSelectValue(kind, value) {
    setSelectValueState(kind, value);
    updateControlsState();
  },
  setNote(value) {
    setNoteValueState(value);
    updateControlsState();
  },
  setManualInventoryTag(value) {
    setManualInventoryTagState(value);
    updateControlsState();
    emitLdvState();
  },
  refreshView() {
    if (!img) return;
    draw();
    applyZoom();
  },
  clickAction(action) {
    const a = String(action);
    if (a === "pickScan" || a === "pickScanV1") {
      setContourPipeline("v1");
      handlePickScan();
      return;
    }
    if (a === "pickScanV2") {
      setContourPipeline("v2");
      handlePickScan();
      return;
    }
    if (a === "pickScanV3") {
      setContourPipeline("v3");
      handlePickScan();
      return;
    }
    if (a === "contourEditToggle") {
      toggleContourDraftMode();
      return;
    }
    if (a === "contourDraftReset") {
      resetContourDraft();
      return;
    }
    if (a === "contourDraftApply") {
      applyContourDraft();
      return;
    }
    if (a === "clear") {
      handleClear();
      return;
    }
    if (a === "save") {
      void handleSave();
      return;
    }
    if (a === "saveTraining") {
      void handleSaveTraining();
      return;
    }
    if (a === "zoomIn") {
      handleZoomIn();
      return;
    }
    if (a === "zoomOut") {
      handleZoomOut();
    }
  },
  notifyState() {
    emitLdvState();
  }
};

function updateStageCursor() {
  if (!canvas || !stage) return;
  const cursor = resolveStageCursor({ isPanning, spacePanActive });
  // Apply to full scene area, not only the image pixels.
  canvas.style.cursor = cursor;
  stage.style.cursor = cursor;
}

// Global keyboard handling for "hold Space to pan" behavior.
attachKeyboardPanHandlers({
  updateStageCursor,
  setSpacePanActive: (next) => { spacePanActive = !!next; }
});

function centerSceneInStage() {
  if (!img || !stage) return;
  const scale = Math.max(0.01, Number(zoomPercent || 100) / 100);
  const viewW = Math.max(1, Number(stage.clientWidth || 1));
  const viewH = Math.max(1, Number(stage.clientHeight || 1));
  const safeW = Math.max(1, viewW - STAGE_VIEW_INSET.left - STAGE_VIEW_INSET.right);
  const safeH = Math.max(1, viewH - STAGE_VIEW_INSET.top - STAGE_VIEW_INSET.bottom);
  const viewCx = STAGE_VIEW_INSET.left + safeW * 0.5;
  const viewCy = STAGE_VIEW_INSET.top + safeH * 0.5;
  const minX = Number(modelStats && modelStats.bboxMinX);
  const minY = Number(modelStats && modelStats.bboxMinY);
  const bw = Math.max(1, Number(modelStats && modelStats.bboxW) || Number(canvas.width || 1));
  const bh = Math.max(1, Number(modelStats && modelStats.bboxH) || Number(canvas.height || 1));
  const cx = (Number.isFinite(minX) ? minX : 0) + bw * 0.5;
  const cy = (Number.isFinite(minY) ? minY : 0) + bh * 0.5;
  scenePanX = Math.round(viewCx - cx * scale);
  scenePanY = Math.round(viewCy - cy * scale);
}

function fitImageToStage() {
  if (!img || !stage || !canvas) return;
  const viewW = Math.max(1, Number(stage.clientWidth || 1));
  const viewH = Math.max(1, Number(stage.clientHeight || 1));
  const imgW = Math.max(1, Number(modelStats && modelStats.bboxW) || Number(canvas.width || 1));
  const imgH = Math.max(1, Number(modelStats && modelStats.bboxH) || Number(canvas.height || 1));
  const safeW = Math.max(1, viewW - STAGE_VIEW_INSET.left - STAGE_VIEW_INSET.right);
  const safeH = Math.max(1, viewH - STAGE_VIEW_INSET.top - STAGE_VIEW_INSET.bottom);
  const fitScale = Math.min(safeW / imgW, safeH / imgH) * STAGE_FIT_RATIO;
  const fitPercent = Math.floor(Math.max(0.01, fitScale) * 100);
  // Prevent "invisible canvas" when fit unexpectedly falls to 1-2%.
  const safe = clampZoomPercent(Math.max(10, fitPercent), 1, 300, 100);
  zoomPercent = safe;
  if (LEGACY_DOM_SYNC && zoomInput) zoomInput.value = String(safe);
}

// Keep scene centered when viewport size changes.
attachResizeRecenterHandler({
  getHasImage: () => !!img,
  recenterAndApplyZoom: () => {
    centerSceneInStage();
    applyZoom();
  }
});

function updateHintText() {
  if (!LEGACY_DOM_SYNC || !hintText) return;
  if (mode === "manual") {
    hintText.textContent = "Направление ворса по точкам задается оператором";
    return;
  }
  hintText.textContent = "Направление ворса определяется по найденной метке";
}

initOpenCv();
checkApiHealth();
setUploadCheckedState(LEGACY_DOM_SYNC && uploadImageChk ? !!uploadImageChk.checked : uiUploadChecked);
setDebugFlagState("lineMask", LEGACY_DOM_SYNC && showLineMaskChk ? !!showLineMaskChk.checked : uiDebugState.lineMask);
setDebugFlagState("contour", LEGACY_DOM_SYNC && showContourChk ? !!showContourChk.checked : uiDebugState.contour);
setDebugFlagState("edgeDistance", LEGACY_DOM_SYNC && showEdgeDistanceChk ? !!showEdgeDistanceChk.checked : uiDebugState.edgeDistance);
setDebugFlagState("bbox", LEGACY_DOM_SYNC && showBboxChk ? !!showBboxChk.checked : uiDebugState.bbox);
setDebugFlagState("controlPoints", LEGACY_DOM_SYNC && showControlPointsChk ? !!showControlPointsChk.checked : uiDebugState.controlPoints);
setDebugFlagState("napArrow", LEGACY_DOM_SYNC && showNapArrowChk ? !!showNapArrowChk.checked : uiDebugState.napArrow);
setDebugFlagState("mmGrid", LEGACY_DOM_SYNC && showMmGridChk ? !!showMmGridChk.checked : uiDebugState.mmGrid);
setSelectValueState("material", uiSelectState.materialValue);
setSelectValueState("storage", uiSelectState.storageValue);
setSelectValueState("quality", uiSelectState.qualityValue);
setNoteValueState(uiNoteValue);

if (LEGACY_DOM_SYNC) {
  showContourChk?.addEventListener("change", () => { setDebugFlagState("contour", !!showContourChk.checked); draw(); emitLdvState(); });
  showLineMaskChk?.addEventListener("change", () => { setDebugFlagState("lineMask", !!showLineMaskChk.checked); draw(); emitLdvState(); });
  showEdgeDistanceChk?.addEventListener("change", () => { setDebugFlagState("edgeDistance", !!showEdgeDistanceChk.checked); draw(); emitLdvState(); });
  showBboxChk?.addEventListener("change", () => { setDebugFlagState("bbox", !!showBboxChk.checked); draw(); emitLdvState(); });
  showControlPointsChk?.addEventListener("change", () => { setDebugFlagState("controlPoints", !!showControlPointsChk.checked); draw(); emitLdvState(); });
  showNapArrowChk?.addEventListener("change", () => { setDebugFlagState("napArrow", !!showNapArrowChk.checked); draw(); emitLdvState(); });
  showMmGridChk?.addEventListener("change", () => { setDebugFlagState("mmGrid", !!showMmGridChk.checked); draw(); emitLdvState(); });
  uploadImageChk?.addEventListener("change", () => { setUploadCheckedState(!!uploadImageChk.checked); updateControlsState(); });
  qualitySelect?.addEventListener("change", () => { setSelectValueState("quality", qualitySelect.value); updateControlsState(); });
  noteInput?.addEventListener("input", () => { setNoteValueState(noteInput.value); updateControlsState(); });
  materialSelect?.addEventListener("change", () => { setSelectValueState("material", materialSelect.value); updateControlsState(); });
  storageSelect?.addEventListener("change", () => { setSelectValueState("storage", storageSelect.value); updateControlsState(); });
  if (debugOptions) debugOptions.hidden = false;
}

fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  setScanStatus("pending", "Обработка скана...");
  const loadStart = nowMs();
  const telemetry = {
    decodeMs: null,
    dpiMs: null,
    modelMs: null,
    autoMs: null,
    qrMs: null,
    totalMs: null
  };
  uiFileName = String(file.name || "(файл не выбран)");
  if (LEGACY_DOM_SYNC && fileNameText) fileNameText.textContent = uiFileName;
  sourceFile = file;
  if (saveStatusKind !== "warn" && saveStatusKind !== "error") {
    setSaveStatus("", "");
  }
  // Сбрасываем стрелку сразу — не ждём завершения загрузки.
  lineP1 = null; lineP2 = null; napVector = null;
  draw();
  const url = URL.createObjectURL(file);
  const dpiPromise = parseDpiFromFile(file).catch(() => null);
  const image = new Image();
  image.onload = async () => {
    telemetry.decodeMs = nowMs() - loadStart;
    setOutputTextState("Загрузка скана: подготовка изображения...");
    img = image;
    canvas.width = image.width;
    canvas.height = image.height;
    sourceCanvas.width = image.width;
    sourceCanvas.height = image.height;
    sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    sourceCtx.drawImage(image, 0, 0);
    sourceData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
    setManualInventoryTagState("");
    fitImageToStage();
    centerSceneInStage();

    const dpiT0 = nowMs();
    const dpiInfo = await dpiPromise;
    telemetry.dpiMs = nowMs() - dpiT0;
    if (dpiInfo && dpiInfo.x > 1 && dpiInfo.y > 1) {
      dpiX = dpiInfo.x;
      dpiY = dpiInfo.y;
      dpiSource = dpiInfo.source;
    } else {
      dpiX = DEFAULT_SCAN_DPI;
      dpiY = DEFAULT_SCAN_DPI;
      dpiSource = "assumed-150";
    }

    qrText = "(поиск...)";
    updateControlsState();
    const qrT0 = nowMs();
    void decodeQrFromSource()
      .finally(() => {
        telemetry.qrMs = nowMs() - qrT0;
        lastLoadTelemetry = { ...telemetry };
      });
    if (!dictsLoaded) {
      await loadDictionaries();
    }

    const modelT0 = nowMs();
    const model = buildPolygonModel();
    telemetry.modelMs = nowMs() - modelT0;
    polygonMask = model.polygonMask;
    outerBgMask = model.outerBgMask;
    edgeDistanceMap = model.edgeDistanceMap;
    modelStats = model.stats;
    segmentationRunId += 1;
    if (modelStats && typeof modelStats === "object") modelStats.runId = segmentationRunId;
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
    contourDraftMode = false;
    contourDraftPoints = null;
    contourAppliedPoints = null;
    contourDragActive = false;
    contourDragIndex = -1;
    contourHoverIndex = -1;
    contourSelectedIndex = -1;
    contourSelectedSet = new Set();
    contourBoxSelectActive = false;
    contourBoxSelectStart = null;
    contourBoxSelectEnd = null;
    contourUndoStack = [];
    fitImageToStage();
    centerSceneInStage();
    autoDetectLineSegment();
    draw();
    applyZoom();
    // One more fit pass after layout settles to prevent occasional clipping.
    requestAnimationFrame(() => {
      if (!img) return;
      fitImageToStage();
      centerSceneInStage();
      applyZoom();
      draw();
    });
    refreshPieceCard();

    if (mode === "auto") {
      const autoT0 = nowMs();
      runAutoDetect();
      telemetry.autoMs = nowMs() - autoT0;
    } else {
      setOutputTextState("Изображение загружено. Ручной режим: поставь 2 точки на линии ворса (сначала P1, потом P2).");
    }
    telemetry.totalMs = nowMs() - loadStart;
    lastLoadTelemetry = { ...telemetry };
    const loadLine = formatLoadTelemetryText(lastLoadTelemetry);
    if (loadLine) appendOutputTextState(`\n${loadLine}`);
    setScanStatus("success", "Скан готов");
  };
  image.onerror = () => {
    setScanStatus("error", "Ошибка загрузки скана");
  };
  image.src = url;
});

function handlePickScan() {
  // Reset value so selecting the same file fires "change" reliably.
  if (fileInput) fileInput.value = "";
  fileInput?.click();
}

pickScanBtn?.addEventListener("click", handlePickScan);

function applyMode(nextMode) {
  mode = nextMode === "manual" ? "manual" : "auto";
  if (LEGACY_DOM_SYNC && modeInputs && modeInputs.length) {
    modeInputs.forEach((input) => {
      input.checked = input.value === mode;
    });
  }
  updateHintText();
  updateControlsState();
  if (!img) {
    setOutputTextState("Загрузи скан.");
    emitLdvState();
    return;
  }
  if (mode === "auto") {
    // В авто-режиме убираем ручные точки и считаем заново только автоматикой.
    lineP1 = null;
    lineP2 = null;
    napVector = null;
    if (!lineP1 || !lineP2) autoDetectLineSegment();
    runAutoDetect();
    emitLdvState();
    return;
  }
  setOutputTextState("Ручной режим: поставь 2 точки на линии ворса, чтобы задать/исправить направление (P1>P2).");
  emitLdvState();
}

function isPointFinite(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function cloneContourPoints(points) {
  if (!Array.isArray(points)) return null;
  return points
    .filter((p) => isPointFinite(p))
    .map((p) => ({ x: Number(p.x), y: Number(p.y) }));
}

function normalizeContourPoints(points) {
  const src = cloneContourPoints(points);
  if (!src || src.length < 3) return null;
  const out = [];
  let prev = null;
  for (const p of src) {
    if (prev && prev.x === p.x && prev.y === p.y) continue;
    out.push(p);
    prev = p;
  }
  if (out.length >= 3) {
    const a = out[0];
    const b = out[out.length - 1];
    if (a.x === b.x && a.y === b.y) out.pop();
  }
  return out.length >= 3 ? out : null;
}

function downsampleContourPoints(points, targetPoints = CONTOUR_DRAFT_TARGET_POINTS) {
  const norm = normalizeContourPoints(points);
  if (!norm || norm.length < 3) return null;
  const target = Math.max(3, Number(targetPoints) || CONTOUR_DRAFT_TARGET_POINTS);
  if (norm.length <= target) return norm;
  const stride = Math.max(1, Math.ceil(norm.length / target));
  const out = [];
  for (let i = 0; i < norm.length; i += stride) out.push(norm[i]);
  if (out.length < 3) {
    out.push(norm[Math.floor(norm.length / 3)]);
    out.push(norm[Math.floor((norm.length * 2) / 3)]);
  }
  return normalizeContourPoints(out) || norm;
}

function loadContourDraftFromMask() {
  const prevApplied = contourAppliedPoints;
  contourAppliedPoints = null;
  const path = buildBoundaryPathPx(CONTOUR_DRAFT_FETCH_STRIDE);
  contourAppliedPoints = prevApplied;
  const pts = downsampleContourPoints(path, CONTOUR_DRAFT_TARGET_POINTS);
  contourDraftPoints = pts;
  contourDragActive = false;
  contourDragIndex = -1;
  contourHoverIndex = -1;
  contourSelectedIndex = -1;
  contourSelectedSet = new Set();
  contourBoxSelectActive = false;
  contourBoxSelectStart = null;
  contourBoxSelectEnd = null;
  contourUndoStack = [];
}

function toggleContourDraftMode() {
  if (!img || !polygonMask) {
    setOutputTextState("Сначала загрузи скан, потом включай правку контура.");
    return;
  }
  contourDraftMode = !contourDraftMode;
  if (contourDraftMode && (!Array.isArray(contourDraftPoints) || contourDraftPoints.length < 3)) {
    loadContourDraftFromMask();
  }
  if (!contourDraftMode) {
    contourDragActive = false;
    contourDragIndex = -1;
    contourHoverIndex = -1;
    contourSelectedIndex = -1;
    contourSelectedSet = new Set();
    contourBoxSelectActive = false;
    contourBoxSelectStart = null;
    contourBoxSelectEnd = null;
  }
  draw();
  setOutputTextState(
    contourDraftMode
      ? "Режим правки контура: перетаскивай вершины; клик по ребру — добавить; Shift+drag — выделить несколько точек; Delete — удалить выбранные; Ctrl+Z — отмена."
      : "Режим правки контура выключен."
  );
}

function resetContourDraft() {
  if (!img || !polygonMask) {
    setOutputTextState("Нет скана для сброса контура.");
    return;
  }
  loadContourDraftFromMask();
  contourDraftMode = true;
  draw();
  setOutputTextState("Черновик контура сброшен к автоконтуру.");
}

function applyContourDraft() {
  if (!Array.isArray(contourDraftPoints) || contourDraftPoints.length < 3) {
    setOutputTextState("Нет черновика контура для применения.");
    return;
  }
  const normalized = normalizeContourPoints(contourDraftPoints);
  if (!normalized || normalized.length < 3) {
    setOutputTextState("Черновик контура некорректен: нужно минимум 3 точки.");
    return;
  }
  contourAppliedPoints = normalized;
  maxSpanPxCache = null;
  contourDraftMode = false;
  contourDragActive = false;
  contourDragIndex = -1;
  contourHoverIndex = -1;
  contourSelectedIndex = -1;
  contourSelectedSet = new Set();
  contourBoxSelectActive = false;
  contourBoxSelectStart = null;
  contourBoxSelectEnd = null;
  draw();
  refreshPieceCard();
  updateControlsState();
  emitLdvState();
  setOutputTextState("Черновик контура применен в текущем сеансе (без записи в БД).");
}

function canvasClientToImagePoint(e) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height)
  };
}

function clampPointToCanvas(p) {
  return {
    x: Math.max(0, Math.min(Math.max(1, canvas.width - 1), Number(p.x || 0))),
    y: Math.max(0, Math.min(Math.max(1, canvas.height - 1), Number(p.y || 0)))
  };
}

function findNearestContourPointIndex(x, y) {
  if (!Array.isArray(contourDraftPoints) || contourDraftPoints.length < 1) return -1;
  const scale = Math.max(0.01, Number(zoomPercent || 100) / 100);
  const maxDistPx = 12 / scale;
  const maxDist2 = maxDistPx * maxDistPx;
  let bestIdx = -1;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (let i = 0; i < contourDraftPoints.length; i++) {
    const p = contourDraftPoints[i];
    const dx = p.x - x;
    const dy = p.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= maxDist2 && d2 < bestD2) {
      bestIdx = i;
      bestD2 = d2;
    }
  }
  return bestIdx;
}

function getContourHitRadiusPx() {
  const scale = Math.max(0.01, Number(zoomPercent || 100) / 100);
  return 12 / scale;
}

function pushContourUndoSnapshot() {
  if (!Array.isArray(contourDraftPoints) || contourDraftPoints.length < 3) return;
  const snap = cloneContourPoints(contourDraftPoints);
  if (!snap || snap.length < 3) return;
  contourUndoStack.push(snap);
  if (contourUndoStack.length > CONTOUR_UNDO_LIMIT) {
    contourUndoStack = contourUndoStack.slice(contourUndoStack.length - CONTOUR_UNDO_LIMIT);
  }
}

function undoContourDraft() {
  if (!Array.isArray(contourUndoStack) || contourUndoStack.length < 1) return false;
  const prev = contourUndoStack.pop();
  const norm = normalizeContourPoints(prev);
  if (!norm || norm.length < 3) return false;
  contourDraftPoints = norm;
  contourSelectedIndex = Math.min(Math.max(0, contourSelectedIndex), contourDraftPoints.length - 1);
  contourSelectedSet = new Set();
  contourHoverIndex = -1;
  contourDragActive = false;
  contourDragIndex = -1;
  contourBoxSelectActive = false;
  contourBoxSelectStart = null;
  contourBoxSelectEnd = null;
  draw();
  setOutputTextState("Контур: отмена последнего действия.");
  return true;
}

function clearContourSelection() {
  contourSelectedIndex = -1;
  contourSelectedSet = new Set();
}

function setContourSingleSelection(idx) {
  if (!Number.isInteger(idx) || idx < 0) {
    clearContourSelection();
    return;
  }
  contourSelectedIndex = idx;
  contourSelectedSet = new Set([idx]);
}

function getContourSelectionIndices() {
  const out = [];
  if (contourSelectedSet && contourSelectedSet.size > 0) {
    for (const idx of contourSelectedSet) {
      if (Number.isInteger(idx) && idx >= 0 && idx < (contourDraftPoints?.length || 0)) out.push(idx);
    }
    if (out.length > 0) return out;
  }
  if (Number.isInteger(contourSelectedIndex) && contourSelectedIndex >= 0 && contourSelectedIndex < (contourDraftPoints?.length || 0)) {
    out.push(contourSelectedIndex);
    return out;
  }
  if (Number.isInteger(contourHoverIndex) && contourHoverIndex >= 0 && contourHoverIndex < (contourDraftPoints?.length || 0)) {
    out.push(contourHoverIndex);
    return out;
  }
  return out;
}

function applyContourBoxSelection(start, end) {
  if (!Array.isArray(contourDraftPoints) || contourDraftPoints.length < 1) return 0;
  if (!isPointFinite(start) || !isPointFinite(end)) return 0;
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  const picked = [];
  for (let i = 0; i < contourDraftPoints.length; i++) {
    const p = contourDraftPoints[i];
    if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) picked.push(i);
  }
  contourSelectedSet = new Set(picked);
  contourSelectedIndex = picked.length ? picked[picked.length - 1] : -1;
  contourHoverIndex = -1;
  return picked.length;
}

function pointToSegmentDistanceSq(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 <= 1e-9) {
    const dx = px - ax;
    const dy = py - ay;
    return { d2: dx * dx + dy * dy, t: 0 };
  }
  let t = (apx * abx + apy * aby) / ab2;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = px - cx;
  const dy = py - cy;
  return { d2: dx * dx + dy * dy, t };
}

function findNearestContourSegmentIndex(x, y) {
  if (!Array.isArray(contourDraftPoints) || contourDraftPoints.length < 3) return -1;
  const maxDist = getContourHitRadiusPx() * 1.5;
  const maxDist2 = maxDist * maxDist;
  let best = -1;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (let i = 0; i < contourDraftPoints.length; i++) {
    const a = contourDraftPoints[i];
    const b = contourDraftPoints[(i + 1) % contourDraftPoints.length];
    const seg = pointToSegmentDistanceSq(x, y, a.x, a.y, b.x, b.y);
    if (seg.d2 <= maxDist2 && seg.d2 < bestD2) {
      bestD2 = seg.d2;
      best = i;
    }
  }
  return best;
}

function insertContourPointAtSegment(segIdx, point) {
  if (!Array.isArray(contourDraftPoints) || contourDraftPoints.length < 3) return false;
  if (!Number.isInteger(segIdx) || segIdx < 0 || segIdx >= contourDraftPoints.length) return false;
  pushContourUndoSnapshot();
  const p = clampPointToCanvas(point);
  contourDraftPoints.splice(segIdx + 1, 0, p);
  setContourSingleSelection(segIdx + 1);
  contourHoverIndex = contourSelectedIndex;
  draw();
  setOutputTextState("Контур: добавлена новая точка.");
  return true;
}

function removeContourPointAtIndex(idx) {
  if (!Array.isArray(contourDraftPoints) || contourDraftPoints.length <= 3) return false;
  if (!Number.isInteger(idx) || idx < 0 || idx >= contourDraftPoints.length) return false;
  pushContourUndoSnapshot();
  contourDraftPoints.splice(idx, 1);
  if (contourDraftPoints.length < 3) return false;
  setContourSingleSelection(Math.min(idx, contourDraftPoints.length - 1));
  contourHoverIndex = contourSelectedIndex;
  draw();
  setOutputTextState("Контур: точка удалена.");
  return true;
}

function removeContourSelectedPoints() {
  if (!Array.isArray(contourDraftPoints) || contourDraftPoints.length <= 3) return false;
  const selected = getContourSelectionIndices().sort((a, b) => b - a);
  if (selected.length < 1) return false;
  if (contourDraftPoints.length - selected.length < 3) {
    setOutputTextState("Контур: нельзя удалить столько точек (нужно минимум 3).");
    return false;
  }
  pushContourUndoSnapshot();
  for (const idx of selected) {
    if (idx >= 0 && idx < contourDraftPoints.length) contourDraftPoints.splice(idx, 1);
  }
  if (contourDraftPoints.length < 3) return false;
  setContourSingleSelection(Math.min(selected[selected.length - 1], contourDraftPoints.length - 1));
  contourHoverIndex = contourSelectedIndex;
  draw();
  setOutputTextState(`Контур: удалено точек: ${selected.length}.`);
  return true;
}

function handleClear() {
  if (getEffectiveMode() !== "manual") return;
  // Clear only fur direction markers/arrow. Keep contour data untouched.
  lineP1 = null;
  lineP2 = null;
  napVector = null;
  pointSource = null;
  draw();
  refreshPieceCard();
  setOutputTextState("Очистил направление ворса. Контур сохранен. Задай 2 точки P1>P2.");
}

async function handleSave() {
  const runId = ++saveRunSeq;
  if (saveInFlight && saveAbortController) {
    saveAbortController.abort();
  }
  if (!img || !polygonMask) {
    setSaveStatus("", "");
    setOutputTextState("Сначала загрузи изображение.");
    return;
  }
  if (!lineP1 || !lineP2) {
    setSaveStatus("", "");
    setOutputTextState("Задай отрезок ворса: кликни две точки P1 и P2.");
    return;
  }

  const payload = buildSavePayload();
  if (!payload) {
    updateControlsState();
    return;
  }

  const saveT0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  let prepMs = 0;
  if (getUploadChecked() && sourceFile) {
    const prepT0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    try {
      const src = await encodeSourceImage(sourceFile);
      payload.sourceImage = src;
      payload.metrics = payload.metrics || {};
      payload.metrics.sourceImageUploadRequested = true;
    } catch (e) {
      setSaveStatus("error", `Не удалось подготовить файл: ${e?.message || e}`);
      appendOutputTextState(`\n\nНе удалось подготовить файл для загрузки: ${e?.message || e}`);
      return;
    }
    const prepT1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    prepMs = Math.max(0, Math.round(prepT1 - prepT0));
  }

  const prevText = uiOutputText;
  saveInFlight = true;
  saveAbortController = new AbortController();
  const signal = saveAbortController.signal;
  if (saveBtn) saveBtn.disabled = true;
  setSaveStatus("pending", "Сохранение в Access...");
  setOutputTextState(`${prevText}\n\nСохранение в Access...`);
  try {
    const flow = await runSaveFlow(apiFetch, payload, {
      signal,
      askOverwrite: async (inventoryTag) => {
        setSaveStatus("warn", "Запись с таким inventoryTag уже есть.");
        const confirmed = window.confirm(`Запись с тегом ${inventoryTag} уже существует.\nПерезаписать?`);
        if (confirmed) setSaveStatus("pending", "Перезапись существующей записи...");
        return confirmed;
      }
    });
    const saveT1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    const totalMs = Math.max(0, Math.round(saveT1 - saveT0));
    const report = buildSaveUiReport(flow, payload, { prepMs, totalMs, prevText });
    if (report.logLevel === "warn") console.warn("[save-scrap-piece] failed", report.logData || {});
    else console.info("[save-scrap-piece] ok", report.logData || {});
    setOutputTextState(report.outputText || prevText);
    setSaveStatus(report.statusKind || "", report.statusMessage || "");
    if (!report.ok || report.cancelled) return;
  } catch (err) {
    if (err && (err.name === "AbortError" || /aborted/i.test(String(err.message || err)))) {
      if (runId !== saveRunSeq) return;
      setOutputTextState(`${prevText}\n\nСохранение отменено (новый запрос).`);
      setSaveStatus("warn", "Сохранение отменено.");
      return;
    }
    if (runId !== saveRunSeq) return;
    setOutputTextState(`${prevText}\n\nОшибка сохранения в Access: ${err?.message || err}`);
    setSaveStatus("error", `Ошибка: ${err?.message || err}`);
  } finally {
    if (runId !== saveRunSeq) return;
    saveInFlight = false;
    saveAbortController = null;
    if (saveBtn) saveBtn.disabled = false;
    updateControlsState();
  }
}

if (LEGACY_DOM_SYNC) {
  modeInputs.forEach((input) => {
    input.addEventListener("change", () => applyMode(getMode()));
  });
}

clearBtn?.addEventListener("click", handleClear);
saveBtn?.addEventListener("click", () => { void handleSave(); });

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
  if (contourDraftMode) return;
  const activeMode = getEffectiveMode();
  if (activeMode !== "manual") {
    setOutputTextState("Сейчас авто-режим. Для ручной правки переключись в 'Ручной'.");
    return;
  }
  const p = canvasClientToImagePoint(e);
  if (!p) return;
  const x = p.x;
  const y = p.y;
  applyLinePoint(x, y, activeMode);
});

canvas.addEventListener("mousedown", (e) => {
  if (!img || !contourDraftMode || !Array.isArray(contourDraftPoints) || contourDraftPoints.length < 3) return;
  if (spacePanActive || isPanning) return;
  const p = canvasClientToImagePoint(e);
  if (!p) return;
  if (e.shiftKey) {
    contourBoxSelectActive = true;
    contourBoxSelectStart = clampPointToCanvas(p);
    contourBoxSelectEnd = clampPointToCanvas(p);
    contourDragActive = false;
    contourDragIndex = -1;
    draw();
    e.preventDefault();
    return;
  }
  const idx = findNearestContourPointIndex(p.x, p.y);
  if (idx >= 0) {
    pushContourUndoSnapshot();
    contourDragActive = true;
    contourDragIndex = idx;
    setContourSingleSelection(idx);
    contourHoverIndex = idx;
    contourDraftPoints[idx] = clampPointToCanvas(p);
    draw();
    e.preventDefault();
    return;
  }
  const segIdx = findNearestContourSegmentIndex(p.x, p.y);
  if (segIdx >= 0) {
    insertContourPointAtSegment(segIdx, p);
    contourDragActive = true;
    contourDragIndex = contourSelectedIndex;
    e.preventDefault();
  }
});

canvas.addEventListener("mousemove", (e) => {
  const p = canvasClientToImagePoint(e);
  if (!p) return;
  if (contourBoxSelectActive) {
    contourBoxSelectEnd = clampPointToCanvas(p);
    draw();
    e.preventDefault();
    return;
  }
  if (contourDragActive && contourDragIndex >= 0 && Array.isArray(contourDraftPoints)) {
    contourDraftPoints[contourDragIndex] = clampPointToCanvas(p);
    contourSelectedIndex = contourDragIndex;
    contourHoverIndex = contourDragIndex;
    draw();
    e.preventDefault();
    return;
  }
  if (!contourDraftMode || !Array.isArray(contourDraftPoints)) return;
  const idx = findNearestContourPointIndex(p.x, p.y);
  if (idx !== contourHoverIndex) {
    contourHoverIndex = idx;
    draw();
  }
});

window.addEventListener("mouseup", () => {
  if (contourBoxSelectActive) {
    applyContourBoxSelection(contourBoxSelectStart, contourBoxSelectEnd);
    contourBoxSelectActive = false;
    contourBoxSelectStart = null;
    contourBoxSelectEnd = null;
    draw();
  }
  contourDragActive = false;
  contourDragIndex = -1;
});

canvas.addEventListener("dblclick", (e) => {
  if (!img || !contourDraftMode || !Array.isArray(contourDraftPoints)) return;
  const p = canvasClientToImagePoint(e);
  if (!p) return;
  const idx = findNearestContourPointIndex(p.x, p.y);
  if (idx >= 0) {
    removeContourPointAtIndex(idx);
    e.preventDefault();
  }
});

window.addEventListener("keydown", (e) => {
  if (!contourDraftMode) return;
  const key = String(e.key || "").toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === "z") {
    if (undoContourDraft()) e.preventDefault();
    return;
  }
  if (key === "delete" || key === "backspace") {
    const selected = getContourSelectionIndices();
    if (selected.length > 1) {
      if (removeContourSelectedPoints()) e.preventDefault();
      return;
    }
    const idx = selected.length === 1 ? selected[0] : -1;
    if (removeContourPointAtIndex(idx)) e.preventDefault();
    return;
  }
  if (key === "escape") {
    contourDraftMode = false;
    contourDragActive = false;
    contourDragIndex = -1;
    contourHoverIndex = -1;
    clearContourSelection();
    contourBoxSelectActive = false;
    contourBoxSelectStart = null;
    contourBoxSelectEnd = null;
    draw();
    setOutputTextState("Режим правки контура выключен.");
    e.preventDefault();
  }
});

// Stage pointer handlers are delegated to a dedicated pan module.
attachStagePanHandlers({
  stage,
  zoomRail,
  getHasImage: () => !!img,
  getSpacePanActive: () => !!spacePanActive,
  getPanState: () => ({
    isPanning,
    panPointerId,
    panStartClientX,
    panStartClientY,
    panStartX,
    panStartY,
    panMoved,
    scenePanX,
    scenePanY
  }),
  setPanState: (patch) => {
    if (Object.prototype.hasOwnProperty.call(patch, "isPanning")) isPanning = !!patch.isPanning;
    if (Object.prototype.hasOwnProperty.call(patch, "panPointerId")) panPointerId = patch.panPointerId;
    if (Object.prototype.hasOwnProperty.call(patch, "panStartClientX")) panStartClientX = Number(patch.panStartClientX || 0);
    if (Object.prototype.hasOwnProperty.call(patch, "panStartClientY")) panStartClientY = Number(patch.panStartClientY || 0);
    if (Object.prototype.hasOwnProperty.call(patch, "panStartX")) panStartX = Number(patch.panStartX || 0);
    if (Object.prototype.hasOwnProperty.call(patch, "panStartY")) panStartY = Number(patch.panStartY || 0);
    if (Object.prototype.hasOwnProperty.call(patch, "panMoved")) panMoved = !!patch.panMoved;
    if (Object.prototype.hasOwnProperty.call(patch, "scenePanX")) scenePanX = Number(patch.scenePanX || 0);
    if (Object.prototype.hasOwnProperty.call(patch, "scenePanY")) scenePanY = Number(patch.scenePanY || 0);
  },
  updateStageCursor,
  applyZoom,
  setSuppressNextCanvasClick: (next) => { suppressNextCanvasClick = !!next; }
});

function applyZoomValue(next, options = {}) {
  const safe = clampZoomPercent(next, 1, 300, 100);
  const prev = Number(zoomPercent || 100) || 100;
  const keepCentered = options.keepCentered !== false;
  zoomPercent = safe;
  if (img && stage && keepCentered && prev !== safe) {
    const prevScale = Math.max(0.01, prev / 100);
    const nextScale = Math.max(0.01, safe / 100);
    const viewCx = Number(stage.clientWidth || 0) * 0.5;
    const viewCy = Number(stage.clientHeight || 0) * 0.5;
    const imgCx = (viewCx - scenePanX) / prevScale;
    const imgCy = (viewCy - scenePanY) / prevScale;
    scenePanX = Math.round(viewCx - imgCx * nextScale);
    scenePanY = Math.round(viewCy - imgCy * nextScale);
  }
  if (LEGACY_DOM_SYNC && zoomInput) zoomInput.value = String(safe);
  applyZoom();
  if (img) draw();
  emitLdvState();
}

async function handleSaveTraining() {
  if (trainingSaveInFlight) return;
  if (!img || !polygonMask) {
    setSaveStatus("", "");
    setOutputTextState("Сначала загрузи изображение.");
    return;
  }

  const contourPoints = buildBoundaryPathPx(1);
  if (!Array.isArray(contourPoints) || contourPoints.length < 3) {
    setSaveStatus("error", "Нет контура для обучающего датасета.");
    setOutputTextState(`${uiOutputText || ""}\n\nСохранение в датасет отменено: контур пустой.`.trim());
    return;
  }

  const contourMetrics = getActiveContourMetricsPx();
  const inventoryTag = getInventoryTagCandidate();
  let trainingSourceImage = null;
  if (sourceFile) {
    try {
      trainingSourceImage = await encodeSourceImage(sourceFile);
    } catch (e) {
      const warn = `Не удалось прикрепить исходник к датасету: ${e?.message || e}`;
      console.warn("[training-save] source image encode failed", e);
      setOutputTextState(`${uiOutputText || ""}\n\n${warn}`.trim());
    }
  }
  const payloadBase = {
    inventoryTag: inventoryTag || "",
    sourceImageName: String(sourceFile?.name || uiFileName || "").trim(),
    sourceImagePath: "",
    sourceImageHash: "",
    sourceImage: trainingSourceImage,
    imageWidth: Number(canvas?.width || 0),
    imageHeight: Number(canvas?.height || 0),
    contourPoints,
    pipelineVersion: String(contourPipeline || "manual-edit"),
    algorithmVersion: String(modelStats?.mode || ""),
    note: String(getNoteValue() || "").trim(),
    metrics: {
      appVersion: APP_VERSION,
      manualContourApplied: Array.isArray(contourAppliedPoints) && contourAppliedPoints.length >= 3,
      areaPx: Number(contourMetrics?.areaPx ?? modelStats?.polygonAreaPx ?? modelStats?.polygonCount ?? 0),
      bboxWidthPx: Number(contourMetrics?.bboxWidthPx ?? modelStats?.bboxW ?? 0),
      bboxHeightPx: Number(contourMetrics?.bboxHeightPx ?? modelStats?.bboxH ?? 0),
      dpiX,
      dpiY,
      dpiSource,
      qrText,
      mode: getEffectiveMode(),
      sourceImageAttached: !!trainingSourceImage
    }
  };

  trainingSaveInFlight = true;
  const prevText = uiOutputText;
  setSaveStatus("pending", "Сохранение в обучающий датасет...");
  setOutputTextState(`${prevText}\n\nСохранение в обучающий датасет...`.trim());
  try {
    const postAnnotation = async (payload) => {
      const { res } = await apiFetch("/api/training/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => ({}));
      return { res, json };
    };

    let { res, json } = await postAnnotation(payloadBase);
    if ((!res.ok || !json?.ok) && String(json?.error || "") === "annotation_exists" && json?.canOverwrite) {
      const existingId = String(json?.existing?.id || "").trim();
      const existingTs = String(json?.existing?.createdAt || "").trim();
      const proceed = window.confirm(
        `Такой контур уже сохранен в датасете.\n` +
        `${existingId ? `ID: ${existingId}\n` : ""}` +
        `${existingTs ? `Создан: ${existingTs}\n` : ""}` +
        `Пересохранить (заменить существующую запись)?`
      );
      if (!proceed) {
        setSaveStatus("warn", "Сохранение в датасет отменено: запись уже существует.");
        setOutputTextState(`${prevText}\n\nСохранение отменено: такой контур уже есть.`.trim());
        return;
      }
      ({ res, json } = await postAnnotation({ ...payloadBase, overwrite: true }));
    }

    if (!res.ok || !json?.ok) {
      setSaveStatus("error", `Ошибка: ${json?.error || `HTTP ${res.status}`}`);
      setOutputTextState(`${prevText}\n\nОшибка сохранения в обучающий датасет: ${json?.error || `HTTP ${res.status}`}`.trim());
      return;
    }
    const id = String(json?.item?.id || "").trim();
    setSaveStatus("success", json?.overwritten ? "Запись в датасете пересохранена." : "Сохранено в обучающий датасет.");
    setOutputTextState(
      `${prevText}\n\n${json?.overwritten ? "Запись в датасете пересохранена." : "Сохранено в обучающий датасет."}` +
      `\nID: ${id || "-"}` +
      `\nКонтур: ${contourPoints.length} точек` +
      `\nИсточник: ${json?.item?.sourceImagePath || "(без файла)"}`
      .trim()
    );
  } catch (err) {
    setSaveStatus("error", `Ошибка: ${err?.message || err}`);
    setOutputTextState(`${prevText}\n\nОшибка сохранения в обучающий датасет: ${err?.message || err}`.trim());
  } finally {
    trainingSaveInFlight = false;
  }
}

function handleZoomOut() {
  const base = Number(zoomPercent || 100) || 100;
  applyZoomValue(base - 10);
}

function handleZoomIn() {
  const base = Number(zoomPercent || 100) || 100;
  applyZoomValue(base + 10);
}

if (LEGACY_DOM_SYNC) {
  zoomInput?.addEventListener("input", () => applyZoomValue(zoomInput.value));
}
zoomOutBtn?.addEventListener("click", handleZoomOut);
zoomInBtn?.addEventListener("click", handleZoomIn);

stage?.addEventListener("wheel", (e) => {
  if (!img) return;
  e.preventDefault();
  const current = Number(zoomPercent || 100) || 100;
  const dir = e.deltaY < 0 ? 1 : -1;
  applyZoomValue(current + dir * 8);
}, { passive: false });

function runAutoDetect() {
  const found = autoDetectLineSegment();
  if (!found) {
    clearAutoLineVisualState();
    pointSource = "auto";
    draw();
    setOutputTextState(
`Авто: отрезок P1>P2 не найден.
Версия: ${APP_VERSION}
Детектор линии: ${lineDetector}
QR: ${qrText}
${polygonMetricsText()}
${lineMaskInfo ? `Порог линии: ${lineMaskInfo.threshold.toFixed(1)} (mean=${lineMaskInfo.mean.toFixed(1)}, std=${lineMaskInfo.std.toFixed(1)})` : ""}
${lineRejectStats ? `Отбраковка маски: total=${lineRejectStats.compsTotal}, area=${lineRejectStats.compsAreaReject}, feat=${lineRejectStats.compsFeatureReject}, tooBig=${lineRejectStats.compsTooBig}, sticker=${lineRejectStats.compsSticker}
Проходы: primary=${lineRejectStats.compsPrimaryPass}, relaxed=${lineRejectStats.compsRelaxedPass}, emergency=${lineRejectStats.compsEmergencyPass}, selected=${lineRejectStats.selectedBy || "none"}` : ""}
Если не найдено: кликни 2 точки P1>P2 вручную.`);
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

  setOutputTextState(
`${srcLabel}
Детектор: ${lineDetector || lastDetector}
Источник линии: ${lineSource}
${polygonMetricsText()}
P1: ${lineP1 ? `(${lineP1.x.toFixed(1)}, ${lineP1.y.toFixed(1)})` : "(не задана)"}
P2: ${lineP2 ? `(${lineP2.x.toFixed(1)}, ${lineP2.y.toFixed(1)})` : "(не задана)"}
${!hasLine ? "Отрезок P1>P2 не задан: кликни 2 точки на мездре." : ""}
${hasLine ? `d1=${formatDist(d1Mm, napVector?.d1Px)}, d2=${formatDist(d2Mm, napVector?.d2Px)}` : ""}
${hasVector ? `Вектор P1>P2: (${napVector.vx.toFixed(3)}, ${napVector.vy.toFixed(3)})` : "Направление не определено: задай P1>P2."}`);
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
  // dark-line (component-based) is primary — finds the full black stripe reliably.
  // opencv-hough is fallback — catches cases where component analysis fails.
  const seg = detectDarkLineSegment();
  if (seg) {
    lineDetector = "dark-line";
    const segFromMask = segmentFromMaskGlobal(lineMaskBest, canvas.width, canvas.height);
    if (segFromMask && isAutoSegmentPlausible(segFromMask.p1, segFromMask.p2, "global-mask-pca")) {
      lineSource = "global-mask-pca";
      lineP1 = segFromMask.p1;
      lineP2 = segFromMask.p2;
      recomputeNapFromLine("auto");
      return true;
    }
    if (isAutoSegmentPlausible(seg.p1, seg.p2, "dark-line-fallback")) {
      lineSource = "dark-line-fallback";
      lineP1 = seg.p1;
      lineP2 = seg.p2;
      recomputeNapFromLine("auto");
      return true;
    }
  }

  const cvSeg = detectLineSegmentOpenCV();
  if (cvSeg && isAutoSegmentPlausible(cvSeg.p1, cvSeg.p2, "opencv-hough")) {
    lineDetector = "opencv-hough";
    lineSource = "opencv-hough";
    lineP1 = cvSeg.p1;
    lineP2 = cvSeg.p2;
    recomputeNapFromLine("auto");
    return true;
  }

  return false;
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
    if (dark / valid < 0.70) return false;
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
  const maxCompPx = 15000;
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
      if (Math.max(feat.bboxW, feat.bboxH) > 600) {
        lineRejectStats.compsTooBig++;
        continue;
      }
      if (
        isInStickerExclusion((feat.p1.x + feat.p2.x) / 2, (feat.p1.y + feat.p2.y) / 2, 16) ||
        isInStickerExclusion(feat.p1.x, feat.p1.y, 16) ||
        isInStickerExclusion(feat.p2.x, feat.p2.y, 16)
      ) {
        lineRejectStats.compsSticker++;
        continue;
      }

      let nearEdge = 0;
      let edgeSum = 0;
      let graySum = 0;
      for (let k = 0; k < comp.length; k++) {
        const idx = comp[k];
        const px = idx % w;
        const py = (idx - px) / w;
        const d = getEdgeDistance(px, py);
        edgeSum += d;
        if (d < 7) nearEdge++;
        graySum += sampleGray(px, py);
      }
      const nearEdgeRatio = nearEdge / comp.length;
      const meanEdgeDist = edgeSum / comp.length;
      const meanGray = graySum / comp.length;
      // Нап-полоска — реально чёрная; тёмно-коричневый мех или пятна не подходят.
      if (meanGray > 85) continue;

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
      if (darkRatio < 0.65) continue;

      // Prefer interior (high edgeD) and darker lines over long edge-adjacent lines.
      // log1p(len) caps the length bonus so a short dark interior stripe beats a long dim border.
      const score = Math.log1p(len) * 10 + edgeD * 6.0 + darkRatio * 80;
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
  // Ворс направлен к краю мездры: конец линии ближе к краю = наконечник стрелки (to)
  const shouldSwap = Number.isFinite(d1Px) && Number.isFinite(d2Px) && d1Px < d2Px;
  const from = shouldSwap ? lineP2 : lineP1;
  const to   = shouldSwap ? lineP1 : lineP2;
  const choiceText = shouldSwap ? "авто: ближе к краю P1→tip" : "авто: ближе к краю P2→tip";

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

function formatLoadTelemetryText(t) {
  if (!t || typeof t !== "object") return "";
  const parts = [];
  if (Number.isFinite(t.decodeMs)) parts.push(`decode ${Math.round(t.decodeMs)} мс`);
  if (Number.isFinite(t.dpiMs)) parts.push(`dpi ${Math.round(t.dpiMs)} мс`);
  if (Number.isFinite(t.modelMs)) parts.push(`mask ${Math.round(t.modelMs)} мс`);
  if (Number.isFinite(t.autoMs)) parts.push(`auto ${Math.round(t.autoMs)} мс`);
  if (Number.isFinite(t.qrMs)) parts.push(`qr ${Math.round(t.qrMs)} мс`);
  if (Number.isFinite(t.totalMs)) parts.push(`total ${Math.round(t.totalMs)} мс`);
  return parts.length ? `Load telemetry: ${parts.join(" | ")}` : "";
}

function polygonMetricsText() {
  const contourMetrics = getActiveContourMetricsPx();
  const area = Number(contourMetrics?.areaPx ?? modelStats?.polygonAreaPx ?? modelStats?.polygonCount ?? 0);
  const bw = Number(contourMetrics?.bboxWidthPx ?? modelStats?.bboxW ?? 0);
  const bh = Number(contourMetrics?.bboxHeightPx ?? modelStats?.bboxH ?? 0);
  const processingTimeMs = Number(modelStats?.processingTimeMs || 0);
  const refineApplied = !!modelStats?.refineApplied;
  const fallbackUsed = !!modelStats?.fallbackUsed;
  const timeoutHit = !!modelStats?.timeoutHit;
  const componentCount = Number(modelStats?.componentCount || 0);
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
  text += `\nPipeline: ${String(modelStats?.mode || "-")}`;
  if (processingTimeMs > 0) text += `\nSegmentation time: ${processingTimeMs} ms`;
  text += `\nRefine applied: ${refineApplied ? "yes" : "no"}`;
  text += `\nFallback used: ${fallbackUsed ? "yes" : "no"}`;
  text += `\nTimeout hit: ${timeoutHit ? "yes" : "no"}`;
  if (componentCount > 0) text += `\nComponents: ${componentCount}`;
  const loadText = formatLoadTelemetryText(lastLoadTelemetry);
  if (loadText) text += `\n${loadText}`;
  return text;
}

function setViewValue(el, value) {
  if (!LEGACY_DOM_SYNC) return;
  const live = el && el.isConnected ? el : (el?.id ? document.getElementById(el.id) : null);
  if (!live) return;
  live.value = value ?? "-";
}

function getMaxSpanPx() {
  if (maxSpanPxCache == null) {
    maxSpanPxCache = computeMaxSpanPx();
  }
  return maxSpanPxCache;
}

function getPieceViewSnapshot() {
  const candidate = getInventoryTagCandidate();
  const manualDraft = String(getManualInventoryTag() || "").toUpperCase();
  // Show manual draft in UI even when tag is not yet fully valid (less than 6 digits).
  const inventoryTag = String(manualDraft || candidate || "").toUpperCase();
  const contourMetrics = getActiveContourMetricsPx();
  const areaPx = Number(contourMetrics?.areaPx ?? modelStats?.polygonAreaPx ?? modelStats?.polygonCount ?? 0);
  const bboxWidthPx = Number(contourMetrics?.bboxWidthPx ?? modelStats?.bboxW ?? 0);
  const bboxHeightPx = Number(contourMetrics?.bboxHeightPx ?? modelStats?.bboxH ?? 0);
  const areaMm2 = dpiX && dpiY ? areaPx * (25.4 / dpiX) * (25.4 / dpiY) : null;
  const bboxWidthMm = dpiX ? bboxWidthPx * 25.4 / dpiX : null;
  const bboxHeightMm = dpiY ? bboxHeightPx * 25.4 / dpiY : null;
  const maxSpanPx = getMaxSpanPx();
  const maxSpanMm = toMmDistance(maxSpanPx);
  const napDeg = napVector ? napVector.angleDeg : null;
  const areaView = Number.isFinite(areaMm2)
    ? areaMm2.toFixed(2)
    : (areaPx > 0 ? `${Math.round(areaPx)} px²` : "-");
  const bboxWView = Number.isFinite(bboxWidthMm)
    ? bboxWidthMm.toFixed(2)
    : (bboxWidthPx > 0 ? `${Math.round(bboxWidthPx)} px` : "-");
  const bboxHView = Number.isFinite(bboxHeightMm)
    ? bboxHeightMm.toFixed(2)
    : (bboxHeightPx > 0 ? `${Math.round(bboxHeightPx)} px` : "-");
  const maxSpanView = Number.isFinite(maxSpanMm)
    ? maxSpanMm.toFixed(2)
    : (Number.isFinite(maxSpanPx) && maxSpanPx > 0 ? `${maxSpanPx.toFixed(1)} px` : "-");

  return {
    invTag: inventoryTag,
    areaMm2: areaView,
    bboxWidthMm: bboxWView,
    bboxHeightMm: bboxHView,
    maxSpanMm: maxSpanView,
    napDeg: Number.isFinite(napDeg) ? napDeg.toFixed(1) : "-",
  };
}

function refreshPieceCard() {
  const snapshot = getPieceViewSnapshot();
  const inventoryTag = snapshot.invTag;
  const invCandidate = getInventoryTagCandidate();
  const invMissing = !!img && (!getEffectiveInventoryTag() || (!!invCandidate && !isInventoryTagValid(invCandidate)));

  const invEl = getLiveById(invTagView, "invTagView");
  const areaEl = getLiveById(areaMm2View, "areaMm2View");
  const bwEl = getLiveById(bboxWidthMmView, "bboxWidthMmView");
  const bhEl = getLiveById(bboxHeightMmView, "bboxHeightMmView");
  const maxEl = getLiveById(maxSpanMmView, "maxSpanMmView");
  const napEl = getLiveById(napDegView, "napDegView");

  setViewValue(invEl, inventoryTag);
  if (LEGACY_DOM_SYNC && invEl) invEl.classList.toggle("field-invalid", invMissing);
  setViewValue(areaEl, snapshot.areaMm2);
  setViewValue(bwEl, snapshot.bboxWidthMm);
  setViewValue(bhEl, snapshot.bboxHeightMm);
  setViewValue(maxEl, snapshot.maxSpanMm);
  setViewValue(napEl, snapshot.napDeg);
}

function computeMaxSpanPx() {
  if (!polygonMask || !canvas?.width || !canvas?.height) return null;
  const pathPx = buildBoundaryPathPx(2);
  if (!pathPx || pathPx.length < 2) return null;
  const unique = dedupePoints(pathPx);
  if (unique.length < 2) return null;
  const hull = convexHull(unique);
  const maxD2 = hull.length > 2 ? rotatingCalipersDiameterSq(hull) : directMaxD2(hull);
  return maxD2 > 0 ? Math.sqrt(maxD2) : null;
}

function dedupePoints(points) {
  const out = [];
  const seen = new Set();
  for (const p of points || []) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const key = `${Math.round(x * 1000)}:${Math.round(y * 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x, y });
  }
  return out;
}

function directMaxD2(points) {
  let best = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      const d2 = dx * dx + dy * dy;
      if (d2 > best) best = d2;
    }
  }
  return best;
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(points) {
  if (!Array.isArray(points) || points.length < 3) return points || [];
  const pts = points.slice().sort((p1, p2) => (p1.x - p2.x) || (p1.y - p2.y));
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  return hull.length ? hull : pts.slice(0, Math.min(2, pts.length));
}

function triArea2(a, b, c) {
  return Math.abs(cross(a, b, c));
}

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function rotatingCalipersDiameterSq(hull) {
  const n = hull.length;
  if (n < 2) return 0;
  if (n === 2) return dist2(hull[0], hull[1]);
  let j = 1;
  let best = 0;
  for (let i = 0; i < n; i++) {
    const ni = (i + 1) % n;
    while (triArea2(hull[i], hull[ni], hull[(j + 1) % n]) > triArea2(hull[i], hull[ni], hull[j])) {
      j = (j + 1) % n;
    }
    const d1 = dist2(hull[i], hull[j]);
    const d2 = dist2(hull[ni], hull[j]);
    if (d1 > best) best = d1;
    if (d2 > best) best = d2;
  }
  return best;
}

function buildSavePayload() {
  const inventoryTag = getInventoryTagCandidate();
  if (!inventoryTag) {
    setSaveStatus("", "");
    setOutputTextState(
`Нет inventoryTag: QR не распознан и ручной ввод пустой.
Запись в Access отменена.
Введи инв. метку вручную или добейся чтения QR, затем нажми "Записать в Access".`);
    return null;
  }
  if (!isInventoryTagValid(inventoryTag)) {
    setSaveStatus("", "");
    setOutputTextState(
`Некорректный формат inventoryTag.
Ожидаемый формат: FL-SCR-000123.
Пример: FL-SCR-000123.`);
    return null;
  }

  const contourMetrics = getActiveContourMetricsPx();
  const areaPx = Number(contourMetrics?.areaPx ?? modelStats?.polygonAreaPx ?? modelStats?.polygonCount ?? 0);
  const bboxWidthPx = Number(contourMetrics?.bboxWidthPx ?? modelStats?.bboxW ?? 0);
  const bboxHeightPx = Number(contourMetrics?.bboxHeightPx ?? modelStats?.bboxH ?? 0);

  if (!napVector) {
    setSaveStatus("", "");
    return null;
  }
  const napDirectionDegRaw = napVector.angleDeg;
  const materialId = String(getSelectValue("material") || "").trim();
  const storageLocationId = String(getSelectValue("storage") || "").trim();
  const scrapQuality = String(getSelectValue("quality") || "").trim();
  const scrapStatus = "Available";
  const note = String(getNoteValue()).trim();

  if (!materialId) {
    setSaveStatus("", "");
    setOutputTextState("Сохранение отменено: поле 'Материал' обязательно.");
    return null;
  }
  if (!scrapQuality) {
    setSaveStatus("", "");
    setOutputTextState("Сохранение отменено: поле 'Качество' обязательно.");
    return null;
  }
  if (!/^(Good|Limited)$/.test(scrapQuality)) {
    setSaveStatus("", "");
    setOutputTextState("Сохранение отменено: качество должно быть Good или Limited.");
    return null;
  }
  if (scrapQuality === "Limited" && !note) {
    setSaveStatus("", "");
    setOutputTextState("Сохранение отменено: для качества Limited поле 'Комментарий/дефект' обязательно.");
    return null;
  }

  const contourRaw = buildScrapContourJson();
  const scanSide = "leather_up";
  const contourCanonical = buildCanonicalContourForLayout(contourRaw, scanSide);
  const napDirectionDeg = buildCanonicalNapForLayoutDeg(napDirectionDegRaw, scanSide);
  const contour = contourCanonical || contourRaw;
  const areaMm2 = toFiniteOrNull(contour?.metrics?.area, dpiX && dpiY ? areaPx * (25.4 / dpiX) * (25.4 / dpiY) : null);
  const bboxWidthMm = toFiniteOrNull(contour?.metrics?.bboxWidth, dpiX ? bboxWidthPx * 25.4 / dpiX : null);
  const bboxHeightMm = toFiniteOrNull(contour?.metrics?.bboxHeight, dpiY ? bboxHeightPx * 25.4 / dpiY : null);
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
      segmentationMode: modelStats?.mode || null,
      segmentationProcessingTimeMs: modelStats?.processingTimeMs ?? null,
      segmentationRefineApplied: modelStats?.refineApplied ?? null,
      segmentationFallbackUsed: modelStats?.fallbackUsed ?? null,
      segmentationTimeoutHit: modelStats?.timeoutHit ?? null,
      segmentationComponentCount: modelStats?.componentCount ?? null,
      dpiX,
      dpiY,
      dpiSource,
      qrText,
      manualInventoryTag: getManualInventoryTag(),
      inventoryTagSource: normalizeInventoryTag(getManualInventoryTag()) ? "manual" : "qr"
      ,
      scanSide,
      contourNormalization: {
        applied: !!contourCanonical,
        method: "mirror_vertical_bbox_center",
        axis: "bbox_center_x",
        canonicalFrame: "layout_face_side"
      },
      contourRaw: contourRaw || null,
      contourCanonical: contourCanonical || contourRaw || null,
      napDirectionDegRaw: Number.isFinite(napDirectionDegRaw) ? napDirectionDegRaw : null,
      napDirectionDegCanonical: Number.isFinite(napDirectionDeg) ? napDirectionDeg : null,
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
  const clean = String(text).trim().toUpperCase();
  if (!clean) return "";
  if (clean.startsWith("(") && clean.endsWith(")")) return "";
  if (/не найден|не распознан|поиск/i.test(clean)) return "";
  const strict = clean.match(/^FL-SCR-(\d{6})$/);
  if (strict) return `FL-SCR-${strict[1]}`;
  const relaxed = clean.match(/FL[\s\-_]*SCR[\s\-_]*(\d{3,10})/i);
  if (relaxed && relaxed[1]) {
    const digits = String(relaxed[1]).replace(/\D+/g, "").slice(0, 6);
    if (digits.length === 6) return `FL-SCR-${digits}`;
  }
  return "";
}

function buildScrapContourJson() {
  const hasManualApplied = Array.isArray(contourAppliedPoints) && contourAppliedPoints.length >= 3;
  const pathPx = buildBoundaryPathPx(hasManualApplied ? 1 : 4);
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
  if (Array.isArray(contourAppliedPoints) && contourAppliedPoints.length >= 3) {
    contourPathMethod = "manual-draft-applied";
    const sampledApplied = [];
    const strideApplied = Math.max(1, Number(step) || 1);
    for (let i = 0; i < contourAppliedPoints.length; i += strideApplied) {
      sampledApplied.push({ x: contourAppliedPoints[i].x, y: contourAppliedPoints[i].y });
    }
    if (sampledApplied.length > 2) {
      const a = sampledApplied[0];
      const b = sampledApplied[sampledApplied.length - 1];
      if (a.x !== b.x || a.y !== b.y) sampledApplied.push({ x: a.x, y: a.y });
    }
    return sampledApplied;
  }
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

function drawOverlayLayer() {
  renderOverlayLayer({
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
  });
}
function draw() {
  const zoomScale = Math.max(0.5, Number(zoomPercent || 100) / 100);
  const uiScaleInv = 1 / zoomScale;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!img) {
    drawOverlayLayer();
    return;
  }

  ctx.drawImage(img, 0, 0);
  const showControlPoints = getDebugFlag("controlPoints");
  const showBbox = getDebugFlag("bbox");
  const showEdgeDistances = getDebugFlag("edgeDistance");

  if (getDebugFlag("lineMask")) {
    drawLineMaskOverlay();
    if (stickerBox) {
      ctx.strokeStyle = "#ff00aa";
      ctx.lineWidth = 2 * uiScaleInv;
      ctx.strokeRect(
        stickerBox.minX - 8 * uiScaleInv,
        stickerBox.minY - 8 * uiScaleInv,
        stickerBox.maxX - stickerBox.minX + 16 * uiScaleInv,
        stickerBox.maxY - stickerBox.minY + 16 * uiScaleInv
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
      ctx.lineWidth = 1.5 * uiScaleInv;
      ctx.strokeRect(
        markerBox.minX - 1.5 * uiScaleInv,
        markerBox.minY - 1.5 * uiScaleInv,
        markerBox.maxX - markerBox.minX + 3 * uiScaleInv,
        markerBox.maxY - markerBox.minY + 3 * uiScaleInv
      );
    }
  }

  let activeContour = contourDraftMode
    ? contourDraftPoints
    : (Array.isArray(contourAppliedPoints) && contourAppliedPoints.length >= 3 ? contourAppliedPoints : null);
  if (!Array.isArray(activeContour) || activeContour.length < 3) {
    activeContour = buildBoundaryPathPx(1);
  }
  if (getDebugFlag("contour") && Array.isArray(activeContour) && activeContour.length >= 3) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(activeContour[0].x, activeContour[0].y);
    for (let i = 1; i < activeContour.length; i++) {
      ctx.lineTo(activeContour[i].x, activeContour[i].y);
    }
    ctx.closePath();
    ctx.strokeStyle = contourDraftMode ? "rgba(245, 158, 11, 0.95)" : "rgba(16, 185, 129, 0.95)";
    ctx.lineWidth = contourDraftMode ? 2.5 * uiScaleInv : 2 * uiScaleInv;
    ctx.stroke();

    if (contourDraftMode) {
      for (let i = 0; i < activeContour.length; i++) {
        const p = activeContour[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.2 * uiScaleInv, 0, Math.PI * 2);
        const isDrag = i === contourDragIndex;
        const isSelected = i === contourSelectedIndex || (contourSelectedSet && contourSelectedSet.has(i));
        const isHover = i === contourHoverIndex;
        ctx.fillStyle = isDrag
          ? "rgba(220, 38, 38, 0.95)"
          : isSelected
            ? "rgba(245, 158, 11, 0.98)"
            : isHover
              ? "rgba(59, 130, 246, 0.95)"
              : "rgba(251, 191, 36, 0.95)";
        ctx.fill();
        ctx.lineWidth = 1.4 * uiScaleInv;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
        ctx.stroke();
      }

      if (contourBoxSelectActive && isPointFinite(contourBoxSelectStart) && isPointFinite(contourBoxSelectEnd)) {
        const minX = Math.min(contourBoxSelectStart.x, contourBoxSelectEnd.x);
        const minY = Math.min(contourBoxSelectStart.y, contourBoxSelectEnd.y);
        const wSel = Math.abs(contourBoxSelectEnd.x - contourBoxSelectStart.x);
        const hSel = Math.abs(contourBoxSelectEnd.y - contourBoxSelectStart.y);
        ctx.save();
        ctx.fillStyle = "rgba(59, 130, 246, 0.12)";
        ctx.strokeStyle = "rgba(59, 130, 246, 0.9)";
        ctx.lineWidth = 1.2 * uiScaleInv;
        ctx.setLineDash([5 * uiScaleInv, 4 * uiScaleInv]);
        ctx.fillRect(minX, minY, wSel, hSel);
        ctx.strokeRect(minX, minY, wSel, hSel);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  drawOverlayLayer();
}

function normalizeDeg360(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  let out = n % 360;
  if (out < 0) out += 360;
  return out;
}

function toFiniteOrNull(v, fallback = null) {
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const f = Number(fallback);
  return Number.isFinite(f) ? f : null;
}

function normalizeContourPathPoints(path) {
  if (!Array.isArray(path)) return [];
  const out = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ x, y });
  }
  if (out.length >= 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (a.x === b.x && a.y === b.y) out.pop();
  }
  return out;
}

function signedArea2D(path) {
  if (!Array.isArray(path) || path.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < path.length; i++) {
    const a = path[i];
    const b = path[(i + 1) % path.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function ensureClockwiseScreen(path) {
  if (!Array.isArray(path) || path.length < 3) return path;
  const area = signedArea2D(path);
  // In screen coordinates (y down), positive signed area corresponds to CW.
  return area >= 0 ? path : path.slice().reverse();
}

function contourBBox(path) {
  if (!Array.isArray(path) || path.length < 1) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY)
  };
}

function buildCanonicalContourForLayout(contour, scanSide) {
  if (!contour || typeof contour !== "object") return null;
  const units = String(contour.units || "mm");
  const pathRaw = normalizeContourPathPoints(contour.path);
  if (pathRaw.length < 3) return null;
  if (scanSide !== "leather_up") {
    const cw = ensureClockwiseScreen(pathRaw);
    const bbox = contourBBox(cw);
    return {
      ...contour,
      units,
      path: closePath(cw),
      source: {
        ...(contour.source && typeof contour.source === "object" ? contour.source : {}),
        canonicalized: false,
        scanSide: scanSide || null
      },
      metrics: bbox ? {
        area: Math.abs(signedArea2D(cw)),
        bboxWidth: bbox.width,
        bboxHeight: bbox.height
      } : null
    };
  }
  const bboxRaw = contourBBox(pathRaw);
  if (!bboxRaw) return null;
  const cx = (bboxRaw.minX + bboxRaw.maxX) / 2;
  const mirrored = pathRaw.map((p) => ({ x: 2 * cx - p.x, y: p.y }));
  const cw = ensureClockwiseScreen(mirrored);
  const bbox = contourBBox(cw);
  return {
    ...contour,
    units,
    path: closePath(cw),
    source: {
      ...(contour.source && typeof contour.source === "object" ? contour.source : {}),
      canonicalized: true,
      canonicalizationMethod: "mirror_vertical_bbox_center",
      scanSide: "leather_up"
    },
    metrics: bbox ? {
      area: Math.abs(signedArea2D(cw)),
      bboxWidth: bbox.width,
      bboxHeight: bbox.height
    } : null
  };
}

function closePath(path) {
  if (!Array.isArray(path) || path.length < 1) return [];
  const out = path.slice();
  const a = out[0];
  const b = out[out.length - 1];
  if (a.x !== b.x || a.y !== b.y) out.push({ x: a.x, y: a.y });
  return out;
}

function buildCanonicalNapForLayoutDeg(napDeg, scanSide) {
  const n = normalizeDeg360(napDeg);
  if (n === null) return null;
  if (scanSide !== "leather_up") return n;
  return normalizeDeg360(180 - n);
}

function computePolygonMetricsFromPath(pathPx) {
  if (!Array.isArray(pathPx) || pathPx.length < 3) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let twiceArea = 0;
  for (let i = 0; i < pathPx.length; i++) {
    const a = pathPx[i];
    const b = pathPx[(i + 1) % pathPx.length];
    const ax = Number(a?.x);
    const ay = Number(a?.y);
    const bx = Number(b?.x);
    const by = Number(b?.y);
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
    minX = Math.min(minX, ax);
    minY = Math.min(minY, ay);
    maxX = Math.max(maxX, ax);
    maxY = Math.max(maxY, ay);
    twiceArea += ax * by - bx * ay;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
  return {
    areaPx: Math.abs(twiceArea) * 0.5,
    bboxWidthPx: Math.max(0, maxX - minX + 1),
    bboxHeightPx: Math.max(0, maxY - minY + 1)
  };
}

function getActiveContourMetricsPx() {
  if (Array.isArray(contourAppliedPoints) && contourAppliedPoints.length >= 3) {
    return computePolygonMetricsFromPath(contourAppliedPoints);
  }
  if (contourDraftMode && Array.isArray(contourDraftPoints) && contourDraftPoints.length >= 3) {
    return computePolygonMetricsFromPath(contourDraftPoints);
  }
  const pathPx = buildBoundaryPathPx(1);
  if (!Array.isArray(pathPx) || pathPx.length < 3) return null;
  return computePolygonMetricsFromPath(pathPx);
}

function drawLineMaskOverlay() {
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return;

  if (polygonMask) {
    ctx.fillStyle = "rgba(0, 180, 255, 0.14)";
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (polygonMask[y * w + x]) ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.fillStyle = "rgba(0, 140, 220, 0.95)";
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!polygonMask[i]) continue;
        if (
          !polygonMask[i - 1] || !polygonMask[i + 1] ||
          !polygonMask[i - w] || !polygonMask[i + w]
        ) {
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

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
  const view = getZoomRenderState({
    hasImage: !!img,
    zoomPercent,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    scenePanX,
    scenePanY
  });

  canvas.style.display = view.canvasStyle.display;
  if (view.hidden) {
    if (stageWrap) stageWrap.style.display = view.stageWrapStyle.display;
    if (overlayCanvas) overlayCanvas.style.display = view.overlayStyle.display;
    if (zoomRail) zoomRail.style.display = view.zoomRailStyle.display;
    drawOverlayLayer();
    if (LEGACY_DOM_SYNC && zoomValue) zoomValue.textContent = view.zoomText;
    return;
  }

  canvas.style.transform = view.canvasStyle.transform;
  canvas.style.width = view.canvasStyle.width;
  canvas.style.height = view.canvasStyle.height;
  if (stageWrap) {
    stageWrap.style.display = view.stageWrapStyle.display;
    stageWrap.style.width = view.stageWrapStyle.width;
    stageWrap.style.height = view.stageWrapStyle.height;
    stageWrap.style.transform = view.stageWrapStyle.transform;
  }
  if (overlayCanvas) overlayCanvas.style.display = view.overlayStyle.display;
  if (zoomRail) zoomRail.style.display = view.zoomRailStyle.display;
  drawOverlayLayer();

  if (LEGACY_DOM_SYNC && zoomValue) zoomValue.textContent = view.zoomText;
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
  //эятикетка в этих кадрах стабильно слева-сверху.
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

  // Дилатация: соединяем белые острова через QR-модули (чёрные полосы ~3-5px).
  // Обрезаем результат обратно по polygonMask чтобы не захватить фон сканера.
  const brightDilatedRaw = morphDilate(bright, w, h, 2);
  const brightDilated = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (brightDilatedRaw[i] && polygonMask[i]) brightDilated[i] = 1;
  }

  let best = null;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!brightDilated[i] || visited[i]) continue;
      const comp = bfsMaskComponent(brightDilated, visited, x, y, w, h);
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

function computeMaskStats(mask, w, h) {
  let count = 0;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      count++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return {
    count,
    minX: count ? minX : 0,
    minY: count ? minY : 0,
    maxX: count ? maxX : 0,
    maxY: count ? maxY : 0,
    bboxW: count ? (maxX - minX + 1) : 0,
    bboxH: count ? (maxY - minY + 1) : 0
  };
}

function hashMaskFNV1a(mask) {
  if (!mask) return null;
  let h = 0x811c9dc5;
  for (let i = 0; i < mask.length; i++) {
    h ^= (mask[i] ? 1 : 0);
    h = Math.imul(h, 0x01000193);
  }
  return (`00000000${(h >>> 0).toString(16)}`).slice(-8);
}

function buildEdgeMask(mask, outerBgMask, w, h) {
  const edgeMask = new Uint8Array(w * h);
  let edgeCount = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (
        outerBgMask[i - 1] || outerBgMask[i + 1] ||
        outerBgMask[i - w] || outerBgMask[i + w]
      ) {
        edgeMask[i] = 1;
        edgeCount++;
      }
    }
  }
  return { edgeMask, edgeCount };
}

function countConnectedComponents(mask, w, h) {
  if (!mask) return 0;
  const visited = new Uint8Array(w * h);
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i] || visited[i]) continue;
      bfsComponent(mask, visited, x, y, w, h);
      count += 1;
    }
  }
  return count;
}

function buildPolygonModel() {
  return runSegmentationPipeline({
    pipeline: contourPipeline,
    w: canvas.width,
    h: canvas.height,
    size: canvas.width * canvas.height,
    sourceData,
    sampleGray,
    timeoutConfig: {
      softTimeoutMs: SEGMENTATION_SOFT_TIMEOUT_MS,
      hardTimeoutMs: SEGMENTATION_HARD_TIMEOUT_MS
    },
    primitives: {
      erodeMask,
      dilateMask,
      floodFillOuterOnTraversable,
      floodFillOuterBackground,
      extractLargestComponent,
      buildEdgeMask,
      computeMaskStats,
      buildDistanceTransform,
      countConnectedComponents,
      hashMask: hashMaskFNV1a,
      runGrabCutMask
    }
  });
}

function runGrabCutMask({ sourceRgba, w, h, fgSeed, bgSeed, candidateMask, iterCount = 2 }) {
  if (!sourceRgba || !fgSeed || !bgSeed || !w || !h) return null;
  if (typeof cv === "undefined" || !cv || typeof cv.grabCut !== "function") return null;
  let src = null;
  let srcRgb = null;
  let mask = null;
  let bgdModel = null;
  let fgdModel = null;
  let rect = null;
  try {
    src = cv.matFromImageData(new ImageData(new Uint8ClampedArray(sourceRgba), w, h));
    srcRgb = new cv.Mat();
    cv.cvtColor(src, srcRgb, cv.COLOR_RGBA2RGB);
    mask = new cv.Mat(h, w, cv.CV_8UC1);
    const md = mask.data;
    const GC_BGD = Number(cv.GC_BGD ?? 0);
    const GC_FGD = Number(cv.GC_FGD ?? 1);
    const GC_PR_BGD = Number(cv.GC_PR_BGD ?? 2);
    const GC_PR_FGD = Number(cv.GC_PR_FGD ?? 3);
    for (let i = 0; i < md.length; i++) md[i] = GC_PR_BGD;
    for (let i = 0; i < md.length; i++) {
      if (candidateMask && !candidateMask[i]) {
        md[i] = GC_BGD;
      }
      if (fgSeed[i]) md[i] = GC_FGD;
      else if (bgSeed[i]) md[i] = GC_BGD;
      else if (candidateMask && candidateMask[i]) md[i] = GC_PR_FGD;
    }
    bgdModel = new cv.Mat(1, 65, cv.CV_64FC1);
    fgdModel = new cv.Mat(1, 65, cv.CV_64FC1);
    rect = new cv.Rect(0, 0, 1, 1);
    cv.grabCut(srcRgb, mask, rect, bgdModel, fgdModel, Math.max(1, Number(iterCount) || 2), cv.GC_INIT_WITH_MASK);
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) {
      const v = md[i];
      out[i] = (v === GC_FGD || v === GC_PR_FGD) ? 1 : 0;
    }
    return out;
  } catch (_) {
    return null;
  } finally {
    if (src) src.delete();
    if (srcRgb) srcRgb.delete();
    if (mask) mask.delete();
    if (bgdModel) bgdModel.delete();
    if (fgdModel) fgdModel.delete();
  }
}

function erodeMask(mask, w, h, radius) {
  if (!mask || radius <= 0) return mask;
  const window = radius * 2 + 1;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);

  // Horizontal pass.
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) run += 1;
      else run = 0;
      if (run >= window) {
        tmp[y * w + (x - radius)] = 1;
      }
    }
  }

  // Vertical pass.
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) run += 1;
      else run = 0;
      if (run >= window) {
        out[(y - radius) * w + x] = 1;
      }
    }
  }

  return out;
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
  if (!LEGACY_DOM_SYNC) return getEffectiveMode();
  if (!modeInputs || modeInputs.length === 0) return mode || "auto";
  const active = Array.from(modeInputs).find((el) => el.checked);
  return active ? active.value : (mode || "auto");
}

function updateControlsState() {
  mode = getEffectiveMode();
  clearDisabledState = mode !== "manual";
  if (clearBtn) clearBtn.disabled = clearDisabledState;
  const validation = getValidationState();
  const noteEl = getLiveById(noteInput, "noteInput");
  if (LEGACY_DOM_SYNC && noteEl) noteEl.classList.toggle("field-invalid", validation.noteMissing);
  const materialEl = getLiveById(materialSelect, "materialSelect");
  if (LEGACY_DOM_SYNC && materialEl) materialEl.classList.toggle("field-invalid", validation.materialMissing);

  saveDisabledState = !validation.canSave;
  if (saveBtn) saveBtn.disabled = saveDisabledState;
  if (
    validation.canSave &&
    saveStatusKind === "error" &&
    /^(Сначала загрузи изображение\.|Задай отрезок ворса: P1 и P2\.|Нет inventoryTag: QR не распознан(?: и ручной ввод пустой)?\.|Некорректный формат inventoryTag\.|Нет направления\. Задай P1>P2\.|Выбери материал\.|Выбери качество\.|Некорректное качество\.|Для Limited нужен комментарий\/дефект\.)$/u.test(String(saveStatusMessage || ""))
  ) {
    setSaveStatus("", "");
  }
  emitLdvState(validation);
}



function setSaveStatus(kind, message) {
  saveStatusKind = String(kind || "");
  saveStatusMessage = String(message || "");
  window.dispatchEvent(new CustomEvent(LDV_SAVE_STATUS_EVENT, {
    detail: { kind: saveStatusKind, message: saveStatusMessage }
  }));
  if (!LEGACY_DOM_SYNC || !saveStatus) return;
  saveStatus.className = `save-status ${saveStatusKind}`.trim();
  saveStatus.textContent = saveStatusMessage;
}

function setScanStatus(kind, message) {
  window.dispatchEvent(new CustomEvent(LDV_SCAN_STATUS_EVENT, {
    detail: { kind: String(kind || ""), message: String(message || "") }
  }));
}

async function checkApiHealth() { return dictRuntime.checkApiHealth(); }
async function loadDictionaries() { return dictRuntime.loadDictionaries(); }
function applyFallbackDicts() { return dictRuntime.applyFallbackDicts(); }

mode = getMode();
updateHintText();
if (appVersionEl) appVersionEl.textContent = `Версия проекта: ${APP_VERSION}`;
updateControlsState();
if (!img) {
  setOutputTextState(
`Шаги:
1) Загрузи скан.
2) В режиме "Авто" система пытается сама найти отрезок P1->P2 на мездре.
3) Если авто не сработал, переключись в "Ручной" и поставь 2 точки на линии ворса: сначала P1, потом P2.
4) Направление ворса всегда считается от P1->P2.
5) После этого запись в Access станет доступна.`);
}
applyZoom();
updateStageCursor();
emitLdvState();








