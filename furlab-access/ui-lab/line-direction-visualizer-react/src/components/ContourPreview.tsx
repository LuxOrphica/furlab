import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Checkbox, Slider, Space, Spin, Typography } from "antd";
import { getPreferredApiBase } from "../core/api";

export type PreviewMode = "ScanA3" | "Scan";

type Pt = { x: number; y: number };

type ContourPreviewProps = {
  contourJson: string | null | undefined;
  mirrorForLayout?: boolean;
  sourceImageRef?: string | null;
  napDirectionDeg: number | null | undefined;
  napDirectionDegRaw?: number | null | undefined;
  areaMm2: number | null | undefined;
  maxSpanMm: number | null | undefined;
  mode: PreviewMode;
  normalize: boolean;
  showSummary?: boolean;
  loading?: boolean;
  onPerfMeasured?: (payload: { parseMs: number; drawMs: number }) => void;
};

type ParsedContour = {
  units: string;
  points: Pt[];
};

function rotatePoints(points: Pt[], deg: number): Pt[] {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return points.map((p) => ({
    x: p.x * c - p.y * s,
    y: p.x * s + p.y * c,
  }));
}

function mirrorPointsVertical(points: Pt[]): Pt[] {
  if (!Array.isArray(points) || points.length < 1) return [];
  const b = getBounds(points);
  const cx = (b.minX + b.maxX) * 0.5;
  return points.map((p) => ({ x: 2 * cx - p.x, y: p.y }));
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
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function normalizeSignedDeg(deg: number): number {
  const v = ((deg + 180) % 360 + 360) % 360 - 180;
  return v === -180 ? 180 : v;
}

function normalizeDeg360(deg: number): number {
  let out = deg % 360;
  if (out < 0) out += 360;
  return out;
}

function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs(normalizeDeg360(a) - normalizeDeg360(b));
  return d > 180 ? 360 - d : d;
}

function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(rawStep));
  const n = rawStep / p;
  if (n <= 1) return 1 * p;
  if (n <= 2) return 2 * p;
  if (n <= 5) return 5 * p;
  return 10 * p;
}

