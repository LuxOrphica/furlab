import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CopyOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Collapse, Input, Popover, Select, Space, Table, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import ContourPreview, { type PreviewMode } from "../components/ContourPreview";
import { ApiClient, normalizeDictRows } from "../core/api";
import { clearRegistryCache } from "./RegistryScreen";

type PieceCardScreenProps = {
  pieceId: string;
  onLoadInfoChange?: (text: string) => void;
};

type PieceData = {
  id: string;
  inventoryTag: string;
  materialId: string;
  storageLocationId: string;
  scrapQuality: string;
  scrapStatus: string;
  areaMm2: number | null;
  bboxWidthMm: number | null;
  bboxHeightMm: number | null;
  maxSpanMm: number | null;
  napDirectionDeg: number | null;
  note: string;
  createdAt: string;
  updatedAt: string;
  metricsJson?: string | null;
  scrapContour?: string | null;
  history?: unknown[] | null;
  reservation?: {
    active?: {
      reservedAt?: string | null;
      reservedBy?: string | null;
      note?: string | null;
    } | null;
    last?: {
      reservedAt?: string | null;
      releasedAt?: string | null;
      reservedBy?: string | null;
      note?: string | null;
    } | null;
  } | null;
};

type Pt = { x: number; y: number };
type DictOption = { value: string; label: string };
type PieceHistoryItem = {
  sourceTable?: string;
  transType?: string;
  transAt?: string;
  ts?: string;
  action?: string;
  statusBefore?: string;
  statusAfter?: string;
  sourceRef?: string;
  userName?: string;
  layoutRunId?: string;
  fragmentId?: string;
  zoneId?: string;
  rotationDeg?: string;
  offsetXmm?: string;
  offsetYmm?: string;
  resultContourSnapshot?: string;
  note?: string;
};

type ContourPayload = {
  metricsJson?: string | null;
  scrapContour?: string | null;
};

type ContourFetchResult = {
  payload: ContourPayload;
  loadMs: number;
  requestMs: number;
  jsonMs: number;
  fromCache: boolean;
};

const CONTOUR_CACHE_TTL_MS = 10 * 60 * 1000;
const contourCache = new Map<string, {
  ts: number;
  payload: ContourPayload;
  loadMs: number;
  requestMs: number;
  jsonMs: number;
}>();
const contourInFlight = new Map<string, Promise<{
  payload: ContourPayload;
  loadMs: number;
  requestMs: number;
  jsonMs: number;
}>>();

function formatNum(value: number | null, digits: number): string {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "-";
}

