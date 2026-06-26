export function createLegacyLineSearchMask(deps) {
  const {
    getSourceData,
    getCanvas,
    sampleGray,
    morphErode,
    morphDilate,
    extractLargestComponent,
    getPolygonMask
  } = deps;

  function buildFallbackLineSearchMask() {
    const sourceData = getSourceData();
    const canvas = getCanvas();
    if (!sourceData || !canvas?.width || !canvas?.height) return null;
    const w = canvas.width;
    const h = canvas.height;
    const size = w * h;
    const raw = new Uint8Array(size);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const p = i * 4;
        const r = sourceData[p];
        const g = sourceData[p + 1];
        const b = sourceData[p + 2];
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const gray = sampleGray(x, y);
        if (mx < 244 && (gray < 236 || (mx - mn) > 7)) raw[i] = 1;
      }
    }

    const clean = morphErode(morphDilate(raw, w, h, 2), w, h, 1);
    const visited = new Uint8Array(size);
    const main = extractLargestComponent(clean, visited, w, h);
    if (!main || main.length < Math.max(900, Math.round(size * 0.015))) return null;

    const out = new Uint8Array(size);
    for (let i = 0; i < main.length; i++) out[main[i]] = 1;
    return out;
  }

  function getLineSearchMask() {
    const polygonMask = getPolygonMask();
    const canvas = getCanvas();
    if (!polygonMask || !canvas?.width || !canvas?.height) {
      const fallback = buildFallbackLineSearchMask();
      return { mask: fallback, reliablePolygon: false, source: "fallback-object" };
    }

    const size = canvas.width * canvas.height;
    let polyArea = 0;
    for (let i = 0; i < size; i++) polyArea += polygonMask[i] ? 1 : 0;
    const reliable = polyArea >= Math.round(size * 0.06);
    if (reliable) return { mask: polygonMask, reliablePolygon: true, source: "polygon-mask" };

    const fallback = buildFallbackLineSearchMask();
    return {
      mask: fallback || polygonMask,
      reliablePolygon: false,
      source: fallback ? "fallback-object" : "polygon-mask-small"
    };
  }

  return {
    buildFallbackLineSearchMask,
    getLineSearchMask
  };
}