export default function ContourPreview({
  contourJson,
  mirrorForLayout = false,
  sourceImageRef,
  napDirectionDeg,
  napDirectionDegRaw,
  areaMm2,
  maxSpanMm,
  mode,
  normalize,
  showSummary = true,
  loading = false,
  onPerfMeasured,
}: ContourPreviewProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [showBounds, setShowBounds] = useState(false);
  const [showScanContour, setShowScanContour] = useState(true);
  const [showMirrorContour, setShowMirrorContour] = useState(true);
  const [showNormContour, setShowNormContour] = useState(true);
  const [scanZoomPct, setScanZoomPct] = useState(100);
  const [viewport, setViewport] = useState({ w: 920, h: 620 });
  const perfCbRef = useRef<typeof onPerfMeasured>(onPerfMeasured);
  useEffect(() => {
    perfCbRef.current = onPerfMeasured;
  }, [onPerfMeasured]);
  const parsedInfo = useMemo(() => {
    if (!contourJson) return { parsed: null as ParsedContour | null, parseMs: 0 };
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const parsed = JSON.parse(contourJson) as { units?: string; path?: Array<{ x?: number; y?: number }> };
      const path = Array.isArray(parsed?.path) ? parsed.path : [];
      const points = path
        .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (points.length < 3) return { parsed: null as ParsedContour | null, parseMs: Math.max(0, Math.round(t1 - t0)) };
      return {
        parsed: { units: String(parsed?.units || "mm"), points },
        parseMs: Math.max(0, Math.round(t1 - t0)),
      };
    } catch {
      const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
      return { parsed: null as ParsedContour | null, parseMs: Math.max(0, Math.round(t1 - t0)) };
    }
  }, [contourJson]);
  const parsed = parsedInfo.parsed;
  const parseMs = parsedInfo.parseMs;
  const sourceImageUrl = useMemo(() => {
    const raw = String(sourceImageRef || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^(s3|file):\/\//i.test(raw)) return "";
    const path = raw.startsWith("/") ? raw : `/${raw}`;
    return `${getPreferredApiBase()}${path}`;
  }, [sourceImageRef]);
  const isDark =
    typeof document !== "undefined" &&
    document.querySelector(".unified-shell-root")?.getAttribute("data-theme") === "dark";
  const palette = useMemo(() => ({
    canvasBg: isDark ? "#1f232a" : "#f7f8fa",
    textMuted: isDark ? "#a3aab6" : "#6b7280",
    textAxis: isDark ? "#c7ced9" : "#4b5563",
    gridMinor: isDark ? "#2d3440" : "#eceff3",
    gridMajor: isDark ? "#3a4250" : "#d9dee6",
    frame: isDark ? "#566074" : "#9ca3af",
    normLine: isDark ? "#e5e7eb" : "#1f2937",
    // Monochrome style for all overlays.
    scanLine: isDark ? "rgba(203, 213, 225, 0.9)" : "rgba(31, 41, 55, 0.45)",
    auxLine: isDark ? "rgba(148, 163, 184, 0.85)" : "rgba(75, 85, 99, 0.72)",
    rotArc: isDark ? "rgba(229, 231, 235, 0.62)" : "rgba(31, 41, 55, 0.5)",
  }), [isDark]);

  const rotationDeg = useMemo(() => {
    if (!normalize || !Number.isFinite(Number(napDirectionDeg))) return 0;
    return 90 - Number(napDirectionDeg);
  }, [normalize, napDirectionDeg]);
  const validatedRawNapDeg = useMemo(() => {
    const raw = Number(napDirectionDegRaw);
    if (!Number.isFinite(raw)) return null;
    const canonical = Number(napDirectionDeg);
    if (!Number.isFinite(canonical)) return normalizeDeg360(raw);
    const expectedCanonical = mirrorForLayout
      ? normalizeDeg360(180 - raw)
      : normalizeDeg360(raw);
    // Guard against stale/corrupted historical raw angle.
    // If raw disagrees with canonical too much, trust canonical and hide raw-derived arc.
    if (angleDiffDeg(expectedCanonical, canonical) > 20) return null;
    return normalizeDeg360(raw);
  }, [mirrorForLayout, napDirectionDeg, napDirectionDegRaw]);
  const hasRawNapDeg = validatedRawNapDeg !== null;
  const scanNapDeg = useMemo(() => {
    return validatedRawNapDeg;
  }, [validatedRawNapDeg]);
  const singleViewNapDeg = useMemo(() => {
    if (scanNapDeg !== null) return scanNapDeg;
    const canonical = Number(napDirectionDeg);
    return Number.isFinite(canonical) ? normalizeDeg360(canonical) : null;
  }, [napDirectionDeg, scanNapDeg]);

  const pointsView = useMemo(() => {
    if (!parsed) return [];
    let pts = parsed.points;
    if (normalize && mirrorForLayout) {
      pts = mirrorPointsVertical(pts);
    }
    return rotationDeg !== 0 ? rotatePoints(pts, rotationDeg) : pts;
  }, [mirrorForLayout, normalize, parsed, rotationDeg]);

  const rawBounds = useMemo(() => (parsed ? getBounds(parsed.points) : null), [parsed]);
  const scanOverlayPoints = useMemo(() => {
    if (!parsed) return [];
    if (normalize && mirrorForLayout) return mirrorPointsVertical(parsed.points);
    return parsed.points;
  }, [mirrorForLayout, normalize, parsed]);
  const viewBounds = useMemo(() => (pointsView.length ? getBounds(pointsView) : null), [pointsView]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const baseW = 920;
    const baseH = 620;
    const ratio = mode === "ScanA3" ? (420 / 297) : (baseW / baseH);
    let raf = 0;
    const applySize = () => {
      const w = Math.max(320, Math.floor(wrap.clientWidth));
      const h = Math.max(220, Math.floor(w / ratio) - 100);
      setViewport((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    applySize();
    const scheduleApply = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        applySize();
      });
    };
    const ro = new ResizeObserver(() => scheduleApply());
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [mode]);

  // Derive effective zoom inline so mode changes don't create an extra render cycle.
  const effectiveScanZoomPct = mode === "Scan" ? scanZoomPct : 100;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const viewCtx = canvas.getContext("2d");
    if (!viewCtx) return;

    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const width = viewport.w;
    const height = viewport.h;
    const bw = Math.max(1, Math.floor(width * dpr));
    const bh = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const back = document.createElement("canvas");
    back.width = bw;
    back.height = bh;
    const ctx = back.getContext("2d");
    if (!ctx) return;

    const commit = () => {
      viewCtx.setTransform(1, 0, 0, 1, 0, 0);
      viewCtx.clearRect(0, 0, bw, bh);
      viewCtx.drawImage(back, 0, 0);
    };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = palette.canvasBg;
    ctx.fillRect(0, 0, width, height);

    const drawStart = typeof performance !== "undefined" ? performance.now() : Date.now();
    const emitPerf = () => {
      const drawEnd = typeof performance !== "undefined" ? performance.now() : Date.now();
      perfCbRef.current?.({ parseMs, drawMs: Math.max(0, Math.round(drawEnd - drawStart)) });
    };

    if (mode === "Scan") {
      const drawCenteredMessage = (text: string) => {
        ctx.save();
        ctx.fillStyle = palette.textMuted;
        ctx.font = "14px 'Segoe UI', Tahoma, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, width * 0.5, height * 0.5);
        ctx.restore();
      };
      const drawImageOnly = () => {
        if (!sourceImageUrl) {
          drawCenteredMessage("Источник скана не задан");
          commit();
          emitPerf();
          return;
        }
        const img = new Image();
        img.onload = () => {
          const pad = 20;
          const fitW = width - pad * 2;
          const fitH = height - pad * 2;
          const baseK = Math.min(fitW / Math.max(1, img.naturalWidth), fitH / Math.max(1, img.naturalHeight));
          const k = baseK * (effectiveScanZoomPct / 100);
          const dw = img.naturalWidth * k;
          const dh = img.naturalHeight * k;
          const dx = (width - dw) * 0.5;
          const dy = (height - dh) * 0.5;
          ctx.drawImage(img, dx, dy, dw, dh);
          commit();
          emitPerf();
        };
        img.onerror = () => {
          drawCenteredMessage("Не удалось загрузить скан");
          commit();
          emitPerf();
        };
        img.src = sourceImageUrl;
      };

      drawImageOnly();
      return;
    }

    if (!viewBounds || pointsView.length < 3) {
      ctx.save();
      ctx.fillStyle = palette.textMuted;
      ctx.font = "14px 'Segoe UI', Tahoma, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Контур недоступен", width * 0.5, height * 0.5);
      ctx.restore();
      commit();
      emitPerf();
      return;
    }

    const pad = mode === "ScanA3" ? 38 : 28;
    const drawW = width - pad * 2;
    const drawH = height - pad * 2;

    const isA3 = mode === "ScanA3";
    let domainW = isA3 ? 420 : Math.max(viewBounds.w, 1);
    let domainH = isA3 ? 297 : Math.max(viewBounds.h, 1);
    if (!isA3) {
      domainW = Math.max(domainW, 420);
      domainH = Math.max(domainH, 297);
    }

    // In A3 mode, keep 1:1 mm mapping stable. Normalization must rotate/translate only,
    // not auto-rescale geometry to fit the sheet.
    const shapeFit = 1;

    const baseScale = Math.min(drawW / domainW, drawH / domainH);
    // Keep A3 frame stable, but render about 5% larger than previous tuned value.
    const scale = baseScale;
    const ox = (width - domainW * scale) * 0.5;
    const oy = (height - domainH * scale) * 0.5;

    const viewScaledW = viewBounds.w * shapeFit;
    const viewScaledH = viewBounds.h * shapeFit;
    const centerOffsetX = (domainW - viewScaledW) * 0.5;
    const centerOffsetY = (domainH - viewScaledH) * 0.5;
    const tx = (x: number) => ox + (centerOffsetX + (x - viewBounds.minX) * shapeFit) * scale;
    const ty = (y: number) => oy + (centerOffsetY + (y - viewBounds.minY) * shapeFit) * scale;

    const drawGridW = domainW * scale;
    const drawGridH = domainH * scale;

    if (showGrid) {
      const majorTargetPx = 82;
      const majorStepMm = niceStep(majorTargetPx / Math.max(scale, 1e-6));
      const minorStepMm = majorStepMm / 5;
      const showMinor = minorStepMm * scale >= 10;
      const showLabels = majorStepMm * scale >= 28;

      const drawLocalGridLines = (stepMm: number, color: string, lineWidth: number) => {
        if (!Number.isFinite(stepMm) || stepMm <= 0) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        for (let x = 0; x <= domainW + stepMm * 0.5; x += stepMm) {
          const gx = ox + x * scale;
          ctx.beginPath();
          ctx.moveTo(gx, oy);
          ctx.lineTo(gx, oy + drawGridH);
          ctx.stroke();
        }
        for (let y = 0; y <= domainH + stepMm * 0.5; y += stepMm) {
          const gy = oy + y * scale;
          ctx.beginPath();
          ctx.moveTo(ox, gy);
          ctx.lineTo(ox + drawGridW, gy);
          ctx.stroke();
        }
      };

      if (showMinor) drawLocalGridLines(minorStepMm, palette.gridMinor, 1);
      drawLocalGridLines(majorStepMm, palette.gridMajor, 1.15);

      if (showLabels) {
        ctx.save();
        ctx.fillStyle = palette.textMuted;
        ctx.font = "11px 'Segoe UI', Tahoma, sans-serif";
        ctx.textBaseline = "middle";

        for (let x = 0; x <= domainW + majorStepMm * 0.5; x += majorStepMm) {
          const gx = ox + x * scale;
          ctx.textAlign = "center";
          ctx.fillText(`${Math.round(x)}`, gx, oy - 10);
        }
        for (let y = 0; y <= domainH + majorStepMm * 0.5; y += majorStepMm) {
          if (Math.round(y) === 0) continue;
          const gy = oy + y * scale;
          ctx.textAlign = "right";
          ctx.fillText(`${Math.round(y)}`, ox - 8, gy);
        }
        ctx.fillStyle = palette.textAxis;
        ctx.textAlign = "left";
        ctx.fillText("X, мм", ox + drawGridW + 8, oy - 10);
        ctx.fillText("Y, мм", ox - 2, oy + drawGridH + 14);
        ctx.restore();
      }
    }

    ctx.strokeStyle = palette.frame;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(ox, oy, domainW * scale, domainH * scale);

    const lineColor = palette.normLine;
    const scanColor = palette.scanLine;
    const lineWidth = 2.2;
    const thinLineWidth = 1.25;
    const dashedLineWidth = 1.25;
    const dashedPattern: number[] = [1.25, 2.5];

    if (normalize && parsed?.points?.length) {
      const sourceScanPoints = parsed.points;
      const mirroredScanPoints = scanOverlayPoints;
      const rawB = getBounds(sourceScanPoints);
      const rawScaledW = rawB.w * shapeFit;
      const rawScaledH = rawB.h * shapeFit;
      const rawCenterOffsetX = (domainW - rawScaledW) * 0.5;
      const rawCenterOffsetY = (domainH - rawScaledH) * 0.5;
      const rawTx = (x: number) => ox + (rawCenterOffsetX + (x - rawB.minX) * shapeFit) * scale;
      const rawTy = (y: number) => oy + (rawCenterOffsetY + (y - rawB.minY) * shapeFit) * scale;

      const drawOverlayContour = (pts: Pt[], dash: number[], width: number) => {
        if (!pts.length) return;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 1) {
          const p = pts[i];
          const px = rawTx(p.x);
          const py = rawTy(p.y);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.setLineDash(dash);
        ctx.lineWidth = width;
        ctx.stroke();
      };

      ctx.save();
      ctx.strokeStyle = scanColor;
      // 1) Original scan contour (dashed).
      if (showScanContour) drawOverlayContour(sourceScanPoints, dashedPattern, dashedLineWidth);
      // 2) Mirrored scan contour (solid).
      if (showMirrorContour) drawOverlayContour(mirroredScanPoints, [], thinLineWidth);
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (normalize && !parsed?.points?.length && scanOverlayPoints.length) {
      const rawB = getBounds(scanOverlayPoints);
      const rawScaledW = rawB.w * shapeFit;
      const rawScaledH = rawB.h * shapeFit;
      const rawCenterOffsetX = (domainW - rawScaledW) * 0.5;
      const rawCenterOffsetY = (domainH - rawScaledH) * 0.5;
      const rawTx = (x: number) => ox + (rawCenterOffsetX + (x - rawB.minX) * shapeFit) * scale;
      const rawTy = (y: number) => oy + (rawCenterOffsetY + (y - rawB.minY) * shapeFit) * scale;
      ctx.save();
      ctx.strokeStyle = scanColor;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (let i = 0; i < scanOverlayPoints.length; i += 1) {
        const p = scanOverlayPoints[i];
        const px = rawTx(p.x);
        const py = rawTy(p.y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.setLineDash([1.2, 4.2]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (showNormContour) {
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash([]);
      ctx.beginPath();
      for (let i = 0; i < pointsView.length; i += 1) {
        const p = pointsView[i];
        const px = tx(p.x);
        const py = ty(p.y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    if (showBounds) {
      const bx = ox + centerOffsetX * scale;
      const by = oy + centerOffsetY * scale;
      const bw = viewScaledW * scale;
      const bh = viewScaledH * scale;
      ctx.save();
      ctx.strokeStyle = palette.auxLine;
      ctx.setLineDash([]);
      ctx.lineWidth = 1.25;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.fillStyle = palette.auxLine;
      ctx.font = "12px 'Segoe UI', Tahoma, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`Габариты: ${viewBounds.w.toFixed(1)} x ${viewBounds.h.toFixed(1)} мм`, bx + 4, by - 6);
      ctx.restore();
    }

    if (singleViewNapDeg !== null || (normalize && scanNapDeg !== null)) {
      const cx = tx((viewBounds.minX + viewBounds.maxX) / 2);
      const cy = ty((viewBounds.minY + viewBounds.maxY) / 2);
      const len = 62;

      const drawArrow = (
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        color: string,
        dash: number[] = [],
        width = lineWidth
      ) => {
        const ang = Math.atan2(y1 - y0, x1 - x0);
        const ah = 10;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(dash);

        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 + Math.cos(ang + Math.PI * 0.85) * ah, y1 + Math.sin(ang + Math.PI * 0.85) * ah);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 + Math.cos(ang - Math.PI * 0.85) * ah, y1 + Math.sin(ang - Math.PI * 0.85) * ah);
        ctx.stroke();
        ctx.restore();
      };

      if (normalize) {
        const scanDegForDraw = scanNapDeg !== null ? scanNapDeg : singleViewNapDeg;
        if (scanDegForDraw !== null) {
          // Source scan arrow: dashed.
          const rawAngle = (scanDegForDraw * Math.PI) / 180;
          const vxRaw = Math.cos(rawAngle);
          const vyRaw = Math.sin(rawAngle);
          if (showScanContour) {
            drawArrow(cx, cy, cx + vxRaw * len, cy + vyRaw * len, scanColor, dashedPattern, dashedLineWidth);
          }
          // Mirrored scan arrow: dotted.
          if (mirrorForLayout) {
            const mirroredScanDeg = normalizeDeg360(180 - scanDegForDraw);
            const mirroredAngle = (mirroredScanDeg * Math.PI) / 180;
            const vxMirr = Math.cos(mirroredAngle);
            const vyMirr = Math.sin(mirroredAngle);
            if (showMirrorContour) {
              drawArrow(cx, cy, cx + vxMirr * len, cy + vyMirr * len, scanColor, [], thinLineWidth);
            }
          }
        }
      } else if (singleViewNapDeg !== null) {
        const rawAngle = (singleViewNapDeg * Math.PI) / 180;
        const vxRaw = Math.cos(rawAngle);
        const vyRaw = Math.sin(rawAngle);
        drawArrow(cx, cy, cx + vxRaw * len, cy + vyRaw * len, lineColor);
      }
      if (normalize && showNormContour) drawArrow(cx, cy, cx, cy + len, lineColor);

      const showRotationArc = normalize && showNormContour && showMirrorContour;
      if (showRotationArc) {
        const signedRotationDeg = normalizeSignedDeg(rotationDeg);
        const sign = signedRotationDeg >= 0 ? 1 : -1;
        const visualSweepDeg = Math.abs(signedRotationDeg);
      if (visualSweepDeg < 0.1) {
        commit();
        emitPerf();
        return;
      }
        const visualSweepRad = (visualSweepDeg * Math.PI) / 180;
        const targetAngle = Math.PI / 2;
        const startAngle = targetAngle - sign * visualSweepRad;
        const radius = Math.max(34, Math.min(58, len * 0.62));

        ctx.save();
        ctx.strokeStyle = palette.rotArc;
        ctx.fillStyle = palette.rotArc;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAngle, targetAngle, sign < 0);
        ctx.stroke();

        const ex = cx + Math.cos(targetAngle) * radius;
        const ey = cy + Math.sin(targetAngle) * radius;
        const tangent = targetAngle + (sign > 0 ? Math.PI / 2 : -Math.PI / 2);
        const ah = 6;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(tangent - 0.45) * ah, ey - Math.sin(tangent - 0.45) * ah);
        ctx.lineTo(ex - Math.cos(tangent + 0.45) * ah, ey - Math.sin(tangent + 0.45) * ah);
        ctx.closePath();
        ctx.fill();

        const midAngle = targetAngle - sign * visualSweepRad * 0.5;
        const lx = cx + Math.cos(midAngle) * (radius + 14);
        const ly = cy + Math.sin(midAngle) * (radius + 14);
        const signedText = `${signedRotationDeg >= 0 ? "+" : ""}${signedRotationDeg.toFixed(1)}°`;
        ctx.font = "12px 'Segoe UI', Tahoma, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(signedText, lx, ly);
        ctx.restore();
      }
    }
    commit();
    emitPerf();
  }, [hasRawNapDeg, mirrorForLayout, mode, napDirectionDeg, normalize, palette, parseMs, parsed, pointsView, rotationDeg, scanNapDeg, scanOverlayPoints, effectiveScanZoomPct, showBounds, showGrid, showMirrorContour, showNormContour, showScanContour, sourceImageUrl, viewBounds, viewport]);

  const overlayNode = mode === "ScanA3" ? (
    <>
      <div className="contour-overlay-panel contour-overlay-top contour-overlay-controls">
        <div className="contour-overlay-options contour-overlay-options-row">
          <Checkbox checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)}>
            Сетка
          </Checkbox>
          {mode === "ScanA3" ? (
            <Checkbox checked={showBounds} onChange={(e) => setShowBounds(e.target.checked)}>
              Габариты
            </Checkbox>
          ) : null}
        </div>
      </div>
      {normalize ? (
        <div className="contour-overlay-panel contour-overlay-top contour-overlay-legend">
          <button type="button" className={`contour-legend-item contour-legend-toggle${showScanContour ? " is-on" : ""}`} onClick={() => setShowScanContour((v) => !v)}>
            <span className="contour-legend-line contour-legend-line-scan" />
            <span>leather_up (скан)</span>
            <span className="contour-legend-check">{showScanContour ? "✓" : ""}</span>
          </button>
          <button type="button" className={`contour-legend-item contour-legend-toggle${showMirrorContour ? " is-on" : ""}`} onClick={() => setShowMirrorContour((v) => !v)}>
            <span className="contour-legend-line contour-legend-line-mirror" />
            <span>fur_up (зеркало)</span>
            <span className="contour-legend-check">{showMirrorContour ? "✓" : ""}</span>
          </button>
          <button type="button" className={`contour-legend-item contour-legend-toggle${showNormContour ? " is-on" : ""}`} onClick={() => setShowNormContour((v) => !v)}>
            <span className="contour-legend-line contour-legend-line-norm" />
            <span>fur_up ↓ (норм.)</span>
            <span className="contour-legend-check">{showNormContour ? "✓" : ""}</span>
          </button>
        </div>
      ) : null}
    </>
  ) : null;
  const zoomNode = mode === "Scan" ? (
    <div className="contour-overlay-zoom">
      <Button size="small" onClick={() => setScanZoomPct((v) => Math.min(300, v + 10))}>+</Button>
      <Slider
        className="contour-zoom-slider"
        vertical
        min={50}
        max={300}
        step={10}
        value={scanZoomPct}
        onChange={(v) => setScanZoomPct(Number(Array.isArray(v) ? v[0] : v))}
      />
      <Button size="small" onClick={() => setScanZoomPct((v) => Math.max(50, v - 10))}>-</Button>
      <span className="contour-zoom-value">{scanZoomPct}%</span>
    </div>
  ) : null;

  return (
    <div className={showSummary ? "contour-preview-layout" : "contour-preview-layout contour-preview-compact"}>
      <div className="contour-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} />
        {overlayNode}
        {zoomNode}
        {loading ? (
          <div className="contour-loading-overlay">
            <Spin size="small" />
            <span>Загрузка контура...</span>
          </div>
        ) : null}
      </div>
      {showSummary && parsed && viewBounds && rawBounds ? (
        <Card size="small" className="contour-summary-card" title="Contour Summary">
          <Space direction="vertical" size={6}>
            <Typography.Text>Mode: {mode}{normalize ? " (normalized view)" : ""}</Typography.Text>
            <Typography.Text>
              Bounds (view): {viewBounds.w.toFixed(1)} x {viewBounds.h.toFixed(1)} {parsed.units}
            </Typography.Text>
            <Typography.Text>
              Bounds (raw): {rawBounds.w.toFixed(1)} x {rawBounds.h.toFixed(1)} {parsed.units}
            </Typography.Text>
            <Typography.Text>
              Area: {Number.isFinite(Number(areaMm2)) ? Number(areaMm2).toFixed(1) : "-"} mm²
            </Typography.Text>
            <Typography.Text>
              Max span: {Number.isFinite(Number(maxSpanMm)) ? Number(maxSpanMm).toFixed(1) : "-"} mm
            </Typography.Text>
            <Typography.Text>
              Nap angle (scan): {scanNapDeg !== null ? scanNapDeg.toFixed(1) : "-"} deg
            </Typography.Text>
            <Typography.Text>View rotation: {rotationDeg.toFixed(1)} deg</Typography.Text>
            <Typography.Text>Contour points: {parsed.points.length}</Typography.Text>
          </Space>
        </Card>
      ) : null}
    </div>
  );
}