function formatDate(value: string): string {
  const dt = new Date(String(value || ""));
  if (Number.isNaN(dt.getTime())) return String(value || "-");
  return dt.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mapTransitionError(raw: string): string {
  const err = String(raw || "");
  if (err.includes("transition_exit_1")) {
    return "Переход статуса не выполнен (ошибка запуска Access-скрипта). Карточка обновлена, попробуй еще раз.";
  }
  if (err.includes("transition_denied_reserve_requires_available")) {
    return "Нельзя зарезервировать: текущий статус уже не «Доступен». Карточка обновлена.";
  }
  if (err.includes("transition_denied_release_requires_reserved")) {
    return "Нельзя снять резерв: текущий статус уже не «Резерв». Карточка обновлена.";
  }
  if (err.includes("transition_denied_use_requires_available_or_reserved")) {
    return "Нельзя отметить «Использован»: статус должен быть «Доступен» или «Резерв». Карточка обновлена.";
  }
  if (err.includes("transition_conflict_status_changed")) {
    return "Статус уже изменился в базе. Карточка обновлена, проверь актуальный статус.";
  }
  if (err.includes("piece_not_found")) return "Запись не найдена.";
  if (err.includes("transition_empty_output")) return "Переход не выполнен: пустой ответ Access-скрипта.";
  return err;
}

function parseMetricsJson(text: string | null | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function mergeMetricsJson(baseText: string | null | undefined, patchText: string | null | undefined): string | null | undefined {
  const base = parseMetricsJson(baseText);
  const patch = parseMetricsJson(patchText);

  // Ensure subcategories and products are not merged incorrectly
  if (base.subcategory && patch.subcategory && base.subcategory !== patch.subcategory) {
    console.warn('Conflicting subcategories detected. Keeping base subcategory.');
    delete patch.subcategory;
  }

  const hasBase = Object.keys(base).length > 0;
  const hasPatch = Object.keys(patch).length > 0;
  if (!hasBase && !hasPatch) return patchText ?? baseText;
  if (!hasPatch) return baseText;
  if (!hasBase) return patchText;

  try {
    return JSON.stringify({ ...base, ...patch });
  } catch {
    return baseText;
  }
}

function normalizeGuidLike(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\{guid/g, "")
    .replace(/[{}]/g, "");
}

function looksLikeGuid(value: string): boolean {
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(normalizeGuidLike(value));
}

function findOptionByValue(options: DictOption[], rawValue: string): DictOption | null {
  const key = String(rawValue || "").trim();
  if (!key) return null;
  const exact = options.find((o) => String(o.value).trim() === key);
  if (exact) return exact;
  if (!looksLikeGuid(key)) return null;
  const norm = normalizeGuidLike(key);
  return options.find((o) => looksLikeGuid(String(o.value || "")) && normalizeGuidLike(String(o.value || "")) === norm) || null;
}

function normalizeOptionValue(options: DictOption[], rawValue: string): string {
  const hit = findOptionByValue(options, rawValue);
  if (hit) return String(hit.value || "");
  return String(rawValue || "").trim();
}

function isSamePiece(requested: string, item: PieceData | null): boolean {
  if (!item) return false;
  const req = String(requested || "").trim();
  if (!req) return false;
  const itemId = String(item.id || "").trim();
  const itemTag = String(item.inventoryTag || "").trim();
  if (looksLikeGuid(req)) {
    return normalizeGuidLike(req) === normalizeGuidLike(itemId);
  }
  return req === itemTag;
}

function normalizePieceTimestamps(item: PieceData | null): PieceData | null {
  if (!item) return item;
  const rec = item as unknown as Record<string, unknown>;
  const firstNonEmpty = (...vals: Array<unknown>) => {
    for (const v of vals) {
      const s = String(v ?? "").trim();
      if (s) return s;
    }
    return "";
  };
  const created = firstNonEmpty(
    item.createdAt,
    rec.created_at,
    rec.addedAt,
    rec.added_at,
    rec.createdTs,
    rec.created_ts
  );
  const updated = firstNonEmpty(
    item.updatedAt,
    rec.updated_at,
    rec.modifiedAt,
    rec.modified_at,
    rec.updatedTs,
    rec.updated_ts
  );
  return {
    ...item,
    createdAt: created || updated || "",
    updatedAt: updated || created || "",
  };
}

function getContourPointCount(contourJson: string | null | undefined): number | null {
  if (!contourJson) return null;
  try {
    const parsed = JSON.parse(contourJson) as { path?: Array<unknown> };
    return Array.isArray(parsed.path) ? parsed.path.length : null;
  } catch {
    return null;
  }
}

function pickMetricValue(metrics: Record<string, unknown>, keys: string[]): string {
  const entries = Object.entries(metrics || {});
  const normalized = new Map<string, unknown>();
  for (const [k, v] of entries) {
    normalized.set(k, v);
    normalized.set(k.toLowerCase(), v);
    normalized.set(k.toLowerCase().replace(/[^a-z0-9]/g, ""), v);
  }
  for (const key of keys) {
    const variants = [
      key,
      key.toLowerCase(),
      key.toLowerCase().replace(/[^a-z0-9]/g, ""),
    ];
    for (const candidate of variants) {
      const v = normalized.get(candidate);
      if (v !== null && v !== undefined && String(v).trim() !== "") return String(v);
    }
  }
  return "-";
}

function pickRowValue(row: PieceHistoryItem, keys: string[]): string {
  return pickMetricValue(row as unknown as Record<string, unknown>, keys);
}

function normalizeHistoryItem(raw: unknown): PieceHistoryItem {
  const rec = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  const toMaybe = (v: string): string | undefined => (hasRealValue(v) ? v : undefined);
  const out: PieceHistoryItem = {
    sourceTable: toMaybe(pickMetricValue(rec, ["sourceTable", "source_table", "tableName", "table"])),
    transType: toMaybe(pickMetricValue(rec, ["transType", "trans_type", "type"])),
    transAt: toMaybe(pickMetricValue(rec, ["transAt", "trans_at", "createdAt", "created_at"])),
    ts: toMaybe(pickMetricValue(rec, ["ts", "timestamp", "createdAt", "created_at", "eventTs", "event_ts"])),
    action: toMaybe(pickMetricValue(rec, ["action", "eventAction", "event_action"])),
    statusBefore: toMaybe(pickMetricValue(rec, ["statusBefore", "status_before", "fromStatus", "from_status"])),
    statusAfter: toMaybe(pickMetricValue(rec, ["statusAfter", "status_after", "toStatus", "to_status"])),
    sourceRef: toMaybe(pickMetricValue(rec, ["sourceRef", "source_ref", "ref", "reference"])),
    userName: toMaybe(pickMetricValue(rec, ["userName", "user_name", "author", "operator"])),
    layoutRunId: toMaybe(pickMetricValue(rec, ["layoutRunId", "layout_run_id", "layoutId", "layout_id"])),
    fragmentId: toMaybe(pickMetricValue(rec, ["fragmentId", "fragment_id"])),
    zoneId: toMaybe(pickMetricValue(rec, ["zoneId", "zone_id"])),
    rotationDeg: toMaybe(pickMetricValue(rec, ["rotationDeg", "rotation_deg", "rotation"])),
    offsetXmm: toMaybe(pickMetricValue(rec, ["offsetXmm", "offset_x_mm", "offsetX", "offset_x"])),
    offsetYmm: toMaybe(pickMetricValue(rec, ["offsetYmm", "offset_y_mm", "offsetY", "offset_y"])),
    resultContourSnapshot: toMaybe(pickMetricValue(rec, ["resultContourSnapshot", "result_contour_snapshot", "contourSnapshot", "contour_snapshot"])),
    note: toMaybe(pickMetricValue(rec, ["note", "comment", "details"])),
  };
  return out;
}

function historyItemKey(it: PieceHistoryItem): string {
  return [
    it.sourceTable || "",
    it.ts || it.transAt || "",
    it.layoutRunId || "",
    it.fragmentId || "",
    it.transType || "",
    it.statusBefore || "",
    it.statusAfter || "",
    it.sourceRef || "",
    it.note || "",
  ].join("|");
}

function sameReservation(
  a: PieceData["reservation"] | null | undefined,
  b: PieceData["reservation"] | null | undefined
): boolean {
  const aActive = a?.active || null;
  const bActive = b?.active || null;
  const aLast = a?.last || null;
  const bLast = b?.last || null;
  return (
    String(aActive?.reservedAt || "") === String(bActive?.reservedAt || "") &&
    String(aActive?.reservedBy || "") === String(bActive?.reservedBy || "") &&
    String(aActive?.note || "") === String(bActive?.note || "") &&
    String(aLast?.reservedAt || "") === String(bLast?.reservedAt || "") &&
    String(aLast?.releasedAt || "") === String(bLast?.releasedAt || "") &&
    String(aLast?.reservedBy || "") === String(bLast?.reservedBy || "") &&
    String(aLast?.note || "") === String(bLast?.note || "")
  );
}

function extractHistoryItems(json: Record<string, unknown>, item: PieceData | null): PieceHistoryItem[] {
  const top = Array.isArray(json.history) ? (json.history as unknown[]) : [];
  const nested = Array.isArray(item?.history) ? (item?.history as unknown[]) : [];
  const all = [...top, ...nested];
  if (all.length === 0) return [];
  const unique = new Map<string, PieceHistoryItem>();
  for (const raw of all) {
    const normalized = normalizeHistoryItem(raw);
    const key = historyItemKey(normalized);
    if (!unique.has(key)) unique.set(key, normalized);
  }
  return Array.from(unique.values());
}

function hasRealValue(v: unknown): boolean {
  const s = String(v ?? "").trim();
  return s !== "" && s !== "-";
}

function isPlacementHistoryItem(it: PieceHistoryItem): boolean {
  const src = String(it.sourceTable || "").toLowerCase();
  if (src === "layoutrunscrapplacement" || src === "scrappieceusagehistory" || src === "scrapusagehistory") return true;
  return (
    hasRealValue(it.layoutRunId) ||
    hasRealValue(it.fragmentId) ||
    hasRealValue(it.zoneId) ||
    hasRealValue(it.rotationDeg) ||
    hasRealValue(it.offsetXmm) ||
    hasRealValue(it.offsetYmm) ||
    hasRealValue(it.resultContourSnapshot)
  );
}

function parseContourPoints(contourJson: string | null | undefined): Pt[] {
  if (!contourJson) return [];
  try {
    const parsed = JSON.parse(contourJson) as { path?: Array<{ x?: number; y?: number }> };
    const path = Array.isArray(parsed?.path) ? parsed.path : [];
    return path
      .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  } catch {
    return [];
  }
}

function isContourObject(value: unknown): value is { path: Array<{ x?: number; y?: number }>; units?: string } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.path);
}

function mirrorContourObjectVertical(contour: { path: Array<{ x?: number; y?: number }>; units?: string }): { path: Array<{ x: number; y: number }>; units?: string } | null {
  const pts = contour.path
    .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 3) return null;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  const cx = (minX + maxX) * 0.5;
  const mirrored = pts.map((p) => ({ x: 2 * cx - p.x, y: p.y }));
  return { units: contour.units, path: mirrored };
}

function rotatePoints(points: Pt[], deg: number): Pt[] {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return points.map((p) => ({
    x: p.x * c - p.y * s,
    y: p.x * s + p.y * c,
  }));
}

function getBounds(points: Pt[]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  return { w, h, maxSpan: Math.max(w, h) };
}

