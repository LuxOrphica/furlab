// FurLab SVG / contour parsing helpers — pure, no state, no app DOM
// Exposes window.FurLabSvgParse
(function (global) {

  function parseSvgPathToPoints(d, scale) {
    const tokenRe = /([MLHVCSQTAZmlhvcsqtaz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
    const tokens = [];
    let m;
    while ((m = tokenRe.exec(d)) !== null) tokens.push(m[1] || m[2]);

    const CURVE_STEPS = 8;
    const pts = [];
    let i = 0, cx = 0, cy = 0, subX = 0, subY = 0, cmd = "M";
    let prevCpX = 0, prevCpY = 0;

    function nn() { return i < tokens.length && !isNaN(Number(tokens[i])) ? Number(tokens[i++]) : 0; }
    function add(x, y) { pts.push({ x: x * scale, y: y * scale }); prevCpX = cx; prevCpY = cy; cx = x; cy = y; }

    function cubicBezier(x0, y0, x1, y1, x2, y2, x3, y3) {
      for (let s = 1; s <= CURVE_STEPS; s++) {
        const t = s / CURVE_STEPS, mt = 1 - t;
        add(mt*mt*mt*x0 + 3*mt*mt*t*x1 + 3*mt*t*t*x2 + t*t*t*x3,
            mt*mt*mt*y0 + 3*mt*mt*t*y1 + 3*mt*t*t*y2 + t*t*t*y3);
      }
    }
    function quadBezier(x0, y0, x1, y1, x2, y2) {
      for (let s = 1; s <= CURVE_STEPS; s++) {
        const t = s / CURVE_STEPS, mt = 1 - t;
        add(mt*mt*x0 + 2*mt*t*x1 + t*t*x2, mt*mt*y0 + 2*mt*t*y1 + t*t*y2);
      }
    }
    function arcTo(x1, y1, rx, ry, xRot, largeArc, sweep) {
      const steps = Math.max(4, Math.round(Math.sqrt((cx-x1)*(cx-x1)+(cy-y1)*(cy-y1)) / 20));
      const x0 = cx, y0 = cy;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        add(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      }
    }

    while (i < tokens.length) {
      const t = tokens[i];
      if (isNaN(Number(t))) { cmd = t; i++; continue; }
      switch (cmd) {
        case "M": { const x=nn(),y=nn(); add(x,y); subX=x; subY=y; cmd="L"; break; }
        case "m": { const x=cx+nn(),y=cy+nn(); add(x,y); subX=x; subY=y; cmd="l"; break; }
        case "L": add(nn(),nn()); break;
        case "l": add(cx+nn(),cy+nn()); break;
        case "H": add(nn(),cy); break;
        case "h": add(cx+nn(),cy); break;
        case "V": add(cx,nn()); break;
        case "v": add(cx,cy+nn()); break;
        case "C": { const x1=nn(),y1=nn(),x2=nn(),y2=nn(),x3=nn(),y3=nn(); cubicBezier(cx,cy,x1,y1,x2,y2,x3,y3); break; }
        case "c": { const x1=cx+nn(),y1=cy+nn(),x2=cx+nn(),y2=cy+nn(),x3=cx+nn(),y3=cy+nn(); cubicBezier(cx,cy,x1,y1,x2,y2,x3,y3); break; }
        case "S": { const x1=2*cx-prevCpX,y1=2*cy-prevCpY,x2=nn(),y2=nn(),x3=nn(),y3=nn(); cubicBezier(cx,cy,x1,y1,x2,y2,x3,y3); break; }
        case "s": { const x1=2*cx-prevCpX,y1=2*cy-prevCpY,x2=cx+nn(),y2=cy+nn(),x3=cx+nn(),y3=cy+nn(); cubicBezier(cx,cy,x1,y1,x2,y2,x3,y3); break; }
        case "Q": { const x1=nn(),y1=nn(),x2=nn(),y2=nn(); quadBezier(cx,cy,x1,y1,x2,y2); break; }
        case "q": { const x1=cx+nn(),y1=cy+nn(),x2=cx+nn(),y2=cy+nn(); quadBezier(cx,cy,x1,y1,x2,y2); break; }
        case "T": { const x1=2*cx-prevCpX,y1=2*cy-prevCpY,x2=nn(),y2=nn(); quadBezier(cx,cy,x1,y1,x2,y2); break; }
        case "t": { const x1=2*cx-prevCpX,y1=2*cy-prevCpY,x2=cx+nn(),y2=cy+nn(); quadBezier(cx,cy,x1,y1,x2,y2); break; }
        case "A": { const rx=nn(),ry=nn(),xr=nn(),la=nn(),sw=nn(),x=nn(),y=nn(); arcTo(x,y,rx,ry,xr,la,sw); break; }
        case "a": { const rx=nn(),ry=nn(),xr=nn(),la=nn(),sw=nn(),x=cx+nn(),y=cy+nn(); arcTo(x,y,rx,ry,xr,la,sw); break; }
        case "Z": case "z": cx=subX; cy=subY; break;
        default: if (!isNaN(Number(tokens[i]))) nn(); else i++; break;
      }
    }
    return pts;
  }

  function parseSvgContours(svgText, scaleMmPerUnit) {
    const scale = Number(scaleMmPerUnit) > 0 ? Number(scaleMmPerUnit) : 1;
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, "image/svg+xml");
    const err = doc.querySelector("parsererror");
    if (err) return { contours: [], error: "SVG parse error" };
    const contours = [];

    let autoScale = scale;
    const svgEl = doc.querySelector("svg");
    if (svgEl) {
      const wAttr = svgEl.getAttribute("width") || "";
      const vbAttr = svgEl.getAttribute("viewBox") || "";
      const mmMatch = wAttr.match(/^([\d.]+)mm$/i);
      const cmMatch = wAttr.match(/^([\d.]+)cm$/i);
      const vbNums = vbAttr.trim().split(/[\s,]+/).map(Number);
      if (vbNums.length >= 4 && vbNums[2] > 0) {
        let physMm = null;
        if (mmMatch) physMm = Number(mmMatch[1]);
        else if (cmMatch) physMm = Number(cmMatch[1]) * 10;
        if (physMm) autoScale = physMm / vbNums[2];
      }
    }

    function pxPts(str) {
      return (str.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) || []).map(Number);
    }
    for (const el of doc.querySelectorAll("polygon,polyline")) {
      const nums = pxPts(el.getAttribute("points") || "");
      if (nums.length < 6) continue;
      const pts = [];
      for (let j = 0; j + 1 < nums.length; j += 2) pts.push({ x: nums[j] * autoScale, y: nums[j + 1] * autoScale });
      contours.push(pts);
    }
    for (const el of doc.querySelectorAll("path")) {
      const pts = parseSvgPathToPoints(el.getAttribute("d") || "", autoScale);
      if (pts.length >= 3) contours.push(pts);
    }
    for (const el of doc.querySelectorAll("rect")) {
      const x = Number(el.getAttribute("x") || 0) * autoScale;
      const y = Number(el.getAttribute("y") || 0) * autoScale;
      const w = Number(el.getAttribute("width") || 0) * autoScale;
      const h = Number(el.getAttribute("height") || 0) * autoScale;
      if (w > 0 && h > 0) contours.push([{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]);
    }

    return { contours, autoScale };
  }

  function parseScrapContourPoints(scrapContourText) {
    if (!scrapContourText) return [];
    try {
      const parsed = JSON.parse(String(scrapContourText));
      const arr = Array.isArray(parsed && parsed.path) ? parsed.path : [];
      const out = [];
      for (const p of arr) {
        const x = Number(p && p.x);
        const y = Number(p && p.y);
        if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
      }
      return out;
    } catch (_) {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  global.FurLabSvgParse = {
    parseSvgPathToPoints,
    parseSvgContours,
    parseScrapContourPoints,
  };

})(window);
