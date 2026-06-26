// Extracted from app.js (runtime UI text normalizer)
(function (global) {
  const uiUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

  function cp1251Byte(ch) {
    const code = ch.charCodeAt(0);
    if (code <= 0x7f) return code;
    if (code === 0x0401) return 0xa8;
    if (code === 0x0451) return 0xb8;
    if (code >= 0x0410 && code <= 0x044f) return code - 0x350;
    const map = new Map([
      [0x0402, 0x80], [0x0403, 0x81], [0x201a, 0x82], [0x0453, 0x83],
      [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
      [0x20ac, 0x88], [0x2030, 0x89], [0x0409, 0x8a], [0x2039, 0x8b],
      [0x040a, 0x8c], [0x040c, 0x8d], [0x040b, 0x8e], [0x040f, 0x8f],
      [0x0452, 0x90], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
      [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
      [0x2122, 0x99], [0x0459, 0x9a], [0x203a, 0x9b], [0x045a, 0x9c],
      [0x045c, 0x9d], [0x045b, 0x9e], [0x045f, 0x9f], [0x00a0, 0xa0],
      [0x040e, 0xa1], [0x045e, 0xa2], [0x0408, 0xa3], [0x00a4, 0xa4],
      [0x0490, 0xa5], [0x00a6, 0xa6], [0x00a7, 0xa7], [0x00a9, 0xa9],
      [0x0404, 0xaa], [0x00ab, 0xab], [0x00ac, 0xac], [0x00ad, 0xad],
      [0x00ae, 0xae], [0x0407, 0xaf], [0x00b0, 0xb0], [0x00b1, 0xb1],
      [0x0406, 0xb2], [0x0456, 0xb3], [0x0491, 0xb4], [0x00b5, 0xb5],
      [0x00b6, 0xb6], [0x00b7, 0xb7], [0x2116, 0xb9], [0x0454, 0xba],
      [0x00bb, 0xbb], [0x0458, 0xbc], [0x0405, 0xbd], [0x0455, 0xbe],
      [0x0457, 0xbf]
    ]);
    if (map.has(code)) return map.get(code);
    return -1;
  }

  function decodeUtf8FromCp1251(str) {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i += 1) {
      const b = cp1251Byte(str[i]);
      if (b < 0) return null;
      bytes[i] = b;
    }
    try { return uiUtf8Decoder.decode(bytes); } catch (_) { return null; }
  }

  function decodeUtf8FromLatin1(str) {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i += 1) {
      const code = str.charCodeAt(i);
      if (code > 0xff) return null;
      bytes[i] = code;
    }
    try { return uiUtf8Decoder.decode(bytes); } catch (_) { return null; }
  }

  function hasMojibakeMarker(str) {
    return /(?:\u0420.|\u0421.|\u00D0.|\u00D1.|\u00C2.|\u00E2.)/.test(str);
  }

  function textQualityScore(str) {
    const bad = (str.match(/(?:\u0420.|\u0421.|\u00D0.|\u00D1.|\u00C2.|\u00E2.)/g) || []).length;
    const ru = (str.match(/[\u0410-\u042F\u0430-\u044F\u0401\u0451]/g) || []).length;
    return ru * 3 - bad * 4;
  }

  function normalizeUiText(input) {
    const s = String(input == null ? "" : input);
    if (!s || !hasMojibakeMarker(s)) return s;
    let best = s;
    let score = textQualityScore(s);
    let cur = s;
    for (let i = 0; i < 3; i += 1) {
      const c1 = decodeUtf8FromCp1251(cur);
      const c2 = decodeUtf8FromLatin1(cur);
      let improved = false;
      for (const cand of [c1, c2]) {
        if (!cand) continue;
        const sc = textQualityScore(cand);
        if (sc > score) {
          best = cand;
          score = sc;
          improved = true;
        }
      }
      if (!improved) break;
      cur = best;
    }
    return best;
  }

  function normalizeDomSubtree(root) {
    if (!root || root.nodeType !== 1) return;
    const attrs = ["title", "placeholder", "value"];
    for (const a of attrs) {
      if (!root.hasAttribute || !root.hasAttribute(a)) continue;
      const cur = root.getAttribute(a);
      if (typeof cur !== "string") continue;
      const fixed = normalizeUiText(cur);
      if (fixed !== cur) root.setAttribute(a, fixed);
    }
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n = tw.nextNode();
    while (n) {
      const cur = String(n.nodeValue || "");
      const fixed = normalizeUiText(cur);
      if (fixed !== cur) n.nodeValue = fixed;
      n = tw.nextNode();
    }
  }

  function installUiTextNormalizer() {
    normalizeDomSubtree(document.body);
    const mo = new MutationObserver((records) => {
      for (const rec of records) {
        if (rec.type === "characterData" && rec.target && rec.target.nodeType === 3) {
          const cur = String(rec.target.nodeValue || "");
          const fixed = normalizeUiText(cur);
          if (fixed !== cur) rec.target.nodeValue = fixed;
          continue;
        }
        if (rec.type === "childList") {
          for (const node of rec.addedNodes || []) {
            if (node && node.nodeType === 1) normalizeDomSubtree(node);
          }
          continue;
        }
        if (rec.type === "attributes" && rec.target && rec.target.nodeType === 1) {
          normalizeDomSubtree(rec.target);
        }
      }
    });

    mo.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["title", "placeholder", "value"]
    });

    if (global.Konva && global.Konva.Text && global.Konva.Text.prototype) {
      const proto = global.Konva.Text.prototype;
      if (!proto.__uiTextPatched && typeof proto.setAttr === "function") {
        const setAttrOrig = proto.setAttr;
        proto.setAttr = function setAttrPatched(key, val) {
          if (key === "text" && typeof val === "string") {
            return setAttrOrig.call(this, key, normalizeUiText(val));
          }
          return setAttrOrig.call(this, key, val);
        };
        proto.__uiTextPatched = true;
      }
    }
  }

  global.FurLabText = Object.assign({}, global.FurLabText || {}, {
    normalizeUiText,
    normalizeDomSubtree,
    installUiTextNormalizer
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installUiTextNormalizer, { once: true });
  } else {
    installUiTextNormalizer();
  }
})(window);