async function fetchContourPayload(api: ApiClient, pieceId: string, force = false): Promise<ContourFetchResult> {
  const raw = String(pieceId || "").trim();
  const key = looksLikeGuid(raw) ? normalizeGuidLike(raw) : raw;
  if (!key) throw new Error("contour_piece_id_empty");

  const cached = contourCache.get(key);
  const now = Date.now();
  if (!force && cached && now - cached.ts <= CONTOUR_CACHE_TTL_MS) {
    return {
      payload: cached.payload,
      loadMs: cached.loadMs,
      requestMs: cached.requestMs,
      jsonMs: cached.jsonMs,
      fromCache: true,
    };
  }

  if (!force) {
    const existing = contourInFlight.get(key);
    if (existing) {
      const data = await existing;
      return { payload: data.payload, loadMs: data.loadMs, requestMs: data.requestMs, jsonMs: data.jsonMs, fromCache: false };
    }
  }

  const promise = (async () => {
    const timed = await api.pieceContourByIdTimed(raw);
    const { ok, status, json, timings } = timed;
    if (!ok) throw new Error(String(json.error || `HTTP ${status}`));
    const item = (json.item || null) as PieceData | null;
    if (!item) throw new Error("contour_item_empty");
    const payload: ContourPayload = {
      metricsJson: item.metricsJson ?? null,
      scrapContour: item.scrapContour ?? null,
    };
    const loadMs = timings.totalMs;
    const requestMs = timings.requestMs;
    const jsonMs = timings.jsonMs;
    contourCache.set(key, { ts: Date.now(), payload, loadMs, requestMs, jsonMs });
    return { payload, loadMs, requestMs, jsonMs };
  })();

  contourInFlight.set(key, promise);
  try {
    const data = await promise;
    return { payload: data.payload, loadMs: data.loadMs, requestMs: data.requestMs, jsonMs: data.jsonMs, fromCache: false };
  } finally {
    contourInFlight.delete(key);
  }
}

