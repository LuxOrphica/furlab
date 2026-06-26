import { useEffect, useMemo, useRef, useState } from "react";
import { IdcardOutlined, ReloadOutlined, SettingOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Checkbox, Input, Popover, Space, Table, Typography } from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import type { FilterValue, SorterResult, TableCurrentDataSource } from "antd/es/table/interface";
import { ApiClient, normalizeDictRows } from "../core/api";

type RegistryItem = {
  id: string;
  inventoryTag: string;
  materialId: string;
  storageLocationId: string;
  scrapQuality: string;
  scrapStatus: string;
  areaMm2: number | null;
  maxSpanMm: number | null;
  napDirectionDeg: number | null;
  updatedAt: string;
  note: string;
};

type RegistryResponse = {
  ok: boolean;
  total: number;
  page: number;
  pageSize: number;
  items: RegistryItem[];
  error?: string;
  requestId?: string;
  cache?: {
    cached?: boolean;
    stale?: boolean;
    ageMs?: number;
    ttlMs?: number;
  };
  diag?: {
    source?: string;
    copyMs?: number;
    scriptMs?: number;
    parseMs?: number;
    filterMs?: number;
    sortMs?: number;
    pageMs?: number;
    totalMs?: number;
    script?: {
      engine?: string;
      openMs?: number;
      queryMs?: number;
      encodeMs?: number;
      closeMs?: number;
      rows?: number;
      beforeCloseMs?: number;
      totalMs?: number;
      daoOpenCode?: number;
      adoOpenCode?: number;
    };
  };
};

type RegistryScreenProps = {
  onOpenPiece?: (id: string) => void;
  onLoadInfoChange?: (text: string) => void;
};

type SortDir = "asc" | "desc";
type ColumnKey =
  | "inventoryTag"
  | "scrapQuality"
  | "scrapStatus"
  | "actions"
  | "materialId"
  | "storageLocationId"
  | "areaMm2"
  | "maxSpanMm"
  | "updatedAt"
  | "note";

