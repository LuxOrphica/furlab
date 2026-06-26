import {
  AuditOutlined,
  DownOutlined,
  HddOutlined,
  NodeIndexOutlined,
  QrcodeOutlined,
} from "@ant-design/icons";
import { ConfigProvider, Menu, theme as antdTheme } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import LineDirectionScreen from "./screens/LineDirectionScreen";
import PieceCardScreen from "./screens/PieceCardScreen";
import PieceHistoryScreen from "./screens/PieceHistoryScreen";
import ReportsScreen from "./screens/ReportsScreen";
import RegistryScreen from "./screens/RegistryScreen";

type SectionKey = "registry" | "card" | "history" | "reports" | "reports-pick" | "reports-trace" | "line";
type AppProps = {
  isDark: boolean;
};

type RouteState = {
  section: SectionKey;
  pieceId: string;
};

const CANONICAL_BASE_PATH = "/furlab-ac";
const LEGACY_BASE_PATHS = ["/line-direction-visualizer", "/line-direction-visualizer-react"];

function normalizePath(path: string): string {
  const withSlashes = path.replace(/\\/g, "/");
  const collapsed = withSlashes.replace(/\/{2,}/g, "/");
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
}

function canonicalizePath(pathname: string): string {
  const p = normalizePath(pathname);
  for (const legacyBase of LEGACY_BASE_PATHS) {
    const legacy = normalizePath(legacyBase);
    if (p === legacy) return CANONICAL_BASE_PATH;
    if (p.startsWith(`${legacy}/`)) {
      return normalizePath(`${CANONICAL_BASE_PATH}${p.slice(legacy.length)}`);
    }
  }
  return p;
}

function detectBasePath(pathname: string): string {
  const p = canonicalizePath(pathname);
  if (p.endsWith("/index.html")) return normalizePath(p.slice(0, -"/index.html".length) || "/");
  const cardMatch = p.match(/^(.*)\/inventory\/card\/[^/]+$/);
  if (cardMatch) return normalizePath(cardMatch[1] || "/");
  for (const suffix of ["/scan", "/inventory", "/history", "/reports", "/reports-pick", "/reports-trace"]) {
    if (p.endsWith(suffix)) return normalizePath(p.slice(0, -suffix.length) || "/");
  }
  return p || "/";
}

function parseRoute(pathname: string): RouteState {
  const p = canonicalizePath(pathname).replace(/\/index\.html$/, "");
  const cardMatch = p.match(/\/inventory\/card\/([^/]+)$/);
  if (cardMatch) {
    return { section: "card", pieceId: decodeURIComponent(cardMatch[1] || "") };
  }
  if (p.endsWith("/scan")) return { section: "line", pieceId: "" };
  if (p.endsWith("/inventory")) return { section: "registry", pieceId: "" };
  if (p.endsWith("/history")) return { section: "history", pieceId: "" };
  if (p.endsWith("/reports-pick")) return { section: "reports-pick", pieceId: "" };
  if (p.endsWith("/reports-trace")) return { section: "reports-trace", pieceId: "" };
  if (p.endsWith("/reports")) return { section: "reports", pieceId: "" };
  return { section: "registry", pieceId: "" };
}

function buildRoute(basePath: string, section: SectionKey, pieceId: string): string {
  const base = normalizePath(basePath || "/");
  const prefix = base === "/" ? "" : base;
  if (section === "card") {
    return `${prefix}/inventory/card/${encodeURIComponent(pieceId || "")}`;
  }
  if (section === "line") return `${prefix}/scan`;
  if (section === "registry") return `${prefix}/inventory`;
  if (section === "history") return `${prefix}/history`;
  if (section === "reports-pick") return `${prefix}/reports-pick`;
  if (section === "reports-trace") return `${prefix}/reports-trace`;
  return `${prefix}/reports`;
}

