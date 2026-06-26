function parseDpiFromPng(u8) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < sig.length; i++) if (u8[i] !== sig[i]) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let p = 8;
  while (p + 12 <= u8.length) {
    const len = dv.getUint32(p, false);
    const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
    const dataStart = p + 8;
    if (type === "pHYs" && len >= 9 && dataStart + 9 <= u8.length) {
      const ppmX = dv.getUint32(dataStart, false);
      const ppmY = dv.getUint32(dataStart + 4, false);
      const unit = u8[dataStart + 8];
      if (unit === 1 && ppmX > 0 && ppmY > 0) {
        return { x: ppmX * 0.0254, y: ppmY * 0.0254 };
      }
      return null;
    }
    p += 12 + len;
  }
  return null;
}

function parseDpiFromJpeg(u8) {
  if (!(u8.length > 4 && u8[0] === 0xff && u8[1] === 0xd8)) return null;
  let p = 2;
  while (p + 4 <= u8.length) {
    if (u8[p] !== 0xff) {
      p++;
      continue;
    }
    const marker = u8[p + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const len = (u8[p + 2] << 8) | u8[p + 3];
    if (len < 2 || p + 2 + len > u8.length) break;
    if (marker === 0xe0) {
      const s = p + 4;
      if (
        s + 13 <= u8.length &&
        u8[s] === 0x4a && u8[s + 1] === 0x46 && u8[s + 2] === 0x49 &&
        u8[s + 3] === 0x46 && u8[s + 4] === 0x00
      ) {
        const units = u8[s + 7];
        const dx = (u8[s + 8] << 8) | u8[s + 9];
        const dy = (u8[s + 10] << 8) | u8[s + 11];
        if (dx > 0 && dy > 0) {
          if (units === 1) return { x: dx, y: dy };
          if (units === 2) return { x: dx * 2.54, y: dy * 2.54 };
        }
      }
    }
    p += 2 + len;
  }
  return null;
}

function parseDpiFromTiff(u8) {
  if (u8.length < 16) return null;
  const le = u8[0] === 0x49 && u8[1] === 0x49;
  const be = u8[0] === 0x4d && u8[1] === 0x4d;
  if (!le && !be) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const rd16 = (o) => dv.getUint16(o, le);
  const rd32 = (o) => dv.getUint32(o, le);
  if (rd16(2) !== 42) return null;
  const ifd = rd32(4);
  if (ifd <= 0 || ifd + 2 > u8.length) return null;

  const count = rd16(ifd);
  let xRes = null;
  let yRes = null;
  let unit = 2;
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > u8.length) break;
    const tag = rd16(e);
    const type = rd16(e + 2);
    const num = rd32(e + 4);
    const val = rd32(e + 8);

    if ((tag === 282 || tag === 283) && type === 5 && num >= 1) {
      if (val + 8 > u8.length) continue;
      const n = rd32(val);
      const d = rd32(val + 4);
      if (d === 0) continue;
      const r = n / d;
      if (tag === 282) xRes = r;
      if (tag === 283) yRes = r;
    } else if (tag === 296) {
      if (type === 3) unit = val & 0xffff;
    }
  }
  if (!(xRes && yRes)) return null;
  if (unit === 3) return { x: xRes * 2.54, y: yRes * 2.54 };
  return { x: xRes, y: yRes };
}

async function parseDpiFromFile(file) {
  // Быстрый путь: для DPI читаем только заголовок файла, а не весь буфер.
  const headBytes = Math.max(64 * 1024, Math.min(512 * 1024, Number(file?.size || 0)));
  const buf = await file.slice(0, headBytes).arrayBuffer();
  const u8 = new Uint8Array(buf);

  const tiff = parseDpiFromTiff(u8);
  if (tiff) return { ...tiff, source: "tiff-meta" };

  const png = parseDpiFromPng(u8);
  if (png) return { ...png, source: "png-pHYs" };

  const jpg = parseDpiFromJpeg(u8);
  if (jpg) return { ...jpg, source: "jpeg-jfif" };

  return null;
}

export async function parseDpiFromFileWithTimeout(file, timeoutMs = 250, enabled = true) {
  if (!file || !enabled) return null;
  let timer = null;
  try {
    return await Promise.race([
      parseDpiFromFile(file),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), Math.max(20, Number(timeoutMs) || 250));
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

