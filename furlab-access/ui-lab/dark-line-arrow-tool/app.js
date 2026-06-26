const fileInput = document.getElementById("fileInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const contourBtn = document.getElementById("contourBtn");
const statusEl = document.getElementById("status");
const darkPercentInput = document.getElementById("darkPercent");
const darkPercentValue = document.getElementById("darkPercentValue");
const maskValMinInput = document.getElementById("maskValMin");
const maskValMinValue = document.getElementById("maskValMinValue");
const maskValMaxInput = document.getElementById("maskValMax");
const maskValMaxValue = document.getElementById("maskValMaxValue");
const maskSatMaxInput = document.getElementById("maskSatMax");
const maskSatMaxValue = document.getElementById("maskSatMaxValue");
const maskColorDistInput = document.getElementById("maskColorDist");
const maskColorDistValue = document.getElementById("maskColorDistValue");
const maskInsetMmInput = document.getElementById("maskInsetMm");
const maskInsetMmValue = document.getElementById("maskInsetMmValue");
const antiFurInput = document.getElementById("antiFur");
const antiFurValue = document.getElementById("antiFurValue");

const sourceCanvas = document.getElementById("sourceCanvas");
const resultCanvas = document.getElementById("resultCanvas");
const sourceCtx = sourceCanvas.getContext("2d");
const resultCtx = resultCanvas.getContext("2d");

let loadedImage = null;
let lastState = null;
const STICKER_WIDTH_MM = 22;

const setStatus = (text) => {
  statusEl.textContent = text;
};

const updateLabels = () => {
  darkPercentValue.textContent = `${darkPercentInput.value}%`;
  maskValMinValue.textContent = `${maskValMinInput.value}`;
  maskValMaxValue.textContent = `${maskValMaxInput.value}`;
  maskSatMaxValue.textContent = `${maskSatMaxInput.value}%`;
  maskColorDistValue.textContent = `${maskColorDistInput.value}`;
  maskInsetMmValue.textContent = `${Number(maskInsetMmInput.value).toFixed(1)}`;
  antiFurValue.textContent = `${antiFurInput.value}%`;
};

const fitCanvases = (w, h) => {
  sourceCanvas.width = w;
  sourceCanvas.height = h;
  resultCanvas.width = w;
  resultCanvas.height = h;

  const maxSide = Math.max(w, h);
  const previewTarget = 260;
  const scale = Math.max(0.33, Math.min(1.15, previewTarget / Math.max(1, maxSide)));
  const displayW = Math.round(w * scale);
  const displayH = Math.round(h * scale);

  sourceCanvas.style.width = `${displayW}px`;
  sourceCanvas.style.height = `${displayH}px`;
  resultCanvas.style.width = `${displayW}px`;
  resultCanvas.style.height = `${displayH}px`;
};

const percentile = (arr, q) => {
  const sorted = Array.from(arr);
  sorted.sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * q)));
  return sorted[idx];
};

const drawArrow = (ctx, start, end) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 6) return;

  const ux = dx / len;
  const uy = dy / len;
  const head = Math.max(10, Math.min(26, len * 0.22));

  ctx.save();
  ctx.strokeStyle = "#e53935";
  ctx.fillStyle = "#e53935";
  ctx.lineWidth = Math.max(2, Math.min(5, len * 0.11));
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  const hx = end.x;
  const hy = end.y;
  const lx = hx - ux * head - uy * head * 0.55;
  const ly = hy - uy * head + ux * head * 0.55;
  const rx = hx - ux * head + uy * head * 0.55;
  const ry = hy - uy * head - ux * head * 0.55;

  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(lx, ly);
  ctx.lineTo(rx, ry);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const eigFromCov = (cxx, cyy, cxy) => {
  const tr = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = tr / 2 - disc;
  const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  return { l1, l2, angle };
};