const COLUMN_PREFS_KEY = "furlab.registry.visibleColumns.v2";
const REGISTRY_FILTERS_SESSION_KEY = "furlab.registry.filters.v1";
const REQUIRED_COLUMNS = new Set<ColumnKey>(["inventoryTag", "scrapStatus", "actions"]);
const COLUMN_META: Array<{ key: ColumnKey; label: string }> = [
  { key: "inventoryTag", label: "\u0418\u043d\u0432. \u043c\u0435\u0442\u043a\u0430" },
  { key: "materialId", label: "\u041c\u0430\u0442\u0435\u0440\u0438\u0430\u043b" },
  { key: "maxSpanMm", label: "\u041c\u0430\u043a\u0441. \u0433\u0430\u0431\u0430\u0440\u0438\u0442, \u043c\u043c" },
  { key: "areaMm2", label: "\u041f\u043b\u043e\u0449\u0430\u0434\u044c, \u043c\u043c\u00b2" },
  { key: "scrapQuality", label: "\u041a\u0430\u0447\u0435\u0441\u0442\u0432\u043e" },
  { key: "scrapStatus", label: "\u0421\u0442\u0430\u0442\u0443\u0441" },
  { key: "storageLocationId", label: "\u041b\u043e\u043a\u0430\u0446\u0438\u044f" },
  { key: "updatedAt", label: "\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u043e" },
  { key: "note", label: "\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439" },
  { key: "actions", label: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044f" },
];
const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = [
  "inventoryTag",
  "materialId",
  "maxSpanMm",
  "areaMm2",
  "scrapQuality",
  "scrapStatus",
  "storageLocationId",
  "updatedAt",
  "actions",
];

type RegistryQuery = {
  page: number;
  pageSize: number;
  q: string;
  quality: string;
  status: string;
  materialId: string;
  storageLocationId: string;
  sortBy: string;
  sortDir: SortDir;
  refresh?: boolean;
};

type LoadRegistryPatch = Partial<{
  page: number;
  pageSize: number;
  q: string;
  quality: string;
  status: string;
  materialId: string;
  storageLocationId: string;
  sortBy: string;
  sortDir: SortDir;
  refresh: boolean;
  silent: boolean;
}>;

type RegistryPerf = {
  totalMs: number;
  requestMs: number;
  jsonMs: number;
  fromCache: boolean;
};

type RegistryFiltersState = {
  page: number;
  pageSize: number;
  q: string;
  quality: string;
  status: string;
  materialId: string;
  storageLocationId: string;
  sortBy: string;
  sortDir: SortDir;
};

const DEFAULT_REGISTRY_FILTERS: RegistryFiltersState = {
  page: 1,
  pageSize: 20,
  q: "",
  quality: "",
  status: "",
  materialId: "",
  storageLocationId: "",
  sortBy: "",
  sortDir: "desc",
};

const REGISTRY_CACHE_TTL_MS = 2 * 60 * 1000;
const registryCache = new Map<string, { ts: number; response: RegistryResponse; perf: RegistryPerf }>();
const registryInFlight = new Map<string, Promise<{ response: RegistryResponse; perf: RegistryPerf }>>();

export function clearRegistryCache(): void {
  registryCache.clear();
  registryInFlight.clear();
}

function buildRegistryCacheKey(query: RegistryQuery): string {
  return JSON.stringify(query);
}

async function fetchRegistryWithCache(api: ApiClient, query: RegistryQuery, force = false): Promise<{ response: RegistryResponse; perf: RegistryPerf }> {
  const key = buildRegistryCacheKey(query);
  const now = Date.now();
  const cached = registryCache.get(key);
  const bypassCache = force || !!query.refresh;
  if (!bypassCache && cached && now - cached.ts <= REGISTRY_CACHE_TTL_MS) {
    return {
      response: cached.response,
      perf: { ...cached.perf, fromCache: true },
    };
  }

  if (!bypassCache) {
    const existing = registryInFlight.get(key);
    if (existing) return existing;
  }

  const promise = (async () => {
    const timed = await api.registryTimed(query);
    const json = timed.json as RegistryResponse;
    const response: RegistryResponse = {
      ok: !!json.ok,
      total: Number(json.total || 0),
      page: Number(json.page || query.page),
      pageSize: Number(json.pageSize || query.pageSize),
      items: Array.isArray(json.items) ? json.items : [],
      error: json.error,
      requestId: typeof json.requestId === "string" ? json.requestId : undefined,
      cache: json.cache,
      diag: json.diag,
    };
    const perf: RegistryPerf = {
      totalMs: timed.timings.totalMs,
      requestMs: timed.timings.requestMs,
      jsonMs: timed.timings.jsonMs,
      fromCache: false,
    };
    if (!bypassCache) registryCache.set(key, { ts: Date.now(), response, perf });
    return { response, perf };
  })();

  if (!bypassCache) registryInFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (!bypassCache) registryInFlight.delete(key);
  }
}

function formatNum(value: number | null, digits: number): string {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "-";
}

function formatUpdatedAt(value: string): string {
  const dt = new Date(String(value || ""));
  if (Number.isNaN(dt.getTime())) return String(value || "-");
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, "0");
  const min = String(dt.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}

function parseUpdatedAtTs(value: string): number | null {
  const s = String(value || "").trim().replace(/\u00A0/g, " ");
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    let yyyy = Number(m[3]);
    const hh = Number(m[4] || 0);
    const mi = Number(m[5] || 0);
    const ss = Number(m[6] || 0);
    if (yyyy < 100) yyyy += 2000;
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      const ts = new Date(yyyy, mm - 1, dd, hh, mi, ss).getTime();
      return Number.isFinite(ts) ? ts : null;
    }
  }
  const ts = Date.parse(s);
  return Number.isFinite(ts) ? ts : null;
}

