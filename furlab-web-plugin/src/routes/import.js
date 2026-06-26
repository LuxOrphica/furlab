"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

async function handleImportRoutes(req, res, reqUrl, deps) {
  const {
    EXAMPLES_DIR,
    ROOT_DIR,
    DB_PATH,
    previewStore,
    geometryCache,
    jsonReply,
    readBodyJson,
    listDxfInFolder,
    psPathLiteral,
    runPowerShell,
    parseScriptJson,
    runCscript,
    makePreviewItem,
    buildZprjPreviewResult,
    parseDxfGeometry,
    parsePacGeometry,
    parsePosGeometry
  } = deps;

  function psOpenFileDialog({ filter, multiselect, title, initialDir }) {
    return [
      "$ErrorActionPreference='Stop'",
      "Add-Type -AssemblyName System.Windows.Forms",
      "$owner = New-Object System.Windows.Forms.Form",
      "$owner.TopMost = $true",
      "$owner.ShowInTaskbar = $false",
      "$owner.WindowState = 'Minimized'",
      "$owner.Show()",
      `$dlg = New-Object System.Windows.Forms.OpenFileDialog`,
      `$dlg.Filter = '${filter}'`,
      `$dlg.Multiselect = $${multiselect ? "true" : "false"}`,
      `$dlg.Title = '${title}'`,
      `$dlg.InitialDirectory = '${initialDir}'`,
      "$res = $dlg.ShowDialog($owner)",
      "$owner.Close()"
    ].join("; ");
  }

  function normalizeGeometryFormat(raw) {
    const fmt = String(raw || "").trim().toLowerCase();
    if (fmt === "dxf" || fmt === "pac" || fmt === "pos") return fmt;
    return "";
  }

  function resolveFallbackItem(rawItem) {
    if (!rawItem || typeof rawItem !== "object") return null;
    const geometryPath = String(rawItem.geometryPath || rawItem.sourcePath || "").trim();
    if (!geometryPath) return null;
    const geometryFormat =
      normalizeGeometryFormat(rawItem.geometryFormat) ||
      normalizeGeometryFormat(path.extname(geometryPath).replace(/^\./, ""));
    if (!geometryFormat) return null;
    if (!fs.existsSync(geometryPath)) return null;
    const st = fs.statSync(geometryPath);
    return {
      previewIndex: Number(rawItem.previewIndex),
      sourcePath: String(rawItem.sourcePath || geometryPath),
      geometryPath,
      geometryFormat,
      exists: true,
      sizeBytes: Number(st.size || 0),
      modifiedAt: new Date(st.mtimeMs || Date.now()).toISOString()
    };
  }

  // Discover local DXF files in the selected directory.
  if (req.method === "POST" && reqUrl.pathname === "/api/import/dxf/discover") {
    const body = await readBodyJson(req);
    const requestedFolder = String(body.folder || "").trim();
    const folder = requestedFolder || EXAMPLES_DIR;
    const recursive = body.recursive === true;
    if (!folder) return jsonReply(res, 400, { ok: false, error: "folder_required" });
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
      return jsonReply(res, 400, { ok: false, error: "folder_not_found" });
    }
    const files = listDxfInFolder(folder, recursive);
    return jsonReply(res, 200, {
      ok: true,
      folder,
      recursive,
      total: files.length,
      files,
      usedDefaultFolder: requestedFolder ? false : true
    });
  }

  // Open native file dialog for multiple DXF files.
  if (req.method === "POST" && reqUrl.pathname === "/api/import/dxf/pick-files") {
    const initialDir = fs.existsSync(EXAMPLES_DIR) ? EXAMPLES_DIR : "C:\\";
    const ps = [
      psOpenFileDialog({ filter: "DXF files (*.dxf)|*.dxf|All files (*.*)|*.*", multiselect: true, title: "Select DXF files", initialDir: psPathLiteral(initialDir) }),
      "if ($res -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  @{ ok = $true; files = $dlg.FileNames } | ConvertTo-Json -Compress",
      "} else {",
      "  @{ ok = $true; files = @() } | ConvertTo-Json -Compress",
      "}"
    ].join("; ");
    const exec = runPowerShell(ps, 300000);
    if (exec.run.error) return jsonReply(res, 500, { ok: false, error: `pick_files_run_failed: ${exec.run.error.message}` });
    if (exec.run.status !== 0) return jsonReply(res, 400, { ok: false, error: `pick_files_exit_${exec.run.status}`, stderr: exec.stderr });
    try {
      const parsed = parseScriptJson(exec.stdout || "{}");
      const files = Array.isArray(parsed.files) ? parsed.files.map((x) => String(x)) : [];
      return jsonReply(res, 200, { ok: true, files, total: files.length });
    } catch (e) {
      return jsonReply(res, 500, { ok: false, error: `pick_files_parse_failed: ${e.message}`, stdout: exec.stdout });
    }
  }

  // Open native dialog for one ZPRJ project file.
  if (req.method === "POST" && reqUrl.pathname === "/api/import/zprj/pick-file") {
    const initialDir = fs.existsSync(EXAMPLES_DIR) ? EXAMPLES_DIR : "C:\\";
    const ps = [
      psOpenFileDialog({ filter: "CLO project (*.zprj)|*.zprj|All files (*.*)|*.*", multiselect: false, title: "Select ZPRJ file", initialDir: psPathLiteral(initialDir) }),
      "if ($res -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  @{ ok = $true; file = $dlg.FileName } | ConvertTo-Json -Compress",
      "} else {",
      "  @{ ok = $true; file = '' } | ConvertTo-Json -Compress",
      "}"
    ].join("; ");
    const exec = runPowerShell(ps, 300000);
    if (exec.run.error) return jsonReply(res, 500, { ok: false, error: `pick_zprj_run_failed: ${exec.run.error.message}` });
    if (exec.run.status !== 0) return jsonReply(res, 400, { ok: false, error: `pick_zprj_exit_${exec.run.status}`, stderr: exec.stderr });
    try {
      const parsed = parseScriptJson(exec.stdout || "{}");
      const file = String(parsed.file || "");
      return jsonReply(res, 200, { ok: true, file });
    } catch (e) {
      return jsonReply(res, 500, { ok: false, error: `pick_zprj_parse_failed: ${e.message}`, stdout: exec.stdout });
    }
  }

  // Read parts already persisted in Access.
  if (req.method === "GET" && reqUrl.pathname === "/api/project/parts") {
    const scriptPath = path.join(ROOT_DIR, "scripts", "access_read_parts.js");
    const exec = runCscript(scriptPath, [DB_PATH]);
    if (exec.run.error) return jsonReply(res, 500, { ok: false, error: `parts_run_failed: ${exec.run.error.message}` });
    if (exec.run.status !== 0) return jsonReply(res, 400, { ok: false, error: `parts_exit_${exec.run.status}`, stderr: exec.stderr });
    return jsonReply(res, 200, parseScriptJson(exec.stdout));
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/import/dxf/preview") {
    const body = await readBodyJson(req);
    const files = Array.isArray(body.files) ? body.files : [];
    const items = files.map((f, i) => makePreviewItem(f, i));
    const ready = items.filter((x) => x.isReadyForCommit).length;
    const token = crypto.randomUUID();
    const now = Date.now();
    previewStore.set(token, { createdAt: now, lastAccessAt: now, items });
    return jsonReply(res, 200, {
      ok: true,
      mode: "preview_only",
      token,
      totalInput: files.length,
      totalPreview: items.length,
      totalReadyForCommit: ready,
      items
    });
  }

  // Browser-upload DXF preview: accepts file payloads (name + base64) and stores temp files server-side.
  if (req.method === "POST" && reqUrl.pathname === "/api/import/dxf/preview-upload") {
    const body = await readBodyJson(req);
    const inputFiles = Array.isArray(body && body.files) ? body.files : [];
    if (!inputFiles.length) return jsonReply(res, 400, { ok: false, error: "files_required" });
    if (inputFiles.length > 100) return jsonReply(res, 400, { ok: false, error: "too_many_files" });

    const uploadToken = crypto.randomUUID();
    const uploadDir = path.join(ROOT_DIR, "tmp", "import_uploads", uploadToken);
    fs.mkdirSync(uploadDir, { recursive: true });

    const storedPaths = [];
    try {
      for (let i = 0; i < inputFiles.length; i++) {
        const f = inputFiles[i] || {};
        const rawName = String(f.name || `upload_${i + 1}.dxf`).trim() || `upload_${i + 1}.dxf`;
        const safeNameBase = path.basename(rawName).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
        const fileName = safeNameBase.toLowerCase().endsWith(".dxf") ? safeNameBase : `${safeNameBase}.dxf`;
        const dataBase64 = String(f.dataBase64 || "").trim();
        if (!dataBase64) continue;
        const bin = Buffer.from(dataBase64, "base64");
        if (!bin.length) continue;
        const dst = path.join(uploadDir, fileName);
        fs.writeFileSync(dst, bin);
        storedPaths.push(dst);
      }
    } catch (e) {
      return jsonReply(res, 500, { ok: false, error: `upload_write_failed: ${String(e && e.message ? e.message : e)}` });
    }

    if (!storedPaths.length) return jsonReply(res, 400, { ok: false, error: "no_valid_uploaded_files" });

    const items = storedPaths.map((f, i) => makePreviewItem(f, i));
    const ready = items.filter((x) => x.isReadyForCommit).length;
    const token = crypto.randomUUID();
    const now = Date.now();
    previewStore.set(token, {
      createdAt: now,
      lastAccessAt: now,
      sourceType: "upload",
      items,
      cleanupPaths: [uploadDir]
    });
    return jsonReply(res, 200, {
      ok: true,
      mode: "preview_only",
      sourceType: "upload",
      token,
      totalInput: inputFiles.length,
      totalPreview: items.length,
      totalReadyForCommit: ready,
      items
    });
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/import/zprj/preview") {
    const body = await readBodyJson(req);
    const filePath = String(body.filePath || "").trim();
    if (!filePath) return jsonReply(res, 400, { ok: false, error: "file_path_required" });
    if (!fs.existsSync(filePath)) return jsonReply(res, 400, { ok: false, error: "file_not_found" });
    if (path.extname(filePath).toLowerCase() !== ".zprj") return jsonReply(res, 400, { ok: false, error: "not_zprj_file" });
    const prep = buildZprjPreviewResult(filePath);
    if (!prep.ok) return jsonReply(res, 400, prep);
    const token = crypto.randomUUID();
    const now = Date.now();
    previewStore.set(token, {
      createdAt: now,
      lastAccessAt: now,
      sourceType: "zprj",
      items: prep.items,
      cleanupPaths: prep.cleanupPaths
    });
    return jsonReply(res, 200, {
      ok: true,
      mode: "preview_only",
      sourceType: "zprj",
      token,
      filePath,
      totalEntries: prep.entries.length,
      hasZpac: prep.hasZpac,
      hasXml: prep.hasXml,
      hasPac: prep.hasPac,
      hasPos: prep.hasPos,
      totalPreview: prep.items.length,
      totalReadyForCommit: prep.items.filter((x) => x.isReadyForCommit).length,
      totalGeometryItems: prep.items.filter((x) => x.geometryAvailable === true).length,
      items: prep.items
    });
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/import/dxf/commit") {
    return jsonReply(res, 410, {
      ok: false,
      error: "import_to_db_disabled",
      message: "Import to DB is disabled. Preview is available only for viewing."
    });
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/import/zprj/commit") {
    return jsonReply(res, 410, {
      ok: false,
      error: "import_to_db_disabled",
      message: "Import to DB is disabled. Preview is available only for viewing."
    });
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/import/dxf/geometry") {
    const body = await readBodyJson(req);
    const token = String(body.token || "").trim();
    const previewIndex = Number(body.previewIndex);
    let rec = null;
    let item = null;
    let fallbackWithoutToken = false;

    if (token) {
      rec = previewStore.get(token);
      if (rec && Array.isArray(rec.items) && Number.isFinite(previewIndex)) {
        item = rec.items.find((x) => Number(x.previewIndex) === previewIndex) || null;
      }
      if (rec && !item && Number.isFinite(previewIndex) && rec.items.length === 1) {
        item = rec.items[0] || null;
      }
      if (rec && item) {
        rec.lastAccessAt = Date.now();
      }
    }

    if (!item) {
      const fallbackItem = resolveFallbackItem(body.item);
      if (!fallbackItem) {
        if (!token) return jsonReply(res, 400, { ok: false, error: "token_required" });
        if (!rec) return jsonReply(res, 400, { ok: false, error: "preview_not_found_or_expired" });
        if (!Number.isFinite(previewIndex)) return jsonReply(res, 400, { ok: false, error: "preview_index_required" });
        return jsonReply(res, 404, { ok: false, error: "preview_item_not_found" });
      }
      item = fallbackItem;
      fallbackWithoutToken = true;
    }

    if (!item.exists) return jsonReply(res, 400, { ok: false, error: "file_not_found" });
    const geometryPath = String(item.geometryPath || item.sourcePath || "").trim();
    if (!geometryPath || !fs.existsSync(geometryPath)) {
      return jsonReply(res, 400, { ok: false, error: "geometry_not_available_for_item" });
    }

    const geometryFormat = String(item.geometryFormat || "dxf").toLowerCase();
    const cacheKey = `${geometryFormat}__${geometryPath}__${item.modifiedAt || ""}__${item.sizeBytes || 0}`;
    if (geometryCache.has(cacheKey)) {
      return jsonReply(res, 200, {
        ok: true,
        cached: true,
        fallbackWithoutToken,
        item,
        geometry: geometryCache.get(cacheKey)
      });
    }
    try {
      let geometry = null;
      if (geometryFormat === "dxf") geometry = parseDxfGeometry(geometryPath);
      else if (geometryFormat === "pac") geometry = parsePacGeometry(geometryPath);
      else if (geometryFormat === "pos") geometry = parsePosGeometry(geometryPath);
      else return jsonReply(res, 400, { ok: false, error: "unsupported_geometry_format", geometryFormat });
      geometryCache.set(cacheKey, geometry);
      return jsonReply(res, 200, { ok: true, cached: false, fallbackWithoutToken, item, geometry });
    } catch (e) {
      return jsonReply(res, 500, {
        ok: false,
        error: "geometry_parse_failed",
        detail: String(e && e.message ? e.message : e)
      });
    }
  }

  return false;
}

module.exports = {
  handleImportRoutes
};