const collectComponents = (mask, w, h) => {
  const size = w * h;
  const visited = new Uint8Array(size);
  const offsets = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],           [1, 0],
    [-1, 1],  [0, 1],  [1, 1],
  ];

  const components = [];

  for (let i = 0; i < size; i += 1) {
    if (!mask[i] || visited[i]) continue;

    const queue = [i];
    visited[i] = 1;
    const points = [];

    while (queue.length) {
      const current = queue.pop();
      points.push(current);

      const x = current % w;
      const y = Math.floor(current / w);

      for (let k = 0; k < offsets.length; k += 1) {
        const nx = x + offsets[k][0];
        const ny = y + offsets[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (!mask[ni] || visited[ni]) continue;
        visited[ni] = 1;
        queue.push(ni);
      }
    }

    components.push(points);
  }

  return components;
};

const erodeMask = (mask, w, h) => {
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      let keep = 1;
      for (let ny = y - 1; ny <= y + 1 && keep; ny += 1) {
        for (let nx = x - 1; nx <= x + 1; nx += 1) {
          if (!mask[ny * w + nx]) {
            keep = 0;
            break;
          }
        }
      }
      out[i] = keep;
    }
  }
  return out;
};

const dilateMask = (mask, w, h) => {
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      let on = 0;
      for (let ny = y - 1; ny <= y + 1 && !on; ny += 1) {
        for (let nx = x - 1; nx <= x + 1; nx += 1) {
          if (mask[ny * w + nx]) {
            on = 1;
            break;
          }
        }
      }
      out[i] = on;
    }
  }
  return out;
};

const openCloseMask = (mask, w, h, openIterations = 1, closeIterations = 2) => {
  let m = mask;
  for (let i = 0; i < openIterations; i += 1) {
    m = erodeMask(m, w, h);
    m = dilateMask(m, w, h);
  }
  for (let i = 0; i < closeIterations; i += 1) {
    m = dilateMask(m, w, h);
    m = erodeMask(m, w, h);
  }
  return m;
};

const andMask = (a, b) => {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i += 1) {
    out[i] = a[i] && b[i] ? 1 : 0;
  }
  return out;
};

const masksEqual = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const reconstructMask = (marker, constraint, w, h, maxIter = 64) => {
  let current = marker;
  for (let iter = 0; iter < maxIter; iter += 1) {
    const next = andMask(dilateMask(current, w, h), constraint);
    if (masksEqual(next, current)) break;
    current = next;
  }
  return current;
};

const maskFromPoints = (points, size) => {
  const mask = new Uint8Array(size);
  for (let i = 0; i < points.length; i += 1) {
    mask[points[i]] = 1;
  }
  return mask;
};

const largestComponentPoints = (mask, w, h) => {
  const components = collectComponents(mask, w, h);
  if (!components.length) return null;
  let best = components[0];
  for (let i = 1; i < components.length; i += 1) {
    if (components[i].length > best.length) best = components[i];
  }
  return best;
};

const trimMaskAgainstFur = (points, rgb, w, h, antiFurLevel = 55) => {
  const size = w * h;
  const mask = maskFromPoints(points, size);

  const cx0 = Math.floor(w * 0.42);
  const cx1 = Math.floor(w * 0.58);
  const cy0 = Math.floor(h * 0.42);
  const cy1 = Math.floor(h * 0.58);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;

  for (let y = cy0; y < cy1; y += 1) {
    for (let x = cx0; x < cx1; x += 1) {
      const p = (y * w + x) * 4;
      sumR += rgb[p];
      sumG += rgb[p + 1];
      sumB += rgb[p + 2];
      count += 1;
    }
  }

  const refR = sumR / Math.max(1, count);
  const refG = sumG / Math.max(1, count);
  const refB = sumB / Math.max(1, count);
  const strength = Math.max(0, Math.min(1, antiFurLevel / 100));
  const satLow = 0.18 + 0.20 * strength;
  const satHigh = 0.30 + 0.18 * strength;
  const distThr = 68 - 34 * strength;
  const valThr = 205 - 42 * strength;

  const trimmed = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    if (!mask[i]) continue;
    const p = i * 4;
    const r = rgb[p];
    const g = rgb[p + 1];
    const b = rgb[p + 2];
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
    const val = maxC;
    const dist = Math.hypot(r - refR, g - refG, b - refB);
    const furLike =
      (sat > satLow && val < valThr && dist > distThr) ||
      (sat > satHigh && val < 215);
    if (!furLike) trimmed[i] = 1;
  }

  let clean = openCloseMask(trimmed, w, h, 1, 1);
  clean = removeSmallComponents(clean, w, h, Math.max(120, Math.floor(size * 0.0007)));
  const main = largestComponentPoints(clean, w, h);
  return main && main.length > 260 ? main : points;
};