export default function App({ isDark }: AppProps) {
  const appVersion = String((import.meta as { env?: Record<string, unknown> }).env?.VITE_APP_VERSION || "2.0.42");
  const basePathRef = useRef(detectBasePath(window.location.pathname));
  const initialRoute = useMemo(() => parseRoute(window.location.pathname), []);
  const [section, setSection] = useState<SectionKey>(initialRoute.section);
  const [activePieceId, setActivePieceId] = useState(initialRoute.pieceId);
  const [topbarStatus, setTopbarStatus] = useState("");

  useEffect(() => {
    setTopbarStatus("");
  }, [section]);

  useEffect(() => {
    const onPopState = () => {
      const canonicalPath = canonicalizePath(window.location.pathname);
      if (canonicalPath !== normalizePath(window.location.pathname)) {
        window.history.replaceState(null, "", canonicalPath);
      }
      const route = parseRoute(canonicalPath);
      setSection(route.section);
      setActivePieceId(route.pieceId);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const current = normalizePath(window.location.pathname);
    const canonical = canonicalizePath(current);
    if (canonical !== current) {
      window.history.replaceState(null, "", canonical);
    }
  }, []);

  const navigateToSection = (nextSection: SectionKey, nextPieceId = "") => {
    const pieceId = nextSection === "card" ? nextPieceId : "";
    setSection(nextSection);
    setActivePieceId(pieceId);
    const nextPath = normalizePath(buildRoute(basePathRef.current, nextSection, pieceId));
    const currentPath = normalizePath(window.location.pathname);
    if (currentPath !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }
  };

  const sectionLabel = useMemo(() => {
    if (section === "registry" || section === "card") return "Инвентарь лоскутов";
    if (section === "history") return "История размещений";
    if (section === "reports" || section === "reports-pick" || section === "reports-trace") return "Отчёты";
    return "Загрузка сканов";
  }, [section]);
  return (
    <div className="app-root unified-shell-root" data-theme={isDark ? "dark" : "light"}>
      <div className="unified-shell">
        <aside className="unified-sidebar">
          <div className="unified-sidebar-brand">
            <h1 className="unified-title">FURLAB AC</h1>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[section === "card" ? "registry" : section]}
            defaultOpenKeys={[]}
            expandIcon={({ isOpen }) => (
              <DownOutlined
                style={{
                  fontSize: 11,
                  color: isDark ? "#a3aab6" : "#8c8c8c",
                  transform: isOpen ? "rotate(180deg)" : "none",
                  transition: "transform 0.15s ease",
                }}
              />
            )}
            onClick={(e) => {
              const key = String(e.key);
              if (key === "reports-group") return;
              navigateToSection(key as SectionKey);
            }}
            items={[
              { key: "line", label: "Загрузка сканов", icon: <QrcodeOutlined />, className: "menu-item-upload" },
              { type: "divider" },
              { key: "registry", label: "Инвентарь лоскутов", icon: <HddOutlined /> },
              { key: "history", label: "История размещений", icon: <NodeIndexOutlined /> },
              {
                key: "reports-group",
                label: "Отчёты",
                icon: <AuditOutlined />,
                children: [
                  { key: "reports", label: "Сводка" },
                  { key: "reports-pick", label: "Ведомость отбора" },
                  { key: "reports-trace", label: "Трассируемость" },
                ],
              },
            ]}
          />
          <div className="sidebar-footer">
            <a
              className="sidebar-aux-link"
              href="/qr-generator/index.html?mode=single"
              target="_blank"
              rel="noreferrer"
            >
              QR-генератор
            </a>
            <div className="sidebar-version">{`v${appVersion}`}</div>
          </div>
        </aside>

        <main className="unified-main">
          <div className="unified-topbar">
            <div className="unified-section-title">{sectionLabel}</div>
            <div className="unified-topbar-right">
              <div className="unified-topbar-status" title={topbarStatus || undefined}>
                {topbarStatus}
              </div>
            </div>
          </div>

          <div className="unified-content">
              {section === "registry" ? (
                <div className="section-view">
                  <RegistryScreen
                    onLoadInfoChange={setTopbarStatus}
                    onOpenPiece={(id) => navigateToSection("card", id)}
                  />
                </div>
              ) : null}
              {section === "card" ? (
                <div className="section-view">
                  <PieceCardScreen pieceId={activePieceId} onLoadInfoChange={setTopbarStatus} />
                </div>
              ) : null}
              {section === "history" ? (
                <div className="section-view">
                  <PieceHistoryScreen onLoadInfoChange={setTopbarStatus} />
                </div>
              ) : null}
              {section === "reports" || section === "reports-pick" || section === "reports-trace" ? (
                <div className="section-view">
                  <ReportsScreen
                    mode={section === "reports-pick" ? "picklist" : section === "reports-trace" ? "traceability" : "summary"}
                    onLoadInfoChange={setTopbarStatus}
                  />
                </div>
              ) : null}
              {section === "line" ? (
                <div className="section-view">
                  <LineDirectionScreen />
                </div>
              ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}

export function AppWithProviders() {
  const isDark = false;

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      }}
    >
      <App isDark={isDark} />
    </ConfigProvider>
  );
}
