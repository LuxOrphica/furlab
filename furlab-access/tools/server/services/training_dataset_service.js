"use strict";

function createTrainingDatasetService(deps) {
  const { fs, path, crypto, rootDir, dbPathOverride } = deps;

  const defaultDbPath = path.join(rootDir, "data", "training", "annotations.ndjson");
  const dbPath = String(dbPathOverride || "").trim() || defaultDbPath;
  const imagesDir = path.join(path.dirname(dbPath), "images");

  function ensureDbReady() {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(imagesDir, { recursive: true });
    if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, "", "utf8");
  }

  function safeFileBase(name) {
    const raw = String(name || "").trim() || "scan";
    const ext = path.extname(raw);
    const base = path.basename(raw, ext);
    const cleanBase = String(base || "scan").replace(/[^\w\-\.]+/g, "_").slice(0, 120) || "scan";
    const cleanExt = String(ext || "").toLowerCase();
    if (cleanExt && /^[.][a-z0-9]{1,10}$/.test(cleanExt)) return { base: cleanBase, ext: cleanExt };
    return { base: cleanBase, ext: ".png" };
  }

  function guessExtByMime(mime) {
    const m = String(mime || "").toLowerCase();
    if (m.includes("jpeg") || m.includes("jpg")) return ".jpg";
    if (m.includes("webp")) return ".webp";
    if (m.includes("bmp")) return ".bmp";
    if (m.includes("gif")) return ".gif";
    if (m.includes("png")) return ".png";
    return ".png";
  }

  function saveTrainingSourceImage(sourceImage, fallbackName) {
    if (!sourceImage || typeof sourceImage !== "object") return null;
    const dataBase64 = String(sourceImage.dataBase64 || "").trim();
    if (!dataBase64) return null;
    const mime = String(sourceImage.mimeType || "").trim();
    const hintName = String(sourceImage.fileName || fallbackName || "").trim();
    const parsed = safeFileBase(hintName);
    const ext = path.extname(parsed.base + parsed.ext) ? parsed.ext : guessExtByMime(mime);
    let buf = null;
    try {
      buf = Buffer.from(dataBase64, "base64");
    } catch (_) {
      return null;
    }
    if (!buf || !buf.length) return null;
    const hash = crypto.createHash("sha1").update(buf).digest("hex");
    const fileName = `${parsed.base}_${hash.slice(0, 10)}${ext}`;
    const filePath = path.join(imagesDir, fileName);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, buf);
    }
    return {
      fileName,
      absPath: filePath,
      relPath: path.relative(rootDir, filePath).replace(/\\/g, "/"),
      sha1: hash
    };
  }

  function safeNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function normalizePoint(p) {
    if (!p || typeof p !== "object") return null;
    const x = safeNum(p.x);
    const y = safeNum(p.y);
    if (x === null || y === null) return null;
    return { x, y };
  }

  function readAll() {
    ensureDbReady();
    const text = String(fs.readFileSync(dbPath, "utf8") || "");
    if (!text.trim()) return [];
    const rows = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const s = String(line || "").trim();
      if (!s) continue;
      try {
        const row = JSON.parse(s);
        if (row && typeof row === "object") rows.push(row);
      } catch (_) {}
    }
    return rows;
  }

  function writeAll(rows) {
    ensureDbReady();
    const lines = Array.isArray(rows) ? rows.map((r) => JSON.stringify(r)).join("\n") : "";
    fs.writeFileSync(dbPath, lines ? `${lines}\n` : "", "utf8");
  }

  function round3(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.round(x * 1000) / 1000;
  }

  function contourHash(points) {
    const arr = Array.isArray(points) ? points : [];
    const packed = arr.map((p) => [round3(p?.x), round3(p?.y)]);
    return crypto.createHash("sha1").update(JSON.stringify(packed)).digest("hex");
  }

  function annotationSignature(input) {
    const sourceImageName = String(input?.sourceImageName || "").trim().toLowerCase();
    const inventoryTag = String(input?.inventoryTag || "").trim().toUpperCase();
    const imageWidth = safeNum(input?.imageWidth) || 0;
    const imageHeight = safeNum(input?.imageHeight) || 0;
    const baseId = sourceImageName || `${inventoryTag}|${imageWidth}x${imageHeight}`;
    const hash = contourHash(input?.contourPoints || []);
    return `${baseId}|${hash}`;
  }

  function listAnnotations(query) {
    const limitRaw = Number(query?.get?.("limit") || 100);
    const offsetRaw = Number(query?.get?.("offset") || 0);
    const limit = Math.max(1, Math.min(1000, Number.isFinite(limitRaw) ? limitRaw : 100));
    const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);
    const inventoryTag = String(query?.get?.("inventoryTag") || "").trim().toUpperCase();
    const sourceImageName = String(query?.get?.("sourceImageName") || "").trim();

    let items = readAll();
    if (inventoryTag) {
      items = items.filter((it) => String(it?.inventoryTag || "").trim().toUpperCase() === inventoryTag);
    }
    if (sourceImageName) {
      items = items.filter((it) => String(it?.sourceImageName || "").trim() === sourceImageName);
    }
    const total = items.length;
    const page = items.slice(offset, offset + limit);
    return { ok: true, items: page, total, limit, offset, dbPath };
  }

  function stats() {
    const items = readAll();
    const byPipeline = {};
    for (const it of items) {
      const p = String(it?.pipelineVersion || "unknown");
      byPipeline[p] = Number(byPipeline[p] || 0) + 1;
    }
    return {
      ok: true,
      total: items.length,
      byPipeline,
      dbPath
    };
  }

  function saveAnnotation(payload) {
    if (!payload || typeof payload !== "object") return { ok: false, error: "payload_required" };
    const contourPointsRaw = Array.isArray(payload.contourPoints) ? payload.contourPoints : [];
    const contourPoints = contourPointsRaw.map(normalizePoint).filter(Boolean);
    if (contourPoints.length < 3) return { ok: false, error: "contour_points_required" };

    const imageWidth = safeNum(payload.imageWidth);
    const imageHeight = safeNum(payload.imageHeight);
    if (imageWidth === null || imageHeight === null || imageWidth <= 0 || imageHeight <= 0) {
      return { ok: false, error: "image_size_invalid" };
    }

    const draft = {
      inventoryTag: String(payload.inventoryTag || "").trim().toUpperCase(),
      sourceImageName: String(payload.sourceImageName || "").trim(),
      imageWidth,
      imageHeight,
      contourPoints
    };
    const sig = annotationSignature(draft);
    const overwrite = !!payload.overwrite;
    const rows = readAll();
    const existing = rows.find((r) => annotationSignature(r) === sig);
    if (existing && !overwrite) {
      return {
        ok: false,
        error: "annotation_exists",
        canOverwrite: true,
        existing: {
          id: String(existing.id || ""),
          createdAt: String(existing.createdAt || ""),
          sourceImageName: String(existing.sourceImageName || ""),
          inventoryTag: String(existing.inventoryTag || "")
        }
      };
    }

    const savedImage = saveTrainingSourceImage(payload.sourceImage, draft.sourceImageName);
    const row = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      inventoryTag: draft.inventoryTag,
      sourceImageName: String((savedImage && savedImage.fileName) || draft.sourceImageName || "").trim(),
      sourceImagePath: String((savedImage && savedImage.relPath) || payload.sourceImagePath || "").trim(),
      sourceImageHash: String((savedImage && savedImage.sha1) || payload.sourceImageHash || "").trim(),
      imageWidth,
      imageHeight,
      contourPoints,
      pipelineVersion: String(payload.pipelineVersion || "").trim() || "manual-edit",
      algorithmVersion: String(payload.algorithmVersion || "").trim(),
      note: String(payload.note || "").trim(),
      metrics: payload.metrics && typeof payload.metrics === "object" ? payload.metrics : null
    };

    if (existing && overwrite) {
      const filtered = rows.filter((r) => annotationSignature(r) !== sig);
      filtered.push(row);
      writeAll(filtered);
      return { ok: true, item: row, overwritten: true, dbPath, imagesDir };
    }

    ensureDbReady();
    fs.appendFileSync(dbPath, `${JSON.stringify(row)}\n`, "utf8");
    return { ok: true, item: row, overwritten: false, dbPath, imagesDir };
  }

  return {
    listAnnotations,
    saveAnnotation,
    getStats: stats
  };
}

module.exports = {
  createTrainingDatasetService
};