const suppressFurProtrusions = (points, w, h, pxPerMm = 0, edgeInsetMm = 1.6) => {
  const size = w * h;
  const original = maskFromPoints(points, size);
  const insetPx = pxPerMm > 0
    ? Math.max(2, Math.min(10, Math.round(pxPerMm * edgeInsetMm)))
    : 3;
  const coreErodeIters = Math.max(2, Math.min(6, Math.round(insetPx * 0.55)));

  // Build a stable core of the light zone; thin fur branches usually disappear here.
  let core = original;
  for (let i = 0; i < coreErodeIters; i += 1) core = erodeMask(core, w, h);

  // Recover only regions connected to the core inside the original mask.
  let reconstructed = reconstructMask(core, original, w, h, 80);
  reconstructed = openCloseMask(reconstructed, w, h, 1, 1);
  reconstructed = removeSmallComponents(reconstructed, w, h, Math.max(140, Math.floor(size * 0.0008)));

  // Inset boundary by known physical distance (mm), then smooth back.
  for (let i = 0; i < insetPx; i += 1) reconstructed = erodeMask(reconstructed, w, h);
  for (let i = 0; i < Math.max(1, insetPx - 1); i += 1) reconstructed = dilateMask(reconstructed, w, h);

  const main = largestComponentPoints(reconstructed, w, h);
  if (!main || main.length < 300) return points;
  return main;
};

const removeSmallComponents = (mask, w, h, minArea) => {
  const components = collectComponents(mask, w, h);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < components.length; i += 1) {
    const points = components[i];
    if (points.length < minArea) continue;
    for (let j = 0; j < points.length; j += 1) {
      out[points[j]] = 1;
    }
  }
  return out;
};

const regionGrowFromCenter = (candidateMask, w, h) => {
  const size = w * h;
  const visited = new Uint8Array(size);
  const out = new Uint8Array(size);
  const queue = [];
  const offsets = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],           [1, 0],
    [-1, 1],  [0, 1],  [1, 1],
  ];

  const cx0 = Math.floor(w * 0.42);
  const cx1 = Math.floor(w * 0.58);
  const cy0 = Math.floor(h * 0.42);
  const cy1 = Math.floor(h * 0.58);

  for (let y = cy0; y < cy1; y += 1) {
    for (let x = cx0; x < cx1; x += 1) {
      const i = y * w + x;
      if (!candidateMask[i] || visited[i]) continue;
      visited[i] = 1;
      queue.push(i);
      out[i] = 1;
    }
  }

  if (!queue.length) {
    const c = Math.floor(h / 2) * w + Math.floor(w / 2);
    if (candidateMask[c]) {
      visited[c] = 1;
      queue.push(c);
      out[c] = 1;
    }
  }

  while (queue.length) {
    const current = queue.pop();
    const x = current % w;
    const y = Math.floor(current / w);

    for (let k = 0; k < offsets.length; k += 1) {
      const nx = x + offsets[k][0];
      const ny = y + offsets[k][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (!candidateMask[ni] || visited[ni]) continue;
      visited[ni] = 1;
      out[ni] = 1;
      queue.push(ni);
    }
  }

  return out;
};

const componentBounds = (points, w, h) => {
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let sumX = 0;
  let sumY = 0;
  const n = points.length;

  for (let i = 0; i < n; i += 1) {
    const idx = points[i];
    const x = idx % w;
    const y = Math.floor(idx / w);
    sumX += x;
    sumY += y;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: sumX / Math.max(1, n),
    cy: sumY / Math.max(1, n),
    bboxW: maxX - minX + 1,
    bboxH: maxY - minY + 1,
  };
};

