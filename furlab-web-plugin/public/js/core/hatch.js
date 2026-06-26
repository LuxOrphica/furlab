// FurLab Hatch / Material Visual module
// Exposes window.FurLabHatch
(function (global) {

  // ---------------------------------------------------------------------------
  // Color utils
  // ---------------------------------------------------------------------------

  function normalizeHexColor(value, fallback) {
    const raw = String(value || "").trim();
    if (!raw) return fallback || "#9fb3c8";
    const hex = raw.startsWith("#") ? raw : `#${raw}`;
    return /^#([0-9a-fA-F]{6})$/.test(hex) ? hex : (fallback || "#9fb3c8");
  }

  function clamp01(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return Number.isFinite(fallback) ? fallback : 0;
    return Math.max(0, Math.min(1, n));
  }

  function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex, "#9fb3c8");
    const match = normalized.match(/^#([0-9a-fA-F]{6})$/);
    if (!match) return { r: 159, g: 179, b: 200 };
    const raw = match[1];
    return { r: parseInt(raw.slice(0, 2), 16), g: parseInt(raw.slice(2, 4), 16), b: parseInt(raw.slice(4, 6), 16) };
  }

  function rgbaFromHex(hex, alpha) {
    const rgb = hexToRgb(hex);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.max(0, Math.min(1, Number(alpha) || 0))})`;
  }

  // ---------------------------------------------------------------------------
  // Material hatch color
  // ---------------------------------------------------------------------------

  function computeMaterialHatchColor(densityNorm, thicknessNorm, curlEffNorm, bendNorm, lengthNorm, fluffNorm) {
    const hue = Math.round(44 - curlEffNorm * 16 - fluffNorm * 8 + bendNorm * 6);
    const sat = Math.round(28 + lengthNorm * 26 + densityNorm * 16);
    const lit = Math.round(52 - densityNorm * 22 - thicknessNorm * 12 + fluffNorm * 6);
    const alpha = (0.78 + densityNorm * 0.16).toFixed(2);
    return `hsla(${hue},${sat}%,${Math.max(18, Math.min(68, lit))}%,${alpha})`;
  }

  function normalizeRange(value, min, max, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    if (max <= min) return 0;
    return Math.max(0, Math.min(1, (n - min) / (max - min)));
  }

  // ---------------------------------------------------------------------------
  // Pattern spec
  // ---------------------------------------------------------------------------

  function getMaterialPatternSpec(material) {
    const pileLengthMm = Math.max(0, Number(material && material.pileLengthMm || 0));
    const pileDensityPerIn2 = Math.max(0, Number(material && material.pileDensityPerIn2 || 0));
    const hairThicknessMm = Math.max(0, Number(material && material.hairThicknessMm || 0));
    const hairBend = clamp01(material && material.hairBend, 0.15);
    const bendSpread = clamp01(material && material.bendSpread, 0.2);
    const curlRadiusMm = Math.max(0, Number(material && material.curlRadiusMm || 0));
    const curlEffect = clamp01(material && material.curlEffect, 0.2);
    const fluffiness = clamp01(material && material.fluffiness, 0.25);
    const segmentationCount = Math.max(1, Number(material && material.segmentationCount || 1));
    const softness = clamp01(material && material.softness, 0.35);

    const densityNorm = normalizeRange(pileDensityPerIn2, 550, 950, 0.45);
    const lengthNorm = normalizeRange(pileLengthMm, 15, 65, 0.35);
    const thicknessNorm = normalizeRange(hairThicknessMm, 0.08, 0.22, 0.4);
    const curlRadiusNorm = normalizeRange(curlRadiusMm, 1.5, 5.5, 0.25);
    const curlEffNorm = clamp01(curlEffect, 0.2);
    const bendNorm = clamp01(hairBend, 0.2);
    const spreadNorm = clamp01(bendSpread, 0.2);
    const fluffNorm = clamp01(fluffiness, 0.25);
    const segNorm = normalizeRange(segmentationCount, 1, 5, 0.2);
    const softNorm = clamp01(softness, 0.35);

    const spacing = Math.max(7.5, Math.min(28, 28 - densityNorm * 17));
    const strokeWidth = Math.max(0.3, Math.min(1.1, 0.3 + thicknessNorm * 0.8));
    const dashLength = Math.max(2.6, Math.min(36, 2.6 + lengthNorm * 33.4));
    const baseGapLength = Math.max(1.8, Math.min(18, 14.5 - densityNorm * 8.2));
    const baseAngleDeg = -88 + bendNorm * 92;
    const angleJitterDeg = spreadNorm * 4;
    const wavelength = Math.max(10, Math.min(64, 10 + curlRadiusNorm * 46));
    const waveAmplitude = curlEffNorm >= 0.72 ? Math.max(1.8, Math.min(5.6, (curlEffNorm - 0.72) / 0.28 * 3.8 + 1.8)) : 0;
    const segmentationRatio = Math.max(0.10, Math.min(0.98, 0.98 - segNorm * 0.74));
    const dashSegment = Math.max(1.8, dashLength * segmentationRatio);
    const dashGap = Math.max(1.5, baseGapLength * (1 + segNorm * 0.9));

    const hatchStroke = computeMaterialHatchColor(densityNorm, thicknessNorm, curlEffNorm, bendNorm, lengthNorm, fluffNorm);
    return {
      family: 'direct-geometry',
      stroke: hatchStroke, strokeWidth, spacing,
      dash: [dashSegment, dashGap],
      baseAngleDeg, angleRad: baseAngleDeg * Math.PI / 180, angleJitterDeg,
      waveAmplitude, wavelength,
      densityNorm, lengthNorm, thicknessNorm, curlRadiusNorm,
      curlEffNorm, bendNorm, spreadNorm, fluffNorm, segNorm, softNorm,
      layers: [{
        kind: waveAmplitude > 0 ? 'wave' : 'line',
        spacing, dash: [dashSegment, dashGap], strokeWidth,
        amplitude: waveAmplitude, wavelength,
        segmentationScale: Math.max(0, segNorm),
        softnessScale: Math.max(0, softNorm)
      }]
    };
  }

  // ---------------------------------------------------------------------------
  // Wavy line geometry
  // ---------------------------------------------------------------------------

  function buildWavyLinePoints(anchorX, anchorY, dirX, dirY, normalX, normalY, halfLength, amplitude, wavelength) {
    const points = [];
    const steps = Math.max(10, Math.round((halfLength * 2) / Math.max(8, wavelength * 0.35)));
    for (let i = 0; i <= steps; i++) {
      const t = -halfLength + (halfLength * 2 * i / steps);
      const phase = (t / Math.max(8, wavelength)) * Math.PI * 2;
      const wave = Math.sin(phase) * amplitude;
      points.push(anchorX + dirX * t + normalX * wave, anchorY + dirY * t + normalY * wave);
    }
    return points;
  }

  function buildWavyDashSegmentPoints(anchorX, anchorY, dirX, dirY, normalX, normalY, tStart, tEnd, amplitude, wavelength) {
    const points = [];
    const segLength = Math.max(0.001, Math.abs(tEnd - tStart));
    const cycles = Math.max(1, Math.round(segLength / Math.max(18, wavelength * 1.2)));
    const steps = Math.max(8, Math.round(segLength / 2.2));
    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      const t = tStart + (tEnd - tStart) * progress;
      const phase = progress * Math.PI * cycles;
      const wave = Math.sin(phase) * amplitude;
      points.push(anchorX + dirX * t + normalX * wave, anchorY + dirY * t + normalY * wave);
    }
    return points;
  }

  // ---------------------------------------------------------------------------
  // SVG preview
  // ---------------------------------------------------------------------------

  function buildMaterialPreviewSvgMarkup(material) {
    const spec = getMaterialPatternSpec(material);
    const width = 88, height = 118;
    const diag = Math.sqrt(width * width + height * height) + 20;
    const centerX = width / 2, centerY = height / 2;
    const lines = [];
    const addLine = (attrs) => lines.push(`<path ${attrs}/>`);
    const getLineGeometry = (angle, offset) => {
      const dirX = Math.cos(angle), dirY = Math.sin(angle);
      const normalX = -dirY, normalY = dirX;
      const anchorX = centerX + normalX * offset, anchorY = centerY + normalY * offset;
      return { dirX, dirY, normalX, normalY, anchorX, anchorY,
        x1: anchorX - dirX * diag, y1: anchorY - dirY * diag,
        x2: anchorX + dirX * diag, y2: anchorY + dirY * diag };
    };
    const addPatternSet = (layer) => {
      const spacing = Number(layer.spacing || spec.spacing);
      const baseDash = Array.isArray(layer.dash) ? layer.dash : spec.dash;
      const strokeWidth = Number(layer.strokeWidth || spec.strokeWidth);
      const amplitude = Number(layer.amplitude || spec.waveAmplitude);
      const wavelength = Number(layer.wavelength || spec.wavelength);
      for (let offset = -diag; offset <= diag; offset += spacing) {
        const angle = spec.angleRad;
        const geom = getLineGeometry(angle, offset);
        const dash = [Math.max(1.2, baseDash[0]), Math.max(1.2, baseDash[1])];
        if (String(layer.kind || '') === 'wave') {
          for (let t = -diag; t <= diag; t += dash[0] + dash[1]) {
            const tEnd = Math.min(diag, t + dash[0]);
            if (tEnd <= t) continue;
            const wpts = buildWavyDashSegmentPoints(geom.anchorX, geom.anchorY, geom.dirX, geom.dirY, geom.normalX, geom.normalY, t, tEnd, amplitude, wavelength);
            if (wpts.length < 4) continue;
            let d = '';
            for (let i = 0; i < wpts.length; i += 2) d += `${i === 0 ? 'M' : 'L'} ${wpts[i].toFixed(2)} ${wpts[i + 1].toFixed(2)} `;
            addLine(`d="${d.trim()}" stroke="${spec.stroke}" stroke-width="${strokeWidth.toFixed(2)}" fill="none" stroke-linecap="round"`);
          }
        } else {
          addLine(`d="M ${geom.x1.toFixed(2)} ${geom.y1.toFixed(2)} L ${geom.x2.toFixed(2)} ${geom.y2.toFixed(2)}" stroke="${spec.stroke}" stroke-width="${strokeWidth.toFixed(2)}" fill="none" stroke-dasharray="${dash[0].toFixed(2)} ${dash[1].toFixed(2)}" stroke-linecap="round"`);
        }
      }
    };
    for (const layer of spec.layers) addPatternSet(layer);
    const bgRect = `<rect width="${width}" height="${height}" fill="#f8f3ec"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${bgRect}${lines.join('')}</svg>`;
  }

  function buildMaterialPreviewSvg(material) {
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(buildMaterialPreviewSvgMarkup(material))}")`;
  }

  function buildMaterialPatternPreviewStyle(material) {
    return `background-color:transparent;background-image:${buildMaterialPreviewSvg(material)};background-repeat:no-repeat;background-size:100% 100%;background-position:center;`;
  }

  function describeMaterialPatternDebug(material) {
    const spec = getMaterialPatternSpec(material);
    const layer = Array.isArray(spec.layers) && spec.layers[0] ? spec.layers[0] : {};
    return [String(layer.kind || 'line'), `sp ${Number(spec.spacing || 0).toFixed(1)}`,
      `dash ${Number(spec.dash && spec.dash[0] || 0).toFixed(1)}`, `gap ${Number(spec.dash && spec.dash[1] || 0).toFixed(1)}`,
      `w ${Number(spec.strokeWidth || 0).toFixed(2)}`, `a ${Number(spec.baseAngleDeg || 0).toFixed(1)}`,
      `wav ${Number(spec.waveAmplitude || 0).toFixed(1)}`].join(' | ');
  }

  function getZoneMaterialVisual(material) {
    const spec = getMaterialPatternSpec(material);
    return {
      family: spec.family, fill: 'rgba(0,0,0,0)',
      hatchStroke: spec.stroke, hatchSecondary: spec.stroke, accentStroke: spec.stroke,
      spacing: spec.spacing, strokeWidth: spec.strokeWidth, angleRad: spec.angleRad,
      dash: spec.dash, bendAmplitude: spec.waveAmplitude,
      curlRadiusPx: spec.wavelength / 2, layers: spec.layers, spreadNorm: spec.spreadNorm
    };
  }

  // ---------------------------------------------------------------------------
  // Canvas hatch tile (Konva fillPattern)
  // ---------------------------------------------------------------------------

  const _hatchTileCache = new Map();

  function buildHatchTile(visual, layerSpec) {
    const spacing = Math.max(5, Number(layerSpec.spacing || visual.spacing));
    const stroke = visual.hatchStroke;
    const strokeWidth = Math.max(0.25, Number(layerSpec.strokeWidth || visual.strokeWidth));
    const useWave = String(layerSpec.kind || '') === 'wave';
    const amplitude = Number(layerSpec.amplitude || visual.bendAmplitude || 2);
    const wavelength = Number(layerSpec.wavelength || Math.max(12, visual.curlRadiusPx * 2));
    const dash = Array.isArray(layerSpec.dash) ? layerSpec.dash : visual.dash;
    const dashLen = Math.max(1.2, dash[0]);
    const gapLen = Math.max(1.2, dash[1]);
    const period = dashLen + gapLen;
    const key = `${stroke}|${spacing.toFixed(1)}|${strokeWidth.toFixed(2)}|${dashLen.toFixed(1)}|${gapLen.toFixed(1)}|${useWave}|${amplitude.toFixed(1)}`;
    if (_hatchTileCache.has(key)) return _hatchTileCache.get(key);

    const H = Math.ceil(useWave ? Math.max(spacing, amplitude * 2 + strokeWidth * 2 + 4) : spacing);
    const W = useWave ? Math.ceil(Math.max(wavelength * 2, period * 3)) : Math.ceil(period);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H * 2;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = stroke; ctx.lineWidth = strokeWidth; ctx.lineCap = 'round';

    if (useWave) {
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      for (let t = 0; t <= W; t += period) {
        const tEnd = Math.min(W, t + dashLen);
        if (tEnd <= t) continue;
        const wpts = buildWavyDashSegmentPoints(0, 0, 1, 0, 0, 1, t, tEnd, amplitude, wavelength);
        if (wpts.length < 4) continue;
        ctx.moveTo(wpts[0], H * 0.5 + wpts[1]);
        for (let wi = 2; wi < wpts.length; wi += 2) ctx.lineTo(wpts[wi], H * 0.5 + wpts[wi + 1]);
      }
      ctx.stroke();
      ctx.globalAlpha = 0.38;
      ctx.beginPath();
      const off2 = W / 2;
      for (let t = -off2; t <= W; t += period) {
        const tStart = Math.max(0, t), tEnd = Math.min(W, t + dashLen);
        if (tEnd <= tStart) continue;
        const wpts = buildWavyDashSegmentPoints(0, 0, 1, 0, 0, 1, tStart - t, tEnd - t, amplitude, wavelength);
        if (wpts.length < 4) continue;
        ctx.moveTo(tStart + wpts[0], H * 1.5 + wpts[1]);
        for (let wi = 2; wi < wpts.length; wi += 2) ctx.lineTo(tStart + wpts[wi], H * 1.5 + wpts[wi + 1]);
      }
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.45;
      ctx.setLineDash([dashLen, gapLen]);
      ctx.beginPath(); ctx.moveTo(0, H * 0.5); ctx.lineTo(W, H * 0.5); ctx.stroke();
      ctx.globalAlpha = 0.38;
      ctx.lineDashOffset = -(period / 2);
      ctx.beginPath(); ctx.moveTo(0, H * 1.5); ctx.lineTo(W, H * 1.5); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }
    ctx.globalAlpha = 1.0;
    _hatchTileCache.set(key, canvas);
    return canvas;
  }

  function clearHatchTileCache() { _hatchTileCache.clear(); }

  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------

  global.FurLabHatch = {
    normalizeHexColor, clamp01, hexToRgb, rgbaFromHex,
    computeMaterialHatchColor, normalizeRange, getMaterialPatternSpec,
    buildWavyLinePoints, buildWavyDashSegmentPoints,
    buildMaterialPreviewSvgMarkup, buildMaterialPreviewSvg,
    buildMaterialPatternPreviewStyle, describeMaterialPatternDebug,
    getZoneMaterialVisual, buildHatchTile, clearHatchTileCache
  };
})(window);
