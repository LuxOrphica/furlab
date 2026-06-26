import { useEffect, useMemo, useReducer, useState } from "react";
import { DownloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Row, Statistic, Table, message } from "antd";
import type { ColumnsType } from "antd/es/table";
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
  napDirectionDeg?: number | null;
  updatedAt: string;
};

type UsageItem = {
  inventoryTag: string;
  layoutRunId: string;
  fragmentId: string;
  rotationDeg: string;
  offsetXmm: string;
  offsetYmm: string;
  ts: string;
};

type MaterialStat = { key: string; material: string; count: number };
type LocationStat = { key: string; location: string; count: number };

type ReportsScreenProps = {
  mode?: "summary" | "picklist" | "traceability";
  onLoadInfoChange?: (text: string) => void;
};

function statusClass(status: string): string {
  const s = String(status || "").trim().toLowerCase();
  if (s === "available" || s === "доступен") return "status-pill status-pill-available";
  if (s === "reserved" || s === "резерв" || s === "зарезервирован") return "status-pill status-pill-reserved";
  if (s === "used" || s === "использован") return "status-pill status-pill-used";
  if (s === "discarded" || s === "списан") return "status-pill status-pill-discarded";
  return "status-pill";
}

function qualityClass(quality: string): string {
  const q = String(quality || "").trim().toLowerCase();
  if (q === "good" || q === "хорошее") return "quality-pill quality-pill-good";
  if (q === "limited" || q === "ограниченное") return "quality-pill quality-pill-limited";
  return "quality-pill";
}

function makeFileStamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}`;
}

function ellipsisCell(value: unknown) {
  const text = String(value ?? "-");
  return (
    <span className="table-cell-ellipsis" title={text}>
      {text}
    </span>
  );
}

type DataState = {
  loading: boolean;
  error: string;
  truncated: boolean;
  truncatedTotalHint: number | null;
  rows: RegistryItem[];
  usageRows: UsageItem[];
  materialMap: Map<string, string>;
  locationMap: Map<string, string>;
  qualityMap: Map<string, string>;
  statusMap: Map<string, string>;
};

type DataAction =
  | { type: "LOAD_START" }
  | { type: "LOAD_SUCCESS"; rows: RegistryItem[]; usageRows: UsageItem[]; truncated: boolean; truncatedTotalHint: number | null }
  | { type: "DICTS_LOADED"; materialMap: Map<string, string>; locationMap: Map<string, string>; qualityMap: Map<string, string>; statusMap: Map<string, string> }
  | { type: "LOAD_ERROR"; error: string }
  | { type: "LOAD_DONE" }
  | { type: "TRUNCATED"; total: number | null };

const initialDataState: DataState = {
  loading: false,
  error: "",
  truncated: false,
  truncatedTotalHint: null,
  rows: [],
  usageRows: [],
  materialMap: new Map(),
  locationMap: new Map(),
  qualityMap: new Map(),
  statusMap: new Map(),
};

function dataReducer(state: DataState, action: DataAction): DataState {
  switch (action.type) {
    case "LOAD_START":
      return { ...state, loading: true, error: "", truncated: false, truncatedTotalHint: null };
    case "DICTS_LOADED":
      return { ...state, materialMap: action.materialMap, locationMap: action.locationMap, qualityMap: action.qualityMap, statusMap: action.statusMap };
    case "TRUNCATED":
      return { ...state, truncated: true, truncatedTotalHint: action.total };
    case "LOAD_SUCCESS":
      return { ...state, rows: action.rows, usageRows: action.usageRows, truncated: action.truncated, truncatedTotalHint: action.truncatedTotalHint };
    case "LOAD_ERROR":
      return { ...state, rows: [], usageRows: [], truncated: false, truncatedTotalHint: null, error: action.error };
    case "LOAD_DONE":
      return { ...state, loading: false };
    default:
      return state;
  }
}

export default function ReportsScreen({ mode = "summary", onLoadInfoChange }: ReportsScreenProps) {
  const api = useMemo(() => new ApiClient(), []);
  const [dataState, dispatch] = useReducer(dataReducer, initialDataState);
  const { loading, error, truncated, truncatedTotalHint, rows, usageRows, materialMap, locationMap, qualityMap, statusMap } = dataState;
  const [exporting, setExporting] = useState(false);

  const resolveLabel = (id: string, map: Map<string, string>) => {
    const key = String(id || "").trim();
    if (!key) return "-";
    return map.get(key) || key;
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
      const title = mode === "picklist" ? "Отчёты / Ведомость отбора" : mode === "traceability" ? "Отчёты / Трассируемость" : "Отчёты / Сводка";
      dispatch({ type: "LOAD_START" });
      onLoadInfoChange?.(`${title}: загрузка...`);

      try {
        const needRegistry = mode !== "traceability";
        const needUsage = mode === "traceability";
        const needDicts = mode !== "traceability";

        if (needDicts) {
          const dictRes = await api.dicts();
          if (dictRes.ok) {
            const json = dictRes.json;
            const materialRows = normalizeDictRows(json.materials, ["idVal", "id", "materialId", "guid"], ["materialName", "name", "label", "code", "idVal"]);
            const locationRows = normalizeDictRows(json.locations, ["idVal", "id", "storageLocationId", "guid"], ["locCode", "locationCode", "name", "label", "idVal"]);
            const qualityRows = normalizeDictRows(json.qualities, ["code", "id", "value"], ["descr", "name", "label", "code"]);
            const statusRows = normalizeDictRows(json.statuses, ["code", "id", "value"], ["descr", "name", "label", "code"]);
            if (mounted) {
              dispatch({
                type: "DICTS_LOADED",
                materialMap: new Map(materialRows.map((x) => [x.value, x.label])),
                locationMap: new Map(locationRows.map((x) => [x.value, x.label])),
                qualityMap: new Map(qualityRows.map((x) => [x.value, x.label])),
                statusMap: new Map(statusRows.map((x) => [x.value, x.label])),
              });
            }
          }
        }

        const all: RegistryItem[] = [];
        let isTruncated = false;
        let truncatedTotal: number | null = null;
        if (needRegistry) {
          let page = 1;
          const pageSize = 200;
          let total = 0;
          do {
            const res = await api.registry({ page, pageSize });
            if (!res.ok) throw new Error(String(res.json.error || `HTTP ${res.status}`));
            const json = res.json as { items?: RegistryItem[]; total?: number };
            const part = Array.isArray(json.items) ? json.items : [];
            total = Number(json.total || 0);
            all.push(...part);
            page += 1;
            if (page > 100) {
              isTruncated = true;
              truncatedTotal = total > 0 ? total : null;
              break;
            }
          } while (all.length < total);
        }

        let usageItems: UsageItem[] = [];
        if (needUsage) {
          const usage = await api.usageHistoryAll();
          if (!usage.ok) throw new Error(String(usage.json.error || `HTTP ${usage.status}`));
          usageItems = Array.isArray((usage.json as { items?: unknown[] }).items)
            ? ((usage.json as { items?: UsageItem[] }).items as UsageItem[])
            : [];
        }

        if (!mounted) return;
        dispatch({ type: "LOAD_SUCCESS", rows: all, usageRows: usageItems, truncated: isTruncated, truncatedTotalHint: truncatedTotal });

        const dt = Math.max(0, Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0));
        if (mode === "picklist") onLoadInfoChange?.(`Ведомость отбора: ${all.length} строк, ${dt} мс`);
        else if (mode === "traceability") onLoadInfoChange?.(`Трассируемость: ${usageItems.length} строк, ${dt} мс`);
        else onLoadInfoChange?.(`Отчёты / Сводка: ${all.length} строк, ${dt} мс`);
      } catch (e) {
        if (!mounted) return;
        dispatch({ type: "LOAD_ERROR", error: `Не удалось загрузить отчеты: ${e instanceof Error ? e.message : String(e)}` });
        onLoadInfoChange?.(`${title}: ошибка загрузки`);
      } finally {
        if (mounted) dispatch({ type: "LOAD_DONE" });
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [api, mode, onLoadInfoChange]);

  const byStatus = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = String(r.scrapStatus || "").trim() || "-";
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([k, v]) => ({ key: k, status: resolveLabel(k, statusMap), count: v, raw: k }))
      .sort((a, b) => b.count - a.count);
  }, [rows, statusMap]);

  const byQuality = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = String(r.scrapQuality || "").trim() || "-";
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([k, v]) => ({ key: k, quality: resolveLabel(k, qualityMap), count: v }))
      .sort((a, b) => b.count - a.count);
  }, [rows, qualityMap]);

  const byMaterial = useMemo<MaterialStat[]>(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = String(r.materialId || "").trim() || "-";
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([k, v]) => ({ key: k, material: resolveLabel(k, materialMap), count: v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [rows, materialMap]);

  const byLocation = useMemo<LocationStat[]>(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = String(r.storageLocationId || "").trim() || "-";
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([k, v]) => ({ key: k, location: resolveLabel(k, locationMap), count: v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [rows, locationMap]);

  const totalArea = useMemo(() => rows.reduce((s, r) => s + (Number(r.areaMm2) || 0), 0), [rows]);
  const usedCount = useMemo(
    () => rows.filter((r) => {
      const s = String(r.scrapStatus || "").trim().toLowerCase();
      return s === "used" || s === "использован";
    }).length,
    [rows]
  );

  const statusColumns: ColumnsType<{ key: string; status: string; count: number; raw: string }> = [
    { title: "Статус", dataIndex: "status", key: "status", render: (_, row) => <span className={statusClass(row.raw)}>{row.status}</span> },
    { title: "Кол-во", dataIndex: "count", key: "count", width: 100 },
  ];

  const qualityColumns: ColumnsType<{ key: string; quality: string; count: number }> = [
    {
      title: "Качество",
      dataIndex: "quality",
      key: "quality",
      render: (v: string) => <span className={qualityClass(v)}>{v}</span>,
    },
    { title: "Кол-во", dataIndex: "count", key: "count", width: 100 },
  ];

  const materialColumns: ColumnsType<MaterialStat> = [
    { title: "Материал", dataIndex: "material", key: "material" },
    { title: "Кол-во", dataIndex: "count", key: "count", width: 100 },
  ];

  const locationColumns: ColumnsType<LocationStat> = [
    { title: "Локация", dataIndex: "location", key: "location" },
    { title: "Кол-во", dataIndex: "count", key: "count", width: 100 },
  ];

  const pickListColumns: ColumnsType<RegistryItem> = [
    { title: "Инв. метка", dataIndex: "inventoryTag", key: "inventoryTag", width: 130, render: (v) => ellipsisCell(v) },
    { title: "Локация", dataIndex: "storageLocationId", key: "storageLocationId", width: 100, render: (v) => ellipsisCell(resolveLabel(String(v || ""), locationMap)) },
    { title: "Материал", dataIndex: "materialId", key: "materialId", width: 130, render: (v) => ellipsisCell(resolveLabel(String(v || ""), materialMap)) },
    { title: "Статус", dataIndex: "scrapStatus", key: "scrapStatus", width: 120, render: (v) => <span className={statusClass(String(v || ""))}>{resolveLabel(String(v || ""), statusMap)}</span> },
    {
      title: "Качество",
      dataIndex: "scrapQuality",
      key: "scrapQuality",
      width: 120,
      render: (v) => {
        const label = resolveLabel(String(v || ""), qualityMap);
        return <span className={qualityClass(label)}>{label}</span>;
      },
    },
    { title: "Площадь, мм²", dataIndex: "areaMm2", key: "areaMm2", width: 120, align: "right", render: (v) => ellipsisCell(Number(v || 0).toFixed(0)) },
    { title: "Направление ворса, °", dataIndex: "napDirectionDeg", key: "napDirectionDeg", width: 140, align: "right", render: (v) => ellipsisCell(v == null ? "-" : Number(v).toFixed(1)) },
  ];

  const traceColumns: ColumnsType<UsageItem> = [
    { title: "Инв. метка", dataIndex: "inventoryTag", key: "inventoryTag", width: 150, render: (v) => ellipsisCell(v) },
    { title: "Запуск выкладки", dataIndex: "layoutRunId", key: "layoutRunId", render: (v) => ellipsisCell(v) },
    { title: "Фрагмент", dataIndex: "fragmentId", key: "fragmentId", render: (v) => ellipsisCell(v) },
    { title: "Поворот, deg", dataIndex: "rotationDeg", key: "rotationDeg", width: 110, align: "right", render: (v) => ellipsisCell(v) },
    { title: "Смещение X, мм", dataIndex: "offsetXmm", key: "offsetXmm", width: 130, align: "right", render: (v) => ellipsisCell(v) },
    { title: "Смещение Y, мм", dataIndex: "offsetYmm", key: "offsetYmm", width: 130, align: "right", render: (v) => ellipsisCell(v) },
  ];

  const exportPdf = async () => {
    setExporting(true);
    try {
      const [pdfMakeModule, pdfFontsModule] = await Promise.all([
        import("pdfmake/build/pdfmake"),
        import("pdfmake/build/vfs_fonts"),
      ]);
      type PdfMakeShape = {
        createPdf?: (d: unknown) => {
          download?: (n: string) => void | Promise<void>;
          getBlob?: ((cb: (blob: Blob) => void) => void) | (() => Blob | Promise<Blob>);
        };
        addVirtualFileSystem?: (vfs: Record<string, string>) => void;
        vfs?: Record<string, string>;
      };
      const moduleObj = pdfMakeModule as unknown as { default?: PdfMakeShape };
      const moduleDefault = moduleObj.default;
      const moduleRoot = pdfMakeModule as unknown as PdfMakeShape;
      const pdfMake: PdfMakeShape | undefined = moduleRoot?.createPdf ? moduleRoot : moduleDefault?.createPdf ? moduleDefault : moduleRoot;
      const fontsObj = pdfFontsModule as unknown as {
        default?: unknown;
        pdfMake?: { vfs?: Record<string, string> };
      };
      const defaultFonts = fontsObj.default as { pdfMake?: { vfs?: Record<string, string> } } | Record<string, string> | undefined;
      const vfs =
        (defaultFonts && typeof defaultFonts === "object" && "pdfMake" in defaultFonts
          ? (defaultFonts as { pdfMake?: { vfs?: Record<string, string> } }).pdfMake?.vfs
          : undefined) ||
        fontsObj.pdfMake?.vfs ||
        (defaultFonts && typeof defaultFonts === "object" && !("pdfMake" in defaultFonts)
          ? (defaultFonts as Record<string, string>)
          : undefined);
      if (!pdfMake?.createPdf) throw new Error("pdfmake_not_ready");
      if (vfs && pdfMake.addVirtualFileSystem) pdfMake.addVirtualFileSystem(vfs);
      if (vfs && !pdfMake.addVirtualFileSystem) pdfMake.vfs = vfs;

      const now = new Date().toLocaleString("ru-RU");
      const stamp = makeFileStamp();
      const page = {
        pageSize: "A4",
        pageOrientation: "landscape" as const,
        pageMargins: [24, 20, 24, 24] as [number, number, number, number],
        defaultStyle: { fontSize: 9 },
      };
      const downloadDoc = async (doc: unknown, fileName: string) => {
        const pdf = pdfMake.createPdf?.(doc);
        if (!pdf) throw new Error("pdf_create_failed");
        if (typeof pdf.getBlob === "function") {
          const saveBlob = (blob: Blob) => {
            if (!blob) throw new Error("pdf_blob_empty");
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = fileName;
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          };
          const getBlobFn = pdf.getBlob as unknown as (...args: unknown[]) => unknown;
          if (getBlobFn.length === 0) {
            const blob = await Promise.resolve(getBlobFn.call(pdf)) as Blob;
            saveBlob(blob);
            return;
          }
          await new Promise<void>((resolve, reject) => {
            try {
              (pdf.getBlob as (cb: (blob: Blob) => void) => void)((blob: Blob) => {
                try {
                  saveBlob(blob);
                  resolve();
                } catch (err) {
                  reject(err);
                }
              });
            } catch (err) {
              reject(err);
            }
          });
          return;
        }
        if (typeof pdf.download === "function") {
          await Promise.resolve(pdf.download(fileName));
          return;
        }
        throw new Error("pdf_download_not_supported");
      };

      if (mode === "picklist") {
        const body = [
          ["Инв. метка", "Локация", "Материал", "Статус", "Качество", "Площадь, мм²", "Направление ворса, °"],
          ...rows.map((r) => [
            r.inventoryTag || "-",
            resolveLabel(String(r.storageLocationId || ""), locationMap),
            resolveLabel(String(r.materialId || ""), materialMap),
            resolveLabel(String(r.scrapStatus || ""), statusMap),
            resolveLabel(String(r.scrapQuality || ""), qualityMap),
            Number(r.areaMm2 || 0).toFixed(0),
            r.napDirectionDeg == null ? "-" : Number(r.napDirectionDeg).toFixed(1),
          ]),
        ];
        await downloadDoc({
          ...page,
          content: [
            { text: "FURLAB AC - Ведомость отбора", bold: true, fontSize: 14 },
            { text: `Сформировано: ${now}`, margin: [0, 2, 0, 10], color: "#6b7280", fontSize: 8 },
            { table: { headerRows: 1, widths: [90, 80, 90, 80, 80, 80, 90], body }, layout: "lightHorizontalLines" },
          ],
        }, `furlab_picklist_${stamp}.pdf`);
        message.success("PDF выгружен");
        return;
      }

      if (mode === "traceability") {
        const body = [
          ["Инв. метка", "Запуск выкладки", "Фрагмент", "Поворот, deg", "Смещение X, мм", "Смещение Y, мм"],
          ...usageRows.map((r) => [
            r.inventoryTag || "-",
            r.layoutRunId || "-",
            r.fragmentId || "-",
            r.rotationDeg || "-",
            r.offsetXmm || "-",
            r.offsetYmm || "-",
          ]),
        ];
        await downloadDoc({
          ...page,
          content: [
            { text: "FURLAB AC - Трассируемость", bold: true, fontSize: 14 },
            { text: `Сформировано: ${now}`, margin: [0, 2, 0, 10], color: "#6b7280", fontSize: 8 },
            { table: { headerRows: 1, widths: [90, 180, 180, 70, 90, 90], body }, layout: "lightHorizontalLines" },
          ],
        }, `furlab_traceability_${stamp}.pdf`);
        message.success("PDF выгружен");
        return;
      }

      const statusBody = [["Статус", "Кол-во"], ...byStatus.map((x) => [x.status, String(x.count)])];
      const qualityBody = [["Качество", "Кол-во"], ...byQuality.map((x) => [x.quality, String(x.count)])];
      const materialBody = [["Материал", "Кол-во"], ...byMaterial.map((x) => [x.material, String(x.count)])];
      const locationBody = [["Локация", "Кол-во"], ...byLocation.map((x) => [x.location, String(x.count)])];
      await downloadDoc({
        ...page,
        content: [
          { text: "FURLAB AC - Сводка", bold: true, fontSize: 14 },
          { text: `Сформировано: ${now}`, margin: [0, 2, 0, 10], color: "#6b7280", fontSize: 8 },
          { text: `Всего кусков: ${rows.length}; Использовано: ${usedCount}; Площадь: ${Math.round(totalArea)} мм²`, margin: [0, 0, 0, 10], color: "#6b7280", fontSize: 8 },
          { text: "По статусам", bold: true, margin: [0, 8, 0, 4] },
          { table: { headerRows: 1, widths: [180, 80], body: statusBody }, layout: "lightHorizontalLines" },
          { text: "По качеству", bold: true, margin: [0, 8, 0, 4] },
          { table: { headerRows: 1, widths: [180, 80], body: qualityBody }, layout: "lightHorizontalLines" },
          { text: "Топ материалов", bold: true, margin: [0, 8, 0, 4] },
          { table: { headerRows: 1, widths: [180, 80], body: materialBody }, layout: "lightHorizontalLines" },
          { text: "Топ локаций", bold: true, margin: [0, 8, 0, 4] },
          { table: { headerRows: 1, widths: [180, 80], body: locationBody }, layout: "lightHorizontalLines" },
        ],
      }, `furlab_summary_${stamp}.pdf`);
      message.success("PDF выгружен");
    } catch (e) {
      console.error("PDF export failed", e);
      message.error(`Экспорт PDF не выполнен: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  if (mode === "picklist") {
    return (
      <div className="section-shell">
        <Card
          size="small"
          loading={loading}
          title="Ведомость отбора"
          extra={<Button icon={<DownloadOutlined />} loading={exporting} onClick={() => void exportPdf()}>Экспорт PDF</Button>}
        >
          {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
          {truncated ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={`Данные отчёта усечены по лимиту клиента (20 000 строк)${truncatedTotalHint ? ` из ${truncatedTotalHint}` : ""}.`}
            />
          ) : null}
          <Table
            size="small"
            rowKey={(r) => r.id}
            columns={pickListColumns}
            dataSource={rows}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            tableLayout="fixed"
            locale={{ emptyText: "Нет данных для ведомости отбора." }}
          />
        </Card>
      </div>
    );
  }

  if (mode === "traceability") {
    return (
      <div className="section-shell">
        <Card
          size="small"
          loading={loading}
          title="Трассируемость"
          extra={<Button icon={<DownloadOutlined />} loading={exporting} onClick={() => void exportPdf()}>Экспорт PDF</Button>}
        >
          {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
          <Table
            size="small"
            rowKey={(r, i) => `${r.inventoryTag}_${r.layoutRunId}_${r.fragmentId}_${i}`}
            className="reports-trace-table"
            columns={traceColumns}
            dataSource={usageRows}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            tableLayout="fixed"
            locale={{ emptyText: "Нет данных трассируемости." }}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="section-shell">
        <Card
          size="small"
          loading={loading}
        >
          {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
          {truncated ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={`Данные отчёта усечены по лимиту клиента (20 000 строк)${truncatedTotalHint ? ` из ${truncatedTotalHint}` : ""}.`}
            />
          ) : null}
          <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
          <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="Всего кусков" value={rows.length} /></Card></Col>
          <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="Использовано" value={usedCount} /></Card></Col>
          <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="Площадь суммарно, мм²" value={Math.round(totalArea)} /></Card></Col>
        </Row>

        <div className="reports-grid">
          <Card size="small" title="По статусам" className="reports-panel"><Table size="small" pagination={false} rowKey="key" columns={statusColumns} dataSource={byStatus} /></Card>
          <Card size="small" title="По качеству" className="reports-panel"><Table size="small" pagination={false} rowKey="key" columns={qualityColumns} dataSource={byQuality} /></Card>
          <Card size="small" title="Топ материалов" className="reports-panel"><Table size="small" pagination={false} rowKey="key" columns={materialColumns} dataSource={byMaterial} /></Card>
          <Card size="small" title="Топ локаций" className="reports-panel"><Table size="small" pagination={false} rowKey="key" columns={locationColumns} dataSource={byLocation} /></Card>
        </div>
      </Card>
    </div>
  );
}