const isQrLikeBrightComponent = (points, luminance, w, h) => {
  if (points.length < 60) return false;
  const b = componentBounds(points, w, h);
  const minSide = Math.min(b.bboxW, b.bboxH);
  const maxSide = Math.max(b.bboxW, b.bboxH);
  const aspect = maxSide / Math.max(1, minSide);
  const fillRatio = points.length / Math.max(1, b.bboxW * b.bboxH);

  if (aspect > 1.35) return false;
  if (minSide < 16 || maxSide > Math.min(w, h) * 0.35) return false;
  if (fillRatio < 0.35) return false;

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  let transitions = 0;

  for (let y = b.minY; y <= b.maxY; y += 1) {
    let prevDark = -1;
    for (let x = b.minX; x <= b.maxX; x += 1) {
      const v = luminance[y * w + x];
      sum += v;
      sumSq += v * v;
      count += 1;

      const dark = v < 128 ? 1 : 0;
      if (prevDark !== -1 && prevDark !== dark) transitions += 1;
      prevDark = dark;
    }
  }

  for (let x = b.minX; x <= b.maxX; x += 1) {
    let prevDark = -1;
    for (let y = b.minY; y <= b.maxY; y += 1) {
      const v = luminance[y * w + x];
      const dark = v < 128 ? 1 : 0;
      if (prevDark !== -1 && prevDark !== dark) transitions += 1;
      prevDark = dark;
    }
  }

  const mean = sum / Math.max(1, count);
  const variance = sumSq / Math.max(1, count) - mean * mean;
  const std = Math.sqrt(Math.max(0, variance));
  const transitionDensity = transitions / Math.max(1, b.bboxW * b.bboxH);

  return mean > 165 && std > 42 && transitionDensity > 0.16;
};

const estimateStickerScalePxPerMm = (rgb, luminance, w, h) => {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i += 1) {
    const p = i * 4;
    const r = rgb[p];
    const g = rgb[p + 1];
    const b = rgb[p + 2];
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
    if (maxC >= 170 && sat < 0.28) mask[i] = 1;
  }

  const components = collectComponents(mask, w, h);
  let best = null;

  for (let i = 0; i < components.length; i += 1) {
    const points = components[i];
    const n = points.length;
    if (n < 120) continue;
    const b = componentBounds(points, w, h);
    const minSide = Math.min(b.bboxW, b.bboxH);
    const maxSide = Math.max(b.bboxW, b.bboxH);
    const aspect = maxSide / Math.max(1, minSide);
    if (aspect > 1.35 || minSide < 18 || maxSide > Math.min(w, h) * 0.42) continue;

    let darkCount = 0;
    let sum = 0;
    let sumSq = 0;
    let transitions = 0;
    let cnt = 0;

    for (let y = b.minY; y <= b.maxY; y += 1) {
      let prev = -1;
      for (let x = b.minX; x <= b.maxX; x += 1) {
        const v = luminance[y * w + x];
        cnt += 1;
        sum += v;
        sumSq += v * v;
        const d = v < 128 ? 1 : 0;
        if (d) darkCount += 1;
        if (prev !== -1 && prev !== d) transitions += 1;
        prev = d;
      }
    }

    const darkRatio = darkCount / Math.max(1, cnt);
    const mean = sum / Math.max(1, cnt);
    const variance = sumSq / Math.max(1, cnt) - mean * mean;
    const std = Math.sqrt(Math.max(0, variance));
    const transitionDensity = transitions / Math.max(1, b.bboxW * b.bboxH);

    const squareLike = Math.max(0, 1 - (aspect - 1) / 0.35);
    const darkLike = 1 - Math.min(1, Math.abs(darkRatio - 0.42) / 0.32);
    const textureLike = Math.max(0, Math.min(1, (transitionDensity - 0.08) / 0.22));
    const contrastLike = Math.max(0, Math.min(1, (std - 28) / 55));

    if (mean < 120 || darkRatio < 0.1 || darkRatio > 0.8) continue;
    const score = squareLike * 0.35 + darkLike * 0.25 + textureLike * 0.25 + contrastLike * 0.15;
    if (!best || score > best.score) {
      best = { score, widthPx: maxSide, bounds: b };
    }
  }

  if (!best || best.score < 0.3) return { pxPerMm: 0, stickerWidthPx: 0 };
  return { pxPerMm: best.widthPx / STICKER_WIDTH_MM, stickerWidthPx: best.widthPx };
};

