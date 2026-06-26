"use strict";

function createUploadService(deps) {
  const {
    fs,
    path,
    crypto,
    rootDir,
    uploadsDir
  } = deps;

  function sanitizeNamePart(s) {
    return String(s || "piece")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "piece";
  }

  function pickImageExt(fileName, mimeType) {
    const byMime = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/tiff": ".tif",
      "image/webp": ".webp",
      "image/bmp": ".bmp",
      "image/gif": ".gif"
    };
    const ext = path.extname(fileName || "").toLowerCase();
    if (ext && ext.length <= 6) return ext;
    return byMime[String(mimeType || "").toLowerCase()] || ".bin";
  }

  function saveUploadedSourceImage(src, inventoryTag) {
    const fileName = String(src.fileName || "scan");
    const mimeType = String(src.mimeType || "application/octet-stream");
    const dataBase64 = String(src.dataBase64 || "");
    if (!dataBase64) return { ok: false, error: "source_image_empty" };

    const ext = pickImageExt(fileName, mimeType);
    const safeTag = sanitizeNamePart(inventoryTag || "piece");
    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
      const buf = Buffer.from(dataBase64, "base64");
      if (!buf.length) return { ok: false, error: "source_image_decode_failed" };
      const hash = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16);
      const dedupName = `${safeTag}_${hash}${ext}`;
      const dedupPath = path.join(uploadsDir, dedupName);
      if (!fs.existsSync(dedupPath)) {
        fs.writeFileSync(dedupPath, buf);
      }
      const rel = path.relative(rootDir, dedupPath).replace(/\\/g, "/");
      return { ok: true, sourceAssetRef: rel };
    } catch (err) {
      return { ok: false, error: `source_image_save_failed: ${err.message || err}` };
    }
  }

  return {
    saveUploadedSourceImage
  };
}

module.exports = {
  createUploadService
};