function isLongOrGuid(v: string): boolean {
  if (!v || v === "-") return false;
  return /\{guid\s*\{/i.test(v) || v.length > 22 || v.startsWith("{");
}

function MetricValueCell({ raw, copyLabel, forceCopy = false }: { raw: unknown; copyLabel: string; forceCopy?: boolean }) {
  const value = String(raw ?? "-");
  const canCopy = forceCopy || isLongOrGuid(value);
  const handleCopy = async () => {
    const v = value.trim();
    if (!v || v === "-") return;
    try {
      await navigator.clipboard.writeText(v);
      message.success("Скопировано");
    } catch {
      message.error("Не удалось скопировать");
    }
  };
  if (!canCopy) return <div className="piece-metric-value">{value}</div>;
  return (
    <div className="piece-metric-value piece-metric-value-with-action">
      <span className="piece-metric-ellipsis">{value}</span>
      <Button
        size="small"
        type="text"
        className="piece-copy-btn"
        icon={<CopyOutlined />}
        aria-label={copyLabel}
        onClick={() => void handleCopy()}
      />
    </div>
  );
}

export default function PieceCardScreen({ pieceId, onLoadInfoChange }: PieceCardScreenProps) {
  const api = useMemo(() => new ApiClient(), []);
  const latestPieceIdRef = useRef(pieceId);
  const transitionInFlightRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [reservationLoading, setReservationLoading] = useState(false);
  const [error, setError] = useState("");
  const [piece, setPiece] = useState<PieceData | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionNote, setActionNote] = useState("");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("ScanA3");
  const [qualityOptions, setQualityOptions] = useState<DictOption[]>([]);
  const [materialOptions, setMaterialOptions] = useState<DictOption[]>([]);
  const [locationOptions, setLocationOptions] = useState<DictOption[]>([]);
  const [statusOptions, setStatusOptions] = useState<DictOption[]>([]);
  const [dictsLoading, setDictsLoading] = useState(true);
  const [statusMap, setStatusMap] = useState<Map<string, string>>(new Map());
  const [editMaterialId, setEditMaterialId] = useState("");
  const [editLocationId, setEditLocationId] = useState("");
  const [editQuality, setEditQuality] = useState("");
  const [editNote, setEditNote] = useState("");
  const [reserveUser, setReserveUser] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [pieceLoadMs, setPieceLoadMs] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyItems, setHistoryItems] = useState<PieceHistoryItem[]>([]);
  const [contourLoading, setContourLoading] = useState(false);
  const [contourFetchDone, setContourFetchDone] = useState(false);
  const [contourLoadMs, setContourLoadMs] = useState<number | null>(null);
  const [contourRequestMs, setContourRequestMs] = useState<number | null>(null);
  const [contourJsonMs, setContourJsonMs] = useState<number | null>(null);
  const [contourClientParseMs, setContourClientParseMs] = useState<number | null>(null);
  const [contourDrawMs, setContourDrawMs] = useState<number | null>(null);
  const [contourCacheHit, setContourCacheHit] = useState(false);
  const lastContourPerfRef = useRef<{ parseMs: number | null; drawMs: number | null }>({ parseMs: null, drawMs: null });

  const effectiveMaterialId = normalizeOptionValue(materialOptions, editMaterialId);
  const effectiveLocationId = normalizeOptionValue(locationOptions, editLocationId);

  useEffect(() => {
    latestPieceIdRef.current = pieceId;
  }, [pieceId]);

  const normalizeStatusCode = (s: string): "Available" | "Reserved" | "Used" | "Discarded" | "" => {
    const t = String(s || "").trim().toLowerCase();
    if (t === "available" || t === "доступен" || t === "доступно") return "Available";
    if (t === "reserved" || t === "зарезервирован" || t === "резерв") return "Reserved";
    if (t === "used" || t === "использован") return "Used";
    if (t === "discarded" || t === "списан") return "Discarded";
    return "";
  };

  const pieceStatus = normalizeStatusCode(String(piece?.scrapStatus || ""));
  const statusPillClass =
    pieceStatus === "Available"
      ? "status-pill status-pill-available"
      : pieceStatus === "Reserved"
        ? "status-pill status-pill-reserved"
        : pieceStatus === "Used"
          ? "status-pill status-pill-used"
          : pieceStatus === "Discarded"
            ? "status-pill status-pill-discarded"
            : "status-pill";
  const currentAction: "reserve" | "release" | "" =
    pieceStatus === "Available" ? "reserve" : pieceStatus === "Reserved" ? "release" : "";
  const currentActionLabel = currentAction === "reserve" ? "Зарезервировать" : "Снять резерв";
  const isEditable = pieceStatus === "Available";
  const materialLabel = useMemo(() => {
    if (dictsLoading) return "не выбрано";
    const key = String(editMaterialId || "").trim();
    if (!key) return "не выбрано";
    const hit = findOptionByValue(materialOptions, key);
    return hit?.label || "не выбрано";
  }, [dictsLoading, editMaterialId, materialOptions]);
  const locationLabel = useMemo(() => {
    if (dictsLoading) return "не выбрано";
    const key = String(editLocationId || "").trim();
    if (!key) return "не выбрано";
    const hit = findOptionByValue(locationOptions, key);
    return hit?.label || "не выбрано";
  }, [dictsLoading, editLocationId, locationOptions]);
  const qualityLabel = useMemo(() => {
    if (dictsLoading) return "не выбрано";
    const key = String(editQuality || "").trim();
    if (!key) return "не выбрано";
    const hit = qualityOptions.find((o) => String(o.value) === key);
    return hit?.label || "не выбрано";
  }, [dictsLoading, editQuality, qualityOptions]);
  const loadText = loading
    ? "Карточка лоскута: загрузка..."
    : pieceLoadMs !== null
      ? `Карточка лоскута: ${pieceLoadMs} мс`
      : "";
  const contourPerfText = useMemo(() => {
    if (contourLoading) return "Контур: загрузка...";
    if (contourLoadMs === null) return "";
    const parts = [`Контур: ${contourLoadMs} мс`];
    if (contourRequestMs !== null) parts.push(`сеть ${contourRequestMs} мс`);
    if (contourJsonMs !== null) parts.push(`json ${contourJsonMs} мс`);
    if (contourClientParseMs !== null) parts.push(`parse ${contourClientParseMs} мс`);
    if (contourDrawMs !== null) parts.push(`draw ${contourDrawMs} мс`);
    if (contourCacheHit) parts.push("cache");
    return parts.join(" | ");
  }, [contourClientParseMs, contourDrawMs, contourJsonMs, contourLoadMs, contourLoading, contourRequestMs, contourCacheHit]);
  const handleContourPerfMeasured = useCallback((perf: { parseMs: number; drawMs: number }) => {
    const prev = lastContourPerfRef.current;
    if (prev.parseMs === perf.parseMs && prev.drawMs === perf.drawMs) return;
    lastContourPerfRef.current = { parseMs: perf.parseMs, drawMs: perf.drawMs };
    setContourClientParseMs(perf.parseMs);
    setContourDrawMs(perf.drawMs);
  }, []);
  const metrics = useMemo(() => parseMetricsJson(piece?.metricsJson), [piece?.metricsJson]);
  const napDirectionDegRaw = useMemo(() => {
    const nMetric = Number(metrics.napDirectionDegRaw);
    if (Number.isFinite(nMetric)) return nMetric;
    const nField = Number(piece?.napDirectionDeg);
    return Number.isFinite(nField) ? nField : null;
  }, [metrics, piece?.napDirectionDeg]);
  const napDirectionDegCanonical = useMemo(() => {
    const nMetric = Number(metrics.napDirectionDegCanonical);
    if (Number.isFinite(nMetric)) return nMetric;
    const raw = Number(napDirectionDegRaw);
    if (!Number.isFinite(raw)) return null;
    const scanSide = String(metrics.scanSide || "").trim().toLowerCase();
    return scanSide === "leather_up" ? (180 - raw + 360) % 360 : ((raw % 360) + 360) % 360;
  }, [metrics, napDirectionDegRaw]);
  const previewContourConfig = useMemo(() => {
    const scanSide = String(metrics.scanSide || "").trim().toLowerCase();
    const normObj = (metrics.contourNormalization && typeof metrics.contourNormalization === "object")
      ? (metrics.contourNormalization as Record<string, unknown>)
      : null;
    const normalizationMethod = String(normObj?.method || "").trim().toLowerCase();
    const mirrorHint =
      scanSide === "leather_up" ||
      normalizationMethod === "mirror_vertical_bbox_center" ||
      normObj?.applied === true;
    const rawObj = metrics.contourRaw;
    if (isContourObject(rawObj)) {
      try {
        return {
          contourJson: JSON.stringify(rawObj),
          mirrorForLayout: mirrorHint,
        };
      } catch {
        // fall through to next variant
      }
    }

    const canonicalObj = metrics.contourCanonical;
    if (mirrorHint && isContourObject(canonicalObj)) {
      const syntheticRaw = mirrorContourObjectVertical(canonicalObj);
      if (syntheticRaw) {
        try {
          return {
            contourJson: JSON.stringify(syntheticRaw),
            mirrorForLayout: true,
          };
        } catch {
          // fall through to default
        }
      }
    }

    return {
      contourJson: piece?.scrapContour ?? null,
      mirrorForLayout: false,
    };
  }, [metrics, piece?.scrapContour]);
  const contourPointCount = useMemo(() => getContourPointCount(piece?.scrapContour), [piece?.scrapContour]);
  const scanNapText = Number.isFinite(Number(napDirectionDegRaw))
    ? Number(napDirectionDegRaw).toFixed(1)
    : "-";
  const normAngleText = formatNum(napDirectionDegCanonical, 1);
  const normAngleInlineFormulaText = useMemo(() => {
    const scanSide = String(metrics.scanSide || "").trim().toLowerCase();
    return scanSide === "leather_up"
      ? "180° - leather_up"
      : "leather_up";
  }, [metrics.scanSide]);
  const contourStats = useMemo(() => {
    const points = parseContourPoints(piece?.scrapContour);
    if (points.length < 3) {
      return {
        scanW: piece?.bboxWidthMm ?? null,
        scanH: piece?.bboxHeightMm ?? null,
        scanMax: piece?.maxSpanMm ?? null,
        normW: piece?.bboxWidthMm ?? null,
        normH: piece?.bboxHeightMm ?? null,
        normMax: piece?.maxSpanMm ?? null,
        pointsCount: contourPointCount ?? null,
      };
    }
    const raw = getBounds(points);
    const canNorm = Number.isFinite(Number(napDirectionDegCanonical));
    const rotated = canNorm ? rotatePoints(points, 90 - Number(napDirectionDegCanonical)) : points;
    const norm = getBounds(rotated);
    return {
      scanW: raw.w,
      scanH: raw.h,
      scanMax: raw.maxSpan,
      normW: norm.w,
      normH: norm.h,
      normMax: norm.maxSpan,
      pointsCount: points.length,
    };
  }, [
    piece?.scrapContour,
    piece?.bboxWidthMm,
    piece?.bboxHeightMm,
    piece?.maxSpanMm,
    napDirectionDegCanonical,
    contourPointCount,
  ]);
  const placementData = useMemo(() => ({
    layoutRunId: pickMetricValue(metrics, ["layoutRunId", "layout_run_id", "layoutId", "layout_id"]),
    fragmentId: pickMetricValue(metrics, ["fragmentId", "fragment_id"]),
    zoneId: pickMetricValue(metrics, ["zoneId", "zone_id"]),
    rotationDeg: pickMetricValue(metrics, ["rotationDeg", "rotation_deg", "rotation"]),
    offsetXmm: pickMetricValue(metrics, ["offsetXmm", "offset_x_mm", "offsetX", "offset_x"]),
    offsetYmm: pickMetricValue(metrics, ["offsetYmm", "offset_y_mm", "offsetY", "offset_y"]),
    resultContourSnapshot: pickMetricValue(metrics, ["resultContourSnapshot", "result_contour_snapshot", "contourSnapshot", "contour_snapshot"]),
  }), [metrics]);
  const operationRows = useMemo(() => {
    const rows = historyItems.filter((it) => String(it.sourceTable || "").toLowerCase() === "scraptransaction");
    rows.sort((a, b) => String(b.transAt || "").localeCompare(String(a.transAt || "")));
    return rows;
  }, [historyItems]);
  const usageRows = useMemo(() => {
    const rows = historyItems.filter((it) => isPlacementHistoryItem(it));
    rows.sort((a, b) => String(b.ts || b.transAt || "").localeCompare(String(a.ts || a.transAt || "")));
    return rows;
  }, [historyItems]);
  const placementDataView = useMemo(() => {
    const firstUsage = usageRows.find((it) => (
      hasRealValue(it.layoutRunId) ||
      hasRealValue(it.fragmentId) ||
      hasRealValue(it.zoneId) ||
      hasRealValue(it.rotationDeg) ||
      hasRealValue(it.offsetXmm) ||
      hasRealValue(it.offsetYmm) ||
      hasRealValue(it.resultContourSnapshot)
    )) || null;
    const preferMetric = (metricValue: unknown, usageValue: unknown) => {
      if (hasRealValue(metricValue)) return String(metricValue);
      if (hasRealValue(usageValue)) return String(usageValue);
      return "-";
    };
    return {
      layoutRunId: preferMetric(placementData.layoutRunId, firstUsage ? pickRowValue(firstUsage, ["layoutRunId", "layout_run_id", "layoutId", "layout_id"]) : "-"),
      fragmentId: preferMetric(placementData.fragmentId, firstUsage ? pickRowValue(firstUsage, ["fragmentId", "fragment_id"]) : "-"),
      zoneId: preferMetric(placementData.zoneId, firstUsage ? pickRowValue(firstUsage, ["zoneId", "zone_id"]) : "-"),
      rotationDeg: preferMetric(placementData.rotationDeg, firstUsage ? pickRowValue(firstUsage, ["rotationDeg", "rotation_deg", "rotation"]) : "-"),
      offsetXmm: preferMetric(placementData.offsetXmm, firstUsage ? pickRowValue(firstUsage, ["offsetXmm", "offset_x_mm", "offsetX", "offset_x"]) : "-"),
      offsetYmm: preferMetric(placementData.offsetYmm, firstUsage ? pickRowValue(firstUsage, ["offsetYmm", "offset_y_mm", "offsetY", "offset_y"]) : "-"),
      resultContourSnapshot: preferMetric(placementData.resultContourSnapshot, firstUsage ? pickRowValue(firstUsage, ["resultContourSnapshot", "result_contour_snapshot", "contourSnapshot", "contour_snapshot"]) : "-"),
    };
  }, [placementData, usageRows]);
  const operationColumns: ColumnsType<PieceHistoryItem> = useMemo(() => [
    { title: "Инв. метка", key: "inv", width: 140, render: () => piece?.inventoryTag || "-" },
    { title: "Дата/время", dataIndex: "transAt", key: "transAt", width: 170, render: (v) => formatDate(String(v || "")) },
    { title: "Тип", dataIndex: "transType", key: "transType", width: 150, render: (v) => v || "-" },
    { title: "Было", dataIndex: "statusBefore", key: "statusBefore", width: 120, render: (v) => v || "-" },
    { title: "Стало", dataIndex: "statusAfter", key: "statusAfter", width: 120, render: (v) => v || "-" },
    { title: "Основание", dataIndex: "sourceRef", key: "sourceRef", width: 190, ellipsis: true, render: (v) => v || "-" },
  ], [piece?.inventoryTag]);
  const usageColumns: ColumnsType<PieceHistoryItem> = useMemo(() => [
    { title: "Инв. метка", key: "inv", width: 140, render: () => piece?.inventoryTag || "-" },
    { title: "Запуск выкладки", dataIndex: "layoutRunId", key: "layoutRunId", width: 180, ellipsis: true, render: (v) => v || "-" },
    { title: "Фрагмент", dataIndex: "fragmentId", key: "fragmentId", width: 150, ellipsis: true, render: (v) => v || "-" },
    { title: "Поворот, deg", dataIndex: "rotationDeg", key: "rotationDeg", width: 120, render: (v) => v || "-" },
    { title: "Позиция X, мм", dataIndex: "offsetXmm", key: "offsetXmm", width: 120, render: (v) => v || "-" },
    { title: "Позиция Y, мм", dataIndex: "offsetYmm", key: "offsetYmm", width: 120, render: (v) => v || "-" },
    { title: "Комментарий", dataIndex: "note", key: "note", width: 190, ellipsis: true, render: (v) => v || "-" },
  ], [piece?.inventoryTag]);

  useEffect(() => {
    if (!onLoadInfoChange) return;
    onLoadInfoChange(loadText);
    return () => onLoadInfoChange("");
  }, [loadText, onLoadInfoChange]);

  const fetchPiece = async (
    id: string,
    options?: { refresh?: boolean }
  ): Promise<{ item: PieceData | null; loadMs: number; historyItems: PieceHistoryItem[] }> => {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const { ok, status, json } = await api.pieceById(id, {
      includeReservation: false,
      includeHistory: true,
      lite: true,
      refresh: !!options?.refresh,
    });
    if (!ok) throw new Error(String(json.error || `HTTP ${status}`));
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const item = (json.item || null) as PieceData | null;
    if (item && !isSamePiece(id, item)) {
      throw new Error(`piece_mismatch: requested=${id}; got=${item.id || item.inventoryTag || "-"}`);
    }
    const loadedHistory = extractHistoryItems(json, item);
    return {
      item,
      loadMs: Math.max(0, Math.round(t1 - t0)),
      historyItems: loadedHistory,
    };
  };

  const applyLoadedPiece = (payload: { item: PieceData | null; loadMs: number; historyItems: PieceHistoryItem[] }) => {
    const item = normalizePieceTimestamps(payload.item);
    setPiece(item);
    setHistoryItems(payload.historyItems);
    setHistoryError("");
    setEditMaterialId(String(item?.materialId || ""));
    setEditLocationId(String(item?.storageLocationId || ""));
    setEditQuality(String(item?.scrapQuality || ""));
    setEditNote(String(item?.note || ""));
    setPieceLoadMs(payload.loadMs);
  };

  const reloadPiece = async (targetPieceId = pieceId, options?: { refresh?: boolean }) => {
    if (!targetPieceId) return;
    const payload = await fetchPiece(targetPieceId, options);
    if (latestPieceIdRef.current !== targetPieceId) return;
    applyLoadedPiece(payload);
    const hasPlacementRows = payload.historyItems.some(isPlacementHistoryItem);
    if (!hasPlacementRows) {
      const canonicalPieceId = String(payload.item?.id || targetPieceId).trim();
      void reloadHistory(canonicalPieceId);
    }
    return payload;
  };

  const applyContourToPiece = (
    targetPieceId: string,
    payload: ContourPayload,
    timings: { loadMs: number; requestMs: number; jsonMs: number; fromCache: boolean }
  ) => {
    if (latestPieceIdRef.current !== targetPieceId) return;
    setPiece((prev) => {
      if (!prev || !isSamePiece(targetPieceId, prev)) return prev;
      const mergedMetrics = mergeMetricsJson(prev.metricsJson, payload.metricsJson);
      const mergedContour = payload.scrapContour ?? prev.scrapContour;
      if (mergedMetrics === prev.metricsJson && mergedContour === prev.scrapContour) return prev;
      return {
        ...prev,
        metricsJson: mergedMetrics,
        scrapContour: mergedContour,
      };
    });
    setContourLoadMs(timings.loadMs);
    setContourRequestMs(timings.requestMs);
    setContourJsonMs(timings.jsonMs);
    setContourCacheHit(!!timings.fromCache);
    setContourFetchDone(true);
  };

  const reloadHistory = async (targetPieceId = pieceId) => {
    if (!targetPieceId) return;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const { ok, status, json } = await api.pieceHistoryById(targetPieceId);
      if (!ok) throw new Error(String(json.error || `HTTP ${status}`));
      if (latestPieceIdRef.current !== targetPieceId) return;
      const items = Array.isArray(json.items) ? (json.items as unknown[]).map((raw) => normalizeHistoryItem(raw)) : [];
      setHistoryItems(items);
    } catch (e) {
      if (latestPieceIdRef.current !== targetPieceId) return;
      setHistoryItems([]);
      setHistoryError(`История не загружена: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (latestPieceIdRef.current !== targetPieceId) return;
      setHistoryLoading(false);
    }
  };
  const reloadReservation = async (targetPieceId = pieceId) => {
    if (!targetPieceId) return;
    setReservationLoading(true);
    try {
      const { ok, status, json } = await api.pieceReservationById(targetPieceId);
      if (!ok) throw new Error(String(json.error || `HTTP ${status}`));
      if (latestPieceIdRef.current !== targetPieceId) return;
      const active = (json.active || null) as PieceData["reservation"] extends { active?: infer A } ? A : never;
      const last = (json.last || null) as PieceData["reservation"] extends { last?: infer L } ? L : never;
      setPiece((prev) => {
        if (!prev || !isSamePiece(targetPieceId, prev)) return prev;
        const nextReservation: PieceData["reservation"] = { active, last };
        if (sameReservation(prev.reservation, nextReservation)) return prev;
        return {
          ...prev,
          reservation: nextReservation,
        };
      });
    } catch {
      // non-blocking
    } finally {
      if (latestPieceIdRef.current !== targetPieceId) return;
      setReservationLoading(false);
    }
  };

  const runStatusAction = async (action: "reserve" | "release" | "use") => {
    if (!pieceId || !piece) return;
    if (transitionInFlightRef.current) return;
    transitionInFlightRef.current = true;
    setActionBusy(true);
    try {
      const { ok, status, json } = await api.pieceStatusTransition(pieceId, action, {
        userName: reserveUser.trim() || "react-ui",
        note: actionNote.trim(),
      });
      if (!ok) {
        const raw = String(json.error || `HTTP ${status}`);
        const readable = mapTransitionError(raw);
        if (raw.includes("transition_")) {
          const expectedStatus = action === "reserve" ? "Reserved" : action === "release" ? "Available" : "Used";
          const currentStatus = String(json.currentStatus || "").trim();
          if (currentStatus) {
            setPiece((prev) => (prev ? { ...prev, scrapStatus: currentStatus } : prev));
          } else {
            // Backward-compatible fallback for older backend payloads.
            try {
              const parsed = JSON.parse(String(json.stdout || "{}")) as Record<string, unknown>;
              const fallbackStatus = String(parsed.currentStatus || "").trim();
              if (fallbackStatus) setPiece((prev) => (prev ? { ...prev, scrapStatus: fallbackStatus } : prev));
            } catch (_) {}
          }
          let refreshedStatus = "";
          try {
            const refreshed = await reloadPiece(pieceId, { refresh: true });
            await reloadReservation(pieceId);
            refreshedStatus = normalizeStatusCode(String(refreshed?.item?.scrapStatus || ""));
          } catch (_) {}
          if (refreshedStatus === expectedStatus) {
            void reloadHistory(pieceId);
            setActionNote("");
            if (action === "release") setReserveUser("");
            message.success("Статус обновлен");
            return;
          }
          if (raw.includes("transition_denied_")) {
            message.warning(readable);
          } else {
            message.error(readable);
          }
          return;
        }
        throw new Error(raw);
      }
      clearRegistryCache();
      await reloadPiece(pieceId, { refresh: true });
      void reloadHistory(pieceId);
      setActionNote("");
      if (action === "release") setReserveUser("");
      message.success("Статус обновлен");
    } catch (e) {
      message.error(mapTransitionError(e instanceof Error ? e.message : String(e)));
    } finally {
      setActionBusy(false);
      transitionInFlightRef.current = false;
    }
  };

  const saveEditableFields = async () => {
    if (!pieceId || !piece) return;
    if (!isEditable) {
      message.warning("Параметры доступны для редактирования только в статусе «Доступен»");
      return;
    }
    if (!editQuality) {
      message.warning("Выбери качество");
      return;
    }
    if (editQuality === "Limited" && !editNote.trim()) {
      message.warning("Для качества 'Ограниченное' нужен комментарий");
      return;
    }
    setSaveBusy(true);
    try {
      const { ok, status, json } = await api.pieceUpdateById(pieceId, {
        materialId: effectiveMaterialId || "",
        storageLocationId: effectiveLocationId || "",
        scrapQuality: editQuality,
        note: editNote,
      });
      if (!ok) throw new Error(String(json.error || `HTTP ${status}`));
      await reloadPiece();
      message.success("Параметры карточки сохранены");
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaveBusy(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      const targetPieceId = pieceId;
      if (!targetPieceId) return;
      // Prevent previous card flash while next piece is loading.
      setPiece(null);
      setHistoryItems([]);
      setHistoryError("");
      setHistoryLoading(false);
      setContourLoading(true);
      setContourFetchDone(false);
      setContourLoadMs(null);
      setContourRequestMs(null);
      setContourJsonMs(null);
      setContourClientParseMs(null);
      setContourDrawMs(null);
      setContourCacheHit(false);
      lastContourPerfRef.current = { parseMs: null, drawMs: null };
      setLoading(true);
      setError("");

      const contourTask = fetchContourPayload(api, targetPieceId).catch(() => null);
      try {
        const payload = await fetchPiece(targetPieceId);
        if (!mounted) return;
        if (latestPieceIdRef.current !== targetPieceId) return;
        applyLoadedPiece(payload);
        if (payload.item?.scrapContour) {
          setContourLoading(false);
          setContourFetchDone(true);
        }
        const contour = await contourTask;
        if (!mounted) return;
        if (latestPieceIdRef.current !== targetPieceId) return;
        if (contour) {
          applyContourToPiece(targetPieceId, contour.payload, {
            loadMs: contour.loadMs,
            requestMs: contour.requestMs,
            jsonMs: contour.jsonMs,
            fromCache: contour.fromCache,
          });
          setContourLoading(false);
        } else {
          setContourLoading(false);
          setContourFetchDone(true);
        }
        void reloadReservation(targetPieceId);
      } catch (e) {
        if (!mounted) return;
        if (latestPieceIdRef.current !== targetPieceId) return;
        setError(`Не удалось загрузить карточку: ${e instanceof Error ? e.message : String(e)}`);
        onLoadInfoChange?.("Карточка лоскута: ошибка загрузки");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [api, pieceId]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (mounted) setDictsLoading(true);
      try {
        const { ok, status, json } = await api.dicts();
        if (!ok) throw new Error(String(json.error || `HTTP ${status}`));
        if (!mounted) return;

        const materialRows = normalizeDictRows(
          json.materials,
          ["idVal", "id", "materialId", "guid"],
          ["materialName", "name", "label", "code", "idVal"]
        );
        const locationRows = normalizeDictRows(
          json.locations,
          ["idVal", "id", "storageLocationId", "guid"],
          ["locCode", "locationCode", "name", "label", "idVal"]
        );
        const qualityRows = normalizeDictRows(
          json.qualities,
          ["code", "id", "value"],
          ["descr", "name", "label", "code"]
        );
        const statusRows = normalizeDictRows(
          json.statuses,
          ["code", "id", "value"],
          ["descr", "name", "label", "code"]
        );

        setQualityOptions(qualityRows);
        setMaterialOptions(materialRows);
        setLocationOptions(locationRows);
        setStatusOptions(statusRows);
        setStatusMap(new Map(statusRows.map((row) => [row.value, row.label || row.value])));
      } catch {
        if (!mounted) return;
        setQualityOptions([]);
        setMaterialOptions([]);
        setLocationOptions([]);
        setStatusOptions([]);
        setStatusMap(new Map());
      } finally {
        if (mounted) setDictsLoading(false);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [api]);

  return (
    <div className="section-shell">
      <Card
        size="small"
        title={(
          <Space size={10} wrap>
            <span>Карточка лоскута</span>
            {piece?.inventoryTag ? <span>{piece.inventoryTag}</span> : null}
            {piece ? (
              <span className={statusPillClass}>
                {statusMap.get(piece.scrapStatus || "") || piece.scrapStatus || "-"}
              </span>
            ) : null}
          </Space>
        )}
        extra={(
          <div className="piece-card-extra">
            {piece ? (
              currentAction ? (
                <Popover
                  trigger="click"
                  placement="bottomRight"
                  content={(
                    <Space direction="vertical" size={10} style={{ width: 380 }}>
                      <div className="reservation-row">
                        <div className="reservation-field">
                          <div className="piece-kv-label">Статус</div>
                          <Select
                            value={piece.scrapStatus || undefined}
                            options={statusOptions}
                            disabled
                            style={{ width: 170 }}
                            placeholder="-"
                          />
                        </div>
                        <div className="reservation-field">
                          <div className="piece-kv-label">Зарезервировал</div>
                          <Input
                            value={reserveUser}
                            onChange={(e) => setReserveUser(e.target.value)}
                            placeholder={piece.reservation?.active?.reservedBy || ""}
                            maxLength={64}
                            style={{ width: 190 }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="piece-kv-label">Комментарий операции</div>
                        <Input
                          value={actionNote}
                          onChange={(e) => setActionNote(e.target.value)}
                          maxLength={255}
                          placeholder="опционально"
                        />
                      </div>
                      <Space>
                        <Button
                          type={currentAction === "reserve" ? "primary" : "default"}
                          disabled={actionBusy}
                          loading={actionBusy}
                          onClick={() => void runStatusAction(currentAction)}
                        >
                          {currentActionLabel}
                        </Button>
                      </Space>
                      <div style={{ color: "#6b7280", fontSize: 12 }}>
                        {reservationLoading
                          ? "Загрузка резерва..."
                          : piece.reservation?.active
                            ? `Активный резерв: ${piece.reservation.active.reservedBy || "-"}, ${formatDate(String(piece.reservation.active.reservedAt || ""))}`
                            : `Статус: ${statusMap.get(piece.scrapStatus || "") || piece.scrapStatus || "-"}`}
                      </div>
                      {!reservationLoading && piece.reservation?.active?.note ? (
                        <div style={{ color: "#6b7280", fontSize: 12 }}>
                          Комментарий: {String(piece.reservation.active.note)}
                        </div>
                      ) : null}
                    </Space>
                  )}
                >
                  <Button type="primary" className="piece-header-action-btn">
                    {currentActionLabel}
                  </Button>
                </Popover>
              ) : null
            ) : null}
          </div>
        )}
        loading={false}
      >
        {!pieceId ? <Alert type="info" showIcon message="Выбери запись в реестре." /> : null}
        {error ? <Alert type="error" showIcon message={error} /> : null}
        {piece ? (
          <div className="piece-layout">
            <aside className="piece-left-col">
              <div className="piece-side-title">Параметры куска</div>
              <div className="piece-side-form">
                <div className="piece-edit-row">
                  <div className="piece-edit-label">Материал</div>
                  <div className="piece-edit-control">
                    {isEditable ? (
                      <Select
                        value={dictsLoading ? undefined : (effectiveMaterialId || undefined)}
                        onChange={(v) => setEditMaterialId(String(v || ""))}
                        options={materialOptions}
                        placeholder={dictsLoading ? "загрузка..." : "не выбрано"}
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        loading={dictsLoading}
                        disabled={dictsLoading}
                      />
                    ) : (
                      <Input value={materialLabel} readOnly />
                    )}
                  </div>
                </div>
                <div className="piece-edit-row">
                  <div className="piece-edit-label">Локация</div>
                  <div className="piece-edit-control">
                    {isEditable ? (
                      <Select
                        value={dictsLoading ? undefined : (effectiveLocationId || undefined)}
                        onChange={(v) => setEditLocationId(String(v || ""))}
                        options={locationOptions}
                        placeholder={dictsLoading ? "загрузка..." : "не выбрано"}
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        loading={dictsLoading}
                        disabled={dictsLoading}
                      />
                    ) : (
                      <Input value={locationLabel} readOnly />
                    )}
                  </div>
                </div>
                <div className="piece-edit-row">
                  <div className="piece-edit-label">Качество</div>
                  <div className="piece-edit-control">
                    {isEditable ? (
                      <Select
                        value={dictsLoading ? undefined : (editQuality || undefined)}
                        onChange={setEditQuality}
                        options={qualityOptions}
                        placeholder={dictsLoading ? "загрузка..." : "не выбрано"}
                        allowClear
                        loading={dictsLoading}
                        disabled={dictsLoading}
                      />
                    ) : (
                      <Input value={qualityLabel} readOnly />
                    )}
                  </div>
                </div>
                <div className="piece-kv-item">
                  <div className="piece-kv-label">Комментарий</div>
                  <Input.TextArea
                    className="comment-field"
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    maxLength={255}
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    placeholder="..."
                    readOnly={!isEditable}
                  />
                </div>
                <div className="piece-kv-item">
                  <Button type="primary" loading={saveBusy} onClick={() => void saveEditableFields()} disabled={!isEditable}>
                    Сохранить параметры
                  </Button>
                </div>
              </div>

              <Collapse
                size="small"
                bordered={false}
                expandIconPosition="end"
                defaultActiveKey={["geom"]}
                className="piece-side-collapse"
                items={[
                  {
                    key: "geom",
                    label: "Геометрия",
                    children: (
                      <div className="piece-metric-grid">
                        <div className="piece-metric-row"><span>Площадь, мм²</span><div className="piece-metric-value">{formatNum(piece.areaMm2, 0)}</div></div>
                        <div className="piece-metric-row"><span>Габариты (скан мездры), мм: W x H</span><div className="piece-metric-value">{`${formatNum(contourStats.scanW, 1)} x ${formatNum(contourStats.scanH, 1)}`}</div></div>
                        <div className="piece-metric-row"><span>Макс. габарит (скан мездры), мм</span><div className="piece-metric-value">{formatNum(contourStats.scanMax, 1)}</div></div>
                        <div className="piece-metric-row"><span>Габариты (fur_up ↓), мм: W x H</span><div className="piece-metric-value">{`${formatNum(contourStats.normW, 1)} x ${formatNum(contourStats.normH, 1)}`}</div></div>
                        <div className="piece-metric-row"><span>Макс. габарит (fur_up ↓), мм</span><div className="piece-metric-value">{formatNum(contourStats.normMax, 1)}</div></div>
                        <div className="piece-metric-row"><span>Точек контура, шт.</span><div className="piece-metric-value">{contourStats.pointsCount ?? "-"}</div></div>
                      </div>
                    ),
                  },
                  {
                    key: "nap",
                    label: "Ориентация ворса",
                    children: (
                        <div className="piece-metric-grid">
                        <div className="piece-metric-hint">От оси X, по часовой</div>
                        <div className="piece-metric-row"><span>Угол ворса (leather_up), °</span><div className="piece-metric-value">{scanNapText}</div></div>
                        <div className="piece-metric-row"><span>{`Угол ворса (${normAngleInlineFormulaText}), °`}</span><div className="piece-metric-value">{normAngleText}</div></div>
                      </div>
                    ),
                  },
                  {
                    key: "pass",
                    label: "Паспорт (скан)",
                    children: (
                      <div className="piece-metric-grid">
                        <div className="piece-metric-row">
                          <span>ID куска</span>
                          <MetricValueCell raw={piece.id || "-"} copyLabel="Скопировать ID куска" forceCopy />
                        </div>
                        <div className="piece-metric-row"><span>Источник (скан)</span><MetricValueCell raw={String(metrics.sourceAssetRef || "-")} copyLabel="Скопировать источник скана" /></div>
                        <div className="piece-metric-row"><span>Добавлено</span><div className="piece-metric-value">{formatDate(piece.createdAt)}</div></div>
                        <div className="piece-metric-row"><span>Изменено</span><div className="piece-metric-value">{formatDate(piece.updatedAt)}</div></div>
                      </div>
                    ),
                  },
                  ...(pieceStatus === "Used"
                    ? [{
                      key: "placement",
                      label: "Размещение в выкладке",
                      children: (
                        <div className="piece-metric-grid">
                          <div className="piece-metric-row"><span>Зона (ID)</span><MetricValueCell raw={placementDataView.zoneId} copyLabel="Скопировать ID зоны" /></div>
                          <div className="piece-metric-row"><span>Выкладка (ID)</span><MetricValueCell raw={placementDataView.layoutRunId} copyLabel="Скопировать ID выкладки" /></div>
                          <div className="piece-metric-row"><span>Фрагмент (ID)</span><MetricValueCell raw={placementDataView.fragmentId} copyLabel="Скопировать ID фрагмента" /></div>
                          <div className="piece-metric-row"><span>Поворот размещения, °</span><div className="piece-metric-value">{placementDataView.rotationDeg}</div></div>
                          <div className="piece-metric-row"><span>Позиция X, мм</span><div className="piece-metric-value">{placementDataView.offsetXmm}</div></div>
                          <div className="piece-metric-row"><span>Позиция Y, мм</span><div className="piece-metric-value">{placementDataView.offsetYmm}</div></div>
                          <div className="piece-metric-row"><span>Контур результата (снимок)</span><MetricValueCell raw={placementDataView.resultContourSnapshot} copyLabel="Скопировать контур результата" /></div>
                        </div>
                      ),
                    }]
                    : []),
                ]}
              />
            </aside>

            <section className="piece-preview-col">
              <div className="piece-preview-head">
                <div className="piece-side-title">Превью контура</div>
                <Space size={10} wrap className="piece-preview-controls">
                  <span className="piece-preview-meta">
                    {contourPerfText}
                  </span>
                  <span>Режим</span>
                  <Select
                    size="small"
                    value={previewMode}
                    onChange={(v) => setPreviewMode(v as PreviewMode)}
                    options={[
                      { value: "ScanA3", label: "Контуры" },
                      { value: "Scan", label: "Скан мездры" },
                    ]}
                    style={{ width: 150 }}
                  />
                </Space>
              </div>
              <div className="piece-preview-body">
                <ContourPreview
                  contourJson={previewContourConfig.contourJson}
                  mirrorForLayout={previewContourConfig.mirrorForLayout}
                  sourceImageRef={String(metrics.sourceAssetRef || "")}
                  napDirectionDeg={napDirectionDegCanonical}
                  napDirectionDegRaw={napDirectionDegRaw}
                  areaMm2={piece.areaMm2}
                  maxSpanMm={piece.maxSpanMm}
                  mode={previewMode}
                  normalize={previewMode === "ScanA3"}
                  showSummary={false}
                  loading={contourLoading || (!piece.scrapContour && !contourFetchDone)}
                  onPerfMeasured={handleContourPerfMeasured}
                />
              </div>
            </section>
          </div>
        ) : null}
        {piece ? (
          <div className="piece-history-blocks">
            <Collapse
              bordered
              items={[
                {
                  key: "operations",
                  label: "Операции",
                  children: (
                    <>
                      {historyError ? <Alert type="warning" showIcon message={historyError} style={{ marginBottom: 10 }} /> : null}
                      <Table
                        size="small"
                        rowKey={(r, idx) => `op_${r.transAt || ""}_${r.transType || ""}_${idx}`}
                        columns={operationColumns}
                        dataSource={operationRows}
                        loading={historyLoading}
                        pagination={{ pageSize: 5, showSizeChanger: false }}
                        scroll={{ x: 860 }}
                        locale={{ emptyText: "Операции не найдены." }}
                      />
                    </>
                  ),
                },
                {
                  key: "usage",
                  label: "История размещения",
                  children: (
                    <Table
                      size="small"
                      rowKey={(r, idx) => `use_${r.ts || r.transAt || ""}_${r.layoutRunId || ""}_${idx}`}
                      columns={usageColumns}
                      dataSource={usageRows}
                      loading={historyLoading}
                      pagination={{ pageSize: 5, showSizeChanger: false }}
                      scroll={{ x: 860 }}
                      locale={{ emptyText: "История размещения не найдена." }}
                    />
                  ),
                },
              ]}
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}




