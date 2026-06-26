// FurLab pure utility functions — no state, no DOM
// Exposes window.FurLabUtils
(function (global) {

  // ---------------------------------------------------------------------------
  // String / number utils
  // ---------------------------------------------------------------------------

  function parseLocaleNumber(v, fallback) {
    if (fallback === undefined) fallback = null;
    if (v === null || v === undefined) return fallback;
    if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
    const s = String(v).trim().replace(",", ".");
    if (!s) return fallback;
    const n = Number(s);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeDeg(v, fallback) {
    if (fallback === undefined) fallback = 90;
    const n = parseLocaleNumber(v, fallback);
    if (!Number.isFinite(n)) return Number(fallback);
    return ((n % 360) + 360) % 360;
  }

  function safeText(v) { return v === null || v === undefined ? "" : String(v); }

  function escapeHtml(v) {
    return String(v === null || v === undefined ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeCsv(value) {
    const s = String(value === null || value === undefined ? "" : value);
    if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function napSymbolByDeg(deg) {
    const d = (((Number(deg) || 0) % 360) + 360) % 360;
    if (d >= 337.5 || d < 22.5) return "↑";
    if (d < 67.5) return "↗";
    if (d < 112.5) return "→";
    if (d < 157.5) return "↘";
    if (d < 202.5) return "↓";
    if (d < 247.5) return "↙";
    if (d < 292.5) return "←";
    return "↖";
  }

  function finiteNumOrNaN(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }

  // ---------------------------------------------------------------------------
  // Geometry — point / polygon
  // ---------------------------------------------------------------------------

  function distance2(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y, xj = polygon[j].x, yj = polygon[j].y;
      const intersect = ((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function dist2PointToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return distance2(p, a);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: a.x + t * dx, y: a.y + t * dy };
    return distance2(p, proj);
  }

  function segmentIntersectionGlobal(a, b, c, d) {
    function orient(p, q, r) {
      return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    }
    function onSeg(p, q, r) {
      return Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x) &&
        Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);
    }
    const o1 = orient(a, b, c);
    const o2 = orient(a, b, d);
    const o3 = orient(c, d, a);
    const o4 = orient(c, d, b);
    if ((o1 > 0 && o2 < 0 || o1 < 0 && o2 > 0) && (o3 > 0 && o4 < 0 || o3 < 0 && o4 > 0)) return true;
    if (o1 === 0 && onSeg(a, c, b)) return true;
    if (o2 === 0 && onSeg(a, d, b)) return true;
    if (o3 === 0 && onSeg(c, a, d)) return true;
    if (o4 === 0 && onSeg(c, b, d)) return true;
    return false;
  }

  function buildRectZonePoints(a, b) {
    return [
      { x: a.x, y: a.y },
      { x: b.x, y: a.y },
      { x: b.x, y: b.y },
      { x: a.x, y: b.y }
    ];
  }

  function buildEllipseZonePoints(a, b, segments) {
    if (segments === undefined) segments = 32;
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const rx = Math.abs(b.x - a.x) / 2;
    const ry = Math.abs(b.y - a.y) / 2;
    const pts = [];
    for (let i = 0; i < segments; i++) {
      const angle = (2 * Math.PI * i) / segments;
      pts.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
    }
    return pts;
  }

  function smoothZoneVertexPoints(points, vertexIndex, strength) {
    if (strength === undefined) strength = 0.22;
    const pts = Array.isArray(points) ? points.map((p) => ({ x: Number(p.x), y: Number(p.y) })) : [];
    if (pts.length < 3) return null;
    const n = pts.length;
    const idx = ((Number(vertexIndex) % n) + n) % n;
    const prev = pts[(idx - 1 + n) % n];
    const curr = pts[idx];
    const next = pts[(idx + 1) % n];
    const lenPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const lenNext = Math.hypot(next.x - curr.x, next.y - curr.y);
    const usable = Math.min(lenPrev, lenNext);
    if (!Number.isFinite(usable) || usable <= 2) return null;
    const offset = Math.max(1.5, Math.min(usable * Math.max(0.08, Math.min(0.45, Number(strength) || 0.22)), usable * 0.45));
    if (offset <= 0.5) return null;
    const uxPrev = (prev.x - curr.x) / (lenPrev || 1);
    const uyPrev = (prev.y - curr.y) / (lenPrev || 1);
    const uxNext = (next.x - curr.x) / (lenNext || 1);
    const uyNext = (next.y - curr.y) / (lenNext || 1);
    const pIn = { x: curr.x + uxPrev * offset, y: curr.y + uyPrev * offset };
    const pOut = { x: curr.x + uxNext * offset, y: curr.y + uyNext * offset };
    const quad = (t) => {
      const mt = 1 - t;
      return {
        x: mt * mt * pIn.x + 2 * mt * t * curr.x + t * t * pOut.x,
        y: mt * mt * pIn.y + 2 * mt * t * curr.y + t * t * pOut.y
      };
    };
    const replacement = [pIn, quad(0.25), quad(0.5), quad(0.75), pOut];
    const out = [];
    for (let i = 0; i < n; i++) {
      if (i === idx) {
        replacement.forEach((p) => out.push({ x: p.x, y: p.y }));
      } else {
        out.push({ x: pts[i].x, y: pts[i].y });
      }
    }
    return out;
  }

  function getZoneBounds(points) {
    const pts = Array.isArray(points) ? points : [];
    if (!pts.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  function getZoneCenterPoint(zone) {
    const pts = Array.isArray(zone && zone.points) ? zone.points : [];
    if (!pts.length) return null;
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; }
    return { x: sx / pts.length, y: sy / pts.length };
  }

  // ---------------------------------------------------------------------------
  // Contour normalization
  // ---------------------------------------------------------------------------

  function normalizeContourArray(raw) {
    if (!raw) return null;
    const pts = [];
    const push = (x, y) => {
      const xn = Number(x);
      const yn = Number(y);
      if (!Number.isFinite(xn) || !Number.isFinite(yn)) return;
      pts.push({ x: xn, y: yn });
    };
    const walk = (node) => {
      if (!node) return;
      if (Array.isArray(node)) {
        if (node.length >= 2 && Number.isFinite(Number(node[0])) && Number.isFinite(Number(node[1]))) {
          push(node[0], node[1]);
          return;
        }
        for (const child of node) walk(child);
        return;
      }
      if (typeof node === "object" && node.x !== undefined && node.y !== undefined) {
        push(node.x, node.y);
      }
    };
    walk(raw);
    return pts.length >= 3 ? pts : null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  global.FurLabUtils = {
    parseLocaleNumber,
    normalizeDeg,
    safeText,
    escapeHtml,
    escapeCsv,
    napSymbolByDeg,
    finiteNumOrNaN,
    distance2,
    pointInPolygon,
    dist2PointToSegment,
    segmentIntersectionGlobal,
    buildRectZonePoints,
    buildEllipseZonePoints,
    smoothZoneVertexPoints,
    getZoneBounds,
    getZoneCenterPoint,
    normalizeContourArray,
  };

})(window);
