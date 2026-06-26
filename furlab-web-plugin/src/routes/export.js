"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { generateGltfString, generateJfabString } = require("../services/clo_gltf_generator");

// ---------------------------------------------------------------------------
// DXF helpers (no external deps, minimal ENTITIES section)
// ---------------------------------------------------------------------------

function dxfHeader(units) {
  // INSUNITS 4 = mm
  return [
    "0", "SECTION",
    "2", "HEADER",
    "9", "$INSUNITS",
    "70", String(units === "mm" ? 4 : 0),
    "0", "ENDSEC"
  ].join("\n");
}

function dxfPolyline(points, layer, closed) {
  if (!Array.isArray(points) || points.length < 2) return "";
  const flag = closed ? 1 : 0;
  const lines = [
    "0", "LWPOLYLINE",
    "5", crypto.randomBytes(4).toString("hex").toUpperCase(),
    "100", "AcDbEntity",
    "8", String(layer || "0"),
    "100", "AcDbPolyline",
    "90", String(points.length),
    "70", String(flag)
  ];
  for (const p of points) {
    lines.push("10", String(Number(p.x || 0).toFixed(6)));
    lines.push("20", String(Number(p.y || 0).toFixed(6)));
  }
  return lines.join("\n");
}

function dxfText(x, y, text, layer) {
  return [
    "0", "TEXT",
    "5", crypto.randomBytes(4).toString("hex").toUpperCase(),
    "100", "AcDbEntity",
    "8", String(layer || "TEXT"),
    "100", "AcDbText",
    "10", String(Number(x || 0).toFixed(6)),
    "20", String(Number(y || 0).toFixed(6)),
    "30", "0.0",
    "40", "5.0",
    "1", String(text || "")
  ].join("\n");
}

