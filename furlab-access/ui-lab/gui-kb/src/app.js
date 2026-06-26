(function () {
  const data = window.GUI_KB_DATA;
  if (!data || !Array.isArray(data.notes)) {
    document.body.innerHTML = "<p>Нет данных. Сначала запустите генерацию.</p>";
    return;
  }

  const cp1251Inverse = (() => {
    const map = new Map();
    try {
      const decoder = new TextDecoder("windows-1251");
      for (let i = 0; i < 256; i += 1) {
        const ch = decoder.decode(Uint8Array.of(i));
        if (!map.has(ch)) map.set(ch, i);
      }
    } catch {
      return null;
    }
    return map;
  })();

  function decodeCp1251Mojibake(str) {
    if (!cp1251Inverse) return str;
    const bytes = [];
    for (const ch of str) {
      bytes.push(cp1251Inverse.has(ch) ? cp1251Inverse.get(ch) : 0x3f);
    }
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  }

  function mojibakeQuality(str) {
    const s = String(str || "");
    const markers = (s.match(/(?:Р[А-Яа-яЁё]|С[А-Яа-яЁё]|Р[’ ]|вЂ|пїЅ|рџ|в”|�)/g) || []).length;
    const cyr = (s.match(/[А-Яа-яЁё]/g) || []).length;
    const replacements = (s.match(/�/g) || []).length;
    const qRuns = (s.match(/\?{3,}/g) || []).length;
    const commonWords = (s.match(/\b(и|в|на|с|по|что|для|это|как|не|к|из|от)\b/giu) || []).length;
    return cyr + commonWords * 20 - markers * 15 - replacements * 40 - qRuns * 20;
  }

  function fixMojibake(input) {
    let s = String(input || "");
    s = s.replace(/^\uFEFF/, "");
    for (let i = 0; i < 3; i += 1) {
      const fixed = decodeCp1251Mojibake(s);
      if (fixed === s) break;
      const before = mojibakeQuality(s);
      const after = mojibakeQuality(fixed);
      if (after <= before + 5) break;
      s = fixed;
    }
    return s
      .replace(/^п»ї/, "")
      .replace(/вЂ“/g, "–")
      .replace(/вЂ‘/g, "‑")
      .replace(/вЂ”/g, "—")
      .replace(/вЂ¦/g, "…")
      .replace(/вЂњ/g, "“")
      .replace(/вЂќ/g, "”")
      .replace(/вЂ™/g, "’")
      .replace(/В·/g, "·");
  }

  data.notes = data.notes.map((n) => ({
    ...n,
    relPath: fixMojibake(n.relPath),
    folder: fixMojibake(n.folder),
    name: fixMojibake(n.name),
    title: fixMojibake(n.title),
    links: Array.isArray(n.links) ? n.links.map((x) => fixMojibake(x)) : [],
    content: fixMojibake(n.content),
  }));
  data.assets = Array.isArray(data.assets)
    ? data.assets.map((a) => ({
        ...a,
        name: fixMojibake(a.name),
        relPath: fixMojibake(a.relPath),
      }))
    : [];

  const byId = new Map();
  const byName = new Map();
  const byNameLower = new Map();
  data.notes.forEach((n) => {
    byId.set(n.id, n);
    if (!byName.has(n.name)) byName.set(n.name, n);
    if (!byNameLower.has(n.name.toLowerCase())) byNameLower.set(n.name.toLowerCase(), n);
  });

  const assets = Array.isArray(data.assets) ? data.assets : [];
  const assetsByName = new Map();
  const assetsByRel = new Map();
  assets.forEach((a) => {
    if (!assetsByName.has(a.name)) assetsByName.set(a.name, a);
    assetsByRel.set(a.relPath.toLowerCase(), a);
  });

  const state = {
    query: "",
    currentId: data.notes[0] ? data.notes[0].id : null,
    view: "note",
    yearFilter: null,
  };

  const metaEl = document.getElementById("meta");
  const navEl = document.getElementById("nav");
  const articleEl = document.getElementById("article");
  const imageRailEl = document.getElementById("imageRail");
  const searchEl = document.getElementById("search");
  const noteViewEl = document.getElementById("noteView");
  const graphViewEl = document.getElementById("graphView");
  const timelineViewEl = document.getElementById("timelineView");
  const viewNoteBtn = document.getElementById("viewNoteBtn");
  const viewGraphBtn = document.getElementById("viewGraphBtn");
  const viewTimelineBtn = document.getElementById("viewTimelineBtn");
  const graphCanvas = document.getElementById("graphCanvas");
  const graphMeta = document.getElementById("graphMeta");
  const timelineMetaEl = document.getElementById("timelineMeta");
  const timelineListEl = document.getElementById("timelineList");
  const sidebarTimelineEl = document.getElementById("sidebarTimeline");

  metaEl.textContent = `${data.noteCount} заметок, ${data.assetCount || 0} ассетов, обновлено ${new Date(data.generatedAt).toLocaleString("ru-RU")}`;

  const graph = buildGraph();
  const timeline = buildTimeline();
  let graphHitNodes = [];

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function resolveNote(target) {
    const trimmed = String(target || "").trim();
    return byName.get(trimmed) || byNameLower.get(trimmed.toLowerCase()) || null;
  }

  function resolveAsset(target) {
    const trimmed = String(target || "").trim().replace(/\\/g, "/");
    const lower = trimmed.toLowerCase();
    const byRel = assetsByRel.get(lower);
    if (byRel) return encodeURI(byRel.webPath);
    const fileName = trimmed.split("/").pop();
    const byNameAsset = assetsByName.get(fileName);
    if (byNameAsset) return encodeURI(byNameAsset.webPath);
    return null;
  }

  function renderInline(text) {
    let s = escapeHtml(text);

    s = s.replace(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (_, target) => {
      const src = resolveAsset(target);
      if (!src) return `<span class="broken">![[${escapeHtml(target)}]]</span>`;
      return `<img class="md-image" src="${src}" alt="${escapeHtml(target)}" loading="lazy" />`;
    });

    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => `<img class="md-image" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" />`);

    s = s.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (m, target, alias) => {
      const key = String(target || "").trim();
      const label = (alias || key).trim();
      const note = resolveNote(key);
      if (!note) return `<span class="broken">${escapeHtml(label)}</span>`;
      return `<a href="#" class="wikilink" data-target-id="${note.id}">${escapeHtml(label)}</a>`;
    });

    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`);
    s = s.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    return s;
  }

  function isTableHeader(lines, i) {
    if (i + 1 >= lines.length) return false;
    const a = lines[i].trim();
    const b = lines[i + 1].trim();
    return a.startsWith("|") && b.startsWith("|") && /\|?\s*:?-{3,}:?\s*\|/.test(b);
  }

  function parseTableRow(line) {
    return line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  }

  function renderMarkdown(md) {
    const lines = String(md || "").replace(/\r/g, "").split("\n");
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Image blocks are rendered in the right rail to avoid duplicates in the main article.
      if (
        /^!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/.test(trimmed) ||
        /^!\[[^\]]*\]\([^)]+\)$/.test(trimmed) ||
        /^\*\*!?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]\*\*$/.test(trimmed)
      ) {
        i += 1;
        continue;
      }

      if (!trimmed) {
        i += 1;
        continue;
      }

      if (trimmed.startsWith("```")) {
        const lang = trimmed.slice(3).trim();
        const code = [];
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith("```")) {
          code.push(lines[i]);
          i += 1;
        }
        i += 1;
        out.push(`<pre><code class="lang-${escapeHtml(lang)}">${escapeHtml(code.join("\n"))}</code></pre>`);
        continue;
      }

      if (isTableHeader(lines, i)) {
        const head = parseTableRow(lines[i]);
        i += 2;
        const body = [];
        while (i < lines.length && lines[i].trim().startsWith("|")) {
          body.push(parseTableRow(lines[i]));
          i += 1;
        }
        const thead = `<thead><tr>${head.map((h) => `<th>${renderInline(h)}</th>`).join("")}</tr></thead>`;
        const tbody = `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;
        out.push(`<div class="table-wrap"><table>${thead}${tbody}</table></div>`);
        continue;
      }

      const h = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (h) {
        const level = h[1].length;
        out.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
        i += 1;
        continue;
      }

      if (/^\s*([-*+]\s+.+|\d+\.\s+.+)$/.test(trimmed)) {
        const items = [];
        let ordered = /^\d+\./.test(trimmed);
        while (i < lines.length && /^\s*([-*+]\s+.+|\d+\.\s+.+)$/.test(lines[i].trim())) {
          const t = lines[i].trim();
          ordered = ordered || /^\d+\./.test(t);
          items.push(t.replace(/^([-*+]\s+|\d+\.\s+)/, ""));
          i += 1;
        }
        const tag = ordered ? "ol" : "ul";
        out.push(`<${tag}>${items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</${tag}>`);
        continue;
      }

      if (trimmed.startsWith(">")) {
        const quote = [];
        while (i < lines.length && lines[i].trim().startsWith(">")) {
          quote.push(lines[i].trim().replace(/^>\s?/, ""));
          i += 1;
        }
        out.push(`<blockquote>${quote.map((q) => `<p>${renderInline(q)}</p>`).join("")}</blockquote>`);
        continue;
      }

      if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
        out.push("<hr />");
        i += 1;
        continue;
      }

      const para = [line];
      i += 1;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!t || t.startsWith("#") || t.startsWith("```") || t.startsWith(">") || isTableHeader(lines, i) || /^\s*([-*+]\s+.+|\d+\.\s+.+)$/.test(t) || /^(-{3,}|\*{3,})$/.test(t)) {
          break;
        }
        para.push(lines[i]);
        i += 1;
      }
      out.push(`<p>${renderInline(para.join(" "))}</p>`);
    }

    return out.join("\n");
  }

  function groupedNotes() {
    const q = state.query.trim().toLowerCase();
    const list = data.notes.filter((n) => {
      if (state.yearFilter !== null) {
        const allowed = timeline.noteIdsByYear.get(Number(state.yearFilter));
        if (!allowed || !allowed.has(n.id)) return false;
      }
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) ||
        n.name.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q)
      );
    });

    const map = new Map();
    list.forEach((n) => {
      if (!map.has(n.folder)) map.set(n.folder, []);
      map.get(n.folder).push(n);
    });
    return map;
  }

  function renderNav() {
    const groups = groupedNotes();
    const folders = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, "ru"));
    navEl.innerHTML = folders.map((folder) => {
      const links = groups.get(folder)
        .sort((a, b) => a.title.localeCompare(b.title, "ru"))
        .map((n) => `<a href="#" class="nav-link ${n.id === state.currentId ? "active" : ""}" data-id="${n.id}">${n.title}</a>`)
        .join("");
      return `<section class="folder"><h3>${folder}</h3>${links}</section>`;
    }).join("");
  }

  function collectNoteImages(note) {
    const images = [];
    const seen = new Set();
    const text = String(note.content || "");

    const obsidianImgRe = /!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let m;
    while ((m = obsidianImgRe.exec(text)) !== null) {
      const target = String(m[1] || "").trim();
      const src = resolveAsset(target);
      if (!src || seen.has(src)) continue;
      seen.add(src);
      images.push({ src, label: target });
    }

    const mdImgRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
    while ((m = mdImgRe.exec(text)) !== null) {
      const label = String(m[1] || "").trim() || "image";
      const src = String(m[2] || "").trim();
      if (!src || seen.has(src)) continue;
      seen.add(src);
      images.push({ src, label });
    }

    (note.links || []).forEach((target) => {
      const src = resolveAsset(target);
      if (!src || seen.has(src)) return;
      seen.add(src);
      images.push({ src, label: target });
    });

    return images;
  }

  function renderImageRail(note) {
    const imgs = collectNoteImages(note);
    if (!imgs.length) {
      imageRailEl.innerHTML = `<h3>Картинки</h3><div class="rail-empty">Для этой заметки изображения не найдены.</div>`;
      return;
    }
    imageRailEl.innerHTML = `
      <h3>Картинки (${imgs.length})</h3>
      <div class="image-grid">
        ${imgs.map((img) => `
          <a class="rail-item" href="${escapeHtml(img.src)}" target="_blank" rel="noopener noreferrer">
            <img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.label)}" loading="lazy" />
            <div class="rail-cap">${escapeHtml(img.label)}</div>
          </a>
        `).join("")}
      </div>
    `;
  }

  function renderArticle() {
    const note = byId.get(state.currentId) || data.notes[0];
    if (!note) {
      articleEl.innerHTML = "<p>Нет заметок</p>";
      return;
    }
    state.currentId = note.id;
    const linksLine = note.links.length ? `<p><b>Ссылки:</b> ${note.links.map((l) => escapeHtml(l)).join(", ")}</p>` : "";
    articleEl.innerHTML = `
      <h1>${escapeHtml(note.title)}</h1>
      <p><small>${escapeHtml(note.relPath)}</small></p>
      ${linksLine}
      <hr />
      ${renderMarkdown(note.content)}
    `;

    articleEl.querySelectorAll("a.wikilink").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const id = a.getAttribute("data-target-id");
        if (!id) return;
        state.currentId = id;
        state.view = "note";
        updateView();
        renderNav();
        renderArticle();
        drawGraph();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
    renderImageRail(note);
  }

  function buildGraph() {
    const nodes = data.notes.map((n) => ({ id: n.id, title: n.title, name: n.name, folder: n.folder, degree: 0 }));
    const idToNode = new Map(nodes.map((n) => [n.id, n]));
    const byNameLocal = new Map();
    data.notes.forEach((n) => {
      if (!byNameLocal.has(n.name)) byNameLocal.set(n.name, n);
    });

    const seen = new Set();
    const edges = [];
    data.notes.forEach((n) => {
      n.links.forEach((target) => {
        const t = byNameLocal.get(target);
        if (!t) return;
        const a = n.id < t.id ? n.id : t.id;
        const b = n.id < t.id ? t.id : n.id;
        const key = `${a}__${b}`;
        if (a === b || seen.has(key)) return;
        seen.add(key);
        edges.push({ from: a, to: b });
      });
    });

    edges.forEach((e) => {
      const a = idToNode.get(e.from);
      const b = idToNode.get(e.to);
      if (a) a.degree += 1;
      if (b) b.degree += 1;
    });

    return { nodes, edges };
  }

  function noteKind(note) {
    if (note.folder === "10_Concepts") return "Concept";
    if (note.folder === "20_Styles") return "Style";
    if (note.folder === "30_Products") return "Product";
    if (note.folder === "50_Timeline") return "Timeline";
    return "Other";
  }

  function extractYearCandidates(text) {
    const years = new Set();
    const s = String(text || "");
    const re = /\b(19[0-9]{2}|20[0-9]{2}|21[0-9]{2})\b/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const y = Number(m[1]);
      if (y >= 1950 && y <= 2030) years.add(y);
    }
    return Array.from(years).sort((a, b) => a - b);
  }

  function chooseYear(note) {
    const years = [
      ...extractYearCandidates(note.content.slice(0, 800)),
      ...extractYearCandidates(note.title),
      ...extractYearCandidates(note.relPath),
    ];
    if (!years.length) return null;
    return years[0];
  }

  function buildTimeline() {
    const items = data.notes
      .map((note) => ({ note, year: chooseYear(note), kind: noteKind(note) }))
      .filter((x) => x.year !== null && ["Concept", "Style", "Product", "Timeline"].includes(x.kind));

    const byYear = new Map();
    const noteIdsByYear = new Map();
    items.forEach((x) => {
      if (!byYear.has(x.year)) byYear.set(x.year, []);
      byYear.get(x.year).push(x);
      if (!noteIdsByYear.has(x.year)) noteIdsByYear.set(x.year, new Set());
      noteIdsByYear.get(x.year).add(x.note.id);
    });

    const years = Array.from(byYear.keys()).sort((a, b) => a - b);
    years.forEach((year) => {
      byYear.get(year).sort((a, b) => {
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind, "en");
        return a.note.title.localeCompare(b.note.title, "ru");
      });
    });

    return { byYear, years, total: items.length, noteIdsByYear };
  }

  function renderTimeline() {
    timelineMetaEl.textContent = `Связующая нить эволюции: ${timeline.total} событий, период ${timeline.years[0] || "?"}–${timeline.years[timeline.years.length - 1] || "?"}.`;
    timelineListEl.innerHTML = timeline.years.map((year) => {
      const items = timeline.byYear.get(year) || [];
      return `
        <section class="timeline-block" id="tl-year-${year}">
          <h2 class="timeline-year">${year}</h2>
          <div class="timeline-items">
            ${items.map((x) => `
              <a href="#" class="timeline-item" data-id="${x.note.id}">
                <span class="timeline-tag">${x.kind}</span>
                <div class="timeline-title">${escapeHtml(x.note.title)}</div>
                <div class="timeline-path">${escapeHtml(x.note.relPath)}</div>
              </a>
            `).join("")}
          </div>
        </section>
      `;
    }).join("");
  }

  function renderSidebarTimeline() {
    const allClass = state.yearFilter === null ? "year-chip active" : "year-chip";
    sidebarTimelineEl.innerHTML = `<a href="#" class="${allClass}" data-year="">Все</a>` + timeline.years
      .map((year) => {
        const count = (timeline.byYear.get(year) || []).length;
        const cls = Number(state.yearFilter) === year ? "year-chip active" : "year-chip";
        return `<a href="#" class="${cls}" data-year="${year}">${year} · ${count}</a>`;
      })
      .join("");
  }

  function setCanvasSize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = graphCanvas.getBoundingClientRect();
    graphCanvas.width = Math.max(300, Math.floor(rect.width * dpr));
    graphCanvas.height = Math.max(260, Math.floor(rect.height * dpr));
    const ctx = graphCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawGraph() {
    if (state.view !== "graph") return;

    setCanvasSize();
    const ctx = graphCanvas.getContext("2d");
    const w = graphCanvas.clientWidth;
    const h = graphCanvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const nodes = graph.nodes;
    const edges = graph.edges;
    const folders = Array.from(new Set(nodes.map((n) => n.folder))).sort((a, b) => a.localeCompare(b, "ru"));
    const folderIndex = new Map(folders.map((f, idx) => [f, idx]));

    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.33;
    const groupCenters = new Map();

    folders.forEach((folder, i) => {
      const ang = (i / Math.max(1, folders.length)) * Math.PI * 2;
      groupCenters.set(folder, {
        x: cx + Math.cos(ang) * R,
        y: cy + Math.sin(ang) * R,
      });
    });

    const nodesByFolder = new Map();
    nodes.forEach((n) => {
      if (!nodesByFolder.has(n.folder)) nodesByFolder.set(n.folder, []);
      nodesByFolder.get(n.folder).push(n);
    });

    graphHitNodes = [];
    const pos = new Map();

    nodesByFolder.forEach((arr, folder) => {
      const c = groupCenters.get(folder);
      const localR = Math.max(18, Math.min(80, 10 + arr.length * 1.8));
      arr.sort((a, b) => a.title.localeCompare(b.title, "ru"));
      arr.forEach((n, i) => {
        const ang = (i / Math.max(1, arr.length)) * Math.PI * 2;
        const x = c.x + Math.cos(ang) * localR;
        const y = c.y + Math.sin(ang) * localR;
        pos.set(n.id, { x, y });
      });
    });

    ctx.strokeStyle = "rgba(82, 102, 120, 0.23)";
    ctx.lineWidth = 1;
    edges.forEach((e) => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) return;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });

    nodes.forEach((n) => {
      const p = pos.get(n.id);
      if (!p) return;
      const active = n.id === state.currentId;
      const r = active ? 6 : Math.min(5, 3 + Math.log2(1 + n.degree));
      const hue = (folderIndex.get(n.folder) * 43) % 360;
      ctx.fillStyle = active ? "#d1563d" : `hsl(${hue}deg 58% 45%)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();

      if (active) {
        ctx.strokeStyle = "rgba(209, 86, 61, 0.35)";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      graphHitNodes.push({ id: n.id, x: p.x, y: p.y, r: r + 4, title: n.title });
    });

    graphMeta.textContent = `Узлы: ${nodes.length}, связи: ${edges.length}. Нажмите на узел, чтобы открыть заметку.`;
  }

  function updateView() {
    const note = state.view === "note";
    const graphMode = state.view === "graph";
    const timelineMode = state.view === "timeline";
    noteViewEl.classList.toggle("active", note);
    graphViewEl.classList.toggle("active", graphMode);
    timelineViewEl.classList.toggle("active", timelineMode);
    viewNoteBtn.classList.toggle("active", note);
    viewGraphBtn.classList.toggle("active", graphMode);
    viewTimelineBtn.classList.toggle("active", timelineMode);
    if (graphMode) drawGraph();
    if (timelineMode) renderTimeline();
  }

  navEl.addEventListener("click", (e) => {
    const target = e.target.closest("a.nav-link");
    if (!target) return;
    e.preventDefault();
    state.currentId = target.getAttribute("data-id");
    state.view = "note";
    renderNav();
    renderArticle();
    updateView();
  });

  viewNoteBtn.addEventListener("click", () => {
    state.view = "note";
    updateView();
  });

  viewGraphBtn.addEventListener("click", () => {
    state.view = "graph";
    updateView();
  });

  viewTimelineBtn.addEventListener("click", () => {
    state.view = "timeline";
    updateView();
  });

  graphCanvas.addEventListener("click", (e) => {
    const rect = graphCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best = null;
    for (const n of graphHitNodes) {
      const dx = x - n.x;
      const dy = y - n.y;
      if (Math.sqrt(dx * dx + dy * dy) <= n.r) {
        best = n;
        break;
      }
    }
    if (!best) return;
    state.currentId = best.id;
    state.view = "note";
    updateView();
    renderNav();
    renderArticle();
    drawGraph();
  });

  searchEl.addEventListener("input", () => {
    state.query = searchEl.value;
    renderNav();
  });

  sidebarTimelineEl.addEventListener("click", (e) => {
    const chip = e.target.closest("a.year-chip");
    if (!chip) return;
    e.preventDefault();
    const year = chip.getAttribute("data-year");
    state.yearFilter = year ? Number(year) : null;
    renderSidebarTimeline();
    renderNav();
    const groups = groupedNotes();
    const firstGroup = groups.values().next().value;
    const firstNote = firstGroup && firstGroup.length ? firstGroup[0] : null;
    if (firstNote) {
      state.currentId = firstNote.id;
      renderArticle();
    }
    if (!year) {
      state.view = "note";
      updateView();
      return;
    }
    state.view = "timeline";
    updateView();
    const target = document.getElementById(`tl-year-${year}`);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  timelineListEl.addEventListener("click", (e) => {
    const item = e.target.closest("a.timeline-item");
    if (!item) return;
    e.preventDefault();
    const id = item.getAttribute("data-id");
    if (!id) return;
    state.currentId = id;
    state.view = "note";
    renderNav();
    renderArticle();
    updateView();
  });

  window.addEventListener("resize", () => drawGraph());

  renderNav();
  renderSidebarTimeline();
  renderArticle();
  updateView();
})();