const analyzeDarkLineComponent = (points, w, h) => {
  const n = points.length;
  if (n < 12) return null;

  let sumX = 0;
  let sumY = 0;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;

  for (let i = 0; i < n; i += 1) {
    const idx = points[i];
    const x = idx % w;
    const y = Math.floor(idx / w);
    sumX += x;
    sumY += y;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const cx = sumX / n;
  const cy = sumY / n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;

  for (let i = 0; i < n; i += 1) {
    const idx = points[i];
    const x = idx % w;
    const y = Math.floor(idx / w);
    const dx = x - cx;
    const dy = y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  const { l1, l2, angle } = eigFromCov(sxx / n, syy / n, sxy / n);
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);

  let minT = Infinity;
  let maxT = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const idx = points[i];
    const x = idx % w;
    const y = Math.floor(idx / w);
    const t = (x - cx) * ux + (y - cy) * uy;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }

  const length = Math.max(0, maxT - minT);
  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  const fillRatio = n / Math.max(1, bboxW * bboxH);
  const elongation = l1 / Math.max(0.001, l2);

  const nx = (cx - w / 2) / (w / 2);
  const ny = (cy - h / 2) / (h / 2);
  const centerDist = Math.min(1, Math.hypot(nx, ny));
  const touchesBorder = minX <= 1 || minY <= 1 || maxX >= w - 2 || maxY >= h - 2;

  const score =
    Math.max(0, Math.min(1, (elongation - 4) / 30)) * 0.45 +
    Math.max(0, Math.min(1, (0.45 - fillRatio) / 0.45)) * 0.20 +
    Math.max(0, Math.min(1, (length - 10) / 80)) * 0.20 +
    (1 - centerDist) * 0.15 -
    (touchesBorder ? 0.25 : 0);

  return {
    score,
    start: { x: cx + minT * ux, y: cy + minT * uy },
    end: { x: cx + maxT * ux, y: cy + maxT * uy },
    count: n,
    elongation,
  };
};

const findBestDarkLine = (luminance, threshold, w, h) => {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i += 1) {
    if (luminance[i] <= threshold) mask[i] = 1;
  }

  const components = collectComponents(mask, w, h);
  let best = null;
  for (let i = 0; i < components.length; i += 1) {
    const candidate = analyzeDarkLineComponent(components[i], w, h);
    if (!candidate) continue;
    if (!best || candidate.score > best.score) best = candidate;
  }

  return best;
};

