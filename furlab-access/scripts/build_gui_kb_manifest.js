const fs = require("fs");
const path = require("path");

const vaultPath =
  process.env.GUI_KB_PATH ||
  "F:/\u041f\u0440\u043e\u0435\u043a\u0442\u044b \u041e\u0431\u0441\u0438\u0434\u0438\u0430\u043d/MD-\u0444\u0430\u0439\u043b\u044b/GUI";
const outRoot = path.resolve(__dirname, "../ui-lab/gui-kb/data");
const outFile = path.join(outRoot, "notes-data.js");
const outAssetsDir = path.join(outRoot, "assets");
const imageExt = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
const cp1251Decoder = new TextDecoder("windows-1251");
const cp1251Inverse = (() => {
  const map = new Map();
  for (let i = 0; i < 256; i += 1) {
    const ch = cp1251Decoder.decode(Uint8Array.of(i));
    if (!map.has(ch)) map.set(ch, i);
  }
  return map;
})();

function walk(dir) {
  const result = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".obsidian") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walk(fullPath));
    } else {
      result.push(fullPath);
    }
  }
  return result;
}

function readSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath);
    const text = raw.toString("utf8");
    return normalizeText(text);
  } catch {
    return "";
  }
}

function cp1251EncodeFromString(str) {
  const bytes = [];
  for (const ch of str) {
    bytes.push(cp1251Inverse.has(ch) ? cp1251Inverse.get(ch) : 0x3f);
  }
  return Buffer.from(bytes);
}

function mojibakeScore(str) {
  const m = str.match(/(?:Р[А-Яа-яЁё]|С[А-Яа-яЁё]|вЂ|п»ї|пїЅ|�)/g);
  return m ? m.length : 0;
}

function cyrillicScore(str) {
  const m = str.match(/[А-Яа-яЁё]/g);
  return m ? m.length : 0;
}

function commonRussianWordsScore(str) {
  const m = str.match(/\b(и|в|на|с|по|что|для|это|как|не|к|из|от)\b/giu);
  return m ? m.length : 0;
}

function textQualityScore(str) {
  const cyr = cyrillicScore(str);
  const moj = mojibakeScore(str);
  const common = commonRussianWordsScore(str);
  const rsCount = (str.match(/[РС]/g) || []).length;
  const rsRatio = cyr > 0 ? rsCount / cyr : 0;
  const replacements = (str.match(/[�]|пїЅ/g) || []).length;
  return common * 18 + cyr - moj * 14 - replacements * 25 - rsRatio * 220;
}

function tryRepairMojibake(str) {
  const scoreBefore = mojibakeScore(str);
  const cyrBefore = cyrillicScore(str);
  const rsRatioBefore = cyrBefore > 0 ? ((str.match(/[РС]/g) || []).length / cyrBefore) : 0;
  const hasReplacement = /[�]|пїЅ/.test(str);

  if (scoreBefore < 3 && rsRatioBefore < 0.18 && !hasReplacement) return str;

  const repaired = cp1251EncodeFromString(str).toString("utf8");
  if (rsRatioBefore > 0.22 || /Р[’ ]/.test(str)) {
    return repaired;
  }
  const beforeQuality = textQualityScore(str);
  const afterQuality = textQualityScore(repaired);

  if (afterQuality > beforeQuality) {
    return repaired;
  }
  return str;
}

function normalizeText(input) {
  let text = String(input || "");
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < 3; i += 1) {
    const repaired = tryRepairMojibake(text);
    if (repaired === text) break;
    text = repaired;
  }
  text = text
    .replace(/вЂ“/g, "–")
    .replace(/вЂ‘/g, "‑")
    .replace(/вЂ”/g, "—")
    .replace(/вЂ¦/g, "…")
    .replace(/вЂњ/g, "“")
    .replace(/вЂќ/g, "”")
    .replace(/вЂ™/g, "’")
    .replace(/В·/g, "·");
  text = text.replace(/^п»ї/, "");
  text = text.replace(/^\?(?=\r?\n|#|\*|$)/, "");
  return text;
}

function extractTitle(content, fallback) {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

function extractLinks(content) {
  const links = [];
  const regex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    const t = m[1].trim();
    if (t) links.push(t);
  }
  return Array.from(new Set(links));
}

function stripFrontmatter(content) {
  if (!content.startsWith("---\n")) return content;
  const second = content.indexOf("\n---", 4);
  if (second < 0) return content;
  return content.slice(second + 4).replace(/^\n/, "");
}

function copyAssets(allFiles) {
  fs.rmSync(outAssetsDir, { recursive: true, force: true });
  const assets = [];

  for (const filePath of allFiles) {
    const ext = path.extname(filePath).toLowerCase();
    if (!imageExt.has(ext)) continue;

    const rel = path.relative(vaultPath, filePath).replace(/\\/g, "/");
    const out = path.join(outAssetsDir, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(filePath, out);

    assets.push({
      name: path.basename(filePath),
      relPath: rel,
      webPath: `data/assets/${rel}`,
    });
  }

  assets.sort((a, b) => a.relPath.localeCompare(b.relPath, "ru"));
  return assets;
}

function build() {
  if (!fs.existsSync(vaultPath)) {
    throw new Error(`Vault path not found: ${vaultPath}`);
  }

  const allFiles = walk(vaultPath);
  const mdFiles = allFiles.filter((f) => f.toLowerCase().endsWith(".md"));

  const notes = mdFiles.map((filePath) => {
    const relRaw = path.relative(vaultPath, filePath).replace(/\\/g, "/");
    const rel = normalizeText(relRaw);
    const folder = rel.includes("/") ? rel.split("/")[0] : "root";
    const basename = normalizeText(path.basename(filePath, ".md"));
    const raw = readSafe(filePath);
    const body = stripFrontmatter(raw);
    return {
      id: relRaw,
      relPath: rel,
      folder,
      name: basename,
      title: extractTitle(body, basename),
      links: extractLinks(body),
      content: body,
    };
  });

  notes.sort((a, b) => a.relPath.localeCompare(b.relPath, "ru"));
  const assets = copyAssets(allFiles);

  const payload = {
    generatedAt: new Date().toISOString(),
    vaultPath,
    noteCount: notes.length,
    assetCount: assets.length,
    notes,
    assets,
  };

  const js = `window.GUI_KB_DATA = ${JSON.stringify(payload, null, 2)};\n`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, js, "utf8");

  console.log(`Generated: ${outFile}`);
  console.log(`Notes: ${notes.length}`);
  console.log(`Assets: ${assets.length}`);
}

build();