function sortRegistryItemsLocal(items: RegistryItem[], sortBy: string, sortDir: SortDir): RegistryItem[] {
  if (!sortBy) return items;
  const dir = sortDir === "desc" ? -1 : 1;
  const out = [...items];
  out.sort((a, b) => {
    if (sortBy === "updatedAt") {
      const at = parseUpdatedAtTs(String(a.updatedAt || ""));
      const bt = parseUpdatedAtTs(String(b.updatedAt || ""));
      if (at === null && bt === null) return 0;
      if (at === null) return 1;
      if (bt === null) return -1;
      return (at - bt) * dir;
    }
    const av = (a as unknown as Record<string, unknown>)[sortBy];
    const bv = (b as unknown as Record<string, unknown>)[sortBy];
    if (av === null || av === undefined || av === "") return 1;
    if (bv === null || bv === undefined || bv === "") return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv), "ru", { sensitivity: "base", numeric: true }) * dir;
  });
  return out;
}

function buildDictMap(rows: Array<{ value: string; label: string }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.value) map.set(r.value, r.label || r.value);
  }
  return map;
}

function pickFilterValue(v: FilterValue | null | undefined): string {
  if (!v || !Array.isArray(v) || v.length === 0) return "";
  const first = v[0];
  return first === undefined || first === null ? "" : String(first);
}

function statusClass(status: string): string {
  const s = String(status || "").trim().toLowerCase();
  if (s === "available") return "status-pill status-pill-available";
  if (s === "reserved") return "status-pill status-pill-reserved";
  if (s === "used") return "status-pill status-pill-used";
  if (s === "discarded") return "status-pill status-pill-discarded";
  return "status-pill";
}

function qualityClass(quality: string): string {
  const q = String(quality || "").trim().toLowerCase();
  if (q === "good" || q === "хорошее") return "quality-pill quality-pill-good";
  if (q === "limited" || q === "ограниченное") return "quality-pill quality-pill-limited";
  return "quality-pill";
}

function headerLabel(text: string) {
  return (
    <span className="registry-col-title-ellipsis" title={text}>
      {text}
    </span>
  );
}

function loadRegistryFiltersFromSession(): RegistryFiltersState {
  try {
    const raw = sessionStorage.getItem(REGISTRY_FILTERS_SESSION_KEY);
    if (!raw) return DEFAULT_REGISTRY_FILTERS;
    const parsed = JSON.parse(raw) as Partial<RegistryFiltersState> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_REGISTRY_FILTERS;
    const sortDir: SortDir = parsed.sortDir === "asc" ? "asc" : "desc";
    return {
      page: Math.max(1, Number(parsed.page || DEFAULT_REGISTRY_FILTERS.page)),
      pageSize: Math.max(1, Number(parsed.pageSize || DEFAULT_REGISTRY_FILTERS.pageSize)),
      q: String(parsed.q || ""),
      quality: String(parsed.quality || ""),
      status: String(parsed.status || ""),
      materialId: String(parsed.materialId || ""),
      storageLocationId: String(parsed.storageLocationId || ""),
      sortBy: String(parsed.sortBy || ""),
      sortDir,
    };
  } catch {
    return DEFAULT_REGISTRY_FILTERS;
  }
}