const findBestBrightZone = (rgb, w, h) => {
  const luminance = rgbToLuminance(rgb, w, h);
  const maskValMin = Number(maskValMinInput.value);
  const maskValMax = Number(maskValMaxInput.value);
  const maskSatMax = Number(maskSatMaxInput.value) / 100;
  const maskColorDist = Number(maskColorDistInput.value);
  const cx0 = Math.floor(w * 0.35);
  const cx1 = Math.floor(w * 0.65);
  const cy0 = Math.floor(h * 0.35);
  const cy1 = Math.floor(h * 0.65);

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sampleCount = 0;

  for (let y = cy0; y < cy1; y += 1) {
    for (let x = cx0; x < cx1; x += 1) {
      const p = (y * w + x) * 4;
      sumR += rgb[p];
      sumG += rgb[p + 1];
      sumB += rgb[p + 2];
      sampleCount += 1;
    }
  }

  const meanR = sumR / Math.max(1, sampleCount);
  const meanG = sumG / Math.max(1, sampleCount);
  const meanB = sumB / Math.max(1, sampleCount);

  const candidateMask = new Uint8Array(w * h);
  for (let i = 0; i < candidateMask.length; i += 1) {
    const p = i * 4;
    const r = rgb[p];
    const g = rgb[p + 1];
    const b = rgb[p + 2];

    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
    const val = maxC;
    const dist = Math.hypot(r - meanR, g - meanG, b - meanB);

    if (val < maskValMin || val > maskValMax) continue;
    if (sat > maskSatMax) continue;
    if (dist > maskColorDist) continue;
    candidateMask[i] = 1;
  }

  // Keep only the region connected to the center to avoid fur islands.
  let cleanedMask = regionGrowFromCenter(candidateMask, w, h);
  cleanedMask = removeSmallComponents(
    openCloseMask(cleanedMask, w, h, 1, 2),
    w,
    h,
    Math.max(320, Math.floor(w * h * 0.002))
  );
  // Slight inset to suppress fur protrusions near boundaries.
  cleanedMask = erodeMask(cleanedMask, w, h);
  cleanedMask = erodeMask(cleanedMask, w, h);
  cleanedMask = dilateMask(cleanedMask, w, h);

  const components = collectComponents(cleanedMask, w, h);
  let best = null;

  for (let i = 0; i < components.length; i += 1) {
    const points = components[i];
    const n = points.length;
    if (n < 800) continue;
    if (isQrLikeBrightComponent(points, luminance, w, h)) continue;
    const b = componentBounds(points, w, h);
    const cx = b.cx;
    const cy = b.cy;
    const bboxW = b.bboxW;
    const bboxH = b.bboxH;
    const compactness = n / Math.max(1, bboxW * bboxH);
    const areaNorm = Math.min(1, n / (w * h * 0.25));

    const nx = (cx - w / 2) / (w / 2);
    const ny = (cy - h / 2) / (h / 2);
    const centerLike = 1 - Math.min(1, Math.hypot(nx, ny));
    const touchesBorder = b.minX <= 1 || b.minY <= 1 || b.maxX >= w - 2 || b.maxY >= h - 2;

    if (touchesBorder) continue;
    const score = areaNorm * 0.70 + centerLike * 0.20 + compactness * 0.15;

    if (!best || score > best.score) {
      best = { score, points, area: n };
    }
  }

  return best;
};

const drawComponentMaskAndContour = (ctx, points, w, h) => {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < points.length; i += 1) {
    mask[points[i]] = 1;
  }

  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;

  const setContourPixel = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = (y * w + x) * 4;
    data[p] = 18;
    data[p + 1] = 135;
    data[p + 2] = 74;
    data[p + 3] = 255;
  };

  for (let i = 0; i < points.length; i += 1) {
    const idx = points[i];
    const p = idx * 4;
    const alpha = 0.34;
    data[p] = Math.round(data[p] * (1 - alpha) + 0 * alpha);
    data[p + 1] = Math.round(data[p + 1] * (1 - alpha) + 180 * alpha);
    data[p + 2] = Math.round(data[p + 2] * (1 - alpha) + 255 * alpha);
  }

  for (let i = 0; i < points.length; i += 1) {
    const idx = points[i];
    const x = idx % w;
    const y = Math.floor(idx / w);

    let boundary = false;
    for (let ny = y - 1; ny <= y + 1 && !boundary; ny += 1) {
      for (let nx = x - 1; nx <= x + 1; nx += 1) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          boundary = true;
          break;
        }
        const ni = ny * w + nx;
        if (!mask[ni]) {
          boundary = true;
          break;
        }
      }
    }

    if (!boundary) continue;
    setContourPixel(x, y);
    setContourPixel(x + 1, y);
    setContourPixel(x - 1, y);
    setContourPixel(x, y + 1);
    setContourPixel(x, y - 1);
    setContourPixel(x + 1, y + 1);
    setContourPixel(x - 1, y - 1);
    setContourPixel(x + 1, y - 1);
    setContourPixel(x - 1, y + 1);
  }

  ctx.putImageData(img, 0, 0);
};

const rgbToLuminance = (rgb, w, h) => {
  const luminance = new Float32Array(w * h);
  for (let i = 0, p = 0; p < luminance.length; i += 4, p += 1) {
    luminance[p] = 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2];
  }
  return luminance;
};

const getImageFeaturesFromSource = (w, h) => {
  const srcImage = sourceCtx.getImageData(0, 0, w, h);
  const rgb = srcImage.data;
  const luminance = rgbToLuminance(rgb, w, h);
  return { rgb, luminance };
};