function buildFragmentDxf(fragment, zone, zoneSeams) {
  const contourPoints = Array.isArray(fragment.points) ? fragment.points : [];
  const label = String(fragment.id || "");

  const entities = [
    dxfPolyline(contourPoints, "FRAGMENT_CONTOUR", true)
  ];

  if (Array.isArray(zoneSeams)) {
    for (const seam of zoneSeams) {
      const pts = Array.isArray(seam && seam.points) ? seam.points : [];
      if (pts.length >= 2) entities.push(dxfPolyline(pts, "SEAM_LINE", false));
    }
  }

  // Label at approximate centroid
  if (contourPoints.length >= 3) {
    const cx = contourPoints.reduce((s, p) => s + Number(p.x || 0), 0) / contourPoints.length;
    const cy = contourPoints.reduce((s, p) => s + Number(p.y || 0), 0) / contourPoints.length;
    entities.push(dxfText(cx, cy, label, "LABELS"));
  }

  return [
    dxfHeader("mm"),
    "0", "SECTION",
    "2", "ENTITIES",
    ...entities,
    "0", "ENDSEC",
    "0", "EOF"
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Seam computation (shared edges between adjacent fragments in the same zone)
// ---------------------------------------------------------------------------

function segKey(ax, ay, bx, by) {
  const p = `${ax.toFixed(2)},${ay.toFixed(2)}`;
  const q = `${bx.toFixed(2)},${by.toFixed(2)}`;
  return p < q ? `${p}|${q}` : `${q}|${p}`;
}

function computeSharedSeams(fragmentsInZone, tolMm) {
  const tol = Number(tolMm || 2);
  // Build edge -> fragmentId index
  const edgeIndex = new Map();

  for (const frag of fragmentsInZone) {
    const pts = Array.isArray(frag.points) ? frag.points : [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const key = segKey(Number(a.x), Number(a.y), Number(b.x), Number(b.y));
      if (!edgeIndex.has(key)) edgeIndex.set(key, []);
      edgeIndex.get(key).push({ fragId: String(frag.id || ""), a, b });
    }
  }

  const seams = [];
  for (const [, frags] of edgeIndex) {
    if (frags.length >= 2) {
      const { a, b } = frags[0];
      const dx = Number(b.x) - Number(a.x);
      const dy = Number(b.y) - Number(a.y);
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > tol) {
        seams.push({
          points: [{ x: Number(a.x), y: Number(a.y) }, { x: Number(b.x), y: Number(b.y) }],
          lengthMm: len,
          fragmentIds: frags.map((f) => f.fragId)
        });
      }
    }
  }
  return seams;
}

// ---------------------------------------------------------------------------
// ZIP builder (pure Node.js, no native deps — uses deflate via zlib)
// ---------------------------------------------------------------------------

function normalizePoint(p) {
  if (Array.isArray(p) && p.length >= 2) {
    const x = Number(p[0]);
    const y = Number(p[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  if (p && typeof p === "object") {
    const x = Number(p.x);
    const y = Number(p.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  return null;
}

function normalizeContourPoints(value) {
  if (!Array.isArray(value)) return [];
  const direct = value.map(normalizePoint).filter(Boolean);
  if (direct.length >= 3) return direct;

  const firstRing = Array.isArray(value[0]) && Array.isArray(value[0][0])
    ? (Array.isArray(value[0][0][0]) ? value[0][0] : value[0])
    : [];
  const ring = Array.isArray(firstRing) ? firstRing.map(normalizePoint).filter(Boolean) : [];
  if (ring.length >= 4) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first && last && first.x === last.x && first.y === last.y) return ring.slice(0, -1);
  }
  return ring.length >= 3 ? ring : [];
}

function getFragmentExportPoints(fragment) {
  if (!fragment || typeof fragment !== "object") return [];
  const candidates = [
    fragment.points,
    fragment.cutPoints,
    fragment.seamPoints,
    fragment.cleanPoints,
    fragment.fragmentContour,
    fragment.resultContourSnapshot,
    fragment.contour,
  ];
  for (const candidate of candidates) {
    const points = normalizeContourPoints(candidate);
    if (points.length >= 3) return points;
  }
  return [];
}

const zlib = require("zlib");

function uint16LE(n) { const b = Buffer.allocUnsafe(2); b.writeUInt16LE(n, 0); return b; }
function uint32LE(n) { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(n >>> 0, 0); return b; }

function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })());
  let crc = 0xFFFFFFFF;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeZipEntry(name, data) {
  const nameBuf = Buffer.from(name, "utf8");
  const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  const compressed = zlib.deflateRawSync(dataBuf, { level: 6 });
  const crc = crc32(dataBuf);
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

  const localHeader = Buffer.concat([
    Buffer.from("504b0304", "hex"),
    uint16LE(20), uint16LE(0x0800), uint16LE(8),
    uint16LE(dosTime), uint16LE(dosDate),
    uint32LE(crc),
    uint32LE(compressed.length),
    uint32LE(dataBuf.length),
    uint16LE(nameBuf.length),
    uint16LE(0),
    nameBuf,
    compressed
  ]);

  return { localHeader, crc, compressedSize: compressed.length, uncompressedSize: dataBuf.length, nameBuf, dosTime, dosDate };
}

function buildZip(files) {
  // files: [{ name, data }]
  const entries = files.map((f) => makeZipEntry(f.name, f.data));
  const localParts = [];
  const offsets = [];
  let offset = 0;
  for (const e of entries) {
    offsets.push(offset);
    localParts.push(e.localHeader);
    offset += e.localHeader.length;
  }

  const centralDirParts = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const cd = Buffer.concat([
      Buffer.from("504b0102", "hex"),
      uint16LE(20), uint16LE(20), uint16LE(0x0800), uint16LE(8),
      uint16LE(e.dosTime), uint16LE(e.dosDate),
      uint32LE(e.crc),
      uint32LE(e.compressedSize),
      uint32LE(e.uncompressedSize),
      uint16LE(e.nameBuf.length),
      uint16LE(0), uint16LE(0), uint16LE(0), uint16LE(0),
      uint32LE(0),
      uint32LE(offsets[i]),
      e.nameBuf
    ]);
    centralDirParts.push(cd);
  }

  const centralDir = Buffer.concat(centralDirParts);
  const eocd = Buffer.concat([
    Buffer.from("504b0506", "hex"),
    uint16LE(0), uint16LE(0),
    uint16LE(entries.length), uint16LE(entries.length),
    uint32LE(centralDir.length),
    uint32LE(offset),
    uint16LE(0)
  ]);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

// ---------------------------------------------------------------------------
// Export payload builder
// ---------------------------------------------------------------------------

function buildExportPayload(body) {
  const { zones = [], layouts = [], materials = {}, zoneScope, seamMode } = body;

  // Scope: "current" uses only the zoneId provided, "all" uses all zones
  const targetZoneIds = zoneScope === "current" && body.currentZoneId
    ? new Set([Number(body.currentZoneId)])
    : new Set(zones.map((z) => Number(z.id)));

  const resultFragments = []; // { id, zoneId, detailId, materialId, points, areaMm2 }
  const zoneMap = new Map(zones.map((z) => [Number(z.id), z]));

  // Collect applied fragments from layout runs
  for (const layout of layouts) {
    const zoneId = Number(layout.zoneId || 0);
    if (!targetZoneIds.has(zoneId)) continue;
    const zone = zoneMap.get(zoneId);
    const runs = Array.isArray(layout.runs) ? layout.runs : [];
    const lastRun = runs[runs.length - 1];
    if (!lastRun) continue;
    const frags = Array.isArray(lastRun.resultSnapshot && lastRun.resultSnapshot.fragments)
      ? lastRun.resultSnapshot.fragments
      : [];

    // Build lookup: fragmentId → placed contour from scrapPlacements
    const placementGeom = {};
    for (const sp of (Array.isArray(lastRun.scrapPlacements) ? lastRun.scrapPlacements : [])) {
      if (!sp) continue;
      const fid = String(sp.fragmentId || sp.id || "");
      if (fid && !placementGeom[fid]) {
        const contour = normalizeContourPoints(sp.resultContourSnapshot || sp.alignedContour || []);
        if (contour.length >= 3) placementGeom[fid] = contour;
      }
    }

    // If resultSnapshot has no fragments but scrapPlacements do, synthesize fragment list
    const fragSource = frags.length > 0
      ? frags
      : Object.keys(placementGeom).map(id => ({ id, areaMm2: 0 }));

    for (const f of fragSource) {
      // Enrich fragment with placed geometry if available
      const fid = String(f && (f.id || f.fragmentId) || "");
      const enriched = placementGeom[fid]
        ? { ...f, resultContourSnapshot: placementGeom[fid] }
        : f;
      const points = getFragmentExportPoints(enriched);
      if (points.length < 3) continue;
      resultFragments.push({
        id: String(f.id || `frag_${resultFragments.length}`),
        layoutId: String(layout.id || ""),
        zoneId,
        detailId: Number(zone && zone.detailId || 0),
        materialId: String(zone && zone.materialId || ""),
        napDirectionDeg: Number(zone && zone.napDirectionDeg || 0),
        points,
        areaMm2: Number(f.areaMm2 || 0)
      });
    }
  }

  // Compute seams per zone
  const seamsByZone = new Map();
  if (seamMode !== "none") {
    for (const zoneId of targetZoneIds) {
      const fragsInZone = resultFragments.filter((f) => f.zoneId === zoneId);
      if (fragsInZone.length >= 2) {
        seamsByZone.set(zoneId, computeSharedSeams(fragsInZone, 2));
      }
    }
  }

  const allSeams = [];
  for (const [, seams] of seamsByZone) allSeams.push(...seams);

  // Collect used materials — normalise IDs by stripping curly braces for lookup
  const normId = (id) => String(id || "").replace(/^\{|\}$/g, "");
  const normMaterials = {};
  for (const [k, v] of Object.entries(materials || {})) normMaterials[normId(k)] = v;

  const usedMaterialIds = new Set(resultFragments.map((f) => f.materialId).filter(Boolean));
  const exportMaterials = [];
  for (const mid of usedMaterialIds) {
    const m = normMaterials[normId(mid)];
    if (m) exportMaterials.push({ materialId: mid, ...m });
    else exportMaterials.push({ materialId: mid });
  }

  return {
    fragments: resultFragments,
    seams: allSeams,
    materials: exportMaterials,
    seamsByZone,
    stats: {
      fragmentsCount: resultFragments.length,
      seamsCount: allSeams.length,
      zonesCount: targetZoneIds.size,
      materialsCount: exportMaterials.length
    }
  };
}

function getLastExportZipPath(deps) {
  return path.join(deps.TMP_DIR || path.join(deps.ROOT_DIR, "tmp"), "last_export.zip");
}

function writeLastExportZip(deps, zip) {
  const lastZipPath = getLastExportZipPath(deps);
  fs.mkdirSync(path.dirname(lastZipPath), { recursive: true });
  fs.writeFileSync(lastZipPath, zip);
  return lastZipPath;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

async function handleExportRoutes(req, res, reqUrl, deps) {
  const { jsonReply, readBodyJson, psPathLiteral, runPowerShell } = deps;

  if (req.method === "POST" && reqUrl.pathname === "/api/export/patterns/preview") {
    const body = await readBodyJson(req);
    const payload = buildExportPayload(body);
    const { stats, fragments } = payload;

    // Zone status: exported / needs-regen (simplified: all zones with fragments = exported)
    const exportedZoneIds = new Set(fragments.map((f) => f.zoneId));
    const zoneStatuses = (body.zones || []).map((z) => ({
      id: Number(z.id),
      name: String(z.name || ""),
      status: exportedZoneIds.has(Number(z.id)) ? "exported" : "no_layout"
    }));

    jsonReply(res, 200, {
      ok: true,
      fragmentsCount: stats.fragmentsCount,
      seamsCount: stats.seamsCount,
      zonesCount: stats.zonesCount,
      materialsCount: stats.materialsCount,
      zoneStatuses
    });
    return true;
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/export/patterns/run") {
    const body = await readBodyJson(req);
    const payload = buildExportPayload(body);
    const { fragments, seams, materials, seamsByZone } = payload;

    if (fragments.length === 0) {
      jsonReply(res, 400, { ok: false, error: "no_fragments" });
      return true;
    }

    const files = [];

    // One DXF per fragment
    const zoneMap = new Map((body.zones || []).map((z) => [Number(z.id), z]));
    for (const frag of fragments) {
      const zone = zoneMap.get(frag.zoneId);
      const zoneSeams = seamsByZone.get(frag.zoneId) || [];
      const dxf = buildFragmentDxf(frag, zone, zoneSeams);
      const zoneName = String(zone && zone.name || `zone_${frag.zoneId}`).replace(/[^a-zA-Z0-9а-яА-Я_-]/g, "_");
      files.push({ name: `fragments/${zoneName}/${frag.id}.dxf`, data: dxf });
    }

    // manifest.json
    const manifest = {
      exportedAt: new Date().toISOString(),
      fragmentsCount: fragments.length,
      seamsCount: seams.length,
      entries: fragments.map((f) => ({
        fragmentId: f.id,
        zoneId: f.zoneId,
        detailId: f.detailId,
        materialId: f.materialId,
        napDirectionDeg: f.napDirectionDeg,
        areaMm2: f.areaMm2,
        dxfPath: `fragments/${String((zoneMap.get(f.zoneId) && zoneMap.get(f.zoneId).name || `zone_${f.zoneId}`)).replace(/[^a-zA-Z0-9а-яА-Я_-]/g, "_")}/${f.id}.dxf`,
        points: f.points
      })),
      seams: seams.map((s) => ({
        fragmentIds: s.fragmentIds,
        lengthMm: s.lengthMm,
        points: s.points
      }))
    };
    files.push({ name: "manifest.json", data: JSON.stringify(manifest, null, 2) });

    // materials.json
    files.push({ name: "materials.json", data: JSON.stringify(materials, null, 2) });

    // One .gltf per unique material — for CLO fabric_api.AddFabric()
    const gltfPaths = {};
    for (const mat of materials) {
      if (!mat || !mat.materialId) continue;
      const safeName = String(mat.name || mat.materialId).replace(/[^a-zA-Z0-9а-яА-Я_-]/g, "_");
      const gltfName = `materials/${safeName}.gltf`;
      const jfabName = `materials/${safeName}.jfab`;
      files.push({ name: gltfName, data: generateGltfString(mat) });
      files.push({ name: jfabName, data: generateJfabString(mat) });
      gltfPaths[mat.materialId] = { gltf: gltfName, jfab: jfabName };
    }

    // Update manifest entries with gltfPath
    manifest.entries = manifest.entries.map((e) => ({
      ...e,
      materialGltfPath: (gltfPaths[e.materialId] && gltfPaths[e.materialId].gltf) || null,
      materialJfabPath: (gltfPaths[e.materialId] && gltfPaths[e.materialId].jfab) || null
    }));
    // Refresh manifest.json in files array
    const manifestIdx = files.findIndex((f) => f.name === "manifest.json");
    if (manifestIdx >= 0) files[manifestIdx].data = JSON.stringify(manifest, null, 2);

    // Bundle CLO import script so the constructor has everything in one ZIP
    const scriptSrc = path.join(deps.ROOT_DIR || path.join(__dirname, "../.."), "public/scripts/clo_import_furlab.py");
    try {
      files.push({ name: "clo_import_furlab.py", data: fs.readFileSync(scriptSrc, "utf8") });
    } catch (_) {}

    const readmeLines = [
      "ИМПОРТ В CLO 3D",
      "===============",
      "",
      "1. Убедитесь что этот ZIP лежит в папке Загрузки (Downloads) или на Рабочем столе.",
      "   Скрипт найдёт его автоматически по имени furlab_export_*.zip",
      "",
      "2. Откройте CLO 3D.",
      "",
      "3. В меню: Edit > Python Script  (или нажмите Alt+Shift+P)",
      "",
      "4. Откройте файл clo_import_furlab.py из этого архива.",
      "   Нажмите Run (кнопка ▶ или F5).",
      "",
      "5. Лекала появятся в сцене CLO с правильным направлением ворса и материалами.",
      "",
      "Если что-то пошло не так — смотрите вывод в консоли Python Script.",
      "Там будут строки [FURLAB] с подробностями.",
    ];
    files.push({ name: "КАК_ИМПОРТИРОВАТЬ_В_CLO.txt", data: readmeLines.join("\r\n") });

    const zip = buildZip(files);

    // If client requested save-dialog mode, use native SaveFileDialog
    if (body._saveDialog) {
      const defaultName = `furlab_export_${new Date().toISOString().slice(0,10)}.zip`;
      const initialDir = deps.ROOT_DIR || "C:\\";
      if (!psPathLiteral || !runPowerShell) {
        jsonReply(res, 500, { ok: false, error: "save_dialog_not_available" });
        return true;
      }
      const ps = [
        "$ErrorActionPreference='Stop'",
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
        "$OutputEncoding = [System.Text.Encoding]::UTF8",
        "Add-Type -AssemblyName System.Windows.Forms",
        "$owner = New-Object System.Windows.Forms.Form",
        "$owner.TopMost = $true",
        "$owner.ShowInTaskbar = $false",
        "$owner.WindowState = 'Minimized'",
        "$owner.Show()",
        "$dlg = New-Object System.Windows.Forms.SaveFileDialog",
        "$dlg.Filter = 'ZIP archive (*.zip)|*.zip|All files (*.*)|*.*'",
        `$dlg.FileName = '${defaultName}'`,
        `$dlg.InitialDirectory = '${psPathLiteral(initialDir)}'`,
        "$dlg.Title = 'Сохранить экспорт FURLAB'",
        "$res = $dlg.ShowDialog($owner)",
        "$owner.Close()",
        "if ($res -eq [System.Windows.Forms.DialogResult]::OK) {",
        "  @{ ok = $true; path = $dlg.FileName } | ConvertTo-Json -Compress",
        "} else {",
        "  @{ ok = $false; path = '' } | ConvertTo-Json -Compress",
        "}"
      ].join("; ");
      const exec = runPowerShell(ps, 300000);
      if (exec.run.error || exec.run.status !== 0) {
        jsonReply(res, 500, { ok: false, error: "save_dialog_failed", stderr: exec.stderr });
        return true;
      }
      let parsed;
      try { parsed = JSON.parse(exec.stdout.trim()); } catch {
        jsonReply(res, 500, { ok: false, error: "save_dialog_parse_failed" });
        return true;
      }
      if (!parsed.ok || !parsed.path) {
        jsonReply(res, 200, { ok: false, cancelled: true });
        return true;
      }
      fs.writeFileSync(parsed.path, zip);
      try { writeLastExportZip(deps, zip); } catch {}
      jsonReply(res, 200, { ok: true, savedTo: parsed.path });
      return true;
    }

    // Save a copy as last_export.zip so CLO import script can fetch it
    try { writeLastExportZip(deps, zip); } catch {}

    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="furlab_export_${Date.now()}.zip"`,
      "Content-Length": String(zip.length)
    });
    res.end(zip);
    return true;
  }

  // Serve last export ZIP for CLO import script
  if (req.method === "GET" && reqUrl.pathname === "/api/export/latest-zip") {
    const lastZipPath = getLastExportZipPath(deps);
    if (!fs.existsSync(lastZipPath)) {
      jsonReply(res, 404, { ok: false, error: "no_export_yet" });
      return true;
    }
    const data = fs.readFileSync(lastZipPath);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="furlab_export_latest.zip"',
      "Content-Length": String(data.length)
    });
    res.end(data);
    return true;
  }

  return false;
}

module.exports = {
  handleExportRoutes,
  buildExportPayload,
  getFragmentExportPoints,
  normalizeContourPoints
};