export default function RegistryScreen({ onOpenPiece, onLoadInfoChange }: RegistryScreenProps) {
  const api = useMemo(() => new ApiClient(), []);
  const initialFilters = useMemo(() => loadRegistryFiltersFromSession(), []);
  const mountedRef = useRef(true);
  const registryReqSeq = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<RegistryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(initialFilters.page);
  const [pageSize, setPageSize] = useState(initialFilters.pageSize);
  const [q, setQ] = useState(initialFilters.q);

  const [quality, setQuality] = useState(initialFilters.quality);
  const [status, setStatus] = useState(initialFilters.status);
  const [materialId, setMaterialId] = useState(initialFilters.materialId);
  const [storageLocationId, setStorageLocationId] = useState(initialFilters.storageLocationId);
  const [sortBy, setSortBy] = useState(initialFilters.sortBy);
  const [sortDir, setSortDir] = useState<SortDir>(initialFilters.sortDir);

  const [materialMap, setMaterialMap] = useState<Map<string, string>>(new Map());
  const [locationMap, setLocationMap] = useState<Map<string, string>>(new Map());
  const [qualityMap, setQualityMap] = useState<Map<string, string>>(new Map());
  const [statusMap, setStatusMap] = useState<Map<string, string>>(new Map());

  const [qualityOptions, setQualityOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [statusOptions, setStatusOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [materialOptions, setMaterialOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [locationOptions, setLocationOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() => {
    try {
      const raw = localStorage.getItem(COLUMN_PREFS_KEY);
      if (!raw) return DEFAULT_VISIBLE_COLUMNS;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return DEFAULT_VISIBLE_COLUMNS;
      const known = new Set(COLUMN_META.map((x) => x.key));
      const values = parsed
        .map((v) => String(v) as ColumnKey)
        .filter((v) => known.has(v));
      const withRequired = Array.from(new Set([...values, ...Array.from(REQUIRED_COLUMNS)]));
      return withRequired.length ? withRequired : DEFAULT_VISIBLE_COLUMNS;
    } catch {
      return DEFAULT_VISIBLE_COLUMNS;
    }
  });

  const resolveLabel = (id: string, map: Map<string, string>) => {
    const key = String(id || "").trim();
    if (!key) return "-";
    return map.get(key) || key;
  };

  const loadRegistry = async (patch?: LoadRegistryPatch) => {
    const reqId = ++registryReqSeq.current;
    const silent = !!patch?.silent;
    const next: RegistryQuery = {
      page: patch?.page ?? page,
      pageSize: patch?.pageSize ?? pageSize,
      q: (patch?.q ?? q).trim(),
      quality: patch?.quality ?? quality,
      status: patch?.status ?? status,
      materialId: patch?.materialId ?? materialId,
      storageLocationId: patch?.storageLocationId ?? storageLocationId,
      sortBy: patch?.sortBy ?? sortBy,
      sortDir: patch?.sortDir ?? sortDir,
      refresh: !!patch?.refresh,
    };

    if (!silent) {
      setLoading(true);
      onLoadInfoChange?.("Инвентарь лоскутов: загрузка...");
    }
    setError("");
    try {
      const { response, perf } = await fetchRegistryWithCache(api, next);
      if (!mountedRef.current || reqId !== registryReqSeq.current) return;
      if (!response.ok) throw new Error(response.error || "registry_fetch_failed");
      const loadedItemsBase = Array.isArray(response.items) ? response.items : [];
      let loadedItems = loadedItemsBase;
      if (next.sortBy === "updatedAt") {
        const dir = next.sortDir === "desc" ? -1 : 1;
        loadedItems = [...loadedItemsBase].sort((a, b) => {
          const at = parseUpdatedAtTs(String(a.updatedAt || ""));
          const bt = parseUpdatedAtTs(String(b.updatedAt || ""));
          if (at === null && bt === null) return 0;
          if (at === null) return 1;
          if (bt === null) return -1;
          return (at - bt) * dir;
        });
      }
      const loadedTotal = Number(response.total || 0);
      setItems(loadedItems);
      setTotal(loadedTotal);
      const source = String(response.diag?.source || "");
      const engine = String(response.diag?.script?.engine || "");
      const backendTotal = Number(response.diag?.totalMs || 0);
      const backendScript = Number(response.diag?.scriptMs || 0);
      const cacheTag = perf.fromCache || response.cache?.cached ? " | cache" : "";
      if (!silent) {
        onLoadInfoChange?.(
          `Инвентарь лоскутов: ${loadedTotal} строк, ${perf.totalMs} мс | сеть ${perf.requestMs} мс | json ${perf.jsonMs} мс` +
            (response.diag ? ` | src ${source || "-"}${engine ? `/${engine}` : ""} | script ${backendScript} мс | backend ${backendTotal} мс` : "") +
            cacheTag
        );
      }
    } catch (e) {
      if (!mountedRef.current || reqId !== registryReqSeq.current) return;
      setItems([]);
      setTotal(0);
      const msg = `Не удалось загрузить реестр: ${e instanceof Error ? e.message : String(e)}`;
      setError(msg);
      if (!silent) onLoadInfoChange?.("Инвентарь лоскутов: ошибка загрузки");
    } finally {
      if (!mountedRef.current || reqId !== registryReqSeq.current) return;
      if (!silent) setLoading(false);
    }
  };

  const loadDictionaries = async () => {
    try {
      const { ok, status: httpStatus, json } = await api.dicts();
      if (!ok) throw new Error(String(json.error || `HTTP ${httpStatus}`));

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

      setMaterialMap(buildDictMap(materialRows));
      setLocationMap(buildDictMap(locationRows));
      setQualityMap(buildDictMap(qualityRows));
      setStatusMap(buildDictMap(statusRows));

      setMaterialOptions(materialRows);
      setLocationOptions(locationRows);
      setQualityOptions(qualityRows);
      setStatusOptions(statusRows);
    } catch {
      setMaterialMap(new Map());
      setLocationMap(new Map());
      setQualityMap(new Map());
      setStatusMap(new Map());
      setMaterialOptions([]);
      setLocationOptions([]);
      setQualityOptions([]);
      setStatusOptions([]);
    }
  };

  useEffect(() => {
    void loadDictionaries();
    void loadRegistry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  useEffect(() => {
    // Keep active registry filters only for the current browser session.
    const snapshot: RegistryFiltersState = {
      page,
      pageSize,
      q,
      quality,
      status,
      materialId,
      storageLocationId,
      sortBy,
      sortDir,
    };
    try {
      sessionStorage.setItem(REGISTRY_FILTERS_SESSION_KEY, JSON.stringify(snapshot));
    } catch {
      // Ignore storage write errors to avoid breaking the screen.
    }
  }, [materialId, page, pageSize, q, quality, sortBy, sortDir, status, storageLocationId]);

  const allColumns: ColumnsType<RegistryItem> = [
    {
      title: headerLabel("Инв. метка"),
      dataIndex: "inventoryTag",
      key: "inventoryTag",
      width: 130,
      fixed: "left",
      sorter: true,
      sortOrder: sortBy === "inventoryTag" ? (sortDir === "asc" ? "ascend" : "descend") : null,
      render: (v: string) => (
        <Typography.Text
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            letterSpacing: 0.2,
          }}
        >
          {v || "-"}
        </Typography.Text>
      ),
    },
    {
      title: headerLabel("Материал"),
      dataIndex: "materialId",
      key: "materialId",
      width: 130,
      ellipsis: true,
      filters: materialOptions.map((o) => ({ text: o.label, value: o.value })),
      filteredValue: materialId ? [materialId] : null,
      filterMultiple: false,
      render: (id: string) => resolveLabel(id, materialMap),
    },
    {
      title: headerLabel("Макс. габарит, мм"),
      dataIndex: "maxSpanMm",
      key: "maxSpanMm",
      width: 130,
      sorter: true,
      sortOrder: sortBy === "maxSpanMm" ? (sortDir === "asc" ? "ascend" : "descend") : null,
      render: (v) => formatNum(v, 1),
    },

    {
      title: headerLabel("Площадь, мм²"),
      dataIndex: "areaMm2",
      key: "areaMm2",
      width: 120,
      sorter: true,
      sortOrder: sortBy === "areaMm2" ? (sortDir === "asc" ? "ascend" : "descend") : null,
      render: (v) => formatNum(v, 0),
    },
    {
      title: headerLabel("Качество"),
      dataIndex: "scrapQuality",
      key: "scrapQuality",
      width: 120,
      filters: qualityOptions.map((o) => ({ text: o.label, value: o.value })),
      filteredValue: quality ? [quality] : null,
      filterMultiple: false,
      render: (v) => (
        <span className={qualityClass(String(v || ""))}>
          {resolveLabel(String(v || ""), qualityMap)}
        </span>
      ),
    },
    {
      title: headerLabel("Статус"),
      dataIndex: "scrapStatus",
      key: "scrapStatus",
      width: 130,
      filters: statusOptions.map((o) => ({ text: o.label, value: o.value })),
      filteredValue: status ? [status] : null,
      filterMultiple: false,
      render: (v) => (
        <span className={statusClass(String(v || ""))}>{resolveLabel(String(v || ""), statusMap)}</span>
      ),
    },
    {
      title: headerLabel("Локация"),
      dataIndex: "storageLocationId",
      key: "storageLocationId",
      width: 130,
      ellipsis: true,
      filters: locationOptions.map((o) => ({ text: o.label, value: o.value })),
      filteredValue: storageLocationId ? [storageLocationId] : null,
      filterMultiple: false,
      render: (id: string) => resolveLabel(id, locationMap),
    },
    {
      title: headerLabel("Обновлено"),
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 160,
      sorter: true,
      sortOrder: sortBy === "updatedAt" ? (sortDir === "asc" ? "ascend" : "descend") : null,
      render: (v: string) => formatUpdatedAt(v),
    },
    { title: headerLabel("Комментарий"), dataIndex: "note", key: "note", ellipsis: true, width: 180 },
    {
      title: "",
      key: "actions",
      width: 48,
      fixed: "right",
      render: (_, row) => (
        <Space size={6}>
          <Button
            className="registry-action-btn"
            size="small"
            icon={<IdcardOutlined />}
            title="Карточка"
            aria-label="Карточка"
            onClick={(e) => {
              e.stopPropagation();
              const pieceRef = String(row.id || row.inventoryTag || "").trim();
              if (pieceRef && onOpenPiece) onOpenPiece(pieceRef);
            }}
          />
        </Space>
      ),
    },
  ];
  const columns = allColumns.filter((c) => visibleColumns.includes(String(c.key || "") as ColumnKey));

  const handleTableChange = (
    pagination: TablePaginationConfig,
    filters: Record<string, FilterValue | null>,
    sorter: SorterResult<RegistryItem> | SorterResult<RegistryItem>[],
    _extra: TableCurrentDataSource<RegistryItem>
  ) => {
    const nextPage = Number(pagination.current || 1);
    const nextPageSize = Number(pagination.pageSize || 20);

    const nextQuality = pickFilterValue(filters.scrapQuality);
    const nextStatus = pickFilterValue(filters.scrapStatus);
    const nextMaterial = pickFilterValue(filters.materialId);
    const nextLocation = pickFilterValue(filters.storageLocationId);

    let nextSortBy = "";
    let nextSortDir: SortDir = "asc";
    const s = Array.isArray(sorter) ? sorter[0] : sorter;
    if (s && s.order && s.field) {
      nextSortBy = String(s.field);
      nextSortDir = s.order === "descend" ? "desc" : "asc";
    }

    setPage(nextPage);
    setPageSize(nextPageSize);
    setQuality(nextQuality);
    setStatus(nextStatus);
    setMaterialId(nextMaterial);
    setStorageLocationId(nextLocation);
    setSortBy(nextSortBy);
    setSortDir(nextSortDir);
    // Instant UX: sort visible rows immediately, then sync with backend.
    setItems((prev) => sortRegistryItemsLocal(prev, nextSortBy, nextSortDir));

    void loadRegistry({
      page: nextPage,
      pageSize: nextPageSize,
      quality: nextQuality,
      status: nextStatus,
      materialId: nextMaterial,
      storageLocationId: nextLocation,
      sortBy: nextSortBy,
      sortDir: nextSortDir,
      refresh: true,
      silent: true,
    });
  };

  const applySearch = () => {
    setPage(1);
    void loadRegistry({ page: 1, q: q.trim() });
  };

  const resetAll = () => {
    setQ("");
    setPage(1);
    setPageSize(20);
    setQuality("");
    setStatus("");
    setMaterialId("");
    setStorageLocationId("");
    setSortBy("");
    setSortDir("desc");
    void loadRegistry({
      page: 1,
      pageSize: 20,
      q: "",
      quality: "",
      status: "",
      materialId: "",
      storageLocationId: "",
      sortBy: "",
      sortDir: "desc",
    });
  };

  const resetColumns = () => {
    setVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
  };

  const toggleColumn = (key: ColumnKey, checked: boolean) => {
    if (REQUIRED_COLUMNS.has(key)) return;
    setVisibleColumns((prev) => {
      const next = checked ? Array.from(new Set([...prev, key])) : prev.filter((k) => k !== key);
      for (const required of REQUIRED_COLUMNS) {
        if (!next.includes(required)) next.push(required);
      }
      return next;
    });
  };

  return (
    <div className="section-shell">
      <Card size="small">
        {error ? (
          <Alert
            type="error"
            showIcon
            message={error}
            style={{ marginBottom: 12 }}
          />
        ) : null}

        <div className="registry-toolbar">
          <div className="registry-toolbar-left">
            <Input.Search
              className="registry-search-input"
              allowClear
              placeholder="Поиск (инв. метка / комментарий / id)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onSearch={() => applySearch()}
            />
            <Button className="registry-reset-btn" onClick={resetAll} icon={<ReloadOutlined />} aria-label="Сброс" title="Сброс">
              <span className="registry-reset-label">Сброс</span>
            </Button>
          </div>

          <div className="registry-toolbar-right">
            <Popover
              trigger="click"
              placement="bottomRight"
              content={(
                <div style={{ minWidth: 240 }}>
                  <div style={{ marginBottom: 8, fontWeight: 600 }}>Видимость колонок</div>
                  <Space direction="vertical" size={6} style={{ width: "100%" }}>
                    {COLUMN_META.map((item) => (
                      <Checkbox
                        key={item.key}
                        checked={visibleColumns.includes(item.key)}
                        disabled={REQUIRED_COLUMNS.has(item.key)}
                        onChange={(e) => toggleColumn(item.key, !!e.target.checked)}
                      >
                        {item.label}
                      </Checkbox>
                    ))}
                  </Space>
                  <div style={{ marginTop: 10 }}>
                    <Button size="small" onClick={resetColumns}>Сбросить вид</Button>
                  </div>
                </div>
              )}
            >
              <Button className="registry-settings-btn" icon={<SettingOutlined />} aria-label="Настройки" title="Настройки">
                <span className="registry-settings-label">Настройки</span>
              </Button>
            </Popover>
          </div>
        </div>
        <Table
          rowKey={(r) => r.id || `${r.inventoryTag}_${r.updatedAt}`}
          columns={columns}
          dataSource={items}
          loading={loading}
          size="small"
          locale={{
            emptyText: "Записи не найдены.",
            filterConfirm: "ОК",
            filterReset: "Сброс",
          }}
          scroll={{ x: "max-content" }}
          onChange={handleTableChange}
          onRow={(record) => {
            const pieceRef = String(record.id || record.inventoryTag || "").trim();
            return {
              className: pieceRef ? "registry-row-clickable" : "",
              onClick: () => {
                if (pieceRef && onOpenPiece) onOpenPiece(pieceRef);
              },
            };
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
          }}
        />
      </Card>
    </div>
  );
}