const redrawBaseAndArrow = () => {
  if (!lastState) return;
  const { w, h, bestLine } = lastState;
  resultCtx.clearRect(0, 0, w, h);
  resultCtx.drawImage(loadedImage, 0, 0, w, h);
  if (bestLine) drawArrow(resultCtx, bestLine.start, bestLine.end);
};

const processImage = () => {
  if (!loadedImage) {
    setStatus("Сначала загрузите изображение.");
    return false;
  }

  const w = loadedImage.naturalWidth || loadedImage.width;
  const h = loadedImage.naturalHeight || loadedImage.height;
  fitCanvases(w, h);

  sourceCtx.clearRect(0, 0, w, h);
  resultCtx.clearRect(0, 0, w, h);
  sourceCtx.drawImage(loadedImage, 0, 0, w, h);
  resultCtx.drawImage(loadedImage, 0, 0, w, h);

  const features = getImageFeaturesFromSource(w, h);
  const luminance = features.luminance;
  const darkThreshold = percentile(luminance, Number(darkPercentInput.value) / 100);
  const best = findBestDarkLine(luminance, darkThreshold, w, h);

  const sticker = estimateStickerScalePxPerMm(features.rgb, luminance, w, h);

  if (!best || best.score < 0.12) {
    lastState = { w, h, luminance, rgb: features.rgb, bestLine: null, pxPerMm: sticker.pxPerMm, stickerWidthPx: sticker.stickerWidthPx };
    setStatus("Линия не найдена уверенно. Попробуйте увеличить долю тёмных пикселей.");
    return false;
  }

  drawArrow(resultCtx, best.start, best.end);
  lastState = { w, h, luminance, rgb: features.rgb, bestLine: best, pxPerMm: sticker.pxPerMm, stickerWidthPx: sticker.stickerWidthPx };

  setStatus(
    `Линия найдена. Порог: ${darkThreshold.toFixed(1)}. Пикселей линии: ${best.count}. ` +
      `Линейность: ${best.elongation.toFixed(1)}.` +
      (sticker.pxPerMm > 0 ? ` Масштаб: ${sticker.pxPerMm.toFixed(2)} px/мм.` : "")
  );
  return true;
};

const drawBrightContour = () => {
  if (!loadedImage) {
    setStatus("Сначала загрузите изображение.");
    return;
  }

  if (!lastState) {
    processImage();
  }

  if (!lastState) return;

  redrawBaseAndArrow();
  const zone = findBestBrightZone(lastState.rgb, lastState.w, lastState.h);

  if (!zone || zone.score < 0.08) {
    setStatus("Светлая зона не найдена уверенно.");
    return;
  }

  const insetMm = Number(maskInsetMmInput.value || 1.6);
  const antiFurLevel = Number(antiFurInput.value || 55);
  const cleanedPoints = suppressFurProtrusions(zone.points, lastState.w, lastState.h, Number(lastState.pxPerMm || 0), insetMm);
  const antiFurPoints = trimMaskAgainstFur(cleanedPoints, lastState.rgb, lastState.w, lastState.h, antiFurLevel);
  drawComponentMaskAndContour(resultCtx, antiFurPoints, lastState.w, lastState.h);
  setStatus(
    `Контур светлой зоны построен. Площадь зоны: ${antiFurPoints.length} px.` +
      (lastState.pxPerMm > 0 ? ` Отступ от края: ${insetMm.toFixed(1)} мм.` : "")
  );
};

fileInput.addEventListener("change", (event) => {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    loadedImage = img;
    lastState = null;
    processImage();
    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    setStatus("Ошибка загрузки изображения.");
    URL.revokeObjectURL(url);
  };
  img.src = url;
});

analyzeBtn.addEventListener("click", processImage);
contourBtn.addEventListener("click", drawBrightContour);
darkPercentInput.addEventListener("input", updateLabels);
maskValMinInput.addEventListener("input", updateLabels);
maskValMaxInput.addEventListener("input", updateLabels);
maskSatMaxInput.addEventListener("input", updateLabels);
maskColorDistInput.addEventListener("input", updateLabels);
maskInsetMmInput.addEventListener("input", updateLabels);
antiFurInput.addEventListener("input", updateLabels);

updateLabels();
