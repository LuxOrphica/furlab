const DEFAULT_INVENTORY_TAG_MASK_RX = /^FL-SCR-[0-9]{6}$/;

export function normalizeManualInventoryTagInput(text) {
  const raw = String(text || "").toUpperCase();
  if (!raw.trim()) return "";
  const digits = raw.replace(/\D+/g, "").slice(0, 6);
  return digits ? `FL-SCR-${digits}` : "";
}

export function isInventoryTagValid(tag, maskRx = DEFAULT_INVENTORY_TAG_MASK_RX) {
  const t = String(tag || "").trim().toUpperCase();
  if (!t) return false;
  return maskRx.test(t);
}

export function normalizeInventoryTag(text) {
  if (!text) return "";
  const clean = String(text).trim().toUpperCase();
  if (!clean) return "";
  if (clean.startsWith("(") && clean.endsWith(")")) return "";
  if (/не найден|не распознан|поиск/i.test(clean)) return "";
  const strict = clean.match(/^FL-SCR-(\d{6})$/);
  if (strict) return `FL-SCR-${strict[1]}`;
  const relaxed = clean.match(/FL[\s\-_]*SCR[\s\-_]*(\d{3,10})/i);
  if (relaxed && relaxed[1]) {
    const digits = String(relaxed[1]).replace(/\D+/g, "").slice(0, 6);
    if (digits.length === 6) return `FL-SCR-${digits}`;
  }
  return "";
}

export function getInventoryTagCandidate(manualRaw, qrText) {
  const manual = normalizeInventoryTag(manualRaw);
  if (String(manualRaw || "").trim()) {
    return manual;
  }
  return normalizeInventoryTag(qrText);
}

export function getEffectiveInventoryTag(manualRaw, qrText, maskRx = DEFAULT_INVENTORY_TAG_MASK_RX) {
  const tag = getInventoryTagCandidate(manualRaw, qrText);
  return isInventoryTagValid(tag, maskRx) ? tag : "";
}
