"use strict";

const fs = require("fs");
const path = require("path");

function safeReadFurMaterials(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { version: 1, items: [] };
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed && parsed.items) ? parsed.items : [];
    return {
      version: Number(parsed && parsed.version || 1) || 1,
      items
    };
  } catch (_) {
    return { version: 1, items: [] };
  }
}

function normalizeMaterial(raw) {
  const item = raw && typeof raw === "object" ? raw : {};
  const text = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    id: text(item.id),
    name: text(item.name),
    category: text(item.category),
    species: text(item.species),
    colorHex: text(item.colorHex),
    melanin: num(item.melanin),
    pheomelanin: num(item.pheomelanin),
    maxLengthMm: num(item.maxLengthMm),
    maxWidthMm: num(item.maxWidthMm),
    thicknessMm: num(item.thicknessMm),
    gloss: num(item.gloss),
    softness: num(item.softness),
    fluffiness: num(item.fluffiness),
    pileLengthMm: num(item.pileLengthMm),
    hairThicknessMm: num(item.hairThicknessMm),
    pileDensityPerIn2: num(item.pileDensityPerIn2),
    taper: num(item.taper),
    segmentationCount: num(item.segmentationCount),
    hairBend: num(item.hairBend),
    bendSpread: num(item.bendSpread),
    curlRadiusMm: num(item.curlRadiusMm),
    curlEffect: num(item.curlEffect),
    elasticity: num(item.elasticity),
    stretch: num(item.stretch),
    weightGm2: num(item.weightGm2),
    thumbnail: text(item.thumbnail)
  };
}

async function handleFurMaterialRoutes(req, res, reqUrl, deps) {
  const jsonReply = deps && deps.jsonReply;
  const ROOT_DIR = deps && deps.ROOT_DIR;
  if (typeof jsonReply !== "function" || !ROOT_DIR) {
    throw new Error("fur_material_routes_deps_missing");
  }

  const filePath = path.join(ROOT_DIR, "data", "fur_materials.json");
  const store = safeReadFurMaterials(filePath);
  const items = store.items.map(normalizeMaterial).filter((x) => x.id);

  if (req.method === "GET" && reqUrl.pathname === "/api/fur-materials") {
    return jsonReply(res, 200, {
      ok: true,
      version: store.version,
      items
    });
  }

  if (req.method === "GET" && reqUrl.pathname.indexOf("/api/fur-materials/") === 0) {
    const id = decodeURIComponent(String(reqUrl.pathname.slice("/api/fur-materials/".length) || "").trim());
    const item = items.find((x) => String(x.id) === id) || null;
    if (!item) {
      return jsonReply(res, 404, { ok: false, error: "fur_material_not_found" });
    }
    return jsonReply(res, 200, { ok: true, item });
  }

  return false;
}

module.exports = {
  handleFurMaterialRoutes
};
