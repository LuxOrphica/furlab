import { useEffect, useMemo, useState } from "react";
import { Alert, Card, Input, Space, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ApiClient } from "../core/api";

const PIECE_HISTORY_FILTERS_SESSION_KEY = "furlab.piece-history.filters.v1";

function loadPieceHistoryQueryFromSession(): string {
  try {
    return String(sessionStorage.getItem(PIECE_HISTORY_FILTERS_SESSION_KEY) || "");
  } catch {
    return "";
  }
}

type UsageItem = {
  inventoryTag: string;
  layoutRunId: string;
  fragmentId: string;
  rotationDeg: string;
  offsetXmm: string;
  offsetYmm: string;
  resultContourSnapshot: string;
  ts: string;
};

type PieceHistoryScreenProps = {
  onLoadInfoChange?: (text: string) => void;
};

function fmtDate(v: string): string {
  const dt = new Date(String(v || ""));
  if (Number.isNaN(dt.getTime())) return String(v || "-");
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, "0");
  const mi = String(dt.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
}

function ellipsisCell(value: unknown) {
  const text = String(value ?? "-");
  return (
    <span className="table-cell-ellipsis" title={text}>
      {text}
    </span>
  );
}

export default function PieceHistoryScreen({ onLoadInfoChange }: PieceHistoryScreenProps) {
  const api = useMemo(() => new ApiClient(), []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState(() => loadPieceHistoryQueryFromSession());
  const [items, setItems] = useState<UsageItem[]>([]);

  useEffect(() => {
    // Search filter is kept per-session to restore context after navigation.
    try {
      sessionStorage.setItem(PIECE_HISTORY_FILTERS_SESSION_KEY, q);
    } catch {
      // Ignore storage write errors.
    }
  }, [q]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
      setLoading(true);
      onLoadInfoChange?.("История размещений: загрузка...");
      setError("");
      try {
        const { ok, status, json } = await api.usageHistoryAll();
        if (!ok) throw new Error(String(json.error || `HTTP ${status}`));
        if (!mounted) return;
        const loaded = Array.isArray(json.items) ? (json.items as UsageItem[]) : [];
        setItems(loaded);
        const dt = Math.max(0, Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0));
        onLoadInfoChange?.(`История размещений: ${loaded.length} строк, ${dt} мс`);
      } catch (e) {
        if (!mounted) return;
        setItems([]);
        setError(`Не удалось загрузить историю размещений: ${e instanceof Error ? e.message : String(e)}`);
        onLoadInfoChange?.("История размещений: ошибка загрузки");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [api]);

  const filteredItems = useMemo(() => {
    const needle = String(q || "").trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => {
      const text = [
        it.inventoryTag,
        it.layoutRunId,
        it.fragmentId,
        it.rotationDeg,
        it.offsetXmm,
        it.offsetYmm,
      ].join(" ").toLowerCase();
      return text.includes(needle);
    });
  }, [items, q]);

  const columns: ColumnsType<UsageItem> = [
    { title: "Инв. метка", dataIndex: "inventoryTag", key: "inventoryTag", width: 150, render: (v) => ellipsisCell(v) },
    { title: "Дата/время", dataIndex: "ts", key: "ts", width: 160, render: (v) => ellipsisCell(fmtDate(String(v || ""))) },
    { title: "Запуск выкладки", dataIndex: "layoutRunId", key: "layoutRunId", render: (v) => ellipsisCell(v) },
    { title: "Фрагмент", dataIndex: "fragmentId", key: "fragmentId", render: (v) => ellipsisCell(v) },
    { title: "Поворот, deg", dataIndex: "rotationDeg", key: "rotationDeg", width: 110, render: (v) => ellipsisCell(v) },
    { title: "Смещение X, мм", dataIndex: "offsetXmm", key: "offsetXmm", width: 120, render: (v) => ellipsisCell(v) },
    { title: "Смещение Y, мм", dataIndex: "offsetYmm", key: "offsetYmm", width: 120, render: (v) => ellipsisCell(v) },
    { title: "Контур результата (снимок)", dataIndex: "resultContourSnapshot", key: "resultContourSnapshot", render: (v) => ellipsisCell(v) },
  ];

  return (
    <div className="section-shell">
      <Card size="small">
        {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
        <Space className="history-toolbar" style={{ marginBottom: 12 }}>
          <Input.Search
            allowClear
            placeholder="Поиск (инв. метка / запуск / фрагмент)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: "min(360px, 100%)" }}
          />
        </Space>
        <Table
          rowKey={(r, idx) => `${r.inventoryTag}_${r.layoutRunId}_${r.fragmentId}_${idx}`}
          loading={loading}
          size="small"
          tableLayout="fixed"
          columns={columns}
          dataSource={filteredItems}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          locale={{ emptyText: "История размещения не найдена." }}
        />
      </Card>
    </div>
  );
}
